import { describe, expect, it } from '@jest/globals'
import { compileSkeleton } from '@/core/skeleton'
import { importSpine, type MaskLibrary, type SkeletonAsset } from '@/asset/importer'
import { Engine } from '@/runtime/runtime'
import { maskChain } from '@/render/render'
import { WebGL2Backend } from '@/backend/backend'
import { FakeWebGL } from '../render/fake-webgl'
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
    expect(packet.maskPath).toBe(-1)
    const gl = new FakeWebGL()
    new WebGL2Backend(gl).draw(frame)
    expect(gl.argsOf('drawElements')).toHaveLength(frame.packets.length)
    expect(gl.argsOf('enable')).not.toContainEqual([0x0b90])
  })

  it('preserves alpha masking after consuming the enclosing stencil on the CPU', () => {
    const masked: SkeletonAsset = {
      ...asset,
      slots: slots.map((slot) => slot.id === 'body' ? { ...slot, mask: 'alpha' } : slot),
      maskLibrary: { version: 1, masks: [masks.masks[0]!, {
        id: 'alpha', mode: 'alpha', invert: false, feather: 0,
        polygon: new Float32Array([-2, -2, 0, -2, 0, 2, -2, 2]),
        startSlotId: 'clip', endSlotId: 'after',
      }] },
    }
    const engine = new Engine({ backend: 'cpu' })
    engine.load(masked)
    const frame = engine.render()
    const packet = frame.packets.find((p) => p.id === 1)!
    expect(Math.max(...Array.from(packet.positions).filter((_, i) => i % 2 === 0))).toBeLessThanOrEqual(0.00001)
    expect(maskChain(packet.maskPath, frame.maskPaths!).ids).toEqual([1])
    expect(frame.masks!.masks[1]!.mode).toBe('alpha')
    expect(frame.packets.find((p) => p.id === 2)!.maskPath).toBe(-1)
  })

  it('leaves inverse stencil geometry to the backend instead of CPU-clipping it', () => {
    const inverted: SkeletonAsset = {
      ...asset,
      maskLibrary: { version: 1, masks: [{ ...masks.masks[0]!, invert: true }] },
    }
    const engine = new Engine({ backend: 'cpu' })
    engine.load(inverted)
    const frame = engine.render()
    const packet = frame.packets.find((p) => p.id === 1)!
    expect(Math.max(...Array.from(packet.positions).filter((_, i) => i % 2 === 0))).toBeGreaterThan(0)
    expect(maskChain(packet.maskPath, frame.maskPaths!).ids).toEqual([0])
  })

  it('clips imported Spine JSON including the end slot, then follows attachment changes', () => {
    const imported = importSpine({
      skeleton: { spine: '4.2.0' }, bones: [{ name: 'root' }],
      slots: [
        { name: 'clipSlot', bone: 'root', attachment: 'cut', blend: 'additive' },
        { name: 'middle', bone: 'root', attachment: 'body' },
        { name: 'end', bone: 'root', attachment: 'body', blend: 'additive' },
        { name: 'outside', bone: 'root', attachment: 'body' },
      ],
      skins: [{ name: 'default', attachments: {
        clipSlot: { cut: { type: 'clipping', end: 'end', vertexCount: 4, vertices: [-2, -2, 0, -2, 0, 2, -2, 2] },
          noCut: { type: 'region', width: 4, height: 4 } },
        middle: { body: { type: 'region', width: 4, height: 4 } },
        end: { body: { type: 'region', width: 4, height: 4 } },
        outside: { body: { type: 'region', width: 4, height: 4 } },
      } }],
    }, { unitScale: 1 })
    const engine = new Engine({ backend: 'cpu' })
    engine.load(imported)
    const maxX = (id: number): number => {
      const positions = engine.render().packets.find((p) => p.id === id)!.positions
      return Math.max(...Array.from(positions).filter((_, index) => index % 2 === 0))
    }
    expect(engine.render().packets.some((p) => p.id === 0)).toBe(false)
    expect(maxX(1)).toBeLessThanOrEqual(0.00001)
    expect(maxX(2)).toBeLessThanOrEqual(0.00001)
    expect(maxX(3)).toBeGreaterThan(0)
    engine.setAttachment('clipSlot', 'noCut')
    expect(maxX(1)).toBeGreaterThan(0)
    engine.setAttachment('clipSlot', 'cut')
    expect(maxX(1)).toBeLessThanOrEqual(0.00001)
  })

  it('builds clipping geometry from the active attachment without a mask library', () => {
    const { maskLibrary: _cached, ...uncached } = asset
    const dynamic: SkeletonAsset = {
      ...uncached,
      skins: new Map([['default', { id: 'default', attachments: new Map<string, Attachment>([
        ['body', body],
        ['clip', { kind: 'clipping', id: 'clip', endSlotId: 'after',
          polygon: new Float32Array([0, -2, 2, -2, 2, 2, 0, 2]) }],
      ]) }]]),
    }
    const engine = new Engine({ backend: 'cpu' })
    engine.load(dynamic)
    const frame = engine.render()
    expect(frame.maskPaths).toHaveLength(1)
    expect(frame.masks?.masks).toHaveLength(1)
    const xs = Array.from(frame.packets.find((packet) => packet.id === 1)!.positions)
      .filter((_, i) => i % 2 === 0)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-0.00001)
  })

  it('ignores a nested clipping attachment until the outer scope ends', () => {
    const nestedSlots: SlotData[] = [
      { ...slots[0]!, id: 'outer', attachment: 'outer' },
      { ...slots[0]!, id: 'inner', order: 1, attachment: 'inner' },
      { ...slots[1]!, order: 2 },
      { ...slots[2]!, order: 3, blend: 'add' },
    ]
    const nestedAsset: SkeletonAsset = {
      ...asset, slots: nestedSlots,
      maskLibrary: { version: 1, masks: [
        { ...masks.masks[0]!, id: '0:outer', startSlotId: 'outer' },
        { ...masks.masks[0]!, id: '1:inner', startSlotId: 'inner', polygon: new Float32Array([0, -2, 2, -2, 2, 2, 0, 2]) },
      ] },
      skins: new Map([['default', { id: 'default', attachments: new Map<string, Attachment>([
        ['outer', { kind: 'clipping', id: 'outer', polygon: masks.masks[0]!.polygon, endSlotId: 'after' }],
        ['inner', { kind: 'clipping', id: 'inner', polygon: new Float32Array([0, -2, 2, -2, 2, 2, 0, 2]), endSlotId: 'body' }],
        ['body', body],
      ]) }]]),
    }
    const engine = new Engine({ backend: 'cpu' })
    engine.load(nestedAsset)
    const frame = engine.render()
    expect(frame.maskPaths).toHaveLength(1)
    expect(frame.packets.map((packet) => packet.id)).toEqual([2, 3])
    for (const packet of frame.packets) {
      const xs = Array.from(packet.positions).filter((_, i) => i % 2 === 0)
      expect(Math.max(...xs)).toBeLessThanOrEqual(0.00001)
    }
  })
})
