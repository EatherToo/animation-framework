import { BONE_NAMES, applyClavicleFollow, createHumanoid, type BoneId } from '@animation-framework/render-engine/body'
import { compileHumanoid, type CompiledRig } from '@animation-framework/render-engine/compile'
import { evaluateFk } from '@animation-framework/render-engine/fk'
import { fillProjected, type FilledPart } from '@animation-framework/render-engine/fill'
import { sampleTexture, textureProjected, triangleUv, type TexturedPart } from '@animation-framework/render-engine/texture'
import {
  createPose,
  findBone,
  setPoseRotation,
  setPoseSwing,
  setPoseTwist,
  type Pose,
} from '@animation-framework/render-engine/skeleton'
import { armOutlineBones, skinMesh } from '@animation-framework/render-engine/skin'
import { isArmPart } from '@animation-framework/render-engine/outline'
import { drawOrder } from '@animation-framework/render-engine/slot'
import {
  buildHandVolumeParts,
  buildVolumetricPackets,
  createHumanoidAtlas,
  paintPackets as paintPacketsBackend,
  rasterizeMask,
  sampleHumanoid2DAtlasPackets,
  type HumanoidAtlas,
  type RenderPacket,
} from '@animation-framework/render-engine/pipeline2d'
import { strokeContours, type StrokePart } from '@animation-framework/render-engine/stroke'
import { depthOrder, projectParts, type ProjectedPart, type ViewSource } from '@animation-framework/render-engine/view'
import { beginFrame, flatTriangle, shadedTriangle, type Surface } from './raster'
import { PacketWebGLRenderer } from './webgl2'

const HEIGHT = 1.8
const FRONT_VIEW = 90
const FACING = 1
const BACKGROUND = '#5c5c5c'
const STEP = 5
/** R0：默认按部件纯色出图；'texture' 才走逐三角诊断贴图。 */
function renderMode(): '2d' | 'volume' | 'webgl' | 'flat' | 'texture' {
  const mode = new URLSearchParams(window.location.search).get('mode')
  if (mode === '2d' || mode === 'volume' || mode === 'webgl' || mode === 'flat' || mode === 'texture') return mode
  return 'webgl'
}

function volumeView(): number {
  const raw = Number(new URLSearchParams(window.location.search).get('view') ?? FRONT_VIEW)
  if (!Number.isFinite(raw)) return FRONT_VIEW
  return ((Math.round(raw) % 360) + 360) % 360
}

type Axis = 'rotation' | 'swing' | 'twist'

type Control = {
  readonly id: string
  readonly bone: string
  readonly axis: Axis
  readonly group: string
  readonly label: string
  readonly min: number
  readonly max: number
}

const FINGER_LABEL: Record<string, string> = {
  thumb: '拇指',
  index: '示指',
  middle: '中指',
  ring: '无名指',
  pinky: '小指',
}

function fingerUi(name: string): { group: string; label: string } {
  const match = /^(thumb|index|middle|ring|pinky)([123])([LR])$/.exec(name)
  if (match === null) return { group: '手指', label: name }
  const side = match[3] === 'L' ? '左手' : '右手'
  const segment = match[1] === 'thumb'
    ? (match[2] === '1' ? '近节' : '远节')
    : (match[2] === '1' ? '近节' : match[2] === '2' ? '中节' : '远节')
  return { group: `${side} · 手指`, label: `${FINGER_LABEL[match[1]!]!} ${segment}` }
}

