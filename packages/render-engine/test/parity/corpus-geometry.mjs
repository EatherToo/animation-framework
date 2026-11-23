import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)))
const require = createRequire(resolve(root, 'package.json'))
const { AtlasAttachmentLoader, Physics, Skeleton, SkeletonJson, TextureAtlas } = require('@esotericsoftware/spine-core')
const fixture = resolve(root, 'test/fixtures/synthetic/corpus-a41')
const json = JSON.parse(readFileSync(resolve(fixture, 'corpus-a41-pro.json'), 'utf8'))
const atlas = new TextureAtlas(readFileSync(resolve(fixture, 'corpus-a41.atlas'), 'utf8'))
const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(json)
const skeleton = new Skeleton(data)
skeleton.updateWorldTransform(Physics.none)
const region = skeleton.findSlot('trimSlot')
const point = skeleton.findSlot('pointSlot')
const sequence = skeleton.findSlot('sequenceSlot')
const world = new Float32Array(8)
region.pose.attachment.computeWorldVertices(region, region.pose.attachment.getOffsets(region.appliedPose), world, 0, 2)
const position = { x: 0, y: 0 }
point.pose.attachment.computeWorldPosition(point.bone.appliedPose, position)
const attachment = sequence.pose.attachment
process.stdout.write(JSON.stringify({
  world: Array.from(world), point: [position.x, position.y], pointRotation: point.pose.attachment.computeWorldRotation(point.bone.appliedPose),
  trimUVs: Array.from(region.pose.attachment.sequence.getUVs(0)),
  sequenceUVs: attachment.sequence.uvs.map(uvs => Array.from(uvs)),
  sequenceOffsets: attachment.sequence.offsets.map(offsets => Array.from(offsets)),
  blends: data.slots.map(slot => slot.blendMode),
}) + '\n')
