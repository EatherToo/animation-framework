import { describe, expect, it } from '@jest/globals'
import { createVec2, setVec2 } from '@/math/vec2'
import * as space from '@/space'
import { LENGTH_EPSILON } from '@/space/tolerance'
import {
  copyWorldPoint,
  createWorldPoint,
  rigToWorldPoint,
  setWorldPoint,
  worldToRigPoint,
} from '@/space/world-point'
import { expectCloseArray, expectSameBits } from '../math/assert'

describe('world-point', () => {
  it('从 space 入口再导出', () => {
    expect(space.createWorldPoint).toBe(createWorldPoint)
    expect(space.setWorldPoint).toBe(setWorldPoint)
    expect(space.copyWorldPoint).toBe(copyWorldPoint)
    expect(space.rigToWorldPoint).toBe(rigToWorldPoint)
    expect(space.worldToRigPoint).toBe(worldToRigPoint)
    expect(space.LENGTH_EPSILON).toBe(LENGTH_EPSILON)
  })


  it('精度对照：float64 换算达标，fround 路径误差 > LENGTH_EPSILON', () => {
    const origin = setWorldPoint(createWorldPoint(), 12345, 3)
    const world = setWorldPoint(createWorldPoint(), 12345.678901, 3.25)
    const out = createVec2()

    worldToRigPoint(out, world, origin, 1)
    expectCloseArray(out, [0.678901, 0.25])

    const f32x = Math.fround(12345.678901) - Math.fround(12345)
    const f32y = Math.fround(3.25) - Math.fround(3)
    expect(Math.hypot(f32x - 0.678901, f32y - 0.25)).toBeGreaterThan(LENGTH_EPSILON)
  })

  it('往返：几米内角色点、两种 facing、非零原点', () => {
    const origin = setWorldPoint(createWorldPoint(), 100, -2.5)
    const samples = [
      [0, 0],
      [0.3, 0.9],
      [-1.2, 0.5],
      [2, -0.75],
    ] as const
    const world = createWorldPoint()
    const back = createVec2()

    for (const facing of [1, -1] as const) {
      for (const [x, y] of samples) {
        const local = setVec2(createVec2(), x, y)
        rigToWorldPoint(world, local, origin, facing)
        worldToRigPoint(back, world, origin, facing)
        expectCloseArray(back, local)
      }
    }
  })

  it('createWorldPoint / setWorldPoint / copyWorldPoint 按分量正确', () => {
    const created = createWorldPoint()
    expect(created).toBeInstanceOf(Float64Array)
    expect(created).toHaveLength(2)
    expectCloseArray(created, [0, 0])

    const out = createWorldPoint()
    expect(setWorldPoint(out, 1.5, -2.25)).toBe(out)
    expectCloseArray(out, [1.5, -2.25])

    const source = setWorldPoint(createWorldPoint(), 7, 8)
    const copy = createWorldPoint()
    expect(copyWorldPoint(copy, source)).toBe(copy)
    source[0] = 0
    expect(copy[0]).toBe(7)
    expect(copy[1]).toBe(8)
  })

  it('别名：out === origin 时 rigToWorldPoint 与独立缓冲一致；copy 自复制安全', () => {
    const local = setVec2(createVec2(), 0.4, -0.2)
    const origin = setWorldPoint(createWorldPoint(), 12, 3)
    const independent = createWorldPoint()
    const aliased = setWorldPoint(createWorldPoint(), 12, 3)

    for (const facing of [1, -1] as const) {
      setWorldPoint(aliased, 12, 3)
      rigToWorldPoint(independent, local, origin, facing)
      rigToWorldPoint(aliased, local, aliased, facing)
      expectCloseArray(aliased, independent)
    }

    const same = setWorldPoint(createWorldPoint(), 9, -1)
    copyWorldPoint(same, same)
    expectCloseArray(same, [9, -1])
  })

  it('相同输入重复运行，结果二进制相同', () => {
    const origin = setWorldPoint(createWorldPoint(), 5, 2)
    const local = setVec2(createVec2(), 0.3, 0.9)
    const a = rigToWorldPoint(createWorldPoint(), local, origin, -1)
    const b = rigToWorldPoint(createWorldPoint(), local, origin, -1)
    expectSameBits(a, b)

    const world = setWorldPoint(createWorldPoint(), 5.3, 2.9)
    const c = worldToRigPoint(createVec2(), world, origin, 1)
    const d = worldToRigPoint(createVec2(), world, origin, 1)
    expectSameBits(c, d)
  })
})
