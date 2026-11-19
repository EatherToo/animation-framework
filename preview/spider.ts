import { createHumanoid } from '@animation-framework/render-engine/body/assemble'
import { evaluateFk } from '@animation-framework/render-engine/fk/evaluate'
import { setArmSwing, setBreath, setCrouch, setSpeed, setSpineBend, stepParams } from '@animation-framework/render-engine/params/params'
import { captureRenderFrame, sampleRender, type RenderFrame } from '@animation-framework/render-engine/render/sample'
import { bindLength, findBone } from '@animation-framework/render-engine/skeleton/skeleton'
import { createSolver, stepSolver } from '@animation-framework/render-engine/solve/solve'
import { isViewIndex, type ViewIndex } from '@animation-framework/render-engine/view/project'

const DT = 1 / 60
const BODY = 1.7
const SPIN_DEG_PER_SEC = 20

const MODE: Record<string, string> = {
  stand: '站立',
  start: '起步',
  walk: '行走',
  run: '跑步',
  stop: '停止',
  recover: '恢复',
}

const VIEW_NAME: Record<number, string> = {
  0: '右侧',
  45: '右前',
  90: '正面',
  135: '左前',
  180: '左侧',
  225: '左后',
  270: '背面',
  315: '右后',
}

type JointName =
  | 'head' | 'neck' | 'waist'
  | 'shoulderL' | 'elbowL' | 'wristL' | 'handL'
  | 'shoulderR' | 'elbowR' | 'wristR' | 'handR'
  | 'hipL' | 'kneeL' | 'ankleL' | 'footL'
  | 'hipR' | 'kneeR' | 'ankleR' | 'footR'

type Vec = { x: number; y: number }
type Vec3 = { x: number; y: number; z: number }

type Part = {
  bone: string
  a: JointName
  b: JointName
  image: HTMLImageElement
  ax: number
  ay: number
  bx: number
  by: number
  half: number
  mirror: boolean
  jax: number
  jay: number
  jbx: number
  jby: number
}

type Shot = {
  angle: number
  box: { x: number; y: number; w: number; h: number }
  parts: Part[]
}

const JOINT_BONE: Record<JointName, { bone: string; end: boolean }> = {
  head: { bone: 'head', end: true },
  neck: { bone: 'head', end: false },
  waist: { bone: 'pelvis', end: false },
  shoulderL: { bone: 'upperArmL', end: false },
  elbowL: { bone: 'lowerArmL', end: false },
  wristL: { bone: 'handL', end: false },
  handL: { bone: 'handL', end: true },
  shoulderR: { bone: 'upperArmR', end: false },
  elbowR: { bone: 'lowerArmR', end: false },
  wristR: { bone: 'handR', end: false },
  handR: { bone: 'handR', end: true },
  hipL: { bone: 'thighL', end: false },
  kneeL: { bone: 'shinL', end: false },
  ankleL: { bone: 'footL', end: false },
  footL: { bone: 'footL', end: true },
  hipR: { bone: 'thighR', end: false },
  kneeR: { bone: 'shinR', end: false },
  ankleR: { bone: 'footR', end: false },
  footR: { bone: 'footR', end: true },
}

const DEPTH_BIAS: Record<string, number> = {
  thighL: 0.05, shinL: 0.05, footL: 0.04,
  thighR: 0.05, shinR: 0.05, footR: 0.04,
  torso: 0,
  upperArmL: -0.03, lowerArmL: -0.04, handL: -0.05,
  upperArmR: -0.03, lowerArmR: -0.04, handR: -0.05,
  head: -0.07,
}

const solver = createSolver(createHumanoid(BODY))
const canvas = document.querySelector<HTMLCanvasElement>('#stage')!
const readout = document.querySelector<HTMLElement>('#readout')!
const count = solver.compiled.skeleton.boneCount
const fk = new Float32Array(count * 9)
const lateral = new Float32Array(count)
const boneIndex = new Map<string, number>()
for (const spec of Object.values(JOINT_BONE)) {
  if (!boneIndex.has(spec.bone)) boneIndex.set(spec.bone, findBone(solver.pose.skeleton, spec.bone))
}

const params = new URLSearchParams(location.search)
const queryView = Number(params.get('view') ?? 90)

