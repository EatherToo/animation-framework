import { describe, expect, it } from '@jest/globals'
import { compileSkeleton, type BoneSpec, type CompiledSkeleton, type JointSpec } from '@/core/skeleton'
import { createPose, getRotation, setLocal, updateWorld, type Pose } from '@/core/pose'
import { CH_ROT, CH_SHX, CH_SHY, CH_X, CH_Y, POSE_STRIDE } from '@/core/math'
import {
  createConstraintSolver,
  createPhysicsState,
  solveIk,
  stepPhysics,
  type IkConstraint,
  type PathConstraint,
  type PhysicsChain,
  type TransformConstraint,
} from '@/constraint/constraint'

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

  it('4.3 local transform 属性从源 X 映射到目标 Y 并按区间裁剪', () => {
    const sk = armSkeleton()
    const [upper, lower] = ids(sk, 'upper', 'lower')
    const pose = createPose(sk)
    setLocal(pose, upper!, CH_X, 0.7)
    createConstraintSolver([{
      id: 'mapped', kind: 'transform', bone: lower!, sourceBone: upper!,
      weight: 1, enabled: true, order: 0, localSource: true, localTarget: true,
      clamp: true, mixRotate: 0, mixX: 0, mixY: 0.5,
      offsets: [0, 0.1, 0, 0, 0, 0],
      properties: [{ kind: 'x', offset: 0.2, to: [
        { kind: 'y', offset: 0.4, max: 1, scale: 2 },
      ] }],
    }]).solve(pose, 1 / 60)
    // (0.7 + 0.1 - 0.2) * 2 + 0.4 = 1.6; clamp to 1 then mix by 0.5.
    expect(pose.local[lower! * POSE_STRIDE + CH_Y]).toBeCloseTo(0.5, 6)
  })

  it('4.3 From X -> To Y matches official world/local source and target formulas for two bones', () => {
    const sk = compileSkeleton({ name: 'mapping', profile: 'full2d', bones: [
      mkBone('root', -1, 0, 0, 0),
      mkBone('source', 0, 2, 3, 0),
      mkBone('a', 0, -1, 2, 0),
      mkBone('b', 0, 4, -2, 0),
    ] })
    const [source, a, b] = ids(sk, 'source', 'a', 'b')
    for (const localSource of [false, true]) for (const localTarget of [false, true]) {
      const pose = createPose(sk)
      setLocal(pose, source!, CH_ROT, Math.PI / 2)
      setLocal(pose, source!, CH_X, 2)
      setLocal(pose, source!, CH_Y, 3)
      updateWorld(pose)
      const original = [a!, b!].map((bone) => ({ localY: pose.local[bone * POSE_STRIDE + CH_Y]!, worldY: pose.world[bone * 6 + 5]! }))
      // Official FromX: local x + offsetX; world: a*offsetX + b*offsetY + worldX.
      const sourceValue = localSource ? 2 + 0.4 : 2 - 0.7
      const mapped = 0.5 + (sourceValue - 0.2) * 1.5
      const mix = -0.4
      createConstraintSolver([{ id: 'mapped', kind: 'transform', bone: a!, bones: [a!, b!], sourceBone: source!,
        weight: 0.8, enabled: true, order: 0, localSource, localTarget, mixRotate: 0, mixX: 0, mixY: -0.5,
        offsets: [0, 0.4, 0.7, 0, 0, 0], properties: [{ kind: 'x', offset: 0.2, to: [
          { kind: 'y', offset: 0.5, max: 10, scale: 1.5 },
        ] }],
      }]).solve(pose, 0)
      updateWorld(pose)
      for (const [index, bone] of [a!, b!].entries()) {
        const prior = original[index]!
        const expected = localTarget ? prior.localY + (mapped - prior.localY) * mix : prior.worldY + (mapped - prior.worldY) * mix
        expect((localTarget ? pose.local[bone * POSE_STRIDE + CH_Y] : pose.world[bone * 6 + 5])!).toBeCloseTo(expected, 5)
      }
    }
  })

  it('4.3 world To rotation, scale and shear use matrix-column semantics with additive and clamp', () => {
    const sk = compileSkeleton({ name: 'matrix', profile: 'full2d', bones: [
      mkBone('root', -1, 0, 0, 0), mkBone('source', 0, 2, 0, 0), mkBone('target', 0, 0, 0, 0),
    ] })
    const [source, target] = ids(sk, 'source', 'target')
    const pose = createPose(sk)
    setLocal(pose, source!, CH_X, 2)
    createConstraintSolver([{ id: 'world', kind: 'transform', bone: target!, sourceBone: source!,
      weight: 1, enabled: true, order: 0, localSource: true, localTarget: false,
      additive: true, clamp: true, mixRotate: 0.5, mixX: 0, mixY: 0, mixScaleX: -0.25, mixScaleY: 0.5, mixShearY: 0.5,
      properties: [{ kind: 'x', offset: 0, to: [
        { kind: 'rotate', offset: Math.PI / 2, max: Math.PI / 2, scale: 1 },
        { kind: 'scaleX', offset: 3, max: 3, scale: 1 },
        { kind: 'scaleY', offset: 3, max: 3, scale: 1 },
        { kind: 'shearY', offset: Math.PI / 2, max: Math.PI / 2, scale: 1 },
      ] }],
    }]).solve(pose, 0)
    updateWorld(pose)
    const o = target! * 6
    // Official ToRotate turns columns by pi/4; ToScaleX factor 0.5, ToScaleY factor 2;
    // ToShearY then turns the Y column by pi/4 while preserving its length.
    expect(pose.world[o]!).toBeCloseTo(Math.SQRT1_2 * 0.5, 5)
    expect(pose.world[o + 1]!).toBeCloseTo(Math.SQRT1_2 * 0.5, 5)
    expect(pose.world[o + 2]!).toBeCloseTo(-2, 5)
    expect(pose.world[o + 3]!).toBeCloseTo(0, 5)
  })

  it('world ToShearY factors into angular shear without changing shearX', () => {
    const sk = compileSkeleton({ name: 'angular-shear', profile: 'full2d', bones: [
      mkBone('root', -1, 0, 0, 0), mkBone('source', 0, 0, 0, 0), mkBone('target', 0, 0, 0, 0),
    ] })
    const [source, target] = ids(sk, 'source', 'target')
    const pose = createPose(sk)
    setLocal(pose, target!, CH_SHX, 0.2)
    createConstraintSolver([{ id: 'shear', kind: 'transform', bone: target!, sourceBone: source!,
      weight: 1, enabled: true, order: 0, localSource: true, localTarget: false,
      mixRotate: 0, mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 1,
      properties: [{ kind: 'x', offset: 0, to: [
        { kind: 'shearY', offset: 0.5, max: 1, scale: 1 },
      ] }],
    }]).solve(pose, 0)
    updateWorld(pose)
    const o = target! * 6
    expect(pose.local[target! * POSE_STRIDE + CH_SHX]!).toBeCloseTo(0.2, 6)
    expect(pose.local[target! * POSE_STRIDE + CH_SHY]!).toBeCloseTo(0.7, 5)
    expect(pose.world[o]!).toBeCloseTo(Math.cos(0.2), 5)
    expect(pose.world[o + 1]!).toBeCloseTo(Math.sin(0.2), 5)
    expect(pose.world[o + 2]!).toBeCloseTo(-Math.sin(0.7), 5)
    expect(pose.world[o + 3]!).toBeCloseTo(Math.cos(0.7), 5)
  })

  it('4.3 world mapping survives rotated nonuniform parent and zero world X scale', () => {
    const sk = compileSkeleton({ name: 'parent', profile: 'full2d', bones: [
      mkBone('root', -1, 0, 0, 0), mkBone('source', 0, 2, 3, 0), mkBone('target', 0, 1, -2, 0),
    ] })
    const [root, source, target] = ids(sk, 'root', 'source', 'target')
    const pose = createPose(sk)
    setLocal(pose, root!, CH_ROT, Math.PI / 2)
    setLocal(pose, root!, 3, 2)
    setLocal(pose, root!, 4, 3)
    updateWorld(pose)
    const sourceX = pose.world[source! * 6 + 4]!
    createConstraintSolver([{ id: 'world', kind: 'transform', bone: target!, sourceBone: source!,
      weight: 1, enabled: true, order: 0, localSource: false, localTarget: false,
      mixRotate: 0, mixX: 1, mixY: 0, mixScaleX: 1,
      properties: [
        { kind: 'x', offset: 0, to: [{ kind: 'x', offset: 0, max: 0, scale: 1 }] },
        { kind: 'scaleX', offset: 0, to: [{ kind: 'scaleX', offset: 0, max: 0, scale: 0 }] },
      ],
    }]).solve(pose, 0)
    updateWorld(pose)
    expect(pose.world[target! * 6 + 4]!).toBeCloseTo(sourceX, 5)
    expect(pose.world[target! * 6]!).toBeCloseTo(0, 5)
    expect(pose.world[target! * 6 + 1]!).toBeCloseTo(0, 5)
    expect(pose.local[target! * POSE_STRIDE + 3]).toBe(0)
  })

  it('4.3 local ToRotate interpolates raw angles, including a branch crossing', () => {
    const sk = armSkeleton()
    const [upper, lower] = ids(sk, 'upper', 'lower')
    const pose = createPose(sk)
    setLocal(pose, upper!, CH_ROT, 3)
    setLocal(pose, lower!, CH_ROT, -3)
    createConstraintSolver([{ id: 'local', kind: 'transform', bone: lower!, sourceBone: upper!,
      weight: 1, enabled: true, order: 0, localSource: true, localTarget: true,
      mixRotate: 0.5, properties: [{ kind: 'rotate', offset: 0, to: [
        { kind: 'rotate', offset: 0, max: 0, scale: 1 },
      ] }],
    }]).solve(pose, 0)
    expect(getRotation(pose, lower!)).toBeCloseTo(0, 6)
  })

  it('legacy absolute-world zero mixes leave world matrices untouched', () => {
    const sk = armSkeleton()
    const [upper, lower] = ids(sk, 'upper', 'lower')
    const pose = createPose(sk)
    setLocal(pose, upper!, CH_ROT, 0.3)
    updateWorld(pose)
    const before = Array.from(pose.world)
    createConstraintSolver([{ id: 'noop', kind: 'transform', bone: lower!, sourceBone: upper!,
      weight: 1, enabled: true, order: 0, local: false, relative: false,
      mixRotate: 0, mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0,
    }]).solve(pose, 0)
    expect(Array.from(pose.world)).toEqual(before)
  })

  it('legacy absolute-world translation uses target local offsets and signed mixes', () => {
    const sk = compileSkeleton({ name: 'world-offset', profile: 'full2d', bones: [
      mkBone('root', -1, 0, 0, 0), mkBone('source', 0, 2, 3, 0), mkBone('target', 0, 1, -2, 0),
    ] })
    const [root, source, target] = ids(sk, 'root', 'source', 'target')
    const pose = createPose(sk)
    setLocal(pose, root!, CH_ROT, Math.PI / 2)
    updateWorld(pose)
    const sourceOffset = source! * 6
    const targetOffset = target! * 6
    const goalX = pose.world[sourceOffset]! * 0.4 + pose.world[sourceOffset + 2]! * -0.2
      + pose.world[sourceOffset + 4]!
    const goalY = pose.world[sourceOffset + 1]! * 0.4 + pose.world[sourceOffset + 3]! * -0.2
      + pose.world[sourceOffset + 5]!
    const beforeX = pose.world[targetOffset + 4]!
    const beforeY = pose.world[targetOffset + 5]!
    createConstraintSolver([{ id: 'world-signed', kind: 'transform', bone: target!, sourceBone: source!,
      weight: 1, enabled: true, order: 0, local: false, relative: false,
      offsetX: 0.4, offsetY: -0.2, mixRotate: 0, mixX: -1, mixY: -0.5,
    }]).solve(pose, 0)
    updateWorld(pose)
    expect(pose.world[targetOffset + 4]).toBeCloseTo(beforeX - (goalX - beforeX), 6)
    expect(pose.world[targetOffset + 5]).toBeCloseTo(beforeY - (goalY - beforeY) * 0.5, 6)
  })

  it('transform 负 mix 按有符号比例远离目标', () => {
    const sk = armSkeleton()
    const [upper, lower] = ids(sk, 'upper', 'lower')
    const make = () => {
      const pose = createPose(sk)
      setLocal(pose, upper!, CH_X, 0.7)
      return pose
    }
    const base: TransformConstraint = {
      id: 'signed', kind: 'transform', bone: lower!, sourceBone: upper!,
      weight: 1, enabled: true, order: 0, mixRotate: 0, mixX: 1, mixY: 0,
    }
    const positive = make()
    const negative = make()
    const setupX = negative.local[lower! * POSE_STRIDE + CH_X]!
    createConstraintSolver([base]).solve(positive, 1 / 60)
    createConstraintSolver([{ ...base, mixX: -0.5 }]).solve(negative, 1 / 60)
    const targetX = positive.local[lower! * POSE_STRIDE + CH_X]!
    expect(negative.local[lower! * POSE_STRIDE + CH_X]).toBeCloseTo(setupX - (targetX - setupX) * 0.5, 6)
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

  it('Spine one-bone IK aims in parent space and applies mix to local rotation', () => {
    const sk = armSkeleton()
    const [upper, target] = ids(sk, 'upper', 'target')
    const full = armPose(sk)
    const half = armPose(sk)
    solveIk(full, ikOf({ bone: upper!, targetBone: target!, chainLength: 1, spine: true }))
    solveIk(half, ikOf({ bone: upper!, targetBone: target!, chainLength: 1, spine: true, mix: 0.5 }))
    const aim = Math.atan2(0.8, 1.2)
    expect(getRotation(full, upper!)).toBeCloseTo(aim, 6)
    expect(getRotation(half, upper!)).toBeCloseTo(aim / 2, 6)
  })

  it('Spine two-bone IK follows bend direction with exact parent-space angles', () => {
    const sk = armSkeleton()
    const [upper, lower, target] = ids(sk, 'upper', 'lower', 'target')
    const pose = armPose(sk)
    solveIk(pose, ikOf({ bone: lower!, targetBone: target!, spine: true, bendSign: -1 }))
    const knee = -Math.acos((1.2 * 1.2 + 0.8 * 0.8 - 2) / 2)
    const shoulder = Math.atan2(0.8, 1.2) - Math.atan2(Math.sin(knee), 1 + Math.cos(knee))
    expect(getRotation(pose, upper!)).toBeCloseTo(shoulder, 5)
    expect(getRotation(pose, lower!)).toBeCloseTo(knee, 5)
    expect(tipResidual(pose, lower!, target!)).toBeLessThan(1e-5)
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

describe('Spine weighted path constraint', () => {
  it('samples a constant-speed cubic, preserves applied local channels, and scales the chain', () => {
    const sk = compileSkeleton({ name: 'path', profile: 'full2d', bones: [
      mkBone('root', -1, 0, 0, 0),
      mkBone('first', 0, 0, 0.4, 0.5),
      mkBone('second', 1, 0.5, 0, 0.5),
    ] })
    const pose = createPose(sk)
    updateWorld(pose)
    const [root, first, second] = ids(sk, 'root', 'first', 'second')
    const before = Array.from(pose.local)
    const vertices = [-1, 0, 0, 0, 1 / 3, 0, 2 / 3, 0, 1, 0, 2, 0]
    const constraint: PathConstraint = {
      id: 'curve', kind: 'path', bone: second!, bones: [first!, second!], targetBone: root!,
      enabled: true, order: 0, weight: 1, mix: 1, points: new Float32Array([0, 0, 1, 0]),
      mixRotate: 1, mixX: 1, mixY: 1, spacing: 0.5,
      positionMode: 'percent', spacingMode: 'percent', rotateMode: 'chainScale',
      spinePath: { closed: false, constantSpeed: true, lengths: new Float32Array([1]),
        vertices: Array.from({ length: 6 }, (_, i) => [{ bone: root!, x: vertices[i * 2]!, y: vertices[i * 2 + 1]!, weight: 1 }]) },
    }
    createConstraintSolver([constraint]).solve(pose, 0)
    expect(Array.from(pose.local)).toEqual(before)
    expect(pose.world[first! * 6 + 4]).toBeCloseTo(0, 6)
    expect(pose.world[first! * 6 + 5]).toBeCloseTo(0, 6)
    expect(pose.world[second! * 6 + 4]).toBeCloseTo(0.5, 6)
    expect(pose.world[first! * 6]).toBeCloseTo(1, 6)
    expect(pose.world[second! * 6]).toBeCloseTo(1, 6)
    updateWorld(pose)
    expect(pose.world[second! * 6 + 4]).toBeCloseTo(0.5, 6)
  })
})

describe('IK dls：阻尼最小二乘', () => {
  it('四节链在迭代预算内收敛且保持有限残差', () => {
    const sk = compileSkeleton({
      name: 'dls', profile: 'full2d',
      bones: [
        ...Array.from({ length: 5 }, (_, i) => ({
          name: i === 0 ? 'root' : `b${i}`,
          parent: i - 1,
          length: 0.5,
          rest: { x: i === 0 ? 0 : 0.5, y: 0, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 },
        })),
        { name: 'target', parent: 0, length: 0, rest: { x: 1.1, y: 0.9, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0 } },
      ],
    })
    const pose = createPose(sk)
    updateWorld(pose)
    const target = sk.boneIdByName.get('target')!
    updateWorld(pose)
    const result = solveIk(pose, {
      id: 'dls', kind: 'ik', bone: 4, weight: 1, enabled: true, order: 0,
      targetBone: target, chainLength: 4, method: 'dls', maxIterations: 60,
      tolerance: 1e-3, bendSign: 1,
    })
    expect(result.reason).toBe('ok')
    expect(result.reached).toBe(true)
    expect(result.residual).toBeLessThan(1e-3)
    expect(result.iterations).toBeLessThanOrEqual(60)
  })
})
