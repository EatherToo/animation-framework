import { createHumanoid } from '../src/body/assemble'
import { evaluateFk } from '../src/fk/evaluate'
import { fillPose } from '../src/fill/fill'
import { setArmSwing, setBreath, setCrouch, setSpeed, setSpineBend, stepParams } from '../src/params/params'
import { createSolver, stepSolver, type Solver } from '../src/solve/solve'
import { findBone } from '../src/skeleton/skeleton'
import { drawOrder } from '../src/slot/slot'

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
const order = new Array<string>(solver.compiled.slots.slots.length)

let playing = true
let accumulator = 0
let last = performance.now()
let flash = ''
let flashUntil = 0
const plants: { x: number; y: number }[] = []
let lastStance = Number.NaN

setIntent(1.2)
const jump = Number(new URLSearchParams(location.search).get('t') ?? 0)
if (jump > 0) {
  for (let i = 0; i < Math.round(jump / DT); i += 1) {
    stepSolver(solver, DT)
    notePlant()
  }
}

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

requestAnimationFrame(frame)

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
  const elapsed = Math.min(0.05, (now - last) / 1000)
  last = now
  if (playing) {
    accumulator += elapsed
    while (accumulator >= DT) {
      stepSolver(solver, DT)
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
  plants.push({ x: solver.plan.stanceX, y: solver.plan.stanceY })
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

  const filled = fillPose(solver.compiled, solver.pose)
  const fk = new Float32Array(solver.compiled.skeleton.boneCount * 9)
  evaluateFk(fk, solver.compiled, solver.pose, solver.compiled.skeleton.boneCount)
  const pelvisX = fk[6]!

  const viewHeight = 2.2
  const viewWidth = viewHeight * (width / height)
  const x0 = pelvisX - viewWidth * 0.38
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

  const firstMeter = Math.ceil(x0)
  ctx.font = `${12 / scale}px Palatino, serif`
  ctx.fillStyle = '#8ea0b3'
  ctx.textAlign = 'center'
  for (let meter = firstMeter; meter < x0 + viewWidth; meter += 1) {
    ctx.beginPath()
    ctx.moveTo(meter, 0)
    ctx.lineTo(meter, -0.06)
    ctx.strokeStyle = '#d5dde6'
    ctx.stroke()
    ctx.save()
    ctx.scale(1, -1)
    ctx.fillText(String(meter), meter, 0.16)
    ctx.restore()
  }

  for (const plant of plants) dot(ctx, plant.x, plant.y, 0.035, '#c5d0dc')
  dot(ctx, solver.leftX, solver.leftY, 0.045, '#3d6f9c')
  dot(ctx, solver.rightX, solver.rightY, 0.045, '#c47b3a')
  const active = solver.plan.active
  if (active) ring(ctx, active.contactX, active.contactY, 0.07)

  const facing = solver.params.current.facing
  for (const partId of drawOrder(order, solver.compiled.slots, facing)) {
    const part = filled.find((item) => item.partId === partId)
    if (part === undefined) continue
    const { r, g, b } = part.fill
    ctx.fillStyle = `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`
    ctx.beginPath()
    const positions = part.positions
    const indices = part.indices
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
