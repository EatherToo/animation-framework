import { describe, expect, it } from '@jest/globals'
import {
  buildRenderPacket,
  buildRenderPackets,
  createRenderScene,
  sortRenderPackets,
  findRenderAttachment,
  meshBounds,
  setSlotAttachment,
  setSlotOrder,
  validateRenderPacket,
  type RenderAttachment,
  type RenderMesh,
  type RenderScene,
  type RenderSlot,
} from '@/pipeline2d'

function mesh(offset = 0): RenderMesh {
  return {
    positions: Float32Array.from([
      offset, 0,
      offset + 1, 0,
      offset + 1, 1,
      offset, 1,
    ]),
    uvs: new Float32Array(0),
    indices: Uint16Array.from([0, 1, 2, 2, 3, 0]),
    colors: new Uint8Array(0),
    boneIndices: new Uint16Array(0),
    weights: new Float32Array(0),
    seam: new Uint8Array(0),
    depth: Float32Array.from([0, 0, 0, 0]),
    bounds: null,
  }
}

function attachment(id: string, geometry = mesh()): RenderAttachment {
  return {
    id,
    skin: 'base',
    mesh: geometry,
    material: { kind: 'flat', color: { r: 1, g: 0, b: 0, a: 1 } },
    outline: null,
  }
}

function slot(id: string, order: number, attached: string | null): RenderSlot {
  return {
    id,
    order,
    tint: { r: 1, g: 1, b: 1, a: 1 },
    blend: 'normal',
    mask: null,
    attachment: attached,
  }
}

function sceneWith(slots: readonly RenderSlot[], attachments: readonly RenderAttachment[]): RenderScene {
  return createRenderScene(slots, [{ id: 'base', attachments }])
}

describe('pipeline2d scene', () => {
  it('R1：场景校验、附件查找与稳定主序', () => {
    const a = attachment('a', mesh(0))
    const b = attachment('b', mesh(5))
    const c = attachment('c', mesh(9))
    const scene = sceneWith(
      [slot('s0', 2, 'a'), slot('s1', 1, 'b'), slot('s2', 2, 'c')],
      [a, b, c],
    )
    expect(findRenderAttachment(scene, 'b')?.id).toBe('b')
    expect(findRenderAttachment(scene, 'missing')).toBeNull()
    const packets = buildRenderPackets(scene)
    expect(packets.map((packet) => packet.partId)).toEqual(['b', 'a', 'c'])
  })

  it('R1：换附件/改主序返回新场景，不改旧场景', () => {
    const a = attachment('a', mesh(0))
    const b = attachment('b', mesh(5))
    const scene = sceneWith([slot('s0', 2, 'a')], [a, b])
    const swapped = setSlotAttachment(scene, 's0', 'b')
    expect(scene.slots[0]!.attachment).toBe('a')
    expect(swapped.slots[0]!.attachment).toBe('b')
    expect(buildRenderPackets(swapped)[0]!.vertices[0]).toBe(5)

    const reordered = setSlotOrder(scene, 's0', 0)
    expect(reordered.slots[0]!.order).toBe(0)
    expect(scene.slots[0]!.order).toBe(2)
    expect(() => setSlotAttachment(scene, 's0', 'missing')).toThrow(/^attachment$/)
    expect(() => setSlotAttachment(scene, 'missing', 'a')).toThrow(/^slot$/)
    expect(() => setSlotOrder(scene, 's0', Number.NaN)).toThrow(/^order$/)
  })

  it('R1：空附件被跳过，非法场景按稳定错误名拒绝', () => {
    const a = attachment('a')
    const hidden = sceneWith([slot('s0', 0, null), slot('s1', 1, 'a')], [a])
    expect(buildRenderPackets(hidden)).toHaveLength(1)
    expect(() => createRenderScene([slot('s', 0, 'missing')], [])).toThrow(/^attachment$/)
    expect(() =>
      createRenderScene([slot('s', 0, 'a'), slot('s', 1, 'a')], [{ id: 'base', attachments: [a] }]),
    ).toThrow(/^slot$/)
    expect(() =>
      createRenderScene([slot('s', Number.NaN, 'a')], [{ id: 'base', attachments: [a] }]),
    ).toThrow(/^order$/)
    expect(() =>
      createRenderScene(
        [{ ...slot('s', 0, 'a'), tint: { r: 2, g: 0, b: 0, a: 1 } }],
        [{ id: 'base', attachments: [a] }],
      ),
    ).toThrow(/^tint$/)
    const badDepth = { ...mesh(), depth: new Float32Array(3) }
    expect(() => sceneWith([slot('s', 0, 'a')], [attachment('a', badDepth)])).toThrow(/^depth$/)
    const badIndex = { ...mesh(), indices: Uint16Array.from([0, 1, 9]) }
    expect(() => sceneWith([slot('s', 0, 'a')], [attachment('a', badIndex)])).toThrow(/^mesh$/)
  })
})

