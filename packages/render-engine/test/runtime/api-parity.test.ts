import { describe, expect, it } from '@jest/globals'
import { compileSkeleton } from '@/core/skeleton'
import type { SkeletonAsset } from '@/asset/importer'
import type { Attachment, SlotData } from '@/slot/slot'
import { Engine } from '@/runtime/runtime'

const sk = compileSkeleton({ name: 'api', profile: 'simple2d', bones: [{ name: 'root', parent: -1, length: 1 }] })
const rgba = { r: 1, g: 1, b: 1, a: 1 }
const slot: SlotData = { id: 'body', bone: 0, order: 0, color: rgba, blend: 'normal', attachment: 'a', mask: null, zOffset: 0 }
const a: Attachment = { kind: 'region', id: 'a', color: rgba, region: { atlasKey: 'a', uvs: null, width: 2, height: 2 } }
const b: Attachment = { kind: 'region', id: 'b', color: { r: 0, g: 1, b: 0, a: 1 }, region: { atlasKey: 'b', uvs: null, width: 4, height: 2 } }
const asset: SkeletonAsset = {
  schema: 1, source: 'native', sourceVersion: '1', unitScale: 1,
  skeleton: sk, slots: [slot], animations: new Map(), events: [], hash: 'api',
  skins: new Map([
    ['default', { id: 'default', attachments: new Map<string, Attachment>([['a', a], ['b', b]]) }],
    ['alt', { id: 'alt', attachments: new Map<string, Attachment>([['a', b]]) }],
  ]),
  report: { issues: [], warnings: 0, errors: 0 },
}

describe('runtime API parity', () => {
  it('switches skins and attachments without touching pose', () => {
    const engine = new Engine({ backend: 'cpu' })
    engine.load(asset)
    const before = engine.pose.local.slice()
    engine.setSkinByName('alt')
    expect(engine.slotSet.slots[0]!.attachmentId).toBe('a')
    engine.setAttachment('body', 'b')
    expect(engine.slotSet.slots[0]!.attachmentId).toBe('b')
    expect(engine.pose.local).toEqual(before)
  })

  it('resets to setup pose and computes bounds from actual geometry', () => {
    const engine = new Engine({ backend: 'cpu' })
    engine.load(asset)
    engine.setAttachment('body', 'b')
    engine.slotSet.slots[0]!.color = { r: 0, g: 0, b: 1, a: 1 }
    engine.setToSetupPose()
    expect(engine.slotSet.slots[0]!.attachmentId).toBe('a')
    expect(engine.slotSet.slots[0]!.color).toEqual(rgba)
    const bounds = engine.getBounds()
    expect(bounds.width).toBeCloseTo(2, 5)
    expect(bounds.height).toBeCloseTo(2, 5)
  })
})
