/**
 * M11 图集导入单测：Spine atlas 文本 → AtlasData。
 * 覆盖页头、region bounds/offsets、rotate 90/180/270 的 UV 重排、半 texel、
 * 页数上限、稳定 hash 与 atlasRegionRef。
 */
import { describe, expect, it } from '@jest/globals'
import {
  atlasRegionRef,
  importSpineAtlas,
} from '@/asset/atlas'

const TEX = `sheet.png
size: 256,128
format: RGBA8888
filter: Linear,Linear
repeat: none
pma: true
head
  bounds: 10,20,40,30
  offsets: 2,3,40,30
rot90
  bounds: 100,10,64,32
  offsets: 0,0,64,32
  rotate: 90
`

function mapUv(region: { uvMatrix: Float32Array }, u: number, v: number): [number, number] {
  const m = region.uvMatrix
  return [m[0]! * u + m[2]! * v + m[4]!, m[1]! * u + m[3]! * v + m[5]!]
}

function pageText(index: number): string {
  return `p${index}.png
size: 32,32
r${index}
  bounds: 0,0,8,8
  offsets: 0,0,8,8
`
}

describe('M11 atlas: 正常文本解析', () => {
  const atlas = importSpineAtlas(TEX)

  it('页头与 region 字段落到 AtlasData', () => {
    expect(atlas.format).toBe('dsh-2d-atlas')
    expect(atlas.pma).toBe(true)
    expect(atlas.colorSpace).toBe('srgb')
    expect(atlas.source).toBe('file')
    expect(atlas.pages).toHaveLength(1)
    expect(atlas.pages[0]!.width).toBe(256)
    expect(atlas.pages[0]!.height).toBe(128)
    expect(atlas.regions.size).toBe(2)

    const head = atlas.regions.get('head')!
    expect(head.page).toBe(0)
    expect({ x: head.x, y: head.y, width: head.width, height: head.height }).toEqual({
      x: 10, y: 20, width: 40, height: 30,
    })
    expect(head.trim).toEqual({ offsetX: 2, offsetY: 3, sourceWidth: 40, sourceHeight: 30 })
    expect(head.maxMip).toBeGreaterThanOrEqual(0)
    expect(head.uvMatrix).toBeInstanceOf(Float32Array)
    expect(head.uvMatrix).toHaveLength(6)
  })

  it('UV 矩阵按官方 trim/rotate 语义覆盖原尺寸图', () => {
    const head = atlas.regions.get('head')!
    const [u0, v0] = mapUv(head, 0, 0)
    const [u1, v1] = mapUv(head, 1, 1)
    expect(u0).toBeCloseTo((10 - 2) / 256, 8)
    expect(v0).toBeCloseTo((20 + 3) / 128, 8)
    expect(u1).toBeCloseTo((10 - 2 + 40) / 256, 8)
    expect(v1).toBeCloseTo((20 + 3 + 30) / 128, 8)
  })

  it('rotate 90 通过重排 UV 矩阵消除旋转', () => {
    const rot = atlas.regions.get('rot90')!
    const m = rot.uvMatrix
    expect(m[0]).toBeCloseTo(0, 8)
    expect(m[3]).toBeCloseTo(0, 8)
    expect(Math.abs(m[1]!)).toBeGreaterThan(0)
    expect(Math.abs(m[2]!)).toBeGreaterThan(0)

    // 四个角覆盖 packed 矩形；rotate 90 时原尺寸轴已交换。
    const corners = [mapUv(rot, 0, 0), mapUv(rot, 1, 0), mapUv(rot, 0, 1), mapUv(rot, 1, 1)]
    const us = corners.map((c) => c[0])
    const vs = corners.map((c) => c[1])
    expect(Math.min(...us)).toBeCloseTo(100 / 256, 8)
    expect(Math.max(...us)).toBeCloseTo((100 + 32) / 256, 8)
    expect(Math.min(...vs)).toBeCloseTo(10 / 128, 8)
    expect(Math.max(...vs)).toBeCloseTo((10 + 64) / 128, 8)
  })

  it('hash 稳定，内容变化则 hash 变化', () => {
    const again = importSpineAtlas(TEX)
    expect(atlas.hash).toMatch(/^[0-9a-f]{16}$/)
    expect(again.hash).toBe(atlas.hash)
    const changed = importSpineAtlas(TEX.replace('bounds: 10,20,40,30', 'bounds: 11,20,40,30'))
    expect(changed.hash).not.toBe(atlas.hash)
  })

  it('atlasRegionRef 返回页、矩形、页尺寸与 UV 矩阵', () => {
    const ref = atlasRegionRef(atlas, 'head')
    expect(ref).not.toBeNull()
    expect(ref!.page).toBe(0)
    expect(ref!.rect).toEqual({ x: 10, y: 20, width: 40, height: 30 })
    expect(ref!.pageSize).toEqual({ width: 256, height: 128 })
    expect(ref!.uvMatrix).toBe(atlas.regions.get('head')!.uvMatrix)
    expect(atlasRegionRef(atlas, 'ghost')).toBeNull()
  })
})