const BONE_UI: Record<BoneId, { group: string; label: string }> = {
  pelvis: { group: '躯干', label: '骨盆' },
  spine: { group: '躯干', label: '脊柱' },
  chest: { group: '躯干', label: '胸' },
  clavicleL: { group: '左肩', label: '锁骨' },
  clavicleR: { group: '右肩', label: '锁骨' },
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
let humanoidAtlas: HumanoidAtlas = createHumanoidAtlas()
const pose = createPose(humanoid.skeleton)

async function loadAtlas(): Promise<void> {
  try {
    const name = new URLSearchParams(window.location.search).get('atlas') ?? 'base'
    type Region = { id: string; x: number; y: number; width: number; height: number }
    type PageMeta = {
      image?: string
      page: { width: number; height: number; pma: boolean }
      padding: number
      regions: Region[]
    }
    type Meta = PageMeta & { pages?: PageMeta[] }
    const meta = await fetch(`atlas/${name}.json`, { cache: 'no-cache' }).then((response) => {
      if (!response.ok) throw new Error('atlas')
      return response.json() as Promise<Meta>
    })
    const metas: PageMeta[] = meta.pages ?? [meta]
    const pages: {
      atlas: { width: number; height: number; padding: number; pma: boolean; regions: Region[] }
      image: { width: number; height: number; rgba: Uint8Array; pma: boolean }
    }[] = []
    const regions = new Map<string, { page: number; region: Region }>()
    for (let page = 0; page < metas.length; page += 1) {
      const pageMeta = metas[page]!
      const source = pageMeta.image ?? `${name}.png`
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image()
        element.onload = () => resolve(element)
        element.onerror = () => reject(new Error('atlas image'))
        element.src = `atlas/${source}`
      })
      const canvas = document.createElement('canvas')
      canvas.width = pageMeta.page.width
      canvas.height = pageMeta.page.height
      const context = canvas.getContext('2d')
      if (context === null) throw new Error('atlas 2d')
      context.drawImage(image, 0, 0)
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data
      pages.push({
        atlas: {
          width: pageMeta.page.width,
          height: pageMeta.page.height,
          padding: pageMeta.padding,
          pma: pageMeta.page.pma,
          regions: pageMeta.regions,
        },
        image: {
          width: canvas.width,
          height: canvas.height,
          rgba: new Uint8Array(data.buffer.slice(0)),
          pma: pageMeta.page.pma,
        },
      })
      for (const region of pageMeta.regions) regions.set(region.id, { page, region })
    }
    humanoidAtlas = { pages, regions }
    ;(window as unknown as { __atlasPages: number }).__atlasPages = pages.length
    draw()
  } catch {
    // 程序化图集继续作为回退。
  }
}

void loadAtlas()
const fk = new Float32Array(humanoid.skeleton.boneCount * 12)
const controls = buildControls(compiled)
const tie = drawOrder(new Array<string>(compiled.slots.slots.length), compiled.slots, FACING)
const restFrame = contain(projectParts(sample(compiled, pose, fk), FRONT_VIEW))
const rest2DBounds = boundsOfPackets(sampleHumanoid2DAtlasPackets(compiled, pose, humanoidAtlas))
const sliders = new Map<string, HTMLInputElement>()
const readouts = new Map<string, HTMLElement>()
let texturesReady = renderMode() !== 'texture'

mountPose(panel)
new ResizeObserver(() => draw()).observe(canvas.parentElement ?? canvas)
if (renderMode() === 'texture') {
  void loadGrayTextures()
    .then(() => {
      texturesReady = true
      draw()
    })
    .catch((error: unknown) => showLoadError(error))
} else {
  texturesReady = true
  // 等布局完成再画；ResizeObserver / 首帧都会走到 draw。
  requestAnimationFrame(() => draw())
}

function showLoadError(error: unknown): void {
  const stage = canvas!.parentElement
  if (stage === null) return
  const note = document.createElement('pre')
  note.className = 'error'
  note.textContent =
    `${error instanceof Error ? error.message : String(error)}\n\n` +
    '纹理是按网格逐三角形生成的。先重建：pnpm --dir preview run build（或分步 build:engine / textures / bundle）。'
  stage.append(note)
}

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
    slider.dataset.bone = control.bone
    slider.dataset.axis = control.axis
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


type InstalledTexture = {
  readonly width: number
  readonly height: number
  readonly rgb: Uint8Array
}

/**
 * 取一个资源。并发下静态服务器偶发重置连接，这里重试几次再放弃。
 * @param url 相对地址
 * @param attempts 最多尝试次数
 */
async function fetchWithRetry(url: string, attempts = 4): Promise<Response> {
  let last: unknown = new Error(`取不到 ${url}`)
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      last = new Error(`${url} 返回 ${response.status}`)
    } catch (error) {
      last = error
    }
    await new Promise((resolve) => setTimeout(resolve, 80 * (i + 1)))
  }
  throw last instanceof Error ? last : new Error(String(last))
}

