/**
 * M12 运动规划与状态。
 * 权威：docs/18-应用层/运动规划、姿态求解、步态与调度。
 *
 * 事务式提交：先在 setup 基线的局部副本上算，全部校验通过才写回
 * pose.local / params / contacts / phase / supportFeet。失败不触碰原状态。
 */
import { CH_ROT, CH_Y, POSE_STRIDE } from '../core/math'
import { markAllDirty, type Pose } from '../core/pose'
import type { CompiledSkeleton } from '../core/skeleton'
import type { ContactMark } from './foot'
import { speedToGait } from './gait'
import { ParamSmoother, type MotionParams, type ParamState } from './params'
import { createStepSchedule } from './schedule'

export type MotionInput = {
  dt: number
  time: number
  speed: number
  turn: number
  groundY: number
}

/** 应用层运动状态；phase 是 0..1 的环绕相位，generation 用于传送换代。 */
export type MotionState = {
  params: MotionParams
  contacts: ContactMark[]
  pose: Pose | null
  phase: number
  generation: number
  supportFeet: ('L' | 'R')[]
}

export type PlanResult = { committed: boolean; reason?: string }

const DEFAULT_HEIGHT = 1.7
const STEP_PERIOD = 0.8
const STEP_DUTY = 0.6
const STEP_LENGTH = 0.7
const MAX_AMPLITUDE_SPEED = 3
const SWING_SCALE = 0.35
const FOOT_FLAT_ANGLE = 0.02
const PELVIS_LIFT = 0.03

const smoother = new ParamSmoother()

/** 骨架关联（createMotionState 入参在此消费），并给出腿长/身高估计。 */
const skeletonByState = new WeakMap<MotionState, CompiledSkeleton>()

function metricsOf(skeleton: CompiledSkeleton): { height: number; legLength: number } {
  const thigh = skeleton.boneIdByName.get('thighL')
  const shin = skeleton.boneIdByName.get('shinL')
  const legLength = thigh !== undefined && shin !== undefined
    ? skeleton.bones[thigh]!.length + skeleton.bones[shin]!.length
    : 0.47 * DEFAULT_HEIGHT
  return { height: legLength / 0.47, legLength }
}

export function createMotionState(skeleton: CompiledSkeleton): MotionState {
  const state: MotionState = {
    params: { speed: 0, turn: 0, gait: 0, amplitude: 0 },
    contacts: [],
    pose: null,
    phase: 0,
    generation: 0,
    supportFeet: [],
  }
  skeletonByState.set(state, skeleton)
  return state
}

/** 摆动端点速度为零的 smoothstep；输入夹到 0..1。 */
export function smoothstep(u: number): number {
  if (!Number.isFinite(u) || u <= 0) return 0
  if (u >= 1) return 1
  return u * u * (3 - 2 * u)
}

/** 抬脚钟形曲线；端点与导数端点均为 0。 */
export function bump(u: number): number {
  if (!Number.isFinite(u) || u <= 0 || u >= 1) return 0
  const v = u * (1 - u)
  return 16 * v * v
}

/** 相位推进：dt*rate 后环绕到 [0,1)，与帧率无关。 */
export function advancePhase(phase: number, dt: number, rate: number = 1): number {
  if (!Number.isFinite(phase) || !Number.isFinite(dt) || !Number.isFinite(rate)) {
    throw new Error('motion.phase')
  }
  const next = phase + dt * rate
  return next - Math.floor(next)
}

function footIds(
  skeleton: CompiledSkeleton,
  side: 'L' | 'R',
): { thigh: number | undefined; shin: number | undefined; foot: number | undefined } {
  return {
    thigh: skeleton.boneIdByName.get(`thigh${side}`),
    shin: skeleton.boneIdByName.get(`shin${side}`),
    foot: skeleton.boneIdByName.get(`foot${side}`),
  }
}

/**
 * 事务式规划：先复制 local 与 contacts，所有校验通过才写回；失败不改原状态。
 * local 从 setup 基线重算，使结果只依赖 (time, params)，与调用帧率无关。
 */
