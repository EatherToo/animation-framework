/**
 * M11 Spine 4.x 功能单测：region/mesh/weightedmesh/linkedmesh/boundingbox/path/
 * point/clipping、约束、动画 deform/ik/drawOrder，以及 atlas 参数注入。
 */
import { describe, expect, it } from '@jest/globals'
import { importSpine, type SkeletonAsset } from '@/asset/importer'
import { importSpineAtlas } from '@/asset/atlas'
import type { AnimationClip, Timeline } from '@/animation/animation'

const SCALE = 0.01

type KeyTimeline = Extract<Timeline, { keys: unknown }>
function keyTimeline(clip: AnimationClip, predicate: (t: KeyTimeline) => boolean): KeyTimeline {
  return clip.timelines.find(
    (t): t is KeyTimeline => 'keys' in t && predicate(t as KeyTimeline),
  )!
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** Float32 结果的稳定比较值：消掉 -0 与尾差。 */
function clean(v: number): number {
  return Math.abs(v) < 1e-6 ? 0 : Math.round(v * 1000) / 1000
}

/** 6 骨 fixture：root/hip/torso/arm/hand/target。 */
function spineFeaturesFixture(): Record<string, unknown> {
  const weighted: number[] = []
  for (const [x, y] of [[0, 0], [10, 0], [10, 10], [0, 10]] as const) {
    weighted.push(1, 1, x, y, 1)
  }
  return {
    skeleton: { spine: '4.2.33', width: 200, height: 200, fps: 30 },
    bones: [
      { name: 'root' },
      { name: 'hip', parent: 'root', x: 0, y: -10, length: 10 },
      { name: 'torso', parent: 'hip', x: 0, y: -10, rotation: 0, length: 10 },
      { name: 'arm', parent: 'torso', x: 10, y: 0, rotation: 90, length: 10 },
      { name: 'hand', parent: 'arm', x: 10, y: 0, length: 5 },
      { name: 'target', parent: 'root', x: 20, y: -20 },
    ],
    slots: [
      { name: 'bodySlot', bone: 'torso', attachment: 'body', color: 'ffffffff', blend: 'normal' },
      { name: 'linkSlot', bone: 'arm', attachment: 'link', color: 'ffffffff', blend: 'normal' },
      { name: 'clipSlot', bone: 'torso', attachment: 'clip', color: 'ffffffff', blend: 'normal' },
      { name: 'clipEndSlot', bone: 'torso', color: 'ffffffff', blend: 'normal' },
      { name: 'pathSlot', bone: 'torso', attachment: 'trail', color: 'ffffffff', blend: 'normal' },
      { name: 'bboxSlot', bone: 'torso', attachment: 'hit', color: 'ffffffff', blend: 'normal' },
      { name: 'pointSlot', bone: 'hand', attachment: 'muzzle', color: 'ffffffff', blend: 'normal' },
      { name: 'ghostSlot', bone: 'torso', attachment: 'ghost', color: 'ffffffff', blend: 'normal' },
    ],
    skins: [{
      name: 'default',
      attachments: {
        bodySlot: {
          body: {
            type: 'region', path: 'body', x: 0, y: 0, width: 40, height: 30,
            uvs: [0, 0, 1, 0, 1, 1, 0, 1], color: 'ff0000ff',
          },
          bodyMesh: {
            type: 'mesh', path: 'body', uvs: [0, 0, 1, 0, 1, 1, 0, 1],
            triangles: [0, 1, 2, 0, 2, 3],
            vertices: [0, 0, 10, 0, 10, 10, 0, 10],
            hull: 4, edges: [0, 1, 1, 2], width: 10, height: 10,
          },
          bodyWeighted: {
            type: 'mesh', path: 'body', uvs: [0, 0, 1, 0, 1, 1, 0, 1],
            triangles: [0, 1, 2, 0, 2, 3], vertices: weighted,
          },
        },
        linkSlot: {
          link: {
            type: 'linkedmesh', parent: 'bodyMesh', path: 'link',
            vertices: [0, 0, 5, 0, 5, 5, 0, 5],
          },
        },
        clipSlot: {
          clip: {
            type: 'clipping', end: 'clipEndSlot', inverted: true,
            vertices: [0, 0, 10, 0, 10, 10, 0, 10],
          },
        },
        pathSlot: {
          trail: { type: 'path', vertices: [0, 0, 10, 0, 10, 10, 0, 10] },
        },
        bboxSlot: {
          hit: { type: 'boundingbox', vertices: [0, 0, 10, 0, 10, 10, 0, 10] },
        },
        pointSlot: {
          muzzle: { type: 'point', x: 3, y: 4, rotation: 15 },
        },
        ghostSlot: {
          ghost: { type: 'region', path: 'ghost', width: 4, height: 4 },
        },
      },
    }],
    ik: [{
      name: 'legIk', order: 1, bones: ['hip', 'torso'], target: 'target',
      mix: 0.8, bendPositive: false, compress: false, stretch: false,
    }],
    transform: [{
      name: 'follow', order: 0, bones: ['arm'], target: 'hand',
      mixRotate: 0.5, mixX: 0.25, mixY: 0.25,
    }],
    path: [{
      name: 'pathFollow', order: 2, bones: ['hand'], target: 'trail', mixX: 0.5,
    }],
    animations: {
      walk: {
        bones: { arm: { rotate: [{ time: 0, angle: 0 }, { time: 0.5, angle: 90 }] } },
        slots: {
          bodySlot: {
            attachment: [{ time: 0, name: 'body' }, { time: 0.5, name: '' }],
            color: [{ time: 0, color: 'ffffffff' }, { time: 0.5, color: '00ff00ff' }],
          },
        },
        deform: {
          default: { bodySlot: { bodyMesh: [{ time: 0, vertices: [0, 0, 1, 0] }] } },
        },
        drawOrder: [{ time: 0, offsets: [{ slot: 'bodySlot', offset: 2 }] }],
        ik: { legIk: [{ time: 0, mix: 1 }, { time: 0.5, mix: 0.2 }] },
        events: [{ time: 0.25, name: 'step' }],
      },
    },
  }
}

function atlasForFixture() {
  return importSpineAtlas(`sheet.png
size: 256,256
body
  bounds: 10,20,40,30
  offsets: 0,0,40,30
link
  bounds: 60,20,10,10
  offsets: 0,0,10,10
`)
}

function importWith(options?: { atlas?: boolean }): SkeletonAsset {
  return importSpine(spineFeaturesFixture(), {
    unitScale: SCALE,
    ...(options?.atlas === true ? { atlas: atlasForFixture() } : {}),
  })
}

describe('M11 Spine: 附件全类型解析', () => {
  const asset = importWith()
  const attachments = asset.skins.get('default')!.attachments

  it('region 解析 uvs / color', () => {
    const body = attachments.get('body')!
    expect(body.kind).toBe('region')
    if (body.kind === 'region') {
      expect(body.region.atlasKey).toBe('body')
      expect(body.region.uvs).toEqual(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]))
      expect(body.color.r).toBeCloseTo(1, 6)
      expect(body.color.a).toBeCloseTo(1, 6)
    }
  })

  it('mesh 解析 vertices/uvs/triangles/hull/edges', () => {
    const mesh = attachments.get('bodyMesh')!
    expect(mesh.kind).toBe('mesh')
    if (mesh.kind === 'mesh') {
      expect(mesh.mesh.positions).toHaveLength(8)
      expect(mesh.mesh.uvs).toHaveLength(8)
      expect(Array.from(mesh.mesh.indices)).toEqual([0, 1, 2, 0, 2, 3])
      const extra = mesh.mesh as typeof mesh.mesh & { hull?: number; edges?: Uint16Array }
      expect(extra.hull).toBe(4)
      expect(Array.from(extra.edges ?? [])).toEqual([0, 1, 1, 2])
    }
  })

  it('weightedmesh 解析权重且映射稳定 BoneId', () => {
    const mesh = attachments.get('bodyWeighted')!
    expect(mesh.kind).toBe('weightedMesh')
    if (mesh.kind === 'weightedMesh') {
      expect(Array.from(mesh.mesh.weights.slice(0, 8))).toEqual([1, 0, 0, 0, 1, 0, 0, 0])
      const hip = asset.skeleton.boneIdByName.get('hip')!
      const torso = asset.skeleton.boneIdByName.get('torso')!
      // 空影响槽位按既有约定回填 slot 所属骨（torso）。
      expect(Array.from(mesh.mesh.boneIndices.slice(0, 4))).toEqual([hip, torso, torso, torso])
    }
  })

  it('linkedmesh 复用父拓扑与 UV，应用自身 vertices', () => {
    const link = attachments.get('link')!
    const parent = attachments.get('bodyMesh')!
    expect(link.kind).toBe('mesh')
    expect(parent.kind).toBe('mesh')
    if (link.kind === 'mesh' && parent.kind === 'mesh') {
      expect(Array.from(link.mesh.indices)).toEqual(Array.from(parent.mesh.indices))
      expect(Array.from(link.mesh.uvs)).toEqual(Array.from(parent.mesh.uvs))
      expect(Array.from(link.mesh.positions).map(clean)).toEqual([
        0, 0, 0.05, 0, 0.05, -0.05, 0, -0.05,
      ])
      expect(link.region.atlasKey).toBe('link')
    }
  })

  it('boundingbox/path/point/clipping 保留局部坐标', () => {
    const bbox = attachments.get('hit')!
    expect(bbox.kind).toBe('boundingBox')
    if (bbox.kind === 'boundingBox') expect(bbox.polygon).toHaveLength(8)
    const path = attachments.get('trail')!
    expect(path.kind).toBe('path')
    if (path.kind === 'path') expect(path.polygon).toHaveLength(8)
    const point = attachments.get('muzzle')!
    expect(point.kind).toBe('point')
    if (point.kind === 'point') expect(Array.from(point.point)).toEqual([0.03, -0.04])
    const clip = attachments.get('clip')!
    expect(clip.kind).toBe('clipping')
    if (clip.kind === 'clipping') {
      expect(Array.from(clip.polygon).map(clean))
        .toEqual([0, 0, 0.1, 0, 0.1, -0.1, 0, -0.1])
    }
  })
})

