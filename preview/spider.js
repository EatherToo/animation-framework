"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/math/angle.ts
  var TAU = Math.PI * 2;
  function normalizeAngle(rad) {
    if (!Number.isFinite(rad)) return rad;
    let r = ((rad + Math.PI) % TAU + TAU) % TAU - Math.PI;
    if (r === -Math.PI) r = Math.PI;
    return r;
  }

  // src/skeleton/skeleton.ts
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
    const { translationX: tx, translationY: ty, rotation, length: length2 } = spec;
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(rotation) || !Number.isFinite(length2) || length2 < 0) {
      throw new Error("bind");
    }
    builder.names.push(spec.name);
    builder.parent.push(spec.parent);
    builder.translationX.push(tx);
    builder.translationY.push(ty);
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
    const bindRotation2 = new Float32Array(boneCount);
    const bindLength2 = new Float32Array(boneCount);
    for (let i = 0; i < boneCount; i += 1) {
      parent[i] = builder.parent[i];
      bindTranslation2[i * 2] = builder.translationX[i];
      bindTranslation2[i * 2 + 1] = builder.translationY[i];
      bindRotation2[i] = builder.rotation[i];
      bindLength2[i] = builder.length[i];
    }
    builder.finished = true;
    return {
      boneCount,
      name,
      parent,
      bindTranslation: bindTranslation2,
      bindRotation: bindRotation2,
      bindLength: bindLength2
    };
  }
  function parentOf(skeleton, bone2) {
    return skeleton.parent[bone2];
  }
  function boneName(skeleton, bone2) {
    return skeleton.name[bone2];
  }
  function findBone(skeleton, name) {
    for (let i = 0; i < skeleton.boneCount; i += 1) {
      if (skeleton.name[i] === name) return i;
    }
    return PARENT_NONE;
  }
  function bindTranslation(out, skeleton, bone2) {
    const i = bone2 * 2;
    out[0] = skeleton.bindTranslation[i];
    out[1] = skeleton.bindTranslation[i + 1];
    return out;
  }
  function bindRotation(skeleton, bone2) {
    return skeleton.bindRotation[bone2];
  }
  function bindLength(skeleton, bone2) {
    return skeleton.bindLength[bone2];
  }

  // src/body/chains.ts
  var LEG_BEND_SIGN = 1;
  var ARM_BEND_SIGN = -1;
  var LEG_ROM_MIN = -2.618;
  var LEG_ROM_MAX = 0.035;
  var ARM_ROM_MIN = -2.443;
  var ARM_ROM_MAX = 0.175;
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

  // src/body/proportions.ts
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
    const stanceWidth = 0.1 * H;
    return {
      height: H,
      hipHeight,
      ankleHeight,
      pelvisLength: 0.05 * H,
      spineLength: 0.144 * H,
      chestLength: 0.144 * H,
      neckLength: 0.052 * H,
      headLength: 0.13 * H,
      upperArmLength: 0.186 * H,
      lowerArmLength: 0.146 * H,
      handLength: 0.108 * H,
      thighLength,
      shinLength,
      footLength: 0.152 * H,
      legLength: thighLength + shinLength,
      spineRadius: 0.045 * H,
      chestRadius: 0.055 * H,
      neckRadius: 0.025 * H,
      headRadius: 0.065 * H,
      upperArmRadius: 0.03 * H,
      lowerArmRadius: 0.024 * H,
      handRadius: 0.022 * H,
      thighRadius: 0.045 * H,
      shinRadius: 0.032 * H,
      footRadius: 0.028 * H,
      stanceWidth,
      hipOffsetX: stanceWidth / 2,
      shoulderOffsetX: 0.08 * H,
      hipDropY: hipHeight - thighLength - shinLength - ankleHeight,
      shoulderDropY: 0.02 * H,
      reachMargin: REACH_MARGIN
    };
  }

  // src/body/assemble.ts
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
      rotation: 0,
      length: p.pelvisLength
    });
    const spine = addBone(builder, {
      name: "spine",
      parent: pelvis,
      translationX: 0,
      translationY: 0,
      rotation: halfPi,
      length: p.spineLength
    });
    const chest = addBone(builder, {
      name: "chest",
      parent: spine,
      translationX: p.spineLength,
      translationY: 0,
      rotation: 0,
      length: p.chestLength
    });
    const neck = addBone(builder, {
      name: "neck",
      parent: chest,
      translationX: p.chestLength,
      translationY: 0,
      rotation: 0,
      length: p.neckLength
    });
    const head = addBone(builder, {
      name: "head",
      parent: neck,
      translationX: p.neckLength,
      translationY: 0,
      rotation: 0,
      length: p.headLength
    });
    const upperArmL2 = addBone(builder, {
      name: "upperArmL",
      parent: chest,
      translationX: -p.shoulderOffsetX,
      translationY: -p.shoulderDropY,
      rotation: -halfPi,
      length: p.upperArmLength
    });
    const lowerArmL = addBone(builder, {
      name: "lowerArmL",
      parent: upperArmL2,
      translationX: p.upperArmLength,
      translationY: 0,
      rotation: 0,
      length: p.lowerArmLength
    });
    const handL = addBone(builder, {
      name: "handL",
      parent: lowerArmL,
      translationX: p.lowerArmLength,
      translationY: 0,
      rotation: 0,
      length: p.handLength
    });
    const upperArmR2 = addBone(builder, {
      name: "upperArmR",
      parent: chest,
      translationX: p.shoulderOffsetX,
      translationY: -p.shoulderDropY,
      rotation: -halfPi,
      length: p.upperArmLength
    });
    const lowerArmR = addBone(builder, {
      name: "lowerArmR",
      parent: upperArmR2,
      translationX: p.upperArmLength,
      translationY: 0,
      rotation: 0,
      length: p.lowerArmLength
    });
    const handR = addBone(builder, {
      name: "handR",
      parent: lowerArmR,
      translationX: p.lowerArmLength,
      translationY: 0,
      rotation: 0,
      length: p.handLength
    });
    const thighL = addBone(builder, {
      name: "thighL",
      parent: pelvis,
      translationX: -p.hipOffsetX,
      translationY: -p.hipDropY,
      rotation: -halfPi,
      length: p.thighLength
    });
    const shinL = addBone(builder, {
      name: "shinL",
      parent: thighL,
      translationX: p.thighLength,
      translationY: 0,
      rotation: 0,
      length: p.shinLength
    });
    const footL = addBone(builder, {
      name: "footL",
      parent: shinL,
      translationX: p.shinLength,
      translationY: 0,
      rotation: halfPi,
      length: p.footLength
    });
    const thighR = addBone(builder, {
      name: "thighR",
      parent: pelvis,
      translationX: p.hipOffsetX,
      translationY: -p.hipDropY,
      rotation: -halfPi,
      length: p.thighLength
    });
    const shinR = addBone(builder, {
      name: "shinR",
      parent: thighR,
      translationX: p.thighLength,
      translationY: 0,
      rotation: 0,
      length: p.shinLength
    });
    const footR = addBone(builder, {
      name: "footR",
      parent: shinR,
      translationX: p.shinLength,
      translationY: 0,
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
      upperArmL: upperArmL2,
      lowerArmL,
      handL,
      upperArmR: upperArmR2,
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
          root: upperArmL2,
          mid: lowerArmL,
          end: handL,
          bendSign: ARM_BEND_SIGN,
          romMin: ARM_ROM_MIN,
          romMax: ARM_ROM_MAX
        }),
        armR: makeTwoBoneChain({
          root: upperArmR2,
          mid: lowerArmR,
          end: handR,
          bendSign: ARM_BEND_SIGN,
          romMin: ARM_ROM_MIN,
          romMax: ARM_ROM_MAX
        })
      }
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

  // src/math/mat3.ts
  function createMat3() {
    return mat3_exports.create();
  }
  function multiplyMat3(out, a, b) {
    return mat3_exports.multiply(out, a, b);
  }
  function invertMat3(out, a) {
    for (let i = 0; i < 9; i += 1) {
      if (!Number.isFinite(a[i])) return false;
    }
    const det = mat3_exports.determinant(a);
    if (det === 0) return false;
    const a00 = a[0];
    const a01 = a[1];
    const a02 = a[2];
    const a10 = a[3];
    const a11 = a[4];
    const a12 = a[5];
    const a20 = a[6];
    const a21 = a[7];
    const a22 = a[8];
    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;
    const invDet = 1 / det;
    out[0] = b01 * invDet;
    out[1] = (-a22 * a01 + a02 * a21) * invDet;
    out[2] = (a12 * a01 - a02 * a11) * invDet;
    out[3] = b11 * invDet;
    out[4] = (a22 * a00 - a02 * a20) * invDet;
    out[5] = (-a12 * a00 + a02 * a10) * invDet;
    out[6] = b21 * invDet;
    out[7] = (-a21 * a00 + a01 * a20) * invDet;
    out[8] = (a11 * a00 - a01 * a10) * invDet;
    return true;
  }

  // src/skeleton/pose.ts
  var POSE_STRIDE = 3;
  function createPose(skeleton) {
    return {
      skeleton,
      data: new Float32Array(skeleton.boneCount * POSE_STRIDE)
    };
  }
  function setPoseTranslation(pose, bone2, x, y) {
    const i = bone2 * POSE_STRIDE;
    pose.data[i] = x;
    pose.data[i + 1] = y;
  }
  function setPoseRotation(pose, bone2, rotation) {
    pose.data[bone2 * POSE_STRIDE + 2] = normalizeAngle(rotation);
  }
  function poseTranslation(out, pose, bone2) {
    const i = bone2 * POSE_STRIDE;
    out[0] = pose.data[i];
    out[1] = pose.data[i + 1];
    return out;
  }
  function poseRotation(pose, bone2) {
    return pose.data[bone2 * POSE_STRIDE + 2];
  }
  function copyPose(out, src) {
    out.data.set(src.data);
    return out;
  }

  // src/skeleton/parent-from-bone.ts
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
  function setParentFromBone(out, skeleton, pose, bone2) {
    const i2 = bone2 * 2;
    const i3 = bone2 * POSE_STRIDE;
    return writeParentFromBone(
      out,
      skeleton.bindTranslation[i2],
      skeleton.bindTranslation[i2 + 1],
      skeleton.bindRotation[bone2],
      pose.data[i3],
      pose.data[i3 + 1],
      pose.data[i3 + 2]
    );
  }
  function setBindParentFromBone(out, skeleton, bone2) {
    const i2 = bone2 * 2;
    return writeParentFromBone(
      out,
      skeleton.bindTranslation[i2],
      skeleton.bindTranslation[i2 + 1],
      skeleton.bindRotation[bone2],
      0,
      0,
      0
    );
  }

  // src/fk/evaluate.ts
  function evaluateFk(out, compiled, pose, count) {
    if (pose.skeleton !== compiled.skeleton) throw new Error("pose");
    const boneCount = compiled.skeleton.boneCount;
    if (!Number.isInteger(count) || count < 1 || count > boneCount) throw new Error("count");
    if (out.length !== count * 9) throw new Error("out");
    const local = createMat3();
    const parent = createMat3();
    const combined = createMat3();
    for (let bone2 = 0; bone2 < count; bone2 += 1) {
      setParentFromBone(local, compiled.skeleton, pose, bone2);
      const parentIndex = compiled.skeleton.parent[bone2];
      const source = parentIndex < 0 ? local : combine(combined, parent, out, parentIndex, local);
      const dst = bone2 * 9;
      for (let k = 0; k < 9; k += 1) out[dst + k] = source[k];
    }
  }
  function combine(combined, parent, rig, parentIndex, local) {
    const src = parentIndex * 9;
    for (let k = 0; k < 9; k += 1) parent[k] = rig[src + k];
    return multiplyMat3(combined, parent, local);
  }

  // src/space/facing.ts
  function isFacing(x) {
    return x === 1 || x === -1;
  }
  function nearSide(facing) {
    return facing === 1 ? "right" : "left";
  }
  function farSide(facing) {
    return facing === 1 ? "left" : "right";
  }

  // src/params/params.ts
  var TAU2 = 0.25;
  function values(speed, facing) {
    return {
      speed,
      cadenceStyle: 1,
      crouch: 0,
      lean: 0,
      facing,
      armSwing: 0,
      spineBend: 0,
      breath: 0
    };
  }
  function createParams() {
    return { target: values(0, 1), current: values(0, 1) };
  }
  function finite(name, value) {
    if (!Number.isFinite(value)) throw new Error(name);
  }
  function unit(name, value) {
    finite(name, value);
    if (value < 0 || value > 1) throw new Error(name);
  }
  function setSpeed(params, speed) {
    finite("speed", speed);
    params.target.speed = speed;
  }
  function setCrouch(params, crouch2) {
    unit("crouch", crouch2);
    params.target.crouch = crouch2;
  }
  function setArmSwing(params, amount) {
    unit("armSwing", amount);
    params.target.armSwing = amount;
  }
  function setSpineBend(params, amount) {
    unit("spineBend", amount);
    params.target.spineBend = amount;
  }
  function setBreath(params, amount) {
    unit("breath", amount);
    params.target.breath = amount;
  }
  function stepParams(params, dt) {
    finite("dt", dt);
    if (dt <= 0) throw new Error("dt");
    const k = 1 - Math.exp(-dt / TAU2);
    const keys = ["speed", "cadenceStyle", "crouch", "lean", "armSwing", "spineBend", "breath"];
    for (const key of keys) {
      params.current[key] += (params.target[key] - params.current[key]) * k;
    }
  }

  // src/math/vec2.ts
  function createVec2() {
    return vec2_exports.create();
  }
  function setVec2(out, x, y) {
    out[0] = x;
    out[1] = y;
    return out;
  }

  // src/foot/contact.ts
  function ankleFromContact(out, contact, soleLocal2, pitch) {
    assertPitch(pitch);
    assertPoint(contact);
    assertPoint(soleLocal2);
    return writeRotated(out, soleLocal2[0], soleLocal2[1], pitch, contact[0], contact[1], -1);
  }
  function lowestSoleOffset(out, shape, pitch) {
    assertPitch(pitch);
    const soleY2 = shape.ankleHeight === 0 ? 0 : -shape.ankleHeight;
    const qx = Math.fround(Math.sin(pitch) < 0 ? shape.toeForward : -shape.heelBack);
    const qy = Math.fround(soleY2);
    return writeRotated(out, qx, qy, pitch, 0, 0, 1);
  }
  function writeRotated(out, qx, qy, pitch, originX2, originY, sign) {
    const c = Math.cos(pitch);
    const s = Math.sin(pitch);
    const rx = c * qx - s * qy;
    const ry = s * qx + c * qy;
    return setVec2(out, originX2 + sign * rx, originY + sign * ry);
  }
  function assertPitch(pitch) {
    if (!Number.isFinite(pitch)) throw new Error("pitch");
  }
  function assertPoint(point) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      throw new Error("point");
    }
  }

  // src/foot/shape.ts
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
  function soleLocal(out, shape, u) {
    if (!Number.isFinite(u) || Object.is(u, -0) || u < 0 || u > 1) {
      throw new Error("u");
    }
    const y = soleY(shape);
    const x = u === 0 ? -shape.heelBack : u === 1 ? shape.toeForward : -shape.heelBack + u * shape.soleLength;
    return setVec2(out, x, y);
  }
  function stationLocal(out, shape, station) {
    const y = soleY(shape);
    if (station === "heel") return setVec2(out, -shape.heelBack, y);
    if (station === "flat") return setVec2(out, 0, y);
    if (station === "toe") return setVec2(out, shape.toeForward, y);
    throw new Error("station");
  }
  function soleY(shape) {
    return shape.ankleHeight === 0 ? 0 : -shape.ankleHeight;
  }

  // src/ik/solve.ts
  var HIT = 1e-4;
  var DIRECTIONLESS = 1e-8;
  function solveTwoBone(pose, compiled, chain3, targetX, targetY) {
    if (pose.skeleton !== compiled.skeleton) throw new Error("pose");
    const skeleton = compiled.skeleton;
    assertChain(skeleton, chain3);
    const length1 = bindLength(skeleton, chain3.root);
    const length2 = bindLength(skeleton, chain3.mid);
    if (!(length1 > 0) || !(length2 > 0)) throw new Error("length");
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) throw new Error("target");
    const parent = parentOf(skeleton, chain3.root);
    const fk2 = new Float32Array(skeleton.boneCount * 9);
    const parentMatrix = parentMatrixOf(fk2, compiled, pose, parent);
    const bind = bindTranslation(createVec2(), skeleton, chain3.root);
    const hipX = parentMatrix[0] * bind[0] + parentMatrix[3] * bind[1] + parentMatrix[6];
    const hipY = parentMatrix[1] * bind[0] + parentMatrix[4] * bind[1] + parentMatrix[7];
    const parentAngle = Math.atan2(parentMatrix[1], parentMatrix[0]);
    const bindRoot = bindRotation(skeleton, chain3.root);
    const bindMid = bindRotation(skeleton, chain3.mid);
    const offsetX = targetX - hipX;
    const offsetY = targetY - hipY;
    const distance2 = Math.hypot(offsetX, offsetY);
    const targetAngle = distance2 < DIRECTIONLESS ? 0 : Math.atan2(offsetY, offsetX);
    const solved = choose(
      chain3,
      distance2,
      targetAngle,
      length1,
      length2,
      hipX,
      hipY,
      targetX,
      targetY,
      parentAngle,
      bindRoot,
      bindMid
    );
    setPoseRotation(pose, chain3.root, solved.root);
    setPoseRotation(pose, chain3.mid, solved.mid);
    evaluateFk(fk2, compiled, pose, skeleton.boneCount);
    const end = chain3.end * 9;
    const error = Math.hypot(fk2[end + 6] - targetX, fk2[end + 7] - targetY);
    return { reached: error <= HIT };
  }
  function assertChain(skeleton, chain3) {
    const count = skeleton.boneCount;
    const valid = Number.isInteger(chain3.root) && Number.isInteger(chain3.mid) && Number.isInteger(chain3.end) && chain3.root >= 0 && chain3.mid >= 0 && chain3.end >= 0 && chain3.root < count && chain3.mid < count && chain3.end < count && parentOf(skeleton, chain3.mid) === chain3.root && parentOf(skeleton, chain3.end) === chain3.mid && (chain3.bendSign === 1 || chain3.bendSign === -1) && Number.isFinite(chain3.romMin) && Number.isFinite(chain3.romMax) && chain3.romMin < chain3.romMax;
    if (!valid) throw new Error("chain");
  }
  function parentMatrixOf(fk2, compiled, pose, parent) {
    if (parent < 0) {
      const identity2 = new Float32Array(9);
      identity2[0] = 1;
      identity2[4] = 1;
      identity2[8] = 1;
      return identity2;
    }
    const view = fk2.subarray(0, (parent + 1) * 9);
    evaluateFk(view, compiled, pose, parent + 1);
    return view.subarray(parent * 9, parent * 9 + 9);
  }
  function choose(chain3, distance2, targetAngle, length1, length2, hipX, hipY, targetX, targetY, parentAngle, bindRoot, bindMid) {
    const minDistance = Math.abs(length1 - length2);
    const maxDistance = length1 + length2;
    if (distance2 >= minDistance && distance2 <= maxDistance && distance2 >= DIRECTIONLESS) {
      const alpha = angleAtRoot(length1, length2, distance2);
      const preferred = placeSide(
        chain3.bendSign,
        alpha,
        targetAngle,
        length1,
        hipX,
        hipY,
        targetX,
        targetY,
        parentAngle,
        bindRoot,
        bindMid
      );
      if (inRom(preferred.mid, chain3)) return preferred;
      const opposite = placeSide(
        chain3.bendSign === 1 ? -1 : 1,
        alpha,
        targetAngle,
        length1,
        hipX,
        hipY,
        targetX,
        targetY,
        parentAngle,
        bindRoot,
        bindMid
      );
      if (inRom(opposite.mid, chain3)) return opposite;
      return aim(clamp(preferred.mid, chain3), targetAngle, parentAngle, bindRoot, bindMid, length1, length2);
    }
    if (distance2 > maxDistance) {
      const straight = normalizeAngle(-bindMid);
      const mid = inRom(straight, chain3) ? straight : clamp(straight, chain3);
      return aim(mid, targetAngle, parentAngle, bindRoot, bindMid, length1, length2);
    }
    const folded = (chain3.bendSign > 0 ? -Math.PI : Math.PI) - bindMid;
    return aim(clamp(folded, chain3), targetAngle, parentAngle, bindRoot, bindMid, length1, length2);
  }
  function placeSide(bendSign, alpha, targetAngle, length1, hipX, hipY, targetX, targetY, parentAngle, bindRoot, bindMid) {
    const bone1 = targetAngle + bendSign * alpha;
    const kneeX = hipX + length1 * Math.cos(bone1);
    const kneeY = hipY + length1 * Math.sin(bone1);
    const bone2 = Math.atan2(targetY - kneeY, targetX - kneeX);
    return {
      root: normalizeAngle(bone1 - parentAngle - bindRoot),
      mid: normalizeAngle(bone2 - bone1 - bindMid)
    };
  }
  function aim(mid, targetAngle, parentAngle, bindRoot, bindMid, length1, length2) {
    const turn = bindMid + mid;
    const localX = length1 + length2 * Math.cos(turn);
    const localY = length2 * Math.sin(turn);
    const bone1 = targetAngle - Math.atan2(localY, localX);
    return {
      root: normalizeAngle(bone1 - parentAngle - bindRoot),
      mid: normalizeAngle(mid)
    };
  }
  function angleAtRoot(length1, length2, distance2) {
    const cosine = (length1 * length1 + distance2 * distance2 - length2 * length2) / (2 * length1 * distance2);
    return Math.acos(Math.min(1, Math.max(-1, cosine)));
  }
  function inRom(angle2, chain3) {
    return angle2 >= chain3.romMin && angle2 <= chain3.romMax;
  }
  function clamp(angle2, chain3) {
    if (angle2 < chain3.romMin) return chain3.romMin;
    if (angle2 > chain3.romMax) return chain3.romMax;
    return angle2;
  }

  // src/modulate/modulate.ts
  var CROUCH_DROP_RATIO = 0.25;
  var BOB_RATIO = 0.01;
  var ARM_SWING_ARC = 0.4;
  function unit2(name, value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(name);
  }
  function bone(pose, name) {
    const index = findBone(pose.skeleton, name);
    if (index === PARENT_NONE) throw new Error("bone");
    return index;
  }
  function writePelvis(pose, legLength, crouch2, lean, phase, gait) {
    unit2("crouch", crouch2);
    if (!Number.isFinite(lean)) throw new Error("lean");
    if (!Number.isFinite(phase)) throw new Error("phase");
    if (!Number.isFinite(legLength) || legLength <= 0) throw new Error("legLength");
    if (gait !== "stand" && gait !== "walk" && gait !== "run") throw new Error("gait");
    const pelvis = bone(pose, "pelvis");
    const sign = gait === "walk" ? 1 : gait === "run" ? -1 : 0;
    const bob = sign * Math.sin(phase) * BOB_RATIO * legLength;
    const kept = poseTranslation(createVec2(), pose, pelvis);
    setPoseTranslation(pose, pelvis, kept[0], -crouch2 * CROUCH_DROP_RATIO * legLength + bob);
    setPoseRotation(pose, pelvis, lean);
  }
  function writeUpper(pose, armSwing, spineBend, breath, phase) {
    unit2("armSwing", armSwing);
    unit2("spineBend", spineBend);
    unit2("breath", breath);
    if (!Number.isFinite(phase)) throw new Error("phase");
    const spine = bone(pose, "spine");
    const head = bone(pose, "head");
    const armL = bone(pose, "upperArmL");
    const armR = bone(pose, "upperArmR");
    const swing = Math.sin(phase);
    setPoseRotation(pose, spine, spineBend * 0.15 + breath * 0.02 * swing);
    setPoseRotation(pose, armL, -armSwing * ARM_SWING_ARC * swing);
    setPoseRotation(pose, armR, armSwing * ARM_SWING_ARC * swing);
    setPoseRotation(pose, head, breath * 0.05 * swing);
  }

  // src/space/world-point.ts
  function createWorldPoint() {
    return new Float64Array(2);
  }
  function setWorldPoint(out, x, y) {
    out[0] = x;
    out[1] = y;
    return out;
  }
  function rigToWorldPoint(out, p, origin, facing) {
    const ox = origin[0];
    const oy = origin[1];
    const px = p[0];
    const py = p[1];
    out[0] = ox + facing * px;
    out[1] = oy + py;
    return out;
  }
  function worldToRigPoint(out, w, origin, facing) {
    const ox = origin[0];
    const oy = origin[1];
    const wx = w[0];
    const wy = w[1];
    out[0] = facing * (wx - ox);
    out[1] = wy - oy;
    return out;
  }

  // src/place/place.ts
  function createPlacement() {
    return { origin: createWorldPoint(), groundY: 0, generation: 0 };
  }
  function finite2(name, value) {
    if (!Number.isFinite(value)) throw new Error(name);
  }
  function setPlacement(placement, originX2, originY, groundY, generation) {
    finite2("originX", originX2);
    finite2("originY", originY);
    finite2("groundY", groundY);
    if (!Number.isInteger(generation) || generation < placement.generation) {
      throw new Error("generation");
    }
    setWorldPoint(placement.origin, originX2, originY);
    placement.groundY = groundY;
    placement.generation = generation;
  }
  function characterGroundY(placement) {
    return placement.groundY - placement.origin[1];
  }
  function movedGeneration(previous, next) {
    return next > previous;
  }

  // src/reach/reach.ts
  function reachFootfall(compiled, pose, chain3, contactX, contactY, soleX, soleY2, pitch) {
    if (pose.skeleton !== compiled.skeleton) throw new Error("pose");
    assertPoint2(contactX, contactY, soleX, soleY2);
    const scratch = createPose(pose.skeleton);
    copyPose(scratch, pose);
    const ankle = ankleFromContact(
      createVec2(),
      setVec2(createVec2(), contactX, contactY),
      setVec2(createVec2(), soleX, soleY2),
      pitch
    );
    const hip = chainRoot(compiled, scratch, chain3);
    const solved = solveTwoBone(scratch, compiled, chain3, ankle[0], ankle[1]);
    return pack(compiled, chain3, hip.x, hip.y, ankle[0], ankle[1], solved.reached);
  }
  function pack(compiled, chain3, hipX, hipY, ankleX, ankleY, reached2) {
    const distance2 = Math.hypot(ankleX - hipX, ankleY - hipY);
    const span = bindLength(compiled.skeleton, chain3.root) + bindLength(compiled.skeleton, chain3.mid);
    return {
      reached: reached2,
      withinMargin: distance2 <= compiled.proportions.reachMargin * span,
      distance: distance2
    };
  }
  function chainRoot(compiled, pose, chain3) {
    const fk2 = new Float32Array(compiled.skeleton.boneCount * 9);
    evaluateFk(fk2, compiled, pose, compiled.skeleton.boneCount);
    const index = chain3.root * 9;
    return { x: fk2[index + 6], y: fk2[index + 7] };
  }
  function assertPoint2(a, b, c, d) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) {
      throw new Error("target");
    }
  }

  // src/plan/plan.ts
  var PLAN_HIP_DROP_RATIO = 0.12;
  function footId(foot) {
    if (foot !== "left" && foot !== "right") throw new Error("foot");
    return foot;
  }
  function createStepPlan(stanceFoot, stanceX, stanceY) {
    const foot = footId(stanceFoot);
    if (!Number.isFinite(stanceX)) throw new Error("stanceX");
    if (!Number.isFinite(stanceY)) throw new Error("stanceY");
    return {
      suspended: false,
      nextFoot: foot === "left" ? "right" : "left",
      active: null,
      stanceFoot: foot,
      stanceX,
      stanceY
    };
  }
  function assertCandidate(candidate) {
    if (!Number.isFinite(candidate.cadence) || candidate.cadence < 0) throw new Error("cadence");
    if (!Number.isFinite(candidate.stepLength)) throw new Error("stepLength");
    if (!Number.isFinite(candidate.duty) || candidate.duty <= 0 || candidate.duty > 1) throw new Error("duty");
  }
  function reachable(compiled, pose, placement, facing, chain3, stanceX, stanceY, length2, groundY) {
    const world = setWorldPoint(createWorldPoint(), stanceX + facing * length2, groundY);
    const contact = worldToRigPoint(createVec2(), world, placement.origin, facing);
    const stanceWorld = setWorldPoint(createWorldPoint(), stanceX, stanceY);
    const stanceRig = worldToRigPoint(createVec2(), stanceWorld, placement.origin, facing);
    const scratch = createPose(pose.skeleton);
    copyPose(scratch, pose);
    const bind = bindTranslation(createVec2(), compiled.skeleton, 0);
    const drop = PLAN_HIP_DROP_RATIO * compiled.proportions.legLength;
    setPoseTranslation(scratch, 0, (stanceRig[0] + contact[0]) / 2 - bind[0], -drop);
    const result = reachFootfall(
      compiled,
      scratch,
      chain3,
      contact[0],
      contact[1],
      0,
      -compiled.foot.ankleHeight,
      0
    );
    return result.reached && result.withinMargin;
  }
  function underHip(compiled, chain3, placement, facing, stanceX) {
    const pelvis = bindTranslation(createVec2(), compiled.skeleton, 0);
    const hip = bindTranslation(createVec2(), compiled.skeleton, chain3.root);
    const rigX = pelvis[0] + hip[0];
    const world = setWorldPoint(createWorldPoint(), 0, 0);
    world[0] = placement.origin[0] + facing * rigX;
    return facing * (world[0] - stanceX);
  }
  function beginStep(plan, compiled, pose, placement, facing, candidate, chain3) {
    if (pose.skeleton !== compiled.skeleton) throw new Error("pose");
    if (!isFacing(facing)) throw new Error("facing");
    assertCandidate(candidate);
    if (plan.suspended || plan.active) return false;
    if (candidate.cadence === 0 || candidate.stepLength === 0) return false;
    const sign = candidate.stepLength > 0 ? 1 : -1;
    let lo = 0;
    let hi = Math.abs(candidate.stepLength);
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (reachable(compiled, pose, placement, facing, chain3, plan.stanceX, plan.stanceY, sign * mid, placement.groundY)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    let stepLength = sign * lo;
    if (!reachable(
      compiled,
      pose,
      placement,
      facing,
      chain3,
      plan.stanceX,
      plan.stanceY,
      stepLength,
      placement.groundY
    )) {
      stepLength = underHip(compiled, chain3, placement, facing, plan.stanceX);
    }
    const contactX = plan.stanceX + facing * stepLength;
    plan.active = {
      foot: plan.nextFoot,
      duration: 1 / candidate.cadence,
      stepLength,
      duty: candidate.duty,
      contactX,
      contactY: placement.groundY,
      generation: placement.generation
    };
    return true;
  }
  function finishStep(plan) {
    if (!plan.active) throw new Error("active");
    plan.stanceFoot = plan.active.foot;
    plan.stanceX = plan.active.contactX;
    plan.stanceY = plan.active.contactY;
    plan.nextFoot = plan.active.foot === "left" ? "right" : "left";
    plan.active = null;
  }
  function suspendPlan(plan) {
    plan.suspended = true;
  }
  function resumePlan(plan) {
    plan.suspended = false;
  }

  // src/correction/correction.ts
  function createCorrection() {
    return { enabled: false };
  }
  function applyCorrection(out, positions, correction) {
    if (correction.enabled !== false) throw new Error("correction");
    if (out.length !== positions.length) throw new Error("out");
    out.set(positions);
    return out;
  }

  // src/skin/skin.ts
  function skinMesh(out, compiled, fk2, meshIndex) {
    const mesh = compiled.meshes.meshes[meshIndex];
    if (mesh === void 0) throw new Error("mesh");
    if (fk2.length !== compiled.skeleton.boneCount * 9) throw new Error("fk");
    if (out.length !== mesh.positions.length) throw new Error("out");
    const corrected = new Float32Array(mesh.positions.length);
    applyCorrection(corrected, mesh.positions, compiled.correction);
    const part = compiled.parts.parts[meshIndex];
    if (part.kind === "skinned") skinSkinned(out, compiled, fk2, corrected, part);
    else skinRigid(out, fk2, corrected, part);
  }
  function skinSkinned(out, compiled, fk2, positions, part) {
    const found = compiled.weights.weights.find((item) => item.partId === part.id);
    if (found === void 0) throw new Error("weight");
    const vertexCount = positions.length / 2;
    for (let v = 0; v < vertexCount; v += 1) {
      const x = positions[v * 2];
      const y = positions[v * 2 + 1];
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < part.bones.length; i += 1) {
        const weight = found.weights[v * found.influences + i];
        if (weight === 0) continue;
        const bone2 = part.bones[i];
        const local = apply(compiled.inverseBind, bone2, x, y);
        const current = apply(fk2, bone2, local.x, local.y);
        sx += weight * current.x;
        sy += weight * current.y;
      }
      out[v * 2] = sx;
      out[v * 2 + 1] = sy;
    }
  }
  function skinRigid(out, fk2, positions, part) {
    const vertexCount = positions.length / 2;
    for (let v = 0; v < vertexCount; v += 1) {
      const current = apply(fk2, part.bone, positions[v * 2], positions[v * 2 + 1]);
      out[v * 2] = current.x;
      out[v * 2 + 1] = current.y;
    }
  }
  function apply(matrices, bone2, x, y) {
    const base = bone2 * 9;
    return {
      x: matrices[base] * x + matrices[base + 3] * y + matrices[base + 6],
      y: matrices[base + 1] * x + matrices[base + 4] * y + matrices[base + 7]
    };
  }

  // src/slot/slot.ts
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
    const near = nearSide(facing);
    const far = farSide(facing);
    order.sort((a, b) => compareSlot(set3, a, b, near, far));
    for (let i = 0; i < count; i += 1) out[i] = set3.slots[order[i]].partId;
    return out;
  }
  function compareSlot(set3, a, b, near, far) {
    const sa = set3.slots[a];
    const sb = set3.slots[b];
    if (sa.layer !== sb.layer) return sa.layer - sb.layer;
    const bandA = band(sa.side, near, far);
    const bandB = band(sb.side, near, far);
    if (bandA !== bandB) return bandA - bandB;
    return a - b;
  }
  function band(side, near, far) {
    if (side === far) return 0;
    if (side === "center") return 1;
    if (side === near) return 2;
    return 1;
  }

  // src/trajectory/trajectory.ts
  var SWING_CLEARANCE = 0.05;
  var ROLL_PITCH = 0.35;
  function smoothstep(u) {
    return u * u * (3 - 2 * u);
  }
  function bump(u) {
    return 16 * u * u * (1 - u) * (1 - u);
  }
  function ankleAt(compiled, placement, facing, contactX, contactY, soleU, pitch) {
    const contact = worldToRigPoint(
      createVec2(),
      setWorldPoint(createWorldPoint(), contactX, contactY),
      placement.origin,
      facing
    );
    const sole = soleLocal(createVec2(), compiled.foot, soleU);
    const ankle = ankleFromContact(createVec2(), contact, sole, pitch);
    return { ankleX: ankle[0], ankleY: ankle[1], pitch };
  }
  function raise(compiled, placement, target) {
    const lowest = lowestSoleOffset(createVec2(), compiled.foot, target.pitch);
    const floor2 = characterGroundY(placement);
    const gap = floor2 - (target.ankleY + lowest[1]);
    if (gap > 0) return { ...target, ankleY: target.ankleY + gap };
    return target;
  }
  function footTarget(compiled, placement, facing, step, fromX, fromY, time) {
    if (step.generation !== placement.generation) throw new Error("generation");
    if (!isFacing(facing)) throw new Error("facing");
    if (!Number.isFinite(fromX) || !Number.isFinite(fromY)) throw new Error("from");
    if (!Number.isFinite(time) || time < 0 || time > step.duration) throw new Error("time");
    const forward = step.stepLength >= 0;
    const liftoff = step.duty * step.duration;
    if (time < liftoff || liftoff >= step.duration) {
      const u2 = liftoff === 0 ? 1 : Math.min(time / liftoff, 1);
      const pitch = (forward ? 1 : -1) * ROLL_PITCH * (1 - 2 * u2);
      const soleU = forward ? u2 : 1 - u2;
      return ankleAt(compiled, placement, facing, fromX, fromY, soleU, pitch);
    }
    const u = (time - liftoff) / (step.duration - liftoff);
    const start = ankleAt(compiled, placement, facing, fromX, fromY, forward ? 1 : 0, (forward ? -1 : 1) * ROLL_PITCH);
    const end = ankleAt(
      compiled,
      placement,
      facing,
      step.contactX,
      step.contactY,
      forward ? 0 : 1,
      (forward ? 1 : -1) * ROLL_PITCH
    );
    const s = smoothstep(u);
    const blended = {
      ankleX: start.ankleX + (end.ankleX - start.ankleX) * s,
      ankleY: start.ankleY + (end.ankleY - start.ankleY) * s + SWING_CLEARANCE * bump(u),
      pitch: start.pitch + (end.pitch - start.pitch) * s
    };
    return raise(compiled, placement, blended);
  }

  // src/render/sample.ts
  function captureRenderFrame(solver2) {
    const pose = createPose(solver2.pose.skeleton);
    copyPose(pose, solver2.pose);
    const active = solver2.plan.active;
    return {
      pose,
      originX: solver2.placement.origin[0],
      originY: solver2.placement.origin[1],
      groundY: solver2.placement.groundY,
      generation: solver2.placement.generation,
      facing: solver2.params.current.facing,
      crouch: solver2.params.current.crouch,
      lean: solver2.params.current.lean,
      armSwing: solver2.params.current.armSwing,
      spineBend: solver2.params.current.spineBend,
      breath: solver2.params.current.breath,
      gait: solver2.gait.mode,
      stepTime: solver2.stepTime,
      step: active ? {
        foot: active.foot,
        duration: active.duration,
        stepLength: active.stepLength,
        duty: active.duty,
        contactX: active.contactX,
        contactY: active.contactY,
        generation: active.generation
      } : null,
      stanceX: solver2.plan.stanceX,
      stanceY: solver2.plan.stanceY,
      leftX: solver2.leftX,
      leftY: solver2.leftY,
      rightX: solver2.rightX,
      rightY: solver2.rightY,
      recovering: solver2.recovery.active,
      legL: solver2.legL,
      legR: solver2.legR
    };
  }
  function sameStep(before2, after2) {
    if (before2.step === null || after2.step === null) return false;
    return before2.step.foot === after2.step.foot && before2.step.contactX === after2.step.contactX && before2.step.contactY === after2.step.contactY && before2.step.duration === after2.step.duration;
  }
  function discontinuous(before2, after2) {
    if (before2.facing !== after2.facing) return true;
    if (after2.generation > before2.generation) return true;
    if (!before2.recovering && after2.recovering) return true;
    if ((before2.step !== null || after2.step !== null) && !sameStep(before2, after2)) return true;
    return false;
  }
  function placementOf(frame2) {
    const placement = createPlacement();
    setPlacement(placement, frame2.originX, frame2.originY, frame2.groundY, frame2.generation);
    return placement;
  }
  function planted(compiled, placement, facing, x, y) {
    const contact = worldToRigPoint(
      createVec2(),
      setWorldPoint(createWorldPoint(), x, y),
      placement.origin,
      facing
    );
    const sole = stationLocal(createVec2(), compiled.foot, "flat");
    const ankle = ankleFromContact(createVec2(), contact, sole, 0);
    return { ankleX: ankle[0], ankleY: ankle[1], pitch: 0 };
  }
  function lerp2(a, b, alpha) {
    return a + (b - a) * alpha;
  }
  function pelvisGait(mode) {
    if (mode === "run") return "run";
    if (mode === "stand") return "stand";
    return "walk";
  }
  function chain(frame2, foot) {
    return foot === "left" ? frame2.legL : frame2.legR;
  }
  function reSolve(compiled, before2, after2, alpha) {
    const step = after2.step;
    const time = before2.stepTime + (after2.stepTime - before2.stepTime) * alpha;
    const placement = placementOf(after2);
    const latched = {
      foot: step.foot,
      duration: step.duration,
      stepLength: step.stepLength,
      duty: step.duty,
      contactX: step.contactX,
      contactY: step.contactY,
      generation: step.generation
    };
    const from = step.foot === "left" ? { x: after2.leftX, y: after2.leftY } : { x: after2.rightX, y: after2.rightY };
    const swing = footTarget(compiled, placement, after2.facing, latched, from.x, from.y, time);
    const stanceFoot = step.foot === "left" ? "right" : "left";
    const stance = planted(compiled, placement, after2.facing, after2.stanceX, after2.stanceY);
    const pose = createPose(compiled.skeleton);
    const phase = Math.PI * 2 * time / step.duration;
    const bind = bindTranslation(createVec2(), compiled.skeleton, 0);
    const pelvisX = (swing.ankleX + stance.ankleX) / 2;
    setPoseTranslation(pose, 0, pelvisX - bind[0], 0);
    writePelvis(
      pose,
      compiled.proportions.legLength,
      lerp2(before2.crouch, after2.crouch, alpha),
      lerp2(before2.lean, after2.lean, alpha),
      phase,
      pelvisGait(after2.gait)
    );
    const kept = poseTranslation(createVec2(), pose, 0);
    setPoseTranslation(pose, 0, kept[0], kept[1] - PLAN_HIP_DROP_RATIO * compiled.proportions.legLength);
    solveTwoBone(pose, compiled, chain(after2, step.foot), swing.ankleX, swing.ankleY);
    solveTwoBone(pose, compiled, chain(after2, stanceFoot), stance.ankleX, stance.ankleY);
    setPoseRotation(pose, chain(after2, step.foot).end, swing.pitch);
    setPoseRotation(pose, chain(after2, stanceFoot).end, stance.pitch);
    writeUpper(
      pose,
      lerp2(before2.armSwing, after2.armSwing, alpha),
      lerp2(before2.spineBend, after2.spineBend, alpha),
      lerp2(before2.breath, after2.breath, alpha),
      phase
    );
    return pose;
  }
  function present(compiled, pose, facing, snapped) {
    const fk2 = new Float32Array(compiled.skeleton.boneCount * 9);
    evaluateFk(fk2, compiled, pose, compiled.skeleton.boneCount);
    const parts = compiled.meshes.meshes.map((mesh, index) => {
      const positions = new Float32Array(mesh.positions.length);
      skinMesh(positions, compiled, fk2, index);
      return { partId: mesh.partId, positions, indices: mesh.indices };
    });
    const order = drawOrder(new Array(compiled.slots.slots.length), compiled.slots, facing);
    return { snapped, pose, parts, order };
  }
  function clonePose(pose) {
    const copy3 = createPose(pose.skeleton);
    copyPose(copy3, pose);
    return copy3;
  }
  function sampleRender(compiled, before2, after2, alpha) {
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error("alpha");
    if (alpha === 0) return present(compiled, clonePose(before2.pose), before2.facing, false);
    const jump2 = discontinuous(before2, after2);
    if (alpha === 1 || jump2 || before2.step === null) {
      return present(compiled, clonePose(after2.pose), after2.facing, jump2 && alpha < 1);
    }
    return present(compiled, reSolve(compiled, before2, after2, alpha), after2.facing, false);
  }

  // src/mesh/strip.ts
  function meshFromStrip(partId, space, segments) {
    if (segments.length === 0) throw new Error("segments");
    const stations = segments.length + 1;
    const positions = new Float32Array(stations * 4);
    writeStation(positions, 0, segments[0].x0, segments[0].y0, segments[0]);
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      writeStation(positions, i + 1, seg.x1, seg.y1, seg);
    }
    const indices = new Uint16Array(segments.length * 6);
    for (let i = 0; i < segments.length; i += 1) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      const t = i * 6;
      indices[t] = a;
      indices[t + 1] = d;
      indices[t + 2] = c;
      indices[t + 3] = a;
      indices[t + 4] = b;
      indices[t + 5] = d;
    }
    return { partId, space, positions, indices };
  }
  function writeStation(positions, station, x, y, seg) {
    const plus = station * 2;
    positions[plus * 2] = x + seg.px * seg.radius;
    positions[plus * 2 + 1] = y + seg.py * seg.radius;
    positions[(plus + 1) * 2] = x - seg.px * seg.radius;
    positions[(plus + 1) * 2 + 1] = y - seg.py * seg.radius;
  }
  function meshFromRectangle(partId, x0, x1, yTop, yBottom) {
    const positions = new Float32Array([x0, yTop, x0, yBottom, x1, yTop, x1, yBottom]);
    const indices = new Uint16Array([0, 3, 2, 0, 1, 3]);
    return { partId, space: "part", positions, indices };
  }

  // src/mesh/humanoid.ts
  var MIN_LENGTH = 1e-5;
  var JOIN_DISTANCE_SQ = 1e-8;
  function createHumanoidMeshes(humanoid, parts) {
    if (parts.skeleton !== humanoid.skeleton) throw new Error("skeleton");
    const rig = writeBindRig(humanoid.skeleton);
    const meshes = [];
    for (let i = 0; i < parts.parts.length; i += 1) {
      const part = parts.parts[i];
      if (part.kind === "skinned") {
        meshes.push(skinMesh2(part, humanoid.skeleton, humanoid.proportions, rig));
      } else {
        meshes.push(rigidMesh(part.id, part.bone, humanoid.skeleton, humanoid.proportions));
      }
    }
    return { meshes };
  }
  function skinMesh2(part, skeleton, proportions, rig) {
    const segments = [];
    for (let i = 0; i < part.bones.length; i += 1) {
      const bone2 = part.bones[i];
      const length2 = bindLength(skeleton, bone2);
      if (length2 <= MIN_LENGTH) continue;
      const name = boneName(skeleton, bone2);
      const base = bone2 * 9;
      const ox = rig[base + 6];
      const oy = rig[base + 7];
      const ax = rig[base];
      const ay = rig[base + 1];
      const radius = radiusOf(name, proportions);
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
      segments.push(segment(ox, oy, x1, y1, radius));
    }
    return meshFromStrip(part.id, "character", segments);
  }
  function segment(x0, y0, x1, y1, radius) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = Math.hypot(dx, dy);
    return { x0, y0, x1, y1, px: -dy / len2, py: dx / len2, radius };
  }
  function rigidMesh(partId, bone2, skeleton, proportions) {
    const length2 = bindLength(skeleton, bone2);
    const name = boneName(skeleton, bone2);
    if (name === "head") {
      return meshFromRectangle(partId, 0, length2, proportions.headRadius, -proportions.headRadius);
    }
    if (name === "handL" || name === "handR") {
      return meshFromRectangle(partId, 0, length2, proportions.handRadius, -proportions.handRadius);
    }
    if (name === "footL" || name === "footR") {
      return meshFromRectangle(partId, 0, length2, proportions.footRadius, -proportions.ankleHeight);
    }
    throw new Error("part");
  }
  function radiusOf(name, proportions) {
    switch (name) {
      case "pelvis":
      case "spine":
        return proportions.spineRadius;
      case "chest":
        return proportions.chestRadius;
      case "neck":
        return proportions.neckRadius;
      case "upperArmL":
      case "upperArmR":
        return proportions.upperArmRadius;
      case "lowerArmL":
      case "lowerArmR":
        return proportions.lowerArmRadius;
      case "thighL":
      case "thighR":
        return proportions.thighRadius;
      case "shinL":
      case "shinR":
        return proportions.shinRadius;
      default:
        throw new Error("bone");
    }
  }
  function writeBindRig(skeleton) {
    const rig = new Float32Array(skeleton.boneCount * 9);
    const local = createMat3();
    const parent = createMat3();
    const combined = createMat3();
    for (let bone2 = 0; bone2 < skeleton.boneCount; bone2 += 1) {
      setBindParentFromBone(local, skeleton, bone2);
      const parentIndex = skeleton.parent[bone2];
      const dst = bone2 * 9;
      const source = parentIndex < 0 ? local : combine2(combined, parent, rig, parentIndex, local);
      for (let k = 0; k < 9; k += 1) rig[dst + k] = source[k];
    }
    return rig;
  }
  function combine2(combined, parent, rig, parentIndex, local) {
    const src = parentIndex * 9;
    for (let k = 0; k < 9; k += 1) parent[k] = rig[src + k];
    return multiplyMat3(combined, parent, local);
  }

  // src/part/set.ts
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

  // src/part/rigid.ts
  function addRigid(builder, spec) {
    const fill = claimFill(builder, spec.id, spec.fill);
    const { bone: bone2, translationX, translationY, rotation } = spec;
    const boneCount = builder.skeleton.boneCount;
    if (!Number.isInteger(bone2) || bone2 < 0 || bone2 >= boneCount) {
      throw new Error("bone");
    }
    if (!Number.isFinite(translationX) || !Number.isFinite(translationY)) {
      throw new Error("translation");
    }
    if (!Number.isFinite(rotation)) throw new Error("rotation");
    const part = {
      kind: "rigid",
      id: spec.id,
      bone: bone2,
      translationX,
      translationY,
      rotation: normalizeAngle(rotation),
      fill
    };
    const index = builder.parts.length;
    builder.parts.push(part);
    return index;
  }

  // src/part/skin.ts
  function addSkinned(builder, spec) {
    const fill = claimFill(builder, spec.id, spec.fill);
    const source = spec.bones;
    if (source === void 0 || source.length < 2) throw new Error("bones");
    const boneCount = builder.skeleton.boneCount;
    const bones = [];
    for (let i = 0; i < source.length; i += 1) {
      const bone2 = source[i];
      if (!Number.isInteger(bone2) || bone2 < 0 || bone2 >= boneCount) {
        throw new Error("bones");
      }
      if (i > 0 && parentOf(builder.skeleton, bone2) !== source[i - 1]) {
        throw new Error("bones");
      }
      bones.push(bone2);
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

  // src/part/humanoid.ts
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

  // src/slot/humanoid.ts
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

  // src/space/tolerance.ts
  var LENGTH_EPSILON = 1e-5;

  // src/topology/validate.ts
  var AREA_EPSILON = 1e-8;
  function validateMesh(mesh) {
    const positions = mesh.positions;
    const indices = mesh.indices;
    if (positions.length < 6 || positions.length % 2 !== 0) throw new Error("mesh");
    if (indices.length < 3 || indices.length % 3 !== 0) throw new Error("mesh");
    const vertexCount = positions.length / 2;
    for (let i = 0; i < indices.length; i += 1) {
      const index = indices[i];
      if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
        throw new Error("indices");
      }
    }
    const triangleCount = indices.length / 3;
    for (let t = 0; t < triangleCount; t += 1) {
      const signed = signedArea(positions, indices, t);
      if (Math.abs(signed) <= AREA_EPSILON) throw new Error("degenerate");
      if (signed < 0) throw new Error("winding");
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
    let boundary = 0;
    for (const edge of edges.values()) {
      if (edge.count === 1) boundary += 1;
    }
    if (boundary === 0) throw new Error("boundary");
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
    if (visited !== triangleCount) throw new Error("connectivity");
  }
  function signedArea(positions, indices, triangle) {
    const i0 = indices[triangle * 3];
    const i1 = indices[triangle * 3 + 1];
    const i2 = indices[triangle * 3 + 2];
    const ax = positions[i0 * 2];
    const ay = positions[i0 * 2 + 1];
    const bx = positions[i1 * 2];
    const by = positions[i1 * 2 + 1];
    const cx = positions[i2 * 2];
    const cy = positions[i2 * 2 + 1];
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
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

  // src/weight/humanoid.ts
  var BAND_RATIO = 0.25;
  function createHumanoidWeights(humanoid, parts, meshes) {
    if (parts.skeleton !== humanoid.skeleton) throw new Error("skeleton");
    if (meshes.meshes.length !== parts.parts.length) throw new Error("mesh");
    const rig = writeBindRig2(humanoid.skeleton);
    const weights = [];
    for (let i = 0; i < parts.parts.length; i += 1) {
      const part = parts.parts[i];
      const mesh = meshes.meshes[i];
      if (mesh.partId !== part.id) throw new Error("mesh");
      if (part.kind !== "skinned") continue;
      weights.push(weightPart(part, mesh.positions, rig, humanoid.skeleton));
    }
    return { weights };
  }
  function weightPart(part, positions, rig, skeleton) {
    const segments = [];
    for (let i = 0; i < part.bones.length; i += 1) {
      const bone2 = part.bones[i];
      const length2 = bindLength(skeleton, bone2);
      if (length2 <= 1e-5) continue;
      const base = bone2 * 9;
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
    const vertexCount = positions.length / 2;
    const weights = new Float32Array(vertexCount * influences);
    for (let v = 0; v < vertexCount; v += 1) {
      const x = positions[v * 2];
      const y = positions[v * 2 + 1];
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
    for (let bone2 = 0; bone2 < skeleton.boneCount; bone2 += 1) {
      setBindParentFromBone(local, skeleton, bone2);
      const parentIndex = skeleton.parent[bone2];
      const source = parentIndex < 0 ? local : combine3(combined, parent, rig, parentIndex, local);
      const dst = bone2 * 9;
      for (let k = 0; k < 9; k += 1) rig[dst + k] = source[k];
    }
    return rig;
  }
  function combine3(combined, parent, rig, parentIndex, local) {
    const src = parentIndex * 9;
    for (let k = 0; k < 9; k += 1) parent[k] = rig[src + k];
    return multiplyMat3(combined, parent, local);
  }

  // src/compile/compile.ts
  function compileHumanoid(humanoid) {
    const parts = createHumanoidParts(humanoid.skeleton);
    const slots = createHumanoidSlots();
    const meshes = createHumanoidMeshes(humanoid, parts);
    const weights = createHumanoidWeights(humanoid, parts, meshes);
    return compileRig({
      humanoid,
      parts,
      slots,
      meshes,
      weights,
      correction: createCorrection()
    });
  }
  function compileRig(input) {
    const { humanoid, parts, slots, meshes, weights, correction } = input;
    if (parts.skeleton !== humanoid.skeleton) throw new Error("skeleton");
    assertSlots(parts, slots);
    assertMeshes(parts, meshes);
    assertWeights(parts, meshes, weights);
    assertChains(humanoid);
    const bindRig = writeBindRig3(humanoid.skeleton);
    const inverseBind = invertAll(bindRig, humanoid.skeleton.boneCount);
    const foot = createFootShape(humanoid.proportions.footLength, humanoid.proportions.ankleHeight);
    return {
      skeleton: humanoid.skeleton,
      proportions: humanoid.proportions,
      foot,
      parts,
      slots,
      meshes,
      weights,
      correction,
      bindRig,
      inverseBind
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
      const vertexCount = mesh.positions.length / 2;
      if (found === void 0 || found.influences !== part.bones.length || found.weights.length !== vertexCount * part.bones.length) {
        throw new Error("weight");
      }
    }
  }
  function assertChains(humanoid) {
    const chains = [
      humanoid.chains.legL,
      humanoid.chains.legR,
      humanoid.chains.armL,
      humanoid.chains.armR
    ];
    for (let i = 0; i < chains.length; i += 1) {
      const chain3 = chains[i];
      assertLink(humanoid.skeleton, chain3.root, chain3.mid);
      assertLink(humanoid.skeleton, chain3.mid, chain3.end);
    }
  }
  function assertLink(skeleton, parent, child) {
    const length2 = bindLength(skeleton, parent);
    const translation = bindTranslation(createVec2(), skeleton, child);
    if (Math.abs(translation[0] - length2) > LENGTH_EPSILON || Math.abs(translation[1]) > LENGTH_EPSILON) {
      throw new Error("chain");
    }
  }
  function writeBindRig3(skeleton) {
    const rig = new Float32Array(skeleton.boneCount * 9);
    const local = createMat3();
    const parent = createMat3();
    const combined = createMat3();
    for (let bone2 = 0; bone2 < skeleton.boneCount; bone2 += 1) {
      setBindParentFromBone(local, skeleton, bone2);
      const parentIndex = skeleton.parent[bone2];
      const source = parentIndex < 0 ? local : combine4(combined, parent, rig, parentIndex, local);
      const dst = bone2 * 9;
      for (let k = 0; k < 9; k += 1) rig[dst + k] = source[k];
    }
    return rig;
  }
  function combine4(combined, parent, rig, parentIndex, local) {
    const src = parentIndex * 9;
    for (let k = 0; k < 9; k += 1) parent[k] = rig[src + k];
    return multiplyMat3(combined, parent, local);
  }
  function invertAll(bindRig, boneCount) {
    const inverse2 = new Float32Array(bindRig.length);
    const source = createMat3();
    const inv = createMat3();
    for (let bone2 = 0; bone2 < boneCount; bone2 += 1) {
      const dst = bone2 * 9;
      for (let k = 0; k < 9; k += 1) source[k] = bindRig[dst + k];
      if (!invertMat3(inv, source)) throw new Error("bind");
      for (let k = 0; k < 9; k += 1) inverse2[dst + k] = inv[k];
    }
    return inverse2;
  }

  // src/speed/speed.ts
  var GRAVITY = 9.81;
  var WALK_FROUDE = 0.5;
  var PREFERRED_STEP_RATIO = 0.8;
  var WALK_DUTY = 0.62;
  var RUN_DUTY = 0.4;
  var STAND_SPEED = 0.05;
  function speedCandidate(speed, cadenceStyle, legLength) {
    if (!Number.isFinite(speed)) throw new Error("speed");
    if (!Number.isFinite(cadenceStyle) || cadenceStyle <= 0) throw new Error("cadenceStyle");
    if (!Number.isFinite(legLength) || legLength <= 0) throw new Error("legLength");
    const froude = speed * speed / (GRAVITY * legLength);
    const duty = Math.abs(froude) < WALK_FROUDE ? WALK_DUTY : RUN_DUTY;
    if (Math.abs(speed) < STAND_SPEED) {
      return { cadence: 0, stepLength: 0, duty: WALK_DUTY, froude };
    }
    const stepLength = Math.sign(speed) * (PREFERRED_STEP_RATIO * legLength / cadenceStyle);
    const cadence = Math.abs(speed) / Math.abs(stepLength);
    return { cadence, stepLength, duty, froude };
  }

  // src/gait/gait.ts
  function createGait() {
    return { mode: "stand", sign: 0, facing: 1 };
  }
  function moving(mode) {
    return mode === "start" || mode === "walk" || mode === "run";
  }
  function stepGait(gait, input) {
    if (!Number.isFinite(input.speed)) throw new Error("speed");
    if (!isFacing(input.facing)) throw new Error("facing");
    if (typeof input.contactHeld !== "boolean") throw new Error("contactHeld");
    if (typeof input.stepFinished !== "boolean") throw new Error("stepFinished");
    if (typeof input.requestRecover !== "boolean") throw new Error("requestRecover");
    if (!Number.isFinite(input.froude)) throw new Error("froude");
    if (input.requestRecover && gait.mode !== "recover") {
      gait.mode = "recover";
      return;
    }
    if (gait.mode === "recover") {
      if (input.stepFinished && input.contactHeld) {
        gait.mode = "stand";
        gait.sign = 0;
      }
      return;
    }
    const wantSign = Math.abs(input.speed) < STAND_SPEED ? 0 : input.speed > 0 ? 1 : -1;
    const facingChanged = input.facing !== gait.facing;
    const reversed = gait.sign !== 0 && wantSign !== 0 && wantSign !== gait.sign;
    if (moving(gait.mode) && (reversed || facingChanged || wantSign === 0)) {
      gait.mode = "stop";
      gait.facing = input.facing;
      return;
    }
    if (gait.mode === "stand") {
      gait.facing = input.facing;
      if (wantSign !== 0) {
        gait.mode = "start";
        gait.sign = wantSign;
      }
      return;
    }
    if (gait.mode === "stop") {
      gait.facing = input.facing;
      if (input.stepFinished && input.contactHeld) {
        gait.mode = "stand";
        gait.sign = 0;
      }
      return;
    }
    if (gait.mode === "start" && input.stepFinished && input.contactHeld) {
      gait.mode = Math.abs(input.froude) < WALK_FROUDE ? "walk" : "run";
      return;
    }
    if (gait.mode === "walk" || gait.mode === "run") {
      gait.mode = Math.abs(input.froude) < WALK_FROUDE ? "walk" : "run";
      gait.sign = wantSign;
    }
  }

  // src/recover/recover.ts
  var RECOVER_STEP = 0.05;
  var RECOVER_DURATION = 0.3;
  function createRecovery() {
    return {
      active: false,
      foot: "left",
      fromX: 0,
      fromY: 0,
      contactX: 0,
      contactY: 0,
      duration: RECOVER_DURATION,
      generation: 0
    };
  }
  function footOf(foot) {
    if (foot !== "left" && foot !== "right") throw new Error("foot");
    return foot;
  }
  function reachedAt(compiled, pose, placement, facing, chain3, x, y) {
    const rig = worldToRigPoint(
      createVec2(),
      setWorldPoint(createWorldPoint(), x, y),
      placement.origin,
      facing
    );
    const scratch = createPose(pose.skeleton);
    copyPose(scratch, pose);
    return reachFootfall(
      compiled,
      scratch,
      chain3,
      rig[0],
      rig[1],
      0,
      -compiled.foot.ankleHeight,
      0
    ).reached;
  }
  function underHip2(compiled, placement, facing, chain3) {
    const pelvis = bindTranslation(createVec2(), compiled.skeleton, 0);
    const hip = bindTranslation(createVec2(), compiled.skeleton, chain3.root);
    return {
      x: placement.origin[0] + facing * (pelvis[0] + hip[0]),
      y: placement.groundY
    };
  }
  function beginRecovery(recovery, compiled, pose, placement, facing, chain3, foot, fromX, fromY, failedX, failedY, approachX, approachY) {
    if (pose.skeleton !== compiled.skeleton) throw new Error("pose");
    if (!isFacing(facing)) throw new Error("facing");
    const which = footOf(foot);
    const points = [fromX, fromY, failedX, failedY, approachX, approachY];
    if (points.some((value) => !Number.isFinite(value))) throw new Error("contact");
    const dx = approachX - failedX;
    const dy = approachY - failedY;
    const length2 = Math.hypot(dx, dy);
    let foundX = Number.NaN;
    let foundY = Number.NaN;
    const count = length2 === 0 ? 1 : Math.ceil(length2 / RECOVER_STEP);
    for (let i = 1; i <= count; i += 1) {
      const t = length2 === 0 ? 1 : Math.min(1, i * RECOVER_STEP / length2);
      const x = failedX + dx * t;
      const y = failedY + dy * t;
      if (reachedAt(compiled, pose, placement, facing, chain3, x, y)) {
        foundX = x;
        foundY = y;
        break;
      }
    }
    if (!Number.isFinite(foundX)) {
      const hip = underHip2(compiled, placement, facing, chain3);
      foundX = hip.x;
      foundY = hip.y;
    }
    recovery.foot = which;
    recovery.fromX = fromX;
    recovery.fromY = fromY;
    recovery.contactX = foundX;
    recovery.contactY = foundY;
    recovery.duration = RECOVER_DURATION;
    recovery.generation = placement.generation;
    recovery.active = true;
  }
  function recoveryTarget(recovery, compiled, placement, facing, time) {
    if (!recovery.active) throw new Error("active");
    const step = {
      foot: recovery.foot,
      duration: recovery.duration,
      stepLength: recovery.contactX - recovery.fromX,
      duty: 0.2,
      contactX: recovery.contactX,
      contactY: recovery.contactY,
      generation: recovery.generation
    };
    return footTarget(compiled, placement, facing, step, recovery.fromX, recovery.fromY, time);
  }
  function clearRecovery(recovery) {
    recovery.active = false;
  }

  // src/schedule/schedule.ts
  function contactMarks(step) {
    if (!Number.isFinite(step.duration) || step.duration <= 0) throw new Error("duration");
    if (!Number.isFinite(step.duty) || step.duty <= 0 || step.duty > 1) throw new Error("duty");
    if (!Number.isFinite(step.stepLength)) throw new Error("stepLength");
    const stance = step.duty * step.duration;
    const first = step.stepLength < 0 ? "toe" : "heel";
    const third = step.stepLength < 0 ? "heel" : "toe";
    return [
      { name: first, time: 0 },
      { name: "flat", time: stance / 3 },
      { name: third, time: 2 * stance / 3 },
      { name: "liftoff", time: stance },
      { name: "landing", time: step.duration }
    ];
  }
  function crossings(prev, next, marks) {
    if (!Number.isFinite(prev) || !Number.isFinite(next) || prev > next) throw new Error("time");
    return marks.filter((mark) => prev < mark.time && mark.time <= next);
  }

  // src/solve/solve.ts
  function footWorld(compiled, pose, bone2) {
    const fk2 = new Float32Array(compiled.skeleton.boneCount * 9);
    evaluateFk(fk2, compiled, pose, compiled.skeleton.boneCount);
    return {
      x: fk2[bone2 * 9 + 6],
      y: fk2[bone2 * 9 + 7] - compiled.foot.ankleHeight
    };
  }
  function createSolver(humanoid) {
    const compiled = compileHumanoid(humanoid);
    const pose = createPose(compiled.skeleton);
    const left = footWorld(compiled, pose, humanoid.chains.legL.end);
    const right = footWorld(compiled, pose, humanoid.chains.legR.end);
    return {
      compiled,
      legL: humanoid.chains.legL,
      legR: humanoid.chains.legR,
      params: createParams(),
      placement: createPlacement(),
      gait: createGait(),
      plan: createStepPlan("right", right.x, right.y),
      pose,
      scratch: createPose(compiled.skeleton),
      recovery: createRecovery(),
      events: [],
      stepTime: 0,
      recoveryTime: 0,
      generation: 0,
      leftX: left.x,
      leftY: left.y,
      rightX: right.x,
      rightY: right.y,
      bindLeftX: left.x,
      bindLeftY: left.y,
      bindRightX: right.x,
      bindRightY: right.y
    };
  }
  function chain2(solver2, foot) {
    return foot === "left" ? solver2.legL : solver2.legR;
  }
  function plant(solver2, foot) {
    return foot === "left" ? { x: solver2.leftX, y: solver2.leftY } : { x: solver2.rightX, y: solver2.rightY };
  }
  function setPlant(solver2, foot, x, y) {
    if (foot === "left") {
      solver2.leftX = x;
      solver2.leftY = y;
    } else {
      solver2.rightX = x;
      solver2.rightY = y;
    }
  }
  function facingOf(solver2) {
    return solver2.params.current.facing;
  }
  function plantedAnkle(solver2, x, y) {
    const contact = worldToRigPoint(
      createVec2(),
      setWorldPoint(createWorldPoint(), x, y),
      solver2.placement.origin,
      facingOf(solver2)
    );
    const sole = stationLocal(createVec2(), solver2.compiled.foot, "flat");
    const ankle = ankleFromContact(createVec2(), contact, sole, 0);
    return { ankleX: ankle[0], ankleY: ankle[1], pitch: 0 };
  }
  function swingAt(solver2, step, time) {
    const from = plant(solver2, step.foot);
    return footTarget(
      solver2.compiled,
      solver2.placement,
      facingOf(solver2),
      step,
      from.x,
      from.y,
      time
    );
  }
  function otherFoot(foot) {
    return foot === "left" ? "right" : "left";
  }
  function inputOf(solver2, candidate, stepFinished, requestRecover, contactHeld) {
    return {
      speed: solver2.params.current.speed,
      facing: facingOf(solver2),
      contactHeld,
      stepFinished,
      requestRecover,
      froude: candidate.froude
    };
  }
  function snap(solver2) {
    const facing = facingOf(solver2);
    const left = rigToWorldPoint(
      createWorldPoint(),
      setVec22(createVec2(), solver2.bindLeftX, solver2.bindLeftY),
      solver2.placement.origin,
      facing
    );
    const right = rigToWorldPoint(
      createWorldPoint(),
      setVec22(createVec2(), solver2.bindRightX, solver2.bindRightY),
      solver2.placement.origin,
      facing
    );
    solver2.leftX = left[0];
    solver2.leftY = left[1];
    solver2.rightX = right[0];
    solver2.rightY = right[1];
    solver2.plan.active = null;
    solver2.plan.suspended = false;
    solver2.plan.stanceFoot = "right";
    solver2.plan.stanceX = solver2.rightX;
    solver2.plan.stanceY = solver2.rightY;
    solver2.plan.nextFoot = "left";
    solver2.stepTime = 0;
    solver2.recoveryTime = 0;
    clearRecovery(solver2.recovery);
    solver2.generation = solver2.placement.generation;
    solver2.events = [];
  }
  function setVec22(out, x, y) {
    out[0] = x;
    out[1] = y;
    return out;
  }
  function placePelvis(solver2, pose, pelvisX, phase) {
    const bind = bindTranslation(createVec2(), solver2.compiled.skeleton, 0);
    setPoseTranslation(pose, 0, pelvisX - bind[0], 0);
    const mode = solver2.gait.mode;
    const gait = mode === "run" ? "run" : mode === "stand" ? "stand" : "walk";
    writePelvis(
      pose,
      solver2.compiled.proportions.legLength,
      solver2.params.current.crouch,
      solver2.params.current.lean,
      phase,
      gait
    );
    const kept = poseTranslation(createVec2(), pose, 0);
    setPoseTranslation(
      pose,
      0,
      kept[0],
      kept[1] - PLAN_HIP_DROP_RATIO * solver2.compiled.proportions.legLength
    );
  }
  function reached(solver2, pose, foot, ankleX, ankleY) {
    return solveTwoBone(pose, solver2.compiled, chain2(solver2, foot), ankleX, ankleY).reached;
  }
  function fail(solver2, step, candidate) {
    const from = plant(solver2, step.foot);
    beginRecovery(
      solver2.recovery,
      solver2.compiled,
      solver2.pose,
      solver2.placement,
      facingOf(solver2),
      chain2(solver2, step.foot),
      step.foot,
      from.x,
      from.y,
      step.contactX,
      step.contactY,
      solver2.plan.stanceX,
      solver2.plan.stanceY
    );
    suspendPlan(solver2.plan);
    solver2.recoveryTime = 0;
    stepGait(solver2.gait, inputOf(solver2, candidate, false, true, false));
  }
  function poseFeet(solver2, step, time) {
    const swing = swingAt(solver2, step, time);
    const stanceFoot = otherFoot(step.foot);
    const stance = plantedAnkle(solver2, solver2.plan.stanceX, solver2.plan.stanceY);
    const landing = swingAt(solver2, step, step.duration);
    const probe = createPose(solver2.compiled.skeleton);
    placePelvis(solver2, probe, (landing.ankleX + stance.ankleX) / 2, 0);
    if (!reached(solver2, probe, step.foot, landing.ankleX, landing.ankleY)) return false;
    if (!reached(solver2, probe, stanceFoot, stance.ankleX, stance.ankleY)) return false;
    const phase = Math.PI * 2 * time / step.duration;
    copyPose(solver2.scratch, solver2.pose);
    placePelvis(solver2, solver2.scratch, (swing.ankleX + stance.ankleX) / 2, phase);
    evaluateFk(new Float32Array(9), solver2.compiled, solver2.scratch, 1);
    if (!reached(solver2, solver2.scratch, step.foot, swing.ankleX, swing.ankleY)) return false;
    if (!reached(solver2, solver2.scratch, stanceFoot, stance.ankleX, stance.ankleY)) return false;
    setPoseRotation(solver2.scratch, chain2(solver2, step.foot).end, swing.pitch);
    setPoseRotation(solver2.scratch, chain2(solver2, stanceFoot).end, stance.pitch);
    const full = new Float32Array(solver2.compiled.skeleton.boneCount * 9);
    evaluateFk(full, solver2.compiled, solver2.scratch, solver2.compiled.skeleton.boneCount);
    writeUpper(
      solver2.scratch,
      solver2.params.current.armSwing,
      solver2.params.current.spineBend,
      solver2.params.current.breath,
      phase
    );
    copyPose(solver2.pose, solver2.scratch);
    return true;
  }
  function recoverTick(solver2, dt, candidate) {
    const time = Math.min(solver2.recoveryTime + dt, solver2.recovery.duration);
    const swing = recoveryTarget(solver2.recovery, solver2.compiled, solver2.placement, facingOf(solver2), time);
    const stanceFoot = otherFoot(solver2.recovery.foot);
    const stancePlant = plant(solver2, stanceFoot);
    const stance = plantedAnkle(solver2, stancePlant.x, stancePlant.y);
    copyPose(solver2.scratch, solver2.pose);
    placePelvis(solver2, solver2.scratch, (swing.ankleX + stance.ankleX) / 2, 0);
    evaluateFk(new Float32Array(9), solver2.compiled, solver2.scratch, 1);
    const swingOk = reached(solver2, solver2.scratch, solver2.recovery.foot, swing.ankleX, swing.ankleY);
    const stanceOk = reached(solver2, solver2.scratch, stanceFoot, stance.ankleX, stance.ankleY);
    if (!swingOk || !stanceOk) return;
    setPoseRotation(solver2.scratch, chain2(solver2, solver2.recovery.foot).end, swing.pitch);
    setPoseRotation(solver2.scratch, chain2(solver2, stanceFoot).end, 0);
    const full = new Float32Array(solver2.compiled.skeleton.boneCount * 9);
    evaluateFk(full, solver2.compiled, solver2.scratch, solver2.compiled.skeleton.boneCount);
    writeUpper(solver2.scratch, solver2.params.current.armSwing, solver2.params.current.spineBend, solver2.params.current.breath, 0);
    copyPose(solver2.pose, solver2.scratch);
    solver2.recoveryTime = time;
    if (time >= solver2.recovery.duration) {
      setPlant(solver2, solver2.recovery.foot, solver2.recovery.contactX, solver2.recovery.contactY);
      clearRecovery(solver2.recovery);
      resumePlan(solver2.plan);
      solver2.plan.active = null;
      solver2.stepTime = 0;
      stepGait(solver2.gait, inputOf(solver2, candidate, true, false, true));
    }
  }
  function stepSolver(solver2, dt) {
    if (!Number.isFinite(dt) || dt <= 0) throw new Error("dt");
    stepParams(solver2.params, dt);
    if (movedGeneration(solver2.generation, solver2.placement.generation)) snap(solver2);
    const candidate = speedCandidate(
      solver2.params.current.speed,
      solver2.params.current.cadenceStyle,
      solver2.compiled.proportions.legLength
    );
    if (solver2.recovery.active) {
      recoverTick(solver2, dt, candidate);
      return;
    }
    stepGait(solver2.gait, inputOf(solver2, candidate, false, false, true));
    const mode = solver2.gait.mode;
    if (!solver2.plan.active && !solver2.plan.suspended && (mode === "start" || mode === "walk" || mode === "run") && Math.abs(solver2.params.current.speed) >= STAND_SPEED) {
      beginStep(
        solver2.plan,
        solver2.compiled,
        solver2.pose,
        solver2.placement,
        facingOf(solver2),
        candidate,
        chain2(solver2, solver2.plan.nextFoot)
      );
    }
    const step = solver2.plan.active;
    if (!step) return;
    const nextTime = Math.min(solver2.stepTime + dt, step.duration);
    if (!poseFeet(solver2, step, nextTime)) {
      fail(solver2, step, candidate);
      return;
    }
    const marks = contactMarks(step);
    const events = [];
    for (const mark of crossings(solver2.stepTime, nextTime, marks)) {
      if (mark.name === "liftoff" || mark.name === "landing") {
        events.push({ kind: mark.name, foot: step.foot });
      }
    }
    solver2.events = events;
    if (nextTime >= step.duration) {
      setPlant(solver2, step.foot, step.contactX, step.contactY);
      finishStep(solver2.plan);
      stepGait(solver2.gait, inputOf(solver2, candidate, true, false, true));
      solver2.stepTime = 0;
      const next = solver2.gait.mode;
      if ((next === "start" || next === "walk" || next === "run") && !solver2.plan.suspended && Math.abs(solver2.params.current.speed) >= STAND_SPEED) {
        beginStep(
          solver2.plan,
          solver2.compiled,
          solver2.pose,
          solver2.placement,
          facingOf(solver2),
          candidate,
          chain2(solver2, solver2.plan.nextFoot)
        );
      }
      return;
    }
    solver2.stepTime = nextTime;
  }

  // preview/spider.ts
  var DT = 1 / 60;
  var MODE = {
    stand: "\u7AD9\u7ACB",
    start: "\u8D77\u6B65",
    walk: "\u884C\u8D70",
    run: "\u8DD1\u6B65",
    stop: "\u505C\u6B62",
    recover: "\u6062\u590D"
  };
  var REST = {
    head: { x: 280, y: 18 },
    neck: { x: 287, y: 158 },
    waist: { x: 287, y: 530 },
    shoulderL: { x: 392, y: 214 },
    elbowL: { x: 424, y: 348 },
    wristL: { x: 458, y: 468 },
    handL: { x: 466, y: 520 },
    shoulderR: { x: 176, y: 214 },
    elbowR: { x: 164, y: 348 },
    wristR: { x: 118, y: 470 },
    handR: { x: 112, y: 522 },
    hipL: { x: 348, y: 548 },
    kneeL: { x: 372, y: 748 },
    ankleL: { x: 398, y: 918 },
    footL: { x: 428, y: 992 },
    hipR: { x: 226, y: 548 },
    kneeR: { x: 206, y: 748 },
    ankleR: { x: 186, y: 918 },
    footR: { x: 148, y: 992 }
  };
  var BONES = [
    { name: "thighL", a: "hipL", b: "kneeL", layer: 0 },
    { name: "shinL", a: "kneeL", b: "ankleL", layer: 0 },
    { name: "footL", a: "ankleL", b: "footL", layer: 0 },
    { name: "thighR", a: "hipR", b: "kneeR", layer: 0 },
    { name: "shinR", a: "kneeR", b: "ankleR", layer: 0 },
    { name: "footR", a: "ankleR", b: "footR", layer: 0 },
    { name: "torso", a: "neck", b: "waist", layer: 1 },
    { name: "head", a: "neck", b: "head", layer: 3 },
    { name: "upperArmL", a: "shoulderL", b: "elbowL", layer: 2 },
    { name: "lowerArmL", a: "elbowL", b: "wristL", layer: 2 },
    { name: "handL", a: "wristL", b: "handL", layer: 2 },
    { name: "upperArmR", a: "shoulderR", b: "elbowR", layer: 2 },
    { name: "lowerArmR", a: "elbowR", b: "wristR", layer: 2 },
    { name: "handR", a: "wristR", b: "handR", layer: 2 }
  ];
  var HALF = {
    thighL: 54,
    thighR: 54,
    shinL: 42,
    shinR: 42,
    footL: 48,
    footR: 48,
    torso: 118,
    head: 64,
    upperArmL: 42,
    upperArmR: 42,
    lowerArmL: 36,
    lowerArmR: 36,
    handL: 32,
    handR: 32
  };
  var solver = createSolver(createHumanoid(1.7));
  var canvas = document.querySelector("#stage");
  var readout = document.querySelector("#readout");
  var upperArmL = findBone(solver.pose.skeleton, "upperArmL");
  var upperArmR = findBone(solver.pose.skeleton, "upperArmR");
  var footBoneL = findBone(solver.pose.skeleton, "footL");
  var footBoneR = findBone(solver.pose.skeleton, "footR");
  var fk = new Float32Array(solver.compiled.skeleton.boneCount * 9);
  var photo = new Image();
  photo.src = "./spider-man.png";
  var ready = false;
  var originX = 287;
  var footY = 1008;
  var ppm = 992 / 1.7;
  var playing = true;
  var accumulator = 0;
  var last = performance.now();
  var plants = [];
  var lastStance = Number.NaN;
  setIntent(1.2);
  var jump = Number(new URLSearchParams(location.search).get("t") ?? 0);
  if (jump > 0) {
    for (let i = 0; i < Math.round(jump / DT); i += 1) {
      stepSolver(solver, DT);
      notePlant();
    }
  }
  var before = captureRenderFrame(solver);
  var after = before;
  photo.onload = () => {
    ready = true;
  };
  if (photo.complete && photo.naturalWidth > 0) ready = true;
  document.querySelector("#stand").addEventListener("click", () => setIntent(0));
  document.querySelector("#walk").addEventListener("click", () => setIntent(1.2));
  document.querySelector("#run").addEventListener("click", () => setIntent(3));
  document.querySelector("#back").addEventListener("click", () => setIntent(-1.2));
  document.querySelector("#pause").addEventListener("click", () => {
    playing = !playing;
    document.querySelector("#pause").setAttribute("aria-pressed", String(!playing));
    document.querySelector("#pause").textContent = playing ? "\u6682\u505C" : "\u7EE7\u7EED";
  });
  var crouch = document.querySelector("#crouch");
  var crouchOut = document.querySelector("#crouch-out");
  crouch.addEventListener("input", () => {
    const value = Number(crouch.value);
    crouchOut.textContent = value.toFixed(2);
    setCrouch(solver.params, value);
  });
  requestAnimationFrame(frame);
  function setIntent(speed) {
    setSpeed(solver.params, speed);
    const moving2 = speed !== 0;
    setArmSwing(solver.params, moving2 ? 0.85 : 0);
    setSpineBend(solver.params, moving2 ? 0.4 : 0);
    setBreath(solver.params, moving2 ? 0.5 : 0);
    if (!solver.plan.active) {
      for (let i = 0; i < 90; i += 1) stepParams(solver.params, DT);
    }
    for (const id of ["stand", "walk", "run", "back"]) {
      document.querySelector("#" + id).setAttribute("aria-pressed", "false");
    }
    const pressed = speed === 0 ? "stand" : speed === 3 ? "run" : speed < 0 ? "back" : "walk";
    document.querySelector("#" + pressed).setAttribute("aria-pressed", "true");
    if (!playing) {
      playing = true;
      document.querySelector("#pause").setAttribute("aria-pressed", "false");
      document.querySelector("#pause").textContent = "\u6682\u505C";
    }
  }
  function frame(now) {
    const elapsed = Math.min(0.05, (now - last) / 1e3);
    last = now;
    if (playing) {
      accumulator += elapsed;
      while (accumulator >= DT) {
        before = after;
        stepSolver(solver, DT);
        after = captureRenderFrame(solver);
        notePlant();
        accumulator -= DT;
      }
    }
    draw();
    writeReadout();
    requestAnimationFrame(frame);
  }
  function notePlant() {
    if (solver.plan.stanceX === lastStance) return;
    lastStance = solver.plan.stanceX;
    plants.push({ x: solver.plan.stanceX, y: solver.plan.stanceY });
    if (plants.length > 14) plants.shift();
  }
  function writeReadout() {
    if (!ready) {
      readout.textContent = "\u6B63\u5728\u51C6\u5907\u8D34\u56FE\u2026";
      return;
    }
    const active = solver.plan.active;
    const mode = MODE[solver.gait.mode] ?? solver.gait.mode;
    const parts = [
      `\u6A21\u5F0F <strong>${mode}</strong>`,
      `\u901F\u5EA6 <strong>${solver.params.current.speed.toFixed(2)}</strong> m/s`
    ];
    if (active) {
      parts.push(`\u6446\u52A8 <strong>${active.foot === "left" ? "\u5DE6" : "\u53F3"}</strong>`);
      parts.push(`\u6B65\u5185 <strong>${solver.stepTime.toFixed(2)}</strong> / ${active.duration.toFixed(2)} s`);
    } else {
      parts.push("\u7AD9\u7ACB");
    }
    readout.innerHTML = parts.join(" \xB7 ");
  }
  function draw() {
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    if (!ready) return;
    const alpha = Math.min(1, accumulator / DT);
    const sampled = sampleRender(solver.compiled, before, after, alpha);
    evaluateFk(fk, solver.compiled, sampled.pose, solver.compiled.skeleton.boneCount);
    const pelvisX = fk[6];
    const viewHeight = 2.35;
    const viewWidth = viewHeight * (width / height);
    const x0 = pelvisX - viewWidth * 0.5;
    const y0 = -0.08;
    const scale3 = height / viewHeight;
    ctx.save();
    ctx.translate(-x0 * scale3, height + y0 * scale3);
    ctx.scale(scale3, -scale3);
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0 + viewWidth, 0);
    ctx.lineWidth = 1.5 / scale3;
    ctx.strokeStyle = "#2a3544";
    ctx.stroke();
    const joints = poseJoints(sampled.pose);
    const order = BONES.slice().sort((a, b) => a.layer - b.layer);
    for (const bone2 of order) {
      paintBone(ctx, joints, bone2, pelvisX);
    }
    ctx.restore();
  }
  function poseJoints(pose) {
    const joints = {};
    for (const name of Object.keys(REST)) joints[name] = { ...REST[name] };
    const yL = fk[footBoneL * 9 + 7];
    const yR = fk[footBoneR * 9 + 7];
    const ground = Math.min(yL, yR);
    bendLeg(joints, "L", Math.max(0, yL - ground) * ppm);
    bendLeg(joints, "R", Math.max(0, yR - ground) * ppm);
    swingArm(joints, "L", poseRotation(pose, upperArmL));
    swingArm(joints, "R", poseRotation(pose, upperArmR));
    const drop = Math.max(0, -poseTranslation(createVec2(), pose, 0)[1]) * ppm * 0.35;
    if (drop > 0) {
      for (const name of ["head", "neck", "waist", "shoulderL", "shoulderR", "elbowL", "elbowR", "wristL", "wristR", "handL", "handR", "hipL", "hipR"]) {
        joints[name].y += drop;
      }
    }
    return joints;
  }
  function bendLeg(joints, side, lift) {
    if (lift < 1) return;
    const hip = joints[`hip${side}`];
    const knee = joints[`knee${side}`];
    const ankle = joints[`ankle${side}`];
    const foot = joints[`foot${side}`];
    const sign = side === "L" ? 1 : -1;
    const thigh = Math.min(0.35, lift / 340);
    const bend = Math.min(0.75, lift / 170);
    rotate3(knee, hip, thigh * sign);
    rotate3(ankle, hip, thigh * sign);
    rotate3(foot, hip, thigh * sign);
    rotate3(ankle, knee, bend * sign);
    rotate3(foot, knee, bend * sign);
  }
  function swingArm(joints, side, angle2) {
    if (Math.abs(angle2) < 1e-3) return;
    const shoulder = joints[`shoulder${side}`];
    const elbow = joints[`elbow${side}`];
    const wrist = joints[`wrist${side}`];
    const hand = joints[`hand${side}`];
    const swing = angle2 * 0.45;
    rotate3(elbow, shoulder, swing);
    rotate3(wrist, shoulder, swing);
    rotate3(hand, shoulder, swing);
  }
  function rotate3(point, origin, angle2) {
    const c = Math.cos(angle2);
    const s = Math.sin(angle2);
    const x = point.x - origin.x;
    const y = point.y - origin.y;
    point.x = origin.x + c * x - s * y;
    point.y = origin.y + s * x + c * y;
  }
  function boneFrame(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = Math.hypot(dx, dy) || 1;
    const ux = dx / len2;
    const uy = dy / len2;
    return { ax: a.x, ay: a.y, ux, uy, px: -uy, py: ux };
  }
  function paintBone(ctx, joints, bone2, pelvisX) {
    const restA = REST[bone2.a];
    const restB = REST[bone2.b];
    const curA = joints[bone2.a];
    const curB = joints[bone2.b];
    const rest = boneFrame(restA, restB);
    const cur = boneFrame(curA, curB);
    const len2 = Math.hypot(restB.x - restA.x, restB.y - restA.y);
    const half = HALF[bone2.name] ?? 40;
    const pad = 12;
    const corners = [
      [-pad, -half],
      [len2 + pad, -half],
      [len2 + pad, half],
      [-pad, half]
    ];
    const imageAt = (frame2, along, side) => ({
      x: frame2.ax + along * frame2.ux + side * frame2.px,
      y: frame2.ay + along * frame2.uy + side * frame2.py
    });
    const uv = corners.map(([along, side]) => imageAt(rest, along, side));
    const xy = corners.map(([along, side]) => imageAt(cur, along, side));
    const world = xy.map((point) => toWorld(point.x, point.y, pelvisX));
    paintTriangle(ctx, world[0], world[1], world[2], uv[0].x, uv[0].y, uv[1].x, uv[1].y, uv[2].x, uv[2].y);
    paintTriangle(ctx, world[0], world[2], world[3], uv[0].x, uv[0].y, uv[2].x, uv[2].y, uv[3].x, uv[3].y);
  }
  function toWorld(ix, iy, pelvisX) {
    return [pelvisX + (ix - originX) / ppm, (footY - iy) / ppm];
  }
  function paintTriangle(ctx, w0, w1, w2, u0, v0, u1, v1, u2, v2) {
    const du1 = u1 - u0;
    const dv1 = v1 - v0;
    const du2 = u2 - u0;
    const dv2 = v2 - v0;
    const det = du1 * dv2 - dv1 * du2;
    if (Math.abs(det) < 1e-4) return;
    const dx1 = w1[0] - w0[0];
    const dy1 = w1[1] - w0[1];
    const dx2 = w2[0] - w0[0];
    const dy2 = w2[1] - w0[1];
    const a = (dx1 * dv2 - dx2 * dv1) / det;
    const c = (dx2 * du1 - dx1 * du2) / det;
    const b = (dy1 * dv2 - dy2 * dv1) / det;
    const d = (dy2 * du1 - dy1 * du2) / det;
    const e = w0[0] - a * u0 - c * v0;
    const f = w0[1] - b * u0 - d * v0;
    const su = Math.min(u0, u1, u2);
    const sv = Math.min(v0, v1, v2);
    const eu = Math.max(u0, u1, u2);
    const ev = Math.max(v0, v1, v2);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w0[0], w0[1]);
    ctx.lineTo(w1[0], w1[1]);
    ctx.lineTo(w2[0], w2[1]);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(photo, su, sv, eu - su, ev - sv, su, sv, eu - su, ev - sv);
    ctx.restore();
  }
})();
