import { describe, expect, it } from '@jest/globals'
import { createHumanoid } from '@/body/assemble'
import { createMat3 } from '@/math/mat3'
import { createPose, setPoseSwing, setPoseTwist } from '@/skeleton/pose'
import { setParentFromBone } from '@/skeleton/parent-from-bone'
import { RIGID_STRIDE, multiplyRigid, setRigidParentFromBone } from '@/skeleton/rigid'
import { expectClose } from '../math/assert'

describe('rigid', () => {
  it('侧摆和扭转为 0 时退回绕 +Z，平移 z 是绑定横向', () => {
    const humanoid = createHumanoid(1.8)
    const pose = createPose(humanoid.skeleton)
    setPoseSwing(pose, humanoid.boneIndex.upperArmL, 0.4)
    setPoseTwist(pose, humanoid.boneIndex.upperArmL, -0.2)
    const bone = humanoid.boneIndex.upperArmL
    const out = new Float32Array(RIGID_STRIDE)
    setRigidParentFromBone(out, humanoid.skeleton, pose, bone, 0, 0)
    const parent = createMat3()
    setParentFromBone(parent, humanoid.skeleton, pose, bone)
    expectClose(out[0]!, parent[0]!)
    expectClose(out[1]!, parent[1]!)
    expectClose(out[2]!, 0)
    expectClose(out[3]!, parent[3]!)
    expectClose(out[4]!, parent[4]!)
    expectClose(out[5]!, 0)
    expectClose(out[8]!, 1)
    expectClose(out[9]!, parent[6]!)
    expectClose(out[10]!, parent[7]!)
    expectClose(out[11]!, humanoid.skeleton.bindLateral[bone]!)
  })

  it('左臂正侧摆把骨轴远端推向 +Z，右臂相反', () => {
    const humanoid = createHumanoid(1.8)
    const pose = createPose(humanoid.skeleton)
    const length = 0.3
    const left = humanoid.boneIndex.upperArmL
    const right = humanoid.boneIndex.upperArmR
    setPoseSwing(pose, left, 0.5)
    setPoseSwing(pose, right, 0.5)
    const leftRigid = new Float32Array(RIGID_STRIDE)
    const rightRigid = new Float32Array(RIGID_STRIDE)
    setRigidParentFromBone(leftRigid, humanoid.skeleton, pose, left, -1, 1)
    setRigidParentFromBone(rightRigid, humanoid.skeleton, pose, right, 1, -1)
    const leftZ = leftRigid[2]! * length + leftRigid[11]!
    const rightZ = rightRigid[2]! * length + rightRigid[11]!
    expect(leftZ).toBeGreaterThan(leftRigid[11]! + 0.05)
    expect(rightZ).toBeLessThan(rightRigid[11]! - 0.05)
  })

  it('刚体相乘可与输出共用缓冲', () => {
    const parent = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 2, 3])
    const local = Float32Array.from([0, 1, 0, -1, 0, 0, 0, 0, 1, 4, 0, 0])
    const out = parent.slice()
    multiplyRigid(out, out, local)
    expectClose(out[0]!, 0)
    expectClose(out[1]!, 1)
    expectClose(out[9]!, 5)
    expectClose(out[10]!, 2)
    expectClose(out[11]!, 3)
  })
})
