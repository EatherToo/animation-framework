import type {
  RGBA,
  RenderAttachment,
  RenderMesh,
  RenderScene,
  RenderSlot,
  RenderSkin,
} from './types'

/**
 * 校验并冻结一份渲染场景。输入不被修改；返回新的 slots/skins 数组。
 * 失败抛出 `slot` / `skin` / `attachment` / `mesh` / `tint` 等稳定错误名。
 * @param slots 槽位，顺序只作为 `order` 相同时的稳定次序
 * @param skins 可替换附件集合
 */
export function createRenderScene(
  slots: readonly RenderSlot[],
  skins: readonly RenderSkin[],
): RenderScene {
  const slotIds = new Set<string>()
  for (const slot of slots) {
    if (slot.id.length === 0 || slotIds.has(slot.id)) throw new Error('slot')
    slotIds.add(slot.id)
    if (!Number.isFinite(slot.order)) throw new Error('order')
    checkColor(slot.tint)
    if (!['normal', 'add', 'multiply', 'screen'].includes(slot.blend)) throw new Error('blend')
    if (slot.mask !== null && typeof slot.mask !== 'string') throw new Error('mask')
  }
  const skinIds = new Set<string>()
  const attachments = new Map<string, RenderAttachment>()
  for (const skin of skins) {
    if (skin.id.length === 0 || skinIds.has(skin.id)) throw new Error('skin')
    skinIds.add(skin.id)
    const local = new Set<string>()
    for (const attachment of skin.attachments) {
      if (attachment.id.length === 0 || local.has(attachment.id)) throw new Error('attachment')
      if (attachment.skin !== skin.id) throw new Error('attachment')
      local.add(attachment.id)
      if (attachments.has(attachment.id)) throw new Error('attachment')
      attachments.set(attachment.id, attachment)
      validateMesh(attachment.mesh)
      validateMaterial(attachment)
      if (attachment.outline !== null) validateOutline(attachment.outline)
    }
  }
  for (const slot of slots) {
    if (slot.attachment !== null && !attachments.has(slot.attachment)) throw new Error('attachment')
  }
  return {
    slots: slots.slice(),
    skins: skins.slice(),
  }
}

/**
 * 按 id 找槽位；找不到返回 -1。
 * @param scene 场景
 * @param slotId 槽位 id
 */
export function findRenderSlot(scene: RenderScene, slotId: string): number {
  for (let i = 0; i < scene.slots.length; i += 1) {
    if (scene.slots[i]!.id === slotId) return i
  }
  return -1
}

/**
 * 按 id 找附件；找不到返回 null。
 * @param scene 场景
 * @param attachmentId 附件 id
 */
export function findRenderAttachment(
  scene: RenderScene,
  attachmentId: string,
): RenderAttachment | null {
  for (const skin of scene.skins) {
    for (const attachment of skin.attachments) {
      if (attachment.id === attachmentId) return attachment
    }
  }
  return null
}

/**
 * 取槽位当前附件；无附件返回 null。
 * @param scene 场景
 * @param slot 槽位
 */
export function attachmentOf(scene: RenderScene, slot: RenderSlot): RenderAttachment | null {
  if (slot.attachment === null) return null
  return findRenderAttachment(scene, slot.attachment)
}

/**
 * 换附件，返回新的场景（不改原场景）。
 * @param scene 场景
 * @param slotId 槽位 id
 * @param attachmentId 新附件 id；null 表示隐藏
 */
export function setSlotAttachment(
  scene: RenderScene,
  slotId: string,
  attachmentId: string | null,
): RenderScene {
  const index = findRenderSlot(scene, slotId)
  if (index < 0) throw new Error('slot')
  if (attachmentId !== null && findRenderAttachment(scene, attachmentId) === null) {
    throw new Error('attachment')
  }
  const slots = scene.slots.slice()
  slots[index] = { ...slots[index]!, attachment: attachmentId }
  return { slots, skins: scene.skins }
}

