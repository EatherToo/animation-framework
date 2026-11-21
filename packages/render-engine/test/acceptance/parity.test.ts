/**
 * M9 验收门禁：CPU / 参考点采样 / WebGL2 三方一致性。
 *
 * 1) 用完全独立于 CpuBackend 的最简 barycentric 点采样器重画同一帧，
 *    非边缘像素逐通道 diff ≤ 2；
 * 2) 注入 mock gl 给 WebGL2Backend，断言 draw call 数与 packet 数一致、
 *    drawElements 顺序与上传的 positions 拼接顺序未被重排。
 */
import { describe, expect, it } from '@jest/globals'
import { CpuBackend, WebGL2Backend, type WebGL2Like } from '@/backend/backend'
import { buildRegionPacket, sortPackets, type RenderFrame } from '@/render/render'

const WIDTH = 64
const HEIGHT = 64

/** 与 golden.test.ts 中的 makeFrame 必须完全一致。 */
function makeFrame(): RenderFrame {
  const triangleA = buildRegionPacket({
    id: 1,
    positions: new Float32Array([4, 4, 28, 4, 4, 28]),
    color: [1, 0, 0, 1],
    materialId: 0,
    order: 0,
    depthKey: 0,
    seq: 1,
  })
  const triangleB = buildRegionPacket({
    id: 2,
    positions: new Float32Array([36, 36, 60, 36, 36, 60]),
    color: [0, 1, 0, 1],
    materialId: 0,
    order: 1,
    depthKey: 0,
    seq: 2,
  })
  const region = buildRegionPacket({
    id: 3,
    positions: new Float32Array([34, 4, 60, 4, 60, 30, 34, 30]),
    color: [0, 0, 1, 1],
    materialId: 0,
    order: 2,
    depthKey: 0,
    seq: 3,
  })
  return { packets: sortPackets([triangleA, triangleB, region]), width: WIDTH, height: HEIGHT }
}

// ---------------------------------------------------------------------------
// 独立参考点采样器（不 import / 不复用 CpuBackend 的任何实现）
// ---------------------------------------------------------------------------

type Point = { readonly x: number; readonly y: number }
type Triangle = {
  readonly a: Point
  readonly b: Point
  readonly c: Point
  readonly color: readonly [number, number, number, number]
}

/** 叉积 (b-a) × (p-a)，与有向面积同号即同侧。 */
const cross = (a: Point, b: Point, p: Point): number =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)

/** 按 packet 顺序展开三角形；顶点色取该三角形的第一个顶点（本场景为纯色）。 */
function collectTriangles(frame: RenderFrame): Triangle[] {
  const out: Triangle[] = []
  for (const packet of frame.packets) {
    const vertexCount = Math.min(
      Math.floor(packet.uvs.length / 2),
      Math.floor(packet.positions.length / 2),
    )
    const at = (index: number): Point => ({
      x: packet.positions[index * 2]!,
      y: packet.positions[index * 2 + 1]!,
    })
    for (let t = 0; t + 2 < packet.indices.length; t += 3) {
      const i0 = packet.indices[t]!
      const i1 = packet.indices[t + 1]!
      const i2 = packet.indices[t + 2]!
      if (i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) continue
      const o = i0 * 4
      out.push({
        a: at(i0),
        b: at(i1),
        c: at(i2),
        color: [
          packet.colors[o]!, packet.colors[o + 1]!,
          packet.colors[o + 2]!, packet.colors[o + 3]!,
        ],
      })
    }
  }
  return out
}

type ReferenceImage = {
  readonly color: Uint8ClampedArray
  /** 每个像素最后被哪个三角形覆盖；-1 为背景。 */
  readonly owner: Int32Array
}

