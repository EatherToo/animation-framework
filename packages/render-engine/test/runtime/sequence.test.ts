import { describe, expect, it } from '@jest/globals'
import { compileSkeleton } from '@/core/skeleton'
import type { SkeletonAsset } from '@/asset/importer'
import type { AtlasData } from '@/asset/atlas'
import type { Attachment } from '@/slot/slot'
import type { AnimationClip } from '@/animation/animation'
import { Engine } from '@/runtime/runtime'

const sk = compileSkeleton({ name: 'seq', profile: 'simple2d', bones: [{ name: 'root', parent: -1, length: 1 }] })
const rgba = { r: 1, g: 1, b: 1, a: 1 }
const atlas: AtlasData = {
  format: 'dsh-2d-atlas', version: 1, hash: 'seq', pma: true, colorSpace: 'srgb', padding: 0, bleed: 0, source: 'procedural',
  pages: [{ index: 0, width: 2, height: 1, image: { width: 2, height: 1, data: Uint8Array.from([255,0,0,255, 0,255,0,255]) } }],
  regions: new Map([
    ['s0', { id: 's0', page: 0, x: 0, y: 0, width: 1, height: 1, uvMatrix: Float32Array.from([0.5, 0, 0, 1, 0.25, 0]), trim: { offsetX: 0, offsetY: 0, sourceWidth: 1, sourceHeight: 1 }, maxMip: 0 }],
    ['s1', { id: 's1', page: 0, x: 1, y: 0, width: 1, height: 1, uvMatrix: Float32Array.from([0.5, 0, 0, 1, 0.75, 0]), trim: { offsetX: 0, offsetY: 0, sourceWidth: 1, sourceHeight: 1 }, maxMip: 0 }],
  ]),
}
const region: Attachment = {
  kind: 'region', id: 's0', color: rgba,
  region: { atlasKey: 's0', uvs: null, width: 2, height: 2, sequence: { frames: ['s0', 's1'], setupIndex: 0 } },
}
const clip: AnimationClip = { name: 'seq', duration: 1, timelines: [
  { kind: 'sequence', slot: 0, keys: [{ time: 0, value: 1 }] },
] }
const asset: SkeletonAsset = {
  schema: 1, source: 'native', sourceVersion: '1', unitScale: 1, skeleton: sk, atlas,
  slots: [{ id: 's', bone: 0, order: 0, color: rgba, blend: 'normal', attachment: 's0', mask: null, zOffset: 0 }],
  skins: new Map([['default', { id: 'default', attachments: new Map<string, Attachment>([['s0', region]]) }]]),
  animations: new Map([['seq', clip]]), events: [], hash: 'seq', report: { issues: [], warnings: 0, errors: 0 },
}

describe('sequence runtime', () => {
  it('switches region UV by sequence timeline without rebuilding geometry', () => {
    const engine = new Engine({ backend: 'cpu' })
    engine.load(asset)
    engine.play('seq')
    engine.update(0)
    const packet = engine.render().packets[0]!
    expect(packet.uvs[0]).toBeCloseTo(0.75, 5) // s1 的 u0
    expect(packet.positions[0]).toBeCloseTo(-1, 5)
  })
})
