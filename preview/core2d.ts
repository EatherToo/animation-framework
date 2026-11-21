/**
 * 预览与离线校验共用的 core2d 场景构建。
 * 只调用 @animation-framework/render-engine 的新 API，不依赖 DOM。
 */

import {
  CH_X,
  CH_Y,
  addRotation,
  buildMaskSet,
  buildRegionPacket,
  createHumanoid,
  createPose,
  createSlotSet,
  createTrack,
  DEFAULT_CAMERA,
  resetToSetup,
  resolveAttachment,
  sampleAnimation,
  setLocal,
  setSlotColor,
  sortPackets,
  transformAffineInto,
  updateWorld,
  viewProjection2D,
  type AnimationClip,
  type Attachment,
  type AtlasData,
  type AtlasRegion,
  type Camera,
  type CompiledSkeleton,
  type Pose,
  type RenderAssets,
  type RenderFrame,
  type RenderMask,
  type RenderPacket,
  type RGBA,
  type ScalarKey,
  type SkinData,
  type SlotData,
  type SlotSet,
  type Track,
} from '@animation-framework/render-engine'
import { bodyMaskPolygon, createProceduralAtlas, partColorFor } from './procedural-atlas'

export type PoseKind = 'tpose' | 'walk' | 'raise'
export const SLIDER_BONES = ['upperArmR', 'lowerArmR', 'upperArmL', 'thighR', 'thighL'] as const
export type SliderBone = typeof SLIDER_BONES[number]

export const BONE_LABEL: Readonly<Record<SliderBone, string>> = {
  upperArmR: '右上臂',
  lowerArmR: '右前臂',
  upperArmL: '左上臂',
  thighR: '右大腿',
  thighL: '左大腿',
}

export type Scene = {
  readonly skeleton: CompiledSkeleton
  readonly pose: Pose
  readonly slotSet: SlotSet
  readonly baseColors: readonly RGBA[]
  /** 程序化图集与后端资产；flat 模式只使用材质 0。 */
  readonly atlas: AtlasData
  readonly assets: RenderAssets
  /** walk 模式用的可复用 track；speed 在 createScene 时写入。 */
  readonly walkTrack: Track
}

function widthForBone(name: string): number {
  if (name === 'head') return 0.24
  if (name === 'neck') return 0.07
  if (name === 'pelvis' || name === 'spine' || name === 'chest') return 0.16
  if (name.startsWith('thigh') || name.startsWith('shin')) return 0.09
  if (name.startsWith('foot')) return 0.07
  if (name.startsWith('hand')) return 0.07
  return 0.06
}

function keys(points: ReadonlyArray<readonly [number, number]>): ScalarKey[] {
  return points.map(([time, value]) => ({ time, value, curve: 'easeSine' as const }))
}

/** walk: rotate/translate 时间轴写相对 setup 的 swing 增量，upright 基准随后叠加。 */
function createWalkClip(): AnimationClip {
  return {
    name: 'walk',
    duration: 1,
    timelines: [
      { kind: 'rotate', path: 'thighL', keys: keys([[0, 0.45], [0.5, -0.45], [1, 0.45]]) },
      { kind: 'rotate', path: 'thighR', keys: keys([[0, -0.45], [0.5, 0.45], [1, -0.45]]) },
      { kind: 'rotate', path: 'shinL', keys: keys([[0, 0], [0.25, 0.38], [0.5, 0.05], [0.75, 0.12], [1, 0]]) },
      { kind: 'rotate', path: 'shinR', keys: keys([[0, 0.12], [0.25, 0], [0.5, 0.38], [0.75, 0.05], [1, 0.12]]) },
      { kind: 'rotate', path: 'upperArmL', keys: keys([[0, 0.32], [0.5, -0.32], [1, 0.32]]) },
      { kind: 'rotate', path: 'upperArmR', keys: keys([[0, -0.32], [0.5, 0.32], [1, -0.32]]) },
      { kind: 'translate', path: 'pelvis.y', keys: keys([[0, 0], [0.25, 0.025], [0.5, 0], [0.75, 0.025], [1, 0]]) },
    ],
  }
}

