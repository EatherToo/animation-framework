/**
 * 预览用程序化图集：512×512 RGBA8 单页，每个身体部位一个 128×128 区域。
 * 只依赖 @animation-framework/render-engine 的公开类型，输出可直接交给后端 prepare()。
 *
 * 区域布局说明：18 根骨中 root 不参与绘制，pelvis/spine 使用同一块蓝色躯干纹理，
 * 因此 512×512 的 4×4 网格刚好容纳 16 个可视区域；其余每个骨名都有独立的
 * 128×128 AtlasRegion 映射，左右手/左右腿各自保留部位色。
 */

import type {
  AtlasData,
  AtlasPageDef,
  AtlasRegion,
  AtlasRect,
  MaterialDef,
  RGBA,
  RenderAssets,
  TextureData,
} from '@animation-framework/render-engine'

const PAGE_SIZE = 512
const CELL_SIZE = 128
const COLUMNS = 4
const MAX_MIP = 6

/** humanoid('simple2d') 的 18 根骨，顺序与 createHumanoid 稳定下标一致。 */
export const ATLAS_BONE_ORDER = [
  'root', 'pelvis', 'spine', 'chest', 'neck', 'head',
  'upperArmL', 'lowerArmL', 'handL',
  'upperArmR', 'lowerArmR', 'handR',
  'thighL', 'shinL', 'footL',
  'thighR', 'shinR', 'footR',
] as const

/** 每个区域对应的调色板代表骨；pelvis/spine 共用躯干块。 */
const CELL_BONE = [
  'pelvis', 'chest', 'neck', 'head',
  'upperArmL', 'lowerArmL', 'handL',
  'upperArmR', 'lowerArmR', 'handR',
  'thighL', 'shinL', 'footL',
  'thighR', 'shinR', 'footR',
] as const

/** 骨名 → 区域编号；root 复用 pelvis，pelvis/spine 共用蓝色躯干块。 */
const CELL_OF_BONE: Readonly<Record<string, number>> = {
  root: 0,
  pelvis: 0,
  spine: 0,
  chest: 1,
  neck: 2,
  head: 3,
  upperArmL: 4,
  lowerArmL: 5,
  handL: 6,
  upperArmR: 7,
  lowerArmR: 8,
  handR: 9,
  thighL: 10,
  shinL: 11,
  footL: 12,
  thighR: 13,
  shinR: 14,
  footR: 15,
}

/** 与 flat 模式共用的部位色，保证纹理/色块两种模式的观感一致。 */
export function partColorFor(name: string): RGBA {
  if (name === 'root') return { r: 0.93, g: 0.95, b: 1, a: 1 }
  if (name === 'head') return { r: 1, g: 0.82, b: 0.45, a: 1 }
  if (name === 'neck') return { r: 0.95, g: 0.72, b: 0.42, a: 1 }
  if (name === 'pelvis' || name === 'spine' || name === 'chest') {
    return { r: 0.30, g: 0.70, b: 0.98, a: 1 }
  }
  if (name.startsWith('hand')) {
    return name.endsWith('L') ? { r: 0.42, g: 0.92, b: 0.66, a: 1 } : { r: 1, g: 0.54, b: 0.56, a: 1 }
  }
  if (name.startsWith('upperArm') || name.startsWith('lowerArm')) {
    return name.endsWith('L') ? { r: 0.34, g: 0.84, b: 0.58, a: 1 } : { r: 0.96, g: 0.40, b: 0.44, a: 1 }
  }
  if (name.startsWith('thigh') || name.startsWith('shin') || name.startsWith('foot')) {
    return name.endsWith('L') ? { r: 0.54, g: 0.60, b: 0.98, a: 1 } : { r: 1, g: 0.64, b: 0.30, a: 1 }
  }
  return { r: 0.8, g: 0.8, b: 0.8, a: 1 }
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)
const toByte = (v: number): number => Math.min(255, Math.max(0, Math.round(clamp01(v) * 255)))

function writePixel(data: Uint8Array, x: number, y: number, r: number, g: number, b: number, a: number): void {
  const o = (y * PAGE_SIZE + x) * 4
  data[o] = toByte(r)
  data[o + 1] = toByte(g)
  data[o + 2] = toByte(b)
  data[o + 3] = toByte(a)
}

/** 深色底，避免未采样区域出现白色；页内所有 region 都会完整覆盖。 */
function fillBackground(data: Uint8Array): void {
  for (let y = 0; y < PAGE_SIZE; y += 1) {
    for (let x = 0; x < PAGE_SIZE; x += 1) writePixel(data, x, y, 16 / 255, 20 / 255, 28 / 255, 1)
  }
}

