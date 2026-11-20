/**
 * 08 网格生成：肢体圆管、加盖圆管、星形截面与矩形。
 * 依赖数学、骨架、体型与部件。
 */
export { AXIAL_STEPS, TUBE_SIDES, meshFromStrip, meshFromCappedTube, meshFromCappedSection, meshFromRectangle } from './strip'
export type { Mesh, MeshSet, MeshSpace, StripSegment } from './strip'

export { TEXTURE_EDGE, createTriangleTexture, createMeshTextures, validateMeshTextures } from './texture'
export type { Texture } from './texture'

export { createHumanoidMeshes } from './humanoid'
