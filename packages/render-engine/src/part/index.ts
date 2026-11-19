/**
 * 06 部件：刚性零件与蒙皮网格两类附着物。
 * 依赖 01 数学与 03 骨架。不生成几何，不排绘制顺序。
 */
export {
  PART_NONE,
  MAX_PARTS,
  createPartSetBuilder,
  finishPartSet,
  partCount,
  partAt,
  findPart,
} from './set'
export type {
  Fill,
  Part,
  PartKind,
  PartSet,
  PartSetBuilder,
  RigidPart,
  SkinnedPart,
} from './set'

export { addRigid, setBoneFromPart } from './rigid'
export type { RigidSpec } from './rigid'

export { addSkinned } from './skin'
export type { SkinnedSpec } from './skin'

export {
  HUMANOID_PART_COUNT,
  HUMANOID_PART_IDS,
  HUMANOID_FILL,
  appendHumanoidParts,
  createHumanoidParts,
} from './humanoid'
export type { HumanoidPartId } from './humanoid'
