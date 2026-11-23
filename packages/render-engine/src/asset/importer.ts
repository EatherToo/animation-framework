/**
 * M5 资产导入：Spine 4.x / DragonBones 4.5 JSON → core2d 只读运行时数据模型。
 * 权威：docs/11-资产导入.md、docs/11-资产/{spine,dragonbones}.md。
 *
 * 五类转换集中在此模块：坐标 y 翻转、单位 scale、角度（度→弧度 + 符号）、
 * drawOrder/zOrder、权重裁剪。错误的 JSON 结构抛错，可恢复的语义问题收集进
 * report，不打断导入。所有输出对象冻结一层，防止运行时污染资产。
 */
import { compileSkeleton, type BoneSpec, type CompiledSkeleton } from '../core/skeleton'
import { createPose, updateWorld } from '../core/pose'
import { decomposeAffine, normalizeAngle, WORLD_STRIDE, type InheritMode, type LocalTransform } from '../core/math'
import type { Attachment, BlendMode, RegionRef, RGBA, SkinData, SlotData, SpinePathData } from '../slot/slot'
import type { AnimationClip, ConstraintFrame, DeformKey, ScalarKey, Timeline } from '../animation/animation'
import type { ConstraintData, TransformFrom, TransformProperty } from '../constraint/constraint'
import type { AtlasData } from './atlas'

const DEG = Math.PI / 180
// Spine region：bl=(u,v2)、br=(u2,v2)、tr=(u2,v)、tl=(u,v)；v=0 是图集顶部。
const DEFAULT_REGION_UVS = new Float32Array([0, 1, 0, 0, 1, 0, 1, 1])

/** 单条导入记录：带 code / path / 原值 / 处置。 */
export type ImportIssue = {
  severity: 'error' | 'warning' | 'info'
  code: string
  path: string
  message: string
  sourceValue?: unknown
  action: 'reject' | 'skip' | 'clamp' | 'normalize' | 'fallback' | 'keep'
}

/** 导入报告：只保留 issues 与两个计数，便于 UI/CI 展示。 */
export type ImportReport = { issues: ImportIssue[]; warnings: number; errors: number }

/** 单个裁剪 mask：slot 范围 + 局部多边形；alphaRegion 为可选的 alpha mask 图。 */
export type MaskData = {
  readonly id: string
  readonly mode: 'clip' | 'alpha'
  readonly invert: boolean
  readonly feather: number
  readonly polygon: Float32Array
  readonly startSlotId: string
  readonly endSlotId: string
  readonly alphaRegion?: RegionRef
}

/** mask 库：version 固定 1，masks 稳定顺序。 */
export type MaskLibrary = {
  readonly version: 1
  readonly masks: readonly MaskData[]
}

/** 导入产物：schema 固定为 1，hash 覆盖除 report/hash 外的全部字段。 */
export type SkeletonAsset = {
  readonly schema: 1
  readonly source: 'spine' | 'dragonbones' | 'native'
  readonly sourceVersion: string
  readonly unitScale: number
  readonly skeleton: CompiledSkeleton
  readonly slots: readonly SlotData[]
  readonly skins: ReadonlyMap<string, SkinData>
  readonly animations: ReadonlyMap<string, AnimationClip>
  readonly events: readonly { time: number; name: string }[]
  readonly hash: string
  readonly report: ImportReport
  /** 实际图集；未提供 atlas 参数时缺省。 */
  readonly atlas?: AtlasData
  /** setup 约束；按源格式解析，运行时交 createConstraintSolver。 */
  readonly constraints?: readonly ConstraintData[]
  /** clipping 附件生成的 mask 库。 */
  readonly maskLibrary?: MaskLibrary
}

// ---------------------------------------------------------------------------
// 通用小工具
// ---------------------------------------------------------------------------

type Ctx = {
  source: 'spine' | 'dragonbones'
  sourceYDown: boolean
  unitScale: number
  maxInfluences: number
  issues: ImportIssue[]
  atlas: ReadonlySet<string> | null
  atlasData: AtlasData | null
  masks: MaskData[]
}

function add(
  ctx: Ctx,
  severity: ImportIssue['severity'],
  code: string,
  path: string,
  message: string,
  action: ImportIssue['action'],
  sourceValue?: unknown,
): void {
  const issue: ImportIssue = { severity, code, path, message, action }
  if (sourceValue !== undefined) issue.sourceValue = sourceValue
  ctx.issues.push(issue)
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return v <= 0 ? 0 : v >= 1 ? 1 : v
}

const WHITE: RGBA = { r: 1, g: 1, b: 1, a: 1 }

function parseHexColor(v: unknown, ctx: Ctx, path: string): RGBA {
  if (v === undefined || v === null) return WHITE
  if (typeof v === 'string' && /^[0-9a-fA-F]{8}$/.test(v)) {
    return {
      r: Number.parseInt(v.slice(0, 2), 16) / 255,
      g: Number.parseInt(v.slice(2, 4), 16) / 255,
      b: Number.parseInt(v.slice(4, 6), 16) / 255,
      a: Number.parseInt(v.slice(6, 8), 16) / 255,
    }
  }
  add(ctx, 'info', 'I_COLOR_DEFAULT', path, '颜色字段非法，回退白色', 'fallback', v)
  return WHITE
}

/** DragonBones 颜色：clamp((m/100)*src + o/100)，src 取纹理白 1。 */
function parseDbColor(v: unknown): RGBA {
  const o = obj(v)
  if (o === null) return WHITE
  const ch = (m: string, addKey: string): number => clamp01(num(o[m], 100) / 100 + num(o[addKey], 0) / 100)
  return { r: ch('rM', 'rO'), g: ch('gM', 'gO'), b: ch('bM', 'bO'), a: ch('aM', 'aO') }
}

const BLEND_MAP: Readonly<Record<string, BlendMode>> = {
  normal: 'normal', additive: 'add', add: 'add',
  multiply: 'multiply', screen: 'screen',
}

function parseBlend(v: unknown, ctx: Ctx, path: string): BlendMode {
  if (v === undefined || v === null) return 'normal'
  if (typeof v !== 'string') {
    // 类型都不对属于结构性问题，记 error；结果仍降级 normal 不崩。
    add(ctx, 'error', 'E_UNKNOWN_BLEND', path, 'blend 不是字符串，回退 normal', 'fallback', v)
    return 'normal'
  }
  const mode = BLEND_MAP[v.toLowerCase()]
  if (mode !== undefined) return mode
  add(ctx, 'warning', 'W_BLEND_UNKNOWN', path, '未知 blend，回退 normal', 'fallback', v)
  return 'normal'
}

/** 名字去重：重复项加稳定后缀并把 E_DUPLICATE_NAME 记进报告。 */
function dedupe(names: string[], ctx: Ctx, prefix: string): string[] {
  const used = new Set<string>()
  return names.map((raw, i) => {
    const base = raw.length > 0 ? raw : `${prefix.replace(/\[\]$/, '')}_${i}`
    if (base.length === 0 || raw.length === 0) {
      add(ctx, 'error', 'E_SCHEMA', `${prefix}[${i}].name`, '名字为空，已生成替补名', 'fallback', raw)
    }
    let name = base
    let n = 2
    while (used.has(name)) {
      name = `${base}_${n}`
      n += 1
    }
    if (name !== base) {
      add(ctx, 'error', 'E_DUPLICATE_NAME', `${prefix}[${i}].name`, '名字重复，已加稳定后缀', 'fallback', raw)
    }
    used.add(name)
    return name
  })
}

function collectAtlas(doc: Record<string, unknown>, source: Ctx['source']): ReadonlySet<string> | null {
  if (source === 'spine') {
    const raw = doc.atlas
    if (Array.isArray(raw)) {
      return new Set(raw.filter((x): x is string => typeof x === 'string'))
    }
  } else {
    const raw = doc.SubTexture ?? doc.textures
    if (Array.isArray(raw)) {
      const names = raw.map((x) => (typeof x === 'string' ? x : obj(x)?.name)).filter((x): x is string => typeof x === 'string')
      return new Set(names)
    }
  }
  return null
}

/** 校验 region 是否有对应图集；缺失时仍产出占位 region，保证结构完整。 */
function atlasKeyOf(rawPath: unknown, fallbackName: string, ctx: Ctx, path: string): string {
  const key = typeof rawPath === 'string' && rawPath.length > 0 ? rawPath : fallbackName
  // 实际 AtlasData 优先：缺失只记 warning，不阻断导入。
  if (ctx.atlasData !== null) {
    if (!ctx.atlasData.regions.has(key)) {
      add(ctx, 'warning', 'W_ATLAS_MISSING', path, 'atlas 中缺少 region，保留 atlasKey 占位', 'fallback', key)
    }
    return key
  }
  if (ctx.atlas !== null) {
    // 源 JSON 自带 atlas 名单：保持 M5 的 error 语义。
    if (!ctx.atlas.has(key)) {
      add(ctx, 'error', 'E_MISSING_ATLAS', path, 'region 无对应图集，使用占位键', 'fallback', rawPath)
    } else if (key === fallbackName && (typeof rawPath !== 'string' || rawPath.length === 0)) {
      add(ctx, 'error', 'E_MISSING_ATLAS', path, 'region path 为空，使用附件名', 'fallback', rawPath)
    }
    return key
  }
  if (key === fallbackName && (typeof rawPath !== 'string' || rawPath.length === 0)) {
    add(ctx, 'error', 'E_MISSING_ATLAS', path, 'region path 为空，使用附件名', 'fallback', rawPath)
  }
  return key
}

/** 有实际 atlas 时给 region 附件补默认四边形 UV；其余情况保持原值。 */
function regionRefOf(ctx: Ctx, atlasKey: string, uvs: Float32Array | null): RegionRef {
  if (uvs === null && ctx.atlasData !== null && ctx.atlasData.regions.has(atlasKey)) {
    return { atlasKey, uvs: DEFAULT_REGION_UVS }
  }
  return { atlasKey, uvs }
}

// ---------------------------------------------------------------------------
// 骨：源矩阵 → y 翻转共轭 → 目标 7 通道
// ---------------------------------------------------------------------------

type RawBone = {
  name: string
  parentName: string | null
  sourceIndex: number
  length: number
  x: number
  y: number
  rotationDeg: number
  scaleX: number
  scaleY: number
  shearXDeg: number
  shearYDeg: number
  skXDeg: number
  skYDeg: number
  inherit: InheritMode
  tags: readonly string[]
  kind: 'spine' | 'db'
}

const INHERITS: readonly InheritMode[] = [
  'normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection',
]

function rawBoneFrom(raw: unknown, index: number, kind: RawBone['kind'], ctx: Ctx, path: string): RawBone {
  const o = obj(raw)
  if (o === null) {
    add(ctx, 'error', 'E_SCHEMA', path, '骨骼不是对象，已跳过字段', 'fallback', raw)
  }
  const d = o ?? {}
  const transform = obj(d.transform) ?? {}
  const inheritRaw = d.inherit
  const inherit = typeof inheritRaw === 'string' && INHERITS.includes(inheritRaw as InheritMode)
    ? inheritRaw as InheritMode
    : 'normal'
  const parent = typeof d.parent === 'string' && d.parent.length > 0 ? d.parent : null
  const bone: RawBone = {
    name: typeof d.name === 'string' ? d.name : `bone_${index}`,
    parentName: parent,
    sourceIndex: index,
    length: Math.max(0, num(d.length, 0)),
    x: num(kind === 'spine' ? d.x : transform.x),
    y: num(kind === 'spine' ? d.y : transform.y),
    rotationDeg: num(d.rotation),
    scaleX: num(kind === 'spine' ? d.scaleX : transform.scX, 1),
    scaleY: num(kind === 'spine' ? d.scaleY : transform.scY, 1),
    shearXDeg: num(d.shearX),
    shearYDeg: num(d.shearY),
    skXDeg: num(transform.skX),
    skYDeg: num(transform.skY),
    inherit,
    tags: d.skin === true ? ['skinBone'] : [],
    kind,
  }
  return bone
}

/** 按源 runtime 公式构造 M_src，再作 F·M_src·F（F=diag(1,-1)）。 */
function flippedMatrix(b: RawBone, unitScale: number, sourceYDown: boolean): Float64Array {
  let a: number
  let b1: number
  let c: number
  let d: number
  if (b.kind === 'spine') {
    const r = b.rotationDeg * DEG
    const shx = b.shearXDeg * DEG
    const shy = b.shearYDeg * DEG
    a = Math.cos(r + shx) * b.scaleX
    b1 = -Math.sin(r + shy) * b.scaleY
    c = Math.sin(r + shx) * b.scaleX
    d = Math.cos(r + shy) * b.scaleY
  } else {
    const sx = b.skXDeg * DEG
    const sy = b.skYDeg * DEG
    a = Math.cos(sy) * b.scaleX
    b1 = Math.sin(sy) * b.scaleX
    c = -Math.sin(sx) * b.scaleY
    d = Math.cos(sx) * b.scaleY
  }
  const out = new Float64Array(WORLD_STRIDE)
  out[0] = a
  // 引擎向量是 (m0*x + m2*y, m1*x + m3*y)；Spine y-up 需要转置官方 row-major 矩阵。
  if (b.kind === 'spine' && !sourceYDown) {
    out[1] = c
    out[2] = b1
  } else {
    out[1] = -b1
    out[2] = -c
  }
  out[3] = d
  out[4] = b.x * unitScale
  out[5] = (b.kind === 'spine' && !sourceYDown ? b.y : -b.y) * unitScale
  return out
}

function convertBone(b: RawBone, ctx: Ctx, path: string): LocalTransform {
  if (b.kind === 'spine' && !ctx.sourceYDown) {
    return {
      x: b.x * ctx.unitScale,
      y: b.y * ctx.unitScale,
      rotation: b.rotationDeg * DEG,
      scaleX: b.scaleX,
      scaleY: b.scaleY,
      shearX: b.shearXDeg * DEG,
      shearY: b.shearYDeg * DEG,
    }
  }
  const m = flippedMatrix(b, ctx.unitScale, ctx.sourceYDown)
  try {
    return decomposeAffine(m)
  } catch {
    // 奇异矩阵不能分解；保留平移与可恢复的尺度，记录 E_TRANSFORM。
    add(ctx, 'error', 'E_TRANSFORM', path, '矩阵奇异，已退回轴对齐近似', 'fallback', Array.from(m))
    return {
      x: m[4]!,
      y: m[5]!,
      rotation: normalizeAngle(Math.atan2(m[1]!, m[0]!)),
      scaleX: Math.hypot(m[0]!, m[1]!) || 1,
      scaleY: Math.hypot(m[2]!, m[3]!) || 1,
      shearX: 0,
      shearY: 0,
    }
  }
}

