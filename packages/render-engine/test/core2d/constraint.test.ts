import { describe, expect, it } from '@jest/globals'
import { compileSkeleton, type BoneSpec, type CompiledSkeleton, type JointSpec } from '@/core2d/skeleton'
import { createPose, getRotation, setLocal, updateWorld, type Pose } from '@/core2d/pose'
import { CH_ROT, CH_X, CH_Y, POSE_STRIDE } from '@/core2d/math'
import {
  createConstraintSolver,
  createPhysicsState,
  solveIk,
  stepPhysics,
  type IkConstraint,
  type PhysicsChain,
  type TransformConstraint,
} from '@/core2d/constraint'

/** 编译后的 id 由 Kahn 拓扑序决定，测试统一按名字解析，避免依赖输入顺序。 */
function ids(sk: CompiledSkeleton, ...names: string[]): number[] {
  return names.map((name) => sk.boneIdByName.get(name)!)
}

/** 构造一根骨：枢轴 (x, y)，末端在 +X 方向 length 米处。 */
function mkBone(
  name: string,
  parent: number,
  x: number,
  y: number,
  length: number,
  joint: JointSpec | null = null,
): BoneSpec {
  return {
    name, parent, length, joint,
    rest: { x, y, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
  }
}

/** 两骨手臂：upper → lower，末端是 lower 的 +X 尖端；target 在 (1.2, 0.8)。 */
function armSkeleton(lowerJoint: JointSpec | null = null): CompiledSkeleton {
  return compileSkeleton({
    name: 'arm',
    profile: 'full2d',
    bones: [
      mkBone('base', -1, 0, 0, 0),
      mkBone('upper', 0, 0, 0, 1),
      mkBone('lower', 1, 1, 0, 1, lowerJoint),
      mkBone('target', 0, 1.2, 0.8, 0),
    ],
  })
}

function armPose(sk: CompiledSkeleton): Pose {
  const pose = createPose(sk)
  updateWorld(pose)
  return pose
}

function ikOf(over: Partial<IkConstraint>): IkConstraint {
  return {
    id: 'ik', kind: 'ik', bone: 0, weight: 1, enabled: true, order: 0,
    targetBone: 0, chainLength: 2, method: 'analytic',
    maxIterations: 32, tolerance: 1e-6, bendSign: 1,
    ...over,
  }
}

/** 四节链 + 目标骨，供 CCD / FABRIK 使用。 */
function chainSkeleton(): CompiledSkeleton {
  return compileSkeleton({
    name: 'chain4',
    profile: 'full2d',
    bones: [
      mkBone('base', -1, 0, 0, 0),
      mkBone('s1', 0, 0, 0, 0.5),
      mkBone('s2', 1, 0.5, 0, 0.5),
      mkBone('s3', 2, 0.5, 0, 0.5),
      mkBone('s4', 3, 0.5, 0, 0.5),
      mkBone('target', 0, 1.2, 0.6, 0),
    ],
  })
}

function hairSkeleton(): CompiledSkeleton {
  return compileSkeleton({
    name: 'hair',
    profile: 'full2d',
    bones: [
      mkBone('head', -1, 0, 0, 0),
      mkBone('h1', 0, 0, 0, 0.1),
      mkBone('h2', 1, 0.1, 0, 0.1),
      mkBone('h3', 2, 0.1, 0, 0.1),
      mkBone('h4', 3, 0.1, 0, 0.1),
    ],
  })
}

function hairIds(sk: CompiledSkeleton): { root: number; chain: number[]; restLengths: number[] } {
  const [head, h1, h2, h3, h4] = ids(sk, 'head', 'h1', 'h2', 'h3', 'h4')
  void head
  return { root: h1!, chain: [h1!, h2!, h3!, h4!], restLengths: [0.1, 0.1, 0.1] }
}

function hairChain(sk: CompiledSkeleton): PhysicsChain {
  const { root, chain, restLengths } = hairIds(sk)
  return {
    id: 'hair', rootBone: root, bones: chain,
    restLengths, gravity: [0, -2], stiffness: 1, damping: 0.98,
  }
}

/** 末端（lower 尖端）到目标骨原点的距离。 */
function tipResidual(pose: Pose, bone: number, targetBone: number): number {
  updateWorld(pose)
  const o = bone * 6
  const t = targetBone * 6
  const len = pose.skeleton.bones[bone]!.length
  const tx = pose.world[o + 0]! * len + pose.world[o + 4]!
  const ty = pose.world[o + 1]! * len + pose.world[o + 5]!
  return Math.hypot(tx - pose.world[t + 4]!, ty - pose.world[t + 5]!)
}

describe('core2d constraint solver', () => {
  it('按 (order, id) 排序：order 决定覆盖顺序', () => {
    const sk = armSkeleton()
    const [upper, lower, target] = ids(sk, 'upper', 'lower', 'target')
    const t1: TransformConstraint = {
      id: 'a', kind: 'transform', bone: lower!, weight: 1, enabled: true, order: 1,
      sourceBone: upper!, mixRotation: 1, mixTranslation: 0,
    }
    const t2: TransformConstraint = { ...t1, id: 'b', order: 5, sourceBone: target! }
    const make = () => {
      const pose = armPose(sk)
      setLocal(pose, upper!, CH_ROT, 0.3)
      setLocal(pose, target!, CH_ROT, -0.7)
      return pose
    }
    const a = make()
    createConstraintSolver([t1, t2]).solve(a, 1 / 60)
    expect(getRotation(a, lower!)).toBeCloseTo(-0.7, 6) // 先 a 后 b

    const b = make()
    createConstraintSolver([{ ...t1, order: 5 }, { ...t2, order: 1 }]).solve(b, 1 / 60)
    expect(getRotation(b, lower!)).toBeCloseTo(0.3, 6) // 先 t2 后 t1
  })

  it('order 相同时按 id 字典序决定覆盖顺序', () => {
    const sk = armSkeleton()
    const [upper, lower, target] = ids(sk, 'upper', 'lower', 'target')
    const base: TransformConstraint = {
      id: 'a', kind: 'transform', bone: lower!, weight: 1, enabled: true, order: 3,
      sourceBone: upper!, mixRotation: 1, mixTranslation: 0,
    }
    const make = () => {
      const pose = armPose(sk)
      setLocal(pose, upper!, CH_ROT, 0.3)
      setLocal(pose, target!, CH_ROT, -0.7)
      return pose
    }
    const a = make()
    createConstraintSolver([base, { ...base, id: 'b', sourceBone: target! }]).solve(a, 1 / 60)
    expect(getRotation(a, lower!)).toBeCloseTo(-0.7, 6) // 'b' 后写

    const b = make()
    createConstraintSolver([
      { ...base, id: 'z', sourceBone: upper! },
      { ...base, id: 'a', sourceBone: target! },
    ]).solve(b, 1 / 60)
    expect(getRotation(b, lower!)).toBeCloseTo(0.3, 6) // 'z' 后写
  })

  it('weight=0 与 enabled=false 严格不写入（按位相同）', () => {
    const sk = armSkeleton()
    const [upper, lower] = ids(sk, 'upper', 'lower')
    const t: TransformConstraint = {
      id: 't', kind: 'transform', bone: lower!, weight: 0, enabled: true, order: 0,
      sourceBone: upper!, mixRotation: 1, mixTranslation: 1,
    }
    for (const c of [t, { ...t, weight: 1, enabled: false }]) {
      const pose = createPose(sk)
      setLocal(pose, upper!, CH_ROT, 0.9)
      setLocal(pose, upper!, CH_X, 0.7)
      const before = Array.from(pose.local)
      createConstraintSolver([c]).solve(pose, 1 / 60)
      expect(Array.from(pose.local)).toEqual(before)
    }
  })

  it('weight 在偏移空间最短弧混合，0.5 得到中点', () => {
    const sk = armSkeleton()
    const [upper, lower] = ids(sk, 'upper', 'lower')
    const pose = createPose(sk)
    setLocal(pose, upper!, CH_ROT, Math.PI - 0.2)
    setLocal(pose, lower!, CH_ROT, -Math.PI + 0.2)
    const t: TransformConstraint = {
      id: 't', kind: 'transform', bone: lower!, weight: 0.5, enabled: true, order: 0,
      sourceBone: upper!, mixRotation: 1, mixTranslation: 0,
    }
    createConstraintSolver([t]).solve(pose, 1 / 60)
    // 最短弧跨 -π：-π+0.2 → π-0.2 实际只走 -0.4 rad，中点落在 -π。
    expect(getRotation(pose, lower!)).toBeCloseTo(-Math.PI, 6)
  })

  it('循环依赖：transform 源/目标成环以及 IK 链包含目标骨时抛出 cycle', () => {
    const sk = armSkeleton()
    const [upper, lower] = ids(sk, 'upper', 'lower')
    const t = (id: string, bone: number, sourceBone: number): TransformConstraint => ({
      id, kind: 'transform', bone, sourceBone, weight: 1, enabled: true, order: 0,
      mixRotation: 1, mixTranslation: 1,
    })
    expect(() => createConstraintSolver([t('a', lower!, lower!)])).toThrow(/cycle/)
    expect(() => createConstraintSolver([t('a', lower!, upper!), t('b', upper!, lower!)])).toThrow(/cycle/)
    // 目标骨就是被写的骨：构建期即判环。
    expect(() => createConstraintSolver([ikOf({ bone: lower!, targetBone: lower! })])).toThrow(/cycle/)
    // 目标骨是链上祖先：求解期拿到骨架后判环。
    const solver = createConstraintSolver([ikOf({ bone: lower!, targetBone: upper! })])
    expect(() => solver.solve(armPose(sk), 1 / 60)).toThrow(/cycle/)
    // 目标骨在链外，正常。
    expect(() => createConstraintSolver([ikOf({ bone: lower!, targetBone: ids(sk, 'target')[0]! })])).not.toThrow()
  })

  it('IK analytic：可达目标精确命中，只写链上骨的旋转通道', () => {
    const sk = armSkeleton()
    const [upper, lower, target] = ids(sk, 'upper', 'lower', 'target')
    const pose = armPose(sk)
    const before = Array.from(pose.local)
    const result = solveIk(pose, ikOf({ bone: lower!, targetBone: target! }))
    expect(result.reason).toBe('ok')
    expect(result.reached).toBe(true)
    expect(result.residual).toBeLessThan(1e-4)
    expect(tipResidual(pose, lower!, target!)).toBeLessThan(1e-4)
    for (let b = 0; b < sk.count; b += 1) {
      for (const ch of [CH_X, CH_Y]) {
        expect(pose.local[b * POSE_STRIDE + ch]).toBe(before[b * POSE_STRIDE + ch])
      }
      if (b !== upper && b !== lower) {
        expect(pose.local[b * POSE_STRIDE + CH_ROT]).toBe(before[b * POSE_STRIDE + CH_ROT])
      }
    }
  })

  it('IK analytic：超出总长返回 unreachable，残差有限且不产生 NaN', () => {
    const sk = compileSkeleton({
      name: 'far', profile: 'full2d',
      bones: [
        mkBone('base', -1, 0, 0, 0),
        mkBone('upper', 0, 0, 0, 1),
        mkBone('lower', 1, 1, 0, 1),
        mkBone('target', 0, 10, 10, 0),
      ],
    })
    const [lower, target] = ids(sk, 'lower', 'target')
    const pose = armPose(sk)
    const result = solveIk(pose, ikOf({ bone: lower!, targetBone: target! }))
    expect(result.reason).toBe('unreachable')
    expect(result.reached).toBe(false)
    expect(Number.isFinite(result.residual)).toBe(true)
    for (const v of pose.local) expect(Number.isFinite(v)).toBe(true)
  })

  it('IK：零长链 degenerate，不写姿态', () => {
    const sk = armSkeleton()
    const [lower, target] = ids(sk, 'lower', 'target')
    const pose = armPose(sk)
    const before = Array.from(pose.local)
    const result = solveIk(pose, ikOf({ bone: lower!, targetBone: target!, chainLength: 1 }))
    expect(result.reason).toBe('degenerate')
    expect(result.reached).toBe(false)
    expect(result.iterations).toBe(0)
    expect(Array.from(pose.local)).toEqual(before)
  })

  it('IK：目标与链根重合时 degenerate，无 NaN', () => {
    const sk = compileSkeleton({
      name: 'coincident', profile: 'full2d',
      bones: [
        mkBone('base', -1, 0, 0, 0),
        mkBone('upper', 0, 0, 0, 1),
        mkBone('lower', 1, 1, 0, 1),
        mkBone('target', 1, 0, 0, 0),
      ],
    })
    const [lower, target] = ids(sk, 'lower', 'target')
    const pose = armPose(sk)
    const result = solveIk(pose, ikOf({ bone: lower!, targetBone: target! }))
    expect(result.reason).toBe('degenerate')
    for (const v of pose.local) expect(Number.isFinite(v)).toBe(true)
  })

  it('IK limit：joint 限位不允许任何候选侧时报告 limit，允许镜像侧时精确命中', () => {
    const blocked: JointSpec = { dof: 1, min: 0.6, max: 1.2, rest: 0.8, bendSign: 1, yoke: null }
    const sk1 = armSkeleton(blocked)
    const [lower1, target1] = ids(sk1, 'lower', 'target')
    const result = solveIk(armPose(sk1), ikOf({ bone: lower1!, targetBone: target1! }))
    expect(result.reason).toBe('limit')
    expect(Number.isFinite(result.residual)).toBe(true)

    const mirror: JointSpec = { dof: 1, min: 1.0, max: 2.0, rest: 1.5, bendSign: 1, yoke: null }
    const sk2 = armSkeleton(mirror)
    const [lower2, target2] = ids(sk2, 'lower', 'target')
    const result2 = solveIk(armPose(sk2), ikOf({ bone: lower2!, targetBone: target2! }))
    expect(result2.reason).toBe('ok')
    expect(result2.residual).toBeLessThan(1e-4)
  })

  it('IK ccd：四节链在迭代预算内收敛', () => {
    const sk = chainSkeleton()
    const [s4, target] = ids(sk, 's4', 'target')
    const pose = armPose(sk)
    const result = solveIk(pose, ikOf({
      bone: s4!, targetBone: target!, chainLength: 4, method: 'ccd',
      maxIterations: 80, tolerance: 1e-4,
    }))
    expect(result.reason).toBe('ok')
    expect(result.reached).toBe(true)
    expect(tipResidual(pose, s4!, target!)).toBeLessThan(1e-3)
  })

  it('IK fabrik：四节链收敛且保持段长', () => {
    const sk = chainSkeleton()
    const [s1, s2, s3, s4, target] = ids(sk, 's1', 's2', 's3', 's4', 'target')
    const pose = armPose(sk)
    const result = solveIk(pose, ikOf({
      bone: s4!, targetBone: target!, chainLength: 4, method: 'fabrik',
      maxIterations: 40, tolerance: 1e-4,
    }))
    expect(result.reason).toBe('ok')
    expect(result.residual).toBeLessThan(1e-3)
    updateWorld(pose)
    const pts = [s1!, s2!, s3!, s4!].map((b) => [pose.world[b * 6 + 4]!, pose.world[b * 6 + 5]!] as const)
    const tipX = pose.world[s4! * 6]! * 0.5 + pose.world[s4! * 6 + 4]!
    const tipY = pose.world[s4! * 6 + 1]! * 0.5 + pose.world[s4! * 6 + 5]!
    const all = [...pts, [tipX, tipY] as const]
    for (let i = 1; i < all.length; i += 1) {
      const dx = all[i]![0] - all[i - 1]![0]
      const dy = all[i]![1] - all[i - 1]![1]
      expect(Math.hypot(dx, dy)).toBeCloseTo(0.5, 5)
    }
  })

  it('IK：迭代预算耗尽时报告 maxIterations 且 iterations 不超过预算', () => {
    const sk = chainSkeleton()
    const [s4, target] = ids(sk, 's4', 'target')
    const pose = armPose(sk)
    const result = solveIk(pose, ikOf({
      bone: s4!, targetBone: target!, chainLength: 4, method: 'ccd',
      maxIterations: 1, tolerance: 1e-10,
    }))
    expect(result.reason).toBe('maxIterations')
    expect(result.iterations).toBe(1)
  })

  it('results 映射只记录启用且未忽略的 IK 约束', () => {
    const sk = armSkeleton()
    const [lower, target] = ids(sk, 'lower', 'target')
    const pose = armPose(sk)
    const solver = createConstraintSolver([
      ikOf({ id: 'on', bone: lower!, targetBone: target!, weight: 1 }),
      ikOf({ id: 'off', bone: lower!, targetBone: target!, weight: 0 }),
      ikOf({ id: 'disabled', bone: lower!, targetBone: target!, enabled: false }),
    ])
    solver.solve(pose, 1 / 60)
    expect(solver.results.has('on')).toBe(true)
    expect(solver.results.has('off')).toBe(false)
    expect(solver.results.has('disabled')).toBe(false)
  })
})

describe('core2d secondary physics', () => {
  it('createPhysicsState 分配正确尺寸并延迟初始化', () => {
    const sk = hairSkeleton()
    const chain = hairChain(sk)
    const state = createPhysicsState(chain)
    expect(state.positions.length).toBe(chain.bones.length * 2)
    expect(state.previous.length).toBe(state.positions.length)
    expect(state.initialized).toBe(false)
  })

  it('固定步长：一次 1/30 与两次 1/60 的推进按位一致', () => {
    const sk = hairSkeleton()
    const chain = hairChain(sk)
    const a = armPose(sk)
    const sa = createPhysicsState(chain)
    stepPhysics(a, chain, sa, 1 / 30)

    const b = armPose(sk)
    const sb = createPhysicsState(chain)
    stepPhysics(b, chain, sb, 1 / 60)
    stepPhysics(b, chain, sb, 1 / 60)

    expect(Array.from(sa.positions)).toEqual(Array.from(sb.positions))
    expect(Array.from(sa.previous)).toEqual(Array.from(sb.previous))
    expect(sa.initialized).toBe(true)
  })

  it('确定性 + 距离约束长度保持 + 无 NaN', () => {
    const sk = hairSkeleton()
    const chain = hairChain(sk)
    const { root } = hairIds(sk)
    const run = () => {
      const pose = armPose(sk)
      const state = createPhysicsState(chain)
      const dts = [1 / 60, 1 / 30, 1 / 144, 1 / 120]
      for (let frame = 0; frame < 90; frame += 1) {
        stepPhysics(pose, chain, state, dts[frame % dts.length]!)
      }
      return { pose, state }
    }
    const x = run()
    const y = run()
    expect(Array.from(x.state.positions)).toEqual(Array.from(y.state.positions))
    expect(Array.from(x.state.previous)).toEqual(Array.from(y.state.previous))
    expect(Array.from(x.pose.local)).toEqual(Array.from(y.pose.local))
    for (const v of x.state.positions) expect(Number.isFinite(v)).toBe(true)
    for (const v of x.pose.local) expect(Number.isFinite(v)).toBe(true)
    void root
    for (let s = 0; s < chain.restLengths.length; s += 1) {
      const dx = x.state.positions[(s + 1) * 2]! - x.state.positions[s * 2]!
      const dy = x.state.positions[(s + 1) * 2 + 1]! - x.state.positions[s * 2 + 1]!
      expect(Math.hypot(dx, dy)).toBeCloseTo(chain.restLengths[s]!, 3)
    }
  })

  it('根节点始终钉住骨枢轴，dt=0 不再推进且不写 NaN', () => {
    const sk = hairSkeleton()
    const chain = hairChain(sk)
    const { root } = hairIds(sk)
    const pose = armPose(sk)
    setLocal(pose, 0, CH_X, 0.3)
    const state = createPhysicsState(chain)
    stepPhysics(pose, chain, state, 1 / 60)
    updateWorld(pose)
    expect(state.positions[0]).toBeCloseTo(pose.world[root! * 6 + 4]!, 6)
    expect(state.positions[1]).toBeCloseTo(pose.world[root! * 6 + 5]!, 6)
    const snapshot = Array.from(state.positions)
    stepPhysics(pose, chain, state, 0)
    expect(Array.from(state.positions)).toEqual(snapshot)
    for (const v of state.positions) expect(Number.isFinite(v)).toBe(true)
  })
})
