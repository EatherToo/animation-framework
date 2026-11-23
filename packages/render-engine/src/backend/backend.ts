/** M4 后端：CPU 参考光栅化与 WebGL2 提交，两者只消费 RenderFrame。 */

import type {
  BlendMode,
  MaterialDef,
  RenderAssets,
  RenderFrame,
  RenderMask,
  TextureData,
} from '../render/render'
import { FRAGMENT, VERTEX, ProgramCache, variantOf } from '../render/shader-variants'
import { maskChain, sampleTexture, validateAssets } from '../render/render'
import { premultiply } from '../asset/image'

export interface Viewport {
  width: number
  height: number
}

export interface BackendStats {
  drawCalls: number
  packets: number
  /** Submitted packet groups; runtime prebatch count is carried by RenderFrame.stats. */
  batches: number
  textureBinds: number
  programSwitches: number
  /** Buffer payload submitted by the WebGL backend, including stencil geometry. */
  uploadedBytes: number
  uploadedVertices: number
  /** mask 求值次数（层数 × 覆盖像素）。 */
  maskTests: number
  /** 纹理采样次数（每片元一次）。 */
  textureSamples: number
}

export interface RenderBackend {
  readonly kind: 'cpu' | 'webgl2'
  /** 上传/更新纹理页与材质缓存；非必需，旧后端可只消费 frame.assets。 */
  prepare?(assets: RenderAssets): void
  draw(frame: RenderFrame): void
  readPixels(out?: Uint8ClampedArray): Uint8ClampedArray
  resize(v: Viewport): void
  /** 上下文恢复后重建 GPU 资源；CPU 后端可不实现。 */
  restore?(): void
  dispose(): void
}

const EPS = 1e-12
const mulU8 = (a: number, b: number): number => (((a * b + 127) / 255) | 0)
const clampUnit = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

function assetError(code: string, detail: string): Error & { code: string } {
  return Object.assign(new Error(`${code}: ${detail}`), { code })
}

function checkAssets(assets: RenderAssets): void {
  const { errors } = validateAssets(assets)
  if (errors.length > 0) throw assetError('E_ASSET_INVALID', errors.join('; '))
}

function spritePage(material: MaterialDef | null, pages: readonly TextureData[] | undefined): void {
  if (material?.kind === 'sprite' && pages?.[material.page] === undefined) {
    throw assetError('E_TEXTURE_MISSING', `材质 ${material.id} 的图集页 ${material.page} 缺失`)
  }
}

/** 点到线段距离（像素），用于 mask feather 软边。 */
function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 <= EPS) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

/** 奇偶规则点在多边形内；poly 为 [x0,y0,x1,y1,...] 的屏幕空间边界。 */
function pointInPolygon(poly: readonly number[], px: number, py: number): boolean {
  let inside = false
  const count = Math.floor(poly.length / 2)
  for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
    const xi = poly[i * 2]!
    const yi = poly[i * 2 + 1]!
    const xj = poly[j * 2]!
    const yj = poly[j * 2 + 1]!
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function distanceToPolygon(poly: readonly number[], px: number, py: number): number {
  const count = Math.floor(poly.length / 2)
  let best = Infinity
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % count
    const d = distanceToSegment(px, py, poly[i * 2]!, poly[i * 2 + 1]!, poly[j * 2]!, poly[j * 2 + 1]!)
    if (d < best) best = d
  }
  return best
}

/** 固定管线混合，全部在 PMA 域；multiply/screen 采用文档的受控近似。 */
function blendPixel(
  dst: Uint8ClampedArray, di: number,
  sr: number, sg: number, sb: number, sa: number,
  mode: BlendMode,
): void {
  const dr = dst[di]!
  const dg = dst[di + 1]!
  const db = dst[di + 2]!
  const da = dst[di + 3]!
  const inv = 255 - sa
  switch (mode) {
    case 'normal':
      dst[di] = sr + mulU8(dr, inv)
      dst[di + 1] = sg + mulU8(dg, inv)
      dst[di + 2] = sb + mulU8(db, inv)
      dst[di + 3] = sa + mulU8(da, inv)
      break
    case 'add':
      dst[di] = sr + dr
      dst[di + 1] = sg + dg
      dst[di + 2] = sb + db
      dst[di + 3] = sa + da
      break
    case 'multiply':
      // co = cb·(cs + 1 - as)
      dst[di] = mulU8(sr, dr) + mulU8(dr, inv)
      dst[di + 1] = mulU8(sg, dg) + mulU8(dg, inv)
      dst[di + 2] = mulU8(sb, db) + mulU8(db, inv)
      dst[di + 3] = sa + mulU8(da, inv)
      break
    case 'screen':
      // co = cs + cb·(1 - cs)
      dst[di] = sr + mulU8(dr, 255 - sr)
      dst[di + 1] = sg + mulU8(dg, 255 - sg)
      dst[di + 2] = sb + mulU8(db, 255 - sb)
      dst[di + 3] = sa + mulU8(da, inv)
      break
  }
}

interface ScreenVertex {
  x: number
  y: number
  u: number
  v: number
  z: number
  r: number
  g: number
  b: number
  a: number
  dr?: number
  dg?: number
  db?: number
  da?: number
}

/** 预转换到屏幕空间的 mask 上下文，避免逐像素做坐标变换。 */
interface MaskCtx {
  readonly mask: RenderMask
  readonly rect: { x0: number; y0: number; x1: number; y1: number }
  readonly poly: readonly number[] | null
  readonly alphaPage: TextureData | null
}

const edge = (a: ScreenVertex, b: ScreenVertex, x: number, y: number): number =>
  (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)

/** top-left 规则：共享边只归属一侧，避免相邻三角形裂缝或双重混合。 */
function insideEdge(e: number, a: ScreenVertex, b: ScreenVertex): boolean {
  if (e > 0) return true
  if (e < 0) return false
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dy === 0 && dx > 0) return true // 上边
  if (dy < 0) return true // 左边
  return false
}

export interface CpuBackendOptions {
  readonly width?: number
  readonly height?: number
  /** 超采样倍数：1=预算/CI，2=平滑边缘 */
  readonly supersample?: 1 | 2 | 4 | 8 | 16
  /** 背板背景色，RGBA 字节；默认不透明黑 */
  readonly background?: readonly [number, number, number, number]
}

/** 纯 TypeScript 参考光栅化器；不依赖 DOM/Canvas。 */
export class CpuBackend implements RenderBackend {
  readonly kind = 'cpu' as const
  readonly stats: BackendStats = {
    drawCalls: 0, packets: 0, batches: 0, textureBinds: 0, programSwitches: 0,
    uploadedBytes: 0, uploadedVertices: 0, maskTests: 0, textureSamples: 0,
  }

  private width: number
  private height: number
  private readonly ss: 1 | 2 | 4 | 8 | 16
  private readonly background: readonly [number, number, number, number]
  private color: Uint8ClampedArray
  private disposed = false
  /** prepare() 缓存的资产；frame.assets 优先。 */
  private assets: RenderAssets | null = null
  private depthBuffer: Float32Array | null = null
  private depthMode: 'none' | 'test' | 'write' = 'none'
  private material: MaterialDef | null = null
  private page: TextureData | null = null
  private masks: MaskCtx[] = []
  private readonly maskCache = new Map<RenderMask, MaskCtx>()

