import { describe, expect, it } from '@jest/globals'
import * as body from '@/body'
import {
  ARM_BEND_SIGN,
  ARM_ROM_MAX,
  ARM_ROM_MIN,
  LEG_BEND_SIGN,
  LEG_ROM_MAX,
  LEG_ROM_MIN,
  makeTwoBoneChain,
} from '@/body/chains'
import { expectClose } from '../math/assert'

describe('chains', () => {
  it('从 body 入口再导出', () => {
    expect(body.makeTwoBoneChain).toBe(makeTwoBoneChain)
    expect(body.LEG_BEND_SIGN).toBe(LEG_BEND_SIGN)
    expect(body.ARM_BEND_SIGN).toBe(ARM_BEND_SIGN)
    expect(body.LEG_ROM_MIN).toBe(LEG_ROM_MIN)
    expect(body.LEG_ROM_MAX).toBe(LEG_ROM_MAX)
    expect(body.ARM_ROM_MIN).toBe(ARM_ROM_MIN)
    expect(body.ARM_ROM_MAX).toBe(ARM_ROM_MAX)
  })

  it('非法规格抛出', () => {
    const ok = {
      root: 1,
      mid: 2,
      end: 3,
      bendSign: 1 as const,
      romMin: -1,
      romMax: 1,
    }
    expect(() => makeTwoBoneChain({ ...ok, romMin: 1, romMax: 1 })).toThrow()
    expect(() => makeTwoBoneChain({ ...ok, romMin: 2, romMax: 1 })).toThrow()
    expect(() =>
      makeTwoBoneChain({ ...ok, romMin: Number.NaN, romMax: 1 }),
    ).toThrow()
    expect(() =>
      makeTwoBoneChain({ ...ok, bendSign: 0 as 1 | -1 }),
    ).toThrow()
    expect(() => makeTwoBoneChain({ ...ok, root: 2, mid: 2 })).toThrow()
    expect(() => makeTwoBoneChain({ ...ok, root: -1 })).toThrow()
    expect(() => makeTwoBoneChain({ ...ok, mid: 1.5 })).toThrow()
  })

  it('合法规格原样返回', () => {
    const chain = makeTwoBoneChain({
      root: 11,
      mid: 12,
      end: 13,
      bendSign: -1,
      romMin: -2,
      romMax: 0.1,
    })
    expect(chain.root).toBe(11)
    expect(chain.mid).toBe(12)
    expect(chain.end).toBe(13)
    expect(chain.bendSign).toBe(-1)
    expect(chain.romMin).toBe(-2)
    expect(chain.romMax).toBe(0.1)
  })

  it('ROM 与弯曲符号常数', () => {
    expect(LEG_ROM_MIN < LEG_ROM_MAX).toBe(true)
    expect(ARM_ROM_MIN < ARM_ROM_MAX).toBe(true)
    expectClose(LEG_ROM_MIN, -2.618)
    expectClose(LEG_ROM_MAX, 0.035)
    expectClose(ARM_ROM_MIN, -2.443)
    expectClose(ARM_ROM_MAX, 0.175)
    expect(LEG_BEND_SIGN).toBe(1)
    expect(ARM_BEND_SIGN).toBe(-1)
  })
})