/** 校验 parent 引用并断开第一个环，使后续拓扑排序必然成功。 */
function resolveParents(bones: readonly RawBone[], ctx: Ctx, prefix: string): void {
  const byName = new Map<string, number>()
  bones.forEach((b, i) => byName.set(b.name, i))
  for (const b of bones) {
    if (b.parentName === null) continue
    if (!byName.has(b.parentName)) {
      add(ctx, 'error', 'E_BONE_PARENT', `${prefix}[${b.sourceIndex}].parent`, '父骨不存在，挂为根', 'fallback', b.parentName)
      b.parentName = null
    }
  }
  const state = new Uint8Array(bones.length)
  const visit = (i: number): boolean => {
    if (state[i] === 1) return true
    if (state[i] === 2) return false
    state[i] = 1
    const b = bones[i]!
    const p = b.parentName === null ? -1 : byName.get(b.parentName) ?? -1
    if (p >= 0 && visit(p)) {
      add(ctx, 'error', 'E_BONE_CYCLE', `${prefix}[${b.sourceIndex}].parent`, '骨骼父子成环，已断环', 'fallback', b.parentName)
      b.parentName = null
    }
    state[i] = 2
    return false
  }
  for (let i = 0; i < bones.length; i += 1) visit(i)
}

function topoSort(bones: readonly RawBone[]): { order: number[]; srcToId: Int32Array } {
  const n = bones.length
  const byName = new Map<string, number>()
  bones.forEach((b, i) => byName.set(b.name, i))
  const parent = bones.map((b) => (b.parentName === null ? -1 : byName.get(b.parentName) ?? -1))
  const indegree = new Uint16Array(n)
  const children: number[][] = Array.from({ length: n }, () => [])
  for (let i = 0; i < n; i += 1) {
    if (parent[i]! >= 0) {
      indegree[i] = 1
      children[parent[i]!]!.push(i)
    }
  }
  const queue: number[] = []
  for (let i = 0; i < n; i += 1) if (indegree[i] === 0) queue.push(i)
  const order: number[] = []
  const srcToId = new Int32Array(n).fill(-1)
  while (queue.length > 0) {
    const cur = queue.shift()!
    srcToId[cur] = order.length
    order.push(cur)
    for (const child of children[cur]!) {
      indegree[child] = indegree[child]! - 1
      if (indegree[child] === 0) queue.push(child)
    }
  }
  if (order.length !== n) throw new Error('E_SCHEMA: skeleton.topoSort')
  return { order, srcToId }
}

function compileBones(
  bones: readonly RawBone[],
  ctx: Ctx,
  skeletonName: string,
): { skeleton: CompiledSkeleton; srcToId: Int32Array } {
  resolveParents(bones, ctx, ctx.source === 'spine' ? 'bones' : 'armature.bones')
  const { order, srcToId } = topoSort(bones)
  const specs: BoneSpec[] = order.map((src, id) => {
    const b = bones[src]!
    const t = convertBone(b, ctx, `bones[${b.sourceIndex}]`)
    const byName = new Map<string, number>()
    bones.forEach((x, i) => byName.set(x.name, i))
    const p = b.parentName === null ? -1 : srcToId[byName.get(b.parentName)!]!
    return {
      name: b.name,
      parent: p,
      length: b.length * ctx.unitScale,
      rest: t,
      setup: t,
      inherit: b.inherit,
      tags: b.tags,
    }
  })
  const skeleton = compileSkeleton({ name: skeletonName, profile: 'full2d', bones: specs })
  return { skeleton, srcToId }
}

// ---------------------------------------------------------------------------
// 附件 / 皮肤 / 插槽
// ---------------------------------------------------------------------------

function flatPositions(points: unknown[], ctx: Ctx, scale: number): Float32Array {
  const ySign = ctx.sourceYDown ? -1 : 1
  const out = new Float32Array(points.length)
  for (let i = 0; i < points.length; i += 2) {
    out[i] = num(points[i]) * scale
    out[i + 1] = ySign * num(points[i + 1]) * scale
  }
  return out
}

function readSpinePath(
  raw: Record<string, unknown>, slotBone: number, srcToId: Int32Array, ctx: Ctx, path: string,
): { polygon: Float32Array; pathData: SpinePathData } {
  const values = arr(raw.vertices).map((value) => num(value))
  const lengths = Float32Array.from(arr(raw.lengths).map((value) => num(value) * ctx.unitScale))
  const closed = raw.closed === true
  const expected = Number.isInteger(raw.vertexCount) && (raw.vertexCount as number) > 0
    ? raw.vertexCount as number
    : lengths.length > 0 ? (lengths.length + (closed ? 0 : 2)) * 3 : 0
  const ySign = ctx.sourceYDown ? -1 : 1
  const rigid = expected === 0 ? values.length % 2 === 0 : values.length === expected * 2
  const vertices: { bone: number; x: number; y: number; weight: number }[][] = []
  if (rigid) {
    for (let i = 0; i + 1 < values.length; i += 2) {
      vertices.push([{ bone: slotBone, x: values[i]! * ctx.unitScale, y: values[i + 1]! * ctx.unitScale * ySign, weight: 1 }])
    }
  } else {
    let cursor = 0
    while (cursor < values.length && (expected === 0 || vertices.length < expected)) {
      const count = values[cursor++]!
      if (!Number.isInteger(count) || count < 1 || cursor + count * 4 > values.length) break
      const influences: { bone: number; x: number; y: number; weight: number }[] = []
      for (let j = 0; j < count; j += 1) {
        const sourceBone = values[cursor++]!
        const x = values[cursor++]! * ctx.unitScale
        const y = values[cursor++]! * ctx.unitScale * ySign
        const weight = values[cursor++]!
        if (!Number.isInteger(sourceBone) || sourceBone < 0 || sourceBone >= srcToId.length) {
          add(ctx, 'error', 'E_INDEX_RANGE', `${path}.vertices[${vertices.length}][${j}].bone`, '路径权重骨索引越界，已跳过', 'skip', sourceBone)
          continue
        }
        influences.push({ bone: srcToId[sourceBone]!, x, y, weight })
      }
      const sum = influences.reduce((total, influence) => total + influence.weight, 0)
      if (sum <= 0 || !Number.isFinite(sum)) {
        add(ctx, 'error', 'E_WEIGHT_SUM', `${path}.vertices[${vertices.length}]`, '路径顶点权重无效，回退到 slot 骨', 'fallback')
        influences.splice(0, influences.length, { bone: slotBone, x: 0, y: 0, weight: 1 })
      } else {
        for (const influence of influences) influence.weight /= sum
      }
      if (ctx.maxInfluences > 0 && influences.length > ctx.maxInfluences) {
        add(ctx, 'warning', 'W_WEIGHT_LIMIT', `${path}.vertices[${vertices.length}]`, '路径顶点影响数超过配置上限，保留全部影响', 'keep', influences.length)
      }
      vertices.push(influences)
    }
    if (cursor !== values.length || (expected > 0 && vertices.length !== expected)) {
      add(ctx, 'warning', 'W_ATTACHMENT_UNSUPPORTED', path, '路径权重布局无效，保留旧坐标回退', 'fallback', raw.vertices)
      return {
        polygon: flatPositions(values, ctx, ctx.unitScale),
        pathData: { vertices: [], lengths, closed, constantSpeed: raw.constantSpeed !== false },
      }
    }
  }
  const polygon = Float32Array.from(vertices.flatMap((influences) => [influences[0]!.x, influences[0]!.y]))
  return { polygon, pathData: { vertices, lengths, closed, constantSpeed: raw.constantSpeed !== false } }
}

function validateIndices(raw: unknown, vertexCount: number, ctx: Ctx, path: string): Uint16Array {
  const kept: number[] = []
  const values = arr(raw)
  for (let i = 0; i + 2 < values.length; i += 3) {
    const tri = [num(values[i]), num(values[i + 1]), num(values[i + 2])]
    if (tri.some((v) => !Number.isInteger(v) || v < 0 || v >= vertexCount)) {
      add(ctx, 'error', 'E_INDEX_RANGE', `${path}.triangles[${i}]`, '三角形索引越界，已丢弃', 'skip', tri)
      continue
    }
    kept.push(...tri)
  }
  return Uint16Array.from(kept)
}

/** 权重：读 count → (boneIndex,x,y,w)；映射稳定 BoneId 并保留全部影响。 */
function readWeightedMesh(
  raw: Record<string, unknown>,
  name: string,
  slotBone: number,
  srcToId: Int32Array,
  ctx: Ctx,
  path: string,
): Attachment {
  const vertices = arr(raw.vertices).map((v) => num(v))
  const uvs = arr(raw.uvs).map((v) => num(v))
  let perVertex = 4
  // 先按源布局数一遍顶点：每个顶点 = count + count×4 个分量。
  let vertexCount = 0
  let scan = 0
  while (scan < vertices.length) {
    const count = Math.floor(vertices[scan] ?? 0)
    if (!Number.isInteger(count) || count < 0 || scan + 1 + count * 4 > vertices.length) break
    perVertex = Math.max(perVertex, count)
    scan += 1 + count * 4
    vertexCount += 1
  }
  if (vertexCount === 0) vertexCount = Math.max(1, Math.floor(vertices.length / 2))
  const positions = new Float32Array(vertexCount * 2)
  const boneIndices = new Uint16Array(vertexCount * perVertex)
  const weights = new Float32Array(vertexCount * perVertex)
  const influencePositions = new Float32Array(vertexCount * perVertex * 2)
  const influenceSourceIndices = new Int32Array(vertexCount * perVertex).fill(-1)
  let sourceComponent = 0
  let p = 0
  let v = 0
  while (p < vertices.length && v < vertexCount) {
    const count = Math.max(0, Math.floor(vertices[p++]!))
    const influences: { bone: number; x: number; y: number; w: number; source: number }[] = []
    for (let j = 0; j < count; j += 1) {
      const srcIndex = Math.floor(vertices[p++]!)
      const x = vertices[p++] ?? 0
      const y = vertices[p++] ?? 0
      const w = vertices[p++] ?? 0
      if (srcIndex < 0 || srcIndex >= srcToId.length) {
        add(ctx, 'error', 'E_INDEX_RANGE', `${path}.vertices[${v}][${j}].bone`, '权重骨索引越界，已跳过', 'skip', srcIndex)
        continue
      }
      influences.push({ bone: srcToId[srcIndex]!, x, y, w, source: j })
    }
    let sum = influences.reduce((acc, inf) => acc + inf.w, 0)
    if (!Number.isFinite(sum) || sum <= 0) {
      add(ctx, 'error', 'E_WEIGHT_SUM', `${path}.vertices[${v}]`, '权重和 ≤0 或非有限，回退单骨刚性', 'fallback', influences.map((i) => i.w))
      influences.length = 0
      influences.push({ bone: slotBone, x: 0, y: 0, w: 1, source: -1 })
      sum = 1
    }
    if (ctx.maxInfluences > 0 && influences.length > ctx.maxInfluences) {
      add(ctx, 'warning', 'W_WEIGHT_LIMIT', `${path}.vertices[${v}]`, '顶点影响数超过配置上限，保留全部影响', 'keep', influences.length)
    }
    positions[v * 2] = influences[0]!.x * ctx.unitScale
    positions[v * 2 + 1] = (ctx.sourceYDown ? -1 : 1) * influences[0]!.y * ctx.unitScale
    for (let j = 0; j < perVertex; j += 1) {
      const inf = influences[j]
      boneIndices[v * perVertex + j] = inf?.bone ?? slotBone
      weights[v * perVertex + j] = inf && sum > 0 ? clamp01(inf.w / sum) : 0
      if (inf !== undefined) {
        influenceSourceIndices[v * perVertex + j] = inf.source < 0 ? -1 : sourceComponent + inf.source * 2
        influencePositions[(v * perVertex + j) * 2] = inf.x * ctx.unitScale
        influencePositions[(v * perVertex + j) * 2 + 1] = (ctx.sourceYDown ? -1 : 1) * inf.y * ctx.unitScale
      }
    }
    sourceComponent += count * 2
    v += 1
  }
  const mesh = {
    id: name,
    positions,
    uvs: uvOf(uvs, vertexCount),
    indices: validateIndices(raw.triangles, vertexCount, ctx, path),
    bone: slotBone,
    vertexSpace: 'boneLocal' as const,
    boneIndices,
    weights,
    influencePositions,
    influenceSourceIndices,
    influencesPerVertex: perVertex,
    // 调试/描边扩展字段；不进入核心 MeshData 契约，故用结构附加。
    ...(Number.isFinite(num(raw.hull, NaN)) ? { hull: num(raw.hull) } : {}),
    ...(arr(raw.edges).length > 0 ? { edges: Uint16Array.from(arr(raw.edges).map((v) => num(v))) } : {}),
    ...(Number.isFinite(num(raw.width, NaN)) ? { sourceWidth: num(raw.width) * ctx.unitScale } : {}),
    ...(Number.isFinite(num(raw.height, NaN)) ? { sourceHeight: num(raw.height) * ctx.unitScale } : {}),
  }
  return {
    kind: 'weightedMesh',
    id: mesh.id,
    mesh,
    region: regionRefOf(ctx, atlasKeyOf(raw.path, mesh.id, ctx, `${path}.path`), null),
    color: WHITE,
  }
}

function uvOf(uvs: number[], vertexCount: number): Float32Array {
  const out = new Float32Array(vertexCount * 2)
  out.set(uvs.slice(0, out.length))
  return out
}

type BuiltSlot = { name: string }

