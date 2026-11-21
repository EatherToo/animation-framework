/** Node 离线渲染校验：生成 24 位 BMP 并打印可核验统计。 */

// @ts-expect-error Node 内置模块类型未安装；esbuild 打包后直接由 Node 运行
import { mkdirSync, writeFileSync } from 'node:fs'
// @ts-expect-error Node 内置模块类型未安装；esbuild 打包后直接由 Node 运行
import { basename, join } from 'node:path'
// @ts-expect-error Node 全局类型未安装
const cwd: string = process.cwd()
import { CpuBackend } from '@animation-framework/render-engine'
import { applyPose, buildFrame, createScene } from './core2d'

const WIDTH = 320
const HEIGHT = 480
const BACKGROUND = [24, 28, 38, 255] as const

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

function main(): void {
  const scene = createScene(1)
  applyPose(scene, 'tpose', {}, 0)
  const backend = new CpuBackend({ width: WIDTH, height: HEIGHT, background: BACKGROUND })
  const frame = buildFrame(scene, WIDTH, HEIGHT)
  backend.draw(frame)
  const rgba = backend.readPixels()

  let nonBackground = 0
  let minX = WIDTH
  let minY = HEIGHT
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const o = (y * WIDTH + x) * 4
      const diff = Math.abs(rgba[o]! - BACKGROUND[0]) +
        Math.abs(rgba[o + 1]! - BACKGROUND[1]) +
        Math.abs(rgba[o + 2]! - BACKGROUND[2])
      if (diff <= 9) continue
      nonBackground += 1
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  // esbuild 打包后 import.meta.url 指向 .tmp 产物，因此用 cwd 定位 preview 源目录。
  const previewDir = basename(cwd) === 'preview' ? cwd : join(cwd, 'preview')
  const out = join(previewDir, 'golden', 'core2d-frame.bmp')
  mkdirSync(join(previewDir, 'golden'), { recursive: true })
  writeBmp24(out, WIDTH, HEIGHT, rgba)

  const ratio = nonBackground / (WIDTH * HEIGHT)
  const bbox = maxX >= 0 ? `${maxX - minX + 1}x${maxY - minY + 1} @ (${minX},${minY})` : 'empty'
  console.log(`尺寸: ${WIDTH}x${HEIGHT}`)
  console.log(`packets: ${frame.packets.length} (${backend.stats.packets} 已绘制, drawCalls ${backend.stats.drawCalls})`)
  console.log(`非背景像素: ${nonBackground} / ${WIDTH * HEIGHT} (${(ratio * 100).toFixed(2)}%)`)
  console.log(`人形包围盒: ${bbox}`)
  console.log(`BMP: ${out}`)

  if (frame.packets.length < 17) throw new Error('packets 数不足：期望 17 个身体部件包')
  if (nonBackground < 4500 || ratio > 0.8) throw new Error('人形面积不合理：非背景像素过少或过多')
  if (maxX - minX < 100 || maxY - minY < 100) throw new Error('人形包围盒过小')
  if (maxX < 0) throw new Error('渲染结果为空')
}

main()
