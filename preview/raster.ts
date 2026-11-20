/**
 * 预览页的光栅化：逐像素深度测试，填充与描边共用同一张深度缓冲。
 * 不依赖 DOM，便于在 Node 里单独验证。
 *
 * 深度约定与 36 正交视角一致：越大越远。屏幕坐标是画布像素，原点在左上角。
 */

/** 一张画布缓冲：像素与逐像素深度。 */
export type Surface = {
  readonly width: number
  readonly height: number
  /** RGBA，步长 4 */
  readonly pixels: Uint8ClampedArray
  /** 每像素最近深度，初值 +Infinity */
  readonly depth: Float32Array
}

type FrameBuffer = {
  width: number
  height: number
  pixels: Uint8ClampedArray | null
  depth: Float32Array
}

const buffer: FrameBuffer = {
  width: 0,
  height: 0,
  pixels: null,
  depth: new Float32Array(0),
}

/**
 * 为一帧准备缓冲：尺寸变化时重建深度缓冲，并按给定背景色清屏。
 * @param width 画布宽（设备像素）
 * @param height 画布高（设备像素）
 * @param pixels 画布像素数组，步长 4
 * @param background 背景 RGB，0–255
 */
export function beginFrame(
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
  background: readonly [number, number, number],
): Surface {
  if (width <= 0 || height <= 0) throw new Error('size')
  if (pixels.length !== width * height * 4) throw new Error('pixels')
  if (buffer.width !== width || buffer.height !== height) {
    buffer.width = width
    buffer.height = height
    buffer.depth = new Float32Array(width * height)
  }
  buffer.pixels = pixels
  buffer.depth.fill(Number.POSITIVE_INFINITY)
  pixels.fill(0)
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 4] = background[0]
    pixels[i * 4 + 1] = background[1]
    pixels[i * 4 + 2] = background[2]
    pixels[i * 4 + 3] = 255
  }
  return { width, height, pixels, depth: buffer.depth }
}

/** 屏幕三角形的重心坐标；退化时返回 null。 */
function barycentric(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): { denom: number } | null {
  const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
  return Math.abs(denom) <= 1e-8 ? null : { denom }
}

function bounds(
  surface: Surface,
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
  const maxX = Math.min(surface.width - 1, Math.ceil(Math.max(ax, bx, cx)))
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
  const maxY = Math.min(surface.height - 1, Math.ceil(Math.max(ay, by, cy)))
  return minX > maxX || minY > maxY ? null : { minX, maxX, minY, maxY }
}

/**
 * 画一个深度恒定的三角形，逐像素做深度测试。用于描边。
 * @param surface 目标缓冲
 * @param point 三个屏幕点与共同深度
 * @param color RGB，0–255
 */
export function flatTriangle(
  surface: Surface,
  point: readonly [number, number, number, number, number, number],
  z: number,
  color: readonly [number, number, number],
): void {
  const [ax, ay, bx, by, cx, cy] = point
  const basis = barycentric(ax, ay, bx, by, cx, cy)
  const box = bounds(surface, ax, ay, bx, by, cx, cy)
  if (basis === null || box === null) return
  const { denom } = basis
  const { width, pixels, depth } = surface
  for (let y = box.minY; y <= box.maxY; y += 1) {
    for (let x = box.minX; x <= box.maxX; x += 1) {
      const px = x + 0.5
      const py = y + 0.5
      const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom
      const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom
      if (w0 < -1e-6 || w1 < -1e-6 || 1 - w0 - w1 < -1e-6) continue
      const pixel = y * width + x
      if (z >= depth[pixel]!) continue
      pixels[pixel * 4] = color[0]
      pixels[pixel * 4 + 1] = color[1]
      pixels[pixel * 4 + 2] = color[2]
      pixels[pixel * 4 + 3] = 255
      depth[pixel] = z
    }
  }
}

/**
 * 画一个带逐顶点深度的三角形，颜色由回调按像素给出。用于贴图面。
 * @param surface 目标缓冲
 * @param point 三个屏幕点
 * @param z 三个顶点的深度
 * @param shade 给定屏幕点与重心坐标，返回该像素的 RGB；返回 null 表示跳过
 */
export function shadedTriangle(
  surface: Surface,
  point: readonly [number, number, number, number, number, number],
  z: readonly [number, number, number],
  shade: (px: number, py: number) => readonly [number, number, number] | null,
): void {
  const [ax, ay, bx, by, cx, cy] = point
  const basis = barycentric(ax, ay, bx, by, cx, cy)
  const box = bounds(surface, ax, ay, bx, by, cx, cy)
  if (basis === null || box === null) return
  const { denom } = basis
  const { width, pixels, depth } = surface
  const [za, zb, zc] = z
  for (let y = box.minY; y <= box.maxY; y += 1) {
    for (let x = box.minX; x <= box.maxX; x += 1) {
      const px = x + 0.5
      const py = y + 0.5
      const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom
      const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom
      if (w0 < -1e-6 || w1 < -1e-6 || 1 - w0 - w1 < -1e-6) continue
      const pixel = y * width + x
      const value = w0 * za + w1 * zb + (1 - w0 - w1) * zc
      if (value >= depth[pixel]!) continue
      const color = shade(px, py)
      if (color === null) continue
      pixels[pixel * 4] = color[0]
      pixels[pixel * 4 + 1] = color[1]
      pixels[pixel * 4 + 2] = color[2]
      pixels[pixel * 4 + 3] = 255
      depth[pixel] = value
    }
  }
}
