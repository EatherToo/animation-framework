/**
 * 04 体型：身高比例、二骨链与 17 骨人形装配。
 * 依赖 01 数学与 03 骨架；不导入 space / gl-matrix。
 */
export { createProportions } from './proportions'
export type { BodyProportions } from './proportions'

export {
  LEG_BEND_SIGN,
  ARM_BEND_SIGN,
  LEG_ROM_MIN,
  LEG_ROM_MAX,
  ARM_ROM_MIN,
  ARM_ROM_MAX,
  makeTwoBoneChain,
} from './chains'
export type { TwoBoneChain, TwoBoneChainSpec } from './chains'

export { createJointDofs, clampJointPose } from './joints'
export type { JointDof, JointLimit } from './joints'

export {
  BONE_NAMES,
  createHumanoid,
  createHumanoidFromProportions,
} from './assemble'
export type { BoneId, Humanoid } from './assemble'
