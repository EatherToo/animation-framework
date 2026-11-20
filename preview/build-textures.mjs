import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const esbuild = join(root, 'node_modules', '.bin', 'esbuild')
const bundle = join(here, '.generate-textures.build.mjs')

// 从源码打包：dist 的入口是给打包器用的，Node 直接跑会解析不了无扩展名的目录导入。
execFileSync(
  esbuild,
  [
    'preview/generate-textures.mjs',
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--tsconfig=tsconfig.json',
    `--outfile=${bundle}`,
  ],
  { cwd: root, stdio: 'inherit' },
)

execFileSync(process.execPath, [bundle], { cwd: root, stdio: 'inherit' })
