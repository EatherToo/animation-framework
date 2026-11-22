/**
 * S3 导入兼容：Spine 3.8 JSON → 4.2 兼容结构 → importSpine。
 * 权威：docs/22-Spine渲染对标/import-compat.md §4.3。
 *
 * 3.8 与 4.2 的差异集中在此层：旧 `transform` 名映射 `inherit`、无 `inherit`
 * 补 normal、`weightedmesh` 转 mesh（顶点布局由 importer 自动识别）、drawOrder
 * offset 交给 importer 展开、缺 `physics` 忽略；3.8 约束的 `*Mix`/`bendDirection`
 * 旧名同步改写。尚未实现的通道（如 bone shear timeline）显式记 W_，不静默。
 *
 * 转换完成后仍调用 importSpine，并恢复原始 3.8 版本号与重算 hash。
 */

import {
  canonicalHash,
  importSpine,
  type ImportIssue,
  type SkeletonAsset,
} from './importer'
import type { AtlasData } from './atlas'

type CompatError = Error & { code: string }

function fail(code: string, message: string): never {
  const error = new Error(`${code}: ${message}`) as CompatError
  error.code = code
  throw error
}

function obj(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 只复制 JSON 树，避免改写调用方传入的 3.8 文档。 */
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = clone(item)
    return out as T
  }
  return value
}

function addWarning(
  issues: ImportIssue[],
  code: string,
  path: string,
  message: string,
  sourceValue?: unknown,
): void {
  const issue: ImportIssue = { severity: 'warning', code, path, message, action: 'fallback' }
  if (sourceValue !== undefined) issue.sourceValue = sourceValue
  issues.push(issue)
}

/** 把 3.8 旧字段名改写成 4.2 名；不改坐标/单位/角度。 */
function convertBone38(raw: unknown, index: number, issues: ImportIssue[]): Record<string, unknown> {
  const source = obj(raw)
  if (source === null) return {}
  const bone = clone(source)
  const inherit = source.inherit ?? source.transform
  delete bone.transform
  if (typeof inherit === 'string' && inherit.length > 0) {
    bone.inherit = inherit
  } else {
    if (inherit !== undefined && inherit !== null) {
      addWarning(issues, 'W_BONE_INHERIT', `bones[${index}].inherit`, 'inherit/transform 非字符串，回退 normal', inherit)
    }
    bone.inherit = 'normal'
  }
  return bone
}

/** 3.8 附件 type → 4.2 结构；weightedmesh 归一为 mesh，权重布局由 importer 识别。 */
function convertAttachment38(raw: unknown, path: string, issues: ImportIssue[]): Record<string, unknown> {
  const source = obj(raw)
  if (source === null) return {}
  const attachment = clone(source)
  const type = typeof source.type === 'string' ? source.type : 'region'
  if (type === 'weightedmesh' || type === 'skinnedmesh') {
    attachment.type = 'mesh'
    if (type === 'skinnedmesh') {
      addWarning(issues, 'W_ATTACHMENT_UNSUPPORTED', `${path}.type`, 'skinnedmesh 按 mesh 读取，权重布局未知', type)
    }
  } else if (type === 'region' || type === 'mesh' || type === 'linkedmesh'
    || type === 'clipping' || type === 'path' || type === 'point' || type === 'boundingbox') {
    attachment.type = type
  } else {
    // 未知类型保持原值，由 importer 统一走 W_ATTACHMENT_UNSUPPORTED/W_SEQUENCE 降级。
    attachment.type = type
  }
  return attachment
}

function convertSkins38(rawSkins: unknown, issues: ImportIssue[]): Record<string, unknown>[] {
  return arr(rawSkins).map((rawSkin, skinIndex) => {
    const skin = obj(rawSkin) ?? {}
    const attachmentsRaw = obj(skin.attachments) ?? {}
    const attachments: Record<string, Record<string, unknown>> = {}
    for (const [slotName, groupRaw] of Object.entries(attachmentsRaw)) {
      const group = obj(groupRaw) ?? {}
      const converted: Record<string, unknown> = {}
      for (const [attName, attRaw] of Object.entries(group)) {
        converted[attName] = convertAttachment38(attRaw, `skins[${skinIndex}].attachments.${slotName}.${attName}`, issues)
      }
      attachments[slotName] = converted
    }
    return { ...clone(skin), attachments }
  })
}