  constructor(options?: CpuBackendOptions)
  constructor(width: number, height: number, supersample?: 1 | 2 | 4 | 8 | 16)
  constructor(a: number | CpuBackendOptions = {}, b?: number, c?: 1 | 2 | 4 | 8 | 16) {
    const opts: CpuBackendOptions = typeof a === 'number'
      ? { width: a, height: b ?? 1, supersample: c ?? 1 }
      : a
    this.width = Math.max(1, Math.floor(opts.width ?? 1))
    this.height = Math.max(1, Math.floor(opts.height ?? 1))
    this.ss = opts.supersample ?? 1
    this.background = opts.background ?? [0, 0, 0, 255]
    this.color = new Uint8ClampedArray(this.width * this.ss * this.height * this.ss * 4)
    this.clear()
  }

  /** CPU 端资产只是引用；真正采样在 draw 时进行。 */
  prepare(assets: RenderAssets): void {
    checkAssets(assets)
    this.assets = assets
  }

  resize(v: Viewport): void {
    const w = Math.max(1, Math.floor(v.width))
    const h = Math.max(1, Math.floor(v.height))
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    this.color = new Uint8ClampedArray(w * this.ss * h * this.ss * 4)
    this.depthBuffer = null
    this.clear()
  }

  private clear(): void {
    const [r, g, b, a] = this.background
    // Materialize through the clamped view so fractional/out-of-range backgrounds retain their semantics.
    this.color[0] = r
    this.color[1] = g
    this.color[2] = b
    this.color[3] = a
    const packed = new Uint32Array(this.color.buffer)
    packed.fill(packed[0]!)
  }

  private toScreen(frame: RenderFrame, x: number, y: number): [number, number] {
    const m = frame.viewProjection
    if (m === undefined) return [x, y]
    if (m.length >= 16) {
      // 4x4 列主序：world → NDC → 设备像素。
      const cx = m[0]! * x + m[4]! * y + m[12]!
      const cy = m[1]! * x + m[5]! * y + m[13]!
      const cw = m[3]! * x + m[7]! * y + m[15]!
      const w = Math.abs(cw) < EPS ? EPS : cw
      return [(cx / w * 0.5 + 0.5) * frame.width, (0.5 - cy / w * 0.5) * frame.height]
    }
    if (m.length >= 9) {
      // 3x3 列主序，已是像素空间（见 camera.viewProjection2D）。
      const cx = m[0]! * x + m[3]! * y + m[6]!
      const cy = m[1]! * x + m[4]! * y + m[7]!
      const cw = m[2]! * x + m[5]! * y + m[8]!
      const w = Math.abs(cw) < EPS ? EPS : cw
      return [cx / w, cy / w]
    }
    return [x, y]
  }

