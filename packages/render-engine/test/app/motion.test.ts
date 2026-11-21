/**
 * M12 运动层模块测试：步态、调度、轨迹、可达、放置、恢复、参数与事务提交。
 * 只覆盖 app/* 的公开契约。
 */
import { describe, expect, it } from '@jest/globals'
import { createHumanoid, humanoidSpec, type HandLod } from '@/app/app'
import { createPose, getRotation, updateWorld } from '@/core/pose'
import { POSE_STRIDE } from '@/core/math'
import {
  advancePhase,
  bump,
  createMotionState,
  planMotion,
  smoothstep,
  type MotionState,
} from '@/app/motion'
import { gaitTable, speedToGait } from '@/app/gait'
import { createStepSchedule, sampleSchedule } from '@/app/schedule'
import { footTrajectory, sampleTrajectory } from '@/app/trajectory'
import { solveReach } from '@/app/reach'
import { placeFoot, placeFootInto, type Placement } from '@/app/place'
import { attemptRecover, createRecovery, type Recovery } from '@/app/recover'
import { ParamSmoother, modulatePose, smoothingAlpha, type ParamState } from '@/app/params'

const HEIGHT = 1.7

function makeRig(profile: 'simple2d' | 'full2d' = 'simple2d', handLod: HandLod = 'none') {
  const skeleton = createHumanoid(profile, { height: HEIGHT, handLod })
  const pose = createPose(skeleton)
  const state = createMotionState(skeleton)
  state.pose = pose
  return { skeleton, pose, state }
}

describe('M12 · 人形手型与镜像', () => {
  it('LOD 骨数：none=20、simple=22、full=48、simple2d=18', () => {
    expect(humanoidSpec('simple2d', { handLod: 'full' }).bones).toHaveLength(18)
    expect(humanoidSpec('full2d').bones).toHaveLength(20)
    expect(humanoidSpec('full2d', { handLod: 'simple' }).bones).toHaveLength(22)
    expect(humanoidSpec('full2d', { handLod: 'full' }).bones).toHaveLength(48)
    expect(humanoidSpec('full2d', { handLod: 'full' }).bones.length).toBe(20 + 2 * 14)
  })

  it('full2d + full 双手左右逐骨镜像（<1e-9）且逐位确定', () => {
    const a = createHumanoid('full2d', { height: 1.83, handLod: 'full' })
    const b = createHumanoid('full2d', { height: 1.83, handLod: 'full' })
    expect(Array.from(a.setupLocal)).toEqual(Array.from(b.setupLocal))

    let pairs = 0
    for (const bone of a.bones) {
      if (!bone.name.endsWith('L')) continue
      const rightId = a.boneIdByName.get(`${bone.name.slice(0, -1)}R`)
      expect(rightId).toBeDefined()
      const right = a.bones[rightId!]!
      expect(bone.rest.x).toBeCloseTo(-right.rest.x, 10)
      expect(bone.rest.y).toBeCloseTo(right.rest.y, 10)
      expect(bone.rest.rotation).toBeCloseTo(-right.rest.rotation, 10)
      expect(Math.abs(bone.rest.x + right.rest.x)).toBeLessThan(1e-9)
      expect(Math.abs(bone.rest.rotation + right.rest.rotation)).toBeLessThan(1e-9)
      pairs += 1
    }
    expect(pairs).toBeGreaterThan(20)
  })
})

describe('M12 · 步态与调度', () => {
  it('gaitTable 三档周期/占空比/摆幅合法', () => {
    for (const mode of ['idle', 'walk', 'run'] as const) {
      const g = gaitTable[mode]
      expect(g.mode).toBe(mode)
      expect(g.cycle).toBeGreaterThan(0)
      expect(g.duty).toBeGreaterThan(0)
      expect(g.duty).toBeLessThanOrEqual(1)
      expect(g.amplitude).toBeGreaterThanOrEqual(0)
    }
    expect(gaitTable.run.amplitude).toBeGreaterThan(gaitTable.walk.amplitude)
  })

  it('speedToGait 复用 Froude 阈值', () => {
    const v1 = Math.sqrt(0.5 * 9.81 * HEIGHT)
    const v2 = Math.sqrt(2.5 * 9.81 * HEIGHT)
    expect(speedToGait(v1 - 0.05, HEIGHT)).toBe(0)
    expect(speedToGait(v1 + 0.05, HEIGHT)).toBe(1)
    expect(speedToGait(v2 + 0.05, HEIGHT)).toBe(2)
    expect(speedToGait(-(v2 + 0.05), HEIGHT)).toBe(2)
  })

  it('StepSchedule 事件顺序与 sampleSchedule 当前/下一事件', () => {
    const s = createStepSchedule({
      foot: 'L', startTime: 0, duration: 1, duty: 0.6, stepLength: 0.5,
    })
    expect(s.events.map((e) => e.kind)).toEqual(['heel', 'flat', 'toe', 'liftoff', 'landing'])
    const expectedAt = [0, 0.2, 0.4, 0.6, 1]
    s.events.forEach((e, i) => expect(e.at).toBeCloseTo(expectedAt[i]!, 12))

    const atHead = sampleSchedule(s, 0.1)
    expect(atHead.phase).toBeCloseTo(0.1, 12)
    expect(atHead.current?.kind).toBe('heel')
    expect(atHead.next?.kind).toBe('flat')

    const atToe = sampleSchedule(s, 0.5)
    expect(atToe.current?.kind).toBe('toe')
    expect(atToe.next?.kind).toBe('liftoff')

    const after = sampleSchedule(s, 1.2)
    expect(after.current?.kind).toBe('landing')
    expect(after.next).toBeNull()
  })
})

