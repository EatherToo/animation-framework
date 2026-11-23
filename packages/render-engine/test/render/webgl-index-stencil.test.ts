import { describe, expect, it } from '@jest/globals'
import { WebGL2Backend } from '@/backend/backend'
import { buildMeshPacket, type RenderFrame, type RenderMask } from '@/render/render'
import { FakeWebGL } from './fake-webgl'

const SHORT = 0x1403
const INT = 0x1405
const STENCIL = 0x0b90
const DEPTH = 0x0b71

function packet(indices: Uint16Array | Uint32Array, dark = false) {
  return buildMeshPacket({
    id: 1, positions: new Float32Array([0, 0, 4, 0, 0, 4]),
    indices, color: [1, 1, 1, 1], ...(dark ? { dark: [0.5, 0, 0, 1] as const } : {}),
    twoColor: dark, materialId: 0, order: 0, depthKey: 0,
  })
}

function maskedFrame(indices: Uint16Array | Uint32Array): RenderFrame {
  const mask: RenderMask = {
    id: 0, mode: 'stencil', invert: false, feather: 0,
    positions: new Float32Array([0, 0, 4, 0, 0, 4]),
    indices: indices as RenderMask['indices'],
    bounds: { x: 0, y: 0, width: 4, height: 4 },
  }
  return {
    packets: [{ ...packet(new Uint16Array([0, 1, 2])), maskPath: 0 }],
    width: 4, height: 4, depthMode: 'write',
    maskPaths: [{ maskId: 0, parent: -1 }], masks: { version: 1, masks: [mask] },
  }
}

describe('N9-T1 WebGL2 index and stencil state', () => {
  it('selects packet index type for each draw independently', () => {
    const gl = new FakeWebGL()
    new WebGL2Backend(gl).draw({
      packets: [packet(new Uint16Array([0, 1, 2])), packet(new Uint32Array([0, 1, 2]))],
      width: 4, height: 4,
    })
    expect(gl.argsOf('drawElements').map((args) => args[2])).toEqual([SHORT, INT])
  })

  it.each([new Uint16Array([0, 1, 2]), new Uint32Array([0, 1, 2])])(
    'selects mask index type and protects stencil from packet writes', (indices) => {
      const gl = new FakeWebGL()
      new WebGL2Backend(gl).draw(maskedFrame(indices))
      const draws = gl.calls.flatMap((call, i) => call.op === 'drawElements' ? [i] : [])
      expect(gl.argsOf('drawElements').map((args) => args[2])).toEqual([
        indices instanceof Uint16Array ? SHORT : INT, SHORT,
      ])
      expect(gl.argsOf('stencilMask')).toEqual([[0xff], [0], [0xff]])
      expect(gl.calls.findIndex((call) => call.op === 'disable' && call.args[0] === DEPTH))
        .toBeLessThan(draws[0]!)
      expect(gl.calls.findIndex((call, i) => i > draws[0]! && call.op === 'enable' && call.args[0] === DEPTH))
        .toBeLessThan(draws[1]!)
      expect(gl.argsOf('enable')).toContainEqual([STENCIL])
    },
  )

  it('disables and zeros aDark after a two-color packet', () => {
    const gl = new FakeWebGL()
    new WebGL2Backend(gl).draw({
      packets: [packet(new Uint16Array([0, 1, 2]), true), packet(new Uint16Array([0, 1, 2]))],
      width: 4, height: 4,
    })
    const draws = gl.calls.flatMap((call, i) => call.op === 'drawElements' ? [i] : [])
    const disable = gl.calls.findIndex((call) => call.op === 'disableVertexAttribArray' && call.args[0] === 3)
    expect(disable).toBeGreaterThan(draws[0]!)
    expect(disable).toBeLessThan(draws[1]!)
    expect(gl.argsOf('vertexAttrib4f')).toContainEqual([3, 0, 0, 0, 0])
  })

  it('rejects contexts without a stencil buffer when query is available', () => {
    const gl = Object.assign(new FakeWebGL(), { getParameter: (_name: number) => 0 })
    expect(() => new WebGL2Backend(gl)).toThrow(/stencil buffer/)
  })
})
