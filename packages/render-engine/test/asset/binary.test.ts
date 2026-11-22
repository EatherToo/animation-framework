/**
 * S3 导入兼容：Spine binary 4.2 核心子集单测。
 *
 * 测试内自带最小 binary 编码器，按 `docs/22-Spine渲染对标/import-compat.md`
 * §4.2 的 header / 字符串表 / bones / slots / skins / attachments / animations
 * 顺序写出一个 4 骨、1 slot、1 region、1 rotate timeline 的角色；再与同源 JSON
 * 导入结果逐项比对。坏 fixture 只断言约定错误码，不依赖内部实现。
 */
import { describe, expect, it } from '@jest/globals'
import { importSpine, importSpineBinary, type SkeletonAsset } from '@/asset/importer'
import type { AnimationClip } from '@/animation/animation'

const SCALE = 0.01

/**
 * Timeline 现在是按 key 类型分组的判别联合；测试只关心标量通道的 time/value，
 * 这里用结构别名收窄，避免把 5 种 key 的差异带进断言。
 */
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

/** 最小 binary 写入器；多字节整数一律 little-endian，与 DataView 读取一致。 */
class Writer {
  private readonly out: number[] = []

  u8(value: number): void {
    this.out.push(value & 0xff)
  }

  u32(value: number): void {
    this.u8(value)
    this.u8(value >>> 8)
    this.u8(value >>> 16)
    this.u8(value >>> 24)
  }

  f32(value: number): void {
    const view = new DataView(new ArrayBuffer(4))
    view.setFloat32(0, value, true)
    for (let i = 0; i < 4; i += 1) this.u8(view.getUint8(i))
  }

  /** 无符号 LEB128。 */
  varint(value: number): void {
    let v = value
    while (v >= 0x80) {
      this.u8((v & 0x7f) | 0x80)
      v = Math.floor(v / 128)
    }
    this.u8(v)
  }

  /** 有符号 zigzag，用于 -1 父级/附件索引。 */
  zigzag(value: number): void {
    this.varint(value >= 0 ? value * 2 : -value * 2 - 1)
  }

  rawString(value: string): void {
    this.varint(value.length)
    for (let i = 0; i < value.length; i += 1) this.u8(value.charCodeAt(i))
  }

  /** hash 固定 8 字节，不带长度前缀。 */
  hash8(value: string): void {
    for (let i = 0; i < 8; i += 1) this.u8(i < value.length ? value.charCodeAt(i) : 0)
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.out)
  }

  arrayBuffer(): ArrayBuffer {
    const bytes = this.bytes()
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }
}

type BoneFixture = { name: string; parent: string | null; x: number; y: number; rotation: number; length: number }
type BinaryFixtureOptions = { version?: string; badStringIndex?: boolean }

