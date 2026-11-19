import { describe, expect, it } from '@jest/globals'
import { createBinding, createMemoryLayer, updateBinding } from '@/bind/bind'
import { createHumanoid } from '@/body/assemble'
import { createContactLog, pullContacts, recordContacts, type ContactLog } from '@/event/event'
import { fillPose } from '@/fill/fill'
import { setSpeed, stepParams } from '@/params/params'
import { setPlacement } from '@/place/place'
import { captureRenderFrame, type RenderFrame } from '@/render/sample'
import { captureSnapshot, restoreSnapshot, type RenderPair } from '@/snapshot/snapshot'
import { createPose, setPoseRotation } from '@/skeleton/pose'
import { findBone } from '@/skeleton/skeleton'
import { createSolver, stepSolver, type Solver } from '@/solve/solve'
import { strokeContours } from '@/stroke/stroke'
import { drawOrder } from '@/slot/slot'

const DT = 1 / 60

function boot(): { solver: Solver; pair: RenderPair; log: ContactLog } {
  const solver = createSolver(createHumanoid(1.7))
  const log = createContactLog()
  setSpeed(solver.params, 1.2)
  for (let i = 0; i < 90; i += 1) stepParams(solver.params, DT)
  for (let i = 0; i < 25; i += 1) {
    const before = solver.events
    stepSolver(solver, DT)
    if (solver.events !== before) recordContacts(log, solver.events)
  }
  return {
    solver,
    log,
    pair: { before: captureRenderFrame(solver), after: captureRenderFrame(solver) },
  }
}

describe('snapshot', () => {
  it('写回后与抄下时一致，且不碰显示对象', () => {
    const { solver, pair, log } = boot()
    expect(log.pending.length).toBeGreaterThan(0)
    const shot = captureSnapshot(solver, log, pair)
    const pose = Array.from(solver.pose.data)
    const speed = solver.params.current.speed
    const generation = solver.placement.generation
    const originX = solver.placement.origin[0]!
    const mode = solver.gait.mode
    const stanceX = solver.plan.stanceX
    const recovering = solver.recovery.active
    const pending = log.pending.map((event) => ({ ...event }))
    const beforePose = Array.from(pair.before.pose.data)
    const afterTime = pair.after.stepTime

    const layer = createMemoryLayer()
    const binding = createBinding(layer)
    const order = drawOrder(new Array<string>(solver.compiled.slots.slots.length), solver.compiled.slots, 1)
    const filled = fillPose(solver.compiled, solver.pose)
    updateBinding(binding, filled, strokeContours(filled, true), order)
    const bent = createPose(solver.pose.skeleton)
    bent.data.set(solver.pose.data)
    setPoseRotation(bent, findBone(solver.pose.skeleton, 'shinL'), -0.6)
    const next = fillPose(solver.compiled, bent)
    updateBinding(binding, next, strokeContours(next, true), order)
    const shown = Array.from(layer.objects[0]!.positions)

    setPlacement(solver.placement, 4, 1, 0, generation + 1)
    setSpeed(solver.params, 0)
    for (let i = 0; i < 5; i += 1) {
      const previous = solver.events
      stepSolver(solver, DT)
      if (solver.events !== previous) recordContacts(log, solver.events)
    }
    pullContacts(log)
    pair.before = captureRenderFrame(solver)
    pair.after = captureRenderFrame(solver)
    expect(Array.from(shot.pose)).toEqual(pose)

    restoreSnapshot(solver, log, pair, shot)
    expect(Array.from(solver.pose.data)).toEqual(pose)
    expect(solver.params.current.speed).toBe(speed)
    expect(solver.placement.generation).toBe(generation)
    expect(solver.placement.origin[0]).toBe(originX)
    expect(solver.gait.mode).toBe(mode)
    expect(solver.plan.stanceX).toBe(stanceX)
    expect(solver.recovery.active).toBe(recovering)
    expect(log.pending).toEqual(pending)
    expect(Array.from(pair.before.pose.data)).toEqual(beforePose)
    expect(pair.after.stepTime).toBe(afterTime)
    expect(Array.from(layer.objects[0]!.positions)).toEqual(shown)
  })

  it('快照不合法时整份不动', () => {
    const { solver, pair, log } = boot()
    const shot = captureSnapshot(solver, log, pair)
    const pose = Array.from(solver.pose.data)
    const pending = log.pending.map((event) => ({ ...event }))
    const frame: RenderFrame = pair.before
    expect(() => restoreSnapshot(solver, log, pair, { ...shot, pose: new Float32Array(1) })).toThrow(/^pose$/)
    expect(Array.from(solver.pose.data)).toEqual(pose)
    expect(log.pending).toEqual(pending)
    expect(pair.before).toBe(frame)
  })
})
