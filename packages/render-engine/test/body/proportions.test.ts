import { describe, expect, it } from '@jest/globals'
import * as body from '@/body'
import {
  createProportions,
  type BodyProportions,
  type RadiusProfile,
  type SectionProfile,
  type SectionSample,
} from '@/body/proportions'
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

const SECTION_KEYS = [
  'torsoProfile',
  'neckProfile',
  'headProfile',
  'upperArmProfile',
  'lowerArmProfile',
  'thighProfile',
  'shinProfile',
] as const

const RADIUS_KEYS = ['footHalfWidth', 'footInstep'] as const

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
    expectClose(p.shoulderOffsetZ, 0.1 * H)
    expectClose(p.stanceWidth, 0.1 * H)
    expectClose(p.footLength + p.heelBack, 0.15 * H)
    expect(p.reachMargin).toBe(0.98)
  })

  it('长度随 H 成比例；截面与指数各自按规则缩放', () => {
    const H = 1.7
    const a = createProportions(H)
    const b = createProportions(2 * H)
    for (const key of LENGTH_KEYS) {
      expectClose(b[key] as number, 2 * (a[key] as number))
    }
    for (let i = 0; i < 4; i += 1) {
      expect(b.fingerOffsets[i]).toBeCloseTo(2 * a.fingerOffsets[i]!)
      expect(b.fingerLengths[i]).toBe(a.fingerLengths[i])
    }
    expect(b.palmWrist.halfWidth).toBeCloseTo(2 * a.palmWrist.halfWidth)
    expect(b.palmKnuckle.halfThickness).toBeCloseTo(2 * a.palmKnuckle.halfThickness)
    for (const key of SECTION_KEYS) expectSectionScale(a[key], b[key])
    for (const key of RADIUS_KEYS) expectRadiusScale(a[key], b[key])
    expect(b.reachMargin).toBe(a.reachMargin)
    expect(b.palmFraction).toBe(a.palmFraction)
    expect(b.thumbAlong).toBe(a.thumbAlong)
  })

  it('每条截面轮廓的 t、正性与指数', () => {
    const p = createProportions(1.8)
    for (const key of SECTION_KEYS) {
      const profile = p[key]
      expect(profile.length).toBeGreaterThanOrEqual(2)
      expect(profile[0]!.t).toBe(0)
      expect(profile[profile.length - 1]!.t).toBe(1)
      for (let i = 0; i < profile.length; i += 1) {
        const sample = profile[i]!
        if (i > 0) expect(sample.t).toBeGreaterThan(profile[i - 1]!.t)
        expect(sample.halfWidth).toBeGreaterThan(0)
        expect(sample.frontDepth).toBeGreaterThan(0)
        expect(sample.backDepth).toBeGreaterThan(0)
        expect(sample.exponent).toBeGreaterThanOrEqual(1)
      }
    }
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
      expectClose(p.heelBack, 0.3 * p.footLength)
      expectClose(p.footLength + p.heelBack, 0.15 * H)
      const shoulder = p.torsoProfile[p.torsoProfile.length - 2]!
      expectClose(shoulder.t, 0.268 / 0.288)
      expectClose(shoulder.halfWidth, 0.086 * H)
      expect('hipOffsetX' in p).toBe(false)
      expect('shoulderOffsetX' in p).toBe(false)
    }
  })

  it('共站的相邻轮廓四个量相同', () => {
    const p = createProportions(1.8)
    const pairs: Array<[SectionProfile, SectionProfile]> = [
      [p.torsoProfile, p.neckProfile],
      [p.neckProfile, p.headProfile],
      [p.upperArmProfile, p.lowerArmProfile],
      [p.thighProfile, p.shinProfile],
    ]
    for (const [left, right] of pairs) {
      const tail = left[left.length - 1]!
      const head = right[0]!
      expect(tail.t).toBe(1)
      expect(head.t).toBe(0)
      expectSectionEqual(tail, head)
    }
  })

  it('同一 H 两次调用字段按位相同', () => {
    const a = createProportions(1.7)
    const b = createProportions(1.7)
    for (const key of LENGTH_KEYS) expect(Object.is(a[key], b[key])).toBe(true)
    expect(Object.is(a.palmFraction, b.palmFraction)).toBe(true)
    expect(Object.is(a.thumbAlong, b.thumbAlong)).toBe(true)
    expect(Object.is(a.reachMargin, b.reachMargin)).toBe(true)
    for (let i = 0; i < 4; i += 1) expect(Object.is(a.fingerOffsets[i], b.fingerOffsets[i])).toBe(true)
    expect(Object.is(a.palmWrist.halfWidth, b.palmWrist.halfWidth)).toBe(true)
    for (const key of SECTION_KEYS) {
      expect(a[key].length).toBe(b[key].length)
      for (let i = 0; i < a[key].length; i += 1) {
        expect(Object.is(a[key][i]!.t, b[key][i]!.t)).toBe(true)
        expect(Object.is(a[key][i]!.halfWidth, b[key][i]!.halfWidth)).toBe(true)
        expect(Object.is(a[key][i]!.frontDepth, b[key][i]!.frontDepth)).toBe(true)
        expect(Object.is(a[key][i]!.backDepth, b[key][i]!.backDepth)).toBe(true)
        expect(Object.is(a[key][i]!.exponent, b[key][i]!.exponent)).toBe(true)
      }
    }
    for (const key of RADIUS_KEYS) {
      expect(a[key].length).toBe(b[key].length)
      for (let i = 0; i < a[key].length; i += 1) {
        expect(Object.is(a[key][i]!.t, b[key][i]!.t)).toBe(true)
        expect(Object.is(a[key][i]!.radius, b[key][i]!.radius)).toBe(true)
      }
    }
  })
})

function expectSectionScale(small: SectionProfile, large: SectionProfile): void {
  expect(large.length).toBe(small.length)
  for (let i = 0; i < small.length; i += 1) {
    const a = small[i]!
    const b = large[i]!
    expect(b.t).toBe(a.t)
    expect(b.halfWidth).toBeCloseTo(2 * a.halfWidth)
    expect(b.frontDepth).toBeCloseTo(2 * a.frontDepth)
    expect(b.backDepth).toBeCloseTo(2 * a.backDepth)
    expect(b.exponent).toBe(a.exponent)
  }
}

function expectRadiusScale(small: RadiusProfile, large: RadiusProfile): void {
  expect(large.length).toBe(small.length)
  for (let i = 0; i < small.length; i += 1) {
    expect(large[i]!.t).toBe(small[i]!.t)
    expect(large[i]!.radius).toBeCloseTo(2 * small[i]!.radius)
  }
}

function expectSectionEqual(a: SectionSample, b: SectionSample): void {
  expect(a.halfWidth).toBeCloseTo(b.halfWidth, 8)
  expect(a.frontDepth).toBeCloseTo(b.frontDepth, 8)
  expect(a.backDepth).toBeCloseTo(b.backDepth, 8)
  expect(a.exponent).toBeCloseTo(b.exponent, 8)
}
