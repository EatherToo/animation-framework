import { describe, expect, it } from '@jest/globals'
import { CpuBackend, WebGL2Backend } from '@/backend/backend'
import {
  buildRegionPacket,
  sampleTexture,
  validateAssets,
  type MaterialDef,
  type RenderAssets,
  type RenderFrame,
  type TextureData,
} from '@/render/render'
import { FakeWebGL } from './fake-webgl'

/** 构造一页 RGBA8 纹理；默认视为已预乘。 */
function tex(width: number, height: number, pixels: number[], pma = true): TextureData {
  return { width, height, data: new Uint8Array(pixels), pma }
}

function rgba(r: number, g: number, b: number, a = 255): number[] {
  return [r, g, b, a]
}

const sprite = (id: number, p: number): MaterialDef => ({ id, kind: 'sprite', page: p, filter: 'linear' })

describe('M10 texture: 最近邻与双线性精度', () => {
  it('nearest 用 floor 命中 texel，且 v 向下', () => {
    const redBlue = tex(2, 1, [...rgba(255, 0, 0), ...rgba(0, 0, 255)])
    expect(sampleTexture(redBlue, 0.24, 0.5, 'nearest')).toEqual([255, 0, 0, 255])
    expect(sampleTexture(redBlue, 0.26, 0.5, 'nearest')).toEqual([255, 0, 0, 255])
    expect(sampleTexture(redBlue, 0.74, 0.5, 'nearest')).toEqual([0, 0, 255, 255])
    expect(sampleTexture(redBlue, 0.76, 0.5, 'nearest')).toEqual([0, 0, 255, 255])

    const topBottom = tex(1, 2, [...rgba(255, 0, 0), ...rgba(0, 0, 255)])
    expect(sampleTexture(topBottom, 0.5, 0.24, 'nearest')).toEqual([255, 0, 0, 255])
    expect(sampleTexture(topBottom, 0.5, 0.76, 'nearest')).toEqual([0, 0, 255, 255])
  })

  it('nearest 对越界 UV 做 clamp', () => {
    const redBlue = tex(2, 1, [...rgba(255, 0, 0), ...rgba(0, 0, 255)])
    expect(sampleTexture(redBlue, -3, 0.5, 'nearest')).toEqual([255, 0, 0, 255])
    expect(sampleTexture(redBlue, 3, 0.5, 'nearest')).toEqual([0, 0, 255, 255])
  })

  it('linear 在 texel 中心精确命中，中点 50/50 四舍五入', () => {
    const redBlue = tex(2, 1, [...rgba(255, 0, 0), ...rgba(0, 0, 255)])
    // texel 中心：x=0.5 → u=0.25；x=1.5 → u=0.75。
    expect(sampleTexture(redBlue, 0.25, 0.5, 'linear')).toEqual([255, 0, 0, 255])
    expect(sampleTexture(redBlue, 0.75, 0.5, 'linear')).toEqual([0, 0, 255, 255])
    // 正中间 fx=0.5：红/蓝各半，127.5 → 128。
    expect(sampleTexture(redBlue, 0.5, 0.5, 'linear')).toEqual([128, 0, 128, 255])
  })

  it('linear 双轴双线性：四角平均，v 仍向下', () => {
    const quad = tex(2, 2, [
      ...rgba(255, 0, 0), // (0,0) 上左红
      ...rgba(0, 255, 0), // (1,0) 上右绿
      ...rgba(0, 0, 255), // (0,1) 下左蓝
      ...rgba(255, 255, 255), // (1,1) 下右白
    ])
    // u=0.5,v=0.5 正好落在四个 texel 中心之间。
    expect(sampleTexture(quad, 0.5, 0.5, 'linear')).toEqual([128, 128, 128, 255])
    // u=0.25,v=0.75 → 下左 texel 中心，蓝色。
    expect(sampleTexture(quad, 0.25, 0.75, 'linear')).toEqual([0, 0, 255, 255])
  })
})

