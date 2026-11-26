/**
 * core2d 插槽 / 附件 / 皮肤。权威：docs/04-插槽附件皮肤.md。
 * slot 只决定绘制顺序/颜色/混合；几何在附件局部；skin 是命名附件集合。
 */
import type { BoneId } from '../core/skeleton'
import type { MeshData, WeightedMeshData } from '../mesh/mesh'

export type RGBA = { readonly r: number; readonly g: number; readonly b: number; readonly a: number }
/** Fresh instance tint; slot/attachment colors remain independent. */
export function whiteSkeletonColor(): { r: number; g: number; b: number; a: number } {
  return { r: 1, g: 1, b: 1, a: 1 }
}
export type BlendMode = 'normal' | 'add' | 'multiply' | 'screen'
export type RegionRef = {
  readonly atlasKey: string
  readonly uvs: Float32Array | null
  /** 附件局部尺寸/中心偏移/旋转/缩放；缺省回退 1×1 单位方块以兼容旧资产。 */
  readonly width?: number
  readonly height?: number
  readonly x?: number
  readonly y?: number
  readonly rotation?: number
  readonly scaleX?: number
  readonly scaleY?: number
  /** Spine 4.3 sequence：帧 region 列表与 setup 帧；缺省为普通 region。 */
  readonly sequence?: { readonly frames: readonly string[]; readonly setupIndex: number }
}

export type SpinePathData = {
  readonly vertices: readonly (readonly { readonly bone: number; readonly x: number; readonly y: number; readonly weight: number }[])[]
  readonly lengths: Float32Array
  readonly closed: boolean
  readonly constantSpeed: boolean
}

export type Attachment =
  | { kind: 'region'; id: string; region: RegionRef; color: RGBA; dark?: RGBA }
  | { kind: 'mesh'; id: string; mesh: MeshData; region: RegionRef; color: RGBA; dark?: RGBA }
  | { kind: 'weightedMesh'; id: string; mesh: WeightedMeshData; region: RegionRef; color: RGBA; dark?: RGBA }
  | { kind: 'boundingBox' | 'path'; id: string; polygon: Float32Array; pathData?: SpinePathData }
  | { kind: 'clipping'; id: string; polygon: Float32Array; endSlotId?: string }
  | { kind: 'point'; id: string; point: readonly [number, number] }

export type SlotData = {
  readonly id: string
  readonly bone: BoneId
  readonly order: number
  readonly color: RGBA
  /** two-color tint 的暗部颜色；缺省透明。 */
  readonly dark?: RGBA
  readonly blend: BlendMode
  readonly attachment: string | null
  readonly mask: string | null
  /** 无量纲层带；越大越近、后画。 */
  readonly zOffset: number
}

export type SkinData = {
  readonly id: string
  readonly attachments: ReadonlyMap<string, Attachment>
}

export type SlotState = {
  readonly data: SlotData
  skinId: string
  attachmentId: string | null
  color: RGBA
}

export type SlotSet = {
  readonly slots: readonly SlotState[]
  readonly skins: ReadonlyMap<string, SkinData>
  /** slot 下标的完整排列，越小越先画。 */
  drawOrder: number[]
}

export function createSlotSet(
  slots: readonly SlotData[],
  skins: ReadonlyMap<string, SkinData>,
  defaultSkinId: string,
): SlotSet {
  if (!skins.has(defaultSkinId)) throw new Error('slot.skin')
  return {
    slots: slots.map((data) => ({
      data,
      skinId: defaultSkinId,
      attachmentId: data.attachment,
      color: data.color,
    })),
    skins,
    drawOrder: slots.map((_, i) => i).sort((a, b) => slots[a]!.order - slots[b]!.order),
  }
}

export function setSkin(set: SlotSet, skinId: string): void {
  if (!set.skins.has(skinId)) throw new Error('slot.skin')
  for (const slot of set.slots) slot.skinId = skinId
}

export function setSlotAttachment(set: SlotSet, slotIndex: number, attachmentId: string | null): void {
  const slot = set.slots[slotIndex]
  if (!slot) throw new Error('slot.index')
  slot.attachmentId = attachmentId
}

export function setSlotColor(set: SlotSet, slotIndex: number, packed: number): void {
  const slot = set.slots[slotIndex]
  if (!slot) throw new Error('slot.index')
  if (!Number.isInteger(packed) || packed < 0 || packed > 0xffffffff) throw new Error('slot.color')
  slot.color = {
    a: ((packed >>> 24) & 0xff) / 255,
    r: ((packed >>> 16) & 0xff) / 255,
    g: ((packed >>> 8) & 0xff) / 255,
    b: (packed & 0xff) / 255,
  }
}

export function resolveAttachment(set: SlotSet, slotIndex: number): Attachment | null {
  const slot = set.slots[slotIndex]
  if (!slot || slot.attachmentId === null) return null
  const skin = set.skins.get(slot.skinId)
  // Spine attachment names are local to each slot. The unqualified lookup
  // remains a fallback for native assets that use a flat attachment map.
  return skin?.attachments.get(`${slot.data.id}\u0000${slot.attachmentId}`)
    ?? skin?.attachments.get(slot.attachmentId) ?? null
}

/** region/mesh/weightedMesh 产生渲染几何；其余附件只参与逻辑。 */
export function isRenderable(a: Attachment): boolean {
  return a.kind === 'region' || a.kind === 'mesh' || a.kind === 'weightedMesh'
}

/** DrawOrder 必须是 [0, n) 的全排列。 */
export function validateDrawOrder(order: readonly number[], slotCount: number): boolean {
  if (order.length !== slotCount) return false
  const seen = new Uint8Array(slotCount)
  for (const id of order) {
    if (!Number.isInteger(id) || id < 0 || id >= slotCount || seen[id] !== 0) return false
    seen[id] = 1
  }
  return true
}

export function setDrawOrder(set: SlotSet, order: readonly number[]): void {
  if (!validateDrawOrder(order, set.slots.length)) throw new Error('slot.drawOrder')
  set.drawOrder.length = 0
  set.drawOrder.push(...order)
}
