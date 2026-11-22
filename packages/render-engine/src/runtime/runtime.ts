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
import { createConstraintSolver, type ConstraintData, type ConstraintSolver } from '../constraint/constraint'
import { AnimationState, createTrack, sampleAnimation, type SampleResult, type Track } from '../animation/animation'
import { buildInverseBind, skinMesh2D, type MeshData, type WeightedMeshData } from '../mesh/mesh'
import { createPose, markAllDirty, setLocal, updateWorld, type Pose } from '../core/pose'
import { CH_SX, CH_SY, POSE_STRIDE, WORLD_STRIDE } from '../core/math'
import {
  buildMaskSet,
  maskChain,
  buildMeshPacket,
  batchPackets,
  buildOutlinePacket,
  buildRegionPacket,
  sortPackets,
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
  type Attachment,
  type SkinData,
  type SlotSet,
} from '../slot/slot'
import { DEFAULT_CAMERA, viewProjection2D, type Camera } from '../render/camera'
import type { SkeletonAsset, MaskLibrary } from '../asset/importer'
import type { AtlasData } from '../asset/atlas'
import { resolveViewRule, type ViewRule } from '../volume/volume'
import { clipTriangles } from '../render/clipping'

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
  fixedDt?: number
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
function defaultBackendFactory(kind: 'cpu' | 'webgl2'): RenderBackend {
  if (kind === 'cpu') return new CpuBackend({ width: 1, height: 1 })
  if (typeof document === 'undefined') throw new Error('E_BACKEND: WebGL2 上下文不可用')
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
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
      pma: true,
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
 * 把 MaskLibrary 的 clip scope 展开成每个 slot 的 maskPath。
 * 结束槽位本身不受该 mask 影响（半开区间）；clipping 槽不产生绘制。
 */
export function resolveMaskPaths(
  slotSet: SlotSet,
  library: MaskLibrary,
  pose?: Pose,
  atlas?: AtlasData,
): ResolvedMasks {
  const byId = new Map<string, number>()
  library.masks.forEach((mask, index) => byId.set(mask.id, index))
  const paths = new Array<number>(slotSet.slots.length).fill(-1)
  const nodes: MaskPathNode[] = []
  const masks: (RenderMask | null)[] = new Array(library.masks.length).fill(null)
  const open: Array<{ maskId: number; path: number; endSlotId: string }> = []
  for (const slotIndex of slotSet.drawOrder) {
    const slot = slotSet.slots[slotIndex]
    if (slot === undefined) continue
    while (open.length > 0 && open[open.length - 1]!.endSlotId === slot.data.id) open.pop()
    const attachment = resolveAttachment(slotSet, slotIndex)
    if (attachment !== null && attachment.kind === 'clipping') {
      const maskIndex = byId.get(attachment.id) ?? byId.get(slot.data.id)
      if (maskIndex !== undefined) {
        const def = library.masks[maskIndex]!
        const parent = open.length > 0 ? open[open.length - 1]!.path : -1
        nodes.push({ maskId: maskIndex, parent })
        open.push({ maskId: maskIndex, path: nodes.length - 1, endSlotId: def.endSlotId })
        if (masks[maskIndex] == null) masks[maskIndex] = buildRuntimeMask(def, slotSet, pose, atlas)
      }
      paths[slotIndex] = -1
      continue
    }
    let path = open.length > 0 ? open[open.length - 1]!.path : -1
    // 显式 slot mask：在 clip scope 之外再追加一个内层 mask，仅作用于该 slot。
    if (slot.data.mask !== null) {
      const explicit = byId.get(slot.data.mask)
      if (explicit !== undefined) {
        const def = library.masks[explicit]!
        nodes.push({ maskId: explicit, parent: path })
        path = nodes.length - 1
        if (masks[explicit] == null) masks[explicit] = buildRuntimeMask(def, slotSet, pose, atlas)
      }
    }
    paths[slotIndex] = path
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
function atlasUvOf(asset: SkeletonAsset, attachment: RenderableAttachment): {
  uvs: Float32Array; page: number; materialId: number
} | null {
  const atlas = asset.atlas
  if (atlas === undefined) return null
  const key = attachment.region.atlasKey
  const region = atlas.regions.get(key)
  if (region === undefined) return null
  const source = attachment.kind === 'region'
    ? (attachment.region.uvs ?? new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]))
    : attachment.mesh.uvs
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

export class Engine {
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
  private readonly ownedTracks: Track[] = []
  private inverseBind: Float32Array | null = null
  private solver: ConstraintSolver | null = null
  private animationState: AnimationState | null = null
  private lastAnimation: SampleResult | null = null
  private flipX = false
  private flipY = false
  private instanceScaleX = 1
  private instanceScaleY = 1
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
    this.maxInfluences = config.maxInfluences ?? 4
    this.fixedDt = config.fixedDt
    this.outline = config.outline
    if (!Number.isInteger(this.maxBones) || this.maxBones < 1 ||
        !Number.isInteger(this.maxTexturePages) || this.maxTexturePages < 1 || this.maxTexturePages > 4 ||
        !Number.isInteger(this.maxInfluences) || this.maxInfluences < 1 || this.maxInfluences > 4) {
      throw new Error('E_CONFIG')
    }
    const factory = deps?.backendFactory ?? defaultBackendFactory
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
            for (let i = 0; i < attachment.mesh.weights.length; i += 4) {
              let count = 0
              for (let j = 0; j < 4; j += 1) if ((attachment.mesh.weights[i + j] ?? 0) > 0) count += 1
              if (count > max) max = count
            }
            if (max > this.maxInfluences) throw new Error('E_CONFIG: maxInfluences')
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
      updateWorld(pose)
      const slotSet = createSlotSet(asset.slots, skins, defaultSkinId)

      this.asset = asset
      this.ownedPose = pose
      this.ownedSlotSet = slotSet
      this.animationState?.dispose()
      this.animationState = new AnimationState(asset.animations, pose, slotSet)
      this.lastAnimation = null
      this.inverseBind = buildInverseBind(pose)
      this.solver = asset.constraints !== undefined && asset.constraints.length > 0
        ? createConstraintSolver(asset.constraints)
        : null
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

  /** 播放指定动画；省略名字时取资产首条动画。空资产只切到 running。 */
  play(name?: string): void {
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
    if (this.animationState !== null) {
      const target = name ?? this.asset.animations.keys().next().value
      if (target !== undefined) this.animationState.play(target)
    } else if (clip !== undefined) {
      this.ownedTracks.push(createTrack(clip))
    }
    this._phase = 'running'
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
      const root = pose.skeleton.roots[0]
      if (root !== undefined && (this.flipX || this.flipY || this.instanceScaleX !== 1 || this.instanceScaleY !== 1)) {
        const base = root * POSE_STRIDE
        const sx = pose.skeleton.setupLocal[base + CH_SX] ?? 1
        const sy = pose.skeleton.setupLocal[base + CH_SY] ?? 1
        setLocal(pose, root, CH_SX, sx * (this.flipX ? -1 : 1) * this.instanceScaleX)
        setLocal(pose, root, CH_SY, sy * (this.flipY ? -1 : 1) * this.instanceScaleY)
      }
      if (this.solver !== null) this.solver.solve(pose, h)
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

    const resolved = this.maskLibrary !== undefined
      ? resolveMaskPaths(slotSet, this.maskLibrary, pose, this.asset.atlas)
      : undefined
    const rules = this.host.viewRules()
    const packets: RenderPacket[] = []
    const drawOrder = slotSet.drawOrder
    for (let seq = 0; seq < drawOrder.length; seq += 1) {
      const slotIndex = drawOrder[seq]!
      const slot = slotSet.slots[slotIndex]
      if (slot === undefined) continue
      if (rules.length > 0) {
        const current = slot.attachmentId
        const picked = resolveViewRule(rules, this.camera, slotIndex, current, 0)
        if (picked.attachment !== null && picked.attachment !== current) {
          setSlotAttachment(slotSet, slotIndex, picked.attachment)
        }
      }
      const attachment = resolveAttachment(slotSet, slotIndex)
      if (!asRenderable(attachment)) continue
      const maskPath = resolved?.paths[slotIndex] ?? 0
      const packet = this.buildPacket(attachment, slotIndex, seq, pose, maskPath, resolved)
      if (packet !== null) packets.push(packet)
    }

    const outlined = this.outline === undefined
      ? packets
      : packets.flatMap((packet) => [
          packet,
          buildOutlinePacket(packet, this.outline!.width, this.outline!.color, packet.id + 100000, packet.seq),
        ])
    const frame: RenderFrame = {
      packets: batchPackets(sortPackets(outlined)),
      width: this.viewport.width,
      height: this.viewport.height,
      viewProjection: this.viewProjection,
      ...(this.renderAssets === undefined ? {} : { assets: this.renderAssets }),
      ...(resolved === undefined ? {} : { maskPaths: resolved.maskPaths, masks: { version: this.maskLibrary!.version, masks: resolved.masks } }),
      depthMode: 'none',
    }
    if (this.renderAssets !== undefined && this.preparedAssets !== this.renderAssets && this.backend.prepare !== undefined) {
      this.backend.prepare(this.renderAssets)
      this.preparedAssets = this.renderAssets
    }
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
      if (mask !== null && mask !== undefined && mask.mode === 'stencil') out.push(mask.positions)
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
  ): RenderPacket | null {
    const slot = this.ownedSlotSet!.slots[slotIndex]!
    const atlas = atlasUvOf(this.asset!, attachment)
    const dark = slot.data.dark ?? attachment.dark
    const hasDark = dark !== undefined && (dark.r > 0 || dark.g > 0 || dark.b > 0 || dark.a > 0)
    const base = {
      id: slotIndex,
      color: [slot.color.r, slot.color.g, slot.color.b, slot.color.a] as [number, number, number, number],
      ...(hasDark && dark !== undefined
        ? { dark: [dark.r, dark.g, dark.b, dark.a] as [number, number, number, number], twoColor: true }
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
      const atlasRegion = this.asset!.atlas?.regions.get(region.atlasKey)
      const sourceW = atlasRegion !== undefined && atlasRegion.trim.sourceWidth > 0
        ? atlasRegion.trim.sourceWidth
        : (region.width ?? 1)
      const sourceH = atlasRegion !== undefined && atlasRegion.trim.sourceHeight > 0
        ? atlasRegion.trim.sourceHeight
        : (region.height ?? 1)
      const w = atlasRegion !== undefined ? atlasRegion.width : sourceW
      const h = atlasRegion !== undefined ? atlasRegion.height : sourceH
      const ox = atlasRegion !== undefined ? atlasRegion.trim.offsetX : 0
      const oy = atlasRegion !== undefined ? atlasRegion.trim.offsetY : 0
      const x0 = -sourceW / 2 + ox
      const y0 = -sourceH / 2 + oy
      const x1 = x0 + w
      const y1 = y0 + h
      const sx = region.scaleX ?? 1
      const sy = region.scaleY ?? 1
      const rot = region.rotation ?? 0
      const cos = Math.cos(rot)
      const sin = Math.sin(rot)
      const px = region.x ?? 0
      const py = region.y ?? 0
      const corners = [x0, y0, x1, y0, x1, y1, x0, y1]
      const positions = new Float32Array(8)
      for (let v = 0; v < 4; v += 1) {
        const lx = corners[v * 2]! * sx
        const ly = corners[v * 2 + 1]! * sy
        const x = lx * cos - ly * sin + px
        const y = lx * sin + ly * cos + py
        positions[v * 2] = m[off]! * x + m[off + 2]! * y + m[off + 4]!
        positions[v * 2 + 1] = m[off + 1]! * x + m[off + 3]! * y + m[off + 5]!
      }
      const uvs = atlas?.uvs ?? attachment.region.uvs ?? new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
      const polygons = this.clipPolygonsFor(resolved, maskPath)
      if (polygons.length > 0) {
        const clipped = clipTriangles(positions, uvs, new Uint16Array([0, 1, 2, 0, 2, 3]), polygons)
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
    if (offsets !== undefined && offsets.length > 0) {
      const deformed = new Float32Array(baseMesh.positions.length)
      deformed.set(baseMesh.positions)
      const n = Math.min(deformed.length, offsets.length)
      for (let i = 0; i < n; i += 1) deformed[i] = deformed[i]! + offsets[i]!
      mesh = { ...baseMesh, positions: deformed }
    }
    try {
      const inverseBind = this.inverseBind!
      const positions = skinMesh2D(mesh, pose, inverseBind)
      const uvs = atlas?.uvs ?? mesh.uvs
      const polygons = this.clipPolygonsFor(resolved, maskPath)
      if (polygons.length > 0) {
        const clipped = clipTriangles(positions, uvs, mesh.indices, polygons)
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

  /** 实例级翻转；只影响渲染，不写资产/setup。 */
  setFlip(flipX: boolean, flipY: boolean): void {
    this.assertLive()
    this.flipX = flipX
    this.flipY = flipY
  }

  /** 实例级缩放；作用在根骨，不改变其他骨 local。 */
  setScale(scaleX: number, scaleY: number): void {
    this.assertLive()
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX === 0 || scaleY === 0) {
      throw new Error('E_CONFIG')
    }
    this.instanceScaleX = scaleX
    this.instanceScaleY = scaleY
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

  /** 恢复 setup pose / slot 颜色 / 附件 / draw order；停止播放。 */
  setToSetupPose(): void {
    this.assertLive()
    const pose = this.ownedPose
    const set = this.ownedSlotSet
    if (pose === null || set === null) throw new Error('E_NO_ASSET')
    pose.local.set(pose.skeleton.setupLocal)
    markAllDirty(pose)
    for (const slot of set.slots) {
      slot.attachmentId = slot.data.attachment
      slot.color = slot.data.color
    }
    set.drawOrder.length = 0
    set.drawOrder.push(...set.slots.map((_, i) => i).sort((a, b) => set.slots[a]!.data.order - set.slots[b]!.data.order))
    this.animationState?.stop()
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
      const packet = this.buildPacket(attachment, index, seq, pose, 0, undefined)
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
    this.inverseBind = null
    this.solver = null
    this.ownedTracks.length = 0
  }
}
