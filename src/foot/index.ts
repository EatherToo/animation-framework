/**
 * 05 足部几何：脚底相对踝的外形，以及接触点与踝的换算。
 * 只依赖 01 数学。尺度由调用方传入。
 */
export {
  HEEL_BACK_RATIO,
  FLAT_PARAMETER,
  createFootShape,
  stationParameter,
  soleLocal,
  stationLocal,
} from './shape'
export type { FootShape, FootStation } from './shape'

export {
  soleOffset,
  contactFromAnkle,
  ankleFromContact,
  lowestSoleOffset,
} from './contact'
