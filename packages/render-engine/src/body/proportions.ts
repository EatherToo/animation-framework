/** 沿骨轴或脚底的一个截面样本。`t` 从 0 到 1，`radius` 为米。 */
export type RadiusSample = {
  readonly t: number
  readonly radius: number
}

/** 严格按 `t` 递增的截面轮廓。 */
export type RadiusProfile = readonly RadiusSample[]

/** 由站立身高导出的体型比例量（米；`reachMargin` 和无量纲分数除外）。 */
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
  readonly spineProfile: RadiusProfile
  readonly chestProfile: RadiusProfile
  readonly neckProfile: RadiusProfile
  readonly headProfile: RadiusProfile
  readonly upperArmProfile: RadiusProfile
  readonly lowerArmProfile: RadiusProfile
  readonly thighProfile: RadiusProfile
  readonly shinProfile: RadiusProfile
  readonly palmRadius: number
  readonly palmFraction: number
  readonly fingerRadius: number
  readonly fingerFraction: number
  readonly fingerSpread: readonly [number, number]
  readonly thumbRadius: number
  readonly thumbFraction: number
  readonly thumbAlong: number
  readonly thumbDrop: number
  readonly thumbOffsetZ: number
  readonly heelBack: number
  readonly footHalfWidth: RadiusProfile
  readonly footInstep: RadiusProfile
  /** 左右踝绑定位置在角色 z 上的间距，米 */
  readonly stanceWidth: number
  /** 半髋宽：髋相对骨盆中线沿角色 z 的偏移绝对值，米。左侧为正 */
  readonly hipOffsetZ: number
  /** 肩相对胸中线沿角色 z 的偏移绝对值，米。左侧为正 */
  readonly shoulderOffsetZ: number
  /**
   * 髋相对骨盆原点沿 −Y 的偏移，米（字段值为非负；绑定写 `−hipDropY`）。
   * 派生：`hipHeight − thighLength − shinLength − ankleHeight`。
   */
  readonly hipDropY: number
  /**
   * 肩在胸骨末端以下的距离，米。沿胸的骨轴往回量。
   * 胸的局部 `+X` 朝上，绑定写 `chestLength − shoulderDropY`。
   */
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
  const footLength = 0.152 * H
  const chestLength = 0.144 * H
  const shoulderDropY = 0.02 * H
  const stanceWidth = 0.12 * H
  const shoulderOffsetZ = 0.11 * H

  return {
    height: H,
    hipHeight,
    ankleHeight,
    pelvisLength: 0.05 * H,
    spineLength: 0.144 * H,
    chestLength,
    neckLength: 0.052 * H,
    headLength: 0.13 * H,
    upperArmLength: 0.186 * H,
    lowerArmLength: 0.146 * H,
    handLength: 0.108 * H,
    thighLength,
    shinLength,
    footLength,
    legLength: thighLength + shinLength,
    spineProfile: profile(H, [[0, 0.09], [0.55, 0.062], [1, 0.062]]),
    chestProfile: profile(H, [
      [0, 0.062],
      [0.45, 0.08],
      [1 - shoulderDropY / chestLength, 0.11],
      [1, 0.036],
    ]),
    neckProfile: profile(H, [[0, 0.036], [1, 0.032]]),
    headProfile: profile(H, [[0, 0.032], [0.45, 0.078], [1, 0.028]]),
    upperArmProfile: profile(H, [[0, 0.04], [0.5, 0.032], [1, 0.018]]),
    lowerArmProfile: profile(H, [[0, 0.018], [0.5, 0.026], [1, 0.016]]),
    thighProfile: profile(H, [[0, 0.072], [0.4, 0.06], [1, 0.026]]),
    shinProfile: profile(H, [[0, 0.026], [0.5, 0.038], [1, 0.02]]),
    palmRadius: 0.028 * H,
    palmFraction: 0.42,
    fingerRadius: 0.0065 * H,
    fingerFraction: 0.58,
    fingerSpread: [0.008 * H, 0.022 * H],
    thumbRadius: 0.008 * H,
    thumbFraction: 0.36,
    thumbAlong: 0.2,
    thumbDrop: 0.012 * H,
    thumbOffsetZ: 0.02 * H,
    heelBack: 0.3 * footLength,
    footHalfWidth: profile(H, [[0, 0.022], [0.65, 0.032], [1, 0.016]]),
    footInstep: profile(H, [[0, 0.04], [0.5, 0.052], [1, 0.022]]),
    stanceWidth,
    hipOffsetZ: stanceWidth / 2,
    shoulderOffsetZ,
    hipDropY: hipHeight - thighLength - shinLength - ankleHeight,
    shoulderDropY,
    reachMargin: REACH_MARGIN,
  }
}

function profile(height: number, samples: readonly (readonly [number, number])[]): RadiusProfile {
  return samples.map(([t, coefficient]) => ({ t, radius: coefficient * height }))
}
