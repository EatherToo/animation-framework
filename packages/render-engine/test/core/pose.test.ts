import { describe, expect, it } from '@jest/globals'
import { compileSkeleton, type BoneSpec } from '@/core/skeleton'
import {
  addRotation,
  createPose,
  getWorld,
  markDirty,
  POSE_STRIDE,
  resetToSetup,
  setLocal,
  updateWorld,
  WORLD_STRIDE,
} from '@/core/pose'
import { detAffine, transformAffinePoint, type Affine } from '@/core/math'

const chain = (inherits: Array<'normal' | 'onlyTranslation' | 'noRotationOrReflection' | 'noScale' | 'noScaleOrReflection'>) =>
  compileSkeleton({
    name: 'chain', profile: 'full2d',
    bones: ['root', 'child', 'grandchild'].map((name, i) => ({
      name, parent: i === 0 ? -1 : i - 1, length: 1, inherit: inherits[i]!,
      rest: { x: i === 0 ? 0 : 1, y: 0, rotation: i === 1 ? Math.PI / 2 : 0, scaleX: i === 1 ? 2 : 1, scaleY: i === 1 ? 3 : 1, shearX: 0, shearY: 0 },
    })),
  })

describe('core2d pose / FK', () => {
  it('allocates spec-sized buffers and evaluates a chain in topological order', () => {
    const sk = chain(['normal', 'normal', 'normal'])
    const pose = createPose(sk)
    expect(pose.local.length).toBe(POSE_STRIDE * 3)
    expect(pose.world.length).toBe(WORLD_STRIDE * 3)
    updateWorld(pose)
    expect(pose.worldValid).toBe(true)
    expect(pose.dirtyCount).toBe(0)
    const w0 = getWorld(pose, 0)
    expect(w0[4]).toBe(0)
    const w1 = getWorld(pose, 1)
    expect(w1[4]).toBe(1)
    expect(w1[5]).toBe(0)
    const tip = transformAffinePoint(getWorld(pose, 2), 1, 0)
    expect(tip[0]).toBeCloseTo(1, 6)
    expect(tip[1]).toBeCloseTo(4, 6) // 父骨 R90·S(2,3) 把两段 x=1 各映射为 y=2
  })

  it('marks whole subtree dirty and only recomputes dirty bones', () => {
    const sk = compileSkeleton({
      name: 'tree', profile: 'simple2d',
      bones: [
        { name: 'root', parent: -1, length: 0 },
        { name: 'a', parent: 0, length: 1 },
        { name: 'b', parent: 0, length: 1 },
        { name: 'a1', parent: 1, length: 1 },
      ] as BoneSpec[],
    })
    const pose = createPose(sk)
    updateWorld(pose)
    const beforeB = getWorld(pose, 2)
    setLocal(pose, 1, 2, 0.5)
    expect(pose.dirty[1]).toBe(1)
    expect(pose.dirty[3]).toBe(1)
    expect(pose.dirty[2]).toBe(0)
    expect(pose.dirtyCount).toBe(2)
    updateWorld(pose)
    const afterB = getWorld(pose, 2)
    expect(Array.from(afterB)).toEqual(Array.from(beforeB))
    expect(pose.dirtyCount).toBe(0)
  })

  it('applies inherit modes numerically', () => {
    const modes = ['onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'] as const
    for (const mode of modes) {
      const sk = chain(['normal', 'normal', mode])
      const pose = createPose(sk)
      updateWorld(pose)
      const parent = getWorld(pose, 1)
      const world = getWorld(pose, 2)
      const expectedLinear = (() => {
        if (mode === 'onlyTranslation') return [1, 0, 0, 1] as const
        if (mode === 'noRotationOrReflection') return [2, 0, 0, 3] as const
        if (mode === 'noScale') return [0, 1, -1, 0] as const
        return [0, 1, -1, 0] as const // reflected Y basis already has positive det
      })()
      // grandchild local is identity, so world linear part == parent basis linear part
      expect(parent[0]).not.toBeNaN()
      expect(Math.abs(world[0]! - expectedLinear[0])).toBeLessThan(1e-6)
      expect(Math.abs(world[2]! - expectedLinear[2])).toBeLessThan(1e-6)
    }
  })

  it('keeps rotation continuous beyond one turn and resets to setup', () => {
    const sk = chain(['normal', 'normal', 'normal'])
    const pose = createPose(sk)
    addRotation(pose, 1, 4 * Math.PI)
    expect(pose.local[POSE_STRIDE + 2]).toBeCloseTo(4 * Math.PI + Math.PI / 2, 5)
    updateWorld(pose)
    expect(detAffine(getWorld(pose, 1))).toBeGreaterThan(0)
    resetToSetup(pose)
    expect(pose.local[POSE_STRIDE + 2]).toBeCloseTo(Math.PI / 2, 6)
    expect(pose.worldValid).toBe(false)
    updateWorld(pose)
    expect(getWorld(pose, 1)[2]).toBeCloseTo(-3, 6)
  })

  it('ignores redundant dirty marks', () => {
    const sk = chain(['normal', 'normal', 'normal'])
    const pose = createPose(sk)
    updateWorld(pose)
    markDirty(pose, 2)
    markDirty(pose, 2)
    expect(pose.dirtyCount).toBe(1)
  })
})
