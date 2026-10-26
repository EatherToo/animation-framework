import { describe, expect, it } from '@jest/globals'
import {
  composeTRS,
  createMat3,
  determinantMat3,
  transformPoint,
} from '@/math/mat3'
import { createVec2, setVec2 } from '@/math/vec2'
import * as skeleton from '@/skeleton'
import {
  PARENT_NONE,
  addBone,
  createSkeletonBuilder,
  finishSkeleton,
  type Skeleton,
} from '@/skeleton/skeleton'
import {
  createPose,
  setPoseRotation,
  setPoseTranslation,
  type Pose,
} from '@/skeleton/pose'
import {
  setBindParentFromBone,
  setParentFromBone,
} from '@/skeleton/parent-from-bone'
import { expectClose, expectCloseArray, expectSameBits } from '../math/assert'

function singleBone(
  tx: number,
  ty: number,
  rotation: number,
  length = 0.45,
): Skeleton {
  const builder = createSkeletonBuilder()
  addBone(builder, {
    name: 'bone',
    parent: PARENT_NONE,
    translationX: tx,
    translationY: ty,
    rotation,
    length,
  })
  return finishSkeleton(builder)
}

function exampleChain(): Skeleton {
  const builder = createSkeletonBuilder()
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
  return finishSkeleton(builder)
}

function scaleOne() {
  return setVec2(createVec2(), 1, 1)
}

describe('parent-from-bone', () => {
  it('从 skeleton 入口再导出', () => {
    expect(skeleton.setParentFromBone).toBe(setParentFromBone)
    expect(skeleton.setBindParentFromBone).toBe(setBindParentFromBone)
  })

  it('零偏移即绑定，且与 composeTRS 一致', () => {
    const sk = singleBone(0.4, -0.2, Math.PI / 2)
    const pose = createPose(sk)
    const fromPose = setParentFromBone(createMat3(), sk, pose, 0)
    const fromBind = setBindParentFromBone(createMat3(), sk, 0)
    expectSameBits(fromPose, fromBind)

    const expected = composeTRS(
      createMat3(),
      setVec2(createVec2(), 0.4, -0.2),
      Math.PI / 2,
      scaleOne(),
    )
    expectCloseArray(fromPose, expected)
  })

  it('绕枢轴旋转', () => {
    const sk = singleBone(2, 3, 0)
    const pose = createPose(sk)
    setPoseRotation(pose, 0, Math.PI / 2)
    const m = setParentFromBone(createMat3(), sk, pose, 0)
    const out = createVec2()
    transformPoint(out, setVec2(createVec2(), 0, 0), m)
    expectCloseArray(out, [2, 3])
    transformPoint(out, setVec2(createVec2(), 1, 0), m)
    expectCloseArray(out, [2, 4])
  })

  it('平移沿绑定轴', () => {
    const sk = singleBone(0, 1, -Math.PI / 2)
    const pose = createPose(sk)
    setPoseTranslation(pose, 0, 0.2, 0)
    const m = setParentFromBone(createMat3(), sk, pose, 0)
    const out = createVec2()
    transformPoint(out, setVec2(createVec2(), 0, 0), m)
    expectCloseArray(out, [0, 0.8])
    transformPoint(out, setVec2(createVec2(), 1, 0), m)
    expectCloseArray(out, [0, -0.2])
  })

  it('角相加', () => {
    const sk = singleBone(0, 0, Math.PI / 6)
    const pose = createPose(sk)
    setPoseRotation(pose, 0, Math.PI / 6)
    const m = setParentFromBone(createMat3(), sk, pose, 0)
    const expected = composeTRS(
      createMat3(),
      setVec2(createVec2(), 0, 0),
      Math.PI / 3,
      scaleOne(),
    )
    expectCloseArray(m, expected)
    const out = createVec2()
    transformPoint(out, setVec2(createVec2(), 1, 0), m)
    expectCloseArray(out, [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)])
  })

  it('平移方向不吃偏移旋转', () => {
    const sk = singleBone(0, 1, 0)
    const pose = createPose(sk)
    setPoseTranslation(pose, 0, 0, -0.1)
    setPoseRotation(pose, 0, 0.2)
    const m = setParentFromBone(createMat3(), sk, pose, 0)
    const pivot = transformPoint(createVec2(), setVec2(createVec2(), 0, 0), m)
    expectCloseArray(pivot, [0, 0.9])

    const linear = composeTRS(
      createMat3(),
      setVec2(createVec2(), 0, 0),
      0.2,
      scaleOne(),
    )
    expectClose(m[0]!, linear[0]!)
    expectClose(m[1]!, linear[1]!)
    expectClose(m[3]!, linear[3]!)
    expectClose(m[4]!, linear[4]!)
  })

  it('行列式约为 +1', () => {
    const cases: Array<[Skeleton, Pose]> = []

    {
      const sk = singleBone(2, 3, 0)
      const pose = createPose(sk)
      setPoseRotation(pose, 0, Math.PI / 2)
      cases.push([sk, pose])
    }
    {
      const sk = singleBone(0, 1, -Math.PI / 2)
      const pose = createPose(sk)
      setPoseTranslation(pose, 0, 0.2, 0)
      cases.push([sk, pose])
    }
    {
      const sk = singleBone(0, 0, Math.PI / 6)
      const pose = createPose(sk)
      setPoseRotation(pose, 0, Math.PI / 6)
      cases.push([sk, pose])
    }

    for (const [sk, pose] of cases) {
      const m = setParentFromBone(createMat3(), sk, pose, 0)
      expectClose(determinantMat3(m), 1)
    }
  })

  it('只改一根骨头的局部矩阵', () => {
    const sk = exampleChain()
    const pose = createPose(sk)
    const shinBefore = setParentFromBone(createMat3(), sk, pose, 2)
    const shinCopy = new Float32Array(shinBefore)
    const thighBefore = setParentFromBone(createMat3(), sk, pose, 1)

    setPoseRotation(pose, 1, Math.PI / 6)
    const shinAfter = setParentFromBone(createMat3(), sk, pose, 2)
    const thighAfter = setParentFromBone(createMat3(), sk, pose, 1)

    expectSameBits(shinAfter, shinCopy)
    expect(thighAfter[0]).not.toBe(thighBefore[0])
  })

  it('长度不参与矩阵', () => {
    const a = setBindParentFromBone(createMat3(), singleBone(0.1, 0.2, 0.3, 0), 0)
    const b = setBindParentFromBone(
      createMat3(),
      singleBone(0.1, 0.2, 0.3, 0.45),
      0,
    )
    expectSameBits(a, b)
  })

  it('固定输入两次调用按位相同', () => {
    const sk = singleBone(0.2, -0.1, Math.PI / 5)
    const pose = createPose(sk)
    setPoseTranslation(pose, 0, 0.05, -0.02)
    setPoseRotation(pose, 0, 0.4)
    const a = setParentFromBone(createMat3(), sk, pose, 0)
    const b = setParentFromBone(createMat3(), sk, pose, 0)
    expectSameBits(a, b)
  })
})