/** 4 骨角色 + 1 slot + 1 region + arm 的 rotate timeline。 */
function binaryFixture(options: BinaryFixtureOptions = {}): ArrayBuffer {
  const version = options.version ?? '4.2.33'
  const bones: BoneFixture[] = [
    { name: 'root', parent: null, x: 0, y: 0, rotation: 0, length: 0 },
    { name: 'spine', parent: 'root', x: 0, y: -10, rotation: 0, length: 10 },
    { name: 'arm', parent: 'spine', x: 5, y: 0, rotation: 90, length: 10 },
    { name: 'hand', parent: 'arm', x: 10, y: 0, rotation: -30, length: 5 },
  ]
  const slots = [{ name: 'bodySlot', bone: 'spine', attachment: 'body' }]
  const attachmentName = 'body'
  const skinName = 'default'
  const animationName = 'wave'

  // 字符串表：名字索引稳定，重复字符串不重复注册。
  const strings: string[] = []
  const indexOf = (value: string): number => {
    const found = strings.indexOf(value)
    if (found >= 0) return found
    strings.push(value)
    return strings.length - 1
  }
  for (const bone of bones) indexOf(bone.name)
  for (const slot of slots) {
    indexOf(slot.name)
    indexOf(slot.attachment)
  }
  indexOf(skinName)
  indexOf(attachmentName)
  indexOf(animationName)

  const w = new Writer()
  w.hash8('BINFIX01')
  w.rawString(version)
  w.f32(0)
  w.f32(0)
  w.f32(200)
  w.f32(200)
  w.u8(0) // nonessential = false

  w.varint(strings.length)
  for (const value of strings) w.rawString(value)

  const boneIndex = new Map(bones.map((bone, i) => [bone.name, i]))
  w.varint(bones.length)
  for (const [i, bone] of bones.entries()) {
    w.varint(i === 0 && options.badStringIndex === true ? 9999 : indexOf(bone.name))
    // 首骨没有 parent 字段，保持与 SkeletonBinary 的紧凑布局一致。
    if (i > 0) w.zigzag(boneIndex.get(bone.parent!)!)
    w.f32(bone.rotation)
    w.f32(bone.x)
    w.f32(bone.y)
    w.f32(1)
    w.f32(1)
    w.f32(0)
    w.f32(0)
    w.f32(bone.length)
    w.varint(0) // normal
    w.u8(0) // skin = false
  }

  w.varint(slots.length)
  for (const slot of slots) {
    w.varint(indexOf(slot.name))
    w.varint(boneIndex.get(slot.bone)!)
    w.u32(0xffffffff) // RGBA
    w.zigzag(indexOf(slot.attachment))
    w.varint(0) // blend normal
  }

  w.varint(0) // ik
  w.varint(0) // transform
  w.varint(0) // path

  w.varint(1) // skins
  w.varint(indexOf(skinName))
  w.varint(1) // slot groups
  w.varint(0) // slot index 0
  w.varint(1) // attachment count
  w.varint(indexOf(attachmentName))
  w.varint(0) // type region
  w.zigzag(-1) // path = attachment name
  w.u32(0xffffffff) // color
  w.f32(0)
  w.f32(0)
  w.f32(0)
  w.f32(1)
  w.f32(1)
  w.f32(20)
  w.f32(40)
  w.varint(8)
  for (const uv of [0, 0, 1, 0, 1, 1, 0, 1]) w.f32(uv)

  w.varint(0) // events

  w.varint(1) // animations
  w.varint(indexOf(animationName))
  w.f32(1) // duration
  w.varint(1) // timeline count
  w.varint(0) // rotate (与 SkeletonBinary 的 AnimationTimeline 枚举对齐)
  w.varint(boneIndex.get('arm')!)
  w.varint(2) // keys
  for (const [time, angle] of [[0, 0], [1, 720]] as const) {
    w.f32(time)
    w.f32(angle)
  }

  return w.arrayBuffer()
}

/** 与 binary 同源的 JSON 结构；字段数量/顺序无关，语义一致即可。 */
function jsonFixture(): Record<string, unknown> {
  return {
    skeleton: { spine: '4.2.33', x: 0, y: 0, width: 200, height: 200 },
    bones: [
      { name: 'root', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, length: 0 },
      { name: 'spine', parent: 'root', x: 0, y: -10, rotation: 0, length: 10 },
      { name: 'arm', parent: 'spine', x: 5, y: 0, rotation: 90, length: 10 },
      { name: 'hand', parent: 'arm', x: 10, y: 0, rotation: -30, length: 5 },
    ],
    slots: [{ name: 'bodySlot', bone: 'spine', attachment: 'body', color: 'ffffffff', blend: 'normal' }],
    skins: [{
      name: 'default',
      attachments: {
        bodySlot: {
          body: {
            type: 'region', path: 'body', x: 0, y: 0, rotation: 0,
            scaleX: 1, scaleY: 1, width: 20, height: 40, color: 'ffffffff',
            uvs: [0, 0, 1, 0, 1, 1, 0, 1],
          },
        },
      },
    }],
    animations: {
      wave: { bones: { arm: { rotate: [{ time: 0, angle: 0 }, { time: 1, angle: 720 }] } } },
    },
  }
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    return (error as Error & { code?: string }).code
  }
}

function setup(bone: SkeletonAsset['skeleton']['bones'][number]): {
  x: number; y: number; rotation: number; scaleX: number; scaleY: number
} {
  return bone.setup
}

