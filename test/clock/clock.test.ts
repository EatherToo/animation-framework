import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { advanceClock, createClock } from '@/clock/clock'
import { createEngine, stepEngine } from '@/engine/engine'
import { setSpeed } from '@/params/params'
import { setPlacement } from '@/place/place'
import { createMemoryLayer } from '@/bind/bind'

const DT = 1 / 60

describe('clock', () => {
  it('半秒帧间隔等于三十次固定步，且不写场景', () => {
    const layer = createMemoryLayer()
    const direct = createEngine(createHumanoid(1.7), createMemoryLayer())
    const adapted = createEngine(createHumanoid(1.7), layer)
    setSpeed(direct.solver.params, 1.2)
    setSpeed(adapted.solver.params, 1.2)
    for (let i = 0; i < 30; i += 1) stepEngine(direct, DT)
    let calls = 0
    const clock = createClock(adapted, DT, () => {
      calls += 1
    })
    expect(advanceClock(clock, 0.5)).toBe(30)
    expect(calls).toBe(30)
    expect(clock.accumulator).toBe(0)
    expect(Array.from(adapted.solver.pose.data)).toEqual(Array.from(direct.solver.pose.data))
    expect(layer.objects).toHaveLength(0)
  })

  it('不足一步的余数留到下一帧', () => {
    const engine = createEngine(createHumanoid(1.7), createMemoryLayer())
    const clock = createClock(engine, DT, () => {})
    expect(advanceClock(clock, DT / 2)).toBe(0)
    expect(advanceClock(clock, DT / 2)).toBe(1)
    expect(clock.accumulator).toBe(0)
  })

  it('每个固定步求解前先填写放置', () => {
    const engine = createEngine(createHumanoid(1.7), createMemoryLayer())
    const clock = createClock(engine, DT, (placement) => {
      setPlacement(placement, 0, 0, 0, placement.generation + 1)
    })
    expect(advanceClock(clock, DT * 3)).toBe(3)
    expect(engine.solver.placement.generation).toBe(3)
    expect(engine.solver.generation).toBe(3)
  })

  it('宿主抛出时这一步还没有被消耗', () => {
    const engine = createEngine(createHumanoid(1.7), createMemoryLayer())
    let calls = 0
    const clock = createClock(engine, DT, () => {
      calls += 1
      if (calls === 2) throw new Error('host')
    })
    expect(() => advanceClock(clock, DT * 3)).toThrow(/^host$/)
    expect(clock.accumulator).toBeCloseTo(DT * 2, 8)
    clock.place = () => {
      calls += 1
    }
    expect(advanceClock(clock, DT)).toBe(3)
    expect(calls).toBe(5)
  })
})
