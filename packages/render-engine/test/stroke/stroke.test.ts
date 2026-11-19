import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { AXIAL_STEPS } from '@/mesh/strip'
import { createPose } from '@/skeleton/pose'
import { STROKE_WIDTH, strokeContours, type StrokeSource } from '@/stroke/stroke'
import { presentPose } from '../view/present'

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

  it('正面与背面相接的边是轮廓：两次走向相同的共享边要描', () => {
    const folded = strokeContours(
      [source('a', [0, 0, 1, 0, 0, 1], [0, 1, 2, 0, 1, 2])],
      true,
    )
    expect(folded[0]!.quads).toHaveLength(3)

    const unwound = strokeContours(
      [source('a', [0, 0, 1, 0, 0, 1], [0, 1, 2, 0, 2, 1])],
      true,
    )
    expect(unwound[0]!.quads).toHaveLength(3)

    const tent = strokeContours(
      [source('a', [0, 0, 1, 0, 0, 1, 0.2, 0.2], [0, 1, 2, 1, 3, 2])],
      true,
    )
    expect(tent[0]!.quads).toHaveLength(5)
  })

  it('屏幕上叠在一起的两件各自保留轮廓，隔着同一条边相接的才算接缝', () => {
    const overlapped = strokeContours(
      [
        source('a', [0, 0, 1, 0, 0, 1], [0, 1, 2]),
        source('b', [0, 0, 1, 0, 0, 1], [0, 1, 2]),
      ],
      true,
    )
    expect(overlapped[0]!.quads).toHaveLength(3)
    expect(overlapped[1]!.quads).toHaveLength(3)

    const adjacent = strokeContours(
      [
        source('a', [0, 0, 1, 0, 0, 1], [0, 1, 2]),
        source('b', [0, 0, 0, -1, 1, 0], [0, 1, 2]),
      ],
      true,
    )
    expect(adjacent[0]!.quads).toHaveLength(2)
    expect(adjacent[1]!.quads).toHaveLength(2)
  })

  it('投影成一个点的边不描', () => {
    const stroked = strokeContours([source('a', [0, 0, 0, 0, 1, 1], [0, 1, 2])], true)
    expect(stroked[0]!.quads).toHaveLength(2)
  })

  it('圆管投影后描出两条侧边和两端，线贴着轮廓', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const p = compiled.proportions
    for (const view of [0, 90, 180]) {
      const { filled } = presentPose(compiled, createPose(compiled.skeleton), view)
      const before = filled.map((part) => Array.from(part.positions))
      const stroked = strokeContours(filled, true)
      expect(stroked.map((part) => part.partId)).toEqual(filled.map((part) => part.partId))
      for (let i = 0; i < filled.length; i += 1) {
        expect(Array.from(filled[i]!.positions)).toEqual(before[i])
        expect(stroked[i]!.quads.length).toBeGreaterThan(0)
      }

      const index = filled.findIndex((part) => part.partId === 'legL')
      const leg = filled[index]!
      let min = Infinity
      let max = -Infinity
      let bottom = Infinity
      let top = -Infinity
      for (let i = 0; i < leg.positions.length; i += 2) {
        min = Math.min(min, leg.positions[i]!)
        max = Math.max(max, leg.positions[i]!)
        bottom = Math.min(bottom, leg.positions[i + 1]!)
        top = Math.max(top, leg.positions[i + 1]!)
      }
      expect(max - min).toBeCloseTo(2 * p.thighRadius, 4)

      let left = false
      let right = false
      for (const quad of stroked[index]!.quads) {
        const x0 = (quad.positions[0]! + quad.positions[6]!) / 2
        const y0 = (quad.positions[1]! + quad.positions[7]!) / 2
        const x1 = (quad.positions[2]! + quad.positions[4]!) / 2
        const y1 = (quad.positions[3]! + quad.positions[5]!) / 2
        for (const [x, y] of [[x0, y0], [x1, y1]] as const) {
          expect(x).toBeGreaterThanOrEqual(min - 1e-5)
          expect(x).toBeLessThanOrEqual(max + 1e-5)
          expect(y).toBeGreaterThanOrEqual(bottom - 1e-5)
          expect(y).toBeLessThanOrEqual(top + 1e-5)
        }
        const alongSilhouette =
          Math.abs(x1 - x0) < 1e-4 && Math.abs(y1 - y0) > p.thighLength / AXIAL_STEPS / 2
        if (alongSilhouette && Math.abs(x0 - min) < 1e-4) left = true
        if (alongSilhouette && Math.abs(x0 - max) < 1e-4) right = true
      }
      expect(left).toBe(true)
      expect(right).toBe(true)
    }
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
