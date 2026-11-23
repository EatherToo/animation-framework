import { describe, expect, it } from '@jest/globals'
import { importSpine, importSpineBinary } from '@/asset/importer'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Encode the official SkeletonBinary wire layout, including big-endian floats,
// length+1 strings, one-based string refs, and versioned constraint/mesh blocks.
class Writer {
  bytes: number[] = []
  byte(n: number): void { this.bytes.push(n & 255) }
  int(n: number): void { for (let i = 3; i >= 0; i--) this.byte(n >>> (i * 8)) }
  float(n: number): void {
    const view = new DataView(new ArrayBuffer(4))
    view.setFloat32(0, n, false)
    for (let i = 0; i < 4; i++) this.byte(view.getUint8(i))
  }
  varint(n: number): void {
    while (n >= 128) { this.byte((n % 128) | 128); n = Math.floor(n / 128) }
    this.byte(n)
  }
  string(s: string): void {
    const bytes = new TextEncoder().encode(s)
    this.varint(bytes.length + 1)
    for (const b of bytes) this.byte(b)
  }
  buffer(): ArrayBuffer { return Uint8Array.from(this.bytes).buffer as ArrayBuffer }
}

function official(version: string, mesh = false, animated = false, ik = false, slotType = 0, transform = false, bezier = false): ArrayBuffer {
  const w = new Writer()
  w.int(0x12345678); w.int(0x12345678)
  w.string(version)
  for (const value of [0, 0, 200, 200, 100]) w.float(value)
  w.byte(0) // nonessential
  const strings = ['image']
  w.varint(strings.length); for (const s of strings) w.string(s)
  w.varint(2) // bones
  w.string('root')
  for (const v of [0, 0, 0, 1, 1, 0, 0]) w.float(v)
  if (version.startsWith('4.3')) w.byte(0) // inherit precedes length in 4.3
  w.float(0)
  if (!version.startsWith('4.3')) w.byte(0)
  w.byte(0) // skinRequired
  w.string('child'); w.varint(0) // parent index, not zigzag
  for (const v of [30, 10, 20, 1, 1, 0, 0]) w.float(v)
  if (version.startsWith('4.3')) w.byte(0)
  w.float(5)
  if (!version.startsWith('4.3')) w.byte(0)
  w.byte(0)
  w.varint(1) // slots
  w.string('slot'); w.varint(1); w.int(0xffffffff); w.int(0xffffffff)
  w.varint(1); w.varint(0) // attachment ref, blend
  if (version.startsWith('4.3')) {
    w.varint(Number(ik) + Number(transform))
    if (ik) {
      w.string('aim'); w.byte(0) // tagged IK
      w.varint(1); w.varint(1); w.varint(0) // child bone, root target
      w.byte(32 | 64); w.float(0.75)
    }
    if (transform) {
      w.string('follow'); w.byte(2) // tagged transform
      w.varint(1); w.varint(1); w.varint(0) // child, root source
      w.byte(0); w.byte(0) // no properties or offsets
      w.byte(3); w.float(0.5); w.float(0.25) // rotate/x mixes
    }
  } else {
    w.varint(ik ? 1 : 0)
    if (ik) {
      w.string('aim'); w.varint(0) // order
      w.varint(1); w.varint(1); w.varint(0)
      w.byte(2 | 32 | 64); w.float(0.75)
    }
    w.varint(transform ? 1 : 0)
    if (transform) {
      w.string('follow'); w.varint(0)
      w.varint(1); w.varint(1); w.varint(0)
      w.byte(0); w.byte(2 | 4); w.float(0.5); w.float(0.25)
    }
    for (let i = 0; i < 2; i++) w.varint(0) // path/physics
  }
  w.varint(1); w.varint(0); w.varint(1); w.varint(1) // default skin slot/slot index/attachments/ref
  if (mesh) {
    w.byte(2) // mesh attachment flags
    w.varint(3) // hull (triangle count = 3)
    w.varint(3) // vertex count
    for (const v of [0, 0, 20, 0, 0, 20]) w.float(v)
    for (const v of [0, 0, 1, 0, 0, 1]) w.float(v)
    for (const i of [0, 1, 2]) w.varint(i)
    if (version.startsWith('4.3')) w.varint(0) // timelineSlots count
  } else {
    w.byte(0) // region flags
    for (const v of [3, 4, 1, 1, 20, 40]) w.float(v)
  }
  w.varint(0) // other skins
  w.varint(0) // events
  w.varint(animated ? 1 : 0)
  if (animated) {
    w.string('idle')
    w.varint(3) // total timeline count
    w.varint(1); w.varint(0); w.varint(1) // slot 0, one attachment timeline
    w.byte(slotType); w.varint(2)
    w.float(0); w.varint(1); w.float(0.5); w.varint(0)
    w.varint(1); w.varint(1); w.varint(2) // child bone, rotate + translate
    w.byte(0); w.varint(2); w.varint(bezier ? 1 : 0) // rotate frames, bezier count
    w.float(0); w.float(0); w.float(1); w.float(45); w.byte(bezier ? 2 : 1)
    if (bezier) for (const control of [0.25, 10, 0.75, 35]) w.float(control)
    w.byte(1); w.varint(2); w.varint(0) // translate frames, bezier count
    w.float(0); w.float(0); w.float(0)
    w.float(1); w.float(8); w.float(6); w.byte(0) // linear
    for (let i = 0; i < (version.startsWith('4.3') ? 9 : 7); i++) w.varint(0)
  }
  return w.buffer()
}

