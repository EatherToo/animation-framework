import type { Vec2 } from '../math/vec2'
import type { Facing } from './facing'

/** 世界空间钉点，Float64Array，长度 2（米）。 */
export type WorldPoint = Float64Array

/**
 * 创建 `(0, 0)` 世界点；仅初始化时用。
 * @returns 新的世界点
 */
export function createWorldPoint(): WorldPoint {
  return new Float64Array(2)
}

/**
 * 写入分量 `(x, y)`。
 * @param out 输出缓冲
 * @param x 世界 x（米）
 * @param y 世界 y（米）
 * @returns `out`
 */
export function setWorldPoint(out: WorldPoint, x: number, y: number): WorldPoint {
  out[0] = x
  out[1] = y
  return out
}

/**
 * 复制 `a` 到 `out`；允许 `out === a`。
 * @param out 输出缓冲
 * @param a 源世界点
 * @returns `out`
 */
export function copyWorldPoint(out: WorldPoint, a: WorldPoint): WorldPoint {
  const x = a[0]!
  const y = a[1]!
  out[0] = x
  out[1] = y
  return out
}

/**
 * 角色点 → 世界点（全程 float64）：
 * `(ox + facing·px, oy + py)`。
 * @param out 输出世界点
 * @param p 角色空间点（米）
 * @param origin 放置原点（世界）
 * @param facing 实例朝向
 * @returns `out`
 */
export function rigToWorldPoint(
  out: WorldPoint,
  p: Vec2,
  origin: WorldPoint,
  facing: Facing,
): WorldPoint {
  const ox = origin[0]!
  const oy = origin[1]!
  const px = p[0]!
  const py = p[1]!
  out[0] = ox + facing * px
  out[1] = oy + py
  return out
}

/**
 * 世界点 → 角色点：在 float64 中减原点后写入 float32 `Vec2`。
 * `(facing·(wx−ox), wy−oy)`。解算换点必须走此路径，勿用 float32 矩阵。
 * @param out 输出角色点（float32）
 * @param w 世界点
 * @param origin 放置原点（世界）
 * @param facing 实例朝向
 * @returns `out`
 */
export function worldToRigPoint(
  out: Vec2,
  w: WorldPoint,
  origin: WorldPoint,
  facing: Facing,
): Vec2 {
  const ox = origin[0]!
  const oy = origin[1]!
  const wx = w[0]!
  const wy = w[1]!
  out[0] = facing * (wx - ox)
  out[1] = wy - oy
  return out
}
