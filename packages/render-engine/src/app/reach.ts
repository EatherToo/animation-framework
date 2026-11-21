/**
 * M12 二骨链可达性。
 * 权威：docs/18-应用层/可达与放置.md。
 *
 * 独立解析实现：先用两段长度判定环带可达，再求解析角（可选关节限位）。
 * 失败必须给出 reason，调用方据此决定是否进入恢复。
 */
import { normalizeAngle } from '../core/math'
import type { FootPoint } from './foot'

export type ReachReason = 'ok' | 'unreachable' | 'degenerate' | 'limit'

export type ReachResult = {
  reachable: boolean
  residual: number
  reason: ReachReason
}

export type ReachLimits = {
  /** 根段角度限位 [min,max]（弧度）。 */
  root?: readonly [number, number]
  /** 中段相对根段的限位 [min,max]（弧度）。 */
  mid?: readonly [number, number]
}

export type ReachOptions = {
  bendSign?: 1 | -1
  tolerance?: number
  limits?: ReachLimits
}

const EPS = 1e-12

function within(angle: number, limit: readonly [number, number]): boolean {
  const a = normalizeAngle(angle)
  return a >= limit[0] - EPS && a <= limit[1] + EPS
}

function degenerate(): ReachResult {
  return { reachable: false, residual: Number.MAX_VALUE, reason: 'degenerate' }
}

/** 两骨解析解；只读入参，不修改任何外部状态。 */
export function solveReach(
  root: FootPoint,
  target: FootPoint,
  l1: number,
  l2: number,
  opts?: ReachOptions,
): ReachResult {
  if (!Number.isFinite(root.x) || !Number.isFinite(root.y)
    || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return degenerate()
  if (!Number.isFinite(l1) || !Number.isFinite(l2) || l1 <= 0 || l2 <= 0) return degenerate()

  const tolerance = opts?.tolerance ?? 1e-9
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('reach.tolerance')
  const bendSign = opts?.bendSign ?? 1

  const dx = target.x - root.x
  const dy = target.y - root.y
  const distance = Math.hypot(dx, dy)
  if (!Number.isFinite(distance) || distance < EPS) return degenerate()

  const max = l1 + l2
  const min = Math.abs(l1 - l2)
  if (distance > max + tolerance) {
    return { reachable: false, residual: distance - max, reason: 'unreachable' }
  }
  if (distance < min - tolerance) {
    return { reachable: false, residual: min - distance, reason: 'unreachable' }
  }

  const cosine = (l1 * l1 + distance * distance - l2 * l2) / (2 * l1 * distance)
  const alpha = Math.acos(cosine < -1 ? -1 : cosine > 1 ? 1 : cosine)
  const base = Math.atan2(dy, dx)

  type Candidate = { a1: number; a2: number; offRoot: number; offMid: number }
  const make = (sign: 1 | -1): Candidate => {
    const a1 = base + sign * alpha
    const kneeX = root.x + l1 * Math.cos(a1)
    const kneeY = root.y + l1 * Math.sin(a1)
    const a2 = Math.atan2(target.y - kneeY, target.x - kneeX)
    return { a1, a2, offRoot: normalizeAngle(a1), offMid: normalizeAngle(a2 - a1) }
  }

  const limits = opts?.limits
  const allowed = (c: Candidate): boolean => {
    if (!limits) return true
    if (limits.root && !within(c.offRoot, limits.root)) return false
    if (limits.mid && !within(c.offMid, limits.mid)) return false
    return true
  }

  const preferred = make(bendSign)
  const opposite = make(bendSign === 1 ? -1 : 1)
  let chosen: Candidate | null = null
  if (allowed(preferred)) chosen = preferred
  else if (allowed(opposite)) chosen = opposite
  if (!chosen) return { reachable: false, residual: 0, reason: 'limit' }

  const kneeX = root.x + l1 * Math.cos(chosen.a1)
  const kneeY = root.y + l1 * Math.sin(chosen.a1)
  const tipX = kneeX + l2 * Math.cos(chosen.a2)
  const tipY = kneeY + l2 * Math.sin(chosen.a2)
  const residual = Math.hypot(tipX - target.x, tipY - target.y)
  return {
    reachable: residual <= Math.max(tolerance, EPS),
    residual,
    reason: 'ok',
  }
}
