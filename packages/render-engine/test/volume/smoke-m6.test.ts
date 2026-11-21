/**
 * M6 应用级烟测：头骨挂 ellipsoid 代理，yaw 0/90/180/270 各出一帧 packet。
 * 关注应用视角的四件事：packet 非空、坐标有限、屏幕包围盒合理、2D pose 全程不变。
 * 权威：docs/10-多视角与360.md §8、docs/10-多视角/volume.md §3/§5。
 */
import { describe, expect, it } from '@jest/globals'
import { DEFAULT_CAMERA, type Camera } from '@/render/camera'
import { createPose, updateWorld, WORLD_STRIDE, type Pose } from '@/core/pose'
import { compileSkeleton, type CompiledSkeleton } from '@/core/skeleton'
import { buildVolumePackets, type VolumeProxy, type VolumeRig } from '@/volume/volume'

const RAD = Math.PI / 180
const YAWS = [0, 90, 180, 270] as const

/** 视角对准头骨中心，便于直接断言屏幕包围盒落在视口内。 */
function cameraAt(yawDeg: number): Camera {
  return {
    ...DEFAULT_CAMERA,
    yaw: yawDeg * RAD,
    target: [0, 0.9, 0],
  }
}

function headSkeleton(): CompiledSkeleton {
  return compileSkeleton({
    name: 'm6-smoke',
    profile: 'volume3d',
    bones: [
      { name: 'root', parent: -1 },
      { name: 'head', parent: 0, length: 0.2, setup: { x: 0, y: 0.9 } },
    ],
  })
}

function headProxy(): VolumeProxy {
  const local = new Float32Array(16)
  local[0] = 1
  local[5] = 1
  local[10] = 1
  local[15] = 1
  return {
    id: 'head-ellipsoid',
    bone: 1,
    kind: 'ellipsoid',
    local,
    radius: [0.12, 0.15, 0.1],
    height: 0.3,
    lod: 1,
  }
}

/** 逐位快照 2D pose：权威 local 与派生 world 都不允许被 Volume 路径改写。 */
function snapshot(pose: Pose): { local: number[]; world: number[]; version: number } {
  return {
    local: Array.from(pose.local),
    world: Array.from(pose.world),
    version: pose.version,
  }
}

describe('M6 smoke: 头骨 ellipsoid 四视角 packet', () => {
  const skeleton = headSkeleton()
  const pose = createPose(skeleton)
  updateWorld(pose)
  const rig: VolumeRig = { skeleton, proxies: [headProxy()] }

  it('四个 yaw 均产生非空且全有限的 packet', () => {
    for (const deg of YAWS) {
      const packets = buildVolumePackets(rig, pose, cameraAt(deg))
      expect(packets.length).toBeGreaterThan(0)
      const packet = packets[0]!
      expect(packet.positions.length).toBeGreaterThanOrEqual(16)
      expect(packet.indices.length).toBeGreaterThan(0)
      expect(Array.from(packet.positions).every(Number.isFinite)).toBe(true)
      expect(Array.from(packet.indices).every((i) => i < packet.positions.length / 2)).toBe(true)
      expect(Number.isFinite(packet.depthKey)).toBe(true)
    }
  })

  it('屏幕包围盒在视口内且不退化', () => {
    const width = DEFAULT_CAMERA.viewport.width
    const height = DEFAULT_CAMERA.viewport.height
    for (const deg of YAWS) {
      const packet = buildVolumePackets(rig, pose, cameraAt(deg))[0]!
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (let i = 0; i + 1 < packet.positions.length; i += 2) {
        const x = packet.positions[i]!
        const y = packet.positions[i + 1]!
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
      expect(minX).toBeGreaterThanOrEqual(0)
      expect(maxX).toBeLessThanOrEqual(width)
      expect(minY).toBeGreaterThanOrEqual(0)
      expect(maxY).toBeLessThanOrEqual(height)
      expect(maxX - minX).toBeGreaterThan(0)
      expect(maxY - minY).toBeGreaterThan(0)
      // 头骨中心投影应贴近视口中心（相机 target 对准头骨）。
      expect((minX + maxX) / 2).toBeCloseTo(width / 2, 4)
      expect((minY + maxY) / 2).toBeCloseTo(height / 2, 4)
    }
  })

  it('四帧视角应用后 2D pose 全程不变（应用视角）', () => {
    const before = snapshot(pose)
    const head = rig.skeleton.boneIdByName.get('head')!
    for (const deg of YAWS) {
      const packets = buildVolumePackets(rig, pose, cameraAt(deg))
      expect(packets.length).toBe(1)
      // 逐帧复核：Volume 不能借相机视角改写任何一根骨的世界矩阵。
      const off = head * WORLD_STRIDE
      expect(pose.world[off + 4]).toBeCloseTo(0, 6)
      expect(pose.world[off + 5]).toBeCloseTo(0.9, 6)
    }
    expect(Array.from(pose.local)).toEqual(before.local)
    expect(Array.from(pose.world)).toEqual(before.world)
    expect(pose.version).toBe(before.version)
  })
})
