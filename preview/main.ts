import {
  ARM_ROM_MAX,
  ARM_ROM_MIN,
  LEG_ROM_MAX,
  LEG_ROM_MIN,
  createHumanoid,
  type BoneId,
} from '@animation-framework/render-engine/body'
import { compileHumanoid, type CompiledRig } from '@animation-framework/render-engine/compile'
import { evaluateFk } from '@animation-framework/render-engine/fk'
import { fillProjected, type FilledPart } from '@animation-framework/render-engine/fill'
import { createPose, setPoseRotation, type Pose } from '@animation-framework/render-engine/skeleton'
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

type Hinge = {
  readonly bone: BoneId
  readonly group: string
  readonly label: string
  readonly min: number
  readonly max: number
}

const HINGES: readonly Hinge[] = [
  { bone: 'upperArmL', group: '左臂', label: '上臂', min: -60, max: 150 },
  { bone: 'lowerArmL', group: '左臂', label: '肘', min: degrees(ARM_ROM_MIN), max: degrees(ARM_ROM_MAX) },
  { bone: 'handL', group: '左臂', label: '手', min: -70, max: 70 },
  { bone: 'upperArmR', group: '右臂', label: '上臂', min: -60, max: 150 },
  { bone: 'lowerArmR', group: '右臂', label: '肘', min: degrees(ARM_ROM_MIN), max: degrees(ARM_ROM_MAX) },
  { bone: 'handR', group: '右臂', label: '手', min: -70, max: 70 },
  { bone: 'thighL', group: '左腿', label: '髋', min: -30, max: 120 },
  { bone: 'shinL', group: '左腿', label: '膝', min: degrees(LEG_ROM_MIN), max: degrees(LEG_ROM_MAX) },
  { bone: 'footL', group: '左腿', label: '脚', min: -40, max: 30 },
  { bone: 'thighR', group: '右腿', label: '髋', min: -30, max: 120 },
  { bone: 'shinR', group: '右腿', label: '膝', min: degrees(LEG_ROM_MIN), max: degrees(LEG_ROM_MAX) },
  { bone: 'footR', group: '右腿', label: '脚', min: -40, max: 30 },
]

const canvas = document.querySelector<HTMLCanvasElement>('#view')
const panel = document.querySelector<HTMLElement>('#pose')
if (canvas === null || panel === null) throw new Error('view')
const ctx = canvas.getContext('2d')
if (ctx === null) throw new Error('2d')

const humanoid = createHumanoid(HEIGHT)
const compiled = compileHumanoid(humanoid)
const pose = createPose(humanoid.skeleton)
const fk = new Float32Array(humanoid.skeleton.boneCount * 9)
const lateral = new Float32Array(humanoid.skeleton.boneCount)
const tie = drawOrder(new Array<string>(compiled.slots.slots.length), compiled.slots, FACING)
const restFrame = contain(projectParts(sample(compiled, pose, fk, lateral), FRONT_VIEW))
const sliders = new Map<BoneId, HTMLInputElement>()
const readouts = new Map<BoneId, HTMLElement>()

mountPose(panel)
new ResizeObserver(() => draw()).observe(canvas.parentElement ?? canvas)
draw()

