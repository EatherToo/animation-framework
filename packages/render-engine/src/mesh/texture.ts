import type { Fill } from '../part/set'

/** 首版程序化图片的边长，像素。 */
export const TEXTURE_EDGE = 4

/** 一张不透明图片。`rgb` 按行排列，每像素三个字节。 */
export type Texture = {
  readonly width: number
  readonly height: number
  readonly rgb: Uint8Array
}

/**
 * 按部件颜色和三角形下标生成一张 4×4 图片。
 * 左上角是部件颜色，其余像素随下标变化。
 * @param fill 部件纯色，分量在 `[0, 1]`
 * @param triangle 三角形下标
 */
export function createTriangleTexture(fill: Fill, triangle: number): Texture {
  const baseR = byteChannel(fill.r)
  const baseG = byteChannel(fill.g)
  const baseB = byteChannel(fill.b)
  const rgb = new Uint8Array(TEXTURE_EDGE * TEXTURE_EDGE * 3)
  for (let sy = 0; sy < TEXTURE_EDGE; sy += 1) {
    for (let sx = 0; sx < TEXTURE_EDGE; sx += 1) {
      const index = (sy * TEXTURE_EDGE + sx) * 3
      if (sx === 0 && sy === 0) {
        rgb[index] = baseR
        rgb[index + 1] = baseG
        rgb[index + 2] = baseB
        continue
      }
      rgb[index] = mod256(baseR + (triangle + 1) * (sx + sy))
      rgb[index + 1] = baseG
      rgb[index + 2] = mod256(baseB + sx * 13 + sy)
    }
  }
  return { width: TEXTURE_EDGE, height: TEXTURE_EDGE, rgb }
}

/**
 * 给每个三角形配一张图。三个角的纹理坐标是 `(0,0)`、`(2,0)`、`(0,2)`。
 * @param indices 三角形索引
 * @param fill 部件纯色
 */
export function createMeshTextures(
  indices: Uint16Array,
  fill: Fill,
): { textures: Texture[]; triangleTexture: Uint16Array; uvs: Float32Array } {
  if (indices.length < 3 || indices.length % 3 !== 0) throw new Error('mesh')
  const triangleCount = indices.length / 3
  const textures: Texture[] = []
  const triangleTexture = new Uint16Array(triangleCount)
  const uvs = new Float32Array(indices.length * 2)
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    textures.push(createTriangleTexture(fill, triangle))
    triangleTexture[triangle] = triangle
    const corner = triangle * 6
    uvs[corner + 2] = 2
    uvs[corner + 5] = 2
  }
  return { textures, triangleTexture, uvs }
}

/**
 * 检查图片下标、纹理坐标和像素缓冲。失败时不改输入。
 * @param indices 三角形索引
 * @param textures 图片
 * @param triangleTexture 每个三角形的图片下标
 * @param uvs 与索引角对齐的纹理坐标
 */
export function validateMeshTextures(
  indices: Uint16Array,
  textures: readonly Texture[],
  triangleTexture: Uint16Array,
  uvs: Float32Array,
): void {
  if (indices.length < 3 || indices.length % 3 !== 0 || triangleTexture.length !== indices.length / 3) {
    throw new Error('texture')
  }
  for (let i = 0; i < triangleTexture.length; i += 1) {
    if (triangleTexture[i]! >= textures.length) throw new Error('texture')
  }
  if (uvs.length !== indices.length * 2) throw new Error('uv')
  for (let i = 0; i < uvs.length; i += 1) {
    if (!Number.isFinite(uvs[i])) throw new Error('uv')
  }
  for (let i = 0; i < textures.length; i += 1) {
    const image = textures[i]!
    if (!Number.isInteger(image.width) || image.width < 1) throw new Error('image')
    if (!Number.isInteger(image.height) || image.height < 1) throw new Error('image')
    if (image.rgb.length !== image.width * image.height * 3) throw new Error('image')
    for (let byte = 0; byte < image.rgb.length; byte += 1) {
      const value = image.rgb[byte]!
      if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error('image')
    }
  }
}

function byteChannel(channel: number): number {
  if (!Number.isFinite(channel) || channel < 0 || channel > 1) throw new Error('fill')
  const rounded = Math.round(channel * 255)
  if (rounded < 0) return 0
  if (rounded > 255) return 255
  return rounded
}

function mod256(value: number): number {
  return ((value % 256) + 256) % 256
}
