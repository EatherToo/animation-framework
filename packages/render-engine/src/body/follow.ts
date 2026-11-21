import type { JointDof } from './joints'
import { findBone, type Skeleton } from '../skeleton/skeleton'
import {
  poseRotation,
  poseSwing,
  setPoseRotation,
  setPoseSwing,
  type Pose,
} from '../skeleton/pose'

/** 锁骨跟随上臂侧摆的比例：抬臂时肩带跟着上抬。 */
export const CLAVICLE_FOLLOW_SWING = 0.3
/** 锁骨跟随上臂矢状弯曲的比例。 */
export const CLAVICLE_FOLLOW_ROTATION = 0.2

/**
 * 让锁骨强制跟随上臂：侧摆取 30%、矢状取 20%，再夹进锁骨自己的活动范围。
 * 这是绑定姿态之外的固定规则，不是可选项；每次写完姿态都要调用。
 * @param pose 当前姿态
 * @param rig 骨架与关节自由度
 */
export function applyClavicleFollow(
  pose: Pose,
  rig: { readonly skeleton: Skeleton; readonly joints: readonly JointDof[] },
): void {
  const skeleton = rig.skeleton
  for (const side of ['L', 'R'] as const) {
    const arm = findBone(skeleton, `upperArm${side}`)
    const clavicle = findBone(skeleton, `clavicle${side}`)
    if (arm < 0 || clavicle < 0) continue
    const joint = rig.joints[clavicle]
    if (joint === undefined) continue
    setPoseSwing(
      pose,
      clavicle,
      clampTo(poseSwing(pose, arm) * CLAVICLE_FOLLOW_SWING, joint.swing),
    )
    setPoseRotation(
      pose,
      clavicle,
      clampTo(poseRotation(pose, arm) * CLAVICLE_FOLLOW_ROTATION, joint.rotation),
    )
  }
}

function clampTo(value: number, limit: JointDof['swing']): number {
  if (limit === null) return value
  if (value < limit.min) return limit.min
  if (value > limit.max) return limit.max
  return value
}
