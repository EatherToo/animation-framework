import { describe, expect, it } from '@jest/globals'
import {
  characterGroundY,
  createPlacement,
  movedGeneration,
  setPlacement,
} from '@/place/place'

describe('place', () => {
  it('创建后角色地面为 0', () => {
    const placement = createPlacement()
    expect(characterGroundY(placement)).toBe(0)
    expect(placement.generation).toBe(0)
  })

  it('角色地面是地面减原点高度', () => {
    const placement = createPlacement()
    setPlacement(placement, 1, 2, 0.5, 0)
    expect(placement.origin[0]).toBe(1)
    expect(placement.origin[1]).toBe(2)
    expect(characterGroundY(placement)).toBe(-1.5)
  })

  it('世代增加才是传送', () => {
    const placement = createPlacement()
    setPlacement(placement, 0, 0, 0, 1)
    expect(movedGeneration(0, placement.generation)).toBe(true)
    setPlacement(placement, 3, 0, 0, 1)
    expect(movedGeneration(1, placement.generation)).toBe(false)
    expect(placement.origin[0]).toBe(3)
  })

  it('非法输入不改原值', () => {
    const placement = createPlacement()
    setPlacement(placement, 4, 5, 1, 2)
    expect(() => setPlacement(placement, 9, 9, Number.NaN, 2)).toThrow(/^groundY$/)
    expect(placement.origin[0]).toBe(4)
    expect(() => setPlacement(placement, 0, 0, 0, -1)).toThrow(/^generation$/)
    expect(() => setPlacement(placement, 0, 0, 0, 1)).toThrow(/^generation$/)
    expect(placement.generation).toBe(2)
    expect(placement.origin[1]).toBe(5)
  })
})
