/**
 * S3 导入兼容：Spine binary 4.2（`.skel`）核心子集 → JSON 结构 → importSpine。
 * 权威：docs/22-Spine渲染对标/import-compat.md §4.2、§4.4。
 *
 * 只读入下述“核心子集”，不假装支持完整 4.2 二进制：
 *   header(hash8 + version + bounds) / 字符串表 / bones / slots /
 *   skins + region|mesh 附件 / animations 的 rotate|translate|scale timeline。
 * 约束、事件、drawOrder、color/deform/ik timeline 等尚未实现的段直接以
 * `E_BINARY_UNSUPPORTED` 拒绝，不静默跳过；可恢复的索引/混合模式问题进 report。
 *
 * 解析后先还原成与官方 JSON 导出同构的对象，再调用 importSpine，保证二进制与
 * JSON 共用同一套坐标/单位/角度/权重/冻结/校验逻辑，不维护第二套运行时模型。
 */

import {
  importSpine,
  type ImportIssue,
  type SkeletonAsset,
} from './importer'
import type { AtlasData } from './atlas'

type BinaryError = Error & { code: string }

function fail(code: string, message: string): never {
  const error = new Error(`${code}: ${message}`) as BinaryError
  error.code = code
  throw error
}

// ---------------------------------------------------------------------------
// 带边界检查的读取器
// ---------------------------------------------------------------------------

/** Spine binary 4.2 使用 little-endian；varint 为无符号 LEB128。 */
class Reader {
  private readonly view: DataView
  private readonly bytes: Uint8Array
  private offset = 0

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer)
    this.bytes = new Uint8Array(buffer)
  }

  get remaining(): number {
    return this.bytes.length - this.offset
  }

  private need(count: number): void {
    if (count < 0 || this.offset + count > this.bytes.length) {
      fail('E_BINARY_TRUNCATED', `偏移 ${this.offset} 读取 ${count} 字节越界（总长 ${this.bytes.length}）`)
    }
  }

  u8(): number {
    this.need(1)
    return this.view.getUint8(this.offset++)
  }

  u32(): number {
    this.need(4)
    const value = this.view.getUint32(this.offset, true)
    this.offset += 4
    return value
  }

  f32(): number {
    this.need(4)
    const value = this.view.getFloat32(this.offset, true)
    this.offset += 4
    return value
  }

  /** 无符号 LEB128；超过 6 字节或非安全整数一律视为损坏。 */
  varint(): number {
    let result = 0
    let scale = 1
    for (let i = 0; i < 6; i += 1) {
      const byte = this.u8()
      result += (byte & 0x7f) * scale
      if (result > Number.MAX_SAFE_INTEGER) {
        fail('E_BINARY_TRUNCATED', 'varint 超出安全整数范围')
      }
      if ((byte & 0x80) === 0) {
        if (!Number.isSafeInteger(result)) fail('E_BINARY_TRUNCATED', 'varint 不是安全整数')
        return result
      }
      scale *= 128
    }
    fail('E_BINARY_TRUNCATED', 'varint 超过 6 字节')
  }

  /** zigzag 解码有符号 varint；用于 -1 父级/附件索引。 */
  zigzag(): number {
    const value = this.varint()
    const half = Math.floor(value / 2)
    return value % 2 === 0 ? half : -half - 1
  }

  /** 长度前缀 UTF-8；长度本身也走 varint。 */
  string(): string {
    const length = this.varint()
    if (length < 0) fail('E_BINARY_STRING', `字符串长度为负：${length}`)
    this.need(length)
    const slice = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return decodeUtf8(slice)
  }

  /** 读取元素个数并做“剩余字节至少能容纳 minBytes/项”的保护。 */
  count(label: string, minBytesPerItem = 1): number {
    const value = this.varint()
    if (!Number.isSafeInteger(value) || value < 0) {
      fail('E_BINARY_TRUNCATED', `${label} 计数非法：${value}`)
    }
    if (value * minBytesPerItem > this.remaining) {
      fail('E_BINARY_TRUNCATED', `${label} 计数 ${value} 与剩余字节 ${this.remaining} 不匹配`)
    }
    return value
  }
}

