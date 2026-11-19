/**
 * 02 空间契约：朝向、世界点、实例变换矩阵、长度容差。
 * 只依赖 01 数学；不保存骨骼、不读宿主相机。
 */
export type { Facing, Side } from './facing'
export { isFacing, nearSide, farSide, mirrorAngle, mirrorVec2 } from './facing'
export type { WorldPoint } from './world-point'
export {
  createWorldPoint,
  setWorldPoint,
  copyWorldPoint,
  rigToWorldPoint,
  worldToRigPoint,
} from './world-point'
export { setWorldFromRig, setRigFromWorld, orientationSign } from './rig-transform'
export { LENGTH_EPSILON } from './tolerance'
