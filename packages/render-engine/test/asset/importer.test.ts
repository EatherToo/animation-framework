/**
 * M5 资产导入单测（TDD）。
 * 手写最小 Spine 4.2 / DragonBones 4.5 fixture，覆盖双向坐标转换、动画秒化、
 * drawOrder/zOrder、权重裁剪、确定性 hash、10 类坏 fixture 与骨世界坐标校验。
 */
import { describe, expect, it } from '@jest/globals'
import {
  canonicalHash,
  importDragonBones,
  importSpine,
  validateBoneWorld,
  type ImportIssue,
  type SkeletonAsset,
} from '@/asset/importer'
import type { AnimationClip } from '@/animation/animation'

const HALF_PI = Math.PI / 2
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

/** 深拷贝 fixture，避免各用例之间互相污染。 */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/**
 * 最小 Spine 4.2 fixture。
 * 注意：源是 y-down，向上的骨 y 写成负值；导入后 (x,y)→(x,-y)。
 * 骨源数组顺序：root=0, spine=1, arm=2, hand=3。
 */
function spineFixture(): Record<string, unknown> {
  const meshVertices: number[] = []
  // 4 个顶点，每个 2 个影响（spine=1、arm=2），权重各 0.5。
  const corners: readonly (readonly [number, number])[] = [[0, 0], [2, 0], [2, 4], [0, 4]]
  for (const [x, y] of corners) {
    meshVertices.push(2, 1, x, y, 0.5, 2, x, y, 0.5)
  }
  return {
    skeleton: { spine: '4.2.33', width: 200, height: 200, fps: 30, images: './images/' },
    bones: [
      { name: 'root' },
      { name: 'spine', parent: 'root', x: 0, y: -10, rotation: 0, length: 10 },
      { name: 'arm', parent: 'spine', x: 5, y: 0, rotation: 90, length: 10 },
      { name: 'hand', parent: 'arm', x: 10, y: 0, rotation: -30, length: 5 },
    ],
    slots: [
      { name: 'bodySlot', bone: 'spine', attachment: 'body', color: 'ffffffff', blend: 'normal' },
      { name: 'handSlot', bone: 'hand', attachment: 'hand', color: 'ffffffff', blend: 'additive' },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          bodySlot: {
            body: { type: 'region', path: 'body', x: 0, y: 0, width: 20, height: 40, color: 'ffffffff' },
            bodyMesh: {
              type: 'mesh', path: 'body', uvs: [0, 0, 1, 0, 1, 1, 0, 1],
              triangles: [0, 1, 2, 0, 2, 3], vertices: meshVertices,
            },
          },
          handSlot: {
            hand: { type: 'region', path: 'hand', x: 0, y: 0, width: 10, height: 10 },
          },
        },
      },
      {
        name: 'alt',
        attachments: {
          handSlot: {
            hand: { type: 'region', path: 'hand-alt', x: 0, y: 0, width: 10, height: 10 },
          },
        },
      },
    ],
    // 可用图集 region 名单；path 不在其中即触发 E_MISSING_ATLAS。
    atlas: ['body', 'hand', 'hand-alt'],
    animations: {
      wave: {
        bones: {
          // 720° 连续角：导入后不得 wrap 成 0。
          arm: {
            rotate: [{ time: 0, angle: 0 }, { time: 0.5, angle: 720 }, { time: 1, angle: 0 }],
          },
          hand: {
            translate: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 10, y: 20 }],
          },
        },
        slots: {
          handSlot: { color: [{ time: 0, color: 'ffffffff' }, { time: 1, color: 'ff0000ff' }] },
        },
        // 相对 setup 顺序 [bodySlot, handSlot]：handSlot 前移 1 位 → [handSlot, bodySlot]。
        drawOrder: [
          { time: 0, offsets: [{ slot: 'handSlot', offset: -1 }] },
          { time: 1, offsets: [] },
        ],
        events: [{ time: 0.5, name: 'clap' }],
      },
    },
    events: { clap: { int: 1, float: 0.5, string: 'x' } },
  }
}

