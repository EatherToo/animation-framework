/**
 * M11 图集导入：Spine `.atlas`（libgdx 风格）文本 → core2d 只读 AtlasData。
 * 权威：docs/08-渲染/atlas.md、docs/11-资产/spine.md §7。
 *
 * 约定：
 * - 页数上限 4；超过直接抛带 code 的错误，不静默截断。
 * - v1 不保留 rotate 字段；rotate 90/180/270 在导入期通过重排 UV 矩阵消除。
 * - UV 矩阵列主序 [a,b,c,d,tx,ty]：u_page = a·u + c·v + tx，v_page = b·u + d·v + ty。
 * - 半 texel 内缩只在 uvMatrix 里做一次，避免双线性采到相邻 region。
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
  readonly width: number
  readonly height: number
  readonly image?: AtlasImage
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
  readonly maxMip: number
}

/** 图集资产：页、region 表与全局约定。 */
export type AtlasData = {
  readonly format: 'dsh-2d-atlas'
  readonly version: number
  readonly hash: string
  readonly pages: readonly AtlasPageDef[]
  readonly regions: ReadonlyMap<string, AtlasRegion>
  readonly pma: true
  readonly colorSpace: 'srgb'
  readonly padding: number
  readonly bleed: number
  readonly source: 'file' | 'procedural'
}

export type AtlasImportOptions = {
  readonly pages?: readonly AtlasPageDef[]
  readonly padding?: number
  readonly bleed?: number
}

type AtlasError = Error & { code: string }

const MAX_PAGES = 4
const HALF_TEXEL = 0.5
const HEADER_KEYS = new Set(['size', 'format', 'filter', 'repeat', 'pma', 'scale'])
const REGION_KEYS = new Set(['bounds', 'offsets', 'orig', 'offset', 'rotate', 'pad', 'split', 'index'])

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
 * 生成局部 0..1 → 页 UV 的矩阵。半 texel 内缩后按 rotate 重排轴：
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
): Float32Array {
  const w = Math.max(1, pageWidth)
  const h = Math.max(1, pageHeight)
  const spanU = Math.max(0, width - 1) / w
  const spanV = Math.max(0, height - 1) / h
  const tx = (x + HALF_TEXEL) / w
  const ty = (y + HALF_TEXEL) / h
  switch (rotate) {
    case 90:
      // u_page = tx + v·spanU，v_page = ty + u·spanV
      return new Float32Array([0, spanV, spanU, 0, tx, ty])
    case 180:
      // u_page = tx + spanU - u·spanU，v_page = ty + spanV - v·spanV
      return new Float32Array([-spanU, 0, 0, -spanV, tx + spanU, ty + spanV])
    case 270:
      // u_page = tx + spanU - v·spanU，v_page = ty + spanV - u·spanV
      return new Float32Array([0, -spanV, -spanU, 0, tx + spanU, ty + spanV])
    default:
      return new Float32Array([spanU, 0, 0, spanV, tx, ty])
  }
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

    // 页头：第一行通常是图片路径；其后是 size/format/filter/repeat/pma。
    while (cursor < lines.length) {
      const raw = lines[cursor]!
      if (raw.trim() === '') break
      if (isIndented(raw)) { cursor += 1; continue }
      const field = splitField(raw.trim())
      if (field === null) {
        if (imageName === null) {
          imageName = raw.trim()
          cursor += 1
          continue
        }
        break
      }
      if (!HEADER_KEYS.has(field.key)) break
      if (field.key === 'size') {
        const values = numberList(field.value, 'E_ATLAS_SIZE', 'size')
        if (values.length < 2) fail('E_ATLAS_SIZE', 'size 需要 width,height')
        width = values[0]!
        height = values[1]!
      }
      cursor += 1
    }

    const provided = options?.pages?.find((page) => page.index === pageIndex) ?? options?.pages?.[pageIndex]
    const pageWidth = width ?? provided?.width
    const pageHeight = height ?? provided?.height
    if (pageWidth === undefined || pageHeight === undefined || pageWidth <= 0 || pageHeight <= 0) {
      fail('E_ATLAS_SIZE', `第 ${pageIndex} 页缺少合法 size${imageName === null ? '' : `（${imageName}）`}`)
    }
    const page: AtlasPageDef = {
      index: pageIndex,
      width: Math.floor(pageWidth),
      height: Math.floor(pageHeight),
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
      if (boundsRaw === undefined) fail('E_ATLAS_REGION', `region ${name} 缺少 bounds`)
      const bounds = numberList(boundsRaw, 'E_ATLAS_REGION', `region ${name}.bounds`)
      if (bounds.length < 4) fail('E_ATLAS_REGION', `region ${name}.bounds 需要 x,y,width,height`)
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
      if (regions.has(name)) fail('E_ATLAS_REGION', `region ${name} 重名`)
      const region: AtlasRegion = {
        id: name,
        page: pageIndex,
        x,
        y,
        width: regionWidth,
        height: regionHeight,
        uvMatrix: uvMatrixOf(x, y, regionWidth, regionHeight, rotate, page.width, page.height),
        trim: Object.freeze({ offsetX, offsetY, sourceWidth, sourceHeight }),
        maxMip: maxMipOf(regionWidth, regionHeight, page.width, page.height),
      }
      regions.set(name, Object.freeze(region))
    }
  }

  if (pages.length === 0) fail('E_ATLAS_REGION', '没有解析到任何图集页')
  if (pages.length > MAX_PAGES) fail('E_ATLAS_PAGES', `图集页数超过 ${MAX_PAGES}`)

  const signature = [
    ...pages.map((page) => `p${page.index}:${page.width}x${page.height}:${page.image?.width ?? 0}x${page.image?.height ?? 0}`),
    ...[...regions.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((r) => `${r.id}@${r.page}:${r.x},${r.y},${r.width},${r.height}:${r.trim.offsetX},${r.trim.offsetY},${r.trim.sourceWidth},${r.trim.sourceHeight}:${Array.from(r.uvMatrix).join(',')}`),
  ].join('|')

  const atlas: AtlasData = {
    format: 'dsh-2d-atlas',
    version: 1,
    hash: fnv1a(signature),
    pages: Object.freeze(pages),
    regions,
    pma: true,
    colorSpace: 'srgb',
    padding,
    bleed,
    source: 'file',
  }
  return Object.freeze(atlas)
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
