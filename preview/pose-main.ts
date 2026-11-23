import { CpuBackend } from '@animation-framework/render-engine'
import { loadSpineScene } from './spine-scene'

const joints = [
  ['head', '头部', 5],
  ['neck', '颈部', 0],
  ['torso', '躯干', -5],
  ['front-shoulder', '前肩', -35],
  ['front-upper-arm', '前上臂', 20],
  ['front-bracer', '前小臂', 0],
  ['back-shoulder', '后肩', 35],
  ['rear-upper-arm', '后上臂', -20],
  ['rear-bracer', '后小臂', 0],
  ['front-thigh', '前大腿', 15],
  ['front-shin', '前小腿', 0],
  ['rear-thigh', '后大腿', -15],
  ['rear-shin', '后小腿', 0],
] as const

const canvas = document.querySelector<HTMLCanvasElement>('#view')!
const controls = document.querySelector<HTMLElement>('#controls')!
const errorBox = document.querySelector<HTMLElement>('#error')!
const context = canvas.getContext('2d', { alpha: false })!
const backend = new CpuBackend({ width: 1, height: 1, background: [25, 27, 34, 255] })

async function start(): Promise<void> {
  const scene = await loadSpineScene('spineboy')
  if (!scene) throw new Error('缺少 Spineboy 素材，请先运行 pnpm fetch:spine-samples')
  window.addEventListener('pagehide', () => { scene.dispose(); backend.dispose() }, { once: true })
  const sliders = new Map<string, HTMLInputElement>()
  let scheduled = false
  let prepared: ReturnType<typeof scene.frame>['assets']
  function draw(): void {
    scheduled = false
    const width = Math.max(1, Math.floor(canvas.clientWidth))
    const height = Math.max(1, Math.floor(canvas.clientHeight))
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    const frame = scene!.frame(width, height)
    if (frame.assets !== undefined && frame.assets !== prepared) {
      backend.prepare?.(frame.assets)
      prepared = frame.assets
    }
    backend.draw(frame)
    context.putImageData(new ImageData(new Uint8ClampedArray(backend.readPixels()), width, height), 0, 0)
  }
  function schedule(): void {
    if (!scheduled) { scheduled = true; requestAnimationFrame(() => { try { draw() } catch (error) { showError(error) } }) }
  }
  for (const [name, label] of joints) {
    if (!scene.boneNames.includes(name)) continue
    const row = document.createElement('label')
    row.className = 'joint'
    const title = document.createElement('span')
    title.textContent = label
    const output = document.createElement('output')
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = '-90'
    slider.max = '90'
    slider.step = '1'
    slider.setAttribute('aria-label', `${label}旋转`)
    slider.addEventListener('input', () => {
      const value = Number(slider.value)
      output.textContent = `${value}°`
      scene.setBoneRotation(name, value)
      schedule()
    })
    row.append(title, output, slider)
    controls.append(row)
    sliders.set(name, slider)
  }
  function preset(approximate: boolean): void {
    scene!.resetBoneRotations()
    for (const [name, , angle] of joints) {
      const slider = sliders.get(name)
      if (!slider) continue
      slider.value = String(approximate ? angle : 0)
      slider.dispatchEvent(new Event('input'))
    }
    schedule()
  }
  document.querySelector('#approx')!.addEventListener('click', () => preset(true))
  document.querySelector('#original')!.addEventListener('click', () => preset(false))
  document.querySelector('#reset')!.addEventListener('click', () => preset(false))
  new ResizeObserver(schedule).observe(canvas)
  preset(true)
}
function showError(error: unknown): void {
  errorBox.hidden = false
  errorBox.textContent = error instanceof Error ? error.message : String(error)
  console.error(error)
}
start().catch(showError)
