#!/usr/bin/env node
/**
 * 下载 Spine 官方示例资产到 test/fixtures/spine/。
 * 网络受限环境会失败；脚本本身不伪造资产。
 *
 * 用法：node scripts/fetch-spine-samples.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const VERSION = '4.3'
const BASE = `https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/refs/heads/${VERSION}/examples`
const OUT = 'test/fixtures/spine'
const SAMPLES = [
  { name: 'spineboy', dir: 'spineboy/export', files: ['spineboy-pro.json', 'spineboy.atlas', 'spineboy.png'] },
  { name: 'raptor', dir: 'raptor/export', files: ['raptor-pro.json', 'raptor.atlas', 'raptor.png'] },
  { name: 'stretchyman', dir: 'stretchyman/export', files: ['stretchyman-pro.json', 'stretchyman.atlas', 'stretchyman.png'] },
]

for (const sample of SAMPLES) {
  for (const file of sample.files) {
    const url = `${BASE}/${sample.dir}/${file}`
    const target = join(OUT, sample.name, file)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
    console.log(`${target} (${bytes.byteLength} bytes)`)
  }
}
