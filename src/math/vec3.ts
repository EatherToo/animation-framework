import { vec3 as glVec3 } from 'gl-matrix'

export type Vec3 = Float32Array

export function createVec3(): Vec3 {
  return glVec3.create() as Vec3
}

export function setVec3(out: Vec3, x: number, y: number, z: number): Vec3 {
  out[0] = x
  out[1] = y
  out[2] = z
  return out
}

export function copyVec3(out: Vec3, a: Vec3): Vec3 {
  return glVec3.copy(out, a) as Vec3
}

export function crossVec3(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  return glVec3.cross(out, a, b) as Vec3
}

export function lengthVec3(a: Vec3): number {
  return glVec3.length(a)
}

export function normalizeVec3(out: Vec3, a: Vec3): boolean {
  const x = a[0]!
  const y = a[1]!
  const z = a[2]!
  const lenSq = x * x + y * y + z * z
  if (lenSq === 0) {
    out[0] = 0
    out[1] = 0
    out[2] = 0
    return false
  }
  glVec3.normalize(out, a)
  return true
}

export function normalVec3(out: Vec3, a: Vec3, b: Vec3): boolean {
  const ax = a[0]!
  const ay = a[1]!
  const az = a[2]!
  const bx = b[0]!
  const by = b[1]!
  const bz = b[2]!
  const nx = ay * bz - az * by
  const ny = az * bx - ax * bz
  const nz = ax * by - ay * bx
  const lenSq = nx * nx + ny * ny + nz * nz
  if (lenSq === 0) {
    out[0] = 0
    out[1] = 0
    out[2] = 0
    return false
  }
  const inv = 1 / Math.sqrt(lenSq)
  out[0] = nx * inv
  out[1] = ny * inv
  out[2] = nz * inv
  return true
}

export function faceNormalVec3(out: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean {
  const ax = a[0]!
  const ay = a[1]!
  const az = a[2]!
  const bx = b[0]!
  const by = b[1]!
  const bz = b[2]!
  const cx = c[0]!
  const cy = c[1]!
  const cz = c[2]!
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const acx = cx - ax
  const acy = cy - ay
  const acz = cz - az
  const nx = aby * acz - abz * acy
  const ny = abz * acx - abx * acz
  const nz = abx * acy - aby * acx
  const lenSq = nx * nx + ny * ny + nz * nz
  if (lenSq === 0) {
    out[0] = 0
    out[1] = 0
    out[2] = 0
    return false
  }
  const inv = 1 / Math.sqrt(lenSq)
  out[0] = nx * inv
  out[1] = ny * inv
  out[2] = nz * inv
  return true
}
