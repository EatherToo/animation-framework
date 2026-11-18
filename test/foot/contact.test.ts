import { describe, expect, it } from '@jest/globals'
import {
  ankleFromContact,
  contactFromAnkle,
  lowestSoleOffset,
  soleOffset,
} from '@/foot/contact'
import { createFootShape, soleLocal, stationLocal } from '@/foot/shape'
import { createMat3, createVec2, fromRotation, setVec2, transformVector } from '@/math'
import { expectClose, expectSameBits } from '../math/assert'

const shape = createFootShape(0.258, 0.066)

describe('contact', () => {
  it('脚放平时平足在踝的正下方，往返按位相同', () => {
    const flat = createVec2()
    stationLocal(flat, shape, 'flat')
    const offset = createVec2()
    soleOffset(offset, flat, 0)
    expect(offset[0]).toBe(0)
    expect(offset[1]).toBe(Math.fround(-shape.ankleHeight))

    const ankle = setVec2(createVec2(), 0.2, 0.5)
    const contact = createVec2()
    contactFromAnkle(contact, ankle, flat, 0)
    expect(contact[0]).toBe(ankle[0])
    expect(contact[1]).toBe(Math.fround(ankle[1]! + flat[1]!))

    const back = createVec2()
    ankleFromContact(back, contact, flat, 0)
    expectSameBits(back, ankle)
  })

  it('脚放平时由脚跟接触反推踝', () => {
    const heel = createVec2()
    stationLocal(heel, shape, 'heel')
    const contact = setVec2(createVec2(), 1, 0)
    const ankle = createVec2()
    ankleFromContact(ankle, contact, heel, 0)
    expect(ankle[0]).toBe(Math.fround(contact[0]! - heel[0]!))
    expect(ankle[1]).toBe(Math.fround(contact[1]! - heel[1]!))
    expect(ankle[0]).toBe(Math.fround(1 + Math.fround(shape.heelBack)))
    expect(ankle[1]).toBe(Math.fround(shape.ankleHeight))
  })

  it('直角俯仰把平足转到踝的前方', () => {
    const flat = createVec2()
    stationLocal(flat, shape, 'flat')
    const offset = createVec2()
    soleOffset(offset, flat, Math.PI / 2)
    expectClose(offset[0]!, shape.ankleHeight)
    expectClose(offset[1]!, 0)
  })

  it('正俯仰抬脚尖，负俯仰抬脚跟', () => {
    const heel = createVec2()
    const toe = createVec2()
    stationLocal(heel, shape, 'heel')
    stationLocal(toe, shape, 'toe')
    const heelOffset = createVec2()
    const toeOffset = createVec2()
    soleOffset(heelOffset, heel, 0.4)
    soleOffset(toeOffset, toe, 0.4)
    expect(toeOffset[1]!).toBeGreaterThan(heelOffset[1]!)
    soleOffset(heelOffset, heel, -0.4)
    soleOffset(toeOffset, toe, -0.4)
    expect(heelOffset[1]!).toBeGreaterThan(toeOffset[1]!)
  })

  it('最低点与对应端点的偏移按位相同', () => {
    const heel = createVec2()
    const toe = createVec2()
    stationLocal(heel, shape, 'heel')
    stationLocal(toe, shape, 'toe')
    const fromEnd = createVec2()
    const lowest = createVec2()
    for (const pitch of [0.4, 0, Math.PI]) {
      soleOffset(fromEnd, heel, pitch)
      lowestSoleOffset(lowest, shape, pitch)
      expectSameBits(lowest, fromEnd)
    }
    soleOffset(fromEnd, toe, -0.4)
    lowestSoleOffset(lowest, shape, -0.4)
    expectSameBits(lowest, fromEnd)
  })

  it('接触与踝往返按位相同', () => {
    const ankle = setVec2(createVec2(), -0.15, 0.42)
    const sole = createVec2()
    const contact = createVec2()
    const back = createVec2()
    for (const u of [0, 0.37, 1]) {
      soleLocal(sole, shape, u)
      for (const pitch of [-1.2, 0, 0.4, Math.PI / 2]) {
        contactFromAnkle(contact, ankle, sole, pitch)
        ankleFromContact(back, contact, sole, pitch)
        expectClose(back[0]!, ankle[0]!)
        expectClose(back[1]!, ankle[1]!)
      }
    }
  })

  it('与 fromRotation 的向量变换按位相同', () => {
    const sole = createVec2()
    soleLocal(sole, shape, 0.2)
    const pitch = 0.4
    const direct = createVec2()
    soleOffset(direct, sole, pitch)
    const matrix = fromRotation(createMat3(), pitch)
    const viaMatrix = createVec2()
    transformVector(viaMatrix, sole, matrix)
    expectSameBits(direct, viaMatrix)
  })

  it('非法俯仰或点不改写输出', () => {
    const out = setVec2(createVec2(), 3, 4)
    const sole = setVec2(createVec2(), 0, -0.066)
    expect(() => soleOffset(out, sole, Number.NaN)).toThrow('pitch')
    expect(out[0]).toBe(3)
    expect(out[1]).toBe(4)
    const bad = setVec2(createVec2(), Number.POSITIVE_INFINITY, 0)
    expect(() => soleOffset(out, bad, 0)).toThrow('point')
    expect(out[0]).toBe(3)
    expect(out[1]).toBe(4)
    expect(() => contactFromAnkle(out, bad, sole, 0)).toThrow('point')
    expect(() => ankleFromContact(out, sole, bad, 0)).toThrow('point')
    expect(out[0]).toBe(3)
    expect(out[1]).toBe(4)
  })
})
