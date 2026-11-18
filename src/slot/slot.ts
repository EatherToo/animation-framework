import { farSide, isFacing, nearSide, type Facing } from '../space/facing'

/** `findSlot` 找不到时的下标。 */
export const SLOT_NONE = -1

/** 一份槽位集合的最大件数。 */
export const MAX_SLOTS = 256

/** 解剖侧。中线不随朝向交换。 */
export type SlotSide = 'left' | 'right' | 'center'

/** 一个部件的绘制层次。 */
export type Slot = {
  readonly partId: string
  readonly layer: number
  readonly side: SlotSide
}

/** 追加槽位时的输入。 */
export type SlotSpec = {
  readonly partId: string
  readonly layer: number
  readonly side: SlotSide
}

/** 已完成的槽位集合。 */
export type SlotSet = {
  readonly slots: readonly Slot[]
}

/**
 * 建造期草稿。字段仅供本模块写入。
 */
export type SlotSetBuilder = {
  finished: boolean
  slots: Slot[]
}

const SIDES: readonly SlotSide[] = ['left', 'right', 'center']

/**
 * 创建空建造器。
 */
export function createSlotSetBuilder(): SlotSetBuilder {
  return { finished: false, slots: [] }
}

/**
 * 追加一条槽位。失败时不修改建造器。
 * @param builder 建造器
 * @param spec 部件、层次与解剖侧
 */
export function addSlot(builder: SlotSetBuilder, spec: SlotSpec): number {
  if (builder.finished) throw new Error('slot set already finished')
  if (builder.slots.length >= MAX_SLOTS) throw new Error('too many slots')
  if (typeof spec.partId !== 'string' || spec.partId.length === 0) throw new Error('id')
  for (let i = 0; i < builder.slots.length; i += 1) {
    if (builder.slots[i]!.partId === spec.partId) throw new Error('duplicate part id')
  }
  if (!Number.isInteger(spec.layer)) throw new Error('layer')
  if (!SIDES.includes(spec.side)) throw new Error('side')

  const index = builder.slots.length
  builder.slots.push({
    partId: spec.partId,
    layer: spec.layer,
    side: spec.side,
  })
  return index
}

/**
 * 冻结槽位集合。空集合或已完成时抛出。
 * @param builder 建造器
 */
export function finishSlotSet(builder: SlotSetBuilder): SlotSet {
  if (builder.finished) throw new Error('slot set already finished')
  if (builder.slots.length === 0) throw new Error('empty slot set')
  builder.finished = true
  return { slots: builder.slots.slice() }
}

/**
 * 件数。
 * @param set 槽位集合
 */
export function slotCount(set: SlotSet): number {
  return set.slots.length
}

/**
 * 按下标读取。越界抛出 `slot`。
 * @param set 槽位集合
 * @param index 登记下标
 */
export function slotAt(set: SlotSet, index: number): Slot {
  if (!Number.isInteger(index) || index < 0 || index >= set.slots.length) {
    throw new Error('slot')
  }
  return set.slots[index]!
}

/**
 * 按部件 id 查找。找不到返回 {@link SLOT_NONE}。
 * @param set 槽位集合
 * @param partId 部件名字
 */
export function findSlot(set: SlotSet, partId: string): number {
  for (let i = 0; i < set.slots.length; i += 1) {
    if (set.slots[i]!.partId === partId) return i
  }
  return SLOT_NONE
}

/**
 * 从远到近把部件 id 写入 `out`。
 * @param out 长度必须等于件数
 * @param set 槽位集合
 * @param facing 当前朝向
 * @returns `out`
 */
export function drawOrder(out: string[], set: SlotSet, facing: Facing): string[] {
  if (!isFacing(facing)) throw new Error('facing')
  const count = set.slots.length
  if (out.length !== count) throw new Error('order')

  const order = new Array<number>(count)
  for (let i = 0; i < count; i += 1) order[i] = i
  const near = nearSide(facing)
  const far = farSide(facing)
  order.sort((a, b) => compareSlot(set, a, b, near, far))
  for (let i = 0; i < count; i += 1) out[i] = set.slots[order[i]!]!.partId
  return out
}

function compareSlot(
  set: SlotSet,
  a: number,
  b: number,
  near: 'left' | 'right',
  far: 'left' | 'right',
): number {
  const sa = set.slots[a]!
  const sb = set.slots[b]!
  if (sa.layer !== sb.layer) return sa.layer - sb.layer
  const bandA = band(sa.side, near, far)
  const bandB = band(sb.side, near, far)
  if (bandA !== bandB) return bandA - bandB
  return a - b
}

function band(side: SlotSide, near: 'left' | 'right', far: 'left' | 'right'): number {
  if (side === far) return 0
  if (side === 'center') return 1
  if (side === near) return 2
  return 1
}
