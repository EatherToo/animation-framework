import type { CompiledRig } from '../compile/compile'
import type { Pose } from '../skeleton/pose'
import { HUMANOID_FILL, type HumanoidPartId } from '../part/humanoid'
import { evaluateFk } from '../fk/evaluate'
import { packAtlas, type Atlas, type AtlasImage, type AtlasRegion } from './atlas'
import { buildRenderPackets } from './packet'
import { createRenderScene } from './scene'
import type { RenderAttachment, RenderMesh, RenderPacket, RenderScene } from './types'
import { buildHumanoid2DScene } from './humanoid2d'

export type AtlasPageImage = {
  readonly atlas: Atlas
  readonly image: AtlasImage
}

export type AtlasRegionRef = {
  readonly page: number
  readonly region: AtlasRegion
}

export type HumanoidAtlas = {
  readonly pages: readonly AtlasPageImage[]
  readonly regions: ReadonlyMap<string, AtlasRegionRef>
}

const PART_IDS: readonly HumanoidPartId[] = [
  'torso', 'head', 'armL', 'handL', 'armR', 'handR', 'legL', 'footL', 'legR', 'footR',
]

/**
 * 生成一张程序化角色图集：每个部件一个 region，region 内是部件色的竖向渐变。
 * 这不是最终美术资产，只用来把图集/UV/PMA 契约跑通。
 */
export function createHumanoidAtlas(): HumanoidAtlas {
  const atlas = packAtlas(
    PART_IDS.map((id) => ({ id, width: 40, height: 80 })),
    { padding: 2, maxWidth: 256, pma: false },
  )
  const image: AtlasImage = {
    width: atlas.width,
    height: atlas.height,
    rgba: new Uint8Array(atlas.width * atlas.height * 4),
    pma: atlas.pma,
  }
  const regions = new Map<string, AtlasRegionRef>()
  for (const region of atlas.regions) {
    regions.set(region.id, { page: 0, region })
    const fill = HUMANOID_FILL[region.id as HumanoidPartId]
    for (let y = 0; y < region.height; y += 1) {
      const shade = 1.1 - (y / Math.max(1, region.height - 1)) * 0.3
      for (let x = 0; x < region.width; x += 1) {
        const i = ((region.y + y) * atlas.width + region.x + x) * 4
        image.rgba[i] = clamp(fill.r * shade)
        image.rgba[i + 1] = clamp(fill.g * shade)
        image.rgba[i + 2] = clamp(fill.b * shade)
        image.rgba[i + 3] = 255
      }
    }
  }
  return { pages: [{ atlas, image }], regions }
}

/**
 * 给 2D 场景里的每个附件加上 region UV 与 atlas 材质。
 * @param scene 平涂 2D 场景
 * @param atlas 角色图集
 */
export function applyHumanoidAtlas(scene: RenderScene, atlas: HumanoidAtlas): RenderScene {
  const skins = scene.skins.map((skin) => ({
    id: skin.id,
    attachments: skin.attachments.map((attachment) => {
      const key = attachment.atlasKey ?? attachment.id
      const ref = atlas.regions.get(key)
      if (ref === undefined) return attachment
      return atlasAttachment(attachment, ref.region, ref.page)
    }),
  }))
  return createRenderScene(scene.slots, skins)
}

/** 当前姿态的图集渲染包。 */
export function sampleHumanoid2DAtlasPackets(
  compiled: CompiledRig,
  pose: Pose,
  atlas: HumanoidAtlas,
): RenderPacket[] {
  if (pose.skeleton !== compiled.skeleton) throw new Error('pose')
  const fk = new Float32Array(compiled.skeleton.boneCount * 12)
  evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount)
  return buildRenderPackets(applyHumanoidAtlas(buildHumanoid2DScene(compiled, fk), atlas))
}

function atlasAttachment(
  attachment: RenderAttachment,
  region: AtlasRegion,
  page: number,
): RenderAttachment {
  const mesh = attachment.mesh
  const bounds = mesh.bounds ?? { x: 0, y: 0, width: 1, height: 1 }
  const width = Math.max(1e-6, bounds.width)
  const height = Math.max(1e-6, bounds.height)
  const uvs = new Float32Array((mesh.positions.length / 2) * 2)
  for (let v = 0; v < mesh.positions.length / 2; v += 1) {
    const localU = (mesh.positions[v * 2]! - bounds.x) / width
    const localV = (mesh.positions[v * 2 + 1]! - bounds.y) / height
    // region 内留 1px，避免线性过滤采到 padding。
    uvs[v * 2] = (1 + localU * (region.width - 2)) / region.width
    uvs[v * 2 + 1] = (1 + localV * (region.height - 2)) / region.height
  }
  const nextMesh: RenderMesh = { ...mesh, uvs }
  return {
    ...attachment,
    mesh: nextMesh,
    material: {
      kind: 'atlas',
      page,
      region,
      tint: { r: 1, g: 1, b: 1, a: 1 },
      filter: 'linear',
    },
  }
}

function clamp(value: number): number {
  const byte = Math.round(value * 255)
  if (byte < 0) return 0
  if (byte > 255) return 255
  return byte
}
