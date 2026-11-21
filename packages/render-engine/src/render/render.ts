/** M4 渲染包契约：定义 RenderPacket/RenderFrame，并提供构建、排序、合批与描边边表工具。 */

export type PacketKind = 'region' | 'mesh' | 'clipping' | 'outline'
export type BlendMode = 'normal' | 'add' | 'multiply' | 'screen'

/** 帧与后端之间唯一的绘制数据契约。顶点为 world 空间，颜色为 PMA 字节。 */
export interface RenderPacket {
  readonly id: number
  readonly kind: PacketKind
  readonly version: 1
  readonly positions: Float32Array
  readonly uvs: Float32Array
  readonly colors: Uint8Array
  readonly depth: Float32Array | null
  readonly indices: Uint16Array | Uint32Array
  readonly materialId: number
  /** 可选：图集页索引；缺省时由材质决定，便于诊断与无材质快速路径。 */
  readonly page?: number
  readonly blend: BlendMode
  readonly maskPath: number
  readonly order: number
  readonly depthKey: number
  readonly subOrder: number
  readonly seq: number
}

export type RenderFrame = {
  readonly packets: readonly RenderPacket[]
  readonly width: number
  readonly height: number
  readonly viewProjection?: Float32Array
  /** 纹理页与材质库；缺省时后端按纯顶点色（flat）绘制，兼容旧帧。 */
  readonly assets?: RenderAssets
  /** mask 路径树；packet.maskPath 指向其中节点。 */
  readonly maskPaths?: readonly MaskPathNode[]
  /** 本帧已变换的 mask 几何，与 maskPaths 的 maskId 对齐。 */
  readonly masks?: RenderMaskSet
  /** 深度模式：2D 默认 'none'；'test' 只测不写；'write' 测试并写入。 */
  readonly depthMode?: 'none' | 'test' | 'write'
}

/** CPU/GPU 共用的图集页：RGBA8 字节，pma 缺省视为 true。 */
export type TextureData = {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
  readonly pma?: boolean
}

/** 材质是资产的不可变描述；id 在材质库内唯一。 */
export type MaterialDef = {
  readonly id: number
  readonly kind: 'flat' | 'sprite'
  /** sprite 指向图集页；flat 为 -1。 */
  readonly page: number
  readonly filter: 'linear' | 'nearest'
}

/** 后端 prepare() 的输入：页纹理 + 材质；最多 4 页。 */
export type RenderAssets = {
  readonly pages: readonly TextureData[]
  readonly materials: readonly MaterialDef[]
  readonly maxTexturePages?: number
}

/** mask 路径树节点：parent = -1 为根，沿 parent 组成外层→内层链。 */
export type MaskPathNode = {
  readonly maskId: number
  readonly parent: number
}

export type MaskBounds = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** 帧级 mask 几何；scissor 只读 bounds，stencil 读 positions/indices，alpha 读 alpha 页。 */
export type RenderMask = {
  readonly id: number
  readonly mode: 'scissor' | 'stencil' | 'alpha'
  readonly invert: boolean
  readonly feather: number
  readonly positions: Float32Array
  readonly indices: Uint32Array
  readonly bounds: MaskBounds
  readonly alpha?: { readonly page: number; readonly uvMatrix: Float32Array }
}

export type RenderMaskSet = {
  readonly version: number
  readonly masks: readonly (RenderMask | null)[]
}


/** 图集矩形（像素单位，左上角原点）与页尺寸。 */
export type AtlasRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export type AtlasPage = { readonly width: number; readonly height: number }
export interface AtlasRegionRef {
  readonly rect: AtlasRect
  readonly page: AtlasPage
}

