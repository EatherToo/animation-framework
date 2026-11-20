/** 沿骨轴或脚底的一个截面样本。`t` 从 0 到 1，`radius` 为米。 */
export type RadiusSample = {
  readonly t: number
  readonly radius: number
}

/** 严格按 `t` 递增的圆截面轮廓。 */
export type RadiusProfile = readonly RadiusSample[]

/**
 * 垂直于骨轴的一个截面。宽沿角色 `±Z`，深沿角色 `±X` 分开给。
 * 三个长度都是米；`exponent` 无量纲。
 */
export type SectionSample = {
  readonly t: number
  /** 角色 ±Z 的半宽 */
  readonly halfWidth: number
  /** 从骨轴向角色 +X（前方）的深度 */
  readonly frontDepth: number
  /** 从骨轴向角色 −X（后方）的深度 */
  readonly backDepth: number
  /** 超椭圆指数：2 为椭圆，大于 2 更方，小于 2 更尖 */
  readonly exponent: number
}

/** 严格按 `t` 递增的截面轮廓。 */
export type SectionProfile = readonly SectionSample[]

/** 手掌这类扁截面的两个半轴。 */
export type PalmSection = {
  readonly halfWidth: number
  readonly halfThickness: number
}

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
  /** 从髋关节到颈根的连续站位表；`t = 0` 在髋，`t = 1` 在颈根 */
  readonly torsoProfile: SectionProfile
  readonly neckProfile: SectionProfile
  readonly headProfile: SectionProfile
  readonly upperArmProfile: SectionProfile
  readonly lowerArmProfile: SectionProfile
  readonly thighProfile: SectionProfile
  readonly shinProfile: SectionProfile
  /** 掌根截面：半宽沿角色 z，半厚沿前后 */
  readonly palmWrist: PalmSection
  /** 掌指关节处的截面 */
  readonly palmKnuckle: PalmSection
  readonly palmFraction: number
  readonly fingerRadius: number
  /** 四指指尖离腕的距离，占 `handLength`；顺序是指到小指 */
  readonly fingerLengths: readonly [number, number, number, number]
  /** 四指中心相对掌心的横向偏移，米；顺序是指到小指 */
  readonly fingerOffsets: readonly [number, number, number, number]
  readonly thumbRadius: number
  readonly thumbAlong: number
  readonly thumbTipAlong: number
  readonly thumbDrop: number
  readonly thumbOffsetZ: number
  readonly thumbTipZ: number
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
  const footLength = (0.15 / 1.3) * H
  const spineLength = 0.144 * H
  const chestLength = 0.144 * H
  const torsoLength = spineLength + chestLength
  const shoulderDropY = 0.02 * H
  const stanceWidth = 0.1 * H
  const shoulderOffsetZ = 0.1 * H
  /** 骨盆原点以上的高度（`H` 的倍数）换成站位参数。 */
  const at = (coefficient: number): number => (coefficient * H) / torsoLength

  return {
    height: H,
    hipHeight,
    ankleHeight,
    pelvisLength: 0.05 * H,
    spineLength,
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
    torsoProfile: section(H, [
      [at(0), 0.096, 0.071, 0.055, 2.4],
      [at(0.03), 0.095, 0.073, 0.055, 2.4],
      [at(0.06), 0.088, 0.066, 0.05, 2.2],
      [at(0.09), 0.079, 0.058, 0.046, 2.2],
      [at(0.12), 0.082, 0.06, 0.048, 2.2],
      [at(0.16), 0.089, 0.064, 0.054, 2.4],
      [at(0.2), 0.092, 0.066, 0.056, 2.4],
      [at(0.24), 0.094, 0.06, 0.058, 2.6],
      [at(0.268), 0.086, 0.052, 0.054, 2.6],
      [at(0.288), 0.033, 0.033, 0.033, 2.0],
    ]),
    neckProfile: section(H, [
      [0, 0.033, 0.033, 0.033, 2.0],
      [1, 0.033, 0.033, 0.033, 2.0],
    ]),
    headProfile: section(H, [
      [0, 0.033, 0.033, 0.033, 2.0],
      [0.1, 0.032, 0.055, 0.045, 2.2],
      [0.22, 0.0347, 0.054, 0.051, 2.2],
      [0.36, 0.038, 0.052, 0.056, 2.2],
      [0.52, 0.0425, 0.052, 0.056, 2.2],
      [0.7, 0.041, 0.046, 0.054, 2.2],
      [0.86, 0.031, 0.032, 0.043, 2.2],
      [1, 0.007, 0.008, 0.012, 2.0],
    ]),
    upperArmProfile: section(H, [
      [0, 0.034, 0.0323, 0.0323, 2.0],
      [0.15, 0.033, 0.03135, 0.03135, 2.0],
      [0.4, 0.032, 0.0304, 0.0304, 2.0],
      [0.7, 0.03, 0.0285, 0.0285, 2.0],
      [1, 0.022, 0.0209, 0.0209, 2.0],
    ]),
    lowerArmProfile: section(H, [
      [0, 0.022, 0.0209, 0.0209, 2.0],
      [0.15, 0.0255, 0.021675, 0.021675, 2.0],
      [0.4, 0.0245, 0.020825, 0.020825, 2.0],
      [0.7, 0.02, 0.017, 0.017, 2.0],
      [1, 0.016, 0.0136, 0.0136, 2.0],
    ]),
    thighProfile: section(H, [
      [0, 0.048, 0.0456, 0.0456, 2.0],
      [0.2, 0.046, 0.0437, 0.0437, 2.0],
      [0.45, 0.043, 0.04085, 0.04085, 2.0],
      [0.7, 0.034, 0.0323, 0.0323, 2.0],
      [1, 0.029, 0.02755, 0.02755, 2.0],
    ]),
    shinProfile: section(H, [
      [0, 0.029, 0.02755, 0.02755, 2.0],
      [0.2, 0.03, 0.027, 0.027, 2.0],
      [0.35, 0.0325, 0.02925, 0.02925, 2.0],
      [0.6, 0.026, 0.0234, 0.0234, 2.0],
      [1, 0.0195, 0.01755, 0.01755, 2.0],
    ]),
    palmWrist: { halfWidth: 0.019 * H, halfThickness: 0.0095 * H },
    palmKnuckle: { halfWidth: 0.024 * H, halfThickness: 0.0085 * H },
    palmFraction: 0.42,
    fingerRadius: 0.0045 * H,
    fingerLengths: [0.96, 1.0, 0.93, 0.85],
    fingerOffsets: [0.0161 * H, 0.0054 * H, -0.0054 * H, -0.0161 * H],
    thumbRadius: 0.007 * H,
    thumbAlong: 0.22,
    thumbTipAlong: 0.52,
    thumbDrop: 0.004 * H,
    thumbOffsetZ: 0.018 * H,
    thumbTipZ: 0.032 * H,
    heelBack: 0.3 * footLength,
    footHalfWidth: radiusProfile(H, [[0, 0.018], [0.65, 0.027], [1, 0.022]]),
    footInstep: radiusProfile(H, [[0, 0.036], [0.5, 0.041], [1, 0.021]]),
    stanceWidth,
    hipOffsetZ: stanceWidth / 2,
    shoulderOffsetZ,
    hipDropY: hipHeight - thighLength - shinLength - ankleHeight,
    shoulderDropY,
    reachMargin: REACH_MARGIN,
  }
}

function section(
  height: number,
  samples: readonly (readonly [number, number, number, number, number])[],
): SectionProfile {
  return samples.map(([t, w, front, back, exponent]) => ({
    t,
    halfWidth: w * height,
    frontDepth: front * height,
    backDepth: back * height,
    exponent,
  }))
}

function radiusProfile(
  height: number,
  samples: readonly (readonly [number, number])[],
): RadiusProfile {
  return samples.map(([t, coefficient]) => ({ t, radius: coefficient * height }))
}
