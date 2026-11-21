// @ts-nocheck -- 离线验收脚本；用 esbuild 打包后由 Node 执行，不参与页面构建。
/**
 * 离线出图：用与 preview 页面相同的投影、填充、描边和逐像素深度，
 * 把「抬 90° 直臂」「抬 90° + 弯肘 100°」两个姿态各出一张侧视图与正视图。
 *
 * 只用于验收，不参与页面构建。运行：
 *   ./node_modules/.bin/esbuild preview/render-poses.ts --bundle --platform=node --format=esm --outfile=.tmp/render-poses.mjs
 *   node .tmp/render-poses.mjs
 *
 * 输出：preview/poses/*.png
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { applyClavicleFollow, createHumanoid } from '@animation-framework/render-engine/body'
import { compileHumanoid, type CompiledRig } from '@animation-framework/render-engine/compile'
import { evaluateFk } from '@animation-framework/render-engine/fk'
import { fillProjected, type FilledPart } from '@animation-framework/render-engine/fill'
import { isArmPart } from '@animation-framework/render-engine/outline'
import { createPose, findBone, setPoseRotation, setPoseSwing, type Pose } from '@animation-framework/render-engine/skeleton'
import { armOutlineBones, skinMesh } from '@animation-framework/render-engine/skin'
import { drawOrder } from '@animation-framework/render-engine/slot'
import { strokeContours, type StrokePart } from '@animation-framework/render-engine/stroke'
import {
  depthOrder,
  projectParts,
  type ProjectedPart,
  type ViewIndex,
  type ViewSource,
} from '@animation-framework/render-engine/view'
import { beginFrame, flatTriangle, shadedTriangle, type Surface } from './raster'

const HEIGHT = 1.8
const WIDTH = 900
const HEIGHT_PX = 1100
const BACKGROUND: readonly [number, number, number] = [92, 92, 92]
const STROKE: readonly [number, number, number] = [20, 20, 20]
const DEPTH_BIAS = 1e-4

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

type PoseSpec = {
  readonly name: string
  readonly view: ViewIndex
  readonly label: string
  /** 取景只框左臂，用来做「一条手臂」的效果检查。 */
  readonly armCloseUp?: boolean
  /** 只画左臂和左手，用来检查腕部几何是否真的接上。 */
  readonly limbOnly?: boolean
  readonly apply: (pose: Pose, compiled: CompiledRig) => void
}

