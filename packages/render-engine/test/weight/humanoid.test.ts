import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { createHumanoidMeshes } from '@/mesh/humanoid'
import { AXIAL_STEPS, TUBE_SIDES } from '@/mesh/strip'
import { createHumanoidParts } from '@/part/humanoid'
import { createHumanoidWeights } from '@/weight/humanoid'
import { expectClose } from '../math/assert'

describe('weights', () => {
  it('链端读 endShare，肘膝过渡带仍在，顶点不动', () => {
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
    const legWeights = set.weights.find((item) => item.partId === 'legL')!
    const torsoWeights = set.weights.find((item) => item.partId === 'torso')!
    expect(armWeights.influences).toBe(4)
    expect(legWeights.influences).toBe(4)
    expect(torsoWeights.influences).toBe(5)
    const vertexCount = arm.positions.length / 3
    expect(armWeights.weights.length).toBe(vertexCount * 4)
    expect(armWeights.twistU.length).toBe(vertexCount)
    for (let v = 0; v < vertexCount; v += 1) {
      let sum = 0
      for (let c = 0; c < 4; c += 1) {
        const weight = armWeights.weights[v * 4 + c]!
        expect(weight).toBeGreaterThanOrEqual(0)
        sum += weight
      }
      expectClose(sum, 1)
      expect(armWeights.twistU[v]!).toBeGreaterThanOrEqual(0)
      expect(armWeights.twistU[v]!).toBeLessThanOrEqual(1)
    }

    const p = humanoid.proportions
    const shoulderY = p.hipHeight + p.spineLength + p.chestLength - p.shoulderDropY
    const elbowY = shoulderY - p.upperArmLength
    const forearmY = elbowY - p.lowerArmLength / AXIAL_STEPS

    let chest = 0
    let collarMid = 0
    let elbow = 0
    let forearm = 0
    let hand = 0
    for (let v = 0; v < vertexCount; v += 1) {
      const column = (slot: number) => armWeights.weights[v * 4 + slot]!
      const head = arm.endShare[v * 2]!
      const tail = arm.endShare[v * 2 + 1]!
      if (arm.seam[v] === 1 && head > 0.99) {
        expect(column(0)).toBeCloseTo(1, 5)
        expect(armWeights.twistU[v]!).toBeCloseTo(0, 5)
        chest += 1
      }
      if (Math.abs(head - 0.5) <= 1e-5) {
        expect(column(0)).toBeCloseTo(0.5, 5)
        expect(column(1)).toBeCloseTo(0.5, 5)
        collarMid += 1
      }
      const y = arm.positions[v * 3 + 1]!
      if (Math.abs(y - elbowY) <= 1e-5) {
        expect(column(1)).toBeCloseTo(0.5, 5)
        expect(column(2)).toBeCloseTo(0.5, 5)
        expect([0, 1]).toContain(Math.round(armWeights.twistU[v]!))
        elbow += 1
      }
      if (Math.abs(y - forearmY) <= 1e-5) {
        expect(column(1)).toBeCloseTo(0.25, 5)
        expect(column(2)).toBeCloseTo(0.75, 5)
        forearm += 1
      }
      if (arm.seam[v] === 1 && tail > 0.99) {
        expect(column(3)).toBeCloseTo(1, 5)
        expect(armWeights.twistU[v]!).toBeCloseTo(1, 5)
        hand += 1
      }
    }
    expect(chest).toBe(TUBE_SIDES)
    expect(collarMid).toBe(TUBE_SIDES)
    expect(elbow).toBe(TUBE_SIDES)
    expect(forearm).toBe(TUBE_SIDES)
    expect(hand).toBe(TUBE_SIDES)

    const leg = meshes.meshes.find((mesh) => mesh.partId === 'legL')!
    let hip = 0
    let foot = 0
    for (let v = 0; v < leg.positions.length / 3; v += 1) {
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
        expect(torsoWeights.weights[v * 5 + 4]!).toBeCloseTo(1, 5)
        head += 1
      }
      if (torso.seam[v] === 1 && torso.endShare[v * 2]! > 0.99) {
        expect(torsoWeights.weights[v * 5]!).toBeCloseTo(1, 5)
        pelvis += 1
      }
    }
    expect(head).toBe(TUBE_SIDES)
    expect(pelvis).toBe(TUBE_SIDES)
  })
})