  private rasterize(p0: ScreenVertex, p1: ScreenVertex, p2: ScreenVertex, ss: number, ssW: number, ssH: number): void {
    let area = edge(p0, p1, p2.x, p2.y)
    if (!Number.isFinite(area) || Math.abs(area) < EPS) return
    // 归一到屏幕空间正面积，保证 top-left 规则对任意绕序一致。
    if (area < 0) {
      const tmp = p1
      p1 = p2
      p2 = tmp
      area = -area
    }
    const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x) * ss - 0.5))
    const maxX = Math.min(ssW - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x) * ss - 0.5))
    const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y) * ss - 0.5))
    const maxY = Math.min(ssH - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y) * ss - 0.5))
    if (this.currentBlend === 'normal' && !this.currentTwoColor && this.page === null &&
        this.masks.length === 0 && this.depthMode === 'none' &&
        p0.a === 255 && p1.a === 255 && p2.a === 255 &&
        p0.r === p1.r && p1.r === p2.r &&
        p0.g === p1.g && p1.g === p2.g &&
        p0.b === p1.b && p1.b === p2.b) {
      const rgba = new Uint8ClampedArray([p0.r, p0.g, p0.b, 255])
      const packed = new Uint32Array(rgba.buffer)[0]!
      const pixels = new Uint32Array(this.color.buffer)
      const top0 = p2.y - p1.y < 0 || (p2.y === p1.y && p2.x > p1.x)
      const top1 = p0.y - p2.y < 0 || (p0.y === p2.y && p0.x > p2.x)
      const top2 = p1.y - p0.y < 0 || (p1.y === p0.y && p1.x > p0.x)
      for (let sy = minY; sy <= maxY; sy += 1) {
        const py = (sy + 0.5) / ss
        let di = sy * ssW + minX
        for (let sx = minX; sx <= maxX; sx += 1, di += 1) {
          const px = (sx + 0.5) / ss
          const w0 = edge(p1, p2, px, py)
          if (w0 < 0 || (w0 === 0 && !top0)) continue
          const w1 = edge(p2, p0, px, py)
          if (w1 < 0 || (w1 === 0 && !top1)) continue
          const w2 = edge(p0, p1, px, py)
          if (w2 < 0 || (w2 === 0 && !top2)) continue
          pixels[di] = packed
        }
      }
      return
    }
    for (let sy = minY; sy <= maxY; sy += 1) {
      const py = (sy + 0.5) / ss
      for (let sx = minX; sx <= maxX; sx += 1) {
        const px = (sx + 0.5) / ss
        const w0 = edge(p1, p2, px, py)
        if (!insideEdge(w0, p1, p2)) continue
        const w1 = edge(p2, p0, px, py)
        if (!insideEdge(w1, p2, p0)) continue
        const w2 = edge(p0, p1, px, py)
        if (!insideEdge(w2, p0, p1)) continue
        const b0 = w0 / area
        const b1 = w1 / area
        const b2 = w2 / area
        let r = Math.round(b0 * p0.r + b1 * p1.r + b2 * p2.r)
        let g = Math.round(b0 * p0.g + b1 * p1.g + b2 * p2.g)
        let b = Math.round(b0 * p0.b + b1 * p1.b + b2 * p2.b)
        const a = Math.round(b0 * p0.a + b1 * p1.a + b2 * p2.a)
        const dr = Math.round(b0 * (p0.dr ?? 0) + b1 * (p1.dr ?? 0) + b2 * (p2.dr ?? 0))
        const dg = Math.round(b0 * (p0.dg ?? 0) + b1 * (p1.dg ?? 0) + b2 * (p2.dg ?? 0))
        const db = Math.round(b0 * (p0.db ?? 0) + b1 * (p1.db ?? 0) + b2 * (p2.db ?? 0))
        const da = Math.round(b0 * (p0.da ?? 0) + b1 * (p1.da ?? 0) + b2 * (p2.da ?? 0))
        const u = b0 * p0.u + b1 * p1.u + b2 * p2.u
        const v = b0 * p0.v + b1 * p1.v + b2 * p2.v
        const z = b0 * p0.z + b1 * p1.z + b2 * p2.z
        this.shadeFragment(sx, sy, px, py, u, v, r, g, b, a, dr, dg, db, da, z)
      }
    }
  }

  /** 片元着色：mask → 深度 → 纹理调制 → 混合；纹理/顶点色都在 PMA 域只乘一次。 */
  private shadeFragment(
    sx: number, sy: number, px: number, py: number,
    u: number, v: number,
    r: number, g: number, b: number, a: number,
    dr: number, dg: number, db: number, da: number,
    z: number,
  ): void {
    if (a <= 0) return
    const ssW = this.width * this.ss
    let coverage = 1
    for (const ctx of this.masks) {
      this.stats.maskTests += 1
      coverage *= this.maskCoverageAt(ctx, px / this.ss, py / this.ss)
      if (coverage <= 0) return
    }
    if (this.depthMode !== 'none' && this.depthBuffer !== null) {
      const di = sy * ssW + sx
      const current = this.depthBuffer[di] ?? 1
      if (!Number.isFinite(z) || z >= current) return
      if (this.depthMode === 'write') this.depthBuffer[di] = z
    }
    let texel: [number, number, number, number] = [255, 255, 255, 255]
    if (this.material !== null && this.material.kind === 'sprite' && this.page !== null) {
      texel = sampleTexture(this.page, u, v, this.page.magFilter ?? this.page.filter ?? this.material.filter)
      this.stats.textureSamples += 1
    }
    if (this.currentTwoColor) {
      const tintBlack = this.material?.tintBlack === true
      const darkFactor = (texel[3] - 255) * (tintBlack ? 255 : da) / 255 + 255
      r = Math.round((darkFactor - texel[0]) * (tintBlack ? 0 : dr) / 255 + texel[0] * r / 255)
      g = Math.round((darkFactor - texel[1]) * (tintBlack ? 0 : dg) / 255 + texel[1] * g / 255)
      b = Math.round((darkFactor - texel[2]) * (tintBlack ? 0 : db) / 255 + texel[2] * b / 255)
    } else {
      r = mulU8(texel[0], r)
      g = mulU8(texel[1], g)
      b = mulU8(texel[2], b)
    }
    a = mulU8(texel[3], a)
    if (coverage < 1) {
      const c = Math.round(coverage * 255)
      r = mulU8(r, c)
      g = mulU8(g, c)
      b = mulU8(b, c)
      a = mulU8(a, c)
    }
    if (a <= 0) return
    blendPixel(this.color, (sy * ssW + sx) * 4, r, g, b, a, this.currentBlend)
  }

  /** 把 mask 的 world 几何预转换到屏幕空间；同一帧内按对象缓存。 */
  private maskCtxFor(mask: RenderMask, frame: RenderFrame, assets: RenderAssets | null): MaskCtx {
    const cached = this.maskCache.get(mask)
    if (cached !== undefined) return cached
    const corners: Array<[number, number]> = [
      this.toScreen(frame, mask.bounds.x, mask.bounds.y),
      this.toScreen(frame, mask.bounds.x + mask.bounds.width, mask.bounds.y),
      this.toScreen(frame, mask.bounds.x + mask.bounds.width, mask.bounds.y + mask.bounds.height),
      this.toScreen(frame, mask.bounds.x, mask.bounds.y + mask.bounds.height),
    ]
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const [x, y] of corners) {
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
    let poly: number[] | null = null
    if (mask.mode === 'stencil') {
      poly = []
      for (let i = 0; i + 1 < mask.positions.length; i += 2) {
        const [sx, sy] = this.toScreen(frame, mask.positions[i]!, mask.positions[i + 1]!)
        poly.push(sx, sy)
      }
    }
    let alphaPage: TextureData | null = null
    if (mask.mode === 'alpha' && mask.alpha !== undefined && assets !== null) {
      alphaPage = assets.pages[mask.alpha.page] ?? null
    }
    const ctx: MaskCtx = { mask, rect: { x0, y0, x1, y1 }, poly, alphaPage }
    this.maskCache.set(mask, ctx)
    return ctx
  }

  /** 像素点（设备像素）的 mask 覆盖率 0..1；invert 作用于单层。 */
  private maskCoverageAt(ctx: MaskCtx, px: number, py: number): number {
    const mask = ctx.mask
    let coverage = 0
    if (mask.mode === 'scissor') {
      const r = ctx.rect
      coverage = px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1 ? 1 : 0
    } else if (mask.mode === 'stencil') {
      const poly = ctx.poly ?? []
      const inside = pointInPolygon(poly, px, py)
      if (mask.feather > 0) {
        const d = distanceToPolygon(poly, px, py)
        coverage = clampUnit(0.5 + (inside ? d : -d) / mask.feather)
      } else {
        coverage = inside ? 1 : 0
      }
    } else {
      const page = ctx.alphaPage
      const alpha = mask.alpha
      if (page === null || alpha === undefined) {
        coverage = 0
      } else {
        const r = ctx.rect
        const u = r.x1 > r.x0 ? (px - r.x0) / (r.x1 - r.x0) : 0
        const v = r.y1 > r.y0 ? (py - r.y0) / (r.y1 - r.y0) : 0
        const m = alpha.uvMatrix
        const up = m[0]! * u + m[2]! * v + m[4]!
        const vp = m[1]! * u + m[3]! * v + m[5]!
        const a = sampleTexture(page, up, vp, 'linear')[3]
        coverage = mask.feather > 0 ? a / 255 : a >= 128 ? 1 : 0
      }
    }
    return mask.invert ? 1 - coverage : coverage
  }

  private currentBlend: BlendMode = 'normal'
  private currentTwoColor = false

  draw(frame: RenderFrame): void {
    if (this.disposed) throw new Error('CpuBackend: 已 dispose，不能继续 draw')
    if (frame.width !== this.width || frame.height !== this.height) {
      this.resize({ width: frame.width, height: frame.height })
    }
    this.clear()
    this.stats.drawCalls = 0
    this.stats.packets = 0
    this.stats.batches = 0
    this.stats.textureBinds = 0
    this.stats.programSwitches = 0
    this.stats.uploadedBytes = 0
    this.stats.uploadedVertices = 0
    this.stats.maskTests = 0
    this.stats.textureSamples = 0
    const ss = this.ss
    const ssW = this.width * ss
    const ssH = this.height * ss
    if (frame.assets !== undefined && frame.assets !== this.assets) this.prepare(frame.assets)
    const assets = frame.assets ?? this.assets
    this.depthMode = frame.depthMode ?? 'none'
    if (this.depthMode !== 'none') {
      const size = ssW * ssH
      if (this.depthBuffer === null || this.depthBuffer.length !== size) {
        this.depthBuffer = new Float32Array(size)
      }
      this.depthBuffer.fill(1)
    } else {
      this.depthBuffer = null
    }
    this.maskCache.clear()

    for (const packet of frame.packets) {
      this.stats.packets += 1
      this.stats.batches += 1
      this.stats.drawCalls += 1
      this.currentBlend = packet.blend
      this.material = assets?.materials.find((m) => m.id === packet.materialId) ?? null
      this.currentTwoColor = (packet.twoColor === true && packet.dark !== undefined) || this.material?.tintBlack === true
      spritePage(this.material, assets?.pages)
      this.page = this.material !== null && this.material.kind === 'sprite' && assets !== null
        ? assets.pages[this.material.page] ?? null
        : null
      this.masks = []
      if (frame.maskPaths !== undefined && frame.masks !== undefined && packet.maskPath >= 0) {
        const chain = maskChain(packet.maskPath, frame.maskPaths)
        if (!chain.error) {
          for (const id of chain.ids) {
            const mask = frame.masks.masks[id]
            if (mask !== null && mask !== undefined) this.masks.push(this.maskCtxFor(mask, frame, assets))
          }
        }
      }

      const vertexCount = Math.min(Math.floor(packet.uvs.length / 2), Math.floor(packet.positions.length / 2))
      if (vertexCount <= 0) continue
      this.stats.uploadedVertices += vertexCount
      const stride = vertexCount > 0 ? packet.positions.length / vertexCount : 0
      if (!Number.isFinite(stride) || stride < 2) continue

      const verts: ScreenVertex[] = []
      for (let i = 0; i < vertexCount; i += 1) {
        const [x, y] = this.toScreen(frame, packet.positions[i * stride]!, packet.positions[i * stride + 1]!)
        const o = i * 4
        const uv = i * 2
        const dark = packet.dark
        const z = packet.depth !== null
          ? clampUnit(packet.depth[i] ?? 1)
          : clampUnit(0.5 - packet.depthKey * 0.01)
        verts.push({
          x: x * ss, y: y * ss,
          u: packet.uvs[uv] ?? 0, v: packet.uvs[uv + 1] ?? 0,
          z,
          r: packet.colors[o]!, g: packet.colors[o + 1]!,
          b: packet.colors[o + 2]!, a: packet.colors[o + 3]!,
          dr: dark?.[o] ?? 0, dg: dark?.[o + 1] ?? 0,
          db: dark?.[o + 2] ?? 0, da: dark?.[o + 3] ?? 0,
        })
      }
      for (let t = 0; t + 2 < packet.indices.length; t += 3) {
        const i0 = packet.indices[t]!
        const i1 = packet.indices[t + 1]!
        const i2 = packet.indices[t + 2]!
        const v0 = verts[i0]
        const v1 = verts[i1]
        const v2 = verts[i2]
        if (v0 === undefined || v1 === undefined || v2 === undefined) continue
        this.rasterize(v0, v1, v2, 1, ssW, ssH)
      }
    }
  }

  readPixels(out?: Uint8ClampedArray): Uint8ClampedArray {
    if (this.disposed) throw new Error('CpuBackend: 已 dispose')
    const size = this.width * this.height * 4
    const target = out ?? new Uint8ClampedArray(size)
    if (target.length !== size) throw new RangeError('CpuBackend.readPixels: 输出缓冲尺寸不匹配')
    if (this.ss === 1) {
      target.set(this.color)
      return target
    }
    // 超采样：box filter 在 PMA 域下采样。
    const ssW = this.width * this.ss
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const o = (y * this.width + x) * 4
        for (let c = 0; c < 4; c += 1) {
          let sum = 0
          for (let sy = 0; sy < this.ss; sy += 1) {
            for (let sx = 0; sx < this.ss; sx += 1) {
              sum += this.color[((y * this.ss + sy) * ssW + x * this.ss + sx) * 4 + c]!
            }
          }
          target[o + c] = Math.round(sum / (this.ss * this.ss))
        }
      }
    }
    return target
  }

  dispose(): void {
    this.disposed = true
    this.color = new Uint8ClampedArray(0)
  }
}

