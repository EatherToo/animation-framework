/**
 * core2d 动画：曲线采样、角度展开、时间轴、播放 track 与混合。
 * 权威：docs/22-Spine渲染对标/curves-and-timelines.md、docs/06-动画与曲线.md。
 * 2D 只有标量角与标量通道；不引入四元数/slerp。时间单位为秒。
 *
 * 兼容两套 timeline 描述：
 * - 旧：`{ kind, path, keys: ScalarKey[] }`（importer 与 runtime 使用）；
 * - 新：Spine 4.2 风格 `{ kind, bone|slot|constraint, keys: 专用 Key[] }`。
 * 两者共用同一采样器，避免出现两套语义。
 */
import {
  CH_ROT, CH_X, CH_Y, CH_SX, CH_SY, CH_SHX, CH_SHY, POSE_STRIDE,
  setLocal,
  type Pose,
} from '../core/pose'
import { normalizeAngle } from '../core/math'
import type { BoneId } from '../core/skeleton'
import {
  setDrawOrder, setSlotAttachment, setSlotColor,
  type RGBA, type SlotSet,
} from '../slot/slot'

const TAU = Math.PI * 2
const IDENTITY_BEZIER: Bezier = [1 / 3, 1 / 3, 2 / 3, 2 / 3]
const ZERO_DARK: RGBA = { r: 0, g: 0, b: 0, a: 0 }

/* -------------------------------------------------------------------------- */
/* 曲线                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 段曲线：描述从本键到下一键的插值方式。
 * - `'linear'` / `'stepped'` / `'easeSine'`；
 * - `'bezier'` 使用键上的 `bezier` 字段（兼容旧数据）；
 * - `[cx1,cy1,cx2,cy2, ...]` 每 4 个数一段，多段按时间等分；
 * - `{ bezier: [...] }` 对象编码。
 */
export type Curve =
  | 'linear'
  | 'stepped'
  | 'bezier'
  | 'easeSine'
  | { readonly bezier: readonly [number, number, number, number] }
  | readonly number[]

/** 三次贝塞尔控制点 [c1x, c1y, c2x, c2y]。 */
export type Bezier = readonly [number, number, number, number]

/** 曲线编码非法时的诊断；采样会降级为 linear，保证不产生 NaN。 */
export type CurveDiagnostic = {
  readonly code: 'W_CURVE' | 'E_CURVE'
  readonly message: string
}

let curveDiagnosticSink: ((diagnostic: CurveDiagnostic) => void) | null = null

/** 注册曲线诊断接收器；传 null 关闭。默认静默，避免热路径产生额外分配。 */
export function setCurveDiagnosticSink(sink: ((diagnostic: CurveDiagnostic) => void) | null): void {
  curveDiagnosticSink = sink
}

function warnCurve(message: string): void {
  if (curveDiagnosticSink !== null) curveDiagnosticSink({ code: 'W_CURVE', message })
}

/* -------------------------------------------------------------------------- */
/* 数据模型                                                                    */
/* -------------------------------------------------------------------------- */

/** 标量关键帧；`curve` 描述本键到下一键的插值。 */
export type ScalarKey = {
  readonly time: number
  readonly value: number
  readonly curve?: Curve
  /** 兼容旧编码：仅当 curve='bezier' 时使用。 */
  readonly bezier?: Bezier
}

/** 角度关键帧，语义与 ScalarKey 相同，单独命名便于导入端标注。 */
export type AngleKey = ScalarKey

/** 光源/暗色双通道颜色键；straight 空间，不做 sRGB 转换。 */
export type ColorKey = {
  readonly time: number
  readonly light: RGBA
  readonly dark?: RGBA
  readonly curve?: Curve
  /** Spine 多分量 timeline 中每个颜色分量独立的曲线。 */
  readonly curves?: readonly (Curve | undefined)[]
}

/** 附件切换键；name 为 null 表示隐藏。 */
export type AttachmentKey = {
  readonly time: number
  readonly name: string | null
}

/** deform 键：offset 为起始顶点索引，vertices 为绝对偏移（相对 bind）。 */
export type DeformKey = {
  readonly time: number
  readonly offset: number
  readonly vertices: Float32Array | readonly number[]
  readonly curve?: Curve
}

/** drawOrder 键：从 setup 顺序出发，对每个 slot 做相对移动。 */
export type DrawOrderKey = {
  readonly time: number
  readonly offsets: readonly { readonly slot: number; readonly offset: number }[]
}

/** 事件键；事件在 (prev, curr] 区间派发。 */
export type EventKey = {
  readonly time: number
  readonly name: string
  readonly int?: number
  readonly float?: number
  readonly string?: string
}

/** 约束混合键；mix ∈ [0,1]。 */
export type MixKey = {
  readonly time: number
  readonly mix: number
  readonly curve?: Curve
}

export type ConstraintFrame = {
  readonly time: number
  readonly values: readonly number[]
  readonly curves?: readonly (Curve | undefined)[]
  readonly bendDirection?: 1 | -1
  readonly compress?: boolean
  readonly stretch?: boolean
}

export type ConstraintChannels = {
  readonly kind: 'ik' | 'transform' | 'path' | 'physics' | 'slider'
  readonly values: Readonly<Record<string, number | boolean>>
  readonly alpha: number
  readonly additive: boolean
}

export type ConstraintMixMap = Map<string, number> & {
  channels: Map<string, ConstraintChannels[]>
}

export type ColorChannel = 'rgb' | 'alpha' | 'rgba' | 'rgb2' | 'alpha2' | 'rgba2'

export type TimelineKey =
  | ScalarKey
  | ColorKey
  | AttachmentKey
  | DeformKey
  | DrawOrderKey
  | EventKey
  | MixKey

type TimelineBase = {
  readonly path?: string
  readonly bone?: number
  readonly slot?: number
  readonly constraint?: string
  readonly skin?: string
  readonly attachment?: string
  /** 逐轴 timeline：只写 x 或 y。 */
  readonly axis?: 'x' | 'y'
  readonly channel?: ColorChannel
}

export type ScalarTimeline = TimelineBase & {
  readonly kind:
    | 'rotate' | 'translate' | 'scale' | 'shear'
    | 'ik' | 'transform' | 'path' | 'physics' | 'slider'
    | 'sequence'
  readonly keys: readonly ScalarKey[]
  /** Spine rotation keys retain authored angular direction instead of shortest-arc unwrapping. */
  readonly rawRotation?: boolean
}

export type ConstraintFrameTimeline = Omit<TimelineBase, 'channel'> & {
  readonly kind: 'ik' | 'transform' | 'path' | 'physics' | 'slider'
  readonly channel?: 'time' | 'position' | 'spacing' | 'mix' | 'reset' | 'inertia' | 'strength' | 'damping' | 'mass' | 'wind' | 'gravity'
  readonly frames: readonly ConstraintFrame[]
}

export type AttachmentTimeline = TimelineBase & {
  readonly kind: 'attachment'
  // 可选以免与旧版 `Extract<Timeline, { keys: unknown }>` 的 keys.value 收窄冲突。
  readonly keys?: readonly (ScalarKey | AttachmentKey)[]
}

export type ColorTimeline = TimelineBase & {
  readonly kind: 'color'
  // 可选以免与旧版 `Extract<Timeline, { keys: unknown }>` 的 keys.value 收窄冲突。
  readonly keys?: readonly (ScalarKey | ColorKey)[]
}

export type DeformTimeline = TimelineBase & {
  readonly kind: 'deform'
  // 可选以免与旧版 `Extract<Timeline, { keys: unknown }>` 的 keys.value 收窄冲突。
  readonly keys?: readonly (ScalarKey | DeformKey)[]
  /** Importer metadata: source-space coordinates and retained influence mapping. */
  readonly baseVertices?: Float32Array
  readonly weighted?: boolean
  readonly vertexIndices?: readonly number[]
  readonly unitScale?: number
  readonly flipY?: boolean
}

export type DrawOrderTimeline = TimelineBase & {
  readonly kind: 'drawOrder'
  // 可选以免与旧版 `Extract<Timeline, { keys: unknown }>` 的 keys.value 收窄冲突。
  readonly keys?: readonly (ScalarKey | DrawOrderKey)[]
}

export type EventTimeline = TimelineBase & {
  readonly kind: 'event'
  /** 新编码。 */
  readonly keys?: readonly EventKey[]
  /** 旧编码。 */
  readonly events?: readonly EventKey[]
}