export function planMotion(state: MotionState, input: MotionInput): PlanResult {
  const fail = (reason: string): PlanResult => ({ committed: false, reason })
  if (!Number.isFinite(input.dt) || input.dt <= 0) return fail('dt')
  if (!Number.isFinite(input.time) || !Number.isFinite(input.speed)
    || !Number.isFinite(input.turn) || !Number.isFinite(input.groundY)) return fail('input')

  const pose = state.pose
  if (!pose) return fail('no-pose')
  const skeleton = skeletonByState.get(state) ?? pose.skeleton
  if (!Array.from(pose.local).every(Number.isFinite)) return fail('pose-local')

  const { height, legLength } = metricsOf(skeleton)
  const work = skeleton.setupLocal.slice()

  // 参数一阶平滑；gait 是离散量，直接取目标速度分档。
  const targetAmplitude = Math.min(1, Math.abs(input.speed) / MAX_AMPLITUDE_SPEED)
  const paramState: ParamState = {
    target: {
      speed: input.speed,
      turn: input.turn,
      gait: speedToGait(input.speed, height),
      amplitude: targetAmplitude,
    },
    current: { ...state.params },
  }
  const next = smoother.step(paramState, input.dt)

  // 腿部确定性摆动（只写腿骨旋转；幅度按腿长归一）。
  const swing = next.amplitude * SWING_SCALE * (legLength / (0.47 * DEFAULT_HEIGHT))
  const cyclePhase = (input.time / STEP_PERIOD) * Math.PI * 2
  const pairs: readonly [string, string, number][] = [
    ['thighL', 'thighR', -Math.sin(cyclePhase)],
    ['shinL', 'shinR', Math.max(0, Math.sin(cyclePhase + 0.8))],
    ['footL', 'footR', Math.min(0, Math.sin(cyclePhase + 1.6))],
  ]
  for (const [lName, rName, s] of pairs) {
    const l = skeleton.boneIdByName.get(lName)
    const r = skeleton.boneIdByName.get(rName)
    if (l !== undefined) work[l * POSE_STRIDE + CH_ROT]! += swing * s
    if (r !== undefined) work[r * POSE_STRIDE + CH_ROT]! -= swing * s
  }

  // 行走时略微抬高骨盆，并让脚骨世界角不小于平足角，避免脚底穿地。
  const pelvis = skeleton.boneIdByName.get('pelvis')
  if (pelvis !== undefined && next.amplitude > 0) {
    work[pelvis * POSE_STRIDE + CH_Y]! += PELVIS_LIFT * next.amplitude
  }
  for (const side of ['L', 'R'] as const) {
    const ids = footIds(skeleton, side)
    if (ids.thigh === undefined || ids.shin === undefined || ids.foot === undefined) continue
    const thighRot = work[ids.thigh * POSE_STRIDE + CH_ROT]!
    const shinRot = thighRot + work[ids.shin * POSE_STRIDE + CH_ROT]!
    const footWorld = shinRot + work[ids.foot * POSE_STRIDE + CH_ROT]!
    if (footWorld < FOOT_FLAT_ANGLE) {
      work[ids.foot * POSE_STRIDE + CH_ROT]! += FOOT_FLAT_ANGLE - footWorld
    }
  }

  // 接触事件按绝对时间阈值生成；已提交的接触点原样保留，支撑期不重算。
  const contacts = state.contacts.slice()
  const cycles = Math.floor((input.time + 1e-12) / STEP_PERIOD)
  for (let k = 1; k <= cycles; k += 1) {
    const schedule = createStepSchedule({
      foot: k % 2 === 0 ? 'R' : 'L',
      startTime: k * STEP_PERIOD,
      duration: STEP_PERIOD,
      duty: STEP_DUTY,
      stepLength: STEP_LENGTH,
    })
    for (const event of schedule.events) {
      if (event.at > input.time + 1e-12) continue
      const duplicate = contacts.some(
        (c) => c.kind === event.kind && Math.abs(c.frame - event.at) < 1e-9,
      )
      if (duplicate) continue
      contacts.push({
        x: k * STEP_LENGTH,
        y: input.groundY,
        frame: event.at,
        kind: event.kind,
      })
    }
  }

  const nextPhase = advancePhase(state.phase, input.dt, 1 / STEP_PERIOD)
  const cycleIndex = Math.max(0, Math.floor((input.time + 1e-12) / STEP_PERIOD))
  const supportFeet: ('L' | 'R')[] = next.gait === 0
    ? []
    : [cycleIndex % 2 === 0 ? 'L' : 'R']

  // 全部检查通过才提交。
  if (!Array.from(work).every(Number.isFinite)) return fail('solve')
  if (contacts.some((c) => !Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.frame))) {
    return fail('contact')
  }

  pose.local.set(work)
  markAllDirty(pose)
  pose.version += 1
  state.params = next
  state.contacts = contacts
  state.phase = nextPhase
  state.supportFeet = supportFeet
  return { committed: true }
}

export { modulatePose } from './params'
export type { MotionParams } from './params'