export function createScene(speed: number): Scene {
  const skeleton = createHumanoid('simple2d') // 18 骨
  const pose = createPose(skeleton)
  const procedural = createProceduralAtlas()
  const slots: SlotData[] = []
  const attachments = new Map<string, Attachment>()
  const baseColors: RGBA[] = []
  for (const bone of skeleton.bones) {
    const color = partColorFor(bone.name)
    baseColors.push(color)
    slots.push({
      id: bone.name,
      bone: bone.id,
      order: bone.id,
      color,
      blend: 'normal',
      attachment: bone.name,
      mask: null,
      zOffset: 0,
    })
    attachments.set(bone.name, {
      kind: 'region',
      id: bone.name,
      region: { atlasKey: bone.name, uvs: null },
      color,
    })
  }
  const skins = new Map<string, SkinData>([['default', { id: 'default', attachments }]])
  const slotSet = createSlotSet(slots, skins, 'default')
  return {
    skeleton,
    pose,
    slotSet,
    baseColors,
    atlas: procedural.data,
    assets: procedural.assets,
    walkTrack: createTrack(createWalkClip(), { speed }),
  }
}

function packColor(c: RGBA): number {
  const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)))
  return (((byte(c.a) << 24) | (byte(c.r) << 16) | (byte(c.g) << 8) | byte(c.b)) >>> 0)
}

/** 用引擎 setSlotColor 给选中骨做高亮；传 null 恢复全部基色。 */
export function setHighlight(scene: Scene, boneName: string | null): void {
  for (let i = 0; i < scene.slotSet.slots.length; i += 1) {
    const base = scene.baseColors[i]!
    const color = boneName === scene.slotSet.slots[i]!.data.id
      ? { r: 1, g: 1, b: 1, a: 1 }
      : base
    setSlotColor(scene.slotSet, i, packColor(color))
  }
}

/**
 * 新引擎 humanoid('simple2d') 的骨轴是局部 +X，且 setup 中没有把躯干立起来。
 * 这里给出 upright 基准：spine 立起，chest/neck/head 续接；肩/腿/脚按父子累积角折算。
 * 这些值以“相对 setup 的增量”形式叠加，因此 sampleAnimation 的 swing 可直接叠加上去。
 */
const BASE_ROTATION: Readonly<Record<string, number>> = {
  spine: Math.PI / 2,
  upperArmL: Math.PI / 2,
  upperArmR: -Math.PI / 2,
  thighL: -Math.PI / 2,
  thighR: -Math.PI / 2,
  footL: Math.PI / 2,
  footR: Math.PI / 2,
}
/** chest 世界角已为 +π/2：局部 +X 朝上、局部 +Y 朝左，故肩的水平偏移写在 Y 通道。 */
const BASE_TRANSLATION: ReadonlyArray<readonly [string, number, number]> = [
  ['upperArmL', 0, 0.1955],
  ['upperArmR', 0, -0.1955],
]

function applyBasePose(scene: Scene): void {
  for (const [name, delta] of Object.entries(BASE_ROTATION)) {
    const id = scene.skeleton.boneIdByName.get(name)
    if (id !== undefined) addRotation(scene.pose, id, delta)
  }
  for (const [name, x, y] of BASE_TRANSLATION) {
    const id = scene.skeleton.boneIdByName.get(name)
    if (id === undefined) continue
    setLocal(scene.pose, id, CH_X, x)
    setLocal(scene.pose, id, CH_Y, y)
  }
}

function addPresetRotation(scene: Scene, name: string, delta: number): void {
  const id = scene.skeleton.boneIdByName.get(name)
  if (id !== undefined) addRotation(scene.pose, id, delta)
}

/** 每帧重建姿态：replace 动画从 setup 重算，slider 作为叠加旋转增量。 */
export function applyPose(
  scene: Scene,
  kind: PoseKind,
  offsets: Readonly<Partial<Record<SliderBone, number>>>,
  dt: number,
): void {
  resetToSetup(scene.pose)
  // replace 动画每帧从 setup 重建 swing，之后叠加 upright 基准与 preset。
  if (kind === 'walk') sampleAnimation([scene.walkTrack], scene.pose, scene.slotSet, dt)
  applyBasePose(scene)
  if (kind === 'raise') {
    addPresetRotation(scene, 'upperArmR', 1.2)
    addPresetRotation(scene, 'lowerArmR', 0.3)
    addPresetRotation(scene, 'upperArmL', -0.2)
    addPresetRotation(scene, 'chest', 0.05)
  }
  for (const name of SLIDER_BONES) {
    const delta = offsets[name] ?? 0
    if (delta === 0) continue
    const id = scene.skeleton.boneIdByName.get(name)
    if (id !== undefined) addRotation(scene.pose, id, delta)
  }
}

export type FrameBuildOptions = {
  /** 默认 true；false 退回 flat 顶点色（?texture=0）。 */
  readonly texture?: boolean
  /** true 时给左臂挂 stencil mask（?mask=1）。 */
  readonly mask?: boolean
}

const LEFT_ARM_BONES: ReadonlySet<string> = new Set(['upperArmL', 'lowerArmL', 'handL'])

