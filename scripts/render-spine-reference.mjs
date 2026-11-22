#!/usr/bin/env node
/**
 * 用官方 spine-canvas runtime 渲染参考图。
 * 输出仅本地使用（资产/衍生图受 Spine Runtimes License 约束，不提交仓库）。
 *
 * 用法：node scripts/render-spine-reference.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import {
  AtlasAttachmentLoader,
  CanvasTexture,
  Physics,
  Skeleton,
  SkeletonJson,
  SkeletonRenderer,
  TextureAtlas,
  AnimationState,
  AnimationStateData,
} from '@esotericsoftware/spine-canvas'

const ROOT = 'test/fixtures/spine'
const OUT = 'preview/golden/spine-reference'
const SIZE = { width: 256, height: 192 }
const SAMPLES = ['spineboy', 'raptor', 'stretchyman']
const FRAMES = [
  { name: 'setup', time: null },
  { name: 'anim-0-25', time: 0.25 },
]

for (const name of SAMPLES) {
  const jsonText = await readFile(join(ROOT, name, `${name}-pro.json`), 'utf8')
  const atlasText = await readFile(join(ROOT, name, `${name}.atlas`), 'utf8')
  const png = await loadImage(await readFile(join(ROOT, name, `${name}.png`)))

  const atlas = new TextureAtlas(atlasText)
  for (const page of atlas.pages) page.setTexture(new CanvasTexture(png))
  const loader = new AtlasAttachmentLoader(atlas)
  const reader = new SkeletonJson(loader)
  const data = reader.readSkeletonData(JSON.parse(jsonText))
  for (const frame of FRAMES) {
    const canvas = createCanvas(SIZE, SIZE)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, SIZE.width, SIZE.height)
    const scale = Math.min(SIZE.width / Math.max(1, data.width), SIZE.height / Math.max(1, data.height)) * 0.8
    ctx.translate(SIZE.width / 2, SIZE.height / 2)
    ctx.scale(scale, -scale)
    ctx.translate(-(data.x + data.width / 2), -(data.y + data.height / 2))

    const skeleton = new Skeleton(data)
    skeleton.setupPose()
    const state = frame.time === null ? null : new AnimationState(new AnimationStateData(data))
    if (state !== null) {
      const animationName = data.animations[0].name
      state.setAnimation(0, animationName, true)
      state.update(frame.time)
      state.apply(skeleton)
    }
    skeleton.updateWorldTransform(Physics.none)

    // SkeletonRenderer 构造需要 ctx；这里用真实 context 重绘。
    const realRenderer = new SkeletonRenderer(ctx)
    realRenderer.triangleRendering = true
    realRenderer.draw(skeleton)

    const outPath = join(OUT, name, `${frame.name}.png`)
    await mkdir(join(OUT, name), { recursive: true })
    await writeFile(outPath, await canvas.encode('png'))
    console.log(outPath)
  }
}