/**
 * 动画通道：rotate/translate/scale/attachment/color/drawOrder/deform/events/ik
 * 均原样交给 importer；3.8 的 bone shear timeline 在 4.x 仍存在但 importer 未实现，
 * 这里显式记 W，避免“看起来导入了”。
 */
function convertAnimations38(raw: unknown, issues: ImportIssue[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, rawAnimation] of Object.entries(obj(raw) ?? {})) {
    const animation = obj(rawAnimation)
    if (animation === null) continue
    const converted = clone(animation)

    const bones = obj(animation.bones)
    if (bones !== null) {
      for (const [boneName, rawChannels] of Object.entries(bones)) {
        const channels = obj(rawChannels)
        if (channels === null) continue
        if (channels.shear !== undefined) {
          addWarning(
            issues,
            'W_TIMELINE_UNSUPPORTED',
            `animations.${name}.bones.${boneName}.shear`,
            'shear timeline 尚未实现，已忽略',
          )
        }
      }
    }

    const slots = obj(animation.slots)
    if (slots !== null) {
      for (const [slotName, rawChannels] of Object.entries(slots)) {
        const channels = obj(rawChannels)
        if (channels === null) continue
        for (const key of Object.keys(channels)) {
          if (key !== 'attachment' && key !== 'color') {
            addWarning(
              issues,
              'W_TIMELINE_UNSUPPORTED',
              `animations.${name}.slots.${slotName}.${key}`,
              `slot ${key} timeline 尚未实现，已忽略`,
            )
          }
        }
      }
    }

    out[name] = converted
  }
  return out
}

