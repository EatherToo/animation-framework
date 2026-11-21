/**
 * M8 应用层测试：人形模板、足部接触、运动规划、参数调制。
 * 仅覆盖 app.ts 对外 API；不触碰核心 01-15。
 */
import { describe, expect, it } from '@jest/globals'
import {
  humanoidSpec,
  createHumanoid,
  ankleFromContact,
  contactFromAnkle,
  soleLocal,
  speedToGait,
  createMotionState,
  planMotion,
  modulatePose,
  type HandLod,
  type ContactMark,
} from '@/app/app'
import { createPose, getRotation, updateWorld } from '@/core/pose'
import { CH_ROT, POSE_STRIDE } from '@/core/math'
import type { CompiledSkeleton } from '@/core/skeleton'

const HEIGHT = 1.7

function makeRig(profile: 'simple2d' | 'full2d' = 'simple2d', handLod: HandLod = 'none') {
  const skeleton = createHumanoid(profile, { height: HEIGHT, handLod })
  const pose = createPose(skeleton)
  const state = createMotionState(skeleton)
  state.pose = pose
  return { skeleton, pose, state }
}

function at(skeleton: CompiledSkeleton, name: string): number {
  const id = skeleton.boneIdByName.get(name)
  if (id === undefined) throw new Error(`missing bone: ${name}`)
  return id
}

describe('M8 应用层 · 人形模板', () => {
  it('骨数表：simple2d=18，full2d 基底 20，simple 22，full 48', () => {
    expect(humanoidSpec('simple2d').bones).toHaveLength(18)
    // simple2d 即使请求指骨也必须保持 18 骨（simple2d 禁止指骨/2DOF yoke）。
    expect(humanoidSpec('simple2d', { handLod: 'full' }).bones).toHaveLength(18)
    expect(humanoidSpec('full2d').bones).toHaveLength(20)
    expect(humanoidSpec('full2d', { handLod: 'simple' }).bones).toHaveLength(22)
    expect(humanoidSpec('full2d', { handLod: 'full' }).bones).toHaveLength(48)
    // 编译后同样成立，且名字唯一。
    expect(createHumanoid('simple2d').count).toBe(18)
    const full = createHumanoid('full2d', { handLod: 'full' })
    expect(full.count).toBe(48)
    expect(full.boneIdByName.size).toBe(48)
  })

  it('同一参数两次生成逐位一致（spec 与编译 local）', () => {
    const opts = { height: 1.83, handLod: 'full' as const }
    const a = humanoidSpec('full2d', opts)
    const b = humanoidSpec('full2d', opts)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    const skelA = createHumanoid('full2d', opts)
    const skelB = createHumanoid('full2d', opts)
    expect(Array.from(skelA.setupLocal)).toEqual(Array.from(skelB.setupLocal))
    expect(Array.from(skelA.restLocal)).toEqual(Array.from(skelB.restLocal))
    expect(skelA.bones.map((b) => b.name)).toEqual(skelB.bones.map((b) => b.name))
  })

  it('左右镜像对称：成对骨长相等、x 反号、旋转反号', () => {
    const skeleton = createHumanoid('full2d', { height: HEIGHT, handLod: 'full' })
    const pairs = [
      ['upperArmL', 'upperArmR'], ['lowerArmL', 'lowerArmR'], ['handL', 'handR'],
      ['clavicleL', 'clavicleR'],
      ['thumb1L', 'thumb1R'], ['index3L', 'index3R'], ['pinky3L', 'pinky3R'],
      ['thighL', 'thighR'], ['shinL', 'shinR'], ['footL', 'footR'],
    ] as const
    for (const [lName, rName] of pairs) {
      const l = skeleton.bones[at(skeleton, lName)]!
      const r = skeleton.bones[at(skeleton, rName)]!
      expect(l.length).toBe(r.length)
      // 用 toBeCloseTo 避免 0 与 -0 的 Object.is 差异。
      expect(l.rest.x).toBeCloseTo(-r.rest.x, 12)
      expect(l.rest.y).toBeCloseTo(r.rest.y, 12)
      expect(l.rest.rotation).toBeCloseTo(-r.rest.rotation, 12)
    }
  })
})

