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
    | 'ik' | 'transform' | 'path' | 'physics'
    | 'sequence'
  readonly keys: readonly ScalarKey[]
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
  constraintMixByName: Map<string, number>
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
}

const EMPTY_CLIP: AnimationClip = { name: '__empty', duration: 0, timelines: [] }

/* -------------------------------------------------------------------------- */
/* AnimationState                                                              */
/* -------------------------------------------------------------------------- */

/**
 * 文档 12 §3 的门面：管理多 track、时间缩放、暂停/恢复与帧末事件派发。
 * 采样与混合仍复用 sampleAnimation，避免两套语义。
 */
export class AnimationState {
  private readonly clips: ReadonlyMap<string, AnimationClip>
  private readonly pose: Pose
  private readonly slotSet: SlotSet
  private readonly listeners = new Map<AnimationEventType, Set<AnimationListener>>()
  private readonly savedSpeed = new WeakMap<Track, number>()
  private readonly _tracks: Track[] = []
  private timeScale = 1
  private disposed = false

  constructor(clips: ReadonlyMap<string, AnimationClip>, pose: Pose, slotSet: SlotSet) {
    this.clips = clips
    this.pose = pose
    this.slotSet = slotSet
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
    const mixDuration = options.mixDuration ?? 0
    const track = createTrack(clip, {
      loop: options.loop ?? true,
      speed: options.speed ?? 1,
      alpha: mixDuration > 0 ? 0 : targetAlpha,
      delay: options.delay ?? 0,
      mixDuration,
      targetAlpha,
      ...(options.blendMode === undefined ? {} : { blendMode: options.blendMode }),
    })
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
    track.queue.push({
      clip,
      loop: options.loop ?? true,
      speed: options.speed ?? 1,
      alpha: options.alpha ?? 1,
      delay: options.delay ?? 0,
      mixDuration: options.mixDuration ?? 0,
      blendMode: options.blendMode ?? 'replace',
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
    const prevLast = this._tracks.map((track) => track.lastTime)
    const result = sampleAnimation(this._tracks, this.pose, this.slotSet, scaled)
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

    this._tracks.forEach((track, index) => {
      const duration = track.clip.duration
      if (track.loop || duration <= 0 || track.time < duration || (prevLast[index] ?? 0) >= duration) return
      const next = track.queue.shift()
      if (next === undefined) return
      applyQueueEntry(track, next)
      this.dispatch({ type: 'start', name: next.clip.name, time: 0, track: index })
    })
    return result
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this._tracks.length = 0
    this.listeners.clear()
  }
}

function applyQueueEntry(track: Track, entry: TrackQueueEntry): void {
  track.clip = entry.clip
  track.time = 0
  track.lastTime = 0
  track.loopCount = 0
  track.loop = entry.loop
  track.speed = entry.speed
  track.delay = entry.delay
  track.mixDuration = entry.mixDuration
  track.mixTime = 0
  track.targetAlpha = entry.alpha
  track.alpha = entry.mixDuration > 0 ? 0 : entry.alpha
  track.blendMode = entry.blendMode
}

/** 建立 track；默认循环播放、完全替换、1 倍速。 */
export function createTrack(
  clip: AnimationClip,
  options?: Partial<Pick<
    Track,
    'alpha' | 'speed' | 'loop' | 'blendMode' | 'time' | 'delay' | 'mixDuration' | 'targetAlpha'
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

/** 三次贝塞尔单轴：P0=(0,0), P3=(1,1)，控制点 y 可越界（过冲）。 */
function bezierAxis(u: number, c1: number, c2: number): number {
  const m = 1 - u
  return 3 * m * m * u * c1 + 3 * m * u * u * c2 + u * u * u
}

function bezierDerivative(u: number, c1: number, c2: number): number {
  const m = 1 - u
  return 3 * m * m * c1 + 6 * m * u * (c2 - c1) + 3 * u * u * (1 - c2)
}

/** 反解 x(u)=t：固定 8 次 Newton + 32 次二分兜底，保证确定性。 */
function solveBezierU(t: number, c1x: number, c2x: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  let u = t
  for (let i = 0; i < 8; i += 1) {
    const err = bezierAxis(u, c1x, c2x) - t
    if (Math.abs(err) < 1e-6) return u
    const d = bezierDerivative(u, c1x, c2x)
    if (Math.abs(d) < 1e-8) break
    u = clamp01(u - err / d)
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 32; i += 1) {
    u = (lo + hi) / 2
    const x = bezierAxis(u, c1x, c2x)
    if (Math.abs(x - t) < 1e-6) return u
    if (x < t) lo = u
    else hi = u
  }
  return (lo + hi) / 2
}

/** 单段 x 单调且落在 [0,1] 才视为合法。 */
function validSegment(segment: readonly number[]): boolean {
  if (segment.length !== 4) return false
  for (let i = 0; i < 4; i += 1) {
    if (!Number.isFinite(segment[i])) return false
  }
  const c1x = segment[0]!
  const c2x = segment[2]!
  return c1x >= 0 && c1x <= 1 && c2x >= 0 && c2x <= 1 && c1x <= c2x
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
function bezierFraction(t: number, segments: readonly number[]): number {
  const count = segments.length / 4
  const scaled = clamp01(t) * count
  const index = Math.min(count - 1, Math.floor(scaled))
  const local = scaled - index
  const base = index * 4
  const localY = bezierAxis(
    solveBezierU(local, segments[base]!, segments[base + 2]!),
    segments[base + 1]!,
    segments[base + 3]!,
  )
  return count === 1 ? localY : (index + localY) / count
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
  const f = curveFraction(k0.curve, span <= 0 ? 1 : (time - k0.time) / span, undefined)
  const d0 = k0.dark ?? ZERO_DARK
  const d1 = k1.dark ?? ZERO_DARK
  return {
    light: mixRGBA(k0.light, k1.light, f),
    dark: mixRGBA(d0, d1, f),
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
  if (mode === 'rgb' || mode === 'rgba') {
    light = mixRGBA(light, { ...light, r: sampled.light.r, g: sampled.light.g, b: sampled.light.b }, alpha)
  }
  if (mode === 'alpha' || mode === 'rgba') {
    light = mixRGBA(light, { ...light, a: sampled.light.a }, alpha)
  }
  if (mode === 'rgb2' || mode === 'rgba2') {
    dark = mixRGBA(dark, { ...dark, r: sampled.dark.r, g: sampled.dark.g, b: sampled.dark.b }, alpha)
  }
  if (mode === 'alpha2' || mode === 'rgba2') {
    dark = mixRGBA(dark, { ...dark, a: sampled.dark.a }, alpha)
  }
  return { light, dark }
}

/* -------------------------------------------------------------------------- */
/* deform / drawOrder                                                          */
/* -------------------------------------------------------------------------- */

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
    const id = `${loopTag}:${e.time}:${e.name}`
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
  const pendingColor = new Map<number, PendingColor>()
  const pendingLegacyColor = new Map<number, number>()
  const pendingDeform = new Map<number, number>()
  const deformOffsets = new Map<string, Float32Array>()
  const pendingIk = new Map<number, number>()
  const pendingSequence = new Map<number, number>()
  const constraintMix = new Map<number, number>()
  const constraintMixByName = new Map<string, number>()
  const constraintIds = new Map<string, number>()
  const constraintNames: string[] = []
  let drawOrderSpec: { kind: 'shift'; shift: number } | { kind: 'order'; order: number[] } | null = null
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
    if (track.mixDuration > 0 && track.mixTime < track.mixDuration && dt > 0) {
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

    if (dt > 0 && track.speed > 0 && duration > 0) {
      curr += dt * track.speed
      if (track.loop) {
        if (curr >= duration) {
          const wraps = Math.floor(curr / duration)
          track.loopCount += wraps
          curr -= wraps * duration
        }
      } else if (curr > duration) {
        curr = duration
      }
    }
    track.time = curr

    const loops = track.loopCount - prevLoops
    if (dt !== 0 && track.alpha >= 0.5) {
      const evs: EventKey[] = []
      for (const tl of clip.timelines) {
        if (tl.kind === 'event') evs.push(...eventKeysOf(tl))
      }
      if (evs.length > 0) {
        if (isFirst) {
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

    const additive = track.blendMode === 'additive'
    let wrote = false
    for (const tl of clip.timelines) {
      if (tl.kind === 'event') continue

      if (tl.kind === 'rotate') {
        const id = boneOf(tl, skeleton)
        if (id === undefined) continue
        const acc = accs.get(id) ?? {}
        const setup = skeleton.setupLocal[id * POSE_STRIDE + CH_ROT]!
        acc.rot = blend(acc.rot, setup, sampleAngle(tl.keys, curr), track.alpha, additive, false)
        accs.set(id, acc)
        wrote = true
        continue
      }

      if (tl.kind === 'translate' || tl.kind === 'scale' || tl.kind === 'shear') {
        const id = boneOf(tl, skeleton)
        if (id === undefined) continue
        if (tl.kind === 'scale' && additive) continue // 乘数不可叠加
        const value = sampleScalar(tl.keys, curr)
        const component = tl.axis !== undefined
          ? axisComponent(tl.kind, tl.axis)
          : targetOf(tl.path ?? '').component
        const acc = accs.get(id) ?? {}
        const base = id * POSE_STRIDE
        for (const c of componentsOf(tl.kind, component)) {
          const channel = CHANNEL_OF[c]!
          const setup = skeleton.setupLocal[base + channel]!
          acc[c] = blend(acc[c], setup, value, track.alpha, additive, tl.kind === 'scale')
        }
        accs.set(id, acc)
        wrote = true
        continue
      }

      if (tl.kind === 'sequence') {
        const index = slotOf(tl)
        pendingSequence.set(index, Math.round(sampleStepped(tl.keys, curr)))
        wrote = true
        continue
      }

      if (tl.kind === 'ik' || tl.kind === 'transform' || tl.kind === 'path' || tl.kind === 'physics') {
        const mix = sampleScalar(tl.keys, curr)
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
        const first = keys[0]
        if (first !== undefined && isAttachmentKey(first)) {
          const key = keys[lastKeyIndex(keys, curr)]!
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
        const sampled = sampleColorKeys(keys, curr)
        if (sampled.legacy !== null) {
          pendingLegacyColor.set(index, sampled.legacy)
        }
        const base = pendingColor.get(index) ?? {
          light: slotSet.slots[index]?.data.color ?? { r: 1, g: 1, b: 1, a: 1 },
          dark: ZERO_DARK,
        }
        pendingColor.set(index, applyColorChannels(base, sampled, tl.channel, track.alpha))
        wrote = true
        continue
      }

      if (tl.kind === 'deform') {
        const keys = tl.keys
        if (keys === undefined || keys.length === 0) continue
        const index = slotOf(tl)
        const first = keys[0]
        if (first !== undefined && isDeformKey(first)) {
          const key = keys[lastKeyIndex(keys, curr)] as DeformKey
          accumulateDeform(deformOffsets, key, track.alpha, deformMeshKey(tl, index))
        } else {
          pendingDeform.set(index, sampleScalar(keys as readonly ScalarKey[], curr))
        }
        wrote = true
        continue
      }

      if (tl.kind === 'drawOrder') {
        if (additive) continue
        const keys = tl.keys
        if (keys === undefined || keys.length === 0) continue
        const first = keys[0]
        if (first !== undefined && isDrawOrderKey(first)) {
          const key = keys[lastKeyIndex(keys, curr)] as DrawOrderKey
          drawOrderSpec = { kind: 'order', order: applyDrawOffsets(setupDrawOrder(slotSet), key.offsets) }
        } else {
          const shift = sampleScalar(keys as readonly ScalarKey[], curr)
          drawOrderSpec = { kind: 'shift', shift }
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
  if (drawOrderSpec === null) {
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
  for (const [slot, color] of pendingColor) colorDark.set(slot, color.dark)

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
