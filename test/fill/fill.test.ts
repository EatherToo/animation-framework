import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { fillPose } from '@/fill/fill'
import { HUMANOID_FILL } from '@/part/humanoid'
import { createPose, setPoseRotation } from '@/skeleton/pose'
import { findBone } from '@/skeleton/skeleton'

describe('fill', () => {
  it('零偏移带着部件颜色，屈膝后左腿移动', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const pose = createPose(compiled.skeleton)
    const rest = fillPose(compiled, pose)
    const restLeg = rest.find((part) => part.partId === 'legL')!
    expect(restLeg.fill.r).toBe(HUMANOID_FILL.legL.r)
    expect(restLeg.fill.g).toBe(HUMANOID_FILL.legL.g)
    expect(restLeg.fill.b).toBe(HUMANOID_FILL.legL.b)
    expect(Object.is(restLeg.fill.r, compiled.parts.parts.find((part) => part.id === 'legL')!.fill.r)).toBe(
      true,
    )

    setPoseRotation(pose, findBone(compiled.skeleton, 'shinL'), -0.8)
    const bent = fillPose(compiled, pose)
    const bentLeg = bent.find((part) => part.partId === 'legL')!
    let moved = false
    for (let i = 0; i < restLeg.positions.length; i += 1) {
      if (Math.abs(restLeg.positions[i]! - bentLeg.positions[i]!) > 1e-3) moved = true
    }
    expect(moved).toBe(true)
    expect(bentLeg.fill).toEqual(restLeg.fill)
  })
})