/** 一个 128×128 区域：部位色 + 棋盘格 + 斜条纹 + 渐变 + 亮边框。 */
function paintCell(data: Uint8Array, cell: number, boneName: string): void {
  const base = partColorFor(boneName)
  const originX = (cell % COLUMNS) * CELL_SIZE
  const originY = Math.floor(cell / COLUMNS) * CELL_SIZE
  for (let y = 0; y < CELL_SIZE; y += 1) {
    for (let x = 0; x < CELL_SIZE; x += 1) {
      const u = x / (CELL_SIZE - 1)
      const v = y / (CELL_SIZE - 1)
      const gradient = 0.72 + 0.28 * (1 - v) + 0.10 * u
      const checker = ((((x >> 4) + (y >> 4)) & 1) === 0 ? 1.16 : 0.86)
      const stripe = ((x + 2 * y + cell * 13) % 28) < 9 ? 1.18 : 1
      const border = x < 3 || y < 3 || x > CELL_SIZE - 4 || y > CELL_SIZE - 4 ? 1.5 : 1
      const sparkle = (x * 7 + y * 11 + cell * 5) % 97 === 0 ? 1.6 : 1
      const k = gradient * checker * stripe * border * sparkle
      const r = clamp01(base.r * k + 0.04)
      const g = clamp01(base.g * k + 0.04)
      const b = clamp01(base.b * k + 0.04)
      writePixel(data, originX + x, originY + y, r, g, b, 1)
    }
  }
}

function paintPage(): Uint8Array {
  const data = new Uint8Array(PAGE_SIZE * PAGE_SIZE * 4)
  fillBackground(data)
  for (let cell = 0; cell < CELL_BONE.length; cell += 1) {
    paintCell(data, cell, CELL_BONE[cell]!)
  }
  return data
}

function rectForCell(cell: number): AtlasRect {
  return {
    x: (cell % COLUMNS) * CELL_SIZE,
    y: Math.floor(cell / COLUMNS) * CELL_SIZE,
    width: CELL_SIZE,
    height: CELL_SIZE,
  }
}

/** 局部 0..1 → 页 UV；span 用 size-1 并在起点加半 texel，等价于四边各内缩半 texel。 */
function uvMatrixOf(rect: AtlasRect): Float32Array {
  const spanU = (rect.width - 1) / PAGE_SIZE
  const spanV = (rect.height - 1) / PAGE_SIZE
  const tx = (rect.x + 0.5) / PAGE_SIZE
  const ty = (rect.y + 0.5) / PAGE_SIZE
  return new Float32Array([spanU, 0, 0, spanV, tx, ty])
}

/** FNV-1a 64 位，只为内容键稳定，不承担加密职责。 */
function fnv1a(text: string): string {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export type ProceduralAtlas = {
  readonly data: AtlasData
  readonly texture: TextureData
  readonly assets: RenderAssets
}

/** 生成图集页、AtlasData 与后端 RenderAssets（sprite 材质 id=page+1=1）。 */
export function createProceduralAtlas(): ProceduralAtlas {
  const pixels = paintPage()
  const page: AtlasPageDef = Object.freeze({
    index: 0,
    width: PAGE_SIZE,
    height: PAGE_SIZE,
    image: Object.freeze({ width: PAGE_SIZE, height: PAGE_SIZE, data: pixels }),
  })

  const regions = new Map<string, AtlasRegion>()
  for (const name of ATLAS_BONE_ORDER) {
    const cell = CELL_OF_BONE[name]!
    const rect = rectForCell(cell)
    const region: AtlasRegion = Object.freeze({
      id: name,
      page: 0,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      uvMatrix: uvMatrixOf(rect),
      trim: Object.freeze({ offsetX: 0, offsetY: 0, sourceWidth: CELL_SIZE, sourceHeight: CELL_SIZE }),
      maxMip: MAX_MIP,
    })
    regions.set(name, region)
  }

  const signature = [
    `procedural:${PAGE_SIZE}x${PAGE_SIZE}:${CELL_SIZE}`,
    ...ATLAS_BONE_ORDER.map((name) => {
      const cell = CELL_OF_BONE[name]!
      const rect = rectForCell(cell)
      return `${name}@0:${rect.x},${rect.y},${rect.width},${rect.height}`
    }),
  ].join('|')

  const data: AtlasData = Object.freeze({
    format: 'dsh-2d-atlas',
    version: 1,
    hash: fnv1a(signature),
    pages: Object.freeze([page]),
    regions,
    pma: true,
    colorSpace: 'srgb',
    padding: 0,
    bleed: 0,
    source: 'procedural',
  })

  const texture: TextureData = Object.freeze({
    width: PAGE_SIZE,
    height: PAGE_SIZE,
    data: pixels,
    pma: true,
  })

  const materials: readonly MaterialDef[] = Object.freeze([
    { id: 0, kind: 'flat', page: -1, filter: 'linear' },
    { id: 1, kind: 'sprite', page: 0, filter: 'linear' },
  ])
  const assets: RenderAssets = Object.freeze({
    pages: Object.freeze([texture]),
    materials,
    maxTexturePages: 4,
  })

  return { data, texture, assets }
}

/**
 * 用于 clipping 的躯干矩形（world 空间，y 向上）。
 * 覆盖躯干与双肩；只作用在左臂时，远端前臂/手会被裁掉，留下近端上臂。
 */
export const bodyMaskPolygon: readonly number[] = [-0.38, 0.80, 0.38, 0.80, 0.38, 1.72, -0.38, 1.72]
