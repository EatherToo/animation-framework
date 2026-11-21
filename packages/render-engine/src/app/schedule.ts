/**
 * M12 步态时间表。
 * 权威：docs/18-应用层/步态与调度.md。
 *
 * 一步内固定五个时刻：heel / flat / toe / liftoff / landing。
 * 支撑相滚动三等分；倒退时脚底滚动顺序反向（toe→flat→heel）。
 */
import type { ContactKind } from './foot'

export type StepSchedule = {
  foot: 'L' | 'R'
  startTime: number
  duration: number
  duty: number
  stepLength: number
  events: readonly ScheduleEvent[]
}

export type ScheduleEvent = {
  kind: ContactKind
  /** 绝对时间（秒）。 */
  at: number
}

export type ScheduleSample = {
  /** 步内相位 0..1。 */
  phase: number
  current: ScheduleEvent | null
  next: ScheduleEvent | null
}

export type StepScheduleInput = {
  foot: 'L' | 'R'
  startTime: number
  duration: number
  duty: number
  stepLength: number
}

const FORWARD_ORDER: readonly ContactKind[] = ['heel', 'flat', 'toe', 'liftoff', 'landing']
const BACKWARD_ORDER: readonly ContactKind[] = ['toe', 'flat', 'heel', 'liftoff', 'landing']
const EPS = 1e-12

export function createStepSchedule(input: StepScheduleInput): StepSchedule {
  const { foot, startTime, duration, duty, stepLength } = input
  if (foot !== 'L' && foot !== 'R') throw new Error('schedule.foot')
  if (!Number.isFinite(startTime)) throw new Error('schedule.startTime')
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('schedule.duration')
  if (!Number.isFinite(duty) || duty <= 0 || duty > 1) throw new Error('schedule.duty')
  if (!Number.isFinite(stepLength)) throw new Error('schedule.stepLength')

  const supportEnd = duty * duration
  const rolling = supportEnd / 3
  const at = [
    startTime,
    startTime + rolling,
    startTime + 2 * rolling,
    startTime + supportEnd,
    startTime + duration,
  ]
  const order = stepLength >= 0 ? FORWARD_ORDER : BACKWARD_ORDER
  const events = order.map((kind, i) => ({ kind, at: at[i]! }))
  return { foot, startTime, duration, duty, stepLength, events }
}

/** 采样步内相位与当前/下一事件；时间在步外时相位夹到 0/1。 */
export function sampleSchedule(schedule: StepSchedule, time: number): ScheduleSample {
  if (!Number.isFinite(time)) throw new Error('schedule.time')
  const raw = (time - schedule.startTime) / schedule.duration
  const phase = raw < 0 ? 0 : raw > 1 ? 1 : raw
  let current: ScheduleEvent | null = null
  let next: ScheduleEvent | null = null
  for (const event of schedule.events) {
    if (event.at <= time + EPS) current = event
    else {
      next = event
      break
    }
  }
  return { phase, current, next }
}
