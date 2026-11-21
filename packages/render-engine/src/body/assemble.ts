import {
  PARENT_NONE,
  addBone,
  createSkeletonBuilder,
  finishSkeleton,
  type Skeleton,
  type SkeletonBuilder,
} from '../skeleton/skeleton'
import {
  ARM_BEND_SIGN,
  ARM_ROM_MAX,
  ARM_ROM_MIN,
  LEG_BEND_SIGN,
  LEG_ROM_MAX,
  LEG_ROM_MIN,
  makeTwoBoneChain,
  type TwoBoneChain,
} from './chains'
import { createJointDofs, type JointDof } from './joints'
import { createProportions, type BodyProportions } from './proportions'

/** 绑定姿态里上臂的外展角。垂臂略向外，让手臂离开躯干。 */
export const ARM_BIND_SWING = 0.1047

/** 肩关节相对锁骨原点的横向距离：锁骨原点在胸骨端 `0.02 H`，肩关节在 `0.10 H`。 */
export const CLAVICLE_REACH = 0.08

/** 首版人形 19 根骨头的固定名字。 */
export type BoneId =
  | 'pelvis'
  | 'spine'
  | 'chest'
  | 'clavicleL'
  | 'clavicleR'
  | 'neck'
  | 'head'
  | 'upperArmL'
  | 'lowerArmL'
  | 'handL'
  | 'upperArmR'
  | 'lowerArmR'
  | 'handR'
  | 'thighL'
  | 'shinL'
  | 'footL'
  | 'thighR'
  | 'shinR'
  | 'footR'

/** 下标顺序与 {@link BoneId} 一致，供遍历。 */
export const BONE_NAMES: readonly BoneId[] = [
  'pelvis',
  'spine',
  'chest',
  'clavicleL',
  'clavicleR',
  'neck',
  'head',
  'upperArmL',
  'lowerArmL',
  'handL',
  'upperArmR',
  'lowerArmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
]

/** 手指骨名字：拇指 2 节，其余四指各 3 节；左右共 28 根。 */
export const FINGER_BONE_NAMES = [
  'thumb1L', 'thumb2L',
  'index1L', 'index2L', 'index3L',
  'middle1L', 'middle2L', 'middle3L',
  'ring1L', 'ring2L', 'ring3L',
  'pinky1L', 'pinky2L', 'pinky3L',
  'thumb1R', 'thumb2R',
  'index1R', 'index2R', 'index3R',
  'middle1R', 'middle2R', 'middle3R',
  'ring1R', 'ring2R', 'ring3R',
  'pinky1R', 'pinky2R', 'pinky3R',
] as const

export type FingerBoneId = (typeof FINGER_BONE_NAMES)[number]

/** 装配完成的人形：比例、骨架、下标表与四条二骨链。 */
export type Humanoid = {
  readonly height: number
  readonly proportions: BodyProportions
  readonly skeleton: Skeleton
  readonly boneIndex: Readonly<Record<BoneId, number>>
  readonly fingerIndex: Readonly<Record<FingerBoneId, number>>
  readonly chains: {
    readonly legL: TwoBoneChain
    readonly legR: TwoBoneChain
    readonly armL: TwoBoneChain
    readonly armR: TwoBoneChain
  }
  readonly joints: readonly JointDof[]
}

/**
 * 由身高装配人形。非法身高抛出。
 * @param height 站立身高（米）
 */
export function createHumanoid(height: number): Humanoid {
  return createHumanoidFromProportions(createProportions(height))
}

const FINGER_ORDER = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const
const FINGER_SEGMENTS: Readonly<Record<(typeof FINGER_ORDER)[number], readonly number[]>> = {
  thumb: [0.55, 0.45],
  index: [0.42, 0.33, 0.25],
  middle: [0.42, 0.33, 0.25],
  ring: [0.42, 0.33, 0.25],
  pinky: [0.42, 0.33, 0.25],
}

/**
 * 在 hand 骨下追加一侧的 14 根指骨。指骨排在所有身体骨之后，
 * 因此 0–18 的核心骨下标不变。
 * @param builder 建造器
 * @param p 比例
 * @param side 左/右
 * @param hand hand 骨下标
 * @param out 指骨名字 → 下标
 */
