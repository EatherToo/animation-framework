import { describe, expect, it } from '@jest/globals'
import { ARM_BIND_SWING, createHumanoid } from '@/body/assemble'
import * as meshEntry from '@/mesh'
import { createHumanoidMeshes, type Mesh } from '@/mesh/humanoid'
import type { RadiusProfile, SectionProfile } from '@/body/proportions'
import { AXIAL_STEPS, TUBE_SIDES, meshFromCappedSection, meshFromCappedTube, meshFromRectangle, meshFromStrip } from '@/mesh/strip'
import {
  ARM_SECTIONS,
  ARM_SHOULDER_INSET_Y,
  armOutlineTriangles,
  halfWidthAt,
} from '@/outline/arm'
import { createHumanoidParts } from '@/part/humanoid'
import { validateMesh } from '@/topology/validate'

type Vec = { x: number; y: number; z: number }

function vertex(mesh: Mesh, index: number): Vec {
  return {
    x: mesh.positions[index * 3]!,
    y: mesh.positions[index * 3 + 1]!,
    z: mesh.positions[index * 3 + 2]!,
  }
}

function nearest(mesh: Mesh, point: Vec): number {
  let best = Infinity
  for (let i = 0; i < mesh.positions.length / 3; i += 1) {
    const v = vertex(mesh, i)
    best = Math.min(best, Math.hypot(v.x - point.x, v.y - point.y, v.z - point.z))
  }
  return best
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

function widestStation(profile: RadiusProfile): number {
  let max = 0
  for (let k = 0; k <= AXIAL_STEPS; k += 1) max = Math.max(max, profileAt(profile, k / AXIAL_STEPS))
  return max
}

function profileAt(profile: RadiusProfile, t: number): number {
  for (let i = 0; i < profile.length - 1; i += 1) {
    const left = profile[i]!
    const right = profile[i + 1]!
    if (t < left.t || t > right.t) continue
    const span = right.t - left.t
    return left.radius * (1 - (t - left.t) / span) + right.radius * ((t - left.t) / span)
  }
  throw new Error('radius')
}

type SectionAt = { halfWidth: number; frontDepth: number; backDepth: number; exponent: number }

function sectionAt(profile: SectionProfile, t: number): SectionAt {
  for (let i = 0; i < profile.length - 1; i += 1) {
    const left = profile[i]!
    const right = profile[i + 1]!
    if (t < left.t || t > right.t) continue
    const span = right.t - left.t
    const u = span === 0 ? 0 : (t - left.t) / span
    return {
      halfWidth: left.halfWidth * (1 - u) + right.halfWidth * u,
      frontDepth: left.frontDepth * (1 - u) + right.frontDepth * u,
      backDepth: left.backDepth * (1 - u) + right.backDepth * u,
      exponent: left.exponent * (1 - u) + right.exponent * u,
    }
  }
  throw new Error('section')
}

/** 生成时实际取到的站点是 `k / AXIAL_STEPS`，头与四肢的极值也只在这些站上出现。 */
function stationExtremes(profile: SectionProfile): {
  halfWidth: number
  frontDepth: number
  backDepth: number
} {
  let halfWidth = 0
  let frontDepth = 0
  let backDepth = 0
  for (let k = 0; k <= AXIAL_STEPS; k += 1) {
    const sample = sectionAt(profile, k / AXIAL_STEPS)
    halfWidth = Math.max(halfWidth, sample.halfWidth)
    frontDepth = Math.max(frontDepth, sample.frontDepth)
    backDepth = Math.max(backDepth, sample.backDepth)
  }
  return { halfWidth, frontDepth, backDepth }
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

function triangles(mesh: Mesh): number {
  return mesh.indices.length / 3
}

describe('humanoid meshes', () => {
  it('从 mesh 入口再导出', () => {
    expect(meshEntry.TUBE_SIDES).toBe(TUBE_SIDES)
    expect(meshEntry.AXIAL_STEPS).toBe(AXIAL_STEPS)
    expect(meshEntry.meshFromStrip).toBe(meshFromStrip)
    expect(meshEntry.meshFromCappedTube).toBe(meshFromCappedTube)
    expect(meshEntry.meshFromCappedSection).toBe(meshFromCappedSection)
    expect(meshEntry.meshFromRectangle).toBe(meshFromRectangle)
    expect(TUBE_SIDES).toBe(24)
    expect(AXIAL_STEPS).toBe(12)
  })

  it('按部件生成圆管、2D 手臂和刚性头手脚', () => {
    const humanoid = createHumanoid(1.7)
    const p = humanoid.proportions
    const parts = createHumanoidParts(humanoid.skeleton)
    const set = createHumanoidMeshes(humanoid, parts)
    expect(set.meshes).toHaveLength(parts.parts.length)
    const byId = new Map(set.meshes.map((mesh) => [mesh.partId, mesh]))
    let total = 0
    for (let i = 0; i < parts.parts.length; i += 1) {
      const part = parts.parts[i]!
      const mesh = set.meshes[i]!
      expect(mesh.partId).toBe(part.id)
      expect(mesh.space).toBe(part.kind === 'skinned' ? 'character' : 'part')
      expect(mesh.positions.length % 3).toBe(0)
      expect(mesh.indices.length % 3).toBe(0)
      expect(mesh.seam.length).toBe(mesh.positions.length / 3)
      expect(mesh.endShare.length).toBe(part.kind === 'skinned' ? mesh.positions.length / 3 * 2 : 0)
      expect(mesh.triangleTexture.length).toBe(triangles(mesh))
      expect(mesh.triangleTexture[0]).toBe(0)
      expect(Array.from(mesh.uvs.subarray(0, 6))).toEqual([0, 0, 2, 0, 0, 2])
      validateMesh(mesh)
      if (part.id !== 'handL' && part.id !== 'handR' && part.kind === 'rigid') {
        expectOutwardFromCentroid(mesh)
      }
      total += triangles(mesh)
    }
    expect(triangles(byId.get('torso')!)).toBe(1920)
    expect(triangles(byId.get('armL')!)).toBe(armOutlineTriangles())
    expect(triangles(byId.get('armR')!)).toBe(armOutlineTriangles())
    expect(triangles(byId.get('legL')!)).toBe(1536)
    expect(triangles(byId.get('legR')!)).toBe(1536)
    expect(triangles(byId.get('head')!)).toBe(600)
    expect(triangles(byId.get('footL')!)).toBe(600)
    expect(triangles(byId.get('footR')!)).toBe(600)
    expect(triangles(byId.get('handL')!)).toBe(3728)
    expect(total).toBe(14404)

    const torso = byId.get('torso')!
    expect(range(torso, 1).max).toBeGreaterThan(p.hipHeight + p.spineLength)
    const hipWide = sectionAt(p.torsoProfile, 0).halfWidth
    expect(range(torso, 2).max).toBeCloseTo(hipWide, 5)
    expect(range(torso, 2).min).toBeCloseTo(-hipWide, 5)

    const head = byId.get('head')!
    const headExtremes = stationExtremes(p.headProfile)
    expect(range(head, 0).min).toBe(0)
    expect(range(head, 0).max).toBeCloseTo(p.headLength, 5)
    expect(range(head, 1).max).toBeCloseTo(headExtremes.backDepth, 5)
    expect(range(head, 1).min).toBeCloseTo(-headExtremes.frontDepth, 5)
    expect(range(head, 2).max).toBeCloseTo(headExtremes.halfWidth, 5)
    expect(head.seam.reduce((sum, value) => sum + value, 0)).toBe(TUBE_SIDES)

    for (const id of ['handL', 'handR']) {
      const hand = byId.get(id)!
      expect(range(hand, 0).min).toBeCloseTo(0, 5)
      expect(range(hand, 0).max).toBeCloseTo(p.handLength, 5)
    }

    for (const id of ['footL', 'footR']) {
      const foot = byId.get(id)!
      expect(range(foot, 0).min).toBeCloseTo(-p.heelBack, 5)
      expect(range(foot, 0).max).toBeCloseTo(p.footLength, 5)
      expect(range(foot, 1).min).toBeCloseTo(-p.ankleHeight, 5)
      expect(foot.seam.reduce((sum, value) => sum + value, 0)).toBe(TUBE_SIDES)
    }
  })

  it('肩髋腕踝接缝成对，2D 手臂两端是开口', () => {
    const humanoid = createHumanoid(1.7)
    const p = humanoid.proportions
    const set = createHumanoidMeshes(humanoid, createHumanoidParts(humanoid.skeleton))
    const byId = new Map(set.meshes.map((mesh) => [mesh.partId, mesh]))
    const torso = byId.get('torso')!
    const arm = byId.get('armL')!
    const leg = byId.get('legL')!
    const foot = byId.get('footL')!
    const hand = byId.get('handL')!
    const head = byId.get('head')!
    const shoulderY = p.hipHeight + p.spineLength + p.chestLength - p.shoulderDropY

    const count = arm.positions.length / 3
    let shoulderSeam = 0
    let wristSeam = 0
    for (let i = 0; i < count; i += 1) {
      const v = vertex(arm, i)
      expect(v.z).toBe(0)
      if (arm.seam[i] !== 1) continue
      if (i < 2) shoulderSeam += 1
      if (i >= count - 2) wristSeam += 1
    }
    expect(shoulderSeam).toBe(2)
    expect(wristSeam).toBe(2)

    // 肩环与腕环关于中线对称；宽度按 (x, y) 量，等于体型截面表的半宽。
    const armFirst = vertex(arm, 0)
    const armSecond = vertex(arm, 1)
    // 绑定姿态的肩在 x=0；横向内收为 0，肩根只向下挪。
    expect((armFirst.x + armSecond.x) / 2).toBeCloseTo(0, 5)
    expect(armFirst.y).toBeCloseTo(shoulderY - ARM_SHOULDER_INSET_Y * p.height, 5)
    expect(Math.abs(armSecond.x - armFirst.x) / 2).toBeCloseTo(
      halfWidthAt(p.upperArmProfile, 0),
      5,
    )
    const wristY =
      shoulderY - Math.cos(ARM_BIND_SWING) * (p.upperArmLength + p.lowerArmLength)
    const wristFirst = vertex(arm, count - 2)
    const wristSecond = vertex(arm, count - 1)
    expect((wristFirst.x + wristSecond.x) / 2).toBeCloseTo(0, 5)
    expect(wristFirst.y).toBeCloseTo(wristY, 5)
    // 腕口半宽跟着掌根在侧视里的厚度走，手臂在这里收细，手掌才不会像一根棍子。
    expect(Math.abs(wristSecond.x - wristFirst.x) / 2).toBeCloseTo(
      p.palmWrist.halfThickness,
      5,
    )

    // 肘截面由两段共用：上臂末与下臂首取同一个半宽。
    const elbowIndex = 2 * ARM_SECTIONS
    const elbowFirst = vertex(arm, elbowIndex)
    const elbowSecond = vertex(arm, elbowIndex + 1)
    expect((elbowFirst.x + elbowSecond.x) / 2).toBeCloseTo(0, 5)
    expect(Math.abs(elbowSecond.x - elbowFirst.x) / 2).toBeCloseTo(
      halfWidthAt(p.upperArmProfile, 1),
      5,
    )
    expect(halfWidthAt(p.upperArmProfile, 1)).toBeCloseTo(halfWidthAt(p.lowerArmProfile, 0), 8)

    let hip = 0
    for (let i = 0; i < leg.positions.length / 3; i += 1) {
      if (leg.seam[i] !== 1 || leg.endShare[i * 2]! < 0.99) continue
      expect(leg.endShare[i * 2]!).toBeCloseTo(1, 5)
      hip += 1
    }
    expect(hip).toBe(TUBE_SIDES)

    let ankle = 0
    for (let i = 0; i < leg.positions.length / 3; i += 1) {
      if (leg.seam[i] !== 1 || leg.endShare[i * 2 + 1]! < 0.99) continue
      expect(leg.endShare[i * 2 + 1]!).toBeCloseTo(1, 5)
      ankle += 1
    }
    expect(ankle).toBe(TUBE_SIDES)
    expect(foot.seam.reduce((sum, value) => sum + value, 0)).toBe(TUBE_SIDES)

    let neck = 0
    for (let i = 0; i < torso.positions.length / 3; i += 1) {
      if (torso.seam[i] !== 1 || torso.endShare[i * 2 + 1]! < 0.99) continue
      expect(torso.endShare[i * 2 + 1]!).toBeCloseTo(1, 5)
      neck += 1
    }
    expect(neck).toBe(TUBE_SIDES)
    expect(head.seam.reduce((sum, value) => sum + value, 0)).toBe(TUBE_SIDES)

  })

  it('空段列表抛出 segments', () => {
    expect(() => meshFromStrip('a', 'character', [], { r: 0, g: 0, b: 0 })).toThrow(/^segments$/)
    expect(() => meshFromCappedTube('a', 'part', [], { r: 0, g: 0, b: 0 })).toThrow(/^segments$/)
    const flat = [
      { t: 0, radius: 0.1 },
      { t: 1, radius: 0.1 },
    ]
    const wide = [
      { t: 0, radius: 0.2 },
      { t: 1, radius: 0.2 },
    ]
    expect(() =>
      meshFromStrip(
        'a',
        'character',
        [
          { x0: 0, y0: 0, z0: 0, x1: 0, y1: 1, z1: 0, px: 1, py: 0, profile: flat },
          { x0: 0, y0: 1, z0: 0, x1: 0, y1: 2, z1: 0, px: 1, py: 0, profile: wide },
        ],
        { r: 0, g: 0, b: 0 },
      ),
    ).toThrow(/^radius$/)
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
