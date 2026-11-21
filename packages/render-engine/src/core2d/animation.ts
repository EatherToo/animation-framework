/**
 * core2d 动画：曲线采样、角度展开、时间轴、播放 track 与混合。
 * 权威：docs/06-动画与曲线.md 与 docs/06-动画/{curve,timeline,events}.md。
 * 2D 只有标量角与标量通道；不引入四元数/slerp。时间单位为秒。
 */
import {
  CH_ROT, CH_X, CH_Y, CH_SX, CH_SY, CH_SHX, CH_SHY, POSE_STRIDE,
  setLocal,
  type Pose,
} from './pose'
import { normalizeAngle } from './math'
import type { BoneId } from './skeleton'
import { setDrawOrder, setSlotAttachment, setSlotColor, type SlotSet } from './slot'

const TAU = Math.PI * 2
const IDENTITY_BEZIER: Bezier = [1 / 3, 1 / 3, 2 / 3, 2 / 3]

/** 段曲线：描述从本键到下一键的插值方式。 */
export type Curve = 'linear' | 'stepped' | 'bezier' | 'easeSine'
/** 三次贝塞尔控制点 [c1x, c1y, c2x, c2y]。 */
export type Bezier = readonly [number, number, number, number]
/** 标量关键帧；bezier 仅当 curve='bezier' 时生效。 */
export type ScalarKey = {
  readonly time: number
  readonly value: number
  readonly curve?: Curve
  readonly bezier?: Bezier
}

export type EventKey = { readonly time: number; readonly name: string }
export type EventTimeline = {
  readonly kind: 'event'
  readonly path: string
  readonly events: readonly EventKey[]
}

/** 时间轴：标量通道统一用 keys.value；离散/数组类通道的 value 为编码数字。 */
export type Timeline = {
  readonly kind: 'rotate' | 'translate' | 'scale' | 'shear' | 'attachment'
    | 'color' | 'drawOrder' | 'deform' | 'ik'
  readonly path: string
  readonly keys: readonly ScalarKey[]
} | EventTimeline

export type AnimationClip = {
  readonly name: string
  readonly duration: number
  readonly timelines: readonly Timeline[]
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
}

export type SampleResult = { events: string[]; dominant: string | null }
export type 动画采样结果 = SampleResult

/** 建立 track；默认循环播放、完全替换、1 倍速。 */
export function createTrack(
  clip: AnimationClip,
  options?: Partial<Pick<Track, 'alpha' | 'speed' | 'loop' | 'blendMode' | 'time'>>,
): Track {
  return {
    clip,
    time: options?.time ?? 0,
    alpha: options?.alpha ?? 1,
    speed: options?.speed ?? 1,
    loop: options?.loop ?? true,
    blendMode: options?.blendMode ?? 'replace',
    lastTime: options?.time ?? 0,
    loopCount: 0,
  }
}

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

/** 反解 x(u)=t：Newton 快速收敛，二分兜底保证收敛；精度优于 1e-6。 */
function solveBezierU(t: number, c1x: number, c2x: number): number {
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

function bezierFraction(t: number, bezier: Bezier | undefined): number {
  const b = bezier ?? IDENTITY_BEZIER
  const c1x = b[0]
  const c1y = b[1]
  const c2x = b[2]
  const c2y = b[3]
  if (![c1x, c1y, c2x, c2y].every(Number.isFinite)) return t
  // x 越界/逆序时 clamp + 排序，保持 x 单调，避免反解失败。
  let ax = clamp01(c1x)
  let bx = clamp01(c2x)
  if (ax > bx) {
    const tmp = ax
    ax = bx
    bx = tmp
  }
  return bezierAxis(solveBezierU(t, ax, bx), c1y, c2y)
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
    case 'stepped': return t >= 1 ? 1 : 0
    case 'bezier': return bezierFraction(t, bezier)
    case 'easeSine': return easeSineFraction(t)
    case 'linear': return t
    default: return t
  }
}

