import { it, expect } from '@jest/globals'
import { CpuBackend } from '@/backend/backend'
import { batchPackets, buildRegionPacket, sortPackets } from '@/render/render'

const probe = process.env.CPU_RASTER_PROBE === '1' ? it : it.skip

probe('reports short 1080p opaque flat draw-only timing', () => {
  const width = 1920
  const height = 1080
  const packets = []
  for (let i = 0; i < 400; i += 1) {
    const arm = Math.floor(i / 4)
    const slot = i % 4
    const left = (arm % 10) * 192 + 20 + (slot % 2) * 70
    const top = Math.floor(arm / 10) * 108 + 12 + Math.floor(slot / 2) * 45
    packets.push(buildRegionPacket({
      id: i, positions: new Float32Array([left, top, left + 36, top, left + 36, top + 24, left, top + 24]),
      color: [1, 0.5, 0.25, 1], materialId: 0, order: i, depthKey: 0, seq: i,
    }))
  }
  const frame = { width, height, packets: batchPackets(sortPackets(packets)) }
  const cpu = new CpuBackend(width, height)
  const run = (): number => {
    const before = performance.now()
    cpu.draw(frame)
    return performance.now() - before
  }
  for (let i = 0; i < 8; i += 1) run()
  const samples = Array.from({ length: 35 }, run).sort((a, b) => a - b)
  console.log(`[CPU 1080p draw-only probe] p50=${samples[17]!.toFixed(2)}ms p95=${samples[33]!.toFixed(2)}ms drawCalls=${cpu.stats.drawCalls}`)
  expect(cpu.stats.drawCalls).toBe(1)
  expect(cpu.readPixels()[(17 * width + 25) * 4]).toBeGreaterThan(0)
  cpu.dispose()
})
