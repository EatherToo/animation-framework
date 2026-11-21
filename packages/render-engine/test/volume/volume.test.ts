/**
 * M6 Volume/多视角单元测试（TDD 先写测试）。
 * 权威：docs/10-多视角与360.md、docs/10-多视角/{camera,volume,occlusion}.md。
 * 测试只通过公开 API 访问实现，约定见各用例注释。
 */
import { describe, expect, it } from '@jest/globals'
import { DEFAULT_CAMERA, depthKeyFor, type Camera } from '@/render/camera'
import { createPose, updateWorld, type Pose } from '@/core/pose'
import { compileSkeleton, type CompiledSkeleton } from '@/core/skeleton'
import { buildMeshPacket, type RenderPacket } from '@/render/render'
import {
  FIXED_VIEW_ANGLES,
  buildVolumePackets,
  projectProxy,
  resolveViewRule,
  selectLod,
  sortByMode,
  type Side,
  type ViewRule,
  type VolumeProxy,
  type VolumeRig,
} from '@/volume/volume'

const RAD = Math.PI / 180

/** 用角度构造相机，其余字段沿用默认正交相机。 */
function cameraAt(yawDeg: number, pitchDeg = 0): Camera {
  return { ...DEFAULT_CAMERA, yaw: yawDeg * RAD, pitch: pitchDeg * RAD }
}

/** volume3d 骨架：root → head，头骨世界原点在 (0, 0.9)。 */
function headSkeleton(): CompiledSkeleton {
  return compileSkeleton({
    name: 'm6-head',
    profile: 'volume3d',
    bones: [
      { name: 'root', parent: -1 },
      { name: 'head', parent: 0, length: 0.2, setup: { x: 0, y: 0.9 } },
    ],
  })
}

/** 列主序 4x4 单位矩阵；只有 tz 可按测试需要改写。 */
function identityMatrix(): Float32Array {
  const m = new Float32Array(16)
  m[0] = 1
  m[5] = 1
  m[10] = 1
  m[15] = 1
  return m
}

function headProxy(lod: 0 | 1 | 2 | 3 = 1, zOffset = 0): VolumeProxy {
  const local = identityMatrix()
  local[14] = zOffset
  return {
    id: 'head-vol',
    bone: 1,
    kind: 'ellipsoid',
    local,
    radius: [0.12, 0.15, 0.1],
    height: 0.3,
    lod,
  }
}

/** 显式构造规则，避免 exactOptionalPropertyTypes 下可选字段被写成 undefined。 */
function makeRule(args: {
  slot: number
  attachment: string
  yaw: [number, number] | 'any'
  pitch: [number, number] | 'any'
  priority: number
  side?: Side
  hysteresisDeg?: number
  fadeSec?: number
  fallback?: string
}): ViewRule {
  const out: ViewRule = {
    slot: args.slot,
    attachment: args.attachment,
    yaw: args.yaw,
    pitch: args.pitch,
    priority: args.priority,
    hysteresisDeg: args.hysteresisDeg ?? 0,
    fadeSec: args.fadeSec ?? 0,
  }
  if (args.side !== undefined) out.side = args.side
  if (args.fallback !== undefined) out.fallback = args.fallback
  return out
}

