import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importSpine } from '@/asset/importer'

const fixture = {
  skeleton: { spine: '4.2.33' },
  bones: [{ name: 'root' }, { name: 'target', parent: 'root' },
    { name: 'follower', parent: 'root' }, { name: 'second', parent: 'follower' }],
  slots: [],
  skins: [],
  transform: [{ name: 'signed', bones: ['follower', 'second'], target: 'target',
    local: true, relative: true, rotation: 90, x: 40.17, y: -1.66,
    scaleX: 0.2, scaleY: -0.4, shearY: -30,
    mixRotate: -0.25, mixX: -1, mixScaleX: -0.75, mixShearY: -0.5 }],
}

describe('Spine 4.2 legacy transform import', () => {
  it('keeps signed per-axis mixes, official inherited values, offsets, flags and bone chain', () => {
    const asset = importSpine(fixture, { unitScale: 0.01, sourceYDown: true })
    const constraint = asset.constraints?.find(item => item.id === 'signed')
    expect(constraint).toMatchObject({
      kind: 'transform', bone: 2, sourceBone: 1, bones: [2, 3],
      local: true, relative: true,
      mixRotation: -0.25, mixTranslation: -1,
      mixRotate: -0.25, mixX: -1, mixY: -1,
      mixScaleX: -0.75, mixScaleY: -0.75, mixShearY: -0.5,
      offsetScaleX: 0.2, offsetScaleY: -0.4,
    })
    expect(constraint?.kind === 'transform' ? constraint.offsetShearY : undefined).toBeCloseTo(-Math.PI / 6)
    expect(constraint?.kind === 'transform' ? constraint.offsetRotation : undefined).toBeCloseTo(Math.PI / 2)
    expect(constraint?.kind === 'transform' ? constraint.offsetX : undefined).toBeCloseTo(0.4017)
    expect(constraint?.kind === 'transform' ? constraint.offsetY : undefined).toBeCloseTo(0.0166)
  })

  it('matches the signed shoulder mix and pixel offsets in the official 4.2 Spineboy JSON', () => {
    const path = resolve(process.cwd(), '../../test/fixtures/spine/spineboy-4.2/spineboy-pro.json')
    const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const asset = importSpine(json, { unitScale: 0.01 })
    const shoulder = asset.constraints?.find(item => item.id === 'shoulder')
    expect(shoulder).toMatchObject({
      kind: 'transform', mixRotate: 0, mixX: -1, mixY: -1,
      mixScaleX: 0, mixScaleY: 0, mixShearY: 0,
      mixTranslation: -1, local: false, relative: false,
    })
    expect(shoulder?.kind === 'transform' ? shoulder.offsetX : undefined).toBeCloseTo(0.4017)
    expect(shoulder?.kind === 'transform' ? shoulder.offsetY : undefined).toBeCloseTo(-0.0166)
  })
})
