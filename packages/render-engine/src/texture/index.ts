/**
 * 37 贴图：把每个三角形的图片采样到投影后的屏幕三角形。
 * 依赖编译结果和正交视角。不改部件纯色。
 */
export { sampleTexture } from './sample'
export { textureProjected, triangleUv } from './bind'
export type { TexturedPart } from './bind'
