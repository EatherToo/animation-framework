/**
 * 预览与离线校验共用的 core2d 场景构建。
 * 只调用 @animation-framework/render-engine 的新 API，不依赖 DOM。
 */

import {
  CH_X,
  CH_Y,
  addRotation,
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
  type Camera,
  type CompiledSkeleton,
  type Pose,
  type RenderFrame,
  type RenderPacket,
  type RGBA,
  type ScalarKey,
  type SkinData,
  type SlotData,
  type SlotSet,
  type Track,
} from '@animation-framework/render-engine'

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
  /** walk 模式用的可复用 track；speed 在 createScene 时写入。 */
  readonly walkTrack: Track
}

function colorFor(name: string): RGBA {
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
  const slots: SlotData[] = []
  const attachments = new Map<string, Attachment>()
  const baseColors: RGBA[] = []
  for (const bone of skeleton.bones) {
    const color = colorFor(bone.name)
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
      region: { atlasKey: 'flat', uvs: null },
      color,
    })
  }
  const skins = new Map<string, SkinData>([['default', { id: 'default', attachments }]])
  const slotSet = createSlotSet(slots, skins, 'default')
  return { skeleton, pose, slotSet, baseColors, walkTrack: createTrack(createWalkClip(), { speed }) }
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

/**
 * 生成一帧：每骨一个 world 空间四边形 packet，经 viewProjection2D 映射到设备像素。
 * 排序由引擎 sortPackets 完成；CPU 后端读取 frame.viewProjection 做投影。
 */
export function buildFrame(scene: Scene, width: number, height: number): RenderFrame {
  const { pose, slotSet } = scene
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
    const c = slot.color
    packets.push(buildRegionPacket({
      id: slotIndex,
      positions,
      color: [c.r, c.g, c.b, c.a],
      materialId: 0,
      order: boneId,
      depthKey: 0,
      seq: slotIndex,
      kind: 'region',
      blend: 'normal',
      pma: false,
    }))
  }
  return { packets: sortPackets(packets), width, height, viewProjection }
}