describe('M11 Spine: 约束与 maskLibrary', () => {
  const asset = importWith()

  it('ik/transform/path 约束数量与字段正确', () => {
    expect(asset.constraints).toHaveLength(3)
    const ik = asset.constraints!.find((c) => c.kind === 'ik')!
    expect(ik.id).toBe('legIk')
    expect(ik.bone).toBe(asset.skeleton.boneIdByName.get('torso'))
    if (ik.kind === 'ik') {
      expect(ik.targetBone).toBe(asset.skeleton.boneIdByName.get('target'))
      expect(ik.chainLength).toBe(2)
      expect(ik.bendSign).toBe(-1)
      expect(ik.weight).toBeCloseTo(0.8, 6)
    }
    const tr = asset.constraints!.find((c) => c.kind === 'transform')!
    if (tr.kind === 'transform') {
      expect(tr.bone).toBe(asset.skeleton.boneIdByName.get('arm'))
      expect(tr.sourceBone).toBe(asset.skeleton.boneIdByName.get('hand'))
      expect(tr.mixRotation).toBeCloseTo(0.5, 6)
      expect(tr.mixTranslation).toBeCloseTo(0.25, 6)
    }
    const path = asset.constraints!.find((c) => c.kind === 'path')!
    if (path.kind === 'path') {
      expect(path.points).toHaveLength(8)
      expect(path.mix).toBeCloseTo(0.5, 6)
    }
  })

  it('clipping 生成 maskLibrary 并给 slot 打 mask', () => {
    expect(asset.maskLibrary).toBeDefined()
    expect(asset.maskLibrary!.version).toBe(1)
    expect(asset.maskLibrary!.masks).toHaveLength(1)
    const mask = asset.maskLibrary!.masks[0]!
    expect(mask.startSlotId).toBe('clipSlot')
    expect(mask.endSlotId).toBe('clipEndSlot')
    expect(mask.invert).toBe(true)
    expect(mask.mode).toBe('clip')
    expect(mask.polygon).toHaveLength(8)
    expect(asset.slots.find((s) => s.id === 'clipSlot')!.mask).toBe(mask.id)
  })
})

