import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createHumanoid,
  createHumanoidMeshes,
  createHumanoidParts,
} from '@animation-framework/render-engine'

const HEIGHT = 1.8
const EDGE = 16
const GRAY_STEP = 16
const PALETTE = []
for (let gray = 32; gray <= 224; gray += GRAY_STEP) PALETTE.push(gray)

const textureRoot = join(process.cwd(), 'preview', 'textures')

const humanoid = createHumanoid(HEIGHT)
const meshes = createHumanoidMeshes(humanoid, createHumanoidParts(humanoid.skeleton))
const parts = []
/** 每个三角形一个灰度字节，按部件顺序拼在一起；页面只需一次请求。 */
const packed = []

await mkdir(textureRoot, { recursive: true })
for (const mesh of meshes.meshes) {
  const triangleCount = mesh.indices.length / 3
  const grays = assignGrays(mesh.indices)
  for (let triangle = 0; triangle < triangleCount; triangle += 1) packed.push(grays[triangle])
  parts.push({ partId: mesh.partId, count: triangleCount })
}

await writeFile(join(textureRoot, 'packed.bin'), Buffer.from(packed))
await writeFile(join(textureRoot, 'manifest.json'), `${JSON.stringify({ edge: EDGE, parts }, null, 2)}\n`)

const total = parts.reduce((sum, part) => sum + part.count, 0)
console.log(`纹理已生成：${parts.length} 件，共 ${total} 张，打包成 ${total} 字节`)

function assignGrays(indices) {
  const triangleCount = indices.length / 3
  const shared = new Map()
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const base = triangle * 3
    addEdge(shared, indices[base], indices[base + 1], triangle)
    addEdge(shared, indices[base + 1], indices[base + 2], triangle)
    addEdge(shared, indices[base + 2], indices[base], triangle)
  }
  const neighbors = Array.from({ length: triangleCount }, () => [])
  for (const tris of shared.values()) {
    for (let i = 0; i < tris.length; i += 1) {
      for (let j = i + 1; j < tris.length; j += 1) {
        neighbors[tris[i]].push(tris[j])
        neighbors[tris[j]].push(tris[i])
      }
    }
  }
  const grays = new Array(triangleCount)
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const used = new Set()
    for (const neighbor of neighbors[triangle]) {
      if (grays[neighbor] !== undefined) used.add(grays[neighbor])
    }
    const start = (triangle * GRAY_STEP) % PALETTE.length
    let chosen
    for (let step = 0; step < PALETTE.length; step += 1) {
      const gray = PALETTE[(start + step) % PALETTE.length]
      if (!used.has(gray)) {
        chosen = gray
        break
      }
    }
    if (chosen === undefined) throw new Error('gray')
    grays[triangle] = chosen
  }
  for (const tris of shared.values()) {
    for (let i = 0; i < tris.length; i += 1) {
      for (let j = i + 1; j < tris.length; j += 1) {
        if (grays[tris[i]] === grays[tris[j]]) throw new Error('adjacent')
      }
    }
  }
  return grays
}

function addEdge(shared, a, b, triangle) {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`
  const list = shared.get(key)
  if (list === undefined) shared.set(key, [triangle])
  else list.push(triangle)
}
