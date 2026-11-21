/**
 * M8 冒烟：应用视角端到端。
 * 18 骨人形以 1.5 m/s 走 2 秒：无 NaN、接触事件合理、快照逐位恢复、60/30 帧率一致。
 */
import { describe, expect, it } from '@jest/globals'
import {
  createHumanoid,
  createMotionState,
  planMotion,
  modulatePose,
  type ContactMark,
} from '@/app/app'
import { captureSnapshot, restoreSnapshot } from '@/tools/tools'
import { createPose, updateWorld } from '@/core/pose'

type RunResult = {
  local: number[]
  world: number[]
  contacts: ContactMark[]
  params: { speed: number; turn: number; gait: 0 | 1 | 2; amplitude: number }
}

/** 应用视角的一帧：规划 → 调制 → FK。 */
function simulate(hz: 60 | 30, seconds: number): RunResult {
  const skeleton = createHumanoid('simple2d', { height: 1.7 })
  const pose = createPose(skeleton)
  const state = createMotionState(skeleton)
  state.pose = pose
  const dt = 1 / hz
  const steps = Math.round(seconds * hz)
  for (let i = 1; i <= steps; i += 1) {
    const time = i * dt
    expect(planMotion(state, { dt, time, speed: 1.5, turn: 0, groundY: 0 }).committed).toBe(true)
    modulatePose(pose, skeleton, state.params, 1)
    updateWorld(pose)
  }
  return {
    local: Array.from(pose.local),
    world: Array.from(pose.world),
    contacts: state.contacts.map((c) => ({ ...c })),
    params: { ...state.params },
  }
}

describe('M8 smoke：应用视角', () => {
  it('1.5 m/s 走 2 秒：无 NaN、接触事件数量合理', () => {
    const r = simulate(60, 2)
    expect(r.local.length).toBe(18 * 7)
    expect(r.local.every(Number.isFinite)).toBe(true)
    expect(r.world.every(Number.isFinite)).toBe(true)
    expect(Number.isFinite(r.params.speed)).toBe(true)
    expect(r.params.gait).toBe(0)

    // 2 秒、周期 0.8s → 两个周期内的 8 个事件（第五个在 2.08s 之后），数量合理且不会无限增长。
    expect(r.contacts.length).toBeGreaterThanOrEqual(8)
    expect(r.contacts.length).toBeLessThan(40)
    for (const c of r.contacts) {
      expect(Number.isFinite(c.x)).toBe(true)
      expect(Number.isFinite(c.y)).toBe(true)
      expect(['heel', 'flat', 'toe', 'liftoff', 'landing']).toContain(c.kind)
    }
    // 每周期 5 事件的相对顺序。
    for (let k = 0; k + 4 < r.contacts.length; k += 5) {
      expect(r.contacts.slice(k, k + 5).map((c) => c.kind)).toEqual([
        'heel', 'flat', 'toe', 'liftoff', 'landing',
      ])
    }
  })

  it('快照恢复后姿态与参数逐位一致', () => {
    const skeleton = createHumanoid('simple2d', { height: 1.7 })
    const pose = createPose(skeleton)
    const state = createMotionState(skeleton)
    state.pose = pose
    for (let i = 1; i <= 30; i += 1) {
      planMotion(state, { dt: 1 / 60, time: i / 60, speed: 1.5, turn: 0, groundY: 0 })
      modulatePose(pose, skeleton, state.params, 1)
    }
    updateWorld(pose)
    const snap = captureSnapshot(state, pose, 30)
    const beforeLocal = Array.from(pose.local)
    const capturedSpeed = state.params.speed

    pose.local.fill(Number.NaN)
    state.params.speed = -1
    expect(restoreSnapshot(state, pose, snap)).toBe(true)
    expect(Array.from(pose.local)).toEqual(beforeLocal)
    expect(state.params.speed).toBe(capturedSpeed)
    expect(pose.worldValid).toBe(false)
  })

  it('60Hz 与 30Hz 应用视角结果误差 < 1e-3', () => {
    const a = simulate(60, 2)
    const b = simulate(30, 2)
    expect(a.local).toHaveLength(b.local.length)
    let maxDiff = 0
    for (let i = 0; i < a.local.length; i += 1) {
      maxDiff = Math.max(maxDiff, Math.abs(a.local[i]! - b.local[i]!))
    }
    expect(maxDiff).toBeLessThan(1e-3)
    // 接触事件逐项一致（时间阈值驱动，不受帧率影响）。
    expect(a.contacts).toEqual(b.contacts)
    expect(a.params.speed).toBeCloseTo(b.params.speed, 6)
    expect(a.params.amplitude).toBeCloseTo(b.params.amplitude, 6)
  })
})