/**
 * 改绘制主序，返回新的场景。
 * @param scene 场景
 * @param slotId 槽位 id
 * @param order 新主序
 */
export function setSlotOrder(scene: RenderScene, slotId: string, order: number): RenderScene {
  if (!Number.isFinite(order)) throw new Error('order')
  const index = findRenderSlot(scene, slotId)
  if (index < 0) throw new Error('slot')
  const slots = scene.slots.slice()
  slots[index] = { ...slots[index]!, order }
  return { slots, skins: scene.skins }
}

/**
 * 计算网格的平面包围盒。
 * @param positions 步长 2
 */
export function meshBounds(positions: Float32Array): { x: number; y: number; width: number; height: number } {
  if (positions.length < 2 || positions.length % 2 !== 0) throw new Error('mesh')
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let i = 0; i < positions.length; i += 2) {
    const x = positions[i]!
    const y = positions[i + 1]!
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('mesh')
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function validateMesh(mesh: RenderMesh): void {
  const count = mesh.positions.length / 2
  if (mesh.positions.length === 0 || mesh.positions.length % 2 !== 0) throw new Error('mesh')
  for (const value of mesh.positions) if (!Number.isFinite(value)) throw new Error('mesh')
  if (mesh.indices.length < 3 || mesh.indices.length % 3 !== 0) throw new Error('mesh')
  for (const index of mesh.indices) {
    if (index >= count) throw new Error('mesh')
  }
  if (mesh.uvs.length !== 0 && mesh.uvs.length !== count * 2) throw new Error('mesh')
  for (const value of mesh.uvs) if (!Number.isFinite(value)) throw new Error('mesh')
  if (mesh.colors.length !== 0 && mesh.colors.length !== count * 4) throw new Error('mesh')
  if (mesh.seam.length !== 0 && mesh.seam.length !== count) throw new Error('mesh')
  if (mesh.depth.length !== count) throw new Error('depth')
  for (const value of mesh.depth) if (!Number.isFinite(value)) throw new Error('depth')
  const weighted = mesh.weights.length !== 0 || mesh.boneIndices.length !== 0
  if (weighted) {
    if (mesh.weights.length !== count * 4 || mesh.boneIndices.length !== count * 4) {
      throw new Error('weights')
    }
    for (const value of mesh.weights) {
      if (!Number.isFinite(value) || value < 0) throw new Error('weights')
    }
  }
  if (mesh.bounds !== null) {
    for (const value of [mesh.bounds.x, mesh.bounds.y, mesh.bounds.width, mesh.bounds.height]) {
      if (!Number.isFinite(value)) throw new Error('bounds')
    }
    if (mesh.bounds.width < 0 || mesh.bounds.height < 0) throw new Error('bounds')
  }
}

function validateMaterial(attachment: RenderAttachment): void {
  const material = attachment.material
  if (material.kind === 'flat') {
    checkColor(material.color)
    return
  }
  if (material.kind !== 'atlas') throw new Error('material')
  if (!Number.isInteger(material.page) || material.page < 0) throw new Error('material')
  for (const value of [
    material.region.x,
    material.region.y,
    material.region.width,
    material.region.height,
  ]) {
    if (!Number.isFinite(value)) throw new Error('material')
  }
  if (material.region.width <= 0 || material.region.height <= 0) throw new Error('material')
  checkColor(material.tint)
  if (material.filter !== 'linear' && material.filter !== 'nearest') throw new Error('material')
}

function validateOutline(outline: NonNullable<RenderAttachment['outline']>): void {
  if (!Number.isFinite(outline.widthPx) || outline.widthPx <= 0) throw new Error('outline')
  checkColor(outline.color)
  if (!['round', 'bevel', 'miter'].includes(outline.join)) throw new Error('outline')
  if (!['butt', 'round', 'square'].includes(outline.cap)) throw new Error('outline')
  if (!Number.isFinite(outline.depthBias)) throw new Error('outline')
}

function checkColor(color: RGBA): void {
  for (const value of [color.r, color.g, color.b, color.a]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('tint')
  }
}
