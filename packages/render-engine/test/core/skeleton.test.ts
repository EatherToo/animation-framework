import { describe, expect, it } from '@jest/globals'
import {
  compileSkeleton,
  findBoneId,
  PROFILE_BONE_LIMITS,
  type BoneSpec,
} from '@/core/skeleton'

const bone = (name: string, parent: number, overrides: Partial<BoneSpec> = {}): BoneSpec => ({
  name, parent, length: 0.1, ...overrides,
})

describe('core2d skeleton compiler', () => {
  it('topologically sorts arbitrary input order and assigns id = index', () => {
    const compiled = compileSkeleton({
      name: 'mini', profile: 'simple2d',
      bones: [
        bone('hand', 1),
        bone('root', -1),
        bone('arm', 0),
      ],
    })
    expect(compiled.bones.map((b) => b.name)).toEqual(['root', 'hand', 'arm'])
    expect(Array.from(compiled.parent)).toEqual([-1, 0, 1])
    expect(compiled.boneIdByName.get('hand')).toBe(1)
    expect(compiled.children[0]).toEqual([1])
    expect(compiled.children[1]).toEqual([2])
    expect(compiled.roots).toEqual([0])
    expect(Array.from(compiled.setupLocal.slice(0, 7))).toEqual([0, 0, 0, 1, 1, 0, 0])
  })

  it('keeps rest/setup distinct and validates joint/yoke structure', () => {
    const compiled = compileSkeleton({
      name: 'yoke', profile: 'full2d',
      bones: [
        bone('root', -1),
        bone('yoke', 0, { joint: { dof: 2, min: -1, max: 1, rest: 0, bendSign: 1, yoke: 1 } }),
        bone('upperArm', 1, { joint: { dof: 1, min: -1, max: 1, rest: 0, bendSign: 1, yoke: null } }),
      ],
    })
    expect(compiled.bones[1]!.joint?.yoke).toBe(1)
    expect(compiled.bones[1]!.joint?.dof).toBe(2)
  })

  it('rejects duplicate names, bad parents, cycles and limit violations', () => {
    expect(() => compileSkeleton({ name: 'x', profile: 'simple2d', bones: [bone('a', -1), bone('a', 0)] })).toThrow()
    expect(() => compileSkeleton({ name: 'x', profile: 'simple2d', bones: [bone('a', 1), bone('b', 0)] })).toThrow()
    expect(() => compileSkeleton({ name: 'x', profile: 'simple2d', bones: [bone('a', 0)] })).toThrow()
    expect(() => compileSkeleton({ name: 'x', profile: 'simple2d', bones: [bone('a', -1), bone('b', 9)] })).toThrow()
    expect(() => compileSkeleton({
      name: 'x', profile: 'simple2d',
      bones: Array.from({ length: PROFILE_BONE_LIMITS.simple2d + 1 }, (_, i) => bone(`b${i}`, i === 0 ? -1 : i - 1)),
    })).toThrow()
  })

  it('rejects 2D bones carrying 3D swing/twist fields', () => {
    const spec = {
      name: 'bad', profile: 'simple2d' as const,
      bones: [bone('root', -1)],
    }
    expect(() => compileSkeleton(Object.assign({}, spec, { bones: [Object.assign(bone('root', -1), { swing: 0.2 })] }))).toThrow(/3d|swing|twist/i)
    expect(() => compileSkeleton(Object.assign({}, spec, { bones: [Object.assign(bone('root', -1), { twist: 0.2 })] }))).toThrow(/3d|swing|twist/i)
  })

  it('forbids fingers/yoke in simple2d but allows them in full2d', () => {
    expect(() => compileSkeleton({
      name: 'x', profile: 'simple2d',
      bones: [bone('root', -1), bone('finger', 0, { tags: ['finger'] })],
    })).toThrow(/profile/i)
    expect(() => compileSkeleton({
      name: 'x', profile: 'simple2d',
      bones: [bone('root', -1), bone('yoke', 0, { joint: { dof: 2, min: -1, max: 1, rest: 0, bendSign: 1, yoke: 1 } })],
    })).toThrow(/profile/i)
    expect(() => compileSkeleton({
      name: 'x', profile: 'full2d',
      bones: [bone('root', -1), bone('finger', 0, { tags: ['finger'] })],
    })).not.toThrow()
  })

  it('finds bones by name and returns -1 for unknown names', () => {
    const c = compileSkeleton({ name: 'x', profile: 'simple2d', bones: [bone('root', -1)] })
    expect(findBoneId(c, 'root')).toBe(0)
    expect(findBoneId(c, 'nope')).toBe(-1)
  })
})
