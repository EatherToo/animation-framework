/**
 * S1 纹理管线：图像解码、CPU 预乘与图集页构建。
 * 权威：docs/22-Spine渲染对标/texture-pipeline.md §4.1–4.2、§5。
 *
 * 约定：
 * - 统一出口是 RGBA8 `Uint8Array`（长度 = w*h*4），CPU 后端与 WebGL2 共用；
 * - 预乘只做一次：`pma=false` 的 straight 数据才调用 `premultiply`；
 * - 浏览器来源（ImageBitmap/HTMLImageElement）经 OffscreenCanvas/Canvas 2D 读回 RGBA，
 *   环境不可用时抛明确错误，不做静默降级；
 * - 图集页数 ≤4，解码尺寸必须与页声明一致。
 */

import type { TextureData, TextureFilter, TextureWrap } from '../render/render'

/** 解码后的原始图像：RGBA8，左上原点。 */
export type RawImage = { readonly width: number; readonly height: number; readonly data: Uint8Array }

/** 图集页构建选项；缺省 pma=true、linear、clamp、无 mipmap。 */
export type BuildTexturePagesOptions = {
  readonly pma?: boolean
  readonly mipmap?: boolean
  readonly filter?: TextureFilter
  readonly wrap?: TextureWrap
}

/** 图集页输入：只关心尺寸与图像来源，其余字段由调用方自持。 */
export type TexturePageSource = {
  readonly width: number
  readonly height: number
  readonly image?: unknown
}

const MAX_PAGES = 4
const CHANNELS = 4

/** 与后端一致的 8 位乘法舍入：(a*b + 127) / 255 向下取整。 */
const mulU8 = (a: number, b: number): number => ((a * b + 127) / 255) | 0

/**
 * straight → PMA：每个像素 `rgb *= a / 255`，alpha 不变。
 * 返回新数组，不改写入参；同一份数据只能调用一次。
 */
export function premultiply(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length)
  for (let i = 0; i + 3 < data.length; i += CHANNELS) {
    const a = data[i + 3]!
    out[i] = Math.min(255, mulU8(data[i]!, a))
    out[i + 1] = Math.min(255, mulU8(data[i + 1]!, a))
    out[i + 2] = Math.min(255, mulU8(data[i + 2]!, a))
    out[i + 3] = a
  }
  return out
}

/** 校验 RGBA8 尺寸与字节长度；不合法直接抛错，不做补齐/截断。 */
function validate(width: unknown, height: unknown, data: unknown): RawImage {
  if (typeof width !== 'number' || typeof height !== 'number' ||
      !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`decodeImage: 宽高必须是正整数，收到 ${String(width)}x${String(height)}`)
  }
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('decodeImage: 图像数据必须是 Uint8Array（RGBA8）')
  }
  const expected = width * height * CHANNELS
  if (data.length !== expected) {
    throw new RangeError(`decodeImage: RGBA8 长度不符，期望 ${expected}，实际 ${data.length}`)
  }
  return { width, height, data }
}

/** 形如 {width,height,data:Uint8Array} 的直通来源。 */
function isRawSource(source: unknown): source is RawImage {
  if (source === null || typeof source !== 'object') return false
  const s = source as { data?: unknown; width?: unknown; height?: unknown }
  return s.data instanceof Uint8Array && typeof s.width === 'number' && typeof s.height === 'number'
}

/** 浏览器位图/元素：有像素尺寸但无字节数据。 */
function isImageLike(source: unknown): source is { width: number; height: number } {
  if (source === null || typeof source !== 'object') return false
  if (isRawSource(source)) return false
  const s = source as { width?: unknown; height?: unknown }
  return typeof s.width === 'number' && typeof s.height === 'number'
}

type Ctx2D = {
  drawImage(image: unknown, dx: number, dy: number): void
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray }
}

/** 用 OffscreenCanvas 或 DOM canvas 把位图读成 RGBA8；环境缺失时抛错。 */
function drawToRgba(source: unknown, width: number, height: number): RawImage {
  const g = globalThis as unknown as {
    OffscreenCanvas?: new (w: number, h: number) => { getContext(id: '2d'): Ctx2D | null }
    document?: { createElement(tag: 'canvas'): { width: number; height: number; getContext(id: '2d'): Ctx2D | null } }
  }
  let ctx: Ctx2D | null = null
  if (typeof g.OffscreenCanvas === 'function') {
    ctx = new g.OffscreenCanvas(width, height).getContext('2d')
  } else if (g.document !== undefined && typeof g.document.createElement === 'function') {
    const canvas = g.document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    ctx = canvas.getContext('2d')
  }
  if (ctx === null) {
    throw new Error(
      'decodeImage: 无法解码图像源，当前环境缺少 OffscreenCanvas/Canvas 2D；' +
      '请在 Node 中直接提供 RGBA8 字节或自定义 loader',
    )
  }
  ctx.drawImage(source, 0, 0)
  const image = ctx.getImageData(0, 0, width, height)
  return validate(width, height, new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength))
}

/**
 * 解码任意来源为 RGBA8。
 * 顺序：RawImage 直通 → 自定义 loader → 浏览器位图（Canvas 读回）；无法识别则抛错。
 */
export async function decodeImage(
  source: unknown,
  loader?: (source: unknown) => Promise<RawImage>,
): Promise<RawImage> {
  if (isRawSource(source)) return validate(source.width, source.height, source.data)

  if (loader !== undefined) {
    const loaded = await loader(source)
    if (!isRawSource(loaded)) throw new TypeError('decodeImage: loader 必须返回 RGBA8 RawImage')
    return validate(loaded.width, loaded.height, loaded.data)
  }

  if (isImageLike(source)) return drawToRgba(source, source.width, source.height)

  throw new TypeError(
    'decodeImage: 无法解码该图像源；支持 RGBA8 字节、ImageBitmap/HTMLImageElement，或传入 loader',
  )
}

/**
 * 图集页 → TextureData 列表（0..4 页）。
 * `pma` 只写入元数据：`pma=false` 时由上传方做唯一一次预乘（见 backend）。
 */
export async function buildTexturePages(
  atlas: { readonly pages: readonly TexturePageSource[] },
  loader?: (source: unknown) => Promise<RawImage>,
  options: BuildTexturePagesOptions = {},
): Promise<readonly TextureData[]> {
  if (atlas === null || typeof atlas !== 'object' || !Array.isArray(atlas.pages)) {
    throw new TypeError('buildTexturePages: 需要 { pages: [...] } 形式的图集')
  }
  if (atlas.pages.length > MAX_PAGES) {
    throw new RangeError(`buildTexturePages: 页数上限 ${MAX_PAGES}，收到 ${atlas.pages.length}`)
  }
  const pma = options.pma ?? true
  const mipmap = options.mipmap ?? false
  const filter = options.filter ?? 'linear'
  const wrap = options.wrap ?? 'clamp'

  const pages: TextureData[] = []
  for (let i = 0; i < atlas.pages.length; i += 1) {
    const page = atlas.pages[i]!
    if (page.image === undefined) throw new Error(`buildTexturePages: 第 ${i} 页缺少图像`)
    const image = await decodeImage(page.image, loader)
    if (image.width !== page.width || image.height !== page.height) {
      throw new RangeError(
        `buildTexturePages: 第 ${i} 页尺寸不一致，声明 ${page.width}x${page.height}，` +
        `解码 ${image.width}x${image.height}`,
      )
    }
    pages.push({ width: image.width, height: image.height, data: image.data, pma, mipmap, filter, wrap })
  }
  return pages
}