/** 最小 DragonBones 4.5 fixture：帧时间需除以 frameRate。 */
function dragonBonesFixture(): Record<string, unknown> {
  return {
    version: '4.5',
    compatibleVersion: '4.5',
    frameRate: 24,
    name: 'Dragon',
    SubTexture: [{ name: 'body', x: 0, y: 0, width: 20, height: 40 }],
    armature: [{
      name: 'Dragon',
      frameRate: 24,
      bone: [
        { name: 'root' },
        { name: 'spine', parent: 'root', length: 10,
          transform: { x: 0, y: -10, skX: 0, skY: 0, scX: 1, scY: 1 } },
        // skX/skY = -90° 经 y 翻转后得到目标 +90°（与 Spine 的 arm 对齐）。
        { name: 'arm', parent: 'spine', length: 10,
          transform: { x: 5, y: 0, skX: -90, skY: -90, scX: 1, scY: 1 } },
        { name: 'hand', parent: 'arm', length: 5,
          transform: { x: 10, y: 0, skX: 0, skY: 0, scX: 1, scY: 1 } },
      ],
      slot: [{
        name: 'bodySlot', parent: 'spine', displayIndex: 0, blendMode: 'normal',
        color: { aM: 100, rM: 100, gM: 100, bM: 100, aO: 0, rO: 0, gO: 0, bO: 0 },
      }],
      skin: [{
        name: 'default',
        slot: [{
          name: 'bodySlot',
          display: [{
            name: 'body', path: 'body', type: 'image',
            transform: { x: 0, y: 0, skX: 0, skY: 0, scX: 1, scY: 1 },
          }],
        }],
      }],
      animation: [{
        name: 'walk',
        duration: 48,
        bone: [{
          name: 'arm',
          // duration 是帧数：12/24=0.5s，24/24=1s。
          rotate: [{ duration: 12, rotate: 0 }, { duration: 12, rotate: 360 }],
        }],
        // 事件在第二帧起点：24 帧 / 24fps = 1 秒。
        frame: [{ duration: 24 }, { duration: 24, event: 'step' }],
        zOrder: [{ duration: 24, zOrder: [0] }],
      }],
    }],
  }
}

/** 期望的 setup 骨原点（米）：Spine 与 DB fixture 几何一致。 */
function expectedWorld(): ReadonlyMap<string, readonly [number, number]> {
  return new Map<string, readonly [number, number]>([
    ['root', [0, 0]],
    ['spine', [0, 0.1]],
    ['arm', [0.05, 0.1]],
    ['hand', [0.05, 0.2]],
  ])
}

/** 取 asset 中参与 hash 的部分。 */
function coreOf(asset: SkeletonAsset): Omit<SkeletonAsset, 'hash' | 'report'> {
  const { hash: _hash, report: _report, ...core } = asset
  return core
}