/** 把 bodyMaskPolygon（world 空间）打包成单层 stencil RenderMask。 */
function buildBodyMask(): RenderMask {
  const positions = new Float32Array(bodyMaskPolygon)
  const count = Math.floor(positions.length / 2)
  const indices = new Uint32Array(Math.max(0, (count - 2) * 3))
  let cursor = 0
  for (let i = 1; i + 1 < count; i += 1) {
    indices[cursor++] = 0
    indices[cursor++] = i
    indices[cursor++] = i + 1
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i + 1 < positions.length; i += 2) {
    minX = Math.min(minX, positions[i]!)
    minY = Math.min(minY, positions[i + 1]!)
    maxX = Math.max(maxX, positions[i]!)
    maxY = Math.max(maxY, positions[i + 1]!)
  }
  const bounds = Number.isFinite(minX)
    ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    : { x: 0, y: 0, width: 0, height: 0 }
  return {
    id: 0,
    mode: 'stencil',
    invert: false,
    feather: 0,
    positions,
    indices,
    bounds,
  }
}

/** 局部 0..1 UV 经 atlas uvMatrix 映射到页 UV；四边已由 uvMatrix 内缩半 texel。 */
function atlasUvs(region: AtlasRegion): Float32Array {
  const m = region.uvMatrix
  const local = [0, 0, 1, 0, 1, 1, 0, 1]
  const uvs = new Float32Array(8)
  for (let i = 0; i < 4; i += 1) {
    const u = local[i * 2]!
    const v = local[i * 2 + 1]!
    uvs[i * 2] = m[0]! * u + m[2]! * v + m[4]!
    uvs[i * 2 + 1] = m[1]! * u + m[3]! * v + m[5]!
  }
  return uvs
}

/**
 * 生成一帧：每骨一个 world 空间四边形 packet，经 viewProjection2D 映射到设备像素。
 * 默认走程序化图集（sprite 材质 id=1）；texture=false 退回 flat 顶点色。
 * mask=true 时只给左臂三根骨挂 stencil mask，其余 packet maskPath=-1。
 */
export function buildFrame(
  scene: Scene,
  width: number,
  height: number,
  options: FrameBuildOptions = {},
): RenderFrame {
  const { pose, slotSet } = scene
  const useTexture = options.texture !== false
  const useMask = options.mask === true
  updateWorld(pose)
  const camera: Camera = {
    ...DEFAULT_CAMERA,
    target: [0, 0.9, 0],
    viewport: { width, height, dpr: 1 },
    orthoHeight: 3,
  }
  const viewProjection = viewProjection2D(camera)
  const packets: RenderPacket[] = []

  for (let slotIndex = 0; slotIndex < slotSet.slots.length; slotIndex += 1) {
    const slot = slotSet.slots[slotIndex]!
    const attachment = resolveAttachment(slotSet, slotIndex)
    if (attachment === null || attachment.kind !== 'region') continue
    const boneId = pose.skeleton.boneIdByName.get(slot.data.id)
    if (boneId === undefined || slot.data.id === 'root') continue // root 是公共原点，不作为身体部件绘制
    const bone = pose.skeleton.bones[boneId]!
    const world = pose.world.subarray(boneId * 6, boneId * 6 + 6)
    const length = Math.max(bone.length, 0.05)
    const half = widthForBone(bone.name) / 2
    const corners: ReadonlyArray<readonly [number, number]> = [
      [0, -half], [length, -half], [length, half], [0, half],
    ]
    const positions = new Float32Array(8)
    for (let i = 0; i < corners.length; i += 1) {
      const [lx, ly] = corners[i]!
      transformAffineInto(positions, i * 2, world, lx, ly)
    }

    const region = scene.atlas.regions.get(bone.name)
    const textured = useTexture && region !== undefined
    const c = textured ? { r: 1, g: 1, b: 1, a: 1 } : slot.color
    packets.push(buildRegionPacket({
      id: slotIndex,
      positions,
      ...(textured ? { uvs: atlasUvs(region), page: region.page } : {}),
      color: [c.r, c.g, c.b, c.a],
      materialId: textured ? region.page + 1 : 0,
      order: boneId,
      depthKey: 0,
      seq: slotIndex,
      kind: 'region',
      blend: 'normal',
      pma: textured,
      maskPath: useMask ? (LEFT_ARM_BONES.has(bone.name) ? 0 : -1) : 0,
    }))
  }

  const frame: RenderFrame = {
    packets: sortPackets(packets),
    width,
    height,
    viewProjection,
    assets: scene.assets,
  }
  if (!useMask) return frame
  return {
    ...frame,
    maskPaths: [{ maskId: 0, parent: -1 }],
    masks: buildMaskSet([buildBodyMask()]),
  }
}