export interface BuildPacketArgs {
  readonly id: number
  /** world 空间顶点，x/y 交错（stride=2） */
  readonly positions: Float32Array
  /** 附件局部归一化 UV；省略时按四边形默认值生成 */
  readonly uvs?: Float32Array
  /** 直通 RGBA，0..1；pma=true 时视为已预乘 */
  readonly color: readonly [number, number, number, number]
  readonly materialId: number
  /** 可选图集页索引；缺省时后端按材质查页。 */
  readonly page?: number
  readonly order: number
  readonly depthKey: number
  readonly maskPath?: number
  readonly seq?: number
  readonly subOrder?: number
  readonly blend?: BlendMode
  readonly kind?: PacketKind
  readonly pma?: boolean
  /** 提供后把局部 UV 映射到图集页（半 texel 内缩） */
  readonly region?: AtlasRegionRef
}

export interface BuildMeshPacketArgs extends BuildPacketArgs {
  readonly indices: Uint16Array | Uint32Array
  readonly depth?: Float32Array | null
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

/** 直通色转预乘 alpha（0..1 浮点），只做一次乘法。 */
export function toPma(rgba: readonly [number, number, number, number]): [number, number, number, number] {
  const a = clamp01(rgba[3])
  return [clamp01(rgba[0]) * a, clamp01(rgba[1]) * a, clamp01(rgba[2]) * a, a]
}

/** 按引擎约定舍入：+0.5 截断，保证 CPU/GPU 参考实现一致。 */
function toByte(v: number): number {
  return Math.min(255, Math.max(0, Math.floor(clamp01(v) * 255 + 0.5)))
}

function colorBytes(color: readonly [number, number, number, number], pma: boolean): Uint8Array {
  const a = clamp01(color[3])
  const r = pma ? clamp01(color[0]) : clamp01(color[0]) * a
  const g = pma ? clamp01(color[1]) : clamp01(color[1]) * a
  const b = pma ? clamp01(color[2]) : clamp01(color[2]) * a
  return new Uint8Array([toByte(r), toByte(g), toByte(b), toByte(a)])
}

function fillColors(vertexCount: number, bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(vertexCount * 4)
  for (let i = 0; i < vertexCount; i += 1) {
    const o = i * 4
    out[o] = bytes[0]!
    out[o + 1] = bytes[1]!
    out[o + 2] = bytes[2]!
    out[o + 3] = bytes[3]!
  }
  return out
}

/** 图集 UV：四角内缩半 texel，避免双线性采到相邻 region。 */
export function atlasRegionUv(
  rect: AtlasRect,
  page: AtlasPage,
): { u0: number; v0: number; u1: number; v1: number } {
  const inset = 0.5
  const w = page.width > 0 ? page.width : 1
  const h = page.height > 0 ? page.height : 1
  return {
    u0: (rect.x + inset) / w,
    v0: (rect.y + inset) / h,
    u1: (rect.x + rect.width - inset) / w,
    v1: (rect.y + rect.height - inset) / h,
  }
}

function defaultUvs(vertexCount: number): Float32Array {
  if (vertexCount === 4) return new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
  const out = new Float32Array(vertexCount * 2)
  const denom = Math.max(1, vertexCount - 1)
  for (let i = 0; i < vertexCount; i += 1) out[i * 2] = i / denom
  return out
}

/** 局部 UV → 图集页 UV；v 保持向下约定。 */
function mapRegionUvs(uvs: Float32Array, region: AtlasRegionRef): Float32Array {
  const uv = atlasRegionUv(region.rect, region.page)
  const du = uv.u1 - uv.u0
  const dv = uv.v1 - uv.v0
  const out = new Float32Array(uvs.length)
  for (let i = 0; i + 1 < uvs.length; i += 2) {
    out[i] = uv.u0 + uvs[i]! * du
    out[i + 1] = uv.v0 + uvs[i + 1]! * dv
  }
  return out
}

/** 四边形用两个三角形，其余顶点数用扇形三角化。 */
function fanIndices(vertexCount: number): Uint16Array | Uint32Array {
  if (vertexCount === 4) return new Uint16Array([0, 1, 2, 0, 2, 3])
  const count = vertexCount >= 3 ? (vertexCount - 2) * 3 : 0
  const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array
  const out = new IndexArray(count)
  let cursor = 0
  for (let i = 1; i + 1 < vertexCount; i += 1) {
    out[cursor++] = 0
    out[cursor++] = i
    out[cursor++] = i + 1
  }
  return out
}

/** 区域 packet：world 空间四边形/扇形几何 + 一次烘焙的 PMA 顶点色。 */
export function buildRegionPacket(args: BuildPacketArgs): RenderPacket {
  const vertexCount = Math.floor(args.positions.length / 2)
  const sourceUvs = args.uvs ?? defaultUvs(vertexCount)
  const uvs = args.region ? mapRegionUvs(sourceUvs, args.region) : new Float32Array(sourceUvs)
  return {
    id: args.id,
    kind: args.kind ?? 'region',
    version: 1,
    positions: args.positions,
    uvs,
    colors: fillColors(vertexCount, colorBytes(args.color, args.pma === true)),
    depth: null,
    indices: fanIndices(vertexCount),
    materialId: args.materialId,
    ...(args.page !== undefined ? { page: args.page } : {}),
    blend: args.blend ?? 'normal',
    maskPath: args.maskPath ?? 0,
    order: args.order,
    depthKey: args.depthKey,
    subOrder: args.subOrder ?? 0,
    seq: args.seq ?? 0,
  }
}

/** 网格 packet：与区域 packet 相同，但显式给出 indices 与可选逐顶点深度。 */
export function buildMeshPacket(args: BuildMeshPacketArgs): RenderPacket {
  const vertexCount = Math.floor(args.positions.length / 2)
  const sourceUvs = args.uvs ?? defaultUvs(vertexCount)
  const uvs = args.region ? mapRegionUvs(sourceUvs, args.region) : new Float32Array(sourceUvs)
  return {
    id: args.id,
    kind: args.kind ?? 'mesh',
    version: 1,
    positions: args.positions,
    uvs,
    colors: fillColors(vertexCount, colorBytes(args.color, args.pma === true)),
    depth: args.depth ?? null,
    indices: args.indices,
    materialId: args.materialId,
    ...(args.page !== undefined ? { page: args.page } : {}),
    blend: args.blend ?? 'normal',
    maskPath: args.maskPath ?? 0,
    order: args.order,
    depthKey: args.depthKey,
    subOrder: args.subOrder ?? 0,
    seq: args.seq ?? 0,
  }
}

function comparePackets(a: RenderPacket, b: RenderPacket): number {
  return a.order - b.order || a.depthKey - b.depthKey || a.subOrder - b.subOrder || a.seq - b.seq
}

/** 全升序稳定排序；seq 之后再用原始下标兜底，不依赖引擎 sort 的稳定性。 */
export function sortPackets(packets: readonly RenderPacket[]): RenderPacket[] {
  const decorated = packets.map((packet, index) => ({ packet, index }))
  decorated.sort((a, b) => comparePackets(a.packet, b.packet) || a.index - b.index)
  return decorated.map((entry) => entry.packet)
}

/** 合批键：材质 / 混合 / mask / 索引宽度 / packet 种类。 */
export function batchKey(p: RenderPacket): string {
  const indexType = p.indices instanceof Uint32Array ? 32 : 16
  return `${p.materialId}|${p.blend}|${p.maskPath}|${indexType}|${p.kind}`
}

/** 图集页数合法范围：1..4（flat 角色也至少有一页占位）。 */
export function validateAtlasPages(pages: number): boolean {
  return Number.isInteger(pages) && pages >= 1 && pages <= 4
}

/** maskPath 为非负整数，0 表示无 mask。 */
export function validateMaskPath(path: number): boolean {
  return Number.isInteger(path) && path >= 0
}

interface EdgeRecord {
  readonly a: number
  readonly b: number
  count: number
}

/** 三角网格的剪影边：共享边去重后只保留单三角形使用的边（内部边不描）。 */
export function outlineEdges(indices: Uint16Array | Uint32Array): Array<[number, number]> {
  const edges = new Map<string, EdgeRecord>()
  const add = (x: number, y: number): void => {
    if (x === y) return
    const a = Math.min(x, y)
    const b = Math.max(x, y)
    const key = `${a},${b}`
    const found = edges.get(key)
    if (found !== undefined) found.count += 1
    else edges.set(key, { a, b, count: 1 })
  }
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const i0 = indices[i]!
    const i1 = indices[i + 1]!
    const i2 = indices[i + 2]!
    add(i0, i1)
    add(i1, i2)
    add(i2, i0)
  }
  const out: Array<[number, number]> = []
  for (const edge of edges.values()) {
    if (edge.count === 1) out.push([edge.a, edge.b])
  }
  out.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  return out
}

