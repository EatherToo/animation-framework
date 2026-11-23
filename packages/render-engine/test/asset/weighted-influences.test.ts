import { describe, expect, it } from '@jest/globals'
import { importSpine } from '@/asset/importer'
import { createPose, updateWorld } from '@/core/pose'
import { buildInverseBind, skinMesh2D, validateTopology } from '@/mesh/mesh'
import { createSlotSet } from '@/slot/slot'
import { createTrack, sampleAnimation } from '@/animation/animation'
import { Engine } from '@/runtime/runtime'

function fixture(count: number): Record<string, unknown> {
  const vertices = (x: number, y: number) => [count, ...Array.from({ length: count }, (_, i) => [i, x + i, y, 1 / count]).flat()]
  return {
    skeleton: { spine: '4.3.13' },
    bones: Array.from({ length: count }, (_, i) => ({ name: `b${i}`, ...(i ? { parent: 'b0', x: i } : {}) })),
    slots: [{ name: 's', bone: 'b0', attachment: 'm' }],
    skins: [{ name: 'default', attachments: { s: { m: {
      type: 'mesh', path: 'm', uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2],
      vertices: [...vertices(0, 0), ...vertices(1, 0), ...vertices(0, 1)],
    } } } }],
    animations: { move: { attachments: { default: { s: { m: { deform: [
      { time: 0, offset: 0, vertices: [3, 4] },
    ] } } } } } },
  }
}

function weighted(count: number, maxInfluences?: number) {
  const asset = importSpine(fixture(count), { unitScale: 1, ...(maxInfluences === undefined ? {} : { maxInfluences }) })
  const attachment = asset.skins.get('default')!.attachments.get('s\u0000m')!
  if (attachment.kind !== 'weightedMesh') throw new Error('expected weighted mesh')
  return { asset, mesh: attachment.mesh }
}

describe('A02 weighted mesh influence limits', () => {
  it('keeps eight influences in skinning and deform mapping', () => {
    const { asset, mesh } = weighted(8, 8)
    expect(mesh.influencesPerVertex).toBe(8)
    expect(mesh.weights.length).toBe(24)
    expect(mesh.influenceSourceIndices?.[7]).toBe(14)
    expect(validateTopology(mesh).errors).toEqual([])
    expect(asset.report.issues.some((issue) => issue.code === 'W_WEIGHT_LIMIT')).toBe(false)
    const pose = createPose(asset.skeleton)
    updateWorld(pose)
    const before = skinMesh2D(mesh, pose, buildInverseBind(pose))
    expect(before[0]).toBeCloseTo(7, 4) // average of local x=i plus bone translations i
    const slots = createSlotSet(asset.slots, asset.skins, 'default')
    const track = createTrack(asset.animations.get('move')!)
    const sampled = sampleAnimation([track], pose, slots, 0)
    const deform = sampled.deformOffsets.get('default:0:m')
    expect(deform).toBeDefined()
    expect(deform?.length).toBe(48)
    expect(deform?.[0]).toBeCloseTo(3)
    const after = skinMesh2D(mesh, pose, buildInverseBind(pose), undefined, deform)
    expect(after[0]).toBeCloseTo(7 + 3 / 8, 4)
    expect(() => new Engine({ backend: 'cpu', maxInfluences: 8 }).load(asset)).not.toThrow()
  })

  it('reports >8 by vertex while preserving all nine weights', () => {
    const { asset, mesh } = weighted(9, 8)
    expect(mesh.influencesPerVertex).toBe(9)
    expect(mesh.weights.length).toBe(27)
    expect(Array.from(mesh.weights.slice(0, 9)).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
    expect(validateTopology(mesh).errors).toEqual([])
    const issues = asset.report.issues.filter((issue) => issue.code === 'W_WEIGHT_LIMIT')
    expect(issues).toHaveLength(3)
    expect(issues[0]).toMatchObject({ path: 'skins[0].attachments.s.m.vertices[0]', action: 'keep', sourceValue: 9 })
    expect(() => new Engine({ backend: 'cpu', maxInfluences: 8 }).load(asset)).toThrow('E_CONFIG: maxInfluences')
    expect(() => new Engine({ backend: 'cpu' }).load(asset)).not.toThrow()
  })
})
