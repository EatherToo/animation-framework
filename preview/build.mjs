import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const esbuild = join(root, 'node_modules', '.bin', 'esbuild')

execFileSync(
  esbuild,
  [
    'preview/main.ts',
    '--bundle',
    '--format=iife',
    '--tsconfig=tsconfig.json',
    '--outfile=preview/main.js',
  ],
  { cwd: root, stdio: 'inherit' },
)

console.log('preview/main.js 已更新')
