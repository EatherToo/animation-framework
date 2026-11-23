#!/usr/bin/env node
/** Fetch official Spine examples locally. These assets are license-gated and not committed. */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const REPO = 'EsotericSoftware/spine-runtimes'
const OUT = 'test/fixtures/spine'
const SAMPLES = [
  { name: 'spineboy', dir: 'spineboy/export', files: ['spineboy-pro.json', 'spineboy-pro.skel', 'spineboy.atlas', 'spineboy.png'] },
  { name: 'raptor', dir: 'raptor/export', files: ['raptor-pro.json', 'raptor.atlas', 'raptor.png'] },
  { name: 'stretchyman', dir: 'stretchyman/export', files: ['stretchyman-pro.json', 'stretchyman.atlas', 'stretchyman.png'] },
]
const OLDER_FILES = ['spineboy-pro.json', 'spineboy-pro.skel', 'spineboy.atlas']
const SHA = /^[0-9a-f]{40}$/i

function usage() {
  return 'Usage: node scripts/fetch-spine-samples.mjs [--branch 3.8|4.2|4.3] [--commit 40-hex-sha]\n' +
    'No arguments fetch 4.3 samples and the optional 4.2 Spineboy pair. --commit requires --branch.'
}

function options(args) {
  let branch, commit
  for (let i = 0; i < args.length; i++) {
    const [key, inline] = args[i].split('=', 2)
    if (key === '--help' && inline === undefined) return { help: true }
    if (key !== '--branch' && key !== '--commit') throw new Error(`Unknown option: ${args[i]}\n${usage()}`)
    const value = inline ?? args[++i]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}\n${usage()}`)
    if (key === '--branch') {
      if (branch) throw new Error('Duplicate --branch')
      branch = value
    } else {
      if (commit) throw new Error('Duplicate --commit')
      commit = value
    }
  }
  if (branch && !['3.8', '4.2', '4.3'].includes(branch)) throw new Error(`Unsupported branch: ${branch}\n${usage()}`)
  if (commit && (!branch || !SHA.test(commit))) throw new Error('--commit requires --branch and a 40-character Git SHA')
  return { branch, commit: commit?.toLowerCase() }
}

async function get(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'animation-framework-spine-sample-fetcher' } })
  if (!response.ok) {
    const error = new Error(`${url} -> HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return response
}

async function resolveCommit(branch) {
  const url = `https://api.github.com/repos/${REPO}/git/ref/heads/${branch}`
  const ref = await (await get(url)).json()
  const commit = ref?.object?.sha
  if (ref?.object?.type !== 'commit' || typeof commit !== 'string' || !SHA.test(commit)) {
    throw new Error(`Invalid commit ref from ${url}`)
  }
  return commit.toLowerCase()
}

function targetDir(branch, name) {
  if (branch === '4.2') return join(OUT, 'spineboy-4.2')
  // 3.8 lives under the already-ignored sample folders; 4.3 retains legacy paths.
  return join(OUT, name, ...(branch === '3.8' ? ['3.8'] : []))
}

async function download(branch, pinnedCommit, optional = false) {
  let commit = pinnedCommit
  if (!commit) {
    try {
      commit = await resolveCommit(branch)
    } catch (error) {
      if (!optional || error.status !== 404) throw error
      console.log(`optional ${branch} branch absent: ${error.message}`)
      return
    }
  }
  const samples = branch === '4.2'
    ? [{ name: 'spineboy', dir: 'spineboy/export', files: OLDER_FILES }]
    : SAMPLES
  const files = []
  for (const sample of samples) {
    for (const file of sample.files) {
      const url = `https://raw.githubusercontent.com/${REPO}/${commit}/examples/${sample.dir}/${file}`
      let response
      try {
        response = await get(url)
      } catch (error) {
        if (optional && error.status === 404) {
          console.log(`optional ${branch} asset absent: ${url}`)
          continue
        }
        throw error
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      const target = join(targetDir(branch, sample.name), file)
      files.push({ target, bytes, record: {
        path: `${sample.name}/${file}`,
        url,
        version: branch,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.byteLength,
      } })
    }
  }
  for (const { target, bytes } of files) {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
    console.log(`${target} (${bytes.byteLength} bytes)`)
  }
  const manifest = join(targetDir(branch, 'spineboy'), 'fetch-manifest.json')
  await mkdir(dirname(manifest), { recursive: true })
  await writeFile(manifest, JSON.stringify({ repository: `https://github.com/${REPO}`, branch,
    commit, files: files.map(({ record }) => record) }, null, 2) + '\n')
  console.log(`${manifest} (commit ${commit})`)
}

const { branch, commit, help } = options(process.argv.slice(2))
if (help) {
  console.log(usage())
} else if (branch) {
  await download(branch, commit)
} else {
  await download('4.3')
  // Preserve the historical optional 4.2 Spineboy download for no-argument invocations.
  await download('4.2', undefined, true)
}
