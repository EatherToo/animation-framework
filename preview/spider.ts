import { createHumanoid } from '../src/body/assemble'
import { evaluateFk } from '../src/fk/evaluate'
import { setArmSwing, setBreath, setCrouch, setSpeed, setSpineBend, stepParams } from '../src/params/params'
import { captureRenderFrame, sampleRender, type RenderFrame } from '../src/render/sample'
import { poseRotation, poseTranslation } from '../src/skeleton/pose'
import { findBone } from '../src/skeleton/skeleton'
import { createSolver, stepSolver } from '../src/solve/solve'
import { createVec2 } from '../src/math/vec2'

const DT = 1 / 60
const MODE: Record<string, string> = {
  stand: '站立',
  start: '起步',
  walk: '行走',
  run: '跑步',
  stop: '停止',
  recover: '恢复',
}

type JointName =
  | 'head'
  | 'neck'
  | 'waist'
  | 'shoulderL'
  | 'elbowL'
  | 'wristL'
  | 'handL'
  | 'shoulderR'
  | 'elbowR'
  | 'wristR'
  | 'handR'
  | 'hipL'
  | 'kneeL'
  | 'ankleL'
  | 'footL'
  | 'hipR'
  | 'kneeR'
  | 'ankleR'
  | 'footR'

type Vec = { x: number; y: number }
type BoneDef = { name: string; a: JointName; b: JointName; layer: number }

const REST: Record<JointName, Vec> = {
  head: { x: 280, y: 18 },
  neck: { x: 287, y: 158 },
  waist: { x: 287, y: 530 },
  shoulderL: { x: 392, y: 214 },
  elbowL: { x: 424, y: 348 },
  wristL: { x: 458, y: 468 },
  handL: { x: 466, y: 520 },
  shoulderR: { x: 176, y: 214 },
  elbowR: { x: 164, y: 348 },
  wristR: { x: 118, y: 470 },
  handR: { x: 112, y: 522 },
  hipL: { x: 348, y: 548 },
  kneeL: { x: 372, y: 748 },
  ankleL: { x: 398, y: 918 },
  footL: { x: 428, y: 992 },
  hipR: { x: 226, y: 548 },
  kneeR: { x: 206, y: 748 },
  ankleR: { x: 186, y: 918 },
  footR: { x: 148, y: 992 },
}

const BONES: readonly BoneDef[] = [
  { name: 'thighL', a: 'hipL', b: 'kneeL', layer: 0 },
  { name: 'shinL', a: 'kneeL', b: 'ankleL', layer: 0 },
  { name: 'footL', a: 'ankleL', b: 'footL', layer: 0 },
  { name: 'thighR', a: 'hipR', b: 'kneeR', layer: 0 },
  { name: 'shinR', a: 'kneeR', b: 'ankleR', layer: 0 },
  { name: 'footR', a: 'ankleR', b: 'footR', layer: 0 },
  { name: 'torso', a: 'neck', b: 'waist', layer: 1 },
  { name: 'head', a: 'neck', b: 'head', layer: 3 },
  { name: 'upperArmL', a: 'shoulderL', b: 'elbowL', layer: 2 },
  { name: 'lowerArmL', a: 'elbowL', b: 'wristL', layer: 2 },
  { name: 'handL', a: 'wristL', b: 'handL', layer: 2 },
  { name: 'upperArmR', a: 'shoulderR', b: 'elbowR', layer: 2 },
  { name: 'lowerArmR', a: 'elbowR', b: 'wristR', layer: 2 },
  { name: 'handR', a: 'wristR', b: 'handR', layer: 2 },
]

type Frame = { ax: number; ay: number; ux: number; uy: number; px: number; py: number }

const HALF: Record<string, number> = {
  thighL: 54,
  thighR: 54,
  shinL: 42,
  shinR: 42,
  footL: 48,
  footR: 48,
  torso: 118,
  head: 64,
  upperArmL: 42,
  upperArmR: 42,
  lowerArmL: 36,
  lowerArmR: 36,
  handL: 32,
  handR: 32,
}

const solver = createSolver(createHumanoid(1.7))
const canvas = document.querySelector<HTMLCanvasElement>('#stage')!
const readout = document.querySelector<HTMLElement>('#readout')!
const upperArmL = findBone(solver.pose.skeleton, 'upperArmL')
const upperArmR = findBone(solver.pose.skeleton, 'upperArmR')
const footBoneL = findBone(solver.pose.skeleton, 'footL')
const footBoneR = findBone(solver.pose.skeleton, 'footR')
const fk = new Float32Array(solver.compiled.skeleton.boneCount * 9)
const photo = new Image()
photo.src = './spider-man.png'