function buildAttachment(
  raw: unknown,
  name: string,
  kindHint: 'spine' | 'db',
  slotBone: number,
  srcToId: Int32Array,
  ctx: Ctx,
  path: string,
): Attachment | null {
  const rawObj = obj(raw)
  if (rawObj === null) {
    add(ctx, 'warning', 'W_ATTACHMENT_UNSUPPORTED', path, '附件不是对象，已跳过', 'skip', raw)
    return null
  }
  const type = kindHint === 'spine'
    ? (typeof rawObj.type === 'string' ? rawObj.type : 'region')
    : (typeof rawObj.type === 'string' && rawObj.type === 'mesh' ? 'mesh' : 'region')
  // sequence 是 Spine 4.3 的帧序列附件；读入帧 region 列表，缺帧时仍按 region 降级。
  const sequence = kindHint === 'spine' ? parseSequence(rawObj, name, ctx, path, atlasKeyOf(rawObj.path ?? name, name, ctx, `${path}.path`)) : undefined
  const atlasKey = atlasKeyOf(rawObj.path ?? name, name, ctx, `${path}.path`)
  const region = { atlasKey, uvs: null as Float32Array | null }
  if (type === 'mesh' || type === 'weightedmesh') {
    const vertices = arr(rawObj.vertices)
    const uvCount = arr(rawObj.uvs).length
    const first = vertices[0]
    // 非加权顶点与 uvs 等长；加权布局首项是影响数，且总长度明显大于 uvs。
    const weighted = type === 'weightedmesh'
      || (vertices.length > 0
        && vertices.length !== uvCount
        && Number.isInteger(first)
        && (first as number) >= 1
        && 1 + (first as number) * 4 <= vertices.length)
    if (weighted) return readWeightedMesh(rawObj, name, slotBone, srcToId, ctx, path)
    const positions = flatPositions(vertices.map((x) => num(x)), ctx, ctx.unitScale)
    const vertexCount = positions.length / 2
    const mesh = {
      id: name,
      positions,
      uvs: uvOf(arr(rawObj.uvs).map((x) => num(x)), vertexCount),
      indices: validateIndices(rawObj.triangles, vertexCount, ctx, path),
      bone: slotBone,
      vertexSpace: 'boneLocal' as const,
      ...(Number.isFinite(num(rawObj.hull, NaN)) ? { hull: num(rawObj.hull) } : {}),
      ...(arr(rawObj.edges).length > 0 ? { edges: Uint16Array.from(arr(rawObj.edges).map((x) => num(x))) } : {}),
      ...(Number.isFinite(num(rawObj.width, NaN)) ? { sourceWidth: num(rawObj.width) * ctx.unitScale } : {}),
      ...(Number.isFinite(num(rawObj.height, NaN)) ? { sourceHeight: num(rawObj.height) * ctx.unitScale } : {}),
    }
    return {
      kind: 'mesh',
      id: name,
      mesh,
      region: regionRefOf(ctx, atlasKey, region.uvs),
      color: kindHint === 'spine' ? parseHexColor(rawObj.color, ctx, `${path}.color`) : WHITE,
    }
  }
  if (type === 'point') {
    return { kind: 'point', id: name, point: [num(rawObj.x) * ctx.unitScale, (ctx.sourceYDown ? -1 : 1) * num(rawObj.y) * ctx.unitScale] }
  }
  if (type === 'path' && kindHint === 'spine') {
    return { kind: 'path', id: name, ...readSpinePath(rawObj, slotBone, srcToId, ctx, path) }
  }
  if (type === 'clipping' || type === 'path' || type === 'boundingbox') {
    const kind = type === 'boundingbox' ? 'boundingBox' : type
    return { kind, id: name, polygon: flatPositions(arr(rawObj.vertices).map((x) => num(x)), ctx, ctx.unitScale) }
  }
  if (type === 'linkedmesh') {
    // 真正的 linkedmesh 由两遍解析处理；走到这里说明父拓扑不可用。
    add(ctx, 'warning', 'W_ATTACHMENT_UNSUPPORTED', path, 'linkedmesh 无法解析父拓扑，退化为 region', 'fallback', rawObj.parent)
    return { kind: 'region', id: name, region: regionRefOf(ctx, atlasKey, null), color: WHITE }
  }
  if (type !== 'region') {
    add(ctx, 'warning', 'W_ATTACHMENT_UNSUPPORTED', path, '未知附件类型，退化为 region', 'fallback', type)
  }
  const customUvs = arr(rawObj.uvs)
  const uvs = customUvs.length === 8 ? Float32Array.from(customUvs.map((x) => num(x))) : null
  // H2：region 的完整局部几何；引擎骨 local 是 Spine y/rotation 的 F·M·F 共轭。
  const width = num(rawObj.width, NaN)
  const height = num(rawObj.height, NaN)
  const regionData: RegionRef = {
    ...regionRefOf(ctx, atlasKey, uvs),
    ...(Number.isFinite(width) ? { width: width * ctx.unitScale } : {}),
    ...(Number.isFinite(height) ? { height: height * ctx.unitScale } : {}),
    ...(rawObj.x !== undefined ? { x: num(rawObj.x) * ctx.unitScale } : {}),
    ...(rawObj.y !== undefined ? { y: (ctx.sourceYDown ? -1 : 1) * num(rawObj.y) * ctx.unitScale } : {}),
    ...(rawObj.rotation !== undefined ? { rotation: num(rawObj.rotation) * DEG } : {}),
    ...(rawObj.scaleX !== undefined ? { scaleX: num(rawObj.scaleX) } : {}),
    ...(rawObj.scaleY !== undefined ? { scaleY: num(rawObj.scaleY) } : {}),
    ...(sequence === undefined ? {} : { sequence }),
  }
  return {
    kind: 'region',
    id: name,
    region: regionData,
    color: kindHint === 'spine' ? parseHexColor(rawObj.color, ctx, `${path}.color`) : WHITE,
  }
}

/**
 * linkedmesh：复用父 mesh 的拓扑/UV/权重，应用自己的 vertices 与可选 uvs。
 * 父必须是同一 skin 内已解析的 mesh/weightedMesh；否则返回 null 由调用方降级。
 */
function buildLinkedMesh(
  raw: Record<string, unknown>,
  name: string,
  parent: Attachment | undefined,
  slotBone: number,
  ctx: Ctx,
  path: string,
): Attachment | null {
  if (parent === undefined || (parent.kind !== 'mesh' && parent.kind !== 'weightedMesh')) {
    return null
  }
  const parentMesh = parent.mesh
  const rawVertices = arr(raw.vertices).map((x) => num(x))
  const positions = rawVertices.length >= 4
    ? flatPositions(rawVertices, ctx, ctx.unitScale)
    : new Float32Array(parentMesh.positions)
  const rawUvs = arr(raw.uvs).map((x) => num(x))
  const uvs = rawUvs.length === positions.length
    ? Float32Array.from(rawUvs)
    : new Float32Array(parentMesh.uvs)
  const atlasKey = atlasKeyOf(raw.path, name, ctx, `${path}.path`)
  const color = parseHexColor(raw.color, ctx, `${path}.color`)

  if (parent.kind === 'weightedMesh') {
    const mesh = {
      id: name,
      positions,
      uvs,
      indices: new Uint16Array(parentMesh.indices),
      bone: parentMesh.bone,
      vertexSpace: parentMesh.vertexSpace,
      boneIndices: new Uint16Array(parent.mesh.boneIndices),
      weights: new Float32Array(parent.mesh.weights),
      ...(parent.mesh.influencesPerVertex === undefined ? {} : { influencesPerVertex: parent.mesh.influencesPerVertex }),
      ...(parent.mesh.influencePositions === undefined ? {} : {
        influencePositions: new Float32Array(parent.mesh.influencePositions),
      }),
      ...(parent.mesh.influenceSourceIndices === undefined ? {} : {
        influenceSourceIndices: new Int32Array(parent.mesh.influenceSourceIndices),
      }),
    }
    return {
      kind: 'weightedMesh',
      id: name,
      mesh,
      region: regionRefOf(ctx, atlasKey, null),
      color,
    }
  }
  const mesh = {
    id: name,
    positions,
    uvs,
    indices: new Uint16Array(parentMesh.indices),
    bone: parentMesh.bone,
    vertexSpace: parentMesh.vertexSpace,
  }
  return { kind: 'mesh', id: name, mesh, region: regionRefOf(ctx, atlasKey, null), color }
}

function parseSequence(
  raw: Record<string, unknown>,
  name: string,
  ctx: Ctx,
  path: string,
  baseKey: string,
): { frames: readonly string[]; setupIndex: number } | undefined {
  const seq = obj(raw.sequence)
  if (seq === null) {
    if (raw.type === 'sequence') add(ctx, 'warning', 'W_SEQUENCE', path, 'sequence 缺帧数据，按 region 降级', 'fallback', name)
    return undefined
  }
  const count = Math.max(0, Math.floor(num(seq.count, 0)))
  if (count <= 0) return undefined
  const start = Math.floor(num(seq.start, 0))
  const digits = Math.max(0, Math.floor(num(seq.digits, 0)))
  const setupIndex = Math.max(0, Math.min(count - 1, Math.floor(num(seq.setupIndex, 0))))
  const frames: string[] = []
  for (let i = 0; i < count; i += 1) {
    const n = start + i
    const suffix = digits > 0 ? String(n).padStart(digits, '0') : String(n)
    frames.push(`${baseKey}_${suffix}`)
  }
  if (ctx.atlasData === null) {
    add(ctx, 'warning', 'W_SEQUENCE', path, '未提供 atlas，sequence 按 setup region 降级', 'fallback', frames)
    return undefined
  }
  if (!frames.every((frame) => ctx.atlasData!.regions.has(frame))) {
    add(ctx, 'warning', 'E_SEQUENCE_REGION', path, 'sequence 帧 region 不完整，保留 setup 帧', 'fallback', frames)
    return undefined
  }
  return { frames, setupIndex }
}

/** 设置 slot.attachment（DragonBones displayIndex 用）。 */
function setSlotAttachment(slots: readonly SlotData[], slotName: string, attachment: string | null): void {
  const slot = slots.find((s) => s.id === slotName)
  if (slot !== undefined) (slot as { attachment: string | null }).attachment = attachment
}

/**
 * clipping → maskLibrary 条目：作用范围从当前 slot 到源 `end` slot（含）。
 * end 不存在时回退到当前 slot 并记 W_CLIP_END。
 */
function addClippingMask(
  ctx: Ctx,
  slots: readonly SlotData[],
  slotName: string,
  attachmentName: string,
  raw: Record<string, unknown>,
  polygon: Float32Array,
): void {
  const id = `${slots.findIndex((slot) => slot.id === slotName)}:${attachmentName}`
  if (ctx.masks.some((mask) => mask.id === id)) return
  const requestedEnd = typeof raw.end === 'string' ? raw.end : ''
  const endSlotId = slots.some((slot) => slot.id === requestedEnd) ? requestedEnd : slotName
  if (endSlotId !== requestedEnd) {
    add(ctx, 'warning', 'W_CLIP_END', `attachments.${slotName}.${attachmentName}.end`, 'clipping end slot 不存在，回退当前 slot', 'fallback', requestedEnd)
  }
  const mask: MaskData = {
    id,
    mode: 'clip',
    invert: raw.inverted === true || raw.inverse === true,
    feather: Math.max(0, num(raw.softness, 0)),
    polygon,
    startSlotId: slotName,
    endSlotId,
  }
  ctx.masks.push(Object.freeze(mask))
}

/** DragonBones 紧凑权重 [boneCount,(boneIndex,weight)*] → 每顶点保留全部影响。 */
function readDbWeights(
  raw: readonly number[],
  vertexCount: number,
  boneNames: readonly string[],
  boneIdByName: ReadonlyMap<string, number>,
  slotBone: number,
  ctx: Ctx,
  path: string,
): { boneIndices: Uint16Array; weights: Float32Array; influencesPerVertex: number } | null {
  let perVertex = 4
  let scan = 0
  for (let v = 0; v < vertexCount; v += 1) {
    if (scan >= raw.length) return null
    const count = Math.floor(raw[scan]!)
    if (count < 0 || scan + 1 + count * 2 > raw.length) return null
    perVertex = Math.max(perVertex, count)
    scan += 1 + count * 2
  }
  const boneIndices = new Uint16Array(Math.max(1, vertexCount) * perVertex)
  const weights = new Float32Array(Math.max(1, vertexCount) * perVertex)
  let cursor = 0
  for (let v = 0; v < vertexCount; v += 1) {
    if (cursor >= raw.length) return null
    const count = Math.max(0, Math.floor(raw[cursor++]!))
    const influences: { bone: number; weight: number }[] = []
    for (let j = 0; j < count; j += 1) {
      const nameIndex = Math.floor(raw[cursor++] ?? -1)
      const weight = raw[cursor++] ?? 0
      const boneName = boneNames[nameIndex]
      const bone = boneName === undefined ? undefined : boneIdByName.get(boneName)
      if (bone === undefined) {
        add(ctx, 'error', 'E_WEIGHT_BONE', `${path}.weights[${v}]`, '权重骨名不存在，已跳过', 'skip', boneName)
        continue
      }
      influences.push({ bone, weight })
    }
    let sum = influences.reduce((acc, item) => acc + item.weight, 0)
    if (!Number.isFinite(sum) || sum <= 0) {
      add(ctx, 'error', 'E_WEIGHT_SUM', `${path}.weights[${v}]`, '权重和 ≤0，回退单骨刚性', 'fallback', influences.map((i) => i.weight))
      influences.length = 0
      influences.push({ bone: slotBone, weight: 1 })
      sum = 1
    }
    if (ctx.maxInfluences > 0 && influences.length > ctx.maxInfluences) {
      add(ctx, 'warning', 'W_WEIGHT_LIMIT', `${path}.weights[${v}]`, '顶点影响数超过配置上限，保留全部影响', 'keep', influences.length)
    }
    for (let j = 0; j < perVertex; j += 1) {
      const influence = influences[j]
      boneIndices[v * perVertex + j] = influence?.bone ?? slotBone
      weights[v * perVertex + j] = influence !== undefined && sum > 0 ? clamp01(influence.weight / sum) : 0
    }
  }
  return cursor > raw.length ? null : { boneIndices, weights, influencesPerVertex: perVertex }
}

/** DragonBones mesh display：image/mesh/armature 的分派与权重展开。 */
function buildDragonBonesDisplay(
  rawDisplay: unknown,
  name: string,
  slotBone: number,
  boneIdByName: ReadonlyMap<string, number>,
  ctx: Ctx,
  path: string,
): Attachment | null {
  const dsp = obj(rawDisplay)
  if (dsp === null) {
    add(ctx, 'warning', 'W_ATTACHMENT_UNSUPPORTED', path, 'display 不是对象，已跳过', 'skip', rawDisplay)
    return null
  }
  const type = typeof dsp.type === 'string' ? dsp.type : 'image'
  if (type === 'armature') {
    add(ctx, 'warning', 'W_SUBARMATURE', path, '嵌套 armature display 暂不支持，已跳过', 'skip', name)
    return null
  }
  const atlasKey = atlasKeyOf(dsp.path ?? name, name, ctx, `${path}.path`)
  if (type === 'mesh') {
    const vertices = arr(dsp.vertices).map((x) => num(x))
    const positions = flatPositions(vertices, ctx, ctx.unitScale)
    const vertexCount = positions.length / 2
    const indices = validateIndices(dsp.triangles, vertexCount, ctx, path)
    const uvs = uvOf(arr(dsp.uvs).map((x) => num(x)), vertexCount)
    const weightsRaw = arr(dsp.weights).map((x) => num(x))
    const boneNames = arr(dsp.bones).map((x) => (typeof x === 'string' ? x : ''))
    const weights = weightsRaw.length > 0
      ? readDbWeights(weightsRaw, vertexCount, boneNames, boneIdByName, slotBone, ctx, path)
      : null
    if (weights === null && weightsRaw.length > 0) {
      add(ctx, 'error', 'E_WEIGHT_LEN', path, 'DragonBones weights 长度与顶点数不符，降级刚性网格', 'fallback', weightsRaw.length)
    }
    const base = {
      id: name,
      positions,
      uvs,
      indices,
      bone: slotBone,
      vertexSpace: 'boneLocal' as const,
    }
    const region = regionRefOf(ctx, atlasKey, null)
    const color = parseDbColor(dsp.color)
    if (weights !== null) {
      return {
        kind: 'weightedMesh',
        id: name,
        mesh: { ...base, boneIndices: weights.boneIndices, weights: weights.weights, influencesPerVertex: weights.influencesPerVertex },
        region,
        color,
      }
    }
    return { kind: 'mesh', id: name, mesh: base, region, color }
  }
  if (type === 'boundingBox' || type === 'boundingbox') {
    return { kind: 'boundingBox', id: name, polygon: flatPositions(arr(dsp.vertices).map((x) => num(x)), ctx, ctx.unitScale) }
  }
  if (type === 'path') {
    return { kind: 'path', id: name, polygon: flatPositions(arr(dsp.vertices).map((x) => num(x)), ctx, ctx.unitScale) }
  }
  if (type !== 'image' && type !== 'region') {
    add(ctx, 'warning', 'W_ATTACHMENT_UNSUPPORTED', path, '未知 display 类型，退化为 region', 'fallback', type)
  }
  return {
    kind: 'region',
    id: name,
    region: regionRefOf(ctx, atlasKey, null),
    color: parseDbColor(dsp.color),
  }
}

