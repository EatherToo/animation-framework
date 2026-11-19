import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { evaluateFk } from '@/fk/evaluate'
import { setFacing, setSpeed, stepParams } from '@/params/params'
import { setPlacement } from '@/place/place'
import { captureRenderFrame, sampleRender } from '@/render/sample'
import { createSolver, stepSolver, type Solver } from '@/solve/solve'
import { findBone } from '@/skeleton/skeleton'
import { projectParts } from '@/view/project'

function warm(solver: Solver): void {
  setSpeed(solver.params, 1.2)
  for (let i = 0; i < 90; i += 1) stepParams(solver.params, 1 / 60)
}

function footY(solver: Solver, poseData: Float32Array, foot: 'left' | 'right'): number {
  const pose = solver.pose
  const saved = pose.data.slice()
  pose.data.set(poseData)
  const fk = new Float32Array(solver.compiled.skeleton.boneCount * 9)
  evaluateFk(fk, new Float32Array(solver.compiled.skeleton.boneCount), solver.compiled, pose, solver.compiled.skeleton.boneCount)
  pose.data.set(saved)
  const bone = findBone(pose.skeleton, foot === 'left' ? 'footL' : 'footR')
  return fk[bone * 9 + 7]!
}

function footX(solver: Solver, poseData: Float32Array, foot: 'left' | 'right'): number {
  const pose = solver.pose
  const saved = pose.data.slice()
  pose.data.set(poseData)
  const fk = new Float32Array(solver.compiled.skeleton.boneCount * 9)
  evaluateFk(fk, new Float32Array(solver.compiled.skeleton.boneCount), solver.compiled, pose, solver.compiled.skeleton.boneCount)
  pose.data.set(saved)
  const bone = findBone(pose.skeleton, foot === 'left' ? 'footL' : 'footR')
  return fk[bone * 9 + 6]!
}

