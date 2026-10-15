import { describe, expect, it } from '@jest/globals'
import * as math from '@/math'
import {
  copyVec3,
  createVec3,
  crossVec3,
  faceNormalVec3,
  lengthVec3,
  normalVec3,
  normalizeVec3,
  setVec3,
} from '@/math/vec3'
import { expectClose, expectCloseArray, expectSameBits, isZero } from './assert'

function xyz(x: number, y: number, z: number): Float32Array {
  return setVec3(createVec3(), x, y, z)
}

describe('vec3', () => {
  it('从 math 入口再导出', () => {
    expect(math.crossVec3).toBe(crossVec3)
    expect(math.normalVec3).toBe(normalVec3)
    expect(math.faceNormalVec3).toBe(faceNormalVec3)
  })

  it('createVec3 得到长度为 3 的零向量', () => {
    const v = createVec3()
    expect(v).toBeInstanceOf(Float32Array)
    expect(v).toHaveLength(3)
    expect(isZero(v[0]) && isZero(v[1]) && isZero(v[2])).toBe(true)
  })

  it('setVec3 与 copyVec3 写入调用者的缓冲', () => {
    const out = createVec3()
    const source = xyz(1, 2, 3)
    expect(setVec3(out, 1, 2, 3)).toBe(out)
    expectCloseArray(out, [1, 2, 3])

    const copy = createVec3()
    expect(copyVec3(copy, source)).toBe(copy)
    source[0] = 0
    expect(copy[0]).toBe(1)
    expect(copy[2]).toBe(3)
  })

  it('crossVec3 遵守右手定则', () => {
    const x = xyz(1, 0, 0)
    const y = xyz(0, 1, 0)
    const out = createVec3()

    expect(crossVec3(out, x, y)).toBe(out)
    expectCloseArray(out, [0, 0, 1])

    crossVec3(out, y, x)
    expectCloseArray(out, [0, 0, -1])

    crossVec3(out, xyz(2, 0, 0), xyz(4, 0, 0))
    expectCloseArray(out, [0, 0, 0])

    const left = xyz(1, 2, 3)
    const right = xyz(4, 5, 6)
    const separate = crossVec3(createVec3(), left, right)
    crossVec3(left, left, right)
    expectCloseArray(left, separate)
  })

  it('normalizeVec3 在零向量时失败，非零时得到单位向量', () => {
    const out = xyz(9, 8, 7)
    expect(normalizeVec3(out, xyz(0, 0, 0))).toBe(false)
    expect(isZero(out[0]) && isZero(out[1]) && isZero(out[2])).toBe(true)

    expect(normalizeVec3(out, xyz(0, 3, 4))).toBe(true)
    expectCloseArray(out, [0, 0.6, 0.8])
    expectClose(lengthVec3(out), 1)
  })

  it('normalVec3 是单位叉积，平行时写入零向量', () => {
    const out = xyz(9, 8, 7)
    expect(normalVec3(out, xyz(1, 0, 0), xyz(0, 1, 0))).toBe(true)
    expectCloseArray(out, [0, 0, 1])
    expectClose(lengthVec3(out), 1)

    expect(normalVec3(out, xyz(2, 0, 0), xyz(0, 0, 3))).toBe(true)
    expectCloseArray(out, [0, -1, 0])

    expect(normalVec3(out, xyz(2, 0, 0), xyz(4, 0, 0))).toBe(false)
    expect(isZero(out[0]) && isZero(out[1]) && isZero(out[2])).toBe(true)

    const a = xyz(1, 0, 0)
    const b = xyz(0, 2, 0)
    expect(normalVec3(a, a, b)).toBe(true)
    expectCloseArray(a, [0, 0, 1])
  })

  it('faceNormalVec3 取三角面的逆时针单位法向量', () => {
    const out = xyz(9, 8, 7)
    const origin = xyz(0, 0, 0)
    const x = xyz(1, 0, 0)
    const y = xyz(0, 1, 0)
    expect(faceNormalVec3(out, origin, x, y)).toBe(true)
    expectCloseArray(out, [0, 0, 1])
    expectClose(lengthVec3(out), 1)

    expect(faceNormalVec3(out, origin, y, x)).toBe(true)
    expectCloseArray(out, [0, 0, -1])

    expect(faceNormalVec3(out, origin, x, xyz(2, 0, 0))).toBe(false)
    expect(isZero(out[0]) && isZero(out[1]) && isZero(out[2])).toBe(true)

    const a = xyz(0, 0, 0)
    const expected = faceNormalVec3(createVec3(), a, x, y)
    expect(expected).toBe(true)
    expect(faceNormalVec3(a, a, x, y)).toBe(true)
    expectCloseArray(a, [0, 0, 1])
  })

  it('相同输入重复运行，结果二进制相同', () => {
    const a = xyz(1.25, -2.5, 0.5)
    const b = xyz(-3, 4, 1)
    const c = xyz(0.5, 1.5, -2)
    const first = createVec3()
    const second = createVec3()

    crossVec3(first, a, b)
    crossVec3(second, a, b)
    expectSameBits(first, second)

    normalVec3(first, a, b)
    normalVec3(second, a, b)
    expectSameBits(first, second)

    faceNormalVec3(first, a, b, c)
    faceNormalVec3(second, a, b, c)
    expectSameBits(first, second)

    expect(Object.is(lengthVec3(a), lengthVec3(a))).toBe(true)
  })
})
