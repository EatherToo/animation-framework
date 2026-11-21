/**
 * M12 足部几何与接触求解测试。
 * 只覆盖 app/foot.ts 的公开契约；不触碰核心 01-15。
 */
import { describe, expect, it } from '@jest/globals'
import {
  FootContactSolver,
  ankleFromContact,
  contactFromAnkle,
  createFootGeometry,
  heelStrike,
  soleLocal,
  toeOff,
  type FootGeometry,
} from '@/app/foot'

const FOOT_LENGTH = 0.15
const ANKLE_HEIGHT = 0.04

function geom(): FootGeometry {
  return createFootGeometry(FOOT_LENGTH, ANKLE_HEIGHT)
}

describe('M12 · 足部几何', () => {
  it('三点与 soleLocal 一致，且 heel < flat < toe', () => {
    const g = geom()
    expect(g.footLength).toBe(FOOT_LENGTH)
    expect(g.ankleHeight).toBe(ANKLE_HEIGHT)
    expect(g.heelBack).toBeCloseTo(0.3 * FOOT_LENGTH, 15)
    expect(g.soleLength).toBeCloseTo(g.heelBack + FOOT_LENGTH, 15)

    const heel = soleLocal(0, g)
    const flat = soleLocal(0.5, g)
    const toe = soleLocal(1, g)
    expect(heel).toEqual([g.heel.x, g.heel.y])
    expect(flat).toEqual([g.flat.x, g.flat.y])
    expect(toe).toEqual([g.toe.x, g.toe.y])
    expect(heel[0]).toBeLessThan(flat[0])
    expect(flat[0]).toBeLessThan(toe[0])
    expect(heel[1]).toBeLessThan(flat[1])
    expect(flat[1]).toBeLessThan(toe[1])
  })

  it('非法尺寸抛错', () => {
    expect(() => createFootGeometry(0, ANKLE_HEIGHT)).toThrow()
    expect(() => createFootGeometry(FOOT_LENGTH, -1)).toThrow()
    expect(() => soleLocal(1.2, geom())).toThrow()
  })

  it('ankleFromContact / contactFromAnkle 互逆（1e-9）', () => {
    const g = geom()
    const soleY = 0.12
    for (const x of [-1.25, 0, 3.75]) {
      const ankle = ankleFromContact({ x, y: soleY }, soleY, g)
      const back = contactFromAnkle(ankle, soleY, g)
      expect(back.x).toBeCloseTo(x, 9)
      expect(back.y).toBeCloseTo(soleY, 9)
    }
    const ankle = { x: 2.5, y: soleY + ANKLE_HEIGHT }
    const contact = contactFromAnkle(ankle, soleY, g)
    const round = ankleFromContact(contact, soleY, g)
    expect(round.x).toBeCloseTo(ankle.x, 9)
    expect(round.y).toBeCloseTo(ankle.y, 9)
  })
})

describe('M12 · 足部接触求解', () => {
  it('支撑期锁定接触点，重复锁定不改变', () => {
    const s = new FootContactSolver(geom())
    expect(s.locked).toBe(false)
    expect(s.lock({ x: 1, y: 0 })).toBe(true)
    expect(s.locked).toBe(true)
    expect(s.contact).toEqual({ x: 1, y: 0 })
    expect(s.lock({ x: 2, y: 0.5 })).toBe(false)
    expect(s.contact).toEqual({ x: 1, y: 0 })
    s.unlock()
    expect(s.locked).toBe(false)
    expect(s.lock({ x: 2, y: 0.5 })).toBe(true)
  })

  it('事件顺序 heel→flat→toe→liftoff→landing，且重复序列去重', () => {
    const s = new FootContactSolver(geom())
    const first = s.sequence(3, 0, 1, 0.8)
    expect(first.map((e) => e.kind)).toEqual(['heel', 'flat', 'toe', 'liftoff', 'landing'])
    const times = first.map((e) => e.time)
    const expected = [1, 1.16, 1.32, 1.48, 1.64]
    times.forEach((t, i) => expect(t).toBeCloseTo(expected[i]!, 12))
    expect(s.sequence(3, 0, 1, 0.8)).toHaveLength(0)
    expect(s.drain()).toHaveLength(5)
    expect(s.drain()).toHaveLength(0)
  })

  it('toeOff / heelStrike 生成 liftoff / landing', () => {
    expect(toeOff(1, 0, 0.5).kind).toBe('liftoff')
    expect(heelStrike(2, 0, 0.6).kind).toBe('landing')
    expect(heelStrike(2, 0, 0.6).x).toBe(2)
  })
})
