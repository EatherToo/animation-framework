/**
 * M11 DragonBones 4.5 功能单测：多皮肤、displayIndex、image/mesh/armature display、
 * zOrder、ffd、frame 时间、ik 约束与 atlas 注入。
 */
import { describe, expect, it } from '@jest/globals'
import { importDragonBones, type SkeletonAsset } from '@/asset/importer'
import { importSpineAtlas } from '@/asset/atlas'
import type { AnimationClip } from '@/animation/animation'

const SCALE = 0.01

/** Timeline 按 key 类型分组；本测试只断言标量通道的 time/value。 */
type KeyTimeline = {
  readonly kind: string
  readonly path: string
  readonly keys: readonly { readonly time: number; readonly value: number }[]
}
function keyTimeline(clip: AnimationClip, predicate: (t: KeyTimeline) => boolean): KeyTimeline {
  return clip.timelines.find(
    (t) => 'keys' in t && t.keys !== undefined && predicate(t as unknown as KeyTimeline),
  ) as unknown as KeyTimeline
}

function dragonBonesFeaturesFixture(): Record<string, unknown> {
  return {
    version: '4.5',
    compatibleVersion: '4.5',
    frameRate: 24,
    name: 'Dragon',
    armature: [{
      name: 'Dragon',
      frameRate: 24,
      bone: [
        { name: 'root' },
        { name: 'hip', parent: 'root', length: 10,
          transform: { x: 0, y: -10, skX: 0, skY: 0, scX: 1, scY: 1 } },
        { name: 'arm', parent: 'hip', length: 10,
          transform: { x: 5, y: 0, skX: -90, skY: -90, scX: 1, scY: 1 } },
        { name: 'target', parent: 'root',
          transform: { x: 20, y: -20, skX: 0, skY: 0, scX: 1, scY: 1 } },
      ],
      slot: [
        { name: 'bodySlot', parent: 'hip', displayIndex: 1, blendMode: 'normal' },
        { name: 'meshSlot', parent: 'arm', displayIndex: 0, blendMode: 'normal' },
        { name: 'nestedSlot', parent: 'hip', displayIndex: 0, blendMode: 'normal' },
        { name: 'tailSlot', parent: 'hip', displayIndex: 0, blendMode: 'normal' },
      ],
      skin: [
        {
          name: 'default',
          slot: [
            {
              name: 'bodySlot',
              display: [
                { name: 'bodyA', path: 'body-a', type: 'image' },
                { name: 'bodyB', path: 'body-b', type: 'image' },
              ],
            },
            {
              name: 'meshSlot',
              display: [{
                name: 'meshBody', path: 'mesh-body', type: 'mesh',
                vertices: [0, 0, 10, 0, 10, 10, 0, 10],
                uvs: [0, 0, 1, 0, 1, 1, 0, 1],
                triangles: [0, 1, 2, 0, 2, 3],
                weights: [1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1],
                bones: ['hip'],
              }],
            },
            {
              name: 'nestedSlot',
              display: [{ name: 'nested', type: 'armature' }],
            },
            {
              name: 'tailSlot',
              display: [{ name: 'tail', path: 'tail', type: 'image' }],
            },
          ],
        },
        {
          name: 'alt',
          slot: [{
            name: 'bodySlot',
            display: [{ name: 'bodyB', path: 'body-alt', type: 'image' }],
          }],
        },
      ],
      ik: [{
        name: 'legIk', bones: ['hip', 'arm'], target: 'target', mix: 0.9, order: 0,
      }],
      animation: [{
        name: 'walk',
        duration: 24,
        bone: [{
          name: 'arm',
          rotate: [{ duration: 12, rotate: 0 }, { duration: 12, rotate: 180 }],
        }],
        slot: [{
          name: 'bodySlot',
          displayIndex: [{ duration: 12, value: 1 }, { duration: 12, value: 0 }],
        }],
        ffd: [{
          name: 'meshSlot',
          vertices: [{ duration: 12, offset: [0, 0, 1, 0] }],
        }],
        zOrder: [{ duration: 12, zOrder: [1, 0, 2, 3] }],
      }],
    }],
  }
}

function atlasForFixture() {
  return importSpineAtlas(`sheet.png
size: 128,128
body-a
  bounds: 0,0,16,16
body-b
  bounds: 16,0,16,16
body-alt
  bounds: 32,0,16,16
mesh-body
  bounds: 48,0,16,16
tail
  bounds: 64,0,16,16
`)
}

