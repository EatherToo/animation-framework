import { describe, expect, it } from '@jest/globals'
import { WebGL2Backend } from '@/backend/backend'
import { ProgramCache } from '@/render/shader-variants'
import { buildMeshPacket, type RenderFrame, type RenderMask } from '@/render/render'
import { FakeWebGL } from './fake-webgl'

class ShaderGL extends FakeWebGL {
  readonly sources: string[] = []
  readonly bounds: number[][] = []
  override shaderSource(shader: unknown, source: string): void {
    this.sources.push(source)
    super.shaderSource(shader, source)
  }
  uniform4f(_location: unknown, x: number, y: number, z: number, w: number): void {
    this.bounds.push([x, y, z, w])
  }
}

const page = { width: 1, height: 1, data: new Uint8Array([255, 255, 255, 128]) }
const assets = { pages: [page], materials: [{ id: 0, kind: 'sprite' as const, page: 0, filter: 'linear' as const }] }
const mask: RenderMask = {
  id: 0, mode: 'alpha', invert: true, feather: 1,
  positions: new Float32Array(0), indices: new Uint16Array(0),
  bounds: { x: 1, y: 2, width: 4, height: 6 },
  alpha: { page: 0, uvMatrix: new Float32Array([0.5, 0, 0, 0.5, 0.25, 0.25]) },
}
const packet = buildMeshPacket({
  id: 1, positions: new Float32Array([0, 0, 4, 0, 0, 4]),
  indices: new Uint16Array([0, 1, 2]), color: [1, 1, 1, 1],
  materialId: 0, order: 0, depthKey: 0,
})
const frame: RenderFrame = {
  packets: [{ ...packet, maskPath: 0 }, packet], width: 10, height: 10,
  assets, maskPaths: [{ maskId: 0, parent: -1 }], masks: { version: 1, masks: [mask] },
}

describe('WebGL2 alpha mask shader', () => {
  it.each([false, true])('samples mask in %s cache mode and resets before unmasked packet', (cached) => {
    const gl = new ShaderGL()
    const backend = new WebGL2Backend(gl, undefined, cached ? new ProgramCache(gl) : undefined)
    backend.draw(frame)
    const fragments = gl.sources.filter((s) => s.includes('out vec4 outColor'))
    expect(fragments.some((s) => s.includes('#define ALPHA_MASK 1') &&
      s.includes('texture(uMask, uv).a') && s.includes('c *= uMaskInvert'))).toBe(true)
    expect(gl.argsOf('uniform1i')).toContainEqual(['uTexture', 0])
    expect(gl.argsOf('uniform1i')).toContainEqual(['uMask', 1])
    expect(gl.argsOf('activeTexture')).toContainEqual([0x84c1])
    expect(gl.bounds).toContainEqual([1, 2, 4, 6])
    expect(gl.argsOf('uniformMatrix3fv')).toContainEqual([
      'uMaskUvMatrix', false, [0.5, 0, 0, 0, 0.5, 0, 0.25, 0.25, 1],
    ])
    expect(gl.argsOf('uniform1f')).toContainEqual(['uMaskInvert', 1])
    expect(gl.argsOf('uniform1f')).toContainEqual(['uMaskFeather', 1])
    const draws = gl.calls.flatMap((call, i) => call.op === 'drawElements' ? [i] : [])
    const maskOn = gl.calls.findIndex((call) => call.op === 'uniform1f' && call.args[0] === 'uAlphaMask' && call.args[1] === 1)
    expect(maskOn).toBeLessThan(draws[0]!)
    expect(gl.calls.slice(draws[0]! + 1, draws[1]!).some((call) =>
      call.op === 'uniform1f' && call.args[0] === 'uAlphaMask' && call.args[1] === 0)).toBe(true)
  })

  it('fails closed on missing page and rejects multiple alpha masks', () => {
    const missing = { ...mask, alpha: { ...mask.alpha!, page: 2 } }
    expect(() => new WebGL2Backend(new ShaderGL()).draw({ ...frame, masks: { version: 1, masks: [missing] } }))
      .toThrow(/E_TEXTURE_MISSING/)
    expect(() => new WebGL2Backend(new ShaderGL()).draw({
      ...frame, maskPaths: [{ maskId: 0, parent: -1 }, { maskId: 1, parent: 0 }],
      masks: { version: 1, masks: [mask, { ...mask, id: 1 }] },
      packets: [{ ...packet, maskPath: 1 }],
    })).toThrow(/多级 alpha mask/)
  })
})
