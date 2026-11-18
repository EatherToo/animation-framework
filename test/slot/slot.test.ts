import { describe, expect, it } from '@jest/globals'
import {
  SLOT_NONE,
  addSlot,
  createSlotSetBuilder,
  drawOrder,
  findSlot,
  finishSlotSet,
  slotAt,
  type SlotSide,
} from '@/slot/slot'

function add(
  builder: ReturnType<typeof createSlotSetBuilder>,
  partId: string,
  layer: number,
  side: SlotSide,
) {
  return addSlot(builder, { partId, layer, side })
}

describe('slot', () => {
  it('空集合拒绝完成', () => {
    expect(() => finishSlotSet(createSlotSetBuilder())).toThrow(/^empty slot set$/)
  })

  it('非法登记不追加', () => {
    const builder = createSlotSetBuilder()
    expect(() => add(builder, '', 0, 'center')).toThrow(/^id$/)
    add(builder, 'hat', 0, 'center')
    expect(() => add(builder, 'hat', 1, 'left')).toThrow(/^duplicate part id$/)
    expect(() => add(builder, 'pin', 1.5, 'left')).toThrow(/^layer$/)
    expect(() => add(builder, 'pin', Number.NaN, 'left')).toThrow(/^layer$/)
    expect(() => add(builder, 'pin', 1, 'front' as SlotSide)).toThrow(/^side$/)
    expect(builder.slots).toHaveLength(1)
  })

  it('完成后不可再添加', () => {
    const builder = createSlotSetBuilder()
    add(builder, 'torso', 0, 'center')
    const set = finishSlotSet(builder)
    expect(set.slots).not.toBe(builder.slots)
    expect(() => add(builder, 'head', 1, 'center')).toThrow(/^slot set already finished$/)
    expect(findSlot(set, 'torso')).toBe(0)
    expect(findSlot(set, 'missing')).toBe(SLOT_NONE)
    expect(slotAt(set, 0).partId).toBe('torso')
  })

  it('低层次先画，即使后登记', () => {
    const builder = createSlotSetBuilder()
    add(builder, 'head', 2, 'center')
    add(builder, 'torso', 0, 'center')
    add(builder, 'arm', 1, 'left')
    const out = ['', '', '']
    drawOrder(out, finishSlotSet(builder), 1)
    expect(out).toEqual(['torso', 'arm', 'head'])
  })

  it('同一层按远、中线、近排列，朝向交换左右', () => {
    const builder = createSlotSetBuilder()
    add(builder, 'mid', 0, 'center')
    add(builder, 'right', 0, 'right')
    add(builder, 'left', 0, 'left')
    const set = finishSlotSet(builder)
    const facingRight = ['', '', '']
    const facingLeft = ['', '', '']
    drawOrder(facingRight, set, 1)
    drawOrder(facingLeft, set, -1)
    expect(facingRight).toEqual(['left', 'mid', 'right'])
    expect(facingLeft).toEqual(['right', 'mid', 'left'])
  })

  it('同一层同一侧保持登记顺序', () => {
    const builder = createSlotSetBuilder()
    add(builder, 'a', 0, 'left')
    add(builder, 'b', 0, 'left')
    const out = ['', '']
    drawOrder(out, finishSlotSet(builder), 1)
    expect(out).toEqual(['a', 'b'])
  })

  it('非法朝向或长度不符时不写 out', () => {
    const builder = createSlotSetBuilder()
    add(builder, 'torso', 0, 'center')
    const set = finishSlotSet(builder)
    const out = ['keep']
    expect(() => drawOrder(out, set, 0 as 1)).toThrow(/^facing$/)
    expect(out).toEqual(['keep'])
    const wide = ['keep', 'keep']
    expect(() => drawOrder(wide, set, 1)).toThrow(/^order$/)
    expect(wide).toEqual(['keep', 'keep'])
  })
})
