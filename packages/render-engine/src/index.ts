/**
 * 类 Spine 2D 骨骼动画引擎公共入口。
 * 目录按技术方案分层：core / slot / mesh / animation / constraint /
 * render / backend / volume / asset / runtime / app / tools。
 */
export * from './core/math'
export * from './core/skeleton'
export * from './core/pose'
export * from './slot/slot'
export * from './mesh/mesh'
export * from './animation/animation'
export * from './constraint/constraint'
export * from './physics/physics'
export type {
  PacketKind, RenderPacket, RenderFrame, AtlasRect, AtlasPage, AtlasRegionRef,
  BuildPacketArgs, BuildMeshPacketArgs, TextureData, MaterialDef, RenderAssets,
  MaskPathNode, RenderMask, RenderMaskSet,
} from './render/render'
export {
  toPma, atlasRegionUv, buildRegionPacket, buildMeshPacket,
  sortPackets, batchKey, validateAtlasPages, validateMaskPath, outlineEdges,
  sampleTexture, validateAssets, maskChain, validateMaskPaths, buildMaskSet,
} from './render/render'
export * from './backend/backend'
export * from './render/camera'
export * from './volume/volume'
export * from './volume/dqs'
export * from './asset/importer'
export * from './asset/atlas'
export * from './runtime/runtime'
export * from './app/app'
export * from './tools/tools'
