import { ARM_ROM_MAX, ARM_ROM_MIN, LEG_ROM_MAX, LEG_ROM_MIN } from './chains'
import type { BoneId } from './assemble'
import {
  poseRotation,
  poseSwing,
  poseTwist,
  setPoseRotation,
  setPoseSwing,
  setPoseTwist,
  type Pose,
} from '../skeleton/pose'

/** 一根转轴的闭区间。两端都是 0 表示锁死。 */
export type JointLimit = {
  readonly min: number
  readonly max: number
}

/** 一根骨头上的三根转轴。`null` 表示这一轴不夹紧。 */
export type JointDof = {
  readonly bone: number
  readonly rotation: JointLimit | null
  readonly swing: JointLimit | null
  readonly twist: JointLimit | null
  readonly swingSign: -1 | 0 | 1
  readonly twistSign: -1 | 0 | 1
}

const LOCKED: JointLimit = { min: 0, max: 0 }

/**
 * 按骨头下标填 17 项转动自由度。角度不随身高变化。
 * @param boneIndex 装配得到的名字到下标
 */
export function createJointDofs(
  boneIndex: Readonly<Record<BoneId, number>>,
): readonly JointDof[] {
  const joints = new Array<JointDof>(17)
  const put = (
    name: BoneId,
    rotation: JointLimit | null,
    swing: JointLimit | null,
    twist: JointLimit | null,
    swingSign: -1 | 0 | 1,
    twistSign: -1 | 0 | 1,
  ): void => {
    const bone = boneIndex[name]
    joints[bone] = { bone, rotation, swing, twist, swingSign, twistSign }
  }
  const mid = { swingSign: -1 as const, twistSign: 1 as const }
  put('pelvis', null, null, null, mid.swingSign, mid.twistSign)
  put('spine', range(-1.047, 0.524), span(0.349), span(0.175), mid.swingSign, mid.twistSign)
  put('chest', range(-0.524, 0.349), span(0.349), span(0.611), mid.swingSign, mid.twistSign)
  put('neck', range(-0.873, 1.047), span(0.785), span(1.396), mid.swingSign, mid.twistSign)
  put('head', range(-0.262, 0.349), span(0.175), span(0.785), mid.swingSign, mid.twistSign)
  const shoulder = {
    rotation: range(-1.047, 2.618),
    swing: range(-0.524, 2.618),
    twist: range(-1.222, 1.571),
  }
  put('upperArmL', shoulder.rotation, shoulder.swing, shoulder.twist, -1, 1)
  put('upperArmR', shoulder.rotation, shoulder.swing, shoulder.twist, 1, -1)
  const elbow = range(ARM_ROM_MIN, ARM_ROM_MAX)
  const pronation = span(1.396)
  put('lowerArmL', elbow, LOCKED, pronation, 0, 1)
  put('lowerArmR', elbow, LOCKED, pronation, 0, -1)
  const wrist = range(-1.222, 1.222)
  const deviation = range(-0.524, 0.349)
  put('handL', wrist, deviation, LOCKED, -1, 0)
  put('handR', wrist, deviation, LOCKED, 1, 0)
  const hip = {
    rotation: range(-0.524, 2.094),
    swing: range(-0.524, 0.785),
    twist: range(-0.698, 0.785),
  }
  put('thighL', hip.rotation, hip.swing, hip.twist, -1, 1)
  put('thighR', hip.rotation, hip.swing, hip.twist, 1, -1)
  const knee = range(LEG_ROM_MIN, LEG_ROM_MAX)
  put('shinL', knee, LOCKED, LOCKED, 0, 0)
  put('shinR', knee, LOCKED, LOCKED, 0, 0)
  const ankle = range(-0.698, 0.524)
  const inversion = range(-0.349, 0.524)
  put('footL', ankle, LOCKED, inversion, 0, 1)
  put('footR', ankle, LOCKED, inversion, 0, -1)
  return joints
}

/**
 * 把姿态夹进关节范围。没有区间的轴保持原值。符号为 0 的轴写成精确 0。
 * 步态和逆运动学不调用。
 * @param pose 当前偏移
 * @param joints 与骨头下标对齐的自由度
 */
export function clampJointPose(pose: Pose, joints: readonly JointDof[]): void {
  for (let i = 0; i < joints.length; i += 1) {
    const joint = joints[i]!
    setPoseRotation(pose, joint.bone, clampAxis(poseRotation(pose, joint.bone), joint.rotation, 1))
    setPoseSwing(
      pose,
      joint.bone,
      clampAxis(poseSwing(pose, joint.bone), joint.swing, joint.swingSign),
    )
    setPoseTwist(
      pose,
      joint.bone,
      clampAxis(poseTwist(pose, joint.bone), joint.twist, joint.twistSign),
    )
  }
}

function range(min: number, max: number): JointLimit {
  return { min, max }
}

function span(abs: number): JointLimit {
  return { min: -abs, max: abs }
}

function clampAxis(value: number, limit: JointLimit | null, sign: -1 | 0 | 1): number {
  if (sign === 0) return 0
  if (limit === null) return value
  if (value < limit.min) return limit.min
  if (value > limit.max) return limit.max
  return value
}
