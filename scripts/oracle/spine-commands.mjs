#!/usr/bin/env node
// Official 4.3.13 RenderCommand oracle; outputs JSON only, never reference pixels.
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  AnimationState, AnimationStateData, AtlasAttachmentLoader, Physics,
  Skeleton, SkeletonJson, SkeletonRendererCore, TextureAtlas,
} from '@esotericsoftware/spine-core'

const root = resolve(process.argv[2])
const name = root.split(/[\\/]/).at(-1)
const time = process.argv[3] === 'setup' ? null : Number(process.argv[3])
if (time !== null && !Number.isFinite(time)) throw new Error(`Invalid time: ${process.argv[3]}`)
const json = JSON.parse(await readFile(join(root, `${name}-pro.json`), 'utf8'))
const atlas = new TextureAtlas(await readFile(join(root, `${name}.atlas`), 'utf8'))
const pages = new Map()
for (const [index, page] of atlas.pages.entries()) {
  const texture = { setFilters() {}, setWraps() {} }
  page.setTexture(texture)
  pages.set(texture, index)
}
const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(json)
const skeleton = new Skeleton(data)
skeleton.setupPose()
const animation = data.animations.find(clip => clip.duration > 0)
if (!animation) throw new Error('No positive-duration animation in official sample')
if (time !== null) {
  const state = new AnimationState(new AnimationStateData(data))
  state.setAnimation(0, animation.name, true)
  state.update(time)
  state.apply(skeleton)
}
skeleton.updateWorldTransform(Physics.none)
const commands = []
for (let command = new SkeletonRendererCore().render(skeleton, true, undefined, 2); command; command = command.next) {
  const page = pages.get(command.texture)
  if (page === undefined) throw new Error('Official command references unknown texture page')
  commands.push({
    positions: Array.from(command.positions.subarray(0, command.numVertices * 2)),
    uvs: Array.from(command.uvs.subarray(0, command.numVertices * 2)),
    colors: Array.from(command.colors.subarray(0, command.numVertices)),
    darkColors: Array.from(command.darkColors.subarray(0, command.numVertices)),
    indices: Array.from(command.indices.subarray(0, command.numIndices)),
    blendMode: command.blendMode, page,
  })
}
process.stdout.write(JSON.stringify({ runtime: 'spine-core@4.3.13', clipping: 'clipTrianglesUnpacked', pma: true, stride: 2, animation: animation.name, commands }) + '\n')
