import { describe, expect, it } from '@jest/globals'
import { CpuBackend, WebGL2Backend } from '@/backend/backend'
import {
  buildMaskSet,
  buildRegionPacket,
  type MaterialDef,
  type RenderAssets,
  type RenderFrame,
  type RenderMask,
  type TextureData,
} from '@/render/render'
import { FakeWebGL } from './fake-webgl'

const W = 64
const H = 64
const CELL = 8
const BG: readonly [number, number, number, number] = [10, 20, 30, 255]
const A: readonly [number, number, number, number] = [220, 40, 40, 255]
const B: readonly [number, number, number, number] = [40, 80, 220, 255]

/** 8×8 棋盘纹理，相邻格颜色不同，便于肉眼/断言确认纹理确实被采样。 */
function checkerboard(): TextureData {
  const data = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const cell = (Math.floor(x / CELL) + Math.floor(y / CELL)) % 2
      const color = cell === 0 ? A : B
      const o = (y * W + x) * 4
      data[o] = color[0]
      data[o + 1] = color[1]
      data[o + 2] = color[2]
      data[o + 3] = color[3]
    }
  }
  return { width: W, height: H, data, pma: true }
}

/** 半径 20、圆心 (32,32) 的 32 边正多边形，作为圆形 stencil mask。 */
function circleMask(radius = 20): RenderMask {
  const segments = 32
  const positions = new Float32Array(segments * 2)
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2
    positions[i * 2] = 32 + Math.cos(angle) * radius
    positions[i * 2 + 1] = 32 + Math.sin(angle) * radius
  }
  const indices = new Uint32Array((segments - 2) * 3)
  let cursor = 0
  for (let i = 1; i + 1 < segments; i += 1) {
    indices[cursor++] = 0
    indices[cursor++] = i
    indices[cursor++] = i + 1
  }
  return {
    id: 0,
    mode: 'stencil',
    invert: false,
    feather: 0,
    positions,
    indices,
    bounds: { x: 32 - radius, y: 32 - radius, width: radius * 2, height: radius * 2 },
  }
}

const MATERIAL: MaterialDef = { id: 0, kind: 'sprite', page: 0, filter: 'nearest' }

function buildAssets(): RenderAssets {
  return { pages: [checkerboard()], materials: [MATERIAL] }
}

function buildFrame(assets: RenderAssets): RenderFrame {
  const quad = buildRegionPacket({
    id: 1,
    positions: new Float32Array([0, 0, W, 0, W, H, 0, H]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    color: [1, 1, 1, 1],
    materialId: 0,
    order: 0,
    depthKey: 0,
  })
  return {
    packets: [quad],
    width: W,
    height: H,
    assets,
    maskPaths: [{ maskId: 0, parent: -1 }],
    masks: buildMaskSet([circleMask()]),
  }
}

function at(px: Uint8ClampedArray, x: number, y: number): [number, number, number, number] {
  const o = (y * W + x) * 4
  return [px[o]!, px[o + 1]!, px[o + 2]!, px[o + 3]!]
}

describe('M10 smoke: 棋盘纹理 + 圆形 stencil mask', () => {
  it('CPU：mask 外为背景，mask 内棋盘可见且符合纹理', () => {
    const assets = buildAssets()
    const backend = new CpuBackend({ width: W, height: H, supersample: 1, background: BG })
    backend.draw(buildFrame(assets))
    const px = backend.readPixels()

    // 圆形外：左上角与包围盒角落都是背景色。
    expect(at(px, 2, 2)).toEqual([...BG])
    expect(at(px, 14, 14)).toEqual([...BG])

    // 圆心附近：落在偶数格 → A 色；其右侧同圆内 → 奇数格 → B 色。
    expect(at(px, 32, 32)).toEqual([...A])
    expect(at(px, 40, 32)).toEqual([...B])
    // 再取一个明显的棋盘格（圆内），确认不是纯色块。
    expect(at(px, 16, 32)).toEqual([...A])

    // 统计：有 mask 测试与纹理采样发生。
    expect(backend.stats.maskTests).toBeGreaterThan(0)
    expect(backend.stats.textureSamples).toBeGreaterThan(0)
  })

  it('WebGL2 mock：先上传页纹理，再绑定页、写 stencil，最后画 packet', () => {
    const gl = new FakeWebGL()
    const backend = new WebGL2Backend(gl)
    backend.resize({ width: W, height: H })
    const assets = buildAssets()
    const frame = buildFrame(assets)
    backend.prepare(assets)
    backend.draw(frame)

    // 页纹理 64×64 上传一次，另有 1×1 白纹理。
    const uploads = gl.argsOf('texImage2D')
    expect(uploads.filter((a) => a[3] === W && a[4] === H).length).toBe(1)
    expect(uploads.filter((a) => a[3] === 1 && a[4] === 1).length).toBe(1)

    // 页纹理先创建（id=1），sprite 绘制在 prepare 上传完成后再次绑定它。
    const uploadIndex = gl.calls.findIndex((c) => c.op === 'texImage2D' && c.args[3] === W)
    const bindPage = gl.calls.findIndex(
      (c, i) => i > uploadIndex && c.op === 'bindTexture' && c.args[1] === 1,
    )
    const enableStencil = gl.calls.findIndex((c) => c.op === 'enable' && c.args[0] === 0x0b90)
    const drawIndices = gl.calls
      .map((c, i) => ({ c, i }))
      .filter((entry) => entry.c.op === 'drawElements')
      .map((entry) => entry.i)

    expect(uploadIndex).toBeGreaterThanOrEqual(0)
    expect(bindPage).toBeGreaterThan(uploadIndex)
    expect(enableStencil).toBeGreaterThanOrEqual(0)
    // 两笔 drawElements：先 mask 几何（32 边形扇形 90 个索引），后 packet（2 个三角形）。
    expect(drawIndices.length).toBe(2)
    expect(gl.calls[drawIndices[0]!]!.args[1]).toBe(90)
    expect(gl.calls[drawIndices[1]!]!.args[1]).toBe(6)
    expect(bindPage).toBeLessThan(drawIndices[1]!)
    expect(drawIndices[0]!).toBeLessThan(drawIndices[1]!)

    expect(backend.stats.packets).toBe(1)
    expect(backend.stats.drawCalls).toBe(1)
    expect(backend.stats.uploadedVertices).toBe(4)
  })
})