export type Timeline =
  | ScalarTimeline
  | ConstraintFrameTimeline
  | AttachmentTimeline
  | ColorTimeline
  | DeformTimeline
  | DrawOrderTimeline
  | EventTimeline

export type AnimationClip = {
  readonly name: string
  readonly duration: number
  readonly timelines: readonly Timeline[]
}

/** 排队的下一个动画；非循环 clip 结束后接续。 */
export type TrackQueueEntry = {
  readonly clip: AnimationClip
  readonly loop: boolean
  readonly speed: number
  readonly alpha: number
  readonly delay: number
  readonly mixDuration: number
  readonly blendMode: 'replace' | 'additive'
  readonly reverse: boolean
}

/** 每帧可变的播放状态；time 已按 loop 处理，lastTime 为上一帧采样时刻。 */
export type Track = {
  clip: AnimationClip
  time: number
  alpha: number
  speed: number
  loop: boolean
  blendMode: 'replace' | 'additive'
  lastTime: number
  loopCount: number
  /** crossfade 总时长（秒）；0 表示直接使用 alpha。 */
  mixDuration: number
  /** 已完成的 crossfade 时间。 */
  mixTime: number
  /** 起步延迟（秒）；>0 时暂停推进。 */
  delay: number
  /** crossfade 目标 alpha。 */
  targetAlpha: number
  /** Outgoing animation retained during a crossfade. */
  mixingFrom?: Track
  eventThreshold: number
  reverse: boolean
  /** Mix percentage while this entry is outgoing. */
  mixingOutMix?: number
  /** Outgoing timeline weights computed for each mix frame. */
  timelineAlphas?: readonly number[]
  mixAttachmentThreshold?: number
  mixDrawOrderThreshold?: number
  alphaAttachmentThreshold?: number
  queue: TrackQueueEntry[]
}

/** 采样时派发的事件载荷；track 为 track 下标。 */
export type SampledEvent = {
  readonly name: string
  readonly time: number
  readonly track: number
  readonly int?: number
  readonly float?: number
  readonly string?: string
}

export type SampleResult = {
  /** 兼容：本帧触发的事件名，按触发顺序。 */
  events: string[]
  /** 本帧事件完整载荷。 */
  eventData: SampledEvent[]
  dominant: string | null
  /** 兼容：旧 deform timeline 的标量采样值（timeline 路径索引）。 */
  deform: Map<number, number>
  /** 兼容：旧 ik timeline 的 mix（timeline 路径索引）。 */
  ik: Map<number, number>
  /** 新 deform：mesh key → 顶点绝对偏移，长度为 offset*2 + vertices.length。 */
  deformOffsets: Map<string, Float32Array>
  /** 本帧完整绘制顺序；无 drawOrder timeline 时也回填 setup 顺序。 */
  drawOrder?: number[]
  /** 约束 mix，字符串约束使用负数 id（见 constraintNames）。 */
  constraintMix: Map<number, number>
  /** 约束名 → 与 constraintMix 一致的 key。 */
  constraintMixByName: ConstraintMixMap
  /** 负数 key 的名称表：constraintNames[-key-1]。 */
  constraintNames: string[]
  /** sequence 离散帧索引，key 为 slot 下标。 */
  sequence: Map<number, number>
  /** 被 rgb2/alpha2/rgba2 修改的 dark 颜色。 */
  colorDark: Map<number, RGBA>
}
export type 动画采样结果 = SampleResult

export type AnimationEventType = 'start' | 'complete' | 'event'
export type AnimationEvent = {
  readonly type: AnimationEventType
  readonly name: string
  readonly time: number
  readonly track: number
  readonly int?: number
  readonly float?: number
  readonly string?: string
}
export type AnimationListener = (event: AnimationEvent) => void
export type PlayOptions = {
  readonly loop?: boolean
  readonly speed?: number
  readonly alpha?: number
  readonly mixDuration?: number
  readonly delay?: number
  readonly track?: number
  readonly blendMode?: 'replace' | 'additive'
  readonly reverse?: boolean
}

const EMPTY_CLIP: AnimationClip = { name: '__empty', duration: 0, timelines: [] }

/* -------------------------------------------------------------------------- */
/* AnimationState                                                              */
/* -------------------------------------------------------------------------- */

/** Directional crossfade durations between animation clips. */
export class AnimationStateData {
  defaultMix = 0
  private readonly mixes = new Map<string, Map<string, number>>()

  constructor(private readonly clips: ReadonlyMap<string, AnimationClip>) {}

  setMix(from: string | AnimationClip, to: string | AnimationClip, duration: number): void {
    const fromName = this.nameOf(from)
    const toName = this.nameOf(to)
    let destinations = this.mixes.get(fromName)
    if (destinations === undefined) {
      destinations = new Map()
      this.mixes.set(fromName, destinations)
    }
    destinations.set(toName, duration)
  }

  getMix(from: string | AnimationClip, to: string | AnimationClip): number {
    return this.mixes.get(this.nameOf(from))?.get(this.nameOf(to)) ?? this.defaultMix
  }

  private nameOf(clip: string | AnimationClip): string {
    if (typeof clip !== 'string') return clip.name
    if (!this.clips.has(clip)) throw new Error('E_ANIM')
    return clip
  }
}

/**
 * 文档 12 §3 的门面：管理多 track、时间缩放、暂停/恢复与帧末事件派发。
 * 采样与混合仍复用 sampleAnimation，避免两套语义。
 */
export class AnimationState {
  readonly data: AnimationStateData
  private readonly clips: ReadonlyMap<string, AnimationClip>
  private readonly pose: Pose
  private readonly slotSet: SlotSet
  private readonly listeners = new Map<AnimationEventType, Set<AnimationListener>>()
  private readonly savedSpeed = new WeakMap<Track, number>()
  private readonly _tracks: Track[] = []
  private timeScale = 1
  private disposed = false

  constructor(clips: ReadonlyMap<string, AnimationClip>, pose: Pose, slotSet: SlotSet, data?: AnimationStateData) {
    this.clips = clips
    this.pose = pose
    this.slotSet = slotSet
    this.data = data ?? new AnimationStateData(clips)
  }

  get tracks(): Track[] {
    return this._tracks
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('E_DISPOSED')
  }

  play(name: string, options: PlayOptions = {}): Track {
    this.assertLive()
    const clip = this.clips.get(name)
    if (clip === undefined) throw new Error('E_ANIM')
    const index = Math.max(0, Math.floor(options.track ?? 0))
    while (this._tracks.length <= index) this._tracks.push(createTrack(EMPTY_CLIP))
    const targetAlpha = options.alpha ?? 1
    const outgoing = this._tracks[index]
    const previous = outgoing?.clip
    const mixDuration = options.mixDuration ?? (previous === undefined || previous === EMPTY_CLIP
      ? 0 : this.data.getMix(previous, clip))
    const track = createTrack(clip, {
      loop: options.loop ?? true,
      speed: options.speed ?? 1,
      alpha: mixDuration > 0 ? 0 : targetAlpha,
      delay: options.delay ?? 0,
      mixDuration,
      targetAlpha,
      reverse: options.reverse ?? false,
      ...(options.blendMode === undefined ? {} : { blendMode: options.blendMode }),
    })
    if (mixDuration > 0 && outgoing !== undefined && outgoing.clip !== EMPTY_CLIP) track.mixingFrom = outgoing
    this._tracks[index] = track
    this.dispatch({ type: 'start', name, time: 0, track: index })
    return track
  }

  /** 把动画排到指定 track 末尾；非循环播放结束后自动接续。 */
  queue(name: string, options: PlayOptions = {}): Track {
    this.assertLive()
    const clip = this.clips.get(name)
    if (clip === undefined) throw new Error('E_ANIM')
    const index = Math.max(0, Math.floor(options.track ?? 0))
    while (this._tracks.length <= index) this._tracks.push(createTrack(EMPTY_CLIP))
    const track = this._tracks[index]!
    if (track.clip === EMPTY_CLIP || track.clip.duration === 0) return this.play(name, options)
    const last = track.queue[track.queue.length - 1]
    const previous = last?.clip ?? track.clip
    const mixDuration = options.mixDuration ?? this.data.getMix(previous, clip)
    const start = last === undefined ? track.time : 0
    const complete = track.loop && last === undefined && track.clip.duration > 0
      ? (Math.floor(start / track.clip.duration) + 1) * track.clip.duration
      : previous.duration
    track.queue.push({
      clip,
      loop: options.loop ?? true,
      speed: options.speed ?? 1,
      alpha: options.alpha ?? 1,
      delay: options.delay !== undefined && options.delay > 0 ? options.delay
        : Math.max(0, complete - mixDuration + (options.delay ?? 0)),
      mixDuration,
      blendMode: options.blendMode ?? 'replace',
      reverse: options.reverse ?? false,
    })
    return track
  }