/** 手写 UTF-8 解码，非法序列归入 E_BINARY_STRING，避免宿主 API 差异。 */
function decodeUtf8(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; ) {
    const first = bytes[i]!
    let codePoint: number
    let size: number
    if (first < 0x80) {
      codePoint = first
      size = 1
    } else if ((first & 0xe0) === 0xc0) {
      codePoint = first & 0x1f
      size = 2
    } else if ((first & 0xf0) === 0xe0) {
      codePoint = first & 0x0f
      size = 3
    } else if ((first & 0xf8) === 0xf0) {
      codePoint = first & 0x07
      size = 4
    } else {
      fail('E_BINARY_STRING', `非法 UTF-8 首字节 0x${first.toString(16)}`)
    }
    if (i + size > bytes.length) fail('E_BINARY_STRING', 'UTF-8 序列被截断')
    for (let j = 1; j < size; j += 1) {
      const next = bytes[i + j]!
      if ((next & 0xc0) !== 0x80) fail('E_BINARY_STRING', '非法 UTF-8 续字节')
      codePoint = (codePoint << 6) | (next & 0x3f)
    }
    if (codePoint > 0x10ffff) fail('E_BINARY_STRING', 'UTF-8 码点越界')
    out += String.fromCodePoint(codePoint)
    i += size
  }
  return out
}

// ---------------------------------------------------------------------------
// 枚举 / 小工具
// ---------------------------------------------------------------------------

const INHERITS = [
  'normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection',
] as const

const BLENDS = ['normal', 'additive', 'multiply', 'screen'] as const

/** 二进制内使用的附件类型；只实现 region/mesh。 */
const ATTACHMENT_REGION = 0
const ATTACHMENT_MESH = 2

/** 二进制 timeline 类型；只实现 rotate/translate/scale。 */
const TIMELINE_ROTATE = 0
const TIMELINE_TRANSLATE = 1
const TIMELINE_SCALE = 2

function rgbaHex(packed: number): string {
  const byte = (shift: number): string => (((packed >>> shift) & 0xff).toString(16).padStart(2, '0'))
  // Spine Color.rgba8888：r 在高位，a 在低位。
  return `${byte(24)}${byte(16)}${byte(8)}${byte(0)}`
}

function warn(
  issues: ImportIssue[],
  code: string,
  path: string,
  message: string,
  sourceValue?: unknown,
): void {
  const issue: ImportIssue = { severity: 'warning', code, path, message, action: 'fallback' }
  if (sourceValue !== undefined) issue.sourceValue = sourceValue
  issues.push(issue)
}

// ---------------------------------------------------------------------------
// 解析主流程
// ---------------------------------------------------------------------------

export type SpineBinaryAssetContext = {
  atlas?: AtlasData
  unitScale?: number
}

type Parsed = { doc: Record<string, unknown>; issues: ImportIssue[] }