/** Spine 约束 target 是 slot 名；旧资产也允许直接用 path 附件名。 */
function pathAttachment(skins: ReadonlyMap<string, SkinData>, slots: readonly SlotData[], target: string): Extract<Attachment, { kind: 'boundingBox' | 'path' }> | undefined {
  const slot = slots.find((item) => item.id === target)
  for (const skin of skins.values()) {
    const attachment = slot?.attachment === null ? undefined : skin.attachments.get(`${target}\u0000${slot?.attachment ?? ''}`)
    if (attachment?.kind === 'path') return attachment
  }
  for (const skin of skins.values()) {
    for (const attachment of skin.attachments.values()) {
      if (attachment.kind === 'path' && attachment.id === target) return attachment
    }
  }
  return undefined
}

function spinePhysicsData(o: Record<string, unknown>, ctx: Ctx) {
  const mass = num(o.mass, 1)
  return {
    x: num(o.x), y: num(o.y), rotate: num(o.rotate), scaleX: num(o.scaleX), shearX: num(o.shearX),
    limit: num(o.limit, 5000) * ctx.unitScale, step: 1 / num(o.fps, 60),
    scaleYMode: o.scaleY === 'Uniform' ? 'Uniform' as const : o.scaleY === 'Volume' ? 'Volume' as const : 'None' as const,
    inertia: num(o.inertia, 0.5), strength: num(o.strength, 100), damping: num(o.damping, 0.85),
    massInverse: 1 / mass, mass, wind: num(o.wind), gravity: num(o.gravity), mix: num(o.mix, 1),
    inertiaGlobal: o.inertiaGlobal === true, strengthGlobal: o.strengthGlobal === true,
    dampingGlobal: o.dampingGlobal === true, massGlobal: o.massGlobal === true,
    windGlobal: o.windGlobal === true, gravityGlobal: o.gravityGlobal === true, mixGlobal: o.mixGlobal === true,
  }
}

/** Spine 顶层 ik/transform/path/physics → ConstraintData[]；不可恢复项记 W 跳过。 */
function readSpineConstraints(
  doc: Record<string, unknown>,
  skeleton: CompiledSkeleton,
  skins: ReadonlyMap<string, SkinData>,
  slots: readonly SlotData[],
  ctx: Ctx,
): ConstraintData[] {
  // Spine 4.3 把约束放进 constraints[]；旧格式仍支持顶层 ik/transform/path/physics。
  if (arr(doc.constraints).length > 0) {
    return readSpineConstraintArray(arr(doc.constraints), skeleton, skins, slots, ctx)
  }
  return readLegacySpineConstraints(doc, skeleton, skins, slots, ctx)
}

function readSpineConstraintArray(
  rawConstraints: readonly unknown[],
  skeleton: CompiledSkeleton,
  skins: ReadonlyMap<string, SkinData>,
  slots: readonly SlotData[],
  ctx: Ctx,
): ConstraintData[] {
  const out: ConstraintData[] = []
  const idOf = (v: unknown): number | undefined => {
    if (typeof v !== 'string') return undefined
    return skeleton.boneIdByName.get(v)
  }
  const idsOf = (v: unknown): number[] => arr(v).map(idOf).filter((id): id is number => id !== undefined)
  for (const [index, raw] of rawConstraints.entries()) {
    const o = obj(raw)
    if (o === null) continue
    const type = typeof o.type === 'string' ? o.type : ''
    const id = typeof o.name === 'string' && o.name.length > 0 ? o.name : `${type || 'constraint'}_${index}`
    const order = Math.floor(num(o.order, index))
    if (type === 'transform') {
      const chain = idsOf(o.bones)
      const source = idOf(o.source ?? o.target)
      if (chain.length === 0 || source === undefined) {
        add(ctx, 'warning', 'W_CONSTRAINT_UNSUPPORTED', `constraints[${index}]`, 'transform 缺 bones/source，已跳过', 'skip', raw)
        continue
      }
      const properties = obj(o.properties)
      const enabled = new Set<string>()
      if (properties !== null) {
        for (const entry of Object.values(properties)) {
          for (const channel of Object.keys(obj(obj(entry)?.to) ?? {})) enabled.add(channel)
        }
      }
      const channelNames: readonly TransformProperty[] = ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'shearY']
      const propertyScale = (kind: TransformProperty): number => kind === 'rotate' || kind === 'shearY'
        ? DEG : kind === 'x' || kind === 'y'
          ? ctx.unitScale * (kind === 'y' && ctx.sourceYDown ? -1 : 1) : 1
      const mappings: TransformFrom[] = properties === null ? [] : Object.entries(properties).flatMap(([kind, entry]) => {
        if (!channelNames.includes(kind as TransformProperty)) return []
        const fromKind = kind as TransformProperty
        const from = obj(entry) ?? {}
        const to = Object.entries(obj(from.to) ?? {}).flatMap(([target, rawTo]) => {
          if (!channelNames.includes(target as TransformProperty)) return []
          const toKind = target as TransformProperty
          const raw = obj(rawTo) ?? {}
          const toScale = propertyScale(toKind)
          return [{ kind: toKind, offset: num(raw.offset) * toScale,
            max: num(raw.max, 1) * toScale,
            scale: num(raw.scale, 1) * toScale / propertyScale(fromKind) }]
        })
        return to.length === 0 ? [] : [{ kind: fromKind, offset: num(from.offset) * propertyScale(fromKind), to }]
      })
      const active = (channel: string) => properties === null || enabled.has(channel)
      const mixRotate = active('rotate') ? num(o.mixRotate, num(o.rotateMix, 1)) : 0
      const mixX = active('x') ? num(o.mixX, num(o.translateMix, 1)) : 0
      const mixY = active('y') ? num(o.mixY, mixX) : 0
      const mixScaleX = active('scaleX') ? num(o.mixScaleX, 1) : 0
      const mixScaleY = active('scaleY') ? num(o.mixScaleY, mixScaleX) : 0
      const mixShearY = active('shearY') ? num(o.mixShearY, 1) : 0
      out.push({
        kind: 'transform',
        id,
        bone: chain[0]!,
        weight: num(o.mix, 1),
        enabled: true,
        order,
        sourceBone: source,
        bones: chain,
        localSource: o.localSource === true,
        localTarget: o.localTarget === true,
        additive: o.additive === true,
        clamp: o.clamp === true,
        offsets: [num(o.rotation) * DEG, num(o.x) * ctx.unitScale,
          num(o.y) * ctx.unitScale * (ctx.sourceYDown ? -1 : 1),
          num(o.scaleX), num(o.scaleY), num(o.shearY) * DEG],
        ...(properties === null ? {} : { properties: mappings }),
        mixRotation: mixRotate,
        mixTranslation: (mixX + mixY) / 2,
        mixRotate,
        mixX,
        mixY,
        mixScaleX,
        mixScaleY,
        mixShearY,
        ...(o.rotation !== undefined ? { offsetRotation: num(o.rotation) * DEG } : {}),
        ...(o.x !== undefined ? { offsetX: num(o.x) * ctx.unitScale } : {}),
        ...(o.y !== undefined ? { offsetY: (ctx.sourceYDown ? -1 : 1) * num(o.y) * ctx.unitScale } : {}),
        ...(o.scaleX !== undefined ? { offsetScaleX: num(o.scaleX) } : {}),
        ...(o.scaleY !== undefined ? { offsetScaleY: num(o.scaleY) } : {}),
        ...(o.shearY !== undefined ? { offsetShearY: num(o.shearY) } : {}),
      })
      continue
    }
    if (type === 'ik') {
      const chain = idsOf(o.bones)
      const target = idOf(o.target)
      if (chain.length === 0 || target === undefined) {
        add(ctx, 'warning', 'W_CONSTRAINT_UNSUPPORTED', `constraints[${index}]`, 'IK 缺 bones/target，已跳过', 'skip', raw)
        continue
      }
      out.push({
        kind: 'ik',
        spine: true,
        id,
        bone: chain[chain.length - 1]!,
        weight: clamp01(num(o.mix, 1)),
        enabled: true,
        order,
        targetBone: target,
        chainLength: chain.length,
        method: 'analytic',
        maxIterations: Math.max(1, Math.floor(num(o.iterations, 8))),
        tolerance: 1e-3,
        bendSign: o.bendPositive === false ? -1 : 1,
        ...(o.softness !== undefined ? { softness: num(o.softness, 0) * ctx.unitScale } : {}),
        ...(o.compress !== undefined ? { compress: o.compress === true ? 1 : 0 } : {}),
        ...(o.stretch !== undefined ? { stretch: o.stretch === true ? 1 : 0 } : {}),
        ...(o.uniform !== undefined ? { uniform: o.uniform === true } : {}),
      })
      continue
    }
    if (type === 'path') {
      const chain = idsOf(o.bones)
      const target = typeof o.slot === 'string' ? o.slot : typeof o.target === 'string' ? o.target : id
      const attachment = pathAttachment(skins, slots, target)
      const points = attachment?.polygon
      const usablePath = points !== undefined && points.length >= 4 && points.length % 2 === 0
        && Array.from(points).every((v) => Number.isFinite(v))
      if (chain.length === 0 || !usablePath) {
        add(ctx, 'warning', 'W_CONSTRAINT_UNSUPPORTED', `constraints[${index}]`, 'path 约束缺可用 path 几何，已跳过', 'skip', raw)
        continue
      }
      out.push({
        kind: 'path',
        id,
        bone: chain[chain.length - 1]!,
        weight: clamp01(num(o.mix, 1)),
        enabled: true,
        order,
        points,
        mix: clamp01(num(o.mix, 1)),
        bones: chain,
        ...(attachment?.pathData !== undefined && attachment.pathData.lengths.length > 0 && attachment.pathData.vertices.length > 0 ? { spinePath: attachment.pathData } : {}),
        ...(slots.find((slot) => slot.id === target) !== undefined ? { targetBone: slots.find((slot) => slot.id === target)!.bone } : {}),
        spacingMode: o.spacingMode === 'fixed' || o.spacingMode === 'percent' || o.spacingMode === 'proportional' ? o.spacingMode : 'length',
        positionMode: o.positionMode === 'fixed' ? 'fixed' : 'percent',
        rotateMode: o.rotateMode === 'tangent' || o.rotateMode === 'chainScale' ? o.rotateMode : 'chain',
        offsetRotation: num(o.rotation, num(o.offsetRotation)) * DEG,
        spacing: num(o.spacing) * (o.spacingMode === 'fixed' || o.spacingMode === 'length' || o.spacingMode === undefined ? ctx.unitScale : 1),
        position: num(o.position) * (o.positionMode === 'fixed' ? ctx.unitScale : 1),
        mixRotate: clamp01(num(o.mixRotate, num(o.rotateMix, 1))),
        mixX: clamp01(num(o.mixX, num(o.translateMix, 1))),
        mixY: clamp01(num(o.mixY, num(o.translateMix, 1))),
        ...(attachment?.pathData !== undefined ? { closed: attachment.pathData.closed } : o.closed !== undefined ? { closed: o.closed === true } : {}),
      })
      continue
    }
    if (type === 'slider') {
      const sourceBone = idOf(o.bone)
      const property = typeof o.property === 'string' ? o.property : undefined
      const validProperties: readonly string[] = ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'shearY']
      if (o.bone !== undefined && (sourceBone === undefined || property === undefined || !validProperties.includes(property))) {
        add(ctx, 'warning', 'W_CONSTRAINT_UNSUPPORTED', `constraints[${index}]`, 'slider source/property invalid', 'skip', raw)
        continue
      }
      const animation = typeof o.animation === 'string' ? o.animation : ''
      const unit = property === 'x' || property === 'y'
        ? ctx.unitScale * (property === 'y' && ctx.sourceYDown ? -1 : 1) : 1
      out.push({ kind: 'slider', id, bone: sourceBone ?? 0, weight: 1, enabled: true, order,
        animation, ...(sourceBone === undefined ? {} : { sourceBone, property: property as TransformProperty }),
        from: num(o.from) * unit, to: num(o.to), scale: num(o.scale, 1) / unit,
        time: num(o.time), mix: num(o.mix, 1), local: o.local === true,
        loop: o.loop === true, additive: o.additive === true })
      continue
    }
    if (type === 'physics') {
      const bone = idOf(o.bone)
      if (bone === undefined) {
        add(ctx, 'warning', 'W_PHYSICS_SKIPPED', `constraints[${index}]`, 'physics 缺 bone，已跳过', 'skip', raw)
        continue
      }
      out.push({
        kind: 'physics',
        id,
        bone,
        weight: 1,
        enabled: true,
        order,
        ...spinePhysicsData(o, ctx),
        ...(typeof o.target === 'string' && idOf(o.target) !== undefined ? { target: idOf(o.target)! } : {}),
      })
      add(ctx, 'warning', 'W_PHYSICS_APPROX', `constraints[${index}]`,
        'physics 数据和 timeline 已读入；世界空间积分及 scale/shear 通道尚未对标官方', 'keep')
      continue
    }
    add(ctx, 'warning', 'W_CONSTRAINT_UNSUPPORTED', `constraints[${index}]`, '未知约束类型，已跳过', 'skip', type)
  }
  return out
}

