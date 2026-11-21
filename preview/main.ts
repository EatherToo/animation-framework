/** 预览入口：只使用 @animation-framework/render-engine 的新 API。 */

import { CpuBackend, WebGL2Backend, type RenderFrame } from '@animation-framework/render-engine'
import {
  BONE_LABEL,
  SLIDER_BONES,
  applyPose,
  buildFrame,
  createScene,
  setHighlight,
  type Scene,
  type SliderBone,
} from './core2d'

const BG = [24, 28, 38, 255] as const

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (element === null) throw new Error(`index.html 缺少 ${selector}`)
  return element
}

const view = required<HTMLCanvasElement>('#view')
const runtimeInfo = required<HTMLElement>('#runtimeInfo')
const panel = required<HTMLElement>('#composerControls')
const resetBtn = required<HTMLButtonElement>('#reset')
const errorBox = document.querySelector<HTMLElement>('#error')

function showError(err: unknown): void {
  const text = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
  if (errorBox !== null) {
    errorBox.hidden = false
    errorBox.textContent = `预览运行失败：\n${text}`
  }
  console.error(err)
}
window.addEventListener('error', (event) => showError(event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => showError(event.reason))

const params = new URLSearchParams(location.search)
const mode = params.get('mode') === 'webgl' ? 'webgl' : 'cpu'
const poseParam = params.get('pose')
const poseKind = poseParam === 'walk' || poseParam === 'raise' ? poseParam : 'tpose'
const speedParam = Number(params.get('speed') ?? '1')
const speed = Number.isFinite(speedParam) ? speedParam : 1
const useTexture = params.get('texture') !== '0'
const useMask = params.get('mask') === '1'

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (shader === null) throw new Error('WebGL2: createShader 失败')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? ''
    gl.deleteShader(shader)
    throw new Error(`WebGL2 shader 编译失败：${log}`)
  }
  return shader
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  // aPosition 约定：world 空间顶点（RenderPacket 契约）。引擎 viewProjection2D 产生的
  // mat3 先把它映射到设备像素，shader 内再转裁剪空间；也可在 CPU 侧预变换成像素空间后
  // 去掉 viewProjection，这里选择前者。
  const vs = `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aUv;
in vec4 aColor;
uniform mat3 viewProjection;
uniform vec2 uResolution;
out vec2 vUv;
out vec4 vColor;
void main() {
  vec3 pixel = viewProjection * vec3(aPosition, 1.0);
  vec2 ndc = vec2(pixel.x / uResolution.x * 2.0 - 1.0,
                  1.0 - pixel.y / uResolution.y * 2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
  vUv = aUv;
  vColor = aColor;
}`
  const fs = `#version 300 es
precision mediump float;
in vec2 vUv;
in vec4 vColor;
uniform sampler2D uTexture;
uniform int uUseTexture;
out vec4 outColor;
void main() {
  // 顶点色与图集页都在 PMA 域；调制后用 ONE / ONE_MINUS_SRC_ALPHA 合成。
  vec4 texel = uUseTexture == 1 ? texture(uTexture, vUv) : vec4(1.0);
  outColor = vColor * texel;
}`
  const program = gl.createProgram()
  if (program === null) throw new Error('WebGL2: createProgram 失败')
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vs)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fs)
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? ''
    gl.deleteProgram(program)
    throw new Error(`WebGL2 program 链接失败：${log}`)
  }
  return program
}

function resizeCanvas(): void {
  const w = Math.max(1, Math.floor(view.clientWidth))
  const h = Math.max(1, Math.floor(view.clientHeight))
  if (view.width !== w || view.height !== h) {
    view.width = w
    view.height = h
  }
}

function webglFrame(frame: RenderFrame): RenderFrame {
  // WebGL2Backend 固定用 UNSIGNED_INT 调 drawElements，索引需为 Uint32。
  return {
    ...frame,
    packets: frame.packets.map((packet) => ({
      ...packet,
      indices: packet.indices instanceof Uint32Array ? packet.indices : new Uint32Array(packet.indices),
    })),
  }
}