describe('M10 texture: PMA 只乘一次', () => {
  it('纹理半透明 × 顶点半透明：CPU 输出约 64 而非 32', () => {
    const W = 4
    const H = 4
    // 0.5 alpha 的 PMA 白：RGB 与 A 都是 128。
    const halfWhite = tex(1, 1, rgba(128, 128, 128, 128))
    const assets: RenderAssets = {
      pages: [halfWhite],
      materials: [{ id: 0, kind: 'sprite', page: 0, filter: 'nearest' }],
    }
    const packet = buildRegionPacket({
      id: 1,
      positions: new Float32Array([0, 0, W, 0, W, H, 0, H]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      color: [1, 1, 1, 0.5],
      materialId: 0,
      order: 0,
      depthKey: 0,
    })
    const frame: RenderFrame = { packets: [packet], width: W, height: H, assets }
    const backend = new CpuBackend({ width: W, height: H, supersample: 1, background: [0, 0, 0, 255] })
    backend.draw(frame)
    const px = backend.readPixels()
    const o = (2 * W + 2) * 4
    // mulU8(128,128)=64；再 over 不透明黑背景，RGB 仍 64。
    expect(px[o]).toBeGreaterThanOrEqual(63)
    expect(px[o]).toBeLessThanOrEqual(65)
    expect(px[o + 1]).toBeGreaterThanOrEqual(63)
    expect(px[o + 2]).toBeGreaterThanOrEqual(63)
    expect(px[o + 3]).toBe(255)
    expect(backend.stats.textureSamples).toBeGreaterThan(0)
  })

  it('flat 材质不采样纹理，保持顶点色', () => {
    const W = 2
    const H = 2
    const assets: RenderAssets = {
      pages: [tex(1, 1, rgba(0, 255, 0))],
      materials: [{ id: 0, kind: 'flat', page: -1, filter: 'nearest' }],
    }
    const packet = buildRegionPacket({
      id: 1,
      positions: new Float32Array([0, 0, W, 0, W, H, 0, H]),
      color: [1, 0, 0, 1],
      materialId: 0,
      order: 0,
      depthKey: 0,
    })
    const backend = new CpuBackend({ width: W, height: H, supersample: 1, background: [0, 0, 0, 255] })
    backend.draw({ packets: [packet], width: W, height: H, assets })
    const px = backend.readPixels()
    expect(Array.from(px.slice(0, 4))).toEqual([255, 0, 0, 255])
    expect(backend.stats.textureSamples).toBe(0)
  })
})

describe('M10 texture: 图集页与材质校验', () => {
  const page = tex(2, 2, new Array<number>(16).fill(255))
  const sprite = (id: number, p: number): MaterialDef => ({ id, kind: 'sprite', page: p, filter: 'linear' })

  it('合法资产无错误', () => {
    const result = validateAssets({
      pages: [page],
      materials: [sprite(0, 0), { id: 1, kind: 'flat', page: -1, filter: 'nearest' }],
    })
    expect(result.errors).toEqual([])
  })

  it('页数必须在 1..4', () => {
    expect(validateAssets({ pages: [], materials: [] }).errors.length).toBeGreaterThan(0)
    expect(validateAssets({ pages: [page, page, page, page, page], materials: [] }).errors.length).toBeGreaterThan(0)
  })

  it('纹理长度必须等于 w*h*4', () => {
    const bad = tex(2, 2, [1, 2, 3, 4])
    expect(validateAssets({ pages: [bad], materials: [] }).errors.some((e) => e.includes('长度'))).toBe(true)
  })

  it('材质 id 唯一且 sprite 必须引用存在页', () => {
    const dup = validateAssets({ pages: [page], materials: [sprite(0, 0), sprite(0, 0)] })
    expect(dup.errors.some((e) => e.includes('重复'))).toBe(true)
    const missing = validateAssets({ pages: [page], materials: [sprite(7, 3)] })
    expect(missing.errors.some((e) => e.includes('页'))).toBe(true)
  })

  it('未预乘纹理给出 warning 而非 error', () => {
    const straight = tex(1, 1, rgba(255, 255, 255), false)
    const result = validateAssets({ pages: [straight], materials: [{ id: 0, kind: 'flat', page: -1, filter: 'nearest' }] })
    expect(result.errors).toEqual([])
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

describe('M10 texture: WebGL2 页纹理上传与绑定', () => {
  it('prepare 上传每页 + 1x1 白纹理，draw 绑定材质对应页', () => {
    const gl = new FakeWebGL()
    const backend = new WebGL2Backend(gl)
    backend.resize({ width: 8, height: 8 })
    const p0 = tex(2, 2, new Array<number>(16).fill(255))
    const p1 = tex(4, 4, new Array<number>(64).fill(128))
    const assets: RenderAssets = {
      pages: [p0, p1],
      materials: [sprite(0, 1)],
    }

    backend.prepare(assets)
    // 两个页纹理（2x2 / 4x4）各上传一次，另加 1x1 白纹理。
    const uploads = gl.argsOf('texImage2D')
    expect(uploads.filter((a) => a[3] === 2 && a[4] === 2).length).toBe(1)
    expect(uploads.filter((a) => a[3] === 4 && a[4] === 4).length).toBe(1)
    expect(uploads.filter((a) => a[3] === 1 && a[4] === 1).length).toBe(1)

    const packet = buildRegionPacket({
      id: 1,
      positions: new Float32Array([0, 0, 8, 0, 8, 8, 0, 8]),
      color: [1, 1, 1, 1],
      materialId: 0,
      order: 0,
      depthKey: 0,
    })
    backend.draw({ packets: [packet], width: 8, height: 8, assets })

    // 页纹理创建顺序：p0=1、p1=2、白=3；sprite 材质应绑定 p1。
    const bindTextures = gl.argsOf('bindTexture').map((a) => a[1])
    expect(bindTextures).toContain(2)
    expect(gl.argsOf('uniform1i').some((a) => a[0] === 'uUseTexture' && a[1] === 1)).toBe(true)
    expect(backend.stats.drawCalls).toBe(1)
    expect(backend.stats.uploadedVertices).toBe(4)
  })

  it('flat 材质绑定白纹理并关闭纹理采样', () => {
    const gl = new FakeWebGL()
    const backend = new WebGL2Backend(gl)
    backend.resize({ width: 4, height: 4 })
    const assets: RenderAssets = {
      pages: [tex(1, 1, rgba(255, 255, 255))],
      materials: [{ id: 0, kind: 'flat', page: -1, filter: 'nearest' }],
    }
    backend.prepare(assets)
    const packet = buildRegionPacket({
      id: 1,
      positions: new Float32Array([0, 0, 4, 0, 4, 4, 0, 4]),
      color: [1, 0, 0, 1],
      materialId: 0,
      order: 0,
      depthKey: 0,
    })
    backend.draw({ packets: [packet], width: 4, height: 4, assets })
    // 白纹理是第三个创建（id=2：页 id=1、白 id=2）。
    expect(gl.argsOf('bindTexture').map((a) => a[1])).toContain(2)
    expect(gl.argsOf('uniform1i').some((a) => a[0] === 'uUseTexture' && a[1] === 0)).toBe(true)
  })
})
