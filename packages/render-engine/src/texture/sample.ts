import type { Texture } from '../mesh/texture'

/**
 * 按夹取后的纹理坐标读取最近的像素，分量换成 `[0, 1]`。
 * @param texture 图片
 * @param u 横向，0 是第一列
 * @param v 纵向，0 是第一行
 */
export function sampleTexture(
  texture: Texture,
  u: number,
  v: number,
): { r: number; g: number; b: number } {
  if (!Number.isFinite(u) || !Number.isFinite(v)) throw new Error('uv')
  const uu = u < 0 ? 0 : u > 1 ? 1 : u
  const vv = v < 0 ? 0 : v > 1 ? 1 : v
  const sx = Math.min(texture.width - 1, Math.floor(uu * texture.width))
  const sy = Math.min(texture.height - 1, Math.floor(vv * texture.height))
  const index = (sy * texture.width + sx) * 3
  return {
    r: texture.rgb[index]! / 255,
    g: texture.rgb[index + 1]! / 255,
    b: texture.rgb[index + 2]! / 255,
  }
}
