/**
 * S3 导入兼容：Spine binary 4.2（`.skel`）核心子集 → JSON 结构 → importSpine。
 * 权威：docs/22-Spine渲染对标/import-compat.md §4.2、§4.4。
 *
 * 官方 4.2/4.3 读取 setup、region/mesh/path/clipping 等附件，以及 slot、bone、
 * IK、deform、event 等动画。运行时没有对应通道的约束/序列帧动画会报告明确警告；
 * physics、drawOrder 等未实现流以 E_BINARY_UNSUPPORTED 拒绝，不静默跳过。
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

  /** Official Spine binary uses big-endian float/int32 and length+1 UTF-8 strings. */
  officialFloat(): number {
    this.need(4)
    const value = this.view.getFloat32(this.offset, false)
    this.offset += 4
    return value
  }

  officialInt32(): number {
    this.need(4)
    const value = this.view.getUint32(this.offset, false)
    this.offset += 4
    return value
  }

  officialString(): string | null {
    const length = this.varint()
    if (length === 0) return null
    if (length === 1) return ''
    this.need(length - 1)
    const slice = this.bytes.subarray(this.offset, this.offset + length - 1)
    this.offset += length - 1
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

/** Read the official 4.2/4.3 layout (not the older synthetic core-subset format). */
function parseOfficialBinary(buffer: ArrayBuffer): Parsed {
  const r = new Reader(buffer)
  const issues: ImportIssue[] = []
  r.officialInt32() // hash low
  r.officialInt32() // hash high
  const version = r.officialString()
  if (version === null || !/^4\.(?:2|3)(?:\.|$)/.test(version)) {
    fail('E_SPINE_VERSION', `binary 只支持 4.2/4.3，实际 ${version ?? '(missing)'}`)
  }
  const is43 = version.startsWith('4.3')
  const x = r.officialFloat(), y = r.officialFloat()
  const width = r.officialFloat(), height = r.officialFloat()
  const referenceScale = r.officialFloat()
  const nonessential = r.u8() !== 0
  let fps: number | undefined
  if (nonessential) {
    fps = r.officialFloat()
    r.officialString() // images path
    r.officialString() // audio path
  }
  const strings = Array.from({ length: r.count('strings') }, () => r.officialString())
  const ref = (path: string): string | null => {
    const index = r.varint()
    if (index === 0) return null
    if (index > strings.length || !strings[index - 1]) fail('E_BINARY_STRING', `${path} 字符串索引 ${index} 越界`)
    return strings[index - 1]!
  }
  const required = (value: string | null, path: string): string => {
    if (!value) fail('E_BINARY_STRING', `${path} 缺少名称`)
    return value
  }
  const name = (path: string): string => required(r.officialString(), path)
  const bones: Record<string, unknown>[] = []
  const boneNames: string[] = []
  for (let i = 0, n = r.count('bones', 34); i < n; i += 1) {
    const boneName = name(`bones[${i}].name`)
    const parentIndex = i ? r.varint() : -1
    if (parentIndex >= i) fail('E_SCHEMA', `bones[${i}].parent 索引 ${parentIndex} 越界`)
    const rotation = r.officialFloat(), bx = r.officialFloat(), by = r.officialFloat()
    const scaleX = r.officialFloat(), scaleY = r.officialFloat()
    const shearX = r.officialFloat(), shearY = r.officialFloat()
    const inheritIndex = is43 ? r.u8() : -1
    const length = r.officialFloat()
    const inherit = is43 ? inheritIndex : r.u8()
    if (inherit >= INHERITS.length) fail('E_SCHEMA', `bones[${i}].inherit 索引 ${inherit} 越界`)
    const skin = r.u8() !== 0
    if (nonessential) {
      r.officialInt32() // editor color
      r.officialString() // editor icon
      if (is43) { r.officialFloat(); r.officialFloat() } // icon size/rotation
      r.u8() // visible
    }
    boneNames.push(boneName)
    bones.push({ name: boneName, ...(parentIndex >= 0 ? { parent: boneNames[parentIndex] } : {}),
      rotation, x: bx, y: by, scaleX, scaleY, shearX, shearY, length,
      inherit: INHERITS[inherit], ...(skin ? { skin: true } : {}) })
  }
  const slots: Record<string, unknown>[] = []
  const slotNames: string[] = []
  for (let i = 0, n = r.count('slots', 11); i < n; i += 1) {
    const slotName = name(`slots[${i}].name`)
    const boneIndex = r.varint()
    if (boneIndex >= boneNames.length) fail('E_SCHEMA', `slots[${i}].bone 索引 ${boneIndex} 越界`)
    const color = rgbaHex(r.officialInt32())
    const dark = r.officialInt32()
    const attachment = ref(`slots[${i}].attachment`)
    const blendIndex = r.varint()
    if (blendIndex >= BLENDS.length) fail('E_SCHEMA', `slots[${i}].blend 索引 ${blendIndex} 越界`)
    if (nonessential) r.u8() // visible
    slotNames.push(slotName)
    slots.push({ name: slotName, bone: boneNames[boneIndex], color,
      ...(dark !== 0xffffffff ? { dark: rgbaHex((dark << 8) | 0xff).slice(0, 6) } : {}),
      ...(attachment !== null ? { attachment } : {}), blend: BLENDS[blendIndex] })
  }
  const constraints: Record<string, unknown>[] = []
  const boneRef = (path: string): string => {
    const index = r.varint()
    if (index >= boneNames.length) fail('E_SCHEMA', `${path} bone 索引 ${index} 越界`)
    return boneNames[index]!
  }
  const readIk = (constraintName: string, isVersion43: boolean, order: number): void => {
    const count = r.count(`${constraintName}.bones`)
    if (count < 1 || count > 2) fail('E_SCHEMA', `${constraintName}.bones 需要 1-2 条骨`)
    const chain = Array.from({ length: count }, (_, i) => boneRef(`${constraintName}.bones[${i}]`))
    const target = boneRef(`${constraintName}.target`)
    const flags = r.u8()
    let scaleYMode: number | undefined
    if (isVersion43 && (flags & 2)) scaleYMode = r.u8()
    const mix = flags & 32 ? flags & 64 ? r.officialFloat() : 1 : 0
    const softness = flags & 128 ? r.officialFloat() : 0
    constraints.push({ type: 'ik', name: constraintName, order, bones: chain, target, mix, softness,
      bendPositive: isVersion43 ? !(flags & 4) : !!(flags & 2),
      compress: !!(flags & (isVersion43 ? 8 : 4)),
      stretch: !!(flags & (isVersion43 ? 16 : 8)),
      ...(!isVersion43 ? { uniform: !!(flags & 16) } : {}),
      ...(scaleYMode !== undefined ? { scaleYMode } : {}),
      ...(flags & 1 ? { skin: true } : {}) })
  }
  // 4.2 groups carry an order; 4.3 has a single tagged, ordered list.
  if (is43) {
    for (let i = 0, count = r.count('constraints'); i < count; i += 1) {
      const constraintName = name(`constraints[${i}].name`)
      const type = r.u8()
      if (type === 0) {
        readIk(constraintName, true, i)
      } else if (type === 1) {
        const boneCount = r.count(`${constraintName}.bones`)
        const chain = Array.from({ length: boneCount }, (_, j) => boneRef(`${constraintName}.bones[${j}]`))
        const slotIndex = r.varint()
        if (slotIndex >= slotNames.length) fail('E_SCHEMA', `${constraintName}.slot 索引 ${slotIndex} 越界`)
        const flags = r.u8()
        const positionMode = (flags >> 1) & 1
        const spacingMode = (flags >> 2) & 3
        const rotateMode = (flags >> 4) & 3
        const rotation = flags & 128 ? r.officialFloat() : 0
        const position = r.officialFloat(), spacing = r.officialFloat()
        const mixRotate = r.officialFloat(), mixX = r.officialFloat(), mixY = r.officialFloat()
        constraints.push({ type: 'path', name: constraintName, order: i, bones: chain,
          slot: slotNames[slotIndex], positionMode: positionMode ? 'percent' : 'fixed',
          spacingMode: ['length', 'fixed', 'percent', 'proportional'][spacingMode],
          rotateMode: ['tangent', 'chain', 'chainScale'][rotateMode],
          rotation, position, spacing, mixRotate, mixX, mixY, ...(flags & 1 ? { skin: true } : {}) })
      } else if (type === 2) {
        const boneCount = r.count(`${constraintName}.bones`)
        const chain = Array.from({ length: boneCount }, (_, j) => boneRef(`${constraintName}.bones[${j}]`))
        const source = boneRef(`${constraintName}.source`)
        const flags = r.u8()
        const channels = ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'shearY']
        const properties: Record<string, unknown> = {}
        for (let j = 0, count = flags >> 5; j < count; j += 1) {
          const from = r.u8()
          if (from >= channels.length) fail('E_SCHEMA', `${constraintName}.properties.from ${from} 越界`)
          const offset = r.officialFloat()
          const to: Record<string, unknown> = {}
          for (let k = 0, targets = r.u8(); k < targets; k += 1) {
            const target = r.u8()
            if (target >= channels.length) fail('E_SCHEMA', `${constraintName}.properties.to ${target} 越界`)
            to[channels[target]!] = { offset: r.officialFloat(), max: r.officialFloat(), scale: r.officialFloat() }
          }
          properties[channels[from]!] = { offset, to }
        }
        const offsetFlags = r.u8()
        const offsets = channels.map((_, bit) => offsetFlags & (1 << bit) ? r.officialFloat() : 0)
        const mixFlags = r.u8()
        const mixes = channels.map((_, bit) => mixFlags & (1 << bit) ? r.officialFloat() : 0)
        constraints.push({ type: 'transform', name: constraintName, order: i, bones: chain, source,
          localSource: !!(flags & 2), localTarget: !!(flags & 4), additive: !!(flags & 8), clamp: !!(flags & 16),
          ...(flags >> 5 ? { properties } : {}),
          ...Object.fromEntries(channels.flatMap((channel, bit) => offsetFlags & (1 << bit)
            ? [[channel === 'rotate' ? 'rotation' : channel, offsets[bit]]] : [])),
          ...Object.fromEntries(channels.map((channel, bit) => [`mix${channel[0]!.toUpperCase()}${channel.slice(1)}`, mixes[bit]])),
          ...(flags & 1 ? { skin: true } : {}) })
      } else fail('E_BINARY_UNSUPPORTED', `4.3 ${constraintName} 约束类型 ${type} 尚未实现`)
    }
  } else {
    for (let i = 0, count = r.count('ik'); i < count; i += 1) {
      const constraintName = name(`ik[${i}].name`)
      const order = r.varint()
      readIk(constraintName, false, order)
    }
    for (let i = 0, count = r.count('transform'); i < count; i += 1) {
      const constraintName = name(`transform[${i}].name`), order = r.varint()
      const boneCount = r.count(`${constraintName}.bones`)
      const chain = Array.from({ length: boneCount }, (_, j) => boneRef(`${constraintName}.bones[${j}]`))
      const source = boneRef(`${constraintName}.target`), flags = r.u8()
      const rotation = flags & 8 ? r.officialFloat() : 0
      const x = flags & 16 ? r.officialFloat() : 0
      const y = flags & 32 ? r.officialFloat() : 0
      const scaleX = flags & 64 ? r.officialFloat() : 0
      const scaleY = flags & 128 ? r.officialFloat() : 0
      const mixFlags = r.u8()
      const shearY = mixFlags & 1 ? r.officialFloat() : 0
      const mixes = [2, 4, 8, 16, 32, 64].map(bit => mixFlags & bit ? r.officialFloat() : 0)
      constraints.push({ type: 'transform', name: constraintName, order, bones: chain, source,
        localSource: !!(flags & 2), localTarget: !!(flags & 2), additive: !!(flags & 4),
        ...(flags & 8 ? { rotation } : {}), ...(flags & 16 ? { x } : {}), ...(flags & 32 ? { y } : {}),
        ...(flags & 64 ? { scaleX } : {}), ...(flags & 128 ? { scaleY } : {}),
        ...(mixFlags & 1 ? { shearY } : {}), mixRotate: mixes[0], mixX: mixes[1], mixY: mixes[2],
        mixScaleX: mixes[3], mixScaleY: mixes[4], mixShearY: mixes[5], ...(flags & 1 ? { skin: true } : {}) })
    }
    for (let i = 0, count = r.count('path'); i < count; i += 1) {
      const constraintName = name(`path[${i}].name`), order = r.varint(), skin = !!r.u8()
      const boneCount = r.count(`${constraintName}.bones`)
      const chain = Array.from({ length: boneCount }, (_, j) => boneRef(`${constraintName}.bones[${j}]`))
      const slotIndex = r.varint()
      if (slotIndex >= slotNames.length) fail('E_SCHEMA', `${constraintName}.slot 索引 ${slotIndex} 越界`)
      const flags = r.u8(), positionMode = flags & 1, spacingMode = (flags >> 1) & 3
      const rotateMode = (flags >> 3) & 3, rotation = flags & 128 ? r.officialFloat() : 0
      const position = r.officialFloat(), spacing = r.officialFloat()
      const mixRotate = r.officialFloat(), mixX = r.officialFloat(), mixY = r.officialFloat()
      constraints.push({ type: 'path', name: constraintName, order, bones: chain,
        slot: slotNames[slotIndex], positionMode: positionMode ? 'percent' : 'fixed',
        spacingMode: ['length', 'fixed', 'percent', 'proportional'][spacingMode],
        rotateMode: ['tangent', 'chain', 'chainScale'][rotateMode], rotation, position, spacing,
        mixRotate, mixX, mixY, ...(skin ? { skin: true } : {}) })
    }
    if (r.count('physics') !== 0) fail('E_BINARY_UNSUPPORTED', '4.2 binary physics 约束块尚未实现')
  }
  const skins: Record<string, unknown>[] = []
  const readVertices = (weighted: boolean, path: string): { vertices: number[]; count: number } => {
    const count = r.count(`${path}.vertices`, weighted ? 1 : 8)
    const vertices: number[] = []
    if (weighted) {
      // 4.3 prefixes the flattened bone array size (one count plus one index
      // per influence), not another vertex count. Validate it after decoding.
      const boneArraySize = is43 ? r.varint() : undefined
      let consumedBones = 0
      for (let i = 0; i < count; i += 1) {
        const influenceCount = r.count(`${path}.vertices[${i}]`)
        consumedBones += 1 + influenceCount
        vertices.push(influenceCount)
        for (let j = 0; j < influenceCount; j += 1) {
          vertices.push(r.varint(), r.officialFloat(), r.officialFloat(), r.officialFloat())
        }
      }
      if (boneArraySize !== undefined && consumedBones !== boneArraySize) {
        fail('E_SCHEMA', `${path}.vertices bone array size ${boneArraySize} != ${consumedBones}`)
      }
    } else {
      for (let i = 0; i < count * 2; i += 1) vertices.push(r.officialFloat())
    }
    return { vertices, count }
  }
  const readSequence = (): Record<string, number> => ({
    count: r.varint(), start: r.varint(), digits: r.varint(), setup: r.varint(),
  })
  const attachment = (placeholder: string, path: string): Record<string, unknown> => {
    const flags = r.u8()
    const type = flags & 7
    const actualName = flags & 8 ? required(ref(`${path}.name`), `${path}.name`) : placeholder
    if (type === 1 || type === 4 || type === 5 || type === 6) {
      if (type === 5) {
        const rotation = r.officialFloat(), x = r.officialFloat(), y = r.officialFloat()
        const color = nonessential ? rgbaHex(r.officialInt32()) : undefined
        return { type: 'point', name: actualName, rotation, x, y, ...(color ? { color } : {}) }
      }
      let end: string | undefined
      if (type === 6) {
        const endSlot = r.varint()
        if (endSlot >= slotNames.length) fail('E_SCHEMA', `${path}.end 索引 ${endSlot} 越界`)
        end = slotNames[endSlot]!
      }
      const { vertices, count } = readVertices(!!(flags & (type === 4 ? 64 : 16)), path)
      const lengths = type === 4 ? Array.from({ length: Math.floor(count / 3) }, () => r.officialFloat()) : undefined
      if (type === 4 && count % 3 !== 0) fail('E_SCHEMA', `${path}.vertices 路径顶点数 ${count} 非 3 的倍数`)
      const color = nonessential ? rgbaHex(r.officialInt32()) : undefined
      if (type === 1) return { type: 'boundingbox', name: actualName, vertexCount: count, vertices,
        ...(color ? { color } : {}) }
      if (type === 4) return { type: 'path', name: actualName, vertexCount: count, vertices, lengths,
        closed: !!(flags & 16), constantSpeed: !!(flags & 32), ...(color ? { color } : {}) }
      return { type: 'clipping', name: actualName, end, vertexCount: count, vertices,
        ...(is43 ? { convex: !!(flags & 32), inverse: !!(flags & 64) } : {}), ...(color ? { color } : {}) }
    }
    if (type !== 0 && type !== 2) fail('E_BINARY_UNSUPPORTED', `${path} 附件类型 ${type} 尚未实现`)
    const imagePath = flags & 16 ? required(ref(`${path}.path`), `${path}.path`) : actualName
    const color = rgbaHex(flags & 32 ? r.officialInt32() : 0xffffffff)
    const sequence = flags & 64 ? readSequence() : undefined
    if (type === 0) {
      const rotation = flags & 128 ? r.officialFloat() : 0
      const x = r.officialFloat(), y = r.officialFloat()
      const scaleX = r.officialFloat(), scaleY = r.officialFloat()
      const width = r.officialFloat(), height = r.officialFloat()
      return { type: 'region', name: actualName, path: imagePath, color, rotation,
        x, y, scaleX, scaleY, width, height, ...(sequence ? { sequence } : {}) }
    }
    const hull = r.varint()
    const { vertices, count } = readVertices((flags & 128) !== 0, path)
    const uvs = Array.from({ length: count * 2 }, () => r.officialFloat())
    const triangleCount = (count * 2 - hull - 2) * 3
    if (triangleCount < 0) fail('E_SCHEMA', `${path}.triangles 计数非法`)
    const triangles = Array.from({ length: triangleCount }, () => r.varint())
    if (is43) {
      const timelineSlotCount = r.count(`${path}.timelineSlots`)
      for (let i = 0; i < timelineSlotCount; i += 1) r.varint()
      if (timelineSlotCount) fail('E_BINARY_UNSUPPORTED', `${path}.timelineSlots 尚未实现`)
    }
    let width = 0, height = 0
    if (nonessential) {
      const edges = r.count(`${path}.edges`)
      for (let i = 0; i < edges; i += 1) r.varint()
      width = r.officialFloat(); height = r.officialFloat()
    }
    return { type: 'mesh', name: actualName, path: imagePath, color, hull, vertices,
      uvs, triangles, width, height, ...(sequence ? { sequence } : {}) }
  }
  const readSkin = (defaultSkin: boolean): void => {
    const skinName = defaultSkin ? 'default' : name('skin.name')
    if (!defaultSkin && nonessential) r.officialInt32()
    if (!defaultSkin) {
      for (const kind of is43 ? ['bones', 'constraints'] : ['bones', 'ik', 'transform', 'path', 'physics']) {
        const n = r.count(`skins.${skinName}.${kind}`)
        for (let i = 0; i < n; i += 1) r.varint()
        if (n) fail('E_BINARY_UNSUPPORTED', `skins.${skinName}.${kind} 引用尚未实现`)
      }
    }
    const groups = r.count(`skins.${skinName}.slots`)
    if (defaultSkin && groups === 0) return
    const attachments: Record<string, Record<string, unknown>> = {}
    for (let i = 0; i < groups; i += 1) {
      const slotIndex = r.varint()
      if (slotIndex >= slotNames.length) fail('E_SCHEMA', `skins.${skinName}.slot 索引 ${slotIndex} 越界`)
      const group: Record<string, unknown> = attachments[slotNames[slotIndex]!] = {}
      for (let j = 0, n = r.count(`skins.${skinName}.attachments`); j < n; j += 1) {
        const placeholder = required(ref(`skins.${skinName}.attachment`), `skins.${skinName}.attachment`)
        group[placeholder] = attachment(placeholder, `skins.${skinName}.${placeholder}`)
      }
    }
    skins.push({ name: skinName, attachments })
  }
  readSkin(true)
  for (let i = 0, n = r.count('skins'); i < n; i += 1) readSkin(false)
  const events: Record<string, unknown> = {}
  const eventNames: string[] = []
  for (let i = 0, count = r.count('events'); i < count; i += 1) {
    const eventName = name(`events[${i}].name`)
    const int = r.zigzag(), float = r.officialFloat(), string = r.officialString()
    const audio = r.officialString()
    events[eventName] = { int, float, string, ...(audio ? { audio, volume: r.officialFloat(), balance: r.officialFloat() } : {}) }
    eventNames.push(eventName)
  }
  const animations: Record<string, unknown> = {}
  for (let a = 0, n = r.count('animations'); a < n; a += 1) {
    const animationName = name(`animations[${a}].name`)
    r.count(`${animationName}.timelineTotal`) // Official count is metadata, not a payload length.
    const slotChannels: Record<string, Record<string, unknown[]>> = {}
    const boneChannels: Record<string, Record<string, unknown[]>> = {}
    for (let s = 0, groups = r.count(`${animationName}.slots`); s < groups; s += 1) {
      const index = r.varint()
      if (index >= slotNames.length) fail('E_SCHEMA', `${animationName}.slots[${index}] 越界`)
      const channel: Record<string, unknown[]> = slotChannels[slotNames[index]!] = {}
      for (let t = 0, count = r.count(`${animationName}.slots[${index}].timelines`); t < count; t += 1) {
        const type = r.u8(), frames = r.count(`${animationName}.slots.frames`, 4)
        if (frames === 0) fail('E_SCHEMA', `${animationName}.slots.frames 不能为空`)
        if (type === 0) {
          channel.attachment = Array.from({ length: frames }, () => ({ time: r.officialFloat(), name: ref(`${animationName}.attachment`) }))
          continue
        }
        const slotTypes = ['', 'rgba', 'rgb', 'rgba2', 'rgb2', 'alpha']
        const lengths = [0, 4, 3, 7, 6, 1]
        if (type >= slotTypes.length) fail('E_BINARY_UNSUPPORTED', `${animationName} slot timeline 类型 ${type} 尚未实现`)
        const bezierCount = r.varint(), components = lengths[type]!
        let used = 0
        const keys: Record<string, unknown>[] = []
        let time = r.officialFloat()
        let values = Array.from({ length: components }, () => r.u8())
        const hex = (bytes: number[]): string => bytes.map(value => value.toString(16).padStart(2, '0')).join('')
        for (let f = 0; f < frames; f += 1) {
          const key: Record<string, unknown> = { time }
          if (type === 5) key.value = values[0]! / 255
          else if (type === 1 || type === 2) key.color = hex(type === 2 ? [...values, 255] : values)
          else {
            key.light = hex(type === 4 ? [...values.slice(0, 3), 255] : values.slice(0, 4))
            key.dark = hex([...values.slice(type === 4 ? 3 : 4), 255])
          }
          if (f < frames - 1) {
            const nextTime = r.officialFloat()
            const nextValues = Array.from({ length: components }, () => r.u8())
            const curve = r.u8()
            if (curve === 1) key.curve = 'stepped'
            else if (curve === 2) {
              used += components
              if (used > bezierCount) fail('E_SCHEMA', `${animationName}.slots bezier 计数越界`)
              key.curve = Array.from({ length: components * 4 }, () => r.officialFloat())
            } else if (curve !== 0) fail('E_SCHEMA', `${animationName}.slots curve 类型 ${curve} 非法`)
            time = nextTime
            values = nextValues
          }
          keys.push(key)
        }
        channel[slotTypes[type]!] = keys
      }
    }
    const boneTypes = ['rotate', 'translate', 'translatex', 'translatey', 'scale', 'scalex', 'scaley', 'shear', 'shearx', 'sheary']
    for (let b = 0, groups = r.count(`${animationName}.bones`); b < groups; b += 1) {
      const index = r.varint()
      if (index >= boneNames.length) fail('E_SCHEMA', `${animationName}.bones[${index}] 越界`)
      const channel: Record<string, unknown[]> = boneChannels[boneNames[index]!] = {}
      for (let t = 0, count = r.count(`${animationName}.bones[${index}].timelines`); t < count; t += 1) {
        const type = r.u8(), frames = r.count(`${animationName}.bones.frames`, 8)
        if (frames === 0) fail('E_SCHEMA', `${animationName}.bones.frames 不能为空`)
        if (type >= boneTypes.length) fail('E_BINARY_UNSUPPORTED', `${animationName} bone timeline 类型 ${type} 尚未实现`)
        const key = boneTypes[type]!
        if (channel[key]) fail('E_SCHEMA', `${animationName}.bones.${boneNames[index]}.${key} 重复`)
        const bezierCount = r.count(`${animationName}.${key}.beziers`)
        const components = type === 1 || type === 4 || type === 7 ? 2 : 1
        let bezierUsed = 0
        const keys: Record<string, unknown>[] = []
        for (let f = 0; f < frames; f += 1) {
          const time = r.officialFloat()
          const values = Array.from({ length: components }, () => r.officialFloat())
          const entry: Record<string, unknown> = components === 2
            ? { time, x: values[0], y: values[1] }
            : { time, value: values[0] }
          if (f > 0) {
            const curveType = r.u8()
            const previous = keys[f - 1]!
            if (curveType === 1) previous.curve = 'stepped'
            else if (curveType === 2) {
              bezierUsed += components
              if (bezierUsed > bezierCount) fail('E_SCHEMA', `${animationName}.${key} bezier 计数越界`)
              const curves = Array.from({ length: components }, () =>
                Array.from({ length: 4 }, () => r.officialFloat()))
              previous.curve = curves.flat()
            } else if (curveType !== 0) fail('E_SCHEMA', `${animationName}.${key} curve 类型 ${curveType} 非法`)
          }
          keys.push(entry)
        }
        channel[key] = keys
      }
    }
    const ikChannels: Record<string, Record<string, unknown>[]> = {}
    // 4.2 timeline indexes are local to each constraint kind; 4.3 indexes the tagged list.
    const timelineConstraint = (kind: string, index: number): Record<string, unknown> | undefined =>
      is43 ? constraints[index] : constraints.filter(constraint => constraint.type === kind)[index]
    for (let i = 0, groups = r.count(`${animationName}.ik`); i < groups; i += 1) {
      const index = r.varint(), frames = r.count(`${animationName}.ik.frames`)
      const ikConstraint = timelineConstraint('ik', index)
      if (ikConstraint?.type !== 'ik' || !frames) {
        fail('E_SCHEMA', `${animationName}.ik[${index}] 约束索引或帧数非法`)
      }
      const bezierCount = r.varint()
      const constraintName = ikConstraint.name as string
      const keys: Record<string, unknown>[] = []
      let used = 0
      for (let frame = 0; frame < frames; frame += 1) {
        const flags = r.u8()
        const time = r.officialFloat()
        const mix = flags & 1 ? flags & 2 ? r.officialFloat() : 1 : 0
        const softness = flags & 4 ? r.officialFloat() : 0
        const key: Record<string, unknown> = { time, mix, softness,
          bendPositive: !!(flags & 8), compress: !!(flags & 16), stretch: !!(flags & 32) }
        if (frame && flags & 64) keys[frame - 1]!.curve = 'stepped'
        if (frame && flags & 128) {
          used += 2
          if (used > bezierCount) fail('E_SCHEMA', `${animationName}.${constraintName} bezier 计数越界`)
          const mixCurve = Array.from({ length: 4 }, () => r.officialFloat())
          const softnessCurve = Array.from({ length: 4 }, () => r.officialFloat())
          keys[frame - 1]!.curve = [...mixCurve, ...softnessCurve]
        }
        keys.push(key)
      }
      ikChannels[constraintName] = keys
    }
    const readMixFrames = (path: string, frames: number, components: number, bezierCount: number): Record<string, unknown>[] => {
      if (!frames) fail('E_SCHEMA', `${path} 帧数不能为空`)
      let used = 0
      const keys: Record<string, unknown>[] = []
      for (let f = 0; f < frames; f += 1) {
        const time = r.officialFloat()
        const values = Array.from({ length: components }, () => r.officialFloat())
        const key: Record<string, unknown> = { time, values }
        if (f) {
          const curve = r.u8()
          if (curve === 1) keys[f - 1]!.curve = 'stepped'
          else if (curve === 2) {
            used += components
            if (used > bezierCount) fail('E_SCHEMA', `${path} bezier 计数越界`)
            keys[f - 1]!.curve = Array.from({ length: components * 4 }, () => r.officialFloat())
          } else if (curve !== 0) fail('E_SCHEMA', `${path} curve 类型 ${curve} 非法`)
        }
        keys.push(key)
      }
      return keys
    }
    const transformChannels: Record<string, Record<string, unknown>[]> = {}
    for (let i = 0, groups = r.count(`${animationName}.transform`); i < groups; i += 1) {
      const index = r.varint(), frames = r.count(`${animationName}.transform.frames`)
      const bezierCount = r.varint()
      const transformConstraint = timelineConstraint('transform', index)
      if (transformConstraint?.type !== 'transform') {
        fail('E_SCHEMA', `${animationName}.transform[${index}] 约束索引非法`)
      }
      const path = `animations.${animationName}.transform.${transformConstraint.name}`
      const keys = readMixFrames(path, frames, 6, bezierCount)
      transformChannels[transformConstraint.name as string] = keys.map(key => {
        const values = key.values as number[]
        const mapped: Record<string, unknown> = { time: key.time, mixRotate: values[0], mixX: values[1],
          mixY: values[2], mixScaleX: values[3], mixScaleY: values[4], mixShearY: values[5] }
        if (key.curve !== undefined) {
          if (Array.isArray(key.curve)) {
            warn(issues, 'W_BINARY_CONSTRAINT_CURVE', path,
              '约束每通道 Bezier 已读取，但运行时无法表示不同通道曲线', key.curve)
          } else mapped.curve = key.curve
        }
        return mapped
      })
    }
    for (let i = 0, groups = r.count(`${animationName}.path`); i < groups; i += 1) {
      const index = r.varint()
      const pathConstraint = timelineConstraint('path', index)
      if (pathConstraint?.type !== 'path') {
        fail('E_SCHEMA', `${animationName}.path[${index}] 约束索引非法`)
      }
      for (let t = 0, count = r.count(`${animationName}.path.timelines`); t < count; t += 1) {
        const type = r.u8(), frames = r.count(`${animationName}.path.frames`), bezierCount = r.varint()
        if (type > 2) fail('E_BINARY_UNSUPPORTED', `${animationName}.path timeline 类型 ${type} 尚未实现`)
        const path = `animations.${animationName}.path.${pathConstraint.name}.${['position', 'spacing', 'mix'][type]}`
        const keys = readMixFrames(path, frames, type === 2 ? 3 : 1, bezierCount)
        warn(issues, 'W_BINARY_CONSTRAINT_TIMELINE', path, 'path 约束动画已解码，但运行时尚未支持该通道', keys)
      }
    }
    for (const kind of is43 ? ['physics', 'slider'] : ['physics']) {
      if (r.count(`${animationName}.${kind}`) !== 0) fail('E_BINARY_UNSUPPORTED', `${animationName}.${kind} timeline 尚未实现`)
    }
    const deform: Record<string, Record<string, Record<string, Record<string, unknown>[]>>> = {}
    for (let skin = 0, groups = r.count(`${animationName}.attachments`); skin < groups; skin += 1) {
      const skinIndex = r.varint()
      if (skinIndex >= skins.length) fail('E_SCHEMA', `${animationName}.attachments skin 索引 ${skinIndex} 越界`)
      const skinName = skins[skinIndex]!.name as string
      const skinSlots = deform[skinName] ?? (deform[skinName] = {})
      for (let s = 0, slotsCount = r.count(`${animationName}.attachments.slots`); s < slotsCount; s += 1) {
        const slotIndex = r.varint()
        if (slotIndex >= slotNames.length) fail('E_SCHEMA', `${animationName}.attachments slot 索引 ${slotIndex} 越界`)
        const slotName = slotNames[slotIndex]!
        for (let j = 0, count = r.count(`${animationName}.attachments.names`); j < count; j += 1) {
          const attachmentName = required(ref(`${animationName}.attachments.name`), `${animationName}.attachments.name`)
          const attachmentDoc = (skins[skinIndex]!.attachments as Record<string, Record<string, Record<string, unknown>>>)[slotName]?.[attachmentName]
          if (!attachmentDoc) fail('E_SCHEMA', `${animationName}.attachments.${skinName}.${slotName}.${attachmentName} 不存在`)
          const type = r.u8(), frames = r.count(`${animationName}.attachments.frames`)
          if (!frames) fail('E_SCHEMA', `${animationName}.attachments.frames 不能为空`)
          const path = `animations.${animationName}.attachments.${skinName}.${slotName}.${attachmentName}`
          if (type === 1) {
            const keys = Array.from({ length: frames }, () => ({ time: r.officialFloat(), modeAndIndex: r.officialInt32(), delay: r.officialFloat() }))
            warn(issues, 'W_BINARY_SEQUENCE_TIMELINE', path, '序列帧动画已解码，但运行时尚未支持该通道', keys)
          } else if (type === 0) {
            const vertices = attachmentDoc.vertices as number[] | undefined
            if (!vertices) fail('E_SCHEMA', `${path} 缺少顶点`)
            const weighted = vertices.length !== (attachmentDoc.vertexCount as number) * 2
            const length = weighted ? (() => {
              let count = 0
              for (let offset = 0; offset < vertices.length;) {
                const influences = vertices[offset++]!
                count += influences * 2
                offset += influences * 4
              }
              return count
            })() : vertices.length
            const bezierCount = r.varint()
            let bezierUsed = 0
            const keys: Record<string, unknown>[] = []
            let time = r.officialFloat()
            for (let f = 0; f < frames; f += 1) {
              const end = r.varint()
              let start = 0
              const values: number[] = []
              if (end) {
                start = r.varint()
                if (start + end > length) fail('E_SCHEMA', `${path} deform 范围越界`)
                for (let k = 0; k < end; k += 1) values.push(r.officialFloat())
              }
              const key: Record<string, unknown> = { time, offset: start, vertices: values }
              if (f < frames - 1) {
                const nextTime = r.officialFloat(), curve = r.u8()
                if (curve === 1) key.curve = 'stepped'
                else if (curve === 2) {
                  if (++bezierUsed > bezierCount) fail('E_SCHEMA', `${path} bezier 计数越界`)
                  key.curve = Array.from({ length: 4 }, () => r.officialFloat())
                } else if (curve !== 0) fail('E_SCHEMA', `${path} curve 类型 ${curve} 非法`)
                time = nextTime
              }
              keys.push(key)
            }
            if (attachmentDoc.type === 'mesh') {
              const slot = skinSlots[slotName] ?? (skinSlots[slotName] = {})
              slot[attachmentName] = keys
            } else warn(issues, 'W_BINARY_DEFORM_TARGET', path, '非 mesh 变形已解码，但运行时不支持该附件', keys)
          } else fail('E_BINARY_UNSUPPORTED', `${path} timeline 类型 ${type} 尚未实现`)
        }
      }
    }
    if (r.count(`${animationName}.drawOrder`) !== 0) fail('E_BINARY_UNSUPPORTED', `${animationName}.drawOrder 尚未实现`)
    if (is43 && r.count(`${animationName}.drawOrderFolder`) !== 0) fail('E_BINARY_UNSUPPORTED', `${animationName}.drawOrderFolder 尚未实现`)
    const eventKeys: Record<string, unknown>[] = []
    for (let i = 0, count = r.count(`${animationName}.events`); i < count; i += 1) {
      const time = r.officialFloat(), eventIndex = r.varint()
      const eventName = eventNames[eventIndex]
      if (!eventName) fail('E_SCHEMA', `${animationName}.events 索引 ${eventIndex} 越界`)
      const int = r.zigzag(), float = r.officialFloat()
      const string = r.officialString() ?? (events[eventName] as Record<string, unknown>).string
      const event: Record<string, unknown> = { time, name: eventName, int, float, string }
      if ((events[eventName] as Record<string, unknown>).audio) {
        event.volume = r.officialFloat()
        event.balance = r.officialFloat()
        warn(issues, 'W_BINARY_EVENT_AUDIO', `animations.${animationName}.events.${eventName}`,
          '事件音频参数已解码，但运行时事件通道不播放音频', event)
      }
      eventKeys.push(event)
    }
    if (is43 && nonessential) r.officialInt32()
    animations[animationName] = { bones: boneChannels, slots: slotChannels, ik: ikChannels,
      transform: transformChannels, deform, events: eventKeys }
  }
  if (r.remaining !== 0) fail('E_BINARY_UNSUPPORTED', `binary 尾部 ${r.remaining} 字节未解析`)
  // 4.2 exports separate constraint groups; the importer applies its legacy
  // defaults and mix clamping only for those groups, as it does for matching JSON.
  const constraintDoc = is43 ? { constraints } : {
    ik: constraints.filter(item => item.type === 'ik').map(({ type, ...item }) => item),
    transform: constraints.filter(item => item.type === 'transform').map(({ type, source, order, ...item }) => ({
      ...item, target: source, ...(order === 0 ? {} : { order }),
    })),
    path: constraints.filter(item => item.type === 'path').map(({ type, ...item }) => item),
  }
  return { doc: { skeleton: { spine: version, x, y, width, height, referenceScale, ...(fps !== undefined ? { fps } : {}) },
    bones, slots, skins, ...constraintDoc, events, animations }, issues }
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
  if (!(buffer instanceof ArrayBuffer)) fail('E_BINARY_TRUNCATED', '需要 ArrayBuffer')
  // Old synthetic tests use a distinct fixture hash; official files use the Spine layout.
  const synthetic = buffer.byteLength >= 8 &&
    String.fromCharCode(...new Uint8Array(buffer, 0, 8)) === 'BINFIX01'
  const { doc, issues } = synthetic ? parseBinary(buffer) : parseOfficialBinary(buffer)
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
