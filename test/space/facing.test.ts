import { describe, expect, it } from '@jest/globals'
import { normalizeAngle } from '@/math/angle'
import { createVec2, setVec2 } from '@/math/vec2'
import { createVec3, crossVec3, setVec3 } from '@/math/vec3'
import * as space from '@/space'
import {
  farSide,
  isFacing,
  mirrorAngle,
  mirrorVec2,
  nearSide,
  type Facing,
} from '@/space/facing'
import { expectClose, expectCloseArray, expectSameBits } from '../math/assert'

describe('facing', () => {
  it('从 space 入口再导出', () => {
    expect(space.isFacing).toBe(isFacing)
    expect(space.nearSide).toBe(nearSide)
    expect(space.farSide).toBe(farSide)
    expect(space.mirrorAngle).toBe(mirrorAngle)
    expect(space.mirrorVec2).toBe(mirrorVec2)
  })

  it('isFacing：仅严格的 ±1 为真', () => {
    expect(isFacing(1)).toBe(true)
    expect(isFacing(-1)).toBe(true)

    expect(isFacing(0)).toBe(false)
    expect(isFacing(-0)).toBe(false)
    expect(isFacing(2)).toBe(false)
    expect(isFacing(1.0000001)).toBe(false)
    expect(isFacing(Number.NaN)).toBe(false)
    expect(isFacing('1')).toBe(false)
    expect(isFacing(undefined)).toBe(false)
    expect(isFacing(null)).toBe(false)
    expect(isFacing(true)).toBe(false)
  })

  it('nearSide / farSide 与上×前的 z 符号一致', () => {
    expect(nearSide(1)).toBe('right')
    expect(farSide(1)).toBe('left')
    expect(nearSide(-1)).toBe('left')
    expect(farSide(-1)).toBe('right')

    const up = setVec3(createVec3(), 0, 1, 0)
    const left = createVec3()

    for (const facing of [1, -1] as const) {
      const forward = setVec3(createVec3(), facing, 0, 0)
      crossVec3(left, up, forward)
      const z = left[2]!
      if (z < 0) {
        expect(nearSide(facing)).toBe('right')
        expect(farSide(facing)).toBe('left')
      } else {
        expect(z).toBeGreaterThan(0)
        expect(nearSide(facing)).toBe('left')
        expect(farSide(facing)).toBe('right')
      }
    }
  })

  it('mirrorAngle 在 facing=-1 时为 π−θ，facing=1 时只折角', () => {
    const cases: Array<[number, number]> = [
      [0, Math.PI],
      [Math.PI / 2, Math.PI / 2],
      [Math.PI / 6, (5 * Math.PI) / 6],
      [-Math.PI / 2, -Math.PI / 2],
    ]

    for (const [input, expected] of cases) {
      expectClose(mirrorAngle(input, -1), expected)
    }

    expectClose(mirrorAngle(3 * Math.PI, 1), normalizeAngle(3 * Math.PI))
    expectClose(mirrorAngle(-Math.PI / 3, 1), -Math.PI / 3)
  })

  it('同一 facing 镜像角度两次等于 normalizeAngle(θ)', () => {
    const samples = [0, Math.PI / 6, Math.PI / 2, Math.PI, -Math.PI / 2, 3 * Math.PI, -3 * Math.PI]
    for (const facing of [1, -1] as const) {
      for (const theta of samples) {
        const once = mirrorAngle(theta, facing)
        const twice = mirrorAngle(once, facing)
        expectClose(twice, normalizeAngle(theta))
      }
    }
  })

  it('mirrorVec2 与 mirrorAngle 对单位方向一致', () => {
    const samples = [0, Math.PI / 6, Math.PI / 3, Math.PI / 2, (2 * Math.PI) / 3, Math.PI, -Math.PI / 4]
    const out = createVec2()

    for (const facing of [1, -1] as const) {
      for (const theta of samples) {
        const dir = setVec2(createVec2(), Math.cos(theta), Math.sin(theta))
        mirrorVec2(out, dir, facing)
        const mirrored = mirrorAngle(theta, facing)
        expectCloseArray(out, [Math.cos(mirrored), Math.sin(mirrored)])
      }
    }
  })

  it('mirrorVec2：facing=1 恒等，facing=-1 只翻 x', () => {
    const d = setVec2(createVec2(), 3, -4)
    const out = createVec2()

    expect(mirrorVec2(out, d, 1)).toBe(out)
    expectCloseArray(out, [3, -4])

    mirrorVec2(out, d, -1)
    expectCloseArray(out, [-3, -4])
  })

  it('mirrorVec2 的 out 与输入同一缓冲时结果正确', () => {
    const independent = createVec2()
    const aliased = setVec2(createVec2(), 2.5, -1.5)
    const source = setVec2(createVec2(), 2.5, -1.5)

    for (const facing of [1, -1] as const) {
      setVec2(aliased, 2.5, -1.5)
      setVec2(source, 2.5, -1.5)
      mirrorVec2(independent, source, facing)
      mirrorVec2(aliased, aliased, facing)
      expectCloseArray(aliased, independent)
    }
  })

  it('相同输入重复运行，结果二进制相同', () => {
    const a = mirrorAngle(Math.PI / 6, -1)
    const b = mirrorAngle(Math.PI / 6, -1)
    expect(Object.is(a, b)).toBe(true)

    const d = setVec2(createVec2(), 0.3, 0.9)
    const out1 = mirrorVec2(createVec2(), d, -1 as Facing)
    const out2 = mirrorVec2(createVec2(), d, -1 as Facing)
    expectSameBits(out1, out2)
  })
})