async function loadGrayTextures(): Promise<void> {
  const response = await fetchWithRetry('./textures/manifest.json')
  const manifest = (await response.json()) as {
    edge: number
    parts: readonly { partId: string; count: number }[]
  }
  const packed = await fetchWithRetry('./textures/packed.bin')
  const bytes = new Uint8Array(await packed.arrayBuffer())
  const total = manifest.parts.reduce((sum, part) => sum + part.count, 0)
  if (bytes.length !== total) {
    throw new Error(`纹理包与清单对不上：packed.bin ${bytes.length} 字节，清单 ${total} 张`)
  }

  const byId = new Map(compiled.meshes.meshes.map((mesh) => [mesh.partId, mesh]))
  let offset = 0
  for (const part of manifest.parts) {
    const mesh = byId.get(part.partId)
    if (mesh === undefined) throw new Error(`纹理清单里有未知部件：${part.partId}`)
    const triangles = mesh.indices.length / 3
    if (triangles !== part.count) {
      throw new Error(
        `纹理与网格对不上：${part.partId} 清单 ${part.count} 张，网格 ${triangles} 个三角形`,
      )
    }
    const textures: InstalledTexture[] = []
    for (let i = 0; i < part.count; i += 1) {
      const gray = bytes[offset + i]!
      const rgb = new Uint8Array(manifest.edge * manifest.edge * 3)
      rgb.fill(gray)
      textures.push({ width: manifest.edge, height: manifest.edge, rgb })
    }
    offset += part.count
    ;(mesh as unknown as { textures: InstalledTexture[] }).textures = textures
  }
}

/** 描边相对所属表面的深度偏置，让它压在自己的面上、又压不过更近的部件。 */
const DEPTH_BIAS = 1e-4
const VIEW_ANGLE = (FRONT_VIEW * Math.PI) / 180
const VIEW_COS = Math.cos(VIEW_ANGLE)
const VIEW_SIN = Math.sin(VIEW_ANGLE)
const STROKE_RGB = [20, 20, 20] as const
const BACKGROUND_RGB = [92, 92, 92] as const

function draw(): void {
  if (!texturesReady) return
  const stage = canvas!.parentElement
  const cssWidth = stage?.clientWidth ?? window.innerWidth
  const cssHeight = stage?.clientHeight ?? window.innerHeight
  if (cssWidth < 2 || cssHeight < 2) return
  const dpr = window.devicePixelRatio || 1
  const width = Math.max(1, Math.round(cssWidth * dpr))
  const height = Math.max(1, Math.round(cssHeight * dpr))
  canvas!.width = width
  canvas!.height = height
  canvas!.style.width = `${cssWidth}px`
  canvas!.style.height = `${cssHeight}px`

  applyPose()
  if (renderMode() === '2d') {
    draw2D(width, height)
    return
  }
  if (renderMode() === 'volume') {
    drawVolume(width, height)
    return
  }
  if (renderMode() === 'webgl') {
    drawWebGL(width, height)
    return
  }
  const sampled = sample(compiled, pose, fk)
  const projected = projectParts(sampled, FRONT_VIEW)
  const filled = fillProjected(
    projected,
    compiled.parts.parts.map((part) => part.fill),
  )
  const stroked = strokeContours(filled, true)
  const order = depthOrder(new Array<string>(projected.length), projected, tie)
  const frame = framing(projected, width, height)
  const depths = sampled.map((part, index) => projected[index]!.depths ?? vertexDepths(part.positions))
  const rawIndices = sampled.map((part) => part.indices)
  const partIndex = new Map(projected.map((part, index) => [part.partId, index]))

  const image = ctx!.getImageData(0, 0, width, height)
  const surface = beginFrame(width, height, image.data, BACKGROUND_RGB)
  if (renderMode() === 'texture') {
    paintTextures(textureProjected(compiled, projected), order, frame, surface, depths, rawIndices, partIndex)
  } else {
    paintFills(filled, order, frame, surface, depths, rawIndices, partIndex)
  }
  paintStrokes(stroked, order, frame, surface, projected, depths, partIndex)
  ctx!.putImageData(image, 0, 0)
}

