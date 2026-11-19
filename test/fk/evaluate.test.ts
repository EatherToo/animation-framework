import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { evaluateFk } from '@/fk/evaluate'
import { createPose, setPoseRotation, setPoseTranslation } from '@/skeleton/pose'
import { expectClose, expectDiffers, expectSameBits } from '../math/assert'

describe('fk', () => {
  it('零偏移全身与绑定矩阵按位相同，前缀只含骨盆', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const pose = createPose(compiled.skeleton)
    const count = compiled.skeleton.boneCount
    const full = new Float32Array(compiled.bindRig.length)
    const lateral = new Float32Array(count)
    evaluateFk(full, lateral, compiled, pose, count)
    expectSameBits(full, compiled.bindRig)
    expectSameBits(lateral, compiled.lateralBind)

    const pelvis = new Float32Array(9)
    const pelvisLateral = new Float32Array(1).fill(7)
    evaluateFk(pelvis, pelvisLateral, compiled, pose, 1)
    expectClose(pelvis[7]!, humanoid.proportions.hipHeight)
    expect(pelvisLateral[0]).toBe(0)
  })

  it('横向沿父链加总：左侧为正，右侧为负，链上后继沿用', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const p = humanoid.proportions
    const index = humanoid.boneIndex
    const count = compiled.skeleton.boneCount
    const lateral = new Float32Array(count)
    evaluateFk(new Float32Array(count * 9), lateral, compiled, createPose(compiled.skeleton), count)

    for (const name of ['pelvis', 'spine', 'chest', 'neck', 'head'] as const) {
      expect(lateral[index[name]]).toBe(0)
    }
    for (const name of ['thighL', 'shinL', 'footL'] as const) {
      expectClose(lateral[index[name]]!, p.hipOffsetZ)
    }
    for (const name of ['thighR', 'shinR', 'footR'] as const) {
      expectClose(lateral[index[name]]!, -p.hipOffsetZ)
    }
    for (const name of ['upperArmL', 'lowerArmL', 'handL'] as const) {
      expectClose(lateral[index[name]]!, p.shoulderOffsetZ)
    }
    for (const name of ['upperArmR', 'lowerArmR', 'handR'] as const) {
      expectClose(lateral[index[name]]!, -p.shoulderOffsetZ)
    }
  })

  it('步行偏移改矩阵，不改横向', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const count = compiled.skeleton.boneCount
    const rest = new Float32Array(count * 9)
    const restLateral = new Float32Array(count)
    const pose = createPose(compiled.skeleton)
    evaluateFk(rest, restLateral, compiled, pose, count)

    setPoseTranslation(pose, humanoid.boneIndex.pelvis, 0.3, -0.1)
    setPoseRotation(pose, humanoid.boneIndex.thighL, 0.6)
    setPoseRotation(pose, humanoid.boneIndex.upperArmR, -0.4)
    const moved = new Float32Array(count * 9)
    const movedLateral = new Float32Array(count)
    evaluateFk(moved, movedLateral, compiled, pose, count)
    expectDiffers(moved, rest)
    expectSameBits(movedLateral, restLateral)
  })

  it('姿态不属于这棵骨架时不写 out', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const other = createPose(createHumanoid(1.8).skeleton)
    const out = new Float32Array(9).fill(4)
    const lateral = new Float32Array(1).fill(5)
    expect(() => evaluateFk(out, lateral, compiled, other, 1)).toThrow(/^pose$/)
    expect(out[0]).toBe(4)
    expect(lateral[0]).toBe(5)
  })

  it('count、out、lateral 依次检查，失败时两个缓冲都不写', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const pose = createPose(compiled.skeleton)
    const count = compiled.skeleton.boneCount
    const out = new Float32Array(9).fill(4)
    const lateral = new Float32Array(1).fill(5)
    expect(() => evaluateFk(out, lateral, compiled, pose, 0)).toThrow(/^count$/)
    expect(() => evaluateFk(out, lateral, compiled, pose, 1.5)).toThrow(/^count$/)
    expect(() => evaluateFk(out, lateral, compiled, pose, count + 1)).toThrow(/^count$/)
    expect(() => evaluateFk(out, new Float32Array(2), compiled, pose, 2)).toThrow(/^out$/)
    expect(() => evaluateFk(new Float32Array(8), new Float32Array(2), compiled, pose, 1)).toThrow(
      /^out$/,
    )
    const two = new Float32Array(2).fill(6)
    expect(() => evaluateFk(out, two, compiled, pose, 1)).toThrow(/^lateral$/)
    expect(Array.from(out)).toEqual(new Array(9).fill(4))
    expect(Array.from(lateral)).toEqual([5])
    expect(Array.from(two)).toEqual([6, 6])
  })
})
