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
    const bindRotation = new Float32Array(boneCount);
    const bindLength2 = new Float32Array(boneCount);
    for (let i = 0; i < boneCount; i += 1) {
      parent[i] = builder.parent[i];
      bindTranslation2[i * 2] = builder.translationX[i];
      bindTranslation2[i * 2 + 1] = builder.translationY[i];
      bindRotation[i] = builder.rotation[i];
      bindLength2[i] = builder.length[i];
    }
    builder.finished = true;
    return {
      boneCount,
      name,
      parent,
      bindTranslation: bindTranslation2,
      bindRotation,
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
    const upperArmL = addBone(builder, {
      name: "upperArmL",
      parent: chest,
      translationX: -p.shoulderOffsetX,
      translationY: -p.shoulderDropY,
      rotation: -halfPi,
      length: p.upperArmLength
    });
    const lowerArmL = addBone(builder, {
      name: "lowerArmL",
      parent: upperArmL,
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
    const upperArmR = addBone(builder, {
      name: "upperArmR",
      parent: chest,
      translationX: p.shoulderOffsetX,
      translationY: -p.shoulderDropY,
      rotation: -halfPi,
      length: p.upperArmLength
    });
    const lowerArmR = addBone(builder, {
      name: "lowerArmR",
      parent: upperArmR,
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
  function setPoseRotation(pose2, bone, rotation) {
    pose2.data[bone * POSE_STRIDE + 2] = normalizeAngle(rotation);
  }
  function zeroPose(pose2) {
    pose2.data.fill(0);
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
  function setParentFromBone(out, skeleton, pose2, bone) {
    const i2 = bone * 2;
    const i3 = bone * POSE_STRIDE;
    return writeParentFromBone(
      out,
      skeleton.bindTranslation[i2],
      skeleton.bindTranslation[i2 + 1],
      skeleton.bindRotation[bone],
      pose2.data[i3],
      pose2.data[i3 + 1],
      pose2.data[i3 + 2]
    );
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
  function createHumanoidMeshes(humanoid2, parts) {
    if (parts.skeleton !== humanoid2.skeleton) throw new Error("skeleton");
    const rig = writeBindRig(humanoid2.skeleton);
    const meshes = [];
    for (let i = 0; i < parts.parts.length; i += 1) {
      const part = parts.parts[i];
      if (part.kind === "skinned") {
        meshes.push(skinMesh(part, humanoid2.skeleton, humanoid2.proportions, rig));
      } else {
        meshes.push(rigidMesh(part.id, part.bone, humanoid2.skeleton, humanoid2.proportions));
      }
    }
    return { meshes };
  }
  function skinMesh(part, skeleton, proportions, rig) {
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
  function rigidMesh(partId, bone, skeleton, proportions) {
    const length2 = bindLength(skeleton, bone);
    const name = boneName(skeleton, bone);
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
    for (let bone = 0; bone < skeleton.boneCount; bone += 1) {
      setBindParentFromBone(local, skeleton, bone);
      const parentIndex = skeleton.parent[bone];
      const dst = bone * 9;
      const source = parentIndex < 0 ? local : combine(combined, parent, rig, parentIndex, local);
      for (let k = 0; k < 9; k += 1) rig[dst + k] = source[k];
    }
    return rig;
  }
  function combine(combined, parent, rig, parentIndex, local) {
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

  // src/part/skin.ts
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

  // src/math/vec2.ts
  function createVec2() {
    return vec2_exports.create();
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

  // src/space/facing.ts
  function isFacing(x) {
    return x === 1 || x === -1;
  }
  function nearSide(facing2) {
    return facing2 === 1 ? "right" : "left";
  }
  function farSide(facing2) {
    return facing2 === 1 ? "left" : "right";
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
  function drawOrder(out, set3, facing2) {
    if (!isFacing(facing2)) throw new Error("facing");
    const count = set3.slots.length;
    if (out.length !== count) throw new Error("order");
    const order = new Array(count);
    for (let i = 0; i < count; i += 1) order[i] = i;
    const near = nearSide(facing2);
    const far = farSide(facing2);
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

  // src/compile/compile.ts
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
    const bindRig = writeBindRig3(humanoid2.skeleton);
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
  function writeBindRig3(skeleton) {
    const rig = new Float32Array(skeleton.boneCount * 9);
    const local = createMat3();
    const parent = createMat3();
    const combined = createMat3();
    for (let bone = 0; bone < skeleton.boneCount; bone += 1) {
      setBindParentFromBone(local, skeleton, bone);
      const parentIndex = skeleton.parent[bone];
      const source = parentIndex < 0 ? local : combine3(combined, parent, rig, parentIndex, local);
      const dst = bone * 9;
      for (let k = 0; k < 9; k += 1) rig[dst + k] = source[k];
    }
    return rig;
  }
  function combine3(combined, parent, rig, parentIndex, local) {
    const src = parentIndex * 9;
    for (let k = 0; k < 9; k += 1) parent[k] = rig[src + k];
    return multiplyMat3(combined, parent, local);
  }
  function invertAll(bindRig, boneCount) {
    const inverse2 = new Float32Array(bindRig.length);
    const source = createMat3();
    const inv = createMat3();
    for (let bone = 0; bone < boneCount; bone += 1) {
      const dst = bone * 9;
      for (let k = 0; k < 9; k += 1) source[k] = bindRig[dst + k];
      if (!invertMat3(inv, source)) throw new Error("bind");
      for (let k = 0; k < 9; k += 1) inverse2[dst + k] = inv[k];
    }
    return inverse2;
  }

  // src/fk/evaluate.ts
  function evaluateFk(out, compiled2, pose2, count) {
    if (pose2.skeleton !== compiled2.skeleton) throw new Error("pose");
    const boneCount = compiled2.skeleton.boneCount;
    if (!Number.isInteger(count) || count < 1 || count > boneCount) throw new Error("count");
    if (out.length !== count * 9) throw new Error("out");
    const local = createMat3();
    const parent = createMat3();
    const combined = createMat3();
    for (let bone = 0; bone < count; bone += 1) {
      setParentFromBone(local, compiled2.skeleton, pose2, bone);
      const parentIndex = compiled2.skeleton.parent[bone];
      const source = parentIndex < 0 ? local : combine4(combined, parent, out, parentIndex, local);
      const dst = bone * 9;
      for (let k = 0; k < 9; k += 1) out[dst + k] = source[k];
    }
  }
  function combine4(combined, parent, rig, parentIndex, local) {
    const src = parentIndex * 9;
    for (let k = 0; k < 9; k += 1) parent[k] = rig[src + k];
    return multiplyMat3(combined, parent, local);
  }

  // src/skin/skin.ts
  function skinMesh2(out, compiled2, fk, meshIndex) {
    const mesh = compiled2.meshes.meshes[meshIndex];
    if (mesh === void 0) throw new Error("mesh");
    if (fk.length !== compiled2.skeleton.boneCount * 9) throw new Error("fk");
    if (out.length !== mesh.positions.length) throw new Error("out");
    const corrected = new Float32Array(mesh.positions.length);
    applyCorrection(corrected, mesh.positions, compiled2.correction);
    const part = compiled2.parts.parts[meshIndex];
    if (part.kind === "skinned") skinSkinned(out, compiled2, fk, corrected, part);
    else skinRigid(out, fk, corrected, part);
  }
  function skinSkinned(out, compiled2, fk, positions, part) {
    const found = compiled2.weights.weights.find((item) => item.partId === part.id);
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
        const bone = part.bones[i];
        const local = apply(compiled2.inverseBind, bone, x, y);
        const current = apply(fk, bone, local.x, local.y);
        sx += weight * current.x;
        sy += weight * current.y;
      }
      out[v * 2] = sx;
      out[v * 2 + 1] = sy;
    }
  }
  function skinRigid(out, fk, positions, part) {
    const vertexCount = positions.length / 2;
    for (let v = 0; v < vertexCount; v += 1) {
      const current = apply(fk, part.bone, positions[v * 2], positions[v * 2 + 1]);
      out[v * 2] = current.x;
      out[v * 2 + 1] = current.y;
    }
  }
  function apply(matrices, bone, x, y) {
    const base = bone * 9;
    return {
      x: matrices[base] * x + matrices[base + 3] * y + matrices[base + 6],
      y: matrices[base + 1] * x + matrices[base + 4] * y + matrices[base + 7]
    };
  }

  // src/fill/fill.ts
  function fillPose(compiled2, pose2) {
    const fk = new Float32Array(compiled2.bindRig.length);
    evaluateFk(fk, compiled2, pose2, compiled2.skeleton.boneCount);
    const filled = [];
    for (let i = 0; i < compiled2.meshes.meshes.length; i += 1) {
      const mesh = compiled2.meshes.meshes[i];
      const positions = new Float32Array(mesh.positions.length);
      skinMesh2(positions, compiled2, fk, i);
      filled.push({
        partId: mesh.partId,
        positions,
        indices: mesh.indices,
        fill: compiled2.parts.parts[i].fill
      });
    }
    return filled;
  }

  // preview/view.ts
  var JOINTS = [
    { bone: "thighL", label: "\u5DE6\u5927\u817F" },
    { bone: "shinL", label: "\u5DE6\u5C0F\u817F" },
    { bone: "footL", label: "\u5DE6\u811A" },
    { bone: "thighR", label: "\u53F3\u5927\u817F" },
    { bone: "shinR", label: "\u53F3\u5C0F\u817F" },
    { bone: "footR", label: "\u53F3\u811A" },
    { bone: "upperArmL", label: "\u5DE6\u4E0A\u81C2" },
    { bone: "lowerArmL", label: "\u5DE6\u524D\u81C2" },
    { bone: "upperArmR", label: "\u53F3\u4E0A\u81C2" },
    { bone: "lowerArmR", label: "\u53F3\u524D\u81C2" },
    { bone: "spine", label: "\u810A\u67F1" },
    { bone: "chest", label: "\u80F8" }
  ];
  var humanoid = createHumanoid(1.7);
  var compiled = compileHumanoid(humanoid);
  var pose = createPose(compiled.skeleton);
  var restPose = createPose(compiled.skeleton);
  var rest = fillPose(compiled, restPose);
  var facing = 1;
  var restCanvas = document.querySelector("#rest");
  var posedCanvas = document.querySelector("#posed");
  var readout = document.querySelector("#readout");
  var controls = document.querySelector("#controls");
  var sliders = /* @__PURE__ */ new Map();
  for (const joint of JOINTS) {
    const label = document.createElement("label");
    const name = document.createElement("span");
    name.textContent = joint.label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = "-2.5";
    input.max = "2.5";
    input.step = "0.01";
    input.value = "0";
    const output = document.createElement("output");
    output.textContent = "0.00";
    input.addEventListener("input", () => {
      output.textContent = Number(input.value).toFixed(2);
      setPoseRotation(pose, findBone(compiled.skeleton, joint.bone), Number(input.value));
      paint();
    });
    label.append(name, input, output);
    controls.append(label);
    sliders.set(joint.bone, input);
  }
  document.querySelector("#stand").addEventListener("click", () => {
    zeroPose(pose);
    syncSliders();
    paint();
  });
  document.querySelector("#knee").addEventListener("click", () => {
    zeroPose(pose);
    setPoseRotation(pose, findBone(compiled.skeleton, "shinL"), -0.8);
    syncSliders();
    paint();
  });
  document.querySelector("#face-pos").addEventListener("click", () => setFacing(1));
  document.querySelector("#face-neg").addEventListener("click", () => setFacing(-1));
  if (new URLSearchParams(location.search).get("pose") === "knee") {
    setPoseRotation(pose, findBone(compiled.skeleton, "shinL"), -0.8);
    syncSliders();
  }
  paint();
  draw(restCanvas, rest, "\u7ED1\u5B9A");
  function setFacing(next) {
    facing = next;
    document.querySelector("#face-pos").setAttribute("aria-pressed", String(next === 1));
    document.querySelector("#face-neg").setAttribute("aria-pressed", String(next === -1));
    paint();
  }
  function syncSliders() {
    for (const joint of JOINTS) {
      const input = sliders.get(joint.bone);
      const value = pose.data[findBone(compiled.skeleton, joint.bone) * 3 + 2] ?? 0;
      input.value = String(value);
      input.nextElementSibling.textContent = value.toFixed(2);
    }
  }
  function paint() {
    const filled = fillPose(compiled, pose);
    draw(posedCanvas, filled, "\u5F53\u524D");
    const leg = displacement(rest, filled, "legL");
    readout.innerHTML = `\u671D\u5411 <strong>${facing === 1 ? "+1" : "\u22121"}</strong>\uFF0C\u8FD1\u4FA7\u753B\u5728\u4E0A\u5C42\u3002\u5DE6\u817F\u76F8\u5BF9\u7ED1\u5B9A\u59FF\u6001\u7684\u6700\u5927\u9876\u70B9\u4F4D\u79FB <strong>${leg.toFixed(3)} m</strong>\u3002\u6D4B\u8BD5\u8981\u6C42\u8FD9\u4E2A\u6570\u5927\u4E8E 0.001\u3002`;
  }
  function displacement(before, after, partId) {
    const a = before.find((part) => part.partId === partId);
    const b = after.find((part) => part.partId === partId);
    let max2 = 0;
    for (let i = 0; i < a.positions.length; i += 2) {
      const dx = a.positions[i] - b.positions[i];
      const dy = a.positions[i + 1] - b.positions[i + 1];
      max2 = Math.max(max2, Math.hypot(dx, dy));
    }
    return max2;
  }
  function draw(canvas, parts, title) {
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const x0 = -0.55;
    const x1 = 0.85;
    const y0 = -0.2;
    const y1 = 1.95;
    const scale3 = Math.min((width - 48) / (x1 - x0), (height - 48) / (y1 - y0));
    const originX = 24 - x0 * scale3;
    const originY = height - 24 + y0 * scale3;
    const order = drawOrder(new Array(compiled.slots.slots.length), compiled.slots, facing);
    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(scale3, -scale3);
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x1, 0);
    ctx.lineWidth = 1 / scale3;
    ctx.strokeStyle = "#b7c3d0";
    ctx.stroke();
    for (const partId of order) {
      const part = parts.find((item) => item.partId === partId);
      if (part === void 0) continue;
      const { r, g, b } = part.fill;
      ctx.fillStyle = `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
      ctx.beginPath();
      const positions = part.positions;
      const indices = part.indices;
      for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 2;
        const bIndex = indices[i + 1] * 2;
        const c = indices[i + 2] * 2;
        ctx.moveTo(positions[a], positions[a + 1]);
        ctx.lineTo(positions[bIndex], positions[bIndex + 1]);
        ctx.lineTo(positions[c], positions[c + 1]);
        ctx.closePath();
      }
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = "#5c6b7a";
    ctx.font = "13px Palatino, serif";
    ctx.fillText(title, 16, 22);
  }
})();