/** 每个顶点的视图深度，越大越远；与 36 的正交投影用同一条公式。 */
function vertexDepths(positions: Float32Array): Float32Array {
  const out = new Float32Array(positions.length / 3)
  for (let v = 0; v < out.length; v += 1) {
    const x = positions[v * 3]!
    const z = positions[v * 3 + 2]!
    out[v] = z * VIEW_COS - x * VIEW_SIN
  }
  return out
}

/** R2：2D 渲染包 + 简单画法。描边暂用旧边表，R4 换屏幕 ribbon。 */
function buildShoulderMask(
  packets: readonly RenderPacket[],
  frame: Frame,
  width: number,
  height: number,
): Uint8Array | null {
  const torso = packets.find((packet) => packet.partId === 'torso')
  if (torso === undefined) return null
  const torsoMask = rasterizeMask(torso, width, height, {
    scale: frame.scale,
    originX: frame.originX,
    originY: frame.originY,
  })
  const mask = new Uint8Array(width * height)
  mask.fill(255)
  evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
  const radius = 0.1 * frame.scale
  for (const name of ['upperArmL', 'upperArmR']) {
    const bone = findBone(compiled.skeleton, name)
    if (bone < 0) continue
    const i = bone * 12
    const cx = frame.originX + fk[i + 11]! * frame.scale
    const cy = frame.originY - fk[i + 10]! * frame.scale
    const minX = Math.max(0, Math.floor(cx - radius))
    const maxX = Math.min(width - 1, Math.ceil(cx + radius))
    const minY = Math.max(0, Math.floor(cy - radius))
    const maxY = Math.min(height - 1, Math.ceil(cy + radius))
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x + 0.5 - cx
        const dy = y + 0.5 - cy
        if (dx * dx + dy * dy > radius * radius) continue
        if (torsoMask[y * width + x] !== 255) continue
        mask[y * width + x] = 0
      }
    }
  }
  return mask
}

function draw2D(width: number, height: number): void {
  if (webglRenderer !== null) webglRenderer.canvas.style.display = 'none'
  canvas!.style.visibility = 'visible'
  // 2D 用 Slot 主序 + 2×2 超采样；不读逐像素深度。
  const supersample = width * height <= 900_000 ? 2 : 1
  const bufferWidth = width * supersample
  const bufferHeight = height * supersample
  const pixels = new Uint8ClampedArray(bufferWidth * bufferHeight * 4)
  const packets = sampleHumanoid2DAtlasPackets(compiled, pose, humanoidAtlas)
  const bounds = boundsOfPackets(packets)
  const frame = framing2DBounds(bounds, bufferWidth, bufferHeight)
  const surface = beginFrame(bufferWidth, bufferHeight, pixels, BACKGROUND_RGB)
  const transform = { scale: frame.scale, originX: frame.originX, originY: frame.originY }
  const torso = packets.find((packet) => packet.partId === 'torso')
  const masks = new Map<string, Uint8Array>()
  const shoulderMask = buildShoulderMask(packets, frame, bufferWidth, bufferHeight)
  if (shoulderMask !== null) masks.set('shoulder', shoulderMask)
  paintPacketsBackend(surface, packets, {
    transform,
    atlas: { pages: humanoidAtlas.pages.map((page) => page.image), regions: humanoidAtlas.regions },
    masks,
    supersample,
    fillMode: 'triangle',
    edges: 'triangles',
    edgeWidthPx: 1,
  })
  const image = ctx!.getImageData(0, 0, width, height)
  downsample(pixels, bufferWidth, supersample, image.data, width, height)
  ctx!.putImageData(image, 0, 0)
}

let webglRenderer: PacketWebGLRenderer | null = null

function paintWebGL(
  packets: readonly RenderPacket[],
  frame: Frame,
  width: number,
  height: number,
  mask: Uint8Array | null,
): boolean {
  if (webglRenderer === null) {
    try {
      webglRenderer = new PacketWebGLRenderer()
      webglRenderer.canvas.style.position = 'absolute'
      webglRenderer.canvas.style.inset = '0'
      webglRenderer.canvas.style.display = 'none'
      webglRenderer.canvas.style.width = '100%'
      webglRenderer.canvas.style.height = '100%'
      canvas!.parentElement?.append(webglRenderer.canvas)
    } catch (error: unknown) {
      ;(window as unknown as { __webglError: string }).__webglError = String(error)
      return false
    }
  }
  webglRenderer.render(packets, humanoidAtlas, frame, width, height, mask)
  webglRenderer.canvas.style.display = 'block'
  canvas!.style.visibility = 'hidden'
  return true
}

