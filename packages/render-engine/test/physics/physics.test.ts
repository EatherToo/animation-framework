/**
 * M14 二级物理单元测试。
 * 权威：docs/07-约束/physics.md §2–§14。
 *
 * 约定：
 * - 所有用例都用固定 dt 与固定子步，不依赖真实时间（§13 第 16 条）。
 * - 断言只依赖位置与几何，不依赖内部迭代顺序。
 */
import { describe, expect, it } from '@jest/globals'
import {
  createParticleChain,
  createSkirt,
  createStrand,
  restoreWorld,
  snapshotWorld,
  stepWorld,
  strandBoneRotations,
  validatePhysicsWorld,
  type Collider,
  type PhysicsWorld,
  type Skirt,
  type Strand,
} from '@/physics/physics'

const DT = 1 / 120

/** 构造点元组的简写，避免 number[][] 推不出元组类型。 */
const P = (x: number, y: number): [number, number] => [x, y]

/** 竖直向下的链：根在 (0,0)，每段 spacing 米。 */
function verticalChain(n: number, spacing = 0.1, options: Parameters<typeof createParticleChain>[1] = {}): Strand {
  const points: [number, number][] = []
  for (let i = 0; i < n; i += 1) points.push(P(0, i * spacing))
  return createParticleChain(points, options)
}

/** 默认世界：无重力、无风、无碰撞，便于隔离被测行为。 */
function makeWorld(partial: Partial<PhysicsWorld> = {}): PhysicsWorld {
  return {
    strands: partial.strands ?? [],
    skirts: partial.skirts ?? [],
    colliders: partial.colliders ?? [],
    gravity: partial.gravity ?? [0, 0],
    wind: partial.wind ?? [0, 0],
    damping: partial.damping ?? 1,
    iterations: partial.iterations ?? 8,
    fixedDt: partial.fixedDt ?? DT,
    maxSubSteps: partial.maxSubSteps ?? 4,
  }
}

