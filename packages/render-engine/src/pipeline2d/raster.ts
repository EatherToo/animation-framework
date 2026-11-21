import { buildOutlineRibbon } from './outline'
import { sampleAtlas, blendColor, type AtlasImage, type AtlasRegion } from './atlas'
import type { RenderPacket, RGBA } from './types'

export type RasterTarget = {
  readonly width: number
  readonly height: number
  /** 步长 4 的 RGBA；调用者负责清屏。 */
  readonly pixels: Uint8ClampedArray
}

export type RasterTransform = {
  /** 单位 → 像素。 */
  readonly scale: number
  readonly originX: number
  readonly originY: number
}

export type RasterAtlas = {
  readonly pages: readonly AtlasImage[]
  readonly regions: ReadonlyMap<string, { readonly page: number; readonly region: AtlasRegion }>
}

export type MaskOptions = {
  /** 只保留世界 y >= minWorldY 的像素；用来做肩口遮罩。 */
  readonly minWorldY?: number
  /** true 时取反：遮罩内透明、遮罩外可见。 */
  readonly invert?: boolean
}

export type RasterOptions = {
  readonly transform: RasterTransform
  /** 'triangle'：每个三角形取一个固定填色；'smooth'：按顶点插值。 */
  readonly fillMode?: 'smooth' | 'triangle'
  /** 'triangles' 额外画出每个三角形的边；'silhouette' 只画外轮廓。 */
  readonly edges?: 'silhouette' | 'triangles' | 'none'
  /** 三角形边线的屏幕像素宽度，默认 1。 */
  readonly edgeWidthPx?: number
  readonly atlas?: RasterAtlas
  /** 每个 mask id 的逐像素 alpha（0–255）。 */
  readonly masks?: ReadonlyMap<string, Uint8Array>
  /** 每像素字形（默认 1）。 */
  readonly supersample?: number
}

/**
 * CPU 2D 后端：按包顺序画填充 + 屏幕描边，不读逐像素深度。
 * 颜色/UV 按屏幕重心插值；mask 用逐像素 alpha。
 * @param target 目标像素缓冲
 * @param packets 已按 Slot + depth 排好的包
 * @param options 变换、图集、mask
 */
export function paintPackets(
  target: RasterTarget,
  packets: readonly RenderPacket[],
  options: RasterOptions,
): void {
  if (target.pixels.length !== target.width * target.height * 4) throw new Error('target')
  const { scale, originX, originY } = options.transform
  if (!(scale > 0)) throw new Error('transform')
  const supersample = options.supersample ?? 1
  const fillMode = options.fillMode ?? 'smooth'
  const edges = options.edges ?? 'silhouette'
  for (const packet of packets) {
    const mask = packet.mask === null ? undefined : options.masks?.get(packet.mask)
    fillPacket(target, packet, { scale, originX, originY }, options.atlas, mask, supersample, fillMode)
    if (packet.outline !== null && edges !== 'none') {
      outlinePacket(target, packet, { scale, originX, originY }, mask, supersample)
    }
    if (packet.outline !== null && edges === 'triangles') {
      edgePacket(target, packet, { scale, originX, originY }, mask, supersample, options.edgeWidthPx ?? 1)
    }
  }
}

type Transform = { readonly scale: number; readonly originX: number; readonly originY: number }

/**
 * 把一个包光栅成逐像素 alpha 遮罩（255=覆盖）。可限制最低世界 y。
 * @param packet 网格包
 * @param width 目标宽
 * @param height 目标高
 * @param transform 单位→像素
 * @param options minWorldY
 */
export function rasterizeMask(
  packet: RenderPacket,
  width: number,
  height: number,
  transform: RasterTransform,
  options: MaskOptions = {},
): Uint8Array {
  const mask = new Uint8Array(width * height)
  const positions = packet.vertices
  const minWorldY = options.minWorldY ?? Number.NEGATIVE_INFINITY
  for (let t = 0; t < packet.indices.length; t += 3) {
    const ia = packet.indices[t]!
    const ib = packet.indices[t + 1]!
    const ic = packet.indices[t + 2]!
    const ax = transform.originX + positions[ia * 2]! * transform.scale
    const ay = transform.originY - positions[ia * 2 + 1]! * transform.scale
    const bx = transform.originX + positions[ib * 2]! * transform.scale
    const by = transform.originY - positions[ib * 2 + 1]! * transform.scale
    const cx = transform.originX + positions[ic * 2]! * transform.scale
    const cy = transform.originY - positions[ic * 2 + 1]! * transform.scale
    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(denom) <= 1e-8) continue
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)))
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)))
    for (let y = minY; y <= maxY; y += 1) {
      const worldY = (transform.originY - (y + 0.5)) / transform.scale
      if (worldY < minWorldY) continue
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5
        const py = y + 0.5
        const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom
        const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom
        const w2 = 1 - w0 - w1
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
        mask[y * width + x] = 255
      }
    }
  }
  if (options.invert === true) {
    for (let i = 0; i < mask.length; i += 1) mask[i] = 255 - mask[i]!
  }
  return mask
}

