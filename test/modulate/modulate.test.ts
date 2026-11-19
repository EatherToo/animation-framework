import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { normalizeAngle } from '@/math/angle'
import { createVec2 } from '@/math/vec2'
import { ARM_SWING_ARC, CROUCH_DROP_RATIO, writePelvis, writeUpper } from '@/modulate/modulate'
import { createPose, poseRotation, poseTranslation, setPoseTranslation } from '@/skeleton/pose'
import { findBone } from '@/skeleton/skeleton'

describe('modulate', () => {
  const humanoid = createHumanoid(1.7)
  const skeleton = humanoid.skeleton
  const leg = humanoid.proportions.legLength
  const stored = (value: number) => new Float32Array([normalizeAngle(value)])[0]
  const pelvis = findBone(skeleton, 'pelvis')
  const thigh = findBone(skeleton, 'thighL')
  const armL = findBone(skeleton, 'upperArmL')
  const armR = findBone(skeleton, 'upperArmR')
  const spine = findBone(skeleton, 'spine')
  const head = findBone(skeleton, 'head')

  it('蹲伏降低骨盆，保留水平偏移，倾斜写成旋转', () => {
    const pose = createPose(skeleton)
    setPoseTranslation(pose, pelvis, 0.2, 0)
    const kept = poseTranslation(createVec2(), pose, pelvis)[0]
    writePelvis(pose, leg, 1, 0.2, 0, 'stand')
    const translated = poseTranslation(createVec2(), pose, pelvis)
    expect(translated[0]).toBe(kept)
    expect(translated[1]).toBe(new Float32Array([-CROUCH_DROP_RATIO * leg])[0])
    expect(poseRotation(pose, pelvis)).toBe(stored(0.2))
  })

  it('行走和跑步的起伏方向相反', () => {
    const pose = createPose(skeleton)
    writePelvis(pose, leg, 0, 0, Math.PI / 2, 'walk')
    const walk = poseTranslation(createVec2(), pose, pelvis)[1]
    expect(walk).toBe(new Float32Array([0.01 * leg])[0])
    writePelvis(pose, leg, 0, 0, Math.PI / 2, 'run')
    expect(poseTranslation(createVec2(), pose, pelvis)[1]).toBe(new Float32Array([-0.01 * leg])[0])
    expect(walk).toBeGreaterThan(0)
  })

  it('上身摆臂不移动骨盆和腿', () => {
    const pose = createPose(skeleton)
    setPoseTranslation(pose, pelvis, 0.2, -0.05)
    const beforePelvis = Array.from(pose.data.slice(pelvis * 3, pelvis * 3 + 3))
    const beforeThigh = Array.from(pose.data.slice(thigh * 3, thigh * 3 + 3))
    writeUpper(pose, 1, 0.5, 1, Math.PI / 2)
    expect(poseRotation(pose, armL)).toBe(stored(-ARM_SWING_ARC))
    expect(poseRotation(pose, armR)).toBe(stored(ARM_SWING_ARC))
    expect(poseRotation(pose, spine)).not.toBe(0)
    expect(poseRotation(pose, head)).not.toBe(0)
    expect(Array.from(pose.data.slice(pelvis * 3, pelvis * 3 + 3))).toEqual(beforePelvis)
    expect(Array.from(pose.data.slice(thigh * 3, thigh * 3 + 3))).toEqual(beforeThigh)
  })

  it('越界蹲伏不写骨盆', () => {
    const pose = createPose(skeleton)
    expect(() => writePelvis(pose, leg, 1.2, 0, 0, 'stand')).toThrow(/^crouch$/)
    expect(poseTranslation(createVec2(), pose, pelvis)[1]).toBe(0)
  })
})