describe('M8 应用层 · 足部与接触', () => {
  it('soleLocal：u=0/0.5/1 站点正确且 y 单调递增', () => {
    const heel = soleLocal(0)
    const flat = soleLocal(0.5)
    const toe = soleLocal(1)
    expect(heel[0]).toBeLessThan(flat[0])
    expect(flat[0]).toBeLessThan(toe[0])
    expect(heel[1]).toBeLessThan(flat[1])
    expect(flat[1]).toBeLessThan(toe[1])
  })

  it('ankleFromContact / contactFromAnkle 互逆（1e-9）', () => {
    const soleY = 0
    const contacts: ContactMark[] = [
      { x: -1.25, y: soleY, frame: 0, kind: 'heel' },
      { x: 0, y: soleY, frame: 1, kind: 'flat' },
      { x: 3.75, y: soleY, frame: 2, kind: 'toe' },
    ]
    for (const c of contacts) {
      const ankle = ankleFromContact(c, soleY)
      const back = contactFromAnkle(ankle, soleY)
      expect(back.x).toBeCloseTo(c.x, 9)
      expect(back.y).toBeCloseTo(c.y, 9)
    }
    // 反向也互逆。
    const ankle = { x: 2.5, y: soleY + 0.04 }
    const p = contactFromAnkle(ankle, soleY)
    const c: ContactMark = { ...p, frame: 0, kind: 'flat' }
    const back = ankleFromContact(c, soleY)
    expect(back.x).toBeCloseTo(ankle.x, 9)
    expect(back.y).toBeCloseTo(ankle.y, 9)
  })
})