function readLegacySpineConstraints(
  doc: Record<string, unknown>,
  skeleton: CompiledSkeleton,
  skins: ReadonlyMap<string, SkinData>,
  slots: readonly SlotData[],
  ctx: Ctx,
): ConstraintData[] {
  const out: ConstraintData[] = []
  const idOf = (v: unknown): number | undefined => {
    if (typeof v !== 'string') return undefined
    return skeleton.boneIdByName.get(v)
  }
  const idsOf = (v: unknown): number[] => arr(v).map(idOf).filter((id): id is number => id !== undefined)

  for (const [index, raw] of arr(doc.ik).entries()) {
    const o = obj(raw)
    if (o === null) continue
    const chain = idsOf(o.bones)
    const target = idOf(o.target)
    if (chain.length === 0 || target === undefined) {
      add(ctx, 'warning', 'W_CONSTRAINT_UNSUPPORTED', `ik[${index}]`, 'IK 缺 bones/target，已跳过', 'skip', raw)
      continue
    }
    if (o.mix === undefined || o.bendPositive === undefined) {
      add(ctx, 'warning', 'W_CONSTRAINT_DEFAULT', `ik[${index}]`, 'IK 缺 mix/bendPositive，使用默认值', 'fallback', raw)
    }
    out.push({
      kind: 'ik',
      spine: true,
      id: typeof o.name === 'string' && o.name.length > 0 ? o.name : `ik_${index}`,
      bone: chain[chain.length - 1]!,
      weight: clamp01(num(o.mix, 1)),
      enabled: true,
      order: Math.floor(num(o.order, index)),
      targetBone: target,
      chainLength: chain.length,
      method: 'analytic',
      maxIterations: Math.max(1, Math.floor(num(o.iterations, 8))),
      tolerance: 1e-3,
      bendSign: o.bendPositive === false ? -1 : 1,
    })
  }

  for (const [index, raw] of arr(doc.transform).entries()) {
    const o = obj(raw)
    if (o === null) continue
    const chain = idsOf(o.bones)
    const source = idOf(o.target)
    if (chain.length === 0 || source === undefined) {
      add(ctx, 'warning', 'W_CONSTRAINT_UNSUPPORTED', `transform[${index}]`, 'transform 缺 bones/target，已跳过', 'skip', raw)
      continue
    }
    if (o.mixRotate === undefined && o.mixX === undefined && o.mixY === undefined) {
      add(ctx, 'warning', 'W_CONSTRAINT_DEFAULT', `transform[${index}]`, 'transform 缺 mix，使用默认 1', 'fallback', raw)
    }
    const mixRotate = num(o.mixRotate, 1)
    const mixX = num(o.mixX, 1)
    const mixY = num(o.mixY, mixX)
    const mixScaleX = num(o.mixScaleX, 1)
    const mixScaleY = num(o.mixScaleY, mixScaleX)
    const mixShearY = num(o.mixShearY, 1)
    out.push({
      kind: 'transform',
      id: typeof o.name === 'string' && o.name.length > 0 ? o.name : `transform_${index}`,
      bone: chain[0]!,
      weight: clamp01(num(o.mix, 1)),
      enabled: true,
      order: Math.floor(num(o.order, index)),
      sourceBone: source,
      bones: chain,
      local: o.local === true,
      relative: o.relative === true,
      mixRotation: mixRotate,
      mixTranslation: (mixX + mixY) / 2,
      mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY,
      ...(o.rotation !== undefined ? { offsetRotation: num(o.rotation) * DEG } : {}),
      ...(o.x !== undefined ? { offsetX: num(o.x) * ctx.unitScale } : {}),
      ...(o.y !== undefined ? { offsetY: num(o.y) * ctx.unitScale * (ctx.sourceYDown ? -1 : 1) } : {}),
      ...(o.scaleX !== undefined ? { offsetScaleX: num(o.scaleX) } : {}),
      ...(o.scaleY !== undefined ? { offsetScaleY: num(o.scaleY) } : {}),
      ...(o.shearY !== undefined ? { offsetShearY: num(o.shearY) * DEG } : {}),
    })
  }

  for (const [index, raw] of arr(doc.path).entries()) {
    const o = obj(raw)
    if (o === null) continue
    const chain = idsOf(o.bones)
    const target = typeof o.target === 'string' ? o.target : ''
    const attachment = pathAttachment(skins, slots, target)
    const points = attachment?.polygon
    if (chain.length === 0 || points === undefined) {
      add(ctx, 'warning', 'W_CONSTRAINT_UNSUPPORTED', `path[${index}]`, 'path 约束缺 bones/path 附件，已跳过', 'skip', raw)
      continue
    }
    if (o.mixX === undefined && o.mixRotate === undefined) {
      add(ctx, 'warning', 'W_CONSTRAINT_DEFAULT', `path[${index}]`, 'path 缺 mix，使用默认 1', 'fallback', raw)
    }
    out.push({
      kind: 'path',
      id: typeof o.name === 'string' && o.name.length > 0 ? o.name : `path_${index}`,
      bone: chain[chain.length - 1]!,
      weight: clamp01(num(o.mix, 1)),
      enabled: true,
      order: Math.floor(num(o.order, index)),
      points,
      mix: clamp01(num(o.mixX, num(o.mixRotate, 1))),
      bones: chain,
      ...(attachment?.pathData !== undefined && attachment.pathData.lengths.length > 0 && attachment.pathData.vertices.length > 0 ? { spinePath: attachment.pathData } : {}),
      ...(slots.find((slot) => slot.id === target) !== undefined ? { targetBone: slots.find((slot) => slot.id === target)!.bone } : {}),
      spacingMode: o.spacingMode === 'fixed' || o.spacingMode === 'percent' || o.spacingMode === 'proportional' ? o.spacingMode : 'length',
      positionMode: o.positionMode === 'fixed' ? 'fixed' : 'percent',
      rotateMode: o.rotateMode === 'tangent' || o.rotateMode === 'chainScale' ? o.rotateMode : 'chain',
      offsetRotation: num(o.rotation, num(o.offsetRotation)) * DEG,
      spacing: num(o.spacing) * (o.spacingMode === 'percent' || o.spacingMode === 'proportional' ? 1 : ctx.unitScale),
      position: num(o.position) * (o.positionMode === 'fixed' ? ctx.unitScale : 1),
      mixRotate: clamp01(num(o.mixRotate, num(o.rotateMix, 1))),
      mixX: clamp01(num(o.mixX, num(o.translateMix, 1))),
      mixY: clamp01(num(o.mixY, num(o.translateMix, 1))),
    })
  }

  for (const [index, raw] of arr(doc.physics).entries()) {
    const o = obj(raw)
    if (o === null) continue
    const bone = idOf(o.bone)
    if (bone === undefined) {
      add(ctx, 'warning', 'W_PHYSICS_SKIPPED', `physics[${index}]`, 'physics 缺 bone，已跳过', 'skip', raw)
      continue
    }
    const target = idOf(o.target)
    out.push({
      kind: 'physics',
      id: typeof o.name === 'string' && o.name.length > 0 ? o.name : `physics_${index}`,
      order: Math.floor(num(o.order, index)),
      enabled: false,
      weight: clamp01(num(o.mix, 1)),
      bone,
      ...(target === undefined ? {} : { target }),
      ...spinePhysicsData(o, ctx),
    })
    add(ctx, 'warning', 'W_PHYSICS_SKIPPED', `physics[${index}]`, '旧版 physics 约束保留数据但默认不求解', 'keep', raw)
  }
  return out
}

/** DragonBones armature 级 ik → ConstraintData[]。 */
function readDragonBonesConstraints(
  armature: Record<string, unknown>,
  skeleton: CompiledSkeleton,
  ctx: Ctx,
): ConstraintData[] {
  const out: ConstraintData[] = []
  const idOf = (v: unknown): number | undefined => (typeof v === 'string' ? skeleton.boneIdByName.get(v) : undefined)
  for (const [index, raw] of arr(armature.ik).entries()) {
    const o = obj(raw)
    if (o === null) continue
    const names = arr(o.bones ?? o.chain).filter((v): v is string => typeof v === 'string')
    const chain = names.map((v) => skeleton.boneIdByName.get(v)).filter((id): id is number => id !== undefined)
    const target = idOf(o.target)
    if (chain.length === 0 || target === undefined) {
      add(ctx, 'warning', 'W_CONSTRAINT_UNSUPPORTED', `ik[${index}]`, 'DragonBones IK 缺 bones/target，已跳过', 'skip', raw)
      continue
    }
    out.push({
      kind: 'ik',
      id: typeof o.name === 'string' && o.name.length > 0 ? o.name : `ik_${index}`,
      bone: chain[chain.length - 1]!,
      weight: clamp01(num(o.mix, 1)),
      enabled: true,
      order: Math.floor(num(o.order, index)),
      targetBone: target,
      chainLength: chain.length,
      method: 'analytic',
      maxIterations: 8,
      tolerance: 1e-3,
      bendSign: o.bendPositive === false ? -1 : 1,
    })
  }
  return out
}

function pickDefaultSkin(
  skins: ReadonlyMap<string, SkinData>,
  requested: string | undefined,
  ctx: Ctx,
): string {
  if (requested !== undefined && skins.has(requested)) return requested
  if (requested !== undefined && !skins.has(requested)) {
    add(ctx, 'warning', 'W_SKIN_MISSING', 'skins.defaultSkin', '指定默认皮肤不存在，回退第一个', 'fallback', requested)
  }
  if (skins.has('default')) return 'default'
  const first = skins.keys().next().value as string | undefined
  if (first === undefined) {
    add(ctx, 'warning', 'W_SKIN_MISSING', 'skins', '没有皮肤，使用空皮肤', 'fallback', requested)
    return 'default'
  }
  if (requested === undefined) {
    add(ctx, 'warning', 'W_SKIN_MISSING', 'skins.defaultSkin', '没有名为 default 的皮肤，回退第一个', 'fallback', first)
  }
  return first
}

