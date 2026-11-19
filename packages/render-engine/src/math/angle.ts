const TAU = Math.PI * 2

/**
 * 度 → 弧度。
 * @param deg 角度（度）
 */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * 弧度 → 度。
 * @param rad 角度（弧度）
 */
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

/**
 * 将角度折到 (-π, π]；非有限值原样返回。
 * @param rad 角度（弧度）
 */
export function normalizeAngle(rad: number): number {
  if (!Number.isFinite(rad)) return rad
  // Fold into (-π, π]. Both ±π map to +π.
  let r = ((rad + Math.PI) % TAU + TAU) % TAU - Math.PI
  if (r === -Math.PI) r = Math.PI
  return r
}

/**
 * 有符号角差 `to − from`，结果落在 (-π, π]。
 * @param from 起始角（弧度）
 * @param to 目标角（弧度）
 */
export function angleDelta(from: number, to: number): number {
  return normalizeAngle(to - from)
}