/** 3.8 约束旧字段：bendDirection / rotateMix / translateMix → 4.2 命名。 */
function convertConstraints38(doc: Record<string, unknown>, issues: ImportIssue[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  if (doc.ik !== undefined) {
    out.ik = arr(doc.ik).map((raw, index) => {
      const source = obj(raw)
      if (source === null) return raw
      const item = clone(source)
      if (typeof source.bendDirection === 'number') item.bendPositive = source.bendDirection >= 0
      if (source.bendPositive === undefined && source.bendDirection === undefined) {
        addWarning(issues, 'W_CONSTRAINT_DEFAULT', `ik[${index}]`, '3.8 IK 缺 bendDirection，使用默认正弯', undefined)
      }
      return item
    })
  }

  if (doc.transform !== undefined) {
    out.transform = arr(doc.transform).map((raw, index) => {
      const source = obj(raw)
      if (source === null) return raw
      const item = clone(source)
      if (typeof source.rotateMix === 'number') item.mixRotate = source.rotateMix
      if (typeof source.translateMix === 'number') {
        item.mixX = source.translateMix
        item.mixY = source.translateMix
      }
      if (source.scaleMix !== undefined) {
        addWarning(issues, 'W_CONSTRAINT_UNSUPPORTED', `transform[${index}].scaleMix`, 'transform scaleMix 尚未实现，已忽略', source.scaleMix)
      }
      return item
    })
  }

  if (doc.path !== undefined) {
    out.path = arr(doc.path).map((raw) => {
      const source = obj(raw)
      if (source === null) return raw
      const item = clone(source)
      if (typeof source.rotateMix === 'number') item.mixRotate = source.rotateMix
      if (typeof source.translateMix === 'number') item.mixX = source.translateMix
      return item
    })
  }

  // 3.8 通常没有 physics；若第三方导出带该字段，交给 importer 统一记 W_PHYSICS_SKIPPED。
  if (doc.physics !== undefined) out.physics = clone(doc.physics)
  if (doc.events !== undefined) out.events = clone(doc.events)
  return out
}

/** 组装 3.8 → 4.2 兼容文档。 */
function convertDocument(doc: Record<string, unknown>, issues: ImportIssue[]): Record<string, unknown> {
  const skeleton = obj(doc.skeleton)
  if (skeleton === null) fail('E_SCHEMA', 'spine.skeleton 缺失')
  const bones = arr(doc.bones)
  if (bones.length === 0) fail('E_SCHEMA', 'spine.bones 为空')

  const out: Record<string, unknown> = {
    skeleton: clone(skeleton),
    bones: bones.map((raw, index) => convertBone38(raw, index, issues)),
    slots: clone(arr(doc.slots)),
    skins: convertSkins38(doc.skins, issues),
  }
  if (doc.animations !== undefined) out.animations = convertAnimations38(doc.animations, issues)
  Object.assign(out, convertConstraints38(doc, issues))
  return out
}

/** 给 importer 抛出的 `E_XXX:` 文本错误补上 `.code`，保持错误通道统一。 */
function withCode(error: unknown): never {
  if (error instanceof Error) {
    const match = /^(E_[A-Z0-9_]+):/.exec(error.message)
    if (match !== null) (error as CompatError).code = match[1]!
  }
  throw error
}

/** 合并 importer 报告与本层兼容告警。 */
function mergeIssues(asset: SkeletonAsset, extra: readonly ImportIssue[]): ImportIssue[] {
  if (extra.length === 0) return [...asset.report.issues]
  return [...asset.report.issues, ...extra]
}

export type Spine38Options = {
  unitScale?: number
  defaultSkin?: string
  atlas?: AtlasData
  sourceYDown?: boolean
}

/**
 * 导入 Spine 3.8 JSON：先转 4.2 兼容结构，再复用 importSpine。
 * 主版本非 3.x 抛 E_SPINE_VERSION；结构非法抛 E_SCHEMA。
 */
export function importSpine38(json: unknown, options: Spine38Options = {}): SkeletonAsset {
  const doc = obj(json)
  if (doc === null) fail('E_SCHEMA', 'Spine JSON 必须是对象')
  const skeleton = obj(doc.skeleton)
  if (skeleton === null) fail('E_SCHEMA', 'spine.skeleton 缺失')
  const version = typeof skeleton.spine === 'string' ? skeleton.spine : ''
  if (!/^3\./.test(version)) {
    fail('E_SPINE_VERSION', `Spine 3.8 兼容入口只接受 3.x，实际 ${version.length > 0 ? version : '(missing)'}`)
  }

  const issues: ImportIssue[] = []
  const converted = convertDocument(doc, issues)
  // 给 importSpine 一个满足 4.x 门禁的哨兵版本；最终会恢复为源 3.8 版本。
  const convertedSkeleton = obj(converted.skeleton)!
  convertedSkeleton.spine = '4.2.0'

  const importOptions: { unitScale?: number; defaultSkin?: string; atlas?: AtlasData; sourceYDown?: boolean } = {}
  if (options.unitScale !== undefined) importOptions.unitScale = options.unitScale
  if (options.defaultSkin !== undefined) importOptions.defaultSkin = options.defaultSkin
  if (options.atlas !== undefined) importOptions.atlas = options.atlas
  if (options.sourceYDown !== undefined) importOptions.sourceYDown = options.sourceYDown

  let imported: SkeletonAsset
  try {
    imported = importSpine(converted, importOptions)
  } catch (error) {
    withCode(error)
  }

  const { hash: _hash, report: _report, ...core } = imported
  const restored: Omit<SkeletonAsset, 'hash' | 'report'> = { ...core, sourceVersion: version }
  const merged = mergeIssues(imported, issues)
  const report = {
    issues: merged,
    warnings: merged.filter((issue) => issue.severity === 'warning').length,
    errors: merged.filter((issue) => issue.severity === 'error').length,
  }
  return Object.freeze({ ...restored, hash: canonicalHash(restored), report })
}
