import { describe, expect, it } from '@jest/globals'
import * as math from '@/math'
import {
  addVec2,
  copyVec2,
  createVec2,
  crossVec2,
  distanceVec2,
  dotVec2,
  lengthVec2,
  lerpVec2,
  negateVec2,
  normalVec2,
  normalizeVec2,
  scaleVec2,
  setVec2,
  squaredLengthVec2,
  subVec2,
} from '@/math/vec2'
import { expectClose, expectCloseArray, expectSameBits, isZero } from './assert'

describe('vec2', () => {
  it('从 math 入口再导出', () => {
    expect(math.addVec2).toBe(addVec2)
    expect(math.crossVec2).toBe(crossVec2)
    expect(math.normalVec2).toBe(normalVec2)
    expect(math.normalizeVec2).toBe(normalizeVec2)
  })

  it('createVec2 得到长度为 2 的零向量', () => {
    const v = createVec2()
    expect(v).toBeInstanceOf(Float32Array)
    expect(v).toHaveLength(2)
    expect(isZero(v[0]) && isZero(v[1])).toBe(true)
  })

  it('setVec2 与 copyVec2 写入调用者的缓冲', () => {
    const out = createVec2()
    const source = setVec2(createVec2(), 3, -4)
    expect(setVec2(out, 3, -4)).toBe(out)
    expect(out[0]).toBe(3)
    expect(out[1]).toBe(-4)

    const copy = createVec2()
    expect(copyVec2(copy, source)).toBe(copy)
    source[0] = 0
    expect(copy[0]).toBe(3)
    expect(copy[1]).toBe(-4)
  })

  it('加减、数乘、取反、点积、长度和距离', () => {
    const a = setVec2(createVec2(), 2, 3)
    const b = setVec2(createVec2(), 4, -1)
    const out = createVec2()

    expect(addVec2(out, a, b)).toBe(out)
    expect(out[0]).toBe(6)
    expect(out[1]).toBe(2)

    subVec2(out, a, b)
    expect(out[0]).toBe(-2)
    expect(out[1]).toBe(4)

    scaleVec2(out, a, -2)
    expect(out[0]).toBe(-4)
    expect(out[1]).toBe(-6)

    negateVec2(out, a)
    expect(out[0]).toBe(-2)
    expect(out[1]).toBe(-3)

    expect(dotVec2(a, b)).toBe(5)
    expect(crossVec2(setVec2(createVec2(), 1, 0), setVec2(createVec2(), 0, 1))).toBe(1)
    expect(crossVec2(setVec2(createVec2(), 0, 1), setVec2(createVec2(), 1, 0))).toBe(-1)
    expect(crossVec2(setVec2(createVec2(), 2, 0), setVec2(createVec2(), 0, 3))).toBe(6)
    expect(crossVec2(setVec2(createVec2(), 2, 0), setVec2(createVec2(), 4, 0))).toBe(0)
    expect(lengthVec2(setVec2(out, 3, 4))).toBe(5)
    expect(squaredLengthVec2(setVec2(out, 3, 4))).toBe(25)
    expect(distanceVec2(setVec2(a, 1, 2), setVec2(b, 4, 6))).toBe(5)
  })

  it('normalVec2 是逆时针单位法向量', () => {
    const out = createVec2()
    expect(normalVec2(out, setVec2(createVec2(), 1, 0))).toBe(true)
    expectCloseArray(out, [0, 1])
    expectClose(lengthVec2(out), 1)

    expect(normalVec2(out, setVec2(createVec2(), 0, 2))).toBe(true)
    expectCloseArray(out, [-1, 0])

    expect(normalVec2(out, setVec2(createVec2(), 3, 4))).toBe(true)
    expectCloseArray(out, [-0.8, 0.6])

    const zeroOut = setVec2(createVec2(), 9, 8)
    expect(normalVec2(zeroOut, setVec2(createVec2(), 0, 0))).toBe(false)
    expect(isZero(zeroOut[0]) && isZero(zeroOut[1])).toBe(true)

    const v = setVec2(createVec2(), 3, 4)
    expect(normalVec2(v, v)).toBe(true)
    expectCloseArray(v, [-0.8, 0.6])
  })

  it('零向量单位化返回 false 并写入 (0, 0)', () => {
    const out = setVec2(createVec2(), 9, 8)
    expect(normalizeVec2(out, setVec2(createVec2(), 0, 0))).toBe(false)
    expect(isZero(out[0]) && isZero(out[1])).toBe(true)

    const negativeZero = setVec2(createVec2(), -0, -0)
    expect(normalizeVec2(negativeZero, negativeZero)).toBe(false)
    expect(isZero(negativeZero[0]) && isZero(negativeZero[1])).toBe(true)
  })

  it('非零向量单位化返回 true，长度为 1', () => {
    const out = createVec2()
    expect(normalizeVec2(out, setVec2(createVec2(), 3, 4))).toBe(true)
    expectClose(out[0] ?? Number.NaN, 0.6)
    expectClose(out[1] ?? Number.NaN, 0.8)
    expectClose(lengthVec2(out), 1)
  })

  it('lerpVec2 不限制 t', () => {
    const a = setVec2(createVec2(), 0, 10)
    const b = setVec2(createVec2(), 10, 0)
    const out = createVec2()

    lerpVec2(out, a, b, 0)
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(10)

    lerpVec2(out, a, b, 1)
    expect(out[0]).toBe(10)
    expect(out[1]).toBe(0)

    lerpVec2(out, a, b, 0.25)
    expectClose(out[0] ?? Number.NaN, 2.5)
    expectClose(out[1] ?? Number.NaN, 7.5)

    lerpVec2(out, a, b, 2)
    expectClose(out[0] ?? Number.NaN, 20)
    expectClose(out[1] ?? Number.NaN, -10)
  })

  it('输出缓冲可以与输入是同一块', () => {
    const a = setVec2(createVec2(), 2, 3)
    const b = setVec2(createVec2(), 4, -1)
    const separate = addVec2(createVec2(), a, b)
    addVec2(a, a, b)
    expect(a[0]).toBe(separate[0])
    expect(a[1]).toBe(separate[1])

    const v = setVec2(createVec2(), 3, 4)
    const normalized = normalizeVec2(createVec2(), v)
    expect(normalized).toBe(true)
    expect(normalizeVec2(v, v)).toBe(true)
    expectClose(v[0] ?? Number.NaN, 0.6)
    expectClose(v[1] ?? Number.NaN, 0.8)
  })

  it('相同输入重复运行，结果二进制相同', () => {
    const a = setVec2(createVec2(), 1.25, -2.5)
    const b = setVec2(createVec2(), -3, 4)
    const first = createVec2()
    const second = createVec2()

    addVec2(first, a, b)
    addVec2(second, a, b)
    expectSameBits(first, second)

    scaleVec2(first, a, 0.5)
    scaleVec2(second, a, 0.5)
    expectSameBits(first, second)

    normalizeVec2(first, a)
    normalizeVec2(second, a)
    expectSameBits(first, second)

    lerpVec2(first, a, b, 0.3)
    lerpVec2(second, a, b, 0.3)
    expectSameBits(first, second)

    expect(Object.is(dotVec2(a, b), dotVec2(a, b))).toBe(true)
    expect(Object.is(crossVec2(a, b), crossVec2(a, b))).toBe(true)

    normalVec2(first, a)
    normalVec2(second, a)
    expectSameBits(first, second)
    expect(Object.is(lengthVec2(a), lengthVec2(a))).toBe(true)
  })
})
