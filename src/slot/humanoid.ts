import type { HumanoidPartId } from '../part/humanoid'
import {
  addSlot,
  createSlotSetBuilder,
  finishSlotSet,
  type SlotSet,
  type SlotSide,
} from './slot'

type HumanoidSlot = {
  readonly partId: HumanoidPartId
  readonly layer: number
  readonly side: SlotSide
}

const HUMANOID_SLOTS: readonly HumanoidSlot[] = [
  { partId: 'legL', layer: 0, side: 'left' },
  { partId: 'legR', layer: 0, side: 'right' },
  { partId: 'footL', layer: 1, side: 'left' },
  { partId: 'footR', layer: 1, side: 'right' },
  { partId: 'torso', layer: 2, side: 'center' },
  { partId: 'armL', layer: 3, side: 'left' },
  { partId: 'armR', layer: 3, side: 'right' },
  { partId: 'handL', layer: 4, side: 'left' },
  { partId: 'handR', layer: 4, side: 'right' },
  { partId: 'head', layer: 5, side: 'center' },
]

/**
 * 首版人形的 10 条槽位。左右成对共用一层。
 */
export function createHumanoidSlots(): SlotSet {
  const builder = createSlotSetBuilder()
  for (let i = 0; i < HUMANOID_SLOTS.length; i += 1) {
    const slot = HUMANOID_SLOTS[i]!
    addSlot(builder, slot)
  }
  return finishSlotSet(builder)
}
