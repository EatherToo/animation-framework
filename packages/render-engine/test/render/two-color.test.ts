import { describe, expect, it } from '@jest/globals'
import { CpuBackend } from '@/backend/backend'
import { buildRegionPacket, type RenderAssets, type RenderFrame } from '@/render/render'

const page = {
  width: 1, height: 1, pma: true,
  data: Uint8Array.from([255, 255, 255, 128]), // PMA 白，半透明
}
const assets: RenderAssets = {
  pages: [page],
  materials: [{ id: 1, kind: 'sprite', page: 0, filter: 'nearest' }],
}

describe('two-color tint', () => {
  it('writes dark bytes and adds dark contribution by (1 - texel.a)', () => {
    const packet = buildRegionPacket({
      id: 1, positions: new Float32Array([0, 0, 2, 0, 2, 2, 0, 2]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      color: [0.2, 0.2, 0.2, 1], dark: [1, 0, 0, 1], twoColor: true,
      materialId: 1, page: 0, order: 0, depthKey: 0,
    })
    expect(packet.twoColor).toBe(true)
    expect(packet.dark?.length).toBe(16)
    const frame: RenderFrame = { packets: [packet], width: 2, height: 2, assets }
    const backend = new CpuBackend(2, 2)
    backend.draw(frame)
    const px = backend.readPixels()
    const i = (0 * 2 + 0) * 4
    expect(px[i]!).toBeGreaterThan(120) // 红被 dark 推高
    expect(px[i + 1]!).toBeLessThan(100)
    expect(px[i + 2]!).toBeLessThan(100)
  })

  it('keeps normal tint when dark is absent', () => {
    const packet = buildRegionPacket({
      id: 1, positions: new Float32Array([0, 0, 2, 0, 2, 2, 0, 2]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      color: [1, 1, 1, 1], materialId: 1, page: 0, order: 0, depthKey: 0,
    })
    expect(packet.dark).toBeUndefined()
    expect(packet.twoColor).toBeUndefined()
  })
})
