import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid, compileRig } from '@/compile/compile'
import { createCorrection } from '@/correction/correction'
import { createHumanoidMeshes, type Mesh } from '@/mesh/humanoid'
import { createHumanoidParts } from '@/part/humanoid'
import { createHumanoidSlots } from '@/slot/humanoid'
import { createHumanoidWeights } from '@/weight/humanoid'

describe('compile', () => {
  it('收成只读结果', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    expect(compiled.skeleton).toBe(humanoid.skeleton)
    expect(compiled.parts.parts).toHaveLength(10)
    expect(compiled.foot.toeForward).toBe(humanoid.proportions.footLength)
    expect(compiled.foot.heelBack).toBeGreaterThan(0)
    expect(compiled.bindRig.length).toBe(humanoid.skeleton.boneCount * 9)
    expect(compiled.inverseBind.length).toBe(compiled.bindRig.length)
    expect(compiled.correction.enabled).toBe(false)
  })

  it('骨架、槽位或绕向不一致时整份拒绝', () => {
    const humanoid = createHumanoid(1.7)
    const other = createHumanoid(1.7)
    const parts = createHumanoidParts(humanoid.skeleton)
    const slots = createHumanoidSlots()
    const meshes = createHumanoidMeshes(humanoid, parts)
    const weights = createHumanoidWeights(humanoid, parts, meshes)
    const correction = createCorrection()
    const base = { humanoid, parts, slots, meshes, weights, correction }

    expect(() =>
      compileRig({ ...base, parts: createHumanoidParts(other.skeleton) }),
    ).toThrow(/^skeleton$/)

    const missing = createSlotSetWithoutHead()
    expect(() => compileRig({ ...base, slots: missing })).toThrow(/^slot$/)

    const clockwise = meshes.meshes.map((mesh, index) =>
      index === 0 ? clockwiseMesh(mesh.partId) : mesh,
    )
    expect(() => compileRig({ ...base, meshes: { meshes: clockwise } })).toThrow(/^winding$/)
  })
})

function createSlotSetWithoutHead() {
  const set = createHumanoidSlots()
  return { slots: set.slots.filter((slot) => slot.partId !== 'head') }
}

function clockwiseMesh(partId: string): Mesh {
  return {
    partId,
    space: 'character',
    positions: new Float32Array([0, 0, 1, 0, 0, 1]),
    indices: new Uint16Array([0, 2, 1]),
  }
}
