/**
 * M14 DQS（对偶四元数）单元测试。
 * 权威：docs/05-网格/skinning.md §6.4、docs/10-多视角/volume.md。
 *
 * DQS 只服务 Volume 3D 路径：本文件只测 3D，不涉及 2D 骨骼。
 */
import { describe, expect, it } from '@jest/globals'
import {
  blendDualQuats,
  dualQuatFromMat4,
  normalizeDualQuat,
  skinDqs,
  transformPointDqs,
  type DualQuat,
} from '@/volume/dqs'

const IDENTITY_MAT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

/** 列主序 4x4：绕 Z 旋转 + 平移，可选均匀/非均匀缩放。 */
function makeMat4(
  angle: number,
  tx = 0,
  ty = 0,
  tz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): Float32Array {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return new Float32Array([
    c * sx, s * sx, 0, 0,
    -s * sy, c * sy, 0, 0,
    0, 0, 1 * sz, 0,
    tx, ty, tz, 1,
  ])
}

function translate(x: number, y: number, z: number): Float32Array {
  return makeMat4(0, x, y, z)
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)
}

function expectVec3(actual: readonly number[], expected: readonly number[], digits = 6): void {
  expect(actual[0]!).toBeCloseTo(expected[0]!, digits)
  expect(actual[1]!).toBeCloseTo(expected[1]!, digits)
  expect(actual[2]!).toBeCloseTo(expected[2]!, digits)
}

describe('DQS: 构造与刚体变换', () => {
  it('纯平移矩阵把原点送到平移量', () => {
    const d = dualQuatFromMat4(translate(3, -2, 5))
    expectVec3(transformPointDqs(d, [0, 0, 0]), [3, -2, 5])
  })

  it('旋转+平移保持点间距离（刚体）', () => {
    const d = dualQuatFromMat4(makeMat4(Math.PI / 3, 3, -2, 5))
    const a = transformPointDqs(d, [1, 0, 0])
    const b = transformPointDqs(d, [0, 1, 0])
    const c = transformPointDqs(d, [0, 0, 1])
    const origin = transformPointDqs(d, [0, 0, 0])
    expect(distance(a, b)).toBeCloseTo(Math.SQRT2, 9)
    expect(distance(b, c)).toBeCloseTo(Math.SQRT2, 9)
    // 原点被送到平移量；旋转不改变它。
    expect(Math.hypot(origin[0]!, origin[1]!, origin[2]!)).toBeCloseTo(
      Math.hypot(3, -2, 5),
      9,
    )
  })

  it('含缩放的矩阵先正交化，仍返回近似刚体变换', () => {
    const d = dualQuatFromMat4(makeMat4(Math.PI / 4, 2, 1, -3, 2, 2, 2))
    expectVec3(transformPointDqs(d, [0, 0, 0]), [2, 1, -3])
    const a = transformPointDqs(d, [1, 0, 0])
    const b = transformPointDqs(d, [0, 1, 0])
    expect(distance(a, b)).toBeCloseTo(Math.SQRT2, 6)
  })

  it('normalizeDualQuat 对已单位化的结果幂等', () => {
    const d = dualQuatFromMat4(makeMat4(0.3, 1, 2, 3))
    const again = normalizeDualQuat(d)
    expectVec3(transformPointDqs(again, [0.4, -0.2, 0.7]), transformPointDqs(d, [0.4, -0.2, 0.7]), 9)
  })
})

