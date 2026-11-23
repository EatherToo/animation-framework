import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { importSpine } from '@/asset/importer'
import { SkeletonBounds } from '@/core/bounds'
import { createPose, setTranslation } from '@/core/pose'
import { createSlotSet } from '@/slot/slot'

const root = resolve(process.cwd(), '../..')
const document = {
  skeleton: { spine: '4.3.0' },
  bones: [
    { name: 'root', x: 3, y: -2, scaleX: 2, scaleY: 3 },
    { name: 'child', parent: 'root', x: 1, y: 1, rotation: 20 },
  ],
  slots: [
    { name: 'front', bone: 'root', attachment: 'box' },
    { name: 'image', bone: 'root', attachment: 'art' },
    { name: 'rear', bone: 'child', attachment: 'childBox' },
  ],
  skins: [{ name: 'default', attachments: {
    front: { box: { type: 'boundingbox', vertexCount: 4, vertices: [0, 0, 2, 0, 2, 2, 0, 2] } },
    image: { art: { type: 'region', width: 2, height: 2 } },
    rear: { childBox: { type: 'boundingbox', vertexCount: 4, vertices: [-1, -1, 1, -1, 1, 1, -1, 1] } },
  } }],
}
const points: [number, number][] = [[4, 0], [5, 2], [0, 0], [9, 0], [3.5, -1]]
const segments: [number, number, number, number][] = [
  [0, 0, 9, 0], [4, 0, 5, 0], [9, 9, 10, 10], [0, 2, 9, 2],
]
const rects = [
  { minX: 4, minY: -1, maxX: 6, maxY: 1 },
  { minX: 100, minY: 100, maxX: 110, maxY: 110 },
  { minX: 7, minY: -1, maxX: 9, maxY: 1 },
]

const officialScript = `
const { createRequire } = require('node:module')
const core = createRequire(process.argv[1] + '/package.json')('@esotericsoftware/spine-core')
const { document, points, segments, rects } = JSON.parse(process.argv[2])
const loader = {
  newBoundingBoxAttachment: (_, name) => new core.BoundingBoxAttachment(name),
  // No image is sampled; a zero-frame sequence lets SkeletonJson load the region slot.
  newRegionAttachment: (_, name) => new core.RegionAttachment(name, new core.Sequence(0, false)),
}
const data = new core.SkeletonJson(loader).readSkeletonData(document)
const skeleton = new core.Skeleton(data)
const bounds = new core.SkeletonBounds()
function snapshot () {
  skeleton.updateWorldTransform(core.Physics.none)
  bounds.update(skeleton, true)
  return {
    names: bounds.boundingBoxes.map(box => box.name),
    polygons: bounds.boundingBoxes.map(box => Array.from(bounds.getPolygon(box))),
    aabb: [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY],
    size: [bounds.getWidth(), bounds.getHeight()],
    points: points.map(([x, y]) => [bounds.containsPoint(x, y)?.name ?? null, bounds.aabbContainsPoint(x, y),
      bounds.polygons.map(p => bounds.containsPointPolygon(p, x, y))]),
    segments: segments.map(([x1, y1, x2, y2]) => [bounds.intersectsSegment(x1, y1, x2, y2)?.name ?? null,
      bounds.aabbIntersectsSegment(x1, y1, x2, y2),
      bounds.polygons.map(p => bounds.intersectsSegmentPolygon(p, x1, y1, x2, y2))]),
    overlaps: rects.map(rect => bounds.aabbIntersectsSkeleton(rect)),
  }
}
const setup = snapshot()
skeleton.bones[1].pose.x = 4
const moved = snapshot()
process.stdout.write(JSON.stringify({ setup, moved }))
`
type Snapshot = {
  names: string[]; polygons: number[][]; aabb: number[]; size: number[]
  points: [string | null, boolean, boolean[]][]
  segments: [string | null, boolean, boolean[]][]
  overlaps: boolean[]
}

describe('Spine 4.3.13 SkeletonBounds oracle', () => {
  it('matches official polygon transforms, selected hit tests, and AABB queries', () => {
    const expected = JSON.parse(execFileSync(process.execPath,
      ['-e', officialScript, root, JSON.stringify({ document, points, segments, rects })],
      { cwd: root, encoding: 'utf8' })) as { setup: Snapshot; moved: Snapshot }
    const asset = importSpine(document, { unitScale: 1, sourceYDown: false })
    const pose = createPose(asset.skeleton)
    const slots = createSlotSet(asset.slots, asset.skins, 'default')
    const bounds = new SkeletonBounds()
    for (const phase of ['setup', 'moved'] as const) {
      if (phase === 'moved') setTranslation(pose, 1, 4, 1)
      bounds.update(pose, slots)
      const oracle = expected[phase]
      expect(bounds.boundingBoxes.map(box => box.id)).toEqual(oracle.names)
      expect(bounds.polygons).toHaveLength(oracle.polygons.length)
      for (let i = 0; i < oracle.polygons.length; i++) {
        expect(bounds.getPolygon(bounds.boundingBoxes[i]!)).toBe(bounds.polygons[i])
        for (let j = 0; j < oracle.polygons[i]!.length; j++) {
          expect(bounds.polygons[i]![j]).toBeCloseTo(oracle.polygons[i]![j]!, 5)
        }
      }
      expect(bounds.getPolygon({ kind: 'boundingBox', id: 'missing', polygon: new Float32Array(6) })).toBeNull()
      for (const [i, value] of [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].entries()) {
        expect(value).toBeCloseTo(oracle.aabb[i]!, 5)
      }
      expect(bounds.getWidth()).toBeCloseTo(oracle.size[0]!, 5)
      expect(bounds.getHeight()).toBeCloseTo(oracle.size[1]!, 5)
      for (const [i, [x, y]] of points.entries()) {
        const [name, aabb, polygonHits] = oracle.points[i]!
        expect(bounds.containsPoint(x, y)?.id ?? null).toBe(name)
        expect(bounds.aabbContainsPoint(x, y)).toBe(aabb)
        bounds.polygons.forEach((polygon, index) => {
          expect(bounds.containsPointPolygon(polygon, x, y)).toBe(polygonHits[index])
        })
      }
      for (const [i, [x1, y1, x2, y2]] of segments.entries()) {
        const [name, aabb, polygonHits] = oracle.segments[i]!
        expect(bounds.intersectsSegment(x1, y1, x2, y2)?.id ?? null).toBe(name)
        expect(bounds.aabbIntersectsSegment(x1, y1, x2, y2)).toBe(aabb)
        bounds.polygons.forEach((polygon, index) => {
          expect(bounds.intersectsSegmentPolygon(polygon, x1, y1, x2, y2)).toBe(polygonHits[index])
        })
      }
      rects.forEach((rect, index) => expect(bounds.aabbIntersectsSkeleton(rect)).toBe(oracle.overlaps[index]))
    }
  })
})