let ready = false
const originX = 287
const footY = 1008
const ppm = 992 / 1.7

let playing = true
let accumulator = 0
let last = performance.now()
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
let before: RenderFrame = captureRenderFrame(solver)
let after: RenderFrame = before

photo.onload = () => {
  ready = true
}
if (photo.complete && photo.naturalWidth > 0) ready = true

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
      before = after
      stepSolver(solver, DT)
      after = captureRenderFrame(solver)
      notePlant()
      accumulator -= DT
    }
  }
  draw()
  writeReadout()
  requestAnimationFrame(frame)
}

function notePlant(): void {
  if (solver.plan.stanceX === lastStance) return
  lastStance = solver.plan.stanceX
  plants.push({ x: solver.plan.stanceX, y: solver.plan.stanceY })
  if (plants.length > 14) plants.shift()
}

function writeReadout(): void {
  if (!ready) {
    readout.textContent = '正在准备贴图…'
    return
  }
  const active = solver.plan.active
  const mode = MODE[solver.gait.mode] ?? solver.gait.mode
  const parts = [
    `模式 <strong>${mode}</strong>`,
    `速度 <strong>${solver.params.current.speed.toFixed(2)}</strong> m/s`,
  ]
  if (active) {
    parts.push(`摆动 <strong>${active.foot === 'left' ? '左' : '右'}</strong>`)
    parts.push(`步内 <strong>${solver.stepTime.toFixed(2)}</strong> / ${active.duration.toFixed(2)} s`)
  } else {
    parts.push('站立')
  }
  readout.innerHTML = parts.join(' · ')
}

function draw(): void {
  const ctx = canvas.getContext('2d')!
  const width = canvas.width
  const height = canvas.height
  ctx.clearRect(0, 0, width, height)
  if (!ready) return

  const alpha = Math.min(1, accumulator / DT)
  const sampled = sampleRender(solver.compiled, before, after, alpha)
  evaluateFk(fk, solver.compiled, sampled.pose, solver.compiled.skeleton.boneCount)
  const pelvisX = fk[6]!
  const viewHeight = 2.35
  const viewWidth = viewHeight * (width / height)
  const x0 = pelvisX - viewWidth * 0.5
  const y0 = -0.08
  const scale = height / viewHeight

  ctx.save()
  ctx.translate(-x0 * scale, height + y0 * scale)
  ctx.scale(scale, -scale)

  ctx.beginPath()
  ctx.moveTo(x0, 0)
  ctx.lineTo(x0 + viewWidth, 0)
  ctx.lineWidth = 1.5 / scale
  ctx.strokeStyle = '#2a3544'
  ctx.stroke()

  const joints = poseJoints(sampled.pose)
  const order = BONES.slice().sort((a, b) => a.layer - b.layer)
  for (const bone of order) {
    paintBone(ctx, joints, bone, pelvisX)
  }
  ctx.restore()
}

function poseJoints(pose: RenderFrame['pose']): Record<JointName, Vec> {
  const joints = {} as Record<JointName, Vec>
  for (const name of Object.keys(REST) as JointName[]) joints[name] = { ...REST[name] }
  const yL = fk[footBoneL * 9 + 7]!
  const yR = fk[footBoneR * 9 + 7]!
  const ground = Math.min(yL, yR)
  bendLeg(joints, 'L', Math.max(0, yL - ground) * ppm)
  bendLeg(joints, 'R', Math.max(0, yR - ground) * ppm)
  swingArm(joints, 'L', poseRotation(pose, upperArmL))
  swingArm(joints, 'R', poseRotation(pose, upperArmR))
  const drop = Math.max(0, -poseTranslation(createVec2(), pose, 0)[1]!) * ppm * 0.35
  if (drop > 0) {
    for (const name of ['head', 'neck', 'waist', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'handL', 'handR', 'hipL', 'hipR'] as const) {
      joints[name].y += drop
    }
  }
  return joints
}

function bendLeg(joints: Record<JointName, Vec>, side: 'L' | 'R', lift: number): void {
  if (lift < 1) return
  const hip = joints[`hip${side}`]
  const knee = joints[`knee${side}`]
  const ankle = joints[`ankle${side}`]
  const foot = joints[`foot${side}`]
  const sign = side === 'L' ? 1 : -1
  const thigh = Math.min(0.35, lift / 340)
  const bend = Math.min(0.75, lift / 170)
  rotate(knee, hip, thigh * sign)
  rotate(ankle, hip, thigh * sign)
  rotate(foot, hip, thigh * sign)
  rotate(ankle, knee, bend * sign)
  rotate(foot, knee, bend * sign)
}

