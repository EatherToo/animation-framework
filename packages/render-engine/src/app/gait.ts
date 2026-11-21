/**
 * M12 步态表与速度分档。
 * 权威：docs/18-应用层/步态与调度.md。
 *
 * 走/跑按 Froude 数 Fr = v²/(gL) 分档：Fr < 0.5 站立，< 2.5 行走，否则奔跑。
 */
export type GaitMode = 'idle' | 'walk' | 'run'

/** 0=站立、1=行走、2=奔跑（对外保持既有数值契约）。 */
export type GaitIndex = 0 | 1 | 2

export type Gait = {
  mode: GaitMode
  /** 一个完整周期（秒）。 */
  cycle: number
  /** 支撑相占周期比例 0..1。 */
  duty: number
  /** 摆动幅度（0..1）。 */
  amplitude: number
  /** 参考步长（米），用于调度锁存。 */
  stepLength: number
}

export const gaitTable: Readonly<Record<GaitMode, Gait>> = {
  idle: { mode: 'idle', cycle: 1.0, duty: 1.0, amplitude: 0.0, stepLength: 0.0 },
  walk: { mode: 'walk', cycle: 0.8, duty: 0.6, amplitude: 0.5, stepLength: 0.7 },
  run: { mode: 'run', cycle: 0.55, duty: 0.35, amplitude: 1.0, stepLength: 1.1 },
}

const GRAVITY = 9.81

/** 由速度与身高估计步态档位；后退取绝对值。 */
export function speedToGait(speed: number, height: number): GaitIndex {
  if (!Number.isFinite(height) || height <= 0) throw new Error('app.height')
  const v = Math.abs(speed)
  const fr = (v * v) / (GRAVITY * height)
  if (fr < 0.5) return 0
  if (fr < 2.5) return 1
  return 2
}

export function gaitModeOf(index: GaitIndex): GaitMode {
  return index === 0 ? 'idle' : index === 1 ? 'walk' : 'run'
}

export function gaitOf(index: GaitIndex): Gait {
  return gaitTable[gaitModeOf(index)]
}
