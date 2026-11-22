import { describe, expect, it } from '@jest/globals'
import {
  buildTexturePages,
  decodeImage,
  premultiply,
  type RawImage,
} from '@/asset/image'

function raw(width: number, height: number, pixels: number[]): RawImage {
  return { width, height, data: new Uint8Array(pixels) }
}

describe('S1 image: premultiply', () => {
  it('半透明像素按 a/255 预乘并四舍五入', () => {
    const out = premultiply(new Uint8Array([255, 0, 0, 255, 255, 255, 255, 128]))
    expect(Array.from(out)).toEqual([255, 0, 0, 255, 128, 128, 128, 128])
  })

  it('alpha=0 归零、alpha=255 原样，且不修改输入', () => {
    const input = new Uint8Array([200, 100, 50, 0, 10, 20, 30, 255])
    const out = premultiply(input)
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 10, 20, 30, 255])
    expect(Array.from(input)).toEqual([200, 100, 50, 0, 10, 20, 30, 255])
    expect(out).not.toBe(input)
  })

  it('极低 alpha 向下取整到 0，不做无意义的进位', () => {
    const out = premultiply(new Uint8Array([1, 1, 1, 1]))
    expect(Array.from(out)).toEqual([0, 0, 0, 1])
  })

  it('只乘一次：对已预乘数据再乘会继续变暗（调用方责任）', () => {
    const once = premultiply(new Uint8Array([255, 255, 255, 128]))
    expect(Array.from(once)).toEqual([128, 128, 128, 128])
  })
})

describe('S1 image: decodeImage', () => {
  it('RawImage 直通，保留 width/height/data', async () => {
    const source = raw(2, 1, [1, 2, 3, 255, 4, 5, 6, 128])
    const decoded = await decodeImage(source)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(1)
    expect(Array.from(decoded.data)).toEqual([1, 2, 3, 255, 4, 5, 6, 128])
  })

  it('接受 {data,width,height} 结构', async () => {
    const decoded = await decodeImage({ width: 1, height: 1, data: new Uint8Array([9, 8, 7, 6]) })
    expect(decoded.width).toBe(1)
    expect(Array.from(decoded.data)).toEqual([9, 8, 7, 6])
  })

  it('RGBA8 长度不符时抛错', async () => {
    await expect(decodeImage({ width: 2, height: 2, data: new Uint8Array(15) })).rejects.toThrow(/长度/)
  })

  it('宽高非法时抛错', async () => {
    await expect(decodeImage({ width: 0, height: 1, data: new Uint8Array(0) })).rejects.toThrow(/宽高/)
    await expect(decodeImage({ width: 2, height: -1, data: new Uint8Array(8) })).rejects.toThrow(/宽高/)
    await expect(decodeImage({ width: 1.5, height: 1, data: new Uint8Array(6) })).rejects.toThrow(/宽高/)
  })

  it('无法识别的来源且无 loader 时给出明确错误', async () => {
    await expect(decodeImage({ foo: 'bar' })).rejects.toThrow(/无法解码/)
  })

  it('自定义 loader 可接管未知来源并校验结果', async () => {
    const decoded = await decodeImage('url://page-0', async (source) => {
      expect(source).toBe('url://page-0')
      return raw(1, 1, [255, 255, 255, 255])
    })
    expect(decoded.width).toBe(1)
    expect(Array.from(decoded.data)).toEqual([255, 255, 255, 255])

    await expect(decodeImage('bad', async () => ({ width: 1, height: 1, data: new Uint8Array(3) }))).rejects.toThrow(/长度/)
  })
})

describe('S1 image: buildTexturePages', () => {
  const atlas = {
    pages: [
      { width: 2, height: 1, image: raw(2, 1, new Array<number>(8).fill(255)) },
      { width: 1, height: 2, image: raw(1, 2, new Array<number>(8).fill(64)) },
    ],
  }

  it('按页生成 TextureData，尺寸来自页声明', async () => {
    const pages = await buildTexturePages(atlas)
    expect(pages.length).toBe(2)
    expect(pages[0]!.width).toBe(2)
    expect(pages[0]!.height).toBe(1)
    expect(pages[0]!.data.length).toBe(8)
    expect(pages[1]!.width).toBe(1)
    expect(pages[1]!.height).toBe(2)
  })

  it('默认 pma=true、filter=linear、wrap=clamp、mipmap=false', async () => {
    const [page] = await buildTexturePages(atlas)
    expect(page!.pma).toBe(true)
    expect(page!.filter).toBe('linear')
    expect(page!.wrap).toBe('clamp')
    expect(page!.mipmap).toBe(false)
  })

  it('options 透传到每页', async () => {
    const pages = await buildTexturePages(atlas, undefined, {
      pma: false, filter: 'nearest', wrap: 'repeat', mipmap: true,
    })
    for (const page of pages) {
      expect(page.pma).toBe(false)
      expect(page.filter).toBe('nearest')
      expect(page.wrap).toBe('repeat')
      expect(page.mipmap).toBe(true)
    }
  })

  it('loader 用于解析未知 image 来源', async () => {
    const pages = await buildTexturePages(
      { pages: [{ width: 1, height: 1, image: 'asset://p0' }] },
      async () => raw(1, 1, [1, 2, 3, 4]),
    )
    expect(pages.length).toBe(1)
    expect(Array.from(pages[0]!.data)).toEqual([1, 2, 3, 4])
  })

  it('页数超过 4 拒绝，0 页允许（flat）', async () => {
    const five = { pages: new Array(5).fill({ width: 1, height: 1, image: raw(1, 1, [0, 0, 0, 0]) }) }
    await expect(buildTexturePages(five)).rejects.toThrow(/4/)
    await expect(buildTexturePages({ pages: [] })).resolves.toEqual([])
  })

  it('缺图或解码尺寸与页声明不一致时抛错', async () => {
    await expect(buildTexturePages({ pages: [{ width: 1, height: 1 }] })).rejects.toThrow(/缺少图像/)
    await expect(buildTexturePages({
      pages: [{ width: 2, height: 2, image: raw(1, 1, [0, 0, 0, 0]) }],
    })).rejects.toThrow(/尺寸/)
  })
})
