import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { evaluateFk } from '@/fk/evaluate'
import { skinMesh } from '@/skin/skin'
import { createPose } from '@/skeleton/pose'
import { expectClose } from '../math/assert'

describe('skin', () => {
  it('零偏移蒙皮回到绑定顶点', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const pose = createPose(compiled.skeleton)
    const fk = new Float32Array(compiled.bindRig.length)
    evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
    const torso = compiled.meshes.meshes[0]!
    const out = new Float32Array(torso.positions.length)
    skinMesh(out, compiled, fk, 0)
    for (let i = 0; i < out.length; i += 1) expectClose(out[i]!, torso.positions[i]!, 1e-4)

    const headIndex = compiled.meshes.meshes.findIndex((mesh) => mesh.partId === 'head')
    const head = compiled.meshes.meshes[headIndex]!
    const headOut = new Float32Array(head.positions.length)
    skinMesh(headOut, compiled, fk, headIndex)
    const bone = compiled.parts.parts[headIndex]!.kind === 'rigid'
      ? compiled.parts.parts[headIndex]
      : undefined
    if (!bone || bone.kind !== 'rigid') throw new Error('kind')
    const base = bone.bone * 9
    const x = head.positions[0]!
    const y = head.positions[1]!
    const expectedX = fk[base]! * x + fk[base + 3]! * y + fk[base + 6]!
    const expectedY = fk[base + 1]! * x + fk[base + 4]! * y + fk[base + 7]!
    expectClose(headOut[0]!, expectedX, 1e-5)
    expectClose(headOut[1]!, expectedY, 1e-5)
  })

  it('输出长度不符时不写', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const out = new Float32Array([3, 4])
    expect(() => skinMesh(out, compiled, compiled.bindRig, 0)).toThrow(/^out$/)
    expect(out[0]).toBe(3)
  })
})