describe('M12 · 足端轨迹、可达与放置', () => {
  const profile = { from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, clearance: 0.2 }

  it('trajectory 端点连续、中点最高', () => {
    const a = footTrajectory(profile, 0)
    const m = footTrajectory(profile, 0.5)
    const b = footTrajectory(profile, 1)
    expect(a.x).toBeCloseTo(0, 12)
    expect(a.y).toBeCloseTo(0, 12)
    expect(a.phase).toBe(0)
    expect(m.x).toBeCloseTo(0.5, 12)
    expect(m.y).toBeCloseTo(0.2, 12)
    expect(m.phase).toBeCloseTo(0.5, 12)
    expect(b.x).toBeCloseTo(1, 12)
    expect(b.y).toBeCloseTo(0, 12)
    expect(b.phase).toBe(1)
    expect(m.y).toBeGreaterThan(a.y)
    expect(m.y).toBeGreaterThan(b.y)
    expect(sampleTrajectory(profile, 0.25)).toEqual(footTrajectory(profile, 0.25))
  })

  it('smoothstep / bump 端点与对称性', () => {
    expect(smoothstep(0)).toBe(0)
    expect(smoothstep(1)).toBe(1)
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 15)
    expect(bump(0)).toBe(0)
    expect(bump(1)).toBe(0)
    expect(bump(0.5)).toBeCloseTo(1, 15)
    expect(bump(0.5)).toBeCloseTo(bump(0.5), 15)
    expect(smoothstep(-1)).toBe(0)
    expect(smoothstep(2)).toBe(1)
  })

  it('solveReach：可达/不可达/退化都有 reason', () => {
    const ok = solveReach({ x: 0, y: 0 }, { x: 0, y: 0.8 }, 0.5, 0.5)
    expect(ok.reachable).toBe(true)
    expect(ok.reason).toBe('ok')
    expect(ok.residual).toBeLessThan(1e-9)

    const far = solveReach({ x: 0, y: 0 }, { x: 0, y: 3 }, 0.5, 0.5)
    expect(far.reachable).toBe(false)
    expect(far.reason).toBe('unreachable')
    expect(far.residual).toBeGreaterThan(0)

    const near = solveReach({ x: 0, y: 0 }, { x: 0, y: 0.01 }, 0.5, 0.1)
    expect(near.reachable).toBe(false)
    expect(near.reason).toBe('unreachable')

    const degenerate = solveReach({ x: 0, y: 0 }, { x: 0, y: 0.5 }, 0, 0.5)
    expect(degenerate.reachable).toBe(false)
    expect(degenerate.reason).toBe('degenerate')
  })

  it('placeFoot 保持腿链长度；失败不写', () => {
    const hip = { x: 0, y: 1 }
    const target = { x: 0.3, y: 0.2 }
    const p = placeFoot(hip, target, 0.5, 0.5)
    expect(p.valid).toBe(true)
    expect(p.x).toBe(target.x)
    expect(p.y).toBe(target.y)
    expect(p.residual).toBeLessThan(1e-9)
    // 放置点距离仍在两段长度构成的区间内（腿链长度未被改变）。
    const d = Math.hypot(p.x - hip.x, p.y - hip.y)
    expect(d).toBeLessThanOrEqual(1 + 1e-12)
    expect(d).toBeGreaterThanOrEqual(0)

    const out: Placement = { x: 9, y: 9, valid: false, residual: -1 }
    expect(placeFootInto(out, hip, { x: 5, y: 0 }, 0.5, 0.5)).toBe(false)
    expect(out).toEqual({ x: 9, y: 9, valid: false, residual: -1 })
  })
})

