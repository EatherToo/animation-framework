import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { createHumanoidMeshes } from '@/mesh/humanoid'
import { AXIAL_STEPS, TUBE_SIDES } from '@/mesh/strip'
import { createHumanoidParts } from '@/part/humanoid'
import { createHumanoidWeights } from '@/weight/humanoid'
import { expectClose } from '../math/assert'

describe('weights', () => {
  it('手臂过渡带混合，头没有权重，顶点不动', () => {
    const humanoid = createHumanoid(1.7)
    const parts = createHumanoidParts(humanoid.skeleton)
    const meshes = createHumanoidMeshes(humanoid, parts)
    const arm = meshes.meshes.find((mesh) => mesh.partId === 'armL')!
    const before = Array.from(arm.positions)
    const set = createHumanoidWeights(humanoid, parts, meshes)
    for (let i = 0; i < before.length; i += 1) {
      expect(Object.is(arm.positions[i], before[i])).toBe(true)
    }

    expect(set.weights.map((item) => item.partId)).toEqual([
      'torso',
      'armL',
      'armR',
      'legL',
      'legR',
    ])
    const armWeights = set.weights.find((item) => item.partId === 'armL')!
    expect(armWeights.influences).toBe(2)
    const vertexCount = arm.positions.length / 3
    expect(vertexCount).toBe((2 * AXIAL_STEPS + 1) * TUBE_SIDES)
    expect(armWeights.weights.length).toBe(vertexCount * 2)
    for (let v = 0; v < vertexCount; v += 1) {
      const sum = armWeights.weights[v * 2]! + armWeights.weights[v * 2 + 1]!
      expectClose(sum, 1)
      expect(armWeights.weights[v * 2]!).toBeGreaterThanOrEqual(0)
      expect(armWeights.weights[v * 2 + 1]!).toBeGreaterThanOrEqual(0)
    }
    expect(armWeights.weights[0]).toBeCloseTo(1, 5)
    const stations = vertexCount / TUBE_SIDES
    for (let station = 0; station < stations; station += 1) {
      for (let j = 1; j < TUBE_SIDES; j += 1) {
        const first = station * TUBE_SIDES
        expectClose(armWeights.weights[(first + j) * 2]!, armWeights.weights[first * 2]!, 1e-5)
        expectClose(armWeights.weights[(first + j) * 2 + 1]!, armWeights.weights[first * 2 + 1]!, 1e-5)
      }
    }
    const elbow = AXIAL_STEPS * TUBE_SIDES
    expect(armWeights.weights[elbow * 2]).toBeCloseTo(0.5, 5)
    expect(armWeights.weights[elbow * 2 + 1]).toBeCloseTo(0.5, 5)
    const forearm = (AXIAL_STEPS + 1) * TUBE_SIDES
    expect(armWeights.weights[forearm * 2]).toBeCloseTo(0.25, 5)
    expect(armWeights.weights[forearm * 2 + 1]).toBeCloseTo(0.75, 5)
    let blended = false
    for (let v = 0; v < vertexCount; v += 1) {
      if (armWeights.weights[v * 2]! > 0.15 && armWeights.weights[v * 2 + 1]! > 0.15) {
        blended = true
      }
    }
    expect(blended).toBe(true)
  })
})
