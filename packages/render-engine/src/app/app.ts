/**
 * M12 应用层：人形模板、足部接触、运动规划与姿态调制。
 * 权威：docs/16-20 及其子文档。只依赖 core2d 骨架/姿态/数学，不碰渲染或核心 01-15。
 *
 * 本文件现在只保留人形模板装配；足部/运动/参数等实现下沉到同目录模块，
 * 这里统一 re-export，保持旧入口 `@/app/app` 的导出兼容。
 */
import {
  compileSkeleton,
  type BoneSpec,
  type CompiledSkeleton,
  type SkeletonSpec,
} from '../core/skeleton'

// ---------------------------------------------------------------------------
// 人形模板（16）
// ---------------------------------------------------------------------------

/** 每手手指骨数：无 / 一根示意 / 14 根（拇指 2 + 其余四指各 3）。 */
export type HandLod = 'none' | 'simple' | 'full'

const DEFAULT_HEIGHT = 1.7

/** average 成人比例表（身高倍数），集中管理，不散落在装配代码里。 */
const P = {
  pelvisHeight: 0.53,
  spine: 0.17,
  chest: 0.20,
  neck: 0.06,
  head: 0.15, // 2 × headRadius(0.075)
  shoulderWidth: 0.23,
  hipWidth: 0.11,
  upperArm: 0.19,
  lowerArm: 0.16,
  hand: 0.11,
  thigh: 0.24,
  shin: 0.23,
  ankleHeight: 0.04,
  foot: 0.15,
  clavicle: 0.05,
} as const

/** 指骨长度系数（相对手长）与横向铺开比例；顺序固定，保证确定性。 */
const FINGERS = [
  { name: 'thumb', segments: [0.30, 0.25], spread: 0.10 },
  { name: 'index', segments: [0.22, 0.16, 0.12], spread: 0.045 },
  { name: 'middle', segments: [0.24, 0.18, 0.13], spread: 0.015 },
  { name: 'ring', segments: [0.22, 0.17, 0.12], spread: -0.015 },
  { name: 'pinky', segments: [0.18, 0.14, 0.10], spread: -0.045 },
] as const

type Side = 'L' | 'R'
const SIDES: readonly { tag: Side; sign: 1 | -1 }[] = [
  { tag: 'L', sign: -1 },
  { tag: 'R', sign: 1 },
]

