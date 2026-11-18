import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { createHumanoidMeshes, type Mesh } from '@/mesh/humanoid'
import { createHumanoidParts } from '@/part/humanoid'

function area(mesh: Mesh, triangle: number): number {
  const i0 = mesh.indices[triangle * 3]!
  const i1 = mesh.indices[triangle * 3 + 1]!
  const i2 = mesh.indices[triangle * 3 + 2]!
  const ax = mesh.positions[i0 * 2]!
  const ay = mesh.positions[i0 * 2 + 1]!
  const bx = mesh.positions[i1 * 2]!
  const by = mesh.positions[i1 * 2 + 1]!
  const cx = mesh.positions[i2 * 2]!
  const cy = mesh.positions[i2 * 2 + 1]!
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

function expectPositive(mesh: Mesh) {
  expect(mesh.indices.length % 3).toBe(0)
  const triangles = mesh.indices.length / 3
  for (let i = 0; i < triangles; i += 1) expect(area(mesh, i)).toBeGreaterThan(0)
}

describe('humanoid meshes', () => {
  it('按部件生成条带和刚性矩形', () => {
    const humanoid = createHumanoid(1.7)
    const parts = createHumanoidParts(humanoid.skeleton)
    const set = createHumanoidMeshes(humanoid, parts)
    expect(set.meshes).toHaveLength(parts.parts.length)
    const byId = new Map(set.meshes.map((mesh) => [mesh.partId, mesh]))
    for (const part of parts.parts) {
      const mesh = byId.get(part.id)
      expect(mesh).toBeDefined()
      expect(mesh!.space).toBe(part.kind === 'skinned' ? 'character' : 'part')
      expectPositive(mesh!)
    }

    const arm = byId.get('armL')!
    expect(arm.positions.length).toBe(12)
    expect(arm.indices.length).toBe(12)

    const torso = byId.get('torso')!
    expect(torso.positions.length).toBe(16)
    expect(torso.indices.length).toBe(18)
    let maxY = -Infinity
    for (let i = 1; i < torso.positions.length; i += 2) maxY = Math.max(maxY, torso.positions[i]!)
    expect(maxY).toBeGreaterThan(humanoid.proportions.hipHeight + humanoid.proportions.spineLength)

    const head = byId.get('head')!
    expect(head.positions.length).toBe(8)
    expect(head.indices.length).toBe(6)
    const xs = [0, 1, 2, 3].map((i) => head.positions[i * 2]!)
    const ys = [0, 1, 2, 3].map((i) => head.positions[i * 2 + 1]!)
    expect(Math.min(...xs)).toBe(0)
    expect(Math.max(...xs)).toBeCloseTo(humanoid.proportions.headLength, 5)
    expect(Math.max(...ys)).toBeCloseTo(humanoid.proportions.headRadius, 5)
    expect(Math.min(...ys)).toBeCloseTo(-humanoid.proportions.headRadius, 5)

    const foot = byId.get('footL')!
    const footYs = [0, 1, 2, 3].map((i) => foot.positions[i * 2 + 1]!)
    expect(Math.min(...footYs)).toBeLessThan(0)
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
