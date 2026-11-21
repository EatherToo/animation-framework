/**
 * M12 足部几何与接触。
 * 权威：docs/17-应用层/足部几何.md、docs/17-应用层/接触事件.md。
 *
 * 脚底是一条线段：u=0 脚跟、0.5 平足、1 脚尖。
 * 接触点在世界空间固定；踝由接触点与脚形反推。
 */
export type ContactKind = 'heel' | 'flat' | 'toe' | 'liftoff' | 'landing'

/** 已提交的接触标记：frame 是事件时间（秒）。 */
export type ContactMark = {
  x: number
  y: number
  frame: number
  kind: ContactKind
}

export type FootPoint = { x: number; y: number }

/** 脚形：footLength 是踝→趾，heelBack 是脚跟向后延伸量。 */
export type FootGeometry = {
  footLength: number
  ankleHeight: number
  heelBack: number
  soleLength: number
  soleRise: number
  heel: FootPoint
  flat: FootPoint
  toe: FootPoint
}

const DEFAULT_FOOT_LENGTH = 0.15
const DEFAULT_ANKLE_HEIGHT = 0.04

/** 脚跟占脚长的比例（与文案一致：0.3）。 */
const HEEL_BACK_RATIO = 0.3

function assertFinite(value: number, code: string): void {
  if (!Number.isFinite(value)) throw new Error(code)
}

/** 由脚长与踝高构造脚形；三段站点在同一构造内算完，保证逐位确定。 */
export function createFootGeometry(
  footLength: number = DEFAULT_FOOT_LENGTH,
  ankleHeight: number = DEFAULT_ANKLE_HEIGHT,
): FootGeometry {
  assertFinite(footLength, 'foot.footLength')
  assertFinite(ankleHeight, 'foot.ankleHeight')
  if (footLength <= 0) throw new Error('foot.footLength')
  if (ankleHeight < 0) throw new Error('foot.ankleHeight')

  const heelBack = HEEL_BACK_RATIO * footLength
  const soleLength = heelBack + footLength
  const soleRise = 2 * ankleHeight
  const point = (u: number): FootPoint => ({
    x: -heelBack + u * soleLength,
    y: -soleRise * 0.5 + u * soleRise,
  })
  return {
    footLength,
    ankleHeight,
    heelBack,
    soleLength,
    soleRise,
    heel: point(0),
    flat: point(0.5),
    toe: point(1),
  }
}

const DEFAULT_GEOMETRY = createFootGeometry()

/** 脚底站点；u 越界直接报错，不静默 clamp。 */
export function soleLocal(
  u: number,
  geometry: FootGeometry = DEFAULT_GEOMETRY,
): [number, number] {
  assertFinite(u, 'foot.u')
  if (u < 0 || u > 1) throw new Error('foot.u')
  return [
    -geometry.heelBack + u * geometry.soleLength,
    -geometry.soleRise * 0.5 + u * geometry.soleRise,
  ]
}

function soleMidX(geometry: FootGeometry): number {
  return -geometry.heelBack + 0.5 * geometry.soleLength
}

/** 接触点 → 踝：接触点位于脚底，踝在中足上方 soleY + 踝高处。 */
export function ankleFromContact(
  c: FootPoint,
  soleY: number,
  geometry: FootGeometry = DEFAULT_GEOMETRY,
): FootPoint {
  assertFinite(c.x, 'foot.contact.x')
  assertFinite(soleY, 'foot.soleY')
  return { x: c.x - soleMidX(geometry), y: soleY + geometry.ankleHeight }
}

/** 踝 → 接触点；与 ankleFromContact 在 soleY 一致时互逆（1e-9）。 */
export function contactFromAnkle(
  a: FootPoint,
  soleY: number,
  geometry: FootGeometry = DEFAULT_GEOMETRY,
): FootPoint {
  assertFinite(a.x, 'foot.ankle.x')
  assertFinite(soleY, 'foot.soleY')
  return { x: a.x + soleMidX(geometry), y: soleY }
}

export type FootContactEvent = {
  kind: ContactKind
  x: number
  y: number
  time: number
}

const EVENT_ORDER: readonly ContactKind[] = ['heel', 'flat', 'toe', 'liftoff', 'landing']
const EVENT_OFFSETS: readonly number[] = [0, 0.2, 0.4, 0.6, 0.8]

/**
 * 支撑期接触求解：首次 lock 后世界接触点冻结，后续 lock 被忽略；
 * 事件按 kind@time 去重，拉取后清空。
 */
export class FootContactSolver {
  readonly geometry: FootGeometry
  private support: FootPoint | null = null
  private buffer: FootContactEvent[] = []

  constructor(geometry: FootGeometry = DEFAULT_GEOMETRY) {
    this.geometry = geometry
  }

  get locked(): boolean {
    return this.support !== null
  }

  get contact(): Readonly<FootPoint> | null {
    return this.support
  }

  /** 锁定支撑接触点；已锁定时返回 false 且不覆盖。 */
  lock(point: FootPoint): boolean {
    assertFinite(point.x, 'foot.contact.x')
    assertFinite(point.y, 'foot.contact.y')
    if (this.support !== null) return false
    this.support = { x: point.x, y: point.y }
    return true
  }

  unlock(): void {
    this.support = null
  }

  /** 推入一个事件；同 kind 同 time 视为重复。 */
  emit(kind: ContactKind, x: number, y: number, time: number): boolean {
    assertFinite(x, 'foot.event.x')
    assertFinite(y, 'foot.event.y')
    assertFinite(time, 'foot.event.time')
    for (const e of this.buffer) {
      if (e.kind === kind && Math.abs(e.time - time) < 1e-9) return false
    }
    this.buffer.push({ kind, x, y, time })
    return true
  }

  /** 生成一个完整支撑周期；返回本次真正新增的事件（重复调用返回空）。 */
  sequence(x: number, y: number, startTime: number, duration: number): FootContactEvent[] {
    assertFinite(startTime, 'foot.sequence.start')
    assertFinite(duration, 'foot.sequence.duration')
    if (duration <= 0) throw new Error('foot.sequence.duration')
    const added: FootContactEvent[] = []
    for (let i = 0; i < EVENT_ORDER.length; i += 1) {
      const kind = EVENT_ORDER[i]!
      const time = startTime + EVENT_OFFSETS[i]! * duration
      if (this.emit(kind, x, y, time)) added.push({ kind, x, y, time })
    }
    return added
  }

  /** 拉取并清空事件缓冲。 */
  drain(): FootContactEvent[] {
    const out = this.buffer
    this.buffer = []
    return out
  }
}

/** 离地事件（toe off）。 */
export function toeOff(x: number, y: number, time: number): FootContactEvent {
  return { kind: 'liftoff', x, y, time }
}

/** 落地事件（heel strike）。 */
export function heelStrike(x: number, y: number, time: number): FootContactEvent {
  return { kind: 'landing', x, y, time }
}
