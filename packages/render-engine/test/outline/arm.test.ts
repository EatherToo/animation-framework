import { describe, expect, it } from '@jest/globals'
import {
  ARM_JOINT_RADIUS_RATIO,
  ARM_JOINT_RINGS,
  ARM_SECTIONS,
  ARM_WRIST_RINGS,
  armOutlineTriangles,
  armOutlineVertexCount,
  buildArmOutline,
  halfWidthAt,
} from '@/outline/arm'

const shoulder = { x: 0, y: 0.8 }
const elbow = { x: 0, y: 0.55 }
const wrist = { x: 0, y: 0.3 }
const width = (): number => 0.03

function triangleArea(positions: Float32Array, indices: Uint16Array, t: number): number {
  const a = indices[t]!
  const b = indices[t + 1]!
  const c = indices[t + 2]!
  return (
    (positions[b * 2]! - positions[a * 2]!) * (positions[c * 2 + 1]! - positions[a * 2 + 1]!) -
    (positions[b * 2 + 1]! - positions[a * 2 + 1]!) * (positions[c * 2]! - positions[a * 2]!)
  )
}

describe('2D arm outline', () => {
  it('笔直手臂：肘部圆弧退化成直线，张数与宽度都对得上', () => {
    const sections = 4
    const mesh = buildArmOutline({
      shoulder,
      elbow,
      wrist,
      upperWidth: width,
      lowerWidth: width,
      sections,
    })
    // 上臂 5 个截面、肘部圆弧 3 个、前臂 5 个、腕部圆弧 2 个、腕口 1 个。
    const rings = 2 * sections + ARM_JOINT_RINGS + ARM_WRIST_RINGS + 3
    expect(mesh.positions.length).toBe(rings * 2 * 2)
    expect(mesh.indices.length).toBe((4 * sections + 2 * ARM_JOINT_RINGS + 2 * ARM_WRIST_RINGS + 4) * 3)
    expect(Math.abs(mesh.positions[0]!)).toBeCloseTo(0.03, 6)

    const radius = 0.03 * ARM_JOINT_RADIUS_RATIO
    const a = (sections) * 2 // 上臂末截面，靠近肘的 A 点
    const b = (sections + ARM_JOINT_RINGS + 1) * 2 // 前臂首截面，靠近肘的 B 点
    expect((mesh.positions[a * 2]! + mesh.positions[(a + 1) * 2]!) / 2).toBeCloseTo(0, 6)
    expect((mesh.positions[b * 2]! + mesh.positions[(b + 1) * 2]!) / 2).toBeCloseTo(0, 6)
    expect(mesh.positions[a * 2 + 1]!).toBeCloseTo(elbow.y + radius, 6)
    expect(mesh.positions[b * 2 + 1]!).toBeCloseTo(elbow.y - radius, 6)
  })

  it('弯肘 100°：肘部圆弧连续，所有三角形都有面积', () => {
    const mesh = buildArmOutline({
      shoulder,
      elbow: { x: 0.333, y: 1.436 },
      wrist: { x: 0.288, y: 1.695 },
      upperWidth: width,
      lowerWidth: width,
      sections: 8,
    })
    for (const value of mesh.positions) expect(Number.isFinite(value)).toBe(true)
    for (let t = 0; t < mesh.indices.length; t += 3) {
      expect(Math.abs(triangleArea(mesh.positions, mesh.indices, t))).toBeGreaterThan(1e-10)
    }
    // 每个截面两点对称，宽度和恒为 2×半宽或 0。
    for (let s = 0; s < mesh.positions.length / 4; s += 1) {
      const i = s * 4
      const dx = mesh.positions[i + 2]! - mesh.positions[i]!
      const dy = mesh.positions[i + 3]! - mesh.positions[i + 1]!
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(0.0600001)
    }
  })

  it('深度沿中线插值：肩、肘、腕各一段标量', () => {
    const mesh = buildArmOutline({
      shoulder,
      elbow,
      wrist,
      upperWidth: width,
      lowerWidth: width,
      sections: 4,
      shoulderDepth: 0.1,
      elbowDepth: 0.2,
      wristDepth: 0.3,
    })
    expect(mesh.depths.length).toBe(2 * (2 * 4 + ARM_JOINT_RINGS + ARM_WRIST_RINGS + 3))
    expect(mesh.depths[0]).toBeCloseTo(0.1, 6)
    // 上臂末截面（A 点）在顶点 8、9（第 5 个截面）。
    expect(mesh.depths[8]).toBeCloseTo(0.2, 6)
    expect(mesh.depths[9]).toBeCloseTo(0.2, 6)
    expect(mesh.depths[mesh.depths.length - 1]).toBeCloseTo(0.3, 6)
  })

  it('接入渲染用的张数与体型宽度一致', () => {
    expect(armOutlineVertexCount()).toBe(
      2 * (2 * ARM_SECTIONS + ARM_JOINT_RINGS + ARM_WRIST_RINGS + 3),
    )
    expect(armOutlineTriangles()).toBe(
      4 * ARM_SECTIONS + 2 * ARM_JOINT_RINGS + 2 * ARM_WRIST_RINGS + 4,
    )
    expect(
      halfWidthAt(
        [
          { t: 0, halfWidth: 0.02 },
          { t: 1, halfWidth: 0.04 },
        ],
        0.25,
      ),
    ).toBeCloseTo(0.025, 8)
  })

  it('腕屈 45°：腕口跟着 hand 方向转，仍与手根相连', () => {
    const mesh = buildArmOutline({
      shoulder,
      elbow,
      wrist,
      handDir: { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
      upperWidth: width,
      lowerWidth: width,
      sections: 8,
    })
    for (const value of mesh.positions) expect(Number.isFinite(value)).toBe(true)
    for (let t = 0; t < mesh.indices.length; t += 3) {
      expect(Math.abs(triangleArea(mesh.positions, mesh.indices, t))).toBeGreaterThan(1e-10)
    }
    // 腕口是最后一圈：两点关于腕点对称，连线垂直于 hand 方向。
    const count = mesh.positions.length / 2
    const ax = mesh.positions[(count - 2) * 2]!
    const ay = mesh.positions[(count - 2) * 2 + 1]!
    const bx = mesh.positions[(count - 1) * 2]!
    const by = mesh.positions[(count - 1) * 2 + 1]!
    expect((ax + bx) / 2).toBeCloseTo(wrist.x, 6)
    expect((ay + by) / 2).toBeCloseTo(wrist.y, 6)
    expect((bx - ax) * Math.SQRT1_2 + (by - ay) * -Math.SQRT1_2).toBeCloseTo(0, 6)
  })

  it('退化输入（肘与肩重合）不产生 NaN', () => {
    const degenerate = buildArmOutline({
      shoulder,
      elbow: shoulder,
      wrist,
      upperWidth: width,
      lowerWidth: width,
      sections: 4,
    })
    for (const value of degenerate.positions) expect(Number.isFinite(value)).toBe(true)
  })
})
