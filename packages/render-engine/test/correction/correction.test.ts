import { describe, expect, it } from '@jest/globals'
import { applyCorrection, createCorrection } from '@/correction/correction'

describe('correction', () => {
  it('首版求值是原样拷贝', () => {
    const correction = createCorrection()
    expect(correction.enabled).toBe(false)
    const positions = new Float32Array([1, 2, 3, 4])
    const out = new Float32Array(4)
    applyCorrection(out, positions, correction)
    for (let i = 0; i < positions.length; i += 1) {
      expect(Object.is(out[i], positions[i])).toBe(true)
    }
    positions[0] = 9
    expect(out[0]).toBe(1)
  })

  it('长度不符时不写 out', () => {
    const out = new Float32Array([7, 8])
    expect(() => applyCorrection(out, new Float32Array([1, 2, 3]), createCorrection())).toThrow(
      /^out$/,
    )
    expect(out[0]).toBe(7)
    expect(out[1]).toBe(8)
  })
})