describe('M5 importer: Spine 4.2 正常导入', () => {
  const asset = importSpine(spineFixture(), { unitScale: SCALE })

  it('骨数/名字/父子/坐标共轭正确', () => {
    expect(asset.source).toBe('spine')
    expect(asset.sourceVersion).toBe('4.2.33')
    expect(asset.unitScale).toBe(SCALE)
    expect(asset.skeleton.count).toBe(4)
    expect(Array.from(asset.skeleton.boneIdByName.keys())).toEqual(['root', 'spine', 'arm', 'hand'])
    const sk = asset.skeleton
    expect(sk.boneIdByName.get('arm')).toBe(2)
    expect(sk.parent[sk.boneIdByName.get('arm')!]).toBe(1)
    expect(sk.parent[sk.boneIdByName.get('hand')!]).toBe(2)
    // (x,y)→(x,-y)，角度由度转弧度；90° 翻转后目标旋转 +π/2。
    expect(sk.bones[1]!.setup.y).toBeCloseTo(0.1, 6)
    expect(sk.bones[2]!.setup.x).toBeCloseTo(0.05, 6)
    expect(sk.bones[2]!.setup.rotation).toBeCloseTo(HALF_PI, 6)
    expect(sk.bones[3]!.setup.rotation).toBeCloseTo(-Math.PI / 6, 6)
    expect(validateBoneWorld(asset, expectedWorld())).toEqual([])
  })

  it('slots / skins / weightedMesh 与默认皮肤正确', () => {
    expect(asset.slots).toHaveLength(2)
    expect(asset.slots[0]!.order).toBe(0)
    expect(asset.slots[0]!.blend).toBe('normal')
    expect(asset.slots[1]!.blend).toBe('add')
    expect(asset.skins.size).toBe(2)
    expect(asset.skins.has('default')).toBe(true)
    const bodyMesh = asset.skins.get('default')!.attachments.get('bodyMesh')!
    expect(bodyMesh.kind).toBe('weightedMesh')
    if (bodyMesh.kind === 'weightedMesh') {
      expect(Array.from(bodyMesh.mesh.weights.slice(0, 8))).toEqual([0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0])
      // 源骨下标 1/2 已换成稳定 BoneId。
      // 空影响槽位填 slot 所属骨（spine=1）。
      expect(Array.from(bodyMesh.mesh.boneIndices.slice(0, 4))).toEqual([1, 2, 1, 1])
    }
  })

  it('动画时间秒化、连续角、drawOrder 完整顺序与事件', () => {
    const clip = asset.animations.get('wave')!
    expect(clip.duration).toBe(1)
    const rot = keyTimeline(clip, (t) => t.kind === 'rotate' && t.path === 'arm')
    expect(rot.kind).toBe('rotate')
    expect(rot.keys[1]!.value).toBeGreaterThan(2 * Math.PI) // 720° 保留圈数
    const trans = keyTimeline(clip, (t) => t.kind === 'translate' && t.path === 'hand.y')
    expect(trans.keys[1]!.value).toBeCloseTo(-0.2, 6) // y 翻转
    const order0 = keyTimeline(clip, (t) => t.path === 'drawOrder[0]')
    expect(order0.keys[0]!.value).toBe(1) // [handSlot, bodySlot]
    expect(order0.keys[1]!.value).toBe(0) // setup 顺序
    expect(asset.events).toEqual([{ time: 0.5, name: 'clap' }])
  })

  it('canonicalHash 稳定且为 64 位小写 hex', () => {
    const again = importSpine(spineFixture(), { unitScale: SCALE })
    expect(asset.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(asset.hash).toBe(again.hash)
    expect(canonicalHash(coreOf(asset))).toBe(asset.hash)
    // 配置变化必须改变 hash。
    const other = importSpine(spineFixture(), { unitScale: 0.02 })
    expect(other.hash).not.toBe(asset.hash)
  })

  it('导入结果顶层只读', () => {
    expect(Object.isFrozen(asset)).toBe(true)
    expect(Object.isFrozen(asset.slots)).toBe(true)
  })
})

describe('M5 importer: DragonBones 4.5 正常导入', () => {
  const asset = importDragonBones(dragonBonesFixture(), { unitScale: SCALE })

  it('骨数/父子/坐标共轭与 zOrder、时间秒化', () => {
    expect(asset.source).toBe('dragonbones')
    expect(asset.sourceVersion).toBe('4.5')
    expect(asset.skeleton.count).toBe(4)
    expect(validateBoneWorld(asset, expectedWorld())).toEqual([])
    const clip = asset.animations.get('walk')!
    const rot = keyTimeline(clip, (t) => t.kind === 'rotate' && t.path === 'arm')
    expect(rot.keys).toHaveLength(2)
    expect(rot.keys[1]!.time).toBeCloseTo(0.5, 6) // 12 帧 / 24fps
    expect(rot.keys[1]!.value).toBeCloseTo(-2 * Math.PI - HALF_PI, 6) // -360° 减 setup 90°，保留圈数
    expect(asset.events).toEqual([{ time: 1, name: 'step' }])
    const order0 = keyTimeline(clip, (t) => t.path === 'drawOrder[0]')
    expect(order0.keys[0]!.time).toBeCloseTo(0, 6)
    expect(order0.keys[0]!.value).toBe(0)
  })

  it('DB fixture 两次导入 hash 稳定', () => {
    const again = importDragonBones(dragonBonesFixture(), { unitScale: SCALE })
    expect(asset.hash).toBe(again.hash)
  })
})

/**
 * 10 类坏 fixture：7 个 error + 3 个 warning。
 * 全部以 compat 方式收集进 report，不抛异常（结构性 JSON 非法才抛）。
 */
describe('M5 importer: 10 类坏 fixture 触发对应 issue code', () => {
  function codes(issues: readonly ImportIssue[]): string[] {
    return issues.map((i) => i.code)
  }

  function spineWith(mutate: (doc: Record<string, any>) => void, options?: { defaultSkin?: string }): SkeletonAsset {
    const doc = clone(spineFixture()) as Record<string, any>
    mutate(doc)
    return importSpine(doc, { unitScale: SCALE, ...options })
  }

  it('E_BONE_PARENT：父骨不存在', () => {
    const a = spineWith((d) => { d.bones[1].parent = 'ghost' })
    expect(a.report.issues.map((i) => i.code)).toContain('E_BONE_PARENT')
    expect(a.report.errors).toBeGreaterThan(0)
  })

  it('E_BONE_CYCLE：父子成环', () => {
    const a = spineWith((d) => { d.bones[0].parent = 'hand' })
    expect(codes(a.report.issues)).toContain('E_BONE_CYCLE')
  })

  it('E_WEIGHT_SUM：权重和 ≤ 0', () => {
    const a = spineWith((d) => {
      d.skins[0].attachments.bodySlot.bodyMesh.vertices = [2, 1, 0, 0, 0, 2, 0, 0, 0]
    })
    expect(codes(a.report.issues)).toContain('E_WEIGHT_SUM')
  })

  it('E_INDEX_RANGE：三角形索引越界', () => {
    const a = spineWith((d) => { d.skins[0].attachments.bodySlot.bodyMesh.triangles = [0, 1, 999] })
    expect(codes(a.report.issues)).toContain('E_INDEX_RANGE')
  })

  it('E_MISSING_ATLAS：region 无对应图集', () => {
    const a = spineWith((d) => { d.skins[0].attachments.bodySlot.body.path = 'ghost' })
    expect(codes(a.report.issues)).toContain('E_MISSING_ATLAS')
  })

  it('E_UNKNOWN_BLEND：blend 字段类型非法', () => {
    const a = spineWith((d) => { d.slots[0].blend = 123 })
    expect(codes(a.report.issues)).toContain('E_UNKNOWN_BLEND')
  })

  it('E_DUPLICATE_NAME：骨名重复', () => {
    const a = spineWith((d) => { d.bones[2].name = 'spine' })
    expect(codes(a.report.issues)).toContain('E_DUPLICATE_NAME')
  })

  it('W_WEIGHT_PRUNED：影响 >4 保留前 4', () => {
    const a = spineWith((d) => {
      d.skins[0].attachments.bodySlot.bodyMesh.vertices = [
        5, 0, 0, 0, 0.2, 1, 0, 0, 0.2, 2, 0, 0, 0.2, 3, 0, 0, 0.2, 0, 0, 0, 0.2,
      ]
    })
    expect(codes(a.report.issues)).toContain('W_WEIGHT_PRUNED')
    expect(a.report.warnings).toBeGreaterThan(0)
  })

  it('W_BLEND_UNKNOWN：未知 blend 字符串降级 normal', () => {
    const a = spineWith((d) => { d.slots[0].blend = 'erase' })
    expect(codes(a.report.issues)).toContain('W_BLEND_UNKNOWN')
    expect(a.slots[0]!.blend).toBe('normal')
  })

  it('W_SKIN_MISSING：默认皮肤不存在', () => {
    const a = spineWith(() => {}, { defaultSkin: 'nope' })
    expect(codes(a.report.issues)).toContain('W_SKIN_MISSING')
    expect(a.skins.size).toBe(2)
  })

  it('结构性 JSON 非法仍抛错', () => {
    expect(() => importSpine({ skeleton: { spine: '4.2.0' }, bones: 'bad' }, { unitScale: SCALE })).toThrow()
  })
})

describe('M5 importer: validateBoneWorld', () => {
  it('原点全部吻合时返回空数组', () => {
    const a = importSpine(spineFixture(), { unitScale: SCALE })
    expect(validateBoneWorld(a, expectedWorld())).toEqual([])
  })

  it('偏差 > 1e-3 米时报 error', () => {
    const a = importSpine(spineFixture(), { unitScale: SCALE })
    const wrong = new Map(expectedWorld())
    wrong.set('hand', [0.05, 0.3])
    const issues = validateBoneWorld(a, wrong)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('error')
    expect(issues[0]!.path).toContain('hand')
  })
})
