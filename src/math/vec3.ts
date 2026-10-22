import { vec3 as glVec3 } from 'gl-matrix'

/** 三维向量，Float32Array，长度 3。 */
export type Vec3 = Float32Array

/**
 * 创建零向量；仅初始化时用。
 * @returns 新的 `(0, 0, 0)` 向量
 */
export function createVec3(): Vec3 {
  return glVec3.create() as Vec3
}

/**
 * 写入分量 `(x, y, z)`。
 * @param out 输出缓冲
 * @param x x 分量
 * @param y y 分量
 * @param z z 分量
 * @returns `out`
 */
export function setVec3(out: Vec3, x: number, y: number, z: number): Vec3 {
  out[0] = x
  out[1] = y
  out[2] = z
  return out
}

/**
 * 复制 `a` 到 `out`。
 * @param out 输出缓冲
 * @param a 源向量
 * @returns `out`
 */
export function copyVec3(out: Vec3, a: Vec3): Vec3 {
  return glVec3.copy(out, a) as Vec3
}

/**
 * `out = a × b`。
 * @param out 输出缓冲
 * @param a 左操作数
 * @param b 右操作数
 * @returns `out`
 */
export function crossVec3(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  return glVec3.cross(out, a, b) as Vec3
}

/**
 * 欧氏长度。
 * @param a 向量
 */
export function lengthVec3(a: Vec3): number {
  return glVec3.length(a)
}

/**
 * 单位化 `a` 写入 `out`。
 * @param out 输出缓冲
 * @param a 源向量
 * @returns 成功为 `true`；零向量时写零向量并返回 `false`
 */
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

/**
 * `a × b` 的单位法向写入 `out`。
 * @param out 输出缓冲
 * @param a 边向量
 * @param b 边向量
 * @returns 成功为 `true`；平行/零叉积时写零向量并返回 `false`
 */
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

/**
 * 三角形 `a→b→c` 的单位面法向（`(b−a) × (c−a)`）写入 `out`。
 * @param out 输出缓冲
 * @param a 顶点 A
 * @param b 顶点 B
 * @param c 顶点 C
 * @returns 成功为 `true`；退化三角时写零向量并返回 `false`
 */
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
