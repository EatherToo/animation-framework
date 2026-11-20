import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { compileHumanoid } from '@/compile/compile'
import { createTriangleTexture } from '@/mesh/texture'
import { createPose } from '@/skeleton/pose'
import { sampleTexture } from '@/texture/sample'
import { textureProjected, triangleUv } from '@/texture/bind'
import { projectParts } from '@/view/project'
import { skinPose } from '../view/present'
import { expectClose } from '../math/assert'

describe('texture bind', () => {
  it('投影交换后两个顶点时，纹理角跟着交换', () => {
    const compiled = compileHumanoid(createHumanoid(1.7))
    const projected = projectParts(skinPose(compiled, createPose(compiled.skeleton)), 90)
    const aligned = textureProjected(compiled, projected)
    const mesh = compiled.meshes.meshes.find((item) => item.partId === 'armL')!
    const part = aligned.find((item) => item.partId === 'armL')!
    let kept = -1
    for (let triangle = 0; triangle < mesh.indices.length / 3; triangle += 1) {
      const base = triangle * 3
      if (
        part.indices[base] === mesh.indices[base] &&
        part.indices[base + 1] === mesh.indices[base + 1] &&
        part.indices[base + 2] === mesh.indices[base + 2]
      ) {
        kept = triangle
        break
      }
    }
    expect(kept).toBeGreaterThanOrEqual(0)
    expect(Array.from(part.uvs.subarray(kept * 6, kept * 6 + 6))).toEqual([0, 0, 2, 0, 0, 2])
    expect(part.textures).toBe(mesh.textures)
    expect(part.triangleTexture).toBe(mesh.triangleTexture)

    const swapped = projected.map((item) => {
      if (item.partId !== 'armL') return item
      const indices = item.indices.slice()
      const base = kept * 3
      const mid = indices[base + 1]!
      indices[base + 1] = indices[base + 2]!
      indices[base + 2] = mid
      return { ...item, indices }
    })
    const flipped = textureProjected(compiled, swapped).find((item) => item.partId === 'armL')!
    expect(Array.from(flipped.uvs.subarray(kept * 6, kept * 6 + 6))).toEqual([0, 0, 0, 2, 2, 0])

    const rotated = projected.map((item) => {
      if (item.partId !== 'armL') return item
      const indices = item.indices.slice()
      const base = kept * 3
      const first = indices[base]!
      indices[base] = indices[base + 1]!
      indices[base + 1] = indices[base + 2]!
      indices[base + 2] = first
      return { ...item, indices }
    })
    expect(() => textureProjected(compiled, rotated)).toThrow(/^indices$/)
  })

  it('三角形中心的纹理坐标是 (2/3, 2/3)，采样落在像素 (2, 2)', () => {
    const out = new Float32Array(2)
    const uvs = Float32Array.from([0, 0, 2, 0, 0, 2])
    triangleUv(out, 0, 0, 2, 0, 0, 2, 2 / 3, 2 / 3, uvs)
    expectClose(out[0]!, 2 / 3)
    expectClose(out[1]!, 2 / 3)
    const texture = createTriangleTexture({ r: 0.2, g: 0.4, b: 0.6 }, 0)
    const color = sampleTexture(texture, out[0]!, out[1]!)
    const pixel = (2 * texture.width + 2) * 3
    expectClose(color.r, texture.rgb[pixel]! / 255)
    expectClose(color.g, texture.rgb[pixel + 1]! / 255)
    expectClose(color.b, texture.rgb[pixel + 2]! / 255)
  })

  it('共线三角形不写输出', () => {
    const out = new Float32Array([4, 5])
    expect(() => triangleUv(out, 0, 0, 1, 0, 2, 0, 0.5, 0, Float32Array.from([0, 0, 2, 0, 0, 2]))).toThrow(
      /^degenerate$/,
    )
    expect(Array.from(out)).toEqual([4, 5])
    const short = new Float32Array([4, 5])
    expect(() => triangleUv(short, 0, 0, 2, 0, 0, 2, 1, 1, new Float32Array(4))).toThrow(/^uv$/)
    expect(Array.from(short)).toEqual([4, 5])
  })
})
