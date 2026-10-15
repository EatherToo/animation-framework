import { mat3 as glMat3 } from 'gl-matrix'
import { describe, expect, it } from '@jest/globals'
import * as math from '@/math'
import {
  composeTRS,
  copyMat3,
  createMat3,
  determinantMat3,
  fromRotation,
  fromScaling,
  fromTranslation,
  identityMat3,
  invertMat3,
  multiplyMat3,
  rotateMat3,
  scaleMat3,
  transformPoint,
  transformVector,
  translateMat3,
} from '@/math/mat3'
import { createVec2, setVec2 } from '@/math/vec2'
import { expectClose, expectCloseArray, expectDiffers, expectSameBits } from './assert'

const HALF_TURN = Math.PI / 2

function referenceTRS(translation: Float32Array, rotationRad: number, scale: Float32Array): Float32Array {
  const t = glMat3.create()
  const r = glMat3.create()
  const s = glMat3.create()
  const rs = glMat3.create()
  const trs = glMat3.create()
  glMat3.fromTranslation(t, translation)
  glMat3.fromRotation(r, rotationRad)
  glMat3.fromScaling(s, scale)
  glMat3.multiply(rs, r, s)
  glMat3.multiply(trs, t, rs)
  return Float32Array.from(trs)
}

describe('mat3', () => {
  it('从 math 入口再导出', () => {
    expect(math.multiplyMat3).toBe(multiplyMat3)
    expect(math.composeTRS).toBe(composeTRS)
    expect(math.transformPoint).toBe(transformPoint)
    expect(math.transformVector).toBe(transformVector)
  })

  it('createMat3 与 identityMat3 是列主序单位矩阵', () => {
    const created = createMat3()
    expect(created).toBeInstanceOf(Float32Array)
    expect(created).toHaveLength(9)
    expectCloseArray(created, [1, 0, 0, 0, 1, 0, 0, 0, 1])

    const out = createMat3()
    out[0] = 4
    expect(identityMat3(out)).toBe(out)
    expectCloseArray(out, [1, 0, 0, 0, 1, 0, 0, 0, 1])
  })

  it('copyMat3 复制 9 个数且随后改源不影响副本', () => {
    const source = fromTranslation(createMat3(), setVec2(createVec2(), 2, 3))
    const out = createMat3()
    expect(copyMat3(out, source)).toBe(out)
    source[6] = 0
    expect(out[6]).toBe(2)
    expect(out[7]).toBe(3)
  })

  it('单位矩阵左右相乘都得到原矩阵，平移与旋转不可交换', () => {
    const value = createMat3()
    value.set([1, 4, 0, 2, 5, 0, 3, 6, 1])
    const identity = identityMat3(createMat3())
    const left = multiplyMat3(createMat3(), identity, value)
    const right = multiplyMat3(createMat3(), value, identity)
    expectCloseArray(left, value)
    expectCloseArray(right, value)

    const translation = fromTranslation(createMat3(), setVec2(createVec2(), 10, 0))
    const rotation = fromRotation(createMat3(), HALF_TURN)
    const translateThenRotate = multiplyMat3(createMat3(), rotation, translation)
    const rotateThenTranslate = multiplyMat3(createMat3(), translation, rotation)
    expectCloseArray(translateThenRotate, [0, 1, 0, -1, 0, 0, 0, 10, 1])
    expectCloseArray(rotateThenTranslate, [0, 1, 0, -1, 0, 0, 10, 0, 1])
    expectDiffers(translateThenRotate, rotateThenTranslate)
  })

  it('右乘平移、旋转、缩放与 multiplyMat3 一致', () => {
    const base = fromTranslation(createMat3(), setVec2(createVec2(), 3, 4))
    const offset = setVec2(createVec2(), 10, 0)
    const factorT = fromTranslation(createMat3(), offset)
    expectCloseArray(translateMat3(createMat3(), base, offset), multiplyMat3(createMat3(), base, factorT))

    const factorR = fromRotation(createMat3(), HALF_TURN)
    expectCloseArray(rotateMat3(createMat3(), base, HALF_TURN), multiplyMat3(createMat3(), base, factorR))

    const scale = setVec2(createVec2(), 2, 5)
    const factorS = fromScaling(createMat3(), scale)
    expectCloseArray(scaleMat3(createMat3(), base, scale), multiplyMat3(createMat3(), base, factorS))
  })

  it('fromRotation(π/2) 把点 (1, 0) 变到 (0, 1)', () => {
    const rotation = fromRotation(createMat3(), HALF_TURN)
    const out = transformPoint(createVec2(), setVec2(createVec2(), 1, 0), rotation)
    expectCloseArray(out, [0, 1])
  })

  it('composeTRS 等于 T·R·S', () => {
    const translation = setVec2(createVec2(), 4, -5)
    const scale = setVec2(createVec2(), 2, 3)
    const rotation = Math.PI / 6
    const out = composeTRS(createMat3(), translation, rotation, scale)
    expect(out).toBeInstanceOf(Float32Array)
    expectCloseArray(out, referenceTRS(translation, rotation, scale))

    const c = Math.cos(rotation)
    const s = Math.sin(rotation)
    expectCloseArray(out, [c * 2, s * 2, 0, -s * 3, c * 3, 0, 4, -5, 1])
  })

  it('平移作用在点上，不作用在方向上', () => {
    const translation = fromTranslation(createMat3(), setVec2(createVec2(), 10, 20))
    const point = transformPoint(createVec2(), setVec2(createVec2(), 1, 2), translation)
    const direction = transformVector(createVec2(), setVec2(createVec2(), 1, 2), translation)
    expectCloseArray(point, [11, 22])
    expectCloseArray(direction, [1, 2])

    const moved = composeTRS(
      createMat3(),
      setVec2(createVec2(), 5, 7),
      HALF_TURN,
      setVec2(createVec2(), 1, 1),
    )
    expectCloseArray(transformPoint(createVec2(), setVec2(createVec2(), 1, 0), moved), [5, 8])
    expectCloseArray(transformVector(createVec2(), setVec2(createVec2(), 1, 0), moved), [0, 1])
  })

  it('可逆矩阵求逆后乘回单位矩阵', () => {
    const original = composeTRS(
      createMat3(),
      setVec2(createVec2(), 3, -4),
      Math.PI / 3,
      setVec2(createVec2(), 2, 0.5),
    )
    const inverse = createMat3()
    expect(invertMat3(inverse, original)).toBe(true)
    expectClose(determinantMat3(original) * determinantMat3(inverse), 1)
    expectCloseArray(multiplyMat3(createMat3(), inverse, original), [1, 0, 0, 0, 1, 0, 0, 0, 1])
    expect(determinantMat3(identityMat3(createMat3()))).toBe(1)
  })

  it('行列式为 0 或含非有限元素时不改写输出', () => {
    const out = createMat3()
    for (let i = 0; i < out.length; i += 1) out[i] = 10 + i
    const before = Float32Array.from(out)

    const singular = fromScaling(createMat3(), setVec2(createVec2(), 0, 1))
    expect(determinantMat3(singular)).toBe(0)
    expect(invertMat3(out, singular)).toBe(false)
    expectSameBits(out, before)

    const zeros = createMat3()
    zeros.fill(0)
    expect(invertMat3(out, zeros)).toBe(false)
    expectSameBits(out, before)

    const nanMatrix = identityMat3(createMat3())
    nanMatrix[0] = Number.NaN
    expect(invertMat3(out, nanMatrix)).toBe(false)
    expectSameBits(out, before)

    const infinite = identityMat3(createMat3())
    infinite[8] = Number.POSITIVE_INFINITY
    expect(invertMat3(out, infinite)).toBe(false)
    expectSameBits(out, before)

    const aliased = fromScaling(createMat3(), setVec2(createVec2(), 0, 1))
    const aliasedBefore = Float32Array.from(aliased)
    expect(invertMat3(aliased, aliased)).toBe(false)
    expectSameBits(aliased, aliasedBefore)
  })

  it('非零行列式仍然求逆', () => {
    const tiny = fromScaling(createMat3(), setVec2(createVec2(), 1e-8, 1))
    expect(determinantMat3(tiny)).not.toBe(0)
    expect(invertMat3(createMat3(), tiny)).toBe(true)
  })

  it('fromScaling((-1, 1)) 的行列式为 -1，并把 (1, 0) 翻到 (-1, 0)', () => {
    const reflected = fromScaling(createMat3(), setVec2(createVec2(), -1, 1))
    expect(determinantMat3(reflected)).toBe(-1)
    expectCloseArray(transformPoint(createVec2(), setVec2(createVec2(), 1, 0), reflected), [-1, 0])
  })

  it('输出缓冲可以与输入是同一块', () => {
    const translation = fromTranslation(createMat3(), setVec2(createVec2(), 10, 0))
    const rotation = fromRotation(createMat3(), HALF_TURN)
    const separate = multiplyMat3(createMat3(), rotation, translation)
    multiplyMat3(rotation, rotation, translation)
    expectCloseArray(rotation, separate)

    const point = setVec2(createVec2(), 1, 2)
    const moved = fromTranslation(createMat3(), setVec2(createVec2(), 10, 20))
    const expectedPoint = transformPoint(createVec2(), point, moved)
    expect(transformPoint(point, point, moved)).toBe(point)
    expectCloseArray(point, expectedPoint)

    const direction = setVec2(createVec2(), 1, 0)
    const rigid = composeTRS(
      createMat3(),
      setVec2(createVec2(), 5, 7),
      HALF_TURN,
      setVec2(createVec2(), 1, 1),
    )
    const expectedDirection = transformVector(createVec2(), direction, rigid)
    expect(transformVector(direction, direction, rigid)).toBe(direction)
    expectCloseArray(direction, expectedDirection)

    const original = fromTranslation(createMat3(), setVec2(createVec2(), 3, -4))
    const expectedInverse = createMat3()
    expect(invertMat3(expectedInverse, original)).toBe(true)
    expect(invertMat3(original, original)).toBe(true)
    expectCloseArray(original, expectedInverse)
  })

  it('相同输入重复运行，结果二进制相同', () => {
    const translation = setVec2(createVec2(), 1.5, -2.25)
    const scale = setVec2(createVec2(), 2, 0.5)
    const rotation = Math.PI / 5
    const first = createMat3()
    const second = createMat3()
    const point = setVec2(createVec2(), 1, 2)
    const pointOut1 = createVec2()
    const pointOut2 = createVec2()

    composeTRS(first, translation, rotation, scale)
    composeTRS(second, translation, rotation, scale)
    expectSameBits(first, second)

    fromRotation(first, HALF_TURN)
    fromRotation(second, HALF_TURN)
    expectSameBits(first, second)

    const matrix = composeTRS(createMat3(), translation, rotation, scale)
    transformPoint(pointOut1, point, matrix)
    transformPoint(pointOut2, point, matrix)
    expectSameBits(pointOut1, pointOut2)
    transformVector(pointOut1, point, matrix)
    transformVector(pointOut2, point, matrix)
    expectSameBits(pointOut1, pointOut2)

    const inverse1 = createMat3()
    const inverse2 = createMat3()
    invertMat3(inverse1, matrix)
    invertMat3(inverse2, matrix)
    expectSameBits(inverse1, inverse2)
    expect(Object.is(determinantMat3(matrix), determinantMat3(matrix))).toBe(true)
  })
})
