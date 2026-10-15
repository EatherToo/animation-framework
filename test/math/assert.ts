import { expect } from '@jest/globals'

export const ABS_EPS = 1e-6

export function expectClose(actual: number, expected: number, eps = ABS_EPS): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(eps)
}

export function expectCloseArray(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  eps = ABS_EPS,
): void {
  expect(actual.length).toBe(expected.length)
  for (let i = 0; i < expected.length; i += 1) {
    const got = actual[i]
    const want = expected[i]
    if (got === undefined || want === undefined) {
      throw new Error(`missing component ${i}`)
    }
    expect(Math.abs(got - want)).toBeLessThanOrEqual(eps)
  }
}

export function expectSameBits(actual: ArrayLike<number>, expected: ArrayLike<number>): void {
  expect(actual.length).toBe(expected.length)
  for (let i = 0; i < expected.length; i += 1) {
    expect(Object.is(actual[i], expected[i])).toBe(true)
  }
}

export function expectDiffers(actual: ArrayLike<number>, expected: ArrayLike<number>, eps = ABS_EPS): void {
  expect(actual.length).toBe(expected.length)
  let differs = false
  for (let i = 0; i < expected.length; i += 1) {
    const got = actual[i]
    const want = expected[i]
    if (got === undefined || want === undefined) {
      throw new Error(`missing component ${i}`)
    }
    if (Math.abs(got - want) > eps) differs = true
  }
  expect(differs).toBe(true)
}

export function isZero(value: number | undefined): boolean {
  return value === 0
}
