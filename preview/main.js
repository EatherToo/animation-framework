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
  function meshFromStrip(partId, space, segments, fill) {
    if (segments.length === 0) throw new Error("segments");
    const intervals = segments.length * AXIAL_STEPS;
    const stations = intervals + 1;
    const positions = new Float32Array(stations * TUBE_SIDES * 3);
    const indices = new Uint16Array(intervals * TUBE_SIDES * 6);
    writeTube(positions, indices, segments);
    return { partId, space, positions, indices, ...createMeshTextures(indices, fill) };
  }
  function meshFromCappedTube(partId, space, segments, fill) {
    if (segments.length === 0) throw new Error("segments");
    const intervals = segments.length * AXIAL_STEPS;
    const stations = intervals + 1;
    const ring = stations * TUBE_SIDES;
    const positions = new Float32Array((ring + 2) * 3);
    const sides = intervals * TUBE_SIDES * 6;
    const indices = new Uint16Array(sides + TUBE_SIDES * 6);
    writeTube(positions, indices, segments);
    const first = segments[0];
    const last = segments[segments.length - 1];
    const start = ring;
    const end = ring + 1;
    positions[start * 3] = first.x0;
    positions[start * 3 + 1] = first.y0;
    positions[start * 3 + 2] = first.z0;
    positions[end * 3] = last.x1;
    positions[end * 3 + 1] = last.y1;
    positions[end * 3 + 2] = last.z1;
    const tail = (stations - 1) * TUBE_SIDES;
    for (let j = 0; j < TUBE_SIDES; j += 1) {
      const next = (j + 1) % TUBE_SIDES;
      const t = sides + j * 6;
      indices[t] = start;
      indices[t + 1] = next;
      indices[t + 2] = j;
      indices[t + 3] = end;
      indices[t + 4] = tail + j;
      indices[t + 5] = tail + next;
    }
    return { partId, space, positions, indices, ...createMeshTextures(indices, fill) };
  }
  function meshFromCappedSection(partId, space, x0, y0, z0, x1, y1, z1, section, fill) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = Math.hypot(dx, dy);
    if (!(len2 > 0)) throw new Error("segments");
    const px = -dy / len2;
    const py = dx / len2;
    const ring = (AXIAL_STEPS + 1) * TUBE_SIDES;
    const positions = new Float32Array((ring + 2) * 3);
    const sides = AXIAL_STEPS * TUBE_SIDES * 6;
    const indices = new Uint16Array(sides + TUBE_SIDES * 6);
    for (let k = 0; k <= AXIAL_STEPS; k += 1) {
      const t = k / AXIAL_STEPS;
      const x = x0 + dx * t;
      const y = y0 + dy * t;
      const z = z0 + (z1 - z0) * t;
      for (let j = 0; j < TUBE_SIDES; j += 1) {
        const theta = j * 2 * Math.PI / TUBE_SIDES;
        const offset = section(t, theta);
        writeOffset(positions, k, j, x, y, z, px, py, offset.along, offset.lateral);
      }
    }
    writeIntervals(indices, AXIAL_STEPS);
    writeCap(positions, indices, 0, ring, sides, false);
    writeCap(positions, indices, AXIAL_STEPS, ring + 1, sides + TUBE_SIDES * 3, true);
    return { partId, space, positions, indices, ...createMeshTextures(indices, fill) };
  }
  function writeTube(positions, indices, segments) {
    let previousEnd = Number.NaN;
    for (let b = 0; b < segments.length; b += 1) {
      const seg = segments[b];
      const startRadius = radiusAt(seg.profile, 0);
      if (b > 0 && Math.abs(previousEnd - startRadius) > 1e-6) throw new Error("radius");
      previousEnd = radiusAt(seg.profile, 1);
      for (let k = b === 0 ? 0 : 1; k <= AXIAL_STEPS; k += 1) {
        const t = k / AXIAL_STEPS;
        const radius = radiusAt(seg.profile, t);
        const x = seg.x0 + (seg.x1 - seg.x0) * t;
        const y = seg.y0 + (seg.y1 - seg.y0) * t;
        const z = seg.z0 + (seg.z1 - seg.z0) * t;
        for (let j = 0; j < TUBE_SIDES; j += 1) {
          const theta = j * 2 * Math.PI / TUBE_SIDES;
          writeOffset(
            positions,
            b * AXIAL_STEPS + k,
            j,
            x,
            y,
            z,
            seg.px,
            seg.py,
            radius * Math.cos(theta),
            radius * Math.sin(theta)
          );
        }
      }
    }
    writeIntervals(indices, segments.length * AXIAL_STEPS);
  }
  function radiusAt(profile2, t) {
    if (profile2.length < 2) throw new Error("radius");
    let previous = -1;
    for (let i = 0; i < profile2.length; i += 1) {
      const sample2 = profile2[i];
      if (!Number.isFinite(sample2.t) || !Number.isFinite(sample2.radius) || !(sample2.radius > 0)) {
        throw new Error("radius");
      }
      if (sample2.t <= previous) throw new Error("radius");
      previous = sample2.t;
    }
    const first = profile2[0];
    const last = profile2[profile2.length - 1];
    if (first.t !== 0 || last.t !== 1) throw new Error("radius");
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
  function writeOffset(positions, station, j, x, y, z, px, py, along, lateral) {
    const base = (station * TUBE_SIDES + j) * 3;
    positions[base] = x + px * along;
    positions[base + 1] = y + py * along;
    positions[base + 2] = z + lateral;
  }
  function writeIntervals(indices, intervals) {
    for (let i = 0; i < intervals; i += 1) {
      const near2 = i * TUBE_SIDES;
      const far = near2 + TUBE_SIDES;
      for (let j = 0; j < TUBE_SIDES; j += 1) {
        const next = (j + 1) % TUBE_SIDES;
        const t = (i * TUBE_SIDES + j) * 6;
        indices[t] = near2 + j;
        indices[t + 1] = near2 + next;
        indices[t + 2] = far + j;
        indices[t + 3] = near2 + next;
        indices[t + 4] = far + next;
        indices[t + 5] = far + j;
      }
    }
  }
  function writeCap(positions, indices, station, center, indexBase, reverse) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let j = 0; j < TUBE_SIDES; j += 1) {
      const base = (station * TUBE_SIDES + j) * 3;
      x += positions[base];
      y += positions[base + 1];
      z += positions[base + 2];
    }
    positions[center * 3] = x / TUBE_SIDES;
    positions[center * 3 + 1] = y / TUBE_SIDES;
    positions[center * 3 + 2] = z / TUBE_SIDES;
    const ring = station * TUBE_SIDES;
    for (let j = 0; j < TUBE_SIDES; j += 1) {
      const next = (j + 1) % TUBE_SIDES;
      const t = indexBase + j * 3;
      indices[t] = center;
      indices[t + 1] = ring + (reverse ? j : next);
      indices[t + 2] = ring + (reverse ? next : j);
    }
  }

  // packages/render-engine/src/mesh/humanoid.ts
  var MIN_LENGTH = 1e-5;
  var JOIN_DISTANCE_SQ = 1e-8;
  function createHumanoidMeshes(humanoid2, parts) {
    if (parts.skeleton !== humanoid2.skeleton) throw new Error("skeleton");
    const rig = writeBindRig(humanoid2.skeleton);
    const lateral = writeBindLateral(humanoid2.skeleton);
    const meshes = [];
    for (let i = 0; i < parts.parts.length; i += 1) {
      const part = parts.parts[i];
      if (part.kind === "skinned") {
        meshes.push(tubeMesh(part, humanoid2.skeleton, humanoid2.proportions, rig, lateral));
      } else {
        meshes.push(rigidMesh(part.id, part.bone, humanoid2.skeleton, humanoid2.proportions, part.fill));
      }
    }
    return { meshes };
  }
  function tubeMesh(part, skeleton, proportions, rig, lateral) {
    const segments = [];
    for (let i = 0; i < part.bones.length; i += 1) {
      const bone = part.bones[i];
      const length2 = bindLength(skeleton, bone);
      if (length2 <= MIN_LENGTH) continue;
      const name = boneName(skeleton, bone);
      const base = bone * 9;
      const ox = rig[base + 6];
      const oy = rig[base + 7];
      const ax = rig[base];
      const ay = rig[base + 1];
      const x1 = ox + ax * length2;
      const y1 = oy + ay * length2;
      const next = i + 1 < part.bones.length ? part.bones[i + 1] : -1;
      if (next >= 0) {
        const nx = rig[next * 9 + 6];
        const ny = rig[next * 9 + 7];
        const dx = nx - x1;
        const dy = ny - y1;
        if (dx * dx + dy * dy > JOIN_DISTANCE_SQ) continue;
      }
      const z = lateral[bone];
      segments.push(segment(ox, oy, z, x1, y1, z, profileOf(name, proportions)));
    }
    return meshFromStrip(part.id, "character", segments, part.fill);
  }
  function segment(x0, y0, z0, x1, y1, z1, profile2) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = Math.hypot(dx, dy);
    return { x0, y0, z0, x1, y1, z1, px: -dy / len2, py: dx / len2, profile: profile2 };
  }
  function rigidMesh(partId, bone, skeleton, proportions, fill) {
    const length2 = bindLength(skeleton, bone);
    const name = boneName(skeleton, bone);
    if (name === "head") {
      return meshFromCappedTube(partId, "part", [segment(0, 0, 0, length2, 0, 0, proportions.headProfile)], fill);
    }
    if (name === "handL" || name === "handR") return handMesh(partId, name === "handL" ? 1 : -1, length2, proportions, fill);
    if (name === "footL" || name === "footR") return footMesh(partId, proportions, fill);
    throw new Error("part");
  }
  function handMesh(partId, side, length2, proportions, fill) {
    const palmEnd = proportions.palmFraction * length2;
    const pieces = [
      meshFromCappedTube(partId, "part", [segment(0, 0, 0, palmEnd, 0, 0, constantProfile(proportions.palmRadius))], fill)
    ];
    for (const spread of [-proportions.fingerSpread[1], -proportions.fingerSpread[0], proportions.fingerSpread[0], proportions.fingerSpread[1]]) {
      pieces.push(
        meshFromCappedTube(
          partId,
          "part",
          [segment(palmEnd, 0, spread, length2, 0, spread, constantProfile(proportions.fingerRadius))],
          fill
        )
      );
    }
    const thumbX = proportions.thumbAlong * length2;
    const thumbZ = side * proportions.thumbOffsetZ;
    pieces.push(
      meshFromCappedTube(
        partId,
        "part",
        [
          segment(
            thumbX,
            -proportions.thumbDrop,
            thumbZ,
            thumbX + proportions.thumbFraction * length2,
            -proportions.thumbDrop,
            thumbZ,
            constantProfile(proportions.thumbRadius)
          )
        ],
        fill
      )
    );
    return concatenate(partId, pieces, fill);
  }
  function footMesh(partId, proportions, fill) {
    return meshFromCappedSection(
      partId,
      "part",
      -proportions.heelBack,
      0,
      0,
      proportions.footLength,
      0,
      0,
      (t, theta) => {
        const lifted = Math.max(0, (Math.sin(theta) + 1) / 2);
        return {
          along: -proportions.ankleHeight + radiusAt2(proportions.footInstep, t) * lifted,
          lateral: -radiusAt2(proportions.footHalfWidth, t) * Math.cos(theta)
        };
      },
      fill
    );
  }
  function concatenate(partId, pieces, fill) {
    let floats = 0;
    let indexCount = 0;
    for (const piece of pieces) {
      floats += piece.positions.length;
      indexCount += piece.indices.length;
    }
    const positions = new Float32Array(floats);
    const indices = new Uint16Array(indexCount);
    let floatOffset = 0;
    let indexOffset = 0;
    let vertexBase = 0;
    for (const piece of pieces) {
      positions.set(piece.positions, floatOffset);
      for (let i = 0; i < piece.indices.length; i += 1) indices[indexOffset + i] = piece.indices[i] + vertexBase;
      floatOffset += piece.positions.length;
      indexOffset += piece.indices.length;
      vertexBase += piece.positions.length / 3;
    }
    return { partId, space: "part", positions, indices, ...createMeshTextures(indices, fill) };
  }
  function constantProfile(radius) {
    return [
      { t: 0, radius },
      { t: 1, radius }
    ];
  }
  function profileOf(name, proportions) {
    switch (name) {
      case "pelvis":
      case "spine":
        return proportions.spineProfile;
      case "chest":
        return proportions.chestProfile;
      case "neck":
        return proportions.neckProfile;
      case "upperArmL":
      case "upperArmR":
        return proportions.upperArmProfile;
      case "lowerArmL":
      case "lowerArmR":
        return proportions.lowerArmProfile;
      case "thighL":
      case "thighR":
        return proportions.thighProfile;
      case "shinL":
      case "shinR":
        return proportions.shinProfile;
      default:
        throw new Error("bone");
    }
  }
  function radiusAt2(profile2, t) {
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
    { id: "torso", kind: "skinned", bones: ["pelvis", "spine", "chest", "neck"] },
    { id: "head", kind: "rigid", bones: ["head"] },
    { id: "armL", kind: "skinned", bones: ["upperArmL", "lowerArmL"] },
    { id: "handL", kind: "rigid", bones: ["handL"] },
    { id: "armR", kind: "skinned", bones: ["upperArmR", "lowerArmR"] },
    { id: "handR", kind: "rigid", bones: ["handR"] },
    { id: "legL", kind: "skinned", bones: ["thighL", "shinL"] },
    { id: "footL", kind: "rigid", bones: ["footL"] },
    { id: "legR", kind: "skinned", bones: ["thighR", "shinR"] },
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

  // packages/render-engine/src/correction/correction.ts
  function createCorrection() {
    return { enabled: false };
  }
  function applyCorrection(out, positions, correction) {
    if (correction.enabled !== false) throw new Error("correction");
    if (out.length !== positions.length) throw new Error("out");
    out.set(positions);
    return out;
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

  // packages/render-engine/src/skeleton/rigid.ts
  var RIGID_STRIDE = 12;
  function setRigidParentFromBone(out, skeleton, pose2, bone, swingSign, twistSign) {
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
    const b = twistSign * twist;
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
      link(neighbors, used, t, a, b);
      link(neighbors, used, t, b, c);
      link(neighbors, used, t, c, a);
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
    if (visited === triangleCount) return;
    for (const edge of edges.values()) {
      if (edge.count !== 2) throw new Error("connectivity");
    }
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
  function link(neighbors, used, triangle, from, to) {
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
      weights.push(weightPart(part, mesh.positions, rig, humanoid2.skeleton));
    }
    return { weights };
  }
  function weightPart(part, positions, rig, skeleton) {
    const segments = [];
    for (let i = 0; i < part.bones.length; i += 1) {
      const bone = part.bones[i];
      const length2 = bindLength(skeleton, bone);
      if (length2 <= 1e-5) continue;
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
    }
    return { partId: part.id, influences, weights };
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
      if (mesh.partId !== parts.parts[i].id) throw new Error("mesh");
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
      if (found === void 0 || found.influences !== part.bones.length || found.weights.length !== vertexCount * part.bones.length) {
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
        fill: fills[i]
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
  function skinMesh(out, compiled2, fk2, meshIndex) {
    const mesh = compiled2.meshes.meshes[meshIndex];
    if (mesh === void 0) throw new Error("mesh");
    if (fk2.length !== compiled2.skeleton.boneCount * RIGID_STRIDE) throw new Error("fk");
    if (out.length !== mesh.positions.length) throw new Error("out");
    const corrected = new Float32Array(mesh.positions.length);
    applyCorrection(corrected, mesh.positions, compiled2.correction);
    const part = compiled2.parts.parts[meshIndex];
    if (part.kind === "skinned") skinSkinned(out, compiled2, fk2, corrected, part);
    else skinRigid(out, fk2, corrected, part);
  }
  function skinSkinned(out, compiled2, fk2, positions, part) {
    const found = compiled2.weights.weights.find((item) => item.partId === part.id);
    if (found === void 0) throw new Error("weight");
    const inverse2 = compiled2.inverseBind;
    const vertexCount = positions.length / 3;
    for (let v = 0; v < vertexCount; v += 1) {
      const x = positions[v * 3];
      const y = positions[v * 3 + 1];
      const z = positions[v * 3 + 2];
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let i = 0; i < part.bones.length; i += 1) {
        const weight = found.weights[v * found.influences + i];
        if (weight === 0) continue;
        const bone = part.bones[i];
        const local = applyRigid(inverse2, bone, x, y, z);
        const world = applyRigid(fk2, bone, local.x, local.y, local.z);
        sx += weight * world.x;
        sy += weight * world.y;
        sz += weight * world.z;
      }
      out[v * 3] = sx;
      out[v * 3 + 1] = sy;
      out[v * 3 + 2] = sz;
    }
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
    const edges = [];
    for (const item of nets.values()) {
      if (item.net === 0) continue;
      const from = item.net > 0 ? item.lo : item.hi;
      const to = item.net > 0 ? item.hi : item.lo;
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
      projected.push({ partId: part.partId, positions, indices, depth });
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
  var restFrame = contain(projectParts(sample(compiled, pose, fk), FRONT_VIEW));
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
    const sampled = sample(compiled, pose, fk);
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
  function sample(rig, current, rigFromBone) {
    evaluateFk(rigFromBone, rig, current, rig.skeleton.boneCount);
    return rig.meshes.meshes.map((mesh, index) => {
      const positions = new Float32Array(mesh.positions.length);
      skinMesh(positions, rig, rigFromBone, index);
      return { partId: mesh.partId, positions, indices: mesh.indices };
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
