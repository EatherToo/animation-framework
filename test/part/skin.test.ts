import { describe, expect, it } from '@jest/globals'
import * as part from '@/part'
import { addSkinned } from '@/part/skin'
import { createPartSetBuilder, finishPartSet, partAt } from '@/part/set'
import {
  PARENT_NONE,
  addBone,
  createSkeletonBuilder,
  finishSkeleton,
  type Skeleton,
} from '@/skeleton/skeleton'

const FILL = { r: 0, g: 0, b: 0 }

function chain(): Skeleton {
  const builder = createSkeletonBuilder()
  addBone(builder, {
    name: 'root',
    parent: PARENT_NONE,
    translationX: 0,
    translationY: 0,
    rotation: 0,
    length: 1,
  })
  addBone(builder, {
    name: 'mid',
    parent: 0,
    translationX: 1,
    translationY: 0,
    rotation: 0,
    length: 1,
  })
  addBone(builder, {
    name: 'end',
    parent: 1,
    translationX: 1,
    translationY: 0,
    rotation: 0,
    length: 1,
  })
  addBone(builder, {
    name: 'side',
    parent: 0,
    translationX: 0,
    translationY: 1,
    rotation: 0,
    length: 1,
  })
  return finishSkeleton(builder)
}

describe('skin', () => {
  it('从 part 入口再导出', () => {
    expect(part.addSkinned).toBe(addSkinned)
  })

  it('沿父子链从近端到远端，并复制骨头列表', () => {
    const bones = [0, 1, 2]
    const builder = createPartSetBuilder(chain())
    addSkinned(builder, { id: 'limb', bones, fill: FILL })
    bones[0] = 9
    const set = finishPartSet(builder)
    const stored = partAt(set, 0)
    if (stored.kind !== 'skinned') throw new Error('kind')
    expect(stored.bones).not.toBe(bones)
    expect(stored.bones).toEqual([0, 1, 2])
    expect(Object.is(stored.bones[0], 0)).toBe(true)
    expect(Object.is(stored.bones[1], 1)).toBe(true)
    expect(Object.is(stored.bones[2], 2)).toBe(true)
  })

  it('链可以从非根开始', () => {
    const builder = createPartSetBuilder(chain())
    addSkinned(builder, { id: 'fore', bones: [1, 2], fill: FILL })
    const stored = partAt(finishPartSet(builder), 0)
    if (stored.kind !== 'skinned') throw new Error('kind')
    expect(stored.bones).toEqual([1, 2])
  })

  it('过短、跳骨、逆序、分叉、重复或越界时不追加', () => {
    const sk = chain()
    const samples: readonly (readonly number[])[] = [
      [],
      [0],
      [0, 2],
      [2, 1],
      [0, 1, 3],
      [0, 1, 1],
      [-1, 0],
      [0, sk.boneCount],
    ]
    for (const bones of samples) {
      const builder = createPartSetBuilder(sk)
      expect(() => addSkinned(builder, { id: 'limb', bones, fill: FILL })).toThrow(/^bones$/)
      expect(builder.parts).toHaveLength(0)
    }
  })
})
