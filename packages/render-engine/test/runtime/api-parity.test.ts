import { describe, expect, it } from '@jest/globals'
import { compileSkeleton } from '@/core/skeleton'
import { markAllDirty, updateWorld } from '@/core/pose'
import type { SkeletonAsset } from '@/asset/importer'
import type { Attachment, SlotData } from '@/slot/slot'
import { Engine } from '@/runtime/runtime'
import type { AnimationClip } from '@/animation/animation'

const sk = compileSkeleton({ name: 'api', profile: 'simple2d', bones: [{ name: 'root', parent: -1, length: 1 }] })
const rgba = { r: 1, g: 1, b: 1, a: 1 }
const slot: SlotData = { id: 'body', bone: 0, order: 0, color: rgba, blend: 'normal', attachment: 'a', mask: null, zOffset: 0 }
const a: Attachment = { kind: 'region', id: 'a', color: rgba, region: { atlasKey: 'a', uvs: null, width: 2, height: 2, x: 1 } }
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
  it('exposes animation mixing data and the played track', () => {
    const engine = new Engine({ backend: 'cpu' })
    expect(() => engine.state).toThrow('E_NO_ASSET')
    const animations = new Map<string, AnimationClip>([
      ['walk', { name: 'walk', duration: 1, timelines: [] }],
      ['run', { name: 'run', duration: 1, timelines: [] }],
    ])
    engine.load({ ...asset, animations })
    engine.state.data.setMix('walk', 'run', 0.4)
    expect(engine.play('walk')?.clip.name).toBe('walk')
    const next = engine.play('run')
    expect(next?.clip.name).toBe('run')
    expect(next?.mixDuration).toBe(0.4)
  })

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

  it('restores setup bones and slots without updating world or stopping tracks', () => {
    const engine = new Engine({ backend: 'cpu' })
    engine.load({ ...asset, animations: new Map([['walk', { name: 'walk', duration: 1, timelines: [] }]]) })
    const track = engine.play('walk')!
    engine.pose.local[0] = 4
    markAllDirty(engine.pose)
    updateWorld(engine.pose)
    const beforeWorld = engine.pose.world.slice()
    engine.setAttachment('body', 'b')
    engine.setupPoseBones()
    expect(engine.pose.local[0]).toBe(sk.setupLocal[0])
    expect(engine.pose.world).toEqual(beforeWorld)
    expect(engine.slotSet.slots[0]!.attachmentId).toBe('b')
    engine.setupPoseSlots()
    expect(engine.slotSet.slots[0]!.attachmentId).toBe('a')
    expect(engine.state.tracks).toContain(track)
    engine.setToSetupPose()
    expect(engine.state.tracks).toContain(track)
    engine.setupPose({ stopOnSetupPose: true })
    expect(engine.state.tracks).toHaveLength(0)
    engine.dispose()
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

describe('runtime instance transform', () => {
  it('applies instance scale and flip to rendered geometry', () => {
    const engine = new Engine({ backend: 'cpu' })
    engine.load(asset)
    engine.setScale(2, 3)
    engine.update(0)
    const scaled = engine.getBounds()
    expect(scaled.width).toBeCloseTo(4, 5)
    expect(scaled.height).toBeCloseTo(6, 5)
    engine.setFlip(true, false)
    engine.update(0)
    const packet = engine.render().packets[0]!
    let maxX = -Infinity
    for (let i = 0; i < packet.positions.length; i += 2) maxX = Math.max(maxX, packet.positions[i]!)
    expect(maxX).toBeLessThanOrEqual(0)
  })
})

describe('runtime debug overlay', () => {
  it('exposes debug lines only after a rendered frame and only when flags are on', () => {
    const engine = new Engine({ backend: 'cpu' })
    engine.load(asset)
    expect(engine.debugLines({ bones: true })).toEqual([])
    engine.render()
    expect(engine.debugLines({ bones: true }).length).toBeGreaterThan(0)
    expect(engine.debugLines({})).toEqual([])
  })
})