const POSES: readonly PoseSpec[] = [
  {
    name: 'side-raise90',
    view: 0,
    label: '侧视 · 抬臂 90° 直臂',
    apply: (pose, compiled) => {
      setPoseRotation(pose, findBone(compiled.skeleton, 'upperArmL'), Math.PI / 2)
    },
  },
  {
    name: 'side-raise90-elbow100',
    view: 0,
    label: '侧视 · 抬臂 90° + 弯肘 100°',
    apply: (pose, compiled) => {
      setPoseRotation(pose, findBone(compiled.skeleton, 'upperArmL'), Math.PI / 2)
      setPoseRotation(pose, findBone(compiled.skeleton, 'lowerArmL'), (100 * Math.PI) / 180)
    },
  },
  {
    name: 'front-swing90',
    view: 90,
    label: '正视 · 侧摆 90° 直臂',
    apply: (pose, compiled) => {
      setPoseSwing(pose, findBone(compiled.skeleton, 'upperArmL'), Math.PI / 2)
    },
  },
  {
    name: 'front-swing90-elbow100',
    view: 90,
    label: '正视 · 侧摆 90° + 弯肘 100°',
    apply: (pose, compiled) => {
      setPoseSwing(pose, findBone(compiled.skeleton, 'upperArmL'), Math.PI / 2)
      setPoseRotation(pose, findBone(compiled.skeleton, 'lowerArmL'), (100 * Math.PI) / 180)
    },
  },
  {
    name: 'front-wrist45',
    view: 90,
    label: '正视 · 腕屈 45°',
    apply: (pose, compiled) => {
      setPoseRotation(pose, findBone(compiled.skeleton, 'handL'), Math.PI / 4)
    },
  },
  {
    name: 'limb-front-wrist45',
    view: 90,
    label: '仅左臂 · 正视腕屈 45°',
    limbOnly: true,
    apply: (pose, compiled) => {
      setPoseRotation(pose, findBone(compiled.skeleton, 'handL'), Math.PI / 4)
    },
  },
  {
    name: 'limb-side-wrist45',
    view: 0,
    label: '仅左臂 · 腕屈 45°',
    limbOnly: true,
    apply: (pose, compiled) => {
      setPoseRotation(pose, findBone(compiled.skeleton, 'handL'), Math.PI / 4)
    },
  },
  {
    name: 'limb-side-elbow100-wrist45',
    view: 0,
    label: '仅左臂 · 抬臂 90° + 弯肘 100° + 腕屈 45°',
    limbOnly: true,
    apply: (pose, compiled) => {
      setPoseRotation(pose, findBone(compiled.skeleton, 'upperArmL'), Math.PI / 2)
      setPoseRotation(pose, findBone(compiled.skeleton, 'lowerArmL'), (100 * Math.PI) / 180)
      setPoseRotation(pose, findBone(compiled.skeleton, 'handL'), Math.PI / 4)
    },
  },
  {
    name: 'side-wrist45',
    view: 0,
    label: '侧视 · 腕屈 45°',
    apply: (pose, compiled) => {
      setPoseRotation(pose, findBone(compiled.skeleton, 'handL'), Math.PI / 4)
    },
  },
  {
    name: 'side-elbow100-wrist45',
    view: 0,
    label: '侧视 · 抬臂 90° + 弯肘 100° + 腕屈 45°',
    apply: (pose, compiled) => {
      setPoseRotation(pose, findBone(compiled.skeleton, 'upperArmL'), Math.PI / 2)
      setPoseRotation(pose, findBone(compiled.skeleton, 'lowerArmL'), (100 * Math.PI) / 180)
      setPoseRotation(pose, findBone(compiled.skeleton, 'handL'), Math.PI / 4)
    },
  },
  {
    name: 'one-arm-side-raise90',
    view: 0,
    label: '单臂特写 · 侧视抬臂 90°',
    armCloseUp: true,
    apply: (pose, compiled) => {
      setPoseRotation(pose, findBone(compiled.skeleton, 'upperArmL'), Math.PI / 2)
    },
  },
  {
    name: 'one-arm-side-raise90-elbow100',
    view: 0,
    label: '单臂特写 · 侧视抬臂 90° + 弯肘 100°',
    armCloseUp: true,
    apply: (pose, compiled) => {
      setPoseRotation(pose, findBone(compiled.skeleton, 'upperArmL'), Math.PI / 2)
      setPoseRotation(pose, findBone(compiled.skeleton, 'lowerArmL'), (100 * Math.PI) / 180)
    },
  },
]

const humanoid = createHumanoid(HEIGHT)
const compiled = compileHumanoid(humanoid)
const fk = new Float32Array(compiled.skeleton.boneCount * 12)
const outDir = join(process.cwd(), 'preview', 'poses')
mkdirSync(outDir, { recursive: true })

for (const spec of POSES) {
  const pixels = drawPose(compiled, spec)
  const file = join(outDir, `${spec.name}.png`)
  writeFileSync(file, png(WIDTH, HEIGHT_PX, pixels))
  console.log(`已出图：${file}（${spec.label}）`)
}

