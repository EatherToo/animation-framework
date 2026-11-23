import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { test } from 'node:test'

const SCRIPT = resolve('scripts/fetch-spine-samples.mjs')
const COMMITS = { '3.8': 'a'.repeat(40), '4.2': 'b'.repeat(40), '4.3': 'c'.repeat(40) }
const fixtureRoot = 'test/fixtures/spine'

async function run(args = [], mock = true) {
  const cwd = await mkdtemp(join(tmpdir(), 'spine-fetch-test-'))
  const preload = join(cwd, 'mock-fetch.mjs')
  if (mock) {
    await writeFile(preload, `
const commits = ${JSON.stringify(COMMITS)}
globalThis.fetch = async url => {
  const ref = url.match(/\\/git\\/ref\\/heads\\/(3\\.8|4\\.2|4\\.3)$/)
  if (ref) {
    if (process.env.SPINE_TEST_MISSING_REF === ref[1]) return new Response('', { status: 404 })
    return new Response(JSON.stringify({ object: { type: 'commit', sha: commits[ref[1]] } }), { status: 200 })
  }
  const raw = url.match(/\\/([a-f0-9]{40})\\/examples\\/([^?]+)$/)
  if (!raw || !Object.values(commits).includes(raw[1])) throw new Error('Unexpected request: ' + url)
  return new Response('fixture:' + raw[1] + ':' + raw[2], { status: 200 })
}
`)
  }
  const result = spawnSync(process.execPath, [...(mock ? ['--import', preload] : []), SCRIPT, ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, SPINE_TEST_MISSING_REF: mock === 'missing-4.2' ? '4.2' : '' } })
  return { cwd, result }
}

async function check(cwd, branch, folder, file = 'spineboy-pro.json') {
  const manifest = JSON.parse(await readFile(join(cwd, fixtureRoot, folder, 'fetch-manifest.json'), 'utf8'))
  assert.equal(manifest.branch, branch)
  assert.equal(manifest.commit, COMMITS[branch])
  const record = manifest.files.find(entry => entry.path === `spineboy/${file}`)
  assert.equal(record.version, branch)
  assert.equal(record.url,
    `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/${COMMITS[branch]}/examples/spineboy/export/${file}`)
  const contents = await readFile(join(cwd, fixtureRoot, folder, file))
  assert.equal(record.sha256, createHash('sha256').update(contents).digest('hex'))
  assert.equal(record.bytes, contents.length)
  return manifest
}

test('no-argument run keeps legacy 4.3 and 4.2 locations, each pinned independently', async () => {
  const { cwd, result } = await run()
  assert.equal(result.status, 0, result.stderr)
  const current = await check(cwd, '4.3', 'spineboy')
  assert.equal(current.files.length, 10)
  assert.equal((await readFile(join(cwd, fixtureRoot, 'raptor/raptor.png'), 'utf8')).includes(COMMITS['4.3']), true)
  const older = await check(cwd, '4.2', 'spineboy-4.2', 'spineboy-pro.skel')
  assert.equal(older.files.length, 3)
})

test('no-argument run tolerates absent optional 4.2 branch', async () => {
  const { cwd, result } = await run([], 'missing-4.2')
  assert.equal(result.status, 0, result.stderr)
  await check(cwd, '4.3', 'spineboy')
  assert.match(result.stdout, /optional 4\.2 branch absent/)
  await assert.rejects(readFile(join(cwd, fixtureRoot, 'spineboy-4.2/fetch-manifest.json')))
})

test('branch 3.8 isolates assets under ignored sample folders', async () => {
  const { cwd, result } = await run(['--branch=3.8'])
  assert.equal(result.status, 0, result.stderr)
  const manifest = await check(cwd, '3.8', 'spineboy/3.8')
  assert.equal(manifest.files.length, 10)
  assert.equal((await readFile(join(cwd, fixtureRoot, 'stretchyman/3.8/stretchyman.atlas'), 'utf8')).includes(COMMITS['3.8']), true)
})

test('explicit commit skips branch lookup and reproduces manifest URL', async () => {
  const { cwd, result } = await run(['--branch', '4.2', '--commit', COMMITS['4.2']])
  assert.equal(result.status, 0, result.stderr)
  await check(cwd, '4.2', 'spineboy-4.2')
})

test('invalid options fail before any network requests', async () => {
  for (const args of [['--branch', '5.0'], ['--commit', COMMITS['4.3']], ['--branch', '4.2', '--commit', 'bad'], ['--branch']]) {
    const { result } = await run(args)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Unsupported branch|requires --branch|Missing value/)
  }
})
