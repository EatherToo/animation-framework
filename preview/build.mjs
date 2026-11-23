import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const esbuild = join(here, 'node_modules', '.bin', 'esbuild')

for (const entry of ['main', 'pose-main']) {
  execFileSync(esbuild, [
    `${entry}.ts`, '--bundle', '--format=iife', '--tsconfig=tsconfig.json',
    `--outfile=${entry === 'main' ? 'main' : 'pose'}.js`,
  ], { cwd: here, stdio: 'inherit' })
}

console.log('preview/main.js 和 preview/pose.js 已更新')
