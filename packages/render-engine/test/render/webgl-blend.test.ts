import { describe, expect, it } from '@jest/globals'
import { WebGL2Backend, type WebGL2Like } from '@/backend/backend'
import { buildRegionPacket, type BlendMode, type RenderFrame } from '@/render/render'
import { FakeWebGL } from './fake-webgl'

function packet(id: number, blend: BlendMode) {
  return buildRegionPacket({
    id, positions: new Float32Array([0, 0, 4, 0, 0, 4]),
    color: [1, 1, 1, 1], materialId: 0, order: id, depthKey: 0, seq: id, blend,
  })
}

function frame(modes: readonly BlendMode[]): RenderFrame {
  return { packets: modes.map((mode, i) => packet(i, mode)), width: 8, height: 8 }
}

const ONE = 1
const ONE_MINUS_SRC_ALPHA = 0x0303
const DST_COLOR = 0x0306
const ONE_MINUS_SRC_COLOR = 0x0301

describe('H1 WebGL2 blend state', () => {
  it('sets blendFunc for every packet mode and enables blending', () => {
    const gl = new FakeWebGL()
    const backend = new WebGL2Backend(gl)
    backend.draw(frame(['normal', 'add', 'multiply', 'screen']))
    const funcs = gl.argsOf('blendFunc')
    expect(funcs).toEqual([
      [ONE, ONE_MINUS_SRC_ALPHA],
      [ONE, ONE],
      [DST_COLOR, ONE_MINUS_SRC_ALPHA],
      [ONE, ONE_MINUS_SRC_COLOR],
    ])
    expect(gl.argsOf('enable')).toContainEqual([0x0be2])
  })

  it('does not re-set blend when consecutive packets share the mode', () => {
    const gl = new FakeWebGL()
    new WebGL2Backend(gl).draw(frame(['normal', 'normal', 'normal']))
    expect(gl.argsOf('blendFunc')).toHaveLength(1)
  })
})
