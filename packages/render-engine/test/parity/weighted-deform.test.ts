import { describe, expect, it } from '@jest/globals'
import { importSpine } from '@/asset/importer'
import { createPose, updateWorld } from '@/core/pose'
import { createSlotSet } from '@/slot/slot'
import { createTrack, sampleAnimation } from '@/animation/animation'
import { buildInverseBind, skinMesh2D } from '@/mesh/mesh'

const vertices = [
  2, 0, 2, 1, 0.25, 1, 4, 3, 0.75,
  2, 0, 3, 1, 0.25, 1, 5, 3, 0.75,
  2, 0, 2, 2, 0.25, 1, 4, 4, 0.75,
]

function fixture() {
  return {
    skeleton: { spine: '4.3.13' },
    bones: [{ name: 'root' }, { name: 'child', parent: 'root', x: 10, rotation: 90 }],
    slots: [{ name: 'slot', bone: 'root', attachment: 'mesh' }],
    skins: [{ name: 'default', attachments: { slot: { mesh: {
      type: 'mesh', uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2], vertices,
    } } } }],
    animations: { bend: { attachments: { default: { slot: { mesh: { deform: [
      { time: 0, offset: 2, vertices: [-2, 4] },
      { time: 1, offset: 2, vertices: [0, 0] },
    ] } } } } } },
  }
}

describe('Spine 4.3 weighted deform per influence', () => {
  it('matches spine-core for second-influence-only deform and interpolation', () => {
    const asset = importSpine(fixture(), { sourceYDown: false, unitScale: 1 })
    const attachment = asset.skins.get('default')!.attachments.get('slot\0mesh')!
    expect(attachment.kind).toBe('weightedMesh')
    if (attachment.kind !== 'weightedMesh') return
    const pose = createPose(asset.skeleton)
    updateWorld(pose)
    const slots = createSlotSet(asset.slots, asset.skins, 'default')
    const track = createTrack(asset.animations.get('bend')!, { loop: false })
    // Generated with spine-core@4.3.13 MeshAttachment.computeWorldVertices (Node ESM).
    const oracle = [[2.75, 1.75, 6, 4, 5, 3.5], [4.25, 2.5, 6, 4, 5, 3.5]]
    const inverse = buildInverseBind(pose)
    for (const [index, expectedDeform] of [[0, [0, 0, -2, 4]], [1, [0, 0, -1, 2]]] as const) {
      const sampled = sampleAnimation([track], pose, slots, index === 0 ? 0 : 0.5)
      const offsets = sampled.deformOffsets.get('default:0:mesh')!
      expect(Array.from(offsets.slice(0, 4))).toEqual(expectedDeform)
      const actual = skinMesh2D(attachment.mesh, pose, inverse, undefined, offsets)
      for (let i = 0; i < 6; i++) expect(actual[i]).toBeCloseTo(oracle[index]![i]!, 4)
    }
  })
})
