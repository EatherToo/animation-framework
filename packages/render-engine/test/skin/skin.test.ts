import { describe, expect, it } from '@jest/globals'
import { ARM_BIND_SWING, createHumanoid } from '@/body/assemble'
import { compileHumanoid, compileRig, type CompiledRig } from '@/compile/compile'
import { createCorrection } from '@/correction/correction'
import { evaluateFk } from '@/fk/evaluate'
import { createHumanoidMeshes } from '@/mesh/humanoid'
import { createHumanoidParts } from '@/part/humanoid'
import { armOutlineBones, skinMesh } from '@/skin/skin'
import { createHumanoidSlots } from '@/slot/humanoid'
import { createPose, setPoseRotation, setPoseSwing, setPoseTwist, type Pose } from '@/skeleton/pose'
import { RIGID_STRIDE } from '@/skeleton/rigid'
import { findBone } from '@/skeleton/skeleton'
import { createHumanoidWeights } from '@/weight/humanoid'
import {
  ARM_JOINT_RINGS,
  ARM_SECTIONS,
  ARM_WRIST_RINGS,
  armOutlineVertexCount,
  halfWidthAt,
  wristHalfWidth,
} from '@/outline/arm'
import { expectClose } from '../math/assert'

function rig(compiled: CompiledRig, pose: Pose): Float32Array {
  const count = compiled.skeleton.boneCount
  const fk = new Float32Array(count * RIGID_STRIDE)
  evaluateFk(fk, compiled, pose, count)
  return fk
}

function meshIndex(compiled: CompiledRig, partId: string): number {
  return compiled.meshes.meshes.findIndex((mesh) => mesh.partId === partId)
}

