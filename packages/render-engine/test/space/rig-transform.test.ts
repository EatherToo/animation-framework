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

  it('setWorldFromRig 只平移，不接收朝向或视角', () => {
    const local = setVec2(createVec2(), 0.3, 0.9)
    const out = createVec2()
    const m = setWorldFromRig(createMat3(), ORIGIN_5_2)
    transformPoint(out, local, m)
    expectCloseArray(out, [5.3, 2.9])
    expect(setWorldFromRig.length).toBe(2)
    expect(setRigFromWorld.length).toBe(2)
  })

  it('setWorldFromRig 写出列主序矩阵并返回 out', () => {
    const out = createMat3()
    out.fill(9)

    expect(setWorldFromRig(out, ORIGIN_5_2)).toBe(out)
    expectSameBits(out, new Float32Array([1, 0, 0, 0, 1, 0, 5, 2, 1]))
  })

  it('setRigFromWorld 写出闭式逆矩阵并返回 out', () => {
    const out = createMat3()
    out.fill(9)

    expect(setRigFromWorld(out, ORIGIN_5_2)).toBe(out)
    expectSameBits(out, new Float32Array([1, 0, 0, 0, 1, 0, -5, -2, 1]))
  })

  it('非零原点：worldFromRig 与 rigFromWorld 互逆', () => {
    const worldFromRig = createMat3()
    const rigFromWorld = createMat3()
    const product = createMat3()
    const identity = identityMat3(createMat3())

    for (const origin of [ORIGIN_5_2, ORIGIN_3_N1, ORIGIN_10_N4]) {
      setWorldFromRig(worldFromRig, origin)
      setRigFromWorld(rigFromWorld, origin)

      multiplyMat3(product, worldFromRig, rigFromWorld)
      expectCloseArray(product, identity)

      multiplyMat3(product, rigFromWorld, worldFromRig)
      expectCloseArray(product, identity)
    }
  })

  it('orientationSign(setWorldFromRig) 为 1；镜像为 -1；奇异为 0', () => {
    const m = createMat3()

    setWorldFromRig(m, ORIGIN_3_N1)
    expect(orientationSign(m)).toBe(1)
    expect(orientationSign(identityMat3(m))).toBe(1)

    m[4] = -1
    expect(orientationSign(m)).toBe(-1)

    m.fill(0)
    expect(orientationSign(m)).toBe(0)

    m.fill(Number.NaN)
    expect(orientationSign(m)).toBe(0)
  })

  it('角色空间逆时针三角经实例矩阵后有符号面积仍为正', () => {
    const a = setVec2(createVec2(), 0, 0)
    const b = setVec2(createVec2(), 1, 0)
    const c = setVec2(createVec2(), 0, 1)

    const ab = subVec2(createVec2(), b, a)
    const ac = subVec2(createVec2(), c, a)
    expect(crossVec2(ab, ac)).toBeGreaterThan(0)

    const worldFromRig = setWorldFromRig(createMat3(), ORIGIN_10_N4)
    const wa = transformPoint(createVec2(), a, worldFromRig)
    const wb = transformPoint(createVec2(), b, worldFromRig)
    const wc = transformPoint(createVec2(), c, worldFromRig)

    const wab = subVec2(createVec2(), wb, wa)
    const wac = subVec2(createVec2(), wc, wa)
    expect(crossVec2(wab, wac)).toBeGreaterThan(0)
  })

  it('相同输入重复运行，结果二进制相同', () => {
    const a = setWorldFromRig(createMat3(), ORIGIN_5_2)
    const b = setWorldFromRig(createMat3(), ORIGIN_5_2)
    expectSameBits(a, b)

    const c = setRigFromWorld(createMat3(), ORIGIN_5_2)
    const d = setRigFromWorld(createMat3(), ORIGIN_5_2)
    expectSameBits(c, d)

    expect(Object.is(orientationSign(a), orientationSign(b))).toBe(true)
  })
})