function mountPose(root: HTMLElement): void {
  const title = document.createElement('h1')
  title.textContent = '姿势'
  const note = document.createElement('p')
  note.className = 'note'
  note.textContent =
    '0° 是绑定站姿，手臂下垂、腿伸直。每个滑块是一根骨头在矢状面里的姿态旋转，正角度逆时针。上臂和髋的正角度朝前。肘的正角度朝前弯，范围是引擎的肘活动度。膝的负角度朝后弯，范围是引擎的膝活动度。手的正角度朝前，脚的正角度脚尖上抬。'
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.className = 'reset'
  reset.textContent = '复位到 0°'
  reset.addEventListener('click', () => {
    for (const hinge of HINGES) {
      const slider = sliders.get(hinge.bone)
      if (slider === undefined) continue
      slider.value = '0'
      writeReadout(hinge)
    }
    draw()
  })
  root.append(title, note, reset)

  let group = ''
  for (const hinge of HINGES) {
    if (hinge.group !== group) {
      group = hinge.group
      const heading = document.createElement('h2')
      heading.textContent = group
      root.append(heading)
    }
    const row = document.createElement('div')
    row.className = 'joint'
    const name = document.createElement('span')
    name.textContent = hinge.label
    const down = document.createElement('button')
    down.type = 'button'
    down.textContent = '−'
    down.setAttribute('aria-label', `${hinge.group}${hinge.label}减 ${STEP} 度`)
    const up = document.createElement('button')
    up.type = 'button'
    up.textContent = '+'
    up.setAttribute('aria-label', `${hinge.group}${hinge.label}加 ${STEP} 度`)
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = String(hinge.min)
    slider.max = String(hinge.max)
    slider.step = '1'
    slider.value = '0'
    slider.setAttribute('aria-label', `${hinge.group}${hinge.label}`)
    const range = document.createElement('div')
    range.className = 'range'
    row.append(name, down, slider, up, range)
    root.append(row)
    sliders.set(hinge.bone, slider)
    readouts.set(hinge.bone, range)
    const apply = (): void => {
      writeReadout(hinge)
      draw()
    }
    slider.addEventListener('input', apply)
    down.addEventListener('click', () => nudge(hinge, -STEP))
    up.addEventListener('click', () => nudge(hinge, STEP))
    writeReadout(hinge)
  }
}

function nudge(hinge: Hinge, delta: number): void {
  const slider = sliders.get(hinge.bone)
  if (slider === undefined) return
  const next = Math.min(hinge.max, Math.max(hinge.min, Number(slider.value) + delta))
  slider.value = String(next)
  writeReadout(hinge)
  draw()
}

function writeReadout(hinge: Hinge): void {
  const readout = readouts.get(hinge.bone)
  const slider = sliders.get(hinge.bone)
  if (readout === undefined || slider === undefined) return
  readout.textContent = `${formatDeg(Number(slider.value))} · 可活动 ${formatDeg(hinge.min)} ~ ${formatDeg(hinge.max)}`
}

function draw(): void {
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
  const sampled = sample(compiled, pose, fk, lateral)
  const projected = projectParts(sampled, FRONT_VIEW)
  const filled = fillProjected(
    projected,
    compiled.parts.parts.map((part) => part.fill),
  )
  const stroked = strokeContours(filled, true)
  const order = depthOrder(new Array<string>(projected.length), projected, tie)
  const frame = fit(restFrame, canvas!.width, canvas!.height)

  ctx!.setTransform(1, 0, 0, 1, 0, 0)
  ctx!.fillStyle = BACKGROUND
  ctx!.fillRect(0, 0, canvas!.width, canvas!.height)
  const byFill = new Map(filled.map((part) => [part.partId, part]))
  const byStroke = new Map(stroked.map((part) => [part.partId, part]))
  for (let i = 0; i < order.length; i += 1) {
    const id = order[i]!
    const part = byFill.get(id)
    if (part === undefined) continue
    paintPart(part, frame)
    const contour = byStroke.get(id)
    if (contour !== undefined) paintStroke(contour, frame)
  }
}

function applyPose(): void {
  for (const hinge of HINGES) {
    const slider = sliders.get(hinge.bone)
    const degrees = slider === undefined ? 0 : Number(slider.value)
    setPoseRotation(pose, humanoid.boneIndex[hinge.bone], (degrees * Math.PI) / 180)
  }
}

function paintPart(part: FilledPart, frame: Frame): void {
  const color = part.fill
  ctx!.fillStyle = `rgb(${Math.round(color.r * 255)} ${Math.round(color.g * 255)} ${Math.round(color.b * 255)})`
  const positions = part.positions
  const indices = part.indices
  for (let t = 0; t < indices.length; t += 3) {
    ctx!.beginPath()
    move(positions, frame, indices[t]!)
    line(positions, frame, indices[t + 1]!)
    line(positions, frame, indices[t + 2]!)
    ctx!.closePath()
    ctx!.fill()
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

function sample(
  rig: CompiledRig,
  current: Pose,
  rigFromBone: Float32Array,
  boneLateral: Float32Array,
): ViewSource[] {
  evaluateFk(rigFromBone, boneLateral, rig, current, rig.skeleton.boneCount)
  return rig.meshes.meshes.map((mesh, index) => {
    const positions = new Float32Array(mesh.positions.length)
    skinMesh(positions, rig, rigFromBone, boneLateral, index)
    return { partId: mesh.partId, positions, indices: mesh.indices }
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
