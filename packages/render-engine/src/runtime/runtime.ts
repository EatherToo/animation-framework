/**
 * M7 运行时与插件宿主：Engine 编排生命周期与一帧流程，PluginHost 负责 hook 调度与隔离。
 * 权威：docs/12-API/runtime.md、docs/12-API/plugin.md。
 * 求值顺序固定：beforeUpdate → 采样 → 约束 → FK →（render）packet → draw → afterRender → afterUpdate。
 */
import {
  CpuBackend,
  WebGL2Backend,
  type RenderBackend,
  type WebGL2Like,
} from '../backend/backend'
import { createConstraintSolver, type ConstraintData, type ConstraintSolver, type PhysicsConstraint } from '../constraint/constraint'
import { AnimationState, createTrack, sampleAnimation, type SampleResult, type Track } from '../animation/animation'
import { buildInverseBind, skinMesh2D, type MeshData, type WeightedMeshData } from '../mesh/mesh'
import {
  createPose, markAllDirty, setLocal, setSkeletonTransform, updateWorld, localToWorld, worldToLocal,
  localToWorldRotation, worldToLocalRotation, type Pose,
} from '../core/pose'
import { CH_X, CH_Y, POSE_STRIDE, WORLD_STRIDE } from '../core/math'
import {
  buildMaskSet,
  maskChain,
  buildMeshPacket,
  batchPackets,
  buildOutlinePacket,
  buildRegionPacket,
  sortPackets,
  spinePmaTint,
  triangulatePolygon,
  type MaterialDef,
  type MaskPathNode,
  type RenderAssets,
  type RenderFrame,
  type RenderMask,
  type RenderPacket,
  type TextureData,
} from '../render/render'
import {
  createSlotSet,
  isRenderable,
  resolveAttachment,
  setSkin,
  setSlotAttachment,
  whiteSkeletonColor,
  type Attachment,
  type SkinData,
  type SlotSet,
} from '../slot/slot'
import { DEFAULT_CAMERA, viewProjection2D, type Camera } from '../render/camera'
import type { SkeletonAsset, MaskLibrary } from '../asset/importer'
import type { AtlasData, AtlasFilter } from '../asset/atlas'
import { resolveViewRule, type ViewRule } from '../volume/volume'
import { clipTriangles } from '../render/clipping'
import { buildDebugLines, type DebugFlags, type DebugLine } from '../debug/overlay'

// ---------------------------------------------------------------------------
// 公开类型
// ---------------------------------------------------------------------------

export type BackendKind = 'auto' | 'webgl2' | 'cpu'

export type EngineConfig = {
  backend?: BackendKind
  maxTexturePages?: number
  maxBones?: number
  maxInfluences?: number
  pixelRatio?: number
  /** CPU 参考后端超采样倍数；用于边缘 AA 对齐。 */
  supersample?: number
  fixedDt?: number
  /** Consume sampled root translation into the instance position. Default keeps it on the bone. */
  rootMotion?: 'bone' | 'entity'
  /** 可选描边：world 宽度 + straight RGBA。 */
  outline?: { readonly width: number; readonly color: readonly [number, number, number, number] }
}

export type EnginePhase =
  | 'created' | 'loading' | 'ready' | 'running' | 'paused'
  | 'contextLost' | 'restored' | 'disposed'

export type PluginApiVersion = 1

export type EnginePlugin = {
  readonly id: string
  readonly apiVersion: PluginApiVersion
  readonly order?: number
  setup?(ctx: PluginContext): void | Promise<void>
  beforeUpdate?(ctx: PluginContext, dt: number): void
  afterUpdate?(ctx: PluginContext, dt: number): void
  afterRender?(ctx: PluginContext, frame: RenderFrame): void
  viewRules?(ctx: PluginContext, skeleton: import('../core/skeleton').CompiledSkeleton): readonly ViewRule[] | void
  dispose?(): void
}

export type PluginContext = {
  readonly engine: Engine
  readonly phase: EnginePhase
  readonly stats: Record<string, number>
}

/** 对外暴露的错误码清单（顺序稳定，便于上层映射）。 */
export const ERROR_CODES = [
  'E_DISPOSED', 'E_NO_ASSET', 'E_BACKEND', 'E_PLUGIN_API', 'E_CONFIG', 'E_STATE',
] as const

// ---------------------------------------------------------------------------
// 后端选择
// ---------------------------------------------------------------------------

/** 默认后端工厂：CPU 永远可用；WebGL2 需要真实 DOM 上下文。 */
function defaultBackendFactory(
  kind: 'cpu' | 'webgl2',
  options?: { supersample?: 1 | 2 | 4 | 8 | 16 },
): RenderBackend {
  if (kind === 'cpu') {
    const ss = options?.supersample ?? 1
    if (!Number.isInteger(ss) || ss < 1 || ss > 16) throw new Error('E_CONFIG')
    return new CpuBackend({ width: 1, height: 1, supersample: ss })
  }
  if (typeof document === 'undefined') throw new Error('E_BACKEND: WebGL2 上下文不可用')
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2', { stencil: true })
  if (gl === null) throw new Error('E_BACKEND: WebGL2 上下文不可用')
  return new WebGL2Backend(gl as unknown as WebGL2Like)
}

/** auto：先试 webgl2，失败回退 cpu；显式选择失败则抛 E_BACKEND。 */
function createBackend(
  kind: BackendKind,
  factory: (kind: 'cpu' | 'webgl2') => RenderBackend,
): RenderBackend {
  if (kind === 'auto') {
    try {
      return factory('webgl2')
    } catch {
      try {
        return factory('cpu')
      } catch {
        throw new Error('E_BACKEND')
      }
    }
  }
  try {
    return factory(kind)
  } catch {
    throw new Error('E_BACKEND')
  }
}

// ---------------------------------------------------------------------------
// PluginHost
// ---------------------------------------------------------------------------

type IndexedPlugin = { readonly plugin: EnginePlugin; readonly index: number }

/** 显式顺序：(order, 注册序) 升序；未声明 order 视为 0。 */
function byOrder(a: IndexedPlugin, b: IndexedPlugin): number {
  return (a.plugin.order ?? 0) - (b.plugin.order ?? 0) || a.index - b.index
}

/**
 * 插件宿主：setup 时做版本协商，apiVersion≠1 或 setup 抛错的插件被隔离；
 * 每个 hook 独立 try/catch，错误写入共享 stats['pluginErrors']，不影响核心流程。
 */
/** 可产生几何的附件子集；用作类型守卫，避免外部 boolean 函数不收窄联合类型。 */
type RenderableAttachment = Extract<Attachment, { kind: 'region' | 'mesh' | 'weightedMesh' }>

function asRenderable(attachment: Attachment | null): attachment is RenderableAttachment {
  return attachment !== null && isRenderable(attachment)
}

export class PluginHost {
  private readonly registry: readonly EnginePlugin[]
  private readonly ctx: PluginContext
  private readonly ready = new Set<string>()
  private readonly rejected = new Set<string>()
  private active: EnginePlugin[] = []
  private disposedFlag = false

  constructor(plugins: readonly EnginePlugin[], ctx: PluginContext) {
    this.registry = plugins
    this.ctx = ctx
    this.refresh()
  }

  /** 当前生效插件的 id，按执行顺序排列。 */
  get order(): string[] {
    return this.active.map((p) => p.id)
  }

  private refresh(): void {
    this.active = this.registry
      .map((plugin, index) => ({ plugin, index }))
      .sort(byOrder)
      .filter(({ plugin }) => !this.rejected.has(plugin.id))
      .map(({ plugin }) => plugin)
  }

  private record(): void {
    const stats = this.ctx.stats
    stats['pluginErrors'] = (stats['pluginErrors'] ?? 0) + 1
  }

  /** 同步异常立即隔离；异步 rejection 也记录，不让未捕获 Promise 冒出去。 */
  private guard(fn: () => unknown): void {
    try {
      const result = fn()
      if (result instanceof Promise) {
        result.catch(() => { this.record() })
      }
    } catch {
      this.record()
    }
  }

