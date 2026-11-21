import { describe, expect, it } from '@jest/globals'
import { compileSkeleton, type BoneSpec } from '@/core2d/skeleton'
import { addRotation, createPose, getWorld, updateWorld } from '@/core2d/pose'
import { transformAffinePoint } from '@/core2d/math'

/**
 * 应用视角的小验证：一条 18 骨 simple2d 人形，抬起右臂后手掌必须离开身体、
 * 朝正确方向移动；FK 在 1000 帧内保持确定性且不产生 NaN。
 */
function humanoid(): BoneSpec[] {
  const b = (name: string, parent: number, x = 0, y = 0): BoneSpec => ({
    name, parent, length: 0.2,
    rest: { x, y, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
  })
  return [
    b('root', -1), b('hips', 0, 0, 0.9), b('spine', 1, 0, 0.15), b('chest', 2, 0, 0.15),
    b('neck', 3, 0, 0.15), b('head', 4, 0, 0.12),
    b('upperArmR', 3, 0.2, 0.05), b('lowerArmR', 6, 0.25, 0), b('handR', 7, 0.22, 0),
    b('upperArmL', 3, -0.2, 0.05), b('lowerArmL', 9, -0.25, 0), b('handL', 10, -0.22, 0),
    b('thighR', 1, 0.08, -0.05), b('shinR', 12, 0, -0.4), b('footR', 13, 0, -0.4),
    b('thighL', 1, -0.08, -0.05), b('shinL', 15, 0, -0.4), b('footL', 16, 0, -0.4),
  ]
}

describe('core2d application smoke', () => {
  it('poses a 18-bone humanoid deterministically', () => {
    const sk = compileSkeleton({ name: 'humanoid', profile: 'simple2d', bones: humanoid() })
    expect(sk.bones).toHaveLength(18)
    const pose = createPose(sk)
    updateWorld(pose)
    const hand = sk.boneIdByName.get('handR')!
    const rest = transformAffinePoint(getWorld(pose, hand), 0, 0)
    addRotation(pose, sk.boneIdByName.get('upperArmR')!, Math.PI / 2)
    updateWorld(pose)
    const raised = transformAffinePoint(getWorld(pose, hand), 0, 0)
    expect(raised[0]).toBeLessThan(rest[0] - 0.1)
    expect(raised[1]).toBeGreaterThan(rest[1] + 0.1)
    for (let i = 0; i < pose.world.length; i += 1) expect(Number.isFinite(pose.world[i])).toBe(true)

    const first = Array.from(pose.world)
    for (let frame = 0; frame < 1000; frame += 1) {
      addRotation(pose, hand, 0.001)
      updateWorld(pose)
    }
    // 旋转手骨只改变该骨自身的线性部分；所有平移与非手骨矩阵逐位不变。
    for (let id = 0; id < sk.count; id += 1) {
      for (let k = 4; k < 6; k += 1) {
        expect(pose.world[id * 6 + k]).toBe(first[id * 6 + k])
      }
      if (id !== hand) {
        for (let k = 0; k < 4; k += 1) expect(pose.world[id * 6 + k]).toBe(first[id * 6 + k])
      }
    }
    // 1000 tiny rotations wrap into a continuous range, never NaN
    for (let i = 0; i < pose.world.length; i += 1) expect(Number.isFinite(pose.world[i])).toBe(true)
  })
})
