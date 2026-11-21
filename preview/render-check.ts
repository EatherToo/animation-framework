/** Node 离线渲染校验：默认纹理模式 + 左臂 mask 两种帧，生成 24 位 BMP 并打印可核验统计。 */

// @ts-expect-error Node 内置模块类型未安装；esbuild 打包后直接由 Node 运行
import { mkdirSync, writeFileSync } from 'node:fs'
// @ts-expect-error Node 内置模块类型未安装；esbuild 打包后直接由 Node 运行
import { basename, join } from 'node:path'
// @ts-expect-error Node 全局类型未安装
const cwd: string = process.cwd()
import { CpuBackend, type RenderFrame } from '@animation-framework/render-engine'
import { applyPose, buildFrame, createScene, type Scene } from './core2d'

const WIDTH = 320
const HEIGHT = 480
const BACKGROUND = [24, 28, 38, 255] as const
const LEFT_ARM = new Set(['upperArmL', 'lowerArmL', 'handL'])

function putU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
}

function putU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

/** 自写 24 位 BMP：BITMAPFILEHEADER(14) + BITMAPINFOHEADER(40) + BGR 底向上行。 */
function writeBmp24(path: string, width: number, height: number, rgba: Uint8ClampedArray): void {
  const row = width * 3
  const padded = (row + 3) & ~3
  const imageBytes = padded * height
  const bytes = new Uint8Array(54 + imageBytes)

  bytes[0] = 0x42 // B
  bytes[1] = 0x4d // M
  putU32(bytes, 2, bytes.length)
  putU32(bytes, 10, 54)
  putU32(bytes, 14, 40) // biSize
  putU32(bytes, 18, width) // biWidth
  putU32(bytes, 22, height) // biHeight (正 = 底向上)
  putU16(bytes, 26, 1) // biPlanes
  putU16(bytes, 28, 24) // biBitCount
  putU32(bytes, 30, 0) // BI_RGB
  putU32(bytes, 34, imageBytes)
  putU32(bytes, 38, 2835) // 72 dpi
  putU32(bytes, 42, 2835)

  let cursor = 54
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4
      bytes[cursor] = rgba[src + 2]!
      bytes[cursor + 1] = rgba[src + 1]!
      bytes[cursor + 2] = rgba[src]!
      cursor += 3
    }
    cursor = 54 + (height - 1 - y) * padded + row
  }
  writeFileSync(path, bytes)
}

function isBackground(rgba: Uint8ClampedArray, offset: number): boolean {
  const diff = Math.abs(rgba[offset]! - BACKGROUND[0]) +
    Math.abs(rgba[offset + 1]! - BACKGROUND[1]) +
    Math.abs(rgba[offset + 2]! - BACKGROUND[2])
  return diff <= 9
}

function countNonBackground(
  rgba: Uint8ClampedArray,
  box?: { x0: number; y0: number; x1: number; y1: number },
): number {
  const x0 = box?.x0 ?? 0
  const y0 = box?.y0 ?? 0
  const x1 = box?.x1 ?? WIDTH - 1
  const y1 = box?.y1 ?? HEIGHT - 1
  let count = 0
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (!isBackground(rgba, (y * WIDTH + x) * 4)) count += 1
    }
  }
  return count
}

/** 每通道取高 5 位去重，避免线性插值产生海量近似色。 */
function uniqueColors(rgba: Uint8ClampedArray): number {
  const seen = new Set<number>()
  for (let i = 0; i < rgba.length; i += 4) {
    if (isBackground(rgba, i)) continue
    seen.add(((rgba[i]! >> 3) << 10) | ((rgba[i + 1]! >> 3) << 5) | (rgba[i + 2]! >> 3))
  }
  return seen.size
}

function project(m: Float32Array, x: number, y: number): [number, number] {
  const cx = m[0]! * x + m[3]! * y + m[6]!
  const cy = m[1]! * x + m[4]! * y + m[7]!
  const cw = m[2]! * x + m[5]! * y + m[8]!
  const w = Math.abs(cw) < 1e-9 ? 1e-9 : cw
  return [cx / w, cy / w]
}

/** 左臂三根骨在屏幕空间的包围盒，用于比较 mask 前后的像素量。 */
function leftArmBounds(frame: RenderFrame, scene: Scene): { x0: number; y0: number; x1: number; y1: number } {
  const m = frame.viewProjection
  if (m === undefined) throw new Error('frame 缺少 viewProjection')
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const packet of frame.packets) {
    const slot = scene.slotSet.slots[packet.id]
    if (slot === undefined || !LEFT_ARM.has(slot.data.id)) continue
    for (let i = 0; i + 1 < packet.positions.length; i += 2) {
      const [sx, sy] = project(m, packet.positions[i]!, packet.positions[i + 1]!)
      x0 = Math.min(x0, sx)
      y0 = Math.min(y0, sy)
      x1 = Math.max(x1, sx)
      y1 = Math.max(y1, sy)
    }
  }
  if (!Number.isFinite(x0)) throw new Error('找不到左臂 packet')
  return {
    x0: Math.max(0, Math.floor(x0)),
    y0: Math.max(0, Math.floor(y0)),
    x1: Math.min(WIDTH - 1, Math.ceil(x1)),
    y1: Math.min(HEIGHT - 1, Math.ceil(y1)),
  }
}