// —— M10：纹理采样、资产校验与 mask 路径 ——

/** 与后端一致的 8 位乘法舍入：(a*b + 127) / 255，向下取整。 */
const mulU8 = (a: number, b: number): number => (((a * b + 127) / 255) | 0)

/** 0..255 浮点值按 +0.5 截断，保证 CPU/GPU 参考实现一致。 */
function roundByte(v: number): number {
  return Math.min(255, Math.max(0, Math.floor(v + 0.5)))
}

/**
 * 采样一页 RGBA8 纹理，返回 0..255 的 PMA 字节。
 * - v 向下，UV 先 clamp 到 [0,1]；
 * - nearest 用 floor 命中 texel；
 * - linear 在 texel 中心之间双线性插值；
 * - pma === false 时逐 texel 预乘后再插值，避免边缘串色。
 */
export function sampleTexture(
  page: TextureData,
  u: number,
  v: number,
  filter: 'linear' | 'nearest',
): [number, number, number, number] {
  const w = Math.max(1, Math.floor(page.width))
  const h = Math.max(1, Math.floor(page.height))
  const data = page.data
  const premultiply = page.pma === false

  const read = (x: number, y: number): [number, number, number, number] => {
    const cx = x < 0 ? 0 : x >= w ? w - 1 : x
    const cy = y < 0 ? 0 : y >= h ? h - 1 : y
    const o = (cy * w + cx) * 4
    const r = data[o] ?? 0
    const g = data[o + 1] ?? 0
    const b = data[o + 2] ?? 0
    const a = data[o + 3] ?? 0
    if (!premultiply) return [r, g, b, a]
    return [mulU8(r, a), mulU8(g, a), mulU8(b, a), a]
  }

  const cu = clamp01(u)
  const cv = clamp01(v)

  if (filter === 'nearest') {
    const ix = Math.min(w - 1, Math.floor(cu * w))
    const iy = Math.min(h - 1, Math.floor(cv * h))
    return read(ix, iy)
  }

  // texel 中心位于 (i+0.5)/size；先换算到“中心坐标系”再插值。
  const fx = cu * w - 0.5
  const fy = cv * h - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const c00 = read(x0, y0)
  const c10 = read(x0 + 1, y0)
  const c01 = read(x0, y0 + 1)
  const c11 = read(x0 + 1, y0 + 1)
  const out: [number, number, number, number] = [0, 0, 0, 0]
  for (let i = 0; i < 4; i += 1) {
    const top = c00[i]! * (1 - tx) + c10[i]! * tx
    const bottom = c01[i]! * (1 - tx) + c11[i]! * tx
    out[i] = roundByte(top * (1 - ty) + bottom * ty)
  }
  return out
}

