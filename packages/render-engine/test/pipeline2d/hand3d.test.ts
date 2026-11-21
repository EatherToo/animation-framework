import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { evaluateFk } from '@/fk/evaluate'
import { buildHandVolumeParts } from '@/pipeline2d'
import { createPose, setPoseRotation } from '@/skeleton/pose'

function setup(): { compiled: ReturnType<typeof compileHumanoid>; pose: ReturnType<typeof createPose>; fk: Float32Array } {
  const humanoid = createHumanoid(1.8)
  const compiled = compileHumanoid(humanoid)
  const pose = createPose(compiled.skeleton)
  const fk = new Float32Array(compiled.skeleton.boneCount * 12)
  evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
  return { compiled, pose, fk }
}

describe('pipeline2d hand3d', () => {
  it('360 手代理：掌 + 14 指骨段，顶点有限', () => {
    const { compiled, fk } = setup()
    const parts = buildHandVolumeParts(compiled, fk, 90, 'L')
    expect(parts).toHaveLength(15)
    for (const part of parts) {
      expect(part.positions.length).toBeGreaterThan(0)
      expect(part.indices.length % 3).toBe(0)
      for (const value of part.positions) expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('指骨弯曲会改变 360 手代理', () => {
    const { compiled, pose, fk } = setup()
    const before = buildHandVolumeParts(compiled, fk, 90, 'L').map((part) => Array.from(part.positions))
    setPoseRotation(pose, compiled.skeleton.name.indexOf('index1L'), 1.2)
    evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
    const after = buildHandVolumeParts(compiled, fk, 90, 'L').map((part) => Array.from(part.positions))
    expect(after).not.toEqual(before)
  })
})
