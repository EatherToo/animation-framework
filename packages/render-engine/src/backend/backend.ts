/** M4 后端：CPU 参考光栅化与 WebGL2 提交，两者只消费 RenderFrame。 */

import type { BlendMode, RenderFrame, RenderPacket } from '../render/render'

export interface Viewport {
  width: number
  height: number
}

export interface BackendStats {
  drawCalls: number
  packets: number
  uploadedVertices: number
}

export interface RenderBackend {
  readonly kind: 'cpu' | 'webgl2'
  draw(frame: RenderFrame): void
  readPixels(out?: Uint8ClampedArray): Uint8ClampedArray
  resize(v: Viewport): void
  dispose(): void
}

const EPS = 1e-12
const mulU8 = (a: number, b: number): number => (((a * b + 127) / 255) | 0)

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
  r: number
  g: number
  b: number
  a: number
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
  readonly supersample?: 1 | 2
  /** 背板背景色，RGBA 字节；默认不透明黑 */
  readonly background?: readonly [number, number, number, number]
}

/** 纯 TypeScript 参考光栅化器；不依赖 DOM/Canvas。 */
export class CpuBackend implements RenderBackend {
  readonly kind = 'cpu' as const
  readonly stats: BackendStats = { drawCalls: 0, packets: 0, uploadedVertices: 0 }

  private width: number
  private height: number
  private readonly ss: 1 | 2
  private readonly background: readonly [number, number, number, number]
  private color: Uint8ClampedArray
  private disposed = false

