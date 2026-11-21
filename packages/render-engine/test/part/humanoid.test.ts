import { describe, expect, it } from '@jest/globals'
import { BONE_NAMES, createHumanoid, type BoneId } from '@/body/assemble'
import * as part from '@/part'
import {
  HUMANOID_FILL,
  HUMANOID_PART_COUNT,
  HUMANOID_PART_IDS,
  appendHumanoidParts,
  createHumanoidParts,
  type HumanoidPartId,
} from '@/part/humanoid'
import { addRigid } from '@/part/rigid'
import { createPartSetBuilder, partAt, partCount, type Part } from '@/part/set'
import {
  PARENT_NONE,
  addBone,
  createSkeletonBuilder,
  findBone,
  finishSkeleton,
  type BoneSpec,
  type Skeleton,
} from '@/skeleton/skeleton'

const FILL = { r: 0, g: 0, b: 0 }

const EXPECTED: readonly {
  id: HumanoidPartId
  kind: Part['kind']
  bones: readonly string[]
}[] = [
  { id: 'torso', kind: 'skinned', bones: ['pelvis', 'spine', 'chest', 'neck', 'head'] },
  { id: 'head', kind: 'rigid', bones: ['head'] },
  { id: 'armL', kind: 'skinned', bones: ['chest', 'clavicleL', 'upperArmL', 'lowerArmL', 'handL'] },
  { id: 'handL', kind: 'rigid', bones: ['handL'] },
  { id: 'armR', kind: 'skinned', bones: ['chest', 'clavicleR', 'upperArmR', 'lowerArmR', 'handR'] },
  { id: 'handR', kind: 'rigid', bones: ['handR'] },
  { id: 'legL', kind: 'skinned', bones: ['pelvis', 'thighL', 'shinL', 'footL'] },
  { id: 'footL', kind: 'rigid', bones: ['footL'] },
  { id: 'legR', kind: 'skinned', bones: ['pelvis', 'thighR', 'shinR', 'footR'] },
  { id: 'footR', kind: 'rigid', bones: ['footR'] },
]

/** 整段体积只属于主部件；这些骨头还可以再出现在邻件链端。 */
const SHARED_BONE_COUNT: Readonly<Record<BoneId, number>> = {
  pelvis: 3,
  spine: 1,
  chest: 3,
  clavicleL: 1,
  clavicleR: 1,
  neck: 1,
  head: 2,
  upperArmL: 1,
  lowerArmL: 1,
  handL: 2,
  upperArmR: 1,
  lowerArmR: 1,
  handR: 2,
  thighL: 1,
  shinL: 1,
  footL: 2,
  thighR: 1,
  shinR: 1,
  footR: 2,
}

function bone(name: string, parent: number): BoneSpec {
  return {
    name,
    parent,
    translationX: 0,
    translationY: 0,
    translationZ: 0,
    rotation: 0,
    length: 0.1,
  }
}

/** 19 个名字都在，但前臂不挂在上臂上。 */
function brokenForearm(): Skeleton {
  const builder = createSkeletonBuilder()
  const parentOf: Record<BoneId, BoneId | null> = {
    pelvis: null,
    spine: 'pelvis',
    chest: 'spine',
    clavicleL: 'chest',
    clavicleR: 'chest',
    neck: 'chest',
    head: 'neck',
    upperArmL: 'clavicleL',
    lowerArmL: 'chest',
    handL: 'lowerArmL',
    upperArmR: 'clavicleR',
    lowerArmR: 'upperArmR',
    handR: 'lowerArmR',
    thighL: 'pelvis',
    shinL: 'thighL',
    footL: 'shinL',
    thighR: 'pelvis',
    shinR: 'thighR',
    footR: 'shinR',
  }
  const index = new Map<string, number>()
  for (const name of BONE_NAMES) {
    const parentName = parentOf[name]
    const parent = parentName === null ? PARENT_NONE : index.get(parentName)!
    index.set(name, addBone(builder, bone(name, parent)))
  }
  return finishSkeleton(builder)
}

