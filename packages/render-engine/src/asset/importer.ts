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
import type { Attachment, BlendMode, RegionRef, RGBA, SkinData, SlotData } from '../slot/slot'
import type { AnimationClip, ScalarKey, Timeline } from '../animation/animation'
import type { ConstraintData } from '../constraint/constraint'
import type { AtlasData } from './atlas'

const DEG = Math.PI / 180
const DEFAULT_REGION_UVS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])

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
  unitScale: number
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
function flippedMatrix(b: RawBone, unitScale: number): Float64Array {
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
  out[1] = -b1 // 共轭：b 取反
  out[2] = -c  // 共轭：c 取反
  out[3] = d
  out[4] = b.x * unitScale
  out[5] = -b.y * unitScale // (x,y) → (x,-y)
  return out
}

function convertBone(b: RawBone, ctx: Ctx, path: string): LocalTransform {
  const m = flippedMatrix(b, ctx.unitScale)
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
  const out = new Float32Array(points.length)
  for (let i = 0; i < points.length; i += 2) {
    out[i] = num(points[i]) * scale
    out[i + 1] = -num(points[i + 1]) * scale
  }
  return out
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

/** 权重：读 count → (boneIndex,x,y,w)；映射稳定 BoneId，超 4 裁剪并归一化。 */
function readWeightedMesh(
  raw: Record<string, unknown>,
  slotBone: number,
  srcToId: Int32Array,
  ctx: Ctx,
  path: string,
): Attachment {
  const vertices = arr(raw.vertices).map((v) => num(v))
  const uvs = arr(raw.uvs).map((v) => num(v))
  const perVertex = 4
  // 先按源布局数一遍顶点：每个顶点 = count + count×4 个分量。
  let vertexCount = 0
  let scan = 0
  while (scan < vertices.length) {
    const count = Math.floor(vertices[scan] ?? 0)
    if (!Number.isInteger(count) || count < 0 || count > 64) break
    scan += 1 + count * 4
    vertexCount += 1
  }
  if (vertexCount === 0) vertexCount = Math.max(1, Math.floor(vertices.length / 2))
  const positions = new Float32Array(vertexCount * 2)
  const boneIndices = new Uint16Array(vertexCount * perVertex)
  const weights = new Float32Array(vertexCount * perVertex)
  let p = 0
  let v = 0
  while (p < vertices.length && v < vertexCount) {
    const count = Math.max(0, Math.floor(vertices[p++]!))
    const influences: { bone: number; x: number; y: number; w: number }[] = []
    for (let j = 0; j < count; j += 1) {
      const srcIndex = Math.floor(vertices[p++]!)
      const x = vertices[p++] ?? 0
      const y = vertices[p++] ?? 0
      const w = vertices[p++] ?? 0
      if (srcIndex < 0 || srcIndex >= srcToId.length) {
        add(ctx, 'error', 'E_INDEX_RANGE', `${path}.vertices[${v}][${j}].bone`, '权重骨索引越界，已跳过', 'skip', srcIndex)
        continue
      }
      influences.push({ bone: srcToId[srcIndex]!, x, y, w })
    }
    let sum = influences.reduce((acc, inf) => acc + inf.w, 0)
    if (!Number.isFinite(sum) || sum <= 0) {
      add(ctx, 'error', 'E_WEIGHT_SUM', `${path}.vertices[${v}]`, '权重和 ≤0 或非有限，回退单骨刚性', 'fallback', influences.map((i) => i.w))
      influences.length = 0
      influences.push({ bone: slotBone, x: 0, y: 0, w: 1 })
      sum = 1
    }
    if (influences.length > 4) {
      add(ctx, 'warning', 'W_WEIGHT_PRUNED', `${path}.vertices[${v}]`, '影响数 >4，保留前 4 并归一化', 'normalize', influences.length)
      influences.length = 4
      sum = influences.reduce((acc, inf) => acc + inf.w, 0)
    }
    positions[v * 2] = influences[0]!.x * ctx.unitScale
    positions[v * 2 + 1] = -influences[0]!.y * ctx.unitScale
    for (let j = 0; j < 4; j += 1) {
      const inf = influences[j]
      boneIndices[v * perVertex + j] = inf?.bone ?? slotBone
      weights[v * perVertex + j] = inf && sum > 0 ? clamp01(inf.w / sum) : 0
    }
    v += 1
  }
  const mesh = {
    id: typeof raw.name === 'string' ? raw.name : 'mesh',
    positions,
    uvs: uvOf(uvs, vertexCount),
    indices: validateIndices(raw.triangles, vertexCount, ctx, path),
    bone: slotBone,
    vertexSpace: 'boneLocal' as const,
    boneIndices,
    weights,
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
    if (weighted) return readWeightedMesh(rawObj, slotBone, srcToId, ctx, path)
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
    return { kind: 'point', id: name, point: [num(rawObj.x) * ctx.unitScale, -num(rawObj.y) * ctx.unitScale] }
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
  return {
    kind: 'region',
    id: name,
    region: { ...regionRefOf(ctx, atlasKey, uvs), ...(sequence === undefined ? {} : { sequence }) },
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

/** 设置 slot.mask；SlotData 对外只读，导入阶段允许一次性写入。 */
function setSlotMask(slots: readonly SlotData[], slotName: string, maskId: string): void {
  const slot = slots.find((s) => s.id === slotName)
  if (slot !== undefined) (slot as { mask: string | null }).mask = maskId
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
  const id = `${slotName}.${attachmentName}`
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
  setSlotMask(slots, slotName, id)
}

/** DragonBones 紧凑权重 [boneCount,(boneIndex,weight)*] → 每顶点 4 影响。 */
function readDbWeights(
  raw: readonly number[],
  vertexCount: number,
  boneNames: readonly string[],
  boneIdByName: ReadonlyMap<string, number>,
  slotBone: number,
  ctx: Ctx,
  path: string,
): { boneIndices: Uint16Array; weights: Float32Array } | null {
  const boneIndices = new Uint16Array(Math.max(1, vertexCount) * 4)
  const weights = new Float32Array(Math.max(1, vertexCount) * 4)
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
    if (influences.length > 4) {
      add(ctx, 'warning', 'W_WEIGHT_PRUNED', `${path}.weights[${v}]`, '影响数 >4，保留前 4 并归一化', 'normalize', influences.length)
      influences.length = 4
      sum = influences.reduce((acc, item) => acc + item.weight, 0)
    }
    for (let j = 0; j < 4; j += 1) {
      const influence = influences[j]
      boneIndices[v * 4 + j] = influence?.bone ?? slotBone
      weights[v * 4 + j] = influence !== undefined && sum > 0 ? clamp01(influence.weight / sum) : 0
    }
  }
  return cursor > raw.length ? null : { boneIndices, weights }
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
        mesh: { ...base, boneIndices: weights.boneIndices, weights: weights.weights },
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

/** 收集 path 附件多边形，供 path 约束引用。 */
function pathPolygons(skins: ReadonlyMap<string, SkinData>): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>()
  for (const skin of skins.values()) {
    for (const attachment of skin.attachments.values()) {
      if (attachment.kind === 'path' && !out.has(attachment.id)) out.set(attachment.id, attachment.polygon)
    }
  }
  return out
}

/** Spine 顶层 ik/transform/path/physics → ConstraintData[]；不可恢复项记 W 跳过。 */
function readSpineConstraints(
  doc: Record<string, unknown>,
  skeleton: CompiledSkeleton,
  skins: ReadonlyMap<string, SkinData>,
  ctx: Ctx,
): ConstraintData[] {
  const out: ConstraintData[] = []
  const paths = pathPolygons(skins)
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
    const mixX = clamp01(num(o.mixX, num(o.mixY, 1)))
    const mixY = clamp01(num(o.mixY, mixX))
    out.push({
      kind: 'transform',
      id: typeof o.name === 'string' && o.name.length > 0 ? o.name : `transform_${index}`,
      bone: chain[0]!,
      weight: clamp01(num(o.mix, 1)),
      enabled: true,
      order: Math.floor(num(o.order, index)),
      sourceBone: source,
      mixRotation: clamp01(num(o.mixRotate, 1)),
      mixTranslation: (mixX + mixY) / 2,
    })
  }

  for (const [index, raw] of arr(doc.path).entries()) {
    const o = obj(raw)
    if (o === null) continue
    const chain = idsOf(o.bones)
    const target = typeof o.target === 'string' ? o.target : ''
    const points = paths.get(target)
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
    })
  }

  for (const raw of arr(doc.physics)) {
    add(ctx, 'warning', 'W_PHYSICS_SKIPPED', 'physics', 'physics 约束读入但不求解（二级物理走独立模块）', 'keep', raw)
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
  const order = slotNames.map((_, i) => i)
  for (const raw of arr(offsets)) {
    const o = obj(raw)
    if (o === null) continue
    const slot = typeof o.slot === 'string' ? slotNames.indexOf(o.slot) : num(o.slot, -1)
    const offset = num(o.offset)
    if (slot < 0 || slot >= slotNames.length || !Number.isInteger(offset)) {
      add(ctx, 'warning', 'W_DRAWORDER_DUP', path, 'drawOrder 偏移非法，已忽略', 'skip', raw)
      continue
    }
    const idx = order.indexOf(slot)
    if (idx < 0) continue
    order.splice(idx, 1)
    const target = Math.max(0, Math.min(order.length, idx + offset))
    order.splice(target, 0, slot)
  }
  return completeOrder(order, slotNames.length)
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
        const keys: ScalarKey[] = arr(ch.rotate).map((raw) => {
          const k = obj(raw) ?? {}
          const time = num(k.time)
          duration = Math.max(duration, time)
          // 目标相对 setup；720° 不 wrap，保留连续角。
          const value = num(k.angle) * DEG - sk.setupLocal[base + 2]!
          return { time, value }
        })
        timelines.push({ kind: 'rotate', path: boneName, keys })
      }
      if (arr(ch.translate).length > 0) {
        for (const axis of ['x', 'y'] as const) {
          const keys: ScalarKey[] = arr(ch.translate).map((raw) => {
            const k = obj(raw) ?? {}
            const time = num(k.time)
            duration = Math.max(duration, time)
            const channel = axis === 'x' ? base + 0 : base + 1
            const absolute = axis === 'x' ? num(k.x) * ctx.unitScale : -num(k.y) * ctx.unitScale
            return { time, value: absolute - sk.setupLocal[channel]! }
          })
          timelines.push({ kind: 'translate', path: `${boneName}.${axis}`, keys })
        }
      }
      if (arr(ch.scale).length > 0) {
        for (const [axis, channel] of [['sx', base + 3], ['sy', base + 4]] as const) {
          const keys: ScalarKey[] = arr(ch.scale).map((raw) => {
            const k = obj(raw) ?? {}
            const time = num(k.time)
            duration = Math.max(duration, time)
            const absolute = num(k[axis === 'sx' ? 'x' : 'y'], 1)
            return { time, value: absolute / sk.setupLocal[channel]! }
          })
          timelines.push({ kind: 'scale', path: `${boneName}.${axis}`, keys })
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
        const keys: ScalarKey[] = arr(ch.attachment).map((raw) => {
          const k = obj(raw) ?? {}
          const time = num(k.time)
          duration = Math.max(duration, time)
          const label = typeof k.name === 'string' ? k.name : ''
          return { time, value: attIndex.get(label) ?? 0 }
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
    // deform：vertices 是顶点偏移；目标 Timeline 以标量通道承载，保留首分量作确定性采样值。
    for (const skinDeform of Object.values(obj(a.deform) ?? {})) {
      for (const [slotName, rawSlotDeform] of Object.entries(obj(skinDeform) ?? {})) {
        const slotIndex = slotNames.indexOf(slotName)
        if (slotIndex < 0) continue
        for (const [attName, rawKeys] of Object.entries(obj(rawSlotDeform) ?? {})) {
          const keys: ScalarKey[] = arr(rawKeys).map((raw) => {
            const k = obj(raw) ?? {}
            const time = num(k.time)
            duration = Math.max(duration, time)
            const offsets = arr(k.vertices)
            return { time, value: offsets.length > 0 ? num(offsets[0]) : 0 }
          })
          if (keys.length > 0) timelines.push({ kind: 'deform', path: `${slotIndex}.${attName}`, keys })
        }
      }
    }
    // ik timeline：按约束名索引，mix 作为标量通道。
    for (const [constraintName, rawKeys] of Object.entries(obj(a.ik) ?? {})) {
      const keys: ScalarKey[] = arr(rawKeys).map((raw) => {
        const k = obj(raw) ?? {}
        const time = num(k.time)
        duration = Math.max(duration, time)
        return { time, value: clamp01(num(k.mix, 1)) }
      })
      if (keys.length > 0) timelines.push({ kind: 'ik', path: constraintName, keys })
    }
    // 事件。
    const eventKeys = arr(a.events).map((raw) => {
      const k = obj(raw) ?? {}
      const time = num(k.time)
      duration = Math.max(duration, time)
      return { time, name: typeof k.name === 'string' ? k.name : '' }
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
            const absolute = axis === 'x' ? num(frame.x) * ctx.unitScale : -num(frame.y) * ctx.unitScale
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
  options?: { unitScale?: number; defaultSkin?: string; atlas?: AtlasData },
): SkeletonAsset {
  const doc = obj(json)
  if (doc === null) throw new Error('E_SCHEMA: spine JSON 必须是对象')
  const skeletonMeta = obj(doc.skeleton)
  if (skeletonMeta === null) throw new Error('E_SCHEMA: spine.skeleton 缺失')
  const version = typeof skeletonMeta.spine === 'string' ? skeletonMeta.spine : ''
  if (!/^4\./.test(version)) throw new Error(`E_VERSION: ${version || '(missing)'}`)

  const ctx: Ctx = {
    source: 'spine',
    unitScale: 0.01,
    issues: [],
    atlas: collectAtlas(doc, 'spine'),
    atlasData: options?.atlas ?? null,
    masks: [],
  }
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
          if (attachments.has(attName)) {
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
          attachments.set(attName, built)
          if (built.kind === 'clipping' && attObj !== null) {
            addClippingMask(ctx, slots, slot.name, attName, attObj, built.polygon)
          }
        }
      }
    }
    skins.set(name, { id: name, attachments })
  }
  // 只负责校验/报告默认皮肤；运行时由 createSlotSet 选用。
  pickDefaultSkin(skins, options?.defaultSkin, ctx)

  const constraints = readSpineConstraints(doc, skeleton, skins, ctx)
  const maskLibrary: MaskLibrary | undefined = ctx.masks.length > 0
    ? Object.freeze({ version: 1 as const, masks: Object.freeze(ctx.masks.slice()) })
    : undefined

  const attIndex = attachmentIndex(skins)
  const { animations, events } = readSpineAnimations(doc.animations, skeleton, slotNames, attIndex, ctx)
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
  options?: { unitScale?: number; defaultSkin?: string; atlas?: AtlasData },
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
    unitScale: 0.01,
    issues: [],
    atlas: collectAtlas(doc, 'dragonbones'),
    atlasData: options?.atlas ?? null,
    masks: [],
  }
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
