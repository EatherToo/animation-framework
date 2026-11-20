import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { createHumanoidMeshes } from '@/mesh/humanoid'
import { createTriangleTexture, createMeshTextures, validateMeshTextures } from '@/mesh/texture'
import { createHumanoidParts } from '@/part/humanoid'

describe('mesh texture', () => {
  it('左上角是部件颜色，其余像素随三角形变化', () => {
    const fill = { r: 0.2, g: 0.4, b: 0.6 }
    const first = createTriangleTexture(fill, 0)
    expect(Array.from(first.rgb.subarray(0, 3))).toEqual([51, 102, 153])
    expect(first.rgb[3]).toBe((51 + 1) % 256)
    expect(first.rgb[4]).toBe(102)
    const later = createTriangleTexture(fill, 3)
    expect(later.rgb[3]).not.toBe(first.rgb[3])
  })

  it('每个三角形一张图，三个角包住整张图片', () => {
    const indices = new Uint16Array(512 * 3)
    const made = createMeshTextures(indices, { r: 1, g: 0, b: 0 })
    expect(made.textures).toHaveLength(512)
    for (let i = 0; i < made.triangleTexture.length; i += 1) expect(made.triangleTexture[i]).toBe(i)
    expect(made.uvs.length).toBe(3072)
    expect(Array.from(made.uvs.subarray(0, 6))).toEqual([0, 0, 2, 0, 0, 2])
  })

  it('人形左臂的图片张数等于三角形数', () => {
    const humanoid = createHumanoid(1.7)
    const meshes = createHumanoidMeshes(humanoid, createHumanoidParts(humanoid.skeleton))
    const arm = meshes.meshes.find((mesh) => mesh.partId === 'armL')
    expect(arm).toBeDefined()
    const triangles = arm!.indices.length / 3
    expect(arm!.textures).toHaveLength(triangles)
    expect(arm!.triangleTexture[0]).toBe(0)
    expect(arm!.triangleTexture[triangles - 1]).toBe(triangles - 1)
    expect(Array.from(arm!.uvs.subarray(0, 6))).toEqual([0, 0, 2, 0, 0, 2])
  })

  it('纹理坐标或图片字节不合法时按顺序拒绝', () => {
    const indices = new Uint16Array([0, 1, 2])
    const made = createMeshTextures(indices, { r: 0, g: 0, b: 0 })
    const short = made.uvs.slice(0, made.uvs.length - 1)
    expect(() => validateMeshTextures(indices, made.textures, made.triangleTexture, short)).toThrow(/^uv$/)
    const fat = {
      width: made.textures[0]!.width,
      height: made.textures[0]!.height,
      rgb: new Uint8Array(made.textures[0]!.rgb.length + 1),
    }
    expect(() =>
      validateMeshTextures(indices, [fat], made.triangleTexture, made.uvs),
    ).toThrow(/^image$/)
  })
})
