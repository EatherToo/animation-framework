import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importSpineAtlas } from '@/asset/atlas'
import { importSpine, importSpineBinary, type SkeletonAsset } from '@/asset/importer'
import { Engine } from '@/runtime/runtime'
import { buildInverseBind, skinMesh2D } from '@/mesh/mesh'
import { updateWorld } from '@/core/pose'

const root = resolve(process.cwd(), '../..')
const sample = (version: string) => resolve(root, 'test/fixtures/spine', version === '4.3' ? 'spineboy' : 'spineboy-4.2')
const files = (version: string) => ['spineboy-pro.json', 'spineboy-pro.skel', 'spineboy.atlas'].map(file => resolve(sample(version), file))
const available = (version: string) => files(version).every(existsSync)
if (process.env.SPINE_PARITY_REQUIRED === '1' && !available('4.3')) {
  throw new Error('Matching official 4.3 Spineboy JSON/skel/atlas missing; run node scripts/fetch-spine-samples.mjs')
}
if (process.env.SPINE_BINARY_PARITY_REQUIRED === '1' && !available('4.2')) {
  throw new Error('Matching official 4.2 Spineboy JSON/skel/atlas missing; run node scripts/fetch-spine-samples.mjs')
}

// Run independently against official spine-core. The binary and JSON inputs must agree there
// before their imported engine poses can be called same-source parity.
const oracle = `
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(process.argv[1] + '/package.json')
const { AtlasAttachmentLoader, AnimationState, AnimationStateData, Physics, Skeleton, SkeletonBinary, SkeletonJson, TextureAtlas } = require('@esotericsoftware/spine-core')
const dir = process.argv[2], animation = process.argv[3], time = Number(process.argv[4])
const atlas = readFileSync(dir + '/spineboy.atlas', 'utf8')
function snapshot(binary) {
  const loader = new AtlasAttachmentLoader(new TextureAtlas(atlas))
  const data = binary
    ? new SkeletonBinary(loader).readSkeletonData(readFileSync(dir + '/spineboy-pro.skel'))
    : new SkeletonJson(loader).readSkeletonData(JSON.parse(readFileSync(dir + '/spineboy-pro.json', 'utf8')))
  const skeleton = new Skeleton(data)
  skeleton.setupPose()
  if (time) {
    skeleton.time = time
    const state = new AnimationState(new AnimationStateData(data))
    state.setAnimation(0, animation, false)
    state.update(time)
    state.apply(skeleton)
  }
  skeleton.updateWorldTransform(Physics.update)
  const bones = skeleton.bones.map(b => ({ name: b.data.name,
    world: [b.appliedPose.a, b.appliedPose.c, b.appliedPose.b, b.appliedPose.d, b.appliedPose.worldX * 0.01, b.appliedPose.worldY * 0.01] }))
  const meshes = {}
  for (const slot of skeleton.slots) {
    const a = slot.appliedPose.attachment
    if (!a || !a.triangles || !a.worldVerticesLength) continue
    const out = new Float32Array(a.worldVerticesLength)
    a.computeWorldVertices(skeleton, slot, 0, out.length, out, 0, 2)
    meshes[slot.data.name + ':' + a.name] = Array.from(out, n => n * 0.01)
  }
  return { bones, meshes, animation: data.animations.find(a => a.name === animation)?.name }
}
process.stdout.write(JSON.stringify({ binary: snapshot(true), json: snapshot(false) }))
`

type Snapshot = { bones: { name: string; world: number[] }[]; meshes: Record<string, number[]>; animation: string }
type SourceBone = { name: string; parent?: string; x?: number; y?: number; rotation?: number;
  shearX?: number; shearY?: number; scaleX?: number; scaleY?: number }
type Precision = { position: number; angle: number; scale: number }