function addFingerBones(
  builder: SkeletonBuilder,
  p: BodyProportions,
  side: 'L' | 'R',
  hand: number,
  out: Record<FingerBoneId, number>,
): void {
  const sideSign = side === 'L' ? 1 : -1
  const handLength = p.handLength
  const palm = p.palmFraction * handLength
  for (const finger of FINGER_ORDER) {
    const index = finger === 'thumb' ? 0 : (['index', 'middle', 'ring', 'pinky'] as const).indexOf(finger)
    const base = finger === 'thumb' ? p.thumbAlong * handLength : palm
    const tip = finger === 'thumb' ? p.thumbTipAlong * handLength : p.fingerLengths[index]! * handLength
    const zBase = finger === 'thumb' ? sideSign * p.thumbOffsetZ : p.fingerOffsets[index]!
    const zTip = finger === 'thumb' ? sideSign * p.thumbTipZ : zBase
    const total = Math.max(0, tip - base)
    const fractions = FINGER_SEGMENTS[finger]
    let parent = hand
    let x = base
    let z = zBase
    for (let s = 0; s < fractions.length; s += 1) {
      const length = total * fractions[s]!
      const name = `${finger}${s + 1}${side}` as FingerBoneId
      const bone = addBone(builder, {
        name,
        parent,
        translationX: x,
        translationY: 0,
        translationZ: z,
        rotation: 0,
        length,
      })
      out[name] = bone
      parent = bone
      x = length
      z = finger === 'thumb' && s === 0 ? zTip - zBase : 0
    }
  }
}

/**
 * 用已有比例装配人形。
 * @param p 比例量
 */
