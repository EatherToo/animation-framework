import { describe, expect, it } from '@jest/globals'
import { ARM_BIND_SWING, createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile'
import { createPose } from '@/skeleton'
import { evaluateFk } from '@/fk'
import { skinMesh } from '@/skin'
import { ARM_JOINT_RINGS, ARM_SECTIONS, armOutlineVertexCount, halfWidthAt, isArmPart } from '@/outline/arm'
import { armOutlineBones } from '@/skin/skin'
import { projectParts } from '@/view/project'

const HEIGHT = 1.8
const TOLERANCE = 0.05

type WorldPart = { id: string; positions: Float32Array }

function worldParts(): {
  parts: Map<string, Float32Array>
  front: Map<string, Float32Array>
  height: number
  proportion: ReturnType<typeof createHumanoid>['proportions']
} {
  const humanoid = createHumanoid(HEIGHT)
  const compiled = compileHumanoid(humanoid)
  const pose = createPose(humanoid.skeleton)
  const fk = new Float32Array(humanoid.skeleton.boneCount * 12)
  evaluateFk(fk, compiled, pose, humanoid.skeleton.boneCount)
  const parts = new Map<string, Float32Array>()
  const sources = []
  for (let i = 0; i < compiled.meshes.meshes.length; i += 1) {
    const mesh = compiled.meshes.meshes[i]!
    const positions = new Float32Array(mesh.positions.length)
    skinMesh(positions, compiled, fk, i, pose)
    parts.set(mesh.partId, positions)
    const arm = isArmPart(mesh.partId) ? armOutlineBones(compiled, fk, mesh.partId) : undefined
    sources.push({ partId: mesh.partId, positions, indices: mesh.indices, seam: mesh.seam, ...(arm === undefined ? {} : { arm }) })
  }
  const front = new Map(
    projectParts(sources, 90).map((part) => [part.partId, part.positions] as const),
  )
  return { parts, front, height: HEIGHT, proportion: humanoid.proportions }
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
  const { parts, front, height, proportion } = worldParts()
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

    const waist = slice(torso, 0.614 * height)
    expectRatio(ratio(waist.w), 0.158)
    expectRatio(ratio(waist.d), 0.104)

    const hip = slice(torso, 0.53 * height)
    expectRatio(ratio(hip.w), 0.192)
    expectRatio(ratio(hip.d), 0.126)
  })

  it('肩宽与四肢直径', () => {
    // 2D 手臂在绑定姿态下是矢状面 (x, y) 的轮廓带；肩宽要在正视投影里量。
    const shoulderY = proportion.hipHeight + proportion.spineLength + proportion.chestLength - proportion.shoulderDropY
    let minZ = Infinity
    let maxZ = -Infinity
    for (const id of ['armL', 'armR']) {
      const positions = front.get(id)!
      for (let i = 0; i < positions.length; i += 2) {
        const dy = shoulderY - positions[i + 1]!
        if (dy < -0.005 || dy > 0.08 * height) continue
        minZ = Math.min(minZ, positions[i]!)
        maxZ = Math.max(maxZ, positions[i]!)
      }
    }
    // 2D 轮廓带的肩根向躯干里收了 0.02 H；可见肩峰跨度约 0.241 H。
    expectRatio(ratio(maxZ - minZ), 0.241)

    // 手臂宽度按 (x, y) 量：每个截面两个点关于中线对称，距离就是 2×半宽。
    const arm = parts.get('armL')!
    const ringWidth = (ring: number): number => {
      const first = ring * 2
      return Math.abs(arm[(first + 1) * 3]! - arm[first * 3]!)
    }
    expect(arm.length / 3).toBe(armOutlineVertexCount())
    for (let v = 0; v < arm.length / 3; v += 1) expect(arm[v * 3 + 2]).toBe(0)

    expectRatio(ratio(ringWidth(ARM_SECTIONS)), 0.04)
    expectRatio(
      ratio(
        ringWidth(ARM_SECTIONS + ARM_JOINT_RINGS + 1 + Math.round(ARM_SECTIONS / 8)),
      ),
      0.05,
    )
    expect(ringWidth(ARM_SECTIONS)).toBeCloseTo(
      2 * halfWidthAt(proportion.upperArmProfile, 1),
      6,
    )
    const thigh = slice(parts.get('legL')!, 0.3769 * height)
    expectRatio(ratio(thigh.w), 0.0725)
    const calf = slice(parts.get('legL')!, 0.19275 * height)
    expectRatio(ratio(calf.w), 0.063)
  })

  it('手掌是扁的，指与掌的比例合理', () => {
    const hand = parts.get('handL')!
    // 手臂外展后手心不再水平，按手骨轴投影取掌中段，而不是按世界高度切。
    const axis = { y: -Math.cos(ARM_BIND_SWING), z: Math.sin(ARM_BIND_SWING) }
    const wristY = (proportion.hipHeight +
      proportion.spineLength +
      proportion.chestLength -
      proportion.shoulderDropY) +
      axis.y * (proportion.upperArmLength + proportion.lowerArmLength)
    const wristZ = proportion.shoulderOffsetZ +
      axis.z * (proportion.upperArmLength + proportion.lowerArmLength)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, found = 0
    const centerZ = wristZ + axis.z * 0.35 * proportion.handLength
    for (let i = 0; i < hand.length; i += 3) {
      const along = ((hand[i + 1]! - wristY) * axis.y + (hand[i + 2]! - wristZ) * axis.z) /
        proportion.handLength
      if (along < 0.28 || along > 0.42) continue
      // 拇指位于掌心外侧，会同时抬高厚度与宽度；只取掌心一侧。
      if (hand[i + 2]! - centerZ > 0.02) continue
      x0 = Math.min(x0, hand[i]!)
      x1 = Math.max(x1, hand[i]!)
      z0 = Math.min(z0, hand[i + 2]!)
      found += 1
    }
    expect(found).toBeGreaterThan(8)
    expectRatio(ratio(x1 - x0), 0.017)
    expectRatio(ratio(2 * (centerZ - z0)), 0.046)

    const lengths = proportion.fingerLengths
    expect(lengths[1]).toBeGreaterThan(lengths[0]!)
    expect(lengths[0]).toBeGreaterThan(lengths[2]!)
    expect(lengths[2]).toBeGreaterThan(lengths[3]!)
  })
})