describe('pipeline2d packet', () => {
  it('R1：渲染包版本、长度、颜色与默认 UV', () => {
    const scene = sceneWith([slot('s0', 0, 'a')], [attachment('a')])
    const [packet] = buildRenderPackets(scene)
    expect(packet).toBeDefined()
    expect(packet!.version).toBe(2)
    expect(packet!.partId).toBe('a')
    expect(packet!.vertices).toHaveLength(8)
    expect(packet!.uvs).toHaveLength(8)
    expect(packet!.colors).toHaveLength(16)
    expect(packet!.atlasPage).toBe(-1)
    expect(Array.from(packet!.colors.subarray(0, 4))).toEqual([255, 0, 0, 255])
    expect(() => validateRenderPacket(packet!)).not.toThrow()
  })

  it('R1：slot tint 与材质色相乘；atlas 页与顶点色走同一契约', () => {
    const tinted = sceneWith(
      [{ ...slot('s0', 0, 'a'), tint: { r: 0.5, g: 1, b: 1, a: 0.5 } }],
      [attachment('a')],
    )
    const [packet] = buildRenderPackets(tinted)
    expect(Array.from(packet!.colors.subarray(0, 4))).toEqual([128, 0, 0, 128])

    const atlas: RenderAttachment = {
      ...attachment('a'),
      material: {
        kind: 'atlas',
        page: 2,
        region: { x: 0, y: 0, width: 16, height: 16 },
        tint: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
        filter: 'linear',
      },
    }
    const [atlasPacket] = buildRenderPackets(sceneWith([slot('s', 0, 'a')], [atlas]))
    expect(atlasPacket!.atlasPage).toBe(2)
    expect(Array.from(atlasPacket!.colors.subarray(0, 4))).toEqual([128, 128, 128, 255])
  })

  it('R5：同 order 时深度大的先画，深度相同保持稳定', () => {
    const near = attachment('near', { ...mesh(), depth: Float32Array.from([0, 0, 0, 0]) })
    const far = attachment('far', { ...mesh(), depth: Float32Array.from([1, 1, 1, 1]) })
    const scene = sceneWith([slot('near', 0, 'near'), slot('far', 0, 'far')], [near, far])
    expect(buildRenderPackets(scene).map((packet) => packet.partId)).toEqual(['far', 'near'])
    const packets = buildRenderPackets(scene)
    expect(sortRenderPackets(packets).map((packet) => packet.partId)).toEqual(['far', 'near'])
  })

  it('R1：非法渲染包被拒绝；meshBounds 可算包围盒', () => {
    const packet = buildRenderPacket(slot('s', 0, 'a'), attachment('a'))
    expect(meshBounds(packet.vertices)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(() => validateRenderPacket({ ...packet, version: 1 as 2 })).toThrow(/^version$/)
    expect(() => validateRenderPacket({ ...packet, materialId: -2 })).toThrow(/^material$/)
    expect(() => validateRenderPacket({ ...packet, uvs: new Float32Array(2) })).toThrow(/^uvs$/)
    expect(() => validateRenderPacket({ ...packet, depth: new Float32Array(2) })).toThrow(/^depth$/)
    expect(() => validateRenderPacket({ ...packet, indices: Uint16Array.from([0, 1, 9]) })).toThrow(/^indices$/)
  })
})