/** 收集所有附件名 → 稳定数字编码，供 attachment timeline 使用。 */
function attachmentIndex(skins: ReadonlyMap<string, SkinData>): Map<string, number> {
  const out = new Map<string, number>()
  for (const skin of skins.values()) {
    for (const key of skin.attachments.keys()) {
      if (!out.has(key)) out.set(key, out.size)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 动画
// ---------------------------------------------------------------------------

type DrawKey = { time: number; order: number[] }

/** drawOrder 完整顺序序列 → 每槽位一条标量时间轴，结构里保留完整顺序。 */
function drawOrderTimelines(keys: readonly DrawKey[], slotCount: number): Timeline[] {
  const out: Timeline[] = []
  for (let pos = 0; pos < slotCount; pos += 1) {
    out.push({
      kind: 'drawOrder',
      path: `drawOrder[${pos}]`,
      keys: keys.map((k) => ({ time: k.time, value: k.order[pos] ?? pos })),
    })
  }
  return out
}

function completeOrder(order: number[], slotCount: number): number[] {
  const out = order.filter((v) => Number.isInteger(v) && v >= 0 && v < slotCount)
  const seen = new Set(out)
  for (let i = 0; i < slotCount; i += 1) if (!seen.has(i)) out.push(i)
  return out.slice(0, slotCount)
}

function fromOffsets(offsets: unknown, slotNames: readonly string[], ctx: Ctx, path: string): number[] {
  const count = slotNames.length
  const order = new Array<number>(count).fill(-1)
  const unchanged: number[] = []
  let original = 0
  for (const raw of arr(offsets)) {
    const o = obj(raw)
    if (o === null) continue
    const slot = typeof o.slot === 'string' ? slotNames.indexOf(o.slot) : num(o.slot, -1)
    const offset = num(o.offset)
    if (slot < original || slot >= count || !Number.isInteger(offset) || slot + offset < 0 || slot + offset >= count || order[slot + offset] !== -1) {
      add(ctx, 'warning', 'W_DRAWORDER_DUP', path, 'drawOrder 偏移非法，已忽略', 'skip', raw)
      continue
    }
    while (original < slot) unchanged.push(original++)
    order[slot + offset] = original++
  }
  while (original < count) unchanged.push(original++)
  for (let i = count - 1; i >= 0; i -= 1) {
    if (order[i] === -1) order[i] = unchanged.pop()!
  }
  return order
}

function spineBoneCurve(
  key: Record<string, unknown>, next: Record<string, unknown> | null,
  component: number, value: number, nextValue: number, controlScale: number,
): ScalarKey['curve'] | undefined {
  if (key.curve === 'stepped') return 'stepped'
  const curve = key.curve
  const offset = component * 4
  if (!Array.isArray(curve) || curve.length < offset + 4 || next === null) return undefined
  const span = num(next.time) - num(key.time)
  const delta = nextValue - value
  if (span <= 0 || Math.abs(delta) < 1e-12) return undefined
  return [
    (num(curve[offset]) - num(key.time)) / span,
    (num(curve[offset + 1]) * controlScale - value) / delta,
    (num(curve[offset + 2]) - num(key.time)) / span,
    (num(curve[offset + 3]) * controlScale - value) / delta,
  ]
}

function packedColor(v: unknown, ctx: Ctx, path: string): number {
  return packRgba(parseHexColor(v, ctx, path))
}

/** RGBA 0..1 → 0xAARRGGBB，与 slot 颜色 timeline 约定一致。 */
function packRgba(c: RGBA): number {
  const byte = (x: number) => Math.round(clamp01(x) * 255)
  return (((byte(c.a) << 24) | (byte(c.r) << 16) | (byte(c.g) << 8) | byte(c.b)) >>> 0)
}

function readSpineAnimations(
  rawAnimations: unknown,
  sk: CompiledSkeleton,
  slotNames: readonly string[],
  attIndex: ReadonlyMap<string, number>,
  skins: ReadonlyMap<string, SkinData>,
  rawSkins: unknown,
  constraints: readonly ConstraintData[],
  legacyConstraints: boolean,
  ctx: Ctx,
): { animations: Map<string, AnimationClip>; events: { time: number; name: string }[] } {
  const animations = new Map<string, AnimationClip>()
  const events: { time: number; name: string }[] = []
  for (const [name, rawAnimation] of Object.entries(obj(rawAnimations) ?? {})) {
    const a = obj(rawAnimation)
    if (a === null) continue
    const timelines: Timeline[] = []
    let duration = 0
    // 骨骼通道。
    for (const [boneName, rawChannels] of Object.entries(obj(a.bones) ?? {})) {
      const id = sk.boneIdByName.get(boneName)
      if (id === undefined) {
        add(ctx, 'warning', 'W_ANIM_TARGET_MISSING', `animations.${name}.bones.${boneName}`, '动画骨不存在，已跳过', 'skip', boneName)
        continue
      }
      const ch = obj(rawChannels)
      if (ch === null) continue
      const base = id * 7
      if (arr(ch.rotate).length > 0) {
        const keys: ScalarKey[] = arr(ch.rotate).map((raw, index, sourceKeys) => {
          const k = obj(raw) ?? {}
          const time = num(k.time)
          duration = Math.max(duration, time)
          // 4.3 的 rotate.value 是相对 setup 的角度；旧 angle 是绝对角。均保留连续角。
          const absolute = k.angle !== undefined
            ? num(k.angle) * DEG
            : sk.setupLocal[base + 2]! + num(k.value) * DEG
          const value = absolute - sk.setupLocal[base + 2]!
          const next = obj(sourceKeys[index + 1])
          const nextValue = next === null ? value : (next.angle !== undefined
            ? num(next.angle) * DEG - sk.setupLocal[base + 2]!
            : num(next.value) * DEG)
          const curve = spineBoneCurve(k, next, 0, value, nextValue, DEG)
          return { time, value, ...(curve === undefined ? {} : { curve }) }
        })
        timelines.push({ kind: 'rotate', path: boneName, keys })
      }
      if (arr(ch.translate).length > 0) {
        for (const axis of ['x', 'y'] as const) {
          const keys: ScalarKey[] = arr(ch.translate).map((raw, index, sourceKeys) => {
            const k = obj(raw) ?? {}
            const time = num(k.time)
            duration = Math.max(duration, time)
            const scale = ctx.unitScale * (axis === 'y' && ctx.sourceYDown ? -1 : 1)
            const value = num(k[axis]) * scale
            const next = obj(sourceKeys[index + 1])
            const curve = spineBoneCurve(k, next, axis === 'x' ? 0 : 1, value, num(next?.[axis]) * scale, scale)
            return { time, value, ...(curve === undefined ? {} : { curve }) }
          })
          timelines.push({ kind: 'translate', path: `${boneName}.${axis}`, keys })
        }
      }
      if (arr(ch.scale).length > 0) {
        for (const axis of ['sx', 'sy'] as const) {
          const keys: ScalarKey[] = arr(ch.scale).map((raw, index, sourceKeys) => {
            const k = obj(raw) ?? {}
            const time = num(k.time)
            duration = Math.max(duration, time)
            const component = axis === 'sx' ? 'x' : 'y'
            const value = num(k[component], 1)
            const next = obj(sourceKeys[index + 1])
            const curve = spineBoneCurve(k, next, component === 'x' ? 0 : 1, value, num(next?.[component], 1), 1)
            return { time, value, ...(curve === undefined ? {} : { curve }) }
          })
          timelines.push({ kind: 'scale', path: `${boneName}.${axis}`, keys })
        }
      }
      for (const kind of ['translate', 'scale', 'shear'] as const) {
        const combined = kind === 'shear' ? ch.shear : undefined
        for (const axis of ['x', 'y'] as const) {
          const keysRaw = arr(ch[`${kind}${axis}`]).length > 0 ? arr(ch[`${kind}${axis}`]) : arr(combined)
          if (keysRaw.length === 0) continue
          const suffix = kind === 'translate' ? axis : kind === 'scale' ? `s${axis}` : `sh${axis}`
          const keys: ScalarKey[] = keysRaw.map((raw, index) => {
            const k = obj(raw) ?? {}
            const time = num(k.time)
            duration = Math.max(duration, time)
            const paired = kind === 'shear' && arr(ch[`${kind}${axis}`]).length === 0
            const property = paired ? axis : 'value'
            const scale = kind === 'translate' ? ctx.unitScale * (axis === 'y' && ctx.sourceYDown ? -1 : 1)
              : kind === 'shear' ? DEG : 1
            const defaultValue = kind === 'scale' ? 1 : 0
            const value = num(k[property], defaultValue) * scale
            const next = obj(keysRaw[index + 1])
            const nextValue = num(next?.[property], defaultValue) * scale
            const curve = spineBoneCurve(k, next, paired && axis === 'y' ? 1 : 0, value, nextValue, scale)
            return { time, value, ...(curve === undefined ? {} : { curve }) }
          })
          timelines.push({ kind, path: `${boneName}.${suffix}`, keys })
        }
      }
    }
    // 插槽通道。
    for (const [slotName, rawChannels] of Object.entries(obj(a.slots) ?? {})) {
      const slotIndex = slotNames.indexOf(slotName)
      if (slotIndex < 0) continue
      const ch = obj(rawChannels)
      if (ch === null) continue
      if (arr(ch.attachment).length > 0) {
        const keys = arr(ch.attachment).map((raw) => {
          const k = obj(raw) ?? {}
          const time = num(k.time)
          duration = Math.max(duration, time)
          const label = typeof k.name === 'string' ? k.name : null
          return { time, name: label }
        })
        timelines.push({ kind: 'attachment', path: String(slotIndex), keys })
      }
      if (arr(ch.color).length > 0) {
        const keys: ScalarKey[] = arr(ch.color).map((raw) => {
          const k = obj(raw) ?? {}
          const time = num(k.time)
          duration = Math.max(duration, time)
          return { time, value: packedColor(k.color, ctx, `animations.${name}.slots.${slotName}.color`) }
        })
        timelines.push({ kind: 'color', path: String(slotIndex), keys })
      }
      for (const channel of ['rgba', 'rgb', 'alpha', 'rgba2', 'rgb2'] as const) {
        if (arr(ch[channel]).length === 0) continue
        const keys = arr(ch[channel]).map((raw, index, sourceKeys) => {
          const k = obj(raw) ?? {}
          const time = num(k.time)
          duration = Math.max(duration, time)
          const parse = (value: unknown, field: string): RGBA => {
            const hex = typeof value === 'string' && /^[\da-fA-F]{6}$/.test(value) ? `${value}ff` : value
            return parseHexColor(hex, ctx, `animations.${name}.slots.${slotName}.${channel}.${field}`)
          }
          const readColors = (key: Record<string, unknown>) => ({
            light: channel === 'alpha'
              ? { ...WHITE, a: num(key.value) }
              : parse(channel.endsWith('2') ? key.light : key.color, 'light'),
            dark: channel.endsWith('2') ? parse(key.dark, 'dark') : WHITE,
          })
          const { light, dark } = readColors(k)
          const next = obj(sourceKeys[index + 1])
          const future = next === null ? null : readColors(next)
          const values = channel === 'alpha' ? [light.a] : channel === 'rgb' ? [light.r, light.g, light.b]
            : channel === 'rgba' ? [light.r, light.g, light.b, light.a]
              : channel === 'rgb2' ? [light.r, light.g, light.b, dark.r, dark.g, dark.b]
                : [light.r, light.g, light.b, light.a, dark.r, dark.g, dark.b]
          const nextValues = future === null ? values : channel === 'alpha' ? [future.light.a]
            : channel === 'rgb' ? [future.light.r, future.light.g, future.light.b]
              : channel === 'rgba' ? [future.light.r, future.light.g, future.light.b, future.light.a]
                : channel === 'rgb2' ? [future.light.r, future.light.g, future.light.b, future.dark.r, future.dark.g, future.dark.b]
                  : [future.light.r, future.light.g, future.light.b, future.light.a, future.dark.r, future.dark.g, future.dark.b]
          const curves = values.map((value, component) => spineBoneCurve(k, next, component, value, nextValues[component]!, 1))
          return {
            time, light,
            ...(channel.endsWith('2') ? { dark } : {}),
            ...(k.curve === 'stepped' ? { curve: 'stepped' as const } : {}),
            ...(k.curve === undefined ? {} : { curves }),
          }
        })
        timelines.push({ kind: 'color', path: String(slotIndex), channel, keys })
      }
    }
    // drawOrder：Spine 存相对 offset，先展开为完整顺序再落盘。
    if (arr(a.drawOrder).length > 0) {
      const drawKeys: DrawKey[] = arr(a.drawOrder).map((raw, i) => {
        const k = obj(raw) ?? {}
        const time = num(k.time)
        duration = Math.max(duration, time)
        return { time, order: fromOffsets(k.offsets, slotNames, ctx, `animations.${name}.drawOrder[${i}]`) }
      })
      timelines.push(...drawOrderTimelines(drawKeys, slotNames.length))
    }
    // 4.3 attachments 与旧 deform 都按 skin/slot/attachment 索引；保留原始 key 分量与 offset。
    for (const [rootName, rawRoot] of [['deform', a.deform], ['attachments', a.attachments]] as const) {
      for (const [skinName, rawSkin] of Object.entries(obj(rawRoot) ?? {})) {
        for (const [slotName, rawSlot] of Object.entries(obj(rawSkin) ?? {})) {
          const slotIndex = slotNames.indexOf(slotName)
          for (const [attName, rawEntry] of Object.entries(obj(rawSlot) ?? {})) {
            const rawKeys = rootName === 'attachments' ? obj(rawEntry)?.deform : rawEntry
            if (arr(rawKeys).length === 0) continue
            const path = `animations.${name}.${rootName}.${skinName}.${slotName}.${attName}`
            const attachment = skins.get(skinName)?.attachments.get(`${slotName}\u0000${attName}`)
            if (slotIndex < 0 || (attachment?.kind !== 'mesh' && attachment?.kind !== 'weightedMesh')) {
              add(ctx, 'warning', 'W_ANIM_TARGET_MISSING', path, 'deform mesh 不存在，已跳过', 'skip')
              continue
            }
            const rawSkinData = arr(rawSkins).find((skin) => obj(skin)?.name === skinName)
            const rawAttachment = obj(obj(obj(rawSkinData)?.attachments)?.[slotName])?.[attName]
            const sourceAttachment = obj(rawAttachment)?.type === 'linkedmesh'
              ? obj(obj(obj(rawSkinData)?.attachments)?.[slotName])?.[String(obj(rawAttachment)?.parent)]
              : rawAttachment
            const rawVertices = arr(obj(sourceAttachment)?.vertices)
            const weighted = attachment.kind === 'weightedMesh'
            const base = attachment.mesh.positions
            const vertexIndices: readonly number[] = weighted && attachment.mesh.influenceSourceIndices !== undefined
              ? Array.from(attachment.mesh.influenceSourceIndices)
              : (() => {
                const indices: number[] = []
                if (!weighted) return indices
                let cursor = 0
                let source = 0
                const stride = attachment.mesh.influencesPerVertex ?? 4
                for (let vertex = 0; vertex < base.length / 2; vertex += 1) {
                  const count = Math.max(0, Math.floor(num(rawVertices[cursor])))
                  for (let influence = 0; influence < stride; influence += 1) {
                    indices.push(influence < count ? source + influence * 2 : -1)
                  }
                  cursor += 1 + count * 4
                  source += count * 2
                }
                return indices
              })()
            const keys: DeformKey[] = arr(rawKeys).map((raw) => {
              const k = obj(raw) ?? {}
              const time = num(k.time)
              duration = Math.max(duration, time)
              return { time, offset: num(k.offset), vertices: arr(k.vertices).map((v) => num(v)),
                ...(k.curve === 'stepped' ? { curve: 'stepped' as const } : {}) }
            })
            timelines.push({ kind: 'deform', skin: skinName, slot: slotIndex, attachment: attName,
              keys, ...(weighted ? { vertexIndices } : { baseVertices: base }), weighted,
              unitScale: ctx.unitScale, flipY: ctx.sourceYDown })
          }
        }
      }
    }
    const constraintFrames = (
      rawKeys: unknown, fields: readonly string[], defaults: readonly number[], scales: readonly number[],
    ): ConstraintFrame[] => arr(rawKeys).map((raw, index, source) => {
      const key = obj(raw) ?? {}
      const next = obj(source[index + 1])
      const time = num(key.time)
      duration = Math.max(duration, time)
      const fieldValue = (sourceKey: Record<string, unknown> | null, field: string, component: number): number => {
        const fallback = field === 'mixY' ? sourceKey?.mixX : field === 'mixScaleY' ? sourceKey?.mixScaleX : undefined
        return num(sourceKey?.[field], num(fallback, defaults[component])) * scales[component]!
      }
      const values = fields.map((field, component) => fieldValue(key, field, component))
      const curves = values.map((value, component) => spineBoneCurve(key, next, component, value,
        fieldValue(next, fields[component]!, component), scales[component]!))
      return { time, values, curves,
        ...(fields[0] === 'mix' ? {
          bendDirection: key.bendPositive === false ? -1 as const : 1 as const,
          compress: key.compress === true, stretch: key.stretch === true,
        } : {}),
      }
    })
    const validConstraint = (kind: ConstraintData['kind'], constraintName: string, path: string): boolean => {
      if (constraints.some(c => c.id === constraintName && c.kind === kind)) return true
      add(ctx, 'warning', 'W_ANIM_TARGET_MISSING', path, '约束 timeline 目标不存在，已跳过', 'skip', constraintName)
      return false
    }
    for (const [constraintName, rawKeys] of Object.entries(obj(a.ik) ?? {})) {
      const path = `animations.${name}.ik.${constraintName}`
      if (!validConstraint('ik', constraintName, path)) continue
      const frames = constraintFrames(rawKeys, ['mix', 'softness'], [1, 0], [1, ctx.unitScale])
      if (frames.length > 0) {
        if (legacyConstraints) timelines.push({ kind: 'ik', path: constraintName,
          keys: frames.map(frame => ({ time: frame.time, value: frame.values[0]! })) })
        else timelines.push({ kind: 'ik', path: constraintName, frames })
      }
    }
    for (const [constraintName, rawKeys] of Object.entries(obj(a.transform) ?? {})) {
      const path = `animations.${name}.transform.${constraintName}`
      if (!validConstraint('transform', constraintName, path)) continue
      const frames = constraintFrames(rawKeys,
        ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'],
        [1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1])
      if (frames.length > 0) timelines.push({ kind: 'transform', path: constraintName, frames })
    }
    for (const [constraintName, rawChannels] of Object.entries(obj(a.path) ?? {})) {
      const path = `animations.${name}.path.${constraintName}`
      if (!validConstraint('path', constraintName, path)) continue
      const constraint = constraints.find((c): c is Extract<ConstraintData, { kind: 'path' }> => c.id === constraintName && c.kind === 'path')!
      for (const [channel, rawKeys] of Object.entries(obj(rawChannels) ?? {})) {
        if (channel !== 'position' && channel !== 'spacing' && channel !== 'mix') {
          add(ctx, 'warning', 'W_ANIM_UNSUPPORTED', `${path}.${channel}`, '未知 path timeline，已跳过', 'skip', rawKeys)
          continue
        }
        const scale = channel === 'position' ? constraint.positionMode === 'fixed' ? ctx.unitScale : 1
          : channel === 'spacing' ? constraint.spacingMode === 'length' || constraint.spacingMode === 'fixed' ? ctx.unitScale : 1 : 1
        const fields = channel === 'mix' ? ['mixRotate', 'mixX', 'mixY'] : ['value']
        const frames = constraintFrames(rawKeys, fields, fields.map(() => channel === 'mix' ? 1 : 0), fields.map(() => scale))
        if (frames.length > 0) timelines.push({ kind: 'path', path: constraintName, channel, frames })
      }
    }
    for (const [constraintName, rawChannels] of Object.entries(obj(a.slider) ?? {})) {
      const path = `animations.${name}.slider.${constraintName}`
      if (!validConstraint('slider', constraintName, path)) continue
      for (const [channel, rawKeys] of Object.entries(obj(rawChannels) ?? {})) {
        if (channel !== 'time' && channel !== 'mix') {
          add(ctx, 'warning', 'W_ANIM_UNSUPPORTED', `${path}.${channel}`, 'unknown slider timeline', 'skip', rawKeys)
          continue
        }
        const frames = constraintFrames(rawKeys, ['value'], [channel === 'mix' ? 1 : 0], [1])
        if (frames.length > 0) timelines.push({ kind: 'slider', path: constraintName, channel, frames })
      }
    }
    for (const [constraintName, rawChannels] of Object.entries(obj(a.physics) ?? {})) {
      const path = `animations.${name}.physics.${constraintName}`
      if (constraintName !== '' && !validConstraint('physics', constraintName, path)) continue
      for (const [channel, rawKeys] of Object.entries(obj(rawChannels) ?? {})) {
        if (!['reset', 'inertia', 'strength', 'damping', 'mass', 'wind', 'gravity', 'mix'].includes(channel)) {
          add(ctx, 'warning', 'W_ANIM_UNSUPPORTED', `${path}.${channel}`, '未知 physics timeline，已跳过', 'skip', rawKeys)
          continue
        }
        const frames = constraintFrames(rawKeys, ['value'], [channel === 'mix' ? 1 : 0], [1])
        if (frames.length > 0) timelines.push({ kind: 'physics', path: constraintName || '-1',
          channel: channel as 'reset' | 'inertia' | 'strength' | 'damping' | 'mass' | 'wind' | 'gravity' | 'mix', frames })
      }
    }
    // 事件。
    const eventKeys = arr(a.events).map((raw) => {
      const k = obj(raw) ?? {}
      const time = num(k.time)
      duration = Math.max(duration, time)
      return {
        time,
        name: typeof k.name === 'string' ? k.name : '',
        ...(k.int !== undefined ? { int: num(k.int) } : {}),
        ...(k.float !== undefined ? { float: num(k.float) } : {}),
        ...(typeof k.string === 'string' ? { string: k.string } : {}),
      }
    })
    if (eventKeys.length > 0) {
      timelines.push({ kind: 'event', path: name, events: eventKeys })
      for (const e of eventKeys) events.push({ time: e.time, name: e.name })
    }
    animations.set(name, { name, duration, timelines })
  }
  return { animations, events }
}

function readDragonBonesAnimations(
  rawAnimations: unknown,
  frameRate: number,
  sk: CompiledSkeleton,
  slotNames: readonly string[],
  ctx: Ctx,
): { animations: Map<string, AnimationClip>; events: { time: number; name: string }[] } {
  const animations = new Map<string, AnimationClip>()
  const events: { time: number; name: string }[] = []
  const rate = frameRate > 0 ? frameRate : 24
  for (const raw of arr(rawAnimations)) {
    const a = obj(raw)
    if (a === null) continue
    const name = typeof a.name === 'string' ? a.name : `anim_${animations.size}`
    const timelines: Timeline[] = []
    let duration = 0
    const eventKeys: { time: number; name: string }[] = []
    for (const rawBone of arr(a.bone)) {
      const b = obj(rawBone)
      if (b === null) continue
      const id = sk.boneIdByName.get(typeof b.name === 'string' ? b.name : '')
      if (id === undefined) {
        add(ctx, 'warning', 'W_ANIM_TARGET_MISSING', `animation.${name}.bone.${String(b.name)}`, '动画骨不存在，已跳过', 'skip', b.name)
        continue
      }
      const base = id * 7
      // 帧关键帧：duration 是到下一帧的帧数，累加后除以 frameRate 得秒。
      const frames = (channel: unknown): { time: number; frame: Record<string, unknown> }[] => {
        let acc = 0
        return arr(channel).map((rawFrame) => {
          const f = obj(rawFrame) ?? {}
          const time = acc / rate
          acc += num(f.duration, 0)
          duration = Math.max(duration, time)
          return { time, frame: f }
        })
      }
      if (arr(b.rotate).length > 0) {
        const keys: ScalarKey[] = frames(b.rotate).map(({ time, frame }) => ({
          time,
          // DragonBones 源绝对角在 y 翻转后取负；保留连续圈数。
          value: -num(frame.rotate) * DEG - sk.setupLocal[base + 2]!,
        }))
        timelines.push({ kind: 'rotate', path: String(b.name), keys })
      }
      if (arr(b.translate).length > 0) {
        for (const [axis, channel] of [['x', base + 0], ['y', base + 1]] as const) {
          const keys: ScalarKey[] = frames(b.translate).map(({ time, frame }) => {
            const absolute = axis === 'x' ? num(frame.x) * ctx.unitScale : (ctx.sourceYDown ? -1 : 1) * num(frame.y) * ctx.unitScale
            return { time, value: absolute - sk.setupLocal[channel]! }
          })
          timelines.push({ kind: 'translate', path: `${String(b.name)}.${axis}`, keys })
        }
      }
      if (arr(b.scale).length > 0) {
        for (const [axis, channel] of [['sx', base + 3], ['sy', base + 4]] as const) {
          const keys: ScalarKey[] = frames(b.scale).map(({ time, frame }) => ({
            time,
            value: num(frame[axis === 'sx' ? 'x' : 'y'], 1) / sk.setupLocal[channel]!,
          }))
          timelines.push({ kind: 'scale', path: `${String(b.name)}.${axis}`, keys })
        }
      }
    }
    // slot displayIndex / color timeline。
    for (const rawSlotAnim of arr(a.slot)) {
      const s = obj(rawSlotAnim)
      if (s === null) continue
      const slotIndex = slotNames.indexOf(typeof s.name === 'string' ? s.name : '')
      if (slotIndex < 0) continue
      if (arr(s.displayIndex).length > 0) {
        let acc = 0
        const keys: ScalarKey[] = arr(s.displayIndex).map((rawFrame) => {
          const f = obj(rawFrame) ?? {}
          const time = acc / rate
          acc += num(f.duration, 0)
          duration = Math.max(duration, time)
          return { time, value: num(f.value, 0) }
        })
        timelines.push({ kind: 'attachment', path: String(slotIndex), keys })
      }
      if (arr(s.color).length > 0) {
        let acc = 0
        const keys: ScalarKey[] = arr(s.color).map((rawFrame) => {
          const f = obj(rawFrame) ?? {}
          const time = acc / rate
          acc += num(f.duration, 0)
          duration = Math.max(duration, time)
          return { time, value: packRgba(parseDbColor(f.value)) }
        })
        timelines.push({ kind: 'color', path: String(slotIndex), keys })
      }
    }
    // ffd：顶点偏移，按 slot 名索引；值取首分量以便统一 Timeline 结构。
    for (const rawFfd of arr(a.ffd)) {
      const f = obj(rawFfd)
      if (f === null) continue
      const slotIndex = slotNames.indexOf(typeof f.name === 'string' ? f.name : '')
      if (slotIndex < 0) continue
      let acc = 0
      const keys: ScalarKey[] = arr(f.vertices).map((rawKey) => {
        const k = obj(rawKey) ?? {}
        const time = acc / rate
        acc += num(k.duration, 0)
        duration = Math.max(duration, time)
        const offset = arr(k.offset)
        return { time, value: offset.length > 0 ? num(offset[0]) : 0 }
      })
      if (keys.length > 0) timelines.push({ kind: 'deform', path: `${slotIndex}.${String(f.name)}`, keys })
    }
    // ik timeline（4.5 可选）：按约束名索引。
    for (const rawIk of arr(a.ik)) {
      const ik = obj(rawIk)
      if (ik === null) continue
      const keyName = typeof ik.name === 'string' ? ik.name : ''
      const keys: ScalarKey[] = arr(ik.keys ?? ik.mix).map((rawKey) => {
        const k = obj(rawKey) ?? {}
        const time = num(k.time, 0)
        duration = Math.max(duration, time)
        return { time, value: clamp01(num(k.mix ?? k.value, 1)) }
      })
      if (keyName.length > 0 && keys.length > 0) timelines.push({ kind: 'ik', path: keyName, keys })
    }
    // zOrder：完整 slot 索引顺序。
    const zFrames = arr(a.zOrder)
    if (zFrames.length > 0) {
      let acc = 0
      const drawKeys: DrawKey[] = zFrames.map((rawFrame) => {
        const f = obj(rawFrame) ?? {}
        const time = acc / rate
        acc += num(f.duration, 0)
        duration = Math.max(duration, time)
        return { time, order: completeOrder(arr(f.zOrder).map((x) => num(x, -1)), slotNames.length) }
      })
      timelines.push(...drawOrderTimelines(drawKeys, slotNames.length))
    }
    // frame 事件：帧时间 / frameRate。
    let eventFrame = 0
    for (const rawFrame of arr(a.frame)) {
      const f = obj(rawFrame) ?? {}
      const time = eventFrame / rate
      eventFrame += num(f.duration, 0)
      if (typeof f.event === 'string' && f.event.length > 0) {
        eventKeys.push({ time, name: f.event })
        events.push({ time, name: f.event })
        duration = Math.max(duration, time)
      }
    }
    if (eventKeys.length > 0) timelines.push({ kind: 'event', path: name, events: eventKeys })
    if (num(a.duration) > 0) duration = Math.max(duration, num(a.duration) / rate)
    animations.set(name, { name, duration, timelines })
  }
  return { animations, events }
}

// ---------------------------------------------------------------------------
// canonical JSON + 纯 TS SHA-256
// ---------------------------------------------------------------------------

/** 递归生成 canonical JSON：键排序、跳过 undefined、typed array 转普通数组。 */
function canonical(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return JSON.stringify(Number.isFinite(v) ? (v === 0 ? 0 : v) : null)
  if (ArrayBuffer.isView(v)) return canonical(Array.from(v as unknown as ArrayLike<number>))
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v instanceof Map) {
    const entries = Array.from(v.entries())
      .map(([k, item]) => [canonical(k), canonical(item)] as const)
      .sort((l, r) => (l[0] < r[0] ? -1 : l[0] > r[0] ? 1 : 0))
    return `{${entries.map(([k, item]) => `${k}:${item}`).join(',')}}`
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
  }
  return 'null'
}

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

/** 手写 UTF-8 编码，避免依赖宿主 API。 */
function utf8(s: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < s.length; i += 1) {
    let cp = s.charCodeAt(i)!
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1)!
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00)
        i += 1
      }
    }
    if (cp < 0x80) out.push(cp)
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
  }
  return Uint8Array.from(out)
}

