import { createHumanoid } from '@animation-framework/render-engine/body/assemble'
import { compileHumanoid } from '@animation-framework/render-engine/compile/compile'
import { evaluateFk } from '@animation-framework/render-engine/fk/evaluate'
import { fillProjected, type FilledPart } from '@animation-framework/render-engine/fill/fill'
import { skinMesh } from '@animation-framework/render-engine/skin/skin'
import { createPose, setPoseRotation, zeroPose, type Pose } from '@animation-framework/render-engine/skeleton/pose'
import { findBone } from '@animation-framework/render-engine/skeleton/skeleton'
import { drawOrder } from '@animation-framework/render-engine/slot/slot'
import { depthOrder, projectParts, type ViewIndex } from '@animation-framework/render-engine/view/project'

const JOINTS: readonly { bone: string; label: string }[] = [
  { bone: 'thighL', label: '左大腿' },
  { bone: 'shinL', label: '左小腿' },
  { bone: 'footL', label: '左脚' },
  { bone: 'thighR', label: '右大腿' },
  { bone: 'shinR', label: '右小腿' },
  { bone: 'footR', label: '右脚' },
  { bone: 'upperArmL', label: '左上臂' },
  { bone: 'lowerArmL', label: '左前臂' },
  { bone: 'upperArmR', label: '右上臂' },
  { bone: 'lowerArmR', label: '右前臂' },
  { bone: 'spine', label: '脊柱' },
  { bone: 'chest', label: '胸' },
]

const humanoid = createHumanoid(1.7)
const compiled = compileHumanoid(humanoid)
const pose = createPose(compiled.skeleton)
const restPose = createPose(compiled.skeleton)
const fills = compiled.parts.parts.map((part) => part.fill)
const tie = drawOrder(new Array<string>(compiled.slots.slots.length), compiled.slots, 1)
let view: ViewIndex = 0

const restCanvas = document.querySelector<HTMLCanvasElement>('#rest')!
const posedCanvas = document.querySelector<HTMLCanvasElement>('#posed')!
const readout = document.querySelector<HTMLElement>('#readout')!
const controls = document.querySelector<HTMLElement>('#controls')!
const sliders = new Map<string, HTMLInputElement>()

for (const joint of JOINTS) {
  const label = document.createElement('label')
  const name = document.createElement('span')
  name.textContent = joint.label
  const input = document.createElement('input')
  input.type = 'range'
  input.min = '-2.5'
  input.max = '2.5'
  input.step = '0.01'
  input.value = '0'
  const output = document.createElement('output')
  output.textContent = '0.00'
  input.addEventListener('input', () => {
    output.textContent = Number(input.value).toFixed(2)
    setPoseRotation(pose, findBone(compiled.skeleton, joint.bone), Number(input.value))
    paint()
  })
  label.append(name, input, output)
  controls.append(label)
  sliders.set(joint.bone, input)
}

document.querySelector('#stand')!.addEventListener('click', () => {
  zeroPose(pose)
  syncSliders()
  paint()
})

document.querySelector('#knee')!.addEventListener('click', () => {
  zeroPose(pose)
  setPoseRotation(pose, findBone(compiled.skeleton, 'shinL'), -0.8)
  syncSliders()
  paint()
})

document.querySelector('#face-pos')!.addEventListener('click', () => setView(0))
document.querySelector('#face-neg')!.addEventListener('click', () => setView(180))

if (new URLSearchParams(location.search).get('pose') === 'knee') {
  setPoseRotation(pose, findBone(compiled.skeleton, 'shinL'), -0.8)
  syncSliders()
}

paint()

function setView(next: ViewIndex): void {
  view = next
  document.querySelector('#face-pos')!.setAttribute('aria-pressed', String(next === 0))
  document.querySelector('#face-neg')!.setAttribute('aria-pressed', String(next === 180))
  paint()
}

