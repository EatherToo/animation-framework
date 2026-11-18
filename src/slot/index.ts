/**
 * 07 槽位：部件的绘制层次。与骨头父子无关。
 * 依赖 02 空间契约与 06 部件名字。
 */
export {
  SLOT_NONE,
  MAX_SLOTS,
  createSlotSetBuilder,
  addSlot,
  finishSlotSet,
  slotCount,
  slotAt,
  findSlot,
  drawOrder,
} from './slot'
export type { Slot, SlotSet, SlotSetBuilder, SlotSide, SlotSpec } from './slot'

export { createHumanoidSlots } from './humanoid'
