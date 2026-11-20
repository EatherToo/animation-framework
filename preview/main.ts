import { BONE_NAMES, createHumanoid, type BoneId } from '@animation-framework/render-engine/body'
import { compileHumanoid, type CompiledRig } from '@animation-framework/render-engine/compile'
import { evaluateFk } from '@animation-framework/render-engine/fk'
import { fillProjected } from '@animation-framework/render-engine/fill'
import { sampleTexture, textureProjected, triangleUv, type TexturedPart } from '@animation-framework/render-engine/texture'
import {
  createPose,
  setPoseRotation,
  setPoseSwing,
  setPoseTwist,
  type Pose,
} from '@animation-framework/render-engine/skeleton'
import { skinMesh } from '@animation-framework/render-engine/skin'
import { drawOrder } from '@animation-framework/render-engine/slot'
import { strokeContours, type StrokePart } from '@animation-framework/render-engine/stroke'
import { depthOrder, projectParts, type ProjectedPart, type ViewSource } from '@animation-framework/render-engine/view'
import { beginFrame, flatTriangle, shadedTriangle, type Surface } from './raster'

const HEIGHT = 1.8
const FRONT_VIEW = 90
const FACING = 1
const BACKGROUND = '#5c5c5c'
const STEP = 5

type Axis = 'rotation' | 'swing' | 'twist'

type Control = {
  readonly id: string
  readonly bone: BoneId
  readonly axis: Axis
  readonly group: string
  readonly label: string
  readonly min: number
  readonly max: number
}

const BONE_UI: Record<BoneId, { group: string; label: string }> = {
  pelvis: { group: '躯干', label: '骨盆' },
  spine: { group: '躯干', label: '脊柱' },
  chest: { group: '躯干', label: '胸' },
  neck: { group: '躯干', label: '颈' },
  head: { group: '躯干', label: '头' },
  upperArmL: { group: '左臂', label: '上臂' },
  lowerArmL: { group: '左臂', label: '肘' },
  handL: { group: '左臂', label: '手' },
  upperArmR: { group: '右臂', label: '上臂' },
  lowerArmR: { group: '右臂', label: '肘' },
  handR: { group: '右臂', label: '手' },
  thighL: { group: '左腿', label: '髋' },
  shinL: { group: '左腿', label: '膝' },
  footL: { group: '左腿', label: '脚' },
  thighR: { group: '右腿', label: '髋' },
  shinR: { group: '右腿', label: '膝' },
  footR: { group: '右腿', label: '脚' },
}

const AXIS_LABEL: Record<Axis, string> = {
  rotation: '矢状',
  swing: '侧摆',
  twist: '扭转',
}

const canvas = document.querySelector<HTMLCanvasElement>('#view')
const panel = document.querySelector<HTMLElement>('#pose')
if (canvas === null || panel === null) throw new Error('view')
const ctx = canvas.getContext('2d')
if (ctx === null) throw new Error('2d')

const humanoid = createHumanoid(HEIGHT)
const compiled = compileHumanoid(humanoid)
const pose = createPose(humanoid.skeleton)
const fk = new Float32Array(humanoid.skeleton.boneCount * 12)
const controls = buildControls(compiled)
const tie = drawOrder(new Array<string>(compiled.slots.slots.length), compiled.slots, FACING)
const restFrame = contain(projectParts(sample(compiled, pose, fk), FRONT_VIEW))
const sliders = new Map<string, HTMLInputElement>()
const readouts = new Map<string, HTMLElement>()

mountPose(panel)
new ResizeObserver(() => draw()).observe(canvas.parentElement ?? canvas)
void loadGrayTextures()
  .then(() => {
    texturesReady = true
    draw()
  })
  .catch((error: unknown) => showLoadError(error))

