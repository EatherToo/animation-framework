import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import * as meshEntry from '@/mesh'
import { createHumanoidMeshes, type Mesh } from '@/mesh/humanoid'
import { TUBE_SIDES, meshFromCappedTube, meshFromRectangle, meshFromStrip } from '@/mesh/strip'
import { createHumanoidParts } from '@/part/humanoid'

type Vec = { x: number; y: number; z: number }

function vertex(mesh: Mesh, index: number): Vec {
  return {
    x: mesh.positions[index * 3]!,
    y: mesh.positions[index * 3 + 1]!,
    z: mesh.positions[index * 3 + 2]!,
  }
}

function normal(mesh: Mesh, triangle: number): { n: Vec; c: Vec } {
  const a = vertex(mesh, mesh.indices[triangle * 3]!)
  const b = vertex(mesh, mesh.indices[triangle * 3 + 1]!)
  const c = vertex(mesh, mesh.indices[triangle * 3 + 2]!)
  const ux = b.x - a.x
  const uy = b.y - a.y
  const uz = b.z - a.z
  const vx = c.x - a.x
  const vy = c.y - a.y
  const vz = c.z - a.z
  return {
    n: { x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx },
    c: { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 },
  }
}

function mean(mesh: Mesh): Vec {
  const count = mesh.positions.length / 3
  const sum = { x: 0, y: 0, z: 0 }
  for (let i = 0; i < count; i += 1) {
    const v = vertex(mesh, i)
    sum.x += v.x
    sum.y += v.y
    sum.z += v.z
  }
  return { x: sum.x / count, y: sum.y / count, z: sum.z / count }
}

/** 绑定姿态下蒙皮圆管都是竖直的：法线离开竖直中心线。 */
function expectOutwardFromVerticalAxis(mesh: Mesh) {
  const axis = mean(mesh)
  const triangles = mesh.indices.length / 3
  for (let t = 0; t < triangles; t += 1) {
    const { n, c } = normal(mesh, t)
    expect(Math.hypot(n.x, n.y, n.z)).toBeGreaterThan(1e-8)
    expect(n.x * (c.x - axis.x) + n.z * (c.z - axis.z)).toBeGreaterThan(0)
  }
}

/** 凸的刚性零件：法线离开形心。 */
function expectOutwardFromCentroid(mesh: Mesh) {
  const center = mean(mesh)
  const triangles = mesh.indices.length / 3
  for (let t = 0; t < triangles; t += 1) {
    const { n, c } = normal(mesh, t)
    expect(Math.hypot(n.x, n.y, n.z)).toBeGreaterThan(1e-8)
    expect(
      n.x * (c.x - center.x) + n.y * (c.y - center.y) + n.z * (c.z - center.z),
    ).toBeGreaterThan(0)
  }
}

function range(mesh: Mesh, axis: 0 | 1 | 2): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (let i = axis; i < mesh.positions.length; i += 3) {
    min = Math.min(min, mesh.positions[i]!)
    max = Math.max(max, mesh.positions[i]!)
  }
  return { min, max }
}

