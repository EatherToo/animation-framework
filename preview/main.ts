import { projectPositions } from '@animation-framework/render-engine/view/project'
import { FRONT_VIEW, MANNEQUIN_HEIGHT, createMannequinMesh, type MannequinPose } from './mannequin'

const BACKGROUND = '#5c5c5c'
const CLAY = [236, 236, 238] as const
const JOINT_COLOR = [42, 42, 46] as const
const GRID = 'rgba(64, 255, 154, 0.95)'
const LIGHT = normalize(0.45, 0.82, 0.2)
const STEP = 5

type JointKey = keyof MannequinPose

type Joint = {
  readonly key: JointKey
  readonly group: string
  readonly label: string
  readonly min: number
  readonly max: number
}

const JOINTS: readonly Joint[] = [
  { key: 'shoulderFlexL', group: '左臂', label: '肩屈', min: -60, max: 130 },
  { key: 'shoulderAbdL', group: '左臂', label: '肩展', min: -120, max: 90 },
  { key: 'shoulderRotL', group: '左臂', label: '肩旋', min: -70, max: 90 },
  { key: 'elbowL', group: '左臂', label: '肘', min: -150, max: 10 },
  { key: 'forearmL', group: '左臂', label: '前臂', min: -80, max: 80 },
  { key: 'wristFlexL', group: '左臂', label: '腕屈', min: -80, max: 70 },
  { key: 'wristDevL', group: '左臂', label: '腕偏', min: -20, max: 30 },
  { key: 'shoulderFlexR', group: '右臂', label: '肩屈', min: -60, max: 130 },
  { key: 'shoulderAbdR', group: '右臂', label: '肩展', min: -120, max: 90 },
  { key: 'shoulderRotR', group: '右臂', label: '肩旋', min: -70, max: 90 },
  { key: 'elbowR', group: '右臂', label: '肘', min: -150, max: 10 },
  { key: 'forearmR', group: '右臂', label: '前臂', min: -80, max: 80 },
  { key: 'wristFlexR', group: '右臂', label: '腕屈', min: -80, max: 70 },
  { key: 'wristDevR', group: '右臂', label: '腕偏', min: -20, max: 30 },
  { key: 'hipFlexL', group: '左腿', label: '髋屈', min: -30, max: 120 },
  { key: 'hipAbdL', group: '左腿', label: '髋展', min: -30, max: 45 },
  { key: 'hipRotL', group: '左腿', label: '髋旋', min: -45, max: 45 },
  { key: 'kneeL', group: '左腿', label: '膝', min: -150, max: 10 },
  { key: 'ankleFlexL', group: '左腿', label: '踝屈', min: -50, max: 20 },
  { key: 'ankleRollL', group: '左腿', label: '踝翻', min: -20, max: 35 },
  { key: 'hipFlexR', group: '右腿', label: '髋屈', min: -30, max: 120 },
  { key: 'hipAbdR', group: '右腿', label: '髋展', min: -30, max: 45 },
  { key: 'hipRotR', group: '右腿', label: '髋旋', min: -45, max: 45 },
  { key: 'kneeR', group: '右腿', label: '膝', min: -150, max: 10 },
  { key: 'ankleFlexR', group: '右腿', label: '踝屈', min: -50, max: 20 },
  { key: 'ankleRollR', group: '右腿', label: '踝翻', min: -20, max: 35 },
]

const canvas = document.querySelector<HTMLCanvasElement>('#view')
const panel = document.querySelector<HTMLElement>('#pose')
if (canvas === null || panel === null) throw new Error('view')
const ctx = canvas.getContext('2d')
if (ctx === null) throw new Error('2d')

let mesh = createMannequinMesh(MANNEQUIN_HEIGHT)
const restProjected = new Float32Array((mesh.positions.length / 3) * 2)
projectPositions(restProjected, mesh.positions, FRONT_VIEW)
const sliders = new Map<JointKey, HTMLInputElement>()
const readouts = new Map<JointKey, HTMLElement>()

mountPose(panel)
new ResizeObserver(() => draw()).observe(canvas.parentElement ?? canvas)
draw()

