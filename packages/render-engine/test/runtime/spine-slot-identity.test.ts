import { describe, expect, it } from '@jest/globals'
import { importSpine } from '@/asset/importer'
import { Engine } from '@/runtime/runtime'

describe('Spine slot attachment identity in rendered geometry', () => {
  it.each(['mesh', 'weightedMesh'])('keeps both limbs when %s attachments have identical names', (kind) => {
    const attachment = (bone: number) => ({
      type: 'mesh',
      uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2],
      vertices: kind === 'mesh' ? [0, 0, 10, 0, 0, 10]
        : [1, bone, 0, 0, 1, 1, bone, 10, 0, 1, 1, bone, 0, 10, 1],
    })
    const asset = importSpine({
      skeleton: { spine: '4.2.22' },
      bones: [{ name: 'root' }, { name: 'left', parent: 'root', x: -20 },
        { name: 'right', parent: 'root', x: 20 }],
      slots: [{ name: 'left-slot', bone: 'left', attachment: 'limb' },
        { name: 'right-slot', bone: 'right', attachment: 'limb' }],
      skins: [{ name: 'default', attachments: {
        'left-slot': { limb: attachment(1) }, 'right-slot': { limb: attachment(2) },
      } }],
    }, { unitScale: 1, sourceYDown: false })
    expect(asset.report.errors).toBe(0)
    const engine = new Engine({ backend: 'cpu' })
    try {
      engine.load(asset)
      const frame = engine.render()
      // Matching render state batches both slots, preserving both geometries
      // and offsetting the second limb's indices.
      expect(frame.packets).toHaveLength(1)
      expect(Array.from(frame.packets[0]!.positions)).toEqual([
        -20, 0, -10, 0, -20, 10, 20, 0, 30, 0, 20, 10,
      ])
      expect(Array.from(frame.packets[0]!.indices)).toEqual([0, 1, 2, 3, 4, 5])
    } finally {
      engine.dispose()
    }
  })
})
