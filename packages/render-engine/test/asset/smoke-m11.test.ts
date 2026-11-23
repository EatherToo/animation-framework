/**
 * M11 应用级烟测：6 骨角色 + clipping mask + atlas。
 * 走 importSpine → createPose → updateWorld → sampleAnimation → buildRegionPacket，
 * 断言附件 UV 落在图集页内、maskLibrary 配对、约束数量正确。
 */
import { describe, expect, it } from '@jest/globals'
import { importSpine } from '@/asset/importer'
import { atlasRegionRef, importSpineAtlas } from '@/asset/atlas'
import { createPose, updateWorld } from '@/core/pose'
import { createTrack, sampleAnimation } from '@/animation/animation'
import {
  createSlotSet,
  resolveAttachment,
} from '@/slot/slot'
import { buildRegionPacket } from '@/render/render'

function humanoidJson(): Record<string, unknown> {
  return {
    skeleton: { spine: '4.2.0', width: 512, height: 512, fps: 30 },
    bones: [
      { name: 'root' },
      { name: 'hips', parent: 'root', x: 0, y: -90, length: 9 },
      { name: 'spine', parent: 'hips', x: 0, y: -15, length: 15 },
      { name: 'neck', parent: 'spine', x: 0, y: -15, length: 15 },
      { name: 'arm', parent: 'neck', x: 20, y: -5, length: 25 },
      { name: 'hand', parent: 'arm', x: 25, y: 0, length: 5 },
    ],
    slots: [
      { name: 'gloveSlot', bone: 'hand', attachment: 'glove', color: 'ffffffff', blend: 'normal' },
      { name: 'clipStart', bone: 'spine', attachment: 'bodyMask', color: 'ffffffff', blend: 'normal' },
      { name: 'clipEnd', bone: 'spine', color: 'ffffffff', blend: 'normal' },
    ],
    skins: [{
      name: 'default',
      attachments: {
        gloveSlot: {
          glove: { type: 'region', path: 'glove', width: 8, height: 8 },
        },
        clipStart: {
          bodyMask: {
            type: 'clipping', end: 'clipEnd',
            vertices: [-5, 0, 5, 0, 5, 10, -5, 10],
          },
        },
      },
    }],
    ik: [{
      name: 'armIk', bones: ['arm', 'hand'], target: 'hand', mix: 0.7, bendPositive: true,
    }],
    transform: [{
      name: 'follow', bones: ['hand'], target: 'arm', mixRotate: 0.3, mixX: 0.2, mixY: 0.2,
    }],
    animations: {
      wave: {
        bones: {
          arm: { rotate: [{ time: 0, angle: 0 }, { time: 0.5, angle: 90 }, { time: 1, angle: 0 }] },
        },
        events: [{ time: 0.5, name: 'wave' }],
      },
    },
    events: { wave: { int: 1 } },
  }
}

function atlas(): ReturnType<typeof importSpineAtlas> {
  return importSpineAtlas(`sheet.png
size: 128,128
glove
  bounds: 16,8,32,32
  offsets: 0,0,32,32
`)
}

describe('M11 smoke: 6 骨 + clipping + atlas 全链路', () => {
  const asset = importSpine(humanoidJson(), { unitScale: 0.01, atlas: atlas() })
  const slotSet = createSlotSet(asset.slots, asset.skins, 'default')

  it('导入包含 atlas / maskLibrary / 两个约束且无 error', () => {
    expect(asset.skeleton.count).toBe(6)
    expect(asset.atlas).toBeDefined()
    expect(asset.atlas!.regions.has('glove')).toBe(true)
    expect(asset.report.errors).toBe(0)
    expect(asset.maskLibrary!.masks).toHaveLength(1)
    expect(asset.constraints).toHaveLength(2)
  })

  it('clipping mask 与 slot 范围配对', () => {
    const mask = asset.maskLibrary!.masks[0]!
    expect(mask.startSlotId).toBe('clipStart')
    expect(mask.endSlotId).toBe('clipEnd')
    expect(asset.slots.some((s) => s.id === mask.startSlotId)).toBe(true)
    expect(asset.slots.some((s) => s.id === mask.endSlotId)).toBe(true)
    expect(asset.slots.find((s) => s.id === 'clipStart')!.mask).toBeNull()
    const clip = asset.skins.get('default')!.attachments.get('bodyMask')!
    expect(clip.kind).toBe('clipping')
    if (clip.kind === 'clipping') expect(clip.endSlotId).toBe('clipEnd')
  })

  it('createPose → updateWorld → sampleAnimation 后姿态有效', () => {
    const pose = createPose(asset.skeleton)
    updateWorld(pose)
    const clip = asset.animations.get('wave')!
    const result = sampleAnimation([createTrack(clip, { time: 0.5 })], pose, slotSet, 0)
    expect(result.dominant).toBe('wave')
    updateWorld(pose)
    const arm = asset.skeleton.boneIdByName.get('arm')!
    expect(pose.local[arm * 7 + 2]).toBeCloseTo(Math.PI / 2, 6)
  })

  it('buildRegionPacket 使用 atlas UV，四角都落在页内 region 内', () => {
    const attachment = resolveAttachment(slotSet, 0)!
    expect(attachment.kind).toBe('region')
    if (attachment.kind !== 'region') return
    const ref = atlasRegionRef(asset.atlas!, attachment.region.atlasKey)
    expect(ref).not.toBeNull()
    const page = asset.atlas!.pages[ref!.page]!
    const packet = buildRegionPacket({
      id: 0,
      positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      uvs: attachment.region.uvs ?? new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      color: [1, 1, 1, 1],
      materialId: 0,
      order: 0,
      depthKey: 0,
      region: { rect: ref!.rect, page: ref!.pageSize },
    })
    const minU = (ref!.rect.x + 0.5) / page.width
    const minV = (ref!.rect.y + 0.5) / page.height
    const maxU = (ref!.rect.x + ref!.rect.width - 0.5) / page.width
    const maxV = (ref!.rect.y + ref!.rect.height - 0.5) / page.height
    for (let i = 0; i < packet.uvs.length; i += 2) {
      const u = packet.uvs[i]!
      const v = packet.uvs[i + 1]!
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThanOrEqual(1)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
      expect(u).toBeGreaterThanOrEqual(minU - 1e-6)
      expect(u).toBeLessThanOrEqual(maxU + 1e-6)
      expect(v).toBeGreaterThanOrEqual(minV - 1e-6)
      expect(v).toBeLessThanOrEqual(maxV + 1e-6)
    }
  })
})
