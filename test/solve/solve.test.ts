import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { evaluateFk } from '@/fk/evaluate'
import { setSpeed } from '@/params/params'
import { createSolver, stepSolver, type Solver } from '@/solve/solve'
import { findBone } from '@/skeleton/skeleton'

function footY(solver: Solver, foot: 'left' | 'right'): number {
  const name = foot === 'left' ? 'footL' : 'footR'
  const bone = findBone(solver.pose.skeleton, name)
  const fk = new Float32Array(solver.pose.skeleton.boneCount * 9)
  evaluateFk(fk, solver.compiled, solver.pose, solver.pose.skeleton.boneCount)
  return fk[bone * 9 + 7]!
}

describe('solve', () => {
  it('速度为 0 时保持站姿，不产生新步', () => {
    const solver = createSolver(createHumanoid(1.7))
    const pose = Array.from(solver.pose.data)
    for (let i = 0; i < 10; i += 1) stepSolver(solver, 1 / 60)
    expect(solver.plan.active).toBeNull()
    expect(Array.from(solver.pose.data)).toEqual(pose)
  })

  it('向前走出一步，支撑落点不变，摆动脚离地，随后换脚', () => {
    const solver = createSolver(createHumanoid(1.7))
    setSpeed(solver.params, 1.2)
    stepSolver(solver, 0.3)
    const latched = solver.plan.active
    expect(latched).not.toBeNull()
    const swing = latched!.foot
    const pinX = solver.plan.stanceX
    const pinY = solver.plan.stanceY
    let lifted = false
    for (let i = 0; i < 20 && solver.plan.active === latched; i += 1) {
      stepSolver(solver, 0.05)
      if (solver.plan.active !== latched) break
      expect(solver.plan.stanceX).toBe(pinX)
      expect(solver.plan.stanceY).toBe(pinY)
      const other = swing === 'left' ? 'right' : 'left'
      if (
        solver.plan.active === latched &&
        solver.stepTime > latched!.duty * latched!.duration &&
        footY(solver, swing) > footY(solver, other) + 0.02
      ) {
        lifted = true
      }
    }
    expect(lifted).toBe(true)
    for (let i = 0; i < 40; i += 1) {
      if (solver.plan.active && solver.plan.active.foot !== swing) break
      stepSolver(solver, 0.05)
    }
    expect(solver.plan.active).not.toBeNull()
    expect(solver.plan.active!.foot).not.toBe(swing)
  })

  it('速度反向时先停止，不在同一步里改步长符号', () => {
    const solver = createSolver(createHumanoid(1.7))
    setSpeed(solver.params, 1.2)
    stepSolver(solver, 0.3)
    const latched = solver.plan.active
    expect(latched).not.toBeNull()
    const sign = Math.sign(latched!.stepLength)
    setSpeed(solver.params, -1.2)
    let stopped = false
    for (let i = 0; i < 12 && solver.plan.active === latched; i += 1) {
      stepSolver(solver, 0.05)
      const active = solver.plan.active
      if (solver.gait.mode === 'stop' && active === latched && active) {
        expect(Math.sign(active.stepLength)).toBe(sign)
        stopped = true
        break
      }
    }
    expect(stopped).toBe(true)
  })

  it('落点超出腿长时已提交姿态不变，并进入恢复', () => {
    const solver = createSolver(createHumanoid(1.7))
    setSpeed(solver.params, 1.2)
    stepSolver(solver, 0.3)
    expect(solver.plan.active).not.toBeNull()
    const before = Array.from(solver.pose.data)
    const active = solver.plan.active as { contactX: number }
    active.contactX = solver.plan.stanceX + 5
    stepSolver(solver, 0.05)
    expect(Array.from(solver.pose.data)).toEqual(before)
    expect(solver.recovery.active).toBe(true)
  })
})
