import { describe, expect, it } from '@jest/globals'
import { splitEqualOrderOverlaps, splitPacketByLine, type RenderPacket } from '@/pipeline2d'

function packet(): RenderPacket {
  return {
    version: 2,
    partId: 'square',
    vertices: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
    uvs: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: Uint16Array.from([0, 1, 2, 0, 2, 3]),
    colors: new Uint8Array(16).fill(255),
    seam: new Uint8Array(4),
    outline: null,
    atlasPage: -1,
    atlasKey: 'square',
    materialId: -1,
    blend: 'normal',
    mask: null,
    order: 0,
    depth: new Float32Array(4),
    bounds: { x: 0, y: 0, width: 1, height: 1 },
  }
}

function area(p: RenderPacket): number {
  let total = 0
  for (let t = 0; t < p.indices.length; t += 3) {
    const a = p.indices[t]!
    const b = p.indices[t + 1]!
    const c = p.indices[t + 2]!
    total += Math.abs(
      (p.vertices[b * 2]! - p.vertices[a * 2]!) * (p.vertices[c * 2 + 1]! - p.vertices[a * 2 + 1]!) -
      (p.vertices[b * 2 + 1]! - p.vertices[a * 2 + 1]!) * (p.vertices[c * 2]! - p.vertices[a * 2]!),
    ) / 2
  }
  return total
}

describe('pipeline2d split', () => {
  it('P5：三角形跨线切分，两侧面积和保持', () => {
    const source = packet()
    const { positive, negative } = splitPacketByLine(source, { x: 0.5, y: -1 }, { x: 0.5, y: 2 })
    expect(positive).not.toBeNull()
    expect(negative).not.toBeNull()
    expect(area(positive!)).toBeCloseTo(0.5, 5)
    expect(area(negative!)).toBeCloseTo(0.5, 5)
    expect(area(positive!) + area(negative!)).toBeCloseTo(area(source), 5)
    for (const value of positive!.vertices) expect(Number.isFinite(value)).toBe(true)
    for (const value of negative!.vertices) expect(Number.isFinite(value)).toBe(true)
  })

  it('P5：同 order 重叠包自动切分并微调 order', () => {
    const a = packet()
    const b = { ...packet(), partId: 'other', vertices: Float32Array.from([0.5, 0, 1.5, 0, 1.5, 1, 0.5, 1]), bounds: { x: 0.5, y: 0, width: 1, height: 1 } }
    const result = splitEqualOrderOverlaps([a, b])
    expect(result.length).toBe(3)
    for (const item of result) {
      for (const value of item.vertices) expect(Number.isFinite(value)).toBe(true)
    }
    expect(new Set(result.map((item) => item.order)).size).toBeGreaterThan(1)
  })

  it('P5：线不穿过时一侧为空', () => {
    const source = packet()
    const { positive, negative } = splitPacketByLine(source, { x: -1, y: -1 }, { x: -1, y: 2 })
    expect(positive).toBeNull()
    expect(negative).not.toBeNull()
    expect(area(negative!)).toBeCloseTo(1, 5)
  })
})
