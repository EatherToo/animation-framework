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

const HEIGHT = 1.8
const FRONT_VIEW = 90
const FACING = 1
const BACKGROUND = '#5c5c5c'
const STROKE = '#141414'
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
void loadGrayTextures().then(() => {
  texturesReady = true
  draw()
})

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
    if (mesh === undefined || mesh.indices.length / 3 !== part.count) throw new Error('texture')
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
    ;(byId.get(part.partId) as { textures: InstalledTexture[] }).textures = textures
  }
}

function draw(): void {
  if (!texturesReady) return
  const stage = canvas!.parentElement
  const cssWidth = stage?.clientWidth ?? window.innerWidth
  const cssHeight = stage?.clientHeight ?? window.innerHeight
  if (cssWidth < 2 || cssHeight < 2) return
  const dpr = window.devicePixelRatio || 1
  canvas!.width = Math.max(1, Math.round(cssWidth * dpr))
  canvas!.height = Math.max(1, Math.round(cssHeight * dpr))
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
  const frame = fit(restFrame, canvas!.width, canvas!.height)

  ctx!.setTransform(1, 0, 0, 1, 0, 0)
  ctx!.fillStyle = BACKGROUND
  ctx!.fillRect(0, 0, canvas!.width, canvas!.height)
  const pixels = ctx!.getImageData(0, 0, canvas!.width, canvas!.height)
  paintTextures(textured, order, frame, pixels)
  ctx!.putImageData(pixels, 0, 0)
  const byFill = new Map(filled.map((part) => [part.partId, part]))
  const byStroke = new Map(stroked.map((part) => [part.partId, part]))
  for (let i = 0; i < order.length; i += 1) {
    const id = order[i]!
    const part = byFill.get(id)
    if (part === undefined) continue
    const contour = byStroke.get(id)
    if (contour !== undefined) paintStroke(contour, frame)
  }
}

function paintTextures(
  parts: readonly TexturedPart[],
  order: readonly string[],
  frame: Frame,
  image: ImageData,
): void {
  const uv = new Float32Array(2)
  const corners = new Float32Array(6)
  const byId = new Map(parts.map((part) => [part.partId, part]))
  const width = image.width
  const height = image.height
  const data = image.data
  for (let i = 0; i < order.length; i += 1) {
    const part = byId.get(order[i]!)
    if (part === undefined || part.textures.length === 0) continue
    const positions = part.positions
    const indices = part.indices
    for (let t = 0; t < indices.length; t += 3) {
      const ia = indices[t]!
      const ib = indices[t + 1]!
      const ic = indices[t + 2]!
      const ax = frame.originX + positions[ia * 2]! * frame.scale
      const ay = frame.originY - positions[ia * 2 + 1]! * frame.scale
      const bx = frame.originX + positions[ib * 2]! * frame.scale
      const by = frame.originY - positions[ib * 2 + 1]! * frame.scale
      const cx = frame.originX + positions[ic * 2]! * frame.scale
      const cy = frame.originY - positions[ic * 2 + 1]! * frame.scale
      const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
      if (Math.abs(denom) <= 1e-8) continue
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
      const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)))
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
      const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)))
      corners.set(part.uvs.subarray(t * 2, t * 2 + 6))
      const texture = part.textures[part.triangleTexture[t / 3]!]
      if (texture === undefined) continue
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const px = x + 0.5
          const py = y + 0.5
          const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom
          const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom
          const w2 = 1 - w0 - w1
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
          triangleUv(uv, ax, ay, bx, by, cx, cy, px, py, corners)
          const color = sampleTexture(texture, uv[0]!, uv[1]!)
          const pixel = (y * width + x) * 4
          data[pixel] = Math.round(color.r * 255)
          data[pixel + 1] = Math.round(color.g * 255)
          data[pixel + 2] = Math.round(color.b * 255)
          data[pixel + 3] = 255
        }
      }
    }
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

function paintStroke(part: StrokePart, frame: Frame): void {
  ctx!.fillStyle = STROKE
  for (let q = 0; q < part.quads.length; q += 1) {
    const quad = part.quads[q]!
    ctx!.beginPath()
    move(quad.positions, frame, quad.indices[0]!)
    line(quad.positions, frame, quad.indices[1]!)
    line(quad.positions, frame, quad.indices[2]!)
    ctx!.closePath()
    ctx!.fill()
    ctx!.beginPath()
    move(quad.positions, frame, quad.indices[3]!)
    line(quad.positions, frame, quad.indices[4]!)
    line(quad.positions, frame, quad.indices[5]!)
    ctx!.closePath()
    ctx!.fill()
  }
}

function sample(rig: CompiledRig, current: Pose, rigFromBone: Float32Array): ViewSource[] {
  evaluateFk(rigFromBone, rig, current, rig.skeleton.boneCount)
  return rig.meshes.meshes.map((mesh, index) => {
    const positions = new Float32Array(mesh.positions.length)
    skinMesh(positions, rig, rigFromBone, index)
    return { partId: mesh.partId, positions, indices: mesh.indices }
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

function move(positions: Float32Array, frame: Frame, index: number): void {
  ctx!.moveTo(frame.originX + positions[index * 2]! * frame.scale, frame.originY - positions[index * 2 + 1]! * frame.scale)
}

function line(positions: Float32Array, frame: Frame, index: number): void {
  ctx!.lineTo(frame.originX + positions[index * 2]! * frame.scale, frame.originY - positions[index * 2 + 1]! * frame.scale)
}

function degrees(radians: number): number {
  return Math.round((radians * 180) / Math.PI)
}

function formatDeg(value: number): string {
  if (value < 0) return `−${Math.abs(value)}°`
  if (value > 0) return `+${value}°`
  return '0°'
}
