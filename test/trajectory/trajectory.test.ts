import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { ankleFromContact, lowestSoleOffset } from '@/foot/contact'
import { soleLocal } from '@/foot/shape'
import { createVec2 } from '@/math/vec2'
import type { LatchedStep } from '@/plan/plan'
import { createPlacement, setPlacement } from '@/place/place'
import { footTarget, ROLL_PITCH, SWING_CLEARANCE } from '@/trajectory/trajectory'
import { createWorldPoint, worldToRigPoint } from '@/space/world-point'

function step(stepLength: number, generation = 0): LatchedStep {
  return {
    foot: 'left',
    duration: 1,
    stepLength,
    duty: 0.6,
    contactX: 0.4,
    contactY: 0,
    generation,
  }
}

describe('trajectory', () => {
  const compiled = compileHumanoid(createHumanoid(1.7))
  const placement = createPlacement()

  it('前进支撑从正俯仰滚到负俯仰，落地又回到正俯仰', () => {
    expect(footTarget(compiled, placement, 1, step(0.3), 0, 0, 0).pitch).toBe(ROLL_PITCH)
    expect(footTarget(compiled, placement, 1, step(0.3), 0, 0, 0.6).pitch).toBe(-ROLL_PITCH)
    expect(footTarget(compiled, placement, 1, step(0.3), 0, 0, 1).pitch).toBe(ROLL_PITCH)
  })

  it('倒退时俯仰正负相反', () => {
    expect(footTarget(compiled, placement, 1, step(-0.3), 0, 0, 0).pitch).toBe(-ROLL_PITCH)
    expect(footTarget(compiled, placement, 1, step(-0.3), 0, 0, 0.6).pitch).toBe(ROLL_PITCH)
    expect(footTarget(compiled, placement, 1, step(-0.3), 0, 0, 1).pitch).toBe(-ROLL_PITCH)
  })

  it('摆动用平滑抬脚，间隙不是正弦', () => {
    const lifted = step(0.3)
    const start = footTarget(compiled, placement, 1, lifted, 0, 0, 0.6)
    const end = footTarget(compiled, placement, 1, lifted, 0, 0, 1)
    const u = 0.25
    const smooth = u * u * (3 - 2 * u)
    const bump = 16 * u * u * (1 - u) * (1 - u)
    const mid = footTarget(compiled, placement, 1, lifted, 0, 0, 0.6 + 0.4 * u)
    const expectedY = start.ankleY + (end.ankleY - start.ankleY) * smooth + SWING_CLEARANCE * bump
    expect(mid.ankleY).toBeCloseTo(expectedY, 5)
    const sineY =
      start.ankleY +
      (end.ankleY - start.ankleY) * Math.sin(Math.PI * u) +
      SWING_CLEARANCE * Math.sin(Math.PI * u)
    expect(Math.abs(mid.ankleY - expectedY)).toBeLessThan(Math.abs(mid.ankleY - sineY))
    const from = worldToRigPoint(createVec2(), createWorldPoint(), placement.origin, 1)
    const sole = soleLocal(createVec2(), compiled.foot, 1)
    const toe = ankleFromContact(createVec2(), from, sole, -ROLL_PITCH)
    expect(start.ankleX).toBeCloseTo(toe[0]!, 5)
  })

  it('脚底低于角色地面时被抬起', () => {
    const high = createPlacement()
    setPlacement(high, 0, -1, 0, 0)
    const mid = footTarget(compiled, high, 1, step(0.3), 0, 0, 0.8)
    const lowest = lowestSoleOffset(createVec2(), compiled.foot, mid.pitch)
    expect(mid.ankleY + lowest[1]!).toBeGreaterThanOrEqual(1 - 1e-4)
  })

  it('世代不一致不插值', () => {
    expect(() => footTarget(compiled, placement, 1, step(0.3, 1), 0, 0, 0.2)).toThrow(/^generation$/)
  })
})
