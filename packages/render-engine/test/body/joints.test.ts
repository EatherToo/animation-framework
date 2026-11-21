import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { ARM_ROM_MAX, ARM_ROM_MIN, LEG_ROM_MAX, LEG_ROM_MIN } from '@/body/chains'
import { clampJointPose, createJointDofs } from '@/body/joints'
import { createPose, poseRotation, poseSwing, poseTwist, setPoseRotation, setPoseSwing, setPoseTwist } from '@/skeleton/pose'
import { expectClose } from '../math/assert'

describe('joints', () => {
  it('核心 19 骨 + 28 指骨的符号与肘膝范围与体型一致', () => {
    const humanoid = createHumanoid(1.8)
    const core = createJointDofs(humanoid.boneIndex)
    expect(core).toHaveLength(19)
    expect(humanoid.joints.slice(0, 19)).toEqual(core)
    const joints = humanoid.joints
    expect(joints).toHaveLength(47)
    for (let i = 0; i < joints.length; i += 1) expect(joints[i]!.bone).toBe(i)

    const index = humanoid.boneIndex
    const leftElbow = joints[index.lowerArmL]!
    const rightElbow = joints[index.lowerArmR]!
    expect(leftElbow.rotation).toEqual({ min: ARM_ROM_MIN, max: ARM_ROM_MAX })
    expect(rightElbow.rotation).toEqual({ min: ARM_ROM_MIN, max: ARM_ROM_MAX })
    expect(Object.is(leftElbow.rotation!.min, ARM_ROM_MIN)).toBe(true)
    expect(Object.is(leftElbow.rotation!.max, ARM_ROM_MAX)).toBe(true)
    expect(leftElbow.swingSign).toBe(0)
    expect(rightElbow.twistSign).toBe(-1)
    expect(leftElbow.twistSign).toBe(1)

    const knee = joints[index.shinL]!
    expect(knee.rotation).toEqual({ min: LEG_ROM_MIN, max: LEG_ROM_MAX })
    expect(Object.is(knee.rotation!.min, LEG_ROM_MIN)).toBe(true)
    expect(knee.swingSign).toBe(0)
    expect(knee.twistSign).toBe(0)
    expect(knee.swing).toEqual({ min: 0, max: 0 })

    expect(joints[index.upperArmL]!.swingSign).toBe(-1)
    expect(joints[index.upperArmR]!.swingSign).toBe(1)
    expect(joints[index.upperArmL]!.twistSign).toBe(1)
    expect(joints[index.upperArmR]!.twistSign).toBe(-1)
    expect(joints[index.pelvis]!.rotation).toBeNull()
    expect(joints[index.pelvis]!.swing).toBeNull()
    expect(joints[index.pelvis]!.twist).toBeNull()
    expect(joints[index.footL]!.twistSign).toBe(1)
    expect(joints[index.footR]!.twistSign).toBe(-1)
    expect(joints[index.footL]!.swingSign).toBe(0)
    const finger = humanoid.fingerIndex.index1L
    expect(joints[finger]!.rotation).toEqual({ min: 0, max: 1.5 })
    expect(joints[finger]!.swingSign).toBe(0)
    expect(joints[finger]!.twistSign).toBe(0)
    const thumb = humanoid.fingerIndex.thumb1R
    expect(joints[thumb]!.rotation).toEqual({ min: 0, max: 1.0 })
  })

  it('夹紧只改有区间的轴，锁死轴写成精确 0，骨盆保持原值', () => {
    const humanoid = createHumanoid(1.8)
    const pose = createPose(humanoid.skeleton)
    const index = humanoid.boneIndex
    setPoseRotation(pose, index.pelvis, 2)
    setPoseSwing(pose, index.pelvis, 3)
    setPoseTwist(pose, index.pelvis, -1)
    setPoseRotation(pose, index.lowerArmL, 3)
    setPoseSwing(pose, index.lowerArmL, 1)
    setPoseTwist(pose, index.shinL, 0.4)
    setPoseSwing(pose, index.shinL, -0.2)
    setPoseRotation(pose, index.shinL, -3)

    clampJointPose(pose, humanoid.joints)

    expect(poseRotation(pose, index.pelvis)).toBe(2)
    expect(poseSwing(pose, index.pelvis)).toBe(3)
    expect(poseTwist(pose, index.pelvis)).toBe(-1)
    expectClose(poseRotation(pose, index.lowerArmL), ARM_ROM_MAX)
    expect(Object.is(poseSwing(pose, index.lowerArmL), 0)).toBe(true)
    expect(Object.is(poseSwing(pose, index.shinL), 0)).toBe(true)
    expect(Object.is(poseTwist(pose, index.shinL), 0)).toBe(true)
    expectClose(poseRotation(pose, index.shinL), LEG_ROM_MIN)
  })
})
