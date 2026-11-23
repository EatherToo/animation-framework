import { describe, expect, it } from '@jest/globals'
import { CpuBackend, WebGL2Backend } from '@/backend/backend'
import { ProgramCache } from '@/render/shader-variants'
import { FakeWebGL } from './fake-webgl'
import { batchPackets, buildMeshPacket, buildRegionPacket, type RenderAssets, type RenderFrame } from '@/render/render'

const texel = [64, 32, 16, 128] as const // PMA texel
const page = { width: 1, height: 1, pma: true, data: Uint8Array.from(texel) }
const assets: RenderAssets = {
  pages: [page],
  materials: [{ id: 1, kind: 'sprite', page: 0, filter: 'nearest' }],
}
const positions = new Float32Array([0, 0, 2, 0, 2, 2, 0, 2])
const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
const light = [0.8, 0.6, 0.4, 0.5] as const
const dark = [0.5, 0.25, 1, 0.75] as const

function render(twoColor: boolean, tintBlack = false): { pixel: number[]; frame: RenderFrame } {
  const packet = buildRegionPacket({
    id: 1, positions, uvs, color: light,
    ...(twoColor ? { dark, twoColor: true } : {}),
    materialId: 1, page: 0, order: 0, depthKey: 0,
  })
  const frame: RenderFrame = {
    packets: [packet], width: 2, height: 2,
    assets: tintBlack ? { ...assets, materials: [{ ...assets.materials[0]!, tintBlack: true }] } : assets,
  }
  const backend = new CpuBackend({ width: 2, height: 2, background: [0, 0, 0, 0] })
  backend.draw(frame)
  return { pixel: Array.from(backend.readPixels().subarray(0, 4)), frame }
}

class ShaderGL extends FakeWebGL {
  readonly sources: string[] = []
  override shaderSource(shader: unknown, source: string): void {
    this.sources.push(source)
    super.shaderSource(shader, source)
  }
}

describe('two-color tint', () => {
  it.each([false, true])('matches official PMA texel equation, tintBlack=%s', (tintBlack) => {
    const { pixel, frame } = render(true, tintBlack)
    expect(frame.packets[0]!.colors.subarray(0, 4)).toEqual(Uint8Array.from([102, 77, 51, 128]))
    expect(frame.packets[0]!.dark!.subarray(0, 4)).toEqual(Uint8Array.from([128, 64, 255, 191]))
    // Official equation on those bytes: a=tex.a*light.a, RGB uses tex.a and dark.a separately.
    expect(pixel).toEqual(tintBlack ? [26, 10, 3, 64] : [74, 42, 147, 64])
  })

  it('keeps normal PMA modulation when dark is absent', () => {
    const { pixel, frame } = render(false)
    expect(frame.packets[0]!.dark).toBeUndefined()
    expect(pixel).toEqual([26, 10, 3, 64])
    expect(render(false, true).pixel).toEqual(pixel)
  })

  it('preserves per-vertex dark bytes and pixels across batching', () => {
    const first = render(true).frame.packets[0]!
    const second = buildRegionPacket({
      id: 2, positions: new Float32Array([2, 0, 4, 0, 4, 2, 2, 2]), uvs,
      color: [0.2, 0.4, 0.6, 0.5], dark: [0.1, 0.7, 0.2, 1],
      materialId: 1, page: 0, order: 1, depthKey: 0,
    })
    const packets = [first, second]
    const batched = batchPackets(packets)
    expect(batched).toHaveLength(1)
    expect(Array.from(batched[0]!.dark!)).toEqual([...first.dark!, ...second.dark!])
    const draw = (toDraw: typeof packets): number[] => {
      const cpu = new CpuBackend({ width: 4, height: 2, background: [0, 0, 0, 0] })
      cpu.draw({ packets: toDraw, width: 4, height: 2, assets })
      return Array.from(cpu.readPixels())
    }
    expect(draw(batched)).toEqual(draw(packets))
    expect(batchPackets([first, { ...second, twoColor: false }])).toHaveLength(2)
  })

  it('keeps mesh dark bytes unmultiplied by dark alpha', () => {
    const packet = buildMeshPacket({
      id: 3, positions: new Float32Array([0, 0, 2, 0, 0, 2]),
      indices: new Uint16Array([0, 1, 2]), color: light, dark,
      materialId: 1, order: 0, depthKey: 0,
    })
    expect(Array.from(packet.dark!.subarray(0, 4))).toEqual([128, 64, 255, 191])
  })

  it.each([false, true])('uses one official equation in default/cache WebGL shaders, cached=%s', (cached) => {
    const gl = new ShaderGL()
    const backend = new WebGL2Backend(gl, undefined, cached ? new ProgramCache(gl) : undefined)
    backend.draw(render(true, true).frame)
    const source = gl.sources.find((s) => s.includes('out vec4 outColor') && s.includes('#define TINT_BLACK 1'))
    if (!cached) expect(source).toBeUndefined()
    const fragment = cached ? source! : gl.sources.find((s) => s.includes('out vec4 outColor'))!
    expect(fragment).toContain('uTintBlack > 0.5 ? vec4(0.0, 0.0, 0.0, 1.0) : vDark')
    expect(fragment).toContain('((texel.a - 1.0) * dark.a + 1.0 - texel.rgb) * dark.rgb + texel.rgb * vColor.rgb')
    expect(gl.argsOf('uniform1f')).toContainEqual(['uTintBlack', 1])
    expect(fragment).toContain('texture(uMask, uv).a')
  })
})
