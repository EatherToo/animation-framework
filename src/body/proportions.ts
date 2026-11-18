/** 由站立身高导出的体型比例量（米；`reachMargin` 无量纲）。 */
export type BodyProportions = {
  readonly height: number
  /** 骨盆高度（脚底 → 髋关节），米 */
  readonly hipHeight: number
  /** 踝关节相对脚底的高度，米 */
  readonly ankleHeight: number
  readonly pelvisLength: number
  readonly spineLength: number
  readonly chestLength: number
  readonly neckLength: number
  readonly headLength: number
  readonly upperArmLength: number
  readonly lowerArmLength: number
  readonly handLength: number
  readonly thighLength: number
  readonly shinLength: number
  readonly footLength: number
  /** thigh + shin */
  readonly legLength: number
  readonly spineRadius: number
  readonly chestRadius: number
  readonly neckRadius: number
  readonly headRadius: number
  readonly upperArmRadius: number
  readonly lowerArmRadius: number
  readonly handRadius: number
  readonly thighRadius: number
  readonly shinRadius: number
  readonly footRadius: number
  /** 左右踝绑定位置在角色 +X 上的间距，米 */
  readonly stanceWidth: number
  /** 半髋宽：髋相对骨盆中线沿角色 +X 的偏移绝对值，米 */
  readonly hipOffsetX: number
  /** 肩相对胸中线沿角色 +X 的偏移绝对值，米 */
  readonly shoulderOffsetX: number
  /**
   * 髋相对骨盆原点沿 −Y 的偏移，米（字段值为非负；绑定写 `−hipDropY`）。
   * 派生：`hipHeight − thighLength − shinLength − ankleHeight`。
   */
  readonly hipDropY: number
  /** 肩相对胸局部原点沿 −Y 的偏移，米 */
  readonly shoulderDropY: number
  /**
   * 可达余量，无量纲，落在 (0, 1]。
   * 规划用最大够及距离 = reachMargin · legLength。
   */
  readonly reachMargin: number
}

const REACH_MARGIN = 0.98

/**
 * 把站立身高换成一份只读比例量。
 * @param height 站立身高（米），须有限且 &gt; 0
 */
export function createProportions(height: number): BodyProportions {
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error('height')
  }

  const H = height
  const hipHeight = 0.53 * H
  const ankleHeight = 0.039 * H
  const thighLength = 0.245 * H
  const shinLength = 0.246 * H
  const stanceWidth = 0.1 * H

  return {
    height: H,
    hipHeight,
    ankleHeight,
    pelvisLength: 0.05 * H,
    spineLength: 0.144 * H,
    chestLength: 0.144 * H,
    neckLength: 0.052 * H,
    headLength: 0.13 * H,
    upperArmLength: 0.186 * H,
    lowerArmLength: 0.146 * H,
    handLength: 0.108 * H,
    thighLength,
    shinLength,
    footLength: 0.152 * H,
    legLength: thighLength + shinLength,
    spineRadius: 0.045 * H,
    chestRadius: 0.055 * H,
    neckRadius: 0.025 * H,
    headRadius: 0.065 * H,
    upperArmRadius: 0.03 * H,
    lowerArmRadius: 0.024 * H,
    handRadius: 0.022 * H,
    thighRadius: 0.045 * H,
    shinRadius: 0.032 * H,
    footRadius: 0.028 * H,
    stanceWidth,
    hipOffsetX: stanceWidth / 2,
    shoulderOffsetX: 0.08 * H,
    hipDropY: hipHeight - thighLength - shinLength - ankleHeight,
    shoulderDropY: 0.02 * H,
    reachMargin: REACH_MARGIN,
  }
}