let shots: Shot[] = []
let ready = false
let view: ViewIndex = isViewIndex(queryView) ? queryView : 90
let spinning = params.get('spin') !== '0'
let dragging = false
let playing = params.get('t') == null
if (!playing) {
  const pause = document.querySelector<HTMLButtonElement>('#pause')!
  pause.setAttribute('aria-pressed', 'true')
  pause.textContent = '继续'
}
let accumulator = 0
let last = performance.now()

evaluateFk(fk, lateral, solver.compiled, solver.pose, count)
const bindPose = snapshotJoints()

setIntent(params.get('gait') === 'walk' ? 1.2 : params.get('gait') === 'run' ? 3 : 0, false)
const jump = Number(params.get('t') ?? 0)
if (jump > 0) {
  for (let i = 0; i < Math.round(jump / DT); i += 1) stepSolver(solver, DT)
}
let before: RenderFrame = captureRenderFrame(solver)
let after: RenderFrame = before

const viewInput = document.querySelector<HTMLInputElement>('#view')!
const viewOut = document.querySelector<HTMLOutputElement>('#view-out')!
viewInput.addEventListener('input', () => applyView(Number(viewInput.value), true))
for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
  button.addEventListener('click', () => applyView(Number(button.dataset.view), true))
}
document.querySelector('#spin')!.addEventListener('click', () => {
  spinning = !spinning
  syncSpin()
})
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

canvas.addEventListener('pointerdown', (event) => {
  dragging = true
  canvas.setPointerCapture(event.pointerId)
  spinning = false
  syncSpin()
})
canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return
  applyView(view - event.movementX * 0.4, false)
})
canvas.addEventListener('pointerup', () => {
  dragging = false
})
canvas.addEventListener('pointercancel', () => {
  dragging = false
})
canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    applyView(view + Math.sign(event.deltaY) * 4, true)
  },
  { passive: false },
)

applyView(view, false)
syncSpin()
void loadShots()
requestAnimationFrame(frame)

async function loadShots(): Promise<void> {
  const response = await fetch('./spider-views/parts/parts.json')
  const data = (await response.json()) as {
    views: {
      angle: number
      box: [number, number, number, number]
      parts: {
        bone: string
        a: JointName
        b: JointName
        file: string
        ax: number
        ay: number
        bx: number
        by: number
        half: number
        mirror: boolean
        jax: number
        jay: number
        jbx: number
        jby: number
      }[]
    }[]
  }
  const images = new Map<string, HTMLImageElement>()
  shots = data.views
    .map((item) => ({
      angle: item.angle,
      box: { x: item.box[0], y: item.box[1], w: item.box[2], h: item.box[3] },
      parts: item.parts.map((part) => {
        let image = images.get(part.file)
        if (image === undefined) {
          image = new Image()
          image.src = `./spider-views/parts/${part.file}`
          images.set(part.file, image)
        }
        return { ...part, image }
      }),
    }))
    .sort((a, b) => a.angle - b.angle)
  await Promise.all(
    [...images.values()].map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete && image.naturalWidth > 0) resolve()
          else {
            image.onload = () => resolve()
            image.onerror = () => resolve()
          }
        }),
    ),
  )
  ready = [...images.values()].every((image) => image.naturalWidth > 0)
}

function setIntent(speed: number, resume = true): void {
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
  if (resume && !playing) {
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
      accumulator -= DT
    }
  }
  if (spinning && !dragging) applyView(view + elapsed * SPIN_DEG_PER_SEC, false)
  draw()
  writeReadout()
  requestAnimationFrame(frame)
}

function applyView(next: number, fromUser: boolean): void {
  const wrapped = ((Math.round(next) % 360) + 360) % 360
  view = isViewIndex(wrapped) ? wrapped : 0
  viewInput.value = String(view)
  viewOut.textContent = `${view}°`
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.view) === view))
  }
  if (fromUser) {
    spinning = false
    syncSpin()
  }
}

function syncSpin(): void {
  const button = document.querySelector('#spin')!
  button.setAttribute('aria-pressed', String(spinning))
  button.textContent = spinning ? '停止旋转' : '旋转'
}

function writeReadout(): void {
  if (!ready) {
    readout.textContent = '正在准备各角度贴图…'
    return
  }
  const shot = nearestShot(view)
  const mode = MODE[solver.gait.mode] ?? solver.gait.mode
  const facing = VIEW_NAME[view] ? ` ${VIEW_NAME[view]}` : ''
  readout.innerHTML = [
    `视角 <strong>${view}°</strong>${facing}`,
    `贴图 <strong>${shot.angle}°</strong>`,
    `模式 <strong>${mode}</strong>`,
  ].join(' · ')
}