/** 有符号转向角：seg(a→b) 到 seg(b→c) 的夹角，逆时针为正。 */
function turnAngle(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  const ax = b.x - a.x
  const ay = b.y - a.y
  const bx = c.x - b.x
  const by = c.y - b.y
  return Math.atan2(ax * by - ay * bx, ax * bx + ay * by)
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** 把所有粒子坐标压平，便于做逐位比较。 */
function flatten(strands: readonly Strand[]): number[] {
  const out: number[] = []
  for (const strand of strands) {
    for (const p of strand.particles) out.push(p.x, p.y, p.px, p.py)
  }
  return out
}

describe('physics: 固定步长与确定性', () => {
  it('1/30 秒帧按 1/120 固定步长推进 4 个子步', () => {
    const world = makeWorld({ strands: [verticalChain(3)] })
    const result = stepWorld(world, 1 / 30)
    expect(result.substeps).toBe(4)
    expect(result.accumulator).toBeLessThan(DT)
    expect(result.particles).toBe(3)
  })

  it('超长帧被 maxSubSteps 截断，累加器不会无限增长', () => {
    const state = { accumulator: 0 }
    const world = makeWorld({ strands: [verticalChain(3)], maxSubSteps: 4 })
    const result = stepWorld(world, 0.5, state)
    expect(result.substeps).toBe(4)
    expect(result.accumulator).toBeLessThan(DT)
    expect(state.accumulator).toBe(result.accumulator)
  })

  it('不足一个子步的时间只累积、不推进', () => {
    const state = { accumulator: 0 }
    const world = makeWorld({ strands: [verticalChain(3)] })
    const result = stepWorld(world, DT / 2, state)
    expect(result.substeps).toBe(0)
    expect(result.accumulator).toBeCloseTo(DT / 2, 12)
  })

  it('同初值、同 dt 序列按位确定', () => {
    const a = makeWorld({
      strands: [verticalChain(6, 0.1, { damping: 0.97, bendStiffness: 0.2 })],
      gravity: [0, -9.8],
      wind: [0.7, 0.2],
    })
    const b = makeWorld({
      strands: [verticalChain(6, 0.1, { damping: 0.97, bendStiffness: 0.2 })],
      gravity: [0, -9.8],
      wind: [0.7, 0.2],
    })
    for (let i = 0; i < 60; i += 1) {
      stepWorld(a, 1 / 60)
      stepWorld(b, 1 / 60)
    }
    expect(flatten(a.strands)).toEqual(flatten(b.strands))
  })
})

describe('physics: 钉根与距离约束', () => {
  it('invMass=0 的根在重力下按位不动', () => {
    const strand = verticalChain(5)
    const world = makeWorld({ strands: [strand], gravity: [0, -9.8] })
    for (let i = 0; i < 120; i += 1) stepWorld(world, 1 / 60)
    const root = strand.particles[0]!
    expect(root.invMass).toBe(0)
    expect(root.x).toBe(0)
    expect(root.y).toBe(0)
    expect(root.px).toBe(0)
    expect(root.py).toBe(0)
  })

  it('段长在重力摆动后仍保持（相对误差 ≤ 1e-3）', () => {
    const strand = verticalChain(8, 0.12)
    const world = makeWorld({ strands: [strand], gravity: [0, -9.8], wind: [1.2, 0.4] })
    for (let i = 0; i < 180; i += 1) stepWorld(world, 1 / 60)
    for (let i = 1; i < strand.particles.length; i += 1) {
      const measured = distance(strand.particles[i - 1]!, strand.particles[i]!)
      const rest = strand.restLengths[i - 1]!
      expect(Math.abs(measured - rest) / rest).toBeLessThanOrEqual(1e-3)
    }
  })

  it('弯曲约束把偏离的夹角拉回静止角', () => {
    const strand = createStrand('bend', [P(0, 0), P(0, 1), P(1.2, 2)], {
      stiffness: 1,
      damping: 1,
      bendStiffness: 0.9,
      restAngles: [0],
    })
    const before = Math.abs(turnAngle(strand.particles[0]!, strand.particles[1]!, strand.particles[2]!))
    const world = makeWorld({ strands: [strand], gravity: [0, 0], damping: 1 })
    for (let i = 0; i < 12; i += 1) stepWorld(world, DT)
    const after = Math.abs(turnAngle(strand.particles[0]!, strand.particles[1]!, strand.particles[2]!))
    expect(before).toBeGreaterThan(0.5)
    expect(after).toBeLessThan(before * 0.5)
  })
})

describe('physics: 裙摆环向约束', () => {
  it('环向 link 把被拉开的相邻垂链拉回静止距离', () => {
    const left = createStrand('left', [P(0, 0), P(0, 0.2), P(0, 0.4)], { stiffness: 1, damping: 1 })
    const right = createStrand('right', [P(0.3, 0), P(0.3, 0.2), P(0.3, 0.4)], { stiffness: 1, damping: 1 })
    const skirt = createSkirt('skirt', [left, right], [{ a: 1, b: 4, rest: 0.3, stiffness: 0.9 }], 0.3, true)
    // 人为把右侧中段拉远，验证环向约束回拉。
    right.particles[1]!.x = 1.3
    const initial = distance(left.particles[1]!, right.particles[1]!)
    const world = makeWorld({ skirts: [skirt], gravity: [0, 0], damping: 1 })
    for (let i = 0; i < 40; i += 1) stepWorld(world, DT)
    const final = distance(left.particles[1]!, right.particles[1]!)
    expect(initial).toBeGreaterThan(1)
    expect(final).toBeLessThan(initial * 0.5)
    expect(Math.abs(final - 0.3)).toBeLessThan(0.1)
  })
})

describe('physics: 碰撞投影', () => {
  /** 单粒子链，根可动，方便只观察碰撞。 */
  function singleAt(x: number, y: number): Strand {
    return createParticleChain([P(x, y)], { rootInvMass: 1, damping: 1 })
  }

  it('圆碰撞把粒子推到半径外并标记 hit', () => {
    const strand = singleAt(0.2, 0)
    const collider: Collider = { kind: 'circle', x: 0, y: 0, radius: 1 }
    const world = makeWorld({ strands: [strand], colliders: [collider] })
    stepWorld(world, DT)
    const p = strand.particles[0]!
    expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(1 - 1e-9)
    expect(p.hit).toBe(true)
  })

  it('胶囊碰撞把粒子推到轴线半径外', () => {
    const strand = singleAt(0, 0.1)
    const collider: Collider = { kind: 'capsule', ax: -1, ay: 0, bx: 1, by: 0, radius: 0.5 }
    const world = makeWorld({ strands: [strand], colliders: [collider] })
    stepWorld(world, DT)
    const p = strand.particles[0]!
    expect(Math.abs(p.y)).toBeGreaterThanOrEqual(0.5 - 1e-9)
    expect(p.hit).toBe(true)
  })

  it('凸多边形碰撞把内部粒子推到边界外且不穿透', () => {
    const square = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1])
    const collider: Collider = { kind: 'convex', points: square }

    /** CCW 多边形：取各边「内侧深度」的最小值；>0 表示点仍在多边形内部。 */
    const deepestInside = (x: number, y: number): number => {
      let shallowest = Infinity
      for (let i = 0; i < square.length; i += 2) {
        const ax = square[i]!
        const ay = square[i + 1]!
        const bx = square[(i + 2) % square.length]!
        const by = square[(i + 3) % square.length]!
        const dx = bx - ax
        const dy = by - ay
        const len = Math.hypot(dx, dy)
        const nx = dy / len
        const ny = -dx / len
        shallowest = Math.min(shallowest, -(nx * (x - ax) + ny * (y - ay)))
      }
      return shallowest
    }

    const strand = singleAt(0.2, 0.1)
    const world = makeWorld({ strands: [strand], colliders: [collider] })
    for (let i = 0; i < 8; i += 1) stepWorld(world, DT)
    const p = strand.particles[0]!
    expect(deepestInside(p.x, p.y)).toBeLessThanOrEqual(1e-6)
    expect(p.hit).toBe(true)
  })

  it('碰撞后的法向速度不再指向碰撞体内部', () => {
    const strand = singleAt(0.2, 0)
    const world = makeWorld({
      strands: [strand],
      colliders: [{ kind: 'circle', x: 0, y: 0, radius: 1 }],
      gravity: [0, 0],
    })
    stepWorld(world, DT)
    const p = strand.particles[0]!
    const nx = p.x
    const ny = p.y
    const vn = (p.x - p.px) * nx + (p.y - p.py) * ny
    expect(vn).toBeGreaterThanOrEqual(-1e-9)
  })
})

