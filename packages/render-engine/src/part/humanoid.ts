import { PARENT_NONE, findBone, parentOf, type Skeleton } from '../skeleton/skeleton'
import { addRigid } from './rigid'
import { addSkinned } from './skin'
import {
  MAX_PARTS,
  createPartSetBuilder,
  finishPartSet,
  type Fill,
  type PartSet,
  type PartSetBuilder,
} from './set'

/** 首版人形部件的件数。 */
export const HUMANOID_PART_COUNT = 10

/** 首版人形部件的名字。 */
export type HumanoidPartId =
  | 'torso'
  | 'head'
  | 'armL'
  | 'handL'
  | 'armR'
  | 'handR'
  | 'legL'
  | 'footL'
  | 'legR'
  | 'footR'

type HumanoidEntry = {
  readonly id: HumanoidPartId
  readonly kind: 'rigid' | 'skinned'
  readonly bones: readonly string[]
}

/** 登记顺序。蒙皮链从近端排到远端。 */
const HUMANOID_PARTS: readonly HumanoidEntry[] = [
  { id: 'torso', kind: 'skinned', bones: ['pelvis', 'spine', 'chest', 'neck', 'head'] },
  { id: 'head', kind: 'rigid', bones: ['head'] },
  { id: 'armL', kind: 'skinned', bones: ['chest', 'upperArmL', 'lowerArmL', 'handL'] },
  { id: 'handL', kind: 'rigid', bones: ['handL'] },
  { id: 'armR', kind: 'skinned', bones: ['chest', 'upperArmR', 'lowerArmR', 'handR'] },
  { id: 'handR', kind: 'rigid', bones: ['handR'] },
  { id: 'legL', kind: 'skinned', bones: ['pelvis', 'thighL', 'shinL', 'footL'] },
  { id: 'footL', kind: 'rigid', bones: ['footL'] },
  { id: 'legR', kind: 'skinned', bones: ['pelvis', 'thighR', 'shinR', 'footR'] },
  { id: 'footR', kind: 'rigid', bones: ['footR'] },
]

/** 与 {@link HUMANOID_PARTS} 相同的登记顺序。 */
export const HUMANOID_PART_IDS: readonly HumanoidPartId[] = HUMANOID_PARTS.map(
  (entry) => entry.id,
)

/** 占位纯色。追加时只从这张表取数。 */
export const HUMANOID_FILL: Readonly<Record<HumanoidPartId, Fill>> = {
  torso: { r: 0.22, g: 0.38, b: 0.58 },
  head: { r: 0.93, g: 0.78, b: 0.64 },
  armL: { r: 0.3, g: 0.48, b: 0.72 },
  handL: { r: 0.93, g: 0.78, b: 0.64 },
  armR: { r: 0.16, g: 0.32, b: 0.52 },
  handR: { r: 0.84, g: 0.68, b: 0.54 },
  legL: { r: 0.28, g: 0.4, b: 0.56 },
  legR: { r: 0.16, g: 0.26, b: 0.38 },
  footL: { r: 0.32, g: 0.28, b: 0.24 },
  footR: { r: 0.2, g: 0.16, b: 0.14 },
}

/**
 * 把人形的 10 件部件追加到建造器末尾。
 * `skeleton` 必须与建造器上的是同一引用。
 * 任一检查失败时一件都不追加。
 * @param builder 建造器
 * @param skeleton 与建造器绑定的同一棵骨架
 */
export function appendHumanoidParts(builder: PartSetBuilder, skeleton: Skeleton): void {
  if (skeleton !== builder.skeleton) throw new Error('skeleton')

  const resolved: number[][] = []
  for (let i = 0; i < HUMANOID_PARTS.length; i += 1) {
    const names = HUMANOID_PARTS[i]!.bones
    const bones: number[] = []
    for (let n = 0; n < names.length; n += 1) {
      const index = findBone(skeleton, names[n]!)
      if (index === PARENT_NONE) throw new Error('bone')
      bones.push(index)
    }
    resolved.push(bones)
  }

  for (let i = 0; i < HUMANOID_PARTS.length; i += 1) {
    const entry = HUMANOID_PARTS[i]!
    if (entry.kind !== 'skinned') continue
    const bones = resolved[i]!
    for (let b = 1; b < bones.length; b += 1) {
      if (parentOf(skeleton, bones[b]!) !== bones[b - 1]) throw new Error('bones')
    }
  }

  for (let i = 0; i < HUMANOID_PARTS.length; i += 1) {
    const id = HUMANOID_PARTS[i]!.id
    for (let p = 0; p < builder.parts.length; p += 1) {
      if (builder.parts[p]!.id === id) throw new Error('duplicate part id')
    }
  }

  if (builder.parts.length + HUMANOID_PART_COUNT > MAX_PARTS) {
    throw new Error('too many parts')
  }

  for (let i = 0; i < HUMANOID_PARTS.length; i += 1) {
    const entry = HUMANOID_PARTS[i]!
    const fill = HUMANOID_FILL[entry.id]
    const bones = resolved[i]!
    if (entry.kind === 'rigid') {
      addRigid(builder, {
        id: entry.id,
        bone: bones[0]!,
        translationX: 0,
        translationY: 0,
        rotation: 0,
        fill,
      })
    } else {
      addSkinned(builder, {
        id: entry.id,
        bones,
        fill,
      })
    }
  }
}

/**
 * 为这棵骨架创建并完成人形部件集合。
 * @param skeleton 含 04 骨头名字的骨架
 */
export function createHumanoidParts(skeleton: Skeleton): PartSet {
  const builder = createPartSetBuilder(skeleton)
  appendHumanoidParts(builder, skeleton)
  return finishPartSet(builder)
}