  stop(track?: Track): void {
    this.assertLive()
    if (track === undefined) { this._tracks.length = 0; return }
    const index = this._tracks.indexOf(track)
    if (index >= 0) this._tracks.splice(index, 1)
  }

  pause(track?: Track): void {
    this.assertLive()
    const list = track === undefined ? this._tracks : [track]
    for (const t of list) {
      if (!this.savedSpeed.has(t)) this.savedSpeed.set(t, t.speed)
      t.speed = 0
    }
  }

  resume(track?: Track): void {
    this.assertLive()
    const list = track === undefined ? this._tracks : [track]
    for (const t of list) {
      const saved = this.savedSpeed.get(t)
      if (saved !== undefined) { t.speed = saved; this.savedSpeed.delete(t) }
    }
  }

  setTimeScale(scale: number): void {
    this.assertLive()
    if (!Number.isFinite(scale) || scale < 0) throw new Error('E_TRACK')
    this.timeScale = scale
  }

  addListener(type: AnimationEventType, fn: AnimationListener): () => void {
    this.assertLive()
    let set = this.listeners.get(type)
    if (set === undefined) { set = new Set(); this.listeners.set(type, set) }
    set.add(fn)
    return () => { set!.delete(fn) }
  }

  private dispatch(event: AnimationEvent): void {
    const set = this.listeners.get(event.type)
    if (set === undefined) return
    for (const fn of set) {
      try { fn(event) } catch { /* 监听器异常隔离 */ }
    }
  }

  update(dt: number): SampleResult {
    this.assertLive()
    if (!Number.isFinite(dt) || dt < 0) throw new Error('E_TRACK')
    const scaled = dt * this.timeScale
    // Spine tests queued delays against the last applied track time, then
    // carries the excess into the new entry before advancing this frame.
    this._tracks.forEach((track, index) => {
      const next = track.queue[0]
      if (next === undefined) return
      const elapsed = track.lastTime + track.loopCount * track.clip.duration
      if (elapsed < next.delay) return
      track.queue.shift()
      const outgoing = { ...track, queue: [] }
      applyQueueEntry(track, next)
      track.time = Math.max(0, elapsed - next.delay)
      track.lastTime = track.time
      if (next.mixDuration > 0) track.mixingFrom = outgoing
      this.dispatch({ type: 'start', name: next.clip.name, time: 0, track: index })
    })
    const prevLast = this._tracks.map((track) => track.lastTime)
    const active: Track[] = []
    const indices: number[] = []
    for (let index = 0; index < this._tracks.length; index += 1) {
      const track = this._tracks[index]!
      const chain: Track[] = []
      for (let entry = track.mixingFrom; entry !== undefined; entry = entry.mixingFrom) chain.unshift(entry)
      for (const entry of chain) {
        if (entry.mixDuration > 0) entry.mixTime = Math.min(entry.mixDuration, entry.mixTime + scaled)
      }
      for (let i = 0; i < chain.length; i += 1) {
        const from = chain[i]!
        const to = chain[i + 1] ?? track
        const mix = to.mixDuration > 0 ? Math.min(1, (to.mixTime + scaled) / to.mixDuration) : 1
        const fromMix = i === 0 ? 1 : from.mixDuration > 0
          ? Math.min(1, from.mixTime / from.mixDuration) : 1
        const a = from.targetAlpha * fromMix
        const alphaMix = a * (1 - mix)
        const keep = 1 - mix * to.targetAlpha
        const alphaHold = keep > 0 ? alphaMix / keep : a
        from.timelineAlphas = from.clip.timelines.map(timeline => {
          if (timeline.kind === 'event' || !to.clip.timelines.some(other => timelineId(other) === timelineId(timeline)))
            return alphaMix
          for (let j = i + 2; j <= chain.length; j += 1) {
            const next = chain[j] ?? track
            if (!next.clip.timelines.some(other => timelineId(other) === timelineId(timeline))) {
              const nextMix = next.mixDuration > 0 ? Math.min(1, (next.mixTime + scaled) / next.mixDuration) : 1
              return alphaHold * (1 - nextMix)
            }
          }
          return alphaHold
        })
        from.alpha = Math.max(0, ...from.timelineAlphas)
        from.mixingOutMix = mix
        active.push(from)
        indices.push(index)
      }
      active.push(track)
      indices.push(index)
    }
    const result = sampleAnimation(active, this.pose, this.slotSet, scaled)
    if (this._tracks.length === 1 && this._tracks[0]?.clip === EMPTY_CLIP &&
      this._tracks[0].mixTime >= this._tracks[0].mixDuration) {
      for (let bone = 0; bone < this.pose.skeleton.setupLocal.length / POSE_STRIDE; bone += 1) {
        for (let channel = 0; channel < POSE_STRIDE; channel += 1) {
          setLocal(this.pose, bone, channel, this.pose.skeleton.setupLocal[bone * POSE_STRIDE + channel]!)
        }
      }
    }
    result.eventData = result.eventData.map(event => ({ ...event, track: indices[event.track] ?? event.track }))
    for (const [index, track] of this._tracks.entries()) {
      if (track.mixingFrom !== undefined && track.mixTime >= track.mixDuration) delete track.mixingFrom
      if (track.clip === EMPTY_CLIP && (prevLast[index] ?? 0) > track.mixDuration) {
        this._tracks[index] = createTrack(EMPTY_CLIP, { alpha: 0, speed: 0 })
      }
    }
    const pending: AnimationEvent[] = []
    for (const event of result.eventData) {
      pending.push({
        type: 'event',
        name: event.name,
        time: event.time,
        track: event.track,
        ...(event.int === undefined ? {} : { int: event.int }),
        ...(event.float === undefined ? {} : { float: event.float }),
        ...(event.string === undefined ? {} : { string: event.string }),
      })
    }
    // 事件在帧末统一派发；complete 与 queue 接续也在此刻发生。
    this._tracks.forEach((track, index) => {
      const duration = track.clip.duration
      if (!track.loop && duration > 0 && track.time >= duration && (prevLast[index] ?? 0) < duration) {
        pending.push({ type: 'complete', name: track.clip.name, time: track.time, track: index })
      }
    })
    for (const event of pending) this.dispatch(event)

    return result
  }

  /** Transition a track to setup pose; zero duration takes effect on the next update. */
  setEmptyAnimation(index: number, mixDuration = 0): Track {
    this.assertLive()
    while (this._tracks.length <= index) this._tracks.push(createTrack(EMPTY_CLIP))
    const previous = this._tracks[index]!
    const empty = createTrack(EMPTY_CLIP, { loop: false, mixDuration,
      alpha: mixDuration > 0 ? 0 : 1, targetAlpha: 1 })
    if (mixDuration > 0 && previous.clip !== EMPTY_CLIP) empty.mixingFrom = previous
    this._tracks[index] = empty
    return empty
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this._tracks.length = 0
    this.listeners.clear()
  }
}

function timelineId(timeline: Timeline): string {
  if (timeline.kind === 'event') return 'event'
  const target = timeline.bone ?? timeline.slot ?? timeline.constraint ?? timeline.path ?? ''
  const component = timeline.axis ?? (timeline.path === undefined ? '' : targetOf(timeline.path).component)
  return `${timeline.kind}:${target}:${component}:${timeline.channel ?? ''}:${timeline.skin ?? ''}:${timeline.attachment ?? ''}`
}

function applyQueueEntry(track: Track, entry: TrackQueueEntry): void {
  track.clip = entry.clip
  track.time = 0
  track.lastTime = 0
  track.loopCount = 0
  track.loop = entry.loop
  track.speed = entry.speed
  track.delay = 0
  track.mixDuration = entry.mixDuration
  track.mixTime = 0
  track.targetAlpha = entry.alpha
  track.alpha = entry.mixDuration > 0 ? 0 : entry.alpha
  track.blendMode = entry.blendMode
  track.reverse = entry.reverse
}