describe('physics: 数值保护与快照', () => {
  it('注入 NaN 后回退到上一有效位置并继续运行', () => {
    const strand = verticalChain(4, 0.1, { damping: 0.98 })
    const world = makeWorld({ strands: [strand], gravity: [0, -9.8] })
    for (let i = 0; i < 20; i += 1) stepWorld(world, 1 / 60)
    const p = strand.particles[2]!
    const lastX = p.px
    const lastY = p.py
    p.x = Number.NaN
    p.y = Number.NaN
    stepWorld(world, 1 / 60)
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
    expect(p.x).toBe(lastX)
    expect(p.y).toBe(lastY)
  })

  it('快照 round-trip 恢复全部 x/y/px/py', () => {
    const strands = [verticalChain(4), verticalChain(3, 0.05)]
    const left = createStrand('a', [P(0, 0), P(0, 0.2)], {})
    const right = createStrand('b', [P(0.2, 0), P(0.2, 0.2)], {})
    const skirt = createSkirt('s', [left, right], [{ a: 1, b: 3, rest: 0.2, stiffness: 0.5 }], 0.2, true)
    const world = makeWorld({ strands, skirts: [skirt], gravity: [0, -9.8] })
    for (let i = 0; i < 30; i += 1) stepWorld(world, 1 / 60)

    const snap = snapshotWorld(world.strands, world.skirts)
    const expected = flatten([...world.strands, ...world.skirts.flatMap((s) => s.strands)])
    for (const strand of world.strands) strand.particles[1]!.x += 5
    for (const s of world.skirts) for (const strand of s.strands) strand.particles[1]!.y += 5

    expect(restoreWorld(world.strands, world.skirts, snap)).toBe(true)
    // 快照布局是 Float32Array（§9.3），round-trip 只保证 Float32 精度。
    const restored = flatten([...world.strands, ...world.skirts.flatMap((s) => s.strands)])
    for (let i = 0; i < restored.length; i += 1) {
      expect(restored[i]!).toBeCloseTo(expected[i]!, 6)
    }
  })

  it('尺寸不符的快照返回 false 且不改动世界', () => {
    const strand = verticalChain(3)
    const world = makeWorld({ strands: [strand] })
    stepWorld(world, DT)
    const before = flatten(world.strands)
    const bad = { strands: [new Float32Array(3)], skirts: [] }
    expect(restoreWorld(world.strands, world.skirts, bad)).toBe(false)
    expect(flatten(world.strands)).toEqual(before)
  })

  it('strandBoneRotations 返回每段方向角', () => {
    const strand = createStrand('rot', [P(0, 0), P(0, 1), P(1, 1)], {})
    const rotations = strandBoneRotations(strand)
    expect(rotations).toHaveLength(2)
    expect(rotations[0]).toBeCloseTo(Math.PI / 2, 12)
    expect(rotations[1]).toBeCloseTo(0, 12)
  })

  it('validatePhysicsWorld 接受合法世界并报告非法配置', () => {
    const valid = makeWorld({ strands: [verticalChain(4)] })
    expect(validatePhysicsWorld(valid)).toEqual([])

    const validStrand = verticalChain(3)
    const badStrand: Strand = { ...validStrand, restLengths: [] }
    const badSkirt: Skirt = createSkirt(
      'bad',
      [createStrand('x', [P(0, 0), P(0, 0.1)], {}), createStrand('y', [P(0.1, 0), P(0.1, 0.1)], {})],
      [{ a: 0, b: 99, rest: 0.1, stiffness: 1 }],
      0.1,
      true,
    )
    const bad = makeWorld({
      strands: [badStrand],
      skirts: [badSkirt],
      gravity: [Number.NaN, 0],
      fixedDt: 0,
      maxSubSteps: 0,
    })
    const errors = validatePhysicsWorld(bad)
    expect(errors.length).toBeGreaterThan(0)
  })
})
