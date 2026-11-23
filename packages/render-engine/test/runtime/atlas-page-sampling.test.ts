import { describe, expect, it } from '@jest/globals'
import type { SkeletonAsset } from '@/asset/importer'
import { importSpineAtlas } from '@/asset/atlas'
import { Engine, buildRenderAssets } from '@/runtime/runtime'
import { sampleTexture, type RenderMask } from '@/render/render'
import { WebGL2Backend } from '@/backend/backend'
import { FakeWebGL } from '../render/fake-webgl'

const atlas = importSpineAtlas([
  'one.png', 'size: 2, 1', 'filter: Nearest,Linear', 'repeat: x', 'pma: false',
  'first', '  bounds: 0,0,2,1', '',
  'two.png', 'size: 2, 1', 'filter: MipMapNearestLinear,Nearest', 'repeat: y', 'pma: true',
  'second', '  bounds: 0,0,2,1',
].join('\n'), { pages: [
  { index: 0, name: 'one.png', width: 2, height: 1, image: { width: 2, height: 1, data: Uint8Array.from([255, 0, 0, 128, 0, 0, 255, 255]) } },
  { index: 1, name: 'two.png', width: 2, height: 1, image: { width: 2, height: 1, data: Uint8Array.from([0, 255, 0, 255, 255, 255, 0, 255]) } },
] })
const assets = buildRenderAssets({ atlas } as SkeletonAsset)!

class SamplingGL extends FakeWebGL {
  generateMipmap(target: number): void { this.calls.push({ op: 'generateMipmap', args: [target] }) }
}

describe('N8 atlas page sampling metadata', () => {
  it('requests a stencil-capable default WebGL context', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const options: unknown[] = []
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
      createElement: () => ({ getContext: (kind: string, attrs: unknown) => {
        options.push([kind, attrs])
        return new SamplingGL()
      } }),
    } })
    try {
      const engine = new Engine({ backend: 'webgl2' })
      expect(options).toEqual([['webgl2', { stencil: true }]])
      engine.dispose()
    } finally {
      if (original === undefined) Reflect.deleteProperty(globalThis, 'document')
      else Object.defineProperty(globalThis, 'document', original)
    }
  })

  it('accepts 16-bit and 32-bit mask indices', () => {
    const mask = { id: 0, mode: 'stencil' as const, invert: false, feather: 0,
      positions: new Float32Array(0), bounds: { x: 0, y: 0, width: 0, height: 0 } }
    const shortMask: RenderMask = { ...mask, indices: new Uint16Array([0, 1, 2]) }
    const longMask: RenderMask = { ...mask, indices: new Uint32Array([0, 1, 2]) }
    expect(shortMask.indices).toBeInstanceOf(Uint16Array)
    expect(longMask.indices).toBeInstanceOf(Uint32Array)
  })
  it('keeps independent PMA, filters and U/V wraps per page', () => {
    expect(assets.pages[0]).toMatchObject({ pma: false, minFilter: 'nearest', magFilter: 'linear', uWrap: 'repeat', vWrap: 'clamp', mipmap: false })
    expect(assets.pages[1]).toMatchObject({ pma: true, minFilter: 'mipmapNearestLinear', magFilter: 'nearest', uWrap: 'clamp', vWrap: 'repeat', mipmap: true })
    expect(sampleTexture(assets.pages[0]!, -0.25, 0.5, 'nearest')).toEqual([0, 0, 255, 255])
    expect(sampleTexture(assets.pages[0]!, 0.25, 0.5, 'nearest')).toEqual([128, 0, 0, 128])
    expect(sampleTexture(assets.pages[0]!, 0, 0.5, 'linear')).toEqual([64, 0, 128, 192])
  })

  it('uploads independent GL filter/wrap states and generates only requested mips', () => {
    const gl = new SamplingGL()
    new WebGL2Backend(gl).prepare(assets)
    const params = gl.argsOf('texParameteri')
    const values = (pname: number) => params.filter((args) => args[1] === pname).slice(0, 2).map((args) => args[2])
    expect(values(0x2801)).toEqual([0x2600, 0x2702]) // MIN: nearest, nearest-mipmap-linear
    expect(values(0x2800)).toEqual([0x2601, 0x2600]) // MAG: linear, nearest
    expect(values(0x2802)).toEqual([0x2901, 0x812f]) // S: repeat, clamp
    expect(values(0x2803)).toEqual([0x812f, 0x2901]) // T: clamp, repeat
    expect(gl.argsOf('generateMipmap')).toEqual([[0x0de1]])
    const uploaded = gl.argsOf('texImage2D')
    expect(Array.from(uploaded[0]![8] as Uint8Array).slice(0, 4)).toEqual([128, 0, 0, 128])
    expect(Array.from(uploaded[1]![8] as Uint8Array).slice(0, 4)).toEqual([0, 255, 0, 255])
  })
})
