import { describe, expect, it } from '@jest/globals'
import { createVec2 } from '@/math/vec2'
import * as skeleton from '@/skeleton'
import {
  PARENT_NONE,
  MAX_BONES,
  addBone,
  bindLength,
  bindRotation,
  bindTranslation,
  boneName,
  createSkeletonBuilder,
  findBone,
  finishSkeleton,
  parentOf,
  type BoneSpec,
  type SkeletonBuilder,
} from '@/skeleton/skeleton'
import { expectClose, expectSameBits } from '../math/assert'

function exampleChain(builder: SkeletonBuilder = createSkeletonBuilder()) {
  addBone(builder, {
    name: 'pelvis',
    parent: PARENT_NONE,
    translationX: 0,
    translationY: 1,
    rotation: 0,
    length: 0.2,
  })
  addBone(builder, {
    name: 'thigh',
    parent: 0,
    translationX: 0,
    translationY: -0.05,
    rotation: -Math.PI / 2,
    length: 0.45,
  })
  addBone(builder, {
    name: 'shin',
    parent: 1,
    translationX: 0.45,
    translationY: 0,
    rotation: 0,
    length: 0.45,
  })
  return builder
}

function bone(
  name: string,
  parent: number,
  tx = 0,
  ty = 0,
  rotation = 0,
  length = 0,
): BoneSpec {
  return {
    name,
    parent,
    translationX: tx,
    translationY: ty,
    rotation,
    length,
  }
}

describe('skeleton', () => {
  it('从 skeleton 入口再导出', () => {
    expect(skeleton.createSkeletonBuilder).toBe(createSkeletonBuilder)
    expect(skeleton.addBone).toBe(addBone)
    expect(skeleton.finishSkeleton).toBe(finishSkeleton)
    expect(skeleton.parentOf).toBe(parentOf)
    expect(skeleton.findBone).toBe(findBone)
    expect(skeleton.PARENT_NONE).toBe(PARENT_NONE)
    expect(skeleton.MAX_BONES).toBe(MAX_BONES)
  })

  it('示例链：拓扑、名字查找与绑定分量', () => {
    const sk = finishSkeleton(exampleChain())
    expect(sk.boneCount).toBe(3)
    expect(parentOf(sk, 0)).toBe(PARENT_NONE)
    expect(parentOf(sk, 1)).toBe(0)
    expect(parentOf(sk, 2)).toBe(1)
    expect(boneName(sk, 0)).toBe('pelvis')
    expect(findBone(sk, 'shin')).toBe(2)
    expect(findBone(sk, 'Shin')).toBe(PARENT_NONE)
    expect(findBone(sk, 'unknown')).toBe(PARENT_NONE)

    const out = createVec2()
    expectClose(bindTranslation(out, sk, 1)[0]!, 0)
    expectClose(out[1]!, -0.05)
    expectClose(bindTranslation(out, sk, 2)[0]!, 0.45)
    expectClose(out[1]!, 0)
    expectClose(bindLength(sk, 0), 0.2)
  })

  it('空建造器与完成后的非法操作抛出', () => {
    const empty = createSkeletonBuilder()
    expect(() => finishSkeleton(empty)).toThrow()

    const builder = exampleChain()
    finishSkeleton(builder)
    expect(() => finishSkeleton(builder)).toThrow()
    expect(() => addBone(builder, bone('extra', 0))).toThrow()
  })

  it('非法 parent 抛出', () => {
    expect(() =>
      addBone(createSkeletonBuilder(), bone('root', 0)),
    ).toThrow()

    const builder = createSkeletonBuilder()
    addBone(builder, bone('root', PARENT_NONE))
    expect(() => addBone(builder, bone('a', PARENT_NONE))).toThrow()
    expect(() => addBone(builder, bone('b', 1))).toThrow()
    expect(() => addBone(builder, bone('c', 1.5))).toThrow()
    expect(() => addBone(builder, bone('d', Number.NaN))).toThrow()
    expect(builder.count).toBe(1)
  })

  it('非法名字与绑定抛出且不增加 count', () => {
    const builder = createSkeletonBuilder()
    addBone(builder, bone('root', PARENT_NONE))

    expect(() =>
      addBone(builder, { ...bone('ok', 0), name: '' }),
    ).toThrow()
    expect(() => addBone(builder, bone('root', 0))).toThrow()
    expect(() =>
      addBone(builder, { ...bone('a', 0), translationX: Number.NaN }),
    ).toThrow()
    expect(() =>
      addBone(builder, { ...bone('b', 0), rotation: Number.POSITIVE_INFINITY }),
    ).toThrow()
    expect(() =>
      addBone(builder, { ...bone('c', 0), length: -1 }),
    ).toThrow()
    expect(() =>
      addBone(builder, { ...bone('d', 0), length: Number.NaN }),
    ).toThrow()
    expect(builder.count).toBe(1)
  })

  it('加满 MAX_BONES 后下一根抛出', () => {
    const builder = createSkeletonBuilder()
    addBone(builder, bone('root', PARENT_NONE))
    for (let i = 1; i < MAX_BONES; i += 1) {
      addBone(builder, bone(`b${i}`, 0))
    }
    expect(builder.count).toBe(MAX_BONES)
    expect(() => addBone(builder, bone('overflow', 0))).toThrow()
    const sk = finishSkeleton(builder)
    expect(sk.boneCount).toBe(MAX_BONES)
    expect(parentOf(sk, MAX_BONES - 1)).toBe(0)
  })

  it('绑定旋转折角进 float32；length -0 存成 0', () => {
    const builder = createSkeletonBuilder()
    addBone(builder, {
      name: 'a',
      parent: PARENT_NONE,
      translationX: 0,
      translationY: 0,
      rotation: 3 * Math.PI,
      length: 0,
    })
    addBone(builder, {
      name: 'b',
      parent: 0,
      translationX: 0,
      translationY: 0,
      rotation: -Math.PI,
      length: -0,
    })
    const sk = finishSkeleton(builder)
    expect(Object.is(bindRotation(sk, 0), Math.fround(Math.PI))).toBe(true)
    expect(Object.is(bindRotation(sk, 1), Math.fround(Math.PI))).toBe(true)
    expect(Object.is(bindLength(sk, 1), 0)).toBe(true)
  })

  it('不要求子平移等于 (父长度, 0)', () => {
    const sk = finishSkeleton(exampleChain())
    const out = createVec2()
    bindTranslation(out, sk, 1)
    expectClose(out[0]!, 0)
    expectClose(out[1]!, -0.05)
    expectClose(bindLength(sk, 0), 0.2)
  })

  it('bindTranslation 写回同一 out', () => {
    const sk = finishSkeleton(exampleChain())
    const out = createVec2()
    const returned = bindTranslation(out, sk, 0)
    expect(returned).toBe(out)
    expectSameBits(out, new Float32Array([0, 1]))
  })
})