function json(version: string, mesh: boolean): Record<string, unknown> {
  return {
    skeleton: { spine: version, x: 0, y: 0, width: 200, height: 200, referenceScale: 100 },
    bones: [{ name: 'root' }, { name: 'child', parent: 'root', rotation: 30, x: 10, y: 20, length: 5 }],
    slots: [{ name: 'slot', bone: 'child', attachment: 'image', color: 'ffffffff', blend: 'normal' }],
    skins: [{ name: 'default', attachments: { slot: { image: mesh
      ? { type: 'mesh', path: 'image', color: 'ffffffff', hull: 3,
        vertices: [0, 0, 20, 0, 0, 20], uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2], width: 0, height: 0 }
      : { type: 'region', path: 'image', color: 'ffffffff', x: 3, y: 4,
        rotation: 0, scaleX: 1, scaleY: 1, width: 20, height: 40 } } } }],
    animations: {},
  }
}

describe.each(['4.2.33', '4.3.75-beta'])('official binary %s', (version) => {
  it('matches same-source transform constraint JSON', () => {
    const expectedDoc = json(version, false)
    const transform = { name: 'follow', order: 0, bones: ['child'], target: 'root',
      mixRotate: 0.5, mixX: 0.25, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 }
    if (version.startsWith('4.3')) expectedDoc.constraints = [{ type: 'transform', ...transform, source: 'root' }]
    else expectedDoc.transform = [transform]
    const actual = importSpineBinary(official(version, false, false, false, 0, true))
    const expected = importSpine(expectedDoc)
    expect(actual.constraints).toEqual(expected.constraints)
  })

  it('matches same-source IK constraint JSON', () => {
    const expectedDoc = json(version, false)
    const ik = { name: 'aim', order: 0, bones: ['child'], target: 'root', mix: 0.75, bendPositive: true }
    if (version.startsWith('4.3')) expectedDoc.constraints = [{ type: 'ik', ...ik, softness: 0, compress: false, stretch: false }]
    else expectedDoc.ik = [ik]
    const actual = importSpineBinary(official(version, false, false, true))
    const expected = importSpine(expectedDoc)
    expect(actual.constraints).toEqual(expected.constraints)
  })

  it.each([false, true])('matches setup pose and %s attachment JSON', (mesh) => {
    const binary = importSpineBinary(official(version, mesh))
    const expected = importSpine(json(version, mesh))
    expect(binary.report.errors).toBe(0)
    expect(binary.skeleton.parent).toEqual(expected.skeleton.parent)
    for (let i = 0; i < binary.skeleton.count; i++) {
      const a = binary.skeleton.bones[i]!.setup
      const b = expected.skeleton.bones[i]!.setup
      for (const key of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'] as const) {
        expect(Math.abs(a[key] - b[key])).toBeLessThanOrEqual(1e-4)
      }
    }
    const left = binary.skins.get('default')!.attachments.get('image')!
    const right = expected.skins.get('default')!.attachments.get('image')!
    expect(left.kind).toBe(right.kind)
    expect(binary.hash).toBe(expected.hash)
  })
})

