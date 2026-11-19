/**
 * 08 网格生成：肢体圆管、加盖圆管与脚的平板。
 * 依赖数学、骨架、体型与部件。
 */
export { TUBE_SIDES, meshFromStrip, meshFromCappedTube, meshFromRectangle } from './strip'
export type { Mesh, MeshSet, MeshSpace, StripSegment } from './strip'

export { createHumanoidMeshes } from './humanoid'
