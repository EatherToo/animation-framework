import { describe, expect, it } from '@jest/globals'
import { compileSkeleton } from '@/core/skeleton'
import { createSlotSet, type Attachment, type SlotData } from '@/slot/slot'
import type { SkeletonAsset } from '@/asset/importer'
import { Engine } from '@/runtime/runtime'

const sk = compileSkeleton({ name: 'region', profile: 'simple2d', bones: [{ name: 'root', parent: -1, length: 1 }] })
const rgba = { r: 1, g: 1, b: 1, a: 1 }

function asset(region: Attachment): SkeletonAsset {
  const slots: SlotData[] = [{
    id: 'body', bone: 0, order: 0, color: rgba, blend: 'normal', attachment: 'body', mask: null, zOffset: 0,
  }]
  return {
    schema: 1, source: 'native', sourceVersion: '1', unitScale: 1,
    skeleton: sk, slots, skins: new Map([['default', { id: 'default', attachments: new Map([['body', region]]) }]]),
    animations: new Map(), events: [], hash: 'region', report: { issues: [], warnings: 0, errors: 0 },
  }
}

function bbox(positions: Float32Array): { w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i + 1 < positions.length; i += 2) {
    minX = Math.min(minX, positions[i]!); maxX = Math.max(maxX, positions[i]!)
    minY = Math.min(minY, positions[i + 1]!); maxY = Math.max(maxY, positions[i + 1]!)
  }
  return { w: maxX - minX, h: maxY - minY }
}

describe('H2 region attachment geometry', () => {
  it('uses width/height instead of a unit quad', () => {
    const region: Attachment = {
      kind: 'region', id: 'body', color: rgba,
      region: { atlasKey: 'body', uvs: null, width: 4, height: 2 },
    }
    const engine = new Engine({ backend: 'cpu' })
    engine.load(asset(region))
    const packet = engine.render().packets[0]!
    const box = bbox(packet.positions)
    expect(box.w).toBeCloseTo(4, 5)
    expect(box.h).toBeCloseTo(2, 5)
  })

  it('applies pivot offset and rotation in local space', () => {
    const region: Attachment = {
      kind: 'region', id: 'body', color: rgba,
      region: {
        atlasKey: 'body', uvs: null, width: 4, height: 2,
        x: 1, y: 0, rotation: Math.PI / 2, scaleX: 1, scaleY: 1,
      },
    }
    const engine = new Engine({ backend: 'cpu' })
    engine.load(asset(region))
    const packet = engine.render().packets[0]!
    const box = bbox(packet.positions)
    expect(box.w).toBeCloseTo(2, 5)
    expect(box.h).toBeCloseTo(4, 5)
  })
})
