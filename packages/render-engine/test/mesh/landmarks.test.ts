import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile'
import { createPose } from '@/skeleton'
import { evaluateFk } from '@/fk'
import { skinMesh } from '@/skin'

const HEIGHT = 1.8
const TOLERANCE = 0.05

type WorldPart = { id: string; positions: Float32Array }

function worldParts(): { parts: Map<string, Float32Array>; height: number; proportion: ReturnType<typeof createHumanoid>['proportions'] } {
  const humanoid = createHumanoid(HEIGHT)
  const compiled = compileHumanoid(humanoid)
  const pose = createPose(humanoid.skeleton)
  const fk = new Float32Array(humanoid.skeleton.boneCount * 12)
  evaluateFk(fk, compiled, pose, humanoid.skeleton.boneCount)
  const parts = new Map<string, Float32Array>()
  for (let i = 0; i < compiled.meshes.meshes.length; i += 1) {
    const mesh = compiled.meshes.meshes[i]!
    const positions = new Float32Array(mesh.positions.length)
    skinMesh(positions, compiled, fk, i, pose)
    parts.set(mesh.partId, positions)
  }
  return { parts, height: HEIGHT, proportion: humanoid.proportions }
}

function bounds(positions: Float32Array): { w: number; d: number; h: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    x0 = Math.min(x0, positions[i]!)
    x1 = Math.max(x1, positions[i]!)
    y0 = Math.min(y0, positions[i + 1]!)
    y1 = Math.max(y1, positions[i + 1]!)
    z0 = Math.min(z0, positions[i + 2]!)
    z1 = Math.max(z1, positions[i + 2]!)
  }
  return { w: z1 - z0, d: x1 - x0, h: y1 - y0 }
}

/** 取离给定高度最近的一圈，返回该圈的横向宽与前后深。 */
/** 在给定高度上下 1.2 mm 内量截面：接头段的圈不共面，不能只取最近的一圈。 */
function slice(positions: Float32Array, y: number): { w: number; d: number } {
  const band = 0.0012
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  let found = 0
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i + 1]! - y) > band) continue
    x0 = Math.min(x0, positions[i]!)
    x1 = Math.max(x1, positions[i]!)
    z0 = Math.min(z0, positions[i + 2]!)
    z1 = Math.max(z1, positions[i + 2]!)
    found += 1
  }
  if (found < 8) throw new Error(`slice 找不到截面：y=${(y / HEIGHT).toFixed(3)}H，只有 ${found} 个顶点`)
  return { w: z1 - z0, d: x1 - x0 }
}

function expectRatio(actual: number, expected: number, tolerance = TOLERANCE): void {
  const error = Math.abs(actual - expected) / expected
  if (error > tolerance) {
    throw new Error(`比例越界：实得 ${actual.toFixed(4)}，目标 ${expected.toFixed(4)}，偏差 ${(error * 100).toFixed(1)}%`)
  }
}

describe('humanoid landmarks', () => {
  const { parts, height, proportion } = worldParts()
  const ratio = (value: number): number => value / height

  it('头、手、脚的整体比例', () => {
    const head = bounds(parts.get('head')!)
    expectRatio(ratio(head.h), 0.13)
    expectRatio(ratio(head.w), 0.085)
    expectRatio(ratio(head.d), 0.108)

    const hand = bounds(parts.get('handL')!)
    expectRatio(ratio(hand.h), 0.108)

    const foot = bounds(parts.get('footL')!)
    expectRatio(ratio(foot.d), 0.15)
    expectRatio(ratio(foot.w), 0.054)
  })

  it('躯干的胸、腰、胯三段', () => {
    const torso = parts.get('torso')!
    const chest = slice(torso, 0.728 * height)
    expectRatio(ratio(chest.w), 0.184)
    expectRatio(ratio(chest.d), 0.122)

    const waist = slice(torso, 0.62 * height)
    expectRatio(ratio(waist.w), 0.158)
    expectRatio(ratio(waist.d), 0.104)

    const hip = slice(torso, 0.53 * height)
    expectRatio(ratio(hip.w), 0.192)
    expectRatio(ratio(hip.d), 0.126)
  })

  it('肩宽与四肢直径', () => {
    const span = (id: string): { min: number; max: number } => {
      const positions = parts.get(id)!
      let min = Infinity
      let max = -Infinity
      for (let i = 2; i < positions.length; i += 3) {
        min = Math.min(min, positions[i]!)
        max = Math.max(max, positions[i]!)
      }
      return { min, max }
    }
    const shoulder = span('armL').max - span('armR').min
    expectRatio(ratio(shoulder), 0.25)

    const upperArm = slice(parts.get('armL')!, 0.6585 * height)
    expectRatio(ratio(upperArm.w), 0.058)
    const forearm = slice(parts.get('armL')!, 0.5937 * height)
    expectRatio(ratio(forearm.w), 0.05)
    const thigh = slice(parts.get('legL')!, 0.34625 * height)
    expectRatio(ratio(thigh.w), 0.066)
    const calf = slice(parts.get('legL')!, 0.19275 * height)
    expectRatio(ratio(calf.w), 0.063)
  })

  it('手掌是扁的，指与掌的比例合理', () => {
    const hand = parts.get('handL')!
    const palm = slice(hand, 0.432 * height)
    expectRatio(ratio(palm.d), 0.017)
    expectRatio(ratio(palm.w), 0.046)

    const lengths = proportion.fingerLengths
    expect(lengths[1]).toBeGreaterThan(lengths[0]!)
    expect(lengths[0]).toBeGreaterThan(lengths[2]!)
    expect(lengths[2]).toBeGreaterThan(lengths[3]!)
  })
})