describe('M11 atlas: rotate 180/270 与 options', () => {
  it('rotate 180 翻转 u/v，rotate 270 交换轴', () => {
    const atlas = importSpineAtlas(`sheet.png
size: 64,64
r180
  bounds: 0,0,16,8
  offsets: 0,0,16,8
  rotate: 180
r270
  bounds: 32,0,16,8
  offsets: 0,0,16,8
  rotate: 270
`)
    const r180 = atlas.regions.get('r180')!
    expect(r180.uvMatrix[0]).toBeLessThan(0)
    expect(r180.uvMatrix[3]).toBeLessThan(0)
    const r270 = atlas.regions.get('r270')!
    expect(r270.uvMatrix[3]).toBeCloseTo(0, 8)
    expect(r270.uvMatrix[1]).toBeGreaterThan(0)
    expect(r270.uvMatrix[2]).toBeLessThan(0)
  })

  it('缺 size 时用 options.pages 补齐页尺寸，并记录 padding/bleed', () => {
    const atlas = importSpineAtlas(`sheet.png
body
  bounds: 4,4,8,8
  offsets: 0,0,8,8
`, {
      pages: [{ index: 0, width: 128, height: 64, image: { width: 128, height: 64 } }],
      padding: 6,
      bleed: 3,
    })
    expect(atlas.pages[0]!.width).toBe(128)
    expect(atlas.pages[0]!.height).toBe(64)
    expect(atlas.pages[0]!.image).toEqual({ width: 128, height: 64 })
    expect(atlas.padding).toBe(6)
    expect(atlas.bleed).toBe(3)
  })
})

describe('M11 atlas: 非法输入给出明确 code', () => {
  it('超过 4 页抛 E_ATLAS_PAGES', () => {
    const text = [0, 1, 2, 3, 4].map(pageText).join('\n')
    let caught: (Error & { code?: string }) | null = null
    try {
      importSpineAtlas(text)
    } catch (error) {
      caught = error as Error & { code?: string }
    }
    expect(caught).not.toBeNull()
    expect(caught!.code).toBe('E_ATLAS_PAGES')
    expect(caught!.message).toContain('E_ATLAS_PAGES')
  })

  it('region 缺 bounds 抛 E_ATLAS_REGION', () => {
    let caught: (Error & { code?: string }) | null = null
    try {
      importSpineAtlas(`sheet.png
size: 32,32
broken
  offsets: 0,0,8,8
`)
    } catch (error) {
      caught = error as Error & { code?: string }
    }
    expect(caught!.code).toBe('E_ATLAS_REGION')
  })

  it('非 90 倍数 rotate 抛 E_ATLAS_ROTATE', () => {
    let caught: (Error & { code?: string }) | null = null
    try {
      importSpineAtlas(`sheet.png
size: 32,32
broken
  bounds: 0,0,8,8
  rotate: 45
`)
    } catch (error) {
      caught = error as Error & { code?: string }
    }
    expect(caught!.code).toBe('E_ATLAS_ROTATE')
  })

  it('缺页尺寸且无 options.pages 抛 E_ATLAS_SIZE', () => {
    let caught: (Error & { code?: string }) | null = null
    try {
      importSpineAtlas(`sheet.png
broken
  bounds: 0,0,8,8
`)
    } catch (error) {
      caught = error as Error & { code?: string }
    }
    expect(caught!.code).toBe('E_ATLAS_SIZE')
  })
})