function main(): void {
  const scene = createScene(1)
  applyPose(scene, 'tpose', {}, 0)
  const backend = new CpuBackend({ width: WIDTH, height: HEIGHT, background: BACKGROUND })

  // 1) 默认纹理模式。
  const textureFrame = buildFrame(scene, WIDTH, HEIGHT)
  backend.draw(textureFrame)
  const texturePixels = backend.readPixels()
  const textureSamples = backend.stats.textureSamples
  const textureDrawCalls = backend.stats.drawCalls
  const nonBackground = countNonBackground(texturePixels)
  const textureColors = uniqueColors(texturePixels)

  // 2) flat 对照，证明颜色种类增加来自纹理而不是顶点色。
  const flatFrame = buildFrame(scene, WIDTH, HEIGHT, { texture: false })
  backend.draw(flatFrame)
  const flatColors = uniqueColors(backend.readPixels())

  // 3) 左臂 stencil mask。
  const maskFrame = buildFrame(scene, WIDTH, HEIGHT, { mask: true })
  backend.draw(maskFrame)
  const maskPixels = backend.readPixels()
  const maskedNonBackground = countNonBackground(maskPixels)
  const armBox = leftArmBounds(textureFrame, scene)
  const armPixels = countNonBackground(texturePixels, armBox)
  const maskedArmPixels = countNonBackground(maskPixels, armBox)

  // esbuild 打包后 import.meta.url 指向 .tmp 产物，因此用 cwd 定位 preview 源目录。
  const previewDir = basename(cwd) === 'preview' ? cwd : join(cwd, 'preview')
  const goldenDir = join(previewDir, 'golden')
  mkdirSync(goldenDir, { recursive: true })
  const textureOut = join(goldenDir, 'core2d-texture.bmp')
  const maskOut = join(goldenDir, 'core2d-mask.bmp')
  writeBmp24(textureOut, WIDTH, HEIGHT, texturePixels)
  writeBmp24(maskOut, WIDTH, HEIGHT, maskPixels)

  let minX = WIDTH
  let minY = HEIGHT
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (isBackground(texturePixels, (y * WIDTH + x) * 4)) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  const ratio = nonBackground / (WIDTH * HEIGHT)
  const bbox = maxX >= 0 ? `${maxX - minX + 1}x${maxY - minY + 1} @ (${minX},${minY})` : 'empty'
  const armDrop = armPixels > 0 ? (1 - maskedArmPixels / armPixels) * 100 : 0
  console.log(`尺寸: ${WIDTH}x${HEIGHT}`)
  console.log(`纹理帧: packets ${textureFrame.packets.length} (drawCalls ${textureDrawCalls}), textureSamples ${textureSamples}`)
  console.log(`纹理帧非背景: ${nonBackground} / ${WIDTH * HEIGHT} (${(ratio * 100).toFixed(2)}%), 颜色种类 ${textureColors}`)
  console.log(`flat 对照颜色种类: ${flatColors}`)
  console.log(`人形包围盒: ${bbox}`)
  console.log(`左臂 bbox: ${armBox.x1 - armBox.x0 + 1}x${armBox.y1 - armBox.y0 + 1} @ (${armBox.x0},${armBox.y0})`)
  console.log(`左臂像素: ${armPixels} -> ${maskedArmPixels} (裁掉 ${armDrop.toFixed(1)}%)`)
  console.log(`mask 帧非背景: ${maskedNonBackground} / ${nonBackground}`)
  console.log(`BMP: ${textureOut}`)
  console.log(`BMP: ${maskOut}`)

  if (textureFrame.packets.length < 17) throw new Error('packets 数不足：期望 17 个身体部件包')
  if (nonBackground < 4500 || ratio > 0.8) throw new Error('人形面积不合理：非背景像素过少或过多')
  if (maxX - minX < 100 || maxY - minY < 100) throw new Error('人形包围盒过小')
  if (textureSamples <= 0) throw new Error('纹理模式没有发生采样')
  if (textureColors <= 8) throw new Error(`颜色种类不足 ${textureColors}，疑似 flat 渲染`)
  if (textureColors <= flatColors) throw new Error('纹理模式颜色种类未超过 flat 对照')
  if (maskFrame.maskPaths === undefined || maskFrame.masks === undefined) throw new Error('mask 帧缺少 maskPaths/masks')
  if (armPixels <= 0) throw new Error('mask 前左臂区域没有像素')
  if (maskedArmPixels >= armPixels) throw new Error('mask 后左臂像素没有减少')
  if (maskedNonBackground >= nonBackground) throw new Error('mask 后全图非背景像素没有减少')
}

main()
