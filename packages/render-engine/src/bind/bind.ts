import type { StrokePart } from '../stroke/stroke'
import type { Texture } from '../mesh/texture'
import type { TexturedPart } from '../texture/bind'

export type SceneColor = {
  readonly r: number
  readonly g: number
  readonly b: number
}

export type SceneObject = {
  id: string
  kind: 'fill' | 'stroke' | 'texture'
  partId: string
  positions: Float32Array
  indices: Uint16Array
  color: SceneColor | null
  textures: readonly Texture[] | null
  triangleTexture: Uint16Array | null
  uvs: Float32Array | null
  order: number
  destroyed: boolean
}

export type SceneLayer = {
  objects: SceneObject[]
  lost: boolean
  add(object: SceneObject): void
  remove(object: SceneObject): void
}

export type FillSource = {
  readonly partId: string
  readonly positions: Float32Array
  readonly indices: Uint16Array
  readonly fill: SceneColor
}

export type RenderBinding = {
  layer: SceneLayer
  objects: SceneObject[]
  lost: boolean
  destroyed: boolean
}

let nextId = 1

export function createMemoryLayer(): SceneLayer {
  const layer: SceneLayer = {
    objects: [],
    lost: false,
    add(object) {
      layer.objects.push(object)
    },
    remove(object) {
      layer.objects = layer.objects.filter((item) => item !== object)
    },
  }
  return layer
}

export function createBinding(layer: SceneLayer): RenderBinding {
  return { layer, objects: [], lost: false, destroyed: false }
}

function rank(order: readonly string[], partId: string): number {
  const index = order.indexOf(partId)
  return index < 0 ? order.length : index
}

function writeBuffer(current: Float32Array, next: Float32Array): Float32Array {
  if (current.length === next.length) {
    current.set(next)
    return current
  }
  return next.slice()
}

function writeIndices(current: Uint16Array, next: Uint16Array): Uint16Array {
  if (current.length === next.length) {
    current.set(next)
    return current
  }
  return next.slice()
}

function strokeMesh(part: StrokePart | undefined): { positions: Float32Array; indices: Uint16Array } {
  const quads = part?.quads ?? []
  const positions = new Float32Array(quads.length * 8)
  const indices = new Uint16Array(quads.length * 6)
  for (let i = 0; i < quads.length; i += 1) {
    positions.set(quads[i]!.positions, i * 8)
    const offset = i * 4
    indices.set(quads[i]!.indices.map((index) => index + offset), i * 6)
  }
  return { positions, indices }
}

export function updateBinding(
  binding: RenderBinding,
  fills: readonly FillSource[],
  textured: readonly TexturedPart[],
  strokes: readonly StrokePart[],
  order: readonly string[],
): void {
  if (binding.destroyed) throw new Error('destroyed')
  assertAligned(fills, textured)
  if (binding.lost || binding.layer.lost) return
  if (binding.objects.length === 0) {
    const created: SceneObject[] = []
    for (let i = 0; i < fills.length; i += 1) {
      const fill = fills[i]!
      const image = textured[i]!
      const placed = rank(order, fill.partId)
      const textureObject = object(
        'texture',
        fill.partId,
        image.positions.slice(),
        image.indices,
        null,
        placed,
        image.textures,
        image.triangleTexture,
        image.uvs.slice(),
      )
      const fillObject = object('fill', fill.partId, fill.positions.slice(), fill.indices.slice(), fill.fill, placed)
      const stroke = strokeMesh(strokes.find((item) => item.partId === fill.partId))
      const strokeObject = object('stroke', fill.partId, stroke.positions, stroke.indices, null, placed + 0.5)
      binding.layer.add(textureObject)
      binding.layer.add(fillObject)
      binding.layer.add(strokeObject)
      created.push(textureObject, fillObject, strokeObject)
    }
    binding.objects = created
    return
  }
  for (let i = 0; i < fills.length; i += 1) {
    const fill = fills[i]!
    const image = textured[i]!
    const target = binding.objects.find((item) => item.kind === 'fill' && item.partId === fill.partId)
    if (target === undefined) throw new Error('part')
    target.positions = writeBuffer(target.positions, fill.positions)
    target.indices = writeIndices(target.indices, fill.indices)
    target.color = fill.fill
    target.order = rank(order, fill.partId)
    const texture = binding.objects.find((item) => item.kind === 'texture' && item.partId === fill.partId)
    if (texture === undefined) throw new Error('texture')
    texture.positions = writeBuffer(texture.positions, image.positions)
    texture.indices = image.indices
    texture.textures = image.textures
    texture.triangleTexture = image.triangleTexture
    texture.uvs = writeBuffer(texture.uvs ?? new Float32Array(), image.uvs)
    texture.order = target.order
    const stroke = binding.objects.find((item) => item.kind === 'stroke' && item.partId === fill.partId)
    if (stroke === undefined) throw new Error('stroke')
    const mesh = strokeMesh(strokes.find((item) => item.partId === fill.partId))
    stroke.positions = writeBuffer(stroke.positions, mesh.positions)
    stroke.indices = writeIndices(stroke.indices, mesh.indices)
    stroke.order = target.order + 0.5
  }
}

function assertAligned(fills: readonly FillSource[], textured: readonly TexturedPart[]): void {
  if (textured.length !== fills.length) throw new Error('texture')
  for (let i = 0; i < fills.length; i += 1) {
    if (textured[i]!.partId !== fills[i]!.partId) throw new Error('texture')
  }
}

function object(
  kind: 'fill' | 'stroke' | 'texture',
  partId: string,
  positions: Float32Array,
  indices: Uint16Array,
  color: SceneColor | null,
  order: number,
  textures: readonly Texture[] | null = null,
  triangleTexture: Uint16Array | null = null,
  uvs: Float32Array | null = null,
): SceneObject {
  const created: SceneObject = {
    id: `${kind}:${partId}:${nextId}`,
    kind,
    partId,
    positions,
    indices,
    color,
    textures,
    triangleTexture,
    uvs,
    order,
    destroyed: false,
  }
  nextId += 1
  return created
}

export function notifyContextLost(binding: RenderBinding): void {
  binding.lost = true
  binding.layer.lost = true
}

export function notifyContextRestored(binding: RenderBinding): void {
  binding.lost = false
  binding.layer.lost = false
}

export function destroyBinding(binding: RenderBinding): void {
  for (const item of binding.objects) {
    item.destroyed = true
    binding.layer.remove(item)
  }
  binding.objects = []
  binding.destroyed = true
}
