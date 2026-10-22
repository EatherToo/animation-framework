import { describe, expect, it } from '@jest/globals'
import * as space from '@/space'
import {
  createMat3,
  identityMat3,
  multiplyMat3,
  transformPoint,
} from '@/math/mat3'
import { createVec2, crossVec2, setVec2, subVec2 } from '@/math/vec2'
import {
  orientationSign,
  setRigFromWorld,
  setWorldFromRig,
} from '@/space/rig-transform'
import { expectCloseArray, expectSameBits } from '../math/assert'

/** 模拟 WorldPoint（Float64Array(2)），不依赖 world-point 模块 */
const ORIGIN_5_2 = new Float64Array([5, 2])
const ORIGIN_3_N1 = new Float64Array([3, -1])
const ORIGIN_10_N4 = new Float64Array([10, -4])

describe('rig-transform', () => {
  it('从 space 入口再导出', () => {
    expect(space.setWorldFromRig).toBe(setWorldFromRig)
    expect(space.setRigFromWorld).toBe(setRigFromWorld)
    expect(space.orientationSign).toBe(orientationSign)
  })

  it('setWorldFromRig：facing=±1 时 transformPoint 符合 T·S', () => {
    // 角色空间点 (0.3, 0.9)
    const local = setVec2(createVec2(), 0.3, 0.9)
    const out = createVec2()
    const m = createMat3()
    // 得到世界空间变换矩阵
    setWorldFromRig(m, ORIGIN_5_2, 1)
    // 变换到世界空间点 (5.3, 2.9)
    transformPoint(out, local, m)
    expectCloseArray(out, [5.3, 2.9])

    setWorldFromRig(m, ORIGIN_5_2, -1)
    transformPoint(out, local, m)
    // 为什么是 (4.7, 2.9)？
    // 因为 facing=-1 时，朝向与原点相反，所以结果是 (5 - 0.3, 2 + 0.9) = (4.7, 2.9)
    expectCloseArray(out, [4.7, 2.9])
  })

  it('setWorldFromRig 写出列主序矩阵并返回 out', () => {
    const out = createMat3()
    out.fill(9)

    expect(setWorldFromRig(out, ORIGIN_5_2, -1)).toBe(out)
    expectCloseArray(out, [-1, 0, 0, 0, 1, 0, 5, 2, 1])
  })

  it('setRigFromWorld 写出闭式逆矩阵并返回 out', () => {
    const out = createMat3()

    expect(setRigFromWorld(out, ORIGIN_5_2, -1)).toBe(out)
    expectCloseArray(out, [-1, 0, 0, 0, 1, 0, 5, -2, 1])
  })

  it('两种朝向、非零原点：worldFromRig 与 rigFromWorld 互逆', () => {
    const worldFromRig = createMat3()
    const rigFromWorld = createMat3()
    const product = createMat3()
    const identity = identityMat3(createMat3())

    for (const facing of [1, -1] as const) {
      setWorldFromRig(worldFromRig, ORIGIN_5_2, facing)
      setRigFromWorld(rigFromWorld, ORIGIN_5_2, facing)

      multiplyMat3(product, worldFromRig, rigFromWorld)
      expectCloseArray(product, identity)

      multiplyMat3(product, rigFromWorld, worldFromRig)
      expectCloseArray(product, identity)
    }
  })

  it('orientationSign(setWorldFromRig) 等于 facing；单位矩阵为 1；奇异为 0', () => {
    const m = createMat3()

    for (const facing of [1, -1] as const) {
      setWorldFromRig(m, ORIGIN_3_N1, facing)
      expect(orientationSign(m)).toBe(facing)
    }

    expect(orientationSign(identityMat3(m))).toBe(1)

    m.fill(0)
    expect(orientationSign(m)).toBe(0)

    m.fill(Number.NaN)
    expect(orientationSign(m)).toBe(0)
  })

  it('facing=-1 时角色空间逆时针三角的有符号面积变负', () => {
    const a = setVec2(createVec2(), 0, 0)
    const b = setVec2(createVec2(), 1, 0)
    const c = setVec2(createVec2(), 0, 1)

    const ab = subVec2(createVec2(), b, a)
    const ac = subVec2(createVec2(), c, a)
    expect(crossVec2(ab, ac)).toBeGreaterThan(0)

    const worldFromRig = setWorldFromRig(createMat3(), ORIGIN_10_N4, -1)
    const wa = transformPoint(createVec2(), a, worldFromRig)
    const wb = transformPoint(createVec2(), b, worldFromRig)
    const wc = transformPoint(createVec2(), c, worldFromRig)

    const wab = subVec2(createVec2(), wb, wa)
    const wac = subVec2(createVec2(), wc, wa)
    expect(crossVec2(wab, wac)).toBeLessThan(0)
  })

  it('相同输入重复运行，结果二进制相同', () => {
    const a = setWorldFromRig(createMat3(), ORIGIN_5_2, -1)
    const b = setWorldFromRig(createMat3(), ORIGIN_5_2, -1)
    expectSameBits(a, b)

    const c = setRigFromWorld(createMat3(), ORIGIN_5_2, -1)
    const d = setRigFromWorld(createMat3(), ORIGIN_5_2, -1)
    expectSameBits(c, d)

    expect(Object.is(orientationSign(a), orientationSign(b))).toBe(true)
  })
})