describe('S3 binary: 4.2 核心子集与同源 JSON 一致', () => {
  const binary = importSpineBinary(binaryFixture(), { unitScale: SCALE })
  const json = importSpine(jsonFixture(), { unitScale: SCALE })

  it('header 版本、骨数/名字/父子一致', () => {
    expect(binary.source).toBe('spine')
    expect(binary.sourceVersion).toBe('4.2.33')
    expect(binary.unitScale).toBe(SCALE)
    expect(binary.skeleton.count).toBe(4)
    expect(Array.from(binary.skeleton.boneIdByName.keys()))
      .toEqual(Array.from(json.skeleton.boneIdByName.keys()))
    expect(Array.from(binary.skeleton.parent)).toEqual(Array.from(json.skeleton.parent))
  })

  it('bones 的 7 通道与 JSON 逐项一致', () => {
    expect(binary.skeleton.count).toBe(json.skeleton.count)
    for (let i = 0; i < binary.skeleton.count; i += 1) {
      const a = setup(binary.skeleton.bones[i]!)
      const b = setup(json.skeleton.bones[i]!)
      expect(a.x).toBeCloseTo(b.x, 6)
      expect(a.y).toBeCloseTo(b.y, 6)
      expect(a.rotation).toBeCloseTo(b.rotation, 6)
      expect(a.scaleX).toBeCloseTo(b.scaleX, 6)
      expect(a.scaleY).toBeCloseTo(b.scaleY, 6)
    }
  })

  it('slots / skins / region 附件一致', () => {
    expect(binary.slots).toHaveLength(1)
    expect(binary.slots[0]!.id).toBe('bodySlot')
    expect(binary.slots[0]!.attachment).toBe('body')
    expect(binary.skins.size).toBe(1)
    const left = binary.skins.get('default')!.attachments.get('body')!
    const right = json.skins.get('default')!.attachments.get('body')!
    expect(left.kind).toBe('region')
    expect(right.kind).toBe('region')
    if (left.kind === 'region' && right.kind === 'region') {
      expect(left.region.atlasKey).toBe(right.region.atlasKey)
      expect(Array.from(left.region.uvs ?? [])).toEqual(Array.from(right.region.uvs ?? []))
    }
  })

  it('rotate timeline 与 clip duration 一致', () => {
    const left = binary.animations.get('wave')!
    const right = json.animations.get('wave')!
    expect(left.duration).toBeCloseTo(right.duration, 6)
    const l = keyTimeline(left, (t) => t.kind === 'rotate' && t.path === 'arm')
    const r = keyTimeline(right, (t) => t.kind === 'rotate' && t.path === 'arm')
    expect(l.keys.map((k) => [k.time, k.value]))
      .toEqual(r.keys.map((k) => [k.time, k.value]))
    expect(l.keys[1]!.value).toBeGreaterThan(2 * Math.PI) // 720° 保留圈数
  })

  it('同源 binary/JSON 产生相同 hash', () => {
    expect(binary.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(binary.hash).toBe(json.hash)
  })

  it('assetContext.atlas 透传给 importer', () => {
    const atlas = {
      format: 'dsh-2d-atlas' as const,
      version: 1,
      hash: 'fixture',
      pages: [{ index: 0, width: 128, height: 128 }],
      regions: new Map(),
      pma: true as const,
      colorSpace: 'srgb' as const,
      padding: 4,
      bleed: 2,
      source: 'file' as const,
    }
    const asset = importSpineBinary(binaryFixture(), { unitScale: SCALE, atlas })
    expect(asset.atlas).toBe(atlas)
  })
})

describe('S3 binary: 坏 fixture 返回约定错误码', () => {
  it('E_BINARY_TRUNCATED：越界读取', () => {
    const full = new Uint8Array(binaryFixture())
    const cut = full.slice(0, 16)
    const buffer = cut.buffer.slice(cut.byteOffset, cut.byteOffset + cut.byteLength) as ArrayBuffer
    expect(errorCode(() => importSpineBinary(buffer))).toBe('E_BINARY_TRUNCATED')
  })

  it('E_BINARY_STRING：字符串索引越界', () => {
    expect(errorCode(() => importSpineBinary(binaryFixture({ badStringIndex: true })))).toBe('E_BINARY_STRING')
  })

  it('E_SPINE_VERSION：非 4.2 主版本', () => {
    expect(errorCode(() => importSpineBinary(binaryFixture({ version: '4.3.0' })))).toBe('E_SPINE_VERSION')
    expect(errorCode(() => importSpineBinary(binaryFixture({ version: '3.8.75' })))).toBe('E_SPINE_VERSION')
  })
})
