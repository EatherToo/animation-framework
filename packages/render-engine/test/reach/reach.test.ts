import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { evaluateFk } from '@/fk/evaluate'
import { solveTwoBone } from '@/ik/solve'
import { reachAnkle, reachFootfall, reachStance } from '@/reach/reach'
import { createPose, setPoseTranslation } from '@/skeleton/pose'
import { expectClose } from '../math/assert'

function boneOrigin(
  compiled: ReturnType<typeof compileHumanoid>,
  pose: ReturnType<typeof createPose>,
  bone: number,
) {
  const fk = new Float32Array(compiled.bindRig.length)
  evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
  return { x: fk[bone * 12 + 9]!, y: fk[bone * 12 + 10]! }
}

describe('reach', () => {
  it('绑定站立够得到，但不在规划余量内', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const pose = createPose(compiled.skeleton)
    const chain = humanoid.chains.legL
    const hip = boneOrigin(compiled, pose, chain.root)
    const ankle = boneOrigin(compiled, pose, chain.end)
    const result = reachAnkle(compiled, chain, hip.x, hip.y, ankle.x, ankle.y)
    expect(result.reached).toBe(true)
    expect(result.withinMargin).toBe(false)
    expectClose(result.distance, humanoid.proportions.legLength, 1e-4)
  })

  it('落点查询不改姿态，绑定双脚站姿成立', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const pose = createPose(compiled.skeleton)
    const soleY = -humanoid.proportions.ankleHeight
    const leftAnkle = boneOrigin(compiled, pose, humanoid.chains.legL.end)
    const rightAnkle = boneOrigin(compiled, pose, humanoid.chains.legR.end)
    const before = Array.from(pose.data)
    const footfall = reachFootfall(
      compiled,
      pose,
      humanoid.chains.legL,
      leftAnkle.x,
      leftAnkle.y - humanoid.proportions.ankleHeight,
      0,
      soleY,
      0,
    )
    expect(footfall.reached).toBe(true)
    expect(Array.from(pose.data)).toEqual(before)

    const pelvis = boneOrigin(compiled, pose, 0)
    expect(
      reachStance(
        compiled,
        humanoid.chains.legL,
        humanoid.chains.legR,
        pelvis.x,
        pelvis.y,
        0,
        leftAnkle.x,
        leftAnkle.y - humanoid.proportions.ankleHeight,
        rightAnkle.x,
        rightAnkle.y - humanoid.proportions.ankleHeight,
        0,
        soleY,
        0,
      ),
    ).toBe(true)
  })

  it('降低骨盆后仍够得到并进入余量，过高或单侧过远则不成立', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const pose = createPose(compiled.skeleton)
    const pelvis = boneOrigin(compiled, pose, 0)
    const left = boneOrigin(compiled, pose, humanoid.chains.legL.end)
    const right = boneOrigin(compiled, pose, humanoid.chains.legR.end)
    const soleY = -humanoid.proportions.ankleHeight
    const leftX = left.x
    const leftY = left.y - humanoid.proportions.ankleHeight
    const rightX = right.x
    const rightY = right.y - humanoid.proportions.ankleHeight
    expect(
      reachStance(
        compiled,
        humanoid.chains.legL,
        humanoid.chains.legR,
        pelvis.x,
        pelvis.y - 0.2,
        0,
        leftX,
        leftY,
        rightX,
        rightY,
        0,
        soleY,
        0,
      ),
    ).toBe(true)

    const hip = boneOrigin(compiled, pose, humanoid.chains.legL.root)
    const lowered = reachAnkle(compiled, humanoid.chains.legL, hip.x, hip.y - 0.2, left.x, left.y)
    expect(lowered.reached).toBe(true)
    expect(lowered.withinMargin).toBe(true)

    expect(
      reachStance(
        compiled,
        humanoid.chains.legL,
        humanoid.chains.legR,
        pelvis.x,
        pelvis.y + 0.5,
        0,
        leftX,
        leftY,
        rightX,
        rightY,
        0,
        soleY,
        0,
      ),
    ).toBe(false)
    expect(
      reachStance(
        compiled,
        humanoid.chains.legL,
        humanoid.chains.legR,
        pelvis.x,
        pelvis.y,
        0,
        leftX + 2,
        leftY,
        rightX,
        rightY,
        0,
        soleY,
        0,
      ),
    ).toBe(false)
  })

  it('降低骨盆后反解的左踝落在目标上', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const pose = createPose(compiled.skeleton)
    const pelvis = boneOrigin(compiled, pose, 0)
    setPoseTranslation(pose, 0, 0, -0.2)
    const chain = humanoid.chains.legL
    const ankle = boneOrigin(compiled, createPose(compiled.skeleton), chain.end)
    const solved = solveTwoBone(pose, compiled, chain, ankle.x, ankle.y)
    expect(solved.reached).toBe(true)
    const landed = boneOrigin(compiled, pose, chain.end)
    expectClose(landed.x, ankle.x, 1e-4)
    expectClose(landed.y, ankle.y, 1e-4)
    expect(pelvis.y).toBeGreaterThan(0)
  })
})