describe('M6 resolveViewRule', () => {
  it('按 yaw 区间命中并按 priority 决策，slot 必须匹配', () => {
    const front = makeRule({ slot: 0, attachment: 'front', yaw: [-60 * RAD, 60 * RAD], pitch: 'any', priority: 1 })
    const side = makeRule({ slot: 0, attachment: 'side', yaw: [60 * RAD, 120 * RAD], pitch: 'any', priority: 2 })
    expect(resolveViewRule([front, side], cameraAt(0), 0, null, 0).attachment).toBe('front')
    const at90 = resolveViewRule([front, side], cameraAt(90), 0, null, 0)
    expect(at90.attachment).toBe('side')
    expect(at90.rule?.priority).toBe(2)
    // 规则属于 slot 0，请求 slot 1 时不应命中。
    expect(resolveViewRule([front, side], cameraAt(0), 1, null, 0).attachment).toBeNull()
  })

  it('pitch 闭区间命中；越界时不命中', () => {
    const narrow = makeRule({
      slot: 0, attachment: 'pitch-ok', yaw: 'any', pitch: [-20 * RAD, 20 * RAD], priority: 1,
    })
    expect(resolveViewRule([narrow], cameraAt(0, 0), 0, null, 0).attachment).toBe('pitch-ok')
    expect(resolveViewRule([narrow], cameraAt(0, 45), 0, null, 0).attachment).toBeNull()
    expect(resolveViewRule([narrow], cameraAt(0, -20), 0, null, 0).attachment).toBe('pitch-ok')
  })

  it('side 由相机 yaw 符号近似；正视只匹配 any', () => {
    const right = makeRule({ slot: 0, attachment: 'right', yaw: 'any', pitch: 'any', side: 'right', priority: 3 })
    const left = makeRule({ slot: 0, attachment: 'left', yaw: 'any', pitch: 'any', side: 'left', priority: 2 })
    const any = makeRule({ slot: 0, attachment: 'any', yaw: 'any', pitch: 'any', side: 'any', priority: 1 })
    const rules = [right, left, any]
    expect(resolveViewRule(rules, cameraAt(90), 0, null, 0).attachment).toBe('right')
    expect(resolveViewRule(rules, cameraAt(-90), 0, null, 0).attachment).toBe('left')
    expect(resolveViewRule(rules, cameraAt(0), 0, null, 0).attachment).toBe('any')
  })

  it('yaw 区间跨 ±π 时按 wrap 判断', () => {
    const back = makeRule({
      slot: 0, attachment: 'back', yaw: [170 * RAD, -170 * RAD], pitch: 'any', priority: 1,
    })
    expect(resolveViewRule([back], cameraAt(175), 0, null, 0).attachment).toBe('back')
    expect(resolveViewRule([back], cameraAt(-175), 0, null, 0).attachment).toBe('back')
    expect(resolveViewRule([back], cameraAt(0), 0, null, 0).attachment).toBeNull()
  })

  it('滞回：上一附件在边界外 hysteresisDeg 内保持，超出则切换', () => {
    const front = makeRule({
      slot: 0, attachment: 'front', yaw: [-30 * RAD, 30 * RAD], pitch: 'any',
      priority: 2, hysteresisDeg: 3,
    })
    const side = makeRule({ slot: 0, attachment: 'side', yaw: [30 * RAD, 90 * RAD], pitch: 'any', priority: 1 })
    expect(resolveViewRule([front, side], cameraAt(32), 0, 'front', 0).attachment).toBe('front')
    expect(resolveViewRule([front, side], cameraAt(34), 0, 'front', 0).attachment).toBe('side')
    // 无 prev 时不允许滞回，严格命中 side。
    expect(resolveViewRule([front, side], cameraAt(32), 0, null, 0).attachment).toBe('side')
  })

  it('fadeSec>0 时 fadeAlpha 随 elapsed 线性到 1；fadeSec=0 硬切', () => {
    const fading = makeRule({ slot: 0, attachment: 'fade', yaw: 'any', pitch: 'any', priority: 1, fadeSec: 0.5 })
    expect(resolveViewRule([fading], cameraAt(0), 0, null, 0.25).fadeAlpha).toBeCloseTo(0.5, 6)
    expect(resolveViewRule([fading], cameraAt(0), 0, null, 1).fadeAlpha).toBe(1)
    expect(resolveViewRule([fading], cameraAt(0), 0, null, -1).fadeAlpha).toBe(0)
    const hard = makeRule({ slot: 0, attachment: 'hard', yaw: 'any', pitch: 'any', priority: 1, fadeSec: 0 })
    expect(resolveViewRule([hard], cameraAt(0), 0, null, 0.1).fadeAlpha).toBe(1)
  })

  it('无命中时优先使用 fallback，否则返回 null', () => {
    const withFallback = makeRule({
      slot: 0, attachment: 'x', yaw: [0, 10 * RAD], pitch: 'any', priority: 1, fallback: 'fb',
    })
    expect(resolveViewRule([withFallback], cameraAt(90), 0, null, 0)).toEqual({
      attachment: 'fb', fadeAlpha: 1, rule: null,
    })
    const noFallback = makeRule({ slot: 0, attachment: 'y', yaw: [0, 10 * RAD], pitch: 'any', priority: 1 })
    expect(resolveViewRule([noFallback], cameraAt(90), 0, null, 0).attachment).toBeNull()
  })
})

