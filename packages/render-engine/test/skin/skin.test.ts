import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid, compileRig, type CompiledRig } from '@/compile/compile'
import { createCorrection } from '@/correction/correction'
import { evaluateFk } from '@/fk/evaluate'
import { createHumanoidMeshes } from '@/mesh/humanoid'
import { createHumanoidParts } from '@/part/humanoid'
import { skinMesh } from '@/skin/skin'
import { createHumanoidSlots } from '@/slot/humanoid'
import { createPose, setPoseRotation, setPoseTwist, type Pose } from '@/skeleton/pose'
import { RIGID_STRIDE } from '@/skeleton/rigid'
import { findBone } from '@/skeleton/skeleton'
import { createHumanoidWeights } from '@/weight/humanoid'
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
    expectClose(fk[hand.bone * RIGID_STRIDE + 11]!, compiled.proportions.shoulderOffsetZ)
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

  it('前臂扭转沿 twistU 分布：腕满拧、肩接缝不拧', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const index = meshIndex(compiled, 'armL')
    const mesh = compiled.meshes.meshes[index]!
    const weights = compiled.weights.weights.find((item) => item.partId === 'armL')!
    const pose = createPose(compiled.skeleton)
    setPoseTwist(pose, findBone(compiled.skeleton, 'lowerArmL'), Math.PI / 2)
    const out = new Float32Array(mesh.positions.length)
    skinMesh(out, compiled, rig(compiled, pose), index, pose)

    let distalMove = 0
    let distalCount = 0
    let proximalMove = 0
    let proximalCount = 0
    let shoulderCount = 0
    for (let v = 0; v < mesh.positions.length / 3; v += 1) {
      const u = weights.twistU[v]!
      const forearm = weights.weights[v * 4 + 2]!
      const bx = mesh.positions[v * 3]!
      const by = mesh.positions[v * 3 + 1]!
      const bz = mesh.positions[v * 3 + 2]!
      const ox = out[v * 3]!
      const oy = out[v * 3 + 1]!
      const oz = out[v * 3 + 2]!
      const move = Math.abs(ox - bx) + Math.abs(oy - by) + Math.abs(oz - bz)
      if (mesh.seam[v] === 1 && weights.weights[v * 4]! > 0.99) {
        expectClose(ox, bx, 1e-3)
        expectClose(oy, by, 1e-3)
        expectClose(oz, bz, 1e-3)
        shoulderCount += 1
      }
      if (forearm > 0.5 && u >= 0.5) {
        distalMove += move
        distalCount += 1
      }
      if (forearm > 0.5 && u <= 0.125) {
        proximalMove += move
        proximalCount += 1
      }
    }
    expect(shoulderCount).toBeGreaterThan(0)
    expect(distalCount).toBeGreaterThan(0)
    expect(proximalCount).toBeGreaterThan(0)
    expect(distalMove / distalCount).toBeGreaterThan((proximalMove / proximalCount) * 2)
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
