import { describe, expect, it } from '@jest/globals'
import { compileSkeleton, type BoneSpec, type CompiledSkeleton, type JointSpec } from '@/core/skeleton'
import { createPose, getLocal, getRotation, setLocal, updateWorld, type Pose } from '@/core/pose'
import {
  CH_ROT, CH_SHY, CH_SX, CH_SY, CH_X, CH_Y, POSE_STRIDE, WORLD_STRIDE,
  angleDelta,
} from '@/core/math'
import {
  createConstraintSolver,
  createPhysicsConstraintState,
  resetPhysicsConstraintState,
  solveIk,
  stepPhysicsConstraint,
  type ConstraintData,
  type IkConstraint,
  type PathConstraint,
  type PhysicsConstraint,
  type TransformConstraint,
} from '@/constraint/constraint'

function mkBone(
  name: string,
  parent: number,
  x: number,
  y: number,
  length: number,
  restRotation = 0,
  joint: JointSpec | null = null,
): BoneSpec {
  return {
    name, parent, length, joint,
    rest: { x, y, rotation: restRotation, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
  }
}

function boneId(sk: CompiledSkeleton, name: string): number {
  return sk.boneIdByName.get(name)!
}

function local(pose: Pose, bone: number, channel: number): number {
  return pose.local[bone * POSE_STRIDE + channel]!
}

function worldPoint(pose: Pose, bone: number): [number, number] {
  const o = bone * WORLD_STRIDE
  return [pose.world[o + 4]!, pose.world[o + 5]!]
}

function worldAngle(pose: Pose, bone: number): number {
  const o = bone * WORLD_STRIDE
  return Math.atan2(pose.world[o + 1]!, pose.world[o]!)
}

function tipPoint(pose: Pose, bone: number): [number, number] {
  const o = bone * WORLD_STRIDE
  const length = pose.skeleton.bones[bone]!.length
  return [pose.world[o]! * length + pose.world[o + 4]!, pose.world[o + 1]! * length + pose.world[o + 5]!]
}

/** 两骨手臂：upper → lower，target 是 base 的独立子骨。 */
function armSkeleton(targetX = 1.2, targetY = 0.8, lowerLength = 1, lowerJoint: JointSpec | null = null): CompiledSkeleton {
  return compileSkeleton({
    name: 'arm-parity',
    profile: 'full2d',
    bones: [
      mkBone('base', -1, 0, 0, 0),
      mkBone('upper', 0, 0, 0, 1),
      mkBone('lower', 1, 1, 0, lowerLength, 0, lowerJoint),
      mkBone('target', 0, targetX, targetY, 0),
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

function transformOf(over: Partial<TransformConstraint>): TransformConstraint {
  return {
    id: 't', kind: 'transform', bone: 0, weight: 1, enabled: true, order: 0,
    sourceBone: 0, mixRotation: 0, mixTranslation: 0,
    ...over,
  }
}

function pathOf(over: Partial<PathConstraint>): PathConstraint {
  return {
    id: 'p', kind: 'path', bone: 0, weight: 1, enabled: true, order: 0,
    points: new Float32Array([0, 0, 10, 0, 10, 10]),
    mix: 1,
    ...over,
  }
}

function physicsOf(over: Partial<PhysicsConstraint>): PhysicsConstraint {
  return {
    id: 'phys', kind: 'physics', bone: 1, weight: 1, enabled: true, order: 0,
    inertia: 1, strength: 40, damping: 8, mass: 1, wind: 0, gravity: 0, mix: 1,
    ...over,
  }
}

describe('IK parity: softness / stretch / compress / bendDirection', () => {
  it('softness 在可达边界附近连续，且比硬解更保守', () => {
    const sk = armSkeleton(1, 0, 1)
    const [upper, lower, target] = ['upper', 'lower', 'target'].map((n) => boneId(sk, n))
    const solveAt = (distance: number, softness: number) => {
      const pose = armPose(sk)
      const angle = 0.6
      setLocal(pose, target!, CH_X, distance * Math.cos(angle))
      setLocal(pose, target!, CH_Y, distance * Math.sin(angle))
      const result = solveIk(pose, ikOf({ bone: lower!, targetBone: target!, softness }))
      return { upper: getRotation(pose, upper!), lower: getRotation(pose, lower!), result }
    }

    for (const softness of [0, 1]) {
      let previous: number | null = null
      for (let d = 1; d <= 2.05; d += 0.05) {
        const value = solveAt(d, softness)
        const poseValue = value.upper + value.lower
        if (previous !== null) expect(Math.abs(poseValue - previous)).toBeLessThan(0.25)
        previous = poseValue
        expect(Number.isFinite(poseValue)).toBe(true)
      }
    }
    const hard = solveAt(1.95, 0)
    const soft = solveAt(1.95, 1)
    expect(hard.result.residual).toBeLessThan(1e-4)
    expect(soft.result.residual).toBeGreaterThan(hard.result.residual)
    expect(soft.result.reason).toBe('ok')
  })

  it('bendDirection 决定肘部朝向，且优先于旧 bendSign', () => {
    const sk = armSkeleton()
    const [lower, target] = ['lower', 'target'].map((n) => boneId(sk, n))
    const solve = (direction: 1 | -1) => {
      const pose = armPose(sk)
      solveIk(pose, ikOf({ bone: lower!, targetBone: target!, bendSign: 1, bendDirection: direction }))
      updateWorld(pose)
      return worldPoint(pose, lower!)
    }
    const plus = solve(1)
    const minus = solve(-1)
    expect(plus[1] * minus[1]).toBeLessThan(0)
    expect(Math.abs(plus[1] - minus[1])).toBeGreaterThan(0.1)
  })

  it('stretch 允许超过静止总长并精确命中，stretch=0 保持 unreachable', () => {
    const sk = armSkeleton(3, 0, 1)
    const [upper, lower, target] = ['upper', 'lower', 'target'].map((n) => boneId(sk, n))
    const hardPose = armPose(sk)
    const hard = solveIk(hardPose, ikOf({ bone: lower!, targetBone: target!, stretch: 0 }))
    expect(hard.reason).toBe('unreachable')
    expect(hard.reached).toBe(false)

    const pose = armPose(sk)
    const result = solveIk(pose, ikOf({ bone: lower!, targetBone: target!, stretch: 1 }))
    updateWorld(pose)
    const tip = tipPoint(pose, lower!)
    const targetPoint = worldPoint(pose, target!)
    expect(result.reached).toBe(true)
    expect(Math.hypot(tip[0] - targetPoint[0], tip[1] - targetPoint[1])).toBeLessThan(1e-3)
    expect(local(pose, upper!, CH_SX)).toBeCloseTo(1.5, 6)

    const uniformPose = armPose(sk)
    solveIk(uniformPose, ikOf({ bone: lower!, targetBone: target!, stretch: 1, uniform: true }))
    expect(local(uniformPose, upper!, CH_SX)).toBeCloseTo(1.5, 6)
    expect(local(uniformPose, upper!, CH_SY)).toBeCloseTo(1.5, 6)
  })

  it('mix 在最终 local 空间插值，直接调用 solveIk 也生效', () => {
    const sk = armSkeleton()
    const [upper, lower, target] = ['upper', 'lower', 'target'].map((n) => boneId(sk, n))
    const solve = (mix: number) => {
      const pose = armPose(sk)
      const before = [getRotation(pose, upper!), getRotation(pose, lower!)] as const
      solveIk(pose, ikOf({ bone: lower!, targetBone: target!, mix }))
      return {
        before,
        after: [getRotation(pose, upper!), getRotation(pose, lower!)] as const,
      }
    }
    const full = solve(1)
    const half = solve(0.5)
    for (let i = 0; i < 2; i += 1) {
      const expected = full.before[i]! + angleDelta(full.before[i]!, full.after[i]!) * 0.5
      expect(half.after[i]).toBeCloseTo(expected, 5)
    }
  })

  it('compress 允许链短于几何最小距离，compress=0 时 fold 并报告 unreachable', () => {
    const sk = armSkeleton(0.5, 0, 0.2)
    const [upper, lower, target] = ['upper', 'lower', 'target'].map((n) => boneId(sk, n))
    const hard = solveIk(armPose(sk), ikOf({ bone: lower!, targetBone: target!, compress: 0 }))
    expect(hard.reason).toBe('unreachable')

    const pose = armPose(sk)
    const result = solveIk(pose, ikOf({ bone: lower!, targetBone: target!, compress: 1 }))
    updateWorld(pose)
    const tip = tipPoint(pose, lower!)
    const targetPoint = worldPoint(pose, target!)
    expect(result.reached).toBe(true)
    expect(Math.hypot(tip[0] - targetPoint[0], tip[1] - targetPoint[1])).toBeLessThan(1e-3)
    expect(local(pose, upper!, CH_SX)).toBeCloseTo(0.625, 6)
  })
})

describe('transform parity: 逐轴 mix / offset / local / relative', () => {
  function transformSkeleton(): CompiledSkeleton {
    return compileSkeleton({
      name: 'transform-parity',
      profile: 'full2d',
      bones: [
        mkBone('base', -1, 0, 0, 0),
        mkBone('driver', 0, 2, 0, 0),
        mkBone('follower', 0, -2, 0, 0),
      ],
    })
  }

  function setup(): { sk: CompiledSkeleton; pose: Pose; driver: number; follower: number } {
    const sk = transformSkeleton()
    const driver = boneId(sk, 'driver')
    const follower = boneId(sk, 'follower')
    const pose = createPose(sk)
    setLocal(pose, driver, CH_ROT, 0.4)
    setLocal(pose, driver, CH_X, 0.3)
    setLocal(pose, driver, CH_Y, -0.2)
    setLocal(pose, driver, CH_SX, 1.5)
    setLocal(pose, driver, CH_SY, 0.8)
    setLocal(pose, driver, CH_SHY, 0.25)
    setLocal(pose, follower, CH_ROT, 0.1)
    setLocal(pose, follower, CH_X, 0.05)
    setLocal(pose, follower, CH_Y, 0.05)
    updateWorld(pose)
    return { sk, pose, driver, follower }
  }

  it('每个 mix 只影响对应通道', () => {
    const cases: Array<[Partial<TransformConstraint>, number, number, number]> = [
      [{ mixRotate: 1 }, CH_ROT, 0.4, 0.1],
      [{ mixX: 1 }, CH_X, 0.3, 0.05],
      [{ mixY: 1 }, CH_Y, -0.2, 0.05],
      [{ mixScaleX: 1 }, CH_SX, 1.5, 1],
      [{ mixScaleY: 1 }, CH_SY, 0.8, 1],
      [{ mixShearY: 1 }, CH_SHY, 0.25, 0],
    ]
    for (const [over, channel, expected, untouched] of cases) {
      const { pose, driver, follower } = setup()
      const untouchedChannel = channel === CH_X ? CH_Y : CH_X
      const untouchedBefore = local(pose, follower, untouchedChannel)
      createConstraintSolver([transformOf({ ...over, bone: follower, sourceBone: driver })]).solve(pose, 1 / 60)
      expect(local(pose, follower, channel)).toBeCloseTo(expected, 6)
      expect(local(pose, follower, untouchedChannel)).toBe(untouchedBefore)
    }
  })

  it('offset 与对应通道叠加，未启用通道保持不变', () => {
    const { pose, driver, follower } = setup()
    createConstraintSolver([
      transformOf({
        bone: follower, sourceBone: driver,
        mixRotate: 1, mixX: 1,
        offsetRotation: 0.2, offsetX: 0.1,
      }),
    ]).solve(pose, 1 / 60)
    expect(getRotation(pose, follower)).toBeCloseTo(0.6, 6)
    expect(local(pose, follower, CH_X)).toBeCloseTo(0.4, 6)
    expect(local(pose, follower, CH_Y)).toBeCloseTo(0.05, 6)
  })

  it('local=true 复制 local 通道；local=false 让 follower 世界位置/角度对齐 driver', () => {
    const sk = compileSkeleton({
      name: 'transform-local',
      profile: 'full2d',
      bones: [
        mkBone('base', -1, 0, 0, 0),
        mkBone('pivot', 0, 2, 0.5, 0, 0.4),
        mkBone('driver', 1, 0.5, 0.2, 0),
        mkBone('follower', 1, -1, 0.3, 0),
      ],
    })
    const driver = boneId(sk, 'driver')
    const follower = boneId(sk, 'follower')

    const localPose = createPose(sk)
    setLocal(localPose, driver, CH_ROT, 0.3)
    setLocal(localPose, driver, CH_X, 0.5)
    setLocal(localPose, driver, CH_Y, 0.2)
    createConstraintSolver([
      transformOf({ bone: follower, sourceBone: driver, mixRotate: 1, mixX: 1, mixY: 1, local: true }),
    ]).solve(localPose, 1 / 60)
    expect(getRotation(localPose, follower)).toBeCloseTo(0.3, 6)
    expect(local(localPose, follower, CH_X)).toBeCloseTo(0.5, 6)
    expect(local(localPose, follower, CH_Y)).toBeCloseTo(0.2, 6)

    const worldPose = createPose(sk)
    setLocal(worldPose, driver, CH_ROT, 0.3)
    setLocal(worldPose, driver, CH_X, 0.5)
    setLocal(worldPose, driver, CH_Y, 0.2)
    createConstraintSolver([
      transformOf({ bone: follower, sourceBone: driver, mixRotate: 1, mixX: 1, mixY: 1, local: false }),
    ]).solve(worldPose, 1 / 60)
    updateWorld(worldPose)
    const a = worldPoint(worldPose, follower)
    const b = worldPoint(worldPose, driver)
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-5)
    expect(angleDelta(worldAngle(worldPose, follower), worldAngle(worldPose, driver))).toBeCloseTo(0, 5)
  })

  it('relative=true 叠加到当前值，false 时直接替换', () => {
    const sk = transformSkeleton()
    const driver = boneId(sk, 'driver')
    const follower = boneId(sk, 'follower')
    const make = () => {
      const pose = createPose(sk)
      setLocal(pose, driver, CH_ROT, 0.4)
      setLocal(pose, driver, CH_X, 0.3)
      setLocal(pose, follower, CH_ROT, 0.1)
      setLocal(pose, follower, CH_X, 0.2)
      return pose
    }
    const relative = make()
    createConstraintSolver([
      transformOf({ bone: follower, sourceBone: driver, mixRotate: 1, mixX: 1, relative: true }),
    ]).solve(relative, 1 / 60)
    expect(getRotation(relative, follower)).toBeCloseTo(0.5, 6)
    expect(local(relative, follower, CH_X)).toBeCloseTo(0.5, 6)

    const absolute = make()
    createConstraintSolver([
      transformOf({ bone: follower, sourceBone: driver, mixRotate: 1, mixX: 1, relative: false }),
    ]).solve(absolute, 1 / 60)
    expect(getRotation(absolute, follower)).toBeCloseTo(0.4, 6)
    expect(local(absolute, follower, CH_X)).toBeCloseTo(0.3, 6)
  })
})

describe('path parity: 弧长 / 开放 / 闭合 / spacing', () => {
  function pathSkeleton(): CompiledSkeleton {
    return compileSkeleton({
      name: 'path-parity',
      profile: 'full2d',
      bones: [
        mkBone('p0', -1, 0, 0, 0),
        mkBone('p1', -1, 0, 0, 0),
        mkBone('p2', -1, 0, 0, 0),
      ],
    })
  }

  it('开放路径按归一化弧长采样并朝向切线', () => {
    const sk = pathSkeleton()
    const p0 = boneId(sk, 'p0')
    const open = new Float32Array([0, 0, 10, 0, 10, 10])
    const pose = createPose(sk)
    createConstraintSolver([
      pathOf({ bone: p0, points: open, position: 0.75, mixRotate: 1, mixX: 1, mixY: 1 }),
    ]).solve(pose, 1 / 60)
    updateWorld(pose)
    const point = worldPoint(pose, p0)
    expect(point[0]).toBeCloseTo(10, 5)
    expect(point[1]).toBeCloseTo(5, 5)
    expect(worldAngle(pose, p0)).toBeCloseTo(Math.PI / 2, 5)
  })

  it('闭合路径最后一段回到首点，position 接近 1 与 0 几何连续', () => {
    const sk = pathSkeleton()
    const p0 = boneId(sk, 'p0')
    const closed = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10])
    const at = (position: number) => {
      const pose = createPose(sk)
      createConstraintSolver([
        pathOf({ bone: p0, points: closed, closed: true, position, mixRotate: 1, mixX: 1, mixY: 1 }),
      ]).solve(pose, 1 / 60)
      updateWorld(pose)
      return { point: worldPoint(pose, p0), angle: worldAngle(pose, p0) }
    }
    const late = at(0.9)
    expect(late.point[0]).toBeCloseTo(0, 5)
    expect(late.point[1]).toBeCloseTo(4, 5)
    expect(late.angle).toBeCloseTo(-Math.PI / 2, 5)

    const end = at(0.999)
    const start = at(0.001)
    expect(Math.hypot(end.point[0] - start.point[0], end.point[1] - start.point[1])).toBeLessThan(0.1)
  })

  it('spacing 让多骨沿路径分布，段长按实际长度而非顶点数', () => {
    const sk = pathSkeleton()
    const [p0, p1, p2] = ['p0', 'p1', 'p2'].map((n) => boneId(sk, n))
    const pose = createPose(sk)
    createConstraintSolver([
      pathOf({
        bone: p2!, bones: [p0!, p1!, p2!],
        points: new Float32Array([0, 0, 10, 0, 10, 10]),
        position: 0, spacing: 0.25, mixRotate: 0, mixX: 1, mixY: 1,
      }),
    ]).solve(pose, 1 / 60)
    updateWorld(pose)
    expect(worldPoint(pose, p0!)[0]).toBeCloseTo(0, 5)
    expect(worldPoint(pose, p1!)[0]).toBeCloseTo(5, 5)
    expect(worldPoint(pose, p2!)[0]).toBeCloseTo(10, 5)

    const uneven = createPose(sk)
    createConstraintSolver([
      pathOf({
        bone: p0!, points: new Float32Array([0, 0, 5, 0, 15, 0]),
        position: 0.5, mixX: 1, mixY: 1,
      }),
    ]).solve(uneven, 1 / 60)
    updateWorld(uneven)
    expect(worldPoint(uneven, p0!)[0]).toBeCloseTo(7.5, 5)
  })

  it('rotateMix / translateMix 作为 Spine 别名生效', () => {
    const sk = pathSkeleton()
    const p0 = boneId(sk, 'p0')
    const pose = createPose(sk)
    createConstraintSolver([
      pathOf({
        bone: p0,
        points: new Float32Array([0, 0, 0, 10]),
        position: 0,
        mix: 0,
        rotateMix: 1,
        translateMix: 0.5,
      }),
    ]).solve(pose, 1 / 60)
    updateWorld(pose)
    const point = worldPoint(pose, p0)
    expect(point[0]).toBeCloseTo(0, 5)
    expect(point[1]).toBeCloseTo(0, 5)
    expect(worldAngle(pose, p0)).toBeCloseTo(Math.PI / 2, 5)
  })
})

describe('constraint order / dependency / cycle', () => {
  it('写-读依赖按 order 生效：path 先写 a，transform 后读 a', () => {
    const sk = compileSkeleton({
      name: 'order-parity',
      profile: 'full2d',
      bones: [mkBone('a', -1, 0, 0, 0), mkBone('b', -1, 0, 0, 0)],
    })
    const a = boneId(sk, 'a')
    const b = boneId(sk, 'b')
    const make = () => createPose(sk)
    const path: PathConstraint = pathOf({
      id: 'path', bone: a, points: new Float32Array([5, 0, 5, 1]), position: 0, mix: 1,
    })
    const copy: TransformConstraint = transformOf({
      id: 'copy', bone: b, sourceBone: a, mixX: 1,
    })

    const after = make()
    createConstraintSolver([{ ...path, order: 1 }, { ...copy, order: 2 }]).solve(after, 1 / 60)
    expect(local(after, b, CH_X)).toBeCloseTo(5, 6)

    const before = make()
    createConstraintSolver([{ ...copy, order: 1 }, { ...path, order: 2 }]).solve(before, 1 / 60)
    expect(local(before, b, CH_X)).toBe(0)
  })

  it('path / physics 的写-读关系也参与循环检测', () => {
    const sk = compileSkeleton({
      name: 'cycle-parity',
      profile: 'full2d',
      bones: [mkBone('a', -1, 0, 0, 0), mkBone('b', -1, 0, 0, 0)],
    })
    const a = boneId(sk, 'a')
    const b = boneId(sk, 'b')
    const path = pathOf({ id: 'p', bone: a, targetBone: b })
    const copy = transformOf({ id: 't', bone: b, sourceBone: a, mixX: 1 })
    expect(() => createConstraintSolver([path, copy])).toThrow(/cycle/)

    const selfTarget = pathOf({ id: 'p2', bone: a, targetBone: a })
    expect(() => createConstraintSolver([selfTarget])).toThrow(/cycle/)

    const physics = physicsOf({ id: 'ph', bone: b, target: b })
    expect(() => createConstraintSolver([physics])).toThrow(/cycle/)

    const chainSk = compileSkeleton({
      name: 'cycle-ik',
      profile: 'full2d',
      bones: [mkBone('root', -1, 0, 0, 0), mkBone('jointA', 0, 0, 0, 1), mkBone('jointB', 1, 1, 0, 1)],
    })
    const jointA = boneId(chainSk, 'jointA')
    const jointB = boneId(chainSk, 'jointB')
    const solver = createConstraintSolver([
      ikOf({ id: 'ik', bone: jointB, targetBone: jointA, chainLength: 2 }),
    ])
    expect(() => solver.solve(createPose(chainSk), 1 / 60)).toThrow(/cycle/)
  })
})

describe('physics parity: 惯性 / 回稳 / reset / 固定子步', () => {
  function physicsSkeleton(): CompiledSkeleton {
    return compileSkeleton({
      name: 'physics-parity',
      profile: 'full2d',
      bones: [mkBone('base', -1, 0, 0, 0), mkBone('hair', 0, 0.2, 0, 0.2)],
    })
  }

  it('父级阶跃后骨骼滞后，随后回稳到基线', () => {
    const sk = physicsSkeleton()
    const base = boneId(sk, 'base')
    const hair = boneId(sk, 'hair')
    const pose = createPose(sk)
    const c = physicsOf({ bone: hair, inertia: 2, strength: 60, damping: 12 })
    const solver = createConstraintSolver([c])
    solver.solve(pose, 1 / 60)
    setLocal(pose, base, CH_X, 1)
    solver.solve(pose, 1 / 60)
    expect(local(pose, hair, CH_X)).toBeLessThan(0.2)

    for (let frame = 0; frame < 180; frame += 1) solver.solve(pose, 1 / 60)
    expect(Math.abs(local(pose, hair, CH_X) - 0.2)).toBeLessThan(1e-3)
    expect(Math.abs(getRotation(pose, hair))).toBeLessThan(1e-3)
  })

  it('reset 立即撤销累积偏移，当帧不叠加旧值', () => {
    const sk = physicsSkeleton()
    const hair = boneId(sk, 'hair')
    const pose = createPose(sk)
    const c = physicsOf({ bone: hair, wind: 4, strength: 20, damping: 4 })
    const solver = createConstraintSolver([c])
    for (let frame = 0; frame < 40; frame += 1) solver.solve(pose, 1 / 60)
    expect(Math.abs(local(pose, hair, CH_X) - 0.2)).toBeGreaterThan(1e-4)

    const mutable = c as { reset?: boolean }
    mutable.reset = true
    solver.solve(pose, 1 / 60)
    expect(local(pose, hair, CH_X)).toBeCloseTo(0.2, 6)
    expect(getRotation(pose, hair)).toBeCloseTo(0, 6)
  })

  it('固定子步：60×1/60 与 30×1/30 得到相同状态与姿态', () => {
    const sk = physicsSkeleton()
    const hair = boneId(sk, 'hair')
    const c = physicsOf({ bone: hair, wind: 1, strength: 20, damping: 4 })
    const run = (frames: number, dt: number) => {
      const pose = createPose(sk)
      const state = createPhysicsConstraintState()
      for (let i = 0; i < frames; i += 1) stepPhysicsConstraint(pose, c, state, dt)
      return { pose, state }
    }
    const a = run(60, 1 / 60)
    const b = run(30, 1 / 30)
    expect(local(a.pose, hair, CH_X)).toBeCloseTo(local(b.pose, hair, CH_X), 6)
    expect(a.state.offsetX).toBeCloseTo(b.state.offsetX, 6)
    expect(Number.isFinite(a.state.offsetX)).toBe(true)
  })

  it('gravity 驱动 Y 偏移，mix 线性缩放写入量', () => {
    const sk = physicsSkeleton()
    const hair = boneId(sk, 'hair')
    const run = (mix: number, gravity: number, wind: number) => {
      const pose = createPose(sk)
      const state = createPhysicsConstraintState()
      const c = physicsOf({ bone: hair, wind, gravity, mix, strength: 20, damping: 4 })
      for (let frame = 0; frame < 60; frame += 1) stepPhysicsConstraint(pose, c, state, 1 / 60)
      return { pose, state }
    }
    const full = run(1, 0, 1)
    const half = run(0.5, 0, 1)
    expect(local(half.pose, hair, CH_X) - 0.2).toBeCloseTo((local(full.pose, hair, CH_X) - 0.2) * 0.5, 5)
    const falling = run(1, -2, 0)
    expect(local(falling.pose, hair, CH_Y)).toBeLessThan(0)
    expect(Number.isFinite(local(falling.pose, hair, CH_Y))).toBe(true)
  })

  it('resetPhysicsConstraintState 清零所有累积量', () => {
    const state = createPhysicsConstraintState()
    state.offsetX = 1
    state.velocityY = 2
    state.appliedRot = 3
    state.accumulator = 4
    state.initialized = true
    resetPhysicsConstraintState(state)
    expect(state.offsetX).toBe(0)
    expect(state.velocityY).toBe(0)
    expect(state.appliedRot).toBe(0)
    expect(state.accumulator).toBe(0)
    expect(state.initialized).toBe(false)
  })
})

describe('constraint stack: 只写允许通道并刷新世界', () => {
  it('每条约束解完立即 updateWorld，后续约束读到最新姿态', () => {
    const sk = compileSkeleton({
      name: 'refresh-parity',
      profile: 'full2d',
      bones: [mkBone('a', -1, 0, 0, 0), mkBone('b', -1, 0, 0, 0)],
    })
    const a = boneId(sk, 'a')
    const b = boneId(sk, 'b')
    const pose = createPose(sk)
    const constraints: ConstraintData[] = [
      pathOf({ id: 'p', bone: a, points: new Float32Array([3, 0, 3, 1]), position: 0, mix: 1, order: 1 }),
      transformOf({ id: 't', bone: b, sourceBone: a, mixX: 1, order: 2 }),
    ]
    createConstraintSolver(constraints).solve(pose, 1 / 60)
    expect(local(pose, b, CH_X)).toBeCloseTo(3, 6)
    for (const v of pose.local) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('constraint timeline mix override', () => {
  it('uses the timeline mix instead of the setup weight', () => {
    const sk = compileSkeleton({
      name: 'mix', profile: 'simple2d',
      bones: [
        { name: 'root', parent: -1, length: 1 },
        { name: 'arm', parent: 0, length: 1 },
      ],
    })
    const pose = createPose(sk)
    setLocal(pose, 1, CH_ROT, 1)
    const solver = createConstraintSolver([{
      kind: 'transform', id: 'c', bone: 0, weight: 1, enabled: true, order: 0,
      sourceBone: 1, mixRotation: 1, mixTranslation: 0,
    }])
    solver.solve(pose, 1 / 60, new Map([['c', 0]]))
    expect(getLocal(pose, 0, CH_ROT)).toBeCloseTo(0, 6)
    solver.solve(pose, 1 / 60, new Map([['c', 1]]))
    expect(getLocal(pose, 0, CH_ROT)).toBeCloseTo(1, 6)
  })
})
