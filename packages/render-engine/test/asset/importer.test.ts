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
import { createTrack, sampleAnimation, type AnimationClip, type DeformTimeline } from '@/animation/animation'
import { createPose } from '@/core/pose'
import { createSlotSet } from '@/slot/slot'

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
  const asset = importSpine(spineFixture(), { unitScale: SCALE, sourceYDown: true })

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

  it('缺省 slot 和附件颜色不产生回退诊断', () => {
    const fixture = spineFixture() as any
    delete fixture.slots[0].color
    delete fixture.skins[0].attachments.bodySlot.body.color
    const parsed = importSpine(fixture, { unitScale: SCALE, sourceYDown: true })
    expect(parsed.report.issues.filter((issue) => issue.code === 'I_COLOR_DEFAULT')).toEqual([])
  })

  it('默认 Spine y-up，显式 sourceYDown 才转换坐标', () => {
    const standard = importSpine(spineFixture(), { unitScale: SCALE })
    expect(standard.skeleton.bones[1]!.setup.y).toBeCloseTo(-0.1, 6)
    expect(asset.skeleton.bones[1]!.setup.y).toBeCloseTo(0.1, 6)
  })

  it('保留动画段曲线并按 Spine 偏移算法重建 drawOrder', () => {
    const fixture = spineFixture() as any
    fixture.animations.wave.bones.arm.rotate[0].curve = 'stepped'
    fixture.animations.wave.bones.hand.translate[0].curve = [0.25, 2, 0.75, 8, 0.25, 4, 0.75, 16]
    const parsed = importSpine(fixture, { unitScale: SCALE, sourceYDown: true })
    const clip = parsed.animations.get('wave')!
    const rotate = keyTimeline(clip, (t) => t.kind === 'rotate' && t.path === 'arm')
    const translate = keyTimeline(clip, (t) => t.kind === 'translate' && t.path === 'hand.x')
    expect((rotate.keys[0] as any).curve).toBe('stepped')
    const translateY = keyTimeline(clip, (t) => t.kind === 'translate' && t.path === 'hand.y')
    for (const timeline of [translate, translateY]) {
      const curve = (timeline.keys[0] as any).curve as number[]
      for (const [index, expected] of [0.25, 0.2, 0.75, 0.8].entries()) {
        expect(curve[index]).toBeCloseTo(expected, 6)
      }
    }
    const order = keyTimeline(clip, (t) => t.path === 'drawOrder[0]')
    expect(order.keys[0]!.value).toBe(1)

    fixture.slots.push(
      { name: 'third', bone: 'spine' },
      { name: 'fourth', bone: 'spine' },
    )
    fixture.animations.wave.drawOrder = [{
      time: 0, offsets: [{ slot: 'bodySlot', offset: 1 }, { slot: 'handSlot', offset: 1 }],
    }]
    const four = importSpine(fixture, { unitScale: SCALE, sourceYDown: true }).animations.get('wave')!
    const values = [0, 1, 2, 3].map((index) =>
      keyTimeline(four, (t) => t.path === `drawOrder[${index}]`).keys[0]!.value,
    )
    expect(values).toEqual([2, 0, 1, 3])
  })

  it('骨骼键保持 setup 偏移/倍数并导入逐轴与 shear 变体', () => {
    const fixture = spineFixture() as any
    fixture.bones[2].scaleX = 2
    fixture.animations.wave.bones.arm.translatex = [{ time: 0.25, value: 10 }]
    fixture.animations.wave.bones.arm.scalex = [{ time: 0.25, value: 1.5 }]
    fixture.animations.wave.bones.arm.shear = [{ time: 0.5, x: 15, y: -20 }]
    fixture.animations.wave.bones.arm.sheary = [{ time: 0.75, value: 30 }]
    const clip = importSpine(fixture, { unitScale: SCALE, sourceYDown: true }).animations.get('wave')!
    const get = (kind: string, path: string) => keyTimeline(clip, (t) => t.kind === kind && t.path === path).keys[0]!.value
    expect(get('translate', 'hand.x')).toBeCloseTo(0, 6)
    expect(get('translate', 'arm.x')).toBeCloseTo(0.1, 6)
    expect(get('scale', 'arm.sx')).toBeCloseTo(1.5, 6)
    expect(get('shear', 'arm.shx')).toBeCloseTo(15 * Math.PI / 180, 6)
    expect(get('shear', 'arm.shy')).toBeCloseTo(30 * Math.PI / 180, 6)
  })

  it('双分量 shear 曲线分别读取控制点的绝对时间和值', () => {
    const fixture = spineFixture() as any
    fixture.animations.wave.bones.arm.shear = [
      { time: 0, x: 0, y: 0, curve: [0.25, 5, 0.75, 10, 0.25, -2, 0.75, -8] },
      { time: 1, x: 15, y: -10 },
    ]
    const clip = importSpine(fixture, { unitScale: SCALE, sourceYDown: true }).animations.get('wave')!
    const x = keyTimeline(clip, (t) => t.kind === 'shear' && t.path === 'arm.shx')
    const y = keyTimeline(clip, (t) => t.kind === 'shear' && t.path === 'arm.shy')
    expect((x.keys[0] as any).curve[1]).toBeCloseTo(1 / 3, 6)
    expect((x.keys[0] as any).curve[3]).toBeCloseTo(2 / 3, 6)
    expect((y.keys[0] as any).curve).toEqual([0.25, 0.2, 0.75, 0.8])
  })

  it('导入 4.3 slot 颜色通道和双颜色载荷', () => {
    const fixture = spineFixture() as any
    fixture.animations.wave.slots.bodySlot = {
      rgba: [{ time: 0, color: 'ff804080', curve: 'stepped' }],
      rgb2: [{ time: 0.2, light: 'abcdef', dark: '123456' }],
      alpha: [{ time: 0.3, value: 0.4 }, { time: 0.4 }],
    }
    const clip = importSpine(fixture, { unitScale: SCALE, sourceYDown: true }).animations.get('wave')!
    const colors = clip.timelines.filter((item) => item.kind === 'color' && item.path === '0') as any[]
    expect(colors.map((item) => item.channel)).toEqual(['rgba', 'alpha', 'rgb2'])
    expect(colors[0].keys[0]).toMatchObject({ curve: 'stepped', light: { r: 1, a: 128 / 255 } })
    expect(colors[1].keys[1].light.a).toBe(0)
    expect(colors[2].keys[0]).toMatchObject({ light: { r: 171 / 255 }, dark: { r: 18 / 255 } })
  })

  it('slot rgba 曲线按分量展开并归一化绝对控制点', () => {
    const fixture = spineFixture() as any
    fixture.animations.wave.slots.bodySlot = {
      rgba: [
        { time: 0, color: '00000000', curve: [
          0.25, 0, 0.75, 0, 0.25, 1, 0.75, 1,
          0.25, 0, 0.75, 0, 0.25, 1, 0.75, 1,
        ] },
        { time: 1, color: 'ffffffff' },
      ],
    }
    const clip = importSpine(fixture, { unitScale: SCALE, sourceYDown: true }).animations.get('wave')!
    const timeline = clip.timelines.find((item) => item.kind === 'color' && item.channel === 'rgba') as any
    expect(timeline.keys[0].curves).toEqual([
      [0.25, 0, 0.75, 0], [0.25, 1, 0.75, 1],
      [0.25, 0, 0.75, 0], [0.25, 1, 0.75, 1],
    ])
  })

  it('4.3 transform properties 只启用声明的目标通道并继承 Y mix', () => {
    const fixture = spineFixture() as any
    fixture.constraints = [{
      type: 'transform', name: 'partial', source: 'arm', bones: ['hand'],
      mixX: 0, mixScaleX: 0.3,
      localSource: true, localTarget: true, additive: true, clamp: true,
      properties: { x: { offset: 2, to: { x: {}, y: { offset: 4, max: 8, scale: 2 } } },
        y: { to: { y: {} } }, scaleX: { to: { scaleX: {} } } },
    }]
    const asset = importSpine(fixture, { unitScale: SCALE, sourceYDown: true })
    expect(asset.constraints?.[0]).toMatchObject({
      kind: 'transform', mixRotate: 0, mixX: 0, mixY: 0,
      mixScaleX: 0.3, mixScaleY: 0, mixShearY: 0,
      localSource: true, localTarget: true, additive: true, clamp: true,
      properties: expect.arrayContaining([{ kind: 'x', offset: 0.02, to: [
        { kind: 'x', offset: 0, max: 0.01, scale: 1 },
        { kind: 'y', offset: -0.04, max: -0.08, scale: -2 },
      ] }]),
    })
  })

  it('事件 timeline 保留数值和字符串载荷', () => {
    const fixture = spineFixture() as any
    fixture.animations.wave.events = [{ time: 0.5, name: 'step', int: 3, float: 0.75, string: 'left' }]
    const clip = importSpine(fixture, { unitScale: SCALE, sourceYDown: true }).animations.get('wave')!
    const timeline = clip.timelines.find((item) => item.kind === 'event')!
    expect(timeline).toMatchObject({ events: [{ time: 0.5, name: 'step', int: 3, float: 0.75, string: 'left' }] })
  })

  it('canonicalHash 稳定且为 64 位小写 hex', () => {
    const again = importSpine(spineFixture(), { unitScale: SCALE, sourceYDown: true })
    expect(asset.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(asset.hash).toBe(again.hash)
    expect(canonicalHash(coreOf(asset))).toBe(asset.hash)
    // 配置变化必须改变 hash。
    const other = importSpine(spineFixture(), { unitScale: 0.02, sourceYDown: true })
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

  it('unlimited default retains more than four influences without a limit issue', () => {
    const a = spineWith((d) => {
      d.skins[0].attachments.bodySlot.bodyMesh.vertices = [
        5, 0, 0, 0, 0.2, 1, 0, 0, 0.2, 2, 0, 0, 0.2, 3, 0, 0, 0.2, 0, 0, 0, 0.2,
      ]
    })
    const mesh = a.skins.get('default')!.attachments.get('bodySlot\u0000bodyMesh')!
    expect(mesh.kind).toBe('weightedMesh')
    if (mesh.kind !== 'weightedMesh') return
    expect(mesh.mesh.influencesPerVertex).toBe(5)
    for (const weight of mesh.mesh.weights.slice(0, 5)) expect(weight).toBeCloseTo(0.2)
    expect(codes(a.report.issues)).not.toContain('W_WEIGHT_LIMIT')
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

describe('Spine deform import', () => {
  it('4.3 attachments path preserves complete unweighted frames and samples absolute local vertices', () => {
    const fixture = spineFixture()
    const skins = fixture.skins as { attachments: Record<string, Record<string, unknown>> }[]
    skins[0]!.attachments.bodySlot!.bodyMesh = {
      type: 'mesh', path: 'body', uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      triangles: [0, 1, 2, 0, 2, 3], vertices: [1, 2, 3, 4, 5, 6, 7, 8],
    }
    const animation = (fixture.animations as Record<string, Record<string, unknown>>).wave!
    animation.attachments = { default: { bodySlot: { bodyMesh: { deform: [
      { time: 0, offset: 2, vertices: [12, 14, 16, 18] },
      { time: 1, offset: 2, vertices: [22, 24, 26, 28] },
    ] } } } }
    const asset = importSpine(fixture, { unitScale: SCALE, sourceYDown: true })
    const clip = asset.animations.get('wave')!
    const timeline = clip.timelines.find((t) => t.kind === 'deform') as DeformTimeline
    expect(timeline.skin).toBe('default')
    expect(timeline.slot).toBe(0)
    expect(timeline.attachment).toBe('bodyMesh')
    expect(timeline.keys).toMatchObject([{ offset: 2, vertices: [12, 14, 16, 18] }, { offset: 2, vertices: [22, 24, 26, 28] }])
    const result = sampleAnimation([createTrack({ ...clip, timelines: [timeline] }, { loop: false })], createPose(asset.skeleton),
      createSlotSet(asset.slots, asset.skins, 'default'), 0.5)
    const offsets = result.deformOffsets.get('default:0:bodyMesh')!
    expect(Array.from(offsets).map((v) => Number(v.toFixed(3)))).toEqual([0, 0, 0.14, -0.15, 0.16, -0.17, 0, 0])
  })

  it('legacy deform path keeps weighted component offset and runtime mesh key', () => {
    const fixture = spineFixture()
    const animation = (fixture.animations as Record<string, Record<string, unknown>>).wave!
    animation.deform = { default: { bodySlot: { bodyMesh: [
      { time: 0, offset: 2, vertices: [10, 20, 30, 40] },
    ] } } }
    const asset = importSpine(fixture, { unitScale: SCALE, sourceYDown: true })
    const clip = asset.animations.get('wave')!
    const timeline = clip.timelines.find((t) => t.kind === 'deform') as DeformTimeline
    expect(timeline.keys).toMatchObject([{ offset: 2, vertices: [10, 20, 30, 40] }])
    const result = sampleAnimation([createTrack({ ...clip, timelines: [timeline] }, { loop: false })], createPose(asset.skeleton),
      createSlotSet(asset.slots, asset.skins, 'default'), 0)
    const offsets = result.deformOffsets.get('default:0:bodyMesh')!
    expect(offsets).toHaveLength(32)
    expect(Array.from(offsets.subarray(0, 12)).map((v) => Number(v.toFixed(3))))
      .toEqual([0, 0, 0.1, -0.2, 0, 0, 0, 0, 0.3, -0.4, 0, 0])
  })
})

describe('M5 importer: validateBoneWorld', () => {
  it('原点全部吻合时返回空数组', () => {
    const a = importSpine(spineFixture(), { unitScale: SCALE, sourceYDown: true })
    expect(validateBoneWorld(a, expectedWorld())).toEqual([])
  })

  it('偏差 > 1e-3 米时报 error', () => {
    const a = importSpine(spineFixture(), { unitScale: SCALE, sourceYDown: true })
    const wrong = new Map(expectedWorld())
    wrong.set('hand', [0.05, 0.3])
    const issues = validateBoneWorld(a, wrong)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('error')
    expect(issues[0]!.path).toContain('hand')
  })
})
