import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { evaluateFk } from '@/fk/evaluate'
import { createPose } from '@/skeleton/pose'
import { expectClose, expectSameBits } from '../math/assert'

describe('fk', () => {
  it('零偏移全身与绑定矩阵按位相同，前缀只含骨盆', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const pose = createPose(compiled.skeleton)
    const full = new Float32Array(compiled.bindRig.length)
    evaluateFk(full, compiled, pose, compiled.skeleton.boneCount)
    expectSameBits(full, compiled.bindRig)

    const pelvis = new Float32Array(9)
    evaluateFk(pelvis, compiled, pose, 1)
    expectClose(pelvis[7]!, humanoid.proportions.hipHeight)
  })

  it('姿态不属于这棵骨架时不写 out', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const other = createPose(createHumanoid(1.8).skeleton)
    const out = new Float32Array(9).fill(4)
    expect(() => evaluateFk(out, compiled, other, 1)).toThrow(/^pose$/)
    expect(out[0]).toBe(4)
  })
})
