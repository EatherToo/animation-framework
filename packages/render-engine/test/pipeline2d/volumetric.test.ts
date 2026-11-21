import { describe, expect, it } from '@jest/globals'
import { buildVolumetricPackets } from '@/pipeline2d'

const parts = [
  {
    partId: 'torso',
    positions: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: Uint16Array.from([0, 1, 2, 0, 2, 3]),
    seam: new Uint8Array(4),
    depth: 0,
  },
  {
    partId: 'head',
    positions: Float32Array.from([2, 2, 3, 2, 3, 3, 2, 3]),
    indices: Uint16Array.from([0, 1, 2, 0, 2, 3]),
    seam: new Uint8Array(4),
    depth: 1,
  },
]

describe('pipeline2d volumetric', () => {
  it('3D 代理投影转 RenderPacket，远部件先画', () => {
    const packets = buildVolumetricPackets(parts)
    expect(packets.map((packet) => packet.partId)).toEqual(['head', 'torso'])
    expect(packets[0]!.depth[0]).toBe(1)
    expect(packets[0]!.colors[0]).toBeGreaterThan(0)
    expect(packets[0]!.outline).not.toBeNull()
    expect(packets[0]!.bounds.width).toBeCloseTo(1, 6)
  })
})
