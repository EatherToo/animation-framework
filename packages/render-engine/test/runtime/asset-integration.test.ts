import { describe, expect, it } from '@jest/globals'
import { compileSkeleton } from '@/core/skeleton'
import { createPose, updateWorld } from '@/core/pose'
import type { SkeletonAsset, MaskLibrary } from '@/asset/importer'
import type { AtlasData } from '@/asset/atlas'
import { createSlotSet, type Attachment, type SkinData, type SlotData } from '@/slot/slot'
import { Engine, buildRenderAssets, resolveMaskPaths } from '@/runtime/runtime'
import { sortPackets } from '@/render/render'
import { DEFAULT_CAMERA } from '@/render/camera'

const sk = compileSkeleton({
  name: 'asset-rig', profile: 'full2d',
  bones: [
    { name: 'root', parent: -1, length: 0 },
    { name: 'body', parent: 0, length: 1 },
  ],
})
const rgba = { r: 1, g: 1, b: 1, a: 1 }
const slots: SlotData[] = [
  { id: 'clip', bone: 1, order: 0, color: rgba, blend: 'normal', attachment: 'clip', mask: null, zOffset: 0 },
  { id: 'body', bone: 1, order: 1, color: rgba, blend: 'normal', attachment: 'body', mask: null, zOffset: 1 },
  { id: 'after', bone: 1, order: 2, color: rgba, blend: 'normal', attachment: 'body', mask: null, zOffset: 2 },
]
const atlas: AtlasData = {
  format: 'dsh-2d-atlas', version: 1, hash: 'test', pma: true, colorSpace: 'srgb',
  padding: 4, bleed: 2, source: 'procedural',
  pages: [{ index: 0, width: 2, height: 2, image: { width: 2, height: 2, data: Uint8Array.from([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
  ]) } }],
  regions: new Map([['body', {
    id: 'body', page: 0, x: 0, y: 0, width: 2, height: 2,
    uvMatrix: Float32Array.from([1, 0, 0, 1, 0, 0]),
    trim: { offsetX: 0, offsetY: 0, sourceWidth: 2, sourceHeight: 2 }, maxMip: 0,
  }]]),
}
const region = (id: string): Attachment => ({
  kind: 'region', id, region: { atlasKey: id === 'clip' ? 'body' : 'body', uvs: null }, color: rgba,
})
const masks: MaskLibrary = { version: 1, masks: [{
  id: 'clip', mode: 'clip', invert: false, feather: 0,
  polygon: new Float32Array([0, -0.5, 1, -0.5, 1, 0.5, 0, 0.5]),
  startSlotId: 'clip', endSlotId: 'after',
}] }
const asset: SkeletonAsset = {
  schema: 1, source: 'native', sourceVersion: 'test', unitScale: 1,
  skeleton: sk, slots, skins: new Map<string, SkinData>([['default', {
    id: 'default', attachments: new Map([['body', region('body')], ['clip', { kind: 'clipping', id: 'clip', polygon: masks.masks[0]!.polygon }]]),
  }]]),
  animations: new Map(), events: [], hash: 'asset', report: { issues: [], warnings: 0, errors: 0 },
  atlas, maskLibrary: masks,
}

describe('runtime asset integration', () => {
  it('builds texture pages and sprite materials from the atlas', () => {
    const assets = buildRenderAssets(asset)!
    expect(assets.pages).toHaveLength(1)
    expect(assets.pages[0]!.data.length).toBe(16)
    expect(assets.materials.some((m) => m.kind === 'sprite')).toBe(true)
  })

  it('renders atlas UVs through the CPU backend', () => {
    const engine = new Engine({ backend: 'cpu', pixelRatio: 1 })
    engine.load(asset)
    const frame = engine.render()
    const body = frame.packets.find((p) => p.id === 1)!
    expect(body.page).toBe(0)
    expect(body.materialId).toBeGreaterThan(0)
    expect(frame.assets?.pages).toHaveLength(1)
    const pixels = engine.readPixels()
    let colored = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] !== pixels[i + 1] || pixels[i + 1] !== pixels[i + 2]) colored += 1
    }
    expect(colored).toBeGreaterThan(0)
  })

  it('resolves clipping scopes into mask paths without drawing the clipping slot', () => {
    const pose = createPose(sk)
    updateWorld(pose)
    const set = createSlotSet(slots, asset.skins, 'default')
    const paths = resolveMaskPaths(set, asset.maskLibrary!)
    expect(paths.paths).toHaveLength(3)
    expect(paths.paths[0]).toBe(-1) // clipping slot 本身不画
    expect(paths.paths[1]).toBeGreaterThanOrEqual(0) // body 在 scope 内
    expect(paths.paths[2]).toBe(-1) // end 槽位自身不被裁
    expect(paths.maskPaths).toHaveLength(1)
    expect(paths.masks[0]!.positions.length).toBeGreaterThanOrEqual(6)
  })

  it('keeps packets sorted and applies the frame mask set', () => {
    const engine = new Engine({ backend: 'cpu' })
    engine.load(asset)
    const frame = engine.render()
    expect(frame.packets).toEqual(sortPackets(frame.packets))
    expect(frame.masks?.masks.length).toBe(1)
    expect(frame.maskPaths?.length).toBe(1)
    const body = frame.packets.find((p) => p.id === 1)!
    expect(body.maskPath).toBeGreaterThanOrEqual(0)
    expect(frame.packets.find((p) => p.id === 0)).toBeUndefined() // clipping 槽不绘制
  })
})

describe('runtime view rules', () => {
  it('lets plugins choose attachments by camera yaw', () => {
    const rig = compileSkeleton({ name: 'view', profile: 'simple2d', bones: [{ name: 'root', parent: -1, length: 1 }] })
    const viewSlots: SlotData[] = [{ id: 'face', bone: 0, order: 0, color: rgba, blend: 'normal', attachment: 'front', mask: null, zOffset: 0 }]
    const front: Attachment = { kind: 'region', id: 'front', region: { atlasKey: 'front', uvs: null }, color: rgba }
    const side: Attachment = { kind: 'region', id: 'side', region: { atlasKey: 'side', uvs: null }, color: rgba }
    const { atlas: _atlas, maskLibrary: _masks, ...base } = asset
    const viewAsset: SkeletonAsset = {
      ...base, skeleton: rig, slots: viewSlots,
      skins: new Map([['default', { id: 'default', attachments: new Map([['front', front], ['side', side]]) }]]),
    }
    const engine = new Engine({ backend: 'cpu' })
    engine.usePlugin({
      id: 'view', apiVersion: 1,
      viewRules: () => [{ slot: 0, attachment: 'side', yaw: [Math.PI * 80 / 180, Math.PI * 100 / 180], pitch: 'any', priority: 1, hysteresisDeg: 5, fadeSec: 0 }],
    })
    engine.load(viewAsset)
    engine.setCamera({ ...DEFAULT_CAMERA, yaw: Math.PI / 2 })
    const frame = engine.render()
    expect(engine.slotSet.slots[0]!.attachmentId).toBe('side')
    expect(frame.packets).toHaveLength(1)
  })
})