function draw(): void {
  const ctx = canvas.getContext('2d')!
  const width = canvas.width
  const height = canvas.height
  ctx.clearRect(0, 0, width, height)
  if (!ready) return

  const alpha = Math.min(1, accumulator / DT)
  const sampled = sampleRender(solver.compiled, before, after, alpha)
  evaluateFk(fk, lateral, solver.compiled, sampled.pose, count)
  const shot = nearestShot(view)
  const body = height * 0.78
  const layout = { cx: width * 0.5, ground: height * 0.9, body, ppm: body / BODY }
  const shift = pelvisShift(layout.ppm)
  const scale = body / shot.box.h

  ctx.save()
  ctx.translate(shift.x, shift.y)
  ctx.strokeStyle = '#2a3544'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(40, layout.ground)
  ctx.lineTo(width - 40, layout.ground)
  ctx.stroke()
  ctx.fillStyle = '#000'
  ctx.globalAlpha = 0.38
  ctx.beginPath()
  ctx.ellipse(layout.cx, layout.ground + 6, shot.box.w * scale * 0.42, body * 0.035, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  const psi = (view * Math.PI) / 180
  const ordered = shot.parts.slice().sort((a, b) => depthOf(b, psi) - depthOf(a, psi))
  const placed: { file: string; jax: number; jay: number; x: number; y: number }[] = []
  for (const part of ordered) {
    const destA = screenJoint(shot, part.jax, part.jay, part.a, layout, scale)
    const stacked = placed.some(
      (item) =>
        item.file === part.image.src &&
        Math.hypot(item.jax - part.jax, item.jay - part.jay) < 2 &&
        Math.hypot(item.x - destA.x, item.y - destA.y) < 4,
    )
    if (stacked) continue
    placed.push({ file: part.image.src, jax: part.jax, jay: part.jay, x: destA.x, y: destA.y })
    paintPart(ctx, shot, part, layout, scale)
  }
  ctx.restore()
}

/** 骨盆相对站立参考的屏幕位移。肢体自己的弯折另算。 */
function pelvisShift(ppm: number): { x: number; y: number } {
  const pel = rawDelta('waist')
  const psi = (view * Math.PI) / 180
  return {
    x: (pel.x * Math.cos(psi) + pel.z * Math.sin(psi)) * ppm,
    y: -pel.y * ppm,
  }
}

function nearestShot(angle: number): Shot {
  let best = shots[0]!
  let bestDistance = 360
  for (const shot of shots) {
    const distance = Math.min(Math.abs(angle - shot.angle), 360 - Math.abs(angle - shot.angle))
    if (distance < bestDistance) {
      best = shot
      bestDistance = distance
    }
  }
  return best
}

function depthOf(part: Part, psi: number): number {
  const a = jointNow(part.a)
  const b = jointNow(part.b)
  const x = (a.x + b.x) / 2
  const z = (a.z + b.z) / 2
  return -x * Math.sin(psi) + z * Math.cos(psi) + (DEPTH_BIAS[part.bone] ?? 0)
}

function paintPart(
  ctx: CanvasRenderingContext2D,
  shot: Shot,
  part: Part,
  layout: { cx: number; ground: number; body: number; ppm: number },
  scale: number,
): void {
  const destA = screenJoint(shot, part.jax, part.jay, part.a, layout, scale)
  const destB = screenJoint(shot, part.jbx, part.jby, part.b, layout, scale)
  const sourceA = { x: part.ax, y: part.ay }
  const sourceB = { x: part.bx, y: part.by }
  paintLimb(ctx, part.image, sourceA, sourceB, destA, destB, scale, part.mirror)
}

function screenJoint(
  shot: Shot,
  imageX: number,
  imageY: number,
  name: JointName,
  layout: { cx: number; ground: number; body: number; ppm: number },
  scale: number,
): Vec {
  const restX = layout.cx - (shot.box.w * scale) / 2 + (imageX - shot.box.x) * scale
  const restY = layout.ground - shot.box.h * scale + (imageY - shot.box.y) * scale
  const moved = localDelta(name)
  const psi = (view * Math.PI) / 180
  return {
    x: restX + (moved.x * Math.cos(psi) + moved.z * Math.sin(psi)) * layout.ppm,
    y: restY - moved.y * layout.ppm,
  }
}

function paintLimb(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  iA: Vec,
  iB: Vec,
  sA: Vec,
  sB: Vec,
  pageScale: number,
  mirror: boolean,
): void {
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (width < 1 || height < 1) return
  const ri = boneFrame(iA, iB)
  const rs = boneFrame(sA, sB)
  const pinned = rs.len / ri.len
  const alongScale = Math.min(pageScale * 1.45, Math.max(pageScale * 0.72, pinned))
  const flip = mirror ? -1 : 1
  const map = (x: number, y: number): Vec => {
    const along = (x - ri.ax) * ri.ux + (y - ri.ay) * ri.uy
    const side = (x - ri.ax) * ri.px + (y - ri.ay) * ri.py
    return {
      x: rs.ax + along * alongScale * rs.ux + flip * side * pageScale * rs.px,
      y: rs.ay + along * alongScale * rs.uy + flip * side * pageScale * rs.py,
    }
  }
  const corners: readonly [number, number][] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ]
  const xy = corners.map(([x, y]) => map(x, y))
  const uv = corners.map(([x, y]) => ({ x, y }))
  paintTriangle(ctx, image, xy[0]!, xy[1]!, xy[2]!, uv[0]!, uv[1]!, uv[2]!)
  paintTriangle(ctx, image, xy[0]!, xy[2]!, xy[3]!, uv[0]!, uv[2]!, uv[3]!)
}

