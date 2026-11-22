import { describe, expect, it } from '@jest/globals'
import { WebGL2Backend, type WebGL2Like } from '@/backend/backend'
import { batchPackets, buildRegionPacket, sortPackets } from '@/render/render'

function mockGl(): WebGL2Like {
  let next = 1
  return {
    createBuffer: () => ({ id: next++ }),
    bindBuffer: () => {}, bufferData: () => {}, bufferSubData: () => {},
    getAttribLocation: () => 0, enableVertexAttribArray: () => {}, vertexAttribPointer: () => {},
    useProgram: () => {}, drawElements: () => {}, getUniformLocation: () => null,
  } as WebGL2Like
}

function frame(packetCount: number) {
  const packets = Array.from({ length: packetCount }, (_, i) => buildRegionPacket({
    id: i,
    positions: new Float32Array([0, 0, 8, 0, 8, 8, 0, 8]),
    color: [1, 1, 1, 1], materialId: 0, order: i, depthKey: 0, seq: i,
  }))
  return { packets: batchPackets(sortPackets(packets)), width: 1920, height: 1080 }
}

describe('performance budget: 1080p frame submission', () => {
  it('keeps draw calls bounded and CPU submission under 16.6ms', () => {
    const f = frame(512)
    expect(f.packets.length).toBeLessThanOrEqual(50)
    const backend = new WebGL2Backend(mockGl())
    const start = performance.now()
    backend.draw(f)
    const elapsed = performance.now() - start
    expect(backend.stats.drawCalls).toBe(f.packets.length)
    expect(elapsed).toBeLessThan(16.6)
    backend.dispose()
  })
})