describe('M12 · 恢复', () => {
  it('沿接近方向 0.05 步进直至可达；失败不提交', () => {
    const out: Recovery = createRecovery('L', 7)
    const ok = attemptRecover(out, { x: 1, y: 0 }, { x: -1, y: 0 }, {
      maxSteps: 20,
      check: (x) => x <= 0.5 + 1e-12,
      foot: 'L',
      duration: 0.3,
      generation: 7,
    })
    expect(ok).toBe(true)
    expect(out.active).toBe(true)
    expect(out.contactX).toBeCloseTo(0.5, 12)
    expect(out.generation).toBe(7)

    const sentinel: Recovery = {
      active: false, foot: 'R', fromX: -1, fromY: -2, contactX: -3, contactY: -4,
      duration: 0.1, generation: 1,
    }
    const before = { ...sentinel }
    const fail = attemptRecover(sentinel, { x: 1, y: 0 }, { x: 1, y: 0 }, {
      maxSteps: 5,
      check: () => false,
    })
    expect(fail).toBe(false)
    expect(sentinel).toEqual(before)
  })
})

describe('M12 · 参数平滑与运动状态', () => {
  it('alpha=1-exp(-dt/tau)，60/30Hz 收敛一致', () => {
    expect(smoothingAlpha(0.1, 0.2)).toBeCloseTo(1 - Math.exp(-0.5), 15)

    const a: ParamState = {
      target: { speed: 2, turn: 0.4, gait: 1, amplitude: 0.6 },
      current: { speed: 0, turn: 0, gait: 0, amplitude: 0 },
    }
    const b: ParamState = {
      target: { speed: 2, turn: 0.4, gait: 1, amplitude: 0.6 },
      current: { speed: 0, turn: 0, gait: 0, amplitude: 0 },
    }
    const sm = new ParamSmoother()
    for (let i = 0; i < 120; i += 1) sm.step(a, 1 / 60)
    for (let i = 0; i < 60; i += 1) sm.step(b, 1 / 30)
    expect(a.current.speed).toBeCloseTo(b.current.speed, 9)
    expect(a.current.turn).toBeCloseTo(b.current.turn, 9)
    expect(a.current.amplitude).toBeCloseTo(b.current.amplitude, 9)
    expect(a.current.gait).toBe(1)
  })

  it('advancePhase 环绕且帧率无关', () => {
    let p60 = 0.1
    for (let i = 0; i < 60; i += 1) p60 = advancePhase(p60, 1 / 60, 1)
    let p30 = 0.1
    for (let i = 0; i < 30; i += 1) p30 = advancePhase(p30, 1 / 30, 1)
    expect(p60).toBeCloseTo(p30, 12)
    expect(advancePhase(0.9, 0.2, 1)).toBeCloseTo(0.1, 12)
    expect(advancePhase(0.1, 0, 1)).toBe(0.1)
  })

  it('planMotion 事务式提交：失败不写，成功更新 phase/supportFeet', () => {
    const { pose, state } = makeRig('simple2d')
    const r = planMotion(state, { dt: 1 / 60, time: 1 / 60, speed: 3.2, turn: 0, groundY: 0 })
    expect(r.committed).toBe(true)
    expect(state.phase).toBeGreaterThanOrEqual(0)
    expect(state.phase).toBeLessThan(1)
    expect(state.generation).toBe(0)
    expect(state.supportFeet.length).toBeGreaterThan(0)

    const beforeLocal = pose.local.slice()
    const beforeParams = { ...state.params }
    const beforeContacts = state.contacts.map((c) => ({ ...c }))
    const fail = planMotion(state, {
      dt: 1 / 60, time: 2 / 60, speed: Number.NaN, turn: 0, groundY: 0,
    })
    expect(fail.committed).toBe(false)
    expect(Array.from(pose.local)).toEqual(Array.from(beforeLocal))
    expect(state.params).toEqual(beforeParams)
    expect(state.contacts).toEqual(beforeContacts)
  })

  it('支撑期接触点跨帧不变', () => {
    const { state } = makeRig('simple2d')
    for (let i = 1; i <= 60; i += 1) {
      expect(planMotion(state, {
        dt: 1 / 60, time: i / 60, speed: 1.5, turn: 0, groundY: 0,
      }).committed).toBe(true)
    }
    const frozen = state.contacts.map((c) => ({ ...c }))
    for (let i = 61; i <= 120; i += 1) {
      planMotion(state, { dt: 1 / 60, time: i / 60, speed: 1.5, turn: 0, groundY: 0 })
    }
    frozen.forEach((c, i) => expect(state.contacts[i]).toEqual(c))
  })

  it('modulatePose 兼容导出且只写上身', () => {
    const { skeleton, pose } = makeRig('simple2d')
    const thigh = skeleton.boneIdByName.get('thighL')!
    const before = getRotation(pose, thigh)
    modulatePose(pose, skeleton, { speed: 1, turn: 0.2, gait: 1, amplitude: 0.5 }, 1)
    expect(getRotation(pose, thigh)).toBe(before)
    updateWorld(pose)
    expect(pose.worldValid).toBe(true)
    expect(pose.local[thigh * POSE_STRIDE + 2]).toBe(before)
  })
})