describe('humanoid meshes', () => {
  it('从 mesh 入口再导出', () => {
    expect(meshEntry.TUBE_SIDES).toBe(TUBE_SIDES)
    expect(meshEntry.meshFromStrip).toBe(meshFromStrip)
    expect(meshEntry.meshFromCappedTube).toBe(meshFromCappedTube)
    expect(meshEntry.meshFromRectangle).toBe(meshFromRectangle)
    expect(TUBE_SIDES).toBe(8)
  })

  it('按部件生成圆管、加盖圆管和脚的平板', () => {
    const humanoid = createHumanoid(1.7)
    const p = humanoid.proportions
    const parts = createHumanoidParts(humanoid.skeleton)
    const set = createHumanoidMeshes(humanoid, parts)
    expect(set.meshes).toHaveLength(parts.parts.length)
    const byId = new Map(set.meshes.map((mesh) => [mesh.partId, mesh]))
    for (let i = 0; i < parts.parts.length; i += 1) {
      const part = parts.parts[i]!
      const mesh = set.meshes[i]!
      expect(mesh.partId).toBe(part.id)
      expect(mesh.space).toBe(part.kind === 'skinned' ? 'character' : 'part')
      expect(mesh.positions.length % 3).toBe(0)
      expect(mesh.indices.length % 3).toBe(0)
      if (part.kind === 'skinned') expectOutwardFromVerticalAxis(mesh)
      else expectOutwardFromCentroid(mesh)
    }

    for (const id of ['armL', 'armR', 'legL', 'legR']) {
      const limb = byId.get(id)!
      expect(limb.positions.length).toBe(72)
      expect(limb.indices.length).toBe(96)
    }

    const torso = byId.get('torso')!
    expect(torso.positions.length).toBe(96)
    expect(torso.indices.length).toBe(144)
    expect(range(torso, 1).max).toBeGreaterThan(p.hipHeight + p.spineLength)
    expect(range(torso, 2).max).toBeCloseTo(p.chestRadius, 5)
    expect(range(torso, 2).min).toBeCloseTo(-p.chestRadius, 5)

    for (const id of ['head', 'handL', 'handR']) {
      const capped = byId.get(id)!
      expect(capped.positions.length).toBe(54)
      expect(capped.indices.length).toBe(96)
    }
    const head = byId.get('head')!
    expect(range(head, 0).min).toBe(0)
    expect(range(head, 0).max).toBeCloseTo(p.headLength, 5)
    expect(range(head, 1).max).toBeCloseTo(p.headRadius, 5)
    expect(range(head, 1).min).toBeCloseTo(-p.headRadius, 5)
    expect(range(head, 2).max).toBeCloseTo(p.headRadius, 5)
    expect(range(head, 2).min).toBeCloseTo(-p.headRadius, 5)
    const hand = byId.get('handL')!
    expect(range(hand, 0).max).toBeCloseTo(p.handLength, 5)
    expect(range(hand, 2).max).toBeCloseTo(p.handRadius, 5)

    for (const id of ['footL', 'footR']) {
      const foot = byId.get(id)!
      expect(foot.positions.length).toBe(24)
      expect(foot.indices.length).toBe(36)
      expect(range(foot, 0).min).toBe(0)
      expect(range(foot, 0).max).toBeCloseTo(p.footLength, 5)
      expect(range(foot, 1).min).toBeCloseTo(-p.ankleHeight, 5)
      expect(range(foot, 1).min).toBeLessThan(0)
      expect(range(foot, 1).max).toBeCloseTo(p.footRadius, 5)
      expect(range(foot, 2).min).toBeCloseTo(-p.footRadius, 5)
      expect(range(foot, 2).max).toBeCloseTo(p.footRadius, 5)
    }
  })

  it('肩处的环：矢状面采样离中心线一个半径，横向采样在 z 上离开一个半径', () => {
    const humanoid = createHumanoid(1.7)
    const p = humanoid.proportions
    const set = createHumanoidMeshes(humanoid, createHumanoidParts(humanoid.skeleton))
    const shoulderY = p.hipHeight + p.spineLength - p.shoulderDropY

    const left = set.meshes.find((mesh) => mesh.partId === 'armL')!
    const right = set.meshes.find((mesh) => mesh.partId === 'armR')!
    for (const [arm, centerZ] of [
      [left, p.shoulderOffsetZ],
      [right, -p.shoulderOffsetZ],
    ] as const) {
      for (let j = 0; j < TUBE_SIDES; j += 1) {
        const v = vertex(arm, j)
        expect(v.y).toBeCloseTo(shoulderY, 5)
        expect(Math.hypot(v.x, v.z - centerZ)).toBeCloseTo(p.upperArmRadius, 5)
      }
      expect(Math.abs(vertex(arm, 0).x)).toBeCloseTo(p.upperArmRadius, 5)
      expect(vertex(arm, 0).z).toBeCloseTo(centerZ, 6)
      expect(vertex(arm, 4).x).toBeCloseTo(-vertex(arm, 0).x, 6)
      expect(vertex(arm, 4).z).toBeCloseTo(centerZ, 6)
      expect(vertex(arm, 2).x).toBeCloseTo(0, 6)
      expect(vertex(arm, 2).z).toBeCloseTo(centerZ + p.upperArmRadius, 5)
      expect(vertex(arm, 6).x).toBeCloseTo(0, 6)
      expect(vertex(arm, 6).z).toBeCloseTo(centerZ - p.upperArmRadius, 5)
    }

    const leg = set.meshes.find((mesh) => mesh.partId === 'legL')!
    expect(vertex(leg, 2).z).toBeCloseTo(p.hipOffsetZ + p.thighRadius, 5)
    expect(range(leg, 1).min).toBeCloseTo(p.ankleHeight, 5)
    const wrist = range(left, 1).min
    expect(wrist).toBeCloseTo(shoulderY - p.upperArmLength - p.lowerArmLength, 5)
  })

  it('空段列表抛出 segments', () => {
    expect(() => meshFromStrip('a', 'character', [])).toThrow(/^segments$/)
    expect(() => meshFromCappedTube('a', 'part', [])).toThrow(/^segments$/)
  })

  it('骨架不一致时拒绝', () => {
    const humanoid = createHumanoid(1.7)
    const other = createHumanoid(1.7)
    const parts = createHumanoidParts(other.skeleton)
    expect(() => createHumanoidMeshes(humanoid, parts)).toThrow(/^skeleton$/)
  })

  it('两次生成的位置按位相同', () => {
    const humanoid = createHumanoid(1.7)
    const parts = createHumanoidParts(humanoid.skeleton)
    const a = createHumanoidMeshes(humanoid, parts)
    const b = createHumanoidMeshes(humanoid, parts)
    expect(a).not.toBe(b)
    for (let i = 0; i < a.meshes.length; i += 1) {
      const left = a.meshes[i]!.positions
      const right = b.meshes[i]!.positions
      expect(left.length).toBe(right.length)
      for (let k = 0; k < left.length; k += 1) expect(Object.is(left[k], right[k])).toBe(true)
    }
  })
})
