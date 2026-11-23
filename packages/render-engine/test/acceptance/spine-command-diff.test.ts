import { describe, expect, it } from '@jest/globals'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { importSpineAtlas } from '@/asset/atlas'
import { importSpine } from '@/asset/importer'
import { CpuBackend } from '@/backend/backend'
import { DEFAULT_CAMERA } from '@/render/camera'
import type { RenderFrame, RenderPacket } from '@/render/render'
import { Engine } from '@/runtime/runtime'
import thresholds from '../parity/thresholds.json'

const ROOT = join(process.cwd(), '..', '..', 'test/fixtures/spine')
const SAMPLES = ['spineboy', 'raptor', 'stretchyman'] as const
// Only the A43 child-process probe sets this flag; fixture files are never moved or modified.
const assetsPresent = process.env.A43_TEST_MISSING_SPINE_ASSETS !== '1' && SAMPLES.every(name =>
  ['-pro.json', '.atlas', '.png'].every(ext => existsSync(join(ROOT, name, `${name}${ext}`))))
if (process.env.SPINE_PARITY_REQUIRED === '1' && !assetsPresent) {
  throw new Error('Official Spine samples missing; run node scripts/fetch-spine-samples.mjs')
}
if (!assetsPresent && process.env.A43_TEST_MISSING_SPINE_ASSETS === '1') {
  process.stderr.write('[A43 SKIP] Official Spine samples simulated absent; optional RenderCommand parity skipped, not passed.\n')
}

type OfficialCommand = {
  positions: number[]; uvs: number[]; colors: number[]; darkColors: number[]
  indices: number[]; blendMode: number; page: number
}

function officialCommands(name: string, time: number | null, animation: string): OfficialCommand[] {
  const output = execFileSync(process.execPath, [
    'scripts/oracle/spine-commands.mjs', join(ROOT, name), time === null ? 'setup' : String(time),
  ], { cwd: join(process.cwd(), '..', '..'), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const result = JSON.parse(output) as { commands: OfficialCommand[]; runtime: string; pma: boolean; stride: number; clipping: string; animation: string }
  expect([result.runtime, result.pma, result.stride, result.clipping, result.animation]).toEqual([
    'spine-core@4.3.13', true, 2, 'clipTrianglesUnpacked', animation,
  ])
  return result.commands
}

const blend = (mode: number): RenderPacket['blend'] => {
  switch (mode) {
    case 1: return 'add'
    case 2: return 'multiply'
    case 3: return 'screen'
    case 0: return 'normal'
    default: throw new Error(`Unsupported Spine blend mode ${mode}`)
  }
}

function unpack(colors: readonly number[], count: number): Uint8Array {
  const out = new Uint8Array(count * 4)
  for (let i = 0; i < count; i += 1) {
    const color = colors[i]!
    out.set([(color >>> 16) & 255, (color >>> 8) & 255, color & 255, (color >>> 24) & 255], i * 4)
  }
  return out
}

// The official core's clipTrianglesUnpacked path emits already-clipped positions/UVs/indices.
// Keep command order and every per-vertex field; only scale Spine pixels into engine world units.
function commandFrame(commands: OfficialCommand[], engineFrame: RenderFrame): RenderFrame {
  const packets: RenderPacket[] = []
  for (const command of commands) {
    const count = command.positions.length / 2
    const page = command.page
    if (engineFrame.assets?.pages[page] === undefined) throw new Error('Official RenderCommand references unknown texture page')
    const material = engineFrame.assets.materials.find(candidate => candidate.kind === 'sprite' && candidate.page === page)
    if (material === undefined) throw new Error('Official RenderCommand references page without sprite material')
    const positions = new Float32Array(count * 2)
    for (let i = 0; i < positions.length; i += 1) positions[i] = command.positions[i]! * 0.01
    const dark = unpack(command.darkColors, count)
    const twoColor = dark.some((v, i) => i % 4 !== 3 && v !== 0)
    packets.push({
      id: packets.length, kind: 'mesh', version: 1, positions,
      uvs: new Float32Array(command.uvs),
      colors: unpack(command.colors, count),
      ...(twoColor ? { dark, twoColor: true } : {}),
      depth: null, indices: new Uint16Array(command.indices),
      materialId: material.id, page, blend: blend(command.blendMode),
      maskPath: -1, order: packets.length, depthKey: 0, subOrder: 0, seq: packets.length,
    })
  }
  if (packets.length === 0) throw new Error('Official SkeletonRendererCore produced no commands')
  return {
    packets, width: engineFrame.width, height: engineFrame.height,
    ...(engineFrame.viewProjection === undefined ? {} : { viewProjection: engineFrame.viewProjection }),
    ...(engineFrame.assets === undefined ? {} : { assets: engineFrame.assets }),
    depthMode: 'none',
  }
}

function pixels(frame: RenderFrame): Uint8ClampedArray {
  const backend = new CpuBackend({ width: frame.width, height: frame.height, supersample: 8 })
  try {
    backend.draw(frame)
    return backend.readPixels()
  } finally {
    backend.dispose()
  }
}

function difference(expected: Uint8ClampedArray, actual: Uint8ClampedArray) {
  expect(actual.length).toBe(expected.length)
  const foreground = (pixels: Uint8ClampedArray) => {
    let count = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0) count++
    }
    return count
  }
  expect(foreground(expected)).toBeGreaterThan(0)
  expect(foreground(actual)).toBeGreaterThan(0)
  let max = 0
  let sum = 0
  for (let i = 0; i < expected.length; i += 1) {
    const value = Math.abs(expected[i]! - actual[i]!)
    max = Math.max(max, value)
    sum += value
  }
  return { max, mean: sum / expected.length }
}

