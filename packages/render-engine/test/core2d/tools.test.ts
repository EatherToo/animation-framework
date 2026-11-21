/**
 * M8 工具层测试：快照、时钟、诊断、引擎门面。
 */
import { describe, expect, it } from '@jest/globals'
import { createHumanoid, createMotionState } from '@/core2d/app'
import {
  captureSnapshot,
  restoreSnapshot,
  Clock,
  Diagnostics,
  EngineFacade,
} from '@/core2d/tools'
import { createPose, updateWorld } from '@/core2d/pose'
import { CH_ROT, POSE_STRIDE } from '@/core2d/math'

function makeState() {
  const skeleton = createHumanoid('simple2d', { height: 1.7 })
  const pose = createPose(skeleton)
  const state = createMotionState(skeleton)
  state.pose = pose
  state.params.speed = 1.25
  state.params.turn = -0.3
  state.params.gait = 1
  state.params.amplitude = 0.7
  pose.local[CH_ROT] = 0.123
  pose.local[POSE_STRIDE + CH_ROT] = -0.45
  return { skeleton, pose, state }
}

describe('M8 工具层 · 快照', () => {
  it('capture 整份复制：之后修改姿态/参数不影响快照', () => {
    const { pose, state } = makeState()
    const snap = captureSnapshot(state, pose, 7)
    expect(snap.version).toBe(1)
    expect(snap.tick).toBe(7)
    const before = Array.from(snap.local)
    pose.local[CH_ROT] = 9
    state.params.speed = 99
    expect(Array.from(snap.local)).toEqual(before)
    expect(snap.params.current.speed).toBe(1.25)
    expect(snap.params.current.turn).toBe(-0.3)
  })

  it('round-trip：恢复后姿态逐位一致、参数一致、并标脏', () => {
    const { skeleton, pose, state } = makeState()
    updateWorld(pose)
    const snap = captureSnapshot(state, pose, 11)
    const originalLocal = Array.from(pose.local)
    // 破坏当前状态。
    pose.local.fill(0)
    pose.dirty.fill(0)
    pose.worldValid = true
    state.params.speed = 0
    expect(restoreSnapshot(state, pose, snap)).toBe(true)
    expect(Array.from(pose.local)).toEqual(originalLocal)
    expect(state.params.speed).toBe(1.25)
    expect(state.params.gait).toBe(1)
    expect(pose.version).toBe(11)
    // 恢复后整树标脏，世界缓存失效。
    expect(pose.worldValid).toBe(false)
    expect(pose.dirtyCount).toBe(skeleton.count)
    expect(Array.from(pose.dirty).every((v) => v === 1)).toBe(true)
  })

  it('恢复失败（版本/长度不符）返回 false 且状态不变', () => {
    const { pose, state } = makeState()
    const snap = captureSnapshot(state, pose, 3)
    const beforeLocal = Array.from(pose.local)
    const beforeSpeed = state.params.speed

    const badVersion = { ...snap, version: 2 as 1 }
    expect(restoreSnapshot(state, pose, badVersion)).toBe(false)
    expect(Array.from(pose.local)).toEqual(beforeLocal)
    expect(state.params.speed).toBe(beforeSpeed)

    const badLocal = { ...snap, local: new Float32Array(3) }
    expect(restoreSnapshot(state, pose, badLocal)).toBe(false)
    expect(Array.from(pose.local)).toEqual(beforeLocal)

    const badDirty = { ...snap, constraintState: new Uint8Array(1) }
    expect(restoreSnapshot(state, pose, badDirty)).toBe(false)
    expect(Array.from(pose.local)).toEqual(beforeLocal)
    expect(state.params.speed).toBe(beforeSpeed)
  })
})

describe('M8 工具层 · 时钟', () => {
  it('固定步长：1/60 输入正好一步，余数归零', () => {
    const clock = new Clock()
    expect(clock.step(1 / 60)).toBe(1)
    expect(clock.accumulator).toBeCloseTo(0, 12)
  })

  it('余数累加：两个半步合成一步', () => {
    const clock = new Clock()
    expect(clock.step(1 / 120)).toBe(0)
    expect(clock.step(1 / 120)).toBe(1)
    expect(clock.accumulator).toBeCloseTo(0, 12)
  })

  it('大 dt 截断且不超 4 子步（防死亡螺旋）', () => {
    const clock = new Clock({ fixedDt: 0.01, maxFrameDt: 1, maxSubSteps: 4 })
    expect(clock.step(10)).toBe(4)
    expect(clock.accumulator).toBe(0)
    const capped = new Clock({ fixedDt: 0.01, maxFrameDt: 0.02 })
    expect(capped.step(10)).toBe(2)
    expect(capped.accumulator).toBeCloseTo(0, 12)
  })
})

describe('M8 工具层 · 诊断', () => {
  it('push/drain/size：drain 返回副本并清空，二次 drain 为空', () => {
    const d = new Diagnostics()
    d.push('a', '消息 A', 1)
    d.push('b', '消息 B')
    expect(d.size).toBe(2)
    const out = d.drain()
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ id: 'a', message: '消息 A', data: 1 })
    expect(out[1]).toEqual({ id: 'b', message: '消息 B' })
    expect(d.size).toBe(0)
    expect(d.drain()).toEqual([])
  })

  it('诊断只读：push 不修改姿态', () => {
    const { pose } = makeState()
    const before = Array.from(pose.local)
    const d = new Diagnostics()
    d.push('x', 'y')
    expect(Array.from(pose.local)).toEqual(before)
  })
})

describe('M8 工具层 · 引擎门面', () => {
  it('update 顺序：Clock 门控 → planMotion → modulatePose → updateWorld', () => {
    const skeleton = createHumanoid('simple2d', { height: 1.7 })
    const facade = new EngineFacade(skeleton)
    // 半步不足以推进：Clock 门控生效，世界仍未刷新。
    facade.update(1 / 120)
    expect(facade.pose.worldValid).toBe(false)
    // 再半步累计为 1/60，应完成一个提交步 + 调制 + FK。
    facade.update(1 / 120)
    expect(facade.pose.worldValid).toBe(true)
    const spine = facade.motion.pose!.skeleton.boneIdByName.get('spine')!
    const delta = facade.pose.local[spine * POSE_STRIDE + CH_ROT]! - skeleton.bones[spine]!.setup.rotation
    // modulatePose 的静止摆动项保证上身旋转被写入（没有被后续 planMotion 覆盖）。
    expect(Math.abs(delta)).toBeGreaterThan(1e-9)
    expect(Array.from(facade.pose.world).every(Number.isFinite)).toBe(true)
  })

  it('pose/motion 为稳定引用；dispose 幂等且之后 update 抛 E_DISPOSED', () => {
    const skeleton = createHumanoid('simple2d')
    const facade = new EngineFacade(skeleton)
    expect(facade.pose).toBe(facade.pose)
    expect(facade.motion).toBe(facade.motion)
    expect(facade.disposed).toBe(false)
    facade.dispose()
    facade.dispose()
    expect(facade.disposed).toBe(true)
    expect(() => facade.update(1 / 60)).toThrow(/E_DISPOSED/)
  })

  it('门面多次 update 不产生 NaN', () => {
    const facade = new EngineFacade(createHumanoid('simple2d', { height: 1.7 }))
    for (let i = 0; i < 120; i += 1) facade.update(1 / 60)
    expect(Array.from(facade.pose.local).every(Number.isFinite)).toBe(true)
    expect(Array.from(facade.pose.world).every(Number.isFinite)).toBe(true)
  })
})
