/**
 * 36 正交视角：360 档绕身投影与深度排序。
 * 只读蒙皮后的角色空间顶点和槽位次序；不读姿态、朝向和快照。
 */
export {
  VIEW_COUNT,
  VIEW_STEP_DEG,
  DEPTH_EPSILON,
  WINDING_EPSILON,
  isViewIndex,
  viewAngle,
  projectPositions,
  windIndices,
  projectParts,
  depthOrder,
} from './project'
export type { ViewIndex, ViewSource, ProjectedPart } from './project'
