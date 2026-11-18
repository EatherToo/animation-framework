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

describe('topology', () => {
  it('人形网格通过', () => {
    const humanoid = createHumanoid(1.7)
    const meshes = createHumanoidMeshes(humanoid, createHumanoidParts(humanoid.skeleton))
    for (const item of meshes.meshes) validateMesh(item)
  })

  it('非法网格被拒绝', () => {
    expect(() => validateMesh(mesh([0, 0, 1, 0, 0, 1], [0, 1, 9]))).toThrow(/^indices$/)
    expect(() => validateMesh(mesh([0, 0, 1, 0, 0, 1], [0, 2, 1]))).toThrow(/^winding$/)
    expect(() => validateMesh(mesh([0, 0, 1, 0, 2, 0], [0, 1, 2]))).toThrow(/^degenerate$/)
    expect(() =>
      validateMesh(
        mesh([0, 0, 1, 0, 0, 1, 2, 0, 3, 0, 2, 1], [0, 1, 2, 3, 4, 5]),
      ),
    ).toThrow(/^connectivity$/)
  })
})
