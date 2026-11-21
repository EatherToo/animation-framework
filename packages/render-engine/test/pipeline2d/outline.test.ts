import { describe, expect, it } from '@jest/globals'
import { buildOutlineRibbon, type RenderPacket, type RenderOutline } from '@/pipeline2d'

const outline: RenderOutline = {
  widthPx: 2,
  color: { r: 0, g: 0, b: 0, a: 1 },
  join: 'round',
  cap: 'round',
  depthBias: 0,
}

function packet(seam?: Uint8Array): RenderPacket {
  return {
    version: 2,
    partId: 'square',
    vertices: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
    uvs: new Float32Array(8),
    indices: Uint16Array.from([0, 1, 2, 0, 2, 3]),
    colors: new Uint8Array(16),
    seam: seam ?? new Uint8Array(4),
    outline,
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

describe('pipeline2d outline', () => {
  it('R4：方块生成四条边与四个圆角，宽度按像素换算', () => {
    const ribbon = buildOutlineRibbon(packet(), 100)!
    expect(ribbon).not.toBeNull()
    expect(ribbon.indices.length).toBeGreaterThan(4 * 6)
    const width = Math.hypot(
      ribbon.positions[0]! - ribbon.positions[2]!,
      ribbon.positions[1]! - ribbon.positions[3]!,
    )
    expect(width).toBeCloseTo(0.02, 6)
    for (const value of ribbon.positions) expect(Number.isFinite(value)).toBe(true)
    const half = buildOutlineRibbon(packet(), 200)!
    expect(
      Math.hypot(
        half.positions[0]! - half.positions[2]!,
        half.positions[1]! - half.positions[3]!,
      ),
    ).toBeCloseTo(0.01, 6)
  })

  it('R4：两端 seam 的边不描；无 outline / 非法 scale 返回 null', () => {
    const seam = new Uint8Array(4).fill(1)
    expect(buildOutlineRibbon(packet(seam), 100)).toBeNull()
    const noOutline = { ...packet(), outline: null }
    expect(buildOutlineRibbon(noOutline, 100)).toBeNull()
    expect(buildOutlineRibbon(packet(), 0)).toBeNull()
  })
})
