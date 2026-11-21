/**
 * M12 参数与姿态调制。
 * 权威：docs/19-应用层/参数.md、docs/19-应用层/姿态调制.md。
 *
 * 约定：
 * - 参数是意图（target），当前值（current）由一阶低通得到；
 * - 平滑系数 alpha = 1 - exp(-dt/tau)，与帧率无关；
 * - 调制只写 spine/chest/head 的旋转增量，缺骨时整体不写。
 */
import { addRotation, type Pose } from '../core/pose'
import type { CompiledSkeleton } from '../core/skeleton'

/** 运动参数：速度 m/s、转向 rad、步态档位、摆幅 0..1。 */
export type MotionParams = {
  speed: number
  turn: number
  gait: 0 | 1 | 2
  amplitude: number
}

/** 目标值与当前值的成对状态；存档/快照按值复制。 */
export type ParamState = {
  target: MotionParams
  current: MotionParams
}

export type ParamTaus = {
  speed: number
  turn: number
  amplitude: number
}

export const DEFAULT_PARAM_TAUS: Readonly<ParamTaus> = {
  speed: 0.12,
  turn: 0.16,
  amplitude: 0.20,
}

const DEFAULT_HEIGHT = 1.7

/** 一阶低通系数；dt<=0 时视为不推进。 */
export function smoothingAlpha(dt: number, tau: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0
  if (!Number.isFinite(tau) || tau <= 0) throw new Error('params.tau')
  return 1 - Math.exp(-dt / tau)
}

export function copyParams(p: MotionParams): MotionParams {
  return { speed: p.speed, turn: p.turn, gait: p.gait, amplitude: p.amplitude }
}

/** 逐通道平滑；gait 是离散档位，直接跟随目标。 */
export class ParamSmoother {
  private readonly taus: ParamTaus

  constructor(taus?: Partial<ParamTaus>) {
    this.taus = {
      speed: taus?.speed ?? DEFAULT_PARAM_TAUS.speed,
      turn: taus?.turn ?? DEFAULT_PARAM_TAUS.turn,
      amplitude: taus?.amplitude ?? DEFAULT_PARAM_TAUS.amplitude,
    }
    for (const key of ['speed', 'turn', 'amplitude'] as const) {
      if (!Number.isFinite(this.taus[key]) || this.taus[key] <= 0) throw new Error(`params.tau.${key}`)
    }
  }

  /** 推进一次并写回 state.current；非法 dt 不改变状态。 */
  step(state: ParamState, dt: number): MotionParams {
    if (!Number.isFinite(dt) || dt <= 0) return copyParams(state.current)
    const { current, target } = state
    const next: MotionParams = {
      speed: current.speed + (target.speed - current.speed) * smoothingAlpha(dt, this.taus.speed),
      turn: current.turn + (target.turn - current.turn) * smoothingAlpha(dt, this.taus.turn),
      gait: target.gait,
      amplitude: current.amplitude
        + (target.amplitude - current.amplitude) * smoothingAlpha(dt, this.taus.amplitude),
    }
    state.current = next
    return next
  }
}

function legLengthOf(skeleton: CompiledSkeleton): number {
  const thigh = skeleton.boneIdByName.get('thighL')
  const shin = skeleton.boneIdByName.get('shinL')
  if (thigh === undefined || shin === undefined) return 0.47 * DEFAULT_HEIGHT
  return skeleton.bones[thigh]!.length + skeleton.bones[shin]!.length
}

/**
 * 上身调制：只写 spine/chest/head 的旋转增量，不覆盖腿 IK。
 * 三个骨必须同时存在，否则整体不写（缺骨不半写）。
 */
export function modulatePose(
  pose: Pose,
  skeleton: CompiledSkeleton,
  params: MotionParams,
  amount: number,
): void {
  const names = ['spine', 'chest', 'head'] as const
  const ids: number[] = []
  for (const name of names) {
    const id = skeleton.boneIdByName.get(name)
    if (id === undefined || id < 0 || id >= skeleton.count) return
    ids.push(id)
  }
  if (!Number.isFinite(amount) || amount === 0) return

  const scale = amount * (legLengthOf(skeleton) / (0.47 * DEFAULT_HEIGHT))
  const turn = Number.isFinite(params.turn) ? params.turn : 0
  const amplitude = Number.isFinite(params.amplitude)
    ? Math.min(1, Math.max(0, params.amplitude))
    : 0
  const base = 0.01 * scale
  const lean = (0.6 * turn + 0.4 * amplitude) * scale
  const deltas = [base + 0.3 * lean, 0.5 * lean - 0.5 * base, -0.2 * lean]
  for (let i = 0; i < ids.length; i += 1) addRotation(pose, ids[i]!, deltas[i]!)
}
