import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), '../..')
const samples = ['spineboy', 'raptor', 'stretchyman']
const available = samples.every(name => existsSync(resolve(root, 'test/fixtures/spine', name, `${name}-pro.json`)) && existsSync(resolve(root, 'test/fixtures/spine', name, `${name}.atlas`)))
if (process.env.SPINE_PARITY_REQUIRED === '1' && !available) {
  throw new Error('Official Spine samples missing; run node scripts/fetch-spine-samples.mjs before release parity')
}

// Without licensed official inputs this test is SKIP, never PASS.
const suite = available ? describe : describe.skip
suite('official spine-core numeric oracle', () => {
  for (const name of samples) {
    it(`${name} exports five independently sampled poses`, () => {
      const output = execFileSync(process.execPath, [resolve(root, 'scripts/oracle/spine-core.mjs'), resolve(root, 'test/fixtures/spine', name)], { cwd: root, encoding: 'utf8' })
      const oracle = JSON.parse(output)
      expect(oracle.runtime).toBe('spine-core@4.3.13')
      expect(oracle.frames).toHaveLength(5)
      expect(oracle.frames[0].bones.length).toBeGreaterThan(0)
      expect(oracle.frames[0].slots.length).toBeGreaterThan(0)
      expect(oracle.frames[0].drawOrder.appliedPose.length).toBe(oracle.frames[0].slots.length)
      expect(oracle.frames[0].time).toBeCloseTo(oracle.duration * 0.1)
      expect(oracle.frames[4].time).toBeCloseTo(oracle.duration - 0.0001)
    })
  }
})
