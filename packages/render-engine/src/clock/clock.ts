import type { Engine } from '../engine/engine'
import { stepEngine } from '../engine/engine'
import type { Placement } from '../place/place'

export type Clock = {
  engine: Engine
  fixedDt: number
  accumulator: number
  place: (placement: Placement) => void
}

export function createClock(
  engine: Engine,
  fixedDt: number,
  place: (placement: Placement) => void,
): Clock {
  if (!Number.isFinite(fixedDt) || fixedDt <= 0) throw new Error('dt')
  return { engine, fixedDt, accumulator: 0, place }
}

export function advanceClock(clock: Clock, frameDt: number): number {
  if (!Number.isFinite(frameDt) || frameDt <= 0) throw new Error('dt')
  clock.accumulator += frameDt
  let steps = 0
  while (clock.accumulator >= clock.fixedDt) {
    clock.place(clock.engine.solver.placement)
    stepEngine(clock.engine, clock.fixedDt)
    clock.accumulator -= clock.fixedDt
    steps += 1
  }
  if (clock.accumulator < 1e-10) clock.accumulator = 0
  return steps
}