function drawWebGL(width: number, height: number): void {
  const all = sampleHumanoid2DAtlasPackets(compiled, pose, humanoidAtlas)
  const params = new URLSearchParams(window.location.search)
  const only = params.get('only')
  let packets = only === null ? all : all.filter((packet) => packet.partId === only)
  if (params.get('nobridge') === '1') packets = packets.filter((packet) => packet.partId !== 'shoulderL' && packet.partId !== 'shoulderR')
  if (params.get('debug') === '1' && all[0] !== undefined) {
    const base = all[0]!
    packets = [{
      ...base,
      partId: 'debug',
      vertices: Float32Array.from([-1, -1, 1, -1, 1, 1, -1, 1]),
      uvs: new Float32Array(8),
      indices: Uint16Array.from([0, 1, 2, 0, 2, 3]),
      colors: new Uint8Array(16).fill(255),
      atlasPage: -1,
      mask: null,
      depth: new Float32Array(4),
      bounds: { x: -1, y: 0, width: 2, height: 2 },
    }]
  }
  const bounds = boundsOfPackets(packets)
  const frame = framing2DBounds(bounds, width, height)
  const transform = { scale: frame.scale, originX: frame.originX, originY: frame.originY }
  const mask = new URLSearchParams(window.location.search).get('nomask') === '1'
    ? null
    : buildShoulderMask(packets, frame, width, height)
  if (!paintWebGL(packets, frame, width, height, mask)) draw2D(width, height)
}

function drawVolume(width: number, height: number): void {
  const sampled = sample(compiled, pose, fk)
  const view = volumeView()
  const projected = projectParts(sampled, view).filter(
    (part) => part.partId !== 'handL' && part.partId !== 'handR',
  )
  const hands = [
    ...buildHandVolumeParts(compiled, fk, view, 'L'),
    ...buildHandVolumeParts(compiled, fk, view, 'R'),
  ]
  const packets = buildVolumetricPackets([...projected, ...hands])
  const bounds = boundsOfPackets(packets)
  const frame = framing2DBounds(bounds, width, height)
  if (paintWebGL(packets, frame, width, height, null)) return
  const image = ctx!.getImageData(0, 0, width, height)
  const surface = beginFrame(width, height, image.data, BACKGROUND_RGB)
  paintPacketsBackend(surface, packets, {
    transform: { scale: frame.scale, originX: frame.originX, originY: frame.originY },
    fillMode: 'triangle',
    edges: 'triangles',
    edgeWidthPx: 1,
    supersample: 1,
  })
  ctx!.putImageData(image, 0, 0)
}

function downsample(
  source: Uint8ClampedArray,
  sourceWidth: number,
  factor: number,
  target: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const i = ((y * factor + sy) * sourceWidth + (x * factor + sx)) * 4
          r += source[i]!
          g += source[i + 1]!
          b += source[i + 2]!
        }
      }
      const n = factor * factor
      const o = (y * width + x) * 4
      target[o] = r / n
      target[o + 1] = g / n
      target[o + 2] = b / n
      target[o + 3] = 255
    }
  }
}

function boundsOfPackets(packets: readonly RenderPacket[]): Bounds {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const packet of packets) {
    for (let i = 0; i < packet.vertices.length; i += 2) {
      minX = Math.min(minX, packet.vertices[i]!)
      maxX = Math.max(maxX, packet.vertices[i]!)
      minY = Math.min(minY, packet.vertices[i + 1]!)
      maxY = Math.max(maxY, packet.vertices[i + 1]!)
    }
  }
  return { minX, maxX, minY, maxY }
}

