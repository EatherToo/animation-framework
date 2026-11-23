import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importSpineAtlas } from '@/asset/atlas'
import { importSpine, importSpineBinary, type SkeletonAsset } from '@/asset/importer'
import { buildInverseBind, skinMesh2D } from '@/mesh/mesh'
import { markAllDirty, updateWorld } from '@/core/pose'
import { Engine } from '@/runtime/runtime'

// Run with SPINE_CORE_42_PACKAGE=/absolute/path/to/official/4.2/package.json.
// An explicit path prevents the workspace's 4.3 dependency from impersonating 4.2.
const packageFile = process.env.SPINE_CORE_42_PACKAGE
const root = resolve(process.cwd(), '../..')
const dir = resolve(root, 'test/fixtures/spine/spineboy-4.2')
const files = ['spineboy-pro.json', 'spineboy-pro.skel', 'spineboy.atlas'].map(name => resolve(dir, name))
if (process.env.SPINE_42_ORACLE_REQUIRED === '1' && (!packageFile || !existsSync(packageFile) || !files.every(existsSync))) {
  throw new Error('Official 4.2 oracle requires SPINE_CORE_42_PACKAGE=/absolute/path/to/4.2/package.json and matching Spineboy fixtures')
}
const suite = packageFile && files.every(existsSync) ? describe : describe.skip

type Snapshot = { bones: { name: string; world: number[]; local: number[]; beforeConstraints?: number[] }[];
  meshes: Record<string, number[]>; constraints?: { name: string; values: Record<string, number> }[] }
type Frame = { animation: string; time: number; binary: Snapshot; json: Snapshot }

// Separate process isolates the exact 4.2 package from Jest's 4.3 module graph.
const officialScript = `
const { createRequire, registerHooks } = require('node:module')
const { readFileSync, existsSync } = require('node:fs')
const { join, dirname } = require('node:path')
const { pathToFileURL, fileURLToPath } = require('node:url')
const pkg = process.argv[1], dir = process.argv[2]
const meta = JSON.parse(readFileSync(pkg, 'utf8'))
if (meta.name !== '@esotericsoftware/spine-core' || !/^4\\.2\\.\\d+$/.test(meta.version))
  throw new Error('Expected official spine-core@4.2.x, got ' + meta.name + '@' + meta.version)
const packageRoot = dirname(pkg)
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith(pathToFileURL(packageRoot).href)) {
    const candidate = new URL(specifier, context.parentURL)
    const pathname = fileURLToPath(candidate)
    if (!existsSync(pathname) && existsSync(pathname + '.js')) return nextResolve(candidate.href + '.js', context)
    if (existsSync(pathname) && existsSync(join(pathname, 'index.js')))
      return nextResolve(pathToFileURL(join(pathname, 'index.js')).href, context)
  }
  return nextResolve(specifier, context)
} })
const { AtlasAttachmentLoader, AnimationState, AnimationStateData, Physics,
  Skeleton, SkeletonBinary, SkeletonJson, TextureAtlas } = createRequire(pkg)('.')
const atlasText = readFileSync(join(dir, 'spineboy.atlas'), 'utf8')
const json = JSON.parse(readFileSync(join(dir, 'spineboy-pro.json'), 'utf8'))
if (!json.skeleton.spine.startsWith('4.2.')) throw new Error('Not a 4.2 JSON fixture')
const samples = [['idle', 0], ['idle', 0.15], ['idle', 0.4], ['idle', 0.8],
  ['walk', 0.15], ['walk', 0.4], ['walk', 0.6], ['walk', 0.8], ['walk', 0.95],
  ['aim', 0.15], ['aim', 0.4], ['aim', 0.8]]
function snapshot(binary, animation, time) {
  const loader = new AtlasAttachmentLoader(new TextureAtlas(atlasText))
  const data = binary
    ? new SkeletonBinary(loader).readSkeletonData(Uint8Array.from(readFileSync(join(dir, 'spineboy-pro.skel'))))
    : new SkeletonJson(loader).readSkeletonData(json)
  if (!data.animations.some(a => a.name === animation)) throw new Error('Missing official animation ' + animation)
  const skeleton = new Skeleton(data)
  skeleton.setToSetupPose()
  if (time) {
    const state = new AnimationState(new AnimationStateData(data))
    state.setAnimation(0, animation, false)
    state.update(time)
    state.apply(skeleton)
  }
  const local = b => [b.x * 0.01, b.y * 0.01, b.rotation * Math.PI / 180,
    b.scaleX, b.scaleY, b.shearX * Math.PI / 180, b.shearY * Math.PI / 180]
  const before = new Map(skeleton.bones.map(b => [b.data.name, local(b)]))
  skeleton.updateWorldTransform(Physics.update)
  const bones = skeleton.bones.map(b => ({ name: b.data.name, local: local(b),
    beforeConstraints: before.get(b.data.name),
    world: [b.a, b.c, b.b, b.d, b.worldX * 0.01, b.worldY * 0.01] }))
  const constraints = skeleton.transformConstraints.map(c => ({ name: c.data.name,
    values: Object.fromEntries(['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY']
      .filter(key => typeof c[key] === 'number').map(key => [key, c[key]])) }))
  const meshes = {}
  for (const slot of skeleton.slots) {
    const attachment = slot.getAttachment()
    if (!attachment || !attachment.triangles || !attachment.worldVerticesLength) continue
    const vertices = new Float32Array(attachment.worldVerticesLength)
    attachment.computeWorldVertices(slot, 0, vertices.length, vertices, 0, 2)
    meshes[slot.data.name + ':' + attachment.name] = Array.from(vertices, n => n * 0.01)
  }
  return { bones, meshes, constraints }
}
process.stdout.write(JSON.stringify({ version: meta.version, frames: samples.map(([animation, time]) => ({
  animation, time, binary: snapshot(true, animation, time), json: snapshot(false, animation, time)
})) }))
`