  setup(): void {
    if (this.disposedFlag) return
    for (const plugin of this.registry) {
      if (this.ready.has(plugin.id) || this.rejected.has(plugin.id)) continue
      if (plugin.apiVersion !== 1) {
        this.rejected.add(plugin.id)
        this.record()
        continue
      }
      this.ready.add(plugin.id)
      this.guard(() => plugin.setup?.(this.ctx))
    }
    this.refresh()
  }

  beforeUpdate(dt: number): void {
    if (this.disposedFlag) return
    for (const plugin of this.active) this.guard(() => plugin.beforeUpdate?.(this.ctx, dt))
  }

  afterUpdate(dt: number): void {
    if (this.disposedFlag) return
    for (const plugin of this.active) this.guard(() => plugin.afterUpdate?.(this.ctx, dt))
  }

  afterRender(frame: RenderFrame): void {
    if (this.disposedFlag) return
    for (const plugin of this.active) this.guard(() => plugin.afterRender?.(this.ctx, frame))
  }

  viewRules(): ViewRule[] {
    if (this.disposedFlag) return []
    const out: ViewRule[] = []
    for (const plugin of this.active) {
      try {
        const rules = plugin.viewRules?.(this.ctx, this.ctx.engine.pose.skeleton)
        if (rules) out.push(...rules)
      } catch {
        this.record()
      }
    }
    return out
  }

  dispose(): void {
    if (this.disposedFlag) return
    this.disposedFlag = true
    // 资源释放逆序；host 自身幂等。
    for (const plugin of [...this.active].reverse()) this.guard(() => plugin.dispose?.())
    this.active.length = 0
  }
}

// ---------------------------------------------------------------------------
// 资产 → 后端资源 / mask 路径
// ---------------------------------------------------------------------------

const pageFilter = (filter: AtlasFilter | undefined): NonNullable<TextureData['minFilter']> => {
  switch (filter) {
    case 'Nearest': return 'nearest'
    case 'MipMap': return 'mipmap'
    case 'MipMapNearestNearest': return 'mipmapNearestNearest'
    case 'MipMapLinearNearest': return 'mipmapLinearNearest'
    case 'MipMapNearestLinear': return 'mipmapNearestLinear'
    case 'MipMapLinearLinear': return 'mipmapLinearLinear'
    default: return 'linear'
  }
}

/** 图集页 → 后端纹理；缺图的页补 1x1 白纹理，材质 id = page + 1。 */
export function buildRenderAssets(asset: SkeletonAsset): RenderAssets | undefined {
  const atlas: AtlasData | undefined = asset.atlas
  if (atlas === undefined) return undefined
  const pages: TextureData[] = atlas.pages.map((page) => {
    const image = page.image
    const data = image?.data !== undefined && image.data.length === page.width * page.height * 4
      ? image.data
      : new Uint8Array([255, 255, 255, 255])
    return {
      width: image?.data !== undefined ? page.width : 1,
      height: image?.data !== undefined ? page.height : 1,
      data,
      pma: page.pma ?? atlas.pma,
      minFilter: pageFilter(page.minFilter),
      magFilter: page.magFilter === 'Nearest' ? 'nearest' : 'linear',
      uWrap: page.uWrap === 'Repeat' ? 'repeat' : 'clamp',
      vWrap: page.vWrap === 'Repeat' ? 'repeat' : 'clamp',
      mipmap: page.minFilter?.startsWith('MipMap') ?? false,
    }
  })
  const materials: MaterialDef[] = [{ id: 0, kind: 'flat', page: -1, filter: 'linear' }]
  for (let i = 0; i < pages.length; i += 1) {
    materials.push({ id: i + 1, kind: 'sprite', page: i, filter: 'linear' })
  }
  return { pages, materials, maxTexturePages: 4 }
}

export type ResolvedMasks = {
  readonly paths: readonly number[]
  readonly maskPaths: readonly MaskPathNode[]
  readonly masks: readonly (RenderMask | null)[]
}

/**
 * 从当前附件展开 clip scope；maskLibrary 只提供附件的缓存元数据。
 * 结束槽位也被裁剪，clipping 槽不产生绘制。
 */
export function resolveMaskPaths(
  slotSet: SlotSet,
  library: MaskLibrary = { version: 1, masks: [] },
  pose?: Pose,
  atlas?: AtlasData,
): ResolvedMasks {
  const byId = new Map<string, number>()
  library.masks.forEach((mask, index) => byId.set(mask.id, index))
  const paths = new Array<number>(slotSet.slots.length).fill(-1)
  const nodes: MaskPathNode[] = []
  const masks: (RenderMask | null)[] = new Array(library.masks.length).fill(null)
  let open: { path: number; endSlotId: string } | null = null
  for (const slotIndex of slotSet.drawOrder) {
    const slot = slotSet.slots[slotIndex]
    if (slot === undefined) continue
    const attachment = resolveAttachment(slotSet, slotIndex)
    if (attachment !== null && attachment.kind === 'clipping') {
      if (open === null) {
        const canonical = `${slotIndex}:${attachment.id}`
        const cachedIndex = byId.get(canonical) ?? byId.get(`${slot.data.id}.${attachment.id}`)
          ?? library.masks.findIndex((mask) => mask.startSlotId === slot.data.id && mask.id === attachment.id)
        const cached = cachedIndex >= 0 ? library.masks[cachedIndex] : undefined
        const def: MaskLibrary['masks'][number] = {
          id: canonical, mode: cached?.mode ?? 'clip', invert: cached?.invert ?? false,
          feather: cached?.feather ?? 0, polygon: attachment.polygon,
          startSlotId: slot.data.id, endSlotId: attachment.endSlotId ?? cached?.endSlotId ?? slot.data.id,
          ...(cached?.alphaRegion === undefined ? {} : { alphaRegion: cached.alphaRegion }),
        }
        const id = cached === undefined ? masks.length : cachedIndex
        masks[id] = buildRuntimeMask(def, slotSet, pose, atlas)
        nodes.push({ maskId: id, parent: -1 })
        open = { path: nodes.length - 1, endSlotId: def.endSlotId }
      }
      paths[slotIndex] = -1
      if (open !== null && open.endSlotId === slot.data.id) open = null
      continue
    }
    let path = open?.path ?? -1
    // 显式 slot mask：在 clip scope 之外再追加一个内层 mask，仅作用于该 slot。
    if (slot.data.mask !== null) {
      const explicit = byId.get(slot.data.mask)
      if (explicit !== undefined && !(library.masks[explicit]!.mode === 'clip' &&
        library.masks[explicit]!.startSlotId === slot.data.id)) {
        const def = library.masks[explicit]!
        nodes.push({ maskId: explicit, parent: path })
        path = nodes.length - 1
        if (masks[explicit] == null) masks[explicit] = buildRuntimeMask(def, slotSet, pose, atlas)
      }
    }
    paths[slotIndex] = path
    if (open !== null && open.endSlotId === slot.data.id) open = null
  }
  return { paths, maskPaths: nodes, masks }
}

function buildRuntimeMask(
  def: MaskLibrary['masks'][number],
  slotSet: SlotSet,
  pose?: Pose,
  atlas?: AtlasData,
): RenderMask {
  const slot = slotSet.slots.find((entry) => entry.data.id === def.startSlotId)
  const bone = slot?.data.bone ?? 0
  const positions = new Float32Array(def.polygon.length)
  if (pose !== undefined) {
    const m = pose.world
    const off = bone * WORLD_STRIDE
    for (let i = 0; i + 1 < def.polygon.length; i += 2) {
      const x = def.polygon[i]!
      const y = def.polygon[i + 1]!
      positions[i] = m[off]! * x + m[off + 2]! * y + m[off + 4]!
      positions[i + 1] = m[off + 1]! * x + m[off + 3]! * y + m[off + 5]!
    }
  } else {
    positions.set(def.polygon)
  }
  const indices = triangulatePolygon(positions)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i + 1 < positions.length; i += 2) {
    minX = Math.min(minX, positions[i]!)
    minY = Math.min(minY, positions[i + 1]!)
    maxX = Math.max(maxX, positions[i]!)
    maxY = Math.max(maxY, positions[i + 1]!)
  }
  const bounds = Number.isFinite(minX)
    ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    : { x: 0, y: 0, width: 0, height: 0 }
  const alpha = def.mode === 'alpha' && def.alphaRegion !== undefined && atlas !== undefined
    ? atlas.regions.get(def.alphaRegion.atlasKey)
    : undefined
  return {
    id: 0, mode: def.mode === 'alpha' ? 'alpha' : 'stencil', invert: def.invert,
    feather: def.feather, positions, indices, bounds,
    ...(alpha === undefined ? {} : { alpha: { page: alpha.page, uvMatrix: alpha.uvMatrix } }),
  }
}

