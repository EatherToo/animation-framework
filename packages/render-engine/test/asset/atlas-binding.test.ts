import { describe, expect, it } from '@jest/globals'
import { importSpineAtlas } from '@/asset/atlas'

const atlasText = `first.png
size: 2,2
first
  bounds: 0,0,1,1

second.png
size: 2,2
second
  bounds: 0,0,1,1
`

describe('atlas named page binding', () => {
  it('binds swapped images by name, preserving each page index', () => {
    const first = { width: 2, height: 2, data: new Uint8Array(16).fill(1) }
    const second = { width: 2, height: 2, data: new Uint8Array(16).fill(2) }
    const atlas = importSpineAtlas(atlasText, { pages: [
      { index: 0, name: 'second.png', width: 2, height: 2, image: second },
      { index: 1, name: 'first.png', width: 2, height: 2, image: first },
    ] })
    expect(atlas.pages[0]?.image).toBe(first)
    expect(atlas.pages[1]?.image).toBe(second)
    expect(atlas.regions.get('second')?.page).toBe(1)
  })

  it('reports missing or ambiguous named pages rather than binding by position', () => {
    const onlyFirst = { index: 1, name: 'first.png', width: 2, height: 2 }
    expect(() => importSpineAtlas(atlasText, { pages: [onlyFirst] })).toThrow(/E_TEXTURE_MISSING.*second.png/)
    expect(() => importSpineAtlas(atlasText, { pages: [onlyFirst, onlyFirst] })).toThrow(/E_ATLAS_PAGE.*first.png/)
  })
})