function framing2DBounds(bounds: Bounds, width: number, height: number): Frame {
  const current = fit(containBounds(bounds), width, height)
  const baseline = fit(containBounds(rest2DBounds), width, height)
  const scale = Math.min(current.scale, baseline.scale)
  const cx = (rest2DBounds.minX + rest2DBounds.maxX) / 2
  const cy = (rest2DBounds.minY + rest2DBounds.maxY) / 2
  return {
    ...containBounds(bounds),
    scale,
    originX: width / 2 - cx * scale,
    originY: height / 2 + cy * scale,
  }
}

function containBounds(bounds: Bounds): Bounds {
  const spanX = Math.max(1e-4, bounds.maxX - bounds.minX)
  const spanY = Math.max(1e-4, bounds.maxY - bounds.minY)
  return {
    minX: bounds.minX - spanX * 0.12,
    maxX: bounds.maxX + spanX * 0.12,
    minY: bounds.minY - spanY * 0.06,
    maxY: bounds.maxY + spanY * 0.06,
  }
}

function paintFills(
  parts: readonly FilledPart[],
  order: readonly string[],
  frame: Frame,
  surface: Surface,
  depths: readonly Float32Array[],
  rawIndices: readonly Uint16Array[],
  partIndex: ReadonlyMap<string, number>,
): void {
  const byId = new Map(parts.map((part) => [part.partId, part]))
  for (const id of order) {
    const part = byId.get(id)
    if (part === undefined) continue
    const index = partIndex.get(id)
    if (index === undefined) continue
    const depth = depths[index]!
    const raw = rawIndices[index]!
    const positions = part.positions
    const indices = part.indices
    const color: readonly [number, number, number] = [
      Math.round(part.fill.r * 255),
      Math.round(part.fill.g * 255),
      Math.round(part.fill.b * 255),
    ]
    for (let t = 0; t < indices.length; t += 3) {
      if (!isArmPart(part.partId) && backFacing(positions, raw, t)) continue
      const ia = indices[t]!
      const ib = indices[t + 1]!
      const ic = indices[t + 2]!
      shadedTriangle(
        surface,
        [
          frame.originX + positions[ia * 2]! * frame.scale,
          frame.originY - positions[ia * 2 + 1]! * frame.scale,
          frame.originX + positions[ib * 2]! * frame.scale,
          frame.originY - positions[ib * 2 + 1]! * frame.scale,
          frame.originX + positions[ic * 2]! * frame.scale,
          frame.originY - positions[ic * 2 + 1]! * frame.scale,
        ],
        [depth[ia]!, depth[ib]!, depth[ic]!],
        () => color,
      )
    }
  }
}

function paintTextures(
  parts: readonly TexturedPart[],
  order: readonly string[],
  frame: Frame,
  surface: Surface,
  depths: readonly Float32Array[],
  rawIndices: readonly Uint16Array[],
  partIndex: ReadonlyMap<string, number>,
): void {
  const uv = new Float32Array(2)
  const corners = new Float32Array(6)
  const byId = new Map(parts.map((part) => [part.partId, part]))
  for (let oi = 0; oi < order.length; oi += 1) {
    const id = order[oi]!
    const part = byId.get(id)
    if (part === undefined || part.textures.length === 0) continue
    const index = partIndex.get(id)
    if (index === undefined) continue
    const partDepth = depths[index]!
    const raw = rawIndices[index]!
    const positions = part.positions
    const indices = part.indices
    for (let t = 0; t < indices.length; t += 3) {
      if (backFacing(positions, raw, t)) continue
      const ia = indices[t]!
      const ib = indices[t + 1]!
      const ic = indices[t + 2]!
      const ax = frame.originX + positions[ia * 2]! * frame.scale
      const ay = frame.originY - positions[ia * 2 + 1]! * frame.scale
      const bx = frame.originX + positions[ib * 2]! * frame.scale
      const by = frame.originY - positions[ib * 2 + 1]! * frame.scale
      const cx = frame.originX + positions[ic * 2]! * frame.scale
      const cy = frame.originY - positions[ic * 2 + 1]! * frame.scale
      const texture = part.textures[part.triangleTexture[t / 3]!]
      if (texture === undefined) continue
      corners.set(part.uvs.subarray(t * 2, t * 2 + 6))
      shadedTriangle(
        surface,
        [ax, ay, bx, by, cx, cy],
        [partDepth[ia]!, partDepth[ib]!, partDepth[ic]!],
        (px, py) => {
          triangleUv(uv, ax, ay, bx, by, cx, cy, px, py, corners)
          const color = sampleTexture(texture, uv[0]!, uv[1]!)
          return [Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255)]
        },
      )
    }
  }
}

