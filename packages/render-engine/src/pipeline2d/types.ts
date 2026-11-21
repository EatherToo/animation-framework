/**
 * 2D 渲染包的数据模型（R1）。
 *
 * 只描述“画什么”，不出现 Canvas / WebGL / DOM。旧的 `part/*`、`view/*`、
 * `texture/*` 继续作为过渡 3D 路径；这里的 Slot/Attachment/Skin 是目标模型。
 */

/** 0–1 的 RGBA。 */
export type RGBA = {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/** 屏幕/局部平面矩形。 */
export type Rect = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type BlendMode = 'normal' | 'add' | 'multiply' | 'screen'

export type OutlineJoin = 'round' | 'bevel' | 'miter'
export type OutlineCap = 'butt' | 'round' | 'square'

/** 2D 网格。positions 步长 2；权重固定每顶点 4 个槽位。 */
export type RenderMesh = {
  /** 顶点平面坐标，步长 2，不含 3D z。 */
  readonly positions: Float32Array
  /** 归一化 UV，步长 2；平涂材质可以为空。 */
  readonly uvs: Float32Array
  readonly indices: Uint16Array
  /** 每顶点基础色，步长 4（RGBA 0–255）；空 = 用材质色。 */
  readonly colors: Uint8Array
  /** 每顶点 4 个骨骼下标；空 = 跟 Slot 的父骨。 */
  readonly boneIndices: Uint16Array
  /** 每顶点 4 个权重，和归一化；空 = 无权重。 */
  readonly weights: Float32Array
  /** 1 = 硬边/缝线；空 = 无缝线。 */
  readonly seam: Uint8Array
  /** 每顶点一个深度排序键；越大越远。 */
  readonly depth: Float32Array
  /** 局部包围盒；空时由几何计算。 */
  readonly bounds: Rect | null
}

export type RenderMaterial =
  | {
      readonly kind: 'flat'
      readonly color: RGBA
    }
  | {
      readonly kind: 'atlas'
      readonly page: number
      readonly region: Rect
      readonly tint: RGBA
      readonly filter: 'linear' | 'nearest'
    }

export type RenderOutline = {
  /** 屏幕像素宽度。 */
  readonly widthPx: number
  readonly color: RGBA
  readonly join: OutlineJoin
  readonly cap: OutlineCap
  /** 描边相对填充的屏幕深度偏置，默认 0。 */
  readonly depthBias: number
}

export type RenderAttachment = {
  readonly id: string
  readonly skin: string
  readonly mesh: RenderMesh
  readonly material: RenderMaterial
  readonly outline: RenderOutline | null
  /** 图集 region 的键；缺省用 id。肩部 yoke 可指向袖子 region。 */
  readonly atlasKey?: string
}

export type RenderSkin = {
  readonly id: string
  readonly attachments: readonly RenderAttachment[]
}

export type RenderSlot = {
  readonly id: string
  /** 绘制主序：越小越先画（越远）。 */
  readonly order: number
  readonly tint: RGBA
  readonly blend: BlendMode
  readonly mask: string | null
  readonly attachment: string | null
}

export type RenderScene = {
  readonly slots: readonly RenderSlot[]
  readonly skins: readonly RenderSkin[]
}

/** 一个部件交给后端的最终绘制包。 */
export type RenderPacket = {
  readonly version: 2
  readonly partId: string
  readonly vertices: Float32Array
  readonly uvs: Float32Array
  readonly indices: Uint16Array
  readonly colors: Uint8Array
  /** 1 = 硬边/缝线；空 = 无缝线。 */
  readonly seam: Uint8Array
  readonly outline: RenderOutline | null
  readonly atlasPage: number
  /** 图集 region 键；与附件 atlasKey/默认 id 对应。 */
  readonly atlasKey: string
  /** 材质/图集页的稳定 id；flat 为 -1。 */
  readonly materialId: number
  readonly blend: BlendMode
  readonly mask: string | null
  readonly order: number
  readonly depth: Float32Array
  readonly bounds: Rect
}

/** 当前 RenderPacket schema 版本。 */
export const RENDER_PACKET_VERSION = 2 as const