/** 建立 track；默认循环播放、完全替换、1 倍速。 */
export function createTrack(
  clip: AnimationClip,
  options?: Partial<Pick<
    Track,
    'alpha' | 'speed' | 'loop' | 'blendMode' | 'time' | 'delay' | 'mixDuration' | 'targetAlpha' | 'reverse' | 'eventThreshold'
  >>,
): Track {
  const alpha = options?.alpha ?? 1
  return {
    clip,
    time: options?.time ?? 0,
    alpha,
    speed: options?.speed ?? 1,
    loop: options?.loop ?? true,
    blendMode: options?.blendMode ?? 'replace',
    lastTime: options?.time ?? 0,
    loopCount: 0,
    mixDuration: options?.mixDuration ?? 0,
    mixTime: 0,
    delay: options?.delay ?? 0,
    targetAlpha: options?.targetAlpha ?? alpha,
    eventThreshold: options?.eventThreshold ?? 0,
    reverse: options?.reverse ?? false,
    queue: [],
  }
}

/* -------------------------------------------------------------------------- */
/* 曲线求值                                                                    */
/* -------------------------------------------------------------------------- */

function clamp01(v: number): number {
  if (v <= 0) return 0
  if (v >= 1) return 1
  return v
}

/** 官方允许控制点交错或越界；只拒绝非有限值。 */
function validSegment(segment: readonly number[]): boolean {
  if (segment.length !== 4) return false
  for (let i = 0; i < 4; i += 1) {
    if (!Number.isFinite(segment[i])) return false
  }
  return true
}

/** 已校验的曲线段缓存；曲线是只读数据，按对象身份复用，避免逐帧重复校验。 */
const segmentCache = new WeakMap<object, readonly number[] | null>()

function curveSegments(curve: Curve | undefined, bezier: Bezier | undefined): readonly number[] | null {
  if (curve === 'bezier') {
    const b = bezier ?? IDENTITY_BEZIER
    const cached = segmentCache.get(b)
    if (cached !== undefined) return cached
    const result = validSegment(b) ? b : null
    segmentCache.set(b, result)
    return result
  }
  if (Array.isArray(curve)) {
    const cached = segmentCache.get(curve)
    if (cached !== undefined) return cached
    let result: readonly number[] | null = curve.length >= 4 && curve.length % 4 === 0 ? curve : null
    if (result !== null) {
      for (let i = 0; i < curve.length; i += 4) {
        if (!validSegment(curve.slice(i, i + 4))) { result = null; break }
      }
    }
    segmentCache.set(curve, result)
    return result
  }
  if (typeof curve === 'object' && curve !== null && 'bezier' in curve) {
    const cached = segmentCache.get(curve)
    if (cached !== undefined) return cached
    const result = validSegment(curve.bezier) ? curve.bezier : null
    segmentCache.set(curve, result)
    return result
  }
  return null
}

function wantsBezier(curve: Curve | undefined): boolean {
  return curve === 'bezier' || Array.isArray(curve)
    || (typeof curve === 'object' && curve !== null && 'bezier' in curve)
}

/**
 * 多段 Bezier：n 段把 [0,1] 等分，第 i 段在段内用第 i 组控制点求 y，
 * 再映射回全局 ((i + y) / n)。
 */
const bezierPointCache = new WeakMap<object, Float32Array[]>()

function bezierFraction(t: number, segments: readonly number[]): number {
  const count = segments.length / 4
  const scaled = clamp01(t) * count
  const index = Math.min(count - 1, Math.floor(scaled))
  const local = scaled - index
  const base = index * 4
  const x1 = segments[base]!, y1 = segments[base + 1]!
  const x2 = segments[base + 2]!, y2 = segments[base + 3]!
  let cached = bezierPointCache.get(segments)
  if (cached === undefined) {
    cached = []
    bezierPointCache.set(segments, cached)
  }
  let points = cached[index]
  if (points === undefined) {
    points = new Float32Array(18)
    cached[index] = points
    const tmpx = (-2 * x1 + x2) * 0.03, tmpy = (-2 * y1 + y2) * 0.03
    const dddx = (3 * (x1 - x2) + 1) * 0.006, dddy = (3 * (y1 - y2) + 1) * 0.006
    let ddx = 2 * tmpx + dddx, ddy = 2 * tmpy + dddy
    let dx = x1 * 0.3 + tmpx + dddx * 0.16666667
    let dy = y1 * 0.3 + tmpy + dddy * 0.16666667
    let x = dx, y = dy
    for (let i = 0; i < 18; i += 2) {
      points[i] = x
      points[i + 1] = y
      dx += ddx; dy += ddy
      ddx += dddx; ddy += dddy
      x += dx; y += dy
    }
  }
  let prevX = 0, prevY = 0
  for (let i = 0; i <= 18; i += 2) {
    const nextX = i === 18 ? 1 : points[i]!
    const nextY = i === 18 ? 1 : points[i + 1]!
    if (local <= nextX || i === 18) {
      const localY = prevY + (local - prevX) / (nextX - prevX) * (nextY - prevY)
      return count === 1 ? localY : (index + localY) / count
    }
    prevX = nextX; prevY = nextY
  }
  return 1
}

/** Parent 式 3.19：正弦加速 + 匀速 + 正弦减速，默认 k1=0.25, k2=0.75。 */
function easeSineFraction(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const k1 = 0.25
  const k2 = 0.75
  const a = k1 / (Math.PI / 2)
  const b = (1 - k2) / (Math.PI / 2)
  const d = a + (k2 - k1) + b
  let s: number
  if (t < k1) {
    s = a * (1 - Math.cos(Math.PI * t / (2 * k1)))
  } else if (t < k2) {
    s = a + (t - k1)
  } else {
    const w = (t - k2) / (1 - k2)
    s = a + (k2 - k1) + b * Math.sin(w * Math.PI / 2)
  }
  return s / d
}

function curveFraction(curve: Curve | undefined, u: number, bezier: Bezier | undefined): number {
  const t = clamp01(u)
  switch (curve) {
    case undefined:
    case 'linear':
      return t
    case 'stepped':
      // stepped 保持当前值：区间内返回 0，到达下一键才切换。
      return t >= 1 ? 1 : 0
    case 'easeSine':
      return easeSineFraction(t)
    default:
      break
  }
  const segments = curveSegments(curve, bezier)
  if (segments === null) {
    if (wantsBezier(curve)) warnCurve(`非法 Bezier 曲线，已降级为 linear：${String(curve)}`)
    return t
  }
  return bezierFraction(t, segments)
}

/** 最后一个 time <= t 的键下标；t 小于首键返回 0。 */
function lastKeyIndex(keys: readonly { readonly time: number }[], time: number): number {
  if (keys.length === 0) return -1
  if (time <= keys[0]!.time) return 0
  let lo = 0
  let hi = keys.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (keys[mid]!.time <= time) lo = mid
    else hi = mid
  }
  return keys[hi]!.time <= time ? hi : lo
}

/** 在标量关键帧序列上采样；空序列返回 0；时间夹在首尾；末键后保持末值。 */
export function sampleScalar(keys: readonly ScalarKey[], time: number): number {
  if (keys.length === 0) return 0
  const first = keys[0]!
  if (keys.length === 1 || time <= first.time) return first.value
  const last = keys[keys.length - 1]!
  if (time >= last.time) return last.value

  const index = lastKeyIndex(keys, time)
  const k0 = keys[index]!
  const k1 = keys[index + 1]!
  const span = k1.time - k0.time
  const u = span <= 0 ? 1 : (time - k0.time) / span
  const f = curveFraction(k0.curve, u, k0.bezier)
  return k0.value + (k1.value - k0.value) * f
}

/** 离散采样：不做插值，取最后一个已到达的键。 */
function sampleStepped(keys: readonly ScalarKey[], time: number): number {
  if (keys.length === 0) return 0
  return keys[lastKeyIndex(keys, time)]!.value
}

/** 2D 最短有符号角差 to-from，落在 [-π, π)。 */
export function shortestAngle(from: number, to: number): number {
  return normalizeAngle(to - from)
}

/**
 * 把相邻键按最短弧展开成连续角。原始差达到或超过一圈时视为作者显式记录
 * 的连续角（如 720°），保留整圈不折叠；普通差走最短弧（350°→10° 为 -20°）。
 */
