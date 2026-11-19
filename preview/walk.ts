import { createBinding, createMemoryLayer, updateBinding } from '../src/bind/bind'
import { createHumanoid } from '../src/body/assemble'
import { evaluateFk } from '../src/fk/evaluate'
import { fillProjected } from '../src/fill/fill'
import { setArmSwing, setBreath, setCrouch, setSpeed, setSpineBend, stepParams } from '../src/params/params'
import { captureRenderFrame, sampleRender, type RenderFrame } from '../src/render/sample'
import { findBone } from '../src/skeleton/skeleton'
import { createSolver, stepSolver } from '../src/solve/solve'
import { createVec2 } from '../src/math/vec2'
import { createWorldPoint, setWorldPoint, worldToRigPoint } from '../src/space/world-point'
import { strokeContours } from '../src/stroke/stroke'
import { VIEW_COUNT, depthOrder, isViewIndex, projectParts, projectPositions, type ViewIndex } from '../src/view/project'

const DT = 1 / 60
const MODE: Record<string, string> = {
  stand: '站立',
  start: '起步',
  walk: '行走',
  run: '跑步',
  stop: '停止',
  recover: '恢复',
}

const solver = createSolver(createHumanoid(1.7))
const canvas = document.querySelector<HTMLCanvasElement>('#stage')!
const readout = document.querySelector<HTMLElement>('#readout')!
const footL = findBone(solver.pose.skeleton, 'footL')
const footR = findBone(solver.pose.skeleton, 'footR')
const layer = createMemoryLayer()
const binding = createBinding(layer)
const fk = new Float32Array(solver.compiled.skeleton.boneCount * 9)
const lateral = new Float32Array(solver.compiled.skeleton.boneCount)
const fills = solver.compiled.parts.parts.map((part) => part.fill)
const hipOffsetZ = solver.compiled.proportions.hipOffsetZ
const point = new Float32Array(3)
const seen = new Float32Array(2)
const rigPoint = createVec2()
const worldPoint = createWorldPoint()

const VIEW_NAME: Record<number, string> = { 0: '右侧', 90: '正面', 180: '左侧', 270: '背面' }

let view: ViewIndex = 0
let playing = true
let accumulator = 0
let last = performance.now()
let flash = ''
let flashUntil = 0
const plants: { x: number; y: number; z: number }[] = []
let lastStance = Number.NaN

setIntent(1.2)
const jump = Number(new URLSearchParams(location.search).get('t') ?? 0)
if (jump > 0) {
  for (let i = 0; i < Math.round(jump / DT); i += 1) {
    stepSolver(solver, DT)
    notePlant()
  }
}
let before: RenderFrame = captureRenderFrame(solver)
let after: RenderFrame = before

document.querySelector('#stand')!.addEventListener('click', () => setIntent(0))
document.querySelector('#walk')!.addEventListener('click', () => setIntent(1.2))
document.querySelector('#run')!.addEventListener('click', () => setIntent(3))
document.querySelector('#back')!.addEventListener('click', () => setIntent(-1.2))
document.querySelector('#pause')!.addEventListener('click', () => {
  playing = !playing
  document.querySelector('#pause')!.setAttribute('aria-pressed', String(!playing))
  document.querySelector('#pause')!.textContent = playing ? '暂停' : '继续'
})

const crouch = document.querySelector<HTMLInputElement>('#crouch')!
const crouchOut = document.querySelector<HTMLOutputElement>('#crouch-out')!
crouch.addEventListener('input', () => {
  const value = Number(crouch.value)
  crouchOut.textContent = value.toFixed(2)
  setCrouch(solver.params, value)
})

const viewInput = document.querySelector<HTMLInputElement>('#view')!
const viewOut = document.querySelector<HTMLOutputElement>('#view-out')!
viewInput.max = String(VIEW_COUNT - 1)
viewInput.addEventListener('input', () => setView(Number(viewInput.value)))
for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
  button.addEventListener('click', () => setView(Number(button.dataset.view)))
}
setView(Number(new URLSearchParams(location.search).get('view') ?? 0))

requestAnimationFrame(frame)

/** 视角只在画面帧里用：不进固定步，也不改朝向。 */
function setView(next: number): void {
  view = isViewIndex(next) ? next : 0
  viewInput.value = String(view)
  viewOut.textContent = `${view}°`
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.view) === view))
  }
}

