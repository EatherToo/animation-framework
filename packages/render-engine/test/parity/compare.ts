export interface PixelDiff {
  mean: number
  max: number
  p95: number
  p999: number
  interiorMean: number
  edgeMean: number
  changedPixels: number
  bbox: { x: number; y: number; width: number; height: number } | null
}

export function compareRgba(expected: ArrayLike<number>, actual: ArrayLike<number>, width: number, height: number, edgeWidth = 3): PixelDiff {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || expected.length !== width * height * 4 || actual.length !== expected.length) {
    throw new Error('RGBA dimensions do not match')
  }
  const histogram = new Uint32Array(256)
  let sum = 0
  let interiorSum = 0
  let edgeSum = 0
  let interiorCount = 0
  let edgeCount = 0
  let changedPixels = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let changed = false
      const edge = x < edgeWidth || y < edgeWidth || x >= width - edgeWidth || y >= height - edgeWidth
      for (let c = 0; c < 4; c++) {
        const delta = Math.abs(expected[(y * width + x) * 4 + c]! - actual[(y * width + x) * 4 + c]!)
        if (!Number.isInteger(delta) || delta < 0 || delta > 255) throw new Error('RGBA bytes must be integers in [0,255]')
        histogram[delta]!++
        sum += delta
        if (edge) { edgeSum += delta; edgeCount++ } else { interiorSum += delta; interiorCount++ }
        changed ||= delta > 0
      }
      if (changed) {
        changedPixels++
        minX = Math.min(minX, x); minY = Math.min(minY, y)
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      }
    }
  }
  function percentile(fraction: number): number {
    const rank = Math.ceil(expected.length * fraction)
    let seen = 0
    for (let i = 0; i < histogram.length; i++) { seen += histogram[i]!; if (seen >= rank) return i }
    return 255
  }
  return {
    mean: sum / expected.length, max: maxX < 0 ? 0 : percentile(1), p95: percentile(0.95), p999: percentile(0.999),
    interiorMean: interiorCount ? interiorSum / interiorCount : 0,
    edgeMean: edgeCount ? edgeSum / edgeCount : 0,
    changedPixels,
    bbox: maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  }
}