/** 蒙皮、按当前视角投影、配色，并排好远近。 */
function present(current: Pose): { filled: FilledPart[]; order: string[] } {
  const count = compiled.skeleton.boneCount
  const fk = new Float32Array(count * 9)
  const lateral = new Float32Array(count)
  evaluateFk(fk, lateral, compiled, current, count)
  const skinned = compiled.meshes.meshes.map((mesh, index) => {
    const positions = new Float32Array(mesh.positions.length)
    skinMesh(positions, compiled, fk, lateral, index)
    return { partId: mesh.partId, positions, indices: mesh.indices }
  })
  const projected = projectParts(skinned, view)
  return {
    filled: fillProjected(projected, fills),
    order: depthOrder(new Array<string>(projected.length), projected, tie),
  }
}

function syncSliders(): void {
  for (const joint of JOINTS) {
    const input = sliders.get(joint.bone)!
    const value = pose.data[findBone(compiled.skeleton, joint.bone) * 3 + 2] ?? 0
    input.value = String(value)
    input.nextElementSibling!.textContent = value.toFixed(2)
  }
}

function paint(): void {
  const rest = present(restPose)
  const posed = present(pose)
  draw(restCanvas, rest.filled, rest.order, '绑定')
  draw(posedCanvas, posed.filled, posed.order, '当前')
  const leg = displacement(rest.filled, posed.filled, 'legL')
  readout.innerHTML = `视角 <strong>${view}°</strong>，从角色${view === 0 ? '右' : '左'}侧看，近的部件画在上层。左腿相对绑定姿态的最大顶点位移 <strong>${leg.toFixed(3)} m</strong>。测试要求这个数大于 0.001。`
}

function displacement(before: FilledPart[], after: FilledPart[], partId: string): number {
  const a = before.find((part) => part.partId === partId)!
  const b = after.find((part) => part.partId === partId)!
  let max = 0
  for (let i = 0; i < a.positions.length; i += 2) {
    const dx = a.positions[i]! - b.positions[i]!
    const dy = a.positions[i + 1]! - b.positions[i + 1]!
    max = Math.max(max, Math.hypot(dx, dy))
  }
  return max
}

function draw(
  canvas: HTMLCanvasElement,
  parts: FilledPart[],
  order: readonly string[],
  title: string,
): void {
  const ctx = canvas.getContext('2d')!
  const width = canvas.width
  const height = canvas.height
  ctx.clearRect(0, 0, width, height)
  const x0 = view === 0 ? -0.55 : -0.85
  const x1 = view === 0 ? 0.85 : 0.55
  const y0 = -0.2
  const y1 = 1.95
  const scale = Math.min((width - 48) / (x1 - x0), (height - 48) / (y1 - y0))
  const originX = 24 - x0 * scale
  const originY = height - 24 + y0 * scale
  ctx.save()
  ctx.translate(originX, originY)
  ctx.scale(scale, -scale)
  ctx.beginPath()
  ctx.moveTo(x0, 0)
  ctx.lineTo(x1, 0)
  ctx.lineWidth = 1 / scale
  ctx.strokeStyle = '#b7c3d0'
  ctx.stroke()
  for (const partId of order) {
    const part = parts.find((item) => item.partId === partId)
    if (part === undefined) continue
    const { r, g, b } = part.fill
    ctx.fillStyle = `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`
    ctx.beginPath()
    const positions = part.positions
    const indices = part.indices
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]! * 2
      const bIndex = indices[i + 1]! * 2
      const c = indices[i + 2]! * 2
      ctx.moveTo(positions[a]!, positions[a + 1]!)
      ctx.lineTo(positions[bIndex]!, positions[bIndex + 1]!)
      ctx.lineTo(positions[c]!, positions[c + 1]!)
      ctx.closePath()
    }
    ctx.fill()
  }
  ctx.restore()
  ctx.fillStyle = '#5c6b7a'
  ctx.font = '13px Palatino, serif'
  ctx.fillText(title, 16, 22)
}
