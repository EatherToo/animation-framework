/**
 * S3 导入兼容：Spine 3.8 JSON → 4.2 兼容结构单测。
 *
 * 覆盖 3.8 关键差异：无 inherit 默认 normal、`transform` 旧名、weightedmesh
 * 附件、drawOrder offset 展开、缺 physics；坏版本/结构返回错误码。
 */
import { describe, expect, it } from '@jest/globals'
import { importSpine38, validateBoneWorld, type ImportIssue, type SkeletonAsset } from '@/asset/importer'
import type { AnimationClip } from '@/animation/animation'

const SCALE = 0.01
const HALF_PI = Math.PI / 2

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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 3.8 fixture：4 骨、2 slot、weightedmesh + region、rotate 与 drawOrder。
 * 骨源顺序 root=0, body=1, arm=2, hand=3。
 */
function fixture38(): Record<string, unknown> {
  const vertices: number[] = []
  for (const [x, y] of [[0, 0], [2, 0], [2, 4], [0, 4]] as const) {
    // 每顶点 2 影响：body(1) / arm(2)，各 0.5。
    vertices.push(2, 1, x, y, 0.5, 2, x, y, 0.5)
  }
  return {
    skeleton: { spine: '3.8.75', width: 200, height: 200 },
    bones: [
      { name: 'root' },
      // 3.8 无 inherit：兼容层补 normal。
      { name: 'body', parent: 'root', x: 0, y: -10, length: 10 },
      // 3.8 旧字段 transform → 4.2 inherit。
      { name: 'arm', parent: 'body', x: 5, y: 0, rotation: 90, length: 10, transform: 'onlyTranslation' },
      { name: 'hand', parent: 'arm', x: 10, y: 0, rotation: -30, length: 5 },
    ],
    slots: [
      { name: 'bodySlot', bone: 'body', attachment: 'body', color: 'ffffffff', blend: 'normal' },
      { name: 'handSlot', bone: 'hand', attachment: 'hand', color: 'ffffffff', blend: 'normal' },
    ],
    skins: [{
      name: 'default',
      attachments: {
        bodySlot: {
          body: {
            type: 'weightedmesh',
            path: 'body',
            uvs: [0, 0, 1, 0, 1, 1, 0, 1],
            triangles: [0, 1, 2, 0, 2, 3],
            vertices,
          },
        },
        handSlot: {
          hand: { type: 'region', path: 'hand', width: 10, height: 10, color: 'ffffffff' },
        },
      },
    }],
    animations: {
      wave: {
        bones: {
          arm: { rotate: [{ time: 0, angle: 0 }, { time: 0.5, angle: 720 }] },
        },
        // offset 列表：handSlot 前移 1 位 → 完整顺序 [handSlot, bodySlot]。
        drawOrder: [{ time: 0, offsets: [{ slot: 'handSlot', offset: -1 }] }],
      },
    },
  }
}

function expectedWorld(): ReadonlyMap<string, readonly [number, number]> {
  return new Map<string, readonly [number, number]>([
    ['root', [0, 0]],
    ['body', [0, 0.1]],
    ['arm', [0.05, 0.1]],
    ['hand', [0.05, 0.2]],
  ])
}

function codes(issues: readonly ImportIssue[]): string[] {
  return issues.map((issue) => issue.code)
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    return (error as Error & { code?: string }).code
  }
}

function clean(value: number): number {
  const rounded = Math.round(value * 1000) / 1000
  return rounded === 0 ? 0 : rounded
}

