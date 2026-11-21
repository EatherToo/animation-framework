import { describe, expect, it } from '@jest/globals'
import { WebGL2Backend } from '@/backend/backend'
import { FakeWebGL } from './fake-webgl'

describe('WebGL2 default program', () => {
  it('compiles and links the built-in shader when a real GL surface is available', () => {
    const gl = new FakeWebGL()
    const backend = new WebGL2Backend(gl)
    const ops = gl.calls.map((c) => c.op)
    expect(ops).toContain('createProgram')
    expect(ops.filter((op) => op === 'shaderSource')).toHaveLength(2)
    expect(ops).toContain('linkProgram')
    backend.draw({ packets: [], width: 4, height: 4 })
    expect(gl.calls.map((c) => c.op)).toContain('useProgram')
    expect(gl.argsOf('uniform2f')).toContainEqual(['uResolution', 4, 4])
  })

  it('keeps an injected program instead of compiling its own', () => {
    const gl = new FakeWebGL()
    const program = { id: 'custom' }
    new WebGL2Backend(gl, program)
    expect(gl.calls.some((c) => c.op === 'createProgram')).toBe(false)
  })
})