const suite = assetsPresent ? describe : describe.skip
suite('official RenderCommand same-rasterizer parity (A34)', () => {
  it('compares official and engine setup/animated commands with the same CPU rasterizer', () => {
    const failures: string[] = []
    for (const name of SAMPLES) {
      const base = join(ROOT, name, name)
      const json = JSON.parse(readFileSync(`${base}-pro.json`, 'utf8'))
      const atlasText = readFileSync(`${base}.atlas`, 'utf8')
      const image = PNG.sync.read(readFileSync(`${base}.png`))
      const parsed = importSpineAtlas(atlasText)
      const engineAtlas = { ...parsed, pages: parsed.pages.map(page => ({
        ...page, image: { width: image.width, height: image.height, data: new Uint8Array(image.data) },
      })) }
      const asset = importSpine(json, { atlas: engineAtlas, unitScale: 0.01, sourceYDown: false })
      const scale = Math.min(256 / Math.max(1, json.skeleton.width), 192 / Math.max(1, json.skeleton.height)) * 0.8
      const camera = {
        ...DEFAULT_CAMERA,
        target: [(json.skeleton.x + json.skeleton.width / 2) * 0.01, (json.skeleton.y + json.skeleton.height / 2) * 0.01, 0] as [number, number, number],
        orthoHeight: (192 / scale) * 0.01,
        viewport: { width: 256, height: 192, dpr: 1 },
      }
      const engine = new Engine({ backend: 'cpu', supersample: 8 })
      engine.load(asset)
      engine.setCamera(camera)
      const animation = [...asset.animations.values()].find(clip => clip.duration > 0)
      if (!animation) throw new Error('No positive-duration animation in imported sample')
      for (const time of [null, 0.25] as const) {
        if (time !== null) {
          engine.play(animation.name)
          engine.update(time)
        }
        const frame = engine.render()
        expect(frame.packets.length).toBeGreaterThan(0)
        expect(frame.packets.some(packet => packet.indices.length >= 3)).toBe(true)
        const official = commandFrame(officialCommands(name, time, animation.name), frame)
        expect(official.packets.some(packet => packet.indices.length >= 3)).toBe(true)
        const result = difference(pixels(official), pixels(frame))
        console.log('command-diff', name, time ?? 'setup', result, 'packets', official.packets.length, frame.packets.length)
        if (result.max > thresholds.sameRasterizer.maxLsb || result.mean > thresholds.sameRasterizer.meanLsb) {
          failures.push(`${name} ${time ?? 'setup'}: max=${result.max} mean=${result.mean.toFixed(4)}`)
        }
      }
      engine.dispose()
    }
    expect(failures).toEqual([])
  })
})