/** 角色空间的一点按当前视角落到屏幕上。 */
function screenOf(x: number, y: number, z: number): { x: number; y: number } {
  point[0] = x
  point[1] = y
  point[2] = z
  projectPositions(seen, point, view)
  return { x: seen[0]!, y: seen[1]! }
}

/** 矢状面里的世界落点先换回角色空间，再按当前视角投影，最后加上放置原点。 */
function screenOfWorld(x: number, y: number, z: number): { x: number; y: number } {
  const origin = solver.placement.origin
  worldToRigPoint(rigPoint, setWorldPoint(worldPoint, x, y), origin, after.facing)
  const at = screenOf(rigPoint[0]!, rigPoint[1]!, z)
  return { x: origin[0]! + at.x, y: origin[1]! + at.y }
}

function setIntent(speed: number): void {
  setSpeed(solver.params, speed)
  const moving = speed !== 0
  setArmSwing(solver.params, moving ? 0.85 : 0)
  setSpineBend(solver.params, moving ? 0.4 : 0)
  setBreath(solver.params, moving ? 0.5 : 0)
  if (!solver.plan.active) {
    for (let i = 0; i < 90; i += 1) stepParams(solver.params, DT)
  }
  for (const id of ['stand', 'walk', 'run', 'back']) {
    document.querySelector('#' + id)!.setAttribute('aria-pressed', 'false')
  }
  const pressed = speed === 0 ? 'stand' : speed === 3 ? 'run' : speed < 0 ? 'back' : 'walk'
  document.querySelector('#' + pressed)!.setAttribute('aria-pressed', 'true')
  if (!playing) {
    playing = true
    document.querySelector('#pause')!.setAttribute('aria-pressed', 'false')
    document.querySelector('#pause')!.textContent = '暂停'
  }
}

function frame(now: number): void {
  const elapsed = Math.max(0, Math.min(0.05, (now - last) / 1000))
  last = now
  if (playing) {
    accumulator += elapsed
    while (accumulator >= DT) {
      before = after
      stepSolver(solver, DT)
      after = captureRenderFrame(solver)
      notePlant()
      noteEvents(now)
      accumulator -= DT
    }
  }
  draw()
  writeReadout(now)
  requestAnimationFrame(frame)
}

function notePlant(): void {
  if (solver.plan.stanceX === lastStance) return
  lastStance = solver.plan.stanceX
  const z = solver.plan.stanceFoot === 'left' ? hipOffsetZ : -hipOffsetZ
  plants.push({ x: solver.plan.stanceX, y: solver.plan.stanceY, z })
  if (plants.length > 14) plants.shift()
}

function noteEvents(now: number): void {
  if (solver.events.length === 0) return
  flash = solver.events
    .map((event) => `${event.foot === 'left' ? '左脚' : '右脚'}${event.kind === 'liftoff' ? '离地' : '落地'}`)
    .join('，')
  flashUntil = now + 500
}

function writeReadout(now: number): void {
  const active = solver.plan.active
  const mode = MODE[solver.gait.mode] ?? solver.gait.mode
  const speed = solver.params.current.speed
  const parts = [
    `视角 <strong>${view}°</strong>${VIEW_NAME[view] ? ' ' + VIEW_NAME[view] : ''}`,
    `模式 <strong>${mode}</strong>`,
    `速度 <strong>${speed.toFixed(2)}</strong> m/s`,
  ]
  if (active) {
    const other = active.foot === 'left' ? '右' : '左'
    parts.push(`摆动 <strong>${active.foot === 'left' ? '左' : '右'}</strong>，支撑 <strong>${other}</strong>`)
    parts.push(`步内 <strong>${solver.stepTime.toFixed(2)}</strong> / ${active.duration.toFixed(2)} s`)
    parts.push(`支撑世界 x <strong>${solver.plan.stanceX.toFixed(3)}</strong>`)
  } else {
    parts.push('没有锁存的步')
  }
  if (solver.recovery.active) parts.push('<strong>恢复中</strong>')
  if (now < flashUntil) parts.push(flash)
  readout.innerHTML = parts.join(' · ')
}

