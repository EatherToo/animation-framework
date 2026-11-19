import { describe, expect, it } from '@jest/globals'
import * as math from '@/math'
import { angleDelta, degToRad, normalizeAngle, radToDeg } from '@/math/angle'
import { expectClose } from './assert'

describe('angle', () => {
  it('从 math 入口再导出', () => {
    expect(math.normalizeAngle).toBe(normalizeAngle)
    expect(math.angleDelta).toBe(angleDelta)
  })

  it('度与弧度互相换算', () => {
    expectClose(degToRad(180), Math.PI)
    expectClose(degToRad(0), 0)
    expectClose(radToDeg(Math.PI), 180)
    expectClose(radToDeg(degToRad(20)), 20)
  })

  it('normalizeAngle 把 3π 和 -3π 折到 π，±π 都是 +π', () => {
    expectClose(normalizeAngle(3 * Math.PI), Math.PI)
    expectClose(normalizeAngle(-3 * Math.PI), Math.PI)
    expect(normalizeAngle(3 * Math.PI)).toBeGreaterThan(0)
    expect(normalizeAngle(-3 * Math.PI)).toBeGreaterThan(0)

    expectClose(normalizeAngle(Math.PI), Math.PI)
    expectClose(normalizeAngle(-Math.PI), Math.PI)
    expect(normalizeAngle(-Math.PI)).toBeGreaterThan(0)

    expectClose(normalizeAngle(0), 0)
    expectClose(normalizeAngle(Math.PI / 2), Math.PI / 2)
    expectClose(normalizeAngle(-Math.PI / 2), -Math.PI / 2)
    expectClose(normalizeAngle((5 * Math.PI) / 2), Math.PI / 2)
  })

  it('angleDelta 取 (-π, π] 内的有符号差', () => {
    const from = degToRad(170)
    const to = degToRad(-170)
    expectClose(angleDelta(from, to), degToRad(20))
    expect(Math.abs(angleDelta(from, to))).toBeLessThan(Math.PI)

    expectClose(angleDelta(-Math.PI, Math.PI), 0)
    expectClose(angleDelta(Math.PI, -Math.PI), 0)
  })

  it('非有限角度原样返回', () => {
    expect(Object.is(normalizeAngle(Number.NaN), Number.NaN)).toBe(true)
    expect(Object.is(normalizeAngle(Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY)).toBe(true)
    expect(Object.is(normalizeAngle(Number.NEGATIVE_INFINITY), Number.NEGATIVE_INFINITY)).toBe(true)
  })

  it('相同输入重复运行，结果二进制相同', () => {
    expect(Object.is(normalizeAngle(3 * Math.PI), normalizeAngle(3 * Math.PI))).toBe(true)
    expect(Object.is(normalizeAngle(-3 * Math.PI), normalizeAngle(-3 * Math.PI))).toBe(true)
    expect(Object.is(angleDelta(degToRad(170), degToRad(-170)), angleDelta(degToRad(170), degToRad(-170)))).toBe(
      true,
    )
    expect(Object.is(degToRad(20), degToRad(20))).toBe(true)
    expect(Object.is(radToDeg(1), radToDeg(1))).toBe(true)
  })
})