// Decimal exports round each source scalar to half a unit in its last place.
// Animation offsets and setup values are independently rounded, so both contribute.
function halfStep(value: number): number {
  const decimal = String(value).split('.')[1]
  // Integral fields in this export (notably scale=1 and rotation=0) are exact.
  return decimal === undefined ? 0 : 0.5 * 10 ** -decimal.length
}
function sourcePrecision(source: Record<string, unknown>, animationName: string,
  binaryAsset: SkeletonAsset, jsonAsset: SkeletonAsset): Map<string, Precision> {
  const result = new Map<string, Precision>()
  const add = (name: string, kind: keyof Precision, value: unknown) => {
    if (typeof value !== 'number') return
    const precision = result.get(name) ?? { position: 0, angle: 0, scale: 0 }
    const unit = kind === 'position' ? 0.01 : kind === 'angle' ? Math.PI / 180 : 1
    precision[kind] = Math.max(precision[kind], halfStep(value) * unit)
    result.set(name, precision)
  }
  for (const bone of source.bones as SourceBone[]) {
    for (const key of ['x', 'y'] as const) add(bone.name, 'position', bone[key])
    for (const key of ['rotation', 'shearX', 'shearY'] as const) add(bone.name, 'angle', bone[key])
    for (const key of ['scaleX', 'scaleY'] as const) add(bone.name, 'scale', bone[key])
  }
  type Frames = Record<string, number>[]
  const animations = source.animations as Record<string, { bones?: Record<string, Record<string, Frames>> }>
  for (const animation of [animations[animationName]].filter((value): value is NonNullable<typeof value> => value !== undefined)) {
    for (const [name, timelines] of Object.entries(animation.bones ?? {})) {
      for (const [kind, frames] of Object.entries(timelines)) for (const frame of frames) {
        if (kind.startsWith('rotate') || kind.startsWith('shear')) add(name, 'angle', frame.value)
        if (kind.startsWith('translate')) { add(name, 'position', frame.x); add(name, 'position', frame.y) }
        if (kind.startsWith('scale')) { add(name, 'scale', frame.x); add(name, 'scale', frame.y) }
      }
    }
  }
  // Coarse textual values such as scale=1 are exact in these same-source
  // inputs; tighten their budget to the observed imported scalar difference.
  // Verify each imported difference is inside the JSON rounding interval.
  const binaryClip = binaryAsset.animations.get(animationName)
  const jsonClip = jsonAsset.animations.get(animationName)
  for (const [name, p] of result) {
    const bi = binaryAsset.skeleton.bones.findIndex(bone => bone.name === name)
    const ji = jsonAsset.skeleton.bones.findIndex(bone => bone.name === name)
    let observed = Math.max(
      Math.abs(binaryAsset.skeleton.setupLocal[bi * 7 + 3]! - jsonAsset.skeleton.setupLocal[ji * 7 + 3]!),
      Math.abs(binaryAsset.skeleton.setupLocal[bi * 7 + 4]! - jsonAsset.skeleton.setupLocal[ji * 7 + 4]!))
    const jsonScales = jsonClip?.timelines.filter(t => t.kind === 'scale' && t.path === name) ?? []
    const binaryScales = binaryClip?.timelines.filter(t => t.kind === 'scale' && t.path === name) ?? []
    expect(binaryScales.length).toBe(jsonScales.length)
    for (let t = 0; t < jsonScales.length; t++) {
      const jt = jsonScales[t]!, bt = binaryScales[t]!
      if (jt.kind !== 'scale' || bt.kind !== 'scale') throw new Error('scale timeline mismatch')
      const jsonKeys = jt.keys
      const binaryKeys = bt.keys
      expect(binaryKeys.length).toBe(jsonKeys.length)
      for (let k = 0; k < jsonKeys.length; k++) {
        if ('value' in jsonKeys[k]! && 'value' in binaryKeys[k]!) {
          observed = Math.max(observed, Math.abs(binaryKeys[k]!.value - jsonKeys[k]!.value))
        }
      }
    }
    expect(observed).toBeLessThanOrEqual(p.scale + 2e-6)
    p.scale = observed + 2e-6 // imported Float32 arithmetic, not JSON decimal rounding
    let angular = Math.max(...[2, 5, 6].map(channel => Math.abs(
      binaryAsset.skeleton.setupLocal[bi * 7 + channel]! - jsonAsset.skeleton.setupLocal[ji * 7 + channel]!)))
    const jsonAngles = jsonClip?.timelines.filter(t => (t.kind === 'rotate' || t.kind === 'shear') && t.path === name) ?? []
    const binaryAngles = binaryClip?.timelines.filter(t => (t.kind === 'rotate' || t.kind === 'shear') && t.path === name) ?? []
    expect(binaryAngles.length).toBe(jsonAngles.length)
    for (let t = 0; t < jsonAngles.length; t++) {
      const jt = jsonAngles[t]!, bt = binaryAngles[t]!
      if (!('keys' in jt) || !('keys' in bt)) throw new Error('angle timeline mismatch')
      expect(bt.keys.length).toBe(jt.keys.length)
      for (let k = 0; k < jt.keys.length; k++) {
        const bk = bt.keys[k]!, jk = jt.keys[k]!
        if ('value' in bk && 'value' in jk) angular = Math.max(angular, Math.abs(bk.value - jk.value))
      }
    }
    expect(angular).toBeLessThanOrEqual(p.angle + 2e-6)
    p.angle = angular + 2e-6
  }
  return result
}