describe('skin', () => {
  it('零偏移蒙皮回到绑定顶点，包括 z', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const pose = createPose(compiled.skeleton)
    const fk = rig(compiled, pose)
    for (const id of ['torso', 'armL', 'armR', 'legL', 'legR']) {
      const index = meshIndex(compiled, id)
      const mesh = compiled.meshes.meshes[index]!
      const out = new Float32Array(mesh.positions.length)
      skinMesh(out, compiled, fk, index, pose)
      for (let i = 0; i < out.length; i += 1) expectClose(out[i]!, mesh.positions[i]!, 1e-4)
    }
    for (const id of ['armL', 'armR']) {
      const mesh = compiled.meshes.meshes[meshIndex(compiled, id)]!
      for (let v = 0; v < mesh.positions.length / 3; v += 1) {
        expect(mesh.positions[v * 3 + 2]).toBe(0)
      }
    }
    expect(meshIndex(compiled, 'torso')).toBe(0)
  })

  it('刚性零件三个分量都乘当前刚体', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const pose = createPose(compiled.skeleton)
    const fk = rig(compiled, pose)
    for (const id of ['head', 'handL', 'footR']) {
      const index = meshIndex(compiled, id)
      const mesh = compiled.meshes.meshes[index]!
      const out = new Float32Array(mesh.positions.length)
      skinMesh(out, compiled, fk, index, pose)
      const part = compiled.parts.parts[index]!
      if (part.kind !== 'rigid') throw new Error('kind')
      const base = part.bone * RIGID_STRIDE
      for (let v = 0; v < mesh.positions.length / 3; v += 1) {
        const x = mesh.positions[v * 3]!
        const y = mesh.positions[v * 3 + 1]!
        const z = mesh.positions[v * 3 + 2]!
        expectClose(
          out[v * 3]!,
          fk[base]! * x + fk[base + 3]! * y + fk[base + 6]! * z + fk[base + 9]!,
          1e-5,
        )
        expectClose(
          out[v * 3 + 1]!,
          fk[base + 1]! * x + fk[base + 4]! * y + fk[base + 7]! * z + fk[base + 10]!,
          1e-5,
        )
        expectClose(
          out[v * 3 + 2]!,
          fk[base + 2]! * x + fk[base + 5]! * y + fk[base + 8]! * z + fk[base + 11]!,
          1e-5,
        )
      }
    }
    const hand = compiled.parts.parts[meshIndex(compiled, 'handL')]!
    if (hand.kind !== 'rigid') throw new Error('kind')
    const outward = Math.sin(ARM_BIND_SWING)
    expectClose(
      fk[hand.bone * RIGID_STRIDE + 11]!,
      compiled.proportions.shoulderOffsetZ +
        outward * (compiled.proportions.upperArmLength + compiled.proportions.lowerArmLength),
    )
  })

  it('屈膝只移动矢状面，顶点的 z 留在骨头两侧', () => {
    // 关掉体积外推，只验矢状蒙皮不搅横向。
    const humanoid = createHumanoid(1.7)
    const parts = createHumanoidParts(humanoid.skeleton)
    const slots = createHumanoidSlots()
    const meshes = createHumanoidMeshes(humanoid, parts)
    const weights = createHumanoidWeights(humanoid, parts, meshes)
    const compiled = compileRig({
      humanoid,
      parts,
      slots,
      meshes,
      weights,
      correction: createCorrection({ enabled: false }),
    })
    const index = meshIndex(compiled, 'legL')
    const mesh = compiled.meshes.meshes[index]!
    const pose = createPose(compiled.skeleton)
    const rest = new Float32Array(mesh.positions.length)
    skinMesh(rest, compiled, rig(compiled, pose), index, pose)

    setPoseRotation(pose, findBone(compiled.skeleton, 'shinL'), -0.8)
    const bent = new Float32Array(mesh.positions.length)
    skinMesh(bent, compiled, rig(compiled, pose), index, pose)

    let moved = false
    for (let v = 0; v < mesh.positions.length / 3; v += 1) {
      if (Math.abs(bent[v * 3]! - rest[v * 3]!) > 1e-3) moved = true
      expectClose(bent[v * 3 + 2]!, mesh.positions[v * 3 + 2]!, 1e-6)
    }
    expect(moved).toBe(true)
  })

  it('抬臂 90°：顶点 z 恒 0，宽度按 (x, y) 量，腕口跟手走', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const index = meshIndex(compiled, 'armL')
    const mesh = compiled.meshes.meshes[index]!
    const pose = createPose(compiled.skeleton)
    const fkBind = rig(compiled, pose)
    const bind = new Float32Array(mesh.positions.length)
    skinMesh(bind, compiled, fkBind, index, pose)

    const widths = (positions: Float32Array): number[] => {
      const result: number[] = []
      for (let v = 0; v < positions.length / 3; v += 2) {
        const dx = positions[(v + 1) * 3]! - positions[v * 3]!
        const dy = positions[(v + 1) * 3 + 1]! - positions[v * 3 + 1]!
        result.push(Math.hypot(dx, dy))
      }
      return result
    }
    const p = compiled.proportions
    const jointWidth = Math.min(
      halfWidthAt(p.upperArmProfile, 1),
      halfWidthAt(p.lowerArmProfile, 0),
    )
    const lowerStart = ARM_SECTIONS + ARM_JOINT_RINGS + 1
    const wristStart = lowerStart + ARM_SECTIONS
    const expectedFor = (fk: Float32Array): ((ring: number) => number) => {
      const bones = armOutlineBones(compiled, fk, 'armL')
      const handDir = { x: bones.handTip.x - bones.wrist.x, y: bones.handTip.y - bones.wrist.y }
      const wristWidth = wristHalfWidth(
        handDir,
        { x: bones.handLateral.x, y: bones.handLateral.y },
        { x: bones.handThicknessAxis.x, y: bones.handThicknessAxis.y },
        bones.palmHalfWidth,
        bones.palmHalfThickness,
      )
      const startWidth = halfWidthAt(p.lowerArmProfile, 1)
      return (ring: number): number => {
        if (ring <= ARM_SECTIONS) return 2 * halfWidthAt(p.upperArmProfile, ring / ARM_SECTIONS)
        if (ring <= ARM_SECTIONS + ARM_JOINT_RINGS) return 2 * jointWidth
        if (ring <= wristStart) {
          return 2 * halfWidthAt(p.lowerArmProfile, (ring - lowerStart) / ARM_SECTIONS)
        }
        const u = Math.min(1, (ring - wristStart) / (ARM_WRIST_RINGS + 1))
        return 2 * (startWidth + (wristWidth - startWidth) * u)
      }
    }
    const expectedBind = expectedFor(fkBind)
    for (let ring = 0; ring < widths(bind).length; ring += 1) {
      expectClose(widths(bind)[ring]!, expectedBind(ring), 1e-5)
    }

    setPoseSwing(pose, findBone(compiled.skeleton, 'upperArmL'), Math.PI / 2)
    const fkRaised = rig(compiled, pose)
    const raised = new Float32Array(mesh.positions.length)
    skinMesh(raised, compiled, fkRaised, index, pose)
    for (let v = 0; v < raised.length / 3; v += 1) {
      expect(Number.isFinite(raised[v * 3]!)).toBe(true)
      expect(Number.isFinite(raised[v * 3 + 1]!)).toBe(true)
      expect(raised[v * 3 + 2]).toBe(0)
    }
    const expectedRaised = expectedFor(fkRaised)
    for (let ring = 0; ring < widths(raised).length; ring += 1) {
      expectClose(widths(raised)[ring]!, expectedRaised(ring), 1e-5)
    }
    // 侧摆 90° 后腕端明显升高，直臂被真正抬起来。
    const wrist = raised.length / 3 - 1
    expect(raised[wrist * 3 + 1]!).toBeGreaterThan(bind[wrist * 3 + 1]! + 0.2)
    expect(raised.length / 3).toBe(armOutlineVertexCount())
  })

  it('前臂扭转只改变腕口宽度，跟着手掌转', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const index = meshIndex(compiled, 'armL')
    const mesh = compiled.meshes.meshes[index]!
    const pose = createPose(compiled.skeleton)
    const base = new Float32Array(mesh.positions.length)
    skinMesh(base, compiled, rig(compiled, pose), index, pose)
    setPoseTwist(pose, findBone(compiled.skeleton, 'lowerArmL'), Math.PI / 2)
    const twisted = new Float32Array(mesh.positions.length)
    skinMesh(twisted, compiled, rig(compiled, pose), index, pose)
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

  it('长度不符时依次抛出 mesh、fk、out，且不写 out', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const pose = createPose(compiled.skeleton)
    const short = new Float32Array([3, 4])
    expect(() => skinMesh(short, compiled, compiled.bindRig, 99, pose)).toThrow(/^mesh$/)
    expect(() => skinMesh(short, compiled, new Float32Array(RIGID_STRIDE), 0, pose)).toThrow(/^fk$/)
    expect(() => skinMesh(short, compiled, compiled.bindRig, 0, pose)).toThrow(/^out$/)
    expect(Array.from(short)).toEqual([3, 4])

    const full = new Float32Array(compiled.meshes.meshes[0]!.positions.length).fill(9)
    expect(() =>
      skinMesh(full, compiled, new Float32Array(compiled.bindRig.length + RIGID_STRIDE), 0, pose),
    ).toThrow(/^fk$/)
    expect(full.every((value) => value === 9)).toBe(true)
  })
})
