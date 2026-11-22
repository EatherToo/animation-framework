import { describe, expect, it } from '@jest/globals'
import { ProgramCache, variantKey, variantOf, type ShaderVariant } from '@/render/shader-variants'

class FakeProgramGL {
  calls: string[] = []
  private next = 1
  createShader(type: number): number { this.calls.push(`createShader:${type}`); return this.next++ }
  shaderSource(): void { this.calls.push('shaderSource') }
  compileShader(): void { this.calls.push('compileShader') }
  getShaderParameter(): boolean { return true }
  createProgram(): number { this.calls.push('createProgram'); return 100 + this.next++ }
  attachShader(): void { this.calls.push('attachShader') }
  linkProgram(): void { this.calls.push('linkProgram') }
  getProgramParameter(): boolean { return true }
  useProgram(): void { this.calls.push('useProgram') }
  deleteProgram(): void { this.calls.push('deleteProgram') }
}

const variant: ShaderVariant = { pma: true, twoColor: false, tintBlack: false, alphaMask: false, stencil: false }

describe('shader variants', () => {
  it('keys variants by every material feature', () => {
    expect(variantKey(variant)).toBe('pma=1;two=0;black=0;alpha=0;stencil=0')
    expect(variantKey({ ...variant, twoColor: true })).not.toBe(variantKey(variant))
    expect(variantOf({ pma: true, twoColor: true, tintBlack: false, kind: 'sprite' }, 'stencil').stencil).toBe(true)
  })

  it('compiles once per variant and reuses the program', () => {
    const gl = new FakeProgramGL()
    const cache = new ProgramCache(gl)
    const first = cache.get(variant)
    const second = cache.get(variant)
    expect(second).toBe(first)
    expect(gl.calls.filter((c) => c === 'linkProgram')).toHaveLength(1)
    cache.get({ ...variant, twoColor: true })
    expect(gl.calls.filter((c) => c === 'linkProgram')).toHaveLength(2)
    expect(cache.size).toBe(2)
  })

  it('precompiles unique variants and disposes programs', () => {
    const gl = new FakeProgramGL()
    const cache = new ProgramCache(gl)
    cache.precompile([variant, variant, { ...variant, alphaMask: true }])
    expect(cache.size).toBe(2)
    cache.dispose()
    expect(gl.calls.filter((c) => c === 'deleteProgram')).toHaveLength(2)
    expect(() => cache.get(variant)).toThrow('E_DISPOSED')
  })
})
