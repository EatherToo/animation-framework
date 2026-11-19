import { setVec2, type Vec2 } from '../math'

/** 跟到踝，相对踝到趾。跟约占全足长的 0.3/1.3。 */
export const HEEL_BACK_RATIO = 0.3

/**
 * 平足在脚底线段上的参数。
 * 跟和趾都按 `footLength` 缩放，所以这个值不随身高变化。
 */
export const FLAT_PARAMETER = HEEL_BACK_RATIO / (HEEL_BACK_RATIO + 1)

/** 脚底上三个有名字的位置。 */
export type FootStation = 'heel' | 'flat' | 'toe'

/** 脚底相对踝的外形。长度为 JS 数字，写入 `Vec2` 时才变成 float32。 */
export type FootShape = {
  readonly footLength: number
  readonly ankleHeight: number
  /** `HEEL_BACK_RATIO * footLength` */
  readonly heelBack: number
  /** 等于 `footLength` */
  readonly toeForward: number
  /** `heelBack + toeForward` */
  readonly soleLength: number
}

/**
 * 由踝到趾的长度和踝高生成脚底外形。
 * @param footLength 踝到趾，米，须有限且 &gt; 0
 * @param ankleHeight 踝到脚底，米，须有限且 ≥ 0
 * @returns 只读外形
 */
export function createFootShape(footLength: number, ankleHeight: number): FootShape {
  if (!Number.isFinite(footLength) || footLength <= 0) {
    throw new Error('footLength')
  }
  if (!Number.isFinite(ankleHeight) || ankleHeight < 0) {
    throw new Error('ankleHeight')
  }
  const heelBack = HEEL_BACK_RATIO * footLength
  const toeForward = footLength
  return {
    footLength,
    ankleHeight,
    heelBack,
    toeForward,
    soleLength: heelBack + toeForward,
  }
}

/**
 * 某个命名位置在脚底线段上的参数。`heel` 为 0，`toe` 为 1。
 * @param station 脚跟、平足或脚尖
 * @returns `[0, 1]` 上的参数
 */
export function stationParameter(station: FootStation): number {
  if (station === 'heel') return 0
  if (station === 'flat') return FLAT_PARAMETER
  if (station === 'toe') return 1
  throw new Error('station')
}

/**
 * 把脚底线段上的点写入 `out`。原点在踝，`+X` 朝趾，`+Y` 朝上。
 * @param out 输出缓冲
 * @param shape 脚底外形
 * @param u 从跟到趾的参数，含 0 和 1
 * @returns `out`
 */
export function soleLocal(out: Vec2, shape: FootShape, u: number): Vec2 {
  if (!Number.isFinite(u) || Object.is(u, -0) || u < 0 || u > 1) {
    throw new Error('u')
  }
  const y = soleY(shape)
  const x = u === 0 ? -shape.heelBack : u === 1 ? shape.toeForward : -shape.heelBack + u * shape.soleLength
  return setVec2(out, x, y)
}

/**
 * 把脚跟、平足或脚尖的局部坐标写入 `out`。平足直接写在踝的正下方。
 * @param out 输出缓冲
 * @param shape 脚底外形
 * @param station 命名位置
 * @returns `out`
 */
export function stationLocal(out: Vec2, shape: FootShape, station: FootStation): Vec2 {
  const y = soleY(shape)
  if (station === 'heel') return setVec2(out, -shape.heelBack, y)
  if (station === 'flat') return setVec2(out, 0, y)
  if (station === 'toe') return setVec2(out, shape.toeForward, y)
  throw new Error('station')
}

function soleY(shape: FootShape): number {
  return shape.ankleHeight === 0 ? 0 : -shape.ankleHeight
}
