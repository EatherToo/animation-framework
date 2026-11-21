import { describe, expect, it } from '@jest/globals'
import {
  angleDelta,
  composeAffine,
  decomposeAffine,
  detAffine,
  invertAffine,
  multiplyAffine,
  normalizeAngle,
  parentBasis,
  transformAffinePoint,
  type Affine,
} from '@/core/math'

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)
const affine = (values: number[]): Affine => Float64Array.from(values)
const closeAffine = (a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-6) => {
  for (let i = 0; i < 6; i += 1) close(a[i]!, b[i]!, eps)
}

describe('core2d affine math', () => {
  it('composes T·R·Shear·S with the documented expansion', () => {
    const m = composeAffine({
      x: 3, y: -2, rotation: Math.PI / 2,
      scaleX: 2, scaleY: 3, shearX: 0.2, shearY: -0.1,
    })
    // cos≈0, sin=1, sx=2, sy=3, ky=-0.1, kx=0.2
    close(m[0]!, 2 * (0 - 1 * -0.1))
    close(m[1]!, 2 * (1 + 0 * -0.1))
    close(m[2]!, 3 * (0 * 0.2 - 1))
    close(m[3]!, 3 * (1 * 0.2 + 0))
    close(m[4]!, 3)
    close(m[5]!, -2)
    close(detAffine(m), 2 * 3 * (1 - 0.2 * -0.1))
  })

  it('multiplies associatively and inverts exactly', () => {
    const a = composeAffine({ x: 1, y: 2, rotation: 0.7, scaleX: 2, scaleY: 1.5, shearX: 0.1, shearY: 0 })
    const b = composeAffine({ x: -3, y: 4, rotation: -1.2, scaleX: 0.5, scaleY: 3, shearX: 0, shearY: 0.2 })
    const c = composeAffine({ x: 5, y: 1, rotation: 2, scaleX: 1, scaleY: 2, shearX: 0, shearY: 0 })
    closeAffine(multiplyAffine(multiplyAffine(a, b), c), multiplyAffine(a, multiplyAffine(b, c)))
    const inv = invertAffine(a)!
    closeAffine(multiplyAffine(a, inv), affine([1, 0, 0, 1, 0, 0]))
    const p: [number, number] = transformAffinePoint(a, 2, 3)
    const q: [number, number] = transformAffinePoint(inv, p[0], p[1])
    close(q[0], 2)
    close(q[1], 3)
  })

  it('rejects singular matrices', () => {
    const singular = composeAffine({ x: 0, y: 0, rotation: 0, scaleX: 0, scaleY: 1, shearX: 0, shearY: 0 })
    expect(invertAffine(singular)).toBeNull()
  })

  it('decomposes shear-x transforms back into 7 channels', () => {
    const t = { x: 4, y: 5, rotation: 0.6, scaleX: 1.7, scaleY: 0.8, shearX: 0.35, shearY: 0 }
    const d = decomposeAffine(composeAffine(t))
    close(d.x, t.x)
    close(d.y, t.y)
    close(d.rotation, t.rotation)
    close(d.scaleX, t.scaleX)
    close(d.scaleY, t.scaleY)
    close(d.shearX, t.shearX)
    close(d.shearY, 0)
  })

  it('normalizes angles to [-pi, pi) and takes shortest arcs', () => {
    close(normalizeAngle(0), 0)
    close(normalizeAngle(Math.PI), -Math.PI)
    close(normalizeAngle(-Math.PI), -Math.PI)
    close(normalizeAngle(3 * Math.PI), -Math.PI)
    close(angleDelta(3, -3), 2 * Math.PI - 6)
    close(angleDelta(0, 4 * Math.PI), 0, 1e-5)
  })
})

describe('core2d inherit modes', () => {
  const parent = composeAffine({ x: 10, y: 20, rotation: Math.PI / 2, scaleX: 2, scaleY: 3, shearX: 0.25, shearY: 0 })

  it('normal inherits the parent unchanged', () => {
    closeAffine(parentBasis('normal', parent), parent)
  })

  it('onlyTranslation keeps translation and identity basis', () => {
    closeAffine(parentBasis('onlyTranslation', parent), affine([1, 0, 0, 1, 10, 20]))
  })

  it('noRotationOrReflection keeps axis lengths only', () => {
    const ly = Math.hypot(3, 0.75)
    closeAffine(parentBasis('noRotationOrReflection', parent), affine([2, 0, 0, ly, 10, 20]))
  })

  it('noScale keeps direction and shear but normalizes lengths', () => {
    const p = parentBasis('noScale', parent)
    close(Math.hypot(p[0]!, p[1]!), 1)
    close(Math.hypot(p[2]!, p[3]!), 1)
    close(p[0]!, 0)
    close(p[1]!, 1)
    close(p[2]!, -3 / Math.hypot(3, 0.75))
    close(p[3]!, 0.75 / Math.hypot(3, 0.75))
  })

  it('noScaleOrReflection flips a reflected basis back to positive det', () => {
    const reflected = affine([1, 0, 0, -2, 1, 2])
    const p = parentBasis('noScaleOrReflection', reflected)
    expect(detAffine(p)).toBeGreaterThan(0)
    close(p[4]!, 1)
    close(p[5]!, 2)
    close(Math.hypot(p[2]!, p[3]!), 1)
  })

  it('degenerate axes use the documented fallbacks', () => {
    const zero = affine([0, 0, 0, 0, 7, 8])
    closeAffine(parentBasis('noScale', zero), affine([1, 0, 0, 1, 7, 8]))
    closeAffine(parentBasis('noRotationOrReflection', zero), affine([0, 0, 0, 0, 7, 8]))
  })
})