export function unwrapRotateKeys(keys: readonly ScalarKey[]): ScalarKey[] {
  if (keys.length === 0) return []
  const out: ScalarKey[] = [{ ...keys[0]! }]
  let acc = keys[0]!.value
  for (let i = 1; i < keys.length; i += 1) {
    const raw = keys[i]!.value - acc
    const next = Math.abs(raw) >= TAU - 1e-9 ? acc + raw : acc + normalizeAngle(raw)
    out.push({ ...keys[i]!, value: next })
    acc = next
  }
  return out
}

const unwrapCache = new WeakMap<readonly ScalarKey[], ScalarKey[]>()

function unwrappedAngles(keys: readonly ScalarKey[]): ScalarKey[] {
  const cached = unwrapCache.get(keys)
  if (cached !== undefined) return cached
  const unwrapped = unwrapRotateKeys(keys)
  unwrapCache.set(keys, unwrapped)
  return unwrapped
}

/**
 * 角度采样：先展开为连续角（保留显式多圈），再按曲线插值。
 * 循环时样品仍是连续值，不会在 ±π 处折返。
 */
export function sampleAngle(keys: readonly ScalarKey[], time: number): number {
  if (keys.length === 0) return 0
  return sampleScalar(unwrappedAngles(keys), time)
}

/* -------------------------------------------------------------------------- */
/* 目标解析                                                                    */
/* -------------------------------------------------------------------------- */

type Component = 'all' | 'x' | 'y' | 'sx' | 'sy' | 'shx' | 'shy'
const SUFFIXES: Readonly<Record<string, Component>> = {
  x: 'x', y: 'y', sx: 'sx', sy: 'sy', shx: 'shx', shy: 'shy',
}
const CHANNEL_OF: Readonly<Record<Exclude<Component, 'all'>, number>> = {
  x: CH_X, y: CH_Y, sx: CH_SX, sy: CH_SY, shx: CH_SHX, shy: CH_SHY,
}

/** path 支持 'bone'（写全部分量）与 'bone.x' 等分量后缀。 */
function targetOf(path: string): { target: string; component: Component } {
  const dot = path.lastIndexOf('.')
  if (dot > 0) {
    const component = SUFFIXES[path.slice(dot + 1).toLowerCase()]
    if (component !== undefined) return { target: path.slice(0, dot), component }
  }
  return { target: path, component: 'all' }
}

function axisComponent(
  kind: 'translate' | 'scale' | 'shear',
  axis: 'x' | 'y',
): Exclude<Component, 'all'> {
  if (kind === 'translate') return axis
  if (kind === 'scale') return axis === 'x' ? 'sx' : 'sy'
  return axis === 'x' ? 'shx' : 'shy'
}

function componentsOf(
  kind: 'translate' | 'scale' | 'shear',
  component: Component,
): readonly Exclude<Component, 'all'>[] {
  if (component !== 'all') return [component]
  if (kind === 'translate') return ['x', 'y']
  if (kind === 'scale') return ['sx', 'sy']
  return ['shx', 'shy']
}

function boneOf(
  timeline: TimelineBase,
  skeleton: Pose['skeleton'],
): BoneId | undefined {
  if (timeline.bone !== undefined) return timeline.bone
  if (timeline.path === undefined) return undefined
  return skeleton.boneIdByName.get(targetOf(timeline.path).target)
}

