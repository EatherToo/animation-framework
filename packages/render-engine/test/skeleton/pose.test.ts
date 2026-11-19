import { describe, expect, it } from '@jest/globals'
import { createVec2 } from '@/math/vec2'
import * as skeleton from '@/skeleton'
import {
  PARENT_NONE,
  addBone,
  bindLength,
  bindRotation,
  bindTranslation,
  createSkeletonBuilder,
  finishSkeleton,
} from '@/skeleton/skeleton'
import {
  POSE_STRIDE,
  copyPose,
  createPose,
  poseRotation,
  poseTranslation,
  setPoseRotation,
  setPoseTranslation,
  zeroPose,
} from '@/skeleton/pose'
import { expectClose, expectSameBits } from '../math/assert'

function twoBoneSkeleton() {
  const builder = createSkeletonBuilder()
  addBone(builder, {
    name: 'root',
    parent: PARENT_NONE,
    translationX: 0.1,
    translationY: 0.2,
    translationZ: 0,
    rotation: 0.3,
    length: 0.4,
  })
  addBone(builder, {
    name: 'child',
    parent: 0,
    translationX: 0.5,
    translationY: 0,
    translationZ: 0,
    rotation: 0,
    length: 0.5,
  })
  return finishSkeleton(builder)
}

describe('pose', () => {
  it('从 skeleton 入口再导出', () => {
    expect(skeleton.createPose).toBe(createPose)
    expect(skeleton.setPoseTranslation).toBe(setPoseTranslation)
    expect(skeleton.setPoseRotation).toBe(setPoseRotation)
    expect(skeleton.zeroPose).toBe(zeroPose)
    expect(skeleton.copyPose).toBe(copyPose)
    expect(skeleton.POSE_STRIDE).toBe(POSE_STRIDE)
  })

  it('createPose：长度、全零、同一 skeleton 引用', () => {
    const sk = twoBoneSkeleton()
    const pose = createPose(sk)
    expect(pose.skeleton).toBe(sk)
    expect(pose.data.length).toBe(sk.boneCount * POSE_STRIDE)
    for (let i = 0; i < pose.data.length; i += 1) {
      expect(Object.is(pose.data[i], 0)).toBe(true)
    }
  })

  it('平移与旋转互不覆盖，且不改另一根骨头', () => {
    const sk = twoBoneSkeleton()
    const pose = createPose(sk)
    setPoseRotation(pose, 0, 0.7)
    setPoseTranslation(pose, 0, 1, 2)
    expectClose(poseRotation(pose, 0), 0.7)
    const t = createVec2()
    poseTranslation(t, pose, 0)
    expectSameBits(t, new Float32Array([1, 2]))

    setPoseRotation(pose, 0, -0.4)
    poseTranslation(t, pose, 0)
    expectSameBits(t, new Float32Array([1, 2]))
    expectClose(poseRotation(pose, 0), -0.4)

    expect(Object.is(pose.data[3], 0)).toBe(true)
    expect(Object.is(pose.data[4], 0)).toBe(true)
    expect(Object.is(pose.data[5], 0)).toBe(true)
  })

  it('setPoseRotation 折角；±π 读回按位相同', () => {
    const sk = twoBoneSkeleton()
    const pose = createPose(sk)
    setPoseRotation(pose, 0, 3 * Math.PI)
    expectClose(poseRotation(pose, 0), Math.PI)
    setPoseRotation(pose, 0, -3 * Math.PI)
    expectClose(poseRotation(pose, 0), Math.PI)

    setPoseRotation(pose, 0, Math.PI)
    const a = poseRotation(pose, 0)
    setPoseRotation(pose, 0, -Math.PI)
    const b = poseRotation(pose, 0)
    expect(Object.is(a, b)).toBe(true)
  })

  it('zeroPose 回到精确 0', () => {
    const sk = twoBoneSkeleton()
    const pose = createPose(sk)
    setPoseTranslation(pose, 0, 1, -2)
    setPoseRotation(pose, 1, 0.5)
    zeroPose(pose)
    for (let i = 0; i < pose.data.length; i += 1) {
      expect(Object.is(pose.data[i], 0)).toBe(true)
    }
  })

  it('两份 Pose 隔离；copyPose 逐分量按位相等', () => {
    const sk = twoBoneSkeleton()
    const a = createPose(sk)
    const b = createPose(sk)
    setPoseTranslation(a, 0, 3, 4)
    setPoseRotation(a, 1, 0.25)
    for (let i = 0; i < b.data.length; i += 1) {
      expect(Object.is(b.data[i], 0)).toBe(true)
    }

    setPoseTranslation(b, 0, 9, 8)
    setPoseRotation(b, 0, 1)
    const returned = copyPose(b, a)
    expect(returned).toBe(b)
    expectSameBits(b.data, a.data)
  })

  it('写偏移不改变绑定', () => {
    const sk = twoBoneSkeleton()
    const beforeT = new Float32Array(sk.bindTranslation)
    const beforeR = new Float32Array(sk.bindRotation)
    const beforeL = new Float32Array(sk.bindLength)

    const pose = createPose(sk)
    setPoseTranslation(pose, 0, 1, 2)
    setPoseRotation(pose, 1, Math.PI / 3)
    zeroPose(pose)
    copyPose(createPose(sk), pose)

    expectSameBits(sk.bindTranslation, beforeT)
    expectSameBits(sk.bindRotation, beforeR)
    expectSameBits(sk.bindLength, beforeL)

    const out = createVec2()
    bindTranslation(out, sk, 0)
    expectSameBits(out, new Float32Array([0.1, 0.2]))
    expectClose(bindRotation(sk, 0), 0.3)
    expectClose(bindLength(sk, 0), 0.4)
  })
})