describe('render sample', () => {
  it('站立取样不产生新步', () => {
    const solver = createSolver(createHumanoid(1.7))
    for (let i = 0; i < 5; i += 1) stepSolver(solver, 1 / 60)
    const before = captureRenderFrame(solver)
    const after = captureRenderFrame(solver)
    const pose = solver.pose.data.slice()
    const view = sampleRender(solver.compiled, before, after, 0.5)
    expect(view.snapped).toBe(false)
    expect(solver.plan.active).toBeNull()
    expect(Array.from(solver.pose.data)).toEqual(Array.from(pose))
    expect(view.order).toContain('legL')
  })

  it('同一步内两端贴合已提交姿态，中间抬脚且支撑不滑动', () => {
    const solver = createSolver(createHumanoid(1.7))
    warm(solver)
    stepSolver(solver, 0.3)
    const latched = solver.plan.active
    expect(latched).not.toBeNull()
    while (solver.plan.active === latched && solver.stepTime <= latched!.duty * latched!.duration) {
      stepSolver(solver, 0.02)
    }
    const before = captureRenderFrame(solver)
    stepSolver(solver, 0.04)
    expect(solver.plan.active).toBe(latched)
    const after = captureRenderFrame(solver)
    const pose = solver.pose.data.slice()
    const at0 = sampleRender(solver.compiled, before, after, 0)
    const at1 = sampleRender(solver.compiled, before, after, 1)
    const mid = sampleRender(solver.compiled, before, after, 0.5)
    expect(Array.from(at0.pose.data)).toEqual(Array.from(before.pose.data))
    expect(Array.from(at1.pose.data)).toEqual(Array.from(after.pose.data))
    const swing = latched!.foot
    const stance = swing === 'left' ? 'right' : 'left'
    const y0 = footY(solver, at0.pose.data, swing)
    const y1 = footY(solver, at1.pose.data, swing)
    const ym = footY(solver, mid.pose.data, swing)
    expect(ym).toBeGreaterThan(Math.min(y0, y1))
    expect(ym).toBeLessThan(Math.max(y0, y1))
    const x0 = footX(solver, at0.pose.data, stance)
    const x1 = footX(solver, at1.pose.data, stance)
    const xm = footX(solver, mid.pose.data, stance)
    expect(xm).toBeCloseTo(x0, 3)
    expect(xm).toBeCloseTo(x1, 3)
    expect(Array.from(solver.pose.data)).toEqual(Array.from(pose))
    expect(mid.parts.length).toBe(solver.compiled.meshes.meshes.length)
    for (let i = 0; i < mid.parts.length; i += 1) {
      const mesh = solver.compiled.meshes.meshes[i]!
      expect(mid.parts[i]!.positions.length).toBe(mesh.positions.length)
      expect(mid.parts[i]!.positions.length % 3).toBe(0)
      expect(mid.parts[i]!.indices).toBe(mesh.indices)
    }
  })

  it('朝向、传送和恢复开始都取新状态', () => {
    const solver = createSolver(createHumanoid(1.7))
    warm(solver)
    stepSolver(solver, 0.3)
    const facingBefore = captureRenderFrame(solver)
    setFacing(solver.params, -1)
    stepSolver(solver, 0.05)
    const facingAfter = captureRenderFrame(solver)
    const facingView = sampleRender(solver.compiled, facingBefore, facingAfter, 0.5)
    expect(facingView.snapped).toBe(true)
    expect(Array.from(facingView.pose.data)).toEqual(Array.from(facingAfter.pose.data))

    const teleportBefore = captureRenderFrame(solver)
    setPlacement(solver.placement, 0, 0, 0, solver.placement.generation + 1)
    stepSolver(solver, 0.05)
    const teleportAfter = captureRenderFrame(solver)
    const teleportView = sampleRender(solver.compiled, teleportBefore, teleportAfter, 0.5)
    expect(teleportView.snapped).toBe(true)
    expect(Array.from(teleportView.pose.data)).toEqual(Array.from(teleportAfter.pose.data))

    const walking = createSolver(createHumanoid(1.7))
    warm(walking)
    stepSolver(walking, 0.3)
    const recoverBefore = captureRenderFrame(walking)
    const active = walking.plan.active as { contactX: number }
    active.contactX = walking.plan.stanceX + 5
    stepSolver(walking, 0.05)
    const recoverAfter = captureRenderFrame(walking)
    expect(recoverAfter.recovering).toBe(true)
    const recoverView = sampleRender(walking.compiled, recoverBefore, recoverAfter, 0.5)
    expect(recoverView.snapped).toBe(true)
    expect(Array.from(recoverView.pose.data)).toEqual(Array.from(recoverAfter.pose.data))
  })

  it('同一对帧用两个视角投影，取样结果按位相同，换视角不算间断', () => {
    const solver = createSolver(createHumanoid(1.7))
    warm(solver)
    stepSolver(solver, 0.3)
    const before = captureRenderFrame(solver)
    stepSolver(solver, 0.02)
    const after = captureRenderFrame(solver)
    expect('view' in before).toBe(false)

    const first = sampleRender(solver.compiled, before, after, 0.5)
    const side = projectParts(first.parts, 0)
    const second = sampleRender(solver.compiled, before, after, 0.5)
    const back = projectParts(second.parts, 270)
    expect(first.snapped).toBe(false)
    expect(second.snapped).toBe(false)
    expect(Array.from(second.pose.data)).toEqual(Array.from(first.pose.data))
    expect(second.order).toEqual(first.order)
    for (let i = 0; i < first.parts.length; i += 1) {
      expect(Array.from(second.parts[i]!.positions)).toEqual(Array.from(first.parts[i]!.positions))
      expect(back[i]!.partId).toBe(side[i]!.partId)
    }
    const legL = first.parts.find((part) => part.partId === 'legL')!
    const legR = first.parts.find((part) => part.partId === 'legR')!
    expect(legL.positions[2]!).toBeGreaterThan(0)
    expect(legR.positions[2]!).toBeLessThan(0)
  })

  it('非法比例不改求解器', () => {
    const solver = createSolver(createHumanoid(1.7))
    const frame = captureRenderFrame(solver)
    const pose = solver.pose.data.slice()
    expect(() => sampleRender(solver.compiled, frame, frame, Number.NaN)).toThrow(/^alpha$/)
    expect(() => sampleRender(solver.compiled, frame, frame, 1.2)).toThrow(/^alpha$/)
    expect(Array.from(solver.pose.data)).toEqual(Array.from(pose))
  })
})
