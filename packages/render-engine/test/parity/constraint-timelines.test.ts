import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createTrack, sampleAnimation } from '@/animation/animation'
import { importSpine } from '@/asset/importer'
import { Engine } from '@/runtime/runtime'

const root = resolve(process.cwd(), '../..')
const dir = resolve(root, 'test/fixtures/spine/stretchyman')
const probe = {
  ik: { 'back-arm-ik': [
    { time: 0, mix: 0.2, softness: 10, bendPositive: false, compress: true },
    { time: 1, mix: 0.8, softness: 20, bendPositive: true, stretch: true },
  ] },
  transform: { 'back-arm-transform': [
    { time: 0, mixRotate: -0.5, mixX: 0.2, mixY: 0.4, mixScaleX: 0.1, mixScaleY: 0.3, mixShearY: 0.6 },
    { time: 1, mixRotate: 0.5, mixX: 0.8, mixY: 0.6, mixScaleX: 0.7, mixScaleY: 0.9, mixShearY: 0.2 },
  ] },
  path: { 'path-constraint': {
    position: [{ time: 0, value: 10 }, { time: 1, value: 30 }],
    spacing: [{ time: 0, value: 5 }, { time: 1, value: 15 }],
    mix: [{ time: 0, mixRotate: 0.2, mixX: 0.3, mixY: 0.5 },
      { time: 1, mixRotate: 0.8, mixX: 0.7, mixY: 0.9 }],
  } },
}

const oracle = `
const { createRequire } = require('node:module')
const { readFileSync } = require('node:fs')
const requireFromRoot = createRequire(process.argv[1] + '/package.json')
const { AtlasAttachmentLoader, AnimationState, AnimationStateData, Skeleton, SkeletonJson, TextureAtlas } = requireFromRoot('@esotericsoftware/spine-core')
const doc = JSON.parse(readFileSync(process.argv[2], 'utf8'))
doc.animations = { probe: JSON.parse(process.argv[4]) }
const atlas = new TextureAtlas(readFileSync(process.argv[3], 'utf8'))
const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(doc)
const skeleton = new Skeleton(data)
const state = new AnimationState(new AnimationStateData(data))
state.setAnimation(0, 'probe', false)
state.update(0.5)
state.apply(skeleton)
process.stdout.write(JSON.stringify(skeleton.constraints.map(c => ({ name: c.data.name, kind: c.data.constructor.name, pose: c.pose }))))
`

describe('Spine 4.3 constraint timeline import and sampling', () => {
  it('matches spine-core constraint poses at the midpoint', () => {
    const jsonPath = resolve(dir, 'stretchyman-pro.json')
    const atlasPath = resolve(dir, 'stretchyman.atlas')
    const doc = JSON.parse(readFileSync(jsonPath, 'utf8'))
    const kinds = new Map<string, string>()
    for (const c of doc.constraints) if (!kinds.has(c.type)) kinds.set(c.type, c.name)
    const ik = kinds.get('ik')!, transform = kinds.get('transform')!, path = kinds.get('path')!
    const animation = {
      ik: { [ik]: probe.ik['back-arm-ik'] },
      transform: { [transform]: probe.transform['back-arm-transform'] },
      path: { [path]: probe.path['path-constraint'] },
    }
    doc.animations = { probe: animation }
    const expected = JSON.parse(execFileSync(process.execPath,
      ['-e', oracle, root, jsonPath, atlasPath, JSON.stringify(animation)],
      { cwd: root, encoding: 'utf8' })) as { name: string; pose: Record<string, number | boolean> }[]
    const asset = importSpine(doc, { unitScale: 0.01, sourceYDown: false })
    const clip = asset.animations.get('probe')!
    expect(clip.timelines.filter(t => 'frames' in t)).toHaveLength(5)
    const engine = new Engine({ backend: 'cpu' })
    try {
      engine.load(asset)
      const sampled = sampleAnimation([createTrack(clip, { time: 0.5, loop: false })], engine.pose, engine.slotSet, 0)
      const channels = sampled.constraintMixByName.channels
      const pathData = asset.constraints?.find((c): c is Extract<NonNullable<typeof asset.constraints>[number], { kind: 'path' }> =>
        c.id === path && c.kind === 'path')
      for (const name of [ik, transform, path]) {
        const pose = expected.find(c => c.name === name)!.pose
        const entries = channels.get(name)!
        expect(entries.length).toBe(name === path ? 3 : 1)
        for (const entry of entries) for (const [field, actual] of Object.entries(entry.values)) {
          const scale = field === 'softness' || ((field === 'position' || field === 'spacing') &&
            (field === 'position' ? pathData?.positionMode === 'fixed'
              : ['length', 'fixed'].includes(pathData?.spacingMode ?? '')))
            ? 0.01 : 1
          expect(Number(actual)).toBeCloseTo(Number(pose[field]) * scale, 5)
        }
      }
      const setupWorld = Float32Array.from(engine.pose.world)
      engine.play('probe')
      engine.update(0.5)
      expect(Array.from(engine.pose.world).some((value, index) => Math.abs(value - setupWorld[index]!) > 1e-5)).toBe(true)
    } finally {
      engine.dispose()
    }
  })
})
