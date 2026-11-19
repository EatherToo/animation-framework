import { describe, expect, it } from '@jest/globals'
import { drawOrder } from '@/slot/slot'
import { createHumanoidSlots } from '@/slot/humanoid'

describe('humanoid slots', () => {
  it('10 条槽位与两种朝向的绘制顺序', () => {
    const set = createHumanoidSlots()
    expect(set.slots.map((slot) => [slot.partId, slot.layer, slot.side])).toEqual([
      ['legL', 0, 'left'],
      ['legR', 0, 'right'],
      ['footL', 1, 'left'],
      ['footR', 1, 'right'],
      ['torso', 2, 'center'],
      ['armL', 3, 'left'],
      ['armR', 3, 'right'],
      ['handL', 4, 'left'],
      ['handR', 4, 'right'],
      ['head', 5, 'center'],
    ])
    const nearRight = Array<string>(10).fill('')
    const nearLeft = Array<string>(10).fill('')
    drawOrder(nearRight, set, 1)
    drawOrder(nearLeft, set, -1)
    expect(nearRight).toEqual([
      'legL',
      'legR',
      'footL',
      'footR',
      'torso',
      'armL',
      'armR',
      'handL',
      'handR',
      'head',
    ])
    expect(nearLeft).toEqual([
      'legR',
      'legL',
      'footR',
      'footL',
      'torso',
      'armR',
      'armL',
      'handR',
      'handL',
      'head',
    ])
  })
})