describe.each(['4.2.33', '4.3.75-beta'])('official animation %s', (version) => {
  it.each([false, true])('matches same-source JSON bone and slot timelines (bezier=%s)', (bezier) => {
    const expectedDoc = json(version, false)
    expectedDoc.animations = { idle: {
      slots: { slot: { attachment: [{ time: 0, name: 'image' }, { time: 0.5, name: null }] } },
      bones: { child: {
        rotate: [{ time: 0, value: 0, curve: bezier ? [0.25, 10, 0.75, 35] : 'stepped' }, { time: 1, value: 45 }],
        translate: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 8, y: 6 }],
      } },
    } }
    const actual = importSpineBinary(official(version, false, true, false, 0, false, bezier))
    const expected = importSpine(expectedDoc)
    expect(actual.report.errors).toBe(0)
    expect(actual.animations.get('idle')).toEqual(expected.animations.get('idle'))
  })
})

const official43Sample = process.env.SPINE_BINARY_SAMPLE_43
;(official43Sample ? it : it.skip)('matches real upstream 4.3 Spineboy binary and JSON setup pose', () => {
  const bytes = readFileSync(official43Sample!)
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const jsonPath = resolve(process.cwd(), '../../test/fixtures/spine/spineboy/spineboy-pro.json')
  const actual = importSpineBinary(buffer)
  const expected = importSpine(JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>)
  expect(actual.report.errors).toBe(0)
  expect(actual.skeleton.count).toBe(expected.skeleton.count)
  expect(actual.skeleton.parent).toEqual(expected.skeleton.parent)
  expect([...actual.animations.keys()]).toEqual([...expected.animations.keys()])
  for (const [name, clip] of expected.animations) {
    const binary = actual.animations.get(name)!
    expect(binary.duration).toBeCloseTo(clip.duration, 4)
    expect(binary.timelines.map(t => `${t.kind}:${t.path}`)).toEqual(clip.timelines.map(t => `${t.kind}:${t.path}`))
    for (let t = 0; t < clip.timelines.length; t++) {
      const source = clip.timelines[t]!
      const decoded = binary.timelines[t]!
      if ('keys' in source && 'keys' in decoded) {
        expect(decoded.keys.length).toBe(source.keys.length)
        for (let k = 0; k < source.keys.length; k++) {
          const sourceKey = source.keys[k]! as unknown as Record<string, unknown>
          const decodedKey = decoded.keys[k]! as unknown as Record<string, unknown>
          expect(decodedKey.time).toBeCloseTo(sourceKey.time as number, 4)
          for (const field of ['value', 'x', 'y'] as const) {
            if (typeof sourceKey[field] === 'number' && typeof decodedKey[field] === 'number') {
              expect(Math.abs((decodedKey[field] as number) - (sourceKey[field] as number))).toBeLessThanOrEqual(1e-3)
            }
          }
        }
      }
    }
  }
  expect(actual.events.length).toBe(expected.events.length)
  for (let i = 0; i < actual.skeleton.count; i++) {
    const a = actual.skeleton.bones[i]!.setup, b = expected.skeleton.bones[i]!.setup
    for (const key of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'] as const) {
      expect(Math.abs(a[key] - b[key])).toBeLessThanOrEqual(1e-4)
    }
  }
  for (const [skinName, skin] of expected.skins) {
    const imported = actual.skins.get(skinName)
    expect(imported).toBeDefined()
    for (const [attachmentName, attachment] of skin.attachments) {
      const binary = imported!.attachments.get(attachmentName)
      expect(binary?.kind).toBe(attachment.kind)
      if (attachment.kind === 'mesh' && binary?.kind === 'mesh') {
        expect(binary.mesh.positions.length).toBe(attachment.mesh.positions.length)
        binary.mesh.positions.forEach((position, i) => {
          expect(Math.abs(position - attachment.mesh.positions[i]!)).toBeLessThanOrEqual(1e-4)
        })
      }
    }
  }
})

it('rejects unknown official versions and unsupported timeline streams explicitly', () => {
  expect(() => importSpineBinary(official('4.4.0'))).toThrow(/E_SPINE_VERSION/)
  expect(() => importSpineBinary(official('4.3.75-beta', false, true, false, 6)))
    .toThrow(/E_BINARY_UNSUPPORTED.*slot timeline/)
})
