import { describe, expect, it } from '@jest/globals'
import { compareRgba } from './compare'

describe('RGBA parity diagnostics', () => {
  it('reports zero diff for identical images', () => {
    expect(compareRgba(new Uint8Array(4 * 5 * 5), new Uint8Array(4 * 5 * 5), 5, 5)).toMatchObject({ mean: 0, max: 0, bbox: null })
  })

  it('separates edge from interior and finds the changed pixel', () => {
    const expected = new Uint8Array(4 * 5 * 5)
    const actual = expected.slice()
    actual[(2 * 5 + 2) * 4] = 255
    const result = compareRgba(expected, actual, 5, 5, 1)
    expect(result).toMatchObject({ mean: 2.55, max: 255, changedPixels: 1, bbox: { x: 2, y: 2, width: 1, height: 1 }, edgeMean: 0 })
    expect(result.interiorMean).toBeGreaterThan(0)
    expect(() => compareRgba(expected, actual, 4, 5)).toThrow('dimensions')
  })
})