/** 最简单的重心坐标点采样：像素中心落在三条边同侧即覆盖，按序做 PMA normal 混合。 */
function referenceRaster(frame: RenderFrame): ReferenceImage {
  const pixels = frame.width * frame.height
  const color = new Uint8ClampedArray(pixels * 4)
  for (let i = 0; i < pixels; i += 1) color[i * 4 + 3] = 255 // 不透明黑背景
  const owner = new Int32Array(pixels).fill(-1)

  collectTriangles(frame).forEach((tri, triId) => {
    const areaSigned = cross(tri.a, tri.b, tri.c)
    if (!Number.isFinite(areaSigned) || areaSigned === 0) return
    const sign = areaSigned > 0 ? 1 : -1
    const minX = Math.max(0, Math.floor(Math.min(tri.a.x, tri.b.x, tri.c.x)))
    const maxX = Math.min(frame.width - 1, Math.ceil(Math.max(tri.a.x, tri.b.x, tri.c.x)))
    const minY = Math.max(0, Math.floor(Math.min(tri.a.y, tri.b.y, tri.c.y)))
    const maxY = Math.min(frame.height - 1, Math.ceil(Math.max(tri.a.y, tri.b.y, tri.c.y)))
    const [sr, sg, sb, sa] = tri.color
    const inv = 255 - sa

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const p: Point = { x: x + 0.5, y: y + 0.5 }
        const w0 = sign * cross(tri.b, tri.c, p)
        if (w0 <= 0) continue
        const w1 = sign * cross(tri.c, tri.a, p)
        if (w1 <= 0) continue
        const w2 = sign * cross(tri.a, tri.b, p)
        if (w2 <= 0) continue

        const di = (y * frame.width + x) * 4
        color[di] = sr + (((color[di]! * inv + 127) / 255) | 0)
        color[di + 1] = sg + (((color[di + 1]! * inv + 127) / 255) | 0)
        color[di + 2] = sb + (((color[di + 2]! * inv + 127) / 255) | 0)
        color[di + 3] = sa + (((color[di + 3]! * inv + 127) / 255) | 0)
        owner[y * frame.width + x] = triId
      }
    }
  })
  return { color, owner }
}

/** 严格内部：像素自身及 8 邻域都属于同一三角形，排除共享边/轮廓像素。 */
function isInterior(owner: Int32Array, width: number, height: number, x: number, y: number): boolean {
  const id = owner[y * width + x]!
  if (id < 0) return false
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false
      if (owner[ny * width + nx] !== id) return false
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// mock GL：只记录上传与 draw 调用，不做真实渲染
// ---------------------------------------------------------------------------

function createMockGl(): {
  gl: WebGL2Like
  uploads: Array<{ target: number; data: ArrayBufferView }>
  draws: number[]
} {
  const uploads: Array<{ target: number; data: ArrayBufferView }> = []
  const draws: number[] = []
  let nextBuffer = 0
  const gl: WebGL2Like = {
    createBuffer: () => ({ token: (nextBuffer += 1) }),
    bindBuffer: () => {},
    bufferData: () => {},
    bufferSubData: (target, _offset, data) => { uploads.push({ target, data }) },
    getAttribLocation: (_program, name) => (name === 'aPosition' ? 0 : 1),
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    useProgram: () => {},
    drawElements: (_mode, count) => { draws.push(count) },
  }
  return { gl, uploads, draws }
}

describe('M9 parity：CpuBackend 与独立参考点采样器', () => {
  it('同一帧非边缘像素逐通道 diff ≤ 2', () => {
    const frame = makeFrame()
    const backend = new CpuBackend(WIDTH, HEIGHT)
    backend.draw(frame)
    const cpu = backend.readPixels()
    const reference = referenceRaster(frame)

    let checked = 0
    let maxDiff = 0
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        if (!isInterior(reference.owner, WIDTH, HEIGHT, x, y)) continue
        checked += 1
        const i = (y * WIDTH + x) * 4
        for (let c = 0; c < 4; c += 1) {
          const diff = Math.abs(cpu[i + c]! - reference.color[i + c]!)
          maxDiff = Math.max(maxDiff, diff)
          expect(diff).toBeLessThanOrEqual(2)
        }
      }
    }
    expect(checked).toBeGreaterThan(100)
    console.log(`[parity] 非边缘像素=${checked}, 最大通道 diff=${maxDiff}`)
    backend.dispose()
  })
})

describe('M9 parity：WebGL2Backend 提交顺序', () => {
  it('draw call 数等于 packet 数，且 positions 上传顺序未被重排', () => {
    const frame = makeFrame()
    const { gl, uploads, draws } = createMockGl()
    const backend = new WebGL2Backend(gl)
    backend.draw(frame)

    expect(backend.stats.packets).toBe(frame.packets.length)
    expect(backend.stats.drawCalls).toBe(frame.packets.length)
    expect(backend.stats.uploadedVertices).toBe(
      frame.packets.reduce((sum, p) => sum + Math.floor(p.uvs.length / 2), 0),
    )
    expect(draws).toEqual(frame.packets.map((p) => p.indices.length))

    // 每包上传顺序固定为 positions(F32) → uvs(F32) → colors(U8) → indices(U16)，
    // 因此 Float32 上传序列的偶数下标就是各包 positions 的原始顺序。
    const floatUploads = uploads
      .filter((u) => u.data instanceof Float32Array)
      .map((u) => Array.from(u.data as Float32Array))
    expect(floatUploads).toHaveLength(frame.packets.length * 2)
    const uploadedPositions = floatUploads.filter((_, i) => i % 2 === 0).flat()
    const expectedPositions = frame.packets.flatMap((p) => Array.from(p.positions))
    expect(uploadedPositions).toEqual(expectedPositions)
    backend.dispose()
  })
})
