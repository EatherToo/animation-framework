/** 图集打包与采样（R3 数据层）。不依赖 Canvas/WebGL。 */

export type AtlasItem = {
  readonly id: string
  readonly width: number
  readonly height: number
}

export type AtlasRegion = {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type Atlas = {
  readonly width: number
  readonly height: number
  readonly padding: number
  readonly pma: boolean
  readonly regions: readonly AtlasRegion[]
}

export type AtlasOptions = {
  readonly padding?: number
  readonly maxWidth?: number
  readonly pma?: boolean
}

export type AtlasImage = {
  readonly width: number
  readonly height: number
  /** 步长 4 的 RGBA。pma=true 时 RGB 已预乘 alpha。 */
  readonly rgba: Uint8Array
  readonly pma: boolean
}

export type UVRect = {
  readonly u0: number
  readonly v0: number
  readonly u1: number
  readonly v1: number
}

/**
 * 简单的 shelf 打包：按高度降序放置，region 之间留 padding，页面取 2 的幂。
 * @param items 区域尺寸
 * @param options padding / 最大页宽 / PMA 标志
 */
export function packAtlas(items: readonly AtlasItem[], options: AtlasOptions = {}): Atlas {
  const padding = Math.max(0, Math.floor(options.padding ?? 2))
  const maxWidth = Math.max(1, Math.floor(options.maxWidth ?? 256))
  const sorted = items.slice().sort((a, b) => b.height - a.height || b.width - a.width)
  const regions: AtlasRegion[] = []
  let x = padding
  let y = padding
  let rowHeight = 0
  let usedWidth = 0
  for (const item of sorted) {
    if (!Number.isInteger(item.width) || !Number.isInteger(item.height) || item.width <= 0 || item.height <= 0) {
      throw new Error('atlas')
    }
    if (item.width + padding * 2 > maxWidth) throw new Error('atlas')
    if (x + item.width + padding > maxWidth) {
      x = padding
      y += rowHeight + padding
      rowHeight = 0
    }
    regions.push({ id: item.id, x, y, width: item.width, height: item.height })
    x += item.width + padding
    rowHeight = Math.max(rowHeight, item.height)
    usedWidth = Math.max(usedWidth, x)
  }
  const width = nextPowerOfTwo(Math.max(1, usedWidth))
  const height = nextPowerOfTwo(Math.max(1, y + rowHeight + padding))
  return { width, height, padding, pma: options.pma ?? true, regions }
}

export type AtlasPagesOptions = {
  readonly padding?: number
  readonly maxWidth?: number
  readonly maxHeight?: number
  readonly maxPages?: number
  readonly pma?: boolean
}

/**
 * 在最多 maxPages 页内做 shelf 打包；放不下时抛错。
 * 当前角色资产只有 1 页，这里是为 4 页上限预留的通用能力。
 * @param items 区域尺寸
 * @param options 页宽/页高/页数上限
 */
export function packAtlasPages(
  items: readonly AtlasItem[],
  options: AtlasPagesOptions = {},
): Atlas[] {
  const padding = Math.max(0, Math.floor(options.padding ?? 2))
  const maxWidth = Math.max(1, Math.floor(options.maxWidth ?? 1024))
  const maxHeight = Math.max(1, Math.floor(options.maxHeight ?? 1024))
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? 4))
  const sorted = items.slice().sort((a, b) => b.height - a.height || b.width - a.width)
  const pages: Atlas[] = []
  let regions: AtlasRegion[] = []
  let x = padding
  let y = padding
  let rowHeight = 0
  let usedWidth = 0
  const finish = (): void => {
    if (regions.length === 0) return
    pages.push({
      width: nextPowerOfTwo(Math.max(1, usedWidth)),
      height: nextPowerOfTwo(Math.max(1, y + rowHeight + padding)),
      padding,
      pma: options.pma ?? true,
      regions,
    })
    regions = []
    x = padding
    y = padding
    rowHeight = 0
    usedWidth = 0
  }
  for (const item of sorted) {
    if (!Number.isInteger(item.width) || !Number.isInteger(item.height) || item.width <= 0 || item.height <= 0) {
      throw new Error('atlas')
    }
    if (item.width + padding * 2 > maxWidth || item.height + padding * 2 > maxHeight) throw new Error('atlas')
    if (x + item.width + padding > maxWidth) {
      x = padding
      y += rowHeight + padding
      rowHeight = 0
    }
    if (y + item.height + padding > maxHeight) {
      finish()
      if (pages.length >= maxPages) throw new Error('atlas')
    }
    regions.push({ id: item.id, x, y, width: item.width, height: item.height })
    x += item.width + padding
    rowHeight = Math.max(rowHeight, item.height)
    usedWidth = Math.max(usedWidth, x)
  }
  finish()
  if (pages.length === 0 || pages.length > maxPages) throw new Error('atlas')
  return pages
}

/**
 * 区域的归一化 UV（半 texel 内缩，供线性过滤）。
 * @param region 图集区域
 * @param atlas 图集
 */