function swingArm(joints: Record<JointName, Vec>, side: 'L' | 'R', angle: number): void {
  if (Math.abs(angle) < 0.001) return
  const shoulder = joints[`shoulder${side}`]
  const elbow = joints[`elbow${side}`]
  const wrist = joints[`wrist${side}`]
  const hand = joints[`hand${side}`]
  const swing = angle * 0.45
  rotate(elbow, shoulder, swing)
  rotate(wrist, shoulder, swing)
  rotate(hand, shoulder, swing)
}

function rotate(point: Vec, origin: Vec, angle: number): void {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const x = point.x - origin.x
  const y = point.y - origin.y
  point.x = origin.x + c * x - s * y
  point.y = origin.y + s * x + c * y
}

function boneFrame(a: Vec, b: Vec): Frame {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  return { ax: a.x, ay: a.y, ux, uy, px: -uy, py: ux }
}

function paintBone(
  ctx: CanvasRenderingContext2D,
  joints: Record<JointName, Vec>,
  bone: BoneDef,
  pelvisX: number,
): void {
  const restA = REST[bone.a]
  const restB = REST[bone.b]
  const curA = joints[bone.a]
  const curB = joints[bone.b]
  const rest = boneFrame(restA, restB)
  const cur = boneFrame(curA, curB)
  const len = Math.hypot(restB.x - restA.x, restB.y - restA.y)
  const half = HALF[bone.name] ?? 40
  const pad = 12
  const corners: readonly [number, number][] = [
    [-pad, -half],
    [len + pad, -half],
    [len + pad, half],
    [-pad, half],
  ]
  const imageAt = (frame: Frame, along: number, side: number): Vec => ({
    x: frame.ax + along * frame.ux + side * frame.px,
    y: frame.ay + along * frame.uy + side * frame.py,
  })
  const uv = corners.map(([along, side]) => imageAt(rest, along, side))
  const xy = corners.map(([along, side]) => imageAt(cur, along, side))
  const world = xy.map((point) => toWorld(point.x, point.y, pelvisX))
  paintTriangle(ctx, world[0]!, world[1]!, world[2]!, uv[0]!.x, uv[0]!.y, uv[1]!.x, uv[1]!.y, uv[2]!.x, uv[2]!.y)
  paintTriangle(ctx, world[0]!, world[2]!, world[3]!, uv[0]!.x, uv[0]!.y, uv[2]!.x, uv[2]!.y, uv[3]!.x, uv[3]!.y)
}

function toWorld(ix: number, iy: number, pelvisX: number): [number, number] {
  return [pelvisX + (ix - originX) / ppm, (footY - iy) / ppm]
}

function paintTriangle(
  ctx: CanvasRenderingContext2D,
  w0: [number, number],
  w1: [number, number],
  w2: [number, number],
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  u2: number,
  v2: number,
): void {
  const du1 = u1 - u0
  const dv1 = v1 - v0
  const du2 = u2 - u0
  const dv2 = v2 - v0
  const det = du1 * dv2 - dv1 * du2
  if (Math.abs(det) < 1e-4) return
  const dx1 = w1[0] - w0[0]
  const dy1 = w1[1] - w0[1]
  const dx2 = w2[0] - w0[0]
  const dy2 = w2[1] - w0[1]
  const a = (dx1 * dv2 - dx2 * dv1) / det
  const c = (dx2 * du1 - dx1 * du2) / det
  const b = (dy1 * dv2 - dy2 * dv1) / det
  const d = (dy2 * du1 - dy1 * du2) / det
  const e = w0[0] - a * u0 - c * v0
  const f = w0[1] - b * u0 - d * v0
  const su = Math.min(u0, u1, u2)
  const sv = Math.min(v0, v1, v2)
  const eu = Math.max(u0, u1, u2)
  const ev = Math.max(v0, v1, v2)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(w0[0], w0[1])
  ctx.lineTo(w1[0], w1[1])
  ctx.lineTo(w2[0], w2[1])
  ctx.closePath()
  ctx.clip()
  ctx.transform(a, b, c, d, e, f)
  ctx.drawImage(photo, su, sv, eu - su, ev - sv, su, sv, eu - su, ev - sv)
  ctx.restore()
}

