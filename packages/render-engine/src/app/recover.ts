/**
 * M12 失败恢复。
 * 权威：docs/18-应用层/足端轨迹与恢复.md。
 *
 * 从失败点沿接近方向反推，以 0.05m 为步长搜索可达落点；最多 N 次。
 * 只有找到可达点才写回 Recovery，失败不提交。
 */
import type { FootPoint } from './foot'

export type Recovery = {
  active: boolean
  foot: 'L' | 'R'
  fromX: number
  fromY: number
  contactX: number
  contactY: number
  duration: number
  generation: number
}

export type RecoveryOptions = {
  maxSteps?: number
  /** 搜索步长（米），默认 0.05。 */
  step?: number
  /** 返回该候选点是否可达。 */
  check: (x: number, y: number) => boolean
  foot?: 'L' | 'R'
  duration?: number
  generation?: number
}

const DEFAULT_STEP = 0.05
const DEFAULT_MAX_STEPS = 20
const DEFAULT_DURATION = 0.3
const EPS = 1e-12

export function createRecovery(foot: 'L' | 'R' = 'L', generation: number = 0): Recovery {
  return {
    active: false,
    foot,
    fromX: 0,
    fromY: 0,
    contactX: 0,
    contactY: 0,
    duration: DEFAULT_DURATION,
    generation,
  }
}

/**
 * 沿 approach 方向（指向失败点的接近方向）搜索恢复点。
 * 成功写回 out 并返回 true；失败返回 false 且 out 保持不变。
 */
export function attemptRecover(
  out: Recovery,
  fail: FootPoint,
  approach: FootPoint,
  opts: RecoveryOptions,
): boolean {
  if (!Number.isFinite(fail.x) || !Number.isFinite(fail.y)
    || !Number.isFinite(approach.x) || !Number.isFinite(approach.y)) return false
  const length = Math.hypot(approach.x, approach.y)
  if (!Number.isFinite(length) || length < EPS) return false

  const step = opts.step ?? DEFAULT_STEP
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS
  if (!Number.isFinite(step) || step <= 0) throw new Error('recover.step')
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error('recover.maxSteps')

  const dx = approach.x / length
  const dy = approach.y / length
  for (let i = 1; i <= maxSteps; i += 1) {
    const x = fail.x + dx * step * i
    const y = fail.y + dy * step * i
    if (!opts.check(x, y)) continue
    out.active = true
    out.foot = opts.foot ?? out.foot
    out.fromX = fail.x
    out.fromY = fail.y
    out.contactX = x
    out.contactY = y
    out.duration = opts.duration ?? out.duration
    out.generation = opts.generation ?? out.generation
    return true
  }
  return false
}
