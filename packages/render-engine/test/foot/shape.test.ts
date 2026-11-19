import { describe, expect, it } from '@jest/globals'
import * as foot from '@/foot'
import {
  FLAT_PARAMETER,
  HEEL_BACK_RATIO,
  createFootShape,
  soleLocal,
  stationLocal,
  stationParameter,
  type FootStation,
} from '@/foot/shape'
import { createVec2 } from '@/math'
import { expectClose, expectSameBits } from '../math/assert'

describe('shape', () => {
  it('从 foot 入口再导出', () => {
    expect(foot.createFootShape).toBe(createFootShape)
    expect(foot.HEEL_BACK_RATIO).toBe(HEEL_BACK_RATIO)
    expect(foot.FLAT_PARAMETER).toBe(FLAT_PARAMETER)
  })

  it('非法尺度抛出且不返回外形', () => {
    expect(() => createFootShape(Number.NaN, 0.1)).toThrow('footLength')
    expect(() => createFootShape(Number.POSITIVE_INFINITY, 0.1)).toThrow('footLength')
    expect(() => createFootShape(0, 0.1)).toThrow('footLength')
    expect(() => createFootShape(-0.2, 0.1)).toThrow('footLength')
    expect(() => createFootShape(0.2, -0.01)).toThrow('ankleHeight')
    expect(() => createFootShape(0.2, Number.NaN)).toThrow('ankleHeight')
    expect(() => createFootShape(0.2, Number.POSITIVE_INFINITY)).toThrow('ankleHeight')
  })

  it('踝高为 0 时脚底落在 y = 0', () => {
    const shape = createFootShape(0.2, 0)
    const out = createVec2()
    stationLocal(out, shape, 'flat')
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(0)
  })

  it('派生量与常数按位相同', () => {
    const shape = createFootShape(1, 0.04)
    expect(Object.is(shape.heelBack / shape.footLength, HEEL_BACK_RATIO)).toBe(true)
    expect(Object.is(shape.toeForward, shape.footLength)).toBe(true)
    expect(Object.is(shape.soleLength, shape.heelBack + shape.toeForward)).toBe(true)
  })

  it('三个位置：跟在后，平足在踝下，趾在前', () => {
    const shape = createFootShape(0.258, 0.066)
    const heel = createVec2()
    const flat = createVec2()
    const toe = createVec2()
    stationLocal(heel, shape, 'heel')
    stationLocal(flat, shape, 'flat')
    stationLocal(toe, shape, 'toe')
    expect(heel[0]!).toBeLessThan(0)
    expect(flat[0]).toBe(0)
    expect(toe[0]).toBe(Math.fround(shape.footLength))
    const y = Math.fround(-shape.ankleHeight)
    expect(heel[1]).toBe(y)
    expect(flat[1]).toBe(y)
    expect(toe[1]).toBe(y)
  })

  it('线段端点与脚跟、脚尖按位相同', () => {
    const shape = createFootShape(0.258, 0.066)
    const end = createVec2()
    const named = createVec2()
    soleLocal(end, shape, 0)
    stationLocal(named, shape, 'heel')
    expectSameBits(end, named)
    soleLocal(end, shape, 1)
    stationLocal(named, shape, 'toe')
    expectSameBits(end, named)
  })

  it('非法参数抛出', () => {
    const shape = createFootShape(0.2, 0.05)
    const out = createVec2()
    out[0] = 7
    out[1] = 8
    expect(() => soleLocal(out, shape, -0)).toThrow('u')
    expect(() => soleLocal(out, shape, 1.0000001)).toThrow('u')
    expect(() => soleLocal(out, shape, Number.NaN)).toThrow('u')
    expect(out[0]).toBe(7)
    expect(out[1]).toBe(8)
    expect(() => stationParameter('arch' as FootStation)).toThrow('station')
    expect(() => stationLocal(out, shape, 'arch' as FootStation)).toThrow('station')
    expect(out[0]).toBe(7)
    expect(out[1]).toBe(8)
  })

  it('同一尺度创建两次，字段按位相同', () => {
    const a = createFootShape(1.7, 0.0663)
    const b = createFootShape(1.7, 0.0663)
    expect(Object.is(a.footLength, b.footLength)).toBe(true)
    expect(Object.is(a.ankleHeight, b.ankleHeight)).toBe(true)
    expect(Object.is(a.heelBack, b.heelBack)).toBe(true)
    expect(Object.is(a.toeForward, b.toeForward)).toBe(true)
    expect(Object.is(a.soleLength, b.soleLength)).toBe(true)
  })

  it('平足参数插值接近踝正下方', () => {
    const shape = createFootShape(0.258, 0.066)
    const lerped = createVec2()
    const flat = createVec2()
    soleLocal(lerped, shape, FLAT_PARAMETER)
    stationLocal(flat, shape, 'flat')
    expectClose(lerped[0]!, flat[0]!)
    expectClose(lerped[1]!, flat[1]!)
    expect(stationParameter('heel')).toBe(0)
    expect(stationParameter('toe')).toBe(1)
    expect(stationParameter('flat')).toBe(FLAT_PARAMETER)
  })
})
