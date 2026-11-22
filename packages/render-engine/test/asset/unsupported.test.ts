import { describe, expect, it } from '@jest/globals'
import { importSpine } from '@/asset/importer'

const fixture = {
  skeleton: { spine: '4.2.0' },
  bones: [{ name: 'root' }],
  slots: [{ name: 'body', bone: 'root', dark: 'ff0000ff' }],
  skins: [{
    name: 'default',
    attachments: {
      body: {
        seq: { type: 'region', path: 'body', sequence: { count: 3 } },
      },
    },
  }],
  physics: [{ name: 'hair', bone: 'root', inertia: 0.8 }],
  animations: {},
}

describe('unsupported Spine features are downgraded with explicit codes', () => {
  it('warns for sequence, dark tint and physics instead of silently dropping', () => {
    const asset = importSpine(fixture)
    const codes = asset.report.issues.map((i) => i.code)
    expect(codes).toContain('W_SEQUENCE')
    expect(codes).toContain('W_PHYSICS_SKIPPED')
    // two-color 已实现：dark 被读入，不再降级告警
    expect(asset.slots[0]!.dark?.r).toBe(1)
    // physics 读入但默认不求解，数据保留
    const physics = asset.constraints?.find((c) => c.kind === 'physics')
    expect(physics).toMatchObject({ kind: 'physics', enabled: false, inertia: 0.8 })
    // sequence 降级为 region，资产仍可加载
    expect(asset.skins.get('default')!.attachments.get('seq')?.kind).toBe('region')
  })
})