describe('M11 Spine: 动画与 atlas 注入', () => {
  it('drawOrder/attachment/color/deform/ik timeline 全部解析', () => {
    const clip = importWith().animations.get('walk')!
    expect(clip.timelines.some((t) => t.kind === 'attachment')).toBe(true)
    expect(clip.timelines.some((t) => t.kind === 'color')).toBe(true)
    expect(clip.timelines.some((t) => t.kind === 'deform')).toBe(true)
    const ik = keyTimeline(clip, (t) => t.kind === 'ik' && t.path === 'legIk')
    expect(ik.keys[1]!.value).toBeCloseTo(0.2, 6)
    const order = keyTimeline(clip, (t) => t.path === 'drawOrder[0]')
    expect(order.keys[0]!.value).not.toBe(0)
    expect(new Set(clip.timelines.filter((t) => 'keys' in t && t.kind === 'drawOrder').map((t) => t.path)).size)
      .toBe(importWith().slots.length)
    expect(clip.duration).toBeCloseTo(0.5, 6)
  })

  it('提供 atlas 时 region 生成默认 UV，缺失 region 记 W_ATLAS_MISSING', () => {
    const asset = importWith({ atlas: true })
    expect(asset.atlas).toBeDefined()
    const body = asset.skins.get('default')!.attachments.get('body')!
    expect(body.kind).toBe('region')
    if (body.kind === 'region') {
      expect(body.region.uvs).toEqual(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]))
    }
    expect(asset.report.issues.some((i) => i.code === 'W_ATLAS_MISSING')).toBe(true)
    expect(asset.report.errors).toBe(0)
  })

  it('atlas 参与 hash：同 atlas 稳定，换 atlas 变化', () => {
    const a = importWith({ atlas: true })
    const b = importWith({ atlas: true })
    expect(a.hash).toBe(b.hash)
    const other = importSpine(spineFeaturesFixture(), {
      unitScale: SCALE,
      atlas: importSpineAtlas(`sheet.png
size: 128,128
body
  bounds: 0,0,8,8
`),
    })
    expect(other.hash).not.toBe(a.hash)
  })

  it('坏 fixture：clipping end 不存在记 W_CLIP_END；linkedmesh 无父降级', () => {
    const doc = clone(spineFeaturesFixture()) as Record<string, any>
    doc.skins[0].attachments.clipSlot.clip.end = 'ghostEndSlot'
    doc.skins[0].attachments.linkSlot.link.parent = 'missingParent'
    const asset = importSpine(doc, { unitScale: SCALE })
    expect(asset.report.issues.some((i) => i.code === 'W_CLIP_END')).toBe(true)
    expect(asset.report.issues.some((i) => i.code === 'W_ATTACHMENT_UNSUPPORTED')).toBe(true)
  })
})
