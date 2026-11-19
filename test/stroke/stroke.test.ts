import { describe, expect, it } from '@jest/globals'
import { STROKE_WIDTH, strokeContours, type StrokeSource } from '@/stroke/stroke'

function source(partId: string, positions: number[], indices: number[]): StrokeSource {
  return {
    partId,
    positions: Float32Array.from(positions),
    indices: Uint16Array.from(indices),
  }
}

describe('stroke', () => {
  it('三角形的三条边都描，共享边不描', () => {
    const one = strokeContours([source('a', [0, 0, 1, 0, 0, 1], [0, 1, 2])], true)
    expect(one).toHaveLength(1)
    expect(one[0]!.quads).toHaveLength(3)

    const two = strokeContours(
      [source('a', [0, 0, 1, 0, 1, 1, 0, 1], [0, 1, 2, 0, 2, 3])],
      true,
    )
    expect(two[0]!.quads).toHaveLength(4)
  })

  it('部件接缝两边都不描', () => {
    const stroked = strokeContours(
      [
        source('a', [0, 0, 1, 0, 0, 1], [0, 1, 2]),
        source('b', [0, 0, 1, 0, 0, -1], [0, 1, 2]),
      ],
      true,
    )
    const count = stroked.reduce((sum, part) => sum + part.quads.length, 0)
    expect(count).toBe(4)
  })

  it('关闭描边时不改顶点', () => {
    const part = source('a', [0, 0, 1, 0, 0, 1], [0, 1, 2])
    const before = Array.from(part.positions)
    expect(strokeContours([part], false)).toEqual([])
    expect(Array.from(part.positions)).toEqual(before)
  })

  it('四边形短边等于线宽', () => {
    const stroked = strokeContours([source('a', [0, 0, 1, 0, 0, 1], [0, 1, 2])], true)
    const positions = stroked[0]!.quads[0]!.positions
    const dx = positions[0]! - positions[6]!
    const dy = positions[1]! - positions[7]!
    expect(Math.hypot(dx, dy)).toBeCloseTo(STROKE_WIDTH, 5)
  })
})