/** 用原始索引判朝向：`indices` 已被 36 翻成逆时针，不能用来判断正反面。 */
function backFacing(positions: Float32Array, raw: Uint16Array, t: number): boolean {
  const a = raw[t]!
  const b = raw[t + 1]!
  const c = raw[t + 2]!
  const ax = positions[a * 2]!
  const ay = positions[a * 2 + 1]!
  const bx = positions[b * 2]!
  const by = positions[b * 2 + 1]!
  const cx = positions[c * 2]!
  const cy = positions[c * 2 + 1]!
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) <= 0
}

function paintStrokes(
  parts: readonly StrokePart[],
  order: readonly string[],
  frame: Frame,
  surface: Surface,
  projected: readonly ProjectedPart[],
  depths: readonly Float32Array[],
  partIndex: ReadonlyMap<string, number>,
): void {
  const byId = new Map(parts.map((part) => [part.partId, part]))
  for (let oi = 0; oi < order.length; oi += 1) {
    const id = order[oi]!
    const part = byId.get(id)
    if (part === undefined) continue
    const index = partIndex.get(id)
    if (index === undefined) continue
    const screen = projected[index]!.positions
    const partDepth = depths[index]!
    for (const quad of part.quads) {
      const z = quadDepth(quad.positions, screen, partDepth) - DEPTH_BIAS
      const q = quad.indices
      const points = quad.positions
      const at = (i: number): [number, number] => [
        frame.originX + points[i * 2]! * frame.scale,
        frame.originY - points[i * 2 + 1]! * frame.scale,
      ]
      const p0 = at(q[0]!)
      const p1 = at(q[1]!)
      const p2 = at(q[2]!)
      const p3 = at(q[3]!)
      const p4 = at(q[4]!)
      const p5 = at(q[5]!)
      flatTriangle(surface, [p0[0], p0[1], p1[0], p1[1], p2[0], p2[1]], z, STROKE_RGB, false)
      flatTriangle(surface, [p3[0], p3[1], p4[0], p4[1], p5[0], p5[1]], z, STROKE_RGB, false)
    }
  }
}

/** 描边四边形的深度：取离它最近的投影顶点，近似这条边的远近。 */
function quadDepth(
  quad: Float32Array,
  screen: Float32Array,
  partDepth: Float32Array,
): number {
  const cx = (quad[0]! + quad[4]!) / 2
  const cy = (quad[1]! + quad[5]!) / 2
  let best = Number.POSITIVE_INFINITY
  let depth = 0
  for (let v = 0; v < partDepth.length; v += 1) {
    const dx = screen[v * 2]! - cx
    const dy = screen[v * 2 + 1]! - cy
    const distance = dx * dx + dy * dy
    if (distance < best) {
      best = distance
      depth = partDepth[v]!
    }
  }
  return Number.isFinite(best) ? depth : 0
}

/** 取景：按当前姿态收框，但最多放大到绑定姿态的比例，避免姿态收拢时被放大。 */
function framing(parts: readonly ProjectedPart[], width: number, height: number): Frame {
  const current = fit(contain(parts), width, height)
  const baseline = fit(restFrame, width, height)
  const scale = Math.min(current.scale, baseline.scale)
  const cx = (restFrame.minX + restFrame.maxX) / 2
  const cy = (restFrame.minY + restFrame.maxY) / 2
  return {
    ...restFrame,
    scale,
    originX: width / 2 - cx * scale,
    originY: height / 2 + cy * scale,
  }
}

