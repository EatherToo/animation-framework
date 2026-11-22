import { describe, expect, it } from '@jest/globals'
import { clipTriangles } from '@/render/clipping'

const quadPositions = new Float32Array([-2, -2, 2, -2, 2, 2, -2, 2])
const quadUvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
const quadIndices = new Uint16Array([0, 1, 2, 0, 2, 3])

function area(positions: Float32Array, indices: Uint16Array | Uint32Array): number {
  let sum = 0
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i]! * 2, b = indices[i + 1]! * 2, c = indices[i + 2]! * 2
    sum += Math.abs((positions[b]! - positions[a]!) * (positions[c + 1]! - positions[a + 1]!) -
      (positions[b + 1]! - positions[a + 1]!) * (positions[c]! - positions[a]!)) / 2
  }
  return sum
}

describe('H3 CPU triangle clipping', () => {
  it('clips a quad against a rectangle and preserves UV interpolation', () => {
    const clip = new Float32Array([-2, -2, 0, -2, 0, 2, -2, 2])
    const out = clipTriangles(quadPositions, quadUvs, quadIndices, [clip])
    expect(area(out.positions, out.indices)).toBeCloseTo(8, 5) // 左半 4×4
    let minX = Infinity, maxX = -Infinity
    for (let i = 0; i < out.positions.length; i += 2) {
      minX = Math.min(minX, out.positions[i]!)
      maxX = Math.max(maxX, out.positions[i]!)
    }
    expect(minX).toBeGreaterThanOrEqual(-2 - 1e-5)
    expect(maxX).toBeLessThanOrEqual(0 + 1e-5)
    for (let i = 0; i < out.uvs.length; i += 2) {
      expect(out.uvs[i]).toBeGreaterThanOrEqual(-1e-5)
      expect(out.uvs[i]).toBeLessThanOrEqual(1.00001)
    }
  })

  it('handles a concave clip polygon by triangulation', () => {
    const clip = new Float32Array([-2, -2, 2, -2, 2, 2, 0, 0, -2, 2])
    const out = clipTriangles(quadPositions, quadUvs, quadIndices, [clip])
    expect(area(out.positions, out.indices)).toBeCloseTo(12, 4) // 4×4 - 2×2/2
  })

  it('keeps the triangle unchanged when fully inside', () => {
    const clip = new Float32Array([-3, -3, 3, -3, 3, 3, -3, 3])
    const out = clipTriangles(quadPositions, quadUvs, quadIndices, [clip])
    expect(area(out.positions, out.indices)).toBeCloseTo(16, 6)
  })

  it('returns empty when fully outside', () => {
    const clip = new Float32Array([10, 10, 12, 10, 12, 12])
    const out = clipTriangles(quadPositions, quadUvs, quadIndices, [clip])
    expect(out.indices.length).toBe(0)
  })
})
