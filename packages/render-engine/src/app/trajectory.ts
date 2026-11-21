/**
 * M12 足端摆动轨迹。
 * 权威：docs/18-应用层/足端轨迹与恢复.md。
 *
 * 水平分量用 smoothstep（端点速度为零），垂直分量叠加 bump 抬脚间隙。
 */
import type { FootPoint } from './foot'
import { bump, smoothstep } from './motion'

export type TrajectoryProfile = {
  from?: FootPoint
  to?: FootPoint
  fromX?: number
  fromY?: number
  toX?: number
  toY?: number
  clearance?: number
  pitchFrom?: number
  pitchTo?: number
}

export type FootTarget = {
  x: number
  y: number
  /** 摆动相位 0..1。 */
  phase: number
  /** 脚掌俯仰（弧度）。 */
  pitch: number
}

function resolveEndpoints(profile: TrajectoryProfile): {
  fromX: number
  fromY: number
  toX: number
  toY: number
  clearance: number
  pitchFrom: number
  pitchTo: number
} {
  const from = profile.from
  const to = profile.to
  const fromX = from?.x ?? profile.fromX ?? 0
  const fromY = from?.y ?? profile.fromY ?? 0
  const toX = to?.x ?? profile.toX ?? 0
  const toY = to?.y ?? profile.toY ?? 0
  const clearance = profile.clearance ?? 0
  const pitchFrom = profile.pitchFrom ?? 0
  const pitchTo = profile.pitchTo ?? 0
  for (const v of [fromX, fromY, toX, toY, clearance, pitchFrom, pitchTo]) {
    if (!Number.isFinite(v)) throw new Error('trajectory.profile')
  }
  if (clearance < 0) throw new Error('trajectory.clearance')
  return { fromX, fromY, toX, toY, clearance, pitchFrom, pitchTo }
}

/** 按归一化相位 u 采样足端目标；u 越界夹到 0/1。 */
export function footTrajectory(profile: TrajectoryProfile, u: number): FootTarget {
  if (!Number.isFinite(u)) throw new Error('trajectory.u')
  const phase = u < 0 ? 0 : u > 1 ? 1 : u
  const { fromX, fromY, toX, toY, clearance, pitchFrom, pitchTo } = resolveEndpoints(profile)
  const s = smoothstep(phase)
  return {
    x: fromX + (toX - fromX) * s,
    y: fromY + (toY - fromY) * s + clearance * bump(phase),
    phase,
    pitch: pitchFrom + (pitchTo - pitchFrom) * s,
  }
}

/** 与 footTrajectory 同义，返回 (x, y, phase) 的完整目标。 */
export function sampleTrajectory(profile: TrajectoryProfile, u: number): FootTarget {
  return footTrajectory(profile, u)
}
