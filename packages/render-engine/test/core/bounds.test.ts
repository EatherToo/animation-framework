import { describe, expect, it } from '@jest/globals'
import { SkeletonBounds } from '@/core/bounds'
import { compileSkeleton } from '@/core/skeleton'
import { createPose, localToWorld, setLocal, setTranslation, CH_ROT } from '@/core/pose'
import { createSlotSet, setSkin, setSlotAttachment, type Attachment, type SlotData } from '@/slot/slot'

const box = (id: string, vertices: number[]): Attachment => ({
  kind: 'boundingBox', id, polygon: new Float32Array(vertices),
})
const square = box('square', [0, 0, 2, 0, 2, 2, 0, 2])
const concave = box('concave', [0, 0, 4, 0, 4, 4, 3, 4, 3, 1, 1, 1, 1, 4, 0, 4])
const slot = (id: string, bone: number, attachment: string): SlotData => ({
  id, bone, order: bone, attachment, color: { r: 1, g: 1, b: 1, a: 1 }, blend: 'normal', mask: null, zOffset: 0,
})

function fixture(attachments: Attachment[] = [square], slots: SlotData[] = [slot('hit', 0, 'square')]) {
  const pose = createPose(compileSkeleton({
    name: 'hit', profile: 'simple2d', bones: [
      { name: 'root', parent: -1, length: 0, setup: { x: 3, y: -2, scaleX: 2, scaleY: 3 } },
      { name: 'child', parent: 0, length: 0, setup: { x: 1, y: 1 } },
    ],
  }))
  const slotSet = createSlotSet(slots, new Map([
    ['default', { id: 'default', attachments: new Map(attachments.map((a) => [a.id, a])) }],
    ['empty', { id: 'empty', attachments: new Map<string, Attachment>() }],
  ]), 'default')
  return { pose, slotSet }
}