function sha256Hex(msg: Uint8Array): string {
  const total = Math.ceil((msg.length + 9) / 64) * 64
  const padded = new Uint8Array(total)
  padded.set(msg)
  padded[msg.length] = 0x80
  const view = new DataView(padded.buffer)
  const bits = msg.length * 8
  view.setUint32(total - 8, Math.floor(bits / 0x100000000))
  view.setUint32(total - 4, bits >>> 0)

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!
    let e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + s1 + ch + K256[i]! + w[i]!) >>> 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (s0 + maj) >>> 0
      hh = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0
    h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0
    h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('')
}

/** 对 canonical JSON 求 64 位小写 hex；同输入同输出。 */
export function canonicalHash(asset: Omit<SkeletonAsset, 'hash' | 'report'>): string {
  return sha256Hex(utf8(canonical(asset)))
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function unitScaleOf(options: { unitScale?: number } | undefined, ctx: Ctx): number {
  const given = options?.unitScale
  if (given !== undefined && Number.isFinite(given) && given > 0) return given
  add(ctx, 'info', 'I_UNIT_ASSUMED', 'unitScale', '未提供 unitScale，采用 0.01（100px/m）', 'fallback', given)
  return 0.01
}

function freezeAsset(
  source: 'spine' | 'dragonbones',
  sourceVersion: string,
  unitScale: number,
  skeleton: CompiledSkeleton,
  slots: SlotData[],
  skins: Map<string, SkinData>,
  animations: Map<string, AnimationClip>,
  events: { time: number; name: string }[],
  ctx: Ctx,
  atlas?: AtlasData,
  constraints?: readonly ConstraintData[],
  maskLibrary?: MaskLibrary,
): SkeletonAsset {
  slots.forEach((slot) => Object.freeze(slot))
  for (const skin of skins.values()) Object.freeze(skin)
  animations.forEach((clip) => Object.freeze(clip))
  const core: Omit<SkeletonAsset, 'hash' | 'report'> = {
    schema: 1,
    source,
    sourceVersion,
    unitScale,
    skeleton,
    slots: Object.freeze(slots),
    skins: Object.freeze(skins),
    animations: Object.freeze(animations),
    events: Object.freeze(events),
    ...(atlas !== undefined ? { atlas } : {}),
    ...(constraints !== undefined ? { constraints: Object.freeze(constraints) } : {}),
    ...(maskLibrary !== undefined ? { maskLibrary } : {}),
  }
  const report: ImportReport = {
    issues: ctx.issues,
    warnings: ctx.issues.filter((i) => i.severity === 'warning').length,
    errors: ctx.issues.filter((i) => i.severity === 'error').length,
  }
  return Object.freeze({ ...core, hash: canonicalHash(core), report })
}

/** 导入 Spine 4.x JSON。主版本 ≠4 / 结构非法抛错，其余进 report。 */
export function importSpine(
  json: unknown,
  options?: { unitScale?: number; defaultSkin?: string; atlas?: AtlasData; sourceYDown?: boolean; maxInfluences?: number },
): SkeletonAsset {
  const doc = obj(json)
  if (doc === null) throw new Error('E_SCHEMA: spine JSON 必须是对象')
  const skeletonMeta = obj(doc.skeleton)
  if (skeletonMeta === null) throw new Error('E_SCHEMA: spine.skeleton 缺失')
  const version = typeof skeletonMeta.spine === 'string' ? skeletonMeta.spine : ''
  if (!/^4\./.test(version)) throw new Error(`E_VERSION: ${version || '(missing)'}`)

  const ctx: Ctx = {
    source: 'spine',
    sourceYDown: options?.sourceYDown ?? false,
    unitScale: 0.01,
    maxInfluences: options?.maxInfluences ?? 0,
    issues: [],
    atlas: collectAtlas(doc, 'spine'),
    atlasData: options?.atlas ?? null,
    masks: [],
  }
  if (!Number.isInteger(ctx.maxInfluences) || ctx.maxInfluences < 0) throw new Error('E_CONFIG: maxInfluences')
  ctx.unitScale = unitScaleOf(options, ctx)

  const rawBones = arr(doc.bones).map((raw, i) => rawBoneFrom(raw, i, 'spine', ctx, `bones[${i}]`))
  if (rawBones.length === 0) throw new Error('E_SCHEMA: spine.bones 为空')
  const boneNames = dedupe(rawBones.map((b) => b.name), ctx, 'bones')
  rawBones.forEach((b, i) => { b.name = boneNames[i]! })
  const { skeleton, srcToId } = compileBones(rawBones, ctx, typeof doc.name === 'string' ? doc.name : 'spine')

  const rawSlots = arr(doc.slots)
  const slotNames = dedupe(rawSlots.map((raw) => {
    const o = obj(raw)
    return typeof o?.name === 'string' ? o.name : ''
  }), ctx, 'slots')
  const slots: SlotData[] = rawSlots.map((raw, i) => {
    const o = obj(raw) ?? {}
    const boneName = typeof o.bone === 'string' ? o.bone : ''
    let bone = skeleton.boneIdByName.get(boneName)
    if (bone === undefined) {
      add(ctx, 'error', 'E_BONE_PARENT', `slots[${i}].bone`, 'slot 骨不存在，挂到根骨', 'fallback', boneName)
      bone = skeleton.roots[0] ?? 0
    }
    const defaultAttachment = typeof o.attachment === 'string' && o.attachment.length > 0 ? o.attachment : null
    const dark = o.dark !== undefined && o.dark !== null
      ? parseHexColor(o.dark, ctx, `slots[${i}].dark`)
      : undefined
    return {
      id: slotNames[i]!,
      bone,
      order: i,
      color: parseHexColor(o.color, ctx, `slots[${i}].color`),
      ...(dark === undefined ? {} : { dark }),
      blend: parseBlend(o.blend, ctx, `slots[${i}].blend`),
      attachment: defaultAttachment,
      mask: null,
      zOffset: 0,
    }
  })
  const builtSlots: BuiltSlot[] = slots.map((s) => ({ name: s.id, attachment: s.attachment }))

  const skins = new Map<string, SkinData>()
  for (const [i, rawSkin] of arr(doc.skins).entries()) {
    const s = obj(rawSkin)
    if (s === null) continue
    const name = s.name === 'default' ? 'default' : typeof s.name === 'string' ? s.name : `skin_${i}`
    if (skins.has(name)) {
      add(ctx, 'error', 'E_DUPLICATE_NAME', `skins[${i}].name`, '皮肤重名，已跳过', 'skip', name)
      continue
    }
    const attachments = new Map<string, Attachment>()
    const groups = builtSlots.map((slot) => ({
      slot,
      group: obj(obj(s.attachments)?.[slot.name]),
    }))
    // 两遍：先普通附件，再 linkedmesh，保证父拓扑已存在。
    for (const linkedPass of [false, true]) {
      for (const { slot, group } of groups) {
        if (group === null) continue
        for (const [attName, rawAtt] of Object.entries(group)) {
          const attObj = obj(rawAtt)
          const isLinked = attObj?.type === 'linkedmesh'
          if (isLinked !== linkedPass) continue
          // Spine 允许同名附件存在于不同 slot；真正的 key 是 slot 限定的。
          const attachmentKey = `${slot.name}\u0000${attName}`
          if (attachments.has(attachmentKey)) {
            add(ctx, 'error', 'E_DUPLICATE_NAME', `skins[${i}].attachments.${slot.name}.${attName}`, '附件重名，已跳过', 'skip', attName)
            continue
          }
          const path = `skins[${i}].attachments.${slot.name}.${attName}`
          const bone = slotBoneId(slots, slot)
          let built: Attachment | null
          if (isLinked && attObj !== null) {
            built = buildLinkedMesh(attObj, attName, attachments.get(String(attObj.parent ?? '')), bone, ctx, path)
            if (built === null) {
              add(ctx, 'warning', 'W_ATTACHMENT_UNSUPPORTED', path, 'linkedmesh 父拓扑不存在，退化为 region', 'fallback', attObj.parent)
              built = {
                kind: 'region',
                id: attName,
                region: regionRefOf(ctx, atlasKeyOf(attObj.path, attName, ctx, `${path}.path`), null),
                color: WHITE,
              }
            }
          } else {
            built = buildAttachment(rawAtt, attName, 'spine', bone, srcToId, ctx, path)
          }
          if (built === null) continue
          if (built.kind === 'clipping' && attObj !== null) {
            addClippingMask(ctx, slots, slot.name, attName, attObj, built.polygon)
            const mask = ctx.masks.find((item) => item.id === `${slots.findIndex((s) => s.id === slot.name)}:${attName}`)
            if (mask !== undefined) built = { ...built, endSlotId: mask.endSlotId }
          }
          attachments.set(attachmentKey, built)
          if (!attachments.has(attName)) attachments.set(attName, built)
        }
      }
    }
    skins.set(name, { id: name, attachments })
  }
  // 只负责校验/报告默认皮肤；运行时由 createSlotSet 选用。
  pickDefaultSkin(skins, options?.defaultSkin, ctx)

  const referenceScale = num(skeletonMeta.referenceScale, 100) * ctx.unitScale
  let constraints = readSpineConstraints(doc, skeleton, skins, slots, ctx).map(c => c.kind === 'physics'
    ? { ...c, environment: { referenceScale, windX: 1, windY: 0, gravityX: 0, gravityY: 1 } }
    : c)
  const maskLibrary: MaskLibrary | undefined = ctx.masks.length > 0
    ? Object.freeze({ version: 1 as const, masks: Object.freeze(ctx.masks.slice()) })
    : undefined

  const attIndex = attachmentIndex(skins)
  const { animations, events } = readSpineAnimations(doc.animations, skeleton, slotNames, attIndex, skins, doc.skins, constraints, constraints.length === 0, ctx)
  constraints = constraints.map(c => {
    if (c.kind !== 'slider') return c
    const clip = animations.get(c.animation)
    if (clip === undefined) {
      add(ctx, 'warning', 'W_CONSTRAINT_UNSUPPORTED', `constraints.${c.id}`, 'slider animation missing', 'skip', c.animation)
      return { ...c, enabled: false }
    }
    // Slider.update passes null for fired events: nested event timelines are intentionally silent.
    const unsupported = clip.timelines.some(t => !['rotate', 'translate', 'scale', 'shear', 'attachment', 'drawOrder', 'event'].includes(t.kind))
    if (unsupported) add(ctx, 'warning', 'W_CONSTRAINT_UNSUPPORTED', `constraints.${c.id}`,
      'slider nested animation has unsupported channels', 'keep', c.animation)
    return { ...c, clip }
  })
  return freezeAsset(
    'spine', version, ctx.unitScale, skeleton, slots, skins, animations, events, ctx,
    ctx.atlasData ?? undefined, constraints, maskLibrary,
  )
}

/** 由 BuiltSlot 名字回查稳定 BoneId（slots[].bone 保存的即是）。 */
function slotBoneId(slots: readonly SlotData[], slot: BuiltSlot): number {
  return slots.find((s) => s.id === slot.name)?.bone ?? 0
}

/** 导入 DragonBones 4.5 JSON（5.x 走 compatibleVersion 兼容子集）。 */
export function importDragonBones(
  json: unknown,
  options?: { unitScale?: number; defaultSkin?: string; atlas?: AtlasData; sourceYDown?: boolean; maxInfluences?: number },
): SkeletonAsset {
  const doc = obj(json)
  if (doc === null) throw new Error('E_SCHEMA: dragonbones JSON 必须是对象')
  const version = typeof doc.version === 'string' ? doc.version : ''
  const compatible = typeof doc.compatibleVersion === 'string' ? doc.compatibleVersion : ''
  if (!/^4\.5/.test(version) && !/^4\.5/.test(compatible)) {
    throw new Error(`E_VERSION: ${version || '(missing)'}`)
  }
  const ctx: Ctx = {
    source: 'dragonbones',
    sourceYDown: options?.sourceYDown ?? true,
    unitScale: 0.01,
    maxInfluences: options?.maxInfluences ?? 0,
    issues: [],
    atlas: collectAtlas(doc, 'dragonbones'),
    atlasData: options?.atlas ?? null,
    masks: [],
  }
  if (!Number.isInteger(ctx.maxInfluences) || ctx.maxInfluences < 0) throw new Error('E_CONFIG: maxInfluences')
  ctx.unitScale = unitScaleOf(options, ctx)

  const armatures = arr(doc.armature)
  if (armatures.length === 0) throw new Error('E_SCHEMA: dragonbones.armature 为空')
  const armature = obj(armatures[0]) ?? {}
  const frameRate = num(armature.frameRate, num(doc.frameRate, 24))

  const rawBones = arr(armature.bone).map((raw, i) => rawBoneFrom(raw, i, 'db', ctx, `armature.bone[${i}]`))
  if (rawBones.length === 0) throw new Error('E_SCHEMA: dragonbones.bone 为空')
  const boneNames = dedupe(rawBones.map((b) => b.name), ctx, 'armature.bones')
  rawBones.forEach((b, i) => { b.name = boneNames[i]! })
  const { skeleton, srcToId } = compileBones(rawBones, ctx, typeof armature.name === 'string' ? armature.name : 'dragonbones')

  const rawSlots = arr(armature.slot)
  const slotNames = dedupe(rawSlots.map((raw) => {
    const o = obj(raw)
    return typeof o?.name === 'string' ? o.name : ''
  }), ctx, 'armature.slots')
  const slots: SlotData[] = rawSlots.map((raw, i) => {
    const o = obj(raw) ?? {}
    const boneName = typeof o.parent === 'string' ? o.parent : ''
    let bone = skeleton.boneIdByName.get(boneName)
    if (bone === undefined) {
      add(ctx, 'error', 'E_BONE_PARENT', `armature.slot[${i}].parent`, 'slot 骨不存在，挂到根骨', 'fallback', boneName)
      bone = skeleton.roots[0] ?? 0
    }
    const displayIndex = num(o.displayIndex, 0)
    if (!Number.isInteger(displayIndex) || displayIndex < 0) {
      add(ctx, 'warning', 'W_DISPLAY_INDEX', `armature.slot[${i}].displayIndex`, 'displayIndex 越界，回退 0', 'fallback', o.displayIndex)
    }
    const blend = parseBlend(o.blendMode, ctx, `armature.slot[${i}].blendMode`)
    return {
      id: slotNames[i]!,
      bone,
      order: i,
      color: parseDbColor(o.color),
      blend,
      attachment: null,
      mask: null,
      zOffset: 0,
    }
  })

  const skins = new Map<string, SkinData>()
  const displayNamesBySlot = new Map<string, string[]>()
  const displayIndexByName = new Map<string, number>()
  rawSlots.forEach((raw, i) => {
    const o = obj(raw) ?? {}
    displayIndexByName.set(slotNames[i]!, num(o.displayIndex, 0))
  })
  for (const [i, rawSkin] of arr(armature.skin).entries()) {
    const s = obj(rawSkin)
    if (s === null) continue
    const name = typeof s.name === 'string' ? s.name : `skin_${i}`
    if (skins.has(name)) {
      add(ctx, 'error', 'E_DUPLICATE_NAME', `armature.skin[${i}].name`, '皮肤重名，已跳过', 'skip', name)
      continue
    }
    const firstSkin = skins.size === 0
    const attachments = new Map<string, Attachment>()
    for (const rawSlotSkin of arr(s.slot)) {
      const ss = obj(rawSlotSkin)
      if (ss === null) continue
      const slotName = typeof ss.name === 'string' ? ss.name : ''
      const slotIndex = slotNames.indexOf(slotName)
      if (slotIndex < 0) continue
      const displays = arr(ss.display)
      const names: string[] = []
      for (const [j, rawDisplay] of displays.entries()) {
        const dsp = obj(rawDisplay)
        if (dsp === null) continue
        const displayName = typeof dsp.name === 'string' ? dsp.name : `display_${j}`
        names.push(displayName)
        if (attachments.has(displayName)) continue
        const built = buildDragonBonesDisplay(
          dsp, displayName, slots[slotIndex]!.bone, skeleton.boneIdByName, ctx,
          `armature.skin[${i}].slot.${slotName}.display[${j}]`,
        )
        if (built !== null) attachments.set(displayName, built)
      }
      if (firstSkin) displayNamesBySlot.set(slotName, names)
      if (displays.length === 0) {
        add(ctx, 'warning', 'W_ATTACHMENT_UNSUPPORTED', `armature.skin[${i}].slot.${slotName}`, 'display 为空，slot 无附件', 'keep', null)
      }
    }
    skins.set(name, { id: name, attachments })
  }
  // displayIndex：在首个皮肤的 display 列表中选默认附件；越界回退 0。
  for (const [slotName, names] of displayNamesBySlot) {
    const index = Math.floor(num(displayIndexByName.get(slotName), 0))
    const chosen = names[index] ?? names[0] ?? null
    setSlotAttachment(slots, slotName, chosen)
  }
  pickDefaultSkin(skins, options?.defaultSkin, ctx)

  const constraints = readDragonBonesConstraints(armature, skeleton, ctx)
  const { animations, events } = readDragonBonesAnimations(
    armature.animation, frameRate, skeleton, slotNames, ctx,
  )
  return freezeAsset(
    'dragonbones', version, ctx.unitScale, skeleton, slots, skins, animations, events, ctx,
    ctx.atlasData ?? undefined, constraints, undefined,
  )
}

// S3 导入兼容入口：binary 4.2 与 3.8 均在转换后复用本模块的 importSpine。
// 从 importer 再导出，避免调用方为了新格式额外记住两个模块路径。
export { importSpineBinary, type SpineBinaryAssetContext } from './spine-binary'
export { importSpine38, type Spine38Options } from './spine38'

/**
 * 编译 setup 姿态后逐骨比较原点；偏差 > 1e-3 米记 error。
 * 期望表可只给部分骨，缺失骨自身也记 error。
 */
export function validateBoneWorld(
  asset: SkeletonAsset,
  expected: ReadonlyMap<string, readonly [number, number]>,
): ImportIssue[] {
  const pose = createPose(asset.skeleton)
  updateWorld(pose)
  const issues: ImportIssue[] = []
  for (const [name, target] of expected) {
    const id = asset.skeleton.boneIdByName.get(name)
    if (id === undefined) {
      issues.push({
        severity: 'error',
        code: 'E_BONE_MISSING',
        path: `bones.${name}`,
        message: '期望表中的骨不存在',
        action: 'reject',
        sourceValue: name,
      })
      continue
    }
    const off = id * WORLD_STRIDE
    const actual: readonly [number, number] = [pose.world[off + 4]!, pose.world[off + 5]!]
    if (Math.hypot(actual[0] - target[0], actual[1] - target[1]) > 1e-3) {
      issues.push({
        severity: 'error',
        code: 'E_WORLD_MISMATCH',
        path: `bones.${name}`,
        message: 'setup 骨原点与期望不符（> 1e-3 米）',
        action: 'reject',
        sourceValue: actual,
      })
    }
  }
  return issues
}
