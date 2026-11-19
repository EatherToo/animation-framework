import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { evaluateFk } from '@/fk/evaluate'
import { createVec2 } from '@/math/vec2'
import { beginStep, createStepPlan, finishStep, PLAN_HIP_DROP_RATIO, suspendPlan } from '@/plan/plan'
import { createPlacement } from '@/place/place'
import { reachFootfall } from '@/reach/reach'
import { bindTranslation } from '@/skeleton/skeleton'
import { createPose, setPoseTranslation } from '@/skeleton/pose'
import { worldToRigPoint } from '@/space/world-point'

function footContact(compiled: ReturnType<typeof compileHumanoid>, bone: number) {
  const pose = createPose(compiled.skeleton)
  const fk = new Float32Array(compiled.bindRig.length)
  evaluateFk(fk, new Float32Array(compiled.skeleton.boneCount), compiled, pose, compiled.skeleton.boneCount)
  return {
    x: fk[bone * 9 + 6]!,
    y: fk[bone * 9 + 7]! - compiled.foot.ankleHeight,
  }
}

describe('plan', () => {
  it('暂停时不锁存，过长的候选会被裁短并留在余量内', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const stance = footContact(compiled, humanoid.chains.legR.end)
    const plan = createStepPlan('right', stance.x, stance.y)
    const placement = createPlacement()
    const pose = createPose(compiled.skeleton)
    suspendPlan(plan)
    expect(
      beginStep(plan, compiled, pose, placement, 1, { cadence: 2, stepLength: 5, duty: 0.62, froude: 0.1 }, humanoid.chains.legL),
    ).toBe(false)
    expect(plan.active).toBeNull()

    plan.suspended = false
    const before = Array.from(pose.data)
    expect(
      beginStep(plan, compiled, pose, placement, 1, { cadence: 2, stepLength: 5, duty: 0.62, froude: 0.1 }, humanoid.chains.legL),
    ).toBe(true)
    const active = plan.active
    expect(active).not.toBeNull()
    expect(Math.abs(active!.stepLength)).toBeGreaterThan(0)
    expect(Math.abs(active!.stepLength)).toBeLessThan(5)
    expect(active!.contactX).toBe(stance.x + active!.stepLength)
    expect(active!.contactY).toBe(0)
    expect(active!.duration).toBe(0.5)
    expect(active!.foot).toBe('left')
    expect(Array.from(pose.data)).toEqual(before)

    const bind = bindTranslation(createVec2(), compiled.skeleton, 0)
    const contact = worldToRigPoint(createVec2(), Float64Array.from([active!.contactX, active!.contactY]), placement.origin, 1)
    const stanceRig = worldToRigPoint(createVec2(), Float64Array.from([stance.x, stance.y]), placement.origin, 1)
    const probe = createPose(compiled.skeleton)
    setPoseTranslation(
      probe,
      0,
      (stanceRig[0]! + contact[0]!) / 2 - bind[0]!,
      bind[1]! - PLAN_HIP_DROP_RATIO * compiled.proportions.legLength - bind[1]!,
    )
    const reached = reachFootfall(
      compiled,
      probe,
      humanoid.chains.legL,
      contact[0]!,
      contact[1]!,
      0,
      -compiled.foot.ankleHeight,
      0,
    )
    expect(reached.reached).toBe(true)
    expect(reached.withinMargin).toBe(true)

    expect(
      beginStep(plan, compiled, pose, placement, 1, { cadence: 2, stepLength: 1, duty: 0.62, froude: 0.1 }, humanoid.chains.legL),
    ).toBe(false)
    expect(plan.active).toBe(active)
  })

  it('一步结束后换脚', () => {
    const humanoid = createHumanoid(1.7)
    const compiled = compileHumanoid(humanoid)
    const stance = footContact(compiled, humanoid.chains.legR.end)
    const plan = createStepPlan('right', stance.x, stance.y)
    beginStep(
      plan,
      compiled,
      createPose(compiled.skeleton),
      createPlacement(),
      1,
      { cadence: 2, stepLength: 5, duty: 0.62, froude: 0.1 },
      humanoid.chains.legL,
    )
    const landed = plan.active!
    finishStep(plan)
    expect(plan.active).toBeNull()
    expect(plan.stanceFoot).toBe('left')
    expect(plan.nextFoot).toBe('right')
    expect(plan.stanceX).toBe(landed.contactX)
    expect(plan.stanceY).toBe(landed.contactY)
    expect(() => finishStep(plan)).toThrow(/^active$/)
  })
})