describe('M6 projectProxy', () => {
  const pose = createPose(headSkeleton())
  updateWorld(pose)
  const proxy = headProxy()

  it('8 档 yaw 全有限，索引与包围盒合法', () => {
    for (const deg of FIXED_VIEW_ANGLES) {
      const out = projectProxy(proxy, pose, cameraAt(deg))
      const count = out.vertices.length / 2
      expect(out.vertices.length % 2).toBe(0)
      expect(count).toBeGreaterThanOrEqual(8)
      expect(Array.from(out.vertices).every(Number.isFinite)).toBe(true)
      expect(out.indices.length).toBeGreaterThan(0)
      expect(Math.max(...out.indices)).toBeLessThan(count)
      expect(Number.isFinite(out.depthKey)).toBe(true)
      expect(Number.isFinite(out.screenError)).toBe(true)
      expect(out.screenError).toBeGreaterThanOrEqual(0)
    }
  })

  it('depthKey 在 yaw=0 下随代理沿 +Z 靠近相机而单调增大', () => {
    const near = projectProxy(headProxy(1, 0.3), pose, cameraAt(0)).depthKey
    const mid = projectProxy(headProxy(1, 0), pose, cameraAt(0)).depthKey
    const far = projectProxy(headProxy(1, -0.3), pose, cameraAt(0)).depthKey
    expect(near).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(far)
    expect(mid).toBeCloseTo(depthKeyFor('volume', 0, DEFAULT_CAMERA.distance), 5)
  })

  it('convex 退化读取 local 中的打包顶点，仍输出有限几何', () => {
    const local = new Float32Array([
      -0.1, -0.1, 0, 0.1, -0.1, 0.1, 0.1, 0.1, 0, -0.1, 0.1, -0.1, 0, 0, 0.2, 0,
    ])
    const convex: VolumeProxy = {
      id: 'convex', bone: 1, kind: 'convex', local, radius: [0.1, 0.1, 0.1], height: 0.2, lod: 1,
    }
    const out = projectProxy(convex, pose, cameraAt(45))
    expect(out.vertices.length / 2).toBeGreaterThanOrEqual(3)
    expect(Array.from(out.vertices).every(Number.isFinite)).toBe(true)
    expect(Number.isFinite(out.depthKey)).toBe(true)
  })

  it('投影不写回 2D pose（local/world/version 逐位相同）', () => {
    const localBefore = pose.local.slice()
    const worldBefore = pose.world.slice()
    const versionBefore = pose.version
    projectProxy(proxy, pose, cameraAt(135))
    expect(Array.from(pose.local)).toEqual(Array.from(localBefore))
    expect(Array.from(pose.world)).toEqual(Array.from(worldBefore))
    expect(pose.version).toBe(versionBefore)
  })
})

describe('M6 selectLod', () => {
  it('阈值明确：误差越大返回越小的 lod 数值以省预算', () => {
    const proxy = headProxy()
    expect(selectLod(proxy, 0.25)).toBe(3)
    expect(selectLod(proxy, 1)).toBe(2)
    expect(selectLod(proxy, 2)).toBe(1)
    expect(selectLod(proxy, 8)).toBe(0)
    expect(selectLod(proxy, Number.NaN)).toBe(0)
  })

  it('误差增大时 lod 数值单调不增', () => {
    const proxy = headProxy()
    const errors = [0, 0.5, 1, 1.5, 2, 3, 4, 100]
    const lods = errors.map((e) => selectLod(proxy, e))
    for (let i = 1; i < lods.length; i += 1) {
      expect(lods[i]!).toBeLessThanOrEqual(lods[i - 1]!)
    }
  })
})

