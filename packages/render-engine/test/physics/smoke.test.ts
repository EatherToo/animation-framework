/**
 * M14 烟雾测试：一条 8 节头发在重力 + 风下 120 帧不飞散；
 * 8 条裙链 120 帧不穿透圆形腿碰撞体。
 * 权威：docs/07-约束/physics.md §14.1 P1/P6/P7。
 */
import { describe, expect, it } from '@jest/globals'
import {
  createParticleChain,
  createSkirt,
  createStrand,
  stepWorld,
  type PhysicsWorld,
  type RingLink,
  type Strand,
} from '@/physics/physics'

const FRAMES = 120
const FRAME_DT = 1 / 60

const P = (x: number, y: number): [number, number] => [x, y]

function world(partial: Partial<PhysicsWorld>): PhysicsWorld {
  return {
    strands: partial.strands ?? [],
    skirts: partial.skirts ?? [],
    colliders: partial.colliders ?? [],
    gravity: partial.gravity ?? [0, 0],
    wind: partial.wind ?? [0, 0],
    damping: partial.damping ?? 1,
    iterations: partial.iterations ?? 8,
    fixedDt: partial.fixedDt ?? 1 / 120,
    maxSubSteps: partial.maxSubSteps ?? 4,
  }
}

describe('M14 smoke: 头发与裙摆稳定性', () => {
  it('8 节头发在重力+风下 120 帧稳定、有限、不飞散', () => {
    const points: [number, number][] = []
    for (let i = 0; i < 8; i += 1) points.push(P(0, 1 - i * 0.1))
    const hair = createParticleChain(points, {
      rootInvMass: 0,
      damping: 0.97,
      stiffness: 1,
      bendStiffness: 0.25,
    })
    const w = world({
      strands: [hair],
      gravity: [0, -9.8],
      wind: [1.4, 0.6],
      iterations: 8,
    })

    for (let frame = 0; frame < FRAMES; frame += 1) stepWorld(w, FRAME_DT)

    const root = hair.particles[0]!
    expect(root.x).toBe(0)
    expect(root.y).toBe(1)
    const maxReach = hair.restLengths.reduce((sum, value) => sum + value, 0) + 0.3
    for (const p of hair.particles) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
      expect(Math.hypot(p.x - root.x, p.y - root.y)).toBeLessThanOrEqual(maxReach)
    }
    // 段长整体没有超弹性。
    let total = 0
    for (let i = 1; i < hair.particles.length; i += 1) {
      total += Math.hypot(
        hair.particles[i]!.x - hair.particles[i - 1]!.x,
        hair.particles[i]!.y - hair.particles[i - 1]!.y,
      )
    }
    const restTotal = hair.restLengths.reduce((sum, value) => sum + value, 0)
    expect(total).toBeLessThanOrEqual(restTotal * 1.2)
  })

  it('8 条裙链在圆形腿碰撞体上 120 帧无穿透', () => {
    const chainCount = 8
    const levels = 4
    const waistRadius = 0.3
    const spacing = 0.18
    const strands: Strand[] = []
    for (let s = 0; s < chainCount; s += 1) {
      const angle = (s / chainCount) * Math.PI * 2
      const x = Math.cos(angle) * waistRadius
      const z = Math.sin(angle) * waistRadius
      const points: [number, number][] = []
      for (let level = 0; level < levels; level += 1) points.push(P(x, 2 - level * spacing))
      strands.push(createParticleChain(points, { rootInvMass: 0, damping: 0.98, stiffness: 1 }))
    }

    // 相邻垂链在等高粒子之间加环向约束（全局展平下标）。
    const ringLinks: RingLink[] = []
    const ringRest = 2 * waistRadius * Math.sin(Math.PI / chainCount)
    for (let s = 0; s < chainCount; s += 1) {
      const next = (s + 1) % chainCount
      for (let level = 1; level < levels; level += 1) {
        ringLinks.push({
          a: s * levels + level,
          b: next * levels + level,
          rest: ringRest,
          stiffness: 0.5,
        })
      }
    }

    const skirt = createSkirt('skirt', strands, ringLinks, waistRadius, true)
    const leg = { kind: 'circle' as const, x: 0, y: 0.9, radius: 0.34 }
    const w = world({
      skirts: [skirt],
      colliders: [leg],
      gravity: [0, -9.8],
      wind: [0.3, 0],
      iterations: 8,
    })

    for (let frame = 0; frame < FRAMES; frame += 1) stepWorld(w, FRAME_DT)

    for (const strand of skirt.strands) {
      for (const p of strand.particles) {
        expect(Number.isFinite(p.x)).toBe(true)
        expect(Number.isFinite(p.y)).toBe(true)
        const d = Math.hypot(p.x - leg.x, p.y - leg.y)
        expect(d).toBeGreaterThanOrEqual(leg.radius - 1e-6)
      }
      // 腰环钉在根骨上，不应被重力拉走。
      expect(strand.particles[0]!.y).toBe(2)
    }
  })
})
