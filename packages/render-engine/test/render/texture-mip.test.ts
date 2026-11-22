import { describe, expect, it } from '@jest/globals'
import { WebGL2Backend, type WebGL2Like } from '@/backend/backend'
import { buildRegionPacket, type RenderAssets, type TextureData } from '@/render/render'
import { FakeWebGL } from './fake-webgl'

const GL_TEXTURE_2D = 0x0de1
const GL_TEXTURE_MAG_FILTER = 0x2800
const GL_TEXTURE_MIN_FILTER = 0x2801
const GL_TEXTURE_WRAP_S = 0x2802
const GL_TEXTURE_WRAP_T = 0x2803
const GL_LINEAR = 0x2601
const GL_NEAREST = 0x2600
const GL_LINEAR_MIPMAP_LINEAR = 0x2703
const GL_NEAREST_MIPMAP_NEAREST = 0x2700
const GL_CLAMP_TO_EDGE = 0x812f
const GL_REPEAT = 0x2901
const GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9240

/** 在 FakeWebGL 上补齐 mipmap / pixelStorei 的可观测记录。 */
class TextureWebGL extends FakeWebGL implements WebGL2Like {
  generateMipmap(target: number): void {
    this.calls.push({ op: 'generateMipmap', args: [target] })
  }

  pixelStorei(pname: number, param: number): void {
    this.calls.push({ op: 'pixelStorei', args: [pname, param] })
  }
}

function page(width: number, height: number, extra: Partial<TextureData> = {}): TextureData {
  return { width, height, data: new Uint8Array(width * height * 4).fill(255), ...extra }
}

/** 只取前 count 页的参数设置，排除末尾 1x1 白纹理的干扰。 */
function paramOf(gl: FakeWebGL, pname: number, count = 1): number[] {
  return gl.argsOf('texParameteri')
    .filter((a) => a[1] === pname)
    .map((a) => a[2] as number)
    .slice(0, count)
}

const sprite = (id: number, p: number, filter: 'linear' | 'nearest' = 'linear') =>
  ({ id, kind: 'sprite', page: p, filter }) as const

describe('S1 texture-mip: 页级 filter/wrap', () => {
  it('页级 filter 覆盖材质 filter，并同时设置 MIN/MAG', () => {
    const gl = new TextureWebGL()
    const backend = new WebGL2Backend(gl)
    backend.prepare({ pages: [page(2, 2, { filter: 'nearest' })], materials: [sprite(0, 0, 'linear')] })
    expect(paramOf(gl, GL_TEXTURE_MIN_FILTER)).toEqual([GL_NEAREST])
    expect(paramOf(gl, GL_TEXTURE_MAG_FILTER)).toEqual([GL_NEAREST])
  })

  it('缺省 filter 回落到材质 filter', () => {
    const gl = new TextureWebGL()
    const backend = new WebGL2Backend(gl)
    backend.prepare({ pages: [page(2, 2)], materials: [sprite(0, 0, 'nearest')] })
    expect(paramOf(gl, GL_TEXTURE_MIN_FILTER)).toEqual([GL_NEAREST])
    expect(paramOf(gl, GL_TEXTURE_MAG_FILTER)).toEqual([GL_NEAREST])
  })

  it('wrap=repeat 映射 REPEAT，缺省为 CLAMP_TO_EDGE', () => {
    const gl = new TextureWebGL()
    const backend = new WebGL2Backend(gl)
    backend.prepare({
      pages: [page(2, 2, { wrap: 'repeat' }), page(2, 2)],
      materials: [sprite(0, 0), sprite(1, 1)],
    })
    expect(paramOf(gl, GL_TEXTURE_WRAP_S, 2)).toEqual([GL_REPEAT, GL_CLAMP_TO_EDGE])
    expect(paramOf(gl, GL_TEXTURE_WRAP_T, 2)).toEqual([GL_REPEAT, GL_CLAMP_TO_EDGE])
  })
})

