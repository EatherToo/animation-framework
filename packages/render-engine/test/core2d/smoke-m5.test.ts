/**
 * M5 应用级烟测：从 Spine JSON 导入 6 骨人形，走 createPose → updateWorld →
 * sampleAnimation → 换肤的完整应用视角，验证骨世界坐标、rotate 驱动与骨架不变。
 */
import { describe, expect, it } from '@jest/globals'
import { importSpine, type SkeletonAsset } from '@/core2d/importer'
import { createPose, updateWorld } from '@/core2d/pose'
import { createTrack, sampleAnimation } from '@/core2d/animation'
import { createSlotSet, resolveAttachment, setSkin, type SlotSet } from '@/core2d/slot'

/** 6 骨人形：root → hips → spine → neck → arm → hand。y 向上写负值。 */
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
    slots: [{ name: 'handSlot', bone: 'hand', attachment: 'glove', color: 'ffffffff', blend: 'normal' }],
    skins: [
      {
        name: 'default',
        attachments: {
          handSlot: { glove: { type: 'region', path: 'glove-default', x: 0, y: 0, width: 8, height: 8 } },
        },
      },
      {
        name: 'alt',
        attachments: {
          handSlot: { glove: { type: 'region', path: 'glove-alt', x: 0, y: 0, width: 8, height: 8 } },
        },
      },
    ],
    atlas: ['glove-default', 'glove-alt'],
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

function handOrigin(asset: SkeletonAsset): readonly [number, number] {
  const pose = createPose(asset.skeleton)
  updateWorld(pose)
  const id = asset.skeleton.boneIdByName.get('hand')!
  const off = id * 6
  return [pose.world[off + 4]!, pose.world[off + 5]!]
}

describe('M5 smoke: 导入 → 姿态 → 动画 → 换肤', () => {
  const asset = importSpine(humanoidJson(), { unitScale: 0.01 })
  const slotSet: SlotSet = createSlotSet(asset.slots, asset.skins, 'default')

  it('6 骨人形导入后手骨世界坐标符合预期', () => {
    expect(asset.report.errors).toBe(0)
    expect(asset.skeleton.count).toBe(6)
    const [x, y] = handOrigin(asset)
    // root(0,0) → hips(0,0.9) → spine(0,1.05) → neck(0,1.2) → arm(0.2,1.25) → hand(0.45,1.25)
    expect(x).toBeCloseTo(0.45, 6)
    expect(y).toBeCloseTo(1.25, 6)
  })

  it('sampleAnimation 能驱动导入的 rotate timeline', () => {
    const clip = asset.animations.get('wave')!
    expect(clip.timelines.some((t) => t.kind === 'rotate' && t.path === 'arm')).toBe(true)
    const pose = createPose(asset.skeleton)
    const track = createTrack(clip, { time: 0.5 })
    // dt=0 表示定点采样到 0.5s：角度 90° 经导入成为 +π/2。
    const result = sampleAnimation([track], pose, slotSet, 0)
    expect(result.dominant).toBe('wave')
    updateWorld(pose)
    const arm = asset.skeleton.boneIdByName.get('arm')!
    expect(pose.local[arm * 7 + 2]).toBeCloseTo(Math.PI / 2, 6)
    // 手臂抬起后手骨绕 arm 原点旋转到正上方。
    const hand = asset.skeleton.boneIdByName.get('hand')!
    expect(pose.world[hand * 6 + 4]).toBeCloseTo(0.2, 6)
    expect(pose.world[hand * 6 + 5]).toBeCloseTo(1.5, 6)
  })

  it('换肤不改骨架（应用视角）', () => {
    const before = asset.skeleton.setupLocal.slice()
    const namesBefore = Array.from(asset.skeleton.boneIdByName.entries())
    const beforeAttachment = resolveAttachment(slotSet, 0)!

    setSkin(slotSet, 'alt')
    const afterAttachment = resolveAttachment(slotSet, 0)!

    expect(slotSet.slots[0]!.skinId).toBe('alt')
    expect(beforeAttachment.kind).toBe('region')
    expect(afterAttachment.kind).toBe('region')
    if (beforeAttachment.kind === 'region' && afterAttachment.kind === 'region') {
      expect(beforeAttachment.region.atlasKey).toBe('glove-default')
      expect(afterAttachment.region.atlasKey).toBe('glove-alt')
    }
    expect(Array.from(asset.skeleton.setupLocal)).toEqual(Array.from(before))
    expect(Array.from(asset.skeleton.boneIdByName.entries())).toEqual(namesBefore)
    const [hx, hy] = handOrigin(asset)
    expect(hx).toBeCloseTo(0.45, 6)
    expect(hy).toBeCloseTo(1.25, 6)
  })
})
