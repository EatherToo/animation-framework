import { describe, expect, it } from '@jest/globals'
import { compileSkeleton } from '@/core/skeleton'
import type { MaskLibrary, SkeletonAsset } from '@/asset/importer'
import { Engine } from '@/runtime/runtime'
import type { Attachment, SlotData } from '@/slot/slot'

const sk = compileSkeleton({ name: 'h3', profile: 'simple2d', bones: [{ name: 'root', parent: -1, length: 1 }] })
const rgba = { r: 1, g: 1, b: 1, a: 1 }
const masks: MaskLibrary = {
  version: 1,
  masks: [{
    id: 'clip', mode: 'clip', invert: false, feather: 0,
    polygon: new Float32Array([-2, -2, 0, -2, 0, 2, -2, 2]),
    startSlotId: 'clip', endSlotId: 'after',
  }],
}
const slots: SlotData[] = [
  { id: 'clip', bone: 0, order: 0, color: rgba, blend: 'normal', attachment: 'clip', mask: null, zOffset: 0 },
  { id: 'body', bone: 0, order: 1, color: rgba, blend: 'normal', attachment: 'body', mask: null, zOffset: 0 },
  { id: 'after', bone: 0, order: 2, color: rgba, blend: 'normal', attachment: 'body', mask: null, zOffset: 0 },
]
const body: Attachment = {
  kind: 'region', id: 'body', color: rgba,
  region: { atlasKey: 'body', uvs: null, width: 4, height: 4 },
}
const asset: SkeletonAsset = {
  schema: 1, source: 'native', sourceVersion: '1', unitScale: 1,
  skeleton: sk, slots, maskLibrary: masks,
  skins: new Map([['default', { id: 'default', attachments: new Map<string, Attachment>([
    ['body', body],
    ['clip', { kind: 'clipping', id: 'clip', polygon: masks.masks[0]!.polygon }],
  ]) }]]),
  animations: new Map(), events: [], hash: 'h3', report: { issues: [], warnings: 0, errors: 0 },
}

describe('H3 runtime clipping integration', () => {
  it('clips the body packet to the clipping polygon and drops the clipping slot', () => {
    const engine = new Engine({ backend: 'cpu' })
    engine.load(asset)
    const frame = engine.render()
    expect(frame.packets.some((p) => p.id === 0)).toBe(false)
    const packet = frame.packets.find((p) => p.id === 1)!
    let minX = Infinity, maxX = -Infinity
    for (let i = 0; i < packet.positions.length; i += 2) {
      minX = Math.min(minX, packet.positions[i]!)
      maxX = Math.max(maxX, packet.positions[i]!)
    }
    expect(minX).toBeGreaterThanOrEqual(-2.00001)
    expect(maxX).toBeLessThanOrEqual(0.00001)
    expect(packet.indices.length).toBeGreaterThanOrEqual(6)
  })
})
