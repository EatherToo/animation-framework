/** 二骨链：根 / 中 / 末端下标，以及中关节 ROM 与弯曲符号。 */
export type TwoBoneChain = {
  /** 链根骨头下标（大腿 / 上臂） */
  readonly root: number
  /** 中骨头下标（小腿 / 前臂） */
  readonly mid: number
  /** 末端骨头下标（脚 / 手）；IK 目标枢轴是该骨在中骨下的绑定原点 */
  readonly end: number
  /** 弯曲符号，+1 或 −1 */
  readonly bendSign: 1 | -1
  /** 中骨 pose 旋转下限（弧度） */
  readonly romMin: number
  /** 中骨 pose 旋转上限（弧度） */
  readonly romMax: number
}

/** 建造二骨链时的入参。 */
export type TwoBoneChainSpec = {
  readonly root: number
  readonly mid: number
  readonly end: number
  readonly bendSign: 1 | -1
  readonly romMin: number
  readonly romMax: number
}

/** 腿链默认弯曲符号。 */
export const LEG_BEND_SIGN: 1 = 1

/** 臂链默认弯曲符号。手在肩下时，肘在身后，叉积为负。 */
export const ARM_BEND_SIGN: -1 = -1

/** 膝 pose 旋转下限（弧度，≈ −150°）。 */
export const LEG_ROM_MIN = -2.618

/** 膝 pose 旋转上限（弧度，≈ +2°）。 */
export const LEG_ROM_MAX = 0.035

/** 肘 pose 旋转下限（弧度，≈ −140°）。 */
export const ARM_ROM_MIN = -2.443

/** 肘 pose 旋转上限（弧度，≈ +10°）。 */
export const ARM_ROM_MAX = 0.175

/**
 * 校验并返回只读二骨链。装配阶段调用。
 * @param spec 链规格
 */
export function makeTwoBoneChain(spec: TwoBoneChainSpec): TwoBoneChain {
  if (
    !Number.isInteger(spec.root) ||
    !Number.isInteger(spec.mid) ||
    !Number.isInteger(spec.end) ||
    spec.root < 0 ||
    spec.mid < 0 ||
    spec.end < 0
  ) {
    throw new Error('bone index')
  }
  if (spec.root === spec.mid || spec.mid === spec.end || spec.root === spec.end) {
    throw new Error('bone index')
  }
  if (spec.bendSign !== 1 && spec.bendSign !== -1) throw new Error('bendSign')
  if (
    !Number.isFinite(spec.romMin) ||
    !Number.isFinite(spec.romMax) ||
    !(spec.romMin < spec.romMax)
  ) {
    throw new Error('rom')
  }
  return {
    root: spec.root,
    mid: spec.mid,
    end: spec.end,
    bendSign: spec.bendSign,
    romMin: spec.romMin,
    romMax: spec.romMax,
  }
}