function boneFrame(a: Vec, b: Vec): {
  ax: number
  ay: number
  ux: number
  uy: number
  px: number
  py: number
  len: number
} {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  return { ax: a.x, ay: a.y, ux, uy, px: -uy, py: ux, len }
}

function paintTriangle(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  s0: Vec,
  s1: Vec,
  s2: Vec,
  i0: Vec,
  i1: Vec,
  i2: Vec,
): void {
  const du1 = i1.x - i0.x
  const dv1 = i1.y - i0.y
  const du2 = i2.x - i0.x
  const dv2 = i2.y - i0.y
  const det = du1 * dv2 - dv1 * du2
  if (Math.abs(det) < 1e-3) return
  const dx1 = s1.x - s0.x
  const dy1 = s1.y - s0.y
  const dx2 = s2.x - s0.x
  const dy2 = s2.y - s0.y
  const a = (dx1 * dv2 - dx2 * dv1) / det
  const c = (dx2 * du1 - dx1 * du2) / det
  const b = (dy1 * dv2 - dy2 * dv1) / det
  const d = (dy2 * du1 - dy1 * du2) / det
  const e = s0.x - a * i0.x - c * i0.y
  const f = s0.y - b * i0.x - d * i0.y
  const su = Math.max(0, Math.min(i0.x, i1.x, i2.x))
  const sv = Math.max(0, Math.min(i0.y, i1.y, i2.y))
  const eu = Math.min(image.naturalWidth, Math.max(i0.x, i1.x, i2.x))
  const ev = Math.min(image.naturalHeight, Math.max(i0.y, i1.y, i2.y))
  if (eu - su < 1 || ev - sv < 1) return
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(s0.x, s0.y)
  ctx.lineTo(s1.x, s1.y)
  ctx.lineTo(s2.x, s2.y)
  ctx.closePath()
  ctx.clip()
  ctx.transform(a, b, c, d, e, f)
  ctx.drawImage(image, su, sv, eu - su, ev - sv, su, sv, eu - su, ev - sv)
  ctx.restore()
}

function snapshotJoints(): Record<JointName, Vec3> {
  const out = {} as Record<JointName, Vec3>
  for (const name of Object.keys(JOINT_BONE) as JointName[]) out[name] = jointNow(name)
  return out
}

function jointNow(name: JointName): Vec3 {
  const spec = JOINT_BONE[name]
  const bone = boneIndex.get(spec.bone)!
  const base = bone * 9
  const x = fk[base + 6]!
  const y = fk[base + 7]!
  const z = lateral[bone]!
  if (!spec.end) return { x, y, z }
  const length = bindLength(solver.pose.skeleton, bone)
  return { x: x + fk[base]! * length, y: y + fk[base + 1]! * length, z }
}

function rawDelta(name: JointName): Vec3 {
  const now = jointNow(name)
  const rest = bindPose[name]
  return { x: now.x - rest.x, y: now.y - rest.y, z: now.z - rest.z }
}

function localDelta(name: JointName): Vec3 {
  const own = rawDelta(name)
  const root = rawDelta('waist')
  return { x: own.x - root.x, y: own.y - root.y, z: own.z - root.z }
}