function draw(): void {
  const ctx = canvas.getContext('2d')!
  const width = canvas.width
  const height = canvas.height
  ctx.clearRect(0, 0, width, height)

  const alpha = Math.min(1, accumulator / DT)
  const sampled = sampleRender(solver.compiled, before, after, alpha)
  const projected = projectParts(sampled.parts, view)
  const filled = fillProjected(projected, fills)
  const order = depthOrder(new Array<string>(projected.length), projected, sampled.order)
  updateBinding(binding, filled, strokeContours(filled, true), order)
  evaluateFk(fk, lateral, solver.compiled, sampled.pose, solver.compiled.skeleton.boneCount)
  const origin = solver.placement.origin
  const pelvisX = origin[0]! + screenOf(fk[6]!, fk[7]!, 0).x

  const viewHeight = 2.2
  const viewWidth = viewHeight * (width / height)
  const ahead = screenOf(1, 0, 0).x
  const x0 = pelvisX - viewWidth * (0.5 - 0.12 * ahead)
  const y0 = -0.32
  const scale = height / viewHeight

  ctx.save()
  ctx.translate(-x0 * scale, height + y0 * scale)
  ctx.scale(scale, -scale)

  ctx.beginPath()
  ctx.moveTo(x0, 0)
  ctx.lineTo(x0 + viewWidth, 0)
  ctx.lineWidth = 1.5 / scale
  ctx.strokeStyle = '#b7c3d0'
  ctx.stroke()

  ctx.font = `${12 / scale}px Palatino, serif`
  ctx.fillStyle = '#8ea0b3'
  ctx.textAlign = 'center'
  const spacing = Math.abs(screenOfWorld(1, 0, 0).x - screenOfWorld(0, 0, 0).x)
  if (spacing > 0.2) {
    const walked = solver.plan.stanceX
    for (let meter = Math.floor(walked - viewWidth / spacing); meter <= walked + viewWidth / spacing; meter += 1) {
      const at = screenOfWorld(meter, 0, 0).x
      if (at < x0 || at > x0 + viewWidth) continue
      ctx.beginPath()
      ctx.moveTo(at, 0)
      ctx.lineTo(at, -0.06)
      ctx.strokeStyle = '#d5dde6'
      ctx.stroke()
      ctx.save()
      ctx.scale(1, -1)
      ctx.fillText(String(meter), at, 0.16)
      ctx.restore()
    }
  }

  for (const plant of plants) {
    const at = screenOfWorld(plant.x, plant.y, plant.z)
    dot(ctx, at.x, at.y, 0.035, '#c5d0dc')
  }
  const leftAt = screenOfWorld(solver.leftX, solver.leftY, hipOffsetZ)
  const rightAt = screenOfWorld(solver.rightX, solver.rightY, -hipOffsetZ)
  dot(ctx, leftAt.x, leftAt.y, 0.045, '#3d6f9c')
  dot(ctx, rightAt.x, rightAt.y, 0.045, '#c47b3a')
  const active = solver.plan.active
  if (active) {
    const target = screenOfWorld(active.contactX, active.contactY, active.foot === 'left' ? hipOffsetZ : -hipOffsetZ)
    ring(ctx, target.x, target.y, 0.07)
  }

  ctx.translate(origin[0]!, origin[1]!)
  const drawn = layer.objects.slice().sort((a, b) => a.order - b.order)
  for (const object of drawn) {
    if (object.indices.length === 0) continue
    const color = object.color
    ctx.fillStyle =
      color === null
        ? '#1c2430'
        : `rgb(${Math.round(color.r * 255)} ${Math.round(color.g * 255)} ${Math.round(color.b * 255)})`
    ctx.beginPath()
    const positions = object.positions
    const indices = object.indices
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]! * 2
      const b = indices[i + 1]! * 2
      const c = indices[i + 2]! * 2
      ctx.moveTo(positions[a]!, positions[a + 1]!)
      ctx.lineTo(positions[b]!, positions[b + 1]!)
      ctx.lineTo(positions[c]!, positions[c + 1]!)
      ctx.closePath()
    }
    ctx.fill()
  }
  ctx.restore()

  ctx.fillStyle = '#5c6b7a'
  ctx.font = '13px Palatino, serif'
  ctx.textAlign = 'left'
  const swing = active ? boneY(fk, active.foot === 'left' ? footL : footR) : 0
  const stance = active ? boneY(fk, active.foot === 'left' ? footR : footL) : 0
  const lifted = active !== null && solver.stepTime > active.duty * active.duration && swing > stance + 0.02
  ctx.fillText(lifted ? '摆动脚已离开地面' : '蓝点左脚，橙点右脚', 16, 24)
}

function boneY(fk: Float32Array, bone: number): number {
  return fk[bone * 9 + 7]!
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.lineWidth = 0.015
  ctx.strokeStyle = '#1c2430'
  ctx.stroke()
}