describe('DQS: 混合', () => {
  it('50/50 混合两个旋转不产生缩放', () => {
    const identity = dualQuatFromMat4(IDENTITY_MAT)
    const rotate90 = dualQuatFromMat4(makeMat4(Math.PI / 2))
    const blended = blendDualQuats([
      { q: identity, w: 0.5 },
      { q: rotate90, w: 0.5 },
    ])
    const p = transformPointDqs(blended, [1, 0, 0])
    expect(Math.hypot(p[0]!, p[1]!, p[2]!)).toBeCloseTo(1, 9)
    expectVec3(p, [Math.SQRT1_2, Math.SQRT1_2, 0], 6)
  })

  it('50/50 混合两个平移得到平移中点', () => {
    const a = dualQuatFromMat4(translate(0, 0, 0))
    const b = dualQuatFromMat4(translate(2, 4, -6))
    const blended = blendDualQuats([
      { q: a, w: 0.5 },
      { q: b, w: 0.5 },
    ])
    expectVec3(transformPointDqs(blended, [1, 1, 1]), [2, 3, -2], 9)
  })

  it('半球符号：q 与 -q 混合不互相抵消', () => {
    const q = dualQuatFromMat4(makeMat4(Math.PI / 3, 1, 2, 3))
    const neg = new Float64Array(8)
    for (let i = 0; i < 8; i += 1) neg[i] = -q[i]!
    const blended = blendDualQuats([
      { q, w: 0.5 },
      { q: neg, w: 0.5 },
    ])
    const a = transformPointDqs(q, [0.4, 0.2, -0.1])
    const b = transformPointDqs(blended, [0.4, 0.2, -0.1])
    expectVec3(b, a, 9)
  })

  it('总权重为 0 时返回单位对偶四元数', () => {
    const q = dualQuatFromMat4(translate(5, 0, 0))
    const blended = blendDualQuats([
      { q, w: 0 },
      { q, w: 0 },
    ])
    expectVec3(transformPointDqs(blended, [1, 2, 3]), [1, 2, 3], 12)
  })
})

describe('DQS: skinDqs', () => {
  it('单骨恒等矩阵保持顶点不变', () => {
    const points = new Float32Array([1, 2, 3, -1, 0.5, 2])
    const matrices = new Float32Array(IDENTITY_MAT)
    const indices = new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0])
    const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0])
    const out = skinDqs(points, matrices, indices, weights)
    expect(Array.from(out)).toEqual(Array.from(points))
    expect(Array.from(out).every(Number.isFinite)).toBe(true)
  })

  it('双骨 50/50 平移混合得到中点', () => {
    const points = new Float32Array([1, 0, 0])
    const matrices = new Float32Array(32)
    matrices.set(IDENTITY_MAT, 0)
    matrices.set(translate(2, 0, 0), 16)
    const indices = new Uint16Array([0, 1, 0, 0])
    const weights = new Float32Array([0.5, 0.5, 0, 0])
    const out = skinDqs(points, matrices, indices, weights)
    expectVec3(Array.from(out), [2, 0, 0], 6)
  })

  it('双骨旋转混合保持长度且无 NaN', () => {
    const points = new Float32Array([1, 0, 0, 0, 1, 0])
    const matrices = new Float32Array(32)
    matrices.set(IDENTITY_MAT, 0)
    matrices.set(makeMat4(Math.PI / 2), 16)
    const indices = new Uint16Array([0, 1, 0, 0, 0, 1, 0, 0])
    const weights = new Float32Array([0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0])
    const out = skinDqs(points, matrices, indices, weights)
    expect(Array.from(out).every(Number.isFinite)).toBe(true)
    const a = [out[0]!, out[1]!, out[2]!]
    const b = [out[3]!, out[4]!, out[5]!]
    expect(distance(a, b)).toBeCloseTo(Math.SQRT2, 6)
    expect(Math.hypot(a[0]!, a[1]!, a[2]!)).toBeCloseTo(1, 6)
  })

  it('全零权重或越界索引时保持原点且无 NaN', () => {
    const points = new Float32Array([0.5, -0.5, 1])
    const matrices = new Float32Array(IDENTITY_MAT)
    const indices = new Uint16Array([7, 8, 9, 10])
    const weights = new Float32Array([0, 0, 0, 0])
    const out = skinDqs(points, matrices, indices, weights)
    expect(Array.from(out)).toEqual(Array.from(points))
    expect(Array.from(out).every(Number.isFinite)).toBe(true)
  })
})
