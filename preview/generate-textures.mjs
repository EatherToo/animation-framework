import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
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

for (const mesh of meshes.meshes) {
  const triangleCount = mesh.indices.length / 3
  const grays = assignGrays(mesh.indices)
  const dir = join(textureRoot, mesh.partId)
  await mkdir(dir, { recursive: true })
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    await writeFile(join(dir, `${triangle}.png`), png(grays[triangle], EDGE))
  }
  parts.push({ partId: mesh.partId, count: triangleCount })
}

await writeFile(join(textureRoot, 'manifest.json'), `${JSON.stringify({ edge: EDGE, parts }, null, 2)}\n`)

const total = parts.reduce((sum, part) => sum + part.count, 0)
console.log(`纹理已生成：${parts.length} 件，共 ${total} 张（${EDGE}×${EDGE}）`)

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

function png(gray, size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 2
  const stride = size * 3 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y += 1) {
    const row = y * stride
    for (let x = 0; x < size; x += 1) {
      const pixel = row + 1 + x * 3
      raw[pixel] = gray
      raw[pixel + 1] = gray
      raw[pixel + 2] = gray
    }
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const name = Buffer.from(type)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0, 0)
  return Buffer.concat([length, name, data, checksum])
}
