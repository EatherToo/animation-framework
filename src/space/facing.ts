import { normalizeAngle } from '../math/angle'
import type { Vec2 } from '../math/vec2'

/** 实例水平朝向：`1` 朝角色 +X，`-1` 为水平镜像。 */
export type Facing = 1 | -1

/** 远近侧标签（相对画面/观看者）。 */
export type Side = 'left' | 'right'

/**
 * 是否为合法 `Facing`（严格等于 ±1）。
 * @param x 待判定值
 */
export function isFacing(x: unknown): x is Facing {
  return x === 1 || x === -1
}

/**
 * 近侧：`facing=1` 为 right，`facing=-1` 为 left。
 * @param facing 实例朝向
 */
export function nearSide(facing: Facing): Side {
  return facing === 1 ? 'right' : 'left'
}

/**
 * 远侧：与 {@link nearSide} 相对。
 * @param facing 实例朝向
 */
export function farSide(facing: Facing): Side {
  return facing === 1 ? 'left' : 'right'
}

/**
 * 按朝向镜像方向角并折到 (-π, π]。
 * `facing=1` 只折角；`facing=-1` 为 `π − θ` 再折角。
 * @param rad 方向角（弧度，角色空间）
 * @param facing 实例朝向
 */
export function mirrorAngle(rad: number, facing: Facing): number {
  return facing === 1 ? normalizeAngle(rad) : normalizeAngle(Math.PI - rad)
}

/**
 * 按朝向镜像方向向量：`out = (facing·dx, dy)`。
 * 允许 `out === d`。
 * @param out 输出缓冲
 * @param d 源方向（角色空间）
 * @param facing 实例朝向
 * @returns `out`
 */
export function mirrorVec2(out: Vec2, d: Vec2, facing: Facing): Vec2 {
  const dx = d[0]!
  const dy = d[1]!
  out[0] = facing * dx
  out[1] = dy
  return out
}