/** 解析 binary 4.2 核心子集；所有结构错误带 code，可恢复问题进 issues。 */
function parseBinary(buffer: ArrayBuffer): Parsed {
  if (!(buffer instanceof ArrayBuffer)) fail('E_BINARY_TRUNCATED', '需要 ArrayBuffer')
  const reader = new Reader(buffer)
  const issues: ImportIssue[] = []

  // header ---------------------------------------------------------------
  if (reader.remaining < 8) fail('E_BINARY_TRUNCATED', 'header hash 不足 8 字节')
  // hash 是固定 8 字节，不参与运行时，只消费掉。
  for (let i = 0; i < 8; i += 1) reader.u8()
  const version = reader.string()
  if (!/^4\.2(?:\.|$)/.test(version)) {
    fail('E_SPINE_VERSION', `binary 只支持 4.2，实际 ${version.length > 0 ? version : '(missing)'}`)
  }
  const x = reader.f32()
  const y = reader.f32()
  const width = reader.f32()
  const height = reader.f32()
  const nonessential = reader.u8() !== 0
  let fps: number | null = null
  if (nonessential) {
    fps = reader.f32()
    reader.string() // images
    reader.string() // audio
  }

  // 字符串表 -------------------------------------------------------------
  const stringCount = reader.count('strings')
  const strings: string[] = new Array(stringCount)
  for (let i = 0; i < stringCount; i += 1) strings[i] = reader.string()

  const stringAt = (index: number, path: string): string => {
    if (!Number.isInteger(index) || index < 0 || index >= strings.length) {
      fail('E_BINARY_STRING', `${path} 字符串索引 ${index} 越界（共 ${strings.length}）`)
    }
    return strings[index]!
  }

  // bones ----------------------------------------------------------------
  const boneCount = reader.count('bones', 35)
  const boneNames: string[] = new Array(boneCount)
  const bones: Record<string, unknown>[] = new Array(boneCount)
  for (let i = 0; i < boneCount; i += 1) {
    const name = stringAt(reader.varint(), `bones[${i}].name`)
    const parent = i === 0 ? -1 : reader.zigzag()
    if (parent < -1 || parent >= i) {
      fail('E_SCHEMA', `bones[${i}].parent 索引 ${parent} 必须指向更早的骨`)
    }
    const rotation = reader.f32()
    const bx = reader.f32()
    const by = reader.f32()
    const scaleX = reader.f32()
    const scaleY = reader.f32()
    const shearX = reader.f32()
    const shearY = reader.f32()
    const length = reader.f32()
    const inheritIndex = reader.varint()
    let inherit: string
    if (inheritIndex >= 0 && inheritIndex < INHERITS.length) {
      inherit = INHERITS[inheritIndex]!
    } else {
      warn(issues, 'W_BINARY_INHERIT', `bones[${i}].inherit`, `inherit 索引 ${inheritIndex} 非法，回退 normal`, inheritIndex)
      inherit = 'normal'
    }
    const skin = reader.u8() !== 0
    boneNames[i] = name
    bones[i] = {
      name,
      ...(parent >= 0 ? { parent: boneNames[parent]! } : {}),
      rotation,
      x: bx,
      y: by,
      scaleX,
      scaleY,
      shearX,
      shearY,
      length,
      inherit,
      ...(skin ? { skin: true } : {}),
    }
  }

  // slots ----------------------------------------------------------------
  const slotCount = reader.count('slots', 6)
  const slotNames: string[] = new Array(slotCount)
  const slots: Record<string, unknown>[] = new Array(slotCount)
  for (let i = 0; i < slotCount; i += 1) {
    const name = stringAt(reader.varint(), `slots[${i}].name`)
    const boneIndex = reader.varint()
    if (boneIndex < 0 || boneIndex >= boneCount) {
      fail('E_SCHEMA', `slots[${i}].bone 索引 ${boneIndex} 越界`)
    }
    const color = rgbaHex(reader.u32())
    const attachmentIndex = reader.zigzag()
    const attachment = attachmentIndex < 0 ? null : stringAt(attachmentIndex, `slots[${i}].attachment`)
    const blendIndex = reader.varint()
    let blend: string
    if (blendIndex >= 0 && blendIndex < BLENDS.length) {
      blend = BLENDS[blendIndex]!
    } else {
      warn(issues, 'W_BINARY_BLEND', `slots[${i}].blend`, `blend 索引 ${blendIndex} 非法，回退 normal`, blendIndex)
      blend = 'normal'
    }
    slotNames[i] = name
    slots[i] = {
      name,
      bone: boneNames[boneIndex]!,
      color,
      ...(attachment !== null ? { attachment } : {}),
      blend,
    }
  }

  // 约束段：核心子集不解析；计数非 0 直接拒绝，避免错位读取。
  const ikCount = reader.count('ik')
  const transformCount = reader.count('transform')
  const pathCount = reader.count('path')
  if (ikCount + transformCount + pathCount > 0) {
    fail('E_BINARY_UNSUPPORTED', 'binary 约束段尚未实现（ik/transform/path）')
  }

  // skins + attachments --------------------------------------------------
  const skinCount = reader.count('skins', 2)
  const skins: Record<string, unknown>[] = new Array(skinCount)
  for (let i = 0; i < skinCount; i += 1) {
    const skinName = stringAt(reader.varint(), `skins[${i}].name`)
    const attachments: Record<string, Record<string, unknown>> = {}
    const groupCount = reader.count(`skins[${i}].attachments`, 2)
    for (let g = 0; g < groupCount; g += 1) {
      const slotIndex = reader.varint()
      if (slotIndex < 0 || slotIndex >= slotCount) {
        fail('E_SCHEMA', `skins[${i}] slot 索引 ${slotIndex} 越界`)
      }
      const slotName = slotNames[slotIndex]!
      const group = attachments[slotName] ?? (attachments[slotName] = {})
      const attachmentCount = reader.count(`skins[${i}].${slotName}`, 5)
      for (let a = 0; a < attachmentCount; a += 1) {
        const attName = stringAt(reader.varint(), `skins[${i}].${slotName}[${a}].name`)
        if (group[attName] !== undefined) {
          fail('E_SCHEMA', `skins[${i}].${slotName}.${attName} 附件重名`)
        }
        group[attName] = readAttachment(reader, stringAt, issues, `skins[${i}].${slotName}.${attName}`, attName)
      }
    }
    skins[i] = { name: skinName, attachments }
  }

  // events：核心子集不解析；非 0 直接拒绝。
  const eventCount = reader.count('events')
  if (eventCount > 0) fail('E_BINARY_UNSUPPORTED', 'binary 事件段尚未实现')

  // animations -----------------------------------------------------------
  const animationCount = reader.count('animations', 2)
  const animations: Record<string, unknown> = {}
  for (let i = 0; i < animationCount; i += 1) {
    const animationName = stringAt(reader.varint(), `animations[${i}].name`)
    const duration = reader.f32()
    const timelineCount = reader.count(`animations[${i}].timelines`, 3)
    const boneChannels: Record<string, Record<string, unknown[]>> = {}
    let maxKeyTime = 0
    for (let t = 0; t < timelineCount; t += 1) {
      const type = reader.varint()
      const boneIndex = reader.varint()
      if (boneIndex < 0 || boneIndex >= boneCount) {
        fail('E_SCHEMA', `animations[${i}] 第 ${t} 条 timeline 骨索引 ${boneIndex} 越界`)
      }
      const boneName = boneNames[boneIndex]!
      const channel = boneChannels[boneName] ?? (boneChannels[boneName] = {})
      const keyCount = reader.count(`animations[${i}].timelines[${t}].keys`, 8)
      if (type === TIMELINE_ROTATE) {
        const keys = channel.rotate ?? (channel.rotate = [])
        for (let k = 0; k < keyCount; k += 1) {
          const time = reader.f32()
          const angle = reader.f32()
          maxKeyTime = Math.max(maxKeyTime, time)
          keys.push({ time, angle })
        }
      } else if (type === TIMELINE_TRANSLATE || type === TIMELINE_SCALE) {
        const keyName = type === TIMELINE_TRANSLATE ? 'translate' : 'scale'
        const keys = channel[keyName] ?? (channel[keyName] = [])
        for (let k = 0; k < keyCount; k += 1) {
          const time = reader.f32()
          const vx = reader.f32()
          const vy = reader.f32()
          maxKeyTime = Math.max(maxKeyTime, time)
          keys.push({ time, x: vx, y: vy })
        }
      } else {
        fail('E_BINARY_UNSUPPORTED', `animations.${animationName} timeline 类型 ${type} 尚未实现`)
      }
    }
    if (duration + 1e-6 < maxKeyTime) {
      warn(issues, 'W_BINARY_DURATION', `animations.${animationName}.duration`, 'duration 小于末关键帧时间，按末键截断', duration)
    } else if (duration > maxKeyTime + 1e-6) {
      // 在末键后补同值保持键，让 importSpine 推导出的 clip.duration 与源一致。
      for (const channel of Object.values(boneChannels)) {
        appendHold(channel.rotate as Record<string, number>[] | undefined, duration, ['angle'])
        appendHold(channel.translate as Record<string, number>[] | undefined, duration, ['x', 'y'])
        appendHold(channel.scale as Record<string, number>[] | undefined, duration, ['x', 'y'])
      }
    }
    animations[animationName] = { bones: boneChannels }
  }

  if (reader.remaining > 0) {
    warn(issues, 'W_BINARY_TRAILING', 'binary', `已忽略尾部 ${reader.remaining} 字节（未实现段）`, reader.remaining)
  }

  const skeleton: Record<string, unknown> = { spine: version, x, y, width, height }
  if (fps !== null) skeleton.fps = fps
  const doc: Record<string, unknown> = { skeleton, bones, slots, skins, animations }
  return { doc, issues }
}

