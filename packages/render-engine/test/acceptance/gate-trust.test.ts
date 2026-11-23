import { describe, expect, it } from '@jest/globals'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { CpuBackend } from '@/backend/backend'
import { buildRegionPacket } from '@/render/render'

const packageRoot = process.cwd()
const root = resolve(packageRoot, '../..')
const scripts = (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}).scripts
const mandatory = ['golden.test.ts', 'parity.test.ts', 'import-corpus.test.ts', 'gate-trust.test.ts']
const optional = ['spine-samples.test.ts', 'spine-command-diff.test.ts', 'spine-reference-diff.test.ts']
const samples = ['spineboy', 'raptor', 'stretchyman']

// Reproduce official parity with licensed samples:
// node scripts/fetch-spine-samples.mjs
// pnpm -C packages/render-engine test:spine:parity
// For default CI, run pnpm -C packages/render-engine exec jest --runInBand
// --testPathPatterns=acceptance and report skipped tests separately, never as parity passes.
describe('A43 acceptance gate trust', () => {
  it('executes a nonempty synthetic render with independently checked pixel coverage', () => {
    const backend = new CpuBackend(16, 16)
    try {
      const packet = buildRegionPacket({
        id: 1, positions: new Float32Array([2, 2, 14, 2, 14, 14, 2, 14]),
        color: [1, 0, 0, 1], materialId: 0, order: 0, depthKey: 0,
      })
      expect(packet.indices.length).toBeGreaterThan(0)
      backend.draw({ packets: [packet], width: 16, height: 16 })
      const pixels = backend.readPixels()
      const at = (x: number, y: number) => Array.from(pixels.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4))
      expect(pixels).toHaveLength(16 * 16 * 4)
      expect(at(8, 8)).toEqual([255, 0, 0, 255])
      expect(at(0, 0)).toEqual([0, 0, 0, 255])
      let foreground = 0
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] !== 0) foreground += 1
      expect(foreground).toBeGreaterThan(100)
      expect(foreground).toBeLessThan(16 * 16)
    } finally {
      backend.dispose()
    }
  })

  it('keeps mandatory synthetic suites selected by default and the release gate', () => {
    expect(scripts.test).toBe('jest')
    const release = scripts['test:spine'] ?? ''
    expect(release).toContain('SPINE_PARITY_REQUIRED=1')
    expect(release).not.toContain('--passWithNoTests')
    const selection = release.match(/--testPathPatterns='([^']+)'/)?.[1]
    expect(selection).toBeDefined()
    const selected = new RegExp(selection!)
    for (const file of mandatory) {
      expect(selected.test(`test/acceptance/${file}`)).toBe(true)
      const source = readFileSync(join(packageRoot, 'test/acceptance', file), 'utf8')
      expect(source).toMatch(/\bit\(/)
      expect(source).toMatch(/\bexpect\(/)
      expect(source).not.toMatch(/\b(?:describe|it|test)\.skip\(/)
      if (file !== 'gate-trust.test.ts') expect(source).not.toMatch(/\bHEAD\b/)
    }
  })

  it('does not silently pass official parity when licensed assets are missing', () => {
    const missing = samples.flatMap(name => ['-pro.json', '.atlas', '.png']
      .map(ext => join(root, 'test/fixtures/spine', name, `${name}${ext}`)))
      .filter(path => !existsSync(path))
    for (const file of optional) {
      const source = readFileSync(join(packageRoot, 'test/acceptance', file), 'utf8')
      expect(source).toMatch(/(?:assetsPresent|available)\s*\?\s*describe\s*:\s*describe\.skip/)
    }
    for (const file of ['spine-command-diff.test.ts', 'spine-reference-diff.test.ts']) {
      const source = readFileSync(join(packageRoot, 'test/acceptance', file), 'utf8')
      expect(source).toContain("process.env.SPINE_PARITY_REQUIRED === '1' && !assetsPresent")
      expect(source).toMatch(/throw new Error\('Official Spine samples missing/)
    }
    if (missing.length > 0) {
      console.warn(`[A43 SKIP] ${missing.length} official sample files absent; optional parity is skipped, not passed. ` +
        'Fetch licensed samples and run pnpm -C packages/render-engine test:spine:parity for release evidence.')
    }
  })

  it('fails required parity and reports an optional skip with absent licensed assets', () => {
    const jest = join(packageRoot, 'node_modules/jest/bin/jest.js')
    const args = [jest, '--runInBand', '--runTestsByPath',
      'test/acceptance/spine-command-diff.test.ts',
      '--testNamePattern=compares official and engine setup/animated commands with the same CPU rasterizer']
    const run = (required: boolean) => spawnSync(process.execPath, args, {
      cwd: packageRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        A43_TEST_MISSING_SPINE_ASSETS: '1',
        SPINE_PARITY_REQUIRED: required ? '1' : '0',
      },
      timeout: 10000,
    })

    const required = run(true)
    expect(required.error).toBeUndefined()
    expect(required.status).not.toBe(0)
    expect(required.stderr).toContain('Official Spine samples missing; run node scripts/fetch-spine-samples.mjs')

    const optional = run(false)
    expect(optional.error).toBeUndefined()
    expect(optional.status).toBe(0)
    expect(optional.stderr).toContain('[A43 SKIP] Official Spine samples simulated absent; optional RenderCommand parity skipped, not passed.')
    expect(optional.stderr).toMatch(/Tests:\s+1 skipped, 1 total/)
  }, 25000)
})
