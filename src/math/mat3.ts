import { mat3 as glMat3, vec2 as glVec2 } from 'gl-matrix'
import type { Vec2 } from './vec2'

/** 3×3 矩阵，列主序 Float32Array，长度 9。 */
export type Mat3 = Float32Array

/**
 * 创建单位矩阵；仅初始化时用。
 * @returns 新的单位矩阵
 */
export function createMat3(): Mat3 {
  return glMat3.create() as Mat3
}

/**
 * 将 `out` 写成单位矩阵。
 * @param out 输出缓冲
 * @returns `out`
 */
export function identityMat3(out: Mat3): Mat3 {
  return glMat3.identity(out) as Mat3
}

/**
 * 复制 `a` 到 `out`。
 * @param out 输出缓冲
 * @param a 源矩阵
 * @returns `out`
 */
export function copyMat3(out: Mat3, a: Mat3): Mat3 {
  return glMat3.copy(out, a) as Mat3
}

/**
 * `out = a · b`（列向量约定下右边先生效）。
 * @param out 输出缓冲
 * @param a 左矩阵
 * @param b 右矩阵
 * @returns `out`
 */
export function multiplyMat3(out: Mat3, a: Mat3, b: Mat3): Mat3 {
  return glMat3.multiply(out, a, b) as Mat3
}

/**
 * 行列式。
 * @param a 矩阵
 */
export function determinantMat3(a: Mat3): number {
  return glMat3.determinant(a)
}

/**
 * 求逆写入 `out`。
 * @param out 输出缓冲
 * @param a 源矩阵
 * @returns 成功为 `true`；含非有限分量或行列式为 0 时不写 `out`，返回 `false`
 */
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

/**
 * 由平移向量构造矩阵。
 * @param out 输出缓冲
 * @param v 平移 `(tx, ty)`
 * @returns `out`
 */
export function fromTranslation(out: Mat3, v: Vec2): Mat3 {
  return glMat3.fromTranslation(out, v) as Mat3
}

/**
 * 由绕原点旋转角（弧度）构造矩阵。
 * @param out 输出缓冲
 * @param rad 旋转角（弧度）
 * @returns `out`
 */
export function fromRotation(out: Mat3, rad: number): Mat3 {
  return glMat3.fromRotation(out, rad) as Mat3
}

/**
 * 由缩放向量构造矩阵。
 * @param out 输出缓冲
 * @param v 缩放 `(sx, sy)`
 * @returns `out`
 */
export function fromScaling(out: Mat3, v: Vec2): Mat3 {
  return glMat3.fromScaling(out, v) as Mat3
}

/**
 * 在 `a` 右侧乘以平移，结果写入 `out`。
 * @param out 输出缓冲
 * @param a 源矩阵
 * @param v 平移 `(tx, ty)`
 * @returns `out`
 */
export function translateMat3(out: Mat3, a: Mat3, v: Vec2): Mat3 {
  return glMat3.translate(out, a, v) as Mat3
}

/**
 * 在 `a` 右侧乘以旋转，结果写入 `out`。
 * @param out 输出缓冲
 * @param a 源矩阵
 * @param rad 旋转角（弧度）
 * @returns `out`
 */
export function rotateMat3(out: Mat3, a: Mat3, rad: number): Mat3 {
  return glMat3.rotate(out, a, rad) as Mat3
}

/**
 * 在 `a` 右侧乘以缩放，结果写入 `out`。
 * @param out 输出缓冲
 * @param a 源矩阵
 * @param v 缩放 `(sx, sy)`
 * @returns `out`
 */
export function scaleMat3(out: Mat3, a: Mat3, v: Vec2): Mat3 {
  return glMat3.scale(out, a, v) as Mat3
}

/**
 * 组合 `T · R · S`（列向量下先缩放、再旋转、再平移）。
 * @param out 输出缓冲
 * @param translation 平移
 * @param rotationRad 旋转角（弧度）
 * @param scale 缩放
 * @returns `out`
 */
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

/**
 * 用矩阵变换点（含平移）：`out = m · a`（齐次 w=1）。
 * @param out 输出缓冲
 * @param a 源点
 * @param m 变换矩阵
 * @returns `out`
 */
export function transformPoint(out: Vec2, a: Vec2, m: Mat3): Vec2 {
  return glVec2.transformMat3(out, a, m) as Vec2
}

/**
 * 用矩阵变换方向（忽略平移）：`out = L · a`。
 * @param out 输出缓冲
 * @param a 源方向
 * @param m 变换矩阵
 * @returns `out`
 */
export function transformVector(out: Vec2, a: Vec2, m: Mat3): Vec2 {
  const x = a[0]!
  const y = a[1]!
  out[0] = m[0]! * x + m[3]! * y
  out[1] = m[1]! * x + m[4]! * y
  return out
}