describe('S1 texture-mip: mipmap 生成', () => {
  it('mipmap=true 生成一次 mipmap 并切到 mipmap min filter', () => {
    const gl = new TextureWebGL()
    const backend = new WebGL2Backend(gl)
    backend.prepare({ pages: [page(4, 4, { mipmap: true })], materials: [sprite(0, 0)] })
    expect(gl.argsOf('generateMipmap')).toEqual([[GL_TEXTURE_2D]])
    expect(paramOf(gl, GL_TEXTURE_MIN_FILTER)).toEqual([GL_LINEAR_MIPMAP_LINEAR])
    expect(paramOf(gl, GL_TEXTURE_MAG_FILTER)).toEqual([GL_LINEAR])
  })

  it('nearest + mipmap 使用 NEAREST_MIPMAP_NEAREST', () => {
    const gl = new TextureWebGL()
    const backend = new WebGL2Backend(gl)
    backend.prepare({
      pages: [page(4, 4, { mipmap: true, filter: 'nearest' })],
      materials: [sprite(0, 0)],
    })
    expect(paramOf(gl, GL_TEXTURE_MIN_FILTER)).toEqual([GL_NEAREST_MIPMAP_NEAREST])
    expect(paramOf(gl, GL_TEXTURE_MAG_FILTER)).toEqual([GL_NEAREST])
  })

  it('mipmap=false 不生成，min filter 保持非 mipmap 值', () => {
    const gl = new TextureWebGL()
    const backend = new WebGL2Backend(gl)
    backend.prepare({ pages: [page(4, 4)], materials: [sprite(0, 0)] })
    expect(gl.argsOf('generateMipmap')).toEqual([])
    expect(paramOf(gl, GL_TEXTURE_MIN_FILTER)).toEqual([GL_LINEAR])
  })
})

describe('S1 texture-mip: 上传时机与 PMA', () => {
  it('只在 prepare 上传，draw 不重复 texImage2D/createTexture', () => {
    const gl = new TextureWebGL()
    const backend = new WebGL2Backend(gl)
    const assets: RenderAssets = { pages: [page(2, 2)], materials: [sprite(0, 0)] }
    backend.prepare(assets)
    const uploadsAfterPrepare = gl.count('texImage2D')
    const createsAfterPrepare = gl.count('createTexture')
    expect(uploadsAfterPrepare).toBe(2) // 页 + 1x1 白纹理

    const packet = buildRegionPacket({
      id: 1,
      positions: new Float32Array([0, 0, 2, 0, 2, 2, 0, 2]),
      color: [1, 1, 1, 1],
      materialId: 0,
      order: 0,
      depthKey: 0,
    })
    backend.draw({ packets: [packet], width: 2, height: 2, assets })
    backend.draw({ packets: [packet], width: 2, height: 2, assets })
    expect(gl.count('texImage2D')).toBe(uploadsAfterPrepare)
    expect(gl.count('createTexture')).toBe(createsAfterPrepare)
    expect(gl.count('generateMipmap')).toBe(0)
  })

  it('pma=false 在 CPU 预乘一次后上传', () => {
    const gl = new TextureWebGL()
    const backend = new WebGL2Backend(gl)
    const straight: TextureData = {
      width: 1, height: 1, pma: false,
      data: new Uint8Array([255, 255, 255, 128]),
    }
    backend.prepare({ pages: [straight], materials: [sprite(0, 0)] })
    const pageUpload = gl.argsOf('texImage2D').find((a) => a[3] === 1 && a[4] === 1 && a[8] instanceof Uint8Array && a[8].length === 4)
    expect(pageUpload).toBeDefined()
    expect(Array.from(pageUpload![8] as Uint8Array)).toEqual([128, 128, 128, 128])
  })

  it('上传后用 pixelStorei 把 UNPACK_PREMULTIPLY 状态恢复为 0', () => {
    const gl = new TextureWebGL()
    const backend = new WebGL2Backend(gl)
    backend.prepare({ pages: [page(2, 2, { pma: false })], materials: [sprite(0, 0)] })
    const stores = gl.argsOf('pixelStorei')
    expect(stores.length).toBeGreaterThan(0)
    for (const [pname, param] of stores) {
      expect(pname).toBe(GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL)
      expect(param).toBe(0)
    }
    const lastStore = gl.calls.map((c) => c.op).lastIndexOf('pixelStorei')
    const lastUpload = gl.calls.map((c) => c.op).lastIndexOf('texImage2D')
    expect(lastStore).toBeGreaterThan(lastUpload)
  })
})
