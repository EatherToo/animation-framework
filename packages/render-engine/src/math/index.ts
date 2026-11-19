/**
 * 01 数学：Vec2 / Vec3 / Mat3 / 角度。
 * 写出结果的函数把 `out` 放第一参数。
 */
export type { Vec2 } from './vec2'
export {
  createVec2,
  setVec2,
  copyVec2,
  addVec2,
  subVec2,
  scaleVec2,
  negateVec2,
  dotVec2,
  crossVec2,
  normalVec2,
  lengthVec2,
  squaredLengthVec2,
  distanceVec2,
  normalizeVec2,
  lerpVec2,
} from './vec2'

export type { Vec3 } from './vec3'
export {
  createVec3,
  setVec3,
  copyVec3,
  crossVec3,
  lengthVec3,
  normalizeVec3,
  normalVec3,
  faceNormalVec3,
} from './vec3'

export type { Mat3 } from './mat3'
export {
  createMat3,
  identityMat3,
  copyMat3,
  multiplyMat3,
  invertMat3,
  determinantMat3,
  fromTranslation,
  fromRotation,
  fromScaling,
  translateMat3,
  rotateMat3,
  scaleMat3,
  composeTRS,
  transformPoint,
  transformVector,
} from './mat3'

export { degToRad, radToDeg, normalizeAngle, angleDelta } from './angle'