/** 校验资产：页数 1..4、纹理长度、材质 id 唯一与 sprite 页引用。 */
export function validateAssets(assets: RenderAssets): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const pages = assets.pages
  const maxPages = assets.maxTexturePages ?? 4

  if (pages.length < 1) errors.push('纹理页数量必须至少为 1')
  if (pages.length > 4) errors.push('纹理页数量超过引擎上限 4')
  if (pages.length > maxPages) errors.push(`纹理页数量 ${pages.length} 超过 maxTexturePages=${maxPages}`)

  pages.forEach((page, index) => {
    if (!Number.isInteger(page.width) || page.width <= 0) {
      errors.push(`纹理页 ${index} 宽度必须为正整数`)
    }
    if (!Number.isInteger(page.height) || page.height <= 0) {
      errors.push(`纹理页 ${index} 高度必须为正整数`)
    }
    const need = Math.max(0, Math.floor(page.width)) * Math.max(0, Math.floor(page.height)) * 4
    if (page.data.length !== need) {
      errors.push(`纹理页 ${index} 数据长度 ${page.data.length} 应为 ${need}（w*h*4）`)
    }
    if (page.pma === false) warnings.push(`纹理页 ${index} 未预乘 alpha`)
  })

  const ids = new Set<number>()
  for (const material of assets.materials) {
    if (!Number.isInteger(material.id) || material.id < 0) {
      errors.push(`材质 id ${material.id} 必须为非负整数`)
    }
    if (ids.has(material.id)) errors.push(`材质 id ${material.id} 重复`)
    ids.add(material.id)
    if (material.kind === 'sprite') {
      if (!Number.isInteger(material.page) || material.page < 0 || material.page >= pages.length) {
        errors.push(`材质 ${material.id} 引用了不存在的纹理页 ${material.page}`)
      }
    } else if (material.page !== -1 && (material.page < 0 || material.page >= pages.length)) {
      errors.push(`材质 ${material.id} 的 flat 页号应为 -1`)
    }
  }
  if (assets.materials.length === 0) warnings.push('材质库为空')

  return { errors, warnings }
}