function drawPose(rig: CompiledRig, spec: PoseSpec): Uint8ClampedArray {
  const pose = createPose(rig.skeleton)
  spec.apply(pose, rig)
  applyClavicleFollow(pose, rig)
  const sampledAll = sample(rig, pose)
  const keep = spec.limbOnly
    ? (partId: string): boolean => partId === 'armL' || partId === 'handL'
    : (): boolean => true
  const sampled = sampledAll.filter((part) => keep(part.partId))
  const projected = projectParts(sampled, spec.view)
  const filled = fillProjected(
    projected,
    rig.parts.parts.filter((part) => keep(part.id)).map((part) => part.fill),
  )
  const stroked = strokeContours(filled, true)
  const order = depthOrder(
    new Array<string>(projected.length),
    projected,
    drawOrder(new Array<string>(rig.slots.slots.length), rig.slots, 1),
  )
  const frame = framing(
    spec.armCloseUp
      ? projected.filter((part) => part.partId === 'armL')
      : spec.limbOnly
        ? projected
        : projected,
  )
  const depths = sampled.map((part, index) => projected[index]!.depths ?? vertexDepths(part.positions, spec.view))
  const raw = sampled.map((part) => part.indices)
  const partIndex = new Map(projected.map((part, index) => [part.partId, index]))
  const surface = beginFrame(WIDTH, HEIGHT_PX, new Uint8ClampedArray(WIDTH * HEIGHT_PX * 4), BACKGROUND)
  paintFills(surface, filled, order, frame, depths, raw, partIndex)
  paintStrokes(surface, stroked, order, frame, projected, depths, partIndex)
  return surface.pixels
}

function sample(rig: CompiledRig, pose: Pose): ViewSource[] {
  evaluateFk(fk, rig, pose, rig.skeleton.boneCount)
  return rig.meshes.meshes.map((mesh, index) => {
    const positions = new Float32Array(mesh.positions.length)
    skinMesh(positions, rig, fk, index, pose)
    if (!isArmPart(mesh.partId)) {
      return { partId: mesh.partId, positions, indices: mesh.indices, seam: mesh.seam }
    }
    return {
      partId: mesh.partId,
      positions,
      indices: mesh.indices,
      seam: mesh.seam,
      arm: armOutlineBones(rig, fk, mesh.partId),
    }
  })
}

type Frame = {
  readonly scale: number
  readonly originX: number
  readonly originY: number
}

function framing(parts: readonly ProjectedPart[]): Frame {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const part of parts) {
    for (let i = 0; i < part.positions.length; i += 2) {
      minX = Math.min(minX, part.positions[i]!)
      maxX = Math.max(maxX, part.positions[i]!)
      minY = Math.min(minY, part.positions[i + 1]!)
      maxY = Math.max(maxY, part.positions[i + 1]!)
    }
  }
  const spanX = Math.max(1e-4, maxX - minX)
  const spanY = Math.max(1e-4, maxY - minY)
  minX -= spanX * 0.12
  maxX += spanX * 0.12
  minY -= spanY * 0.06
  maxY += spanY * 0.06
  const scale = Math.min(WIDTH / (maxX - minX), HEIGHT_PX / (maxY - minY))
  return {
    scale,
    originX: (WIDTH - (maxX - minX) * scale) / 2 - minX * scale,
    originY: (HEIGHT_PX - (maxY - minY) * scale) / 2 + maxY * scale,
  }
}

function paintFills(
  surface: Surface,
  parts: readonly FilledPart[],
  order: readonly string[],
  frame: Frame,
  depths: readonly Float32Array[],
  rawIndices: readonly Uint16Array[],
  partIndex: ReadonlyMap<string, number>,
): void {
  const byId = new Map(parts.map((part) => [part.partId, part]))
  for (const id of order) {
    const part = byId.get(id)
    if (part === undefined) continue
    const index = partIndex.get(id)
    if (index === undefined) continue
    const depth = depths[index]!
    const raw = rawIndices[index]!
    const positions = part.positions
    const indices = part.indices
    const color: readonly [number, number, number] = [
      Math.round(part.fill.r * 255),
      Math.round(part.fill.g * 255),
      Math.round(part.fill.b * 255),
    ]
    for (let t = 0; t < indices.length; t += 3) {
      if (!isArmPart(part.partId) && backFacing(positions, raw, t)) continue
      const ia = indices[t]!
      const ib = indices[t + 1]!
      const ic = indices[t + 2]!
      shadedTriangle(
        surface,
        [
          frame.originX + positions[ia * 2]! * frame.scale,
          frame.originY - positions[ia * 2 + 1]! * frame.scale,
          frame.originX + positions[ib * 2]! * frame.scale,
          frame.originY - positions[ib * 2 + 1]! * frame.scale,
          frame.originX + positions[ic * 2]! * frame.scale,
          frame.originY - positions[ic * 2 + 1]! * frame.scale,
        ],
        [depth[ia]!, depth[ib]!, depth[ic]!],
        () => color,
      )
    }
  }
}