const GL_ARRAY_BUFFER = 0x8892
const GL_ELEMENT_ARRAY_BUFFER = 0x8893
const GL_DYNAMIC_DRAW = 0x88e8
const GL_FLOAT = 0x1406
const GL_UNSIGNED_BYTE = 0x1401
const GL_UNSIGNED_SHORT = 0x1403
const GL_UNSIGNED_INT = 0x1405
const GL_TRIANGLES = 0x0004
const GL_RGBA = 0x1908
const GL_RGBA8 = 0x8058
const GL_TEXTURE_2D = 0x0de1
const GL_TEXTURE0 = 0x84c0
const GL_TEXTURE1 = 0x84c1
const GL_TEXTURE_MIN_FILTER = 0x2801
const GL_TEXTURE_MAG_FILTER = 0x2800
const GL_TEXTURE_WRAP_S = 0x2802
const GL_TEXTURE_WRAP_T = 0x2803
const GL_LINEAR = 0x2601
const GL_NEAREST = 0x2600
const GL_LINEAR_MIPMAP_LINEAR = 0x2703
const GL_NEAREST_MIPMAP_NEAREST = 0x2700
const GL_LINEAR_MIPMAP_NEAREST = 0x2701
const GL_NEAREST_MIPMAP_LINEAR = 0x2702
const GL_CLAMP_TO_EDGE = 0x812f
const GL_REPEAT = 0x2901
/** 全局 UNPACK 状态：上传后必须恢复 0，否则会重复预乘。 */
const GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9240
const GL_SCISSOR_TEST = 0x0c11
const GL_BLEND = 0x0be2
const GL_ONE = 1
const GL_ONE_MINUS_SRC_ALPHA = 0x0303
const GL_DST_COLOR = 0x0306
const GL_ONE_MINUS_SRC_COLOR = 0x0301
const GL_STENCIL_TEST = 0x0b90
const GL_DEPTH_TEST = 0x0b71
const GL_ALWAYS = 0x0207
const GL_EQUAL = 0x0202
const GL_NOTEQUAL = 0x0205
const GL_LEQUAL = 0x0203
const GL_KEEP = 0x1e00
const GL_REPLACE = 0x1e01
const GL_STENCIL_BUFFER_BIT = 0x0400
const GL_STENCIL_BITS = 0x0d57
const GL_DEPTH_BUFFER_BIT = 0x0100

function indexType(indices: Uint16Array | Uint32Array): number {
  return indices instanceof Uint16Array ? GL_UNSIGNED_SHORT : GL_UNSIGNED_INT
}

