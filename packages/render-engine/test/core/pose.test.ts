import { describe, expect, it } from '@jest/globals'
import { compileSkeleton, type BoneSpec } from '@/core/skeleton'
import {
  addRotation,
  createPose,
  copyPose,
  getWorld,
  markDirty,
  localToWorld,
  worldToLocal,
  localToWorldRotation,
  worldToLocalRotation,
  POSE_STRIDE,
  resetToSetup,
  setLocal,
  setWorldOverride,
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
  it('keeps world-only constraints separate from applied local and propagates to children', () => {
    const skeleton = chain(['normal', 'normal', 'normal'])
    const pose = createPose(skeleton)
    updateWorld(pose)
    const appliedX = pose.local[0]!
    setWorldOverride(pose, 0, [1, 0, 0, 1, 4, 5])
    updateWorld(pose)
    expect(getWorld(pose, 0)[4]).toBe(4)
    expect(getWorld(pose, 1)[4]).toBe(5)
    expect(pose.local[0]).toBe(appliedX)
    const copy = createPose(skeleton)
    copyPose(copy, pose)
    updateWorld(copy)
    expect(getWorld(copy, 1)[4]).toBe(5)
    setLocal(pose, 0, 0, 2)
    updateWorld(pose)
    expect(getWorld(pose, 0)[4]).toBe(2)
    resetToSetup(copy)
    updateWorld(copy)
    expect(getWorld(copy, 0)[4]).toBe(0)
  })
  it('inverts bone-space points and rotations with nonuniform scale', () => {
    const pose = createPose(chain(['normal', 'normal', 'normal']))
    for (const bone of [0, 1, 2]) {
      const point = [0.35, -0.8] as const
      const world = localToWorld(pose, bone, ...point)
      const local = worldToLocal(pose, bone, ...world)
      expect(local[0]).toBeCloseTo(point[0], 6)
      expect(local[1]).toBeCloseTo(point[1], 6)
      const angle = 0.43
      const recovered = worldToLocalRotation(pose, bone, localToWorldRotation(pose, bone, angle))
      expect(recovered).toBeCloseTo(angle, 6)
    }
    setLocal(pose, 1, 3, 0)
    expect(() => worldToLocal(pose, 1, 0, 0)).toThrow('pose.worldToLocal: singular')
  })

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
        if (mode === 'noRotationOrReflection') return [3, 0, 0, 2] as const
        if (mode === 'noScale') return [0, 1, -1, 0] as const
        return [0, 1, -1, 0] as const // parent determinant is positive
      })()
      // An identity local transform exposes the mode's resulting world basis.
      expect(parent[0]).not.toBeNaN()
      expect(Math.abs(world[0]! - expectedLinear[0])).toBeLessThan(1e-6)
      expect(Math.abs(world[2]! - expectedLinear[2])).toBeLessThan(1e-6)
    }
  })

  it('uses the full parent matrix for translation in every inherit mode', () => {
    const modes = ['onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'] as const
    for (const mode of modes) {
      const sk = compileSkeleton({ name: mode, profile: 'full2d', bones: [
        { name: 'parent', parent: -1, length: 0, rest: { x: 5, y: -4, rotation: 0, scaleX: 2, scaleY: 3, shearX: 0, shearY: 0 } },
        { name: 'child', parent: 0, length: 0, inherit: mode, rest: { x: 1, y: 2, rotation: Math.PI / 4, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 } },
      ] })
      const pose = createPose(sk)
      updateWorld(pose)
      const child = getWorld(pose, 1)
      expect(child[4]).toBeCloseTo(7, 6)
      expect(child[5]).toBeCloseTo(2, 6)
      if (mode === 'noScale' || mode === 'noScaleOrReflection') {
        expect(child[0]).toBeCloseTo(2 / Math.sqrt(13), 6)
        expect(child[1]).toBeCloseTo(3 / Math.sqrt(13), 6)
        expect(child[2]).toBeCloseTo(-3 / Math.sqrt(13), 6)
        expect(child[3]).toBeCloseTo(2 / Math.sqrt(13), 6)
      }
    }
  })

  it('preserves reflection only for noScale', () => {
    for (const mode of ['noScale', 'noScaleOrReflection'] as const) {
      const sk = compileSkeleton({ name: mode, profile: 'full2d', bones: [
        { name: 'parent', parent: -1, length: 0, rest: { x: 0, y: 0, rotation: 0, scaleX: -2, scaleY: 3, shearX: 0, shearY: 0 } },
        { name: 'child', parent: 0, length: 0, inherit: mode },
      ] })
      const pose = createPose(sk)
      updateWorld(pose)
      expect(Math.sign(detAffine(getWorld(pose, 1)))).toBe(mode === 'noScale' ? -1 : 1)
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