function slotOf(timeline: TimelineBase): number {
  if (timeline.slot !== undefined) return timeline.slot
  const parsed = Number.parseInt(timeline.path ?? '', 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function deformMeshKey(timeline: DeformTimeline, slot: number): string {
  return `${timeline.skin ?? 'default'}:${slot}:${timeline.attachment ?? ''}`
}

/* -------------------------------------------------------------------------- */
/* 关键帧类型守卫                                                              */
/* -------------------------------------------------------------------------- */

function isScalarKey(key: TimelineKey): key is ScalarKey {
  return 'value' in key
}
function isDeformKey(key: TimelineKey): key is DeformKey {
  return 'vertices' in key
}
function isDrawOrderKey(key: TimelineKey): key is DrawOrderKey {
  return 'offsets' in key
}
function isAttachmentKey(key: TimelineKey): key is AttachmentKey {
  return 'name' in key && !('value' in key)
}

/* -------------------------------------------------------------------------- */
/* 颜色                                                                        */
/* -------------------------------------------------------------------------- */

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function mixRGBA(from: RGBA, to: RGBA, alpha: number): RGBA {
  return {
    r: lerp(from.r, to.r, alpha),
    g: lerp(from.g, to.g, alpha),
    b: lerp(from.b, to.b, alpha),
    a: lerp(from.a, to.a, alpha),
  }
}

const PACKED_MASK = 0xff

function unpackColor(packed: number): RGBA {
  return {
    a: ((packed >>> 24) & PACKED_MASK) / 255,
    r: ((packed >>> 16) & PACKED_MASK) / 255,
    g: ((packed >>> 8) & PACKED_MASK) / 255,
    b: (packed & PACKED_MASK) / 255,
  }
}

type SampledColor = { readonly light: RGBA; readonly dark: RGBA; readonly legacy: number | null }

function sampleColorKeys(
  keys: readonly (ScalarKey | ColorKey)[],
  time: number,
  channel?: ColorChannel,
): SampledColor {
  if (keys.length === 0) return { light: ZERO_DARK, dark: ZERO_DARK, legacy: null }
  const first = keys[0]!
  if (isScalarKey(first)) {
    const packed = sampleScalar(keys as readonly ScalarKey[], time)
    return { light: unpackColor(packed), dark: ZERO_DARK, legacy: packed }
  }
  const colorKeys = keys as readonly ColorKey[]
  if (colorKeys.length === 1 || time <= colorKeys[0]!.time) {
    const key = colorKeys[0]!
    return { light: key.light, dark: key.dark ?? ZERO_DARK, legacy: null }
  }
  const last = colorKeys[colorKeys.length - 1]!
  if (time >= last.time) {
    return { light: last.light, dark: last.dark ?? ZERO_DARK, legacy: null }
  }
  const index = lastKeyIndex(colorKeys, time)
  const k0 = colorKeys[index]!
  const k1 = colorKeys[index + 1]!
  const span = k1.time - k0.time
  const u = span <= 0 ? 1 : (time - k0.time) / span
  const fraction = (index: number) => curveFraction(k0.curves === undefined ? k0.curve : k0.curves[index], u, undefined)
  const d0 = k0.dark ?? ZERO_DARK
  const d1 = k1.dark ?? ZERO_DARK
  const darkOffset = channel === 'rgb2' ? 3 : 4
  return {
    light: {
      r: lerp(k0.light.r, k1.light.r, fraction(0)),
      g: lerp(k0.light.g, k1.light.g, fraction(1)),
      b: lerp(k0.light.b, k1.light.b, fraction(2)),
      a: lerp(k0.light.a, k1.light.a, fraction(channel === 'alpha' ? 0 : 3)),
    },
    dark: {
      r: lerp(d0.r, d1.r, fraction(darkOffset)),
      g: lerp(d0.g, d1.g, fraction(darkOffset + 1)),
      b: lerp(d0.b, d1.b, fraction(darkOffset + 2)),
      a: lerp(d0.a, d1.a, fraction(7)),
    },
    legacy: null,
  }
}

type PendingColor = { light: RGBA; dark: RGBA }

function applyColorChannels(
  pending: PendingColor,
  sampled: SampledColor,
  channel: ColorChannel | undefined,
  alpha: number,
): PendingColor {
  const mode: ColorChannel = channel ?? 'rgba'
  let light = pending.light
  let dark = pending.dark
  if (mode === 'rgb' || mode === 'rgba' || mode === 'rgb2' || mode === 'rgba2') {
    light = mixRGBA(light, { ...light, r: sampled.light.r, g: sampled.light.g, b: sampled.light.b }, alpha)
  }
  if (mode === 'alpha' || mode === 'rgba' || mode === 'rgba2') {
    light = mixRGBA(light, { ...light, a: sampled.light.a }, alpha)
  }
  if (mode === 'rgb2' || mode === 'rgba2') {
    dark = mixRGBA(dark, { ...dark, r: sampled.dark.r, g: sampled.dark.g, b: sampled.dark.b }, alpha)
  }
  if (mode === 'alpha2') {
    dark = mixRGBA(dark, { ...dark, a: sampled.dark.a }, alpha)
  }
  return { light, dark }
}

/* -------------------------------------------------------------------------- */
/* deform / drawOrder                                                          */
/* -------------------------------------------------------------------------- */

function sampleDeformKeys(keys: readonly DeformKey[], time: number, timeline: DeformTimeline): DeformKey {
  const first = keys[0]!
  if (timeline.unitScale === undefined && timeline.baseVertices === undefined && timeline.vertexIndices === undefined) {
    return keys[lastKeyIndex(keys, time)]!
  }
  const length = timeline.baseVertices?.length ?? (timeline.vertexIndices?.length ?? 0) * 2
  const sampled = new Float32Array(length)
  const index = lastKeyIndex(keys, time)
  const from = keys[index]!
  const to = keys[Math.min(index + 1, keys.length - 1)]!
  const span = to.time - from.time
  const factor = span > 0 && time > from.time && index + 1 < keys.length
    ? curveFraction(from.curve, (time - from.time) / span, undefined) : 0
  const component = (key: DeformKey, sourceIndex: number, targetIndex: number): number => {
    if (sourceIndex < 0) return 0
    const raw = key.vertices[sourceIndex - key.offset]
    if (raw === undefined) return 0
    const scale = (timeline.unitScale ?? 1) * (targetIndex % 2 === 1 && timeline.flipY ? -1 : 1)
    return raw * scale - (timeline.weighted ? 0 : timeline.baseVertices?.[targetIndex] ?? 0)
  }
  for (let i = 0; i < length; i += 1) {
    const influenceSource = timeline.vertexIndices?.[Math.floor(i / 2)] ?? -1
    const source = timeline.weighted ? (influenceSource < 0 ? -1 : influenceSource + i % 2) : i
    const a = component(from, source, i)
    sampled[i] = a + (component(to, source, i) - a) * factor
  }
  return { time, offset: 0, vertices: sampled }
}

function accumulateDeform(
  target: Map<string, Float32Array>,
  key: DeformKey,
  alpha: number,
  meshKey: string,
): void {
  if (alpha <= 0) return
  const offset = Math.max(0, Math.floor(key.offset))
  const start = offset * 2
  const needed = start + key.vertices.length
  let acc = target.get(meshKey)
  if (acc === undefined || acc.length < needed) {
    const grown = new Float32Array(needed)
    if (acc !== undefined) grown.set(acc)
    acc = grown
    target.set(meshKey, acc)
  }
  for (let i = 0; i < key.vertices.length; i += 1) {
    acc[start + i] = acc[start + i]! + key.vertices[i]! * alpha
  }
}

/** 从 setup 顺序重建，绝不在上一帧结果上移动，避免循环漂移。 */
function setupDrawOrder(slotSet: SlotSet): number[] {
  return slotSet.slots
    .map((_, index) => index)
    .sort((a, b) => slotSet.slots[a]!.data.order - slotSet.slots[b]!.data.order || a - b)
}

function applyDrawOffsets(
  base: readonly number[],
  offsets: readonly { readonly slot: number; readonly offset: number }[],
): number[] {
  const order = base.slice()
  for (const { slot, offset } of offsets) {
    const from = order.indexOf(slot)
    if (from < 0) continue
    order.splice(from, 1)
    let to = from + offset
    if (to < 0) to = 0
    if (to > order.length) to = order.length
    order.splice(to, 0, slot)
  }
  return order
}

/* -------------------------------------------------------------------------- */
/* 事件                                                                        */
/* -------------------------------------------------------------------------- */

function eventKeysOf(timeline: EventTimeline): readonly EventKey[] {
  if (timeline.keys !== undefined) return timeline.keys
  return timeline.events ?? []
}

function fireEvents(
  events: readonly EventKey[],
  from: number,
  to: number,
  includeFrom: boolean,
  loopTag: number,
  track: number,
  out: SampledEvent[],
  seen: Set<string>,
): void {
  if (to < from) return
  for (const e of events) {
    if (e.time < from || e.time > to) continue
    if (!includeFrom && e.time === from) continue
    // 去重键含循环序号与事件时间：同一圈同一事件至多一次，跨圈各自触发。
    const id = `${track}:${loopTag}:${e.time}:${e.name}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      name: e.name,
      time: e.time,
      track,
      ...(e.int === undefined ? {} : { int: e.int }),
      ...(e.float === undefined ? {} : { float: e.float }),
      ...(e.string === undefined ? {} : { string: e.string }),
    })
  }
}

/* -------------------------------------------------------------------------- */
/* 混合                                                                        */
/* -------------------------------------------------------------------------- */

type Acc = {
  rot?: number; x?: number; y?: number
  sx?: number; sy?: number; shx?: number; shy?: number
}

/** 替换：在偏移/乘数空间 lerp；叠加：偏移乘 alpha 后累加（scale 不允许叠加）。 */
function blend(cur: number | undefined, setup: number, sample: number, alpha: number, additive: boolean, multiplier: boolean): number {
  const base = cur ?? setup
  if (additive) return base + sample * alpha
  const target = multiplier ? setup * sample : setup + sample
  return base + (target - base) * alpha
}

/* -------------------------------------------------------------------------- */
/* 采样                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 采样一帧：先推进时间并采集事件，再把所有通道从 setup 基线混合进 Pose/SlotSet。
 * replace 通道每帧从 setup 重建（scrub 幂等），additive 通道在其上叠加。
 * 返回的 events 是本帧一次性结果；dominant 为最后写入的 replace clip 名。
 */
export function applySliderBoneAnimation(
  clip: AnimationClip, pose: Pose, time: number, mix: number, additive: boolean, loop: boolean,
): void {
  const at = loop && clip.duration > 0 ? ((time % clip.duration) + clip.duration) % clip.duration : time
  for (const timeline of clip.timelines) {
    if (timeline.kind !== 'rotate' && timeline.kind !== 'translate' && timeline.kind !== 'scale' && timeline.kind !== 'shear') continue
    const bone = boneOf(timeline, pose.skeleton)
    if (bone === undefined || timeline.keys.length === 0 || at < timeline.keys[0]!.time) continue
    const component = timeline.path === undefined ? '' : timeline.path.slice(timeline.path.lastIndexOf('.') + 1)
    const channels = timeline.kind === 'rotate' ? [CH_ROT] : timeline.kind === 'translate'
      ? component === 'x' ? [CH_X] : component === 'y' ? [CH_Y] : [CH_X, CH_Y]
      : timeline.kind === 'scale' ? component === 'sx' ? [CH_SX] : component === 'sy' ? [CH_SY] : [CH_SX, CH_SY]
        : component === 'shx' ? [CH_SHX] : component === 'shy' ? [CH_SHY] : [CH_SHX, CH_SHY]
    const value = sampleScalar(timeline.keys, at)
    for (const channel of channels) {
      const setup = pose.skeleton.setupLocal[bone * POSE_STRIDE + channel]!
      const current = pose.local[bone * POSE_STRIDE + channel]!
      const target = timeline.kind === 'scale' ? setup * value : setup + value
      const next = additive ? current + (timeline.kind === 'scale' ? setup * (value - 1) : value) * mix
        : current + (target - current) * mix
      setLocal(pose, bone, channel, next)
    }
  }
}

/** Apply instant slider timelines to the current applied slot state at constraint time. */
export function applySliderSlotAnimation(
  clip: AnimationClip, slotSet: SlotSet, time: number, loop: boolean,
): void {
  // Slider.update passes null for events; Animation.apply reduces mapped time modulo duration.
  const at = loop && clip.duration > 0 ? time % clip.duration : time
  const positions = new Map<number, number>()
  for (const timeline of clip.timelines) {
    if (timeline.kind === 'attachment') {
      const keys = timeline.keys
      if (keys === undefined || keys.length === 0 || at < keys[0]!.time) continue
      const index = slotOf(timeline)
      if (index < 0 || index >= slotSet.slots.length) continue
      const key = keys[lastKeyIndex(keys, at)]!
      if (isAttachmentKey(key)) setSlotAttachment(slotSet, index, key.name)
    } else if (timeline.kind === 'drawOrder') {
      const keys = timeline.keys
      if (keys === undefined || keys.length === 0 || at < keys[0]!.time) continue
      if (isDrawOrderKey(keys[0]!)) {
        const key = keys[lastKeyIndex(keys, at)] as DrawOrderKey
        setDrawOrder(slotSet, applyDrawOffsets(setupDrawOrder(slotSet), key.offsets))
      } else {
        const position = /^drawOrder\[(\d+)\]$/.exec(timeline.path ?? '')
        if (position !== null) positions.set(Number(position[1]), sampleStepped(keys as readonly ScalarKey[], at))
      }
    }
  }
  if (positions.size > 0) {
    const order = setupDrawOrder(slotSet).map((slot, position) => positions.get(position) ?? slot)
    setDrawOrder(slotSet, order)
  }
}

export function sampleAnimation(
  tracks: readonly Track[],
  pose: Pose,
  slotSet: SlotSet,
  dt: number,
): SampleResult {
  const eventData: SampledEvent[] = []
  const seen = new Set<string>()
  const accs = new Map<BoneId, Acc>()
  let dominant: string | null = null
  const pendingAttachment = new Map<number, string | null>()
  for (const track of tracks) {
    if (track.mixingOutMix === undefined) continue
    for (const timeline of track.clip.timelines) {
      if (timeline.kind !== 'attachment') continue
      const index = slotOf(timeline)
      pendingAttachment.set(index, slotSet.slots[index]?.data.attachment ?? null)
    }
  }
  const pendingColor = new Map<number, PendingColor>()
  const darkSlots = new Set<number>()
  const pendingLegacyColor = new Map<number, number>()
  const pendingDeform = new Map<number, number>()
  const deformOffsets = new Map<string, Float32Array>()
  const pendingIk = new Map<number, number>()
  const pendingSequence = new Map<number, number>()
  const constraintMix = new Map<number, number>()
  const constraintMixByName = new Map<string, number>() as ConstraintMixMap
  constraintMixByName.channels = new Map<string, ConstraintChannels[]>()
  const constraintIds = new Map<string, number>()
  const constraintNames: string[] = []
  let drawOrderSpec: { kind: 'shift'; shift: number } | { kind: 'order'; order: number[] } | null = null
  const drawOrderPositions = new Map<number, number>()
  const skeleton = pose.skeleton

  const addConstraint = (name: string, mix: number): void => {
    const value = clamp01(mix)
    constraintMixByName.set(name, value)
    let id: number
    if (/^-?\d+$/.test(name)) {
      id = Number(name)
    } else {
      let assigned = constraintIds.get(name)
      if (assigned === undefined) {
        assigned = -(constraintIds.size + 1)
        constraintIds.set(name, assigned)
        constraintNames[-assigned - 1] = name
      }
      id = assigned
    }
    constraintMix.set(id, value)
  }

  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
    const track = tracks[trackIndex]!
    // 起步延迟：只消耗时间，不推进动画，也不派发事件。
    if (track.delay > 0) {
      track.delay = Math.max(0, track.delay - dt)
      continue
    }
    // crossfade：按 mixTime 线性提升 alpha；未设置 mixDuration 时完全不动 alpha。
    if (track.mixingOutMix === undefined && track.mixDuration > 0 && track.mixTime < track.mixDuration && dt > 0) {
      track.mixTime = Math.min(track.mixDuration, track.mixTime + dt)
      track.alpha = track.targetAlpha * (track.mixTime / track.mixDuration)
    }
    if (track.alpha <= 0) continue
    const clip = track.clip
    const duration = clip.duration
    const prev = track.lastTime
    const prevLoops = track.loopCount
    const isFirst = prev === 0 && prevLoops === 0 && track.time === 0 && dt > 0
    let curr = track.time

    if (dt > 0 && track.speed > 0 && (duration > 0 || clip === EMPTY_CLIP)) {
      curr += dt * track.speed
      if (track.loop && duration > 0) {
        if (curr >= duration) {
          const wraps = Math.floor(curr / duration)
          track.loopCount += wraps
          curr -= wraps * duration
        }
      } else if (duration > 0 && curr > duration) {
        curr = duration
      }
    }
    track.time = curr

    const loops = track.loopCount - prevLoops
    if (dt !== 0 && (track.mixingOutMix === undefined
      ? track.alpha > 0 : track.mixingOutMix < track.eventThreshold)) {
      const evs: EventKey[] = []
      for (const tl of clip.timelines) {
        if (tl.kind === 'event') evs.push(...eventKeysOf(tl))
      }
      if (evs.length > 0) {
        if (track.reverse) {
          const from = duration - prev
          const to = duration - curr
          // Spine's reverse interval includes the destination, excludes the origin,
          // and visits the low segment before the high segment on a loop wrap.
          if (from >= to) {
            for (const event of evs) {
              if (event.time >= to && event.time < from)
                fireEvents([event], event.time, event.time, true, 0, trackIndex, eventData, seen)
            }
          } else {
            for (const event of evs) {
              if (event.time < from)
                fireEvents([event], event.time, event.time, true, 0, trackIndex, eventData, seen)
            }
            for (const event of evs) {
              if (event.time >= to)
                fireEvents([event], event.time, event.time, true, 1, trackIndex, eventData, seen)
            }
          }
        } else if (isFirst) {
          for (let k = 0; k < loops; k += 1) fireEvents(evs, 0, duration, true, k, trackIndex, eventData, seen)
          fireEvents(evs, 0, curr, true, loops, trackIndex, eventData, seen)
        } else if (loops > 0) {
          fireEvents(evs, prev, duration, false, 0, trackIndex, eventData, seen)
          for (let k = 1; k < loops; k += 1) fireEvents(evs, 0, duration, true, k, trackIndex, eventData, seen)
          fireEvents(evs, 0, curr, true, loops, trackIndex, eventData, seen)
        } else {
          fireEvents(evs, prev, curr, false, 0, trackIndex, eventData, seen)
        }
      }
    }
    track.lastTime = curr
    const applyTime = track.reverse ? duration - curr : curr

    const additive = track.blendMode === 'additive'
    let wrote = false
    for (const [timelineIndex, tl] of clip.timelines.entries()) {
      if (tl.kind === 'event') continue
      const alpha = track.timelineAlphas?.[timelineIndex] ?? track.alpha
      if (alpha <= 0 && tl.kind !== 'attachment' && tl.kind !== 'drawOrder') continue

      if (tl.kind === 'rotate') {
        const id = boneOf(tl, skeleton)
        if (id === undefined || tl.keys.length === 0) continue
        const acc = accs.get(id) ?? {}
        const setup = skeleton.setupLocal[id * POSE_STRIDE + CH_ROT]!
        if (applyTime < tl.keys[0]!.time) {
          // An unowned channel starts at setup; an earlier track remains the underlying mix.
          if (acc.rot === undefined) acc.rot = setup
          accs.set(id, acc)
          continue
        }
        acc.rot = blend(acc.rot, setup, tl.rawRotation ? sampleScalar(tl.keys, applyTime) : sampleAngle(tl.keys, applyTime), alpha, additive, false)
        accs.set(id, acc)
        wrote = true
        continue
      }

      if (tl.kind === 'translate' || tl.kind === 'scale' || tl.kind === 'shear') {
        const id = boneOf(tl, skeleton)
        if (id === undefined || tl.keys.length === 0) continue
        if (tl.kind === 'scale' && additive) continue // 乘数不可叠加
        const component = tl.axis !== undefined
          ? axisComponent(tl.kind, tl.axis)
          : targetOf(tl.path ?? '').component
        const acc = accs.get(id) ?? {}
        const base = id * POSE_STRIDE
        if (applyTime < tl.keys[0]!.time) {
          for (const c of componentsOf(tl.kind, component)) {
            if (acc[c] === undefined) acc[c] = skeleton.setupLocal[base + CHANNEL_OF[c]!]!
          }
          accs.set(id, acc)
          continue
        }
        const value = sampleScalar(tl.keys, applyTime)
        for (const c of componentsOf(tl.kind, component)) {
          const channel = CHANNEL_OF[c]!
          const setup = skeleton.setupLocal[base + channel]!
          acc[c] = blend(acc[c], setup, value, alpha, additive, tl.kind === 'scale')
        }
        accs.set(id, acc)
        wrote = true
        continue
      }

      if (tl.kind === 'sequence') {
        const index = slotOf(tl)
        pendingSequence.set(index, Math.round(sampleStepped(tl.keys, applyTime)))
        wrote = true
        continue
      }

      if ((tl.kind === 'ik' || tl.kind === 'transform' || tl.kind === 'path' || tl.kind === 'physics' || tl.kind === 'slider') && 'frames' in tl) {
        if (tl.frames.length === 0) continue
        if (tl.kind === 'physics' && tl.channel === 'reset') {
          const crossed = tl.frames.some(frame => (loops > 0 || frame.time > prev ||
            (isFirst && frame.time === 0)) && frame.time <= curr)
          if (crossed && dt > 0) {
            const name = tl.constraint ?? tl.path ?? '-1'
            const existing = constraintMixByName.channels.get(name) ?? []
            existing.push({ kind: 'physics', values: { reset: true }, alpha: alpha, additive: false })
            constraintMixByName.channels.set(name, existing)
          }
          continue
        }
        if (curr < tl.frames[0]!.time && !(tl.kind === 'physics' && (tl.path === '-1' || tl.path === ''))) continue
        const name = tl.constraint ?? tl.path
        if (name === undefined) continue
        const fields = tl.kind === 'ik' ? ['mix', 'softness']
          : tl.kind === 'transform' ? ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY']
            : tl.kind === 'physics' || tl.kind === 'slider' ? [tl.channel ?? 'mix']
              : tl.channel === 'mix' ? ['mixRotate', 'mixX', 'mixY'] : [tl.channel ?? 'position']
        const values: Record<string, number | boolean> = {}
        for (const [component, field] of fields.entries()) {
          values[field] = tl.kind === 'physics' && curr < tl.frames[0]!.time ? 0 : sampleScalar(tl.frames.map(frame => ({
            time: frame.time, value: frame.values[component]!,
            ...(frame.curves?.[component] === undefined ? {} : { curve: frame.curves[component] }),
          })), curr)
        }
        if (tl.kind === 'ik') {
          const frame = tl.frames[lastKeyIndex(tl.frames, curr)]!
          values.bendDirection = frame.bendDirection ?? 1
          values.compress = frame.compress ?? false
          values.stretch = frame.stretch ?? false
        }
        const channel = { kind: tl.kind, values, alpha: alpha, additive }
        const existing = constraintMixByName.channels.get(name) ?? []
        existing.push(channel)
        constraintMixByName.channels.set(name, existing)
        wrote = true
        continue
      }

      if (tl.kind === 'ik' || tl.kind === 'transform' || tl.kind === 'path' || tl.kind === 'physics' || tl.kind === 'slider') {
        if (!('keys' in tl)) continue
        const mix = sampleScalar(tl.keys, applyTime)
        addConstraint(tl.constraint ?? tl.path ?? String(slotOf(tl)), mix)
        if (tl.kind === 'ik') pendingIk.set(slotOf(tl), clamp01(mix))
        wrote = true
        continue
      }

      if (tl.kind === 'attachment') {
        if (additive) continue
        const keys = tl.keys
        if (keys === undefined || keys.length === 0) continue
        const index = slotOf(tl)
        if (track.mixingOutMix !== undefined &&
          (track.mixingOutMix >= (track.mixAttachmentThreshold ?? 0) ||
            alpha < (track.alphaAttachmentThreshold ?? 0))) {
          if (!pendingAttachment.has(index)) pendingAttachment.set(index, slotSet.slots[index]?.data.attachment ?? null)
          continue
        }
        if (track.mixingOutMix === undefined && alpha < (track.alphaAttachmentThreshold ?? 0)) continue
        const first = keys[0]
        if (first !== undefined && isAttachmentKey(first)) {
          const key = keys[lastKeyIndex(keys, applyTime)]!
          pendingAttachment.set(index, isAttachmentKey(key) ? key.name : String('value' in key ? key.value : ''))
        } else {
          pendingAttachment.set(index, String(sampleScalar(keys as readonly ScalarKey[], curr)))
        }
        wrote = true
        continue
      }

      if (tl.kind === 'color') {
        if (additive) continue
        const keys = tl.keys
        if (keys === undefined || keys.length === 0) continue
        const index = slotOf(tl)
        const sampled = sampleColorKeys(keys, applyTime, tl.channel)
        if (sampled.legacy !== null) {
          pendingLegacyColor.set(index, sampled.legacy)
        }
        const base = pendingColor.get(index) ?? {
          light: slotSet.slots[index]?.data.color ?? { r: 1, g: 1, b: 1, a: 1 },
          dark: slotSet.slots[index]?.data.dark ?? ZERO_DARK,
        }
        pendingColor.set(index, applyColorChannels(base, sampled, tl.channel, alpha))
        if (tl.channel === 'rgb2' || tl.channel === 'rgba2' || tl.channel === 'alpha2') darkSlots.add(index)
        wrote = true
        continue
      }

      if (tl.kind === 'deform') {
        const keys = tl.keys
        if (keys === undefined || keys.length === 0) continue
        const index = slotOf(tl)
        const first = keys[0]
        if (first !== undefined && isDeformKey(first)) {
          const key = sampleDeformKeys(keys as readonly DeformKey[], applyTime, tl)
          accumulateDeform(deformOffsets, key, alpha, deformMeshKey(tl, index))
        } else {
          pendingDeform.set(index, sampleScalar(keys as readonly ScalarKey[], curr))
        }
        wrote = true
        continue
      }

      if (tl.kind === 'drawOrder') {
        if (additive || (track.mixingOutMix !== undefined &&
          track.mixingOutMix >= (track.mixDrawOrderThreshold ?? 0))) continue
        const keys = tl.keys
        if (keys === undefined || keys.length === 0) continue
        const first = keys[0]
        if (first !== undefined && isDrawOrderKey(first)) {
          const key = keys[lastKeyIndex(keys, applyTime)] as DrawOrderKey
          drawOrderSpec = { kind: 'order', order: applyDrawOffsets(setupDrawOrder(slotSet), key.offsets) }
        } else {
          const position = /^drawOrder\[(\d+)\]$/.exec(tl.path ?? '')
          if (position !== null) {
            drawOrderPositions.set(Number(position[1]), sampleStepped(keys as readonly ScalarKey[], applyTime))
          } else {
            const shift = sampleScalar(keys as readonly ScalarKey[], curr)
            drawOrderSpec = { kind: 'shift', shift }
          }
        }
        wrote = true
        continue
      }
    }
    if (!additive && wrote) dominant = clip.name
  }

  // 逐骨写回：旋转保持连续值（M0 约定），矩阵对 ±2π 不敏感。
  for (const [id, acc] of accs) {
    if (acc.rot !== undefined) setLocal(pose, id, CH_ROT, acc.rot)
    if (acc.x !== undefined) setLocal(pose, id, CH_X, acc.x)
    if (acc.y !== undefined) setLocal(pose, id, CH_Y, acc.y)
    if (acc.sx !== undefined) setLocal(pose, id, CH_SX, acc.sx)
    if (acc.sy !== undefined) setLocal(pose, id, CH_SY, acc.sy)
    if (acc.shx !== undefined) setLocal(pose, id, CH_SHX, acc.shx)
    if (acc.shy !== undefined) setLocal(pose, id, CH_SHY, acc.shy)
  }

  for (const [slot, attachment] of pendingAttachment) {
    if (slot >= 0 && slot < slotSet.slots.length) setSlotAttachment(slotSet, slot, attachment)
  }
  for (const [slot, packed] of pendingLegacyColor) {
    if (slot >= 0 && slot < slotSet.slots.length) setSlotColor(slotSet, slot, packed >>> 0)
  }
  for (const [slot, color] of pendingColor) {
    const state = slotSet.slots[slot]
    // 新颜色直接用浮点写回，避免 8-bit 打包损失（crossfade 的 0.5 必须精确）。
    if (state !== undefined) state.color = color.light
  }

  const baseOrder = setupDrawOrder(slotSet)
  if (drawOrderPositions.size > 0) {
    setDrawOrder(slotSet, baseOrder.map((slot, position) => drawOrderPositions.get(position) ?? slot))
  } else if (drawOrderSpec === null) {
    setDrawOrder(slotSet, baseOrder)
  } else if (drawOrderSpec.kind === 'order') {
    setDrawOrder(slotSet, drawOrderSpec.order)
  } else {
    const n = slotSet.slots.length
    if (n > 0) {
      const shift = ((drawOrderSpec.shift % n) + n) % n
      setDrawOrder(slotSet, baseOrder.map((i) => (i + shift) % n))
    }
  }

  const colorDark = new Map<number, RGBA>()
  for (const [slot, color] of pendingColor) {
    if (darkSlots.has(slot) || slotSet.slots[slot]?.data.dark !== undefined) colorDark.set(slot, color.dark)
  }

  return {
    events: eventData.map((event) => event.name),
    eventData,
    dominant,
    deform: pendingDeform,
    ik: pendingIk,
    deformOffsets,
    drawOrder: slotSet.drawOrder.slice(),
    constraintMix,
    constraintMixByName,
    constraintNames,
    sequence: pendingSequence,
    colorDark,
  }
}
