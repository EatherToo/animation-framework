import { describe, expect, it } from '@jest/globals'
import * as body from '@/body'
import { createProportions, type BodyProportions } from '@/body/proportions'
import { expectClose } from '../math/assert'

const LENGTH_KEYS: Array<keyof BodyProportions> = [
  'height',
  'hipHeight',
  'ankleHeight',
  'pelvisLength',
  'spineLength',
  'chestLength',
  'neckLength',
  'headLength',
  'upperArmLength',
  'lowerArmLength',
  'handLength',
  'thighLength',
  'shinLength',
  'footLength',
  'legLength',
  'spineRadius',
  'chestRadius',
  'neckRadius',
  'headRadius',
  'upperArmRadius',
  'lowerArmRadius',
  'handRadius',
  'thighRadius',
  'shinRadius',
  'footRadius',
  'stanceWidth',
  'hipOffsetZ',
  'shoulderOffsetZ',
  'hipDropY',
  'shoulderDropY',
]

describe('proportions', () => {
  it('从 body 入口再导出', () => {
    expect(body.createProportions).toBe(createProportions)
  })

  it('非法身高抛出', () => {
    expect(() => createProportions(0)).toThrow()
    expect(() => createProportions(-1)).toThrow()
    expect(() => createProportions(Number.NaN)).toThrow()
    expect(() => createProportions(Number.POSITIVE_INFINITY)).toThrow()
    expect(() => createProportions(Number.NEGATIVE_INFINITY)).toThrow()
  })

  it('H=1.7 时关键字段与 reachMargin', () => {
    const H = 1.7
    const p = createProportions(H)
    expectClose(p.hipHeight, 0.53 * H)
    expectClose(p.thighLength, 0.245 * H)
    expectClose(p.legLength, (0.245 + 0.246) * H)
    expect(p.reachMargin).toBe(0.98)
  })

  it('长度随 H 成比例；reachMargin 不变', () => {
    const H = 1.7
    const a = createProportions(H)
    const b = createProportions(2 * H)
    for (const key of LENGTH_KEYS) {
      expectClose(b[key], 2 * a[key])
    }
    expect(b.reachMargin).toBe(a.reachMargin)
  })

  it('派生量与默认表闭合', () => {
    for (const H of [1, 1.7]) {
      const p = createProportions(H)
      expectClose(p.hipOffsetZ, p.stanceWidth / 2)
      expectClose(p.legLength, p.thighLength + p.shinLength)
      expectClose(
        p.hipDropY,
        p.hipHeight - p.thighLength - p.shinLength - p.ankleHeight,
      )
      expect(Math.abs(p.hipDropY)).toBeLessThanOrEqual(1e-6 * H)
      expectClose(p.shoulderOffsetZ, 0.102 * H)
      expect('hipOffsetX' in p).toBe(false)
      expect('shoulderOffsetX' in p).toBe(false)
    }
  })

  it('同一 H 两次调用字段按位相同', () => {
    const a = createProportions(1.7)
    const b = createProportions(1.7)
    for (const key of Object.keys(a) as Array<keyof BodyProportions>) {
      expect(Object.is(a[key], b[key])).toBe(true)
    }
  })
})
