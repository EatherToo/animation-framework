"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // packages/render-engine/src/body/proportions.ts
  var REACH_MARGIN = 0.98;
  function createProportions(height) {
    if (!Number.isFinite(height) || height <= 0) {
      throw new Error("height");
    }
    const H = height;
    const hipHeight = 0.53 * H;
    const ankleHeight = 0.039 * H;
    const thighLength = 0.245 * H;
    const shinLength = 0.246 * H;
    const footLength = 0.152 * H;
    const chestLength = 0.144 * H;
    const shoulderDropY = 0.02 * H;
    const stanceWidth = 0.12 * H;
    const shoulderOffsetZ = 0.11 * H;
    return {
      height: H,
      hipHeight,
      ankleHeight,
      pelvisLength: 0.05 * H,
      spineLength: 0.144 * H,
      chestLength,
      neckLength: 0.052 * H,
      headLength: 0.13 * H,
      upperArmLength: 0.186 * H,
      lowerArmLength: 0.146 * H,
      handLength: 0.108 * H,
      thighLength,
      shinLength,
      footLength,
      legLength: thighLength + shinLength,
      spineProfile: profile(H, [[0, 0.09], [0.55, 0.062], [1, 0.062]]),
      chestProfile: profile(H, [
        [0, 0.062],
        [0.45, 0.08],
        [1 - shoulderDropY / chestLength, 0.11],
        [1, 0.036]
      ]),
      neckProfile: profile(H, [[0, 0.036], [1, 0.032]]),
      headProfile: profile(H, [[0, 0.032], [0.45, 0.078], [1, 0.028]]),
      upperArmProfile: profile(H, [[0, 0.04], [0.5, 0.032], [1, 0.018]]),
      lowerArmProfile: profile(H, [[0, 0.018], [0.5, 0.026], [1, 0.016]]),
      thighProfile: profile(H, [[0, 0.072], [0.4, 0.06], [1, 0.026]]),
      shinProfile: profile(H, [[0, 0.026], [0.5, 0.038], [1, 0.02]]),
      palmRadius: 0.028 * H,
      palmFraction: 0.42,
      fingerRadius: 65e-4 * H,
      fingerFraction: 0.58,
      fingerSpread: [8e-3 * H, 0.022 * H],
      thumbRadius: 8e-3 * H,
      thumbFraction: 0.36,
      thumbAlong: 0.2,
      thumbDrop: 0.012 * H,
      thumbOffsetZ: 0.02 * H,
      heelBack: 0.3 * footLength,
      footHalfWidth: profile(H, [[0, 0.022], [0.65, 0.032], [1, 0.016]]),
      footInstep: profile(H, [[0, 0.04], [0.5, 0.052], [1, 0.022]]),
      stanceWidth,
      hipOffsetZ: stanceWidth / 2,
      shoulderOffsetZ,
      hipDropY: hipHeight - thighLength - shinLength - ankleHeight,
      shoulderDropY,
      reachMargin: REACH_MARGIN
    };
  }
  function profile(height, samples) {
    return samples.map(([t, coefficient]) => ({ t, radius: coefficient * height }));
  }

  // packages/render-engine/src/body/chains.ts
  var LEG_BEND_SIGN = 1;
  var ARM_BEND_SIGN = -1;
  var LEG_ROM_MIN = -2.618;
  var LEG_ROM_MAX = 0.035;
  var ARM_ROM_MIN = -0.175;
  var ARM_ROM_MAX = 2.443;
  function makeTwoBoneChain(spec) {
    if (!Number.isInteger(spec.root) || !Number.isInteger(spec.mid) || !Number.isInteger(spec.end) || spec.root < 0 || spec.mid < 0 || spec.end < 0) {
      throw new Error("bone index");
    }
    if (spec.root === spec.mid || spec.mid === spec.end || spec.root === spec.end) {
      throw new Error("bone index");
    }
    if (spec.bendSign !== 1 && spec.bendSign !== -1) throw new Error("bendSign");
    if (!Number.isFinite(spec.romMin) || !Number.isFinite(spec.romMax) || !(spec.romMin < spec.romMax)) {
      throw new Error("rom");
    }
    return {
      root: spec.root,
      mid: spec.mid,
      end: spec.end,
      bendSign: spec.bendSign,
      romMin: spec.romMin,
      romMax: spec.romMax
    };
  }

  // packages/render-engine/src/math/angle.ts
  var TAU = Math.PI * 2;
  function normalizeAngle(rad) {
    if (!Number.isFinite(rad)) return rad;
    let r = ((rad + Math.PI) % TAU + TAU) % TAU - Math.PI;
    if (r === -Math.PI) r = Math.PI;
    return r;
  }

  // packages/render-engine/src/skeleton/pose.ts
  var POSE_STRIDE = 5;
  function createPose(skeleton) {
    return {
      skeleton,
      data: new Float32Array(skeleton.boneCount * POSE_STRIDE)
    };
  }
  function setPoseRotation(pose2, bone, rotation) {
    pose2.data[bone * POSE_STRIDE + 2] = normalizeAngle(rotation);
  }
  function setPoseSwing(pose2, bone, swing) {
    pose2.data[bone * POSE_STRIDE + 3] = normalizeAngle(swing);
  }
  function setPoseTwist(pose2, bone, twist) {
    pose2.data[bone * POSE_STRIDE + 4] = normalizeAngle(twist);
  }
  function poseRotation(pose2, bone) {
    return pose2.data[bone * POSE_STRIDE + 2];
  }
  function poseSwing(pose2, bone) {
    return pose2.data[bone * POSE_STRIDE + 3];
  }
  function poseTwist(pose2, bone) {
    return pose2.data[bone * POSE_STRIDE + 4];
  }

  // packages/render-engine/src/body/joints.ts
  var LOCKED = { min: 0, max: 0 };
  function createJointDofs(boneIndex) {
    const joints = new Array(17);
    const put = (name, rotation, swing, twist, swingSign, twistSign) => {
      const bone = boneIndex[name];
      joints[bone] = { bone, rotation, swing, twist, swingSign, twistSign };
    };
    const mid = { swingSign: -1, twistSign: 1 };
    put("pelvis", null, null, null, mid.swingSign, mid.twistSign);
    put("spine", range(-1.047, 0.524), span(0.349), span(0.175), mid.swingSign, mid.twistSign);
    put("chest", range(-0.524, 0.349), span(0.349), span(0.611), mid.swingSign, mid.twistSign);
    put("neck", range(-0.873, 1.047), span(0.785), span(1.396), mid.swingSign, mid.twistSign);
    put("head", range(-0.262, 0.349), span(0.175), span(0.785), mid.swingSign, mid.twistSign);
    const shoulder = {
      rotation: range(-1.047, 2.618),
      swing: range(-0.524, 2.618),
      twist: range(-1.222, 1.571)
    };
    put("upperArmL", shoulder.rotation, shoulder.swing, shoulder.twist, -1, 1);
    put("upperArmR", shoulder.rotation, shoulder.swing, shoulder.twist, 1, -1);
    const elbow = range(ARM_ROM_MIN, ARM_ROM_MAX);
    const pronation = span(1.396);
    put("lowerArmL", elbow, LOCKED, pronation, 0, 1);
    put("lowerArmR", elbow, LOCKED, pronation, 0, -1);
    const wrist = range(-1.222, 1.222);
    const deviation = range(-0.524, 0.349);
    put("handL", wrist, deviation, LOCKED, -1, 0);
    put("handR", wrist, deviation, LOCKED, 1, 0);
    const hip = {
      rotation: range(-0.524, 2.094),
      swing: range(-0.524, 0.785),
      twist: range(-0.698, 0.785)
    };
    put("thighL", hip.rotation, hip.swing, hip.twist, -1, 1);
    put("thighR", hip.rotation, hip.swing, hip.twist, 1, -1);
    const knee = range(LEG_ROM_MIN, LEG_ROM_MAX);
    put("shinL", knee, LOCKED, LOCKED, 0, 0);
    put("shinR", knee, LOCKED, LOCKED, 0, 0);
    const ankle = range(-0.698, 0.524);
    const inversion = range(-0.349, 0.524);
    put("footL", ankle, LOCKED, inversion, 0, 1);
    put("footR", ankle, LOCKED, inversion, 0, -1);
    return joints;
  }
  function range(min2, max2) {
    return { min: min2, max: max2 };
  }
  function span(abs) {
    return { min: -abs, max: abs };
  }

  // packages/render-engine/src/skeleton/skeleton.ts
  var PARENT_NONE = -1;
  var MAX_BONES = 256;
  function createSkeletonBuilder() {
    return {
      finished: false,
      count: 0,
      names: [],
      parent: [],
      translationX: [],
      translationY: [],
      translationZ: [],
      rotation: [],
      length: []
    };
  }
  function addBone(builder, spec) {
    if (builder.finished) throw new Error("skeleton already finished");
    if (builder.count >= MAX_BONES) throw new Error("too many bones");
    if (typeof spec.name !== "string" || spec.name.length === 0) {
      throw new Error("bone name");
    }
    if (builder.names.includes(spec.name)) throw new Error("duplicate bone name");
    const index = builder.count;
    if (index === 0) {
      if (spec.parent !== PARENT_NONE) throw new Error("root parent");
    } else if (!Number.isInteger(spec.parent) || spec.parent < 0 || spec.parent >= index) {
      throw new Error("parent");
    }
    const { translationX: tx, translationY: ty, translationZ: tz, rotation, length: length2 } = spec;
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(tz) || !Number.isFinite(rotation) || !Number.isFinite(length2) || length2 < 0) {
      throw new Error("bind");
    }
    builder.names.push(spec.name);
    builder.parent.push(spec.parent);
    builder.translationX.push(tx);
    builder.translationY.push(ty);
    builder.translationZ.push(tz);
    builder.rotation.push(normalizeAngle(rotation));
    builder.length.push(length2 === 0 ? 0 : length2);
    builder.count = index + 1;
    return index;
  }
  function finishSkeleton(builder) {
    if (builder.finished) throw new Error("skeleton already finished");
    if (builder.count === 0) throw new Error("empty skeleton");
    const boneCount = builder.count;
    const name = builder.names.slice();
    const parent = new Int16Array(boneCount);
    const bindTranslation2 = new Float32Array(boneCount * 2);
    const bindLateral2 = new Float32Array(boneCount);
    const bindRotation2 = new Float32Array(boneCount);
    const bindLength2 = new Float32Array(boneCount);
    for (let i = 0; i < boneCount; i += 1) {
      parent[i] = builder.parent[i];
      bindTranslation2[i * 2] = builder.translationX[i];
      bindTranslation2[i * 2 + 1] = builder.translationY[i];
      bindLateral2[i] = builder.translationZ[i];
      bindRotation2[i] = builder.rotation[i];
      bindLength2[i] = builder.length[i];
    }
    builder.finished = true;
    return {
      boneCount,
      name,
      parent,
      bindTranslation: bindTranslation2,
      bindLateral: bindLateral2,
      bindRotation: bindRotation2,
      bindLength: bindLength2
    };
  }
  function parentOf(skeleton, bone) {
    return skeleton.parent[bone];
  }
  function boneName(skeleton, bone) {
    return skeleton.name[bone];
  }
  function findBone(skeleton, name) {
    for (let i = 0; i < skeleton.boneCount; i += 1) {
      if (skeleton.name[i] === name) return i;
    }
    return PARENT_NONE;
  }
  function bindTranslation(out, skeleton, bone) {
    const i = bone * 2;
    out[0] = skeleton.bindTranslation[i];
    out[1] = skeleton.bindTranslation[i + 1];
    return out;
  }
  function bindLength(skeleton, bone) {
    return skeleton.bindLength[bone];
  }

  // packages/render-engine/src/body/assemble.ts
  var BONE_NAMES = [
    "pelvis",
    "spine",
    "chest",
    "neck",
    "head",
    "upperArmL",
    "lowerArmL",
    "handL",
    "upperArmR",
    "lowerArmR",
    "handR",
    "thighL",
    "shinL",
    "footL",
    "thighR",
    "shinR",
    "footR"
  ];
  function createHumanoid(height) {
    return createHumanoidFromProportions(createProportions(height));
  }
  function createHumanoidFromProportions(p) {
    const builder = createSkeletonBuilder();
    const halfPi = Math.PI / 2;
    const pelvis = addBone(builder, {
      name: "pelvis",
      parent: PARENT_NONE,
      translationX: 0,
      translationY: p.hipHeight,
      translationZ: 0,
      rotation: 0,
      length: p.pelvisLength
    });
    const spine = addBone(builder, {
      name: "spine",
      parent: pelvis,
      translationX: 0,
      translationY: 0,
      translationZ: 0,
      rotation: halfPi,
      length: p.spineLength
    });
    const chest = addBone(builder, {
      name: "chest",
      parent: spine,
      translationX: p.spineLength,
      translationY: 0,
      translationZ: 0,
      rotation: 0,
      length: p.chestLength
    });
    const neck = addBone(builder, {
      name: "neck",
      parent: chest,
      translationX: p.chestLength,
      translationY: 0,
      translationZ: 0,
      rotation: 0,
      length: p.neckLength
    });
    const head = addBone(builder, {
      name: "head",
      parent: neck,
      translationX: p.neckLength,
      translationY: 0,
      translationZ: 0,
      rotation: 0,
      length: p.headLength
    });
    const upperArmL = addBone(builder, {
      name: "upperArmL",
      parent: chest,
      translationX: p.chestLength - p.shoulderDropY,
      translationY: 0,
      translationZ: p.shoulderOffsetZ,
      rotation: Math.PI,
      length: p.upperArmLength
    });
    const lowerArmL = addBone(builder, {
      name: "lowerArmL",
      parent: upperArmL,
      translationX: p.upperArmLength,
      translationY: 0,
      translationZ: 0,
      rotation: 0,
      length: p.lowerArmLength
    });
    const handL = addBone(builder, {
      name: "handL",
      parent: lowerArmL,
      translationX: p.lowerArmLength,
      translationY: 0,
      translationZ: 0,
      rotation: 0,
      length: p.handLength
    });
    const upperArmR = addBone(builder, {
      name: "upperArmR",
      parent: chest,
      translationX: p.chestLength - p.shoulderDropY,
      translationY: 0,
      translationZ: -p.shoulderOffsetZ,
      rotation: Math.PI,
      length: p.upperArmLength
    });
    const lowerArmR = addBone(builder, {
      name: "lowerArmR",
      parent: upperArmR,
      translationX: p.upperArmLength,
      translationY: 0,
      translationZ: 0,
      rotation: 0,
      length: p.lowerArmLength
    });
    const handR = addBone(builder, {
      name: "handR",
      parent: lowerArmR,
      translationX: p.lowerArmLength,
      translationY: 0,
      translationZ: 0,
      rotation: 0,
      length: p.handLength
    });
    const thighL = addBone(builder, {
      name: "thighL",
      parent: pelvis,
      translationX: 0,
      translationY: -p.hipDropY,
      translationZ: p.hipOffsetZ,
      rotation: -halfPi,
      length: p.thighLength
    });
    const shinL = addBone(builder, {
      name: "shinL",
      parent: thighL,
      translationX: p.thighLength,
      translationY: 0,
      translationZ: 0,
      rotation: 0,
      length: p.shinLength
    });
    const footL = addBone(builder, {
      name: "footL",
      parent: shinL,
      translationX: p.shinLength,
      translationY: 0,
      translationZ: 0,
      rotation: halfPi,
      length: p.footLength
    });
    const thighR = addBone(builder, {
      name: "thighR",
      parent: pelvis,
      translationX: 0,
      translationY: -p.hipDropY,
      translationZ: -p.hipOffsetZ,
      rotation: -halfPi,
      length: p.thighLength
    });
    const shinR = addBone(builder, {
      name: "shinR",
      parent: thighR,
      translationX: p.thighLength,
      translationY: 0,
      translationZ: 0,
      rotation: 0,
      length: p.shinLength
    });
    const footR = addBone(builder, {
      name: "footR",
      parent: shinR,
      translationX: p.shinLength,
      translationY: 0,
      translationZ: 0,
      rotation: halfPi,
      length: p.footLength
    });
    const skeleton = finishSkeleton(builder);
    const boneIndex = {
      pelvis,
      spine,
      chest,
      neck,
      head,
      upperArmL,
      lowerArmL,
      handL,
      upperArmR,
      lowerArmR,
      handR,
      thighL,
      shinL,
      footL,
      thighR,
      shinR,
      footR
    };
    return {
      height: p.height,
      proportions: p,
      skeleton,
      boneIndex,
      chains: {
        legL: makeTwoBoneChain({
          root: thighL,
          mid: shinL,
          end: footL,
          bendSign: LEG_BEND_SIGN,
          romMin: LEG_ROM_MIN,
          romMax: LEG_ROM_MAX
        }),
        legR: makeTwoBoneChain({
          root: thighR,
          mid: shinR,
          end: footR,
          bendSign: LEG_BEND_SIGN,
          romMin: LEG_ROM_MIN,
          romMax: LEG_ROM_MAX
        }),
        armL: makeTwoBoneChain({
          root: upperArmL,
          mid: lowerArmL,
          end: handL,
          bendSign: ARM_BEND_SIGN,
          romMin: ARM_ROM_MIN,
          romMax: ARM_ROM_MAX
        }),
        armR: makeTwoBoneChain({
          root: upperArmR,
          mid: lowerArmR,
          end: handR,
          bendSign: ARM_BEND_SIGN,
          romMin: ARM_ROM_MIN,
          romMax: ARM_ROM_MAX
        })
      },
      joints: createJointDofs(boneIndex)
    };
  }

  // node_modules/.pnpm/gl-matrix@3.4.4/node_modules/gl-matrix/esm/common.js
  var EPSILON = 1e-6;
  var ARRAY_TYPE = typeof Float32Array !== "undefined" ? Float32Array : Array;
  var RANDOM = Math.random;
  function round(a) {
    if (a >= 0) return Math.round(a);
    return a % 0.5 === 0 ? Math.floor(a) : Math.round(a);
  }
  var degree = Math.PI / 180;
  var radian = 180 / Math.PI;

  // node_modules/.pnpm/gl-matrix@3.4.4/node_modules/gl-matrix/esm/mat3.js
  var mat3_exports = {};
  __export(mat3_exports, {
    add: () => add,
    adjoint: () => adjoint,
    clone: () => clone,
    copy: () => copy,
    create: () => create,
    determinant: () => determinant,
    equals: () => equals,
    exactEquals: () => exactEquals,
    frob: () => frob,
    fromMat2d: () => fromMat2d,
    fromMat4: () => fromMat4,
    fromQuat: () => fromQuat,
    fromRotation: () => fromRotation,
    fromScaling: () => fromScaling,
    fromTranslation: () => fromTranslation,
    fromValues: () => fromValues,
    identity: () => identity,
    invert: () => invert,
    mul: () => mul,
    multiply: () => multiply,
    multiplyScalar: () => multiplyScalar,
    multiplyScalarAndAdd: () => multiplyScalarAndAdd,
    normalFromMat4: () => normalFromMat4,
    projection: () => projection,
    rotate: () => rotate,
    scale: () => scale,
    set: () => set,
    str: () => str,
    sub: () => sub,
    subtract: () => subtract,
    translate: () => translate,
    transpose: () => transpose
  });
  function create() {
    var out = new ARRAY_TYPE(9);
    if (ARRAY_TYPE != Float32Array) {
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[5] = 0;
      out[6] = 0;
      out[7] = 0;
    }
    out[0] = 1;
    out[4] = 1;
    out[8] = 1;
    return out;
  }
  function fromMat4(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[4];
    out[4] = a[5];
    out[5] = a[6];
    out[6] = a[8];
    out[7] = a[9];
    out[8] = a[10];
    return out;
  }
  function clone(a) {
    var out = new ARRAY_TYPE(9);
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    return out;
  }
  function copy(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    return out;
  }
  function fromValues(m00, m01, m02, m10, m11, m12, m20, m21, m22) {
    var out = new ARRAY_TYPE(9);
    out[0] = m00;
    out[1] = m01;
    out[2] = m02;
    out[3] = m10;
    out[4] = m11;
    out[5] = m12;
    out[6] = m20;
    out[7] = m21;
    out[8] = m22;
    return out;
  }
  function set(out, m00, m01, m02, m10, m11, m12, m20, m21, m22) {
    out[0] = m00;
    out[1] = m01;
    out[2] = m02;
    out[3] = m10;
    out[4] = m11;
    out[5] = m12;
    out[6] = m20;
    out[7] = m21;
    out[8] = m22;
    return out;
  }
  function identity(out) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 1;
    out[5] = 0;
    out[6] = 0;
    out[7] = 0;
    out[8] = 1;
    return out;
  }
  function transpose(out, a) {
    if (out === a) {
      var a01 = a[1], a02 = a[2], a12 = a[5];
      out[1] = a[3];
      out[2] = a[6];
      out[3] = a01;
      out[5] = a[7];
      out[6] = a02;
      out[7] = a12;
    } else {
      out[0] = a[0];
      out[1] = a[3];
      out[2] = a[6];
      out[3] = a[1];
      out[4] = a[4];
      out[5] = a[7];
      out[6] = a[2];
      out[7] = a[5];
      out[8] = a[8];
    }
    return out;
  }
  function invert(out, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2];
    var a10 = a[3], a11 = a[4], a12 = a[5];
    var a20 = a[6], a21 = a[7], a22 = a[8];
    var b01 = a22 * a11 - a12 * a21;
    var b11 = -a22 * a10 + a12 * a20;
    var b21 = a21 * a10 - a11 * a20;
    var det = a00 * b01 + a01 * b11 + a02 * b21;
    if (!det) {
      return null;
    }
    det = 1 / det;
    out[0] = b01 * det;
    out[1] = (-a22 * a01 + a02 * a21) * det;
    out[2] = (a12 * a01 - a02 * a11) * det;
    out[3] = b11 * det;
    out[4] = (a22 * a00 - a02 * a20) * det;
    out[5] = (-a12 * a00 + a02 * a10) * det;
    out[6] = b21 * det;
    out[7] = (-a21 * a00 + a01 * a20) * det;
    out[8] = (a11 * a00 - a01 * a10) * det;
    return out;
  }
  function adjoint(out, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2];
    var a10 = a[3], a11 = a[4], a12 = a[5];
    var a20 = a[6], a21 = a[7], a22 = a[8];
    out[0] = a11 * a22 - a12 * a21;
    out[1] = a02 * a21 - a01 * a22;
    out[2] = a01 * a12 - a02 * a11;
    out[3] = a12 * a20 - a10 * a22;
    out[4] = a00 * a22 - a02 * a20;
    out[5] = a02 * a10 - a00 * a12;
    out[6] = a10 * a21 - a11 * a20;
    out[7] = a01 * a20 - a00 * a21;
    out[8] = a00 * a11 - a01 * a10;
    return out;
  }
  function determinant(a) {
    var a00 = a[0], a01 = a[1], a02 = a[2];
    var a10 = a[3], a11 = a[4], a12 = a[5];
    var a20 = a[6], a21 = a[7], a22 = a[8];
    return a00 * (a22 * a11 - a12 * a21) + a01 * (-a22 * a10 + a12 * a20) + a02 * (a21 * a10 - a11 * a20);
  }
  function multiply(out, a, b) {
    var a00 = a[0], a01 = a[1], a02 = a[2];
    var a10 = a[3], a11 = a[4], a12 = a[5];
    var a20 = a[6], a21 = a[7], a22 = a[8];
    var b00 = b[0], b01 = b[1], b02 = b[2];
    var b10 = b[3], b11 = b[4], b12 = b[5];
    var b20 = b[6], b21 = b[7], b22 = b[8];
    out[0] = b00 * a00 + b01 * a10 + b02 * a20;
    out[1] = b00 * a01 + b01 * a11 + b02 * a21;
    out[2] = b00 * a02 + b01 * a12 + b02 * a22;
    out[3] = b10 * a00 + b11 * a10 + b12 * a20;
    out[4] = b10 * a01 + b11 * a11 + b12 * a21;
    out[5] = b10 * a02 + b11 * a12 + b12 * a22;
    out[6] = b20 * a00 + b21 * a10 + b22 * a20;
    out[7] = b20 * a01 + b21 * a11 + b22 * a21;
    out[8] = b20 * a02 + b21 * a12 + b22 * a22;
    return out;
  }
  function translate(out, a, v) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a10 = a[3], a11 = a[4], a12 = a[5], a20 = a[6], a21 = a[7], a22 = a[8], x = v[0], y = v[1];
    out[0] = a00;
    out[1] = a01;
    out[2] = a02;
    out[3] = a10;
    out[4] = a11;
    out[5] = a12;
    out[6] = x * a00 + y * a10 + a20;
    out[7] = x * a01 + y * a11 + a21;
    out[8] = x * a02 + y * a12 + a22;
    return out;
  }
  function rotate(out, a, rad) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a10 = a[3], a11 = a[4], a12 = a[5], a20 = a[6], a21 = a[7], a22 = a[8], s = Math.sin(rad), c = Math.cos(rad);
    out[0] = c * a00 + s * a10;
    out[1] = c * a01 + s * a11;
    out[2] = c * a02 + s * a12;
    out[3] = c * a10 - s * a00;
    out[4] = c * a11 - s * a01;
    out[5] = c * a12 - s * a02;
    out[6] = a20;
    out[7] = a21;
    out[8] = a22;
    return out;
  }
  function scale(out, a, v) {
    var x = v[0], y = v[1];
    out[0] = x * a[0];
    out[1] = x * a[1];
    out[2] = x * a[2];
    out[3] = y * a[3];
    out[4] = y * a[4];
    out[5] = y * a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    return out;
  }
  function fromTranslation(out, v) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 1;
    out[5] = 0;
    out[6] = v[0];
    out[7] = v[1];
    out[8] = 1;
    return out;
  }
  function fromRotation(out, rad) {
    var s = Math.sin(rad), c = Math.cos(rad);
    out[0] = c;
    out[1] = s;
    out[2] = 0;
    out[3] = -s;
    out[4] = c;
    out[5] = 0;
    out[6] = 0;
    out[7] = 0;
    out[8] = 1;
    return out;
  }
  function fromScaling(out, v) {
    out[0] = v[0];
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = v[1];
    out[5] = 0;
    out[6] = 0;
    out[7] = 0;
    out[8] = 1;
    return out;
  }
  function fromMat2d(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = 0;
    out[3] = a[2];
    out[4] = a[3];
    out[5] = 0;
    out[6] = a[4];
    out[7] = a[5];
    out[8] = 1;
    return out;
  }
  function fromQuat(out, q) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var x2 = x + x;
    var y2 = y + y;
    var z2 = z + z;
    var xx = x * x2;
    var yx = y * x2;
    var yy = y * y2;
    var zx = z * x2;
    var zy = z * y2;
    var zz = z * z2;
    var wx = w * x2;
    var wy = w * y2;
    var wz = w * z2;
    out[0] = 1 - yy - zz;
    out[3] = yx - wz;
    out[6] = zx + wy;
    out[1] = yx + wz;
    out[4] = 1 - xx - zz;
    out[7] = zy - wx;
    out[2] = zx - wy;
    out[5] = zy + wx;
    out[8] = 1 - xx - yy;
    return out;
  }
  function normalFromMat4(out, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    var b00 = a00 * a11 - a01 * a10;
    var b01 = a00 * a12 - a02 * a10;
    var b02 = a00 * a13 - a03 * a10;
    var b03 = a01 * a12 - a02 * a11;
    var b04 = a01 * a13 - a03 * a11;
    var b05 = a02 * a13 - a03 * a12;
    var b06 = a20 * a31 - a21 * a30;
    var b07 = a20 * a32 - a22 * a30;
    var b08 = a20 * a33 - a23 * a30;
    var b09 = a21 * a32 - a22 * a31;
    var b10 = a21 * a33 - a23 * a31;
    var b11 = a22 * a33 - a23 * a32;
    var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) {
      return null;
    }
    det = 1 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[2] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[3] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[4] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[5] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[6] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[7] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[8] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    return out;
  }
  function projection(out, width, height) {
    out[0] = 2 / width;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = -2 / height;
    out[5] = 0;
    out[6] = -1;
    out[7] = 1;
    out[8] = 1;
    return out;
  }
  function str(a) {
    return "mat3(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ", " + a[4] + ", " + a[5] + ", " + a[6] + ", " + a[7] + ", " + a[8] + ")";
  }
  function frob(a) {
    return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3] + a[4] * a[4] + a[5] * a[5] + a[6] * a[6] + a[7] * a[7] + a[8] * a[8]);
  }
  function add(out, a, b) {
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    out[2] = a[2] + b[2];
    out[3] = a[3] + b[3];
    out[4] = a[4] + b[4];
    out[5] = a[5] + b[5];
    out[6] = a[6] + b[6];
    out[7] = a[7] + b[7];
    out[8] = a[8] + b[8];
    return out;
  }
  function subtract(out, a, b) {
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    out[2] = a[2] - b[2];
    out[3] = a[3] - b[3];
    out[4] = a[4] - b[4];
    out[5] = a[5] - b[5];
    out[6] = a[6] - b[6];
    out[7] = a[7] - b[7];
    out[8] = a[8] - b[8];
    return out;
  }
  function multiplyScalar(out, a, b) {
    out[0] = a[0] * b;
    out[1] = a[1] * b;
    out[2] = a[2] * b;
    out[3] = a[3] * b;
    out[4] = a[4] * b;
    out[5] = a[5] * b;
    out[6] = a[6] * b;
    out[7] = a[7] * b;
    out[8] = a[8] * b;
    return out;
  }
  function multiplyScalarAndAdd(out, a, b, scale3) {
    out[0] = a[0] + b[0] * scale3;
    out[1] = a[1] + b[1] * scale3;
    out[2] = a[2] + b[2] * scale3;
    out[3] = a[3] + b[3] * scale3;
    out[4] = a[4] + b[4] * scale3;
    out[5] = a[5] + b[5] * scale3;
    out[6] = a[6] + b[6] * scale3;
    out[7] = a[7] + b[7] * scale3;
    out[8] = a[8] + b[8] * scale3;
    return out;
  }
  function exactEquals(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5] && a[6] === b[6] && a[7] === b[7] && a[8] === b[8];
  }
  function equals(a, b) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7], a8 = a[8];
    var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7], b8 = b[8];
    return Math.abs(a0 - b0) <= EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3)) && Math.abs(a4 - b4) <= EPSILON * Math.max(1, Math.abs(a4), Math.abs(b4)) && Math.abs(a5 - b5) <= EPSILON * Math.max(1, Math.abs(a5), Math.abs(b5)) && Math.abs(a6 - b6) <= EPSILON * Math.max(1, Math.abs(a6), Math.abs(b6)) && Math.abs(a7 - b7) <= EPSILON * Math.max(1, Math.abs(a7), Math.abs(b7)) && Math.abs(a8 - b8) <= EPSILON * Math.max(1, Math.abs(a8), Math.abs(b8));
  }
  var mul = multiply;
  var sub = subtract;

  // node_modules/.pnpm/gl-matrix@3.4.4/node_modules/gl-matrix/esm/vec2.js
  var vec2_exports = {};
  __export(vec2_exports, {
    add: () => add2,
    angle: () => angle,
    ceil: () => ceil,
    clone: () => clone2,
    copy: () => copy2,
    create: () => create2,
    cross: () => cross,
    dist: () => dist,
    distance: () => distance,
    div: () => div,
    divide: () => divide,
    dot: () => dot,
    equals: () => equals2,
    exactEquals: () => exactEquals2,
    floor: () => floor,
    forEach: () => forEach,
    fromValues: () => fromValues2,
    inverse: () => inverse,
    len: () => len,
    length: () => length,
    lerp: () => lerp,
    max: () => max,
    min: () => min,
    mul: () => mul2,
    multiply: () => multiply2,
    negate: () => negate,
    normalize: () => normalize,
    random: () => random,
    rotate: () => rotate2,
    round: () => round2,
    scale: () => scale2,
    scaleAndAdd: () => scaleAndAdd,
    set: () => set2,
    signedAngle: () => signedAngle,
    sqrDist: () => sqrDist,
    sqrLen: () => sqrLen,
    squaredDistance: () => squaredDistance,
    squaredLength: () => squaredLength,
    str: () => str2,
    sub: () => sub2,
    subtract: () => subtract2,
    transformMat2: () => transformMat2,
    transformMat2d: () => transformMat2d,
    transformMat3: () => transformMat3,
    transformMat4: () => transformMat4,
    zero: () => zero
  });
  function create2() {
    var out = new ARRAY_TYPE(2);
    if (ARRAY_TYPE != Float32Array) {
      out[0] = 0;
      out[1] = 0;
    }
    return out;
  }
  function clone2(a) {
    var out = new ARRAY_TYPE(2);
    out[0] = a[0];
    out[1] = a[1];
    return out;
  }
  function fromValues2(x, y) {
    var out = new ARRAY_TYPE(2);
    out[0] = x;
    out[1] = y;
    return out;
  }
  function copy2(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    return out;
  }
  function set2(out, x, y) {
    out[0] = x;
    out[1] = y;
    return out;
  }
  function add2(out, a, b) {
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    return out;
  }
  function subtract2(out, a, b) {
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    return out;
  }
  function multiply2(out, a, b) {
    out[0] = a[0] * b[0];
    out[1] = a[1] * b[1];
    return out;
  }
  function divide(out, a, b) {
    out[0] = a[0] / b[0];
    out[1] = a[1] / b[1];
    return out;
  }
  function ceil(out, a) {
    out[0] = Math.ceil(a[0]);
    out[1] = Math.ceil(a[1]);
    return out;
  }
  function floor(out, a) {
    out[0] = Math.floor(a[0]);
    out[1] = Math.floor(a[1]);
    return out;
  }
  function min(out, a, b) {
    out[0] = Math.min(a[0], b[0]);
    out[1] = Math.min(a[1], b[1]);
    return out;
  }
  function max(out, a, b) {
    out[0] = Math.max(a[0], b[0]);
    out[1] = Math.max(a[1], b[1]);
    return out;
  }
  function round2(out, a) {
    out[0] = round(a[0]);
    out[1] = round(a[1]);
    return out;
  }
  function scale2(out, a, b) {
    out[0] = a[0] * b;
    out[1] = a[1] * b;
    return out;
  }
  function scaleAndAdd(out, a, b, scale3) {
    out[0] = a[0] + b[0] * scale3;
    out[1] = a[1] + b[1] * scale3;
    return out;
  }
  function distance(a, b) {
    var x = b[0] - a[0], y = b[1] - a[1];
    return Math.sqrt(x * x + y * y);
  }
  function squaredDistance(a, b) {
    var x = b[0] - a[0], y = b[1] - a[1];
    return x * x + y * y;
  }
  function length(a) {
    var x = a[0], y = a[1];
    return Math.sqrt(x * x + y * y);
  }
  function squaredLength(a) {
    var x = a[0], y = a[1];
    return x * x + y * y;
  }
  function negate(out, a) {
    out[0] = -a[0];
    out[1] = -a[1];
    return out;
  }
  function inverse(out, a) {
    out[0] = 1 / a[0];
    out[1] = 1 / a[1];
    return out;
  }
  function normalize(out, a) {
    var x = a[0], y = a[1];
    var len2 = x * x + y * y;
    if (len2 > 0) {
      len2 = 1 / Math.sqrt(len2);
    }
    out[0] = a[0] * len2;
    out[1] = a[1] * len2;
    return out;
  }
  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1];
  }
  function cross(out, a, b) {
    var z = a[0] * b[1] - a[1] * b[0];
    out[0] = out[1] = 0;
    out[2] = z;
    return out;
  }
  function lerp(out, a, b, t) {
    var ax = a[0], ay = a[1];
    out[0] = ax + t * (b[0] - ax);
    out[1] = ay + t * (b[1] - ay);
    return out;
  }
  function random(out, scale3) {
    scale3 = scale3 === void 0 ? 1 : scale3;
    var r = RANDOM() * 2 * Math.PI;
    out[0] = Math.cos(r) * scale3;
    out[1] = Math.sin(r) * scale3;
    return out;
  }
  function transformMat2(out, a, m) {
    var x = a[0], y = a[1];
    out[0] = m[0] * x + m[2] * y;
    out[1] = m[1] * x + m[3] * y;
    return out;
  }
  function transformMat2d(out, a, m) {
    var x = a[0], y = a[1];
    out[0] = m[0] * x + m[2] * y + m[4];
    out[1] = m[1] * x + m[3] * y + m[5];
    return out;
  }
  function transformMat3(out, a, m) {
    var x = a[0], y = a[1];
    out[0] = m[0] * x + m[3] * y + m[6];
    out[1] = m[1] * x + m[4] * y + m[7];
    return out;
  }
  function transformMat4(out, a, m) {
    var x = a[0];
    var y = a[1];
    out[0] = m[0] * x + m[4] * y + m[12];
    out[1] = m[1] * x + m[5] * y + m[13];
    return out;
  }
  function rotate2(out, a, b, rad) {
    var p0 = a[0] - b[0], p1 = a[1] - b[1], sinC = Math.sin(rad), cosC = Math.cos(rad);
    out[0] = p0 * cosC - p1 * sinC + b[0];
    out[1] = p0 * sinC + p1 * cosC + b[1];
    return out;
  }
  function angle(a, b) {
    var ax = a[0], ay = a[1], bx = b[0], by = b[1];
    return Math.abs(Math.atan2(ay * bx - ax * by, ax * bx + ay * by));
  }
  function signedAngle(a, b) {
    var ax = a[0], ay = a[1], bx = b[0], by = b[1];
    return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  }
  function zero(out) {
    out[0] = 0;
    out[1] = 0;
    return out;
  }
  function str2(a) {
    return "vec2(" + a[0] + ", " + a[1] + ")";
  }
  function exactEquals2(a, b) {
    return a[0] === b[0] && a[1] === b[1];
  }
  function equals2(a, b) {
    var a0 = a[0], a1 = a[1];
    var b0 = b[0], b1 = b[1];
    return Math.abs(a0 - b0) <= EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1));
  }
  var len = length;
  var sub2 = subtract2;
  var mul2 = multiply2;
  var div = divide;
  var dist = distance;
  var sqrDist = squaredDistance;
  var sqrLen = squaredLength;
  var forEach = (function() {
    var vec = create2();
    return function(a, stride, offset, count, fn, arg) {
      var i, l;
      if (!stride) {
        stride = 2;
      }
      if (!offset) {
        offset = 0;
      }
      if (count) {
        l = Math.min(count * stride + offset, a.length);
      } else {
        l = a.length;
      }
      for (i = offset; i < l; i += stride) {
        vec[0] = a[i];
        vec[1] = a[i + 1];
        fn(vec, vec, arg);
        a[i] = vec[0];
        a[i + 1] = vec[1];
      }
      return a;
    };
  })();

  // packages/render-engine/src/math/mat3.ts
  function createMat3() {
    return mat3_exports.create();
  }
  function multiplyMat3(out, a, b) {
    return mat3_exports.multiply(out, a, b);
  }

  // packages/render-engine/src/skeleton/parent-from-bone.ts
  function writeParentFromBone(out, btx, bty, br, ptx, pty, pr) {
    const cb = Math.cos(br);
    const sb = Math.sin(br);
    const rot = br + pr;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    out[0] = c;
    out[1] = s;
    out[2] = 0;
    out[3] = -s;
    out[4] = c;
    out[5] = 0;
    out[6] = btx + cb * ptx - sb * pty;
    out[7] = bty + sb * ptx + cb * pty;
    out[8] = 1;
    return out;
  }
  function setBindParentFromBone(out, skeleton, bone) {
    const i2 = bone * 2;
    return writeParentFromBone(
      out,
      skeleton.bindTranslation[i2],
      skeleton.bindTranslation[i2 + 1],
      skeleton.bindRotation[bone],
      0,
      0,
      0
    );
  }

  // packages/render-engine/src/mesh/texture.ts
  var TEXTURE_EDGE = 4;
  function createTriangleTexture(fill, triangle) {
    const baseR = byteChannel(fill.r);
    const baseG = byteChannel(fill.g);
    const baseB = byteChannel(fill.b);
    const rgb = new Uint8Array(TEXTURE_EDGE * TEXTURE_EDGE * 3);
    for (let sy = 0; sy < TEXTURE_EDGE; sy += 1) {
      for (let sx = 0; sx < TEXTURE_EDGE; sx += 1) {
        const index = (sy * TEXTURE_EDGE + sx) * 3;
        if (sx === 0 && sy === 0) {
          rgb[index] = baseR;
          rgb[index + 1] = baseG;
          rgb[index + 2] = baseB;
          continue;
        }
        rgb[index] = mod256(baseR + (triangle + 1) * (sx + sy));
        rgb[index + 1] = baseG;
        rgb[index + 2] = mod256(baseB + sx * 13 + sy);
      }
    }
    return { width: TEXTURE_EDGE, height: TEXTURE_EDGE, rgb };
  }
  function createMeshTextures(indices, fill) {
    if (indices.length < 3 || indices.length % 3 !== 0) throw new Error("mesh");
    const triangleCount = indices.length / 3;
    const textures = [];
    const triangleTexture = new Uint16Array(triangleCount);
    const uvs = new Float32Array(indices.length * 2);
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      textures.push(createTriangleTexture(fill, triangle));
      triangleTexture[triangle] = triangle;
      const corner = triangle * 6;
      uvs[corner + 2] = 2;
      uvs[corner + 5] = 2;
    }
    return { textures, triangleTexture, uvs };
  }
  function validateMeshTextures(indices, textures, triangleTexture, uvs) {
    if (indices.length < 3 || indices.length % 3 !== 0 || triangleTexture.length !== indices.length / 3) {
      throw new Error("texture");
    }
    for (let i = 0; i < triangleTexture.length; i += 1) {
      if (triangleTexture[i] >= textures.length) throw new Error("texture");
    }
    if (uvs.length !== indices.length * 2) throw new Error("uv");
    for (let i = 0; i < uvs.length; i += 1) {
      if (!Number.isFinite(uvs[i])) throw new Error("uv");
    }
    for (let i = 0; i < textures.length; i += 1) {
      const image = textures[i];
      if (!Number.isInteger(image.width) || image.width < 1) throw new Error("image");
      if (!Number.isInteger(image.height) || image.height < 1) throw new Error("image");
      if (image.rgb.length !== image.width * image.height * 3) throw new Error("image");
      for (let byte = 0; byte < image.rgb.length; byte += 1) {
        const value = image.rgb[byte];
        if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error("image");
      }
    }
  }
  function byteChannel(channel) {
    if (!Number.isFinite(channel) || channel < 0 || channel > 1) throw new Error("fill");
    const rounded = Math.round(channel * 255);
    if (rounded < 0) return 0;
    if (rounded > 255) return 255;
    return rounded;
  }
  function mod256(value) {
    return (value % 256 + 256) % 256;
  }

  // packages/render-engine/src/mesh/strip.ts
  var TUBE_SIDES = 16;
  var AXIAL_STEPS = 8;

  // packages/render-engine/src/mesh/humanoid.ts
  function createHumanoidMeshes(humanoid2, parts) {
    if (parts.skeleton !== humanoid2.skeleton) throw new Error("skeleton");
    const rig = writeBindRig(humanoid2.skeleton);
    const lateral = writeBindLateral(humanoid2.skeleton);
    const meshes = [];
    for (let i = 0; i < parts.parts.length; i += 1) {
      const part = parts.parts[i];
      if (part.kind === "skinned") {
        meshes.push(skinnedMesh(part, humanoid2.skeleton, humanoid2.proportions, rig, lateral));
      } else {
        meshes.push(rigidMesh(part.id, part.bone, humanoid2.skeleton, humanoid2.proportions, part.fill));
      }
    }
    return { meshes };
  }
  function draft(skinned) {
    return { positions: [], indices: [], seam: [], endShare: [], skinned };
  }
  function skinnedMesh(part, skeleton, proportions, rig, lateral) {
    if (part.id === "torso") return torsoMesh(part, skeleton, proportions, rig, lateral);
    if (part.id === "armL" || part.id === "armR") return armMesh(part, skeleton, proportions, rig, lateral);
    if (part.id === "legL" || part.id === "legR") return legMesh(part, skeleton, proportions, rig, lateral);
    throw new Error("part");
  }
  function torsoMesh(part, skeleton, proportions, rig, lateral) {
    const d = draft(true);
    const spine = frameOf(rig, lateral, skeleton, findBone(skeleton, "spine"));
    const chest = frameOf(rig, lateral, skeleton, findBone(skeleton, "chest"));
    const neck = frameOf(rig, lateral, skeleton, findBone(skeleton, "neck"));
    const tS = 1 - proportions.shoulderDropY / proportions.chestLength;
    const chestTs = chestStations(tS);
    const spineRings = [];
    for (let k = 0; k <= AXIAL_STEPS; k += 1) {
      const t = k / AXIAL_STEPS;
      const ring = addRing(d, ringPoints(spine, t, radiusAt(proportions.spineProfile, t)));
      setShare(d, ring, Math.max(0, 1 - 2 * t), 0);
      spineRings.push(ring);
    }
    markSeam(d, spineRings[0]);
    link(d.indices, spineRings);
    const chestRings = [spineRings[spineRings.length - 1]];
    for (let i = 1; i < chestTs.length; i += 1) {
      const t = chestTs[i];
      const ring = addRing(d, ringPoints(chest, t, radiusAt(proportions.chestProfile, t)));
      setShare(d, ring, 0, 0);
      chestRings.push(ring);
    }
    const holeLo = 3;
    const holeHi = 9;
    linkExcept(d.indices, chestRings, (interval, j) => {
      if (interval < holeLo || interval >= holeHi) return false;
      return j === 3 || j === 4 || j === 11 || j === 12;
    });
    const neckRings = [chestRings[chestRings.length - 1]];
    for (let k = 1; k <= AXIAL_STEPS; k += 1) {
      const t = k / AXIAL_STEPS;
      const ring = addRing(d, ringPoints(neck, t, radiusAt(proportions.neckProfile, t)));
      const headShare = t >= 0.5 ? 2 * t - 1 : 0;
      setShare(d, ring, 0, headShare);
      neckRings.push(ring);
    }
    markSeam(d, neckRings[neckRings.length - 1]);
    link(d.indices, neckRings);
    for (const side of [1, -1]) {
      const rim = shoulderRimIndices(chestRings, holeLo, holeHi, side);
      for (const vertex of rim) d.seam[vertex] = 1;
    }
    return finish(part.id, "character", d, part.fill);
  }
  function armMesh(part, skeleton, proportions, rig, lateral) {
    const d = draft(true);
    const side = part.id === "armL" ? 1 : -1;
    const chest = frameOf(rig, lateral, skeleton, findBone(skeleton, "chest"));
    const upper = frameOf(rig, lateral, skeleton, findBone(skeleton, `upperArm${side > 0 ? "L" : "R"}`));
    const lower = frameOf(rig, lateral, skeleton, findBone(skeleton, `lowerArm${side > 0 ? "L" : "R"}`));
    const tS = 1 - proportions.shoulderDropY / proportions.chestLength;
    const chestTs = chestStations(tS);
    const chestRingsPoints = chestTs.map((t) => ringPoints(chest, t, radiusAt(proportions.chestProfile, t)));
    const rim = shoulderRimPoints(chestRingsPoints, 3, 9, side);
    const end = ringPoints(upper, 6 / 8, radiusAt(proportions.upperArmProfile, 6 / 8));
    const collar = addCollar(d, rim, end, upper, proportions.upperArmProfile, 0, true);
    markSeam(d, collar[0]);
    link(d.indices, collar);
    const upperTail = addProfile(
      d,
      upper,
      proportions.upperArmProfile,
      [6 / 8, 7 / 8, 1],
      collar[collar.length - 1]
    );
    link(d.indices, upperTail);
    const forearm = addProfile(
      d,
      lower,
      proportions.lowerArmProfile,
      [0, 1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8],
      upperTail[upperTail.length - 1]
    );
    link(d.indices, forearm);
    const wristTo = ringPoints(lower, 1, proportions.palmRadius);
    const wristRings = addCollar(
      d,
      ringPoints(lower, 5 / 8, radiusAt(proportions.lowerArmProfile, 5 / 8)),
      wristTo,
      lower,
      null,
      1,
      false,
      forearm[forearm.length - 1]
    );
    markSeam(d, wristRings[wristRings.length - 1]);
    link(d.indices, wristRings);
    return finish(part.id, "character", d, part.fill);
  }
  function legMesh(part, skeleton, proportions, rig, lateral) {
    const d = draft(true);
    const side = part.id === "legL" ? 1 : -1;
    const spine = frameOf(rig, lateral, skeleton, findBone(skeleton, "spine"));
    const thigh = frameOf(rig, lateral, skeleton, findBone(skeleton, `thigh${side > 0 ? "L" : "R"}`));
    const shin = frameOf(rig, lateral, skeleton, findBone(skeleton, `shin${side > 0 ? "L" : "R"}`));
    const foot = frameOf(rig, lateral, skeleton, findBone(skeleton, `foot${side > 0 ? "L" : "R"}`));
    const rim = hipRimPoints(spine, proportions, side);
    const end = ringPoints(thigh, 6 / 8, radiusAt(proportions.thighProfile, 6 / 8));
    const collar = addCollar(d, rim, end, thigh, proportions.thighProfile, 0, true);
    markSeam(d, collar[0]);
    link(d.indices, collar);
    const thighTail = addProfile(
      d,
      thigh,
      proportions.thighProfile,
      [6 / 8, 7 / 8, 1],
      collar[collar.length - 1]
    );
    link(d.indices, thighTail);
    const shinRings = addProfile(
      d,
      shin,
      proportions.shinProfile,
      [0, 1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8],
      thighTail[thighTail.length - 1]
    );
    link(d.indices, shinRings);
    const ankleRim = footHoleRimPoints(proportions).map((point) => transformPartPoint(foot, point));
    const ankleRings = addCollar(
      d,
      ringPoints(shin, 5 / 8, radiusAt(proportions.shinProfile, 5 / 8)),
      ankleRim,
      shin,
      null,
      1,
      false,
      shinRings[shinRings.length - 1]
    );
    markSeam(d, ankleRings[ankleRings.length - 1]);
    link(d.indices, ankleRings);
    return finish(part.id, "character", d, part.fill);
  }
  function rigidMesh(partId, bone, skeleton, proportions, fill) {
    const length2 = bindLength(skeleton, bone);
    const name = boneName(skeleton, bone);
    if (name === "head") return headMesh(partId, length2, proportions, fill);
    if (name === "handL" || name === "handR") {
      return handMesh(partId, name === "handL" ? 1 : -1, length2, proportions, fill);
    }
    if (name === "footL" || name === "footR") return footMesh(partId, proportions, fill);
    throw new Error("part");
  }
  function headMesh(partId, length2, proportions, fill) {
    const d = draft(false);
    const frame = { ox: 0, oy: 0, oz: 0, ax: 1, ay: 0, px: 0, py: 1, length: length2 };
    const rings = addProfile(d, frame, proportions.headProfile, uniformStations(), null);
    markSeam(d, rings[0]);
    link(d.indices, rings);
    addCap(d, rings[rings.length - 1], true);
    return finish(partId, "part", d, fill);
  }
  function handMesh(partId, side, length2, proportions, fill) {
    const d = draft(false);
    const palmEnd = proportions.palmFraction * length2;
    const palm = tubeAlongX(d, 0, 0, 0, palmEnd, 0, 0, proportions.palmRadius);
    markSeam(d, palm[0]);
    const thumbX = proportions.thumbAlong * length2;
    const thumbY = -proportions.thumbDrop;
    const thumbZ = side * proportions.thumbOffsetZ;
    const hole = thumbHole(palmEnd, thumbX, thumbY, thumbZ);
    linkExcept(d.indices, palm, (interval, j) => interval === hole.interval && hole.omitted.has(j));
    const fingers = [];
    for (const spread of [
      -proportions.fingerSpread[1],
      -proportions.fingerSpread[0],
      proportions.fingerSpread[0],
      proportions.fingerSpread[1]
    ]) {
      const root = tubeAlongX(d, palmEnd, 0, spread, length2, 0, spread, proportions.fingerRadius);
      link(d.indices, root);
      addCap(d, root[root.length - 1], true);
      const ring = root[0];
      for (let j = 0; j < TUBE_SIDES; j += 1) pullInsidePalm(d.positions, ring + j, proportions.palmRadius);
      fingers.push(ring);
    }
    const thumb = tubeAlongX(
      d,
      thumbX,
      thumbY,
      thumbZ,
      thumbX + proportions.thumbFraction * length2,
      thumbY,
      thumbZ,
      proportions.thumbRadius
    );
    link(d.indices, thumb);
    addCap(d, thumb[thumb.length - 1], true);
    weldPalmEnd(d.indices, d.positions, palm[palm.length - 1], fingers);
    weldThumb(d.indices, d.positions, palm, hole, thumb[0]);
    return finish(partId, "part", d, fill);
  }
  function footMesh(partId, proportions, fill) {
    const d = draft(false);
    const x0 = -proportions.heelBack;
    const x1 = proportions.footLength;
    const rings = [];
    for (let k = 0; k <= AXIAL_STEPS; k += 1) {
      const t = k / AXIAL_STEPS;
      rings.push(addRing(d, footSection(proportions, t, x0, x1)));
    }
    linkExcept(d.indices, rings, (interval, j) => interval >= 1 && interval < 3 && j >= 1 && j <= 6);
    for (const vertex of footHoleRimIndices(rings)) d.seam[vertex] = 1;
    addCap(d, rings[0], false);
    addCap(d, rings[rings.length - 1], true);
    return finish(partId, "part", d, fill);
  }
  function chestStations(tS) {
    const ts = [0, 1 / 8, 2 / 8, 3 / 8];
    for (let i = 1; i <= 6; i += 1) ts.push(3 / 8 + i * (tS - 3 / 8) / 6);
    ts.push(1);
    return ts;
  }
  function shoulderRimPoints(chestRings, holeLo, holeHi, side) {
    const jf = side > 0 ? 5 : 11;
    const jc = side > 0 ? 4 : 12;
    const jb = side > 0 ? 3 : 13;
    const left = new Array(TUBE_SIDES);
    left[4] = chestRings[holeHi][jc];
    left[3] = chestRings[holeHi][jf];
    left[5] = chestRings[holeHi][jb];
    left[12] = chestRings[holeLo][jc];
    left[13] = chestRings[holeLo][jf];
    left[11] = chestRings[holeLo][jb];
    const frontK = [14, 15, 0, 1, 2];
    const backK = [10, 9, 8, 7, 6];
    for (let m = 0; m < 5; m += 1) {
      left[frontK[m]] = chestRings[holeLo + 1 + m][jf];
      left[backK[m]] = chestRings[holeLo + 1 + m][jb];
    }
    if (side > 0) return left;
    return Array.from({ length: TUBE_SIDES }, (_, k) => left[(TUBE_SIDES - k) % TUBE_SIDES]);
  }
  function shoulderRimIndices(chestRings, holeLo, holeHi, side) {
    const jf = side > 0 ? 5 : 11;
    const jc = side > 0 ? 4 : 12;
    const jb = side > 0 ? 3 : 13;
    const left = new Array(TUBE_SIDES);
    left[4] = chestRings[holeHi] + jc;
    left[3] = chestRings[holeHi] + jf;
    left[5] = chestRings[holeHi] + jb;
    left[12] = chestRings[holeLo] + jc;
    left[13] = chestRings[holeLo] + jf;
    left[11] = chestRings[holeLo] + jb;
    const frontK = [14, 15, 0, 1, 2];
    const backK = [10, 9, 8, 7, 6];
    for (let m = 0; m < 5; m += 1) {
      left[frontK[m]] = chestRings[holeLo + 1 + m] + jf;
      left[backK[m]] = chestRings[holeLo + 1 + m] + jb;
    }
    if (side > 0) return left;
    return Array.from({ length: TUBE_SIDES }, (_, k) => left[(TUBE_SIDES - k) % TUBE_SIDES]);
  }
  function hipRimPoints(spine, proportions, side) {
    const r0 = radiusAt(proportions.spineProfile, 0);
    const drop = proportions.thighLength / 8;
    const crotch = (m) => {
      const beta = m * Math.PI / 8;
      return { x: -r0 * Math.cos(beta), y: spine.oy - drop * Math.sin(beta), z: 0 };
    };
    const rim = [];
    if (side > 0) {
      for (let k = 0; k <= 8; k += 1) rim.push(sample(spine, 0, r0, 8 - k));
      for (let m = 1; m <= 7; m += 1) rim.push(crotch(m));
    } else {
      rim.push(sample(spine, 0, r0, 8));
      for (let m = 7; m >= 1; m -= 1) rim.push(crotch(m));
      rim.push(sample(spine, 0, r0, 0));
      for (let j = 15; j >= 9; j -= 1) rim.push(sample(spine, 0, r0, j));
    }
    return rim;
  }
  function footHoleRimPoints(proportions) {
    const x0 = -proportions.heelBack;
    const x1 = proportions.footLength;
    const at = (s, j) => footSection(proportions, s, x0, x1)[j];
    return [
      at(3 / 8, 4),
      at(3 / 8, 5),
      at(3 / 8, 6),
      at(3 / 8, 7),
      at(2 / 8, 7),
      at(1 / 8, 7),
      at(1 / 8, 6),
      at(1 / 8, 5),
      at(1 / 8, 4),
      at(1 / 8, 3),
      at(1 / 8, 2),
      at(1 / 8, 1),
      at(2 / 8, 1),
      at(3 / 8, 1),
      at(3 / 8, 2),
      at(3 / 8, 3)
    ];
  }
  function footHoleRimIndices(rings) {
    const at = (s, j) => rings[s] + j;
    return [
      at(3, 4),
      at(3, 5),
      at(3, 6),
      at(3, 7),
      at(2, 7),
      at(1, 7),
      at(1, 6),
      at(1, 5),
      at(1, 4),
      at(1, 3),
      at(1, 2),
      at(1, 1),
      at(2, 1),
      at(3, 1),
      at(3, 2),
      at(3, 3)
    ];
  }
  function addCollar(d, from, to, frame, profile2, chainEnd, writeFirst, reuseFirst = null) {
    const rings = [];
    for (let i = 0; i <= AXIAL_STEPS; i += 1) {
      const s = i / AXIAL_STEPS;
      const share = chainEnd === 0 ? 1 - s : s;
      if (i === 0 && !writeFirst) {
        const ring2 = reuseFirst;
        if (chainEnd === 0) setShare(d, ring2, share, 0);
        else setShare(d, ring2, 0, share);
        rings.push(ring2);
        continue;
      }
      const points = [];
      for (let k = 0; k < TUBE_SIDES; k += 1) {
        const a = from[k];
        const b = to[k];
        const tk = clamp01(dotAxis(a, frame) / (frame.length * frame.length));
        const wall = profile2 === null ? b : sample(frame, tk, radiusAt(profile2, tk), k);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
        const c = {
          x: 0.5 * mid.x + 0.5 * wall.x,
          y: 0.5 * mid.y + 0.5 * wall.y,
          z: 0.5 * mid.z + 0.5 * wall.z
        };
        const u = 1 - s;
        points.push({
          x: u * u * a.x + 2 * u * s * c.x + s * s * b.x,
          y: u * u * a.y + 2 * u * s * c.y + s * s * b.y,
          z: u * u * a.z + 2 * u * s * c.z + s * s * b.z
        });
      }
      const ring = addRing(d, points);
      if (chainEnd === 0) setShare(d, ring, share, 0);
      else setShare(d, ring, 0, share);
      rings.push(ring);
    }
    return rings;
  }
  function addProfile(d, frame, profile2, ts, reuseFirst) {
    const rings = [];
    for (let i = 0; i < ts.length; i += 1) {
      if (i === 0 && reuseFirst !== null) {
        rings.push(reuseFirst);
        continue;
      }
      const ring = addRing(d, ringPoints(frame, ts[i], radiusAt(profile2, ts[i])));
      setShare(d, ring, 0, 0);
      rings.push(ring);
    }
    return rings;
  }
  function addRing(d, points) {
    const start = d.positions.length / 3;
    for (const point of points) {
      d.positions.push(point.x, point.y, point.z);
      d.seam.push(0);
      if (d.skinned) d.endShare.push(0, 0);
    }
    return start;
  }
  function setShare(d, ring, head, tail) {
    if (!d.skinned) return;
    for (let j = 0; j < TUBE_SIDES; j += 1) {
      const base = (ring + j) * 2;
      d.endShare[base] = head;
      d.endShare[base + 1] = tail;
    }
  }
  function markSeam(d, ring) {
    for (let j = 0; j < TUBE_SIDES; j += 1) d.seam[ring + j] = 1;
  }
  function link(indices, rings) {
    linkExcept(indices, rings, () => false);
  }
  function linkExcept(indices, rings, skip) {
    for (let i = 0; i < rings.length - 1; i += 1) {
      const near2 = rings[i];
      const far = rings[i + 1];
      if (near2 < 0 || far < 0) continue;
      for (let j = 0; j < TUBE_SIDES; j += 1) {
        if (skip(i, j)) continue;
        const next = (j + 1) % TUBE_SIDES;
        indices.push(near2 + j, near2 + next, far + j, near2 + next, far + next, far + j);
      }
    }
  }
  function addCap(d, ring, reverse) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let j = 0; j < TUBE_SIDES; j += 1) {
      const base = (ring + j) * 3;
      x += d.positions[base];
      y += d.positions[base + 1];
      z += d.positions[base + 2];
    }
    const center = d.positions.length / 3;
    d.positions.push(x / TUBE_SIDES, y / TUBE_SIDES, z / TUBE_SIDES);
    d.seam.push(0);
    for (let j = 0; j < TUBE_SIDES; j += 1) {
      const next = (j + 1) % TUBE_SIDES;
      if (reverse) d.indices.push(center, ring + j, ring + next);
      else d.indices.push(center, ring + next, ring + j);
    }
  }
  function finish(partId, space, d, fill) {
    const positions = Float32Array.from(d.positions);
    const indices = Uint16Array.from(d.indices);
    const vertexCount = positions.length / 3;
    const seam2 = new Uint8Array(vertexCount);
    for (let i = 0; i < d.seam.length; i += 1) seam2[i] = d.seam[i];
    const endShare = d.skinned ? Float32Array.from(d.endShare) : new Float32Array(0);
    return {
      partId,
      space,
      positions,
      indices,
      ...createMeshTextures(indices, fill),
      seam: seam2,
      endShare
    };
  }
  function footSection(proportions, t, x0, x1) {
    const x = x0 + (x1 - x0) * t;
    const points = [];
    for (let j = 0; j < TUBE_SIDES; j += 1) {
      const theta = j * 2 * Math.PI / TUBE_SIDES;
      const lifted = Math.max(0, (Math.sin(theta) + 1) / 2);
      points.push({
        x,
        y: -proportions.ankleHeight + radiusAt(proportions.footInstep, t) * lifted,
        z: -radiusAt(proportions.footHalfWidth, t) * Math.cos(theta)
      });
    }
    return points;
  }
  function transformPartPoint(frame, point) {
    return {
      x: frame.ox + frame.ax * point.x + frame.px * point.y,
      y: frame.oy + frame.ay * point.x + frame.py * point.y,
      z: frame.oz + point.z
    };
  }
  function thumbHole(palmEnd, thumbX, thumbY, thumbZ) {
    const along = Math.min(AXIAL_STEPS - 1, Math.max(0, Math.floor(thumbX / palmEnd * AXIAL_STEPS)));
    let theta = Math.atan2(thumbZ, thumbY);
    if (theta < 0) theta += Math.PI * 2;
    const count = 4;
    const j0 = Math.round(theta / (Math.PI * 2) * TUBE_SIDES) - count / 2;
    const omitted = /* @__PURE__ */ new Set();
    for (let s = 0; s < count; s += 1) omitted.add(mod(j0 + s));
    return { interval: along, omitted, j0, count };
  }
  function pullInsidePalm(positions, vertex, radius) {
    const y = positions[vertex * 3 + 1];
    const z = positions[vertex * 3 + 2];
    const reach = Math.hypot(y, z);
    const limit = radius * 0.98;
    if (reach <= limit) return;
    const scale3 = limit / reach;
    positions[vertex * 3 + 1] = y * scale3;
    positions[vertex * 3 + 2] = z * scale3;
  }
  function weldPalmEnd(indices, positions, palm, fingers) {
    const poly = [];
    for (let j = 0; j < TUBE_SIDES; j += 1) poly.push(palm + j);
    for (const finger of fingers) {
      const hole = [finger];
      for (let j = TUBE_SIDES - 1; j >= 1; j -= 1) hole.push(finger + j);
      spliceHole(poly, hole, positions);
    }
    earClip(indices, poly, positions);
  }
  function weldThumb(indices, positions, palm, hole, thumb) {
    const near2 = palm[hole.interval];
    const far = palm[hole.interval + 1];
    const boundary2 = [];
    for (let s = 0; s <= hole.count; s += 1) boundary2.push(near2 + mod(hole.j0 + s));
    for (let s = 0; s <= hole.count; s += 1) boundary2.push(far + mod(hole.j0 + hole.count - s));
    const ring = [thumb];
    for (let j = TUBE_SIDES - 1; j >= 1; j -= 1) ring.push(thumb + j);
    zip(indices, positions, boundary2, ring);
  }
  function spliceHole(poly, hole, positions) {
    let best = Number.POSITIVE_INFINITY;
    let holeAt = 0;
    let polyAt = 0;
    for (let h = 0; h < hole.length; h += 1) {
      for (let p = 0; p < poly.length; p += 1) {
        const gap = vertexGap(positions, hole[h], poly[p]);
        if (gap >= best || !bridgeFree(poly, hole, hole[h], poly[p], positions)) continue;
        best = gap;
        holeAt = h;
        polyAt = p;
      }
    }
    if (!Number.isFinite(best)) throw new Error("weld");
    const rotated = hole.slice(holeAt).concat(hole.slice(0, holeAt));
    poly.splice(polyAt + 1, 0, ...rotated, rotated[0], poly[polyAt]);
  }
  function bridgeFree(poly, hole, from, to, positions) {
    if (hitsLoop(from, to, poly, positions) || hitsLoop(from, to, hole, positions)) return false;
    const y = (positions[from * 3 + 1] + positions[to * 3 + 1]) / 2;
    const z = (positions[from * 3 + 2] + positions[to * 3 + 2]) / 2;
    return contains(poly, y, z, positions);
  }
  function earClip(indices, poly, positions) {
    const loop = poly.slice();
    let guard = loop.length * loop.length;
    while (loop.length > 3) {
      let clipped = false;
      for (let i = 0; i < loop.length; i += 1) {
        const prev = loop[(i + loop.length - 1) % loop.length];
        const curr = loop[i];
        const next = loop[(i + 1) % loop.length];
        if (orient(positions, prev, curr, next) <= 1e-10) continue;
        if (loop.some((other, index) => {
          if (index === i || other === prev || other === curr || other === next) return false;
          return insideTri(positions, other, prev, curr, next);
        })) {
          continue;
        }
        indices.push(prev, curr, next);
        loop.splice(i, 1);
        clipped = true;
        break;
      }
      guard -= 1;
      if (!clipped || guard < 0) throw new Error("weld");
    }
    indices.push(loop[0], loop[1], loop[2]);
  }
  function zip(indices, positions, left, right) {
    const a = spin(left, nearest(left, right[0], positions));
    const b = spin(right, nearest(right, a[0], positions));
    const n = a.length;
    const m = b.length;
    const used = /* @__PURE__ */ new Set();
    const chosen = [];
    const free = (p, q, r) => !used.has(`${p}:${q}`) && !used.has(`${q}:${r}`) && !used.has(`${r}:${p}`);
    const take = (p, q, r) => {
      used.add(`${p}:${q}`);
      used.add(`${q}:${r}`);
      used.add(`${r}:${p}`);
      chosen.push(p, q, r);
    };
    const drop = (p, q, r) => {
      used.delete(`${p}:${q}`);
      used.delete(`${q}:${r}`);
      used.delete(`${r}:${p}`);
      chosen.length -= 3;
    };
    const search = (i, j) => {
      if (i === n && j === m) return true;
      const hole = i < n ? [a[i], a[(i + 1) % n], b[j === m ? 0 : (j + 1) % m]] : null;
      const thumb = j < m ? [a[i === n ? 0 : (i + 1) % n], b[j], b[(j + 1) % m]] : null;
      const options = [hole, thumb];
      for (let k = 0; k < options.length; k += 1) {
        const tri = options[k];
        if (tri === null || tri === void 0 || !free(tri[0], tri[1], tri[2])) continue;
        const p = tri[0];
        const q = tri[1];
        const r = tri[2];
        take(p, q, r);
        if (search(i + (k === 0 ? 1 : 0), j + (k === 1 ? 1 : 0))) return true;
        drop(p, q, r);
      }
      return false;
    };
    if (!search(0, 0)) throw new Error("weld");
    for (const index of chosen) indices.push(index);
  }
  function spin(loop, start) {
    return loop.slice(start).concat(loop.slice(0, start));
  }
  function nearest(loop, target, positions) {
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < loop.length; i += 1) {
      const gap = vertexGap(positions, loop[i], target);
      if (gap < bestDist) {
        bestDist = gap;
        best = i;
      }
    }
    return best;
  }
  function hitsLoop(from, to, loop, positions) {
    for (let i = 0; i < loop.length; i += 1) {
      const c = loop[i];
      const d = loop[(i + 1) % loop.length];
      if (c === from || c === to || d === from || d === to) continue;
      if (segmentsCross(positions, from, to, c, d)) return true;
    }
    return false;
  }
  function contains(poly, y, z, positions) {
    let inside = false;
    for (let i = 0; i < poly.length; i += 1) {
      const a = yz(positions, poly[i]);
      const b = yz(positions, poly[(i + 1) % poly.length]);
      if (a.z > z === b.z > z) continue;
      const at = a.y + (b.y - a.y) * (z - a.z) / (b.z - a.z);
      if (at > y) inside = !inside;
    }
    return inside;
  }
  function insideTri(positions, point, a, b, c) {
    const ab = orient(positions, a, b, point);
    const bc = orient(positions, b, c, point);
    const ca = orient(positions, c, a, point);
    return ab > 1e-12 && bc > 1e-12 && ca > 1e-12;
  }
  function segmentsCross(positions, a, b, c, d) {
    const o1 = orient(positions, a, b, c);
    const o2 = orient(positions, a, b, d);
    const o3 = orient(positions, c, d, a);
    const o4 = orient(positions, c, d, b);
    return o1 * o2 < 0 && o3 * o4 < 0;
  }
  function orient(positions, a, b, c) {
    const pa = yz(positions, a);
    const pb = yz(positions, b);
    const pc = yz(positions, c);
    return (pb.y - pa.y) * (pc.z - pa.z) - (pb.z - pa.z) * (pc.y - pa.y);
  }
  function yz(positions, index) {
    return { y: positions[index * 3 + 1], z: positions[index * 3 + 2] };
  }
  function vertexGap(positions, a, b) {
    const dx = positions[a * 3] - positions[b * 3];
    const dy = positions[a * 3 + 1] - positions[b * 3 + 1];
    const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  }
  function mod(j) {
    return (j % TUBE_SIDES + TUBE_SIDES) % TUBE_SIDES;
  }
  function tubeAlongX(d, x0, y0, z0, x1, y1, z1, radius) {
    const rings = [];
    for (let k = 0; k <= AXIAL_STEPS; k += 1) {
      const u = k / AXIAL_STEPS;
      const points = [];
      for (let j = 0; j < TUBE_SIDES; j += 1) {
        const theta = j * 2 * Math.PI / TUBE_SIDES;
        points.push({
          x: x0 + (x1 - x0) * u,
          y: y0 + (y1 - y0) * u + radius * Math.cos(theta),
          z: z0 + (z1 - z0) * u + radius * Math.sin(theta)
        });
      }
      rings.push(addRing(d, points));
    }
    return rings;
  }
  function uniformStations() {
    const ts = [];
    for (let k = 0; k <= AXIAL_STEPS; k += 1) ts.push(k / AXIAL_STEPS);
    return ts;
  }
  function ringPoints(frame, t, radius) {
    const points = [];
    for (let j = 0; j < TUBE_SIDES; j += 1) points.push(sample(frame, t, radius, j));
    return points;
  }
  function sample(frame, t, radius, j) {
    const theta = j * 2 * Math.PI / TUBE_SIDES;
    const along = radius * Math.cos(theta);
    const lateral = radius * Math.sin(theta);
    return {
      x: frame.ox + frame.ax * frame.length * t + frame.px * along,
      y: frame.oy + frame.ay * frame.length * t + frame.py * along,
      z: frame.oz + lateral
    };
  }
  function dotAxis(point, frame) {
    const dx = point.x - frame.ox;
    const dy = point.y - frame.oy;
    return dx * frame.ax * frame.length + dy * frame.ay * frame.length;
  }
  function clamp01(value) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }
  function frameOf(rig, lateral, skeleton, bone) {
    const length2 = bindLength(skeleton, bone);
    const base = bone * 9;
    const ax = rig[base];
    const ay = rig[base + 1];
    return {
      ox: rig[base + 6],
      oy: rig[base + 7],
      oz: lateral[bone],
      ax,
      ay,
      px: -ay,
      py: ax,
      length: length2
    };
  }
  function radiusAt(profile2, t) {
    for (let i = 0; i < profile2.length - 1; i += 1) {
      const left = profile2[i];
      const right = profile2[i + 1];
      if (t < left.t || t > right.t) continue;
      const span2 = right.t - left.t;
      const u = span2 === 0 ? 0 : (t - left.t) / span2;
      return left.radius * (1 - u) + right.radius * u;
    }
    throw new Error("radius");
  }
  function writeBindRig(skeleton) {
    const rig = new Float32Array(skeleton.boneCount * 9);
    const local = createMat3();
    const parent = createMat3();
    const combined = createMat3();
    for (let bone = 0; bone < skeleton.boneCount; bone += 1) {
      setBindParentFromBone(local, skeleton, bone);
      const parentIndex = skeleton.parent[bone];
      const dst = bone * 9;
      const source = parentIndex < 0 ? local : combine(combined, parent, rig, parentIndex, local);
      for (let k = 0; k < 9; k += 1) rig[dst + k] = source[k];
    }
    return rig;
  }
  function writeBindLateral(skeleton) {
    const lateral = new Float32Array(skeleton.boneCount);
    for (let bone = 0; bone < skeleton.boneCount; bone += 1) {
      const parentIndex = skeleton.parent[bone];
      const own = skeleton.bindLateral[bone];
      lateral[bone] = parentIndex < 0 ? own : lateral[parentIndex] + own;
    }
    return lateral;
  }
  function combine(combined, parent, rig, parentIndex, local) {
    const src = parentIndex * 9;
    for (let k = 0; k < 9; k += 1) parent[k] = rig[src + k];
    return multiplyMat3(combined, parent, local);
  }

  // packages/render-engine/src/part/set.ts
  var MAX_PARTS = 256;
  function createPartSetBuilder(skeleton) {
    return {
      finished: false,
      skeleton,
      parts: []
    };
  }
  function finishPartSet(builder) {
    if (builder.finished) throw new Error("part set already finished");
    if (builder.parts.length === 0) throw new Error("empty part set");
    builder.finished = true;
    return {
      skeleton: builder.skeleton,
      parts: builder.parts.slice()
    };
  }
  function claimFill(builder, id, fill) {
    if (builder.finished) throw new Error("part set already finished");
    if (builder.parts.length >= MAX_PARTS) throw new Error("too many parts");
    if (typeof id !== "string" || id.length === 0) throw new Error("id");
    for (let i = 0; i < builder.parts.length; i += 1) {
      if (builder.parts[i].id === id) throw new Error("duplicate part id");
    }
    if (fill === void 0 || fill === null || typeof fill !== "object" || !inUnit(fill.r) || !inUnit(fill.g) || !inUnit(fill.b)) {
      throw new Error("fill");
    }
    return { r: fill.r, g: fill.g, b: fill.b };
  }
  function inUnit(value) {
    return Number.isFinite(value) && value >= 0 && value <= 1;
  }

  // packages/render-engine/src/part/rigid.ts
  function addRigid(builder, spec) {
    const fill = claimFill(builder, spec.id, spec.fill);
    const { bone, translationX, translationY, rotation } = spec;
    const boneCount = builder.skeleton.boneCount;
    if (!Number.isInteger(bone) || bone < 0 || bone >= boneCount) {
      throw new Error("bone");
    }
    if (!Number.isFinite(translationX) || !Number.isFinite(translationY)) {
      throw new Error("translation");
    }
    if (!Number.isFinite(rotation)) throw new Error("rotation");
    const part = {
      kind: "rigid",
      id: spec.id,
      bone,
      translationX,
      translationY,
      rotation: normalizeAngle(rotation),
      fill
    };
    const index = builder.parts.length;
    builder.parts.push(part);
    return index;
  }

  // packages/render-engine/src/part/skin.ts
  function addSkinned(builder, spec) {
    const fill = claimFill(builder, spec.id, spec.fill);
    const source = spec.bones;
    if (source === void 0 || source.length < 2) throw new Error("bones");
    const boneCount = builder.skeleton.boneCount;
    const bones = [];
    for (let i = 0; i < source.length; i += 1) {
      const bone = source[i];
      if (!Number.isInteger(bone) || bone < 0 || bone >= boneCount) {
        throw new Error("bones");
      }
      if (i > 0 && parentOf(builder.skeleton, bone) !== source[i - 1]) {
        throw new Error("bones");
      }
      bones.push(bone);
    }
    const part = {
      kind: "skinned",
      id: spec.id,
      bones,
      fill
    };
    const index = builder.parts.length;
    builder.parts.push(part);
    return index;
  }

  // packages/render-engine/src/part/humanoid.ts
  var HUMANOID_PART_COUNT = 10;
  var HUMANOID_PARTS = [
    { id: "torso", kind: "skinned", bones: ["pelvis", "spine", "chest", "neck", "head"] },
    { id: "head", kind: "rigid", bones: ["head"] },
    { id: "armL", kind: "skinned", bones: ["chest", "upperArmL", "lowerArmL", "handL"] },
    { id: "handL", kind: "rigid", bones: ["handL"] },
    { id: "armR", kind: "skinned", bones: ["chest", "upperArmR", "lowerArmR", "handR"] },
    { id: "handR", kind: "rigid", bones: ["handR"] },
    { id: "legL", kind: "skinned", bones: ["pelvis", "thighL", "shinL", "footL"] },
    { id: "footL", kind: "rigid", bones: ["footL"] },
    { id: "legR", kind: "skinned", bones: ["pelvis", "thighR", "shinR", "footR"] },
    { id: "footR", kind: "rigid", bones: ["footR"] }
  ];
  var HUMANOID_PART_IDS = HUMANOID_PARTS.map(
    (entry) => entry.id
  );
  var HUMANOID_FILL = {
    torso: { r: 0.22, g: 0.38, b: 0.58 },
    head: { r: 0.93, g: 0.78, b: 0.64 },
    armL: { r: 0.3, g: 0.48, b: 0.72 },
    handL: { r: 0.93, g: 0.78, b: 0.64 },
    armR: { r: 0.16, g: 0.32, b: 0.52 },
    handR: { r: 0.84, g: 0.68, b: 0.54 },
    legL: { r: 0.28, g: 0.4, b: 0.56 },
    legR: { r: 0.16, g: 0.26, b: 0.38 },
    footL: { r: 0.32, g: 0.28, b: 0.24 },
    footR: { r: 0.2, g: 0.16, b: 0.14 }
  };
  function appendHumanoidParts(builder, skeleton) {
    if (skeleton !== builder.skeleton) throw new Error("skeleton");
    const resolved = [];
    for (let i = 0; i < HUMANOID_PARTS.length; i += 1) {
      const names = HUMANOID_PARTS[i].bones;
      const bones = [];
      for (let n = 0; n < names.length; n += 1) {
        const index = findBone(skeleton, names[n]);
        if (index === PARENT_NONE) throw new Error("bone");
        bones.push(index);
      }
      resolved.push(bones);
    }
    for (let i = 0; i < HUMANOID_PARTS.length; i += 1) {
      const entry = HUMANOID_PARTS[i];
      if (entry.kind !== "skinned") continue;
      const bones = resolved[i];
      for (let b = 1; b < bones.length; b += 1) {
        if (parentOf(skeleton, bones[b]) !== bones[b - 1]) throw new Error("bones");
      }
    }
    for (let i = 0; i < HUMANOID_PARTS.length; i += 1) {
      const id = HUMANOID_PARTS[i].id;
      for (let p = 0; p < builder.parts.length; p += 1) {
        if (builder.parts[p].id === id) throw new Error("duplicate part id");
      }
    }
    if (builder.parts.length + HUMANOID_PART_COUNT > MAX_PARTS) {
      throw new Error("too many parts");
    }
    for (let i = 0; i < HUMANOID_PARTS.length; i += 1) {
      const entry = HUMANOID_PARTS[i];
      const fill = HUMANOID_FILL[entry.id];
      const bones = resolved[i];
      if (entry.kind === "rigid") {
        addRigid(builder, {
          id: entry.id,
          bone: bones[0],
          translationX: 0,
          translationY: 0,
          rotation: 0,
          fill
        });
      } else {
        addSkinned(builder, {
          id: entry.id,
          bones,
          fill
        });
      }
    }
  }
  function createHumanoidParts(skeleton) {
    const builder = createPartSetBuilder(skeleton);
    appendHumanoidParts(builder, skeleton);
    return finishPartSet(builder);
  }

  // packages/render-engine/src/math/vec2.ts
  function createVec2() {
    return vec2_exports.create();
  }

  // packages/render-engine/src/foot/shape.ts
  var HEEL_BACK_RATIO = 0.3;
  var FLAT_PARAMETER = HEEL_BACK_RATIO / (HEEL_BACK_RATIO + 1);
  function createFootShape(footLength, ankleHeight) {
    if (!Number.isFinite(footLength) || footLength <= 0) {
      throw new Error("footLength");
    }
    if (!Number.isFinite(ankleHeight) || ankleHeight < 0) {
      throw new Error("ankleHeight");
    }
    const heelBack = HEEL_BACK_RATIO * footLength;
    const toeForward = footLength;
    return {
      footLength,
      ankleHeight,
      heelBack,
      toeForward,
      soleLength: heelBack + toeForward
    };
  }

  // packages/render-engine/src/skeleton/rigid.ts
  var RIGID_STRIDE = 12;
  function setRigidParentFromBone(out, skeleton, pose2, bone, swingSign, twistSign, twistScale = 1) {
    const poseIndex = bone * POSE_STRIDE;
    const translation = bone * 2;
    const ptx = pose2.data[poseIndex];
    const pty = pose2.data[poseIndex + 1];
    const rotation = pose2.data[poseIndex + 2];
    const swing = pose2.data[poseIndex + 3];
    const twist = pose2.data[poseIndex + 4];
    const bindRotation2 = skeleton.bindRotation[bone];
    const btx = skeleton.bindTranslation[translation];
    const bty = skeleton.bindTranslation[translation + 1];
    const a = swingSign * swing;
    const b = twistSign * twist * twistScale;
    const g = bindRotation2 + rotation;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    const cg = Math.cos(g);
    const sg = Math.sin(g);
    const bindCos = Math.cos(bindRotation2);
    const bindSin = Math.sin(bindRotation2);
    out[0] = cg * ca;
    out[1] = sg * ca;
    out[2] = -sa;
    out[3] = cg * sa * sb - sg * cb;
    out[4] = sg * sa * sb + cg * cb;
    out[5] = ca * sb;
    out[6] = cg * sa * cb + sg * sb;
    out[7] = sg * sa * cb - cg * sb;
    out[8] = ca * cb;
    out[9] = btx + bindCos * ptx - bindSin * pty;
    out[10] = bty + bindSin * ptx + bindCos * pty;
    out[11] = skeleton.bindLateral[bone];
  }
  function multiplyRigid(out, parent, local) {
    const p0 = parent[0];
    const p1 = parent[1];
    const p2 = parent[2];
    const p3 = parent[3];
    const p4 = parent[4];
    const p5 = parent[5];
    const p6 = parent[6];
    const p7 = parent[7];
    const p8 = parent[8];
    const ptx = parent[9];
    const pty = parent[10];
    const ptz = parent[11];
    const l0 = local[0];
    const l1 = local[1];
    const l2 = local[2];
    const l3 = local[3];
    const l4 = local[4];
    const l5 = local[5];
    const l6 = local[6];
    const l7 = local[7];
    const l8 = local[8];
    const lx = local[9];
    const ly = local[10];
    const lz = local[11];
    out[0] = p0 * l0 + p3 * l1 + p6 * l2;
    out[1] = p1 * l0 + p4 * l1 + p7 * l2;
    out[2] = p2 * l0 + p5 * l1 + p8 * l2;
    out[3] = p0 * l3 + p3 * l4 + p6 * l5;
    out[4] = p1 * l3 + p4 * l4 + p7 * l5;
    out[5] = p2 * l3 + p5 * l4 + p8 * l5;
    out[6] = p0 * l6 + p3 * l7 + p6 * l8;
    out[7] = p1 * l6 + p4 * l7 + p7 * l8;
    out[8] = p2 * l6 + p5 * l7 + p8 * l8;
    out[9] = p0 * lx + p3 * ly + p6 * lz + ptx;
    out[10] = p1 * lx + p4 * ly + p7 * lz + pty;
    out[11] = p2 * lx + p5 * ly + p8 * lz + ptz;
  }

  // packages/render-engine/src/correction/correction.ts
  function createCorrection(options = {}) {
    return {
      enabled: options.enabled ?? true,
      twistGain: options.twistGain ?? 0.35,
      bendGain: options.bendGain ?? 0.35
    };
  }
  function applyCorrection(out, positions, correction, context) {
    if (out.length !== positions.length) throw new Error("out");
    out.set(positions);
    if (!correction.enabled) return out;
    if (context === void 0) throw new Error("correction");
    pushRadial(out, positions, correction.twistGain, context, twistAngle);
    pushRadial(out, positions, correction.bendGain, context, bendAngle);
    return out;
  }
  function twistAngle(pose2, bone) {
    return Math.abs(poseTwist(pose2, bone));
  }
  function bendAngle(pose2, bone) {
    return Math.hypot(poseSwing(pose2, bone), poseRotation(pose2, bone));
  }
  function pushRadial(out, positions, gain, context, angleOf) {
    if (gain === 0) return;
    const { bones, weights, influences, bindRig, pose: pose2 } = context;
    const skeleton = pose2.skeleton;
    const vertexCount = positions.length / 3;
    for (let v = 0; v < vertexCount; v += 1) {
      let bestBone = -1;
      let bestWeight = 0;
      let bestPhi = 0;
      for (let i = 0; i < influences; i += 1) {
        const bone = bones[i];
        if (!isCorrectionBone(boneName(skeleton, bone))) continue;
        const w = weights[v * influences + i];
        if (w <= 0 || w >= 1) continue;
        const phi = angleOf(pose2, bone);
        if (phi > bestPhi) {
          bestPhi = phi;
          bestBone = bone;
          bestWeight = w;
        }
      }
      if (bestBone < 0 || bestPhi === 0) continue;
      const x = positions[v * 3];
      const y = positions[v * 3 + 1];
      const z = positions[v * 3 + 2];
      const axis = bindAxis(bindRig, bestBone);
      const dx = x - axis.ox;
      const dy = y - axis.oy;
      const dz = z - axis.oz;
      const along = dx * axis.ax + dy * axis.ay + dz * axis.az;
      const px = dx - axis.ax * along;
      const py = dy - axis.ay * along;
      const pz = dz - axis.az * along;
      const r = Math.hypot(px, py, pz);
      if (r < 1e-12) continue;
      const blend2 = 4 * bestWeight * (1 - bestWeight);
      const push = r * gain * (1 - Math.cos(bestPhi)) * blend2;
      const inv = 1 / r;
      out[v * 3] = out[v * 3] + px * inv * push;
      out[v * 3 + 1] = out[v * 3 + 1] + py * inv * push;
      out[v * 3 + 2] = out[v * 3 + 2] + pz * inv * push;
    }
  }
  function isCorrectionBone(name) {
    return name.startsWith("upperArm") || name.startsWith("lowerArm") || name.startsWith("thigh") || name.startsWith("shin");
  }
  function bindAxis(bindRig, bone) {
    const base = bone * RIGID_STRIDE;
    return {
      ox: bindRig[base + 9],
      oy: bindRig[base + 10],
      oz: bindRig[base + 11],
      ax: bindRig[base],
      ay: bindRig[base + 1],
      az: bindRig[base + 2]
    };
  }

  // packages/render-engine/src/space/facing.ts
  function isFacing(x) {
    return x === 1 || x === -1;
  }
  function nearSide(facing) {
    return facing === 1 ? "right" : "left";
  }
  function farSide(facing) {
    return facing === 1 ? "left" : "right";
  }

  // packages/render-engine/src/slot/slot.ts
  var SLOT_NONE = -1;
  var MAX_SLOTS = 256;
  var SIDES = ["left", "right", "center"];
  function createSlotSetBuilder() {
    return { finished: false, slots: [] };
  }
  function addSlot(builder, spec) {
    if (builder.finished) throw new Error("slot set already finished");
    if (builder.slots.length >= MAX_SLOTS) throw new Error("too many slots");
    if (typeof spec.partId !== "string" || spec.partId.length === 0) throw new Error("id");
    for (let i = 0; i < builder.slots.length; i += 1) {
      if (builder.slots[i].partId === spec.partId) throw new Error("duplicate part id");
    }
    if (!Number.isInteger(spec.layer)) throw new Error("layer");
    if (!SIDES.includes(spec.side)) throw new Error("side");
    const index = builder.slots.length;
    builder.slots.push({
      partId: spec.partId,
      layer: spec.layer,
      side: spec.side
    });
    return index;
  }
  function finishSlotSet(builder) {
    if (builder.finished) throw new Error("slot set already finished");
    if (builder.slots.length === 0) throw new Error("empty slot set");
    builder.finished = true;
    return { slots: builder.slots.slice() };
  }
  function findSlot(set3, partId) {
    for (let i = 0; i < set3.slots.length; i += 1) {
      if (set3.slots[i].partId === partId) return i;
    }
    return SLOT_NONE;
  }
  function drawOrder(out, set3, facing) {
    if (!isFacing(facing)) throw new Error("facing");
    const count = set3.slots.length;
    if (out.length !== count) throw new Error("order");
    const order = new Array(count);
    for (let i = 0; i < count; i += 1) order[i] = i;
    const near2 = nearSide(facing);
    const far = farSide(facing);
    order.sort((a, b) => compareSlot(set3, a, b, near2, far));
    for (let i = 0; i < count; i += 1) out[i] = set3.slots[order[i]].partId;
    return out;
  }
  function compareSlot(set3, a, b, near2, far) {
    const sa = set3.slots[a];
    const sb = set3.slots[b];
    if (sa.layer !== sb.layer) return sa.layer - sb.layer;
    const bandA = band(sa.side, near2, far);
    const bandB = band(sb.side, near2, far);
    if (bandA !== bandB) return bandA - bandB;
    return a - b;
  }
  function band(side, near2, far) {
    if (side === far) return 0;
    if (side === "center") return 1;
    if (side === near2) return 2;
    return 1;
  }

  // packages/render-engine/src/slot/humanoid.ts
  var HUMANOID_SLOTS = [
    { partId: "legL", layer: 0, side: "left" },
    { partId: "legR", layer: 0, side: "right" },
    { partId: "footL", layer: 1, side: "left" },
    { partId: "footR", layer: 1, side: "right" },
    { partId: "torso", layer: 2, side: "center" },
    { partId: "armL", layer: 3, side: "left" },
    { partId: "armR", layer: 3, side: "right" },
    { partId: "handL", layer: 4, side: "left" },
    { partId: "handR", layer: 4, side: "right" },
    { partId: "head", layer: 5, side: "center" }
  ];
  function createHumanoidSlots() {
    const builder = createSlotSetBuilder();
    for (let i = 0; i < HUMANOID_SLOTS.length; i += 1) {
      const slot = HUMANOID_SLOTS[i];
      addSlot(builder, slot);
    }
    return finishSlotSet(builder);
  }

  // packages/render-engine/src/space/tolerance.ts
  var LENGTH_EPSILON = 1e-5;

  // packages/render-engine/src/topology/validate.ts
  var AREA_EPSILON = 1e-8;
  function validateMesh(mesh) {
    const positions = mesh.positions;
    const indices = mesh.indices;
    if (positions.length < 9 || positions.length % 3 !== 0) throw new Error("mesh");
    if (indices.length < 3 || indices.length % 3 !== 0) throw new Error("mesh");
    const vertexCount = positions.length / 3;
    for (let i = 0; i < indices.length; i += 1) {
      const index = indices[i];
      if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
        throw new Error("indices");
      }
    }
    const triangleCount = indices.length / 3;
    for (let t = 0; t < triangleCount; t += 1) {
      if (crossLength(positions, indices, t) <= AREA_EPSILON) throw new Error("degenerate");
    }
    const edges = /* @__PURE__ */ new Map();
    for (let t = 0; t < triangleCount; t += 1) {
      const a = indices[t * 3];
      const b = indices[t * 3 + 1];
      const c = indices[t * 3 + 2];
      addEdge(edges, a, b);
      addEdge(edges, b, c);
      addEdge(edges, c, a);
    }
    const neighbors = Array.from({ length: triangleCount }, () => []);
    const used = /* @__PURE__ */ new Map();
    for (let t = 0; t < triangleCount; t += 1) {
      const a = indices[t * 3];
      const b = indices[t * 3 + 1];
      const c = indices[t * 3 + 2];
      link2(neighbors, used, t, a, b);
      link2(neighbors, used, t, b, c);
      link2(neighbors, used, t, c, a);
    }
    const seen = new Array(triangleCount).fill(false);
    const stack = [0];
    seen[0] = true;
    let visited = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      visited += 1;
      const next = neighbors[current];
      for (let i = 0; i < next.length; i += 1) {
        const other = next[i];
        if (seen[other]) continue;
        seen[other] = true;
        stack.push(other);
      }
    }
    if (visited !== triangleCount) throw new Error("connectivity");
  }
  function crossLength(positions, indices, triangle) {
    const i0 = indices[triangle * 3] * 3;
    const i1 = indices[triangle * 3 + 1] * 3;
    const i2 = indices[triangle * 3 + 2] * 3;
    const ux = positions[i1] - positions[i0];
    const uy = positions[i1 + 1] - positions[i0 + 1];
    const uz = positions[i1 + 2] - positions[i0 + 2];
    const vx = positions[i2] - positions[i0];
    const vy = positions[i2 + 1] - positions[i0 + 1];
    const vz = positions[i2 + 2] - positions[i0 + 2];
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  function addEdge(edges, from, to) {
    const lo = from < to ? from : to;
    const hi = from < to ? to : from;
    const key = `${lo}:${hi}`;
    const dir = from === lo ? 1 : -1;
    const previous = edges.get(key);
    if (previous === void 0) {
      edges.set(key, { count: 1, dir });
      return;
    }
    if (previous.count === 2 || previous.dir === dir) throw new Error("manifold");
    previous.count = 2;
  }
  function link2(neighbors, used, triangle, from, to) {
    const lo = from < to ? from : to;
    const hi = from < to ? to : from;
    const key = `${lo}:${hi}`;
    const other = used.get(key);
    if (other === void 0) {
      used.set(key, triangle);
      return;
    }
    neighbors[triangle].push(other);
    neighbors[other].push(triangle);
  }

  // packages/render-engine/src/weight/humanoid.ts
  var BAND_RATIO = 0.25;
  function createHumanoidWeights(humanoid2, parts, meshes) {
    if (parts.skeleton !== humanoid2.skeleton) throw new Error("skeleton");
    if (meshes.meshes.length !== parts.parts.length) throw new Error("mesh");
    const rig = writeBindRig2(humanoid2.skeleton);
    const weights = [];
    for (let i = 0; i < parts.parts.length; i += 1) {
      const part = parts.parts[i];
      const mesh = meshes.meshes[i];
      if (mesh.partId !== part.id) throw new Error("mesh");
      if (part.kind !== "skinned") continue;
      weights.push(weightPart(part, mesh, rig, humanoid2.skeleton));
    }
    return { weights };
  }
  function weightPart(part, mesh, rig, skeleton) {
    const positions = mesh.positions;
    const endShare = mesh.endShare;
    const segments = [];
    for (let i = 0; i < part.bones.length; i += 1) {
      const bone = part.bones[i];
      const length2 = bindLength(skeleton, bone);
      if (length2 <= 1e-5 || borrowed(part.id, boneName(skeleton, bone))) continue;
      const base = bone * 9;
      const x0 = rig[base + 6];
      const y0 = rig[base + 7];
      segments.push({
        slot: i,
        x0,
        y0,
        x1: x0 + rig[base] * length2,
        y1: y0 + rig[base + 1] * length2,
        length: length2
      });
    }
    const influences = part.bones.length;
    const vertexCount = positions.length / 3;
    const weights = new Float32Array(vertexCount * influences);
    const twistU = new Float32Array(vertexCount);
    const headSlot = 0;
    const tailSlot = influences - 1;
    for (let v = 0; v < vertexCount; v += 1) {
      const x = positions[v * 3];
      const y = positions[v * 3 + 1];
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      let bestT = 0;
      for (let s = 0; s < segments.length; s += 1) {
        const proj = project(x, y, segments[s]);
        if (proj.dist < bestDist) {
          best = s;
          bestDist = proj.dist;
          bestT = proj.t;
        }
      }
      const column = weights.subarray(v * influences, (v + 1) * influences);
      blend(column, segments, best, bestT);
      const head = endShare[v * 2];
      const tail = endShare[v * 2 + 1];
      const e = head > 0 ? head : tail;
      const endSlot = head > 0 ? headSlot : tail > 0 ? tailSlot : -1;
      if (endSlot >= 0 && e > 0) {
        for (let i = 0; i < influences; i += 1) column[i] *= 1 - e;
        column[endSlot] += e;
      }
      const seg = segments[best];
      const name = boneName(skeleton, part.bones[seg.slot]);
      if (name.startsWith("lowerArm")) {
        twistU[v] = bestT;
      } else if (name.startsWith("upperArm") || name.startsWith("thigh")) {
        twistU[v] = bestT * (1 - head);
      }
    }
    return { partId: part.id, influences, weights, twistU };
  }
  function borrowed(partId, name) {
    if (partId === "torso") return name === "pelvis" || name === "head";
    if (partId === "armL") return name === "chest" || name === "handL";
    if (partId === "armR") return name === "chest" || name === "handR";
    if (partId === "legL") return name === "pelvis" || name === "footL";
    if (partId === "legR") return name === "pelvis" || name === "footR";
    return false;
  }
  function blend(column, segments, best, t) {
    const seg = segments[best];
    column[seg.slot] = 1;
    const fromStart = t * seg.length;
    const fromEnd = (1 - t) * seg.length;
    if (best > 0 && segments[best - 1].slot === seg.slot - 1) {
      const prev = segments[best - 1];
      const band2 = BAND_RATIO * Math.min(seg.length, prev.length);
      if (fromStart <= band2) {
        const u = band2 === 0 ? 0 : fromStart / band2;
        const wPrev = 0.5 * (1 - u);
        column[seg.slot] = 1 - wPrev;
        column[prev.slot] = wPrev;
        return;
      }
    }
    if (best + 1 < segments.length && segments[best + 1].slot === seg.slot + 1) {
      const next = segments[best + 1];
      const band2 = BAND_RATIO * Math.min(seg.length, next.length);
      if (fromEnd <= band2) {
        const u = band2 === 0 ? 0 : fromEnd / band2;
        const wNext = 0.5 * (1 - u);
        column[seg.slot] = 1 - wNext;
        column[next.slot] = wNext;
      }
    }
  }
  function project(x, y, seg) {
    const dx = seg.x1 - seg.x0;
    const dy = seg.y1 - seg.y0;
    const len2 = dx * dx + dy * dy;
    let t = ((x - seg.x0) * dx + (y - seg.y0) * dy) / len2;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    const cx = seg.x0 + dx * t;
    const cy = seg.y0 + dy * t;
    return { t, dist: Math.hypot(x - cx, y - cy) };
  }
  function writeBindRig2(skeleton) {
    const rig = new Float32Array(skeleton.boneCount * 9);
    const local = createMat3();
    const parent = createMat3();
    const combined = createMat3();
    for (let bone = 0; bone < skeleton.boneCount; bone += 1) {
      setBindParentFromBone(local, skeleton, bone);
      const parentIndex = skeleton.parent[bone];
      const source = parentIndex < 0 ? local : combine2(combined, parent, rig, parentIndex, local);
      const dst = bone * 9;
      for (let k = 0; k < 9; k += 1) rig[dst + k] = source[k];
    }
    return rig;
  }
  function combine2(combined, parent, rig, parentIndex, local) {
    const src = parentIndex * 9;
    for (let k = 0; k < 9; k += 1) parent[k] = rig[src + k];
    return multiplyMat3(combined, parent, local);
  }

  // packages/render-engine/src/compile/compile.ts
  function compileHumanoid(humanoid2) {
    const parts = createHumanoidParts(humanoid2.skeleton);
    const slots = createHumanoidSlots();
    const meshes = createHumanoidMeshes(humanoid2, parts);
    const weights = createHumanoidWeights(humanoid2, parts, meshes);
    return compileRig({
      humanoid: humanoid2,
      parts,
      slots,
      meshes,
      weights,
      correction: createCorrection()
    });
  }
  function compileRig(input) {
    const { humanoid: humanoid2, parts, slots, meshes, weights, correction } = input;
    if (parts.skeleton !== humanoid2.skeleton) throw new Error("skeleton");
    assertSlots(parts, slots);
    assertMeshes(parts, meshes);
    assertWeights(parts, meshes, weights);
    assertChains(humanoid2);
    const bindRig = writeBindRig3(humanoid2);
    const inverseBind = invertAll(bindRig, humanoid2.skeleton.boneCount);
    const foot = createFootShape(humanoid2.proportions.footLength, humanoid2.proportions.ankleHeight);
    return {
      skeleton: humanoid2.skeleton,
      proportions: humanoid2.proportions,
      foot,
      parts,
      slots,
      meshes,
      weights,
      correction,
      bindRig,
      inverseBind,
      joints: humanoid2.joints
    };
  }
  function assertSlots(parts, slots) {
    if (slots.slots.length !== parts.parts.length) throw new Error("slot");
    for (let i = 0; i < parts.parts.length; i += 1) {
      if (findSlot(slots, parts.parts[i].id) < 0) throw new Error("slot");
    }
  }
  function assertMeshes(parts, meshes) {
    if (meshes.meshes.length !== parts.parts.length) throw new Error("mesh");
    for (let i = 0; i < parts.parts.length; i += 1) {
      const mesh = meshes.meshes[i];
      const part = parts.parts[i];
      if (mesh.partId !== part.id) throw new Error("mesh");
      const vertexCount = mesh.positions.length / 3;
      if (mesh.seam.length !== vertexCount) throw new Error("mesh");
      const shareLength = part.kind === "skinned" ? vertexCount * 2 : 0;
      if (mesh.endShare.length !== shareLength) throw new Error("mesh");
      validateMesh(mesh);
      validateMeshTextures(mesh.indices, mesh.textures, mesh.triangleTexture, mesh.uvs);
    }
  }
  function assertWeights(parts, meshes, weights) {
    for (let i = 0; i < parts.parts.length; i += 1) {
      const part = parts.parts[i];
      const found = weights.weights.find((item) => item.partId === part.id);
      if (part.kind === "rigid") {
        if (found !== void 0) throw new Error("weight");
        continue;
      }
      const mesh = meshes.meshes[i];
      const vertexCount = mesh.positions.length / 3;
      if (found === void 0 || found.influences !== part.bones.length || found.weights.length !== vertexCount * part.bones.length || found.twistU.length !== vertexCount) {
        throw new Error("weight");
      }
    }
  }
  function assertChains(humanoid2) {
    const chains = [
      humanoid2.chains.legL,
      humanoid2.chains.legR,
      humanoid2.chains.armL,
      humanoid2.chains.armR
    ];
    for (let i = 0; i < chains.length; i += 1) {
      const chain = chains[i];
      assertLink(humanoid2.skeleton, chain.root, chain.mid);
      assertLink(humanoid2.skeleton, chain.mid, chain.end);
    }
  }
  function assertLink(skeleton, parent, child) {
    const length2 = bindLength(skeleton, parent);
    const translation = bindTranslation(createVec2(), skeleton, child);
    if (Math.abs(translation[0] - length2) > LENGTH_EPSILON || Math.abs(translation[1]) > LENGTH_EPSILON) {
      throw new Error("chain");
    }
  }
  function writeBindRig3(humanoid2) {
    const skeleton = humanoid2.skeleton;
    const pose2 = createPose(skeleton);
    const rig = new Float32Array(skeleton.boneCount * RIGID_STRIDE);
    const local = new Float32Array(RIGID_STRIDE);
    const parent = new Float32Array(RIGID_STRIDE);
    const combined = new Float32Array(RIGID_STRIDE);
    for (let bone = 0; bone < skeleton.boneCount; bone += 1) {
      const joint = humanoid2.joints[bone];
      setRigidParentFromBone(local, skeleton, pose2, bone, joint.swingSign, joint.twistSign);
      const parentIndex = skeleton.parent[bone];
      const dst = bone * RIGID_STRIDE;
      if (parentIndex < 0) {
        rig.set(local, dst);
        continue;
      }
      parent.set(rig.subarray(parentIndex * RIGID_STRIDE, parentIndex * RIGID_STRIDE + RIGID_STRIDE));
      multiplyRigid(combined, parent, local);
      rig.set(combined, dst);
    }
    return rig;
  }
  function invertAll(bindRig, boneCount) {
    const inverse2 = new Float32Array(bindRig.length);
    const source = new Float32Array(RIGID_STRIDE);
    const inv = new Float32Array(RIGID_STRIDE);
    for (let bone = 0; bone < boneCount; bone += 1) {
      const dst = bone * RIGID_STRIDE;
      source.set(bindRig.subarray(dst, dst + RIGID_STRIDE));
      if (!invertRigid(inv, source)) throw new Error("bind");
      inverse2.set(inv, dst);
    }
    return inverse2;
  }
  function invertRigid(out, src) {
    for (let i = 0; i < RIGID_STRIDE; i += 1) {
      if (!Number.isFinite(src[i])) return false;
    }
    out[0] = src[0];
    out[1] = src[3];
    out[2] = src[6];
    out[3] = src[1];
    out[4] = src[4];
    out[5] = src[7];
    out[6] = src[2];
    out[7] = src[5];
    out[8] = src[8];
    const tx = src[9];
    const ty = src[10];
    const tz = src[11];
    out[9] = -(out[0] * tx + out[3] * ty + out[6] * tz);
    out[10] = -(out[1] * tx + out[4] * ty + out[7] * tz);
    out[11] = -(out[2] * tx + out[5] * ty + out[8] * tz);
    let error = 0;
    for (let col = 0; col < 3; col += 1) {
      for (let row = 0; row < 3; row += 1) {
        let sum = 0;
        for (let k = 0; k < 3; k += 1) sum += src[k * 3 + row] * out[col * 3 + k];
        error = Math.max(error, Math.abs(sum - (row === col ? 1 : 0)));
      }
    }
    return error <= 1e-4;
  }

  // packages/render-engine/src/fk/evaluate.ts
  function evaluateFk(out, compiled2, pose2, count) {
    if (pose2.skeleton !== compiled2.skeleton) throw new Error("pose");
    const boneCount = compiled2.skeleton.boneCount;
    if (!Number.isInteger(count) || count < 1 || count > boneCount) throw new Error("count");
    if (out.length !== count * RIGID_STRIDE) throw new Error("out");
    const local = new Float32Array(RIGID_STRIDE);
    const parent = new Float32Array(RIGID_STRIDE);
    const combined = new Float32Array(RIGID_STRIDE);
    for (let bone = 0; bone < count; bone += 1) {
      const joint = compiled2.joints[bone];
      setRigidParentFromBone(
        local,
        compiled2.skeleton,
        pose2,
        bone,
        joint.swingSign,
        joint.twistSign
      );
      const parentIndex = compiled2.skeleton.parent[bone];
      const dst = bone * RIGID_STRIDE;
      if (parentIndex < 0) {
        out.set(local, dst);
        continue;
      }
      parent.set(out.subarray(parentIndex * RIGID_STRIDE, parentIndex * RIGID_STRIDE + RIGID_STRIDE));
      multiplyRigid(combined, parent, local);
      out.set(combined, dst);
    }
  }

  // packages/render-engine/src/fill/fill.ts
  function fillProjected(parts, fills) {
    if (parts.length !== fills.length) throw new Error("part");
    const filled = [];
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      filled.push({
        partId: part.partId,
        positions: part.positions.slice(),
        indices: part.indices,
        fill: fills[i],
        seam: part.seam
      });
    }
    return filled;
  }

  // packages/render-engine/src/texture/sample.ts
  function sampleTexture(texture, u, v) {
    if (!Number.isFinite(u) || !Number.isFinite(v)) throw new Error("uv");
    const uu = u < 0 ? 0 : u > 1 ? 1 : u;
    const vv = v < 0 ? 0 : v > 1 ? 1 : v;
    const sx = Math.min(texture.width - 1, Math.floor(uu * texture.width));
    const sy = Math.min(texture.height - 1, Math.floor(vv * texture.height));
    const index = (sy * texture.width + sx) * 3;
    return {
      r: texture.rgb[index] / 255,
      g: texture.rgb[index + 1] / 255,
      b: texture.rgb[index + 2] / 255
    };
  }

  // packages/render-engine/src/texture/bind.ts
  function textureProjected(compiled2, projected) {
    const meshes = compiled2.meshes.meshes;
    if (projected.length !== meshes.length) throw new Error("mesh");
    const textured = [];
    for (let i = 0; i < projected.length; i += 1) {
      const mesh = meshes[i];
      const part = projected[i];
      if (part.partId !== mesh.partId) throw new Error("mesh");
      if (part.indices.length !== mesh.indices.length) throw new Error("indices");
      const uvs = new Float32Array(mesh.uvs.length);
      const triangleCount = mesh.indices.length / 3;
      for (let triangle = 0; triangle < triangleCount; triangle += 1) {
        const base = triangle * 3;
        const a = mesh.indices[base];
        const b = mesh.indices[base + 1];
        const c = mesh.indices[base + 2];
        const pa = part.indices[base];
        const pb = part.indices[base + 1];
        const pc = part.indices[base + 2];
        const corner = triangle * 6;
        const ua = mesh.uvs[corner];
        const va = mesh.uvs[corner + 1];
        const ub = mesh.uvs[corner + 2];
        const vb = mesh.uvs[corner + 3];
        const uc = mesh.uvs[corner + 4];
        const vc = mesh.uvs[corner + 5];
        if (pa === a && pb === b && pc === c) {
          writeCorner(uvs, corner, ua, va, ub, vb, uc, vc);
        } else if (pa === a && pb === c && pc === b) {
          writeCorner(uvs, corner, ua, va, uc, vc, ub, vb);
        } else {
          throw new Error("indices");
        }
      }
      textured.push({
        partId: part.partId,
        positions: part.positions.slice(),
        indices: part.indices,
        textures: mesh.textures,
        triangleTexture: mesh.triangleTexture,
        uvs
      });
    }
    return textured;
  }
  function triangleUv(out, ax, ay, bx, by, cx, cy, x, y, uvs) {
    if (out.length !== 2 || uvs.length !== 6) throw new Error("uv");
    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denom) <= 1e-8) throw new Error("degenerate");
    const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denom;
    const w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denom;
    const w2 = 1 - w0 - w1;
    out[0] = w0 * uvs[0] + w1 * uvs[2] + w2 * uvs[4];
    out[1] = w0 * uvs[1] + w1 * uvs[3] + w2 * uvs[5];
  }
  function writeCorner(uvs, corner, ua, va, ub, vb, uc, vc) {
    uvs[corner] = ua;
    uvs[corner + 1] = va;
    uvs[corner + 2] = ub;
    uvs[corner + 3] = vb;
    uvs[corner + 4] = uc;
    uvs[corner + 5] = vc;
  }

  // packages/render-engine/src/skin/skin.ts
  function skinMesh(out, compiled2, fk2, meshIndex, pose2) {
    const mesh = compiled2.meshes.meshes[meshIndex];
    if (mesh === void 0) throw new Error("mesh");
    if (fk2.length !== compiled2.skeleton.boneCount * RIGID_STRIDE) throw new Error("fk");
    if (out.length !== mesh.positions.length) throw new Error("out");
    if (pose2.skeleton !== compiled2.skeleton) throw new Error("pose");
    const part = compiled2.parts.parts[meshIndex];
    const corrected = new Float32Array(mesh.positions.length);
    if (part.kind === "skinned") {
      const found = compiled2.weights.weights.find((item) => item.partId === part.id);
      if (found === void 0) throw new Error("weight");
      applyCorrection(corrected, mesh.positions, compiled2.correction, {
        bones: part.bones,
        weights: found.weights,
        influences: found.influences,
        bindRig: compiled2.bindRig,
        pose: pose2
      });
      skinSkinned(out, compiled2, fk2, corrected, part, found, pose2);
    } else {
      applyCorrection(corrected, mesh.positions, { enabled: false, twistGain: 0, bendGain: 0 });
      skinRigid(out, fk2, corrected, part);
    }
  }
  function skinSkinned(out, compiled2, fk2, positions, part, found, pose2) {
    const inverse2 = compiled2.inverseBind;
    const vertexCount = positions.length / 3;
    const local = new Float32Array(RIGID_STRIDE);
    const scaled = new Float32Array(RIGID_STRIDE);
    const parent = new Float32Array(RIGID_STRIDE);
    for (let v = 0; v < vertexCount; v += 1) {
      const x = positions[v * 3];
      const y = positions[v * 3 + 1];
      const z = positions[v * 3 + 2];
      const twistScale = found.twistU[v];
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let i = 0; i < part.bones.length; i += 1) {
        const weight = found.weights[v * found.influences + i];
        if (weight === 0) continue;
        const bone = part.bones[i];
        const bindLocal = applyRigid(inverse2, bone, x, y, z);
        const world = isTwistDistributed(boneName(compiled2.skeleton, bone)) ? applyScaled(
          scaled,
          local,
          parent,
          fk2,
          compiled2,
          pose2,
          bone,
          twistScale,
          bindLocal.x,
          bindLocal.y,
          bindLocal.z
        ) : applyRigid(fk2, bone, bindLocal.x, bindLocal.y, bindLocal.z);
        sx += weight * world.x;
        sy += weight * world.y;
        sz += weight * world.z;
      }
      out[v * 3] = sx;
      out[v * 3 + 1] = sy;
      out[v * 3 + 2] = sz;
    }
  }
  function applyScaled(scaled, local, parent, fk2, compiled2, pose2, bone, twistScale, x, y, z) {
    const joint = compiled2.joints[bone];
    setRigidParentFromBone(
      local,
      compiled2.skeleton,
      pose2,
      bone,
      joint.swingSign,
      joint.twistSign,
      twistScale
    );
    const parentIndex = compiled2.skeleton.parent[bone];
    if (parentIndex < 0) {
      scaled.set(local);
    } else {
      parent.set(fk2.subarray(parentIndex * RIGID_STRIDE, parentIndex * RIGID_STRIDE + RIGID_STRIDE));
      multiplyRigid(scaled, parent, local);
    }
    return {
      x: scaled[0] * x + scaled[3] * y + scaled[6] * z + scaled[9],
      y: scaled[1] * x + scaled[4] * y + scaled[7] * z + scaled[10],
      z: scaled[2] * x + scaled[5] * y + scaled[8] * z + scaled[11]
    };
  }
  function skinRigid(out, fk2, positions, part) {
    const vertexCount = positions.length / 3;
    for (let v = 0; v < vertexCount; v += 1) {
      const world = applyRigid(
        fk2,
        part.bone,
        positions[v * 3],
        positions[v * 3 + 1],
        positions[v * 3 + 2]
      );
      out[v * 3] = world.x;
      out[v * 3 + 1] = world.y;
      out[v * 3 + 2] = world.z;
    }
  }
  function applyRigid(rigid, bone, x, y, z) {
    const base = bone * RIGID_STRIDE;
    return {
      x: rigid[base] * x + rigid[base + 3] * y + rigid[base + 6] * z + rigid[base + 9],
      y: rigid[base + 1] * x + rigid[base + 4] * y + rigid[base + 7] * z + rigid[base + 10],
      z: rigid[base + 2] * x + rigid[base + 5] * y + rigid[base + 8] * z + rigid[base + 11]
    };
  }
  function isTwistDistributed(name) {
    return name.startsWith("upperArm") || name.startsWith("lowerArm") || name.startsWith("thigh");
  }

  // packages/render-engine/src/stroke/stroke.ts
  var STROKE_WIDTH = 0.012;
  var SEAM = 1e-4;
  var MIN_EDGE = 1e-9;
  function strokeContours(parts, enabled, width = STROKE_WIDTH) {
    if (!enabled) return [];
    if (!Number.isFinite(width) || width <= 0) throw new Error("width");
    const edges = [];
    for (let part = 0; part < parts.length; part += 1) {
      edges.push(...boundary(part, parts[part]));
    }
    const keep = edges.filter((edge, index) => !edges.some((other, otherIndex) => otherIndex !== index && edge.part !== other.part && seam(edge, other)));
    const grouped = /* @__PURE__ */ new Map();
    for (const edge of keep) {
      const list = grouped.get(edge.part) ?? [];
      list.push(edge);
      grouped.set(edge.part, list);
    }
    return parts.map((part, index) => ({
      partId: part.partId,
      quads: (grouped.get(index) ?? []).map((edge) => quad(edge, width))
    }));
  }
  function boundary(part, source) {
    const nets = /* @__PURE__ */ new Map();
    const indices = source.indices;
    const positions = source.positions;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      const ax = positions[a * 2];
      const ay = positions[a * 2 + 1];
      const cross2 = (positions[b * 2] - ax) * (positions[c * 2 + 1] - ay) - (positions[b * 2 + 1] - ay) * (positions[c * 2] - ax);
      const turn = cross2 < 0 ? -1 : 1;
      add3(nets, a, b, turn);
      add3(nets, b, c, turn);
      add3(nets, c, a, turn);
    }
    const seam2 = source.seam;
    const edges = [];
    for (const item of nets.values()) {
      if (item.net === 0) continue;
      const from = item.net > 0 ? item.lo : item.hi;
      const to = item.net > 0 ? item.hi : item.lo;
      if (seam2 !== void 0 && seam2[from] === 1 && seam2[to] === 1) continue;
      const x0 = positions[from * 2];
      const y0 = positions[from * 2 + 1];
      const x1 = positions[to * 2];
      const y1 = positions[to * 2 + 1];
      if (Math.hypot(x1 - x0, y1 - y0) <= MIN_EDGE) continue;
      edges.push({ part, x0, y0, x1, y1 });
    }
    return edges;
  }
  function add3(nets, from, to, turn) {
    const lo = from < to ? from : to;
    const hi = from < to ? to : from;
    const key = `${lo}:${hi}`;
    const dir = from === lo ? turn : -turn;
    const found = nets.get(key);
    if (found) {
      found.net += dir;
      return;
    }
    nets.set(key, { lo, hi, net: dir });
  }
  function near(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by) <= SEAM;
  }
  function seam(a, b) {
    return near(a.x0, a.y0, b.x1, b.y1) && near(a.x1, a.y1, b.x0, b.y0);
  }
  function quad(edge, width) {
    const dx = edge.x1 - edge.x0;
    const dy = edge.y1 - edge.y0;
    const length2 = Math.hypot(dx, dy) || 1;
    const nx = dy / length2;
    const ny = -dx / length2;
    const half = width / 2;
    const positions = new Float32Array(8);
    write(positions, 0, edge.x0 + nx * half, edge.y0 + ny * half);
    write(positions, 2, edge.x1 + nx * half, edge.y1 + ny * half);
    write(positions, 4, edge.x1 - nx * half, edge.y1 - ny * half);
    write(positions, 6, edge.x0 - nx * half, edge.y0 - ny * half);
    return { positions, indices: Uint16Array.of(0, 1, 2, 0, 2, 3) };
  }
  function write(out, index, x, y) {
    out[index] = x;
    out[index + 1] = y;
  }

  // packages/render-engine/src/view/project.ts
  var VIEW_COUNT = 360;
  var VIEW_STEP_DEG = 1;
  var DEPTH_EPSILON = 1e-4;
  var WINDING_EPSILON = 1e-8;
  var QUARTER = VIEW_COUNT / 4;
  var HALF = VIEW_COUNT / 2;
  var SIN = new Float64Array(VIEW_COUNT);
  var COS = new Float64Array(VIEW_COUNT);
  for (let k = 0; k < VIEW_COUNT; k += 1) {
    SIN[k] = sineOf(k);
    COS[k] = sineOf((k + QUARTER) % VIEW_COUNT);
  }
  function sineOf(k) {
    const half = k % HALF;
    const base = half <= QUARTER ? half : HALF - half;
    if (base === 0) return 0;
    const value = base === QUARTER ? 1 : Math.sin(base * VIEW_STEP_DEG * Math.PI / 180);
    return k < HALF ? value : -value;
  }
  function isViewIndex(view) {
    return typeof view === "number" && Number.isInteger(view) && view >= 0 && view < VIEW_COUNT;
  }
  function projectPositions(out, positions, view) {
    if (!isViewIndex(view)) throw new Error("view");
    if (positions.length === 0 || positions.length % 3 !== 0) throw new Error("positions");
    const count = positions.length / 3;
    if (out.length !== count * 2) throw new Error("out");
    const sin = SIN[view];
    const cos = COS[view];
    let depth = 0;
    for (let v = 0; v < count; v += 1) {
      const x = positions[v * 3];
      const y = positions[v * 3 + 1];
      const z = positions[v * 3 + 2];
      out[v * 2] = x * cos + z * sin;
      out[v * 2 + 1] = y;
      depth += z * cos - x * sin;
    }
    return depth / count;
  }
  function windIndices(out, indices, screen) {
    if (indices.length % 3 !== 0) throw new Error("indices");
    const count = screen.length / 2;
    for (let i = 0; i < indices.length; i += 1) {
      if (indices[i] >= count) throw new Error("indices");
    }
    if (out.length !== indices.length) throw new Error("out");
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t];
      const b = indices[t + 1];
      const c = indices[t + 2];
      const ax = screen[a * 2];
      const ay = screen[a * 2 + 1];
      const cross2 = (screen[b * 2] - ax) * (screen[c * 2 + 1] - ay) - (screen[b * 2 + 1] - ay) * (screen[c * 2] - ax);
      out[t] = a;
      if (cross2 < -WINDING_EPSILON) {
        out[t + 1] = c;
        out[t + 2] = b;
      } else {
        out[t + 1] = b;
        out[t + 2] = c;
      }
    }
    return out;
  }
  function projectParts(parts, view) {
    if (!isViewIndex(view)) throw new Error("view");
    const projected = [];
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const positions = new Float32Array(part.positions.length / 3 * 2);
      const depth = projectPositions(positions, part.positions, view);
      const indices = windIndices(new Uint16Array(part.indices.length), part.indices, positions);
      projected.push({ partId: part.partId, positions, indices, depth, seam: part.seam });
    }
    return projected;
  }
  function depthOrder(out, parts, tie2) {
    const count = parts.length;
    if (out.length !== count) throw new Error("order");
    const rank = new Array(count);
    const level = new Array(count);
    const order = new Array(count);
    for (let i = 0; i < count; i += 1) {
      const part = parts[i];
      const found = tie2.indexOf(part.partId);
      if (found < 0) throw new Error("slot");
      rank[i] = found;
      level[i] = Math.round(part.depth / DEPTH_EPSILON);
      order[i] = i;
    }
    order.sort((a, b) => {
      if (level[a] !== level[b]) return level[b] - level[a];
      if (rank[a] !== rank[b]) return rank[a] - rank[b];
      return a - b;
    });
    for (let i = 0; i < count; i += 1) out[i] = parts[order[i]].partId;
    return out;
  }

  // preview/main.ts
  var HEIGHT = 1.8;
  var FRONT_VIEW = 90;
  var FACING = 1;
  var BACKGROUND = "#5c5c5c";
  var STROKE = "#141414";
  var STEP = 5;
  var BONE_UI = {
    pelvis: { group: "\u8EAF\u5E72", label: "\u9AA8\u76C6" },
    spine: { group: "\u8EAF\u5E72", label: "\u810A\u67F1" },
    chest: { group: "\u8EAF\u5E72", label: "\u80F8" },
    neck: { group: "\u8EAF\u5E72", label: "\u9888" },
    head: { group: "\u8EAF\u5E72", label: "\u5934" },
    upperArmL: { group: "\u5DE6\u81C2", label: "\u4E0A\u81C2" },
    lowerArmL: { group: "\u5DE6\u81C2", label: "\u8098" },
    handL: { group: "\u5DE6\u81C2", label: "\u624B" },
    upperArmR: { group: "\u53F3\u81C2", label: "\u4E0A\u81C2" },
    lowerArmR: { group: "\u53F3\u81C2", label: "\u8098" },
    handR: { group: "\u53F3\u81C2", label: "\u624B" },
    thighL: { group: "\u5DE6\u817F", label: "\u9ACB" },
    shinL: { group: "\u5DE6\u817F", label: "\u819D" },
    footL: { group: "\u5DE6\u817F", label: "\u811A" },
    thighR: { group: "\u53F3\u817F", label: "\u9ACB" },
    shinR: { group: "\u53F3\u817F", label: "\u819D" },
    footR: { group: "\u53F3\u817F", label: "\u811A" }
  };
  var AXIS_LABEL = {
    rotation: "\u77E2\u72B6",
    swing: "\u4FA7\u6446",
    twist: "\u626D\u8F6C"
  };
  var canvas = document.querySelector("#view");
  var panel = document.querySelector("#pose");
  if (canvas === null || panel === null) throw new Error("view");
  var ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2d");
  var humanoid = createHumanoid(HEIGHT);
  var compiled = compileHumanoid(humanoid);
  var pose = createPose(humanoid.skeleton);
  var fk = new Float32Array(humanoid.skeleton.boneCount * 12);
  var controls = buildControls(compiled);
  var tie = drawOrder(new Array(compiled.slots.slots.length), compiled.slots, FACING);
  var restFrame = contain(projectParts(sample2(compiled, pose, fk), FRONT_VIEW));
  var sliders = /* @__PURE__ */ new Map();
  var readouts = /* @__PURE__ */ new Map();
  mountPose(panel);
  new ResizeObserver(() => draw()).observe(canvas.parentElement ?? canvas);
  void loadGrayTextures().then(() => {
    texturesReady = true;
    draw();
  });
  function mountPose(root) {
    const title = document.createElement("h1");
    title.textContent = "\u59FF\u52BF";
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "0\xB0 \u662F\u7ED1\u5B9A\u7AD9\u59FF\u3002\u672A\u9501\u6B7B\u7684\u8F74\u5404\u6709\u4E00\u4E2A\u6ED1\u5757\u3002\u77E2\u72B6\u6B63\u89D2\u9006\u65F6\u9488\uFF0C\u8098\u671D\u524D\u5F2F\uFF0C\u819D\u671D\u540E\u5F2F\u3002\u4FA7\u6446\u6B63\u503C\u8BA9\u624B\u81C2\u548C\u817F\u79BB\u5F00\u8EAF\u5E72\u3002\u9AA8\u76C6\u4E09\u8F74\u7528 \xB145\xB0\uFF0C\u5176\u4F59\u6ED1\u5757\u7528\u5F15\u64CE\u7684\u6D3B\u52A8\u8303\u56F4\u3002";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "reset";
    reset.textContent = "\u590D\u4F4D\u5230 0\xB0";
    reset.addEventListener("click", () => {
      for (const control of controls) {
        const slider = sliders.get(control.id);
        if (slider === void 0) continue;
        slider.value = "0";
        writeReadout(control);
      }
      draw();
    });
    root.append(title, note, reset);
    let group = "";
    for (const control of controls) {
      if (control.group !== group) {
        group = control.group;
        const heading = document.createElement("h2");
        heading.textContent = group;
        root.append(heading);
      }
      const row = document.createElement("div");
      row.className = "joint";
      const name = document.createElement("span");
      name.textContent = control.label;
      const down = document.createElement("button");
      down.type = "button";
      down.textContent = "\u2212";
      down.setAttribute("aria-label", `${control.group}${control.label}\u51CF ${STEP} \u5EA6`);
      const up = document.createElement("button");
      up.type = "button";
      up.textContent = "+";
      up.setAttribute("aria-label", `${control.group}${control.label}\u52A0 ${STEP} \u5EA6`);
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = String(control.min);
      slider.max = String(control.max);
      slider.step = "1";
      slider.value = "0";
      slider.setAttribute("aria-label", `${control.group}${control.label}`);
      const range2 = document.createElement("div");
      range2.className = "range";
      row.append(name, down, slider, up, range2);
      root.append(row);
      sliders.set(control.id, slider);
      readouts.set(control.id, range2);
      const apply = () => {
        writeReadout(control);
        draw();
      };
      slider.addEventListener("input", apply);
      down.addEventListener("click", () => nudge(control, -STEP));
      up.addEventListener("click", () => nudge(control, STEP));
      writeReadout(control);
    }
  }
  function nudge(control, delta) {
    const slider = sliders.get(control.id);
    if (slider === void 0) return;
    const next = Math.min(control.max, Math.max(control.min, Number(slider.value) + delta));
    slider.value = String(next);
    writeReadout(control);
    draw();
  }
  function writeReadout(control) {
    const readout = readouts.get(control.id);
    const slider = sliders.get(control.id);
    if (readout === void 0 || slider === void 0) return;
    readout.textContent = `${formatDeg(Number(slider.value))} \xB7 \u53EF\u6D3B\u52A8 ${formatDeg(control.min)} ~ ${formatDeg(control.max)}`;
  }
  var texturesReady = false;
  async function loadGrayTextures() {
    const response = await fetch("./textures/manifest.json");
    if (!response.ok) throw new Error("texture");
    const manifest = await response.json();
    const byId = new Map(compiled.meshes.meshes.map((mesh) => [mesh.partId, mesh]));
    const jobs = [];
    for (const part of manifest.parts) {
      const mesh = byId.get(part.partId);
      if (mesh === void 0 || mesh.indices.length / 3 !== part.count) throw new Error("texture");
      for (let index = 0; index < part.count; index += 1) jobs.push({ partId: part.partId, index });
    }
    const decoded = /* @__PURE__ */ new Map();
    for (const part of manifest.parts) decoded.set(part.partId, new Array(part.count));
    const scratch = document.createElement("canvas");
    const scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
    if (scratchCtx === null) throw new Error("2d");
    const batch = 24;
    for (let start = 0; start < jobs.length; start += batch) {
      const slice = jobs.slice(start, start + batch);
      const bitmaps = await Promise.all(
        slice.map(async (job) => {
          const image = await fetch(`./textures/${job.partId}/${job.index}.png`);
          if (!image.ok) throw new Error("texture");
          return createImageBitmap(await image.blob());
        })
      );
      for (let i = 0; i < slice.length; i += 1) {
        const bitmap = bitmaps[i];
        const job = slice[i];
        if (scratch.width !== bitmap.width || scratch.height !== bitmap.height) {
          scratch.width = bitmap.width;
          scratch.height = bitmap.height;
        }
        scratchCtx.drawImage(bitmap, 0, 0);
        const pixels = scratchCtx.getImageData(0, 0, bitmap.width, bitmap.height).data;
        const rgb = new Uint8Array(bitmap.width * bitmap.height * 3);
        for (let pixel = 0; pixel < bitmap.width * bitmap.height; pixel += 1) {
          rgb[pixel * 3] = pixels[pixel * 4];
          rgb[pixel * 3 + 1] = pixels[pixel * 4 + 1];
          rgb[pixel * 3 + 2] = pixels[pixel * 4 + 2];
        }
        decoded.get(job.partId)[job.index] = { width: bitmap.width, height: bitmap.height, rgb };
        bitmap.close();
      }
    }
    for (const part of manifest.parts) {
      const textures = decoded.get(part.partId);
      byId.get(part.partId).textures = textures;
    }
  }
  function draw() {
    if (!texturesReady) return;
    const stage = canvas.parentElement;
    const cssWidth = stage?.clientWidth ?? window.innerWidth;
    const cssHeight = stage?.clientHeight ?? window.innerHeight;
    if (cssWidth < 2 || cssHeight < 2) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    applyPose();
    const sampled = sample2(compiled, pose, fk);
    const projected = projectParts(sampled, FRONT_VIEW);
    const filled = fillProjected(
      projected,
      compiled.parts.parts.map((part) => part.fill)
    );
    const textured = textureProjected(compiled, projected);
    const stroked = strokeContours(filled, true);
    const order = depthOrder(new Array(projected.length), projected, tie);
    const frame = fit(restFrame, canvas.width, canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    paintTextures(textured, order, frame, pixels);
    ctx.putImageData(pixels, 0, 0);
    const byFill = new Map(filled.map((part) => [part.partId, part]));
    const byStroke = new Map(stroked.map((part) => [part.partId, part]));
    for (let i = 0; i < order.length; i += 1) {
      const id = order[i];
      const part = byFill.get(id);
      if (part === void 0) continue;
      const contour = byStroke.get(id);
      if (contour !== void 0) paintStroke(contour, frame);
    }
  }
  function paintTextures(parts, order, frame, image) {
    const uv = new Float32Array(2);
    const corners = new Float32Array(6);
    const byId = new Map(parts.map((part) => [part.partId, part]));
    const width = image.width;
    const height = image.height;
    const data = image.data;
    for (let i = 0; i < order.length; i += 1) {
      const part = byId.get(order[i]);
      if (part === void 0 || part.textures.length === 0) continue;
      const positions = part.positions;
      const indices = part.indices;
      for (let t = 0; t < indices.length; t += 3) {
        const ia = indices[t];
        const ib = indices[t + 1];
        const ic = indices[t + 2];
        const ax = frame.originX + positions[ia * 2] * frame.scale;
        const ay = frame.originY - positions[ia * 2 + 1] * frame.scale;
        const bx = frame.originX + positions[ib * 2] * frame.scale;
        const by = frame.originY - positions[ib * 2 + 1] * frame.scale;
        const cx = frame.originX + positions[ic * 2] * frame.scale;
        const cy = frame.originY - positions[ic * 2 + 1] * frame.scale;
        const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(denom) <= 1e-8) continue;
        const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
        const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
        const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
        const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
        corners.set(part.uvs.subarray(t * 2, t * 2 + 6));
        const texture = part.textures[part.triangleTexture[t / 3]];
        if (texture === void 0) continue;
        for (let y = minY; y <= maxY; y += 1) {
          for (let x = minX; x <= maxX; x += 1) {
            const px = x + 0.5;
            const py = y + 0.5;
            const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
            const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
            const w2 = 1 - w0 - w1;
            if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
            triangleUv(uv, ax, ay, bx, by, cx, cy, px, py, corners);
            const color = sampleTexture(texture, uv[0], uv[1]);
            const pixel = (y * width + x) * 4;
            data[pixel] = Math.round(color.r * 255);
            data[pixel + 1] = Math.round(color.g * 255);
            data[pixel + 2] = Math.round(color.b * 255);
            data[pixel + 3] = 255;
          }
        }
      }
    }
  }
  function applyPose() {
    for (const control of controls) {
      const slider = sliders.get(control.id);
      const radians = (slider === void 0 ? 0 : Number(slider.value)) * Math.PI / 180;
      const bone = humanoid.boneIndex[control.bone];
      if (control.axis === "rotation") setPoseRotation(pose, bone, radians);
      else if (control.axis === "swing") setPoseSwing(pose, bone, radians);
      else setPoseTwist(pose, bone, radians);
    }
  }
  function paintStroke(part, frame) {
    ctx.fillStyle = STROKE;
    for (let q = 0; q < part.quads.length; q += 1) {
      const quad2 = part.quads[q];
      ctx.beginPath();
      move(quad2.positions, frame, quad2.indices[0]);
      line(quad2.positions, frame, quad2.indices[1]);
      line(quad2.positions, frame, quad2.indices[2]);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      move(quad2.positions, frame, quad2.indices[3]);
      line(quad2.positions, frame, quad2.indices[4]);
      line(quad2.positions, frame, quad2.indices[5]);
      ctx.closePath();
      ctx.fill();
    }
  }
  function sample2(rig, current, rigFromBone) {
    evaluateFk(rigFromBone, rig, current, rig.skeleton.boneCount);
    return rig.meshes.meshes.map((mesh, index) => {
      const positions = new Float32Array(mesh.positions.length);
      skinMesh(positions, rig, rigFromBone, index, current);
      return { partId: mesh.partId, positions, indices: mesh.indices, seam: mesh.seam };
    });
  }
  function buildControls(rig) {
    const list = [];
    for (const joint of rig.joints) {
      const bone = BONE_NAMES[joint.bone];
      if (bone === void 0) continue;
      const ui = BONE_UI[bone];
      addAxis(list, bone, ui, "rotation", 1, joint.rotation);
      addAxis(list, bone, ui, "swing", joint.swingSign, joint.swing);
      addAxis(list, bone, ui, "twist", joint.twistSign, joint.twist);
    }
    return list;
  }
  function addAxis(list, bone, ui, axis, sign, limit) {
    if (axis !== "rotation" && sign === 0) return;
    const span2 = limit === null ? { min: -45, max: 45 } : { min: degrees(limit.min), max: degrees(limit.max) };
    list.push({
      id: `${bone}:${axis}`,
      bone,
      axis,
      group: ui.group,
      label: `${ui.label} \xB7 ${AXIS_LABEL[axis]}`,
      min: span2.min,
      max: span2.max
    });
  }
  function contain(parts) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let p = 0; p < parts.length; p += 1) {
      const positions = parts[p].positions;
      for (let i = 0; i < positions.length; i += 2) {
        const x = positions[i];
        const y = positions[i + 1];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    const spanX = Math.max(1e-4, maxX - minX);
    const spanY = Math.max(1e-4, maxY - minY);
    return {
      minX: minX - spanX * 0.12,
      maxX: maxX + spanX * 0.12,
      minY: minY - spanY * 0.06,
      maxY: maxY + spanY * 0.06
    };
  }
  function fit(bounds, width, height) {
    const scale3 = Math.min(width / (bounds.maxX - bounds.minX), height / (bounds.maxY - bounds.minY));
    const usedW = (bounds.maxX - bounds.minX) * scale3;
    const usedH = (bounds.maxY - bounds.minY) * scale3;
    return {
      ...bounds,
      scale: scale3,
      originX: (width - usedW) / 2 - bounds.minX * scale3,
      originY: (height - usedH) / 2 + bounds.maxY * scale3
    };
  }
  function move(positions, frame, index) {
    ctx.moveTo(frame.originX + positions[index * 2] * frame.scale, frame.originY - positions[index * 2 + 1] * frame.scale);
  }
  function line(positions, frame, index) {
    ctx.lineTo(frame.originX + positions[index * 2] * frame.scale, frame.originY - positions[index * 2 + 1] * frame.scale);
  }
  function degrees(radians) {
    return Math.round(radians * 180 / Math.PI);
  }
  function formatDeg(value) {
    if (value < 0) return `\u2212${Math.abs(value)}\xB0`;
    if (value > 0) return `+${value}\xB0`;
    return "0\xB0";
  }
})();