function boot(): void {
  const scene: Scene = createScene(speed)
  const offsets: Partial<Record<SliderBone, number>> = {}

  const ranges: HTMLInputElement[] = []
  for (const name of SLIDER_BONES) {
    const row = document.createElement('div')
    row.className = 'joint'
    const label = document.createElement('label')
    label.textContent = BONE_LABEL[name]
    const value = document.createElement('span')
    value.className = 'value'
    value.textContent = '0°'
    const range = document.createElement('input')
    range.type = 'range'
    range.min = '-180'
    range.max = '180'
    range.step = '1'
    range.value = '0'
    range.setAttribute('aria-label', BONE_LABEL[name])
    range.addEventListener('input', () => {
      const degrees = Number(range.value)
      offsets[name] = (degrees * Math.PI) / 180
      value.textContent = `${degrees}°`
      setHighlight(scene, name)
    })
    row.append(label, value, range)
    panel.append(row)
    ranges.push(range)
  }

  resetBtn.addEventListener('click', () => {
    for (const name of SLIDER_BONES) offsets[name] = 0
    for (const range of ranges) {
      range.value = '0'
      const row = range.parentElement
      const value = row?.querySelector<HTMLElement>('.value')
      if (value !== null && value !== undefined) value.textContent = '0°'
    }
    scene.walkTrack.time = 0
    scene.walkTrack.lastTime = 0
    scene.walkTrack.loopCount = 0
    setHighlight(scene, null)
    applyPose(scene, poseKind, offsets, 0)
  })

  const ctx2d = mode === 'cpu' ? view.getContext('2d', { alpha: false }) : null
  if (mode === 'cpu' && ctx2d === null) throw new Error('无法获取 2D 上下文')
  const gl = mode === 'webgl' ? view.getContext('webgl2', { alpha: false, antialias: true, stencil: true }) : null
  if (mode === 'webgl' && gl === null) throw new Error('当前浏览器/环境不支持 WebGL2')

  let program: WebGLProgram | null = null
  let resolutionLocation: WebGLUniformLocation | null = null
  let textureLocation: WebGLUniformLocation | null = null
  if (mode === 'webgl' && gl !== null) {
    program = createProgram(gl)
    resolutionLocation = gl.getUniformLocation(program, 'uResolution')
    if (resolutionLocation === null) throw new Error('WebGL2: 找不到 uResolution')
    textureLocation = gl.getUniformLocation(program, 'uTexture')
    if (textureLocation === null) throw new Error('WebGL2: 找不到 uTexture')
    const vao = gl.createVertexArray()
    if (vao !== null) gl.bindVertexArray(vao)
    gl.enable(gl.BLEND)
    // aColor / 图集页都在 PMA 域；这里用 ONE / ONE_MINUS_SRC_ALPHA 合成。
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }

  const backend = mode === 'webgl'
    ? new WebGL2Backend(gl!, program!)
    : new CpuBackend({ width: 1, height: 1, background: BG })

  // WebGL2 的纹理只在 prepare() 时上传；CPU 只需缓存引用。
  let assetsPrepared = false

  let last = 0
  const tick = (now: number): void => {
    try {
      const dt = last === 0 ? 0 : Math.min(0.05, (now - last) / 1000)
      last = now
      resizeCanvas()
      const width = view.width
      const height = view.height
      applyPose(scene, poseKind, offsets, dt)
      const frame = buildFrame(scene, width, height, { texture: useTexture, mask: useMask })
      if (!assetsPrepared && frame.assets !== undefined) {
        backend.prepare?.(frame.assets)
        assetsPrepared = true
      }

      if (mode === 'cpu' && ctx2d !== null) {
        backend.draw(frame)
        const pixels = new Uint8ClampedArray(backend.readPixels())
        ctx2d.putImageData(new ImageData(pixels, width, height), 0, 0)
      } else if (mode === 'webgl' && gl !== null && program !== null) {
        gl.viewport(0, 0, width, height)
        gl.clearColor(BG[0] / 255, BG[1] / 255, BG[2] / 255, 1)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
        gl.useProgram(program)
        gl.uniform2f(resolutionLocation, width, height)
        gl.uniform1i(textureLocation, 0)
        backend.draw(webglFrame(frame))
      }
      runtimeInfo.textContent =
        `后端 ${mode} · 姿态 ${poseKind} · 速度 ${speed} · 纹理 ${useTexture ? 'atlas' : 'flat'} · ` +
        `mask ${useMask ? 'left-arm' : 'off'} · 骨骼 ${scene.skeleton.count} · ` +
        `packets ${backend.stats.packets} · drawCalls ${backend.stats.drawCalls}`
    } catch (err) {
      showError(err)
      return
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

try {
  boot()
} catch (err) {
  showError(err)
}
