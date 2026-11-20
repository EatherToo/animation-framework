import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid, type CompiledRig } from '@/compile/compile'
import { evaluateFk } from '@/fk/evaluate'
import { skinMesh } from '@/skin/skin'
import { createPose, setPoseRotation, type Pose } from '@/skeleton/pose'
import { RIGID_STRIDE } from '@/skeleton/rigid'
import { findBone } from '@/skeleton/skeleton'
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
    const fk = rig(compiled, createPose(compiled.skeleton))
    for (const id of ['torso', 'armL', 'armR', 'legL', 'legR']) {
      const index = meshIndex(compiled, id)
      const mesh = compiled.meshes.meshes[index]!
      const out = new Float32Array(mesh.positions.length)
      skinMesh(out, compiled, fk, index)
      for (let i = 0; i < out.length; i += 1) expectClose(out[i]!, mesh.positions[i]!, 1e-4)
    }
    expect(meshIndex(compiled, 'torso')).toBe(0)
  })

  it('刚性零件三个分量都乘当前刚体', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const fk = rig(compiled, createPose(compiled.skeleton))
    for (const id of ['head', 'handL', 'footR']) {
      const index = meshIndex(compiled, id)
      const mesh = compiled.meshes.meshes[index]!
      const out = new Float32Array(mesh.positions.length)
      skinMesh(out, compiled, fk, index)
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
    const compiled = compileHumanoid(createHumanoid(1.7))
    const index = meshIndex(compiled, 'legL')
    const mesh = compiled.meshes.meshes[index]!
    const pose = createPose(compiled.skeleton)
    const rest = new Float32Array(mesh.positions.length)
    skinMesh(rest, compiled, rig(compiled, pose), index)

    setPoseRotation(pose, findBone(compiled.skeleton, 'shinL'), -0.8)
    const bent = new Float32Array(mesh.positions.length)
    skinMesh(bent, compiled, rig(compiled, pose), index)

    let moved = false
    for (let v = 0; v < mesh.positions.length / 3; v += 1) {
      if (Math.abs(bent[v * 3]! - rest[v * 3]!) > 1e-3) moved = true
      expectClose(bent[v * 3 + 2]!, mesh.positions[v * 3 + 2]!, 1e-6)
    }
    expect(moved).toBe(true)
  })

  it('长度不符时依次抛出 mesh、fk、out，且不写 out', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const short = new Float32Array([3, 4])
    expect(() => skinMesh(short, compiled, compiled.bindRig, 99)).toThrow(/^mesh$/)
    expect(() => skinMesh(short, compiled, new Float32Array(RIGID_STRIDE), 0)).toThrow(/^fk$/)
    expect(() => skinMesh(short, compiled, compiled.bindRig, 0)).toThrow(/^out$/)
    expect(Array.from(short)).toEqual([3, 4])

    const full = new Float32Array(compiled.meshes.meshes[0]!.positions.length).fill(9)
    expect(() => skinMesh(full, compiled, new Float32Array(compiled.bindRig.length + RIGID_STRIDE), 0)).toThrow(
      /^fk$/,
    )
    expect(full.every((value) => value === 9)).toBe(true)
  })
})
