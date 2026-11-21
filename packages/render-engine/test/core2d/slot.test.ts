import { describe, expect, it } from '@jest/globals'
import {
  createSlotSet,
  isRenderable,
  resolveAttachment,
  setDrawOrder,
  setSkin,
  setSlotAttachment,
  setSlotColor,
  validateDrawOrder,
  type Attachment,
  type SkinData,
  type SlotData,
} from '@/core2d/slot'

const color = (r = 1, g = 1, b = 1, a = 1) => ({ r, g, b, a })
const region = (id: string): Attachment => ({
  kind: 'region', id, region: { atlasKey: id, uvs: null }, color: color(),
})
const slots: SlotData[] = [
  { id: 'body', bone: 0, order: 0, color: color(), blend: 'normal', attachment: 'torso', mask: null, zOffset: 0 },
  { id: 'head', bone: 1, order: 1, color: color(), blend: 'normal', attachment: 'head', mask: null, zOffset: 1 },
]
const skins = (): ReadonlyMap<string, SkinData> => new Map([
  ['default', { id: 'default', attachments: new Map([['torso', region('torso')], ['head', region('head')]]) }],
  ['armor', { id: 'armor', attachments: new Map([['torso', region('torsoArmor')], ['head', region('head')]]) }],
])

describe('core2d slot / attachment / skin', () => {
  it('resolves attachments from the active skin without touching draw order', () => {
    const set = createSlotSet(slots, skins(), 'default')
    expect(resolveAttachment(set, 0)?.id).toBe('torso')
    const before = [...set.drawOrder]
    setSkin(set, 'armor')
    expect(resolveAttachment(set, 0)?.id).toBe('torsoArmor')
    expect(set.drawOrder).toEqual(before)
    expect(set.slots[0]!.attachmentId).toBe('torso')
    expect(() => setSkin(set, 'missing')).toThrow()
  })

  it('supports per-slot attachment overrides and null attachments', () => {
    const set = createSlotSet(slots, skins(), 'default')
    setSlotAttachment(set, 0, 'head')
    expect(resolveAttachment(set, 0)?.id).toBe('head')
    setSlotAttachment(set, 0, null)
    expect(resolveAttachment(set, 0)).toBeNull()
    expect(() => setSlotAttachment(set, 5, 'torso')).toThrow()
  })

  it('validates draw order as a full permutation', () => {
    expect(validateDrawOrder([1, 0], 2)).toBe(true)
    expect(validateDrawOrder([0, 0], 2)).toBe(false)
    expect(validateDrawOrder([0], 2)).toBe(false)
    expect(validateDrawOrder([0, 2], 2)).toBe(false)
    const set = createSlotSet(slots, skins(), 'default')
    setDrawOrder(set, [1, 0])
    expect(set.drawOrder).toEqual([1, 0])
    expect(() => setDrawOrder(set, [0, 0])).toThrow()
  })

  it('only region/mesh/weightedMesh attachments are renderable', () => {
    expect(isRenderable(region('a'))).toBe(true)
    expect(isRenderable({ kind: 'mesh', id: 'm', mesh: {} as never, region: { atlasKey: 'm', uvs: null }, color: color() })).toBe(true)
    expect(isRenderable({ kind: 'weightedMesh', id: 'w', mesh: {} as never, region: { atlasKey: 'w', uvs: null }, color: color() })).toBe(true)
    expect(isRenderable({ kind: 'boundingBox', id: 'b', polygon: new Float32Array() })).toBe(false)
    expect(isRenderable({ kind: 'path', id: 'p', polygon: new Float32Array() })).toBe(false)
    expect(isRenderable({ kind: 'point', id: 'p', point: [0, 0] })).toBe(false)
    expect(isRenderable({ kind: 'clipping', id: 'c', polygon: new Float32Array() })).toBe(false)
  })

  it('packs animation color updates into slot state', () => {
    const set = createSlotSet(slots, skins(), 'default')
    setSlotColor(set, 0, 0x80ff0000)
    expect(set.slots[0]!.color).toEqual({ r: 1, g: 0, b: 0, a: 128 / 255 })
  })

  it('keeps slot state isolated from the source slot data', () => {
    const set = createSlotSet(slots, skins(), 'default')
    setSkin(set, 'armor')
    expect(slots[0]!.attachment).toBe('torso')
    expect(set.slots[1]!.skinId).toBe('armor')
  })
})
