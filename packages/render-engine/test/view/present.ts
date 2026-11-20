import type { CompiledRig } from '@/compile/compile'
import { evaluateFk } from '@/fk/evaluate'
import { fillProjected, type FilledPart } from '@/fill/fill'
import { skinMesh } from '@/skin/skin'
import type { Pose } from '@/skeleton/pose'
import { drawOrder } from '@/slot/slot'
import type { Facing } from '@/space/facing'
import { depthOrder, projectParts, type ProjectedPart, type ViewIndex, type ViewSource } from '@/view/project'

export type Presented = {
  readonly skinned: ViewSource[]
  readonly projected: ProjectedPart[]
  readonly filled: FilledPart[]
  readonly tie: string[]
  readonly order: string[]
}

/** 当前姿态下各部件的角色空间顶点，步长 3。 */
export function skinPose(compiled: CompiledRig, pose: Pose): ViewSource[] {
  const count = compiled.skeleton.boneCount
  const fk = new Float32Array(count * 12)
  evaluateFk(fk, compiled, pose, count)
  return compiled.meshes.meshes.map((mesh, index) => {
    const positions = new Float32Array(mesh.positions.length)
    skinMesh(positions, compiled, fk, index)
    return { partId: mesh.partId, positions, indices: mesh.indices }
  })
}

/** 蒙皮、投影、填充并排好远近：测试里走一遍上屏之前的整条链。 */
export function presentPose(
  compiled: CompiledRig,
  pose: Pose,
  view: ViewIndex,
  facing: Facing = 1,
): Presented {
  const skinned = skinPose(compiled, pose)
  const projected = projectParts(skinned, view)
  const filled = fillProjected(
    projected,
    compiled.parts.parts.map((part) => part.fill),
  )
  const tie = drawOrder(new Array<string>(compiled.slots.slots.length), compiled.slots, facing)
  const order = depthOrder(new Array<string>(projected.length), projected, tie)
  return { skinned, projected, filled, tie, order }
}
