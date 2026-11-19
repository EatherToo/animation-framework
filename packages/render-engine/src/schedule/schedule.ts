import type { LatchedStep } from '../plan/plan'

export type MarkName = 'heel' | 'flat' | 'toe' | 'liftoff' | 'landing'

export type ContactMark = {
  readonly name: MarkName
  readonly time: number
}

export function contactMarks(step: LatchedStep): ContactMark[] {
  if (!Number.isFinite(step.duration) || step.duration <= 0) throw new Error('duration')
  if (!Number.isFinite(step.duty) || step.duty <= 0 || step.duty > 1) throw new Error('duty')
  if (!Number.isFinite(step.stepLength)) throw new Error('stepLength')
  const stance = step.duty * step.duration
  const first: MarkName = step.stepLength < 0 ? 'toe' : 'heel'
  const third: MarkName = step.stepLength < 0 ? 'heel' : 'toe'
  return [
    { name: first, time: 0 },
    { name: 'flat', time: stance / 3 },
    { name: third, time: (2 * stance) / 3 },
    { name: 'liftoff', time: stance },
    { name: 'landing', time: step.duration },
  ]
}

export function crossings(
  prev: number,
  next: number,
  marks: readonly ContactMark[],
): ContactMark[] {
  if (!Number.isFinite(prev) || !Number.isFinite(next) || prev > next) throw new Error('time')
  return marks.filter((mark) => prev < mark.time && mark.time <= next)
}
