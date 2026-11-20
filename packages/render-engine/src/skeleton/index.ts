/**
 * 03 骨架：骨骼树、绑定与相对绑定的当前偏移。
 * 只依赖 01 数学；不级联、不装配人形、不保存朝向。
 */
export {
  PARENT_NONE,
  MAX_BONES,
  createSkeletonBuilder,
  addBone,
  finishSkeleton,
  parentOf,
  boneName,
  findBone,
  bindTranslation,
  bindLateral,
  bindRotation,
  bindLength,
} from './skeleton'
export type { BoneSpec, Skeleton, SkeletonBuilder } from './skeleton'

export {
  POSE_STRIDE,
  createPose,
  setPoseTranslation,
  setPoseRotation,
  setPoseSwing,
  setPoseTwist,
  poseTranslation,
  poseRotation,
  poseSwing,
  poseTwist,
  zeroPose,
  copyPose,
} from './pose'
export type { Pose } from './pose'

export { setParentFromBone, setBindParentFromBone } from './parent-from-bone'

export { RIGID_STRIDE, setRigidParentFromBone, multiplyRigid } from './rigid'