function quantizationBounds(source: Record<string, unknown>, binary: Snapshot, json: Snapshot,
  binaryAsset: SkeletonAsset, jsonAsset: SkeletonAsset):
  { bones: number[][]; meshes: Record<string, number[]> } {
  const bones = source.bones as SourceBone[]
  const indexByName = new Map(bones.map((bone, index) => [bone.name, index]))
  const worldByName = new Map(binary.bones.map((bone, index) => [bone.name,
    { binary: bone.world, json: json.bones[index]!.world }]))
  const precision = sourcePrecision(source, binary.animation, binaryAsset, jsonAsset)
  const constrained = [...(source.ik as { bones: string[] }[] ?? []),
    ...(source.transform as { bones: string[] }[] ?? [])]
  const limits = binary.bones.map((bone, index) => {
    const world = bone.world, counterpart = json.bones[index]!.world
    let position = 0, linear = 0, constraintStages = 0
    let ancestor: number | undefined = indexByName.get(bone.name)
    while (ancestor !== undefined) {
      const sourceBone: SourceBone = bones[ancestor]!
      const p = precision.get(sourceBone.name) ?? { position: 0, angle: 0, scale: 0 }
      constraintStages += constrained.filter(constraint => constraint.bones.includes(sourceBone.name)).length
      const other = worldByName.get(sourceBone.name)!.binary
      const otherJson = worldByName.get(sourceBone.name)!.json
      const lever = Math.max(Math.hypot(world[4]! - other[4]!, world[5]! - other[5]!),
        Math.hypot(counterpart[4]! - otherJson[4]!, counterpart[5]! - otherJson[5]!))
      const parentScale = Math.max(1, ...other.slice(0, 4).map(Math.abs), ...otherJson.slice(0, 4).map(Math.abs))
      // Two local axes, setup plus timeline; rotation plus shear each affect
      // the linear columns. The lever arm propagates angular/scale rounding.
      position += 4 * p.position * parentScale + lever * (4 * p.angle + 2 * p.scale)
      linear += 4 * p.angle + 2 * p.scale
      ancestor = sourceBone.parent === undefined ? undefined : indexByName.get(sourceBone.parent)
    }
    const ulps = 16 * Math.max(1, ...world.map(Math.abs), ...counterpart.map(Math.abs)) * 2 ** -23
    // Each constraint stage reads a rounded target and writes another pose;
    // Constraint coupling can repeatedly read driven/target parent chains;
    // five extra paths per stage conservatively cover this fixture's IK/transform passes.
    const propagation = 1 + 5 * constraintStages
    const worldScale = Math.max(1, ...world.slice(0, 4).map(Math.abs),
      ...counterpart.slice(0, 4).map(Math.abs))
    return [linear * propagation * worldScale + ulps, linear * propagation * worldScale + ulps,
      linear * propagation * worldScale + ulps, linear * propagation * worldScale + ulps,
      position * propagation + ulps, position * propagation + ulps]
  })
  const meshes: Record<string, number[]> = {}
  const maxPosition = Math.max(...limits.map(limit => limit[4]!))
  const maxLinear = Math.max(...limits.map(limit => limit[0]!))
  type SourceMesh = { type?: string; uvs?: number[]; vertices?: number[] }
  const skins = source.skins as { attachments: Record<string, Record<string, SourceMesh>> }[]
  for (const [key, vertices] of Object.entries(binary.meshes)) {
    const [slot, attachment] = key.split(':')
    const mesh = skins.flatMap(skin => Object.entries(skin.attachments[slot!] ?? {}))
      .find(([name]) => name === attachment)?.[1]
    expect(mesh?.vertices).toBeDefined()
    const encoded = mesh!.vertices!
    const weighted = encoded.length !== mesh!.uvs?.length
    const inputBounds: { coordinate: number; weight: number }[] = []
    if (weighted) {
      for (let cursor = 0; cursor < encoded.length;) {
        const count = encoded[cursor++]!
        let coordinate = 0, weight = 0
        for (let influence = 0; influence < count; influence++) {
          cursor++ // bone index is exact
          const x = encoded[cursor++]!, y = encoded[cursor++]!, w = encoded[cursor++]!
          coordinate += (halfStep(x) + halfStep(y)) * 0.01 * Math.abs(w)
          weight += halfStep(w)
        }
        inputBounds.push({ coordinate, weight })
      }
    } else {
      for (let cursor = 0; cursor < encoded.length; cursor += 2) {
        inputBounds.push({ coordinate: (halfStep(encoded[cursor]!) + halfStep(encoded[cursor + 1]!)) * 0.01,
          weight: 0 })
      }
    }
    if (inputBounds.length * 2 !== vertices.length) throw new Error(`${key}: source ${inputBounds.length}, runtime ${vertices.length / 2}`)
    meshes[key] = vertices.map((value, index) => {
      const radius = Math.max(1, Math.abs(value), Math.abs(json.meshes[key]![index]!))
      const input = inputBounds[Math.floor(index / 2)]!
      return maxPosition + radius * (maxLinear + input.weight) + input.coordinate +
        16 * radius * 2 ** -23
    })
  }
  return { bones: limits, meshes }
}
function checkQuantization(actual: number, expected: number, bound: number, context: string): void {
  const delta = Math.abs(actual - expected)
  if (!Number.isFinite(delta) || delta > bound) {
    throw new Error(`${context}: discrepancy ${delta} exceeds decimal-precision bound ${bound}`)
  }
}
function near(actual: readonly number[], expected: readonly number[], tolerance: number, context: string): void {
  expect(actual.length).toBe(expected.length)
  actual.forEach((value, index) => {
    expect(Number.isFinite(value)).toBe(true)
    if (Math.abs(value - expected[index]!) > tolerance) {
      throw new Error(`${context}[${index}]: binary=${value} JSON=${expected[index]} delta=${value - expected[index]!} > ${tolerance}`)
    }
  })
}
function load(version: string): { binary: SkeletonAsset; json: SkeletonAsset } {
  const [jsonFile, binaryFile, atlasFile] = files(version)
  const atlas = importSpineAtlas(readFileSync(atlasFile!, 'utf8'))
  const json = JSON.parse(readFileSync(jsonFile!, 'utf8')) as Record<string, unknown>
  const bytes = readFileSync(binaryFile!)
  const binary = importSpineBinary(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    { atlas, unitScale: 0.01 })
  return { binary, json: importSpine(json, { atlas, unitScale: 0.01, sourceYDown: false }) }
}
function engineSnapshot(asset: SkeletonAsset, animation: string, time: number): Snapshot {
  const engine = new Engine({ backend: 'cpu' })
  try {
    engine.load(asset)
    if (time) { engine.play(animation); engine.update(time) }
    updateWorld(engine.pose)
    const bones = asset.skeleton.bones.map((b, i) => ({ name: b.name,
      world: Array.from(engine.pose.world.slice(i * 6, i * 6 + 6)) }))
    const inverse = buildInverseBind(engine.pose)
    const meshes: Record<string, number[]> = {}
    for (let i = 0; i < engine.slotSet.slots.length; i++) {
      const slot = engine.slotSet.slots[i]!
      const attachment = engine.slotSet.skins.get(slot.skinId)?.attachments.get(slot.attachmentId ?? '')
      if (attachment?.kind !== 'mesh' && attachment?.kind !== 'weightedMesh') continue
      meshes[slot.data.id + ':' + attachment.id] = Array.from(skinMesh2D(attachment.mesh, engine.pose, inverse))
    }
    return { bones, meshes, animation }
  } finally { engine.dispose() }
}

