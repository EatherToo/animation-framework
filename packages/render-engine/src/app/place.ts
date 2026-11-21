/**
 * M12 足部落点放置。
 * 权威：docs/18-应用层/可达与放置.md。
 *
 * Placement 是纯值对象；placeFoot 返回新值，placeFootInto 才做事务式写入。
 * 腿链长度 l1/l2 只读，成功放置不会改变骨架长度。
 */
import type { FootPoint } from './foot'
import { solveReach, type ReachOptions } from './reach'

export type Placement = {
  x: number
  y: number
  valid: boolean
  residual: number
}

/** 把脚放到目标地面点；返回新的 Placement，不改调用者。 */
export function placeFoot(
  hip: FootPoint,
  target: FootPoint,
  l1: number,
  l2: number,
  opts?: ReachOptions,
): Placement {
  const reach = solveReach(hip, target, l1, l2, opts)
  return {
    x: target.x,
    y: target.y,
    valid: reach.reachable,
    residual: reach.residual,
  }
}

/** 事务式放置：失败返回 false 且 out 保持不变。 */
export function placeFootInto(
  out: Placement,
  hip: FootPoint,
  target: FootPoint,
  l1: number,
  l2: number,
  opts?: ReachOptions,
): boolean {
  const next = placeFoot(hip, target, l1, l2, opts)
  if (!next.valid) return false
  out.x = next.x
  out.y = next.y
  out.valid = true
  out.residual = next.residual
  return true
}
