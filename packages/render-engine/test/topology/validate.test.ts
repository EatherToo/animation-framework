import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { createHumanoidMeshes, type Mesh } from '@/mesh/humanoid'
import { createHumanoidParts } from '@/part/humanoid'
import { validateMesh } from '@/topology/validate'

function mesh(
  positions: number[],
  indices: number[],
): Mesh {
  return {
    partId: 'sample',
    space: 'part',
    positions: new Float32Array(positions),
    indices: new Uint16Array(indices),
  }
}

const TRIANGLE = [0, 0, 0, 1, 0, 0, 0, 1, 0]

describe('topology', () => {
  it('人形网格通过，网格按位不变', () => {
    const humanoid = createHumanoid(1.7)
    const meshes = createHumanoidMeshes(humanoid, createHumanoidParts(humanoid.skeleton))
    expect(meshes.meshes).toHaveLength(10)
    for (const item of meshes.meshes) {
      const positions = Array.from(item.positions)
      const indices = Array.from(item.indices)
      validateMesh(item)
      for (let i = 0; i < positions.length; i += 1) {
        expect(Object.is(item.positions[i], positions[i])).toBe(true)
      }
      expect(Array.from(item.indices)).toEqual(indices)
    }
  })

  it('位置或索引的长度不对时抛出 mesh', () => {
    expect(() => validateMesh(mesh([0, 0, 0, 1, 0, 0], [0, 1, 0]))).toThrow(/^mesh$/)
    expect(() => validateMesh(mesh([0, 0, 1, 0, 0, 1, 2, 0, 3, 0], [0, 1, 2]))).toThrow(/^mesh$/)
    expect(() => validateMesh(mesh(TRIANGLE, []))).toThrow(/^mesh$/)
    expect(() => validateMesh(mesh(TRIANGLE, [0, 1, 2, 0]))).toThrow(/^mesh$/)
  })

  it('非法网格被拒绝', () => {
    expect(() => validateMesh(mesh(TRIANGLE, [0, 1, 9]))).toThrow(/^indices$/)
    expect(() => validateMesh(mesh([0, 0, 0, 1, 0, 0, 2, 0, 0], [0, 1, 2]))).toThrow(
      /^degenerate$/,
    )
    expect(() => validateMesh(mesh([0, 0, 0, 0, 0, 1, 0, 0, 2], [0, 1, 2]))).toThrow(
      /^degenerate$/,
    )
    expect(() =>
      validateMesh(
        mesh([0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0], [0, 1, 2, 3, 4, 5]),
      ),
    ).toThrow(/^connectivity$/)
    expect(() =>
      validateMesh(mesh([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], [0, 1, 2, 0, 1, 3])),
    ).toThrow(/^manifold$/)
  })

  it('退化看三维叉积：离开矢状面的三角形通过，平面三角形两种绕向都通过', () => {
    validateMesh(mesh([0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 1, 2]))
    validateMesh(mesh([0, 0, 0, 0, 1, 0, 0, 0, 1], [0, 1, 2]))
    validateMesh(mesh(TRIANGLE, [0, 1, 2]))
    validateMesh(mesh(TRIANGLE, [0, 2, 1]))
  })

  it('闭合的网格通过', () => {
    validateMesh(
      mesh(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
        [0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2],
      ),
    )
  })
})
