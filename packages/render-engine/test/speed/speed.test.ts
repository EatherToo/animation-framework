import { describe, expect, it } from '@jest/globals'
import { speedCandidate } from '@/speed/speed'

describe('speed', () => {
  it('站立时步长和步频都是 0', () => {
    const candidate = speedCandidate(0, 1, 1)
    expect(candidate.stepLength).toBe(0)
    expect(candidate.cadence).toBe(0)
    expect(candidate.froude).toBe(0)
    expect(candidate.duty).toBe(0.62)
  })

  it('风格为 1 时首选步长是 0.8 倍腿长', () => {
    const candidate = speedCandidate(1, 1, 1)
    expect(candidate.stepLength).toBe(0.8)
    expect(candidate.cadence).toBe(1.25)
    expect(candidate.cadence * candidate.stepLength).toBe(1)
    expect(candidate.duty).toBe(0.62)
  })

  it('风格变大则步频变高、步长变短，速度不变', () => {
    const candidate = speedCandidate(1, 2, 1)
    expect(candidate.stepLength).toBe(0.4)
    expect(candidate.cadence).toBe(2.5)
    expect(candidate.cadence * candidate.stepLength).toBe(1)
  })

  it('负速度只让步长为负', () => {
    const candidate = speedCandidate(-1, 1, 1)
    expect(candidate.stepLength).toBe(-0.8)
    expect(candidate.cadence).toBe(1.25)
  })

  it('Froude 数达到 0.5 时用跑步支撑比例', () => {
    const candidate = speedCandidate(3, 1, 1)
    expect(candidate.froude).toBeGreaterThanOrEqual(0.5)
    expect(candidate.duty).toBe(0.4)
  })

  it('低于 0.05 米每秒视为站立', () => {
    const candidate = speedCandidate(0.04, 1, 1)
    expect(candidate.stepLength).toBe(0)
    expect(candidate.cadence).toBe(0)
  })

  it('非法输入抛出', () => {
    expect(() => speedCandidate(Number.NaN, 1, 1)).toThrow(/^speed$/)
    expect(() => speedCandidate(1, 0, 1)).toThrow(/^cadenceStyle$/)
    expect(() => speedCandidate(1, 1, 0)).toThrow(/^legLength$/)
  })
})
