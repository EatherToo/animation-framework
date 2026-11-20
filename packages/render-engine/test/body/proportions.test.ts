import { describe, expect, it } from '@jest/globals'
import * as body from '@/body'
import { createProportions, type BodyProportions, type RadiusProfile } from '@/body/proportions'
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
  'palmRadius',
  'fingerRadius',
  'thumbRadius',
  'thumbDrop',
  'thumbOffsetZ',
  'heelBack',
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
      expectClose(b[key] as number, 2 * (a[key] as number))
    }
    expect(b.fingerSpread[0]).toBeCloseTo(2 * a.fingerSpread[0])
    expect(b.fingerSpread[1]).toBeCloseTo(2 * a.fingerSpread[1])
    for (const key of PROFILE_KEYS) expectProfileScale(a[key], b[key])
    expect(b.reachMargin).toBe(a.reachMargin)
    expect(b.palmFraction).toBe(a.palmFraction)
    expect(b.fingerFraction).toBe(a.fingerFraction)
    expect(b.thumbFraction).toBe(a.thumbFraction)
    expect(b.thumbAlong).toBe(a.thumbAlong)
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
      expectClose(p.shoulderOffsetZ, 0.11 * H)
      const shoulder = p.chestProfile[2]!
      expectClose(shoulder.t, 1 - p.shoulderDropY / p.chestLength)
      expectClose(shoulder.radius, p.shoulderOffsetZ)
      expectClose(p.spineProfile[1]!.radius, p.chestProfile[0]!.radius)
      expectClose(p.chestProfile[p.chestProfile.length - 1]!.radius, p.neckProfile[0]!.radius)
      expectClose(p.neckProfile[1]!.radius, p.headProfile[0]!.radius)
      expectClose(p.upperArmProfile[2]!.radius, p.lowerArmProfile[0]!.radius)
      expectClose(p.thighProfile[2]!.radius, p.shinProfile[0]!.radius)
      expectClose(p.heelBack, 0.3 * p.footLength)
      expect('hipOffsetX' in p).toBe(false)
      expect('shoulderOffsetX' in p).toBe(false)
    }
  })

  it('同一 H 两次调用字段按位相同', () => {
    const a = createProportions(1.7)
    const b = createProportions(1.7)
    for (const key of LENGTH_KEYS) expect(Object.is(a[key], b[key])).toBe(true)
    expect(Object.is(a.palmFraction, b.palmFraction)).toBe(true)
    expect(Object.is(a.fingerFraction, b.fingerFraction)).toBe(true)
    expect(Object.is(a.thumbFraction, b.thumbFraction)).toBe(true)
    expect(Object.is(a.thumbAlong, b.thumbAlong)).toBe(true)
    expect(Object.is(a.reachMargin, b.reachMargin)).toBe(true)
    expect(Object.is(a.fingerSpread[0], b.fingerSpread[0])).toBe(true)
    expect(Object.is(a.fingerSpread[1], b.fingerSpread[1])).toBe(true)
    for (const key of PROFILE_KEYS) {
      expect(a[key].length).toBe(b[key].length)
      for (let i = 0; i < a[key].length; i += 1) {
        expect(Object.is(a[key][i]!.t, b[key][i]!.t)).toBe(true)
        expect(Object.is(a[key][i]!.radius, b[key][i]!.radius)).toBe(true)
      }
    }
  })
})

const PROFILE_KEYS = [
  'spineProfile',
  'chestProfile',
  'neckProfile',
  'headProfile',
  'upperArmProfile',
  'lowerArmProfile',
  'thighProfile',
  'shinProfile',
  'footHalfWidth',
  'footInstep',
] as const

function expectProfileScale(small: RadiusProfile, large: RadiusProfile): void {
  expect(large.length).toBe(small.length)
  for (let i = 0; i < small.length; i += 1) {
    expect(large[i]!.t).toBe(small[i]!.t)
    expect(large[i]!.radius).toBeCloseTo(2 * small[i]!.radius)
  }
}
