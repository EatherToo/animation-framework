/**
 * M11 图集导入：Spine `.atlas`（libgdx 风格）文本 → core2d 只读 AtlasData。
 * 权威：docs/08-渲染/atlas.md、docs/11-资产/spine.md §7。
 *
 * 约定：
 * - 页数上限 4；超过直接抛带 code 的错误，不静默截断。
 * - v1 不保留 rotate 字段；rotate 90/180/270 在导入期通过重排 UV 矩阵消除。
 * - UV 矩阵列主序 [a,b,c,d,tx,ty]：u_page = a·u + c·v + tx，v_page = b·u + d·v + ty。
 * - 当前 uvMatrix 对齐 Spine 官方 trim/rotate 语义；半 texel/padding/bleed 由上层策略控制。
 * - 输出对象冻结顶层；同一输入 hash 稳定。
 */

/** 页图像：浏览器可给 ImageBitmap/HTMLImageElement，Node/测试给 RGBA8 字节。 */
export type AtlasImage = {
  readonly width: number
  readonly height: number
  readonly data?: Uint8Array
}

/** 图集页定义；options.pages 可补齐文本里缺失的页尺寸/图像。 */
export type AtlasPageDef = {
  readonly index: number
  /** 导入器生成的页必有名称；旧调用方手工创建的页可以省略。 */
  readonly name?: string
  readonly width: number
  readonly height: number
  readonly format?: string
  readonly minFilter?: AtlasFilter
  readonly magFilter?: AtlasFilter
  readonly uWrap?: AtlasWrap
  readonly vWrap?: AtlasWrap
  readonly pma?: boolean
  readonly image?: AtlasImage
}

export type AtlasFilter = 'Nearest' | 'Linear' | 'MipMap' | 'MipMapNearestNearest' |
  'MipMapLinearNearest' | 'MipMapNearestLinear' | 'MipMapLinearLinear'
export type AtlasWrap = 'ClampToEdge' | 'Repeat'

