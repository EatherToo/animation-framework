import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { evaluateFk } from '@/fk/evaluate'
import { createPose, setPoseRotation, setPoseSwing, setPoseTranslation } from '@/skeleton/pose'
import { RIGID_STRIDE } from '@/skeleton/rigid'
import { expectClose, expectDiffers, expectSameBits } from '../math/assert'

describe('fk', () => {
  it('零偏移全身与绑定刚体按位相同，前缀只含骨盆', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const pose = createPose(compiled.skeleton)
    const count = compiled.skeleton.boneCount
    const full = new Float32Array(compiled.bindRig.length)
    evaluateFk(full, compiled, pose, count)
    expectSameBits(full, compiled.bindRig)

    const pelvis = new Float32Array(RIGID_STRIDE)
    evaluateFk(pelvis, compiled, pose, 1)
    expectClose(pelvis[10]!, humanoid.proportions.hipHeight)
    expect(pelvis[11]).toBe(0)
  })

  it('横向沿父链加总：左侧为正，右侧为负，链上后继沿用', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const p = humanoid.proportions
    const index = humanoid.boneIndex
    const count = compiled.skeleton.boneCount
    const fk = new Float32Array(count * RIGID_STRIDE)
    evaluateFk(fk, compiled, createPose(compiled.skeleton), count)
    const z = (name: keyof typeof index) => fk[index[name] * RIGID_STRIDE + 11]!

    for (const name of ['pelvis', 'spine', 'chest', 'neck', 'head'] as const) {
      expect(z(name)).toBe(0)
    }
    for (const name of ['thighL', 'shinL', 'footL'] as const) {
      expectClose(z(name), p.hipOffsetZ)
    }
    for (const name of ['thighR', 'shinR', 'footR'] as const) {
      expectClose(z(name), -p.hipOffsetZ)
    }
    for (const name of ['upperArmL', 'lowerArmL', 'handL'] as const) {
      expectClose(z(name), p.shoulderOffsetZ)
    }
    for (const name of ['upperArmR', 'lowerArmR', 'handR'] as const) {
      expectClose(z(name), -p.shoulderOffsetZ)
    }
  })

  it('步行偏移改刚体，不改横向', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const count = compiled.skeleton.boneCount
    const rest = new Float32Array(count * RIGID_STRIDE)
    const pose = createPose(compiled.skeleton)
    evaluateFk(rest, compiled, pose, count)

    setPoseTranslation(pose, humanoid.boneIndex.pelvis, 0.3, -0.1)
    setPoseRotation(pose, humanoid.boneIndex.thighL, 0.6)
    setPoseRotation(pose, humanoid.boneIndex.upperArmR, -0.4)
    const moved = new Float32Array(count * RIGID_STRIDE)
    evaluateFk(moved, compiled, pose, count)
    expectDiffers(moved, rest)
    for (let bone = 0; bone < count; bone += 1) {
      expect(Object.is(moved[bone * RIGID_STRIDE + 11], rest[bone * RIGID_STRIDE + 11])).toBe(true)
    }
  })

  it('肘的正角把腕弯向身前，膝的负角把踝弯向身后', () => {
    const humanoid = createHumanoid(1.8)
    const compiled = compileHumanoid(humanoid)
    const index = humanoid.boneIndex
    const pose = createPose(compiled.skeleton)
    const count = compiled.skeleton.boneCount
    const at = (fk: Float32Array, bone: number) => ({
      x: fk[bone * RIGID_STRIDE + 9]!,
      y: fk[bone * RIGID_STRIDE + 10]!,
    })
    const rest = new Float32Array(count * RIGID_STRIDE)
    evaluateFk(rest, compiled, pose, count)
    const wrist0 = at(rest, index.handL)
    const ankle0 = at(rest, index.footL)

    setPoseRotation(pose, index.lowerArmL, (40 * Math.PI) / 180)
    const flexed = new Float32Array(count * RIGID_STRIDE)
    evaluateFk(flexed, compiled, pose, count)
    expect(at(flexed, index.handL).x).toBeGreaterThan(wrist0.x + 0.1)

    setPoseRotation(pose, index.lowerArmL, 0)
    setPoseRotation(pose, index.shinL, (-40 * Math.PI) / 180)
    const knee = new Float32Array(count * RIGID_STRIDE)
    evaluateFk(knee, compiled, pose, count)
    expect(at(knee, index.footL).x).toBeLessThan(ankle0.x - 0.1)
  })

  it('左肩正侧摆把肘推向 +Z，右肩相反', () => {
    const humanoid = createHumanoid(1.8)
    const compiled = compileHumanoid(humanoid)
    const index = humanoid.boneIndex
    const pose = createPose(compiled.skeleton)
    const count = compiled.skeleton.boneCount
    const zOf = (fk: Float32Array, bone: number) => fk[bone * RIGID_STRIDE + 11]!
    const rest = new Float32Array(count * RIGID_STRIDE)
    evaluateFk(rest, compiled, pose, count)

    setPoseSwing(pose, index.upperArmL, 0.6)
    const left = new Float32Array(count * RIGID_STRIDE)
    evaluateFk(left, compiled, pose, count)
    expect(zOf(left, index.lowerArmL)).toBeGreaterThan(zOf(rest, index.lowerArmL) + 0.05)

    setPoseSwing(pose, index.upperArmL, 0)
    setPoseSwing(pose, index.upperArmR, 0.6)
    const right = new Float32Array(count * RIGID_STRIDE)
    evaluateFk(right, compiled, pose, count)
    expect(zOf(right, index.lowerArmR)).toBeLessThan(zOf(rest, index.lowerArmR) - 0.05)
  })

  it('姿态不属于这棵骨架时不写 out', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const other = createPose(createHumanoid(1.8).skeleton)
    const out = new Float32Array(RIGID_STRIDE).fill(4)
    expect(() => evaluateFk(out, compiled, other, 1)).toThrow(/^pose$/)
    expect(out.every((value) => value === 4)).toBe(true)
  })

  it('count 与 out 依次检查，失败时不写 out', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const pose = createPose(compiled.skeleton)
    const count = compiled.skeleton.boneCount
    const out = new Float32Array(RIGID_STRIDE).fill(4)
    expect(() => evaluateFk(out, compiled, pose, 0)).toThrow(/^count$/)
    expect(() => evaluateFk(out, compiled, pose, 1.5)).toThrow(/^count$/)
    expect(() => evaluateFk(out, compiled, pose, count + 1)).toThrow(/^count$/)
    expect(() => evaluateFk(new Float32Array(RIGID_STRIDE - 1), compiled, pose, 1)).toThrow(/^out$/)
    expect(out.every((value) => value === 4)).toBe(true)
  })
})