/** WebGL2 所需的最小接口；方法全部可选，便于注入 mock 并做能力降级。 */
export interface WebGL2Like {
  createBuffer?(): unknown
  deleteBuffer?(buffer: unknown): void
  bindBuffer?(target: number, buffer: unknown): void
  bufferData?(target: number, data: ArrayBufferView | number, usage: number): void
  bufferSubData?(target: number, offset: number, data: ArrayBufferView): void
  getAttribLocation?(program: unknown, name: string): number
  enableVertexAttribArray?(index: number): void
  disableVertexAttribArray?(index: number): void
  vertexAttrib4f?(index: number, x: number, y: number, z: number, w: number): void
  vertexAttribPointer?(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void
  getUniformLocation?(program: unknown, name: string): unknown
  uniformMatrix3fv?(location: unknown, transpose: boolean, value: ArrayLike<number>): void
  uniformMatrix4fv?(location: unknown, transpose: boolean, value: ArrayLike<number>): void
  uniform1i?(location: unknown, value: number): void
  uniform1f?(location: unknown, value: number): void
  uniform2f?(location: unknown, x: number, y: number): void
  uniform4f?(location: unknown, x: number, y: number, z: number, w: number): void
  createShader?(type: number): unknown
  shaderSource?(shader: unknown, source: string): void
  compileShader?(shader: unknown): void
  getShaderParameter?(shader: unknown, pname: number): boolean
  deleteShader?(shader: unknown): void
  createProgram?(): unknown
  attachShader?(program: unknown, shader: unknown): void
  linkProgram?(program: unknown): void
  getProgramParameter?(program: unknown, pname: number): boolean
  useProgram?(program: unknown): void
  drawElements?(mode: number, count: number, type: number, offset: number): void
  readPixels?(x: number, y: number, width: number, height: number, format: number, type: number, dst: Uint8Array): void
  createTexture?(): unknown
  deleteTexture?(texture: unknown): void
  bindTexture?(target: number, texture: unknown): void
  activeTexture?(texture: number): void
  texImage2D?(
    target: number, level: number, internalformat: number,
    width: number, height: number, border: number,
    format: number, type: number, pixels: ArrayBufferView | null,
  ): void
  texParameteri?(target: number, pname: number, param: number): void
  generateMipmap?(target: number): void
  pixelStorei?(pname: number, param: number): void
  scissor?(x: number, y: number, width: number, height: number): void
  blendFunc?(sfactor: number, dfactor: number): void
  enable?(cap: number): void
  disable?(cap: number): void
  stencilFunc?(func: number, ref: number, mask: number): void
  stencilOp?(fail: number, zfail: number, zpass: number): void
  stencilMask?(mask: number): void
  getParameter?(pname: number): unknown
  clearStencil?(s: number): void
  colorMask?(r: boolean, g: boolean, b: boolean, a: boolean): void
  depthFunc?(func: number): void
  depthMask?(flag: boolean): void
  clear?(mask: number): void
}

interface GLBuffers {
  positions: unknown
  uvs: unknown
  colors: unknown
  darks: unknown
  indices: unknown
}

const GL_VERTEX_SHADER = 0x8b31
const GL_FRAGMENT_SHADER = 0x8b30
const GL_COMPILE_STATUS = 0x8b81
const GL_LINK_STATUS = 0x8b82

// 默认程序也支持 alpha mask；是否采样由 uAlphaMask 逐包控制。
const DEFAULT_VERTEX_SHADER = VERTEX
const DEFAULT_FRAGMENT_SHADER = FRAGMENT.replace('#version 300 es', '#version 300 es\n#define ALPHA_MASK 1\n#define TWO_COLOR 1')

/** 真实 GL 下默认编译内置 shader；mock 缺少 shader 方法时退回空 program。 */
function compileDefaultProgram(gl: WebGL2Like): object | null {
  if (gl.createShader === undefined || gl.createProgram === undefined ||
      gl.shaderSource === undefined || gl.compileShader === undefined ||
      gl.attachShader === undefined || gl.linkProgram === undefined) return null
  const vs = gl.createShader(GL_VERTEX_SHADER)
  const fs = gl.createShader(GL_FRAGMENT_SHADER)
  gl.shaderSource?.(vs, DEFAULT_VERTEX_SHADER)
  gl.shaderSource?.(fs, DEFAULT_FRAGMENT_SHADER)
  gl.compileShader?.(vs)
  gl.compileShader?.(fs)
  if (gl.getShaderParameter?.(vs, GL_COMPILE_STATUS) === false ||
      gl.getShaderParameter?.(fs, GL_COMPILE_STATUS) === false) {
    gl.deleteShader?.(vs)
    gl.deleteShader?.(fs)
    return null
  }
  const program = gl.createProgram()
  gl.attachShader?.(program, vs)
  gl.attachShader?.(program, fs)
  gl.linkProgram?.(program)
  gl.deleteShader?.(vs)
  gl.deleteShader?.(fs)
  if (gl.getProgramParameter?.(program, GL_LINK_STATUS) === false) return null
  return program as object
}

/** 按 frame.packets 原始顺序逐包上传并 drawElements，绝不重排。 */
export class WebGL2Backend implements RenderBackend {
  readonly kind = 'webgl2' as const
  readonly stats: BackendStats = {
    drawCalls: 0, packets: 0, batches: 0, textureBinds: 0, programSwitches: 0,
    uploadedBytes: 0, uploadedVertices: 0, maskTests: 0, textureSamples: 0,
  }
  /** 上下文恢复次数，供测试/诊断。 */
  restoreCount = 0

  private readonly gl: WebGL2Like
  private buffers: GLBuffers | null = null
  private readonly capacities = new Map<unknown, number>()
  private program: object
  private readonly programCache: ProgramCache | null
  private width = 1
  private height = 1
  private pixels: Uint8ClampedArray = new Uint8ClampedArray(4)
  private disposed = false
  private assets: RenderAssets | null = null
  private currentBlend: BlendMode | null = null
  private textures: unknown[] = []
  private whiteTexture: unknown = null

  constructor(gl: WebGL2Like, program?: object, programCache?: ProgramCache) {
    if (gl === null || typeof gl !== 'object') throw new Error('WebGL2Backend: 缺少 gl 上下文')
    if (typeof gl.drawElements !== 'function') throw new Error('WebGL2Backend: gl.drawElements 不可用，无法提交绘制')
    if (gl.getParameter !== undefined && Number(gl.getParameter(GL_STENCIL_BITS)) < 1) {
      throw new Error('WebGL2Backend: 缺少 stencil buffer（创建上下文时需指定 stencil: true）')
    }
    this.gl = gl
    this.program = program ?? compileDefaultProgram(gl) ?? {}
    this.programCache = programCache ?? null
    if (typeof gl.createBuffer === 'function') {
      this.buffers = {
        positions: gl.createBuffer(),
        uvs: gl.createBuffer(),
        colors: gl.createBuffer(),
        darks: gl.createBuffer(),
        indices: gl.createBuffer(),
      }
    }
  }

  /** 上传页纹理与 1x1 白纹理；帧切换资产时同步更新页绑定。 */
  prepare(assets: RenderAssets): void {
    checkAssets(assets)
    if (this.textures.length > 0) {
      for (const texture of this.textures) this.gl.deleteTexture?.(texture)
      if (this.whiteTexture !== null) this.gl.deleteTexture?.(this.whiteTexture)
    }
    this.assets = assets
    this.uploadAssets(assets)
  }