/**
 * 沿 parent 从根到内层返回 maskId 链。
 * path = -1 表示无 mask；越界/循环/超过 8 层返回空链并标记 error。
 */
export function maskChain(
  path: number,
  maskPaths: readonly MaskPathNode[],
): { ids: number[]; error: boolean } {
  if (path === -1) return { ids: [], error: false }
  if (!Number.isInteger(path) || path < 0 || path >= maskPaths.length) {
    return { ids: [], error: true }
  }
  const ids: number[] = []
  const seen = new Set<number>()
  let cursor = path
  while (cursor !== -1) {
    if (!Number.isInteger(cursor) || cursor < 0 || cursor >= maskPaths.length) {
      return { ids: [], error: true }
    }
    if (seen.has(cursor)) return { ids: [], error: true }
    if (ids.length >= 8) return { ids: [], error: true }
    seen.add(cursor)
    ids.push(maskPaths[cursor]!.maskId)
    cursor = maskPaths[cursor]!.parent
  }
  ids.reverse()
  return { ids, error: false }
}

/**
 * 校验 mask 路径树：每个父必须小于自身下标（保证无环），链深最多 8 层，
 * maskId 为非负整数。
 */
export function validateMaskPaths(maskPaths: readonly MaskPathNode[]): boolean {
  for (let i = 0; i < maskPaths.length; i += 1) {
    const node = maskPaths[i]!
    if (!Number.isInteger(node.maskId) || node.maskId < 0) return false
    if (!Number.isInteger(node.parent)) return false
    if (node.parent < -1 || node.parent >= i) return false
  }
  // parent < 自身下标已排除环，这里只再检查链深上限。
  for (let i = 0; i < maskPaths.length; i += 1) {
    let depth = 0
    let cursor = i
    while (cursor !== -1) {
      depth += 1
      if (depth > 8) return false
      cursor = maskPaths[cursor]!.parent
    }
  }
  return true
}

/** 把一组激活 mask 打包成帧级 mask 集。 */
export function buildMaskSet(masks: readonly RenderMask[]): RenderMaskSet {
  return { version: 1, masks: masks.slice() }
}

