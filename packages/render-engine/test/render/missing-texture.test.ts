import { describe, expect, it } from '@jest/globals'
import { CpuBackend, WebGL2Backend } from '@/backend/backend'
import { buildRegionPacket, type RenderAssets, type RenderFrame } from '@/render/render'
import { FakeWebGL } from './fake-webgl'

const packet = buildRegionPacket({
  id: 1, positions: new Float32Array([0, 0, 2, 0, 2, 2, 0, 2]),
  color: [1, 1, 1, 1], materialId: 1, order: 0, depthKey: 0,
})
const page = (r: number) => ({ width: 1, height: 1, data: new Uint8Array([r, 0, 0, 255]) })
const assets = (r: number): RenderAssets => ({
  pages: [page(r)], materials: [{ id: 1, kind: 'sprite', page: 0, filter: 'nearest' }],
})
const frame = (input: RenderAssets): RenderFrame => ({ packets: [packet], width: 2, height: 2, assets: input })

describe('missing texture diagnostics', () => {
  it('rejects malformed pages on prepare for both backends', () => {
    const invalid: RenderAssets = { pages: [{ width: 1, height: 1, data: new Uint8Array(0) }], materials: [] }
    expect(() => new CpuBackend(2, 2).prepare(invalid)).toThrow(/E_ASSET_INVALID.*长度/)
    const gl = new FakeWebGL()
    expect(() => new WebGL2Backend(gl).prepare(invalid)).toThrow(/E_ASSET_INVALID.*长度/)
    expect(gl.argsOf('texImage2D')).toHaveLength(0)
  })

  it('rejects absent sprite pages before either backend can render white', () => {
    const bad: RenderAssets = {
      pages: [page(255)], materials: [{ id: 1, kind: 'sprite', page: 1, filter: 'linear' }],
    }
    expect(() => new CpuBackend(2, 2).draw(frame(bad))).toThrow(/E_ASSET_INVALID.*页/)
    const gl = new FakeWebGL()
    expect(() => new WebGL2Backend(gl).draw(frame(bad))).toThrow(/E_ASSET_INVALID.*页/)
    expect(gl.argsOf('drawElements')).toHaveLength(0)
  })

  it('uploads a new frame asset set and uses its page instead of stale GPU textures', () => {
    const gl = new FakeWebGL()
    const backend = new WebGL2Backend(gl)
    const first = assets(10)
    const second = assets(200)
    backend.prepare(first)
    backend.draw(frame(first))
    backend.draw(frame(second))
    const uploads = gl.argsOf('texImage2D').filter((args) => args[3] === 1 && args[4] === 1)
    expect(uploads.some((args) => (args[8] as Uint8Array)?.[0] === 200)).toBe(true)
    const draws = gl.calls.filter((call) => call.op === 'drawElements')
    const lastDrawIndex = gl.calls.indexOf(draws[draws.length - 1]!)
    const lastBinding = gl.calls.slice(0, lastDrawIndex).filter((call) => call.op === 'bindTexture').at(-1)
    expect(lastBinding?.args[1]).toBe(3)
  })
})