  constructor(options?: CpuBackendOptions)
  constructor(width: number, height: number, supersample?: 1 | 2)
  constructor(a: number | CpuBackendOptions = {}, b?: number, c?: 1 | 2) {
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

  resize(v: Viewport): void {
    const w = Math.max(1, Math.floor(v.width))
    const h = Math.max(1, Math.floor(v.height))
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    this.color = new Uint8ClampedArray(w * this.ss * h * this.ss * 4)
    this.clear()
  }

  private clear(): void {
    const [r, g, b, a] = this.background
    for (let i = 0; i < this.color.length; i += 4) {
      this.color[i] = r
      this.color[i + 1] = g
      this.color[i + 2] = b
      this.color[i + 3] = a
    }
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
        const r = Math.round(b0 * p0.r + b1 * p1.r + b2 * p2.r)
        const g = Math.round(b0 * p0.g + b1 * p1.g + b2 * p2.g)
        const b = Math.round(b0 * p0.b + b1 * p1.b + b2 * p2.b)
        const a = Math.round(b0 * p0.a + b1 * p1.a + b2 * p2.a)
        if (a <= 0) continue
        blendPixel(this.color, (sy * ssW + sx) * 4, r, g, b, a, this.currentBlend)
      }
    }
  }

  private currentBlend: BlendMode = 'normal'

  draw(frame: RenderFrame): void {
    if (this.disposed) throw new Error('CpuBackend: 已 dispose，不能继续 draw')
    if (frame.width !== this.width || frame.height !== this.height) {
      this.resize({ width: frame.width, height: frame.height })
    }
    this.clear()
    this.stats.drawCalls = 0
    this.stats.packets = 0
    this.stats.uploadedVertices = 0
    const ss = this.ss
    const ssW = this.width * ss
    const ssH = this.height * ss

    for (const packet of frame.packets) {
      this.stats.packets += 1
      this.stats.drawCalls += 1
      this.currentBlend = packet.blend
      const vertexCount = Math.min(Math.floor(packet.uvs.length / 2), Math.floor(packet.positions.length / 2))
      if (vertexCount <= 0) continue
      this.stats.uploadedVertices += vertexCount
      const stride = vertexCount > 0 ? packet.positions.length / vertexCount : 0
      if (!Number.isFinite(stride) || stride < 2) continue

      const verts: ScreenVertex[] = []
      for (let i = 0; i < vertexCount; i += 1) {
        const [x, y] = this.toScreen(frame, packet.positions[i * stride]!, packet.positions[i * stride + 1]!)
        const o = i * 4
        verts.push({
          x: x * ss, y: y * ss,
          r: packet.colors[o]!, g: packet.colors[o + 1]!,
          b: packet.colors[o + 2]!, a: packet.colors[o + 3]!,
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
const GL_UNSIGNED_INT = 0x1405
const GL_TRIANGLES = 0x0004
const GL_RGBA = 0x1908

/** WebGL2 所需的最小接口；方法全部可选，便于注入 mock 并做能力降级。 */
export interface WebGL2Like {
  createBuffer?(): unknown
  deleteBuffer?(buffer: unknown): void
  bindBuffer?(target: number, buffer: unknown): void
  bufferData?(target: number, data: ArrayBufferView | number, usage: number): void
  bufferSubData?(target: number, offset: number, data: ArrayBufferView): void
  getAttribLocation?(program: unknown, name: string): number
  enableVertexAttribArray?(index: number): void
  vertexAttribPointer?(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void
  getUniformLocation?(program: unknown, name: string): unknown
  uniformMatrix3fv?(location: unknown, transpose: boolean, value: ArrayLike<number>): void
  uniformMatrix4fv?(location: unknown, transpose: boolean, value: ArrayLike<number>): void
  useProgram?(program: unknown): void
  drawElements?(mode: number, count: number, type: number, offset: number): void
  readPixels?(x: number, y: number, width: number, height: number, format: number, type: number, dst: Uint8Array): void
}

interface GLBuffers {
  positions: unknown
  uvs: unknown
  colors: unknown
  indices: unknown
}

/** 按 frame.packets 原始顺序逐包上传并 drawElements，绝不重排。 */
export class WebGL2Backend implements RenderBackend {
  readonly kind = 'webgl2' as const
  readonly stats: BackendStats = { drawCalls: 0, packets: 0, uploadedVertices: 0 }

  private readonly gl: WebGL2Like
  private buffers: GLBuffers | null = null
  private readonly capacities = new Map<unknown, number>()
  private readonly program: object
  private width = 1
  private height = 1
  private pixels: Uint8ClampedArray = new Uint8ClampedArray(4)
  private disposed = false

  constructor(gl: WebGL2Like, program: object = {}) {
    if (gl === null || typeof gl !== 'object') throw new Error('WebGL2Backend: 缺少 gl 上下文')
    if (typeof gl.drawElements !== 'function') throw new Error('WebGL2Backend: gl.drawElements 不可用，无法提交绘制')
    this.gl = gl
    this.program = program
    if (typeof gl.createBuffer === 'function') {
      this.buffers = {
        positions: gl.createBuffer(),
        uvs: gl.createBuffer(),
        colors: gl.createBuffer(),
        indices: gl.createBuffer(),
      }
    }
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
  }

  private setAttrib(name: string, size: number, type: number, normalized: boolean): void {
    const gl = this.gl
    const loc = gl.getAttribLocation?.(this.program, name)
    if (loc === undefined || loc < 0 || gl.enableVertexAttribArray === undefined ||
        gl.vertexAttribPointer === undefined) return
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, size, type, normalized, 0, 0)
  }

  private setViewProjection(vp: Float32Array | undefined): void {
    const gl = this.gl
    if (vp === undefined || gl.getUniformLocation === undefined) return
    const loc = gl.getUniformLocation(this.program, 'viewProjection')
    if (loc === null || loc === undefined) return
    if (vp.length >= 16 && gl.uniformMatrix4fv !== undefined) {
      gl.uniformMatrix4fv(loc, false, vp)
    } else if (vp.length >= 9 && gl.uniformMatrix3fv !== undefined) {
      gl.uniformMatrix3fv(loc, false, vp.subarray(0, 9))
    }
  }

  draw(frame: RenderFrame): void {
    if (this.disposed) throw new Error('WebGL2Backend: 已 dispose，不能继续 draw')
    if (frame.width !== this.width || frame.height !== this.height) {
      this.resize({ width: frame.width, height: frame.height })
    }
    this.stats.drawCalls = 0
    this.stats.packets = 0
    this.stats.uploadedVertices = 0
    this.gl.useProgram?.(this.program)
    this.setViewProjection(frame.viewProjection)

    for (const packet of frame.packets) {
      const vertexCount = Math.floor(packet.uvs.length / 2)
      const stride = vertexCount > 0 ? packet.positions.length / vertexCount : 2
      this.upload(GL_ARRAY_BUFFER, this.buffers?.positions, packet.positions)
      this.setAttrib('aPosition', Number.isFinite(stride) ? stride : 2, GL_FLOAT, false)
      this.upload(GL_ARRAY_BUFFER, this.buffers?.uvs, packet.uvs)
      this.setAttrib('aUv', 2, GL_FLOAT, false)
      this.upload(GL_ARRAY_BUFFER, this.buffers?.colors, packet.colors)
      this.setAttrib('aColor', 4, GL_UNSIGNED_BYTE, true)
      this.upload(GL_ELEMENT_ARRAY_BUFFER, this.buffers?.indices, packet.indices)
      this.gl.drawElements?.(GL_TRIANGLES, packet.indices.length, GL_UNSIGNED_INT, 0)
      this.stats.drawCalls += 1
      this.stats.packets += 1
      this.stats.uploadedVertices += vertexCount
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
    this.buffers = null
    this.capacities.clear()
  }
}
