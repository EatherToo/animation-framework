import { describe, expect, it } from '@jest/globals'
import { createBinding, createMemoryLayer, updateBinding } from '@/bind/bind'
import { createHumanoid } from '@/body/assemble'
import { debugView, readDiagnostics } from '@/diag/diag'
import { evaluateFk } from '@/fk/evaluate'
import { setCrouch, setSpeed, stepParams } from '@/params/params'
import { createSolver, stepSolver, type Solver } from '@/solve/solve'
import { findBone } from '@/skeleton/skeleton'
import { strokeContours } from '@/stroke/stroke'
import { presentPose } from '../view/present'

const DT = 1 / 60

function warm(solver: Solver): void {
  setSpeed(solver.params, 1.2)
  for (let i = 0; i < 90; i += 1) stepParams(solver.params, DT)
}

describe('diagnostics', () => {
  it('站立时计划速度为零，支撑残差接近零', () => {
    const solver = createSolver(createHumanoid(1.7))
    const pose = Array.from(solver.pose.data)
    const readout = readDiagnostics(solver)
    expect(readout.plannedSpeed).toBe(0)
    expect(readout.contactResidual).toBeCloseTo(0, 3)
    expect(readout.reachMargin).toBeLessThan(0)
    expect(Array.from(solver.pose.data)).toEqual(pose)
  })

  it('行走中的计划速度等于当前速度，蹲伏增大可达余量', () => {
    const solver = createSolver(createHumanoid(1.7))
    const standing = readDiagnostics(solver).reachMargin
    warm(solver)
    setCrouch(solver.params, 1)
    for (let i = 0; i < 30; i += 1) stepSolver(solver, DT)
    const readout = readDiagnostics(solver)
    expect(readout.plannedSpeed).toBeCloseTo(solver.params.current.speed, 5)
    expect(readout.contactResidual).toBeCloseTo(0, 3)
    expect(readout.reachMargin).toBeGreaterThan(standing)
  })

  it('调试几何不写入产品绑定', () => {
    const solver = createSolver(createHumanoid(1.7))
    warm(solver)
    stepSolver(solver, 0.2)
    const pose = Array.from(solver.pose.data)
    const layer = createMemoryLayer()
    const binding = createBinding(layer)
    const { filled, order } = presentPose(solver.compiled, solver.pose, 0)
    updateBinding(binding, filled, strokeContours(filled, true), order)
    const kept = layer.objects.slice()
    const positions = Array.from(kept[0]!.positions)

    const view = debugView(solver)
    const active = solver.plan.active
    expect(active).not.toBeNull()
    expect(view.bones).toHaveLength(solver.compiled.skeleton.boneCount - 1)
    const thighL = findBone(solver.pose.skeleton, 'thighL')
    const hipSegment = view.bones[thighL - 1]!
    expect(hipSegment.z0).toBe(0)
    expect(hipSegment.z1).toBeCloseTo(solver.compiled.proportions.hipOffsetZ, 6)
    const shinSegment = view.bones[findBone(solver.pose.skeleton, 'shinL') - 1]!
    expect(shinSegment.z0).toBe(shinSegment.z1)
    expect(view.contacts).toHaveLength(1)
    expect(view.contacts[0]!.x).toBeCloseTo(solver.plan.stanceX, 3)
    expect(view.prints).toHaveLength(2)
    expect(view.footfalls).toHaveLength(1)
    expect(view.footfalls[0]!.x).toBeCloseTo(active!.contactX, 5)
    expect(view.wire).toHaveLength(solver.compiled.meshes.meshes.length)
    expect(view.wire[0]!.positions.length).toBe(solver.compiled.meshes.meshes[0]!.positions.length)
    expect(view.weights.length).toBeGreaterThan(0)
    for (const part of view.weights) {
      expect(part.values.length).toBe(part.positions.length / 3)
      for (const value of part.values) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    }

    const fk = new Float32Array(solver.compiled.skeleton.boneCount * 12)
    evaluateFk(fk, solver.compiled, solver.pose, solver.compiled.skeleton.boneCount)
    const hip = thighL * 12
    const radius = solver.compiled.proportions.legLength
    expect(view.envelope.length).toBeGreaterThanOrEqual(8)
    const end = view.envelope[0]!
    const used = Math.hypot(end.x0 - fk[hip + 9]!, end.y0 - fk[hip + 10]!)
    expect(used).toBeCloseTo(radius, 5)

    expect(layer.objects).toEqual(kept)
    expect(Array.from(layer.objects[0]!.positions)).toEqual(positions)
    expect(Array.from(solver.pose.data)).toEqual(pose)
  })
})
