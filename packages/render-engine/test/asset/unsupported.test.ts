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
  physics: [{ name: 'hair', bones: ['root'] }],
  animations: {},
}

describe('unsupported Spine features are downgraded with explicit codes', () => {
  it('warns for sequence, dark tint and physics instead of silently dropping', () => {
    const asset = importSpine(fixture)
    const codes = asset.report.issues.map((i) => i.code)
    expect(codes).toContain('W_SEQUENCE')
    expect(codes).toContain('W_TINT_DOWNGRADE')
    expect(codes).toContain('W_PHYSICS_SKIPPED')
    // sequence 降级为 region，资产仍可加载
    expect(asset.skins.get('default')!.attachments.get('seq')?.kind).toBe('region')
  })
})