export function regionUv(region: AtlasRegion, atlas: Atlas): UVRect {
  if (region.width <= 0 || region.height <= 0 || region.x < 0 || region.y < 0) throw new Error('atlas')
  if (region.x + region.width > atlas.width || region.y + region.height > atlas.height) {
    throw new Error('atlas')
  }
  const u0 = (region.x + 0.5) / atlas.width
  const v0 = (region.y + 0.5) / atlas.height
  const u1 = (region.x + region.width - 0.5) / atlas.width
  const v1 = (region.y + region.height - 0.5) / atlas.height
  return { u0, v0, u1, v1 }
}

/**
 * 在图集内按局部 UV 采样。返回 straight RGBA（0–1），PMA 输入会先反预乘。
 * @param out 输出颜色
 * @param image 图集图片
 * @param region 区域
 * @param u 区域局部横坐标 0–1
 * @param v 区域局部纵坐标 0–1
 * @param filter 最近邻/双线性
 */
export function sampleAtlas(
  out: { r: number; g: number; b: number; a: number },
  image: AtlasImage,
  region: AtlasRegion,
  u: number,
  v: number,
  filter: 'nearest' | 'linear' = 'linear',
): void {
  if (!Number.isFinite(u) || !Number.isFinite(v)) throw new Error('uv')
  const localU = clamp01(u)
  const localV = clamp01(v)
  if (filter === 'nearest') {
    const x = Math.min(region.width - 1, Math.floor(localU * region.width))
    const y = Math.min(region.height - 1, Math.floor(localV * region.height))
    read(out, image, region.x + x, region.y + y)
    return
  }
  const x = region.x + localU * (region.width - 1) + 0.5
  const y = region.y + localV * (region.height - 1) + 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(region.x + region.width - 1, x0 + 1)
  const y1 = Math.min(region.y + region.height - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const c00 = readColor(image, x0, y0)
  const c10 = readColor(image, x1, y0)
  const c01 = readColor(image, x0, y1)
  const c11 = readColor(image, x1, y1)
  out.r = lerp(lerp(c00.r, c10.r, fx), lerp(c01.r, c11.r, fx), fy)
  out.g = lerp(lerp(c00.g, c10.g, fx), lerp(c01.g, c11.g, fx), fy)
  out.b = lerp(lerp(c00.b, c10.b, fx), lerp(c01.b, c11.b, fx), fy)
  out.a = lerp(lerp(c00.a, c10.a, fx), lerp(c01.a, c11.a, fx), fy)
}

/**
 * 按 blend mode 合成一个 straight 颜色；目标也是 straight。
 * @param dst 目标颜色，原地修改
 * @param src 源颜色
 * @param mode 混合模式
 */
export function blendColor(
  dst: { r: number; g: number; b: number; a: number },
  src: { r: number; g: number; b: number; a: number },
  mode: 'normal' | 'add' | 'multiply' | 'screen',
): void {
  const a = src.a
  const outA = a + dst.a * (1 - a)
  if (outA <= 0) {
    dst.r = 0
    dst.g = 0
    dst.b = 0
    dst.a = 0
    return
  }
  let r: number
  let g: number
  let b: number
  if (mode === 'normal') {
    r = src.r * a + dst.r * dst.a * (1 - a)
    g = src.g * a + dst.g * dst.a * (1 - a)
    b = src.b * a + dst.b * dst.a * (1 - a)
  } else {
    const add = mode === 'add' ? (x: number, y: number) => x + y
      : mode === 'multiply' ? (x: number, y: number) => x * y
        : (x: number, y: number) => x + y - x * y
    r = add(src.r, dst.r) * a + dst.r * dst.a * (1 - a)
    g = add(src.g, dst.g) * a + dst.g * dst.a * (1 - a)
    b = add(src.b, dst.b) * a + dst.b * dst.a * (1 - a)
  }
  dst.r = r / outA
  dst.g = g / outA
  dst.b = b / outA
  dst.a = outA
}

function readColor(image: AtlasImage, x: number, y: number): { r: number; g: number; b: number; a: number } {
  const i = (y * image.width + x) * 4
  const a = image.rgba[i + 3]! / 255
  if (image.pma && a > 0) {
    return {
      r: image.rgba[i]! / 255 / a,
      g: image.rgba[i + 1]! / 255 / a,
      b: image.rgba[i + 2]! / 255 / a,
      a,
    }
  }
  return { r: image.rgba[i]! / 255, g: image.rgba[i + 1]! / 255, b: image.rgba[i + 2]! / 255, a }
}

function read(out: { r: number; g: number; b: number; a: number }, image: AtlasImage, x: number, y: number): void {
  const color = readColor(image, x, y)
  out.r = color.r
  out.g = color.g
  out.b = color.b
  out.a = color.a
}

function nextPowerOfTwo(value: number): number {
  let result = 1
  while (result < value) result *= 2
  return result
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