/** 由身高生成骨骼规格；simple2d 强制无指骨（核心编译器也禁止 finger/2DOF）。 */
export function humanoidSpec(
  profile: 'simple2d' | 'full2d',
  opts?: { height?: number; handLod?: HandLod },
): SkeletonSpec {
  const height = opts?.height ?? DEFAULT_HEIGHT
  if (!Number.isFinite(height) || height <= 0) throw new Error('app.height')
  const handLod: HandLod = profile === 'simple2d' ? 'none' : (opts?.handLod ?? 'none')

  // 先算所有骨长（Float64 语义），再组装关节，避免边算边写产生累计误差。
  const m = {
    pelvisHeight: height * P.pelvisHeight,
    spine: height * P.spine,
    chest: height * P.chest,
    neck: height * P.neck,
    head: height * P.head,
    shoulderHalf: height * P.shoulderWidth * 0.5,
    hipHalf: height * P.hipWidth * 0.5,
    upperArm: height * P.upperArm,
    lowerArm: height * P.lowerArm,
    hand: height * P.hand,
    thigh: height * P.thigh,
    shin: height * P.shin,
    ankleHeight: height * P.ankleHeight,
    foot: height * P.foot,
    clavicle: height * P.clavicle,
  }

  const bones: BoneSpec[] = []
  const add = (
    name: string,
    parent: number,
    length: number,
    rest?: { x?: number; y?: number; rotation?: number },
    tags?: readonly string[],
  ): number => {
    bones.push({
      name,
      parent,
      length,
      rest: {
        x: rest?.x ?? 0,
        y: rest?.y ?? 0,
        rotation: rest?.rotation ?? 0,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
      },
      ...(tags ? { tags } : {}),
    })
    return bones.length - 1
  }

  // 核心 18 骨：下标 0..17 稳定。
  const root = add('root', -1, 0)
  const pelvis = add('pelvis', root, 0, { y: m.pelvisHeight })
  const spine = add('spine', pelvis, m.spine)
  const chest = add('chest', spine, m.chest)
  const neckId = add('neck', chest, m.neck)
  add('head', neckId, m.head)

  const handIds: number[] = []
  for (const { tag, sign } of SIDES) {
    let armParent = chest
    let upperX = sign * m.shoulderHalf
    if (profile === 'full2d') {
      // full2d 的 2 根 yoke（肩带骨）插在胸与 upperArm 之间。
      armParent = add(`clavicle${tag}`, chest, m.clavicle, { x: sign * m.shoulderHalf })
      upperX = 0
    }
    const upper = add(`upperArm${tag}`, armParent, m.upperArm, { x: upperX, rotation: sign * 0.06 })
    const lower = add(`lowerArm${tag}`, upper, m.lowerArm, { rotation: sign * 0.05 })
    handIds.push(add(`hand${tag}`, lower, m.hand))
  }

  for (const { tag, sign } of SIDES) {
    const thigh = add(`thigh${tag}`, pelvis, m.thigh, { x: sign * m.hipHalf })
    const shin = add(`shin${tag}`, thigh, m.shin)
    add(`foot${tag}`, shin, m.foot, { y: -m.ankleHeight, rotation: sign * 0.02 })
  }

  // 指骨只在 full2d 生成；simple 每手 1 根示意骨，full 每手 14 根。
  if (profile === 'full2d' && handLod !== 'none') {
    for (let s = 0; s < SIDES.length; s += 1) {
      const { tag, sign } = SIDES[s]!
      const hand = handIds[s]!
      if (handLod === 'simple') {
        add(`index1${tag}`, hand, m.hand * 0.5, { rotation: sign * 0.03 }, ['finger'])
        continue
      }
      // 每根手指的根都挂在手掌上；spread 只作用在根节，不累积到后续节。
      for (const finger of FINGERS) {
        let parent = hand
        for (let seg = 0; seg < finger.segments.length; seg += 1) {
          parent = add(
            `${finger.name}${seg + 1}${tag}`,
            parent,
            m.hand * finger.segments[seg]!,
            {
              x: seg === 0 ? sign * finger.spread * m.hand : 0,
              rotation: sign * 0.03,
            },
            ['finger'],
          )
        }
      }
    }
  }

  return {
    name: `humanoid-${profile}-${handLod}`,
    profile,
    bones,
    rootMotion: 'entity',
  }
}

/** 编译人形骨架；同输入逐位一致。 */
export function createHumanoid(
  profile: 'simple2d' | 'full2d',
  opts?: { height?: number; handLod?: HandLod },
): CompiledSkeleton {
  return compileSkeleton(humanoidSpec(profile, opts))
}

// ---------------------------------------------------------------------------
// 应用层模块统一出口（保持旧入口兼容）
// ---------------------------------------------------------------------------

export type {
  ContactKind,
  ContactMark,
  FootContactEvent,
  FootGeometry,
  FootPoint,
} from './foot'
export {
  FootContactSolver,
  ankleFromContact,
  contactFromAnkle,
  createFootGeometry,
  heelStrike,
  soleLocal,
  toeOff,
} from './foot'

export type { Gait, GaitIndex, GaitMode } from './gait'
export { gaitModeOf, gaitOf, gaitTable, speedToGait } from './gait'

export type {
  ScheduleEvent,
  ScheduleSample,
  StepSchedule,
  StepScheduleInput,
} from './schedule'
export { createStepSchedule, sampleSchedule } from './schedule'

export type { FootTarget, TrajectoryProfile } from './trajectory'
export { footTrajectory, sampleTrajectory } from './trajectory'

export type { ReachLimits, ReachOptions, ReachReason, ReachResult } from './reach'
export { solveReach } from './reach'

export type { Placement } from './place'
export { placeFoot, placeFootInto } from './place'

export type { Recovery, RecoveryOptions } from './recover'
export { attemptRecover, createRecovery } from './recover'

export type { MotionParams, ParamState, ParamTaus } from './params'
export {
  DEFAULT_PARAM_TAUS,
  ParamSmoother,
  copyParams,
  modulatePose,
  smoothingAlpha,
} from './params'

export type { MotionInput, MotionState, PlanResult } from './motion'
export {
  advancePhase,
  bump,
  createMotionState,
  planMotion,
  smoothstep,
} from './motion'