/** 附件局部 UV → 图集页 UV；缺 region 时返回 null。 */
function atlasUvOf(asset: SkeletonAsset, attachment: RenderableAttachment, keyOverride?: string): {
  uvs: Float32Array; page: number; materialId: number
} | null {
  const atlas = asset.atlas
  if (atlas === undefined) return null
  const key = keyOverride ?? attachment.region.atlasKey
  const region = atlas.regions.get(key)
  if (region === undefined) return null
  // Region 的几何顶点只覆盖 trim 后的可见图像；UV 必须对应同一可见矩形。
  // mesh/weighted mesh 的 JSON uvs 已经是最终 page UV，不能再变换。
  if (attachment.kind === 'region' && attachment.region.uvs === null) {
    const page = atlas.pages[region.page]!
    const rotated = region.uvMatrix[1]! < 0 && region.uvMatrix[2]! > 0
    const uv = region.uvMatrix
    const { offsetX, offsetY, sourceWidth, sourceHeight } = region.trim
    const lowU = sourceWidth > 0 ? offsetX / sourceWidth : 0
    const highU = sourceWidth > 0 ? (offsetX + region.width) / sourceWidth : 1
    const lowV = sourceHeight > 0 ? (sourceHeight - offsetY - region.height) / sourceHeight : 0
    const highV = sourceHeight > 0 ? (sourceHeight - offsetY) / sourceHeight : 1
    const u = region.x / page.width
    const v = region.y / page.height
    const u2 = (region.x + region.height) / page.width
    const v2 = (region.y + region.width) / page.height
    const points = [lowU, highV, lowU, lowV, highU, lowV, highU, highV]
    const uvs = new Float32Array(8)
    for (let i = 0; i < 8; i += 2) {
      uvs[i] = rotated ? (i < 4 ? u2 : u) : uv[0]! * points[i]! + uv[2]! * points[i + 1]! + uv[4]!
      uvs[i + 1] = rotated ? (i === 0 || i === 6 ? v2 : v) : uv[1]! * points[i]! + uv[3]! * points[i + 1]! + uv[5]!
    }
    return {
      uvs,
      page: region.page, materialId: region.page + 1,
    }
  }
  const source = attachment.kind === 'region' ? attachment.region.uvs! : attachment.mesh.uvs
  const uv = region.uvMatrix
  const uvs = new Float32Array(source.length)
  for (let i = 0; i + 1 < source.length; i += 2) {
    const u = source[i]!
    const v = source[i + 1]!
    uvs[i] = uv[0]! * u + uv[2]! * v + uv[4]!
    uvs[i + 1] = uv[1]! * u + uv[3]! * v + uv[5]!
  }
  return { uvs, page: region.page, materialId: region.page + 1 }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/** 默认视口取相机默认值；pixelRatio 只放大设备像素，不改变世界单位。 */
function viewportOf(pixelRatio: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(DEFAULT_CAMERA.viewport.width * pixelRatio)),
    height: Math.max(1, Math.floor(DEFAULT_CAMERA.viewport.height * pixelRatio)),
  }
}

export type FacadeColor = { readonly r: number; readonly g: number; readonly b: number; readonly a: number }

const facadeBindings = new WeakMap<Skeleton, { engine: Engine; pose: Pose; slots: SlotSet }>()
function facadePose(skeleton: Skeleton): Pose {
  const bound = facadeBindings.get(skeleton)!
  if (bound.engine.pose !== bound.pose) throw new Error('E_STATE: stale skeleton')
  return bound.pose
}
function facadeSlots(skeleton: Skeleton): SlotSet {
  const bound = facadeBindings.get(skeleton)!
  if (bound.engine.slotSet !== bound.slots) throw new Error('E_STATE: stale skeleton')
  return bound.slots
}

