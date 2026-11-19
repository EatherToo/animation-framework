import { describe, expect, it } from '@jest/globals'
import { createPartSetBuilder as fromRoot } from '@/index'
import * as part from '@/part'
import { addRigid } from '@/part/rigid'
import {
  MAX_PARTS,
  PART_NONE,
  createPartSetBuilder,
  findPart,
  finishPartSet,
  partAt,
  partCount,
  type Fill,
  type PartSetBuilder,
} from '@/part/set'
import {
  PARENT_NONE,
  addBone,
  createSkeletonBuilder,
  finishSkeleton,
  type Skeleton,
} from '@/skeleton/skeleton'

const FILL: Fill = { r: 0.2, g: 0.4, b: 0.6 }

function oneBone(): Skeleton {
  const builder = createSkeletonBuilder()
  addBone(builder, {
    name: 'root',
    parent: PARENT_NONE,
    translationX: 0,
    translationY: 0,
    translationZ: 0,
    rotation: 0,
    length: 1,
  })
  return finishSkeleton(builder)
}

function rigid(
  builder: PartSetBuilder,
  id: string,
  fill: Fill = FILL,
  bone = 0,
): number {
  return addRigid(builder, {
    id,
    bone,
    translationX: 0,
    translationY: 0,
    rotation: 0,
    fill,
  })
}

describe('set', () => {
  it('从 part 入口与引擎入口再导出', () => {
    expect(part.createPartSetBuilder).toBe(createPartSetBuilder)
    expect(part.finishPartSet).toBe(finishPartSet)
    expect(part.partAt).toBe(partAt)
    expect(part.findPart).toBe(findPart)
    expect(part.PART_NONE).toBe(PART_NONE)
    expect(part.MAX_PARTS).toBe(MAX_PARTS)
    expect(fromRoot).toBe(createPartSetBuilder)
  })

  it('空集合拒绝完成', () => {
    const builder = createPartSetBuilder(oneBone())
    expect(() => finishPartSet(builder)).toThrow(/^empty part set$/)
    expect(builder.finished).toBe(false)
  })

  it('空 id 拒绝且不追加', () => {
    const builder = createPartSetBuilder(oneBone())
    expect(() => rigid(builder, '')).toThrow(/^id$/)
    expect(builder.parts).toHaveLength(0)
  })

  it('重复 id 拒绝，大小写不同则可以并存', () => {
    const builder = createPartSetBuilder(oneBone())
    rigid(builder, 'Hat')
    expect(() => rigid(builder, 'Hat')).toThrow(/^duplicate part id$/)
    expect(builder.parts).toHaveLength(1)
    expect(rigid(builder, 'hat')).toBe(1)
    expect(builder.parts).toHaveLength(2)
  })

  it('非法纯色拒绝且不追加', () => {
    const skeleton = oneBone()
    for (const fill of [
      { r: Number.NaN, g: 0, b: 0 },
      { r: -0.1, g: 0, b: 0 },
      { r: 0, g: 1.1, b: 0 },
      { r: 0, g: 0, b: Number.POSITIVE_INFINITY },
    ]) {
      const builder = createPartSetBuilder(skeleton)
      expect(() => rigid(builder, 'a', fill)).toThrow(/^fill$/)
      expect(builder.parts).toHaveLength(0)
    }
  })

  it('超过上限后拒绝', () => {
    const builder = createPartSetBuilder(oneBone())
    for (let i = 0; i < MAX_PARTS; i += 1) rigid(builder, `p${i}`)
    expect(builder.parts).toHaveLength(MAX_PARTS)
    expect(() => rigid(builder, 'overflow')).toThrow(/^too many parts$/)
    expect(builder.parts).toHaveLength(MAX_PARTS)
  })

  it('完成后不可再追加或再次完成，集合复制列表并保留骨架引用', () => {
    const skeleton = oneBone()
    const builder = createPartSetBuilder(skeleton)
    rigid(builder, 'head')
    const set = finishPartSet(builder)
    expect(set.skeleton).toBe(skeleton)
    expect(set.parts).not.toBe(builder.parts)
    expect(set.parts[0]).toBe(builder.parts[0])
    expect(() => rigid(builder, 'hand')).toThrow(/^part set already finished$/)
    expect(() => finishPartSet(builder)).toThrow(/^part set already finished$/)
    expect(builder.parts).toHaveLength(1)
    expect(partCount(set)).toBe(1)
  })

  it('按 id 查找，越界下标抛出', () => {
    const builder = createPartSetBuilder(oneBone())
    rigid(builder, 'head')
    rigid(builder, 'hand')
    const set = finishPartSet(builder)
    expect(findPart(set, 'hand')).toBe(1)
    expect(findPart(set, 'Hand')).toBe(PART_NONE)
    expect(findPart(set, 'missing')).toBe(PART_NONE)
    expect(() => partAt(set, -1)).toThrow(/^part$/)
    expect(() => partAt(set, 1.5)).toThrow(/^part$/)
    expect(() => partAt(set, 2)).toThrow(/^part$/)
  })

  it('纯色是副本，三分量按位相同，重复读取是同一对象', () => {
    const source: Fill = { r: 0.2, g: 0.4, b: 0.6 }
    const builder = createPartSetBuilder(oneBone())
    rigid(builder, 'head', source)
    const set = finishPartSet(builder)
    const part = partAt(set, 0)
    expect(partAt(set, 0)).toBe(part)
    expect(part.fill).not.toBe(source)
    expect(Object.is(part.fill.r, source.r)).toBe(true)
    expect(Object.is(part.fill.g, source.g)).toBe(true)
    expect(Object.is(part.fill.b, source.b)).toBe(true)
  })
})