/** 给末键早于 duration 的通道补一个同值保持键；只改时间，不改采样值。 */
function appendHold(
  keys: Record<string, number>[] | undefined,
  duration: number,
  valueKeys: readonly string[],
): void {
  if (keys === undefined || keys.length === 0) return
  const last = keys[keys.length - 1]!
  if (last.time === undefined || last.time >= duration - 1e-6) return
  const hold: Record<string, number> = { time: duration }
  for (const key of valueKeys) hold[key] = last[key] ?? 0
  keys.push(hold)
}

/** 读取单个附件；仅 region 与 mesh，其余类型显式拒绝。 */
function readAttachment(
  reader: Reader,
  stringAt: (index: number, path: string) => string,
  issues: ImportIssue[],
  path: string,
  name: string,
): Record<string, unknown> {
  const type = reader.varint()
  const pathIndex = reader.zigzag()
  const regionPath = pathIndex < 0 ? name : stringAt(pathIndex, `${path}.path`)
  const color = rgbaHex(reader.u32())

  if (type === ATTACHMENT_REGION) {
    const x = reader.f32()
    const y = reader.f32()
    const rotation = reader.f32()
    const scaleX = reader.f32()
    const scaleY = reader.f32()
    const width = reader.f32()
    const height = reader.f32()
    const uvCount = reader.count(`${path}.uvs`)
    const uvs: number[] = new Array(uvCount)
    for (let i = 0; i < uvCount; i += 1) uvs[i] = reader.f32()
    if (uvCount > 0 && uvCount !== 8) {
      warn(issues, 'W_BINARY_UVS', `${path}.uvs`, 'region uvs 不是 4 角 8 分量，importer 将忽略', uvCount)
    }
    return {
      type: 'region',
      path: regionPath,
      x,
      y,
      rotation,
      scaleX,
      scaleY,
      width,
      height,
      color,
      ...(uvCount > 0 ? { uvs } : {}),
    }
  }

  if (type === ATTACHMENT_MESH) {
    const weighted = reader.u8() !== 0
    const uvCount = reader.count(`${path}.uvs`)
    const uvs: number[] = new Array(uvCount)
    for (let i = 0; i < uvCount; i += 1) uvs[i] = reader.f32()
    const triangleCount = reader.count(`${path}.triangles`)
    const triangles: number[] = new Array(triangleCount)
    for (let i = 0; i < triangleCount; i += 1) triangles[i] = reader.varint()
    const width = reader.f32()
    const height = reader.f32()
    const vertexCount = reader.count(`${path}.vertices`)
    const vertices: number[] = []
    for (let v = 0; v < vertexCount; v += 1) {
      if (!weighted) {
        vertices.push(reader.f32(), reader.f32())
        continue
      }
      const influenceCount = reader.count(`${path}.vertices[${v}]`)
      vertices.push(influenceCount)
      for (let j = 0; j < influenceCount; j += 1) {
        vertices.push(reader.varint(), reader.f32(), reader.f32(), reader.f32())
      }
    }
    return {
      type: 'mesh',
      path: regionPath,
      uvs,
      triangles,
      vertices,
      width,
      height,
      color,
      ...(weighted ? { weighted: true } : {}),
    }
  }

  fail('E_BINARY_UNSUPPORTED', `${path} 附件类型 ${type} 尚未实现`)
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 导入 Spine binary 4.2 核心子集，返回与 JSON 导入完全同构的 SkeletonAsset。
 * 所有读取做边界检查；版本/截断/字符串索引错误抛带 code 的 Error。
 */
export function importSpineBinary(
  buffer: ArrayBuffer,
  assetContext: SpineBinaryAssetContext = {},
): SkeletonAsset {
  const { doc, issues } = parseBinary(buffer)
  const options: { unitScale?: number; atlas?: AtlasData } = {}
  if (assetContext.unitScale !== undefined) options.unitScale = assetContext.unitScale
  if (assetContext.atlas !== undefined) options.atlas = assetContext.atlas
  const asset = importSpine(doc, options)
  if (issues.length === 0) return asset

  const merged = [...asset.report.issues, ...issues]
  const report = {
    issues: merged,
    warnings: merged.filter((issue) => issue.severity === 'warning').length,
    errors: merged.filter((issue) => issue.severity === 'error').length,
  }
  // report 不参与 hash，替换报告不影响字节级确定性。
  return Object.freeze({ ...asset, report })
}
