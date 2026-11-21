import { describe, expect, it, jest } from '@jest/globals'
import type { RenderBackend } from '@/backend/backend'
import { Engine } from '@/runtime/runtime'
import { compileSkeleton } from '@/core/skeleton'
import { createSlotSet } from '@/slot/slot'
import type { SkeletonAsset } from '@/asset/importer'

function asset(bones = 3): SkeletonAsset {
  const skeleton = compileSkeleton({
    name: 'ctx', profile: 'simple2d',
    bones: Array.from({ length: bones }, (_, i) => ({
      name: i === 0 ? 'root' : `b${i}`,
      parent: i - 1, length: 1,
      rest: { x: i === 0 ? 0 : 1, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
    })),
  })
  return {
    schema: 1, source: 'native', sourceVersion: '1', unitScale: 1,
    skeleton, slots: [], skins: new Map([['default', { id: 'default', attachments: new Map() }]]),
    animations: new Map(), events: [], hash: 'ctx', report: { issues: [], warnings: 0, errors: 0 },
  }
}

function backend(): RenderBackend & { restore: jest.Mock; draws: number } {
  const draws = { value: 0 }
  return {
    kind: 'cpu',
    draws: 0,
    draw: () => { draws.value += 1 },
    readPixels: () => new Uint8ClampedArray(4),
    resize: () => {},
    dispose: () => {},
    restore: jest.fn(),
  } as unknown as RenderBackend & { restore: jest.Mock; draws: number }
}

describe('runtime context loss and limits', () => {
  it('enters contextLost and recovers via backend.restore', () => {
    const be = backend()
    const engine = new Engine({ backend: 'cpu' }, { backendFactory: () => be })
    engine.load(asset())
    engine.render()
    engine.contextLost()
    expect(engine.phase).toBe('contextLost')
    expect(() => engine.render()).toThrow('E_STATE')
    engine.contextRestored()
    expect(engine.phase).toBe('restored')
    engine.render()
    expect(be.restore).toHaveBeenCalledTimes(1)
  })

  it('rejects assets beyond maxBones / maxTexturePages', () => {
    expect(() => new Engine({ backend: 'cpu', maxBones: 2 }) .load(asset(3))).toThrow('E_CONFIG')
    const big = asset()
    const withAtlas: SkeletonAsset = {
      ...big,
      atlas: {
        format: 'dsh-2d-atlas', version: 1, hash: 'x', pma: true, colorSpace: 'srgb',
        padding: 0, bleed: 0, source: 'procedural', regions: new Map(),
        pages: Array.from({ length: 3 }, (_, i) => ({ index: i, width: 1, height: 1 })),
      },
    }
    expect(() => new Engine({ backend: 'cpu', maxTexturePages: 2 }).load(withAtlas)).toThrow('E_CONFIG')
  })

  it('rejects maxInfluences smaller than the asset uses', () => {
    const base = asset(2)
    const mesh = {
      id: 'm', bone: 1, vertexSpace: 'bindWorld' as const,
      positions: new Float32Array([0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint16Array([0, 1, 2]),
      boneIndices: Uint16Array.from([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      weights: Float32Array.from([0.5, 0.5, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    }
    const weighted: SkeletonAsset = {
      ...base,
      slots: [{ id: 'm', bone: 1, order: 0, color: { r: 1, g: 1, b: 1, a: 1 }, blend: 'normal', attachment: 'm', mask: null, zOffset: 0 }],
      skins: new Map([['default', { id: 'default', attachments: new Map([['m', {
        kind: 'weightedMesh', id: 'm', mesh, region: { atlasKey: 'm', uvs: null }, color: { r: 1, g: 1, b: 1, a: 1 },
      }]]) }]]),
    }
    expect(() => new Engine({ backend: 'cpu', maxInfluences: 1 }).load(weighted)).toThrow('E_CONFIG')
  })
})
