import { vec2 as glVec2 } from 'gl-matrix'

export type Vec2 = Float32Array

export function createVec2(): Vec2 {
  return glVec2.create() as Vec2
}

export function setVec2(out: Vec2, x: number, y: number): Vec2 {
  out[0] = x
  out[1] = y
  return out
}

export function copyVec2(out: Vec2, a: Vec2): Vec2 {
  return glVec2.copy(out, a) as Vec2
}

export function addVec2(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  return glVec2.add(out, a, b) as Vec2
}

export function subVec2(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  return glVec2.subtract(out, a, b) as Vec2
}

export function scaleVec2(out: Vec2, a: Vec2, s: number): Vec2 {
  return glVec2.scale(out, a, s) as Vec2
}

export function negateVec2(out: Vec2, a: Vec2): Vec2 {
  return glVec2.negate(out, a) as Vec2
}

export function dotVec2(a: Vec2, b: Vec2): number {
  return glVec2.dot(a, b)
}

export function crossVec2(a: Vec2, b: Vec2): number {
  return a[0]! * b[1]! - a[1]! * b[0]!
}

export function lengthVec2(a: Vec2): number {
  return glVec2.length(a)
}

export function squaredLengthVec2(a: Vec2): number {
  return glVec2.squaredLength(a)
}

export function distanceVec2(a: Vec2, b: Vec2): number {
  return glVec2.distance(a, b)
}

export function normalizeVec2(out: Vec2, a: Vec2): boolean {
  const x = a[0]!
  const y = a[1]!
  const lenSq = x * x + y * y
  if (lenSq === 0) {
    out[0] = 0
    out[1] = 0
    return false
  }
  glVec2.normalize(out, a)
  return true
}

export function normalVec2(out: Vec2, a: Vec2): boolean {
  const ax = a[0]!
  const ay = a[1]!
  const nx = -ay
  const ny = ax
  const lenSq = nx * nx + ny * ny
  if (lenSq === 0) {
    out[0] = 0
    out[1] = 0
    return false
  }
  const inv = 1 / Math.sqrt(lenSq)
  out[0] = nx * inv
  out[1] = ny * inv
  return true
}

export function lerpVec2(out: Vec2, a: Vec2, b: Vec2, t: number): Vec2 {
  return glVec2.lerp(out, a, b, t) as Vec2
}