function importWith(options?: { atlas?: boolean }): SkeletonAsset {
  return importDragonBones(dragonBonesFeaturesFixture(), {
    unitScale: SCALE,
    ...(options?.atlas === true ? { atlas: atlasForFixture() } : {}),
  })
}

describe('M11 DragonBones: 皮肤 / displayIndex / display 类型', () => {
  const asset = importWith()

  it('多皮肤全部保留，alt 皮肤可切换', () => {
    expect(asset.skins.size).toBe(2)
    expect(asset.skins.has('default')).toBe(true)
    expect(asset.skins.has('alt')).toBe(true)
    const alt = asset.skins.get('alt')!.attachments.get('bodyB')!
    if (alt.kind === 'region') expect(alt.region.atlasKey).toBe('body-alt')
  })

  it('slot displayIndex 选中对应 display', () => {
    const bodySlot = asset.slots.find((s) => s.id === 'bodySlot')!
    expect(bodySlot.attachment).toBe('bodyB')
    const meshSlot = asset.slots.find((s) => s.id === 'meshSlot')!
    expect(meshSlot.attachment).toBe('meshBody')
  })

  it('mesh display 解析权重并映射骨名到稳定 BoneId', () => {
    const mesh = asset.skins.get('default')!.attachments.get('meshBody')!
    expect(mesh.kind).toBe('weightedMesh')
    if (mesh.kind === 'weightedMesh') {
      expect(mesh.mesh.positions).toHaveLength(8)
      expect(Array.from(mesh.mesh.indices)).toEqual([0, 1, 2, 0, 2, 3])
      const hip = asset.skeleton.boneIdByName.get('hip')!
      // 空影响槽位回填 slot 所属骨（arm）。
      expect(mesh.mesh.boneIndices[0]).toBe(hip)
      expect(Array.from(mesh.mesh.weights.slice(0, 4))).toEqual([1, 0, 0, 0])
    }
  })

  it('armature display 记 W_SUBARMATURE 且跳过', () => {
    expect(asset.report.issues.some((i) => i.code === 'W_SUBARMATURE')).toBe(true)
    expect(asset.skins.get('default')!.attachments.has('nested')).toBe(false)
  })
})

describe('M11 DragonBones: 动画 / zOrder / ffd / 约束', () => {
  const asset = importWith()

  it('帧时间按 frameRate 秒化，zOrder 为完整顺序', () => {
    const clip = asset.animations.get('walk')!
    const rot = keyTimeline(clip, (t) => t.kind === 'rotate' && t.path === 'arm')
    expect(rot.keys[1]!.time).toBeCloseTo(0.5, 6)
    const order = keyTimeline(clip, (t) => t.path === 'drawOrder[0]')
    expect(order.keys[0]!.value).toBe(1)
    const allOrders = clip.timelines.filter((t) => 'keys' in t && t.kind === 'drawOrder')
    expect(allOrders).toHaveLength(asset.slots.length)
  })

  it('ffd 与 slot displayIndex 生成 deform/attachment timeline', () => {
    const clip = asset.animations.get('walk')!
    expect(clip.timelines.some((t) => t.kind === 'deform')).toBe(true)
    const attach = keyTimeline(clip, (t) => t.kind === 'attachment')
    expect(attach.keys[0]!.value).toBe(1)
    expect(attach.keys[1]!.value).toBe(0)
  })

  it('ik 约束映射链长与目标', () => {
    expect(asset.constraints).toHaveLength(1)
    const ik = asset.constraints![0]!
    expect(ik.kind).toBe('ik')
    if (ik.kind === 'ik') {
      expect(ik.bone).toBe(asset.skeleton.boneIdByName.get('arm'))
      expect(ik.targetBone).toBe(asset.skeleton.boneIdByName.get('target'))
      expect(ik.chainLength).toBe(2)
      expect(ik.weight).toBeCloseTo(0.9, 6)
    }
  })

  it('提供 atlas 后 display 的 region 引用可查表', () => {
    const withAtlas = importWith({ atlas: true })
    expect(withAtlas.atlas).toBeDefined()
    const body = withAtlas.skins.get('default')!.attachments.get('bodyB')!
    if (body.kind === 'region') {
      expect(body.region.atlasKey).toBe('body-b')
      expect(body.region.uvs).toEqual(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]))
    }
    expect(withAtlas.report.issues.some((i) => i.code === 'W_ATLAS_MISSING')).toBe(false)
  })
})
