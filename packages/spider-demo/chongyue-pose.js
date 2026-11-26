// Editable rotations relative to the front-facing natural stance.
// Each bone inherits its parent's rigid offset, then rotates about its own pivot.
// Keeping offsets separate preserves the rest matrices without cumulative drift.
export const POSE_CONTROLS = [
  { id: 'pelvis', bone: 'CY_Waist', label: '骨盆', group: '躯干', range: 12 },
  { id: 'chest', bone: 'CY_Shirt', label: '胸廓', group: '躯干', range: 12 },
  { id: 'neck', bone: 'CY_Neck', label: '颈部', group: '躯干', range: 12 },
  { id: 'head', bone: 'CY_Face', label: '头部', group: '躯干', range: 12 },
  { id: 'shoulderL', bone: 'CY_L_Arm', label: '左肩', group: '左臂', range: 20 },
  { id: 'elbowL', bone: 'CY_L_Forearm', label: '左肘', group: '左臂', range: 25 },
  { id: 'wristL', bone: 'CY_L_Hand', label: '左腕', group: '左臂', range: 20 },
  { id: 'shoulderR', bone: 'CY_R_Arm', label: '右肩', group: '右臂', range: 20 },
  { id: 'elbowR', bone: 'CY_R_Forearm', label: '右肘', group: '右臂', range: 25 },
  { id: 'wristR', bone: 'CY_R_Hand_B', label: '右腕', group: '右臂', range: 20 },
  { id: 'hipL', bone: 'CY_L_Leg', label: '左髋', group: '左腿', range: 12 },
  { id: 'kneeL', bone: 'CY_L_Calf', label: '左膝', group: '左腿', range: 18 },
  { id: 'ankleL', bone: 'CY_L_Foot', label: '左踝', group: '左腿', range: 12 },
  { id: 'hipR', bone: 'CY_R_Leg', label: '右髋', group: '右腿', range: 12 },
  { id: 'kneeR', bone: 'CY_R_Calf', label: '右膝', group: '右腿', range: 18 },
  { id: 'ankleR', bone: 'CY_R_Foot', label: '右踝', group: '右腿', range: 12 },
];

export class EditablePose {
  constructor(bones, matrices) {
    if (matrices.length !== bones.length * 6) throw new Error('骨骼矩阵数量错误');
    this.bones = bones;
    this.skeleton = { count: bones.length };
    this.baseWorld = Float64Array.from(matrices);
    this.world = Float64Array.from(matrices);
    this.offsets = new Float64Array(matrices.length);
    this.angles = new Float64Array(bones.length);
    this.byName = new Map(bones.map((bone, index) => [bone.name, index]));
    for (let i = 0; i < bones.length; i++) {
      if (!Number.isInteger(bones[i].parent) || bones[i].parent < -1 || bones[i].parent >= i) {
        throw new Error(`骨骼层级错误: ${bones[i].name}`);
      }
    }
    this.update();
  }

  setAngle(name, degrees) {
    const index = this.byName.get(name);
    if (index === undefined) throw new Error(`骨骼不存在: ${name}`);
    if (!Number.isFinite(degrees)) throw new Error('角度必须是有限数字');
    this.angles[index] = degrees * Math.PI / 180;
    this.update();
  }

  reset() {
    this.angles.fill(0);
    this.update();
  }

  update() {
    const identity = [1, 0, 0, 1, 0, 0];
    for (let i = 0; i < this.bones.length; i++) {
      const offset = i * 6;
      const parent = this.bones[i].parent;
      const p = parent < 0 ? identity : this.offsets.subarray(parent * 6, parent * 6 + 6);
      const b = this.baseWorld.subarray(offset, offset + 6);
      const d = this.offsets.subarray(offset, offset + 6);
      const angle = this.angles[i];
      if (angle === 0) d.set(p);
      else {
        const c = Math.cos(angle), s = Math.sin(angle);
        const x = b[4] - c * b[4] + s * b[5];
        const y = b[5] - s * b[4] - c * b[5];
        d[0] = p[0] * c + p[2] * s;
        d[1] = p[1] * c + p[3] * s;
        d[2] = -p[0] * s + p[2] * c;
        d[3] = -p[1] * s + p[3] * c;
        d[4] = p[0] * x + p[2] * y + p[4];
        d[5] = p[1] * x + p[3] * y + p[5];
      }
      const w = this.world.subarray(offset, offset + 6);
      w[0] = d[0] * b[0] + d[2] * b[1];
      w[1] = d[1] * b[0] + d[3] * b[1];
      w[2] = d[0] * b[2] + d[2] * b[3];
      w[3] = d[1] * b[2] + d[3] * b[3];
      w[4] = d[0] * b[4] + d[2] * b[5] + d[4];
      w[5] = d[1] * b[4] + d[3] * b[5] + d[5];
    }
  }
}
