import { describe, expect, it } from '@jest/globals'
import { compileSkeleton } from '@/core/skeleton'
import type { SkeletonAsset } from '@/asset/importer'
import type { Attachment, SlotData } from '@/slot/slot'
import type { AnimationClip } from '@/animation/animation'
import { Engine } from '@/runtime/runtime'

const sk = compileSkeleton({ name: 'anim-rt', profile: 'simple2d', bones: [{ name: 'root', parent: -1, length: 1 }] })
const rgba = { r: 1, g: 1, b: 1, a: 1 }
const mesh: Attachment = {
  kind: 'mesh', id: 'm', color: rgba,
  region: { atlasKey: 'm', uvs: null },
  mesh: {
    id: 'm', bone: 0, vertexSpace: 'boneLocal',
    positions: new Float32Array([0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    indices: new Uint16Array([0, 1, 2]),
  },
}
const slots: SlotData[] = [
  { id: 'a', bone: 0, order: 0, color: rgba, blend: 'normal', attachment: 'm', mask: null, zOffset: 0 },
  { id: 'b', bone: 0, order: 1, color: rgba, blend: 'normal', attachment: 'm', mask: null, zOffset: 0 },
]
const clip: AnimationClip = {
  name: 'move', duration: 1,
  timelines: [
    { kind: 'deform', slot: 0, skin: 'default', attachment: 'm', keys: [
      { time: 0, offset: 0, vertices: new Float32Array([1, 0, 0, 0, 0, 0]) },
      { time: 1, offset: 0, vertices: new Float32Array([1, 0, 0, 0, 0, 0]) },
    ] },
    { kind: 'drawOrder', keys: [{ time: 0, offsets: [{ slot: 0, offset: 1 }] }] },
  ],
}
const asset: SkeletonAsset = {
  schema: 1, source: 'native', sourceVersion: '1', unitScale: 1,
  skeleton: sk, slots, animations: new Map([['move', clip]]), events: [], hash: 'anim-rt',
  skins: new Map([['default', { id: 'default', attachments: new Map<string, Attachment>([['m', mesh]]) }]]),
  report: { issues: [], warnings: 0, errors: 0 },
}

describe('runtime animation application', () => {
  it('applies deform offsets and drawOrder from AnimationState', () => {
    const engine = new Engine({ backend: 'cpu' })
    engine.load(asset)
    engine.play('move')
    engine.update(0)
    expect(engine.slotSet.drawOrder).toEqual([1, 0])
    const packets = engine.render().packets
    expect(packets.some((p) => [...p.positions].some((v, i) => i % 2 === 0 && Math.abs(v - 1) < 1e-5))).toBe(true) // 原 0 + deform 1
  })
})
