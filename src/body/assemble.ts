import {
  PARENT_NONE,
  addBone,
  createSkeletonBuilder,
  finishSkeleton,
  type Skeleton,
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
import { createProportions, type BodyProportions } from './proportions'

/** 首版人形 17 根骨头的固定名字。 */
export type BoneId =
  | 'pelvis'
  | 'spine'
  | 'chest'
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

/** 装配完成的人形：比例、骨架、下标表与四条二骨链。 */
export type Humanoid = {
  readonly height: number
  readonly proportions: BodyProportions
  readonly skeleton: Skeleton
  readonly boneIndex: Readonly<Record<BoneId, number>>
  readonly chains: {
    readonly legL: TwoBoneChain
    readonly legR: TwoBoneChain
    readonly armL: TwoBoneChain
    readonly armR: TwoBoneChain
  }
}

/**
 * 由身高装配人形。非法身高抛出。
 * @param height 站立身高（米）
 */
export function createHumanoid(height: number): Humanoid {
  return createHumanoidFromProportions(createProportions(height))
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
    parent: chest,
    translationX: -p.shoulderDropY,
    translationY: 0,
    translationZ: p.shoulderOffsetZ,
    rotation: Math.PI,
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
    parent: chest,
    translationX: -p.shoulderDropY,
    translationY: 0,
    translationZ: -p.shoulderOffsetZ,
    rotation: Math.PI,
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

  const skeleton = finishSkeleton(builder)

  const boneIndex: Record<BoneId, number> = {
    pelvis,
    spine,
    chest,
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
  }
}