function showLoadError(error: unknown): void {
  const stage = canvas!.parentElement
  if (stage === null) return
  const note = document.createElement('pre')
  note.className = 'error'
  note.textContent =
    `${error instanceof Error ? error.message : String(error)}\n\n` +
    '纹理是按网格逐三角形生成的。先重建：pnpm --dir preview run build（或分步 build:engine / textures / bundle）。'
  stage.append(note)
}

function mountPose(root: HTMLElement): void {
  const title = document.createElement('h1')
  title.textContent = '姿势'
  const note = document.createElement('p')
  note.className = 'note'
  note.textContent =
    '0° 是绑定站姿。未锁死的轴各有一个滑块。矢状正角逆时针，肘朝前弯，膝朝后弯。侧摆正值让手臂和腿离开躯干。骨盆三轴用 ±45°，其余滑块用引擎的活动范围。'
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.className = 'reset'
  reset.textContent = '复位到 0°'
  reset.addEventListener('click', () => {
    for (const control of controls) {
      const slider = sliders.get(control.id)
      if (slider === undefined) continue
      slider.value = '0'
      writeReadout(control)
    }
    draw()
  })
  root.append(title, note, reset)

  let group = ''
  for (const control of controls) {
    if (control.group !== group) {
      group = control.group
      const heading = document.createElement('h2')
      heading.textContent = group
      root.append(heading)
    }
    const row = document.createElement('div')
    row.className = 'joint'
    const name = document.createElement('span')
    name.textContent = control.label
    const down = document.createElement('button')
    down.type = 'button'
    down.textContent = '−'
    down.setAttribute('aria-label', `${control.group}${control.label}减 ${STEP} 度`)
    const up = document.createElement('button')
    up.type = 'button'
    up.textContent = '+'
    up.setAttribute('aria-label', `${control.group}${control.label}加 ${STEP} 度`)
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = String(control.min)
    slider.max = String(control.max)
    slider.step = '1'
    slider.value = '0'
    slider.setAttribute('aria-label', `${control.group}${control.label}`)
    const range = document.createElement('div')
    range.className = 'range'
    row.append(name, down, slider, up, range)
    root.append(row)
    sliders.set(control.id, slider)
    readouts.set(control.id, range)
    const apply = (): void => {
      writeReadout(control)
      draw()
    }
    slider.addEventListener('input', apply)
    down.addEventListener('click', () => nudge(control, -STEP))
    up.addEventListener('click', () => nudge(control, STEP))
    writeReadout(control)
  }
}

function nudge(control: Control, delta: number): void {
  const slider = sliders.get(control.id)
  if (slider === undefined) return
  const next = Math.min(control.max, Math.max(control.min, Number(slider.value) + delta))
  slider.value = String(next)
  writeReadout(control)
  draw()
}

function writeReadout(control: Control): void {
  const readout = readouts.get(control.id)
  const slider = sliders.get(control.id)
  if (readout === undefined || slider === undefined) return
  readout.textContent = `${formatDeg(Number(slider.value))} · 可活动 ${formatDeg(control.min)} ~ ${formatDeg(control.max)}`
}

let texturesReady = false

type InstalledTexture = {
  readonly width: number
  readonly height: number
  readonly rgb: Uint8Array
}

