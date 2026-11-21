/**
 * 38 2D 渲染管线（R1 数据模型）。
 * 只描述 Slot/Attachment/Skin 与 RenderPacket，不依赖 Canvas / WebGL / DOM。
 */
export {
  attachmentOf,
  createRenderScene,
  findRenderAttachment,
  findRenderSlot,
  meshBounds,
  setSlotAttachment,
  setSlotOrder,
} from './scene'
export { buildRenderPacket, buildRenderPackets, sortRenderPackets, splitEqualOrderOverlaps, validateRenderPacket } from './packet'
export type { BackendKind, BackendStats, MaskSet, RenderBackend } from './backend'
export { buildOutlineRibbon } from './outline'
export { buildHandVolumeParts } from './hand3d'
export { buildVolumetricPackets } from './volumetric'
export { splitPacketByLine } from './split'
export { blendColor, packAtlas, packAtlasPages, regionUv, sampleAtlas } from './atlas'
export { paintPackets, rasterizeMask } from './raster'
export type { MaskOptions, RasterAtlas, RasterOptions, RasterTarget, RasterTransform } from './raster'
export type { Atlas, AtlasImage, AtlasItem, AtlasOptions, AtlasPagesOptions, AtlasRegion, UVRect } from './atlas'
export type { OutlineRibbon } from './outline'
export {
  armMeshVertexCount,
  buildArmAttachment,
  buildLegAttachment,
  frontDepth,
  frontPoint,
  legMeshVertexCount,
  outlineToMesh,
} from './limb'
export {
  applyHumanoidAtlas,
  createHumanoidAtlas,
  sampleHumanoid2DAtlasPackets,
  type AtlasPageImage,
  type AtlasRegionRef,
  type HumanoidAtlas,
} from './humanoidAtlas'
export {
  buildFootAttachment,
  buildHandAttachment,
  buildSkinnedHandAttachment,
  buildHeadAttachment,
  buildHumanoid2DScene,
  buildTorsoAttachment,
  sampleHumanoid2DPackets,
} from './humanoid2d'
export type {
  BlendMode,
  OutlineCap,
  OutlineJoin,
  Rect,
  RenderAttachment,
  RenderMaterial,
  RenderMesh,
  RenderOutline,
  RenderPacket,
  RenderScene,
  RenderSkin,
  RenderSlot,
  RGBA,
} from './types'
export { RENDER_PACKET_VERSION } from './types'
