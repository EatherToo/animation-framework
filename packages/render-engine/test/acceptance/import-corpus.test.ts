/**
 * M9 验收门禁：最小导入语料。
 *
 * 用内联的极小 Spine 4.x / DragonBones 4.5 fixture 验证导入产物 hash 稳定、
 * report.errors = 0；与 test/asset/importer.test.ts 的大 fixture 互补，
 * 不重复其坐标/动画/坏数据覆盖。
 */
import { describe, expect, it } from '@jest/globals'
import {
  canonicalHash,
  importDragonBones,
  importSpine,
  type SkeletonAsset,
} from '@/asset/importer'

/** 两骨、一槽、一 region；所有 path 均在 atlas 内，避免任何 error 级 issue。 */
function spineCorpus(): Record<string, unknown> {
  return {
    skeleton: { spine: '4.1.0' },
    bones: [
      { name: 'root' },
      { name: 'bone', parent: 'root', x: 0, y: -4, length: 4 },
    ],
    slots: [
      { name: 'slot', bone: 'bone', attachment: 'region', color: 'ffffffff' },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          slot: {
            region: { type: 'region', path: 'region', color: 'ffffffff' },
          },
        },
      },
    ],
    atlas: ['region'],
  }
}

/** 同样规模的 DB 语料：帧率、display path 与 SubTexture 对齐。 */
function dragonBonesCorpus(): Record<string, unknown> {
  return {
    version: '4.5',
    compatibleVersion: '4.5',
    frameRate: 24,
    SubTexture: [{ name: 'image' }],
    armature: [
      {
        name: 'corpus',
        bone: [
          { name: 'root' },
          { name: 'bone', parent: 'root', length: 4 },
        ],
        slot: [
          { name: 'slot', parent: 'bone', displayIndex: 0 },
        ],
        skin: [
          {
            name: 'default',
            slot: [
              {
                name: 'slot',
                display: [{ name: 'image', path: 'image', type: 'image' }],
              },
            ],
          },
        ],
      },
    ],
  }
}

/** 取参与 hash 的核心字段（与 importer 的 canonicalHash 口径一致）。 */
function coreOf(asset: SkeletonAsset): Omit<SkeletonAsset, 'hash' | 'report'> {
  const { hash: _hash, report: _report, ...core } = asset
  return core
}

describe('M9 导入语料：最小 Spine fixture', () => {
  const first = importSpine(spineCorpus(), { unitScale: 1 })
  const second = importSpine(spineCorpus(), { unitScale: 1 })

  it('解析成功且 report.errors = 0', () => {
    expect(first.source).toBe('spine')
    expect(first.skeleton.count).toBe(2)
    expect(first.slots).toHaveLength(1)
    expect(first.report.errors).toBe(0)
    expect(second.report.errors).toBe(0)
  })

  it('两次导入 hash 一致，且与 canonicalHash 相符', () => {
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(first.hash).toBe(second.hash)
    expect(canonicalHash(coreOf(first))).toBe(first.hash)
    expect(canonicalHash(coreOf(second))).toBe(second.hash)
  })
})

describe('M9 导入语料：最小 DragonBones fixture', () => {
  const first = importDragonBones(dragonBonesCorpus(), { unitScale: 1 })
  const second = importDragonBones(dragonBonesCorpus(), { unitScale: 1 })

  it('解析成功且 report.errors = 0', () => {
    expect(first.source).toBe('dragonbones')
    expect(first.skeleton.count).toBe(2)
    expect(first.slots).toHaveLength(1)
    expect(first.report.errors).toBe(0)
    expect(second.report.errors).toBe(0)
  })

  it('两次导入 hash 一致，且与 canonicalHash 相符', () => {
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(first.hash).toBe(second.hash)
    expect(canonicalHash(coreOf(first))).toBe(first.hash)
    expect(canonicalHash(coreOf(second))).toBe(second.hash)
  })
})
