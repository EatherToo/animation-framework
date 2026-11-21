import { describe, expect, it } from '@jest/globals'
import { compileSkeleton, type BoneSpec, type CompiledSkeleton } from '@/core2d/skeleton'
import { createPose, setLocal, updateWorld } from '@/core2d/pose'
import { CH_X, CH_Y } from '@/core2d/math'
import {
  createPhysicsState,
  createConstraintSolver,
  solveIk,
  stepPhysics,
  type IkConstraint,
  type PhysicsChain,
} from '@/core2d/constraint'

function mkBone(name: string, parent: number, x: number, y: number, length: number): BoneSpec {
  return {
    name, parent, length,
    rest: { x, y, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
  }
}

function id(sk: CompiledSkeleton, name: string): number {
  return sk.boneIdByName.get(name)!
}

/** 应用视角：两骨手臂 + 独立目标骨。 */
function armAndTarget() {
  const sk = compileSkeleton({
    name: 'arm-smoke', profile: 'full2d',
    bones: [
      mkBone('base', -1, 0, 0, 0),
      mkBone('upper', 0, 0, 0, 1),
      mkBone('lower', 1, 1, 0, 1),
      mkBone('target', 0, 1.2, 0.8, 0),
    ],
  })
  return { sk, pose: createPose(sk) }
}

/**
 * 应用视角：solveIk 解两骨手臂后，末端（lower 的尖端）必须落在目标骨原点 <1e-3。
 * 经约束栈（带 weight=0 的禁用条目）调用时同样成立。
 */
describe('M3 smoke: 应用视角', () => {
  it('两骨 IK 末端命中目标骨', () => {
    const { sk, pose } = armAndTarget()
    updateWorld(pose)
    const lower = id(sk, 'lower')
    const target = id(sk, 'target')
    const ik: IkConstraint = {
      id: 'arm-ik', kind: 'ik', bone: lower, weight: 1, enabled: true, order: 10,
      targetBone: target, chainLength: 2, method: 'analytic',
      maxIterations: 32, tolerance: 1e-6, bendSign: 1,
    }
    const result = solveIk(pose, ik)
    updateWorld(pose)
    const o = lower * 6
    const t = target * 6
    const len = sk.bones[lower]!.length
    const tipX = pose.world[o]! * len + pose.world[o + 4]!
    const tipY = pose.world[o + 1]! * len + pose.world[o + 5]!
    const gap = Math.hypot(tipX - pose.world[t + 4]!, tipY - pose.world[t + 5]!)
    expect(result.reached).toBe(true)
    expect(result.reason).toBe('ok')
    expect(gap).toBeLessThan(1e-3)
  })

  it('四节头发链模拟 60 帧：确定性、有限且不飞出可视范围', () => {
    const sk = compileSkeleton({
      name: 'hair-smoke', profile: 'full2d',
      bones: [
        mkBone('head', -1, 0, 0, 0),
        mkBone('h1', 0, 0, 0, 0.12),
        mkBone('h2', 1, 0.12, 0, 0.12),
        mkBone('h3', 2, 0.12, 0, 0.12),
        mkBone('h4', 3, 0.12, 0, 0.12),
      ],
    })
    const root = id(sk, 'h1')
    const chainBones = [root, id(sk, 'h2'), id(sk, 'h3'), id(sk, 'h4')]
    const chain: PhysicsChain = {
      id: 'hair', rootBone: root, bones: chainBones,
      restLengths: [0.12, 0.12, 0.12], gravity: [0, -3], stiffness: 1, damping: 0.97,
    }
    const dts = [1 / 60, 1 / 30, 1 / 144, 1 / 120]
    const head = id(sk, 'head')

    const run = () => {
      const pose = createPose(sk)
      const state = createPhysicsState(chain)
      for (let frame = 0; frame < 60; frame += 1) {
        // 发根随头左右晃动；这是外部动画写入，物理只读枢轴。
        setLocal(pose, head, CH_X, 0.25 * Math.sin(frame * 0.21))
        setLocal(pose, head, CH_Y, 0.1 * Math.cos(frame * 0.17))
        stepPhysics(pose, chain, state, dts[frame % dts.length]!)
      }
      return { pose, state }
    }

    const a = run()
    const b = run()
    expect(Array.from(a.state.positions)).toEqual(Array.from(b.state.positions))
    expect(Array.from(a.pose.local)).toEqual(Array.from(b.pose.local))
    for (const v of a.state.positions) {
      expect(Number.isFinite(v)).toBe(true)
      expect(Math.abs(v)).toBeLessThan(5)
    }
    for (const v of a.pose.local) expect(Number.isFinite(v)).toBe(true)
    // 应用视角：四节链总长 0.48 m，末端不应远离发根超过总长 + 少量裕度。
    const tipX = a.state.positions[6]!
    const tipY = a.state.positions[7]!
    const rootX = a.state.positions[0]!
    const rootY = a.state.positions[1]!
    expect(Math.hypot(tipX - rootX, tipY - rootY)).toBeLessThan(0.6)
  })

  it('约束栈同时含 transform / path / ik 时结果可复现且 IK 仍然生效', () => {
    const { sk } = armAndTarget()
    const [upper, lower, target, base] = [id(sk, 'upper'), id(sk, 'lower'), id(sk, 'target'), id(sk, 'base')]
    const makePose = () => {
      const pose = createPose(sk)
      setLocal(pose, upper, CH_X, 0.2)
      return pose
    }
    const makeSolver = () => createConstraintSolver([
      {
        id: 'path', kind: 'path', bone: base, weight: 1, enabled: true, order: 1,
        points: new Float32Array([0, 0, 1, 0]), mix: 1,
      },
      {
        id: 'noop', kind: 'transform', bone: upper, weight: 0, enabled: true, order: 2,
        sourceBone: target, mixRotation: 1, mixTranslation: 1,
      },
      {
        id: 'arm-ik', kind: 'ik', bone: lower, weight: 1, enabled: true, order: 10,
        targetBone: target, chainLength: 2, method: 'analytic',
        maxIterations: 32, tolerance: 1e-6, bendSign: -1,
      },
    ])
    const a = makeSolver()
    const b = makeSolver()
    const poseA = makePose()
    const poseB = makePose()
    a.solve(poseA, 1 / 60)
    b.solve(poseB, 1 / 60)
    // 同输入两次独立求值必须按位一致。
    expect(Array.from(poseA.local)).toEqual(Array.from(poseB.local))
    expect(a.results.get('arm-ik')!.reached).toBe(true)
    const len = sk.bones[lower]!.length
    const tipX = poseA.world[lower * 6]! * len + poseA.world[lower * 6 + 4]!
    const tipY = poseA.world[lower * 6 + 1]! * len + poseA.world[lower * 6 + 5]!
    expect(Math.hypot(tipX - poseA.world[target * 6 + 4]!, tipY - poseA.world[target * 6 + 5]!)).toBeLessThan(1e-3)
  })
})
