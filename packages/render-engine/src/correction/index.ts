/**
 * 11 关节修正：扭转与大摆/大屈径向外推，减轻 LBS 糖纸塌缩。
 */
export { createCorrection, applyCorrection } from './correction'
export type { Correction, CorrectionContext, CorrectionOptions } from './correction'