function fillPacket(
  target: RasterTarget,
  packet: RenderPacket,
  transform: Transform,
  atlas: RasterAtlas | undefined,
  mask: Uint8Array | undefined,
  supersample: number,
  fillMode: 'smooth' | 'triangle',
): void {
  const positions = packet.vertices
  const count = positions.length / 2
  const ref = atlas?.regions.get(packet.atlasKey)
  const page = ref === undefined ? undefined : atlas?.pages[ref.page]
  const region = ref?.region
  const useAtlas = page !== undefined && region !== undefined && packet.uvs.length === count * 2
  const vertexColors = new Float32Array(count * 4)
  if (useAtlas) {
    const sampled = { r: 0, g: 0, b: 0, a: 0 }
    for (let v = 0; v < count; v += 1) {
      sampleAtlas(sampled, page, region, packet.uvs[v * 2]!, packet.uvs[v * 2 + 1]!, 'linear')
      vertexColors[v * 4] = sampled.r
      vertexColors[v * 4 + 1] = sampled.g
      vertexColors[v * 4 + 2] = sampled.b
      vertexColors[v * 4 + 3] = sampled.a
    }
  } else {
    for (let v = 0; v < count; v += 1) {
      vertexColors[v * 4] = (packet.colors[v * 4] ?? 255) / 255
      vertexColors[v * 4 + 1] = (packet.colors[v * 4 + 1] ?? 255) / 255
      vertexColors[v * 4 + 2] = (packet.colors[v * 4 + 2] ?? 255) / 255
      vertexColors[v * 4 + 3] = (packet.colors[v * 4 + 3] ?? 255) / 255
    }
  }
  const indices = packet.indices
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t]!
    const ib = indices[t + 1]!
    const ic = indices[t + 2]!
    const ax = transform.originX + positions[ia * 2]! * transform.scale
    const ay = transform.originY - positions[ia * 2 + 1]! * transform.scale
    const bx = transform.originX + positions[ib * 2]! * transform.scale
    const by = transform.originY - positions[ib * 2 + 1]! * transform.scale
    const cx = transform.originX + positions[ic * 2]! * transform.scale
    const cy = transform.originY - positions[ic * 2 + 1]! * transform.scale
    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(denom) <= 1e-8) continue
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const maxX = Math.min(target.width - 1, Math.ceil(Math.max(ax, bx, cx)))
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const maxY = Math.min(target.height - 1, Math.ceil(Math.max(ay, by, cy)))
    const ar = vertexColors[ia * 4]!
    const ag = vertexColors[ia * 4 + 1]!
    const ab = vertexColors[ia * 4 + 2]!
    const aa = vertexColors[ia * 4 + 3]!
    const br = vertexColors[ib * 4]!
    const bg = vertexColors[ib * 4 + 1]!
    const bb = vertexColors[ib * 4 + 2]!
    const ba = vertexColors[ib * 4 + 3]!
    const cr = vertexColors[ic * 4]!
    const cg = vertexColors[ic * 4 + 1]!
    const cb = vertexColors[ic * 4 + 2]!
    const ca = vertexColors[ic * 4 + 3]!
    const fixed = fillMode === 'triangle'
      ? { r: (ar + br + cr) / 3, g: (ag + bg + cg) / 3, b: (ab + bb + cb) / 3, a: (aa + ba + ca) / 3 }
      : null
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5
        const py = y + 0.5
        const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom
        const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom
        const w2 = 1 - w0 - w1
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
        const maskA = mask === undefined ? 1 : (mask[y * target.width + x] ?? 0) / 255
        if (maskA <= 0) continue
        if (fixed !== null) {
          writePixel(target, x, y, fixed.r, fixed.g, fixed.b, fixed.a * maskA, packet.blend)
        } else {
          writePixel(
            target,
            x,
            y,
            ar * w0 + br * w1 + cr * w2,
            ag * w0 + bg * w1 + cg * w2,
            ab * w0 + bb * w1 + cb * w2,
            (aa * w0 + ba * w1 + ca * w2) * maskA,
            packet.blend,
          )
        }
      }
    }
  }
  void supersample
}

function edgePacket(
  target: RasterTarget,
  packet: RenderPacket,
  transform: Transform,
  mask: Uint8Array | undefined,
  supersample: number,
  widthPx: number,
): void {
  const outline = packet.outline!
  const width = Math.max(0.25, widthPx) * supersample
  const seen = new Set<string>()
  const positions = packet.vertices
  const indices = packet.indices
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e += 1) {
      const from = indices[t + e]!
      const to = indices[t + ((e + 1) % 3)]!
      const lo = from < to ? from : to
      const hi = from < to ? to : from
      const key = `${lo}:${hi}`
      if (seen.has(key)) continue
      seen.add(key)
      const ax = transform.originX + positions[lo * 2]! * transform.scale
      const ay = transform.originY - positions[lo * 2 + 1]! * transform.scale
      const bx = transform.originX + positions[hi * 2]! * transform.scale
      const by = transform.originY - positions[hi * 2 + 1]! * transform.scale
      const dx = bx - ax
      const dy = by - ay
      const length = Math.hypot(dx, dy)
      if (length < 1e-9) continue
      const nx = (dy / length) * (width / 2)
      const ny = (-dx / length) * (width / 2)
      fillScreenTriangle(target, ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, outline.color, mask, packet.blend)
      fillScreenTriangle(target, ax + nx, ay + ny, bx - nx, by - ny, ax - nx, ay - ny, outline.color, mask, packet.blend)
    }
  }
}