export function createHumanoidFromProportions(p: BodyProportions): Humanoid {
  const builder = createSkeletonBuilder()
  const halfPi = Math.PI / 2

  const pelvis = addBone(builder, {
    name: 'pelvis',
    parent: PARENT_NONE,
    translationX: 0,
    translationY: p.hipHeight,
    translationZ: 0,
    rotation: 0,
    length: p.pelvisLength,
  })
  const spine = addBone(builder, {
    name: 'spine',
    parent: pelvis,
    translationX: 0,
    translationY: 0,
    translationZ: 0,
    rotation: halfPi,
    length: p.spineLength,
  })
  const chest = addBone(builder, {
    name: 'chest',
    parent: spine,
    translationX: p.spineLength,
    translationY: 0,
    translationZ: 0,
    rotation: 0,
    length: p.chestLength,
  })
  // 锁骨是零长的枢轴骨：原点在胸骨端，坐标系与胸腔一致，只负责把肩关节绕胸骨端转动。
  const clavicleL = addBone(builder, {
    name: 'clavicleL',
    parent: chest,
    translationX: p.chestLength - p.shoulderDropY,
    translationY: 0,
    translationZ: 0.02 * p.height,
    rotation: 0,
    length: 0,
  })
  const clavicleR = addBone(builder, {
    name: 'clavicleR',
    parent: chest,
    translationX: p.chestLength - p.shoulderDropY,
    translationY: 0,
    translationZ: -0.02 * p.height,
    rotation: 0,
    length: 0,
  })
  const neck = addBone(builder, {
    name: 'neck',
    parent: chest,
    translationX: p.chestLength,
    translationY: 0,
    translationZ: 0,
    rotation: 0,
    length: p.neckLength,
  })
  const head = addBone(builder, {
    name: 'head',
    parent: neck,
    translationX: p.neckLength,
    translationY: 0,
    translationZ: 0,
    rotation: 0,
    length: p.headLength,
  })

  const upperArmL = addBone(builder, {
    name: 'upperArmL',
    parent: clavicleL,
    translationX: 0,
    translationY: 0,
    translationZ: CLAVICLE_REACH * p.height,
    rotation: Math.PI,
    swing: ARM_BIND_SWING,
    length: p.upperArmLength,
  })
  const lowerArmL = addBone(builder, {
    name: 'lowerArmL',
    parent: upperArmL,
    translationX: p.upperArmLength,
    translationY: 0,
    translationZ: 0,
    rotation: 0,
    length: p.lowerArmLength,
  })
  const handL = addBone(builder, {
    name: 'handL',
    parent: lowerArmL,
    translationX: p.lowerArmLength,
    translationY: 0,
    translationZ: 0,
    rotation: 0,
    length: p.handLength,
  })

  const upperArmR = addBone(builder, {
    name: 'upperArmR',
    parent: clavicleR,
    translationX: 0,
    translationY: 0,
    translationZ: -CLAVICLE_REACH * p.height,
    rotation: Math.PI,
    swing: ARM_BIND_SWING,
    length: p.upperArmLength,
  })
  const lowerArmR = addBone(builder, {
    name: 'lowerArmR',
    parent: upperArmR,
    translationX: p.upperArmLength,
    translationY: 0,
    translationZ: 0,
    rotation: 0,
    length: p.lowerArmLength,
  })
  const handR = addBone(builder, {
    name: 'handR',
    parent: lowerArmR,
    translationX: p.lowerArmLength,
    translationY: 0,
    translationZ: 0,
    rotation: 0,
    length: p.handLength,
  })

  const thighL = addBone(builder, {
    name: 'thighL',
    parent: pelvis,
    translationX: 0,
    translationY: -p.hipDropY,
    translationZ: p.hipOffsetZ,
    rotation: -halfPi,
    length: p.thighLength,
  })
  const shinL = addBone(builder, {
    name: 'shinL',
    parent: thighL,
    translationX: p.thighLength,
    translationY: 0,
    translationZ: 0,
    rotation: 0,
    length: p.shinLength,
  })
  const footL = addBone(builder, {
    name: 'footL',
    parent: shinL,
    translationX: p.shinLength,
    translationY: 0,
    translationZ: 0,
    rotation: halfPi,
    length: p.footLength,
  })

  const thighR = addBone(builder, {
    name: 'thighR',
    parent: pelvis,
    translationX: 0,
    translationY: -p.hipDropY,
    translationZ: -p.hipOffsetZ,
    rotation: -halfPi,
    length: p.thighLength,
  })
  const shinR = addBone(builder, {
    name: 'shinR',
    parent: thighR,
    translationX: p.thighLength,
    translationY: 0,
    translationZ: 0,
    rotation: 0,
    length: p.shinLength,
  })
  const footR = addBone(builder, {
    name: 'footR',
    parent: shinR,
    translationX: p.shinLength,
    translationY: 0,
    translationZ: 0,
    rotation: halfPi,
    length: p.footLength,
  })

  const fingerIndex = {} as Record<FingerBoneId, number>
  addFingerBones(builder, p, 'L', handL, fingerIndex)
  addFingerBones(builder, p, 'R', handR, fingerIndex)

  const skeleton = finishSkeleton(builder)

  const boneIndex: Record<BoneId, number> = {
    pelvis,
    spine,
    chest,
    clavicleL,
    clavicleR,
    neck,
    head,
    upperArmL,
    lowerArmL,
    handL,
    upperArmR,
    lowerArmR,
    handR,
    thighL,
    shinL,
    footL,
    thighR,
    shinR,
    footR,
  }

  return {
    height: p.height,
    proportions: p,
    skeleton,
    boneIndex,
    fingerIndex,
    chains: {
      legL: makeTwoBoneChain({
        root: thighL,
        mid: shinL,
        end: footL,
        bendSign: LEG_BEND_SIGN,
        romMin: LEG_ROM_MIN,
        romMax: LEG_ROM_MAX,
      }),
      legR: makeTwoBoneChain({
        root: thighR,
        mid: shinR,
        end: footR,
        bendSign: LEG_BEND_SIGN,
        romMin: LEG_ROM_MIN,
        romMax: LEG_ROM_MAX,
      }),
      armL: makeTwoBoneChain({
        root: upperArmL,
        mid: lowerArmL,
        end: handL,
        bendSign: ARM_BEND_SIGN,
        romMin: ARM_ROM_MIN,
        romMax: ARM_ROM_MAX,
      }),
      armR: makeTwoBoneChain({
        root: upperArmR,
        mid: lowerArmR,
        end: handR,
        bendSign: ARM_BEND_SIGN,
        romMin: ARM_ROM_MIN,
        romMax: ARM_ROM_MAX,
      }),
    },
    joints: createJointDofs(boneIndex, fingerIndex, FINGER_BONE_NAMES),
  }
}
