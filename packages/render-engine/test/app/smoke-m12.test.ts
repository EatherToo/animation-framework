/**
 * M12 冒烟：full2d + full 双手角色应用视角行走 2 秒。
 * 检查脚底不穿地、滚动事件齐全、快照恢复后逐位一致。
 */
import { describe, expect, it } from '@jest/globals'
import { createHumanoid, createMotionState, planMotion, modulatePose } from '@/app/app'
import { createFootGeometry, soleLocal } from '@/app/foot'
import { captureSnapshot, restoreSnapshot } from '@/tools/tools'
import { createPose, updateWorld, type Pose } from '@/core/pose'
import { WORLD_STRIDE } from '@/core/math'
import type { CompiledSkeleton } from '@/core/skeleton'

const HEIGHT = 1.7
const GROUND_Y = 0
const GEOMETRY = createFootGeometry(0.15, 0.04)

type RunResult = {
  local: number[]
  world: number[]
  contacts: number[]
  params: { speed: number; turn: number; gait: 0 | 1 | 2; amplitude: number }
  kinds: string[]
}

/** 脚底三点在世界空间的最低 y。 */
function lowestSoleY(pose: Pose, skeleton: CompiledSkeleton, foot: 'L' | 'R'): number {
  const id = skeleton.boneIdByName.get(`foot${foot}`)
  if (id === undefined) throw new Error(`missing foot${foot}`)
  const o = id * WORLD_STRIDE
  const m1 = pose.world[o + 1]!
  const m3 = pose.world[o + 3]!
  const m5 = pose.world[o + 5]!
  let minY = Number.POSITIVE_INFINITY
  for (const u of [0, 0.5, 1]) {
    const p = soleLocal(u, GEOMETRY)
    const y = m1 * p[0] + m3 * p[1] + m5
    if (!Number.isFinite(y)) return Number.NEGATIVE_INFINITY
    minY = Math.min(minY, y)
  }
  return minY
}

function createRig(): { skeleton: CompiledSkeleton; pose: Pose; state: ReturnType<typeof createMotionState> } {
  const skeleton = createHumanoid('full2d', { height: HEIGHT, handLod: 'full' })
  const pose = createPose(skeleton)
  const state = createMotionState(skeleton)
  state.pose = pose
  return { skeleton, pose, state }
}

function frame(
  skeleton: CompiledSkeleton,
  pose: Pose,
  state: ReturnType<typeof createMotionState>,
  time: number,
  dt: number,
): void {
  expect(planMotion(state, { dt, time, speed: 1.5, turn: 0, groundY: GROUND_Y }).committed).toBe(true)
  modulatePose(pose, skeleton, state.params, 1)
  updateWorld(pose)
}

function simulate(hz: 60 | 30, seconds: number): RunResult {
  const { skeleton, pose, state } = createRig()
  const dt = 1 / hz
  const steps = Math.round(seconds * hz)
  let minSole = Number.POSITIVE_INFINITY
  for (let i = 1; i <= steps; i += 1) {
    frame(skeleton, pose, state, i * dt, dt)
    minSole = Math.min(minSole, lowestSoleY(pose, skeleton, 'L'), lowestSoleY(pose, skeleton, 'R'))
  }
  expect(minSole).toBeGreaterThanOrEqual(GROUND_Y - 1e-3)
  return {
    local: Array.from(pose.local),
    world: Array.from(pose.world),
    contacts: state.contacts.map((c) => c.frame),
    params: { ...state.params },
    kinds: state.contacts.map((c) => c.kind),
  }
}

describe('M12 smoke：full2d + full hands 行走', () => {
  it('2 秒行走：无 NaN、脚不穿地、事件齐全', () => {
    const r = simulate(60, 2)
    expect(r.local.length).toBe(48 * 7)
    expect(r.local.every(Number.isFinite)).toBe(true)
    expect(r.world.every(Number.isFinite)).toBe(true)
    expect(r.params.gait).toBe(0)

    const required = ['heel', 'flat', 'toe', 'liftoff', 'landing']
    for (const kind of required) expect(r.kinds).toContain(kind)
    expect(r.contacts.length).toBeGreaterThanOrEqual(8)

    // 事件按完整周期分组且顺序稳定。
    const order = ['heel', 'flat', 'toe', 'liftoff', 'landing']
    for (let k = 0; k + 4 < r.kinds.length; k += 5) {
      expect(r.kinds.slice(k, k + 5)).toEqual(order)
    }
  })

  it('60Hz 与 30Hz 应用视角误差 < 1e-3，接触时刻一致', () => {
    const a = simulate(60, 2)
    const b = simulate(30, 2)
    expect(a.local).toHaveLength(b.local.length)
    let maxDiff = 0
    for (let i = 0; i < a.local.length; i += 1) {
      maxDiff = Math.max(maxDiff, Math.abs(a.local[i]! - b.local[i]!))
    }
    expect(maxDiff).toBeLessThan(1e-3)
    expect(a.contacts).toEqual(b.contacts)
  })

  it('快照恢复后继续推进，姿态/世界矩阵逐位一致', () => {
    const base = createRig()
    for (let i = 1; i <= 60; i += 1) frame(base.skeleton, base.pose, base.state, i / 60, 1 / 60)
    const snap = captureSnapshot(base.state, base.pose, 60)

    // 参照组继续跑 30 帧。
    for (let i = 61; i <= 90; i += 1) frame(base.skeleton, base.pose, base.state, i / 60, 1 / 60)
    const expectedLocal = Array.from(base.pose.local)
    const expectedWorld = Array.from(base.pose.world)

    // 恢复组从快照恢复后跑同样的 30 帧。
    const restored = createRig()
    expect(restoreSnapshot(restored.state, restored.pose, snap)).toBe(true)
    expect(restored.pose.worldValid).toBe(false)
    for (let i = 61; i <= 90; i += 1) frame(restored.skeleton, restored.pose, restored.state, i / 60, 1 / 60)

    expect(Array.from(restored.pose.local)).toEqual(expectedLocal)
    expect(Array.from(restored.pose.world)).toEqual(expectedWorld)
    expect(restored.state.params).toEqual(base.state.params)
  })
})