function mountPose(root: HTMLElement): void {
  const title = document.createElement('h1')
  title.textContent = '姿势'
  const note = document.createElement('p')
  note.className = 'note'
  note.textContent = '0° 是 T 字站姿。肩和髋各有屈、展、旋，腕和踝各有屈伸与侧向，肘、膝、前臂各一个铰链。屈的正角度朝前，展的正角度离开躯干。肘的负角度朝前弯，膝的负角度朝后弯。腕屈正角度手指向上，踝屈正角度脚尖上抬。'
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.className = 'reset'
  reset.textContent = '复位到 0°'
  reset.addEventListener('click', () => {
    for (const joint of JOINTS) {
      const slider = sliders.get(joint.key)
      if (slider === undefined) continue
      slider.value = '0'
      writeReadout(joint)
    }
    poseMesh()
  })
  root.append(title, note, reset)

  let group = ''
  for (const joint of JOINTS) {
    if (joint.group !== group) {
      group = joint.group
      const heading = document.createElement('h2')
      heading.textContent = group
      root.append(heading)
    }
    const row = document.createElement('div')
    row.className = 'joint'
    const name = document.createElement('span')
    name.textContent = joint.label
    const down = document.createElement('button')
    down.type = 'button'
    down.textContent = '−'
    down.setAttribute('aria-label', `${joint.group}${joint.label}减 ${STEP} 度`)
    const up = document.createElement('button')
    up.type = 'button'
    up.textContent = '+'
    up.setAttribute('aria-label', `${joint.group}${joint.label}加 ${STEP} 度`)
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = String(joint.min)
    slider.max = String(joint.max)
    slider.step = '1'
    slider.value = '0'
    slider.setAttribute('aria-label', `${joint.group}${joint.label}`)
    const range = document.createElement('div')
    range.className = 'range'
    row.append(name, down, slider, up, range)
    root.append(row)
    sliders.set(joint.key, slider)
    readouts.set(joint.key, range)
    const apply = (): void => {
      writeReadout(joint)
      poseMesh()
    }
    slider.addEventListener('input', apply)
    down.addEventListener('click', () => nudge(joint, -STEP))
    up.addEventListener('click', () => nudge(joint, STEP))
    writeReadout(joint)
  }
}

function nudge(joint: Joint, delta: number): void {
  const slider = sliders.get(joint.key)
  if (slider === undefined) return
  const next = Math.min(joint.max, Math.max(joint.min, Number(slider.value) + delta))
  slider.value = String(next)
  writeReadout(joint)
  poseMesh()
}

function writeReadout(joint: Joint): void {
  const readout = readouts.get(joint.key)
  const slider = sliders.get(joint.key)
  if (readout === undefined || slider === undefined) return
  readout.textContent = `${formatDeg(Number(slider.value))} · 可活动 ${formatDeg(joint.min)} ~ ${formatDeg(joint.max)}`
}

function poseMesh(): void {
  mesh = createMannequinMesh(MANNEQUIN_HEIGHT, currentPose())
  draw()
}

function currentPose(): MannequinPose {
  return {
    shoulderFlexL: radians('shoulderFlexL'),
    shoulderAbdL: radians('shoulderAbdL'),
    shoulderRotL: radians('shoulderRotL'),
    elbowL: radians('elbowL'),
    forearmL: radians('forearmL'),
    wristFlexL: radians('wristFlexL'),
    wristDevL: radians('wristDevL'),
    shoulderFlexR: radians('shoulderFlexR'),
    shoulderAbdR: radians('shoulderAbdR'),
    shoulderRotR: radians('shoulderRotR'),
    elbowR: radians('elbowR'),
    forearmR: radians('forearmR'),
    wristFlexR: radians('wristFlexR'),
    wristDevR: radians('wristDevR'),
    hipFlexL: radians('hipFlexL'),
    hipAbdL: radians('hipAbdL'),
    hipRotL: radians('hipRotL'),
    kneeL: radians('kneeL'),
    ankleFlexL: radians('ankleFlexL'),
    ankleRollL: radians('ankleRollL'),
    hipFlexR: radians('hipFlexR'),
    hipAbdR: radians('hipAbdR'),
    hipRotR: radians('hipRotR'),
    kneeR: radians('kneeR'),
    ankleFlexR: radians('ankleFlexR'),
    ankleRollR: radians('ankleRollR'),
  }
}

function radians(key: JointKey): number {
  return (Number(sliders.get(key)?.value) * Math.PI) / 180
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

  const projected = new Float32Array((mesh.positions.length / 3) * 2)
  projectPositions(projected, mesh.positions, FRONT_VIEW)
  const order = frontQuads(mesh.positions, mesh.quads)
  const frame = contain(restProjected, canvas!.width, canvas!.height)

  ctx!.setTransform(1, 0, 0, 1, 0, 0)
  ctx!.fillStyle = BACKGROUND
  ctx!.fillRect(0, 0, canvas!.width, canvas!.height)
  ctx!.lineWidth = Math.max(1, dpr)
  ctx!.lineJoin = 'round'
  ctx!.strokeStyle = GRID

  for (let i = 0; i < order.length; i += 1) {
    const q = order[i]!
    const a = mesh.quads[q * 4]!
    const b = mesh.quads[q * 4 + 1]!
    const c = mesh.quads[q * 4 + 2]!
    const d = mesh.quads[q * 4 + 3]!
    const normal = faceNormal(mesh.positions, a, b, c, d)
    const color = mesh.materials[q] === 1 ? JOINT_COLOR : CLAY
    ctx!.beginPath()
    move(ctx!, projected, frame, a)
    line(ctx!, projected, frame, b)
    line(ctx!, projected, frame, c)
    if (d !== c && d !== a) line(ctx!, projected, frame, d)
    ctx!.closePath()
    ctx!.fillStyle = paint(color, normal === null ? 1 : blockShade(normal))
    ctx!.fill()
    ctx!.stroke()
  }
}