function engineSnapshot(asset: SkeletonAsset, animation: string, time: number, withoutConstraints = false): Snapshot {
  const engine = new Engine({ backend: 'cpu' })
  try {
    engine.load(asset)
    if (withoutConstraints) {
      (engine as unknown as { solver: null }).solver = null
      engine.pose.local.set(asset.skeleton.setupLocal)
      markAllDirty(engine.pose)
    }
    if (time) { engine.play(animation); engine.update(time) }
    updateWorld(engine.pose)
    const bones = asset.skeleton.bones.map((bone, i) => ({ name: bone.name,
      local: Array.from(engine.pose.local.slice(i * 7, i * 7 + 7)),
      world: Array.from(engine.pose.world.slice(i * 6, i * 6 + 6)) }))
    const inverse = buildInverseBind(engine.pose)
    const meshes: Record<string, number[]> = {}
    for (const slot of engine.slotSet.slots) {
      const attachment = engine.slotSet.skins.get(slot.skinId)?.attachments.get(slot.attachmentId ?? '')
      if (attachment?.kind !== 'mesh' && attachment?.kind !== 'weightedMesh') continue
      meshes[slot.data.id + ':' + attachment.id] = Array.from(skinMesh2D(attachment.mesh, engine.pose, inverse))
    }
    return { bones, meshes }
  } finally { engine.dispose() }
}

function compare(actual: Snapshot, official: Snapshot, context: string, errors: string[]): number {
  expect(actual.bones.map(b => b.name).sort()).toEqual(official.bones.map(b => b.name).sort())
  expect(Object.keys(actual.meshes).sort()).toEqual(Object.keys(official.meshes).sort())
  expect(Object.keys(actual.meshes).length).toBeGreaterThan(0)
  let maximum = 0
  const values = (a: number[], b: number[], label: string) => {
    expect(a.length).toBe(b.length)
    a.forEach((value, index) => {
      const delta = Math.abs(value - b[index]!)
      if (!Number.isFinite(delta) || delta > 1e-4) {
        errors.push(`${context} ${label}[${index}]: engine=${value}, official=${b[index]}, delta=${delta} > 1e-4`)
      }
      maximum = Math.max(maximum, delta)
    })
  }
  const officialBones = new Map(official.bones.map(bone => [bone.name, bone.world]))
  actual.bones.forEach(bone => values(bone.world, officialBones.get(bone.name)!, `bone ${bone.name}`))
  Object.entries(actual.meshes).forEach(([key, vertices]) => values(vertices, official.meshes[key]!, `mesh ${key}`))
  return maximum
}

