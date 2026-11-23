import { describe, expect, it } from '@jest/globals'
import { CpuBackend } from '@/backend/backend'
import { batchPackets, buildRegionPacket, type RenderFrame, type RenderPacket } from '@/render/render'

const width = 192
const height = 108

function render(packets: RenderPacket[], depthMode?: RenderFrame['depthMode']): Uint8ClampedArray {
  const cpu = new CpuBackend({ width, height, background: [17.5, 23, 31, 128] })
  cpu.draw({ width, height, packets, ...(depthMode === undefined ? {} : { depthMode }) })
  return cpu.readPixels()
}

describe('opaque flat CPU raster path', () => {
  it('matches general rasterization exactly for batched fractional quads and triangle edges', () => {
    const packets: RenderPacket[] = []
    for (let i = 0; i < 40; i += 1) {
      const x = 3.125 + (i % 8) * 23
      const y = 2.375 + Math.floor(i / 8) * 20
      packets.push(buildRegionPacket({
        id: i, positions: new Float32Array([x, y, x + 19.25, y, x + 19.25, y + 17.5, x, y + 17.5]),
        color: [i % 3 / 2, (i + 1) % 4 / 3, 0.5, 1],
        materialId: 0, order: i, depthKey: 0, seq: i,
      }))
    }
    const batched = batchPackets(packets)
    expect(batched).toHaveLength(1)
    expect(render(batched)).toEqual(render(batched, 'test'))
  })

  it('keeps translucent blend and per-vertex colors on the general path', () => {
    const opaque = buildRegionPacket({
      id: 1, positions: new Float32Array([4, 4, 85, 4, 85, 78, 4, 78]),
      color: [0.2, 0.7, 0.4, 1], materialId: 0, order: 0, depthKey: 0,
    })
    const translucent = buildRegionPacket({
      id: 2, positions: new Float32Array([15, 15, 100, 15, 100, 90, 15, 90]),
      color: [0.5, 0.1, 0.2, 0.5], materialId: 0, order: 1, depthKey: 0,
    })
    expect(render([opaque, translucent])).toEqual(render([opaque, translucent], 'test'))
  })
})