async function loadGrayTextures(): Promise<void> {
  const response = await fetch('./textures/manifest.json')
  if (!response.ok) throw new Error('texture')
  const manifest = (await response.json()) as {
    parts: readonly { partId: string; count: number }[]
  }
  const byId = new Map(compiled.meshes.meshes.map((mesh) => [mesh.partId, mesh]))
  const jobs: { partId: string; index: number }[] = []
  for (const part of manifest.parts) {
    const mesh = byId.get(part.partId)
    if (mesh === undefined) throw new Error(`纹理清单里有未知部件：${part.partId}`)
    const triangles = mesh.indices.length / 3
    if (triangles !== part.count) {
      throw new Error(
        `纹理与网格对不上：${part.partId} 清单 ${part.count} 张，网格 ${triangles} 个三角形`,
      )
    }
    for (let index = 0; index < part.count; index += 1) jobs.push({ partId: part.partId, index })
  }
  const decoded = new Map<string, InstalledTexture[]>()
  for (const part of manifest.parts) decoded.set(part.partId, new Array(part.count))
  const scratch = document.createElement('canvas')
  const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })
  if (scratchCtx === null) throw new Error('2d')
  const batch = 24
  for (let start = 0; start < jobs.length; start += batch) {
    const slice = jobs.slice(start, start + batch)
    const bitmaps = await Promise.all(
      slice.map(async (job) => {
        const image = await fetch(`./textures/${job.partId}/${job.index}.png`)
        if (!image.ok) throw new Error('texture')
        return createImageBitmap(await image.blob())
      }),
    )
    for (let i = 0; i < slice.length; i += 1) {
      const bitmap = bitmaps[i]!
      const job = slice[i]!
      if (scratch.width !== bitmap.width || scratch.height !== bitmap.height) {
        scratch.width = bitmap.width
        scratch.height = bitmap.height
      }
      scratchCtx.drawImage(bitmap, 0, 0)
      const pixels = scratchCtx.getImageData(0, 0, bitmap.width, bitmap.height).data
      const rgb = new Uint8Array(bitmap.width * bitmap.height * 3)
      for (let pixel = 0; pixel < bitmap.width * bitmap.height; pixel += 1) {
        rgb[pixel * 3] = pixels[pixel * 4]!
        rgb[pixel * 3 + 1] = pixels[pixel * 4 + 1]!
        rgb[pixel * 3 + 2] = pixels[pixel * 4 + 2]!
      }
      decoded.get(job.partId)![job.index] = { width: bitmap.width, height: bitmap.height, rgb }
      bitmap.close()
    }
  }
  for (const part of manifest.parts) {
    const textures = decoded.get(part.partId)!
    ;(byId.get(part.partId) as unknown as { textures: InstalledTexture[] }).textures = textures
  }
}

/** 描边相对所属表面的深度偏置，让它压在自己的面上、又压不过更近的部件。 */
const DEPTH_BIAS = 1e-4
const VIEW_ANGLE = (FRONT_VIEW * Math.PI) / 180
const VIEW_COS = Math.cos(VIEW_ANGLE)
const VIEW_SIN = Math.sin(VIEW_ANGLE)
const STROKE_RGB = [20, 20, 20] as const
const BACKGROUND_RGB = [92, 92, 92] as const

function draw(): void {
  if (!texturesReady) return
  const stage = canvas!.parentElement
  const cssWidth = stage?.clientWidth ?? window.innerWidth
  const cssHeight = stage?.clientHeight ?? window.innerHeight
  if (cssWidth < 2 || cssHeight < 2) return
  const dpr = window.devicePixelRatio || 1
  const width = Math.max(1, Math.round(cssWidth * dpr))
  const height = Math.max(1, Math.round(cssHeight * dpr))
  canvas!.width = width
  canvas!.height = height
  canvas!.style.width = `${cssWidth}px`
  canvas!.style.height = `${cssHeight}px`

  applyPose()
  const sampled = sample(compiled, pose, fk)
  const projected = projectParts(sampled, FRONT_VIEW)
  const filled = fillProjected(
    projected,
    compiled.parts.parts.map((part) => part.fill),
  )
  const textured = textureProjected(compiled, projected)
  const stroked = strokeContours(filled, true)
  const order = depthOrder(new Array<string>(projected.length), projected, tie)
  const frame = framing(projected, width, height)
  const depths = sampled.map((part) => vertexDepths(part.positions))
  const rawIndices = sampled.map((part) => part.indices)
  const partIndex = new Map(projected.map((part, index) => [part.partId, index]))

  const image = ctx!.getImageData(0, 0, width, height)
  const surface = beginFrame(width, height, image.data, BACKGROUND_RGB)
  paintTextures(textured, order, frame, surface, depths, rawIndices, partIndex)
  paintStrokes(stroked, order, frame, surface, projected, depths, partIndex)
  ctx!.putImageData(image, 0, 0)
}