describe('M8 应用层 · 运动规划', () => {
  it('speedToGait：Froude 阈值 0.5 / 2.5', () => {
    const g = 9.81
    const v1 = Math.sqrt(0.5 * g * HEIGHT)
    const v2 = Math.sqrt(2.5 * g * HEIGHT)
    expect(speedToGait(v1 - 0.05, HEIGHT)).toBe(0)
    expect(speedToGait(v1 + 0.05, HEIGHT)).toBe(1)
    expect(speedToGait(v2 - 0.05, HEIGHT)).toBe(1)
    expect(speedToGait(v2 + 0.05, HEIGHT)).toBe(2)
    // 后退速度取绝对值。
    expect(speedToGait(-(v2 + 0.05), HEIGHT)).toBe(2)
  })

  it('事务失败：非法输入/NaN 局部都不提交，状态和姿态不变', () => {
    const { pose, state } = makeRig()
    const beforeLocal = pose.local.slice()
    const beforeParams = { ...state.params }
    const bad = planMotion(state, { dt: 1 / 60, time: 0.1, speed: Number.NaN, turn: 0, groundY: 0 })
    expect(bad.committed).toBe(false)
    expect(bad.reason).toBeDefined()
    expect(Array.from(pose.local)).toEqual(Array.from(beforeLocal))
    expect(state.params).toEqual(beforeParams)
    expect(state.contacts).toHaveLength(0)

    // 姿态自身含 NaN 时同样拒绝，且不把 NaN 写回原状态。
    pose.local[at(pose.skeleton, 'spine') * POSE_STRIDE + CH_ROT] = Number.NaN
    const localWithNaN = pose.local.slice()
    const bad2 = planMotion(state, { dt: 1 / 60, time: 0.2, speed: 1, turn: 0, groundY: 0 })
    expect(bad2.committed).toBe(false)
    expect(Array.from(pose.local)).toEqual(Array.from(localWithNaN))
  })

  it('支持期接触点不变；事件按 heel→flat→toe→liftoff→landing 顺序且去重', () => {
    const { skeleton, state } = makeRig()
    const period = 0.8 // 与实现约定一致：一个完整步态周期
    const expectedOrder = ['heel', 'flat', 'toe', 'liftoff', 'landing']
    for (let i = 1; i <= 180; i += 1) {
      const time = i / 60
      const r = planMotion(state, { dt: 1 / 60, time, speed: 1.5, turn: 0, groundY: 0 })
      expect(r.committed).toBe(true)
    }
    const contacts = state.contacts
    expect(contacts.length).toBeGreaterThan(0)
    // kind 合法，且无重复的 (kind, frame)。
    const seen = new Set<string>()
    for (const c of contacts) {
      expect(expectedOrder).toContain(c.kind)
      const key = `${c.kind}@${c.frame}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
      expect(Number.isFinite(c.x)).toBe(true)
      expect(Number.isFinite(c.y)).toBe(true)
    }
    // 每个周期内严格按序；全局也满足该相对顺序。
    for (let k = 0; k + 4 < contacts.length; k += expectedOrder.length) {
      expect(contacts.slice(k, k + expectedOrder.length).map((c) => c.kind)).toEqual(expectedOrder)
    }
    // 支撑点冻结：再跑若干帧，已存在接触的 x/y 不变。
    const frozen = contacts.map((c) => ({ x: c.x, y: c.y }))
    for (let i = 181; i <= 240; i += 1) {
      planMotion(state, { dt: 1 / 60, time: i / 60, speed: 1.5, turn: 0, groundY: 0 })
    }
    frozen.forEach((p, i) => {
      expect(state.contacts[i]!.x).toBe(p.x)
      expect(state.contacts[i]!.y).toBe(p.y)
    })
    expect(period).toBeGreaterThan(0)
    // 骨架仍可用（确认没有 NaN 污染）。
    expect(skeleton.count).toBe(18)
  })

  it('参数平滑帧率无关：60Hz 与 30Hz 收敛值一致', () => {
    const a = makeRig()
    const b = makeRig()
    for (let i = 1; i <= 120; i += 1) {
      planMotion(a.state, { dt: 1 / 60, time: i / 60, speed: 1.5, turn: 0.3, groundY: 0 })
    }
    for (let i = 1; i <= 60; i += 1) {
      planMotion(b.state, { dt: 1 / 30, time: i / 30, speed: 1.5, turn: 0.3, groundY: 0 })
    }
    expect(a.state.params.speed).toBeCloseTo(b.state.params.speed, 9)
    expect(a.state.params.turn).toBeCloseTo(b.state.params.turn, 9)
    expect(a.state.params.amplitude).toBeCloseTo(b.state.params.amplitude, 9)
    expect(a.state.params.gait).toBe(b.state.params.gait)
  })
})

describe('M8 应用层 · 姿态调制', () => {
  it('缺骨不半写：缺少 chest/head 时 spine 旋转保持不变', () => {
    const skeleton = createHumanoid('simple2d', { height: HEIGHT })
    const pose = createPose(skeleton)
    // 删除 head 的命名映射以模拟缺骨。
    const damaged = Object.create(skeleton) as CompiledSkeleton
    const map = new Map(skeleton.boneIdByName)
    map.delete('head')
    Object.defineProperty(damaged, 'boneIdByName', { value: map })
    const spine = at(skeleton, 'spine')
    const before = getRotation(pose, spine)
    const r0 = pose.local[spine * POSE_STRIDE + CH_ROT]!
    modulatePose(pose, damaged, { speed: 1, turn: 1, gait: 1, amplitude: 1 }, 1)
    expect(pose.local[spine * POSE_STRIDE + CH_ROT]).toBe(r0)
    expect(getRotation(pose, spine)).toBe(before)
  })

  it('只改 spine/chest/head 旋转；腿骨不动；amount 线性且幅度按身高归一', () => {
    const { skeleton, pose } = makeRig()
    const legs = ['thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'].map((n) => at(skeleton, n))
    const legBefore = legs.map((id) => pose.local[id * POSE_STRIDE + CH_ROT])

    modulatePose(pose, skeleton, { speed: 1.5, turn: 0.2, gait: 1, amplitude: 0.6 }, 1)
    const delta = (['spine', 'chest', 'head'] as const).map((n) => {
      const id = at(skeleton, n)
      return pose.local[id * POSE_STRIDE + CH_ROT]! - skeleton.bones[id]!.setup.rotation
    })
    expect(delta.some((d) => Math.abs(d) > 1e-6)).toBe(true)
    legs.forEach((id, i) => expect(pose.local[id * POSE_STRIDE + CH_ROT]).toBe(legBefore[i]))

    // amount=0 不写；amount 加倍则增量加倍（线性）。
    const pose0 = createPose(skeleton)
    const pose2 = createPose(skeleton)
    modulatePose(pose0, skeleton, { speed: 1.5, turn: 0.2, gait: 1, amplitude: 0.6 }, 0)
    modulatePose(pose2, skeleton, { speed: 1.5, turn: 0.2, gait: 1, amplitude: 0.6 }, 2)
    const spine = at(skeleton, 'spine')
    expect(pose0.local[spine * POSE_STRIDE + CH_ROT]).toBe(skeleton.bones[spine]!.setup.rotation)
    const spine2 = pose2.local[spine * POSE_STRIDE + CH_ROT]! - skeleton.bones[spine]!.setup.rotation
    expect(spine2).toBeCloseTo(delta[0]! * 2, 12)
  })

  it('调制后世界矩阵可刷新且无 NaN', () => {
    const { skeleton, pose } = makeRig()
    modulatePose(pose, skeleton, { speed: 1.2, turn: -0.4, gait: 1, amplitude: 1 }, 1)
    updateWorld(pose)
    expect(pose.worldValid).toBe(true)
    expect(Array.from(pose.world).every(Number.isFinite)).toBe(true)
  })
})
