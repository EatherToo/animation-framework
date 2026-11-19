import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { createContactLog, pullContacts, recordContacts } from '@/event/event'
import { setSpeed, stepParams } from '@/params/params'
import { createSolver, stepSolver, type ContactEvent, type Solver } from '@/solve/solve'

const DT = 1 / 60

function warm(solver: Solver): void {
  setSpeed(solver.params, 1.2)
  for (let i = 0; i < 90; i += 1) stepParams(solver.params, DT)
}

function committed(solver: Solver, before: ContactEvent[]): ContactEvent[] | null {
  return solver.events === before ? null : solver.events
}

describe('contact events', () => {
  it('未拉取的离地和落地按提交顺序留着', () => {
    const solver = createSolver(createHumanoid(1.7))
    const log = createContactLog()
    warm(solver)
    const taken: ContactEvent[] = []
    for (let i = 0; i < 80 && taken.length < 2; i += 1) {
      const before = solver.events
      stepSolver(solver, DT)
      const events = committed(solver, before)
      if (events !== null && events.length > 0) {
        recordContacts(log, events)
        taken.push(...events)
      }
    }
    expect(taken.map((event) => event.kind)).toEqual(['liftoff', 'landing'])
    expect(pullContacts(log)).toEqual(taken)
    expect(pullContacts(log)).toEqual([])
  })

  it('失败的一步没有新事件', () => {
    const solver = createSolver(createHumanoid(1.7))
    const log = createContactLog()
    warm(solver)
    for (let i = 0; i < 20; i += 1) stepSolver(solver, DT)
    const before = solver.events
    const step = solver.plan.active as { contactX: number } | null
    expect(step).not.toBeNull()
    step!.contactX = solver.plan.stanceX + 5
    stepSolver(solver, DT)
    expect(solver.events).toBe(before)
    if (solver.events !== before) recordContacts(log, solver.events)
    expect(pullContacts(log)).toEqual([])
    expect(solver.recovery.active).toBe(true)
  })

  it('缓冲保存副本，也不调用宿主', () => {
    const log = createContactLog()
    const source: ContactEvent[] = [{ kind: 'liftoff', foot: 'left' }]
    let calls = 0
    const host = (): void => {
      calls += 1
    }
    recordContacts(log, source)
    source[0] = { kind: 'landing', foot: 'right' }
    host()
    expect(calls).toBe(1)
    expect(pullContacts(log)).toEqual([{ kind: 'liftoff', foot: 'left' }])
  })
})
