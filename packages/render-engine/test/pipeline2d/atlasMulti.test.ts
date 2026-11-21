import { describe, expect, it } from '@jest/globals'
import {
  applyHumanoidAtlas,
  createRenderScene,
  type Atlas,
  type HumanoidAtlas,
  type RenderAttachment,
  type RenderMesh,
} from '@/pipeline2d'

const mesh: RenderMesh = {
  positions: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
  indices: Uint16Array.from([0, 1, 2, 0, 2, 3]),
  uvs: new Float32Array(8),
  colors: new Uint8Array(0),
  boneIndices: new Uint16Array(0),
  weights: new Float32Array(0),
  depth: new Float32Array(4),
  seam: new Uint8Array(4),
  bounds: { x: 0, y: 0, width: 1, height: 1 },
}

function attachment(id: string): RenderAttachment {
  return {
    id,
    skin: 'base',
    mesh,
    material: { kind: 'flat', color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } },
    outline: null,
  }
}

function page(width: number, height: number, regionX: number): Atlas {
  return {
    width,
    height,
    padding: 2,
    pma: false,
    regions: [{ id: 'torso', x: regionX, y: 4, width: 32, height: 64 }],
  }
}

describe('pipeline2d multi-page atlas', () => {
  it('R3：附件按 region 的 page 绑定，UV 仍是 region 局部', () => {
    const atlas: HumanoidAtlas = {
      pages: [
        { atlas: page(128, 128, 4), image: { width: 128, height: 128, rgba: new Uint8Array(128 * 128 * 4), pma: false } },
        { atlas: page(256, 256, 8), image: { width: 256, height: 256, rgba: new Uint8Array(256 * 256 * 4), pma: false } },
      ],
      regions: new Map([
        ['torso', { page: 1, region: { id: 'torso', x: 8, y: 4, width: 32, height: 64 } }],
        ['head', { page: 0, region: { id: 'head', x: 4, y: 4, width: 16, height: 16 } }],
      ]),
    }
    const scene = createRenderScene(
      [
        { id: 'a', order: 0, attachment: 'torso', tint: { r: 1, g: 1, b: 1, a: 1 }, blend: 'normal', mask: null },
        { id: 'b', order: 1, attachment: 'head', tint: { r: 1, g: 1, b: 1, a: 1 }, blend: 'normal', mask: null },
      ],
      [
        {
          id: 'base',
          attachments: [attachment('torso'), attachment('head')],
        },
      ],
    )
    const applied = applyHumanoidAtlas(scene, atlas)
    expect(applied.skins[0]!.attachments[0]!.material).toMatchObject({ kind: 'atlas', page: 1 })
    expect(applied.skins[0]!.attachments[1]!.material).toMatchObject({ kind: 'atlas', page: 0 })
    expect(applied.skins[0]!.attachments[0]!.mesh.uvs.length).toBe(8)
  })
})
