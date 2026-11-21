import { describe, expect, it } from '@jest/globals'
import { buildMaterialLibrary, packAtlas, type AtlasPackerRegion } from '@/asset/atlas'

const regions: AtlasPackerRegion[] = [
  { id: 'a', width: 20, height: 20 },
  { id: 'b', width: 30, height: 16 },
  { id: 'c', width: 12, height: 40 },
  { id: 'd', width: 48, height: 24 },
]

describe('atlas packer', () => {
  it('packs every region inside a page without overlap or padding violations', () => {
    const atlas = packAtlas(regions, { pageSize: 64, padding: 2, bleed: 1, maxPages: 4 })
    expect(atlas.format).toBe('dsh-2d-atlas')
    expect(atlas.pages.length).toBeGreaterThanOrEqual(1)
    expect(atlas.regions.size).toBe(4)
    const all = [...atlas.regions.values()]
    for (const r of all) {
      expect(r.x).toBeGreaterThanOrEqual(atlas.padding)
      expect(r.y).toBeGreaterThanOrEqual(atlas.padding)
      expect(r.x + r.width).toBeLessThanOrEqual(64 - atlas.padding)
      expect(r.y + r.height).toBeLessThanOrEqual(64 - atlas.padding)
      expect(r.page).toBeGreaterThanOrEqual(0)
      expect(r.page).toBeLessThan(atlas.pages.length)
    }
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        const a = all[i]!
        const b = all[j]!
        if (a.page !== b.page) continue
        const separated = a.x + a.width + atlas.padding <= b.x ||
          b.x + b.width + atlas.padding <= a.x ||
          a.y + a.height + atlas.padding <= b.y ||
          b.y + b.height + atlas.padding <= a.y
        expect(separated).toBe(true)
      }
    }
  })

  it('is deterministic and generates half-texel UV matrices', () => {
    const a = packAtlas(regions, { pageSize: 64, padding: 2, bleed: 1 })
    const b = packAtlas(regions, { pageSize: 64, padding: 2, bleed: 1 })
    expect(a.hash).toBe(b.hash)
    const region = a.regions.get('a')!
    expect(region.uvMatrix[4]).toBeCloseTo((region.x + 0.5) / 64, 6)
    expect(region.uvMatrix[5]).toBeCloseTo((region.y + 0.5) / 64, 6)
    expect(region.uvMatrix[0]).toBeCloseTo((region.width - 1) / 64, 6)
    expect(region.uvMatrix[3]).toBeCloseTo((region.height - 1) / 64, 6)
  })

  it('throws when regions cannot fit within the page limit', () => {
    expect(() => packAtlas([
      { id: 'x', width: 60, height: 60 },
      { id: 'y', width: 60, height: 60 },
      { id: 'z', width: 60, height: 60 },
    ], { pageSize: 64, padding: 2, bleed: 1, maxPages: 1 })).toThrow(/pages|fit/i)
  })

  it('builds flat + one sprite material per page', () => {
    const atlas = packAtlas(regions, { pageSize: 64 })
    const materials = buildMaterialLibrary(atlas)
    expect(materials[0]).toMatchObject({ id: 0, kind: 'flat', page: -1 })
    expect(materials.filter((m) => m.kind === 'sprite')).toHaveLength(atlas.pages.length)
    for (const m of materials.slice(1)) expect(m.page).toBeGreaterThanOrEqual(0)
  })
})
