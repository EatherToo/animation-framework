import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { createHumanoidMeshes } from '@/mesh/humanoid'
import { TUBE_SIDES } from '@/mesh/strip'
import { createHumanoidParts } from '@/part/humanoid'
import { createHumanoidWeights } from '@/weight/humanoid'
import { expectClose } from '../math/assert'

describe('weights', () => {
  it('2D 手臂不再生成权重，链端读 endShare，肘膝过渡带仍在', () => {
    const humanoid = createHumanoid(1.7)
    const parts = createHumanoidParts(humanoid.skeleton)
    const meshes = createHumanoidMeshes(humanoid, parts)
    const before = meshes.meshes.map((mesh) => Array.from(mesh.positions))
    const set = createHumanoidWeights(humanoid, parts, meshes)
    for (let i = 0; i < meshes.meshes.length; i += 1) {
      const after = meshes.meshes[i]!.positions
      for (let k = 0; k < after.length; k += 1) expect(Object.is(after[k], before[i]![k])).toBe(true)
    }

    // 2D 手臂由轮廓生成器直接给顶点，权重表里只留关节修正仍需要的三段。
    expect(set.weights.map((item) => item.partId)).toEqual(['torso', 'legL', 'legR'])
    expect(set.weights.some((item) => item.partId === 'armL' || item.partId === 'armR')).toBe(false)

    const legWeights = set.weights.find((item) => item.partId === 'legL')!
    const torsoWeights = set.weights.find((item) => item.partId === 'torso')!
    expect(legWeights.influences).toBe(4)
    expect(torsoWeights.influences).toBe(5)
    const leg = meshes.meshes.find((mesh) => mesh.partId === 'legL')!
    expect(legWeights.weights.length).toBe((leg.positions.length / 3) * 4)
    const legVertexCount = leg.positions.length / 3
    for (let v = 0; v < legVertexCount; v += 1) {
      let sum = 0
      for (let c = 0; c < legWeights.influences; c += 1) {
        const weight = legWeights.weights[v * legWeights.influences + c]!
        expect(weight).toBeGreaterThanOrEqual(0)
        sum += weight
      }
      expectClose(sum, 1)
    }

    let hip = 0
    let foot = 0
    for (let v = 0; v < legVertexCount; v += 1) {
      const column = (slot: number) => legWeights.weights[v * 4 + slot]!
      if (leg.seam[v] === 1 && leg.endShare[v * 2]! > 0.99) {
        expect(column(0)).toBeCloseTo(1, 5)
        hip += 1
      }
      if (leg.seam[v] === 1 && leg.endShare[v * 2 + 1]! > 0.99) {
        expect(column(3)).toBeCloseTo(1, 5)
        foot += 1
      }
    }
    expect(hip).toBe(TUBE_SIDES)
    expect(foot).toBe(TUBE_SIDES)

    const torso = meshes.meshes.find((mesh) => mesh.partId === 'torso')!
    let head = 0
    let pelvis = 0
    for (let v = 0; v < torso.positions.length / 3; v += 1) {
      if (torso.seam[v] === 1 && torso.endShare[v * 2 + 1]! > 0.99) {
        expect(torsoWeights.weights[v * torsoWeights.influences + (torsoWeights.influences - 1)]!).toBeCloseTo(1, 5)
        head += 1
      }
      if (torso.seam[v] === 1 && torso.endShare[v * 2]! > 0.99) {
        expect(torsoWeights.weights[v * torsoWeights.influences]!).toBeCloseTo(1, 5)
        pelvis += 1
      }
    }
    expect(head).toBe(TUBE_SIDES)
    expect(pelvis).toBe(TUBE_SIDES)
  })
})