describe('S3 3.8: 兼容转换后的骨架/坐标/权重', () => {
  const asset = importSpine38(fixture38(), { unitScale: SCALE, sourceYDown: true })

  it('保留源版本 3.8.75 且 report.errors = 0', () => {
    expect(asset.source).toBe('spine')
    expect(asset.sourceVersion).toBe('3.8.75')
    expect(asset.unitScale).toBe(SCALE)
    expect(asset.report.errors).toBe(0)
  })

  it('关键姿态与坐标和 4.2 目标一致', () => {
    expect(asset.skeleton.count).toBe(4)
    const body = asset.skeleton.bones[asset.skeleton.boneIdByName.get('body')!]!
    const arm = asset.skeleton.bones[asset.skeleton.boneIdByName.get('arm')!]!
    const hand = asset.skeleton.bones[asset.skeleton.boneIdByName.get('hand')!]!
    expect(body.setup.y).toBeCloseTo(0.1, 6)
    expect(arm.setup.x).toBeCloseTo(0.05, 6)
    expect(arm.setup.rotation).toBeCloseTo(HALF_PI, 6)
    expect(hand.setup.rotation).toBeCloseTo(-Math.PI / 6, 6)
    expect(validateBoneWorld(asset, expectedWorld())).toEqual([])
  })

  it('无 inherit 默认 normal；3.8 transform 映射 inherit', () => {
    const body = asset.skeleton.bones[asset.skeleton.boneIdByName.get('body')!]!
    const arm = asset.skeleton.bones[asset.skeleton.boneIdByName.get('arm')!]!
    expect(body.inherit).toBe('normal')
    expect(arm.inherit).toBe('onlyTranslation')
  })

  it('weightedmesh 转为 mesh + 权重，BoneId 稳定', () => {
    const attachment = asset.skins.get('default')!.attachments.get('body')!
    expect(attachment.kind).toBe('weightedMesh')
    if (attachment.kind === 'weightedMesh') {
      expect(Array.from(attachment.mesh.weights.slice(0, 8)))
        .toEqual([0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0])
      const bodyId = asset.skeleton.boneIdByName.get('body')!
      const armId = asset.skeleton.boneIdByName.get('arm')!
      expect(Array.from(attachment.mesh.boneIndices.slice(0, 4)))
        .toEqual([bodyId, armId, bodyId, bodyId])
      expect(Array.from(attachment.mesh.positions.slice(0, 4)).map(clean))
        .toEqual([0, 0, 0.02, 0])
    }
  })

  it('drawOrder offset 展开为完整排列，rotate 保留连续角', () => {
    const clip = asset.animations.get('wave')!
    expect(clip.duration).toBeCloseTo(0.5, 6)
    const order0 = keyTimeline(clip, (t) => t.path === 'drawOrder[0]')
    const order1 = keyTimeline(clip, (t) => t.path === 'drawOrder[1]')
    expect(order0.keys[0]!.value).toBe(1)
    expect(order1.keys[0]!.value).toBe(0)
    const rotate = keyTimeline(clip, (t) => t.kind === 'rotate' && t.path === 'arm')
    expect(rotate.keys[1]!.value).toBeGreaterThan(2 * Math.PI)
  })

  it('缺 physics 不产生 W_PHYSICS_SKIPPED', () => {
    expect(codes(asset.report.issues)).not.toContain('W_PHYSICS_SKIPPED')
  })

  it('同输入两次导入 hash 稳定', () => {
    const again = importSpine38(fixture38(), { unitScale: SCALE, sourceYDown: true })
    expect(asset.hash).toBe(again.hash)
    expect(asset.hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('S3 3.8: 坏 fixture 与降级', () => {
  it('E_SPINE_VERSION：4.2 输入走错入口', () => {
    const doc = clone(fixture38()) as Record<string, any>
    doc.skeleton.spine = '4.2.33'
    expect(errorCode(() => importSpine38(doc, { unitScale: SCALE }))).toBe('E_SPINE_VERSION')
  })

  it('E_SCHEMA：缺 skeleton / bones', () => {
    expect(errorCode(() => importSpine38({ bones: [] }, { unitScale: SCALE }))).toBe('E_SCHEMA')
    expect(errorCode(() => importSpine38({ skeleton: { spine: '3.8.75' } }, { unitScale: SCALE }))).toBe('E_SCHEMA')
  })

  it('sequence 附件显式降级 W_SEQUENCE，不静默', () => {
    const doc = clone(fixture38()) as Record<string, any>
    doc.skins[0].attachments.handSlot.hand.type = 'sequence'
    const asset = importSpine38(doc, { unitScale: SCALE })
    expect(codes(asset.report.issues)).toContain('W_SEQUENCE')
  })

  it('未知附件类型记 W_ATTACHMENT_UNSUPPORTED，按 region 降级', () => {
    const doc = clone(fixture38()) as Record<string, any>
    doc.skins[0].attachments.handSlot.hand.type = 'mystery'
    const asset = importSpine38(doc, { unitScale: SCALE })
    expect(codes(asset.report.issues)).toContain('W_ATTACHMENT_UNSUPPORTED')
  })

  it('3.8 若带 physics，显式记录 W_PHYSICS_SKIPPED', () => {
    const doc = clone(fixture38()) as Record<string, any>
    doc.physics = [{ name: 'hair' }]
    const asset = importSpine38(doc, { unitScale: SCALE })
    expect(codes(asset.report.issues)).toContain('W_PHYSICS_SKIPPED')
  })

  it('不支持的 shear timeline 显式告警', () => {
    const doc = clone(fixture38()) as Record<string, any>
    doc.animations.wave.bones.arm.shear = [{ time: 0, x: 0, y: 0 }]
    const asset = importSpine38(doc, { unitScale: SCALE })
    expect(codes(asset.report.issues)).toContain('W_TIMELINE_UNSUPPORTED')
  })
})

function ensureAsset(value: SkeletonAsset): SkeletonAsset {
  return value
}

describe('S3 3.8: 返回类型可用', () => {
  it('导入产物可传回 validateBoneWorld', () => {
    expect(ensureAsset(importSpine38(fixture38(), { unitScale: SCALE, sourceYDown: true })).schema).toBe(1)
  })
})
