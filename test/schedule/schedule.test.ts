import { describe, expect, it } from '@jest/globals'
import type { LatchedStep } from '@/plan/plan'
import { contactMarks, crossings } from '@/schedule/schedule'

function step(stepLength: number): LatchedStep {
  return {
    foot: 'left',
    duration: 1,
    stepLength,
    duty: 0.6,
    contactX: 0,
    contactY: 0,
    generation: 0,
  }
}

describe('schedule', () => {
  it('前进时按跟、平足、趾滚动', () => {
    const marks = contactMarks(step(0.4))
    expect(marks.map((mark) => mark.name)).toEqual(['heel', 'flat', 'toe', 'liftoff', 'landing'])
    expect(marks[0]!.time).toBe(0)
    expect(marks[1]!.time).toBe(0.6 / 3)
    expect(marks[2]!.time).toBe((2 * 0.6) / 3)
    expect(marks[3]!.time).toBe(0.6)
    expect(marks[4]!.time).toBe(1)
  })

  it('倒退时跟和趾对调', () => {
    const marks = contactMarks(step(-0.4))
    expect(marks.map((mark) => mark.name)).toEqual(['toe', 'flat', 'heel', 'liftoff', 'landing'])
    expect(marks[0]!.time).toBe(0)
    expect(marks[2]!.time).toBe((2 * 0.6) / 3)
  })

  it('只报告区间内跨过的时刻', () => {
    const marks = contactMarks(step(0.4))
    expect(crossings(0, 0.6 / 3, marks).map((mark) => mark.name)).toEqual(['flat'])
    expect(crossings(0.5, 0.7, marks).map((mark) => mark.name)).toEqual(['liftoff'])
    expect(crossings(0.9, 1, marks).map((mark) => mark.name)).toEqual(['landing'])
    expect(() => crossings(0.2, 0.1, marks)).toThrow(/^time$/)
  })
})
