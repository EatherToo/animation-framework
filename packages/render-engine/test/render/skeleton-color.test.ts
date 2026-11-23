import { describe, expect, it } from '@jest/globals'
import { compileSkeleton } from '@/core/skeleton'
import { Engine } from '@/runtime/runtime'
import type { SkeletonAsset } from '@/asset/importer'
import type { Attachment, RGBA, SlotData } from '@/slot/slot'

const white: RGBA = { r: 1, g: 1, b: 1, a: 1 }
const slotColors: RGBA[] = [
  { r: 0.73, g: 0.41, b: 0.82, a: 0.76 },
  { r: 0.39, g: 0.92, b: 0.56, a: 0.67 },
]
const attachmentColor: RGBA = { r: 0.64, g: 0.87, b: 0.52, a: 0.69 }
const darkColors: RGBA[] = [
  { r: 0.28, g: 0.53, b: 0.91, a: 0 },
  { r: 0.71, g: 0.12, b: 0.44, a: 0 },
]
const skeleton = compileSkeleton({
  name: 'tint', profile: 'simple2d', bones: [{ name: 'root', parent: -1, length: 1 }],
})
const slots: SlotData[] = slotColors.map((color, index) => ({
  id: `slot${index}`, bone: 0, order: index, color, dark: darkColors[index]!,
  blend: 'normal', attachment: `region${index}`, mask: null, zOffset: 0,
}))
const attachments = new Map<string, Attachment>(slots.map((_, index) => [
  `region${index}`, { kind: 'region', id: `region${index}`,
    region: { atlasKey: `region${index}`, uvs: null }, color: attachmentColor },
]))
const asset: SkeletonAsset = {
  schema: 1, source: 'native', sourceVersion: 'test', unitScale: 1,
  skeleton, slots, skins: new Map([['default', { id: 'default', attachments }]]),
  animations: new Map(), events: [], hash: 'tint', report: { issues: [], warnings: 0, errors: 0 },
}

// Independent numeric oracle: SkeletonRendererCore 4.3.13, PMA branch, lines 129-142.
function officialBytes(s: RGBA, slot: RGBA, attachment: RGBA, dark: RGBA): number[] {
  const a = Math.floor(s.a * slot.a * attachment.a * 255)
  return [
    Math.floor(a * s.r * slot.r * attachment.r),
    Math.floor(a * s.g * slot.g * attachment.g),
    Math.floor(a * s.b * slot.b * attachment.b), a,
    Math.floor(dark.r * a), Math.floor(dark.g * a), Math.floor(dark.b * a), 255,
  ]
}

function assertVertex(packet: ReturnType<Engine['render']>['packets'][number], vertex: number, expected: number[]): void {
  expect(Array.from(packet.colors.slice(vertex * 4, vertex * 4 + 4))).toEqual(expected.slice(0, 4))
  expect(Array.from(packet.dark!.slice(vertex * 4, vertex * 4 + 4))).toEqual(expected.slice(4))
}

describe('Spine skeleton.color PMA vertex semantics', () => {
  it('defaults to white, mutates per engine, and survives same-material batching', () => {
    const engine = new Engine({ backend: 'cpu' })
    const independent = new Engine({ backend: 'cpu' })
    engine.load(asset)
    independent.load(asset)
    expect(engine.color).toEqual(white)
    let frame = engine.render()
    expect(frame.packets).toHaveLength(1)
    for (let index = 0; index < 2; index++) {
      for (let v = 0; v < 4; v++) {
        assertVertex(frame.packets[0]!, index * 4 + v,
          officialBytes(white, slotColors[index]!, attachmentColor, darkColors[index]!))
      }
    }
    engine.color.r = 0.43
    engine.color.g = 0.78
    engine.color.b = 0.27
    engine.color.a = 0.59
    frame = engine.render()
    expect(frame.packets).toHaveLength(1)
    expect(officialBytes(engine.color, slotColors[0]!, attachmentColor, darkColors[0]!))
      .toEqual([15, 21, 8, 78, 21, 41, 70, 255])
    for (let index = 0; index < 2; index++) {
      for (let v = 0; v < 4; v++) {
        assertVertex(frame.packets[0]!, index * 4 + v,
          officialBytes(engine.color, slotColors[index]!, attachmentColor, darkColors[index]!))
      }
    }
    expect(independent.color).toEqual(white)
    assertVertex(independent.render().packets[0]!, 0,
      officialBytes(white, slotColors[0]!, attachmentColor, darkColors[0]!))
    engine.dispose()
    independent.dispose()
  })

  it('writes the same official tint bytes on mesh vertices', () => {
    const mesh: Attachment = {
      kind: 'mesh', id: 'mesh', color: attachmentColor,
      region: { atlasKey: 'mesh', uvs: null },
      mesh: { id: 'mesh', bone: 0, vertexSpace: 'boneLocal',
        positions: new Float32Array([0, 0, 1, 0, 0, 1]),
        uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
        indices: new Uint16Array([0, 1, 2]) },
    }
    const meshAsset: SkeletonAsset = {
      ...asset, slots: [{ ...slots[0]!, attachment: 'mesh' }],
      skins: new Map([['default', { id: 'default', attachments: new Map([['mesh', mesh]]) }]]),
    }
    const engine = new Engine({ backend: 'cpu' })
    engine.load(meshAsset)
    Object.assign(engine.color, { r: 0.43, g: 0.78, b: 0.27, a: 0.59 })
    const packet = engine.render().packets[0]!
    expect(packet.kind).toBe('mesh')
    expect(packet.colors).toHaveLength(12)
    for (let vertex = 0; vertex < 3; vertex++) {
      assertVertex(packet, vertex, officialBytes(engine.color, slotColors[0]!, attachmentColor, darkColors[0]!))
    }
    engine.dispose()
  })
})