function applyPose(): void {
  for (const control of controls) {
    const slider = sliders.get(control.id)
    const radians = ((slider === undefined ? 0 : Number(slider.value)) * Math.PI) / 180
    const bone = findBone(humanoid.skeleton, control.bone)
    if (control.axis === 'rotation') setPoseRotation(pose, bone, radians)
    else if (control.axis === 'swing') setPoseSwing(pose, bone, radians)
    else setPoseTwist(pose, bone, radians)
  }
  const preset = new URLSearchParams(window.location.search).get('pose')
  if (preset !== null) {
    const bone = (name: string): number => compiled.skeleton.name.indexOf(name)
    if (preset === 'arm-behind') {
      setPoseSwing(pose, bone('upperArmL'), -Math.PI / 2)
      setPoseRotation(pose, bone('lowerArmL'), 0.6)
    } else if (preset === 'arm-across') {
      setPoseRotation(pose, bone('upperArmL'), 1.2)
      setPoseSwing(pose, bone('upperArmL'), 0.9)
      setPoseRotation(pose, bone('lowerArmL'), -1.6)
    } else if (preset === 'cross-legs') {
      setPoseRotation(pose, bone('thighL'), 0.8)
      setPoseRotation(pose, bone('thighR'), -0.2)
    } else if (preset === 'elbow120') {
      setPoseRotation(pose, bone('lowerArmL'), 2.0)
    } else if (preset === 'wrist45') {
      setPoseRotation(pose, bone('handL'), 0.8)
    } else if (preset === 'arm90') {
      setPoseSwing(pose, bone('upperArmL'), Math.PI / 2)
    } else if (preset === 'tpose') {
      setPoseSwing(pose, bone('upperArmL'), Math.PI / 2)
      setPoseSwing(pose, bone('upperArmR'), Math.PI / 2)
    } else if (preset === 'fingers') {
      for (const name of ['index1L', 'index2L', 'index3L', 'middle1L', 'middle2L', 'middle3L']) {
        setPoseRotation(pose, bone(name), 1.1)
      }
    }
  }
  // 锁骨跟随是固定规则：每次写完姿态都要应用，不是可选项。
  applyClavicleFollow(pose, compiled)
}

function sample(rig: CompiledRig, current: Pose, rigFromBone: Float32Array): ViewSource[] {
  evaluateFk(rigFromBone, rig, current, rig.skeleton.boneCount)
  return rig.meshes.meshes.map((mesh, index) => {
    const positions = new Float32Array(mesh.positions.length)
    skinMesh(positions, rig, rigFromBone, index, current)
    if (isArmPart(mesh.partId)) {
      return {
        partId: mesh.partId,
        positions,
        indices: mesh.indices,
        seam: mesh.seam,
        arm: armOutlineBones(rig, rigFromBone, mesh.partId),
      }
    }
    return { partId: mesh.partId, positions, indices: mesh.indices, seam: mesh.seam }
  })
}

function buildControls(rig: CompiledRig): Control[] {
  const list: Control[] = []
  for (const joint of rig.joints) {
    const bone = BONE_NAMES[joint.bone]
    if (bone === undefined) continue
    // 锁骨是跟随驱动的，不给滑块，免得和自动规则打架。
    if (bone.startsWith('clavicle')) continue
    const ui = BONE_UI[bone]
    addAxis(list, bone, ui, 'rotation', 1, joint.rotation)
    addAxis(list, bone, ui, 'swing', joint.swingSign, joint.swing)
    addAxis(list, bone, ui, 'twist', joint.twistSign, joint.twist)
  }
  for (const joint of rig.joints) {
    if (BONE_NAMES[joint.bone] !== undefined) continue
    const name = rig.skeleton.name[joint.bone]
    if (name === undefined || !/^(thumb|index|middle|ring|pinky)[123][LR]$/.test(name)) continue
    addAxis(list, name, fingerUi(name), 'rotation', 1, joint.rotation)
  }
  return list
}

function addAxis(
  list: Control[],
  bone: string,
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

function degrees(radians: number): number {
  return Math.round((radians * 180) / Math.PI)
}

function formatDeg(value: number): string {
  if (value < 0) return `−${Math.abs(value)}°`
  if (value > 0) return `+${value}°`
  return '0°'
}

;(window as unknown as { __draw: () => void; __webgl: () => boolean }).__draw = draw
;(window as unknown as { __draw: () => void; __webgl: () => boolean; __webglRenderer: PacketWebGLRenderer | null }).__webgl = () => webglRenderer !== null
Object.defineProperty(window, '__webglRenderer', { get: () => webglRenderer })
