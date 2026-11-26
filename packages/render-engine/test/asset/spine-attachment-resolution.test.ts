import { describe, expect, it } from '@jest/globals'
import { importSpine } from '@/asset/importer'
import { importSpineAtlas } from '@/asset/atlas'

const triangle = {
  type: 'mesh', vertices: [0, 0, 10, 0, 0, 10],
  uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2],
}
const weightedTriangle = {
  ...triangle,
  vertices: [1, 0, 0, 0, 1, 1, 0, 10, 0, 1, 1, 0, 0, 10, 1],
}
const atlas = importSpineAtlas(`page.png
size: 64,64
explicit
  bounds: 0,0,8,8
texture
  bounds: 8,0,8,8
attachment-key
  bounds: 16,0,8,8
texture_0
  bounds: 24,0,8,8
texture_1
  bounds: 32,0,8,8
`)

function document(attachments: Record<string, unknown>) {
  return {
    skeleton: { spine: '4.2.33' }, bones: [{ name: 'root' }],
    slots: [{ name: 'slot', bone: 'root', attachment: 'attachment-key' }],
    skins: [{ name: 'default', attachments: { slot: attachments } }],
    animations: { change: { slots: { slot: { attachment: [{ name: 'attachment-key' }] } } } },
  }
}

describe('Spine texture path and linked mesh resolution', () => {
  it.each([
    ['region', {}], ['mesh', triangle], ['weightedMesh', weightedTriangle],
    ['linkedmesh', { type: 'linkedmesh', parent: 'parent' }],
  ])('%s resolves path ?? name ?? attachment key without changing animation identity', (_kind, geometry) => {
    for (const [fields, expected] of [
      [{ path: 'explicit', name: 'texture' }, 'explicit'],
      [{ name: 'texture' }, 'texture'],
      [{ path: null, name: 'texture' }, 'texture'],
      [{ path: null, name: null }, 'attachment-key'],
      [{}, 'attachment-key'],
    ] as const) {
      const asset = importSpine(document({
        parent: { ...triangle, path: 'texture' },
        'attachment-key': { ...geometry, ...fields },
      }), { atlas, unitScale: 1 })
      const attachment = asset.skins.get('default')!.attachments.get('slot\u0000attachment-key')!
      expect(attachment.id).toBe('attachment-key')
      expect('region' in attachment && attachment.region.atlasKey).toBe(expected)
      if (attachment.kind === 'mesh' || attachment.kind === 'weightedMesh') {
        expect(attachment.mesh.id).toBe('attachment-key')
      }
      expect(asset.slots[0]!.attachment).toBe('attachment-key')
      expect(asset.animations.get('change')!.timelines).toContainEqual(expect.objectContaining({
        kind: 'attachment', keys: [expect.objectContaining({ name: 'attachment-key' })],
      }))
      expect(asset.report.issues).toEqual([])
    }
  })

  it('uses the texture name for sequence frames while retaining the attachment key', () => {
    const asset = importSpine(document({
      'attachment-key': { name: 'texture', sequence: { count: 2 } },
    }), { atlas, unitScale: 1 })
    const attachment = asset.skins.get('default')!.attachments.get('slot\u0000attachment-key')!
    expect(attachment.kind).toBe('region')
    if (attachment.kind !== 'region') throw new Error('expected region')
    expect(attachment.id).toBe('attachment-key')
    expect(attachment.region.sequence?.frames).toEqual(['texture_0', 'texture_1'])
    expect(asset.report.issues).toEqual([])
  })

  it.each([triangle, weightedTriangle])('resolves a later parent skin with equal parent names in different slots', (geometry) => {
    const asset = importSpine({
      skeleton: { spine: '4.2.33' },
      bones: [{ name: 'root' }, { name: 'other', parent: 'root' }],
      slots: [
        { name: 'left', bone: 'root', attachment: 'link' },
        { name: 'right', bone: 'other', attachment: 'link' },
      ],
      skins: [
        { name: 'default', attachments: {
          left: {
            // Forward linked chains must also resolve without relying on object order.
            chain: { type: 'linkedmesh', parent: 'link', name: 'texture' },
            link: { type: 'linkedmesh', skin: 'spineboy', parent: 'parent', name: 'texture' },
            missing: { type: 'linkedmesh', skin: 'spineboy', parent: 'right-only', name: 'texture' },
            // A local namesake must not override the explicitly requested skin.
            parent: { ...triangle, path: 'explicit', vertices: [90, 0, 100, 0, 90, 10] },
          },
          right: { link: { type: 'linkedmesh', skin: 'spineboy', parent: 'parent', path: 'explicit' } },
        } },
        { name: 'spineboy', attachments: {
          left: { parent: { ...geometry, path: 'texture' } },
          right: {
            parent: { ...triangle, path: 'explicit', vertices: [20, 0, 30, 0, 20, 10], triangles: [2, 1, 0] },
            'right-only': { ...triangle, path: 'texture' },
          },
        } },
      ],
    }, { atlas, unitScale: 1 })
    const child = asset.skins.get('default')!.attachments
    const parents = asset.skins.get('spineboy')!.attachments
    for (const slot of ['left', 'right']) {
      const link = child.get(`${slot}\u0000link`)!
      const parent = parents.get(`${slot}\u0000parent`)!
      expect(link.kind).toBe(parent.kind)
      if ((link.kind !== 'mesh' && link.kind !== 'weightedMesh')
        || (parent.kind !== 'mesh' && parent.kind !== 'weightedMesh')) throw new Error('expected mesh')
      expect(link.id).toBe('link')
      expect(link.mesh.id).toBe('link')
      expect(link.mesh.positions).toEqual(parent.mesh.positions)
      expect(link.mesh.uvs).toEqual(parent.mesh.uvs)
      expect(link.mesh.indices).toEqual(parent.mesh.indices)
      expect(link.mesh.bone).toBe(parent.mesh.bone)
      expect(link.mesh.positions).not.toBe(parent.mesh.positions)
      expect(link.region.atlasKey).toBe(slot === 'left' ? 'texture' : 'explicit')
      if (link.kind === 'weightedMesh' && parent.kind === 'weightedMesh') {
        expect(link.mesh.weights).toEqual(parent.mesh.weights)
        expect(link.mesh.boneIndices).toEqual(parent.mesh.boneIndices)
        expect(link.mesh.influencePositions).toEqual(parent.mesh.influencePositions)
        expect(link.mesh.influenceSourceIndices).toEqual(parent.mesh.influenceSourceIndices)
        expect(link.mesh.influencesPerVertex).toBe(parent.mesh.influencesPerVertex)
      }
    }
    const chain = child.get('left\u0000chain')!
    expect(chain.kind).toBe(child.get('left\u0000link')!.kind)
    if (chain.kind === 'mesh' || chain.kind === 'weightedMesh') {
      expect(chain.mesh.positions).toEqual(new Float32Array([0, 0, 10, 0, 0, 10]))
    }
    expect(child.get('left\u0000missing')!.kind).toBe('region')
    expect(asset.report.issues).toEqual([expect.objectContaining({
      code: 'W_ATTACHMENT_UNSUPPORTED', path: 'skins[0].attachments.left.missing',
    })])
  })
})