/** 每个顶点的视图深度，越大越远；与 36 的正交投影用同一条公式。 */
function vertexDepths(positions: Float32Array): Float32Array {
  const out = new Float32Array(positions.length / 3)
  for (let v = 0; v < out.length; v += 1) {
    const x = positions[v * 3]!
    const z = positions[v * 3 + 2]!
    out[v] = z * VIEW_COS - x * VIEW_SIN
  }
  return out
}

function paintTextures(
  parts: readonly TexturedPart[],
  order: readonly string[],
  frame: Frame,
  surface: Surface,
  depths: readonly Float32Array[],
  rawIndices: readonly Uint16Array[],
  partIndex: ReadonlyMap<string, number>,
): void {
  const uv = new Float32Array(2)
  const corners = new Float32Array(6)
  const byId = new Map(parts.map((part) => [part.partId, part]))
  for (let oi = 0; oi < order.length; oi += 1) {
    const id = order[oi]!
    const part = byId.get(id)
    if (part === undefined || part.textures.length === 0) continue
    const index = partIndex.get(id)
    if (index === undefined) continue
    const partDepth = depths[index]!
    const raw = rawIndices[index]!
    const positions = part.positions
    const indices = part.indices
    for (let t = 0; t < indices.length; t += 3) {
      if (backFacing(positions, raw, t)) continue
      const ia = indices[t]!
      const ib = indices[t + 1]!
      const ic = indices[t + 2]!
      const ax = frame.originX + positions[ia * 2]! * frame.scale
      const ay = frame.originY - positions[ia * 2 + 1]! * frame.scale
      const bx = frame.originX + positions[ib * 2]! * frame.scale
      const by = frame.originY - positions[ib * 2 + 1]! * frame.scale
      const cx = frame.originX + positions[ic * 2]! * frame.scale
      const cy = frame.originY - positions[ic * 2 + 1]! * frame.scale
      const texture = part.textures[part.triangleTexture[t / 3]!]
      if (texture === undefined) continue
      corners.set(part.uvs.subarray(t * 2, t * 2 + 6))
      shadedTriangle(
        surface,
        [ax, ay, bx, by, cx, cy],
        [partDepth[ia]!, partDepth[ib]!, partDepth[ic]!],
        (px, py) => {
          triangleUv(uv, ax, ay, bx, by, cx, cy, px, py, corners)
          const color = sampleTexture(texture, uv[0]!, uv[1]!)
          return [Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255)]
        },
      )
    }
  }
}

/** 用原始索引判朝向：`indices` 已被 36 翻成逆时针，不能用来判断正反面。 */
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

function paintStrokes(
  parts: readonly StrokePart[],
  order: readonly string[],
  frame: Frame,
  surface: Surface,
  projected: readonly ProjectedPart[],
  depths: readonly Float32Array[],
  partIndex: ReadonlyMap<string, number>,
): void {
  const byId = new Map(parts.map((part) => [part.partId, part]))
  for (let oi = 0; oi < order.length; oi += 1) {
    const id = order[oi]!
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
      flatTriangle(surface, [p0[0], p0[1], p1[0], p1[1], p2[0], p2[1]], z, STROKE_RGB)
      flatTriangle(surface, [p3[0], p3[1], p4[0], p4[1], p5[0], p5[1]], z, STROKE_RGB)
    }
  }
}