/** Ninepatch inset order follows the Spine atlas format. */
export type AtlasNinePatchInsets = {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/** 单个 region：页内像素矩形 + 附件局部 UV → 页 UV 的仿射。 */
export type AtlasRegion = {
  readonly id: string
  readonly page: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly uvMatrix: Float32Array
  readonly trim: {
    readonly offsetX: number
    readonly offsetY: number
    readonly sourceWidth: number
    readonly sourceHeight: number
  }
  /** Ninepatch splits measured from original image edges. */
  readonly split?: AtlasNinePatchInsets
  /** Ninepatch content padding measured from original image edges. */
  readonly pad?: AtlasNinePatchInsets
  readonly maxMip: number
}

/** 图集资产：页、region 表与全局约定。 */
export type AtlasData = {
  readonly format: 'dsh-2d-atlas'
  readonly version: number
  readonly hash: string
  readonly pages: readonly AtlasPageDef[]
  readonly regions: ReadonlyMap<string, AtlasRegion>
  /** @deprecated 页级 PMA 请读取 pages[n].pma；此字段只反映首页以兼容旧调用方。 */
  readonly pma: boolean
  readonly colorSpace: 'srgb'
  readonly padding: number
  readonly bleed: number
  readonly source: 'file' | 'procedural'
}

export type AtlasImportOptions = {
  /** 旧 API 允许只给 index/width/height；带 name 时按页名绑定图片。 */
  readonly pages?: readonly (Pick<AtlasPageDef, 'index' | 'width' | 'height'> & Partial<AtlasPageDef>)[]
  readonly padding?: number
  readonly bleed?: number
}

type AtlasError = Error & { code: string }

const MAX_PAGES = 4
const HALF_TEXEL = 0.5
const HEADER_KEYS = new Set(['size', 'format', 'filter', 'repeat', 'pma', 'scale'])
const REGION_KEYS = new Set(['bounds', 'xy', 'size', 'offsets', 'orig', 'offset', 'rotate', 'pad', 'split', 'index'])
const FILTERS = new Set<AtlasFilter>([
  'Nearest', 'Linear', 'MipMap', 'MipMapNearestNearest', 'MipMapLinearNearest',
  'MipMapNearestLinear', 'MipMapLinearLinear',
])

function parseFilter(value: string): AtlasFilter {
  if (!FILTERS.has(value as AtlasFilter)) fail('E_ATLAS_FILTER', `不支持的 filter：${value}`)
  return value as AtlasFilter
}

/** 统一错误出口：message 带 code，同时挂到 error.code 便于调用方分支。 */
function fail(code: string, message: string): never {
  const error = new Error(`${code}: ${message}`) as AtlasError
  error.code = code
  throw error
}

function isIndented(line: string): boolean {
  return line.length > 0 && (line[0] === ' ' || line[0] === '\t')
}

function splitField(line: string): { key: string; value: string } | null {
  const colon = line.indexOf(':')
  if (colon <= 0) return null
  return { key: line.slice(0, colon).trim().toLowerCase(), value: line.slice(colon + 1).trim() }
}

function numberList(value: string, code: string, what: string): number[] {
  const parts = value.split(/[, ]+/).filter((part) => part.length > 0)
  const out = parts.map((part) => Number(part))
  if (out.length === 0 || out.some((n) => !Number.isFinite(n))) fail(code, `${what} 不是合法数字列表`)
  return out
}

function parseInsets(value: string | undefined, name: string, key: string): AtlasNinePatchInsets | undefined {
  if (value === undefined) return undefined
  const values = numberList(value, 'E_ATLAS_REGION', `region ${name}.${key}`)
  if (values.length !== 4 || values.some((n) => !Number.isInteger(n))) {
    fail('E_ATLAS_REGION', `region ${name}.${key} 需要四个整数 (left,right,top,bottom)`)
  }
  return Object.freeze({ left: values[0]!, right: values[1]!, top: values[2]!, bottom: values[3]! })
}

/** rotate 只接受 0/90/180/270；Spine 的 true 等价 90。 */
function parseRotate(value: string | undefined): 0 | 90 | 180 | 270 {
  if (value === undefined || value.length === 0 || value === 'false') return 0
  if (value === 'true') return 90
  const n = Number(value)
  if (!Number.isFinite(n)) fail('E_ATLAS_ROTATE', `rotate 非法：${value}`)
  const normalized = ((Math.round(n) % 360) + 360) % 360
  if (normalized !== 0 && normalized !== 90 && normalized !== 180 && normalized !== 270) {
    fail('E_ATLAS_ROTATE', `rotate 只支持 90 的整数倍：${value}`)
  }
  return normalized as 0 | 90 | 180 | 270
}

/**
 * 生成局部 0..1 → 页 UV 的矩阵。对齐官方 trim/rotate 语义：
 * 90 交换轴，180 双轴反向，270 交换并双轴反向；数据模型不再保留 rotate。
 */
function uvMatrixOf(
  x: number,
  y: number,
  width: number,
  height: number,
  rotate: 0 | 90 | 180 | 270,
  pageWidth: number,
  pageHeight: number,
  offsetX = 0,
  offsetY = 0,
  originalWidth = width,
  originalHeight = height,
): Float32Array {
  const w = Math.max(1, pageWidth)
  const h = Math.max(1, pageHeight)
  // 对齐官方 TextureAtlas/Attachment.computeUVs：trim 后的 0..1 覆盖原尺寸图。
  const sx = offsetX / w
  const sy = offsetY / h
  if (rotate === 90 || rotate === 270) {
    const su = Math.max(0, originalWidth) / h
    const sv = Math.max(0, originalHeight) / w
    const exW = (originalWidth - offsetX - width) / h
    const exH = (originalHeight - offsetY - height) / w
    if (rotate === 90) {
      // pageU = u0 + y·sv；pageV = v0 + (1-x)·su
      return new Float32Array([0, -su, sv, 0, x / w - exH, y / h - exW + su])
    }
    // pageU = u0 + (1-y)·sv；pageV = v0 + x·su
    return new Float32Array([0, su, -sv, 0, x / w - sy + sv, y / h - sx])
  }
  const su = Math.max(0, originalWidth) / w
  const sv = Math.max(0, originalHeight) / h
  const exW = (originalWidth - offsetX - width) / w
  const exH = (originalHeight - offsetY - height) / h
  if (rotate === 180) {
    // pageU = u0 + (1-x)·su；pageV = v0 + (1-y)·sv
    return new Float32Array([-su, 0, 0, -sv, x / w - exW + su, y / h - sy + sv])
  }
  // pageU = u0 + x·su；pageV = v0 + y·sv
  return new Float32Array([su, 0, 0, sv, x / w - sx, y / h - exH])
}

/** mip 上限：region 与页尺寸共同约束，至少 0。 */
function maxMipOf(width: number, height: number, pageWidth: number, pageHeight: number): number {
  const side = Math.min(width, height, pageWidth, pageHeight)
  if (side < 2) return 0
  return Math.max(0, Math.floor(Math.log2(side)) - 1)
}

/** FNV-1a 64 位；只做稳定内容键，不承担加密职责。 */
function fnv1a(text: string): string {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

/** 解析 Spine `.atlas` 文本；页数/尺寸/region 非法时抛带 code 的错误。 */
export function importSpineAtlas(text: string, options?: AtlasImportOptions): AtlasData {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const padding = options?.padding ?? 4
  const bleed = options?.bleed ?? 2
  if (!Number.isFinite(padding) || padding < 0) fail('E_ATLAS_PARSE', 'padding 必须是非负数')
  if (!Number.isFinite(bleed) || bleed < 0) fail('E_ATLAS_PARSE', 'bleed 必须是非负数')

  const pages: AtlasPageDef[] = []
  const regions = new Map<string, AtlasRegion>()
  const namedPages = new Map<string, NonNullable<AtlasImportOptions['pages']>[number]>()
  for (const supplied of options?.pages ?? []) {
    if (supplied.name === undefined) continue
    if (namedPages.has(supplied.name)) fail('E_ATLAS_PAGE', `重复的图片页名：${supplied.name}`)
    namedPages.set(supplied.name, supplied)
  }
  let cursor = 0

  const skipBlank = (): void => {
    while (cursor < lines.length && lines[cursor]!.trim() === '') cursor += 1
  }

  while (cursor < lines.length) {
    skipBlank()
    if (cursor >= lines.length) break

    const pageIndex = pages.length
    if (pageIndex >= MAX_PAGES) fail('E_ATLAS_PAGES', `图集页数超过 ${MAX_PAGES}`)

    let imageName: string | null = null
    let width: number | null = null
    let height: number | null = null
    let format: string | undefined
    let minFilter: AtlasFilter = 'Nearest'
    let magFilter: AtlasFilter = 'Nearest'
    let uWrap: AtlasWrap = 'ClampToEdge'
    let vWrap: AtlasWrap = 'ClampToEdge'
    let pagePma = false

    // 页头：第一行通常是图片路径；其后是 size/format/filter/repeat/pma。
    while (cursor < lines.length) {
      const raw = lines[cursor]!
      if (raw.trim() === '') break
      const field = splitField(raw.trim())
      if (field === null) {
        if (imageName === null) {
          imageName = raw.trim()
          cursor += 1
          continue
        }
        break
      }
      // 官方 atlas 用 tab 缩进 size/filter 等页头字段；不能把缩进当区域行跳过。
      if (!HEADER_KEYS.has(field.key)) break
      if (field.key === 'pma') pagePma = field.value === 'true'
      if (field.key === 'format') format = field.value
      if (field.key === 'filter') {
        const filters = field.value.split(',').map((value) => value.trim())
        if (filters.length !== 2) fail('E_ATLAS_FILTER', 'filter 需要 min,mag')
        minFilter = parseFilter(filters[0]!)
        magFilter = parseFilter(filters[1]!)
      }
      if (field.key === 'repeat') {
        const repeat = field.value.toLowerCase()
        if (!['none', 'x', 'y', 'xy'].includes(repeat)) fail('E_ATLAS_REPEAT', `不支持的 repeat：${field.value}`)
        uWrap = repeat.includes('x') ? 'Repeat' : 'ClampToEdge'
        vWrap = repeat.includes('y') ? 'Repeat' : 'ClampToEdge'
      }
      if (field.key === 'size') {
        const values = numberList(field.value, 'E_ATLAS_SIZE', 'size')
        if (values.length < 2) fail('E_ATLAS_SIZE', 'size 需要 width,height')
        width = values[0]!
        height = values[1]!
      }
      cursor += 1
    }

    const provided = (imageName === null ? undefined : namedPages.get(imageName)) ??
      options?.pages?.find((page) => page.name === undefined && page.index === pageIndex) ??
      (options?.pages?.[pageIndex]?.name === undefined ? options?.pages?.[pageIndex] : undefined)
    if (namedPages.size > 0 && provided === undefined && imageName !== null) {
      fail('E_TEXTURE_MISSING', `图集页 ${pageIndex}（${imageName}）没有对应的命名图片页`)
    }
    const pageWidth = width ?? provided?.width
    const pageHeight = height ?? provided?.height
    if (pageWidth === undefined || pageHeight === undefined || pageWidth <= 0 || pageHeight <= 0) {
      fail('E_ATLAS_SIZE', `第 ${pageIndex} 页缺少合法 size${imageName === null ? '' : `（${imageName}）`}`)
    }
    const page: AtlasPageDef = {
      index: pageIndex,
      name: imageName ?? provided?.name ?? `page-${pageIndex}`,
      width: Math.floor(pageWidth),
      height: Math.floor(pageHeight),
      ...(format !== undefined ? { format } : {}),
      minFilter, magFilter, uWrap, vWrap, pma: pagePma,
      ...(provided?.image !== undefined ? { image: provided.image } : {}),
    }
    pages.push(Object.freeze(page))

    // region 块：非缩进行是名字，缩进行是字段；空行视为页结束。
    while (cursor < lines.length) {
      if (lines[cursor]!.trim() === '') break
      const rawName = lines[cursor]!
      if (isIndented(rawName)) { cursor += 1; continue }
      const name = rawName.trim()
      cursor += 1

      const fields = new Map<string, string>()
      while (cursor < lines.length) {
        const raw = lines[cursor]!
        if (raw.trim() === '') break
        if (!isIndented(raw)) break
        const field = splitField(raw.trim())
        if (field !== null) {
          if (!REGION_KEYS.has(field.key)) {
            // 未知字段忽略但保留解析容错；不在这里引入警告通道。
          } else {
            fields.set(field.key, field.value)
          }
        }
        cursor += 1
      }

      const boundsRaw = fields.get('bounds')
      const xyRaw = fields.get('xy')
      const sizeRaw = fields.get('size')
      if (boundsRaw === undefined && (xyRaw === undefined || sizeRaw === undefined)) {
        fail('E_ATLAS_REGION', `region ${name} 缺少 bounds 或 xy/size`)
      }
      const bounds = boundsRaw === undefined
        ? [...numberList(xyRaw!, 'E_ATLAS_REGION', `region ${name}.xy`),
          ...numberList(sizeRaw!, 'E_ATLAS_REGION', `region ${name}.size`)]
        : numberList(boundsRaw, 'E_ATLAS_REGION', `region ${name}.bounds`)
      if (bounds.length !== 4) fail('E_ATLAS_REGION', `region ${name} 需要 x,y,width,height`)
      const x = bounds[0]!
      const y = bounds[1]!
      const regionWidth = bounds[2]!
      const regionHeight = bounds[3]!
      if (regionWidth <= 0 || regionHeight <= 0) fail('E_ATLAS_REGION', `region ${name} 尺寸必须为正`)

      let offsetX = 0
      let offsetY = 0
      let sourceWidth = regionWidth
      let sourceHeight = regionHeight
      const offsetsRaw = fields.get('offsets')
      if (offsetsRaw !== undefined) {
        const offsets = numberList(offsetsRaw, 'E_ATLAS_REGION', `region ${name}.offsets`)
        if (offsets.length >= 4) {
          offsetX = offsets[0]!
          offsetY = offsets[1]!
          sourceWidth = offsets[2]!
          sourceHeight = offsets[3]!
        }
      }
      // 兼容 orig/offset 分离写法；offsets 优先。
      const origRaw = fields.get('orig')
      if (origRaw !== undefined) {
        const orig = numberList(origRaw, 'E_ATLAS_REGION', `region ${name}.orig`)
        if (orig.length >= 2) {
          sourceWidth = orig[0]!
          sourceHeight = orig[1]!
        }
      }
      const offsetRaw = fields.get('offset')
      if (offsetRaw !== undefined) {
        const offset = numberList(offsetRaw, 'E_ATLAS_REGION', `region ${name}.offset`)
        if (offset.length >= 2) {
          offsetX = offset[0]!
          offsetY = offset[1]!
        }
      }

      const rotate = parseRotate(fields.get('rotate'))
      const split = parseInsets(fields.get('split'), name, 'split')
      const pad = parseInsets(fields.get('pad'), name, 'pad')
      if (pad !== undefined && split === undefined) fail('E_ATLAS_REGION', `region ${name}.pad 需要 split`)
      if (regions.has(name)) fail('E_ATLAS_REGION', `region ${name} 重名`)
      const region: AtlasRegion = {
        id: name,
        page: pageIndex,
        x,
        y,
        width: regionWidth,
        height: regionHeight,
        uvMatrix: uvMatrixOf(x, y, regionWidth, regionHeight, rotate, page.width, page.height, offsetX, offsetY, sourceWidth, sourceHeight),
        trim: Object.freeze({ offsetX, offsetY, sourceWidth, sourceHeight }),
        ...(split !== undefined ? { split } : {}),
        ...(pad !== undefined ? { pad } : {}),
        maxMip: maxMipOf(regionWidth, regionHeight, page.width, page.height),
      }
      regions.set(name, Object.freeze(region))
    }
  }

  if (pages.length === 0) fail('E_ATLAS_REGION', '没有解析到任何图集页')
  if (pages.length > MAX_PAGES) fail('E_ATLAS_PAGES', `图集页数超过 ${MAX_PAGES}`)

  const signature = [
    ...pages.map((page) => `p${page.index}:${page.name}:${page.width}x${page.height}:${page.image?.width ?? 0}x${page.image?.height ?? 0}:${page.format ?? ''}:${page.minFilter},${page.magFilter}:${page.uWrap},${page.vWrap}:${page.pma}`),
    ...[...regions.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((r) => `${r.id}@${r.page}:${r.x},${r.y},${r.width},${r.height}:${r.trim.offsetX},${r.trim.offsetY},${r.trim.sourceWidth},${r.trim.sourceHeight}:${Array.from(r.uvMatrix).join(',')}:split=${r.split === undefined ? '' : Object.values(r.split).join(',')}:pad=${r.pad === undefined ? '' : Object.values(r.pad).join(',')}`),
  ].join('|')

  const atlas: AtlasData = {
    format: 'dsh-2d-atlas',
    version: 1,
    hash: fnv1a(signature),
    pages: Object.freeze(pages),
    regions,
    pma: pages[0]!.pma ?? false,
    colorSpace: 'srgb',
    padding,
    bleed,
    source: 'file',
  }
  return Object.freeze(atlas)
}

/** 打包输入：只关心可见尺寸；trim/旋转由调用方先处理。 */
export type AtlasPackerRegion = { readonly id: string; readonly width: number; readonly height: number }

export type AtlasPackOptions = {
  readonly pageSize?: number
  readonly padding?: number
  readonly bleed?: number
  readonly maxPages?: number
}

/**
 * 确定性 shelf 打包：按高度降序、id 升序放置；每页从上到下分行。
 * 只生成 rotate=0 region；越界/超页直接抛错，不静默丢 region。
 */
export function packAtlas(
  regions: readonly AtlasPackerRegion[],
  options: AtlasPackOptions = {},
): AtlasData {
  const pageSize = Math.max(8, Math.floor(options.pageSize ?? 1024))
  const padding = Math.max(0, Math.floor(options.padding ?? 4))
  const bleed = Math.max(0, Math.floor(options.bleed ?? 2))
  const maxPages = Math.max(1, Math.min(MAX_PAGES, Math.floor(options.maxPages ?? MAX_PAGES)))
  const ordered = regions.slice().sort((a, b) => b.height - a.height || b.width - a.width || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const packed = new Map<string, AtlasRegion>()
  let page = 0
  let x = padding
  let y = padding
  let shelfHeight = 0
  for (const input of ordered) {
    if (!input.id || !(input.width > 0) || !(input.height > 0)) fail('E_ATLAS_REGION', `region ${input.id}`)
    const w = Math.ceil(input.width)
    const h = Math.ceil(input.height)
    if (w + padding * 2 > pageSize || h + padding * 2 > pageSize) fail('E_ATLAS_FIT', `region ${input.id} 超过单页`)
    if (x + w + padding > pageSize) {
      x = padding
      y += shelfHeight + padding
      shelfHeight = 0
    }
    if (y + h + padding > pageSize) {
      page += 1
      if (page >= maxPages) fail('E_ATLAS_PAGES', `region ${input.id} 无法放入 ${maxPages} 页`)
      x = padding
      y = padding
      shelfHeight = 0
    }
    const u0 = (x + 0.5) / pageSize
    const v0 = (y + 0.5) / pageSize
    const u1 = (x + w - 0.5) / pageSize
    const v1 = (y + h - 0.5) / pageSize
    packed.set(input.id, {
      id: input.id, page, x, y, width: w, height: h,
      uvMatrix: Float32Array.from([u1 - u0, 0, 0, v1 - v0, u0, v0]),
      trim: { offsetX: 0, offsetY: 0, sourceWidth: w, sourceHeight: h },
      maxMip: 0,
    })
    x += w + padding
    shelfHeight = Math.max(shelfHeight, h)
  }
  const pages: AtlasPageDef[] = Array.from({ length: page + 1 }, (_, index) => ({
    index, name: `page-${index}`, width: pageSize, height: pageSize,
    minFilter: 'Linear', magFilter: 'Linear', uWrap: 'ClampToEdge', vWrap: 'ClampToEdge', pma: true,
  }))
  const signature = [...packed.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => `${r.id}@${r.page}:${r.x},${r.y},${r.width},${r.height}`)
    .join('|')
  return Object.freeze({
    format: 'dsh-2d-atlas', version: 1, hash: fnv1a(signature),
    pages: Object.freeze(pages), regions: packed, pma: true as const,
    colorSpace: 'srgb' as const, padding, bleed, source: 'procedural' as const,
  })
}

/** 每个图集页一个 sprite 材质；flat 材质固定 id=0。 */
export function buildMaterialLibrary(atlas: AtlasData): import('../render/render').MaterialDef[] {
  const materials: import('../render/render').MaterialDef[] = [
    { id: 0, kind: 'flat', page: -1, filter: 'linear' },
  ]
  atlas.pages.forEach((_, index) => {
    materials.push({ id: index + 1, kind: 'sprite', page: index, filter: 'linear' })
  })
  return materials
}

/** 按 id 取 region 的页号/矩形/页尺寸/UV 矩阵；缺失返回 null。 */
export function atlasRegionRef(
  atlas: AtlasData,
  id: string,
): { page: number; rect: { x: number; y: number; width: number; height: number }; pageSize: { width: number; height: number }; uvMatrix: Float32Array } | null {
  const region = atlas.regions.get(id)
  if (region === undefined) return null
  const page = atlas.pages[region.page]
  if (page === undefined) return null
  return {
    page: region.page,
    rect: { x: region.x, y: region.y, width: region.width, height: region.height },
    pageSize: { width: page.width, height: page.height },
    uvMatrix: region.uvMatrix,
  }
}
