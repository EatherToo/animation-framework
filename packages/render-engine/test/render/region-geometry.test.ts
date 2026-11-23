import { describe, expect, it } from '@jest/globals'
import { compileSkeleton } from '@/core/skeleton'
import { createSlotSet, type Attachment, type SlotData } from '@/slot/slot'
import type { SkeletonAsset } from '@/asset/importer'
import type { AtlasData, AtlasRegion } from '@/asset/atlas'
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

function withAtlas(attachment: Attachment, entry: AtlasRegion): SkeletonAsset {
  const original = asset(attachment)
  const atlas: AtlasData = {
    format: 'dsh-2d-atlas', version: 1, hash: 'trim', pma: true, colorSpace: 'srgb',
    padding: 0, bleed: 0, source: 'procedural',
    pages: [{ index: 0, width: 100, height: 100 }],
    regions: new Map([[entry.id, entry]]),
  }
  return { ...original, atlas }
}

function closeArray(actual: Float32Array, expected: readonly number[]): void {
  expect(actual.length).toBe(expected.length)
  for (let i = 0; i < expected.length; i += 1) expect(actual[i]).toBeCloseTo(expected[i]!, 4)
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

  it('matches official computeUVs offsets for trimmed region with attachment size', () => {
    const region: Attachment = {
      kind: 'region', id: 'body', color: rgba,
      region: { atlasKey: 'body', uvs: null, width: 10, height: 8, x: 1, y: 2 },
    }
    const entry: AtlasRegion = {
      id: 'body', page: 0, x: 10, y: 20, width: 8, height: 6,
      uvMatrix: Float32Array.from([0.2, 0, 0, 0.16, 0.07, 0.14]),
      trim: { offsetX: 3, offsetY: 4, sourceWidth: 20, sourceHeight: 16 }, maxMip: 0,
    }
    const engine = new Engine({ backend: 'cpu' })
    engine.load(withAtlas(region, entry))
    const packet = engine.render().packets[0]!
    // Official RegionAttachment.computeUVs: br/bl/ul/ur, local [-3.5,-2]..[0.5,1].
    closeArray(packet.positions, [-2.5, 0, -2.5, 3, 1.5, 3, 1.5, 0])
    closeArray(packet.uvs, [0.1, 0.26, 0.1, 0.2, 0.18, 0.2, 0.18, 0.26])
  })

  it('matches 90-degree atlas UV ordering and rotated local offsets', () => {
    const region: Attachment = {
      kind: 'region', id: 'body', color: rgba,
      region: { atlasKey: 'body', uvs: null, width: 10, height: 8, x: 1, y: 2, rotation: Math.PI / 2 },
    }
    const entry: AtlasRegion = {
      id: 'body', page: 0, x: 10, y: 20, width: 8, height: 6,
      uvMatrix: Float32Array.from([0, -0.2, 0.16, 0, 0.02, 0.3]),
      trim: { offsetX: 3, offsetY: 4, sourceWidth: 20, sourceHeight: 16 }, maxMip: 0,
    }
    const engine = new Engine({ backend: 'cpu' })
    engine.load(withAtlas(region, entry))
    const packet = engine.render().packets[0]!
    closeArray(packet.positions, [3, -1.5, 0, -1.5, 0, 2.5, 3, 2.5])
    closeArray(packet.uvs, [0.16, 0.28, 0.16, 0.2, 0.1, 0.2, 0.1, 0.28])
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