  private uploadAssets(assets: RenderAssets): void {
    const gl = this.gl
    this.textures = []
    this.whiteTexture = null
    if (typeof gl.createTexture !== 'function') return
    const filterOf = (index: number): 'linear' | 'nearest' => {
      const material = assets.materials.find((m) => m.kind === 'sprite' && m.page === index)
      return material?.filter ?? 'linear'
    }
    for (let i = 0; i < assets.pages.length; i += 1) {
      const page = assets.pages[i]!
      const texture = gl.createTexture()
      gl.activeTexture?.(GL_TEXTURE0 + i)
      this.bindTexture(GL_TEXTURE_2D, texture)
      // straight 页在 CPU 做唯一一次预乘；同时把 GL 全局预乘状态压回 0，避免重复乘。
      const pixels = page.pma === false ? premultiply(page.data) : page.data
      gl.pixelStorei?.(GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
      gl.texImage2D?.(
        GL_TEXTURE_2D, 0, GL_RGBA8, page.width, page.height, 0,
        GL_RGBA, GL_UNSIGNED_BYTE, pixels,
      )
      const nearest = (page.magFilter ?? page.filter ?? filterOf(i)) === 'nearest'
      const mipmap = page.mipmap === true || (page.minFilter?.startsWith('mipmap') ?? false)
      const minFilter = (() => {
        switch (page.minFilter) {
          case 'nearest': return GL_NEAREST
          case 'linear': return GL_LINEAR
          case 'mipmapNearestNearest': return GL_NEAREST_MIPMAP_NEAREST
          case 'mipmapLinearNearest': return GL_LINEAR_MIPMAP_NEAREST
          case 'mipmapNearestLinear': return GL_NEAREST_MIPMAP_LINEAR
          case 'mipmap':
          case 'mipmapLinearLinear': return GL_LINEAR_MIPMAP_LINEAR
          default: return mipmap
            ? (nearest ? GL_NEAREST_MIPMAP_NEAREST : GL_LINEAR_MIPMAP_LINEAR)
            : (nearest ? GL_NEAREST : GL_LINEAR)
        }
      })()
      gl.texParameteri?.(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, minFilter)
      gl.texParameteri?.(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, nearest ? GL_NEAREST : GL_LINEAR)
      gl.texParameteri?.(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, (page.uWrap ?? page.wrap) === 'repeat' ? GL_REPEAT : GL_CLAMP_TO_EDGE)
      gl.texParameteri?.(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, (page.vWrap ?? page.wrap) === 'repeat' ? GL_REPEAT : GL_CLAMP_TO_EDGE)
      if (mipmap) gl.generateMipmap?.(GL_TEXTURE_2D)
      this.textures.push(texture)
    }
    // flat 材质绑定 1x1 白纹理，配合 uUseTexture=0 走纯顶点色。
    const white = gl.createTexture()
    gl.activeTexture?.(GL_TEXTURE0)
    this.bindTexture(GL_TEXTURE_2D, white)
    gl.texImage2D?.(
      GL_TEXTURE_2D, 0, GL_RGBA8, 1, 1, 0,
      GL_RGBA, GL_UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]),
    )
    gl.texParameteri?.(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST)
    gl.texParameteri?.(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST)
    gl.texParameteri?.(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE)
    gl.texParameteri?.(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)
    this.whiteTexture = white
    // 上传结束：UNPACK 预乘是全局状态，恢复默认值，避免污染后续上传。
    gl.pixelStorei?.(GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
  }

  /** 上下文恢复：重建 buffer/texture/Program 状态，并记录次数。 */
  restore(): void {
    this.disposed = false
    const gl = this.gl
    if (typeof gl.createBuffer === 'function') {
      this.buffers = {
        positions: gl.createBuffer(),
        uvs: gl.createBuffer(),
        colors: gl.createBuffer(),
        darks: gl.createBuffer(),
        indices: gl.createBuffer(),
      }
    } else {
      this.buffers = null
    }
    this.capacities.clear()
    this.gl.useProgram?.(this.program)
    if (this.assets !== null) this.uploadAssets(this.assets)
    this.restoreCount += 1
  }

  resize(v: Viewport): void {
    this.width = Math.max(1, Math.floor(v.width))
    this.height = Math.max(1, Math.floor(v.height))
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4)
  }

  private upload(target: number, buffer: unknown, data: ArrayBufferView): void {
    const gl = this.gl
    if (buffer === null || buffer === undefined || gl.bindBuffer === undefined ||
        gl.bufferSubData === undefined) return
    gl.bindBuffer(target, buffer)
    const need = data.byteLength
    const have = this.capacities.get(buffer) ?? 0
    if (need > have && gl.bufferData !== undefined) {
      gl.bufferData(target, need, GL_DYNAMIC_DRAW)
      this.capacities.set(buffer, need)
    }
    gl.bufferSubData(target, 0, data)
    this.stats.uploadedBytes += data.byteLength
  }