for (const version of ['4.3', '4.2']) {
  const suite = available(version) ? describe : describe.skip
  suite(`official ${version} same-source Spineboy binary`, () => {
    if (version === '4.2') it('parses matching 4.2 setup and transform timeline data', () => {
      const { binary, json } = load(version)
      expect(binary.sourceVersion.startsWith('4.2')).toBe(true)
      expect(binary.skeleton.count).toBe(json.skeleton.count)
      expect(binary.animations.size).toBe(json.animations.size)
      expect(binary.report.errors).toBe(0)
      expect(binary.animations.get('aim')!.timelines.filter(timeline => timeline.kind === 'transform').length)
        .toBe(json.animations.get('aim')!.timelines.filter(timeline => timeline.kind === 'transform').length)
    })
    if (version === '4.2') it('rejects a perturbed binary setup scalar', () => {
      const { binary, json } = load(version)
      const source = JSON.parse(readFileSync(files(version)[0]!, 'utf8')) as Record<string, unknown>
      const rootIndex = binary.skeleton.bones.findIndex(bone => bone.name === 'root')
      expect(rootIndex).toBeGreaterThanOrEqual(0)
      binary.skeleton.setupLocal[rootIndex * 7] = binary.skeleton.setupLocal[rootIndex * 7]! + 0.01
      const actual = engineSnapshot(binary, 'idle', 0)
      const expected = engineSnapshot(json, 'idle', 0)
      const bounds = quantizationBounds(source, actual, expected, binary, json)
      const root = actual.bones.findIndex(bone => bone.name === 'root')
      expect(() => checkQuantization(actual.bones[root]!.world[4]!, expected.bones[root]!.world[4]!,
        bounds.bones[root]![4]!, 'mutated root x')).toThrow(/exceeds decimal-precision bound/)
    })
    it(version === '4.2'
      ? 'quantization envelope diagnostic across setup, animation, bones and meshes'
      : 'covers setup, idle, walk and aim at multiple frames and world vertices', () => {
      const { binary, json } = load(version)
      expect(binary.report.errors).toBe(0)
      expect(json.report.errors).toBe(0)
      expect(binary.sourceVersion.slice(0, 3)).toBe(version)
      expect(binary.skeleton.count).toBe(json.skeleton.count)
      let worstSetup = { delta: 0, context: '', binary: 0, json: 0 }
      for (let i = 0; i < binary.skeleton.count; i++) {
        for (let channel = 0; channel < 7; channel++) {
          const delta = Math.abs(binary.skeleton.setupLocal[i * 7 + channel]! - json.skeleton.setupLocal[i * 7 + channel]!)
          if (delta > worstSetup.delta) worstSetup = { delta, context: `${binary.skeleton.bones[i]!.name}[${channel}]`,
            binary: binary.skeleton.setupLocal[i * 7 + channel]!, json: json.skeleton.setupLocal[i * 7 + channel]! }
        }
        near(Array.from(binary.skeleton.setupLocal.slice(i * 7, i * 7 + 7)),
          Array.from(json.skeleton.setupLocal.slice(i * 7, i * 7 + 7)), 2e-4,
          `${version} setup local ${binary.skeleton.bones[i]!.name}`)
      }
      expect([...binary.animations.keys()]).toEqual([...json.animations.keys()])
      const unsupported = binary.report.issues.filter(issue => issue.code.startsWith('W_BINARY_'))
      expect(unsupported.every(issue => issue.code === 'W_BINARY_CONSTRAINT_TIMELINE' ||
        issue.code === 'W_BINARY_CONSTRAINT_CURVE')).toBe(true)
      expect(binary.animations.get('aim')!.timelines.filter(timeline => timeline.kind === 'transform').length)
        .toBe(json.animations.get('aim')!.timelines.filter(timeline => timeline.kind === 'transform').length)
      if (version === '4.3') {
        const binaryIk = binary.animations.get('walk')!.timelines.find(t => t.kind === 'ik' && t.path === 'front-leg-ik')
        const jsonIk = json.animations.get('walk')!.timelines.find(t => t.kind === 'ik' && t.path === 'front-leg-ik')
        expect(binaryIk && 'frames' in binaryIk ? binaryIk.frames.length : 0).toBe(4)
        if (binaryIk && jsonIk && 'frames' in binaryIk && 'frames' in jsonIk) {
          binaryIk.frames.forEach((frame, index) => {
            near(frame.values, jsonIk.frames[index]!.values, 1e-6, `walk front-leg-ik frame ${index} values`)
            const binarySoftness = frame.curves?.[1]
            const jsonSoftness = jsonIk.frames[index]!.curves?.[1]
            expect(binarySoftness === undefined).toBe(jsonSoftness === undefined)
            if (Array.isArray(binarySoftness) && Array.isArray(jsonSoftness)) {
              near(binarySoftness, jsonSoftness, 1e-5, `walk front-leg-ik frame ${index} softness curve`)
            }
          })
        }
      }
      const source = version === '4.2'
        ? JSON.parse(readFileSync(files(version)[0]!, 'utf8')) as Record<string, unknown> : null
      const errors: { delta: number; bound: number; context: string }[] = []
      const collect = (actual: readonly number[], expected: readonly number[], context: string,
        bounds?: readonly number[]) => {
        expect(actual.length).toBe(expected.length)
        actual.forEach((value, index) => {
          expect(Number.isFinite(value)).toBe(true)
          const delta = Math.abs(value - expected[index]!)
          const bound = bounds?.[index] ?? 1e-4
          errors.push({ delta, bound, context: `${context}[${index}]` })
          checkQuantization(value, expected[index]!, bound, `${context}[${index}]`)
        })
      }
      const frames = [['idle', 0], ['idle', 0.15], ['idle', 0.4], ['idle', 0.8],
        ['walk', 0.15], ['walk', 0.4], ['walk', 0.6], ['walk', 0.8], ['walk', 0.95],
        ['aim', 0.15], ['aim', 0.4], ['aim', 0.8]] as const
      for (const [animation, time] of frames) {
        const binaryFrame = engineSnapshot(binary, animation, time)
        const jsonFrame = engineSnapshot(json, animation, time)
        expect(binaryFrame.bones.map(b => b.name)).toEqual(jsonFrame.bones.map(b => b.name))
        const bounds = source === null ? null : quantizationBounds(source, binaryFrame, jsonFrame, binary, json)
        for (let i = 0; i < binaryFrame.bones.length; i++) {
          collect(binaryFrame.bones[i]!.world, jsonFrame.bones[i]!.world,
            `${version} ${animation} ${time} bone ${i} ${binaryFrame.bones[i]!.name}`, bounds?.bones[i])
        }
        expect(Object.keys(binaryFrame.meshes).sort()).toEqual(Object.keys(jsonFrame.meshes).sort())
        for (const [key, vertices] of Object.entries(binaryFrame.meshes)) {
          collect(vertices, jsonFrame.meshes[key]!, `${version} ${animation} ${time} mesh ${key}`, bounds?.meshes[key])
        }
        expect(Object.keys(binaryFrame.meshes).length).toBeGreaterThan(0)
        if (version === '4.3') {
          const official = JSON.parse(execFileSync(process.execPath,
            ['--input-type=module', '-e', oracle, root, sample(version), animation, String(time)],
            { cwd: root, encoding: 'utf8' })) as { binary: Snapshot; json: Snapshot }
          expect(official.binary.animation).toBe(animation)
          expect(official.binary.bones.map(b => b.name)).toEqual(official.json.bones.map(b => b.name))
          for (let i = 0; i < official.binary.bones.length; i++) {
            near(official.binary.bones[i]!.world, official.json.bones[i]!.world, 1e-4, `spine-core ${animation} ${time} bone ${i}`)
          }
          expect(Object.keys(official.binary.meshes).sort()).toEqual(Object.keys(official.json.meshes).sort())
          for (const [key, vertices] of Object.entries(official.binary.meshes)) {
            near(vertices, official.json.meshes[key]!, 1e-4, `spine-core ${animation} ${time} mesh ${key}`)
          }
          expect(Object.keys(official.binary.meshes).length).toBeGreaterThan(0)
        }
      }
      const worst = errors.reduce((max, error) => error.delta > max.delta ? error : max,
        { delta: 0, bound: 0, context: 'none' })
      if (version === '4.2') {
        const closest = errors.reduce<{ ratio: number; context: string; delta: number; bound: number }>((max, error) =>
          error.bound && error.delta / error.bound > max.ratio
          ? { ratio: error.delta / error.bound, context: error.context, delta: error.delta, bound: error.bound }
          : max, { ratio: 0, context: 'none', delta: 0, bound: 0 })
        const largestBound = errors.reduce((max, error) => error.bound > max.bound ? error : max,
          { delta: 0, bound: 0, context: 'none' })
        // Diagnostic only: constrained bones can have a broad propagated bound.
        console.info(`4.2 decimal precision parity: ${JSON.stringify({ samples: errors.length,
          worst, closest, largestBound })}`)
      }
      if ((version === '4.3' || process.env.SPINE_BINARY_PARITY_REQUIRED === '1') && worst.delta > 1e-4) {
        const top = errors.sort((a, b) => b.delta - a.delta).slice(0, 8)
        const frameMax = Object.fromEntries(frames.map(([animation, time]) => [`${animation} ${time}`,
          errors.filter(error => error.context.startsWith(`${version} ${animation} ${time} `))
            .reduce((max, error) => Math.max(max, error.delta), 0)]))
        throw new Error(`${version} maximum engine binary/JSON error > 1e-4: ${JSON.stringify({ top, frameMax, worstSetup })}`)
      }
    })
  })
}