/** 其余名字都在，唯独没有颈。 */
function missingNeck(): Skeleton {
  const builder = createSkeletonBuilder()
  const names = BONE_NAMES.filter((name) => name !== 'neck')
  const parentOf: Record<string, string | null> = {
    pelvis: null,
    spine: 'pelvis',
    chest: 'spine',
    head: 'chest',
    clavicleL: 'chest',
    clavicleR: 'chest',
    upperArmL: 'clavicleL',
    lowerArmL: 'upperArmL',
    handL: 'lowerArmL',
    upperArmR: 'clavicleR',
    lowerArmR: 'upperArmR',
    handR: 'lowerArmR',
    thighL: 'pelvis',
    shinL: 'thighL',
    footL: 'shinL',
    thighR: 'pelvis',
    shinR: 'thighR',
    footR: 'shinR',
  }
  const index = new Map<string, number>()
  for (const name of names) {
    const parentName = parentOf[name]
    const parent = parentName == null ? PARENT_NONE : index.get(parentName)!
    index.set(name, addBone(builder, bone(name, parent)))
  }
  return finishSkeleton(builder)
}

describe('humanoid', () => {
  it('从 part 入口再导出', () => {
    expect(part.createHumanoidParts).toBe(createHumanoidParts)
    expect(part.appendHumanoidParts).toBe(appendHumanoidParts)
    expect(part.HUMANOID_PART_COUNT).toBe(HUMANOID_PART_COUNT)
    expect(part.HUMANOID_PART_IDS).toBe(HUMANOID_PART_IDS)
    expect(part.HUMANOID_FILL).toBe(HUMANOID_FILL)
  })

  it('10 件按登记顺序覆盖 19 根骨头，整段体积只出现一次', () => {
    const skeleton = createHumanoid(1.7).skeleton
    const set = createHumanoidParts(skeleton)
    expect(set.skeleton).toBe(skeleton)
    expect(partCount(set)).toBe(10)
    expect(HUMANOID_PART_IDS).toHaveLength(HUMANOID_PART_COUNT)

    const seen = new Map<number, number>()
    for (let i = 0; i < EXPECTED.length; i += 1) {
      const want = EXPECTED[i]!
      const stored = partAt(set, i)
      expect(stored.id).toBe(want.id)
      expect(HUMANOID_PART_IDS[i]).toBe(want.id)
      expect(stored.kind).toBe(want.kind)
      const fill = HUMANOID_FILL[want.id]
      expect(Object.is(stored.fill.r, fill.r)).toBe(true)
      expect(Object.is(stored.fill.g, fill.g)).toBe(true)
      expect(Object.is(stored.fill.b, fill.b)).toBe(true)

      const indices = want.bones.map((name) => findBone(skeleton, name))
      if (stored.kind === 'rigid') {
        expect(stored.translationX).toBe(0)
        expect(stored.translationY).toBe(0)
        expect(stored.rotation).toBe(0)
        expect(stored.bone).toBe(indices[0])
        seen.set(stored.bone, (seen.get(stored.bone) ?? 0) + 1)
      } else {
        expect(stored.bones).toEqual(indices)
        for (const bone of stored.bones) {
          seen.set(bone, (seen.get(bone) ?? 0) + 1)
        }
      }
    }

    expect(seen.size).toBe(BONE_NAMES.length)
    for (const name of BONE_NAMES) {
      expect(seen.get(findBone(skeleton, name))).toBe(SHARED_BONE_COUNT[name])
    }

    const armL = partAt(set, 2)
    const legL = partAt(set, 6)
    const torso = partAt(set, 0)
    const head = partAt(set, 1)
    if (armL.kind !== 'skinned' || legL.kind !== 'skinned' || torso.kind !== 'skinned') {
      throw new Error('kind')
    }
    if (head.kind !== 'rigid') throw new Error('kind')
    expect(armL.bones).toEqual([
      findBone(skeleton, 'chest'),
      findBone(skeleton, 'clavicleL'),
      findBone(skeleton, 'upperArmL'),
      findBone(skeleton, 'lowerArmL'),
      findBone(skeleton, 'handL'),
    ])
    expect(legL.bones).toEqual([
      findBone(skeleton, 'pelvis'),
      findBone(skeleton, 'thighL'),
      findBone(skeleton, 'shinL'),
      findBone(skeleton, 'footL'),
    ])
    expect(torso.bones).toEqual([
      findBone(skeleton, 'pelvis'),
      findBone(skeleton, 'spine'),
      findBone(skeleton, 'chest'),
      findBone(skeleton, 'neck'),
      findBone(skeleton, 'head'),
    ])
    expect(head.bone).toBe(findBone(skeleton, 'head'))
  })

  it('两次创建的字段按位相同，集合不是同一引用', () => {
    const skeleton = createHumanoid(1.7).skeleton
    const a = createHumanoidParts(skeleton)
    const b = createHumanoidParts(skeleton)
    expect(a).not.toBe(b)
    expect(a.parts).not.toBe(b.parts)
    for (let i = 0; i < HUMANOID_PART_COUNT; i += 1) {
      const left = a.parts[i]!
      const right = b.parts[i]!
      expect(Object.is(left.id, right.id)).toBe(true)
      expect(Object.is(left.fill.r, right.fill.r)).toBe(true)
      expect(Object.is(left.fill.g, right.fill.g)).toBe(true)
      expect(Object.is(left.fill.b, right.fill.b)).toBe(true)
      if (left.kind === 'rigid' && right.kind === 'rigid') {
        expect(Object.is(left.bone, right.bone)).toBe(true)
        expect(Object.is(left.translationX, right.translationX)).toBe(true)
        expect(Object.is(left.translationY, right.translationY)).toBe(true)
        expect(Object.is(left.rotation, right.rotation)).toBe(true)
      } else if (left.kind === 'skinned' && right.kind === 'skinned') {
        expect(left.bones.length).toBe(right.bones.length)
        for (let n = 0; n < left.bones.length; n += 1) {
          expect(Object.is(left.bones[n], right.bones[n])).toBe(true)
        }
      } else {
        throw new Error('kind')
      }
    }
  })

  it('缺骨头时一件都不追加', () => {
    const skeleton = missingNeck()
    const builder = createPartSetBuilder(skeleton)
    addRigid(builder, {
      id: 'hat',
      bone: 0,
      translationX: 0,
      translationY: 0,
      rotation: 0,
      fill: FILL,
    })
    expect(() => appendHumanoidParts(builder, skeleton)).toThrow(/^bone$/)
    expect(builder.parts).toHaveLength(1)
    expect(builder.parts[0]!.id).toBe('hat')
  })

  it('前臂不挂在上臂上时一件都不追加', () => {
    const skeleton = brokenForearm()
    const builder = createPartSetBuilder(skeleton)
    addRigid(builder, {
      id: 'hat',
      bone: 0,
      translationX: 0,
      translationY: 0,
      rotation: 0,
      fill: FILL,
    })
    expect(() => appendHumanoidParts(builder, skeleton)).toThrow(/^bones$/)
    expect(builder.parts).toHaveLength(1)
    expect(builder.parts[0]!.id).toBe('hat')
  })

  it('id 冲突时保留原零件，不追加人形部件', () => {
    const skeleton = createHumanoid(1.7).skeleton
    const builder = createPartSetBuilder(skeleton)
    addRigid(builder, {
      id: 'head',
      bone: findBone(skeleton, 'head'),
      translationX: 0.1,
      translationY: 0,
      rotation: 0,
      fill: FILL,
    })
    expect(() => appendHumanoidParts(builder, skeleton)).toThrow(/^duplicate part id$/)
    expect(builder.parts).toHaveLength(1)
    expect(builder.parts[0]!.id).toBe('head')
    if (builder.parts[0]!.kind !== 'rigid') throw new Error('kind')
    expect(builder.parts[0]!.translationX).toBe(0.1)
  })

  it('另一棵骨架即使名字齐全也拒绝', () => {
    const skeleton = createHumanoid(1.7).skeleton
    const other = createHumanoid(1.7).skeleton
    const builder = createPartSetBuilder(skeleton)
    expect(() => appendHumanoidParts(builder, other)).toThrow(/^skeleton$/)
    expect(builder.parts).toHaveLength(0)
  })
})