  private setAttrib(name: string, size: number, type: number, normalized: boolean): void {
    const gl = this.gl
    const loc = gl.getAttribLocation?.(this.program, name)
    if (loc === undefined || loc < 0 || gl.enableVertexAttribArray === undefined ||
        gl.vertexAttribPointer === undefined) return
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, size, type, normalized, 0, 0)
  }

  private resetDarkAttrib(): void {
    const gl = this.gl
    const loc = gl.getAttribLocation?.(this.program, 'aDark')
    if (loc === undefined || loc < 0) return
    gl.disableVertexAttribArray?.(loc)
    gl.vertexAttrib4f?.(loc, 0, 0, 0, 0)
  }

  private setUniform1f(name: string, value: number): void {
    const gl = this.gl
    if (gl.getUniformLocation === undefined || gl.uniform1f === undefined) return
    const loc = gl.getUniformLocation(this.program, name)
    if (loc !== null && loc !== undefined) gl.uniform1f(loc, value)
  }

  private setResolution(width: number, height: number): void {
    const gl = this.gl
    if (gl.getUniformLocation === undefined || gl.uniform2f === undefined) return
    const loc = gl.getUniformLocation(this.program, 'uResolution')
    if (loc !== null && loc !== undefined) gl.uniform2f(loc, width, height)
  }

  private setViewProjection(vp: Float32Array | undefined): void {
    const gl = this.gl
    if (gl.getUniformLocation === undefined || gl.uniformMatrix3fv === undefined) return
    const loc = gl.getUniformLocation(this.program, 'viewProjection')
    if (loc === null || loc === undefined) return
    if (vp !== undefined && vp.length >= 16) {
      // The shader accepts pixel-space mat3; convert the 4x4 NDC affine projection.
      gl.uniformMatrix3fv(loc, false, new Float32Array([
        vp[0]! * this.width / 2, -vp[1]! * this.height / 2, 0,
        vp[4]! * this.width / 2, -vp[5]! * this.height / 2, 0,
        (vp[12]! + 1) * this.width / 2, (1 - vp[13]!) * this.height / 2, 1,
      ]))
    } else {
      gl.uniformMatrix3fv(loc, false, vp?.length === 9 ? vp : new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]))
    }
  }

  private setUniform1i(name: string, value: number): void {
    const gl = this.gl
    if (gl.getUniformLocation === undefined || gl.uniform1i === undefined) return
    const loc = gl.getUniformLocation(this.program, name)
    if (loc === null || loc === undefined) return
    gl.uniform1i(loc, value)
  }

  private maskMode(frame: RenderFrame, path: number): 'none' | 'stencil' | 'alpha' {
    if (path < 0 || frame.maskPaths === undefined || frame.masks === undefined) return 'none'
    const chain = maskChain(path, frame.maskPaths)
    if (chain.error) return 'none'
    let mode: 'none' | 'stencil' | 'alpha' = 'none'
    for (const id of chain.ids) {
      const mask = frame.masks.masks[id]
      if (mask?.mode === 'alpha') {
        if (mode === 'alpha') throw new Error('WebGL2Backend: 多级 alpha mask 尚不支持')
        mode = 'alpha'
      } else if (mask?.mode === 'stencil' && mode === 'none') {
        mode = 'stencil'
      }
    }
    return mode
  }

  private bindTexture(target: number, texture: unknown): void {
    if (this.gl.bindTexture === undefined) return
    this.gl.bindTexture(target, texture)
    this.stats.textureBinds += 1
  }

  private useProgram(program: object): void {
    if (this.gl.useProgram === undefined) return
    this.gl.useProgram(program)
    this.stats.programSwitches += 1
  }

  private setAlphaMask(mask: RenderMask, frame: RenderFrame): void {
    const alpha = mask.alpha
    const texture = alpha === undefined ? undefined : this.textures[alpha.page]
    if (texture === undefined) throw assetError('E_TEXTURE_MISSING', `alpha mask ${mask.id} 的纹理页缺失`)
    const { x, y, width, height } = mask.bounds
    const corners = [
      this.toScreen(frame, x, y), this.toScreen(frame, x + width, y),
      this.toScreen(frame, x, y + height), this.toScreen(frame, x + width, y + height),
    ]
    const xs = corners.map((corner) => corner[0])
    const ys = corners.map((corner) => corner[1])
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const gl = this.gl
    gl.activeTexture?.(GL_TEXTURE1)
    this.bindTexture(GL_TEXTURE_2D, texture)
    this.setUniform1i('uMask', 1)
    const loc = gl.getUniformLocation?.(this.program, 'uMaskBounds')
    if (loc !== null && loc !== undefined) {
      gl.uniform4f?.(loc, minX, minY, Math.max(Math.max(...xs) - minX, EPS), Math.max(Math.max(...ys) - minY, EPS))
    }
    const m = alpha!.uvMatrix
    const matrix = new Float32Array([m[0]!, m[1]!, 0, m[2]!, m[3]!, 0, m[4]!, m[5]!, 1])
    const matrixLoc = gl.getUniformLocation?.(this.program, 'uMaskUvMatrix')
    if (matrixLoc !== null && matrixLoc !== undefined) gl.uniformMatrix3fv?.(matrixLoc, false, matrix)
    this.setUniform1f('uMaskInvert', mask.invert ? 1 : 0)
    this.setUniform1f('uMaskFeather', mask.feather)
    this.setUniform1f('uAlphaMask', 1)
  }

  /** world 包围盒 → 设备像素矩形；无 viewProjection 时按像素坐标直通。 */
  private projectBounds(frame: RenderFrame, bounds: RenderMask['bounds']): { x: number; y: number; width: number; height: number } {
    const corners: Array<[number, number]> = [
      this.toScreen(frame, bounds.x, bounds.y),
      this.toScreen(frame, bounds.x + bounds.width, bounds.y),
      this.toScreen(frame, bounds.x + bounds.width, bounds.y + bounds.height),
      this.toScreen(frame, bounds.x, bounds.y + bounds.height),
    ]
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of corners) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    const x = Math.floor(minX)
    const y = Math.floor(minY)
    return { x, y, width: Math.max(0, Math.ceil(maxX) - x), height: Math.max(0, Math.ceil(maxY) - y) }
  }

  private toScreen(frame: RenderFrame, x: number, y: number): [number, number] {
    const m = frame.viewProjection
    if (m === undefined) return [x, y]
    if (m.length >= 16) {
      const cx = m[0]! * x + m[4]! * y + m[12]!
      const cy = m[1]! * x + m[5]! * y + m[13]!
      const cw = m[3]! * x + m[7]! * y + m[15]!
      const w = Math.abs(cw) < EPS ? EPS : cw
      return [(cx / w * 0.5 + 0.5) * frame.width, (0.5 - cy / w * 0.5) * frame.height]
    }
    if (m.length >= 9) {
      const cx = m[0]! * x + m[3]! * y + m[6]!
      const cy = m[1]! * x + m[4]! * y + m[7]!
      const cw = m[2]! * x + m[5]! * y + m[8]!
      const w = Math.abs(cw) < EPS ? EPS : cw
      return [cx / w, cy / w]
    }
    return [x, y]
  }

  /** 应用 packet 的 mask 链；返回需要清理的状态。 */
  private applyMasks(
    frame: RenderFrame,
    packetMaskPath: number,
    assets: RenderAssets | null,
  ): { scissor: boolean; stencil: boolean } {
    const state = { scissor: false, stencil: false }
    if (frame.maskPaths === undefined || frame.masks === undefined || packetMaskPath < 0) return state
    const chain = maskChain(packetMaskPath, frame.maskPaths)
    if (chain.error) return state

    // 先合并所有 scissor 为单个矩形（取交集）。
    let rect: { x: number; y: number; width: number; height: number } | null = null
    for (const id of chain.ids) {
      const mask = frame.masks.masks[id]
      if (mask === null || mask === undefined) continue
      this.stats.maskTests += 1
      if (mask.mode !== 'scissor') continue
      const r = this.projectBounds(frame, mask.bounds)
      if (rect === null) rect = r
      else {
        const x0 = Math.max(rect.x, r.x)
        const y0 = Math.max(rect.y, r.y)
        const x1 = Math.min(rect.x + rect.width, r.x + r.width)
        const y1 = Math.min(rect.y + rect.height, r.y + r.height)
        rect = { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
      }
    }
    if (rect !== null) {
      this.gl.enable?.(GL_SCISSOR_TEST)
      this.gl.scissor?.(rect.x, rect.y, rect.width, rect.height)
      state.scissor = true
    }

    for (const id of chain.ids) {
      const mask = frame.masks.masks[id]
      if (mask === null || mask === undefined) continue
      if (mask.mode === 'stencil') {
        const gl = this.gl
        gl.enable?.(GL_STENCIL_TEST)
        gl.colorMask?.(false, false, false, false)
        gl.stencilMask?.(0xff)
        gl.clearStencil?.(0)
        gl.clear?.(GL_STENCIL_BUFFER_BIT)
        gl.stencilFunc?.(GL_ALWAYS, 1, 0xff)
        gl.stencilOp?.(GL_KEEP, GL_KEEP, GL_REPLACE)
        // Mask geometry must not be rejected by the packet depth test.
        gl.disable?.(GL_DEPTH_TEST)
        // mask 是独立几何：必须上传自己的顶点/索引，不能复用上一个 packet 的 buffer。
        this.upload(GL_ARRAY_BUFFER, this.buffers?.positions, mask.positions)
        this.setAttrib('aPosition', 2, GL_FLOAT, false)
        this.upload(GL_ELEMENT_ARRAY_BUFFER, this.buffers?.indices, mask.indices)
        this.setUniform1f('uUseTexture', 0)
        gl.drawElements?.(GL_TRIANGLES, mask.indices.length, indexType(mask.indices), 0)
        if (frame.depthMode !== undefined && frame.depthMode !== 'none') gl.enable?.(GL_DEPTH_TEST)
        gl.colorMask?.(true, true, true, true)
        gl.stencilMask?.(0x00)
        gl.stencilFunc?.(mask.invert ? GL_NOTEQUAL : GL_EQUAL, 1, 0xff)
        gl.stencilOp?.(GL_KEEP, GL_KEEP, GL_KEEP)
        state.stencil = true
      } else if (mask.mode === 'alpha') {
        this.setAlphaMask(mask, frame)
      }
    }
    return state
  }

  private resetMaskState(state: { scissor: boolean; stencil: boolean }): void {
    if (state.scissor) this.gl.disable?.(GL_SCISSOR_TEST)
    if (state.stencil) this.gl.disable?.(GL_STENCIL_TEST)
    if (state.stencil) this.gl.stencilMask?.(0xff)
    this.gl.colorMask?.(true, true, true, true)
    this.gl.activeTexture?.(GL_TEXTURE0)
  }

  /** H1：每个 packet 的混合状态显式设置；连续同模式不重复切换。 */
  private applyBlend(mode: BlendMode): void {
    if (this.currentBlend === mode) return
    this.gl.enable?.(GL_BLEND)
    switch (mode) {
      case 'normal': this.gl.blendFunc?.(GL_ONE, GL_ONE_MINUS_SRC_ALPHA); break
      case 'add': this.gl.blendFunc?.(GL_ONE, GL_ONE); break
      case 'multiply': this.gl.blendFunc?.(GL_DST_COLOR, GL_ONE_MINUS_SRC_ALPHA); break
      case 'screen': this.gl.blendFunc?.(GL_ONE, GL_ONE_MINUS_SRC_COLOR); break
    }
    this.currentBlend = mode
  }

  draw(frame: RenderFrame): void {
    if (this.disposed) throw new Error('WebGL2Backend: 已 dispose，不能继续 draw')
    if (frame.width !== this.width || frame.height !== this.height) {
      this.resize({ width: frame.width, height: frame.height })
    }
    this.stats.drawCalls = 0
    this.stats.packets = 0
    this.stats.batches = 0
    this.stats.textureBinds = 0
    this.stats.programSwitches = 0
    this.stats.uploadedBytes = 0
    this.stats.uploadedVertices = 0
    this.stats.maskTests = 0
    this.stats.textureSamples = 0
    const gl = this.gl
    this.useProgram(this.program)
    this.setViewProjection(frame.viewProjection)
    this.setResolution(frame.width, frame.height)

    const depthMode = frame.depthMode ?? 'none'
    if (depthMode === 'none') {
      gl.disable?.(GL_DEPTH_TEST)
    } else {
      gl.enable?.(GL_DEPTH_TEST)
      gl.depthFunc?.(GL_LEQUAL)
      gl.depthMask?.(depthMode === 'write')
      gl.clear?.(GL_DEPTH_BUFFER_BIT)
    }

    if (frame.assets !== undefined && frame.assets !== this.assets) this.prepare(frame.assets)
    const assets = frame.assets ?? this.assets
    for (const packet of frame.packets) {
      const vertexCount = Math.floor(packet.uvs.length / 2)
      const stride = vertexCount > 0 ? packet.positions.length / vertexCount : 2
      const material = assets?.materials.find((m) => m.id === packet.materialId) ?? null
      spritePage(material, assets?.pages)
      const texture = material !== null && material.kind === 'sprite'
        ? this.textures[material.page]
        : undefined
      if (material?.kind === 'sprite' && texture === undefined) {
        throw assetError('E_TEXTURE_MISSING', `材质 ${material.id} 的图集页 ${material.page} 尚未上传`)
      }

      const maskMode = this.maskMode(frame, packet.maskPath)
      if (this.programCache !== null && material !== null) {
        this.program = this.programCache.get(variantOf({
          pma: material.pma ?? true,
          twoColor: packet.twoColor === true || material.tintBlack === true,
          tintBlack: material.tintBlack === true, kind: material.kind,
        }, maskMode)) as object
        this.useProgram(this.program)
      }
      this.setViewProjection(frame.viewProjection)
      this.setResolution(frame.width, frame.height)
      this.setUniform1f('uAlphaMask', 0)
      if (texture !== undefined) {
        gl.activeTexture?.(GL_TEXTURE0)
        this.bindTexture(GL_TEXTURE_2D, texture)
        this.setUniform1i('uTexture', 0)
        this.setUniform1f('uUseTexture', 1)
      } else {
        if (this.whiteTexture !== null) {
          gl.activeTexture?.(GL_TEXTURE0)
          this.bindTexture(GL_TEXTURE_2D, this.whiteTexture)
        }
        this.setUniform1f('uUseTexture', 0)
      }

      const maskState = this.applyMasks(frame, packet.maskPath, assets)
      this.setUniform1f('uUseTexture', texture === undefined ? 0 : 1)
      this.applyBlend(packet.blend)

      this.upload(GL_ARRAY_BUFFER, this.buffers?.positions, packet.positions)
      this.setAttrib('aPosition', Number.isFinite(stride) ? stride : 2, GL_FLOAT, false)
      this.upload(GL_ARRAY_BUFFER, this.buffers?.uvs, packet.uvs)
      this.setAttrib('aUv', 2, GL_FLOAT, false)
      this.upload(GL_ARRAY_BUFFER, this.buffers?.colors, packet.colors)
      this.setAttrib('aColor', 4, GL_UNSIGNED_BYTE, true)
      if (packet.dark !== undefined) {
        this.upload(GL_ARRAY_BUFFER, this.buffers?.darks, packet.dark)
        this.setAttrib('aDark', 4, GL_UNSIGNED_BYTE, true)
      } else {
        this.resetDarkAttrib()
      }
      this.setUniform1f('uTwoColor', (packet.twoColor === true && packet.dark !== undefined) || material?.tintBlack === true ? 1 : 0)
      this.setUniform1f('uTintBlack', material?.tintBlack === true ? 1 : 0)
      this.upload(GL_ELEMENT_ARRAY_BUFFER, this.buffers?.indices, packet.indices)
      gl.drawElements?.(GL_TRIANGLES, packet.indices.length, indexType(packet.indices), 0)
      this.resetMaskState(maskState)

      this.stats.drawCalls += 1
      this.stats.packets += 1
      this.stats.batches += 1
      this.stats.uploadedVertices += vertexCount
    }

    if (depthMode !== 'none') {
      gl.depthMask?.(false)
      gl.disable?.(GL_DEPTH_TEST)
    }
  }

  readPixels(out?: Uint8ClampedArray): Uint8ClampedArray {
    if (this.disposed) throw new Error('WebGL2Backend: 已 dispose')
    const size = this.width * this.height * 4
    const target = out ?? new Uint8ClampedArray(size)
    if (target.length !== size) throw new RangeError('WebGL2Backend.readPixels: 输出缓冲尺寸不匹配')
    const gl = this.gl
    if (typeof gl.readPixels !== 'function') {
      // mock/无 GPU 时优雅降级：返回已清零的 RGBA 缓冲。
      target.fill(0)
      return target
    }
    const raw = new Uint8Array(size)
    gl.readPixels(0, 0, this.width, this.height, GL_RGBA, GL_UNSIGNED_BYTE, raw)
    // GL 返回 bottom-up，统一翻转为 top-down。
    const row = this.width * 4
    for (let y = 0; y < this.height; y += 1) {
      target.set(raw.subarray((this.height - 1 - y) * row, (this.height - y) * row), y * row)
    }
    return target
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl
    if (typeof gl.deleteBuffer === 'function' && this.buffers !== null) {
      gl.deleteBuffer(this.buffers.positions)
      gl.deleteBuffer(this.buffers.uvs)
      gl.deleteBuffer(this.buffers.colors)
      gl.deleteBuffer(this.buffers.indices)
    }
    if (typeof gl.deleteTexture === 'function') {
      for (const texture of this.textures) gl.deleteTexture(texture)
      if (this.whiteTexture !== null) gl.deleteTexture(this.whiteTexture)
    }
    this.textures = []
    this.whiteTexture = null
    this.buffers = null
    this.capacities.clear()
  }
}
