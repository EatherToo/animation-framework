import { describe, expect, it } from '@jest/globals'
import { applyClavicleFollow } from '@/body/follow'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { evaluateFk } from '@/fk/evaluate'
import {
  ARM_JOINT_RINGS,
  ARM_SECTIONS,
  ARM_WRIST_RINGS,
  armOutlineVertexCount,
  halfWidthAt,
} from '@/outline/arm'
import { skinMesh } from '@/skin/skin'
import {
  createPose,
  setPoseRotation,
  setPoseSwing,
  setPoseTwist,
  type Pose,
} from '@/skeleton/pose'

const H = 1.8

function setup(): {
  humanoid: ReturnType<typeof createHumanoid>
  compiled: ReturnType<typeof compileHumanoid>
  skin: (pose: Pose) => Float32Array
} {
  const humanoid = createHumanoid(H)
  const compiled = compileHumanoid(humanoid)
  const fk = new Float32Array(compiled.skeleton.boneCount * 12)
  const index = compiled.meshes.meshes.findIndex((mesh) => mesh.partId === 'armL')
  const skin = (pose: Pose): Float32Array => {
    applyClavicleFollow(pose, compiled)
    evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
    const positions = new Float32Array(compiled.meshes.meshes[index]!.positions.length)
    skinMesh(positions, compiled, fk, index, pose)
    return positions
  }
  return { humanoid, compiled, skin }
}

/** 2D 三角形的有符号面积；零面积表示轮廓带在关节处塌成一条线。 */
function area(positions: Float32Array, a: number, b: number, c: number): number {
  return (
    (positions[b * 3]! - positions[a * 3]!) * (positions[c * 3 + 1]! - positions[a * 3 + 1]!) -
    (positions[b * 3 + 1]! - positions[a * 3 + 1]!) * (positions[c * 3]! - positions[a * 3]!)
  )
}

function expectOutline(positions: Float32Array, indices: Uint16Array): void {
  for (let v = 0; v < positions.length / 3; v += 1) {
    expect(Number.isFinite(positions[v * 3]!)).toBe(true)
    expect(Number.isFinite(positions[v * 3 + 1]!)).toBe(true)
    expect(positions[v * 3 + 2]).toBe(0)
  }
  for (let t = 0; t < indices.length; t += 3) {
    expect(Math.abs(area(positions, indices[t]!, indices[t + 1]!, indices[t + 2]!))).toBeGreaterThan(1e-10)
  }
}

function ringWidths(positions: Float32Array): number[] {
  const widths: number[] = []
  for (let v = 0; v < positions.length / 3; v += 2) {
    widths.push(
      Math.hypot(
        positions[(v + 1) * 3]! - positions[v * 3]!,
        positions[(v + 1) * 3 + 1]! - positions[v * 3 + 1]!,
      ),
    )
  }
  return widths
}

function expectedWidth(compiled: ReturnType<typeof compileHumanoid>, ring: number): number | null {
  const p = compiled.proportions
  if (ring <= ARM_SECTIONS) return 2 * halfWidthAt(p.upperArmProfile, ring / ARM_SECTIONS)
  if (ring <= ARM_SECTIONS + ARM_JOINT_RINGS) {
    return 2 * Math.min(halfWidthAt(p.upperArmProfile, 1), halfWidthAt(p.lowerArmProfile, 0))
  }
  const lowerStart = ARM_SECTIONS + ARM_JOINT_RINGS + 1
  const wristStart = lowerStart + ARM_SECTIONS
  if (ring <= wristStart) {
    return 2 * halfWidthAt(p.lowerArmProfile, (ring - lowerStart) / ARM_SECTIONS)
  }
  // 腕部圆弧的宽度跟着 hand 骨在屏幕上的投影走，逐姿态变化；这里只查正值。
  return null
}

describe('pose deformation', () => {
  it('抬臂 0/45/90/110°：2D 轮廓连续、宽度不变、z 恒 0', () => {
    const { humanoid, compiled, skin } = setup()
    const mesh = compiled.meshes.meshes.find((item) => item.partId === 'armL')!
    for (const deg of [0, 45, 90, 110]) {
      const pose = createPose(compiled.skeleton)
      setPoseSwing(pose, humanoid.boneIndex.upperArmL, (deg * Math.PI) / 180)
      const positions = skin(pose)
      expectOutline(positions, mesh.indices)
      const widths = ringWidths(positions)
      for (let ring = 0; ring < widths.length; ring += 1) {
        const expected = expectedWidth(compiled, ring)
        if (expected === null) {
          expect(widths[ring]!).toBeGreaterThan(0)
        } else {
          expect(widths[ring]!).toBeCloseTo(expected, 5)
        }
      }
    }
  })

  it('弯肘 100°：内侧不塌、外侧不尖，肘截面仍然连续', () => {
    const { humanoid, compiled, skin } = setup()
    const mesh = compiled.meshes.meshes.find((item) => item.partId === 'armL')!
    const pose = createPose(compiled.skeleton)
    setPoseSwing(pose, humanoid.boneIndex.upperArmL, Math.PI / 2)
    setPoseRotation(pose, humanoid.boneIndex.lowerArmL, (100 * Math.PI) / 180)
    const positions = skin(pose)
    expectOutline(positions, mesh.indices)
    const widths = ringWidths(positions)
    for (let ring = 0; ring < widths.length; ring += 1) {
      const expected = expectedWidth(compiled, ring)
      if (expected === null) {
        expect(widths[ring]!).toBeGreaterThan(0)
      } else {
        expect(widths[ring]!).toBeCloseTo(expected, 5)
      }
    }
    // 上臂、肘部圆弧、前臂各占自己的截面，没有重复环。
    expect(positions.length / 3).toBe(armOutlineVertexCount())
    expect(armOutlineVertexCount()).toBe(
      2 * (2 * ARM_SECTIONS + ARM_JOINT_RINGS + ARM_WRIST_RINGS + 3),
    )
  })

  it('扭转只改腕口宽度，不搅前臂轮廓', () => {
    const { humanoid, compiled, skin } = setup()
    const base = skin(createPose(compiled.skeleton))
    const pose = createPose(compiled.skeleton)
    setPoseTwist(pose, humanoid.boneIndex.lowerArmL, (120 * Math.PI) / 180)
    const twisted = skin(pose)
    const wristStart = 2 * (2 * ARM_SECTIONS + ARM_JOINT_RINGS + 1)
    for (let v = 0; v < wristStart; v += 1) {
      expect(Object.is(twisted[v * 3], base[v * 3])).toBe(true)
      expect(Object.is(twisted[v * 3 + 1], base[v * 3 + 1])).toBe(true)
      expect(Object.is(twisted[v * 3 + 2], base[v * 3 + 2])).toBe(true)
    }
    let changed = false
    for (let v = wristStart; v < twisted.length / 3; v += 1) {
      if (!Object.is(twisted[v * 3], base[v * 3])) changed = true
    }
    expect(changed).toBe(true)
  })
})
