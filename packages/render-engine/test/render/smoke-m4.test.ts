import { describe, expect, it } from '@jest/globals'
import { CpuBackend, WebGL2Backend, type WebGL2Like } from '@/backend/backend'
import { buildMeshPacket, buildRegionPacket, type RenderFrame } from '@/render/render'

const W = 16
const H = 16

function buildFrame(): RenderFrame {
  // 三个 packet 的构造顺序即提交顺序：整屏灰底 + 左下红三角 + 右上蓝三角。
  const background = buildRegionPacket({
    id: 1,
    positions: new Float32Array([0, 0, W, 0, W, H, 0, H]),
    color: [0.2, 0.2, 0.2, 1],
    materialId: 1,
    order: 0,
    depthKey: 0,
  })
  const red = buildMeshPacket({
    id: 2,
    positions: new Float32Array([0, 8, 8, 16, 0, 16]),
    color: [1, 0, 0, 0.5],
    materialId: 2,
    order: 1,
    depthKey: 0,
    indices: new Uint16Array([0, 1, 2]),
  })
  const blue = buildMeshPacket({
    id: 3,
    positions: new Float32Array([8, 0, 16, 0, 16, 8]),
    color: [0, 0, 1, 0.5],
    materialId: 3,
    order: 2,
    depthKey: 0,
    indices: new Uint16Array([0, 1, 2]),
  })
  return {
    packets: [background, red, blue],
    width: W,
    height: H,
    viewProjection: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  }
}

type Call =
  | { op: 'bufferSubData'; target: number; bytes: number[] }
  | { op: 'drawElements'; count: number; colors: number[] }
  | { op: string; args: unknown[] }

/** 最小的 WebGL2 mock：记录 buffer 上传和 drawElements 顺序。 */
class FakeGL {
  readonly calls: Call[] = []
  private nextBuffer = 1
  private uploads = 0
  private lastColors: number[] = []

  createBuffer(): number {
    this.calls.push({ op: 'createBuffer', args: [] })
    return this.nextBuffer++
  }

  deleteBuffer(_buffer: unknown): void {
    this.calls.push({ op: 'deleteBuffer', args: [_buffer] })
  }

  bindBuffer(_target: number, _buffer: unknown): void {
    this.calls.push({ op: 'bindBuffer', args: [_target, _buffer] })
  }

  bufferData(_target: number, _data: ArrayBufferView | number, _usage: number): void {
    this.calls.push({ op: 'bufferData', args: [_target, _usage] })
  }

  bufferSubData(_target: number, _offset: number, data: ArrayBufferView): void {
    const bytes = Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    this.calls.push({ op: 'bufferSubData', target: _target, bytes })
    // 每个 packet 依次上传 positions / uvs / colors / indices。
    if (this.uploads % 4 === 2) this.lastColors = bytes
    this.uploads += 1
  }

  getAttribLocation(_program: unknown, name: string): number {
    this.calls.push({ op: 'getAttribLocation', args: [name] })
    return name === 'aPosition' ? 0 : name === 'aUv' ? 1 : 2
  }

  enableVertexAttribArray(_index: number): void {
    this.calls.push({ op: 'enableVertexAttribArray', args: [_index] })
  }

  vertexAttribPointer(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void {
    this.calls.push({ op: 'vertexAttribPointer', args: [index, size, type, normalized, stride, offset] })
  }

  getUniformLocation(_program: unknown, name: string): string {
    this.calls.push({ op: 'getUniformLocation', args: [name] })
    return name
  }

  uniformMatrix3fv(location: unknown, transpose: boolean, value: ArrayLike<number>): void {
    this.calls.push({ op: 'uniformMatrix3fv', args: [location, transpose, Array.from(value)] })
  }

  uniformMatrix4fv(location: unknown, transpose: boolean, value: ArrayLike<number>): void {
    this.calls.push({ op: 'uniformMatrix4fv', args: [location, transpose, Array.from(value)] })
  }

  useProgram(_program: unknown): void {
    this.calls.push({ op: 'useProgram', args: [_program] })
  }

  drawElements(_mode: number, count: number, _type: number, offset: number): void {
    this.calls.push({ op: 'drawElements', count, colors: this.lastColors.slice() })
    void offset
  }
}

describe('M4 smoke: 应用视角', () => {
  it('CPU 后端出图：颜色、覆盖率正确且无 NaN', () => {
    const backend = new CpuBackend({ width: W, height: H, supersample: 1, background: [0, 0, 0, 255] })
    backend.resize({ width: W, height: H })
    backend.draw(buildFrame())
    const px = backend.readPixels()
    expect(px.length).toBe(W * H * 4)
    for (const v of px) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(255)
    }

    const at = (x: number, y: number): [number, number, number, number] => {
      const i = (y * W + x) * 4
      return [px[i]!, px[i + 1]!, px[i + 2]!, px[i + 3]!]
    }
    // 灰底像素：0.2 * 255 ≈ 51。
    const bg = at(14, 14)
    expect(bg[0]).toBeGreaterThanOrEqual(50)
    expect(bg[0]).toBeLessThanOrEqual(52)
    // 红三角内部：半透明红 over 灰底 → 红通道升高、绿蓝降低。
    const red = at(1, 14)
    expect(red[0]!).toBeGreaterThan(140)
    expect(red[1]!).toBeLessThan(35)
    expect(red[2]!).toBeLessThan(35)
    expect(red[3]).toBe(255)
    // 蓝三角内部：半透明蓝 over 灰底 → 蓝通道升高、红绿降低。
    const blue = at(14, 1)
    expect(blue[2]!).toBeGreaterThan(140)
    expect(blue[0]!).toBeLessThan(35)
    expect(blue[1]!).toBeLessThan(35)

    // 覆盖率：红三角 28 像素（斜边为排除侧），蓝三角 36 像素（斜边为 left 边，含边），合计 64。
    let covered = 0
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const c = at(x, y)
        if (Math.abs(c[0]! - bg[0]!) > 2 || Math.abs(c[2]! - bg[2]!) > 2) covered += 1
      }
    }
    expect(covered).toBe(64)
  })

  it('WebGL2 mock 按输入顺序绘制 3 个 packet 并记录统计', () => {
    const gl: WebGL2Like = new FakeGL()
    const backend = new WebGL2Backend(gl)
    backend.resize({ width: W, height: H })
    const frame = buildFrame()
    backend.draw(frame)

    expect(backend.stats.packets).toBe(3)
    expect(backend.stats.drawCalls).toBe(3)
    expect(backend.stats.uploadedVertices).toBe(10) // 4 + 3 + 3
    const fake = gl as FakeGL
    const draws = fake.calls.filter((c): c is Extract<Call, { op: 'drawElements' }> => c.op === 'drawElements')
    expect(draws.map((d) => d.count)).toEqual([6, 3, 3])
    // drawElements 前最后一次 colors 上传应与 frame.packets 的颜色逐包一致。
    expect(draws.map((d) => d.colors)).toEqual(
      frame.packets.map((p) => Array.from(p.colors)),
    )
    // 3 个属性（aPosition/aUv/aColor）与 viewProjection uniform 均被设置。
    const attrs = fake.calls.filter((c) => c.op === 'getAttribLocation').map((c) => (c as { args: unknown[] }).args[0])
    expect(attrs).toEqual(expect.arrayContaining(['aPosition', 'aUv', 'aColor']))
    expect(fake.calls.some((c) => c.op === 'uniformMatrix3fv' || c.op === 'uniformMatrix4fv')).toBe(true)
    expect(backend.kind).toBe('webgl2')
  })
})