/** 描边四边形的深度：取离它最近的投影顶点，近似这条边的远近。 */
function quadDepth(
  quad: Float32Array,
  screen: Float32Array,
  partDepth: Float32Array,
): number {
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

/** 取景：按当前姿态收框，但最多放大到绑定姿态的比例，避免姿态收拢时被放大。 */
function framing(parts: readonly ProjectedPart[], width: number, height: number): Frame {
  const current = fit(contain(parts), width, height)
  const baseline = fit(restFrame, width, height)
  const scale = Math.min(current.scale, baseline.scale)
  const cx = (restFrame.minX + restFrame.maxX) / 2
  const cy = (restFrame.minY + restFrame.maxY) / 2
  return {
    ...restFrame,
    scale,
    originX: width / 2 - cx * scale,
    originY: height / 2 + cy * scale,
  }
}

function applyPose(): void {
  for (const control of controls) {
    const slider = sliders.get(control.id)
    const radians = ((slider === undefined ? 0 : Number(slider.value)) * Math.PI) / 180
    const bone = humanoid.boneIndex[control.bone]
    if (control.axis === 'rotation') setPoseRotation(pose, bone, radians)
    else if (control.axis === 'swing') setPoseSwing(pose, bone, radians)
    else setPoseTwist(pose, bone, radians)
  }
}

function sample(rig: CompiledRig, current: Pose, rigFromBone: Float32Array): ViewSource[] {
  evaluateFk(rigFromBone, rig, current, rig.skeleton.boneCount)
  return rig.meshes.meshes.map((mesh, index) => {
    const positions = new Float32Array(mesh.positions.length)
    skinMesh(positions, rig, rigFromBone, index, current)
    return { partId: mesh.partId, positions, indices: mesh.indices, seam: mesh.seam }
  })
}

function buildControls(rig: CompiledRig): Control[] {
  const list: Control[] = []
  for (const joint of rig.joints) {
    const bone = BONE_NAMES[joint.bone]
    if (bone === undefined) continue
    const ui = BONE_UI[bone]
    addAxis(list, bone, ui, 'rotation', 1, joint.rotation)
    addAxis(list, bone, ui, 'swing', joint.swingSign, joint.swing)
    addAxis(list, bone, ui, 'twist', joint.twistSign, joint.twist)
  }
  return list
}

function addAxis(
  list: Control[],
  bone: BoneId,
  ui: { group: string; label: string },
  axis: Axis,
  sign: -1 | 0 | 1,
  limit: { min: number; max: number } | null,
): void {
  if (axis !== 'rotation' && sign === 0) return
  const span = limit === null ? { min: -45, max: 45 } : { min: degrees(limit.min), max: degrees(limit.max) }
  list.push({
    id: `${bone}:${axis}`,
    bone,
    axis,
    group: ui.group,
    label: `${ui.label} · ${AXIS_LABEL[axis]}`,
    min: span.min,
    max: span.max,
  })
}

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type Frame = Bounds & { scale: number; originX: number; originY: number }

function contain(parts: readonly ProjectedPart[]): Bounds {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let p = 0; p < parts.length; p += 1) {
    const positions = parts[p]!.positions
    for (let i = 0; i < positions.length; i += 2) {
      const x = positions[i]!
      const y = positions[i + 1]!
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  const spanX = Math.max(1e-4, maxX - minX)
  const spanY = Math.max(1e-4, maxY - minY)
  return {
    minX: minX - spanX * 0.12,
    maxX: maxX + spanX * 0.12,
    minY: minY - spanY * 0.06,
    maxY: maxY + spanY * 0.06,
  }
}

function fit(bounds: Bounds, width: number, height: number): Frame {
  const scale = Math.min(width / (bounds.maxX - bounds.minX), height / (bounds.maxY - bounds.minY))
  const usedW = (bounds.maxX - bounds.minX) * scale
  const usedH = (bounds.maxY - bounds.minY) * scale
  return {
    ...bounds,
    scale,
    originX: (width - usedW) / 2 - bounds.minX * scale,
    originY: (height - usedH) / 2 + bounds.maxY * scale,
  }
}

function degrees(radians: number): number {
  return Math.round((radians * 180) / Math.PI)
}

function formatDeg(value: number): string {
  if (value < 0) return `−${Math.abs(value)}°`
  if (value > 0) return `+${value}°`
  return '0°'
}
