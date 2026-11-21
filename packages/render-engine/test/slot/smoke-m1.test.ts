import { describe, expect, it } from '@jest/globals'
import { compileSkeleton } from '@/core/skeleton'
import { addRotation, createPose, updateWorld } from '@/core/pose'
import { buildInverseBind, skinMesh2D, type WeightedMeshData } from '@/mesh/mesh'
import { createSlotSet, resolveAttachment, setSkin, type Attachment } from '@/slot/slot'

/** 应用视角：一件加权袖子在两根骨之间过渡，换肤只换贴图且不扰动几何。 */
describe('core2d M1 application smoke', () => {
  it('skins a sleeve and switches its skin without changing geometry', () => {
    const sk = compileSkeleton({
      name: 'arm', profile: 'full2d',
      bones: [
        { name: 'root', parent: -1, length: 0 },
        { name: 'upperArm', parent: 0, length: 0.3 },
        { name: 'lowerArm', parent: 1, length: 0.3, rest: { x: 0.3, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 } },
      ],
    })
    const pose = createPose(sk)
    updateWorld(pose)
    const inverseBind = buildInverseBind(pose)
    const mesh: WeightedMeshData = {
      id: 'sleeve',
      bone: 1,
      vertexSpace: 'bindWorld',
      positions: Float32Array.from([0.3, -0.05, 0.6, -0.05, 0.6, 0.05, 0.3, 0.05]),
      uvs: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: Uint16Array.from([0, 1, 2, 0, 2, 3]),
      boneIndices: Uint16Array.from([
        1, 0, 0, 0, 1, 2, 0, 0, 1, 2, 0, 0, 1, 0, 0, 0,
      ]),
      weights: Float32Array.from([
        1, 0, 0, 0, 0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0,
      ]),
    }
    const attachment = (id: string): Attachment => ({
      kind: 'weightedMesh', id, mesh, region: { atlasKey: id, uvs: null }, color: { r: 1, g: 1, b: 1, a: 1 },
    })
    const skins = new Map([
      ['cloth', { id: 'cloth', attachments: new Map([['sleeve', attachment('clothSleeve')]]) }],
      ['armor', { id: 'armor', attachments: new Map([['sleeve', attachment('armorSleeve')]]) }],
    ])
    const set = createSlotSet([{
      id: 'sleeve', bone: 2, order: 0, color: { r: 1, g: 1, b: 1, a: 1 },
      blend: 'normal', attachment: 'sleeve', mask: null, zOffset: 0,
    }], skins, 'cloth')

    const rest = skinMesh2D(mesh, pose, inverseBind)
    setSkin(set, 'armor')
    expect(resolveAttachment(set, 0)?.id).toBe('armorSleeve')
    expect(Array.from(skinMesh2D(mesh, pose, inverseBind))).toEqual(Array.from(rest))

    addRotation(pose, 2, 0.8)
    updateWorld(pose)
    const bent = skinMesh2D(mesh, pose, inverseBind)
    expect(bent[3]).not.toBeCloseTo(rest[3]!, 4)
    for (let i = 0; i < bent.length; i += 1) expect(Number.isFinite(bent[i])).toBe(true)
  })
})
