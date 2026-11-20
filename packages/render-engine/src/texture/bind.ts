import type { CompiledRig } from '../compile/compile'
import type { Texture } from '../mesh/texture'
import type { ProjectedPart } from '../view/project'

/** 一个部件投影后的三角形，以及按屏幕绕向排好的纹理角。 */
export type TexturedPart = {
  readonly partId: string
  readonly positions: Float32Array
  readonly indices: Uint16Array
  readonly textures: readonly Texture[]
  readonly triangleTexture: Uint16Array
  readonly uvs: Float32Array
}

/**
 * 把网格上的图片对齐到投影三角形。投影交换后两个顶点时，纹理角一起交换。
 * @param compiled 编译结果
 * @param projected 与网格等长的投影
 */
export function textureProjected(
  compiled: CompiledRig,
  projected: readonly ProjectedPart[],
): TexturedPart[] {
  const meshes = compiled.meshes.meshes
  if (projected.length !== meshes.length) throw new Error('mesh')
  const textured: TexturedPart[] = []
  for (let i = 0; i < projected.length; i += 1) {
    const mesh = meshes[i]!
    const part = projected[i]!
    if (part.partId !== mesh.partId) throw new Error('mesh')
    if (part.indices.length !== mesh.indices.length) throw new Error('indices')
    const uvs = new Float32Array(mesh.uvs.length)
    const triangleCount = mesh.indices.length / 3
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const base = triangle * 3
      const a = mesh.indices[base]!
      const b = mesh.indices[base + 1]!
      const c = mesh.indices[base + 2]!
      const pa = part.indices[base]!
      const pb = part.indices[base + 1]!
      const pc = part.indices[base + 2]!
      const corner = triangle * 6
      const ua = mesh.uvs[corner]!
      const va = mesh.uvs[corner + 1]!
      const ub = mesh.uvs[corner + 2]!
      const vb = mesh.uvs[corner + 3]!
      const uc = mesh.uvs[corner + 4]!
      const vc = mesh.uvs[corner + 5]!
      if (pa === a && pb === b && pc === c) {
        writeCorner(uvs, corner, ua, va, ub, vb, uc, vc)
      } else if (pa === a && pb === c && pc === b) {
        writeCorner(uvs, corner, ua, va, uc, vc, ub, vb)
      } else {
        throw new Error('indices')
      }
    }
    textured.push({
      partId: part.partId,
      positions: part.positions.slice(),
      indices: part.indices,
      textures: mesh.textures,
      triangleTexture: mesh.triangleTexture,
      uvs,
    })
  }
  return textured
}

/**
 * 用屏幕重心把点换成纹理坐标。面积过小时抛出 `degenerate`，不写 `out`。
 * @param out 长度 2
 * @param uvs 三个角的 `(u, v)`，长度 6
 */
export function triangleUv(
  out: Float32Array,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  x: number,
  y: number,
  uvs: Float32Array,
): void {
  if (out.length !== 2 || uvs.length !== 6) throw new Error('uv')
  const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
  if (Math.abs(denom) <= 1e-8) throw new Error('degenerate')
  const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom
  const w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom
  const w2 = 1 - w0 - w1
  out[0] = w0 * uvs[0]! + w1 * uvs[2]! + w2 * uvs[4]!
  out[1] = w0 * uvs[1]! + w1 * uvs[3]! + w2 * uvs[5]!
}

function writeCorner(
  uvs: Float32Array,
  corner: number,
  ua: number,
  va: number,
  ub: number,
  vb: number,
  uc: number,
  vc: number,
): void {
  uvs[corner] = ua
  uvs[corner + 1] = va
  uvs[corner + 2] = ub
  uvs[corner + 3] = vb
  uvs[corner + 4] = uc
  uvs[corner + 5] = vc
}
