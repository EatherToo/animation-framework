import { describe, expect, it } from '@jest/globals'
import {
  blendColor,
  packAtlas,
  packAtlasPages,
  regionUv,
  sampleAtlas,
  type AtlasImage,
} from '@/pipeline2d'

function image(): AtlasImage {
  const rgba = new Uint8Array(4 * 4 * 4)
  for (let i = 0; i < 16; i += 1) {
    rgba[i * 4] = i * 16
    rgba[i * 4 + 1] = 0
    rgba[i * 4 + 2] = 0
    rgba[i * 4 + 3] = 255
  }
  return { width: 4, height: 4, rgba, pma: false }
}

describe('pipeline2d atlas', () => {
  it('R3：shelf 打包不重叠、留 padding、页面为 2 的幂', () => {
    const atlas = packAtlas(
      [
        { id: 'a', width: 10, height: 8 },
        { id: 'b', width: 6, height: 6 },
        { id: 'c', width: 20, height: 4 },
      ],
      { padding: 2, maxWidth: 64, pma: true },
    )
    expect(atlas.width).toBe(64)
    expect(atlas.height).toBe(16)
    expect(atlas.pma).toBe(true)
    expect(atlas.regions).toHaveLength(3)
    for (const region of atlas.regions) {
      expect(region.x).toBeGreaterThanOrEqual(2)
      expect(region.y).toBeGreaterThanOrEqual(2)
      expect(region.x + region.width).toBeLessThanOrEqual(atlas.width)
      expect(region.y + region.height).toBeLessThanOrEqual(atlas.height)
    }
    for (let i = 0; i < atlas.regions.length; i += 1) {
      for (let j = i + 1; j < atlas.regions.length; j += 1) {
        const a = atlas.regions[i]!
        const b = atlas.regions[j]!
        const overlap =
          a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
        expect(overlap).toBe(false)
      }
    }
    const uv = regionUv(atlas.regions[0]!, atlas)
    expect(uv.u0).toBeGreaterThan(0)
    expect(uv.u1).toBeLessThan(1)
    expect(uv.v0).toBeGreaterThan(0)
    expect(uv.v1).toBeLessThan(1)
  })

  it('R3：最多 4 页的 shelf 打包', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, width: 64, height: 64 }))
    const pages = packAtlasPages(items, { padding: 2, maxWidth: 256, maxHeight: 256, maxPages: 4 })
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.length).toBeLessThanOrEqual(4)
    for (const page of pages) {
      for (const region of page.regions) {
        expect(region.x + region.width).toBeLessThanOrEqual(page.width)
        expect(region.y + region.height).toBeLessThanOrEqual(page.height)
      }
    }
    expect(() =>
      packAtlasPages(
        Array.from({ length: 40 }, (_, i) => ({ id: `q${i}`, width: 64, height: 64 })),
        { padding: 2, maxWidth: 256, maxHeight: 256, maxPages: 4 },
      ),
    ).toThrow(/^atlas$/)
  })

  it('R3：最近邻/双线性采样与 PMA 反预乘', () => {
    const atlasImage = image()
    const region = { id: 'r', x: 0, y: 0, width: 2, height: 2 }
    const out = { r: 0, g: 0, b: 0, a: 0 }
    sampleAtlas(out, atlasImage, region, 0, 0, 'nearest')
    expect(out.a).toBe(1)
    expect(out.r).toBeCloseTo(0, 6)
    sampleAtlas(out, atlasImage, region, 1, 0, 'nearest')
    expect(out.r).toBeCloseTo(16 / 255, 6)

    const pma: AtlasImage = {
      width: 1,
      height: 1,
      rgba: Uint8Array.from([128, 0, 0, 128]),
      pma: true,
    }
    sampleAtlas(out, pma, { id: 'p', x: 0, y: 0, width: 1, height: 1 }, 0.5, 0.5, 'nearest')
    expect(out.r).toBeCloseTo(1, 6)
    expect(out.a).toBeCloseTo(128 / 255, 6)
    expect(Number.isFinite(out.g)).toBe(true)
  })

  it('R3：混合模式合成 straight 颜色', () => {
    const dst = { r: 0, g: 0, b: 1, a: 1 }
    blendColor(dst, { r: 1, g: 0, b: 0, a: 0.5 }, 'normal')
    expect(dst.r).toBeCloseTo(0.5, 6)
    expect(dst.b).toBeCloseTo(0.5, 6)
    expect(dst.a).toBe(1)
    const add = { r: 0, g: 0, b: 1, a: 1 }
    blendColor(add, { r: 1, g: 0, b: 0, a: 1 }, 'add')
    expect(add.r).toBeCloseTo(1, 6)
    expect(add.b).toBeCloseTo(1, 6)
    const clear = { r: 0, g: 0, b: 0, a: 0 }
    blendColor(clear, { r: 1, g: 0, b: 0, a: 0 }, 'normal')
    expect(clear).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('R3：非法图集/UV 被拒绝', () => {
    expect(() => packAtlas([{ id: 'a', width: 0, height: 1 }])).toThrow(/^atlas$/)
    expect(() => packAtlas([{ id: 'a', width: 100, height: 1 }], { maxWidth: 32 })).toThrow(/^atlas$/)
    const atlas = packAtlas([{ id: 'a', width: 2, height: 2 }], { padding: 0 })
    expect(() => regionUv({ id: 'x', x: 0, y: 0, width: 99, height: 2 }, atlas)).toThrow(/^atlas$/)
    const out = { r: 0, g: 0, b: 0, a: 0 }
    expect(() => sampleAtlas(out, image(), { id: 'r', x: 0, y: 0, width: 2, height: 2 }, Number.NaN, 0)).toThrow(/^uv$/)
  })
})
