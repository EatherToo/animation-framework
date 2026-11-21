/**
 * 36 正交视角：360 档绕身投影与深度排序。
 * 读蒙皮后的角色空间顶点、2D 手臂的骨轴端点和槽位次序；不读姿态、朝向和快照。
 * 2D 手臂在这里按当前视角重新生成屏幕轮廓，保证任何视角都不会投影退化。
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