/** 在标量关键帧序列上采样；空序列返回 0；时间夹在首尾；末键后保持末值。 */
export function sampleScalar(keys: readonly ScalarKey[], time: number): number {
  if (keys.length === 0) return 0
  const first = keys[0]!
  if (keys.length === 1 || time <= first.time) return first.value
  const last = keys[keys.length - 1]!
  if (time >= last.time) return last.value

  // 最后一个 keys[i].time <= time 的区间。
  let lo = 0
  let hi = keys.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (keys[mid]!.time <= time) lo = mid
    else hi = mid
  }
  const k0 = keys[lo]!
  const k1 = keys[lo + 1]!
  const span = k1.time - k0.time
  const u = span <= 0 ? 1 : (time - k0.time) / span
  const f = curveFraction(k0.curve, u, k0.bezier)
  return k0.value + (k1.value - k0.value) * f
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

function componentsOf(kind: 'translate' | 'scale' | 'shear', component: Component): readonly Exclude<Component, 'all'>[] {
  if (component !== 'all') return [component]
  if (kind === 'translate') return ['x', 'y']
  if (kind === 'scale') return ['sx', 'sy']
  return ['shx', 'shy']
}

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

function fireEvents(
  events: readonly EventKey[],
  from: number,
  to: number,
  includeFrom: boolean,
  loopTag: number,
  out: string[],
  seen: Set<string>,
): void {
  if (to < from) return
  for (const e of events) {
    if (e.time < from || e.time > to) continue
    if (!includeFrom && e.time === from) continue
    // 去重键含循环序号：同一圈同一事件至多一次，跨圈同名事件各自触发。
    const id = `${loopTag}:${e.name}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(e.name)
  }
}

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
  const events: string[] = []
  const seen = new Set<string>()
  const accs = new Map<BoneId, Acc>()
  let dominant: string | null = null
  const pendingAttachment = new Map<number, number>()
  const pendingColor = new Map<number, number>()
  const pendingDrawOrder = new Map<number, number>()
  const skeleton = pose.skeleton
  for (const track of tracks) {
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
        if (tl.kind === 'event') evs.push(...tl.events)
      }
      if (evs.length > 0) {
        if (isFirst) {
          for (let k = 0; k < loops; k += 1) fireEvents(evs, 0, duration, true, k, events, seen)
          fireEvents(evs, 0, curr, true, loops, events, seen)
        } else if (loops > 0) {
          fireEvents(evs, prev, duration, false, 0, events, seen)
          for (let k = 1; k < loops; k += 1) fireEvents(evs, 0, duration, true, k, events, seen)
          fireEvents(evs, 0, curr, true, loops, events, seen)
        } else {
          fireEvents(evs, prev, curr, false, 0, events, seen)
        }
      }
    }
    track.lastTime = curr

    const additive = track.blendMode === 'additive'
    let wrote = false
    for (const tl of clip.timelines) {
      if (tl.kind === 'event') continue
      const value = sampleScalar(tl.keys, curr)

      if (tl.kind === 'rotate') {
        const { target } = targetOf(tl.path)
        const id = skeleton.boneIdByName.get(target)
        if (id === undefined) continue
        const acc = accs.get(id) ?? {}
        const setup = skeleton.setupLocal[id * POSE_STRIDE + CH_ROT]!
        acc.rot = blend(acc.rot, setup, value, track.alpha, additive, false)
        accs.set(id, acc)
        wrote = true
        continue
      }

      if (tl.kind === 'translate' || tl.kind === 'scale' || tl.kind === 'shear') {
        const { target, component } = targetOf(tl.path)
        const id = skeleton.boneIdByName.get(target)
        if (id === undefined) continue
        if (tl.kind === 'scale' && additive) continue // 乘数不可叠加
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

      if (additive) continue
      const slot = Number.parseInt(tl.path, 10)
      const index = Number.isFinite(slot) ? slot : 0
      if (tl.kind === 'attachment') {
        pendingAttachment.set(index, value)
        wrote = true
      } else if (tl.kind === 'color') {
        pendingColor.set(index, value)
        wrote = true
      } else if (tl.kind === 'drawOrder') {
        pendingDrawOrder.set(index, value)
        wrote = true
      }
      // deform/ik 仅采样，顶点偏移与约束输入由 05/07 的后续模块消费。
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

  for (const [slot, value] of pendingAttachment) setSlotAttachment(slotSet, slot, String(value))
  for (const [slot, value] of pendingColor) setSlotColor(slotSet, slot, value >>> 0)
  for (const [, value] of pendingDrawOrder) {
    const n = slotSet.slots.length
    const shift = ((value % n) + n) % n
    setDrawOrder(slotSet, slotSet.slots.map((_, i) => (i + shift) % n))
  }

  return { events, dominant }
}
