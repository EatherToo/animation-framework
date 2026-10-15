import { mat3 as glMat3, vec2 as glVec2 } from 'gl-matrix'
import type { Vec2 } from './vec2'

export type Mat3 = Float32Array

export function createMat3(): Mat3 {
  return glMat3.create() as Mat3
}

export function identityMat3(out: Mat3): Mat3 {
  return glMat3.identity(out) as Mat3
}

export function copyMat3(out: Mat3, a: Mat3): Mat3 {
  return glMat3.copy(out, a) as Mat3
}

export function multiplyMat3(out: Mat3, a: Mat3, b: Mat3): Mat3 {
  return glMat3.multiply(out, a, b) as Mat3
}

export function determinantMat3(a: Mat3): number {
  return glMat3.determinant(a)
}

export function invertMat3(out: Mat3, a: Mat3): boolean {
  for (let i = 0; i < 9; i += 1) {
    if (!Number.isFinite(a[i])) return false
  }
  const det = glMat3.determinant(a)
  if (det === 0) return false

  // Write into locals first so failure paths never mutate out, and so
  // out === a still works after the finite/det checks above.
  const a00 = a[0]!
  const a01 = a[1]!
  const a02 = a[2]!
  const a10 = a[3]!
  const a11 = a[4]!
  const a12 = a[5]!
  const a20 = a[6]!
  const a21 = a[7]!
  const a22 = a[8]!

  const b01 = a22 * a11 - a12 * a21
  const b11 = -a22 * a10 + a12 * a20
  const b21 = a21 * a10 - a11 * a20
  const invDet = 1 / det

  out[0] = b01 * invDet
  out[1] = (-a22 * a01 + a02 * a21) * invDet
  out[2] = (a12 * a01 - a02 * a11) * invDet
  out[3] = b11 * invDet
  out[4] = (a22 * a00 - a02 * a20) * invDet
  out[5] = (-a12 * a00 + a02 * a10) * invDet
  out[6] = b21 * invDet
  out[7] = (-a21 * a00 + a01 * a20) * invDet
  out[8] = (a11 * a00 - a01 * a10) * invDet
  return true
}

export function fromTranslation(out: Mat3, v: Vec2): Mat3 {
  return glMat3.fromTranslation(out, v) as Mat3
}

export function fromRotation(out: Mat3, rad: number): Mat3 {
  return glMat3.fromRotation(out, rad) as Mat3
}

export function fromScaling(out: Mat3, v: Vec2): Mat3 {
  return glMat3.fromScaling(out, v) as Mat3
}

export function translateMat3(out: Mat3, a: Mat3, v: Vec2): Mat3 {
  return glMat3.translate(out, a, v) as Mat3
}

export function rotateMat3(out: Mat3, a: Mat3, rad: number): Mat3 {
  return glMat3.rotate(out, a, rad) as Mat3
}

export function scaleMat3(out: Mat3, a: Mat3, v: Vec2): Mat3 {
  return glMat3.scale(out, a, v) as Mat3
}

export function composeTRS(
  out: Mat3,
  translation: Vec2,
  rotationRad: number,
  scale: Vec2,
): Mat3 {
  const c = Math.cos(rotationRad)
  const s = Math.sin(rotationRad)
  const sx = scale[0]!
  const sy = scale[1]!
  out[0] = c * sx
  out[1] = s * sx
  out[2] = 0
  out[3] = -s * sy
  out[4] = c * sy
  out[5] = 0
  out[6] = translation[0]!
  out[7] = translation[1]!
  out[8] = 1
  return out
}

export function transformPoint(out: Vec2, a: Vec2, m: Mat3): Vec2 {
  return glVec2.transformMat3(out, a, m) as Vec2
}

export function transformVector(out: Vec2, a: Vec2, m: Mat3): Vec2 {
  const x = a[0]!
  const y = a[1]!
  out[0] = m[0]! * x + m[3]! * y
  out[1] = m[1]! * x + m[4]! * y
  return out
}