function outlinePacket(
  target: RasterTarget,
  packet: RenderPacket,
  transform: Transform,
  mask: Uint8Array | undefined,
  supersample: number,
): void {
  const outline = packet.outline!
  const ribbon = buildOutlineRibbon(packet, transform.scale, outline.widthPx * supersample)
  if (ribbon === null) return
  for (let t = 0; t < ribbon.indices.length; t += 3) {
    const ia = ribbon.indices[t]!
    const ib = ribbon.indices[t + 1]!
    const ic = ribbon.indices[t + 2]!
    const ax = transform.originX + ribbon.positions[ia * 2]! * transform.scale
    const ay = transform.originY - ribbon.positions[ia * 2 + 1]! * transform.scale
    const bx = transform.originX + ribbon.positions[ib * 2]! * transform.scale
    const by = transform.originY - ribbon.positions[ib * 2 + 1]! * transform.scale
    const cx = transform.originX + ribbon.positions[ic * 2]! * transform.scale
    const cy = transform.originY - ribbon.positions[ic * 2 + 1]! * transform.scale
    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(denom) <= 1e-8) continue
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const maxX = Math.min(target.width - 1, Math.ceil(Math.max(ax, bx, cx)))
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const maxY = Math.min(target.height - 1, Math.ceil(Math.max(ay, by, cy)))
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5
        const py = y + 0.5
        const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom
        const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom
        const w2 = 1 - w0 - w1
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
        const maskA = mask === undefined ? 1 : (mask[y * target.width + x] ?? 0) / 255
        if (maskA <= 0) continue
        writePixel(target, x, y, outline.color.r, outline.color.g, outline.color.b, outline.color.a * maskA, packet.blend)
      }
    }
  }
}

function fillScreenTriangle(
  target: RasterTarget,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  color: RGBA,
  mask: Uint8Array | undefined,
  mode: RenderPacket['blend'],
): void {
  const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
  if (Math.abs(denom) <= 1e-8) return
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
  const maxX = Math.min(target.width - 1, Math.ceil(Math.max(ax, bx, cx)))
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
  const maxY = Math.min(target.height - 1, Math.ceil(Math.max(ay, by, cy)))
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5
      const py = y + 0.5
      const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom
      const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom
      const w2 = 1 - w0 - w1
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
      const maskA = mask === undefined ? 1 : (mask[y * target.width + x] ?? 0) / 255
      if (maskA <= 0) continue
      writePixel(target, x, y, color.r, color.g, color.b, color.a * maskA, mode)
    }
  }
}

function colorAt(
  colors: Uint8Array,
  ia: number,
  ib: number,
  ic: number,
  w0: number,
  w1: number,
  w2: number,
): RGBA {
  return {
    r: ((colors[ia * 4] ?? 255) * w0 + (colors[ib * 4] ?? 255) * w1 + (colors[ic * 4] ?? 255) * w2) / 255,
    g: ((colors[ia * 4 + 1] ?? 255) * w0 + (colors[ib * 4 + 1] ?? 255) * w1 + (colors[ic * 4 + 1] ?? 255) * w2) / 255,
    b: ((colors[ia * 4 + 2] ?? 255) * w0 + (colors[ib * 4 + 2] ?? 255) * w1 + (colors[ic * 4 + 2] ?? 255) * w2) / 255,
    a: ((colors[ia * 4 + 3] ?? 255) * w0 + (colors[ib * 4 + 3] ?? 255) * w1 + (colors[ic * 4 + 3] ?? 255) * w2) / 255,
  }
}

function writePixel(
  target: RasterTarget,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
  mode: RenderPacket['blend'],
): void {
  if (a <= 0) return
  const i = (y * target.width + x) * 4
  if (mode === 'normal' && a >= 0.999) {
    target.pixels[i] = Math.round(r * 255)
    target.pixels[i + 1] = Math.round(g * 255)
    target.pixels[i + 2] = Math.round(b * 255)
    target.pixels[i + 3] = 255
    return
  }
  const dst = {
    r: target.pixels[i]! / 255,
    g: target.pixels[i + 1]! / 255,
    b: target.pixels[i + 2]! / 255,
    a: target.pixels[i + 3]! / 255,
  }
  blendColor(dst, { r, g, b, a }, mode)
  target.pixels[i] = Math.round(dst.r * 255)
  target.pixels[i + 1] = Math.round(dst.g * 255)
  target.pixels[i + 2] = Math.round(dst.b * 255)
  target.pixels[i + 3] = Math.round(dst.a * 255)
}
