import { vec2 as glVec2 } from 'gl-matrix'

/** 二维向量，Float32Array，长度 2。 */
export type Vec2 = Float32Array

/**
 * 创建零向量；仅初始化时用。
 * @returns 新的 `(0, 0)` 向量
 */
export function createVec2(): Vec2 {
  return glVec2.create() as Vec2
}

/**
 * 写入分量 `(x, y)`。
 * @param out 输出缓冲
 * @param x x 分量
 * @param y y 分量
 * @returns `out`
 */
export function setVec2(out: Vec2, x: number, y: number): Vec2 {
  out[0] = x
  out[1] = y
  return out
}

/**
 * 复制 `a` 到 `out`。
 * @param out 输出缓冲
 * @param a 源向量
 * @returns `out`
 */
export function copyVec2(out: Vec2, a: Vec2): Vec2 {
  return glVec2.copy(out, a) as Vec2
}

/**
 * `out = a + b`。
 * @param out 输出缓冲
 * @param a 左操作数
 * @param b 右操作数
 * @returns `out`
 */
export function addVec2(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  return glVec2.add(out, a, b) as Vec2
}

/**
 * `out = a − b`。
 * @param out 输出缓冲
 * @param a 被减数
 * @param b 减数
 * @returns `out`
 */
export function subVec2(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  return glVec2.subtract(out, a, b) as Vec2
}

/**
 * `out = a · s`（标量乘）。
 * @param out 输出缓冲
 * @param a 源向量
 * @param s 标量
 * @returns `out`
 */
export function scaleVec2(out: Vec2, a: Vec2, s: number): Vec2 {
  return glVec2.scale(out, a, s) as Vec2
}

/**
 * `out = −a`。
 * @param out 输出缓冲
 * @param a 源向量
 * @returns `out`
 */
export function negateVec2(out: Vec2, a: Vec2): Vec2 {
  return glVec2.negate(out, a) as Vec2
}

/**
 * 点积。
 * @param a 左操作数
 * @param b 右操作数
 */
export function dotVec2(a: Vec2, b: Vec2): number {
  return glVec2.dot(a, b)
}

/**
 * 二维叉积标量 `ax·by − ay·bx`（有符号面积相关）。
 * @param a 左操作数
 * @param b 右操作数
 */
export function crossVec2(a: Vec2, b: Vec2): number {
  return a[0]! * b[1]! - a[1]! * b[0]!
}

/**
 * 欧氏长度。
 * @param a 向量
 */
export function lengthVec2(a: Vec2): number {
  return glVec2.length(a)
}

/**
 * 长度平方，避免开方。
 * @param a 向量
 */
export function squaredLengthVec2(a: Vec2): number {
  return glVec2.squaredLength(a)
}

/**
 * `a` 与 `b` 的欧氏距离。
 * @param a 起点
 * @param b 终点
 */
export function distanceVec2(a: Vec2, b: Vec2): number {
  return glVec2.distance(a, b)
}

/**
 * 单位化 `a` 写入 `out`。
 * @param out 输出缓冲
 * @param a 源向量
 * @returns 成功为 `true`；零向量时写 `(0,0)` 并返回 `false`
 */
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

/**
 * `a` 逆时针转 90° 后的单位法向写入 `out`。
 * @param out 输出缓冲
 * @param a 源向量
 * @returns 成功为 `true`；零向量时写 `(0,0)` 并返回 `false`
 */
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

/**
 * 线性插值 `out = a + t·(b − a)`。
 * @param out 输出缓冲
 * @param a 起点
 * @param b 终点
 * @param t 插值参数
 * @returns `out`
 */
export function lerpVec2(out: Vec2, a: Vec2, b: Vec2, t: number): Vec2 {
  return glVec2.lerp(out, a, b, t) as Vec2
}
