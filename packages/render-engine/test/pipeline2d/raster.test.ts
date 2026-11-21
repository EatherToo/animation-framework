import { describe, expect, it } from '@jest/globals'
import {
  paintPackets,
  rasterizeMask,
  type AtlasImage,
  type RenderPacket,
} from '@/pipeline2d'

function target(width = 12, height = 12): { width: number; height: number; pixels: Uint8ClampedArray } {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) pixels[i * 4 + 3] = 255
  return { width, height, pixels }
}

function packet(overrides: Partial<RenderPacket> = {}): RenderPacket {
  return {
    version: 2,
    partId: 'square',
    vertices: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
    uvs: new Float32Array(8),
    indices: Uint16Array.from([0, 1, 2, 0, 2, 3]),
    colors: Uint8Array.from([
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
    ]),
    seam: new Uint8Array(4),
    outline: null,
    atlasPage: -1,
    atlasKey: 'square',
    materialId: -1,
    blend: 'normal',
    mask: null,
    order: 0,
    depth: new Float32Array(4),
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    ...overrides,
  }
}

const transform = { scale: 5, originX: 2, originY: 7 }

function pixel(surface: { width: number; pixels: Uint8ClampedArray }, x: number, y: number): number[] {
  const i = (y * surface.width + x) * 4
  return [surface.pixels[i]!, surface.pixels[i + 1]!, surface.pixels[i + 2]!, surface.pixels[i + 3]!]
}

describe('pipeline2d raster', () => {
  it('R5：CPU 后端按 order 画平涂三角形', () => {
    const surface = target()
    paintPackets(surface, [packet()], { transform })
    expect(pixel(surface, 5, 5)).toEqual([255, 0, 0, 255])
    expect(pixel(surface, 10, 10)).toEqual([0, 0, 0, 255])
  })

  it('R5：mask 光栅化与 minWorldY 裁剪', () => {
    const full = rasterizeMask(packet(), 12, 12, transform)
    expect(full[5 * 12 + 5]).toBe(255)
    expect(full[0]).toBe(0)
    const upper = rasterizeMask(packet(), 12, 12, transform, { minWorldY: 0.2 })
    expect(upper[5 * 12 + 5]).toBe(255)
    expect(upper[10 * 12 + 5]).toBe(0)
  })

  it('最小渲染单元：triangle fill 每个三角形一个固定色', () => {
    const surface = target()
    const tri = packet({
      vertices: Float32Array.from([0, 0, 1, 0, 1, 1]),
      indices: Uint16Array.from([0, 1, 2]),
      colors: Uint8Array.from([
        255, 0, 0, 255,
        0, 255, 0, 255,
        0, 0, 255, 255,
      ]),
      depth: new Float32Array(3),
      bounds: { x: 0, y: 0, width: 1, height: 1 },
    })
    paintPackets(surface, [tri], { transform, fillMode: 'triangle' })
    const a = pixel(surface, 3, 5)
    const b = pixel(surface, 6, 5)
    const c = pixel(surface, 6, 3)
    expect(a).toEqual(b)
    expect(b).toEqual(c)
    expect(a[0]).toBeGreaterThan(0)
    expect(a[1]).toBeGreaterThan(0)
    expect(a[2]).toBeGreaterThan(0)
  })

  it('最小渲染单元：triangle edges 画出内部三角边', () => {
    const outlined = packet({
      outline: {
        widthPx: 2,
        color: { r: 0, g: 0, b: 0, a: 1 },
        join: 'round',
        cap: 'round',
        depthBias: 0,
      },
    })
    const fill = target()
    paintPackets(fill, [outlined], { transform, fillMode: 'triangle' })
    const edges = target()
    paintPackets(edges, [outlined], { transform, fillMode: 'triangle', edges: 'triangles', edgeWidthPx: 3 })
    // 两个三角形的共享对角线过 (4.5,4.5)；填色模式那里是红色，边线模式应是暗色。
    const diagonal = pixel(edges, 4, 4)
    expect(diagonal[0]).toBeLessThan(255)
    expect(diagonal[1]).toBeLessThan(255)
    expect(diagonal[2]).toBeLessThan(255)
    expect(pixel(fill, 4, 4)).toEqual([255, 0, 0, 255])
  })

  it('R5：图集采样与 mask alpha', () => {
    const image: AtlasImage = {
      width: 2,
      height: 2,
      rgba: Uint8Array.from([
        0, 255, 0, 255, 0, 255, 0, 255,
        0, 255, 0, 255, 0, 255, 0, 255,
      ]),
      pma: false,
    }
    const surface = target()
    const atlasPacket = packet({
      atlasPage: 0,
      atlasKey: 'square',
      uvs: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
      colors: new Uint8Array(16).fill(255),
    })
    paintPackets(surface, [atlasPacket], {
      transform,
      atlas: {
        pages: [image],
        regions: new Map([['square', { page: 0, region: { id: 'square', x: 0, y: 0, width: 2, height: 2 } }]]),
      },
    })
    expect(pixel(surface, 5, 5)).toEqual([0, 255, 0, 255])

    const masked = target()
    const mask = new Uint8Array(12 * 12)
    for (let y = 0; y < 12; y += 1) for (let x = 6; x < 12; x += 1) mask[y * 12 + x] = 255
    paintPackets(masked, [packet({ mask: 'half' })], { transform, masks: new Map([['half', mask]]) })
    expect(pixel(masked, 3, 5)[3]).toBe(255)
    expect(pixel(masked, 3, 5)[0]).toBe(0)
    expect(pixel(masked, 6, 5)[0]).toBe(255)
  })

  it('R5：描边与 add 混合', () => {
    const surface = target()
    const outlined = packet({
      outline: {
        widthPx: 2,
        color: { r: 0, g: 0, b: 0, a: 1 },
        join: 'round',
        cap: 'round',
        depthBias: 0,
      },
    })
    paintPackets(surface, [outlined], { transform })
    // 边附近应出现深色描边，中心仍是填充色。
    expect(pixel(surface, 5, 5)).toEqual([255, 0, 0, 255])
    const edge = pixel(surface, 2, 5)
    expect(edge[0]).toBeLessThan(255)

    const add = target()
    paintPackets(add, [packet({ blend: 'add' })], { transform })
    expect(pixel(add, 5, 5)).toEqual([255, 0, 0, 255])
    expect(() => paintPackets({ width: 1, height: 1, pixels: new Uint8ClampedArray(1) }, [packet()], { transform })).toThrow(/^target$/)
  })
})