describe('M6 buildVolumePackets', () => {
  it('每代理一个 mesh packet，顶点数跨 yaw 稳定且颜色/材质一致', () => {
    const skeleton = headSkeleton()
    const pose = createPose(skeleton)
    updateWorld(pose)
    const proxies: VolumeProxy[] = [headProxy(1), { ...headProxy(1), id: 'root-vol', bone: 0 }]
    const rig: VolumeRig = { skeleton, proxies }
    const counts: number[] = []
    for (const deg of [0, 90, 180, 270]) {
      const camera = cameraAt(deg)
      const packets = buildVolumePackets(rig, pose, camera, {
        startId: 10, blend: 'add', color: [0.5, 0.25, 0.75, 0.5],
      })
      expect(packets.length).toBe(2)
      expect(packets.map((p) => p.id)).toEqual([10, 11])
      counts.push(packets[0]!.positions.length / 2)
      packets.forEach((packet, index) => {
        expect(packet.kind).toBe('mesh')
        expect(packet.version).toBe(1)
        expect(packet.blend).toBe('add')
        expect(packet.materialId).toBe(packets[0]!.materialId)
        expect(Array.from(packet.colors)).toEqual(Array.from(packets[0]!.colors))
        expect(Array.from(packet.positions).every(Number.isFinite)).toBe(true)
        expect(packet.depthKey).toBeCloseTo(projectProxy(proxies[index]!, pose, camera).depthKey, 6)
      })
    }
    expect(new Set(counts).size).toBe(1)
  })

  it('构建 packet 不修改 pose', () => {
    const skeleton = headSkeleton()
    const pose = createPose(skeleton)
    updateWorld(pose)
    const rig: VolumeRig = { skeleton, proxies: [headProxy()] }
    const localBefore = pose.local.slice()
    const worldBefore = pose.world.slice()
    const versionBefore = pose.version
    buildVolumePackets(rig, pose, cameraAt(90))
    expect(Array.from(pose.local)).toEqual(Array.from(localBefore))
    expect(Array.from(pose.world)).toEqual(Array.from(worldBefore))
    expect(pose.version).toBe(versionBefore)
  })
})

describe('M6 sortByMode', () => {
  function packet(id: number, order: number, depthKey: number, subOrder = 0, seq = 0): RenderPacket {
    return buildMeshPacket({
      id,
      positions: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
      color: [1, 1, 1, 1],
      materialId: 0,
      order,
      depthKey,
      subOrder,
      seq,
    })
  }

  const a = packet(1, 1, 9, 0, 0)
  const b = packet(2, 2, 1, 0, 0)
  const c = packet(3, 1, 3, 1, 0)

  it('2d 用 (order, depthKey, subOrder, seq) 升序', () => {
    // a/c 同为 order=1，按 depthKey 升序 c(3) 先于 a(9)；b 的 order=2 最后。
    expect(sortByMode([b, c, a], '2d').map((p) => p.id)).toEqual([3, 1, 2])
  })

  it('2.5d 以 depthKey 为主序升序', () => {
    expect(sortByMode([a, b, c], '2.5d').map((p) => p.id)).toEqual([2, 3, 1])
  })

  it('volume 按 depthKey 降序（z-buffer 近→远 early-z 语义）', () => {
    expect(sortByMode([a, b, c], 'volume').map((p) => p.id)).toEqual([1, 3, 2])
  })

  it('不修改输入数组，同键按原始下标稳定', () => {
    const input = [c, a, b]
    const before = input.slice()
    const sorted = sortByMode(input, '2d')
    expect(sorted).not.toBe(input)
    expect(input).toEqual(before)
    const p1 = packet(11, 5, 1, 0, 1)
    const p2 = packet(12, 5, 1, 0, 1)
    expect(sortByMode([p2, p1], '2d').map((p) => p.id)).toEqual([12, 11])
  })
})
