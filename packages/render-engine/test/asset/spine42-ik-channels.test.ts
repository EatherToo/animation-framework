import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importSpine, importSpineBinary } from '@/asset/importer'

const dir = resolve(process.cwd(), '../../test/fixtures/spine/spineboy-4.2')

describe('Spine 4.2 IK animation import', () => {
  it('preserves softness and bend frames in JSON and binary instead of mix-only keys', () => {
    const json = JSON.parse(readFileSync(resolve(dir, 'spineboy-pro.json'), 'utf8')) as Record<string, unknown>
    const bytes = readFileSync(resolve(dir, 'spineboy-pro.skel'))
    const assets = [
      importSpine(json, { unitScale: 0.01 }),
      importSpineBinary(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        { unitScale: 0.01 }),
    ]
    for (const asset of assets) {
      const timeline = asset.animations.get('walk')?.timelines.find(t => t.kind === 'ik' && t.path === 'front-leg-ik')
      expect(timeline).toBeDefined()
      expect(timeline && 'frames' in timeline).toBe(true)
      if (!timeline || !('frames' in timeline)) continue
      expect(timeline.frames).toHaveLength(4)
      expect(timeline.frames[0]?.values[1]).toBeCloseTo(0.257, 3)
      expect(timeline.frames[2]?.values[1]).toBeCloseTo(0.432, 3)
      expect(timeline.frames[0]?.bendDirection).toBe(-1)
      expect(timeline.frames[2]?.bendDirection).toBe(-1)
    }
  })
})
