import { describe, expect, it } from '@jest/globals'
import { composeTRS, createMat3, createVec2, normalizeAngle, setVec2 } from '@/math'
import * as part from '@/part'
import { addSkinned } from '@/part/skin'
import { addRigid, setBoneFromPart } from '@/part/rigid'
import { createPartSetBuilder, finishPartSet, partAt } from '@/part/set'
import {
  PARENT_NONE,
  addBone,
  createSkeletonBuilder,
  finishSkeleton,
} from '@/skeleton/skeleton'
import { expectSameBits } from '../math/assert'

const FILL = { r: 1, g: 1, b: 1 }

function skeleton() {
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
    name: 'child',
    parent: 0,
    translationX: 1,
    translationY: 0,
    rotation: 0,
    length: 1,
  })
  return finishSkeleton(builder)
}

describe('rigid', () => {
  it('从 part 入口再导出', () => {
    expect(part.addRigid).toBe(addRigid)
    expect(part.setBoneFromPart).toBe(setBoneFromPart)
  })

  it('骨头下标非法时不追加', () => {
    const sk = skeleton()
    for (const bone of [-1, 1.5, sk.boneCount]) {
      const builder = createPartSetBuilder(sk)
      expect(() =>
        addRigid(builder, {
          id: 'hat',
          bone,
          translationX: 0,
          translationY: 0,
          rotation: 0,
          fill: FILL,
        }),
      ).toThrow(/^bone$/)
      expect(builder.parts).toHaveLength(0)
    }
  })

  it('平移或旋转非有限时不追加', () => {
    const builder = createPartSetBuilder(skeleton())
    expect(() =>
      addRigid(builder, {
        id: 'hat',
        bone: 0,
        translationX: Number.NaN,
        translationY: 0,
        rotation: 0,
        fill: FILL,
      }),
    ).toThrow(/^translation$/)
    expect(() =>
      addRigid(builder, {
        id: 'hat',
        bone: 0,
        translationX: 0,
        translationY: Number.POSITIVE_INFINITY,
        rotation: 0,
        fill: FILL,
      }),
    ).toThrow(/^translation$/)
    expect(() =>
      addRigid(builder, {
        id: 'hat',
        bone: 0,
        translationX: 0,
        translationY: 0,
        rotation: Number.NaN,
        fill: FILL,
      }),
    ).toThrow(/^rotation$/)
    expect(builder.parts).toHaveLength(0)
  })

  it('旋转折到 (-π, π]，±π 都得到 +π', () => {
    const builder = createPartSetBuilder(skeleton())
    addRigid(builder, {
      id: 'hat',
      bone: 0,
      translationX: 0,
      translationY: 0,
      rotation: 3 * Math.PI,
      fill: FILL,
    })
    const set = finishPartSet(builder)
    const stored = partAt(set, 0)
    if (stored.kind !== 'rigid') throw new Error('kind')
    expect(stored.rotation).toBe(normalizeAngle(3 * Math.PI))
    expect(stored.rotation).toBe(Math.PI)
    expect(normalizeAngle(-Math.PI)).toBe(Math.PI)
  })

  it('零平移零旋转写出单位矩阵', () => {
    const builder = createPartSetBuilder(skeleton())
    addRigid(builder, {
      id: 'head',
      bone: 0,
      translationX: 0,
      translationY: 0,
      rotation: 0,
      fill: FILL,
    })
    const out = createMat3()
    const expected = createMat3()
    setBoneFromPart(out, partAt(finishPartSet(builder), 0))
    composeTRS(expected, setVec2(createVec2(), 0, 0), 0, setVec2(createVec2(), 1, 1))
    expectSameBits(out, expected)
    expect(out[0]).toBe(1)
    expect(out[4]).toBe(1)
    expect(out[6]).toBe(0)
    expect(out[7]).toBe(0)
    expect(out[8]).toBe(1)
  })

  it('局部变换与 composeTRS 按位相同', () => {
    const builder = createPartSetBuilder(skeleton())
    addRigid(builder, {
      id: 'hat',
      bone: 1,
      translationX: 0.2,
      translationY: -0.1,
      rotation: 0.4,
      fill: FILL,
    })
    const out = createMat3()
    const expected = createMat3()
    setBoneFromPart(out, partAt(finishPartSet(builder), 0))
    composeTRS(
      expected,
      setVec2(createVec2(), 0.2, -0.1),
      0.4,
      setVec2(createVec2(), 1, 1),
    )
    expectSameBits(out, expected)
  })

  it('蒙皮部件不写矩阵', () => {
    const builder = createPartSetBuilder(skeleton())
    addSkinned(builder, { id: 'arm', bones: [0, 1], fill: FILL })
    const out = createMat3()
    for (let i = 0; i < 9; i += 1) out[i] = 7
    const before = Array.from(out)
    expect(() => setBoneFromPart(out, partAt(finishPartSet(builder), 0))).toThrow(/^kind$/)
    expectSameBits(out, before)
  })
})