suite('official Spine 4.2 binary and JSON world vertices (requires SPINE_CORE_42_PACKAGE)', () => {
  it('compares each encoding to its own official 4.2 reference', () => {
    const path = resolve(packageFile!)
    const metadata = JSON.parse(readFileSync(path, 'utf8')) as { name: string; version: string }
    expect(metadata.name).toBe('@esotericsoftware/spine-core')
    expect(metadata.version).toMatch(/^4\.2\.\d+$/)
    const official = JSON.parse(execFileSync(process.execPath, ['-e', officialScript, path, dir], {
      cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    })) as { version: string; frames: Frame[] }
    const atlas = importSpineAtlas(readFileSync(files[2]!, 'utf8'))
    const bytes = readFileSync(files[1]!)
    const binary = importSpineBinary(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      { atlas, unitScale: 0.01 })
    const json = importSpine(JSON.parse(readFileSync(files[0]!, 'utf8')) as Record<string, unknown>,
      { atlas, unitScale: 0.01, sourceYDown: false })
    expect(binary.report.errors).toBe(0)
    expect(json.report.errors).toBe(0)
    let maximumBinary = 0, maximumJson = 0, officialEncodingDelta = 0
    const binaryErrors: string[] = [], jsonErrors: string[] = []
    for (const frame of official.frames) {
      if (frame.animation === 'idle' && frame.time === 0.15) {
        const raw = engineSnapshot(json, frame.animation, frame.time, true)
        const solved = engineSnapshot(json, frame.animation, frame.time)
        const byName = (snapshot: Snapshot) => new Map(snapshot.bones.map(bone => [bone.name, bone]))
        const rawBones = byName(raw), solvedBones = byName(solved), reference = byName(frame.json)
        const localDifferences = frame.json.bones.flatMap(bone => bone.beforeConstraints!.map((value, channel) => ({
          bone: bone.name, channel, delta: Math.abs(value - rawBones.get(bone.name)!.local[channel]!),
        }))).filter(diff => diff.delta < Math.PI).sort((a, b) => b.delta - a.delta).slice(0, 3)
        const shoulder = 'back-shoulder'
        console.info(`4.2 idle@0.15 constraint diagnosis: ${JSON.stringify({
          largestLocalDifferencesIgnoringFullTurns: localDifferences,
          shoulderLocal: [reference.get(shoulder)?.beforeConstraints, rawBones.get(shoulder)?.local],
          shoulderWorldXY: [reference.get(shoulder)?.world.slice(4), rawBones.get(shoulder)?.world.slice(4),
            solvedBones.get(shoulder)?.world.slice(4)],
          officialShoulder: frame.json.constraints?.find(c => c.name === 'shoulder'),
          engineShoulder: json.constraints?.find(c => c.id === 'shoulder'),
        })}`)
      }
      const context = `${frame.animation} @ ${frame.time}`
      maximumBinary = Math.max(maximumBinary, compare(engineSnapshot(binary, frame.animation, frame.time), frame.binary,
        `${context} binary`, binaryErrors))
      maximumJson = Math.max(maximumJson, compare(engineSnapshot(json, frame.animation, frame.time), frame.json,
        `${context} JSON`, jsonErrors))
      expect(frame.binary.bones.map(b => b.name).sort()).toEqual(frame.json.bones.map(b => b.name).sort())
      expect(Object.keys(frame.binary.meshes).sort()).toEqual(Object.keys(frame.json.meshes).sort())
      const jsonBones = new Map(frame.json.bones.map(bone => [bone.name, bone.world]))
      for (const bone of frame.binary.bones) {
        bone.world.forEach((n, j) => {
          officialEncodingDelta = Math.max(officialEncodingDelta, Math.abs(n - jsonBones.get(bone.name)![j]!))
        })
      }
      for (const [key, vertices] of Object.entries(frame.binary.meshes)) {
        vertices.forEach((n, j) => {
          officialEncodingDelta = Math.max(officialEncodingDelta, Math.abs(n - frame.json.meshes[key]![j]!))
        })
      }
    }
    console.info(`Spine ${official.version} engine-v-official maxima: ${JSON.stringify({
      samples: official.frames.length, maximumBinary, maximumJson, officialBinaryJsonDelta: officialEncodingDelta,
      binaryFailures: binaryErrors.length, jsonFailures: jsonErrors.length,
      firstBinaryFailures: binaryErrors.slice(0, 5), firstJsonFailures: jsonErrors.slice(0, 5),
    })}`)
    if (binaryErrors.length || jsonErrors.length) {
      throw new Error(`Strict 1e-4 official parity failed: ${JSON.stringify({
        binaryFailures: binaryErrors.length, jsonFailures: jsonErrors.length,
        maximumBinary, maximumJson, officialEncodingDelta,
        firstBinaryFailures: binaryErrors.slice(0, 5), firstJsonFailures: jsonErrors.slice(0, 5),
      })}`)
    }
  })
})
