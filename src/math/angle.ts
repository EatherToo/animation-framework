const TAU = Math.PI * 2

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

export function normalizeAngle(rad: number): number {
  if (!Number.isFinite(rad)) return rad
  // Fold into (-π, π]. Both ±π map to +π.
  let r = ((rad + Math.PI) % TAU + TAU) % TAU - Math.PI
  if (r === -Math.PI) r = Math.PI
  return r
}

export function angleDelta(from: number, to: number): number {
  return normalizeAngle(to - from)
}