function frontQuads(positions: Float32Array, quads: Uint32Array): number[] {
  const count = quads.length / 4
  const order: { index: number; depth: number }[] = []
  for (let q = 0; q < count; q += 1) {
    const a = quads[q * 4]!
    const b = quads[q * 4 + 1]!
    const c = quads[q * 4 + 2]!
    const d = quads[q * 4 + 3]!
    const normal = faceNormal(positions, a, b, c, d)
    if (normal === null || normal[0] <= -0.04) continue
    order.push({ index: q, depth: centroidX(positions, a, b, c, d) })
  }
  order.sort((left, right) => left.depth - right.depth)
  return order.map((item) => item.index)
}

function contain(projected: Float32Array, width: number, height: number): Frame {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < projected.length; i += 2) {
    const x = projected[i]!
    const y = projected[i + 1]!
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  maxY += 0.7
  minY -= 0.25
  const spanX = Math.max(1e-4, maxX - minX)
  const spanY = Math.max(1e-4, maxY - minY)
  const padX = spanX * 0.12
  const padY = spanY * 0.04
  minX -= padX
  maxX += padX
  minY -= padY
  maxY += padY
  const scale = Math.min(width / (maxX - minX), height / (maxY - minY))
  const usedW = (maxX - minX) * scale
  const usedH = (maxY - minY) * scale
  return {
    scale,
    originX: (width - usedW) / 2 - minX * scale,
    originY: (height - usedH) / 2 + maxY * scale,
  }
}

type Frame = { scale: number; originX: number; originY: number }

function move(context: CanvasRenderingContext2D, projected: Float32Array, frame: Frame, index: number): void {
  context.moveTo(frame.originX + projected[index * 2]! * frame.scale, frame.originY - projected[index * 2 + 1]! * frame.scale)
}

function line(context: CanvasRenderingContext2D, projected: Float32Array, frame: Frame, index: number): void {
  context.lineTo(frame.originX + projected[index * 2]! * frame.scale, frame.originY - projected[index * 2 + 1]! * frame.scale)
}

function faceNormal(
  positions: Float32Array,
  a: number,
  b: number,
  c: number,
  d: number,
): readonly [number, number, number] | null {
  const tail = d === c || d === a ? c : d
  const ax = positions[a * 3]!
  const ay = positions[a * 3 + 1]!
  const az = positions[a * 3 + 2]!
  const ux = positions[b * 3]! - ax
  const uy = positions[b * 3 + 1]! - ay
  const uz = positions[b * 3 + 2]! - az
  const vx = positions[tail * 3]! - ax
  const vy = positions[tail * 3 + 1]! - ay
  const vz = positions[tail * 3 + 2]! - az
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const len = Math.hypot(nx, ny, nz)
  if (len < 1e-8) return null
  return [nx / len, ny / len, nz / len]
}

function centroidX(positions: Float32Array, a: number, b: number, c: number, d: number): number {
  const ids = d === a || d === c ? [a, b, c] : [a, b, c, d]
  let sum = 0
  for (let i = 0; i < ids.length; i += 1) sum += positions[ids[i]! * 3]!
  return sum / ids.length
}

function blockShade(normal: readonly [number, number, number]): number {
  const nd = Math.max(0, normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2])
  return 0.55 + 0.45 * nd
}

function paint(color: readonly [number, number, number], shade: number): string {
  const r = Math.round(color[0] * shade)
  const g = Math.round(color[1] * shade)
  const b = Math.round(color[2] * shade)
  return `rgb(${r} ${g} ${b})`
}

function formatDeg(value: number): string {
  if (value < 0) return `−${Math.abs(value)}°`
  if (value > 0) return `+${value}°`
  return '0°'
}

function normalize(x: number, y: number, z: number): readonly [number, number, number] {
  const len = Math.hypot(x, y, z)
  return [x / len, y / len, z / len]
}