describe('SkeletonBounds', () => {
  it('transforms active polygons through bone world matrices and computes their union AABB', () => {
    const child = box('child', [-1, -1, 1, -1, 1, 1, -1, 1])
    const { pose, slotSet } = fixture([square, child], [slot('root', 0, 'square'), slot('child', 1, 'child')])
    const bounds = new SkeletonBounds()
    bounds.update(pose, slotSet)
    expect(bounds.boundingBoxes).toEqual([square, child])
    expect(Array.from(bounds.polygons[0]!)).toEqual([3, -2, 7, -2, 7, 4, 3, 4])
    expect(Array.from(bounds.polygons[1]!)).toEqual([3, -2, 7, -2, 7, 4, 3, 4])
    expect(bounds.getBoundsRect()).toEqual({ x: 3, y: -2, width: 4, height: 6 })
    setTranslation(pose, 1, 4, 1)
    bounds.update(pose, slotSet)
    expect(Array.from(bounds.polygons[1]!)).toEqual([9, -2, 13, -2, 13, 4, 9, 4])
    expect(bounds.getBoundsRect()).toEqual({ x: 3, y: -2, width: 10, height: 6 })
  })

  it('clears stale polygons and AABB when a skin or attachment removes bounding boxes', () => {
    const { pose, slotSet } = fixture()
    const bounds = new SkeletonBounds()
    bounds.update(pose, slotSet)
    setSkin(slotSet, 'empty')
    bounds.update(pose, slotSet)
    expect(bounds.boundingBoxes).toEqual([])
    expect(bounds.polygons).toEqual([])
    expect(bounds.getBoundsRect()).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(bounds.containsPoint(3, -2)).toBeNull()
    expect(bounds.intersectsSegment(0, 0, 5, 0)).toBeNull()
    expect(bounds.aabbContainsPoint(0, 0)).toBe(false)
    expect(bounds.aabbIntersectsSegment(-1, 0, 1, 0)).toBe(false)
    setSkin(slotSet, 'default')
    setSlotAttachment(slotSet, 0, null)
    bounds.update(pose, slotSet)
    expect(bounds.polygons).toHaveLength(0)
  })

  it('ignores non-bounding-box attachments and malformed polygons', () => {
    const path: Attachment = { kind: 'path', id: 'path', polygon: new Float32Array([0, 0, 2, 0, 2, 2]) }
    const invalid = box('invalid', [0, 0, 1, 1])
    const { pose, slotSet } = fixture([path, invalid], [slot('path', 0, 'path'), slot('invalid', 1, 'invalid')])
    const bounds = new SkeletonBounds()
    bounds.update(pose, slotSet)
    expect(bounds.polygons).toHaveLength(0)
  })

  it('treats edges and vertices as inside and rejects the notch of a concave polygon', () => {
    const { pose, slotSet } = fixture([concave], [slot('concave', 0, 'concave')])
    const bounds = new SkeletonBounds()
    bounds.update(pose, slotSet)
    expect(bounds.containsPoint(4, 1)).toBe(concave)
    expect(bounds.containsPoint(3, -2)).toBe(concave)
    expect(bounds.containsPoint(5, 1)).toBe(concave) // inner notch edge
    expect(bounds.containsPoint(7, 4)).toBeNull() // interior of notch
    expect(bounds.containsPoint(-1, 0)).toBeNull()
  })

  it('detects crossings, endpoint touches, collinear overlaps, and degenerate point segments', () => {
    const { pose, slotSet } = fixture()
    const bounds = new SkeletonBounds()
    bounds.update(pose, slotSet)
    const hit = (...segment: [number, number, number, number]) => bounds.intersectsSegment(...segment)
    expect(hit(2, 0, 8, 0)).toBe(square) // both ends outside
    expect(hit(3, -3, 3, -2)).toBe(square) // vertex touch
    expect(hit(2, -2, 5, -2)).toBe(square) // collinear overlap
    expect(hit(4, 0, 4, 0)).toBeNull() // wholly inside, no edge crossing
    expect(hit(4, 0, 5, 1)).toBeNull() // contained segment, as in Spine
    expect(hit(3, 2, 3, 2)).toBe(square) // point on boundary
    expect(hit(2, 2, 2, 2)).toBeNull()
    expect(hit(2, -2, 2, 4)).toBeNull() // parallel outside
    expect(hit(2, 5, 8, 5)).toBeNull()
  })

  it('exposes inclusive point AABB and strict segment/rectangle AABB checks', () => {
    const { pose, slotSet } = fixture()
    const bounds = new SkeletonBounds()
    bounds.update(pose, slotSet)
    expect(bounds.getWidth()).toBe(4)
    expect(bounds.getHeight()).toBe(6)
    expect(bounds.aabbContainsPoint(3, -2)).toBe(true)
    expect(bounds.aabbContainsPoint(7, 4)).toBe(true)
    expect(bounds.aabbContainsPoint(7.01, 4)).toBe(false)
    expect(bounds.aabbIntersectsSegment(2, 0, 8, 0)).toBe(true)
    expect(bounds.aabbIntersectsSegment(3, -3, 3, 5)).toBe(false)
    expect(bounds.aabbIntersectsSkeleton({ minX: 6, minY: 0, maxX: 8, maxY: 1 })).toBe(true)
    expect(bounds.aabbIntersectsSkeleton({ minX: 7, minY: 0, maxX: 8, maxY: 1 })).toBe(false)
  })

  it('accepts a world boundary point computed before Float32 polygon rounding', () => {
    const { pose, slotSet } = fixture()
    setLocal(pose, 0, CH_ROT, Math.PI / 7)
    const boundary = localToWorld(pose, 0, 1, 0)
    const bounds = new SkeletonBounds()
    bounds.update(pose, slotSet)
    expect(bounds.containsPoint(...boundary)).toBe(square)
    expect(bounds.intersectsSegment(...boundary, ...boundary)).toBe(square)
  })

  it('does not report a segment wholly inside the empty notch of a concave polygon', () => {
    const { pose, slotSet } = fixture([concave], [slot('concave', 0, 'concave')])
    const bounds = new SkeletonBounds()
    bounds.update(pose, slotSet)
    expect(bounds.intersectsSegment(6, 3, 8, 3)).toBeNull()
    expect(bounds.intersectsSegment(4, 3, 10, 3)).toBe(concave)
  })
})
