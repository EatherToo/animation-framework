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
    expect(compiled.bindRig.length).toBe(humanoid.skeleton.boneCount * 12)
    expect(compiled.inverseBind.length).toBe(compiled.bindRig.length)
    expect(compiled.correction.enabled).toBe(true)
    expect(compiled.correction.twistGain).toBeCloseTo(0.35)
    expect(compiled.correction.bendGain).toBeCloseTo(0.35)
    expect(compiled.joints).toHaveLength(17)
    const lateral = (bone: number) => compiled.bindRig[bone * 12 + 11]
    expect(lateral(humanoid.boneIndex.footL)).toBeCloseTo(humanoid.proportions.hipOffsetZ, 6)
    expect(lateral(humanoid.boneIndex.handR)).toBeCloseTo(-humanoid.proportions.shoulderOffsetZ, 6)
    expect(lateral(humanoid.boneIndex.head)).toBe(0)
  })

  it('骨架、槽位不一致或网格不合法时整份拒绝', () => {
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

    const collinear = meshes.meshes.map((mesh, index) =>
      index === 0 ? collinearMesh(mesh.partId) : mesh,
    )
    expect(() => compileRig({ ...base, meshes: { meshes: collinear } })).toThrow(/^degenerate$/)

    const planar = meshes.meshes.map((mesh, index) =>
      index === 0 ? { ...mesh, positions: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]) } : mesh,
    )
    expect(() => compileRig({ ...base, meshes: { meshes: planar } })).toThrow(/^mesh$/)

    const shortUv = meshes.meshes.map((mesh, index) =>
      index === 0 ? { ...mesh, uvs: mesh.uvs.slice(0, mesh.uvs.length - 1) } : mesh,
    )
    expect(() => compileRig({ ...base, meshes: { meshes: shortUv } })).toThrow(/^uv$/)
  })
})

function createSlotSetWithoutHead() {
  const set = createHumanoidSlots()
  return { slots: set.slots.filter((slot) => slot.partId !== 'head') }
}

function collinearMesh(partId: string): Mesh {
  return {
    partId,
    space: 'character',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]),
    indices: new Uint16Array([0, 1, 2]),
    textures: [],
    triangleTexture: new Uint16Array(),
    uvs: new Float32Array(),
    seam: new Uint8Array(3),
    endShare: new Float32Array(6),
  }
}