/** Instance-bound bone API. Numeric channels are the only path to changing pose through this facade. */
export class SpineBone {
  readonly #owner: Skeleton
  constructor(owner: Skeleton, readonly index: number) { this.#owner = owner }
  get name(): string { return facadePose(this.#owner).skeleton.bones[this.index]!.name }
  get length(): number { return facadePose(this.#owner).skeleton.bones[this.index]!.length }
  get data(): Readonly<{ name: string; length: number; parent: number; setup: Readonly<{
    x: number; y: number; rotation: number; scaleX: number; scaleY: number; shearX: number; shearY: number
  }> }> {
    const bone = facadePose(this.#owner).skeleton.bones[this.index]!
    return Object.freeze({ name: bone.name, length: bone.length, parent: bone.parent,
      setup: Object.freeze({ ...bone.setup }) })
  }
  get parent(): SpineBone | null {
    const id = facadePose(this.#owner).skeleton.parent[this.index]!
    return id < 0 ? null : this.#owner.bones[id]!
  }
  private value(channel: number): number { return facadePose(this.#owner).local[this.index * POSE_STRIDE + channel]! }
  private change(channel: number, value: number): void { setLocal(facadePose(this.#owner), this.index, channel, value) }
  get x(): number { return this.value(0) }
  set x(value: number) { this.change(0, value) }
  get y(): number { return this.value(1) }
  set y(value: number) { this.change(1, value) }
  get rotation(): number { return this.value(2) }
  set rotation(value: number) { this.change(2, value) }
  get scaleX(): number { return this.value(3) }
  set scaleX(value: number) { this.change(3, value) }
  get scaleY(): number { return this.value(4) }
  set scaleY(value: number) { this.change(4, value) }
  get shearX(): number { return this.value(5) }
  set shearX(value: number) { this.change(5, value) }
  get shearY(): number { return this.value(6) }
  set shearY(value: number) { this.change(6, value) }
  get worldX(): number { updateWorld(facadePose(this.#owner)); return facadePose(this.#owner).world[this.index * WORLD_STRIDE + 4]! }
  get worldY(): number { updateWorld(facadePose(this.#owner)); return facadePose(this.#owner).world[this.index * WORLD_STRIDE + 5]! }
  get worldTransform(): readonly number[] {
    updateWorld(facadePose(this.#owner))
    return Object.freeze(Array.from(facadePose(this.#owner).world.slice(this.index * WORLD_STRIDE, (this.index + 1) * WORLD_STRIDE)))
  }
  localToWorld(point: Readonly<{ x: number; y: number }>): { x: number; y: number } {
    const [x, y] = localToWorld(facadePose(this.#owner), this.index, point.x, point.y)
    return { x, y }
  }
  worldToLocal(point: Readonly<{ x: number; y: number }>): { x: number; y: number } {
    const [x, y] = worldToLocal(facadePose(this.#owner), this.index, point.x, point.y)
    return { x, y }
  }
  localToWorldRotation(angle: number): number { return localToWorldRotation(facadePose(this.#owner), this.index, angle) }
  worldToLocalRotation(angle: number): number { return worldToLocalRotation(facadePose(this.#owner), this.index, angle) }
  /** Spine 4.3 BonePose-compatible rotation, in degrees (including its shearX offset). */
  localToWorldRotationDegrees(degrees: number): number {
    const pose = facadePose(this.#owner)
    updateWorld(pose)
    const i = this.index * WORLD_STRIDE
    const m = pose.world
    const offset = this.index * POSE_STRIDE
    const angle = degrees * Math.PI / 180 - pose.local[offset + 2]! - pose.local[offset + 5]!
    return Math.atan2(Math.cos(angle) * m[i + 1]! + Math.sin(angle) * m[i + 3]!,
      Math.cos(angle) * m[i]! + Math.sin(angle) * m[i + 2]!) * 180 / Math.PI
  }
  /** Spine 4.3 BonePose-compatible world-to-local rotation, in degrees. */
  worldToLocalRotationDegrees(degrees: number): number {
    const pose = facadePose(this.#owner)
    updateWorld(pose)
    const i = this.index * WORLD_STRIDE
    const m = pose.world
    const a = m[i]!, b = m[i + 2]!, c = m[i + 1]!, d = m[i + 3]!
    if (Math.abs(a * d - b * c) < 1e-12) throw new Error('pose.worldToLocal: singular')
    const offset = this.index * POSE_STRIDE
    const angle = degrees * Math.PI / 180
    return Math.atan2(a * Math.sin(angle) - c * Math.cos(angle),
      d * Math.cos(angle) - b * Math.sin(angle)) * 180 / Math.PI
      + (pose.local[offset + 2]! - pose.local[offset + 5]!) * 180 / Math.PI
  }
}

export class Skin {
  readonly #owner: Skeleton
  constructor(owner: Skeleton, readonly name: string) { this.#owner = owner }
  get attachmentNames(): readonly string[] {
    return Object.freeze([...facadeSlots(this.#owner).skins.get(this.name)!.attachments.keys()])
  }
  hasAttachment(name: string): boolean { return facadeSlots(this.#owner).skins.get(this.name)!.attachments.has(name) }
}

export class Slot {
  readonly #owner: Skeleton
  constructor(owner: Skeleton, readonly index: number) { this.#owner = owner }
  private get state(): SlotSet['slots'][number] { return facadeSlots(this.#owner).slots[this.index]! }
  get name(): string { return this.state.data.id }
  get data(): Readonly<{ name: string; bone: number; attachment: string | null; color: FacadeColor }> {
    const slot = this.state.data
    return Object.freeze({ name: slot.id, bone: slot.bone, attachment: slot.attachment,
      color: Object.freeze({ ...slot.color }) })
  }
  get bone(): SpineBone { return this.#owner.bones[this.state.data.bone]! }
  get attachmentName(): string | null { return this.state.attachmentId }
  get skin(): Skin { return this.#owner.findSkin(this.state.skinId)! }
  get color(): FacadeColor { return Object.freeze({ ...this.state.color }) }
  set color(value: FacadeColor) {
    if (![value.r, value.g, value.b, value.a].every(Number.isFinite)) throw new Error('slot.color')
    this.state.color = { ...value }
  }
  setAttachment(name: string | null): void { this.#owner.setAttachment(this.name, name) }
}

/** Facade views never expose the internal pose, slot set, or mutable attachment data. */
export class Skeleton {
  readonly bones: readonly SpineBone[]
  readonly slots: readonly Slot[]
  readonly skins: readonly Skin[]
  private elapsed = 0
  readonly #engine: Engine
  constructor(engine: Engine, pose: Pose, slots: SlotSet) {
    this.#engine = engine
    facadeBindings.set(this, { engine, pose, slots })
    this.bones = Object.freeze(pose.skeleton.bones.map((_, i) => new SpineBone(this, i)))
    this.slots = Object.freeze(slots.slots.map((_, i) => new Slot(this, i)))
    this.skins = Object.freeze([...slots.skins.keys()].map((name) => new Skin(this, name)))
  }
  get name(): string { return facadePose(this).skeleton.name }
  get color(): FacadeColor { facadePose(this); return Object.freeze({ ...this.#engine.color }) }
  set color(value: FacadeColor) {
    facadePose(this)
    if (![value.r, value.g, value.b, value.a].every(Number.isFinite)) throw new Error('E_CONFIG')
    Object.assign(this.#engine.color, value)
  }
  get windX(): number { facadePose(this); return this.#engine.windX }
  set windX(value: number) { facadePose(this); this.#engine.windX = value }
  get windY(): number { facadePose(this); return this.#engine.windY }
  set windY(value: number) { facadePose(this); this.#engine.windY = value }
  get gravityX(): number { facadePose(this); return this.#engine.gravityX }
  set gravityX(value: number) { facadePose(this); this.#engine.gravityX = value }
  get gravityY(): number { facadePose(this); return this.#engine.gravityY }
  set gravityY(value: number) { facadePose(this); this.#engine.gravityY = value }
  get x(): number { facadePose(this); return this.#engine.x }
  set x(value: number) { facadePose(this); this.#engine.x = value }
  get y(): number { facadePose(this); return this.#engine.y }
  set y(value: number) { facadePose(this); this.#engine.y = value }
  get scaleX(): number { facadePose(this); return this.#engine.scaleX }
  set scaleX(value: number) { facadePose(this); this.#engine.scaleX = value }
  get scaleY(): number { facadePose(this); return this.#engine.scaleY }
  set scaleY(value: number) { facadePose(this); this.#engine.scaleY = value }
  get time(): number { facadePose(this); return this.elapsed }
  set time(value: number) {
    facadePose(this)
    if (!Number.isFinite(value) || value < 0) throw new Error('E_CONFIG')
    this.elapsed = value
  }
  advanceTime(dt: number): void { this.elapsed += dt }
  get drawOrder(): readonly Slot[] { return Object.freeze(facadeSlots(this).drawOrder.map((index) => this.slots[index]!)) }
  get skin(): Skin | null {
    const id = facadeSlots(this).slots[0]?.skinId
    return id === undefined ? null : this.findSkin(id)
  }
  findBone(name: string): SpineBone | null {
    const id = facadePose(this).skeleton.boneIdByName.get(name)
    return id === undefined ? null : this.bones[id]!
  }
  findSlot(name: string): Slot | null {
    const index = facadeSlots(this).slots.findIndex((slot) => slot.data.id === name)
    return index < 0 ? null : this.slots[index]!
  }
  findSkin(name: string): Skin | null {
    facadeSlots(this)
    return this.skins.find((skin) => skin.name === name) ?? null
  }
  setSkinByName(name: string): void { facadeSlots(this); this.#engine.setSkinByName(name) }
  setAttachment(slotName: string, name: string | null): void { facadeSlots(this); this.#engine.setAttachment(slotName, name) }
  getBounds(): { x: number; y: number; width: number; height: number } {
    facadePose(this)
    return this.#engine.getBounds()
  }
  setupPose(): void { facadePose(this); this.#engine.setupPose() }
  setupPoseBones(): void { facadePose(this); this.#engine.setupPoseBones() }
  setupPoseSlots(): void { facadeSlots(this); this.#engine.setupPoseSlots() }
  setToSetupPose(): void { this.setupPose() }
  setBonesToSetupPose(): void { this.setupPoseBones() }
  setSlotsToSetupPose(): void { this.setupPoseSlots() }
  updateWorldTransform(): void { updateWorld(facadePose(this)) }
}

export class Engine {
  /** Per-instance skeleton tint; mutable channels affect the next rendered frame. */
  readonly color: { r: number; g: number; b: number; a: number } = whiteSkeletonColor()
  private _phase: EnginePhase = 'created'
  private readonly backend: RenderBackend
  private readonly stats: Record<string, number> = { pluginErrors: 0 }
  private readonly plugins: EnginePlugin[] = []
  private readonly host: PluginHost
  private readonly ctx: PluginContext
  private readonly viewport: { width: number; height: number }
  private viewProjection: Float32Array
  private asset: SkeletonAsset | null = null
  private ownedPose: Pose | null = null
  private ownedSlotSet: SlotSet | null = null
  private ownedSkeleton: Skeleton | null = null
  private readonly ownedTracks: Track[] = []
  private inverseBind: Float32Array | null = null
  private solver: ConstraintSolver | null = null
  private animationState: AnimationState | null = null
  private lastAnimation: SampleResult | null = null
  private lastFrame: RenderFrame | null = null
  private flipX = false
  private flipY = false
  private instanceScaleX = 1
  private instanceScaleY = 1
  private instanceX = 0
  private instanceY = 0
  private readonly physicsEnvironments: NonNullable<PhysicsConstraint['environment']>[] = []
  private forceWindX = 1
  private forceWindY = 0
  private forceGravityX = 0
  private forceGravityY = 1
  private renderAssets: RenderAssets | undefined
  private preparedAssets: RenderAssets | undefined
  private maskLibrary: MaskLibrary | undefined
  private camera: Camera = DEFAULT_CAMERA
  private readonly maxBones: number
  private readonly maxTexturePages: number
  private readonly maxInfluences: number
  private readonly fixedDt: number | undefined
  private readonly outline: { readonly width: number; readonly color: readonly [number, number, number, number] } | undefined
  private accumulator = 0
  private readonly rootMotionMode: 'bone' | 'entity'
  private rootSampleX = 0
  private rootSampleY = 0
  private rootDisplacementX = 0
  private rootDisplacementY = 0
  private hasUpdatedSinceLoad = false

  constructor(
    config: EngineConfig = {},
    deps?: { backendFactory?: (kind: 'cpu' | 'webgl2') => RenderBackend },
  ) {
    const kind = config.backend ?? 'auto'
    if (kind !== 'auto' && kind !== 'cpu' && kind !== 'webgl2') throw new Error('E_CONFIG')
    const pixelRatio = config.pixelRatio ?? 1
    if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) throw new Error('E_CONFIG')
    if (config.fixedDt !== undefined && (!Number.isFinite(config.fixedDt) || config.fixedDt <= 0)) {
      throw new Error('E_CONFIG')
    }

    this.maxBones = config.maxBones ?? 512
    this.maxTexturePages = config.maxTexturePages ?? 4
    this.maxInfluences = config.maxInfluences ?? 0
    this.fixedDt = config.fixedDt
    if (config.rootMotion !== undefined && config.rootMotion !== 'bone' && config.rootMotion !== 'entity') throw new Error('E_CONFIG')
    this.rootMotionMode = config.rootMotion ?? 'bone'
    this.outline = config.outline
    if (!Number.isInteger(this.maxBones) || this.maxBones < 1 ||
        !Number.isInteger(this.maxTexturePages) || this.maxTexturePages < 1 || this.maxTexturePages > 4 ||
        !Number.isInteger(this.maxInfluences) || this.maxInfluences < 0) {
      throw new Error('E_CONFIG')
    }
    const rawSupersample = config.supersample ?? 1
    const supersample: 1 | 2 | 4 | 8 | 16 = rawSupersample === 2 || rawSupersample === 4
      || rawSupersample === 8 || rawSupersample === 16 ? rawSupersample : 1
    if (rawSupersample !== supersample) throw new Error('E_CONFIG')
    const factory = deps?.backendFactory ?? ((kind) => defaultBackendFactory(kind, { supersample }))
    this.backend = createBackend(kind, factory)
    this.viewport = viewportOf(pixelRatio)
    this.viewProjection = viewProjection2D({
      ...DEFAULT_CAMERA,
      viewport: {
        ...DEFAULT_CAMERA.viewport,
        width: this.viewport.width,
        height: this.viewport.height,
        dpr: pixelRatio,
      },
    })

    const self = this
    this.ctx = {
      engine: this,
      // 用 getter 让插件总是读到当前阶段，而不是注册时的快照。
      get phase(): EnginePhase { return self._phase },
      stats: this.stats,
    }
    this.host = new PluginHost(this.plugins, this.ctx)
  }

  get phase(): EnginePhase {
    return this._phase
  }

  get windX(): number { this.assertLive(); return this.forceWindX }
  set windX(value: number) { this.setPhysicsForce('windX', value) }
  get windY(): number { this.assertLive(); return this.forceWindY }
  set windY(value: number) { this.setPhysicsForce('windY', value) }
  get gravityX(): number { this.assertLive(); return this.forceGravityX }
  set gravityX(value: number) { this.setPhysicsForce('gravityX', value) }
  get gravityY(): number { this.assertLive(); return this.forceGravityY }
  set gravityY(value: number) { this.setPhysicsForce('gravityY', value) }
  get x(): number { this.assertLive(); return this.instanceX }
  set x(value: number) { this.setPosition(value, this.instanceY) }
  get y(): number { this.assertLive(); return this.instanceY }
  set y(value: number) { this.setPosition(this.instanceX, value) }
  /** World displacement extracted from the root in the most recent update. */
  get rootMotionDelta(): Readonly<{ x: number; y: number }> {
    this.assertLive()
    return { x: this.rootDisplacementX, y: this.rootDisplacementY }
  }
  get scaleX(): number { this.assertLive(); return this.instanceScaleX }
  set scaleX(value: number) { this.setScale(value, this.instanceScaleY) }
  get scaleY(): number { this.assertLive(); return this.instanceScaleY }
  set scaleY(value: number) { this.setScale(this.instanceScaleX, value) }

  private setPhysicsForce(field: 'windX' | 'windY' | 'gravityX' | 'gravityY', value: number): void {
    this.assertLive()
    if (!Number.isFinite(value)) throw new Error('E_CONFIG')
    if (field === 'windX') this.forceWindX = value
    else if (field === 'windY') this.forceWindY = value
    else if (field === 'gravityX') this.forceGravityX = value
    else this.forceGravityY = value
    for (const env of this.physicsEnvironments) env[field] = value
  }

  get pose(): Pose {
    this.assertLive()
    if (this.ownedPose === null) throw new Error('E_NO_ASSET')
    return this.ownedPose
  }

  get slotSet(): SlotSet {
    this.assertLive()
    if (this.ownedSlotSet === null) throw new Error('E_NO_ASSET')
    return this.ownedSlotSet
  }

  get skeleton(): Skeleton {
    this.assertLive()
    if (this.ownedSkeleton === null) throw new Error('E_NO_ASSET')
    return this.ownedSkeleton
  }

  get tracks(): Track[] {
    this.assertLive()
    if (this.asset === null) throw new Error('E_NO_ASSET')
    return this.animationState?.tracks ?? this.ownedTracks
  }

  private assertLive(): void {
    if (this._phase === 'disposed') throw new Error('E_DISPOSED')
  }

  /** created/ready/running 可注册；created 阶段的 setup 延迟到 load 的 loading 期。 */
  usePlugin(plugin: EnginePlugin): void {
    this.assertLive()
    const phase = this._phase
    if (phase !== 'created' && phase !== 'ready' && phase !== 'running') throw new Error('E_STATE')
    this.plugins.push(plugin)
    if (phase !== 'created') this.host.setup()
  }

  /** 从不可变资产建立可变实例：Pose / SlotSet / 逆绑定矩阵，并清空播放轨道。 */
  load(asset: SkeletonAsset): void {
    this.assertLive()
    const previous = this._phase
    this._phase = 'loading'
    try {
      if (asset.skeleton.count > this.maxBones) throw new Error('E_CONFIG: maxBones')
      if (asset.atlas !== undefined && asset.atlas.pages.length > this.maxTexturePages) {
        throw new Error('E_CONFIG: maxTexturePages')
      }
      for (const skin of asset.skins.values()) {
        for (const attachment of skin.attachments.values()) {
          if (attachment.kind === 'weightedMesh') {
            let max = 0
            const stride = attachment.mesh.influencesPerVertex ?? 4
            for (let i = 0; i < attachment.mesh.weights.length; i += stride) {
              let count = 0
              for (let j = 0; j < stride; j += 1) if ((attachment.mesh.weights[i + j] ?? 0) > 0) count += 1
              if (count > max) max = count
            }
            if (this.maxInfluences > 0 && max > this.maxInfluences) throw new Error('E_CONFIG: maxInfluences')
          }
        }
      }
      const skins: ReadonlyMap<string, SkinData> = asset.skins.size > 0
        ? asset.skins
        : new Map<string, SkinData>([['default', { id: 'default', attachments: new Map() }]])
      const defaultSkinId = skins.has('default')
        ? 'default'
        : (skins.keys().next().value as string)
      const pose = createPose(asset.skeleton)
      const root = asset.skeleton.roots[0]
      this.rootSampleX = root === undefined ? 0 : pose.local[root * POSE_STRIDE + CH_X]!
      this.rootSampleY = root === undefined ? 0 : pose.local[root * POSE_STRIDE + CH_Y]!
      this.rootDisplacementX = 0
      this.rootDisplacementY = 0
      this.hasUpdatedSinceLoad = false
      setSkeletonTransform(pose, this.instanceX, this.instanceY,
        this.instanceScaleX * (this.flipX ? -1 : 1), this.instanceScaleY * (this.flipY ? -1 : 1))
      updateWorld(pose)
      const slotSet = createSlotSet(asset.slots, skins, defaultSkinId)

      this.asset = asset
      this.ownedPose = pose
      this.ownedSlotSet = slotSet
      this.ownedSkeleton = new Skeleton(this, pose, slotSet)
      this.animationState?.dispose()
      this.animationState = new AnimationState(asset.animations, pose, slotSet)
      this.lastAnimation = null
      this.lastFrame = null
      this.inverseBind = buildInverseBind(pose)
      this.physicsEnvironments.length = 0
      const constraints = asset.constraints?.map(c => {
        if (c.kind !== 'physics') return c
        const environment = {
          referenceScale: c.environment?.referenceScale ?? 1,
          windX: this.forceWindX, windY: this.forceWindY,
          gravityX: this.forceGravityX, gravityY: this.forceGravityY,
          scaleX: pose.skeletonScaleX, scaleY: pose.skeletonScaleY,
        }
        this.physicsEnvironments.push(environment)
        return { ...c, environment }
      })
      this.solver = constraints !== undefined && constraints.length > 0
        ? createConstraintSolver(constraints)
        : null
      // Setup constraints run at load, but physics must initialize on the first update.
      const initialWeights = new Map(constraints?.filter(c => c.kind === 'physics').map(c => [c.id, 0] as const))
      this.solver?.solve(pose, 0, initialWeights, slotSet)
      this.maskLibrary = asset.maskLibrary
      this.renderAssets = buildRenderAssets(asset)
      this.preparedAssets = undefined
      this.ownedTracks.length = 0
      this.host.setup()
      this._phase = 'ready'
    } catch (error) {
      this._phase = previous
      throw error
    }
  }

  get state(): AnimationState {
    this.assertLive()
    if (this.animationState === null) throw new Error('E_NO_ASSET')
    return this.animationState
  }

  /** 播放指定动画；省略名字时取资产首条动画。空资产只切到 running。 */
  play(name?: string): Track | null {
    this.assertLive()
    if (this.asset === null) throw new Error('E_NO_ASSET')
    const animations = this.asset.animations
    let clip
    if (name === undefined) {
      const first = animations.keys().next().value
      clip = first === undefined ? undefined : animations.get(first)
    } else {
      clip = animations.get(name)
      if (clip === undefined) throw new Error('E_STATE: 动画不存在')
    }
    this.ownedTracks.length = 0
    let track: Track | null = null
    if (this.animationState !== null) {
      const target = name ?? this.asset.animations.keys().next().value
      if (target !== undefined) track = this.animationState.play(target)
    } else if (clip !== undefined) {
      track = createTrack(clip)
      this.ownedTracks.push(track)
    }
    this._phase = 'running'
    return track
  }

  pause(): void {
    this.assertLive()
    if (this._phase !== 'running' && this._phase !== 'paused') throw new Error('E_STATE')
    this.animationState?.pause()
    this._phase = 'paused'
  }

  resume(): void {
    this.assertLive()
    if (this._phase !== 'paused') throw new Error('E_STATE')
    this.animationState?.resume()
    this._phase = 'running'
  }

  update(dt: number): void {
    this.assertLive()
    const pose = this.ownedPose
    const slotSet = this.ownedSlotSet
    if (pose === null || slotSet === null || this.asset === null) throw new Error('E_NO_ASSET')
    if (this._phase === 'paused') return // Paused：不推进时间
    if (this._phase === 'contextLost') throw new Error('E_STATE')
    if (this._phase !== 'ready' && this._phase !== 'running' && this._phase !== 'restored') throw new Error('E_STATE')
    if (!Number.isFinite(dt) || dt < 0) throw new Error('E_CONFIG')

    this.host.beforeUpdate(dt)
    this.rootDisplacementX = 0
    this.rootDisplacementY = 0
    const step = (h: number): void => {
      if (this.animationState !== null) {
        this.lastAnimation = this.animationState.update(h)
        if (this.lastAnimation.drawOrder !== undefined && this.lastAnimation.drawOrder.length === slotSet.slots.length) {
          slotSet.drawOrder.length = 0
          slotSet.drawOrder.push(...this.lastAnimation.drawOrder)
        }
      } else {
        this.lastAnimation = sampleAnimation(this.ownedTracks, pose, slotSet, h)
      }
      if (this.rootMotionMode === 'entity') this.consumeRootMotion(pose)
      if (this.solver !== null) this.solver.solve(pose, h, this.lastAnimation?.constraintMixByName, slotSet, true)
      updateWorld(pose)
    }
    if (this.fixedDt === undefined) {
      step(dt)
    } else {
      // 固定步长：最多 4 子步；多余时间丢弃（防螺旋），余数留到下一帧。
      this.accumulator = Math.min(this.accumulator + dt, this.fixedDt * 4)
      let steps = Math.floor(this.accumulator / this.fixedDt + 1e-9)
      if (steps > 4) steps = 4
      this.accumulator -= steps * this.fixedDt
      if (this.accumulator < 0) this.accumulator = 0
      for (let i = 0; i < steps; i += 1) step(this.fixedDt)
    }
    this.host.afterUpdate(dt)
    this.ownedSkeleton?.advanceTime(dt)
    this.hasUpdatedSinceLoad = true
  }

  private consumeRootMotion(pose: Pose): void {
    const root = pose.skeleton.roots[0]
    if (root === undefined) return
    const offset = root * POSE_STRIDE
    const x = pose.local[offset + CH_X]!, y = pose.local[offset + CH_Y]!
    const dx = x - this.rootSampleX, dy = y - this.rootSampleY
    this.rootSampleX = x
    this.rootSampleY = y
    if (dx !== 0 || dy !== 0) {
      const sx = pose.skeletonScaleX, sy = pose.skeletonScaleY
      this.setPosition(this.instanceX + dx * sx, this.instanceY + dy * sy)
      this.rootDisplacementX += dx * sx
      this.rootDisplacementY += dy * sy
    }
    const setup = pose.skeleton.setupLocal
    setLocal(pose, root, CH_X, setup[offset + CH_X]!)
    setLocal(pose, root, CH_Y, setup[offset + CH_Y]!)
  }

  /** 模拟 WebGL 上下文丢失：暂停绘制，保留实例状态。 */
  contextLost(): void {
    this.assertLive()
    if (this._phase === 'created' || this._phase === 'loading') throw new Error('E_STATE')
    this._phase = 'contextLost'
  }

  /** 上下文恢复：重建后端资源，后续 render 重新可用。 */
  contextRestored(): void {
    this.assertLive()
    if (this._phase !== 'contextLost') throw new Error('E_STATE')
    this.backend.restore?.()
    this.preparedAssets = undefined
    this._phase = 'restored'
  }

  render(): RenderFrame {
    this.assertLive()
    const pose = this.ownedPose
    const slotSet = this.ownedSlotSet
    if (pose === null || slotSet === null || this.asset === null || this.inverseBind === null) {
      throw new Error('E_NO_ASSET')
    }
    if (this._phase === 'contextLost' || this._phase === 'created' || this._phase === 'loading') {
      throw new Error('E_STATE')
    }

    const rules = this.host.viewRules()
    // View rules can switch clipping attachments, so resolve them before this frame's scopes.
    if (rules.length > 0) {
      for (const slotIndex of slotSet.drawOrder) {
        const slot = slotSet.slots[slotIndex]
        if (slot === undefined) continue
        const current = slot.attachmentId
        const picked = resolveViewRule(rules, this.camera, slotIndex, current, 0)
        if (picked.attachment !== null && picked.attachment !== current) {
          setSlotAttachment(slotSet, slotIndex, picked.attachment)
        }
      }
    }
    const resolved = resolveMaskPaths(slotSet, this.maskLibrary, pose, this.asset.atlas)
    const packetMaskPaths: MaskPathNode[] = [...resolved.maskPaths]
    const residualPaths = new Map<number, number>()
    const residualMaskPath = (path: number): number => {
      if (path < 0) return -1
      const cached = residualPaths.get(path)
      if (cached !== undefined) return cached
      const chain = maskChain(path, resolved.maskPaths)
      if (chain.error) return path
      let remaining = -1
      for (const id of chain.ids) {
        const mask = resolved.masks[id]
        if (mask === null || mask === undefined || (mask.mode === 'stencil' && !mask.invert)) continue
        packetMaskPaths.push({ maskId: id, parent: remaining })
        remaining = packetMaskPaths.length - 1
      }
      residualPaths.set(path, remaining)
      return remaining
    }
    const packets: RenderPacket[] = []
    const clipStats = { clippedIn: 0, clippedOut: 0 }
    const drawOrder = slotSet.drawOrder
    for (let seq = 0; seq < drawOrder.length; seq += 1) {
      const slotIndex = drawOrder[seq]!
      const slot = slotSet.slots[slotIndex]
      if (slot === undefined) continue
      const attachment = resolveAttachment(slotSet, slotIndex)
      if (!asRenderable(attachment)) continue
      const maskPath = resolved?.paths[slotIndex] ?? -1
      const packet = this.buildPacket(attachment, slotIndex, seq, pose, maskPath, resolved, clipStats)
      if (packet !== null) packets.push({ ...packet, maskPath: residualMaskPath(maskPath) })
    }

    const outlined = this.outline === undefined
      ? packets
      : packets.flatMap((packet) => [
          packet,
          buildOutlinePacket(packet, this.outline!.width, this.outline!.color, packet.id + 100000, packet.seq),
        ])
    const frame: RenderFrame = {
      packets: batchPackets(sortPackets(outlined)),
      stats: { inputPackets: outlined.length, ...clipStats },
      width: this.viewport.width,
      height: this.viewport.height,
      viewProjection: this.viewProjection,
      ...(this.renderAssets === undefined ? {} : { assets: this.renderAssets }),
      maskPaths: packetMaskPaths, masks: { version: 1, masks: resolved.masks },
      depthMode: 'none',
    }
    if (this.renderAssets !== undefined && this.preparedAssets !== this.renderAssets && this.backend.prepare !== undefined) {
      this.backend.prepare(this.renderAssets)
      this.preparedAssets = this.renderAssets
    }
    this.lastFrame = frame
    this.backend.draw(frame)
    this.host.afterRender(frame)
    return frame
  }

  /** 收集当前 packet 的 stencil/clipping 多边形（世界空间）；alpha/scissor 不参与几何裁剪。 */
  private clipPolygonsFor(
    resolved: { readonly maskPaths: readonly { readonly maskId: number; readonly parent: number }[]; readonly masks: readonly (RenderMask | null)[] } | undefined,
    maskPath: number,
  ): Float32Array[] {
    if (resolved === undefined || maskPath < 0) return []
    const chain = maskChain(maskPath, resolved.maskPaths)
    if (chain.error) return []
    const out: Float32Array[] = []
    for (const id of chain.ids) {
      const mask = resolved.masks[id]
      if (mask !== null && mask !== undefined && mask.mode === 'stencil' && !mask.invert) out.push(mask.positions)
    }
    return out
  }

  /** 附件 → packet：region 用骨世界矩阵变换默认四边形；mesh/weightedMesh 走蒙皮。 */
  private buildPacket(
    attachment: RenderableAttachment,
    slotIndex: number,
    seq: number,
    pose: Pose,
    maskPath: number,
    resolved: { readonly maskPaths: readonly { readonly maskId: number; readonly parent: number }[]; readonly masks: readonly (RenderMask | null)[] } | undefined,
    clipStats?: { clippedIn: number; clippedOut: number },
  ): RenderPacket | null {
    const slot = this.ownedSlotSet!.slots[slotIndex]!
    const sequence = attachment.kind === 'region' ? attachment.region.sequence : undefined
    const animatedIndex = this.lastAnimation?.sequence.get(slotIndex)
    const sequenceIndex = sequence !== undefined
      ? Math.max(0, Math.min(sequence.frames.length - 1,
        animatedIndex === undefined || animatedIndex === -1 ? sequence.setupIndex : animatedIndex))
      : 0
    const sequenceKey = sequence !== undefined ? sequence.frames[sequenceIndex] : undefined
    const atlas = atlasUvOf(this.asset!, attachment, sequenceKey)
    const dark = this.lastAnimation?.colorDark.get(slotIndex) ?? slot.data.dark ?? attachment.dark
    const light = attachment.color
    const alpha = slot.color.a * light.a
    const tint = spinePmaTint(this.color, slot.color, light, dark)
    const base = {
      id: slotIndex,
      color: [slot.color.r * light.r, slot.color.g * light.g,
        slot.color.b * light.b, alpha] as [number, number, number, number],
      lightBytes: tint.light,
      ...(dark !== undefined
        ? { dark: [dark.r * alpha, dark.g * alpha, dark.b * alpha, 1] as [number, number, number, number], darkBytes: tint.dark!, twoColor: true }
        : {}),
      materialId: atlas?.materialId ?? 0,
      order: seq,
      depthKey: slot.data.zOffset,
      subOrder: 0,
      seq,
      maskPath,
      ...(atlas === null ? {} : { page: atlas.page }),
      blend: slot.data.blend,
    }

    if (attachment.kind === 'region') {
      const off = slot.data.bone * WORLD_STRIDE
      const m = pose.world
      const region = attachment.region
      const atlasRegion = this.asset!.atlas?.regions.get(sequenceKey ?? region.atlasKey)
      const unitScale = this.asset!.unitScale
      const width = region.width ?? (atlasRegion !== undefined && atlasRegion.trim.sourceWidth > 0
        ? atlasRegion.trim.sourceWidth * unitScale : 1)
      const height = region.height ?? (atlasRegion !== undefined && atlasRegion.trim.sourceHeight > 0
        ? atlasRegion.trim.sourceHeight * unitScale : 1)
      const sx = region.scaleX ?? 1
      const sy = region.scaleY ?? 1
      const scaleX = atlasRegion !== undefined && atlasRegion.trim.sourceWidth > 0
        ? width / atlasRegion.trim.sourceWidth * sx : width * sx
      const scaleY = atlasRegion !== undefined && atlasRegion.trim.sourceHeight > 0
        ? height / atlasRegion.trim.sourceHeight * sy : height * sy
      const x0 = -width / 2 * sx + (atlasRegion?.trim.offsetX ?? 0) * scaleX
      const y0 = -height / 2 * sy + (atlasRegion?.trim.offsetY ?? 0) * scaleY
      const x1 = x0 + (atlasRegion?.width ?? 1) * scaleX
      const y1 = y0 + (atlasRegion?.height ?? 1) * scaleY
      const rot = region.rotation ?? 0
      const cos = Math.cos(rot)
      const sin = Math.sin(rot)
      const px = region.x ?? 0
      const py = region.y ?? 0
      const corners = [x0, y0, x0, y1, x1, y1, x1, y0]
      const positions = new Float32Array(8)
      for (let v = 0; v < 4; v += 1) {
        const lx = corners[v * 2]!
        const ly = corners[v * 2 + 1]!
        const x = lx * cos - ly * sin + px
        const y = lx * sin + ly * cos + py
        positions[v * 2] = m[off]! * x + m[off + 2]! * y + m[off + 4]!
        positions[v * 2 + 1] = m[off + 1]! * x + m[off + 3]! * y + m[off + 5]!
      }
      const uvs = atlas?.uvs ?? attachment.region.uvs ?? new Float32Array([0, 1, 0, 0, 1, 0, 1, 1])
      const polygons = this.clipPolygonsFor(resolved, maskPath)
      if (polygons.length > 0) {
        const clipped = clipTriangles(positions, uvs, new Uint16Array([0, 1, 2, 0, 2, 3]), polygons)
        if (clipStats !== undefined) {
          clipStats.clippedIn += 2
          clipStats.clippedOut += clipped.indices.length / 3
        }
        return buildMeshPacket({
          ...base, kind: 'region', positions: clipped.positions, uvs: clipped.uvs,
          indices: clipped.indices, depth: null,
        })
      }
      return buildRegionPacket({ ...base, positions, uvs, kind: 'region' })
    }

    const baseMesh: MeshData | WeightedMeshData = attachment.mesh
    const meshKey = `${slot.skinId}:${slotIndex}:${attachment.id}`
    const offsets = this.lastAnimation?.deformOffsets.get(meshKey)
    let mesh: MeshData | WeightedMeshData = baseMesh
    if (offsets !== undefined && offsets.length > 0 && attachment.kind !== 'weightedMesh') {
      const deformed = new Float32Array(baseMesh.positions.length)
      deformed.set(baseMesh.positions)
      const n = Math.min(deformed.length, offsets.length)
      for (let i = 0; i < n; i += 1) deformed[i] = deformed[i]! + offsets[i]!
      mesh = { ...baseMesh, positions: deformed }
    }
    try {
      const inverseBind = this.inverseBind!
      const positions = skinMesh2D(mesh, pose, inverseBind, undefined,
        attachment.kind === 'weightedMesh' ? offsets : undefined)
      const uvs = atlas?.uvs ?? mesh.uvs
      const polygons = this.clipPolygonsFor(resolved, maskPath)
      if (polygons.length > 0) {
        const clipped = clipTriangles(positions, uvs, mesh.indices, polygons)
        if (clipStats !== undefined) {
          clipStats.clippedIn += mesh.indices.length / 3
          clipStats.clippedOut += clipped.indices.length / 3
        }
        return buildMeshPacket({
          ...base, positions: clipped.positions, uvs: clipped.uvs,
          indices: clipped.indices, depth: null, kind: 'mesh',
        })
      }
      return buildMeshPacket({
        ...base,
        positions,
        uvs,
        indices: mesh.indices,
        depth: null,
        kind: 'mesh',
      })
    } catch {
      // 骨索引越界/绑定矩阵不可逆：降级为空 packet，不让单帧崩掉。
      return buildMeshPacket({
        ...base,
        positions: new Float32Array(0),
        uvs: new Float32Array(0),
        indices: new Uint16Array(0),
        kind: 'mesh',
      })
    }
  }

  /** 设置 2D/2.5D 相机；viewRules 与投影随之更新。 */
  setCamera(camera: Camera): void {
    this.assertLive()
    this.camera = camera
    this.viewProjection = viewProjection2D(camera)
  }

  /** Instance reflection participates in skeleton world transforms and physics. */
  setFlip(flipX: boolean, flipY: boolean): void {
    this.assertLive()
    this.flipX = flipX
    this.flipY = flipY
    this.syncSkeletonTransform()
  }

  setPosition(x: number, y: number): void {
    this.assertLive()
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('E_CONFIG')
    if (this.rootMotionMode === 'entity') {
      const sx = this.instanceScaleX * (this.flipX ? -1 : 1)
      const sy = this.instanceScaleY * (this.flipY ? -1 : 1)
      this.solver?.physicsTranslate((x - this.instanceX) / sx, (y - this.instanceY) / sy)
    }
    this.instanceX = x
    this.instanceY = y
    this.syncSkeletonTransform()
  }

  private syncSkeletonTransform(): void {
    const sx = this.instanceScaleX * (this.flipX ? -1 : 1)
    const sy = this.instanceScaleY * (this.flipY ? -1 : 1)
    if (this.ownedPose !== null) {
      // Load initializes physics at its current scale; pre-update reflection needs a fresh baseline.
      if (!this.hasUpdatedSinceLoad &&
          (sx !== this.ownedPose.skeletonScaleX || sy !== this.ownedPose.skeletonScaleY)) this.solver?.reset()
      setSkeletonTransform(this.ownedPose, this.instanceX, this.instanceY, sx, sy)
    }
    for (const env of this.physicsEnvironments) {
      env.scaleX = sx
      env.scaleY = sy
    }
  }

  /** Instance scale is a skeleton transform, never a bone local rewrite. */
  setScale(scaleX: number, scaleY: number): void {
    this.assertLive()
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX === 0 || scaleY === 0) {
      throw new Error('E_CONFIG')
    }
    this.instanceScaleX = scaleX
    this.instanceScaleY = scaleY
    this.syncSkeletonTransform()
  }

  /** 换肤：只换附件集合，不改 pose/drawOrder。 */
  setSkinByName(name: string): void {
    this.assertLive()
    if (this.ownedSlotSet === null) throw new Error('E_NO_ASSET')
    setSkin(this.ownedSlotSet, name)
  }

  /** 单槽附件覆盖；名字不存在时清空该槽。 */
  setAttachment(slotName: string, attachmentName: string | null): void {
    this.assertLive()
    const set = this.ownedSlotSet
    if (set === null) throw new Error('E_NO_ASSET')
    const index = set.slots.findIndex((slot) => slot.data.id === slotName)
    if (index < 0) throw new Error('E_ATTACHMENT')
    setSlotAttachment(set, index, attachmentName)
  }

  /** Restores bone locals without updating world transforms or animation state. */
  setupPoseBones(): void {
    this.assertLive()
    const pose = this.ownedPose
    if (pose === null) throw new Error('E_NO_ASSET')
    pose.local.set(pose.skeleton.setupLocal)
    const root = pose.skeleton.roots[0]
    if (root !== undefined) {
      this.rootSampleX = pose.local[root * POSE_STRIDE + CH_X]!
      this.rootSampleY = pose.local[root * POSE_STRIDE + CH_Y]!
    }
    markAllDirty(pose)
  }

  /** Restores setup attachments, colors, and draw order without changing bones. */
  setupPoseSlots(): void {
    this.assertLive()
    const set = this.ownedSlotSet
    if (set === null) throw new Error('E_NO_ASSET')
    for (const slot of set.slots) {
      slot.attachmentId = slot.data.attachment
      slot.color = slot.data.color
    }
    set.drawOrder.length = 0
    set.drawOrder.push(...set.slots.map((_, i) => i).sort((a, b) => set.slots[a]!.data.order - set.slots[b]!.data.order))
  }

  setBonesToSetupPose(): void {
    this.setupPoseBones()
  }

  setSlotsToSetupPose(): void {
    this.setupPoseSlots()
  }

  setupPose(options: { stopOnSetupPose?: boolean } = {}): void {
    this.setupPoseBones()
    this.setupPoseSlots()
    if (options.stopOnSetupPose) this.animationState?.stop()
  }

  /** Legacy alias; stopping playback requires explicit opt-in. */
  setToSetupPose(options: { stopOnSetupPose?: boolean } = {}): void {
    this.setupPose(options)
  }

  /** 当前渲染包围盒（裁剪前、不含描边）；用于取景/调试。 */
  getBounds(): { x: number; y: number; width: number; height: number } {
    this.assertLive()
    const pose = this.ownedPose
    const set = this.ownedSlotSet
    if (pose === null || set === null) throw new Error('E_NO_ASSET')
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let seq = 0; seq < set.drawOrder.length; seq += 1) {
      const index = set.drawOrder[seq]!
      const attachment = resolveAttachment(set, index)
      if (!asRenderable(attachment)) continue
      const packet = this.buildPacket(attachment, index, seq, pose, -1, undefined)
      if (packet === null) continue
      for (let i = 0; i + 1 < packet.positions.length; i += 2) {
        minX = Math.min(minX, packet.positions[i]!)
        maxX = Math.max(maxX, packet.positions[i]!)
        minY = Math.min(minY, packet.positions[i + 1]!)
        maxY = Math.max(maxY, packet.positions[i + 1]!)
      }
    }
    if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }

  /** 调试叠加线：需先 render 一帧；不修改生产 packet/pose。 */
  debugLines(flags: Partial<DebugFlags>): DebugLine[] {
    this.assertLive()
    if (this.lastFrame === null || this.ownedPose === null || this.ownedSlotSet === null) return []
    return buildDebugLines({
      pose: this.ownedPose, slotSet: this.ownedSlotSet,
      packets: this.lastFrame.packets,
      ...(this.lastFrame.masks === undefined ? {} : { masks: this.lastFrame.masks.masks }),
      bounds: this.getBounds(), flags,
    })
  }

  readPixels(): Uint8ClampedArray {
    this.assertLive()
    return this.backend.readPixels()
  }

  /** 幂等：首次释放插件与后端并置 disposed；之后仅 phase 可读。 */
  dispose(): void {
    if (this._phase === 'disposed') return
    this.host.dispose()
    this.backend.dispose()
    this.animationState?.dispose()
    this.animationState = null
    this._phase = 'disposed'
    this.asset = null
    this.ownedPose = null
    this.ownedSlotSet = null
    this.ownedSkeleton = null
    this.inverseBind = null
    this.solver = null
    this.ownedTracks.length = 0
  }
}
