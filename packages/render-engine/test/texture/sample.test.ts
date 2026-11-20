import { describe, expect, it } from '@jest/globals'
import type { Texture } from '@/mesh/texture'
import { sampleTexture } from '@/texture/sample'

function image(): Texture {
  return {
    width: 2,
    height: 2,
    rgb: Uint8Array.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]),
  }
}

describe('texture sample', () => {
  it('按纹素边界取最近像素，越界夹到边缘', () => {
    const tex = image()
    const origin = sampleTexture(tex, 0, 0)
    expect(origin).toEqual({ r: 10 / 255, g: 20 / 255, b: 30 / 255 })
    expect(sampleTexture(tex, 0.49, 0).r).toBe(10 / 255)
    expect(sampleTexture(tex, 0.5, 0).r).toBe(40 / 255)
    expect(sampleTexture(tex, 1, 1).r).toBe(100 / 255)
    expect(sampleTexture(tex, -1, 2)).toEqual(sampleTexture(tex, 0, 1))
  })

  it('非有限纹理坐标抛出 uv', () => {
    expect(() => sampleTexture(image(), Number.NaN, 0)).toThrow(/^uv$/)
  })
})