function paintStrokes(
  surface: Surface,
  parts: readonly StrokePart[],
  order: readonly string[],
  frame: Frame,
  projected: readonly ProjectedPart[],
  depths: readonly Float32Array[],
  partIndex: ReadonlyMap<string, number>,
): void {
  const byId = new Map(parts.map((part) => [part.partId, part]))
  for (const id of order) {
    const part = byId.get(id)
    if (part === undefined) continue
    const index = partIndex.get(id)
    if (index === undefined) continue
    const screen = projected[index]!.positions
    const partDepth = depths[index]!
    for (const quad of part.quads) {
      const z = quadDepth(quad.positions, screen, partDepth) - DEPTH_BIAS
      const q = quad.indices
      const points = quad.positions
      const at = (i: number): [number, number] => [
        frame.originX + points[i * 2]! * frame.scale,
        frame.originY - points[i * 2 + 1]! * frame.scale,
      ]
      const p0 = at(q[0]!)
      const p1 = at(q[1]!)
      const p2 = at(q[2]!)
      const p3 = at(q[3]!)
      const p4 = at(q[4]!)
      const p5 = at(q[5]!)
      flatTriangle(surface, [p0[0], p0[1], p1[0], p1[1], p2[0], p2[1]], z, STROKE)
      flatTriangle(surface, [p3[0], p3[1], p4[0], p4[1], p5[0], p5[1]], z, STROKE)
    }
  }
}

function backFacing(positions: Float32Array, raw: Uint16Array, t: number): boolean {
  const a = raw[t]!
  const b = raw[t + 1]!
  const c = raw[t + 2]!
  const ax = positions[a * 2]!
  const ay = positions[a * 2 + 1]!
  const bx = positions[b * 2]!
  const by = positions[b * 2 + 1]!
  const cx = positions[c * 2]!
  const cy = positions[c * 2 + 1]!
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) <= 0
}

function vertexDepths(positions: Float32Array, view: ViewIndex): Float32Array {
  const psi = (view * Math.PI) / 180
  const sin = Math.sin(psi)
  const cos = Math.cos(psi)
  const out = new Float32Array(positions.length / 3)
  for (let v = 0; v < out.length; v += 1) {
    const x = positions[v * 3]!
    const z = positions[v * 3 + 2]!
    out[v] = z * cos - x * sin
  }
  return out
}

function quadDepth(quad: Float32Array, screen: Float32Array, partDepth: Float32Array): number {
  const cx = (quad[0]! + quad[4]!) / 2
  const cy = (quad[1]! + quad[5]!) / 2
  let best = Number.POSITIVE_INFINITY
  let depth = 0
  for (let v = 0; v < partDepth.length; v += 1) {
    const dx = screen[v * 2]! - cx
    const dy = screen[v * 2 + 1]! - cy
    const distance = dx * dx + dy * dy
    if (distance < best) {
      best = distance
      depth = partDepth[v]!
    }
  }
  return Number.isFinite(best) ? depth : 0
}

function png(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  let cursor = 0
  for (let y = 0; y < height; y += 1) {
    raw[cursor] = 0
    cursor += 1
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      raw[cursor] = rgba[i]!
      raw[cursor + 1] = rgba[i + 1]!
      raw[cursor + 2] = rgba[i + 2]!
      cursor += 3
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr(width, height)),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function ihdr(width: number, height: number): Buffer {
  const data = Buffer.alloc(13)
  data.writeUInt32BE(width, 0)
  data.writeUInt32BE(height, 4)
  data[8] = 8
  data[9] = 2
  return data
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
