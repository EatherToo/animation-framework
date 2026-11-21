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
    const footLength = 0.15 / 1.3 * H;
    const spineLength = 0.144 * H;
    const chestLength = 0.144 * H;
    const torsoLength = spineLength + chestLength;
    const shoulderDropY = 0.02 * H;
    const stanceWidth = 0.1 * H;
    const shoulderOffsetZ = 0.1 * H;
    const at = (coefficient) => coefficient * H / torsoLength;
    return {
      height: H,
      hipHeight,
      ankleHeight,
      pelvisLength: 0.05 * H,
      spineLength,
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
      torsoProfile: section(H, [
        [at(0), 0.096, 0.071, 0.055, 2.4],
        [at(0.03), 0.095, 0.073, 0.055, 2.4],
        [at(0.06), 0.088, 0.066, 0.05, 2.2],
        [at(0.09), 0.079, 0.058, 0.046, 2.2],
        [at(0.12), 0.082, 0.06, 0.048, 2.2],
        [at(0.16), 0.089, 0.064, 0.054, 2.4],
        [at(0.2), 0.092, 0.066, 0.056, 2.4],
        [at(0.24), 0.094, 0.06, 0.058, 2.6],
        [at(0.268), 0.086, 0.052, 0.054, 2.6],
        [at(0.288), 0.033, 0.033, 0.033, 2]
      ]),
      neckProfile: section(H, [
        [0, 0.033, 0.033, 0.033, 2],
        [1, 0.033, 0.033, 0.033, 2]
      ]),
      headProfile: section(H, [
        [0, 0.033, 0.033, 0.033, 2],
        [0.1, 0.036, 0.056, 0.046, 2.2],
        [0.22, 0.04, 0.054, 0.051, 2.2],
        [0.36, 0.041, 0.052, 0.056, 2.2],
        [0.52, 0.0425, 0.052, 0.056, 2.2],
        [0.7, 0.042, 0.046, 0.054, 2.2],
        [0.86, 0.036, 0.032, 0.043, 2.2],
        [0.96, 0.024, 0.018, 0.026, 2.2],
        [1, 0.016, 0.012, 0.018, 2]
      ]),
      upperArmProfile: section(H, [
        [0, 0.033, 0.0314, 0.0314, 2],
        [0.15, 0.031, 0.02945, 0.02945, 2],
        [0.4, 0.028, 0.0266, 0.0266, 2],
        [0.7, 0.026, 0.0247, 0.0247, 2],
        [1, 0.02, 0.019, 0.019, 2]
      ]),
      lowerArmProfile: section(H, [
        [0, 0.02, 0.019, 0.019, 2],
        [0.15, 0.0255, 0.021675, 0.021675, 2],
        [0.4, 0.0245, 0.020825, 0.020825, 2],
        [0.7, 0.02, 0.017, 0.017, 2],
        [1, 0.016, 0.0136, 0.0136, 2]
      ]),
      thighProfile: section(H, [
        [0, 0.048, 0.0456, 0.0456, 2],
        [0.2, 0.046, 0.0437, 0.0437, 2],
        [0.45, 0.043, 0.04085, 0.04085, 2],
        [0.7, 0.034, 0.0323, 0.0323, 2],
        [1, 0.029, 0.02755, 0.02755, 2]
      ]),
      shinProfile: section(H, [
        [0, 0.029, 0.02755, 0.02755, 2],
        [0.2, 0.03, 0.027, 0.027, 2],
        [0.35, 0.0325, 0.02925, 0.02925, 2],
        [0.6, 0.026, 0.0234, 0.0234, 2],
        [1, 0.0195, 0.01755, 0.01755, 2]
      ]),
      palmWrist: { halfWidth: 0.019 * H, halfThickness: 95e-4 * H },
      palmKnuckle: { halfWidth: 0.024 * H, halfThickness: 85e-4 * H },
      palmFraction: 0.42,
      fingerRadius: 48e-4 * H,
      fingerTipRadius: 38e-4 * H,
      fingerLengths: [0.96, 1, 0.93, 0.85],
      fingerOffsets: [0.0166 * H, 55e-4 * H, -55e-4 * H, -0.0166 * H],
      thumbRadius: 7e-3 * H,
      thumbAlong: 0.22,
      thumbTipAlong: 0.52,
      thumbDrop: 4e-3 * H,
      thumbOffsetZ: 0.018 * H,
      thumbTipZ: 0.032 * H,
      heelBack: 0.3 * footLength,
      footHalfWidth: radiusProfile(H, [[0, 0.018], [0.65, 0.027], [1, 0.022]]),
      footInstep: radiusProfile(H, [[0, 0.036], [0.5, 0.041], [1, 0.021]]),
      stanceWidth,
      hipOffsetZ: stanceWidth / 2,
      shoulderOffsetZ,
      hipDropY: hipHeight - thighLength - shinLength - ankleHeight,
      shoulderDropY,
      reachMargin: REACH_MARGIN
    };
  }
  function section(height, samples) {
    return samples.map(([t, w, front, back, exponent]) => ({
      t,
      halfWidth: w * height,
      frontDepth: front * height,
      backDepth: back * height,
      exponent
    }));
  }
  function radiusProfile(height, samples) {
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
  function createJointDofs(boneIndex, fingerIndex, fingerNames) {
    const coreCount = Object.keys(boneIndex).length;
    let count = coreCount;
    if (fingerIndex !== void 0) {
      for (const bone of Object.values(fingerIndex)) count = Math.max(count, bone + 1);
    }
    const joints = new Array(count);
    const put = (name, rotation, swing, twist, swingSign, twistSign) => {
      const bone = boneIndex[name];
      joints[bone] = { bone, rotation, swing, twist, swingSign, twistSign };
    };
    const mid = { swingSign: -1, twistSign: 1 };
    put("pelvis", null, null, null, mid.swingSign, mid.twistSign);
    put("spine", range(-1.047, 0.524), span(0.349), span(0.175), mid.swingSign, mid.twistSign);
    put("chest", range(-0.524, 0.349), span(0.349), span(0.611), mid.swingSign, mid.twistSign);
    const clavicle = { rotation: span(0.436), swing: span(0.349), twist: span(0.262) };
    put("clavicleL", clavicle.rotation, clavicle.swing, clavicle.twist, 1, 1);
    put("clavicleR", clavicle.rotation, clavicle.swing, clavicle.twist, -1, -1);
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
    if (fingerIndex !== void 0 && fingerNames !== void 0) {
      for (const name of fingerNames) {
        const bone = fingerIndex[name];
        if (bone === void 0) continue;
        const flex = name.startsWith("thumb") ? range(0, 1) : range(0, 1.5);
        joints[bone] = { bone, rotation: flex, swing: LOCKED, twist: LOCKED, swingSign: 0, twistSign: 0 };
      }
    }
    return joints;
  }
  function range(min3, max3) {
    return { min: min3, max: max3 };
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
      swing: [],
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
    const { translationX: tx, translationY: ty, translationZ: tz, rotation, length: length6 } = spec;
    const swing = spec.swing ?? 0;
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(tz) || !Number.isFinite(rotation) || !Number.isFinite(swing) || !Number.isFinite(length6) || length6 < 0) {
      throw new Error("bind");
    }
    builder.names.push(spec.name);
    builder.parent.push(spec.parent);
    builder.translationX.push(tx);
    builder.translationY.push(ty);
    builder.translationZ.push(tz);
    builder.rotation.push(normalizeAngle(rotation));
    builder.swing.push(swing);
    builder.length.push(length6 === 0 ? 0 : length6);
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
    const bindSwing = new Float32Array(boneCount);
    const bindRotation2 = new Float32Array(boneCount);
    const bindLength2 = new Float32Array(boneCount);
    for (let i = 0; i < boneCount; i += 1) {
      parent[i] = builder.parent[i];
      bindTranslation2[i * 2] = builder.translationX[i];
      bindTranslation2[i * 2 + 1] = builder.translationY[i];
      bindLateral2[i] = builder.translationZ[i];
      bindSwing[i] = builder.swing[i];
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
      bindSwing,
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

  // packages/render-engine/src/body/follow.ts
  var CLAVICLE_FOLLOW_SWING = 0.3;
  var CLAVICLE_FOLLOW_ROTATION = 0.2;
  function applyClavicleFollow(pose2, rig) {
    const skeleton = rig.skeleton;
    for (const side of ["L", "R"]) {
      const arm = findBone(skeleton, `upperArm${side}`);
      const clavicle = findBone(skeleton, `clavicle${side}`);
      if (arm < 0 || clavicle < 0) continue;
      const joint = rig.joints[clavicle];
      if (joint === void 0) continue;
      setPoseSwing(
        pose2,
        clavicle,
        clampTo(poseSwing(pose2, arm) * CLAVICLE_FOLLOW_SWING, joint.swing)
      );
      setPoseRotation(
        pose2,
        clavicle,
        clampTo(poseRotation(pose2, arm) * CLAVICLE_FOLLOW_ROTATION, joint.rotation)
      );
    }
  }
  function clampTo(value, limit) {
    if (limit === null) return value;
    if (value < limit.min) return limit.min;
    if (value > limit.max) return limit.max;
    return value;
  }

  // packages/render-engine/src/body/assemble.ts
  var ARM_BIND_SWING = 0.1047;
  var CLAVICLE_REACH = 0.08;
  var BONE_NAMES = [
    "pelvis",
    "spine",
    "chest",
    "clavicleL",
    "clavicleR",
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
  var FINGER_BONE_NAMES = [
    "thumb1L",
    "thumb2L",
    "index1L",
    "index2L",
    "index3L",
    "middle1L",
    "middle2L",
    "middle3L",
    "ring1L",
    "ring2L",
    "ring3L",
    "pinky1L",
    "pinky2L",
    "pinky3L",
    "thumb1R",
    "thumb2R",
    "index1R",
    "index2R",
    "index3R",
    "middle1R",
    "middle2R",
    "middle3R",
    "ring1R",
    "ring2R",
    "ring3R",
    "pinky1R",
    "pinky2R",
    "pinky3R"
  ];
  function createHumanoid(height) {
    return createHumanoidFromProportions(createProportions(height));
  }
  var FINGER_ORDER = ["thumb", "index", "middle", "ring", "pinky"];
  var FINGER_SEGMENTS = {
    thumb: [0.55, 0.45],
    index: [0.42, 0.33, 0.25],
    middle: [0.42, 0.33, 0.25],
    ring: [0.42, 0.33, 0.25],
    pinky: [0.42, 0.33, 0.25]
  };
  function addFingerBones(builder, p, side, hand, out) {
    const sideSign = side === "L" ? 1 : -1;
    const handLength = p.handLength;
    const palm = p.palmFraction * handLength;
    for (const finger of FINGER_ORDER) {
      const index = finger === "thumb" ? 0 : ["index", "middle", "ring", "pinky"].indexOf(finger);
      const base = finger === "thumb" ? p.thumbAlong * handLength : palm;
      const tip = finger === "thumb" ? p.thumbTipAlong * handLength : p.fingerLengths[index] * handLength;
      const zBase = finger === "thumb" ? sideSign * p.thumbOffsetZ : p.fingerOffsets[index];
      const zTip = finger === "thumb" ? sideSign * p.thumbTipZ : zBase;
      const total = Math.max(0, tip - base);
      const fractions = FINGER_SEGMENTS[finger];
      let parent = hand;
      let x = base;
      let z = zBase;
      for (let s = 0; s < fractions.length; s += 1) {
        const length6 = total * fractions[s];
        const name = `${finger}${s + 1}${side}`;
        const bone = addBone(builder, {
          name,
          parent,
          translationX: x,
          translationY: 0,
          translationZ: z,
          rotation: 0,
          length: length6
        });
        out[name] = bone;
        parent = bone;
        x = length6;
        z = finger === "thumb" && s === 0 ? zTip - zBase : 0;
      }
    }
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
    const clavicleL = addBone(builder, {
      name: "clavicleL",
      parent: chest,
      translationX: p.chestLength - p.shoulderDropY,
      translationY: 0,
      translationZ: 0.02 * p.height,
      rotation: 0,
      length: 0
    });
    const clavicleR = addBone(builder, {
      name: "clavicleR",
      parent: chest,
      translationX: p.chestLength - p.shoulderDropY,
      translationY: 0,
      translationZ: -0.02 * p.height,
      rotation: 0,
      length: 0
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
      parent: clavicleL,
      translationX: 0,
      translationY: 0,
      translationZ: CLAVICLE_REACH * p.height,
      rotation: Math.PI,
      swing: ARM_BIND_SWING,
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
      parent: clavicleR,
      translationX: 0,
      translationY: 0,
      translationZ: -CLAVICLE_REACH * p.height,
      rotation: Math.PI,
      swing: ARM_BIND_SWING,
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
    const fingerIndex = {};
    addFingerBones(builder, p, "L", handL, fingerIndex);
    addFingerBones(builder, p, "R", handR, fingerIndex);
    const skeleton = finishSkeleton(builder);
    const boneIndex = {
      pelvis,
      spine,
      chest,
      clavicleL,
      clavicleR,
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
      fingerIndex,
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
      joints: createJointDofs(boneIndex, fingerIndex, FINGER_BONE_NAMES)
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

  // node_modules/.pnpm/gl-matrix@3.4.4/node_modules/gl-matrix/esm/mat4.js
  var mat4_exports = {};
  __export(mat4_exports, {
    add: () => add,
    adjoint: () => adjoint,
    clone: () => clone,
    copy: () => copy,
    create: () => create2,
    decompose: () => decompose,
    determinant: () => determinant,
    equals: () => equals,
    exactEquals: () => exactEquals,
    frob: () => frob,
    fromQuat: () => fromQuat,
    fromQuat2: () => fromQuat2,
    fromRotation: () => fromRotation,
    fromRotationTranslation: () => fromRotationTranslation,
    fromRotationTranslationScale: () => fromRotationTranslationScale,
    fromRotationTranslationScaleOrigin: () => fromRotationTranslationScaleOrigin,
    fromScaling: () => fromScaling,
    fromTranslation: () => fromTranslation,
    fromValues: () => fromValues,
    fromXRotation: () => fromXRotation,
    fromYRotation: () => fromYRotation,
    fromZRotation: () => fromZRotation,
    frustum: () => frustum,
    getRotation: () => getRotation,
    getScaling: () => getScaling,
    getTranslation: () => getTranslation,
    identity: () => identity,
    invert: () => invert,
    lookAt: () => lookAt,
    mul: () => mul,
    multiply: () => multiply,
    multiplyScalar: () => multiplyScalar,
    multiplyScalarAndAdd: () => multiplyScalarAndAdd,
    ortho: () => ortho,
    orthoNO: () => orthoNO,
    orthoZO: () => orthoZO,
    perspective: () => perspective,
    perspectiveFromFieldOfView: () => perspectiveFromFieldOfView,
    perspectiveNO: () => perspectiveNO,
    perspectiveZO: () => perspectiveZO,
    rotate: () => rotate,
    rotateX: () => rotateX,
    rotateY: () => rotateY,
    rotateZ: () => rotateZ,
    scale: () => scale,
    set: () => set,
    str: () => str,
    sub: () => sub,
    subtract: () => subtract,
    targetTo: () => targetTo,
    translate: () => translate,
    transpose: () => transpose
  });
  function create2() {
    var out = new ARRAY_TYPE(16);
    if (ARRAY_TYPE != Float32Array) {
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
    }
    out[0] = 1;
    out[5] = 1;
    out[10] = 1;
    out[15] = 1;
    return out;
  }
  function clone(a) {
    var out = new ARRAY_TYPE(16);
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    out[8] = a[8];
    out[9] = a[9];
    out[10] = a[10];
    out[11] = a[11];
    out[12] = a[12];
    out[13] = a[13];
    out[14] = a[14];
    out[15] = a[15];
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
    out[9] = a[9];
    out[10] = a[10];
    out[11] = a[11];
    out[12] = a[12];
    out[13] = a[13];
    out[14] = a[14];
    out[15] = a[15];
    return out;
  }
  function fromValues(m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33) {
    var out = new ARRAY_TYPE(16);
    out[0] = m00;
    out[1] = m01;
    out[2] = m02;
    out[3] = m03;
    out[4] = m10;
    out[5] = m11;
    out[6] = m12;
    out[7] = m13;
    out[8] = m20;
    out[9] = m21;
    out[10] = m22;
    out[11] = m23;
    out[12] = m30;
    out[13] = m31;
    out[14] = m32;
    out[15] = m33;
    return out;
  }
  function set(out, m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33) {
    out[0] = m00;
    out[1] = m01;
    out[2] = m02;
    out[3] = m03;
    out[4] = m10;
    out[5] = m11;
    out[6] = m12;
    out[7] = m13;
    out[8] = m20;
    out[9] = m21;
    out[10] = m22;
    out[11] = m23;
    out[12] = m30;
    out[13] = m31;
    out[14] = m32;
    out[15] = m33;
    return out;
  }
  function identity(out) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = 1;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 1;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
  }
  function transpose(out, a) {
    if (out === a) {
      var a01 = a[1], a02 = a[2], a03 = a[3];
      var a12 = a[6], a13 = a[7];
      var a23 = a[11];
      out[1] = a[4];
      out[2] = a[8];
      out[3] = a[12];
      out[4] = a01;
      out[6] = a[9];
      out[7] = a[13];
      out[8] = a02;
      out[9] = a12;
      out[11] = a[14];
      out[12] = a03;
      out[13] = a13;
      out[14] = a23;
    } else {
      out[0] = a[0];
      out[1] = a[4];
      out[2] = a[8];
      out[3] = a[12];
      out[4] = a[1];
      out[5] = a[5];
      out[6] = a[9];
      out[7] = a[13];
      out[8] = a[2];
      out[9] = a[6];
      out[10] = a[10];
      out[11] = a[14];
      out[12] = a[3];
      out[13] = a[7];
      out[14] = a[11];
      out[15] = a[15];
    }
    return out;
  }
  function invert(out, a) {
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
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  }
  function adjoint(out, a) {
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
    out[0] = a11 * b11 - a12 * b10 + a13 * b09;
    out[1] = a02 * b10 - a01 * b11 - a03 * b09;
    out[2] = a31 * b05 - a32 * b04 + a33 * b03;
    out[3] = a22 * b04 - a21 * b05 - a23 * b03;
    out[4] = a12 * b08 - a10 * b11 - a13 * b07;
    out[5] = a00 * b11 - a02 * b08 + a03 * b07;
    out[6] = a32 * b02 - a30 * b05 - a33 * b01;
    out[7] = a20 * b05 - a22 * b02 + a23 * b01;
    out[8] = a10 * b10 - a11 * b08 + a13 * b06;
    out[9] = a01 * b08 - a00 * b10 - a03 * b06;
    out[10] = a30 * b04 - a31 * b02 + a33 * b00;
    out[11] = a21 * b02 - a20 * b04 - a23 * b00;
    out[12] = a11 * b07 - a10 * b09 - a12 * b06;
    out[13] = a00 * b09 - a01 * b07 + a02 * b06;
    out[14] = a31 * b01 - a30 * b03 - a32 * b00;
    out[15] = a20 * b03 - a21 * b01 + a22 * b00;
    return out;
  }
  function determinant(a) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    var b0 = a00 * a11 - a01 * a10;
    var b1 = a00 * a12 - a02 * a10;
    var b2 = a01 * a12 - a02 * a11;
    var b3 = a20 * a31 - a21 * a30;
    var b4 = a20 * a32 - a22 * a30;
    var b5 = a21 * a32 - a22 * a31;
    var b6 = a00 * b5 - a01 * b4 + a02 * b3;
    var b7 = a10 * b5 - a11 * b4 + a12 * b3;
    var b8 = a20 * b2 - a21 * b1 + a22 * b0;
    var b9 = a30 * b2 - a31 * b1 + a32 * b0;
    return a13 * b6 - a03 * b7 + a33 * b8 - a23 * b9;
  }
  function multiply(out, a, b) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
    out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[4];
    b1 = b[5];
    b2 = b[6];
    b3 = b[7];
    out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[8];
    b1 = b[9];
    b2 = b[10];
    b3 = b[11];
    out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[12];
    b1 = b[13];
    b2 = b[14];
    b3 = b[15];
    out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    return out;
  }
  function translate(out, a, v) {
    var x = v[0], y = v[1], z = v[2];
    var a00, a01, a02, a03;
    var a10, a11, a12, a13;
    var a20, a21, a22, a23;
    if (a === out) {
      out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
      out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
      out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
      out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
    } else {
      a00 = a[0];
      a01 = a[1];
      a02 = a[2];
      a03 = a[3];
      a10 = a[4];
      a11 = a[5];
      a12 = a[6];
      a13 = a[7];
      a20 = a[8];
      a21 = a[9];
      a22 = a[10];
      a23 = a[11];
      out[0] = a00;
      out[1] = a01;
      out[2] = a02;
      out[3] = a03;
      out[4] = a10;
      out[5] = a11;
      out[6] = a12;
      out[7] = a13;
      out[8] = a20;
      out[9] = a21;
      out[10] = a22;
      out[11] = a23;
      out[12] = a00 * x + a10 * y + a20 * z + a[12];
      out[13] = a01 * x + a11 * y + a21 * z + a[13];
      out[14] = a02 * x + a12 * y + a22 * z + a[14];
      out[15] = a03 * x + a13 * y + a23 * z + a[15];
    }
    return out;
  }
  function scale(out, a, v) {
    var x = v[0], y = v[1], z = v[2];
    out[0] = a[0] * x;
    out[1] = a[1] * x;
    out[2] = a[2] * x;
    out[3] = a[3] * x;
    out[4] = a[4] * y;
    out[5] = a[5] * y;
    out[6] = a[6] * y;
    out[7] = a[7] * y;
    out[8] = a[8] * z;
    out[9] = a[9] * z;
    out[10] = a[10] * z;
    out[11] = a[11] * z;
    out[12] = a[12];
    out[13] = a[13];
    out[14] = a[14];
    out[15] = a[15];
    return out;
  }
  function rotate(out, a, rad, axis) {
    var x = axis[0], y = axis[1], z = axis[2];
    var len4 = Math.sqrt(x * x + y * y + z * z);
    var s, c, t;
    var a00, a01, a02, a03;
    var a10, a11, a12, a13;
    var a20, a21, a22, a23;
    var b00, b01, b02;
    var b10, b11, b12;
    var b20, b21, b22;
    if (len4 < EPSILON) {
      return null;
    }
    len4 = 1 / len4;
    x *= len4;
    y *= len4;
    z *= len4;
    s = Math.sin(rad);
    c = Math.cos(rad);
    t = 1 - c;
    a00 = a[0];
    a01 = a[1];
    a02 = a[2];
    a03 = a[3];
    a10 = a[4];
    a11 = a[5];
    a12 = a[6];
    a13 = a[7];
    a20 = a[8];
    a21 = a[9];
    a22 = a[10];
    a23 = a[11];
    b00 = x * x * t + c;
    b01 = y * x * t + z * s;
    b02 = z * x * t - y * s;
    b10 = x * y * t - z * s;
    b11 = y * y * t + c;
    b12 = z * y * t + x * s;
    b20 = x * z * t + y * s;
    b21 = y * z * t - x * s;
    b22 = z * z * t + c;
    out[0] = a00 * b00 + a10 * b01 + a20 * b02;
    out[1] = a01 * b00 + a11 * b01 + a21 * b02;
    out[2] = a02 * b00 + a12 * b01 + a22 * b02;
    out[3] = a03 * b00 + a13 * b01 + a23 * b02;
    out[4] = a00 * b10 + a10 * b11 + a20 * b12;
    out[5] = a01 * b10 + a11 * b11 + a21 * b12;
    out[6] = a02 * b10 + a12 * b11 + a22 * b12;
    out[7] = a03 * b10 + a13 * b11 + a23 * b12;
    out[8] = a00 * b20 + a10 * b21 + a20 * b22;
    out[9] = a01 * b20 + a11 * b21 + a21 * b22;
    out[10] = a02 * b20 + a12 * b21 + a22 * b22;
    out[11] = a03 * b20 + a13 * b21 + a23 * b22;
    if (a !== out) {
      out[12] = a[12];
      out[13] = a[13];
      out[14] = a[14];
      out[15] = a[15];
    }
    return out;
  }
  function rotateX(out, a, rad) {
    var s = Math.sin(rad);
    var c = Math.cos(rad);
    var a10 = a[4];
    var a11 = a[5];
    var a12 = a[6];
    var a13 = a[7];
    var a20 = a[8];
    var a21 = a[9];
    var a22 = a[10];
    var a23 = a[11];
    if (a !== out) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[12] = a[12];
      out[13] = a[13];
      out[14] = a[14];
      out[15] = a[15];
    }
    out[4] = a10 * c + a20 * s;
    out[5] = a11 * c + a21 * s;
    out[6] = a12 * c + a22 * s;
    out[7] = a13 * c + a23 * s;
    out[8] = a20 * c - a10 * s;
    out[9] = a21 * c - a11 * s;
    out[10] = a22 * c - a12 * s;
    out[11] = a23 * c - a13 * s;
    return out;
  }
  function rotateY(out, a, rad) {
    var s = Math.sin(rad);
    var c = Math.cos(rad);
    var a00 = a[0];
    var a01 = a[1];
    var a02 = a[2];
    var a03 = a[3];
    var a20 = a[8];
    var a21 = a[9];
    var a22 = a[10];
    var a23 = a[11];
    if (a !== out) {
      out[4] = a[4];
      out[5] = a[5];
      out[6] = a[6];
      out[7] = a[7];
      out[12] = a[12];
      out[13] = a[13];
      out[14] = a[14];
      out[15] = a[15];
    }
    out[0] = a00 * c - a20 * s;
    out[1] = a01 * c - a21 * s;
    out[2] = a02 * c - a22 * s;
    out[3] = a03 * c - a23 * s;
    out[8] = a00 * s + a20 * c;
    out[9] = a01 * s + a21 * c;
    out[10] = a02 * s + a22 * c;
    out[11] = a03 * s + a23 * c;
    return out;
  }
  function rotateZ(out, a, rad) {
    var s = Math.sin(rad);
    var c = Math.cos(rad);
    var a00 = a[0];
    var a01 = a[1];
    var a02 = a[2];
    var a03 = a[3];
    var a10 = a[4];
    var a11 = a[5];
    var a12 = a[6];
    var a13 = a[7];
    if (a !== out) {
      out[8] = a[8];
      out[9] = a[9];
      out[10] = a[10];
      out[11] = a[11];
      out[12] = a[12];
      out[13] = a[13];
      out[14] = a[14];
      out[15] = a[15];
    }
    out[0] = a00 * c + a10 * s;
    out[1] = a01 * c + a11 * s;
    out[2] = a02 * c + a12 * s;
    out[3] = a03 * c + a13 * s;
    out[4] = a10 * c - a00 * s;
    out[5] = a11 * c - a01 * s;
    out[6] = a12 * c - a02 * s;
    out[7] = a13 * c - a03 * s;
    return out;
  }
  function fromTranslation(out, v) {
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = 1;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 1;
    out[11] = 0;
    out[12] = v[0];
    out[13] = v[1];
    out[14] = v[2];
    out[15] = 1;
    return out;
  }
  function fromScaling(out, v) {
    out[0] = v[0];
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = v[1];
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = v[2];
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
  }
  function fromRotation(out, rad, axis) {
    var x = axis[0], y = axis[1], z = axis[2];
    var len4 = Math.sqrt(x * x + y * y + z * z);
    var s, c, t;
    if (len4 < EPSILON) {
      return null;
    }
    len4 = 1 / len4;
    x *= len4;
    y *= len4;
    z *= len4;
    s = Math.sin(rad);
    c = Math.cos(rad);
    t = 1 - c;
    out[0] = x * x * t + c;
    out[1] = y * x * t + z * s;
    out[2] = z * x * t - y * s;
    out[3] = 0;
    out[4] = x * y * t - z * s;
    out[5] = y * y * t + c;
    out[6] = z * y * t + x * s;
    out[7] = 0;
    out[8] = x * z * t + y * s;
    out[9] = y * z * t - x * s;
    out[10] = z * z * t + c;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
  }
  function fromXRotation(out, rad) {
    var s = Math.sin(rad);
    var c = Math.cos(rad);
    out[0] = 1;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = c;
    out[6] = s;
    out[7] = 0;
    out[8] = 0;
    out[9] = -s;
    out[10] = c;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
  }
  function fromYRotation(out, rad) {
    var s = Math.sin(rad);
    var c = Math.cos(rad);
    out[0] = c;
    out[1] = 0;
    out[2] = -s;
    out[3] = 0;
    out[4] = 0;
    out[5] = 1;
    out[6] = 0;
    out[7] = 0;
    out[8] = s;
    out[9] = 0;
    out[10] = c;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
  }
  function fromZRotation(out, rad) {
    var s = Math.sin(rad);
    var c = Math.cos(rad);
    out[0] = c;
    out[1] = s;
    out[2] = 0;
    out[3] = 0;
    out[4] = -s;
    out[5] = c;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 1;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
  }
  function fromRotationTranslation(out, q, v) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var x2 = x + x;
    var y2 = y + y;
    var z2 = z + z;
    var xx = x * x2;
    var xy = x * y2;
    var xz = x * z2;
    var yy = y * y2;
    var yz2 = y * z2;
    var zz = z * z2;
    var wx = w * x2;
    var wy = w * y2;
    var wz = w * z2;
    out[0] = 1 - (yy + zz);
    out[1] = xy + wz;
    out[2] = xz - wy;
    out[3] = 0;
    out[4] = xy - wz;
    out[5] = 1 - (xx + zz);
    out[6] = yz2 + wx;
    out[7] = 0;
    out[8] = xz + wy;
    out[9] = yz2 - wx;
    out[10] = 1 - (xx + yy);
    out[11] = 0;
    out[12] = v[0];
    out[13] = v[1];
    out[14] = v[2];
    out[15] = 1;
    return out;
  }
  function fromQuat2(out, a) {
    var translation = new ARRAY_TYPE(3);
    var bx = -a[0], by = -a[1], bz = -a[2], bw = a[3], ax = a[4], ay = a[5], az = a[6], aw = a[7];
    var magnitude = bx * bx + by * by + bz * bz + bw * bw;
    if (magnitude > 0) {
      translation[0] = (ax * bw + aw * bx + ay * bz - az * by) * 2 / magnitude;
      translation[1] = (ay * bw + aw * by + az * bx - ax * bz) * 2 / magnitude;
      translation[2] = (az * bw + aw * bz + ax * by - ay * bx) * 2 / magnitude;
    } else {
      translation[0] = (ax * bw + aw * bx + ay * bz - az * by) * 2;
      translation[1] = (ay * bw + aw * by + az * bx - ax * bz) * 2;
      translation[2] = (az * bw + aw * bz + ax * by - ay * bx) * 2;
    }
    fromRotationTranslation(out, a, translation);
    return out;
  }
  function getTranslation(out, mat) {
    out[0] = mat[12];
    out[1] = mat[13];
    out[2] = mat[14];
    return out;
  }
  function getScaling(out, mat) {
    var m11 = mat[0];
    var m12 = mat[1];
    var m13 = mat[2];
    var m21 = mat[4];
    var m22 = mat[5];
    var m23 = mat[6];
    var m31 = mat[8];
    var m32 = mat[9];
    var m33 = mat[10];
    out[0] = Math.sqrt(m11 * m11 + m12 * m12 + m13 * m13);
    out[1] = Math.sqrt(m21 * m21 + m22 * m22 + m23 * m23);
    out[2] = Math.sqrt(m31 * m31 + m32 * m32 + m33 * m33);
    return out;
  }
  function getRotation(out, mat) {
    var scaling = new ARRAY_TYPE(3);
    getScaling(scaling, mat);
    var is1 = 1 / scaling[0];
    var is2 = 1 / scaling[1];
    var is3 = 1 / scaling[2];
    var sm11 = mat[0] * is1;
    var sm12 = mat[1] * is2;
    var sm13 = mat[2] * is3;
    var sm21 = mat[4] * is1;
    var sm22 = mat[5] * is2;
    var sm23 = mat[6] * is3;
    var sm31 = mat[8] * is1;
    var sm32 = mat[9] * is2;
    var sm33 = mat[10] * is3;
    var trace = sm11 + sm22 + sm33;
    var S = 0;
    if (trace > 0) {
      S = Math.sqrt(trace + 1) * 2;
      out[3] = 0.25 * S;
      out[0] = (sm23 - sm32) / S;
      out[1] = (sm31 - sm13) / S;
      out[2] = (sm12 - sm21) / S;
    } else if (sm11 > sm22 && sm11 > sm33) {
      S = Math.sqrt(1 + sm11 - sm22 - sm33) * 2;
      out[3] = (sm23 - sm32) / S;
      out[0] = 0.25 * S;
      out[1] = (sm12 + sm21) / S;
      out[2] = (sm31 + sm13) / S;
    } else if (sm22 > sm33) {
      S = Math.sqrt(1 + sm22 - sm11 - sm33) * 2;
      out[3] = (sm31 - sm13) / S;
      out[0] = (sm12 + sm21) / S;
      out[1] = 0.25 * S;
      out[2] = (sm23 + sm32) / S;
    } else {
      S = Math.sqrt(1 + sm33 - sm11 - sm22) * 2;
      out[3] = (sm12 - sm21) / S;
      out[0] = (sm31 + sm13) / S;
      out[1] = (sm23 + sm32) / S;
      out[2] = 0.25 * S;
    }
    return out;
  }
  function decompose(out_r, out_t, out_s, mat) {
    out_t[0] = mat[12];
    out_t[1] = mat[13];
    out_t[2] = mat[14];
    var m11 = mat[0];
    var m12 = mat[1];
    var m13 = mat[2];
    var m21 = mat[4];
    var m22 = mat[5];
    var m23 = mat[6];
    var m31 = mat[8];
    var m32 = mat[9];
    var m33 = mat[10];
    out_s[0] = Math.sqrt(m11 * m11 + m12 * m12 + m13 * m13);
    out_s[1] = Math.sqrt(m21 * m21 + m22 * m22 + m23 * m23);
    out_s[2] = Math.sqrt(m31 * m31 + m32 * m32 + m33 * m33);
    var is1 = 1 / out_s[0];
    var is2 = 1 / out_s[1];
    var is3 = 1 / out_s[2];
    var sm11 = m11 * is1;
    var sm12 = m12 * is2;
    var sm13 = m13 * is3;
    var sm21 = m21 * is1;
    var sm22 = m22 * is2;
    var sm23 = m23 * is3;
    var sm31 = m31 * is1;
    var sm32 = m32 * is2;
    var sm33 = m33 * is3;
    var trace = sm11 + sm22 + sm33;
    var S = 0;
    if (trace > 0) {
      S = Math.sqrt(trace + 1) * 2;
      out_r[3] = 0.25 * S;
      out_r[0] = (sm23 - sm32) / S;
      out_r[1] = (sm31 - sm13) / S;
      out_r[2] = (sm12 - sm21) / S;
    } else if (sm11 > sm22 && sm11 > sm33) {
      S = Math.sqrt(1 + sm11 - sm22 - sm33) * 2;
      out_r[3] = (sm23 - sm32) / S;
      out_r[0] = 0.25 * S;
      out_r[1] = (sm12 + sm21) / S;
      out_r[2] = (sm31 + sm13) / S;
    } else if (sm22 > sm33) {
      S = Math.sqrt(1 + sm22 - sm11 - sm33) * 2;
      out_r[3] = (sm31 - sm13) / S;
      out_r[0] = (sm12 + sm21) / S;
      out_r[1] = 0.25 * S;
      out_r[2] = (sm23 + sm32) / S;
    } else {
      S = Math.sqrt(1 + sm33 - sm11 - sm22) * 2;
      out_r[3] = (sm12 - sm21) / S;
      out_r[0] = (sm31 + sm13) / S;
      out_r[1] = (sm23 + sm32) / S;
      out_r[2] = 0.25 * S;
    }
    return out_r;
  }
  function fromRotationTranslationScale(out, q, v, s) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var x2 = x + x;
    var y2 = y + y;
    var z2 = z + z;
    var xx = x * x2;
    var xy = x * y2;
    var xz = x * z2;
    var yy = y * y2;
    var yz2 = y * z2;
    var zz = z * z2;
    var wx = w * x2;
    var wy = w * y2;
    var wz = w * z2;
    var sx = s[0];
    var sy = s[1];
    var sz = s[2];
    out[0] = (1 - (yy + zz)) * sx;
    out[1] = (xy + wz) * sx;
    out[2] = (xz - wy) * sx;
    out[3] = 0;
    out[4] = (xy - wz) * sy;
    out[5] = (1 - (xx + zz)) * sy;
    out[6] = (yz2 + wx) * sy;
    out[7] = 0;
    out[8] = (xz + wy) * sz;
    out[9] = (yz2 - wx) * sz;
    out[10] = (1 - (xx + yy)) * sz;
    out[11] = 0;
    out[12] = v[0];
    out[13] = v[1];
    out[14] = v[2];
    out[15] = 1;
    return out;
  }
  function fromRotationTranslationScaleOrigin(out, q, v, s, o) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var x2 = x + x;
    var y2 = y + y;
    var z2 = z + z;
    var xx = x * x2;
    var xy = x * y2;
    var xz = x * z2;
    var yy = y * y2;
    var yz2 = y * z2;
    var zz = z * z2;
    var wx = w * x2;
    var wy = w * y2;
    var wz = w * z2;
    var sx = s[0];
    var sy = s[1];
    var sz = s[2];
    var ox = o[0];
    var oy = o[1];
    var oz = o[2];
    var out0 = (1 - (yy + zz)) * sx;
    var out1 = (xy + wz) * sx;
    var out2 = (xz - wy) * sx;
    var out4 = (xy - wz) * sy;
    var out5 = (1 - (xx + zz)) * sy;
    var out6 = (yz2 + wx) * sy;
    var out8 = (xz + wy) * sz;
    var out9 = (yz2 - wx) * sz;
    var out10 = (1 - (xx + yy)) * sz;
    out[0] = out0;
    out[1] = out1;
    out[2] = out2;
    out[3] = 0;
    out[4] = out4;
    out[5] = out5;
    out[6] = out6;
    out[7] = 0;
    out[8] = out8;
    out[9] = out9;
    out[10] = out10;
    out[11] = 0;
    out[12] = v[0] + ox - (out0 * ox + out4 * oy + out8 * oz);
    out[13] = v[1] + oy - (out1 * ox + out5 * oy + out9 * oz);
    out[14] = v[2] + oz - (out2 * ox + out6 * oy + out10 * oz);
    out[15] = 1;
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
    out[1] = yx + wz;
    out[2] = zx - wy;
    out[3] = 0;
    out[4] = yx - wz;
    out[5] = 1 - xx - zz;
    out[6] = zy + wx;
    out[7] = 0;
    out[8] = zx + wy;
    out[9] = zy - wx;
    out[10] = 1 - xx - yy;
    out[11] = 0;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
  }
  function frustum(out, left, right, bottom, top, near2, far) {
    var rl = 1 / (right - left);
    var tb = 1 / (top - bottom);
    var nf = 1 / (near2 - far);
    out[0] = near2 * 2 * rl;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = near2 * 2 * tb;
    out[6] = 0;
    out[7] = 0;
    out[8] = (right + left) * rl;
    out[9] = (top + bottom) * tb;
    out[10] = (far + near2) * nf;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[14] = far * near2 * 2 * nf;
    out[15] = 0;
    return out;
  }
  function perspectiveNO(out, fovy, aspect, near2, far) {
    var f = 1 / Math.tan(fovy / 2);
    out[0] = f / aspect;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = f;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[15] = 0;
    if (far != null && far !== Infinity) {
      var nf = 1 / (near2 - far);
      out[10] = (far + near2) * nf;
      out[14] = 2 * far * near2 * nf;
    } else {
      out[10] = -1;
      out[14] = -2 * near2;
    }
    return out;
  }
  var perspective = perspectiveNO;
  function perspectiveZO(out, fovy, aspect, near2, far) {
    var f = 1 / Math.tan(fovy / 2);
    out[0] = f / aspect;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = f;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[15] = 0;
    if (far != null && far !== Infinity) {
      var nf = 1 / (near2 - far);
      out[10] = far * nf;
      out[14] = far * near2 * nf;
    } else {
      out[10] = -1;
      out[14] = -near2;
    }
    return out;
  }
  function perspectiveFromFieldOfView(out, fov, near2, far) {
    var upTan = Math.tan(fov.upDegrees * Math.PI / 180);
    var downTan = Math.tan(fov.downDegrees * Math.PI / 180);
    var leftTan = Math.tan(fov.leftDegrees * Math.PI / 180);
    var rightTan = Math.tan(fov.rightDegrees * Math.PI / 180);
    var xScale = 2 / (leftTan + rightTan);
    var yScale = 2 / (upTan + downTan);
    out[0] = xScale;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = yScale;
    out[6] = 0;
    out[7] = 0;
    out[8] = -((leftTan - rightTan) * xScale * 0.5);
    out[9] = (upTan - downTan) * yScale * 0.5;
    out[10] = far / (near2 - far);
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[14] = far * near2 / (near2 - far);
    out[15] = 0;
    return out;
  }
  function orthoNO(out, left, right, bottom, top, near2, far) {
    var lr = 1 / (left - right);
    var bt = 1 / (bottom - top);
    var nf = 1 / (near2 - far);
    out[0] = -2 * lr;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = -2 * bt;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = 2 * nf;
    out[11] = 0;
    out[12] = (left + right) * lr;
    out[13] = (top + bottom) * bt;
    out[14] = (far + near2) * nf;
    out[15] = 1;
    return out;
  }
  var ortho = orthoNO;
  function orthoZO(out, left, right, bottom, top, near2, far) {
    var lr = 1 / (left - right);
    var bt = 1 / (bottom - top);
    var nf = 1 / (near2 - far);
    out[0] = -2 * lr;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = -2 * bt;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = nf;
    out[11] = 0;
    out[12] = (left + right) * lr;
    out[13] = (top + bottom) * bt;
    out[14] = near2 * nf;
    out[15] = 1;
    return out;
  }
  function lookAt(out, eye, center, up) {
    var x0, x1, x2, y0, y1, y2, z0, z1, z2, len4;
    var eyex = eye[0];
    var eyey = eye[1];
    var eyez = eye[2];
    var upx = up[0];
    var upy = up[1];
    var upz = up[2];
    var centerx = center[0];
    var centery = center[1];
    var centerz = center[2];
    if (Math.abs(eyex - centerx) < EPSILON && Math.abs(eyey - centery) < EPSILON && Math.abs(eyez - centerz) < EPSILON) {
      return identity(out);
    }
    z0 = eyex - centerx;
    z1 = eyey - centery;
    z2 = eyez - centerz;
    len4 = 1 / Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2);
    z0 *= len4;
    z1 *= len4;
    z2 *= len4;
    x0 = upy * z2 - upz * z1;
    x1 = upz * z0 - upx * z2;
    x2 = upx * z1 - upy * z0;
    len4 = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
    if (!len4) {
      x0 = 0;
      x1 = 0;
      x2 = 0;
    } else {
      len4 = 1 / len4;
      x0 *= len4;
      x1 *= len4;
      x2 *= len4;
    }
    y0 = z1 * x2 - z2 * x1;
    y1 = z2 * x0 - z0 * x2;
    y2 = z0 * x1 - z1 * x0;
    len4 = Math.sqrt(y0 * y0 + y1 * y1 + y2 * y2);
    if (!len4) {
      y0 = 0;
      y1 = 0;
      y2 = 0;
    } else {
      len4 = 1 / len4;
      y0 *= len4;
      y1 *= len4;
      y2 *= len4;
    }
    out[0] = x0;
    out[1] = y0;
    out[2] = z0;
    out[3] = 0;
    out[4] = x1;
    out[5] = y1;
    out[6] = z1;
    out[7] = 0;
    out[8] = x2;
    out[9] = y2;
    out[10] = z2;
    out[11] = 0;
    out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
    out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
    out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
    out[15] = 1;
    return out;
  }
  function targetTo(out, eye, target, up) {
    var eyex = eye[0], eyey = eye[1], eyez = eye[2], upx = up[0], upy = up[1], upz = up[2];
    var z0 = eyex - target[0], z1 = eyey - target[1], z2 = eyez - target[2];
    var len4 = z0 * z0 + z1 * z1 + z2 * z2;
    if (len4 > 0) {
      len4 = 1 / Math.sqrt(len4);
      z0 *= len4;
      z1 *= len4;
      z2 *= len4;
    }
    var x0 = upy * z2 - upz * z1, x1 = upz * z0 - upx * z2, x2 = upx * z1 - upy * z0;
    len4 = x0 * x0 + x1 * x1 + x2 * x2;
    if (len4 > 0) {
      len4 = 1 / Math.sqrt(len4);
      x0 *= len4;
      x1 *= len4;
      x2 *= len4;
    }
    out[0] = x0;
    out[1] = x1;
    out[2] = x2;
    out[3] = 0;
    out[4] = z1 * x2 - z2 * x1;
    out[5] = z2 * x0 - z0 * x2;
    out[6] = z0 * x1 - z1 * x0;
    out[7] = 0;
    out[8] = z0;
    out[9] = z1;
    out[10] = z2;
    out[11] = 0;
    out[12] = eyex;
    out[13] = eyey;
    out[14] = eyez;
    out[15] = 1;
    return out;
  }
  function str(a) {
    return "mat4(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ", " + a[4] + ", " + a[5] + ", " + a[6] + ", " + a[7] + ", " + a[8] + ", " + a[9] + ", " + a[10] + ", " + a[11] + ", " + a[12] + ", " + a[13] + ", " + a[14] + ", " + a[15] + ")";
  }
  function frob(a) {
    return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3] + a[4] * a[4] + a[5] * a[5] + a[6] * a[6] + a[7] * a[7] + a[8] * a[8] + a[9] * a[9] + a[10] * a[10] + a[11] * a[11] + a[12] * a[12] + a[13] * a[13] + a[14] * a[14] + a[15] * a[15]);
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
    out[9] = a[9] + b[9];
    out[10] = a[10] + b[10];
    out[11] = a[11] + b[11];
    out[12] = a[12] + b[12];
    out[13] = a[13] + b[13];
    out[14] = a[14] + b[14];
    out[15] = a[15] + b[15];
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
    out[9] = a[9] - b[9];
    out[10] = a[10] - b[10];
    out[11] = a[11] - b[11];
    out[12] = a[12] - b[12];
    out[13] = a[13] - b[13];
    out[14] = a[14] - b[14];
    out[15] = a[15] - b[15];
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
    out[9] = a[9] * b;
    out[10] = a[10] * b;
    out[11] = a[11] * b;
    out[12] = a[12] * b;
    out[13] = a[13] * b;
    out[14] = a[14] * b;
    out[15] = a[15] * b;
    return out;
  }
  function multiplyScalarAndAdd(out, a, b, scale7) {
    out[0] = a[0] + b[0] * scale7;
    out[1] = a[1] + b[1] * scale7;
    out[2] = a[2] + b[2] * scale7;
    out[3] = a[3] + b[3] * scale7;
    out[4] = a[4] + b[4] * scale7;
    out[5] = a[5] + b[5] * scale7;
    out[6] = a[6] + b[6] * scale7;
    out[7] = a[7] + b[7] * scale7;
    out[8] = a[8] + b[8] * scale7;
    out[9] = a[9] + b[9] * scale7;
    out[10] = a[10] + b[10] * scale7;
    out[11] = a[11] + b[11] * scale7;
    out[12] = a[12] + b[12] * scale7;
    out[13] = a[13] + b[13] * scale7;
    out[14] = a[14] + b[14] * scale7;
    out[15] = a[15] + b[15] * scale7;
    return out;
  }
  function exactEquals(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5] && a[6] === b[6] && a[7] === b[7] && a[8] === b[8] && a[9] === b[9] && a[10] === b[10] && a[11] === b[11] && a[12] === b[12] && a[13] === b[13] && a[14] === b[14] && a[15] === b[15];
  }
  function equals(a, b) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
    var a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7];
    var a8 = a[8], a9 = a[9], a10 = a[10], a11 = a[11];
    var a12 = a[12], a13 = a[13], a14 = a[14], a15 = a[15];
    var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
    var b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7];
    var b8 = b[8], b9 = b[9], b10 = b[10], b11 = b[11];
    var b12 = b[12], b13 = b[13], b14 = b[14], b15 = b[15];
    return Math.abs(a0 - b0) <= EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3)) && Math.abs(a4 - b4) <= EPSILON * Math.max(1, Math.abs(a4), Math.abs(b4)) && Math.abs(a5 - b5) <= EPSILON * Math.max(1, Math.abs(a5), Math.abs(b5)) && Math.abs(a6 - b6) <= EPSILON * Math.max(1, Math.abs(a6), Math.abs(b6)) && Math.abs(a7 - b7) <= EPSILON * Math.max(1, Math.abs(a7), Math.abs(b7)) && Math.abs(a8 - b8) <= EPSILON * Math.max(1, Math.abs(a8), Math.abs(b8)) && Math.abs(a9 - b9) <= EPSILON * Math.max(1, Math.abs(a9), Math.abs(b9)) && Math.abs(a10 - b10) <= EPSILON * Math.max(1, Math.abs(a10), Math.abs(b10)) && Math.abs(a11 - b11) <= EPSILON * Math.max(1, Math.abs(a11), Math.abs(b11)) && Math.abs(a12 - b12) <= EPSILON * Math.max(1, Math.abs(a12), Math.abs(b12)) && Math.abs(a13 - b13) <= EPSILON * Math.max(1, Math.abs(a13), Math.abs(b13)) && Math.abs(a14 - b14) <= EPSILON * Math.max(1, Math.abs(a14), Math.abs(b14)) && Math.abs(a15 - b15) <= EPSILON * Math.max(1, Math.abs(a15), Math.abs(b15));
  }
  var mul = multiply;
  var sub = subtract;

  // node_modules/.pnpm/gl-matrix@3.4.4/node_modules/gl-matrix/esm/vec3.js
  var vec3_exports = {};
  __export(vec3_exports, {
    add: () => add2,
    angle: () => angle,
    bezier: () => bezier,
    ceil: () => ceil,
    clone: () => clone2,
    copy: () => copy2,
    create: () => create3,
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
    hermite: () => hermite,
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
    rotateX: () => rotateX2,
    rotateY: () => rotateY2,
    rotateZ: () => rotateZ2,
    round: () => round2,
    scale: () => scale2,
    scaleAndAdd: () => scaleAndAdd,
    set: () => set2,
    slerp: () => slerp,
    sqrDist: () => sqrDist,
    sqrLen: () => sqrLen,
    squaredDistance: () => squaredDistance,
    squaredLength: () => squaredLength,
    str: () => str2,
    sub: () => sub2,
    subtract: () => subtract2,
    transformMat3: () => transformMat3,
    transformMat4: () => transformMat4,
    transformQuat: () => transformQuat,
    zero: () => zero
  });
  function create3() {
    var out = new ARRAY_TYPE(3);
    if (ARRAY_TYPE != Float32Array) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
    }
    return out;
  }
  function clone2(a) {
    var out = new ARRAY_TYPE(3);
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    return out;
  }
  function length(a) {
    var x = a[0];
    var y = a[1];
    var z = a[2];
    return Math.sqrt(x * x + y * y + z * z);
  }
  function fromValues2(x, y, z) {
    var out = new ARRAY_TYPE(3);
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
  }
  function copy2(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    return out;
  }
  function set2(out, x, y, z) {
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
  }
  function add2(out, a, b) {
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    out[2] = a[2] + b[2];
    return out;
  }
  function subtract2(out, a, b) {
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    out[2] = a[2] - b[2];
    return out;
  }
  function multiply2(out, a, b) {
    out[0] = a[0] * b[0];
    out[1] = a[1] * b[1];
    out[2] = a[2] * b[2];
    return out;
  }
  function divide(out, a, b) {
    out[0] = a[0] / b[0];
    out[1] = a[1] / b[1];
    out[2] = a[2] / b[2];
    return out;
  }
  function ceil(out, a) {
    out[0] = Math.ceil(a[0]);
    out[1] = Math.ceil(a[1]);
    out[2] = Math.ceil(a[2]);
    return out;
  }
  function floor(out, a) {
    out[0] = Math.floor(a[0]);
    out[1] = Math.floor(a[1]);
    out[2] = Math.floor(a[2]);
    return out;
  }
  function min(out, a, b) {
    out[0] = Math.min(a[0], b[0]);
    out[1] = Math.min(a[1], b[1]);
    out[2] = Math.min(a[2], b[2]);
    return out;
  }
  function max(out, a, b) {
    out[0] = Math.max(a[0], b[0]);
    out[1] = Math.max(a[1], b[1]);
    out[2] = Math.max(a[2], b[2]);
    return out;
  }
  function round2(out, a) {
    out[0] = round(a[0]);
    out[1] = round(a[1]);
    out[2] = round(a[2]);
    return out;
  }
  function scale2(out, a, b) {
    out[0] = a[0] * b;
    out[1] = a[1] * b;
    out[2] = a[2] * b;
    return out;
  }
  function scaleAndAdd(out, a, b, scale7) {
    out[0] = a[0] + b[0] * scale7;
    out[1] = a[1] + b[1] * scale7;
    out[2] = a[2] + b[2] * scale7;
    return out;
  }
  function distance(a, b) {
    var x = b[0] - a[0];
    var y = b[1] - a[1];
    var z = b[2] - a[2];
    return Math.sqrt(x * x + y * y + z * z);
  }
  function squaredDistance(a, b) {
    var x = b[0] - a[0];
    var y = b[1] - a[1];
    var z = b[2] - a[2];
    return x * x + y * y + z * z;
  }
  function squaredLength(a) {
    var x = a[0];
    var y = a[1];
    var z = a[2];
    return x * x + y * y + z * z;
  }
  function negate(out, a) {
    out[0] = -a[0];
    out[1] = -a[1];
    out[2] = -a[2];
    return out;
  }
  function inverse(out, a) {
    out[0] = 1 / a[0];
    out[1] = 1 / a[1];
    out[2] = 1 / a[2];
    return out;
  }
  function normalize(out, a) {
    var x = a[0];
    var y = a[1];
    var z = a[2];
    var len4 = x * x + y * y + z * z;
    if (len4 > 0) {
      len4 = 1 / Math.sqrt(len4);
    }
    out[0] = a[0] * len4;
    out[1] = a[1] * len4;
    out[2] = a[2] * len4;
    return out;
  }
  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
  function cross(out, a, b) {
    var ax = a[0], ay = a[1], az = a[2];
    var bx = b[0], by = b[1], bz = b[2];
    out[0] = ay * bz - az * by;
    out[1] = az * bx - ax * bz;
    out[2] = ax * by - ay * bx;
    return out;
  }
  function lerp(out, a, b, t) {
    var ax = a[0];
    var ay = a[1];
    var az = a[2];
    out[0] = ax + t * (b[0] - ax);
    out[1] = ay + t * (b[1] - ay);
    out[2] = az + t * (b[2] - az);
    return out;
  }
  function slerp(out, a, b, t) {
    var angle3 = Math.acos(Math.min(Math.max(dot(a, b), -1), 1));
    var sinTotal = Math.sin(angle3);
    var ratioA = Math.sin((1 - t) * angle3) / sinTotal;
    var ratioB = Math.sin(t * angle3) / sinTotal;
    out[0] = ratioA * a[0] + ratioB * b[0];
    out[1] = ratioA * a[1] + ratioB * b[1];
    out[2] = ratioA * a[2] + ratioB * b[2];
    return out;
  }
  function hermite(out, a, b, c, d, t) {
    var factorTimes2 = t * t;
    var factor1 = factorTimes2 * (2 * t - 3) + 1;
    var factor2 = factorTimes2 * (t - 2) + t;
    var factor3 = factorTimes2 * (t - 1);
    var factor4 = factorTimes2 * (3 - 2 * t);
    out[0] = a[0] * factor1 + b[0] * factor2 + c[0] * factor3 + d[0] * factor4;
    out[1] = a[1] * factor1 + b[1] * factor2 + c[1] * factor3 + d[1] * factor4;
    out[2] = a[2] * factor1 + b[2] * factor2 + c[2] * factor3 + d[2] * factor4;
    return out;
  }
  function bezier(out, a, b, c, d, t) {
    var inverseFactor = 1 - t;
    var inverseFactorTimesTwo = inverseFactor * inverseFactor;
    var factorTimes2 = t * t;
    var factor1 = inverseFactorTimesTwo * inverseFactor;
    var factor2 = 3 * t * inverseFactorTimesTwo;
    var factor3 = 3 * factorTimes2 * inverseFactor;
    var factor4 = factorTimes2 * t;
    out[0] = a[0] * factor1 + b[0] * factor2 + c[0] * factor3 + d[0] * factor4;
    out[1] = a[1] * factor1 + b[1] * factor2 + c[1] * factor3 + d[1] * factor4;
    out[2] = a[2] * factor1 + b[2] * factor2 + c[2] * factor3 + d[2] * factor4;
    return out;
  }
  function random(out, scale7) {
    scale7 = scale7 === void 0 ? 1 : scale7;
    var r = RANDOM() * 2 * Math.PI;
    var z = RANDOM() * 2 - 1;
    var zScale = Math.sqrt(1 - z * z) * scale7;
    out[0] = Math.cos(r) * zScale;
    out[1] = Math.sin(r) * zScale;
    out[2] = z * scale7;
    return out;
  }
  function transformMat4(out, a, m) {
    var x = a[0], y = a[1], z = a[2];
    var w = m[3] * x + m[7] * y + m[11] * z + m[15];
    w = w || 1;
    out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    return out;
  }
  function transformMat3(out, a, m) {
    var x = a[0], y = a[1], z = a[2];
    out[0] = x * m[0] + y * m[3] + z * m[6];
    out[1] = x * m[1] + y * m[4] + z * m[7];
    out[2] = x * m[2] + y * m[5] + z * m[8];
    return out;
  }
  function transformQuat(out, a, q) {
    var qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    var vx = a[0], vy = a[1], vz = a[2];
    var tx = qy * vz - qz * vy;
    var ty = qz * vx - qx * vz;
    var tz = qx * vy - qy * vx;
    tx = tx + tx;
    ty = ty + ty;
    tz = tz + tz;
    out[0] = vx + qw * tx + qy * tz - qz * ty;
    out[1] = vy + qw * ty + qz * tx - qx * tz;
    out[2] = vz + qw * tz + qx * ty - qy * tx;
    return out;
  }
  function rotateX2(out, a, b, rad) {
    var p = [], r = [];
    p[0] = a[0] - b[0];
    p[1] = a[1] - b[1];
    p[2] = a[2] - b[2];
    r[0] = p[0];
    r[1] = p[1] * Math.cos(rad) - p[2] * Math.sin(rad);
    r[2] = p[1] * Math.sin(rad) + p[2] * Math.cos(rad);
    out[0] = r[0] + b[0];
    out[1] = r[1] + b[1];
    out[2] = r[2] + b[2];
    return out;
  }
  function rotateY2(out, a, b, rad) {
    var p = [], r = [];
    p[0] = a[0] - b[0];
    p[1] = a[1] - b[1];
    p[2] = a[2] - b[2];
    r[0] = p[2] * Math.sin(rad) + p[0] * Math.cos(rad);
    r[1] = p[1];
    r[2] = p[2] * Math.cos(rad) - p[0] * Math.sin(rad);
    out[0] = r[0] + b[0];
    out[1] = r[1] + b[1];
    out[2] = r[2] + b[2];
    return out;
  }
  function rotateZ2(out, a, b, rad) {
    var p = [], r = [];
    p[0] = a[0] - b[0];
    p[1] = a[1] - b[1];
    p[2] = a[2] - b[2];
    r[0] = p[0] * Math.cos(rad) - p[1] * Math.sin(rad);
    r[1] = p[0] * Math.sin(rad) + p[1] * Math.cos(rad);
    r[2] = p[2];
    out[0] = r[0] + b[0];
    out[1] = r[1] + b[1];
    out[2] = r[2] + b[2];
    return out;
  }
  function angle(a, b) {
    var ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2], mag = Math.sqrt((ax * ax + ay * ay + az * az) * (bx * bx + by * by + bz * bz)), cosine = mag && dot(a, b) / mag;
    return Math.acos(Math.min(Math.max(cosine, -1), 1));
  }
  function zero(out) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  function str2(a) {
    return "vec3(" + a[0] + ", " + a[1] + ", " + a[2] + ")";
  }
  function exactEquals2(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }
  function equals2(a, b) {
    var a0 = a[0], a1 = a[1], a2 = a[2];
    var b0 = b[0], b1 = b[1], b2 = b[2];
    return Math.abs(a0 - b0) <= EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2));
  }
  var sub2 = subtract2;
  var mul2 = multiply2;
  var div = divide;
  var dist = distance;
  var sqrDist = squaredDistance;
  var len = length;
  var sqrLen = squaredLength;
  var forEach = (function() {
    var vec = create3();
    return function(a, stride, offset, count, fn, arg) {
      var i, l;
      if (!stride) {
        stride = 3;
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
        vec[2] = a[i + 2];
        fn(vec, vec, arg);
        a[i] = vec[0];
        a[i + 1] = vec[1];
        a[i + 2] = vec[2];
      }
      return a;
    };
  })();

  // node_modules/.pnpm/gl-matrix@3.4.4/node_modules/gl-matrix/esm/vec4.js
  function create4() {
    var out = new ARRAY_TYPE(4);
    if (ARRAY_TYPE != Float32Array) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
    }
    return out;
  }
  function copy3(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    return out;
  }
  function length2(a) {
    var x = a[0];
    var y = a[1];
    var z = a[2];
    var w = a[3];
    return Math.sqrt(x * x + y * y + z * z + w * w);
  }
  function squaredLength2(a) {
    var x = a[0];
    var y = a[1];
    var z = a[2];
    var w = a[3];
    return x * x + y * y + z * z + w * w;
  }
  function normalize2(out, a) {
    var x = a[0];
    var y = a[1];
    var z = a[2];
    var w = a[3];
    var len4 = x * x + y * y + z * z + w * w;
    if (len4 > 0) {
      len4 = 1 / Math.sqrt(len4);
    }
    out[0] = x * len4;
    out[1] = y * len4;
    out[2] = z * len4;
    out[3] = w * len4;
    return out;
  }
  function dot2(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  }
  var forEach2 = (function() {
    var vec = create4();
    return function(a, stride, offset, count, fn, arg) {
      var i, l;
      if (!stride) {
        stride = 4;
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
        vec[2] = a[i + 2];
        vec[3] = a[i + 3];
        fn(vec, vec, arg);
        a[i] = vec[0];
        a[i + 1] = vec[1];
        a[i + 2] = vec[2];
        a[i + 3] = vec[3];
      }
      return a;
    };
  })();

  // node_modules/.pnpm/gl-matrix@3.4.4/node_modules/gl-matrix/esm/quat.js
  function create5() {
    var out = new ARRAY_TYPE(4);
    if (ARRAY_TYPE != Float32Array) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
    }
    out[3] = 1;
    return out;
  }
  function setAxisAngle(out, axis, rad) {
    rad = rad * 0.5;
    var s = Math.sin(rad);
    out[0] = s * axis[0];
    out[1] = s * axis[1];
    out[2] = s * axis[2];
    out[3] = Math.cos(rad);
    return out;
  }
  function rotateX3(out, a, rad) {
    rad *= 0.5;
    var ax = a[0], ay = a[1], az = a[2], aw = a[3];
    var bx = Math.sin(rad), bw = Math.cos(rad);
    out[0] = ax * bw + aw * bx;
    out[1] = ay * bw + az * bx;
    out[2] = az * bw - ay * bx;
    out[3] = aw * bw - ax * bx;
    return out;
  }
  function rotateY3(out, a, rad) {
    rad *= 0.5;
    var ax = a[0], ay = a[1], az = a[2], aw = a[3];
    var by = Math.sin(rad), bw = Math.cos(rad);
    out[0] = ax * bw - az * by;
    out[1] = ay * bw + aw * by;
    out[2] = az * bw + ax * by;
    out[3] = aw * bw - ay * by;
    return out;
  }
  function rotateZ3(out, a, rad) {
    rad *= 0.5;
    var ax = a[0], ay = a[1], az = a[2], aw = a[3];
    var bz = Math.sin(rad), bw = Math.cos(rad);
    out[0] = ax * bw + ay * bz;
    out[1] = ay * bw - ax * bz;
    out[2] = az * bw + aw * bz;
    out[3] = aw * bw - az * bz;
    return out;
  }
  function slerp2(out, a, b, t) {
    var ax = a[0], ay = a[1], az = a[2], aw = a[3];
    var bx = b[0], by = b[1], bz = b[2], bw = b[3];
    var omega, cosom, sinom, scale0, scale1;
    cosom = ax * bx + ay * by + az * bz + aw * bw;
    if (cosom < 0) {
      cosom = -cosom;
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
    }
    if (1 - cosom > EPSILON) {
      omega = Math.acos(cosom);
      sinom = Math.sin(omega);
      scale0 = Math.sin((1 - t) * omega) / sinom;
      scale1 = Math.sin(t * omega) / sinom;
    } else {
      scale0 = 1 - t;
      scale1 = t;
    }
    out[0] = scale0 * ax + scale1 * bx;
    out[1] = scale0 * ay + scale1 * by;
    out[2] = scale0 * az + scale1 * bz;
    out[3] = scale0 * aw + scale1 * bw;
    return out;
  }
  function fromMat3(out, m) {
    var fTrace = m[0] + m[4] + m[8];
    var fRoot;
    if (fTrace > 0) {
      fRoot = Math.sqrt(fTrace + 1);
      out[3] = 0.5 * fRoot;
      fRoot = 0.5 / fRoot;
      out[0] = (m[5] - m[7]) * fRoot;
      out[1] = (m[6] - m[2]) * fRoot;
      out[2] = (m[1] - m[3]) * fRoot;
    } else {
      var i = 0;
      if (m[4] > m[0]) i = 1;
      if (m[8] > m[i * 3 + i]) i = 2;
      var j = (i + 1) % 3;
      var k = (i + 2) % 3;
      fRoot = Math.sqrt(m[i * 3 + i] - m[j * 3 + j] - m[k * 3 + k] + 1);
      out[i] = 0.5 * fRoot;
      fRoot = 0.5 / fRoot;
      out[3] = (m[j * 3 + k] - m[k * 3 + j]) * fRoot;
      out[j] = (m[j * 3 + i] + m[i * 3 + j]) * fRoot;
      out[k] = (m[k * 3 + i] + m[i * 3 + k]) * fRoot;
    }
    return out;
  }
  var copy4 = copy3;
  var dot3 = dot2;
  var length3 = length2;
  var squaredLength3 = squaredLength2;
  var normalize3 = normalize2;
  var rotationTo = (function() {
    var tmpvec3 = create3();
    var xUnitVec3 = fromValues2(1, 0, 0);
    var yUnitVec3 = fromValues2(0, 1, 0);
    return function(out, a, b) {
      var dot6 = dot(a, b);
      if (dot6 < -0.999999) {
        cross(tmpvec3, xUnitVec3, a);
        if (len(tmpvec3) < 1e-6) cross(tmpvec3, yUnitVec3, a);
        normalize(tmpvec3, tmpvec3);
        setAxisAngle(out, tmpvec3, Math.PI);
        return out;
      } else if (dot6 > 0.999999) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        out[3] = 1;
        return out;
      } else {
        cross(tmpvec3, a, b);
        out[0] = tmpvec3[0];
        out[1] = tmpvec3[1];
        out[2] = tmpvec3[2];
        out[3] = 1 + dot6;
        return normalize3(out, out);
      }
    };
  })();
  var sqlerp = (function() {
    var temp1 = create5();
    var temp2 = create5();
    return function(out, a, b, c, d, t) {
      slerp2(temp1, a, d, t);
      slerp2(temp2, b, c, t);
      slerp2(out, temp1, temp2, 2 * t * (1 - t));
      return out;
    };
  })();
  var setAxes = (function() {
    var matr = create();
    return function(out, view, right, up) {
      matr[0] = right[0];
      matr[3] = right[1];
      matr[6] = right[2];
      matr[1] = up[0];
      matr[4] = up[1];
      matr[7] = up[2];
      matr[2] = -view[0];
      matr[5] = -view[1];
      matr[8] = -view[2];
      return normalize3(out, fromMat3(out, matr));
    };
  })();

  // node_modules/.pnpm/gl-matrix@3.4.4/node_modules/gl-matrix/esm/quat2.js
  var quat2_exports = {};
  __export(quat2_exports, {
    add: () => add4,
    clone: () => clone4,
    conjugate: () => conjugate,
    copy: () => copy5,
    create: () => create6,
    dot: () => dot4,
    equals: () => equals3,
    exactEquals: () => exactEquals4,
    fromMat4: () => fromMat4,
    fromRotation: () => fromRotation2,
    fromRotationTranslation: () => fromRotationTranslation2,
    fromRotationTranslationValues: () => fromRotationTranslationValues,
    fromTranslation: () => fromTranslation2,
    fromValues: () => fromValues4,
    getDual: () => getDual,
    getReal: () => getReal,
    getTranslation: () => getTranslation2,
    identity: () => identity2,
    invert: () => invert2,
    len: () => len2,
    length: () => length4,
    lerp: () => lerp3,
    mul: () => mul3,
    multiply: () => multiply3,
    normalize: () => normalize4,
    rotateAroundAxis: () => rotateAroundAxis,
    rotateByQuatAppend: () => rotateByQuatAppend,
    rotateByQuatPrepend: () => rotateByQuatPrepend,
    rotateX: () => rotateX4,
    rotateY: () => rotateY4,
    rotateZ: () => rotateZ4,
    scale: () => scale4,
    set: () => set4,
    setDual: () => setDual,
    setReal: () => setReal,
    sqrLen: () => sqrLen2,
    squaredLength: () => squaredLength4,
    str: () => str3,
    translate: () => translate2
  });
  function create6() {
    var dq = new ARRAY_TYPE(8);
    if (ARRAY_TYPE != Float32Array) {
      dq[0] = 0;
      dq[1] = 0;
      dq[2] = 0;
      dq[4] = 0;
      dq[5] = 0;
      dq[6] = 0;
      dq[7] = 0;
    }
    dq[3] = 1;
    return dq;
  }
  function clone4(a) {
    var dq = new ARRAY_TYPE(8);
    dq[0] = a[0];
    dq[1] = a[1];
    dq[2] = a[2];
    dq[3] = a[3];
    dq[4] = a[4];
    dq[5] = a[5];
    dq[6] = a[6];
    dq[7] = a[7];
    return dq;
  }
  function fromValues4(x1, y1, z1, w1, x2, y2, z2, w2) {
    var dq = new ARRAY_TYPE(8);
    dq[0] = x1;
    dq[1] = y1;
    dq[2] = z1;
    dq[3] = w1;
    dq[4] = x2;
    dq[5] = y2;
    dq[6] = z2;
    dq[7] = w2;
    return dq;
  }
  function fromRotationTranslationValues(x1, y1, z1, w1, x2, y2, z2) {
    var dq = new ARRAY_TYPE(8);
    dq[0] = x1;
    dq[1] = y1;
    dq[2] = z1;
    dq[3] = w1;
    var ax = x2 * 0.5, ay = y2 * 0.5, az = z2 * 0.5;
    dq[4] = ax * w1 + ay * z1 - az * y1;
    dq[5] = ay * w1 + az * x1 - ax * z1;
    dq[6] = az * w1 + ax * y1 - ay * x1;
    dq[7] = -ax * x1 - ay * y1 - az * z1;
    return dq;
  }
  function fromRotationTranslation2(out, q, t) {
    var ax = t[0] * 0.5, ay = t[1] * 0.5, az = t[2] * 0.5, bx = q[0], by = q[1], bz = q[2], bw = q[3];
    out[0] = bx;
    out[1] = by;
    out[2] = bz;
    out[3] = bw;
    out[4] = ax * bw + ay * bz - az * by;
    out[5] = ay * bw + az * bx - ax * bz;
    out[6] = az * bw + ax * by - ay * bx;
    out[7] = -ax * bx - ay * by - az * bz;
    return out;
  }
  function fromTranslation2(out, t) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    out[4] = t[0] * 0.5;
    out[5] = t[1] * 0.5;
    out[6] = t[2] * 0.5;
    out[7] = 0;
    return out;
  }
  function fromRotation2(out, q) {
    out[0] = q[0];
    out[1] = q[1];
    out[2] = q[2];
    out[3] = q[3];
    out[4] = 0;
    out[5] = 0;
    out[6] = 0;
    out[7] = 0;
    return out;
  }
  function fromMat4(out, a) {
    var outer = create5();
    getRotation(outer, a);
    var t = new ARRAY_TYPE(3);
    getTranslation(t, a);
    fromRotationTranslation2(out, outer, t);
    return out;
  }
  function copy5(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = a[3];
    out[4] = a[4];
    out[5] = a[5];
    out[6] = a[6];
    out[7] = a[7];
    return out;
  }
  function identity2(out) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
    out[4] = 0;
    out[5] = 0;
    out[6] = 0;
    out[7] = 0;
    return out;
  }
  function set4(out, x1, y1, z1, w1, x2, y2, z2, w2) {
    out[0] = x1;
    out[1] = y1;
    out[2] = z1;
    out[3] = w1;
    out[4] = x2;
    out[5] = y2;
    out[6] = z2;
    out[7] = w2;
    return out;
  }
  var getReal = copy4;
  function getDual(out, a) {
    out[0] = a[4];
    out[1] = a[5];
    out[2] = a[6];
    out[3] = a[7];
    return out;
  }
  var setReal = copy4;
  function setDual(out, q) {
    out[4] = q[0];
    out[5] = q[1];
    out[6] = q[2];
    out[7] = q[3];
    return out;
  }
  function getTranslation2(out, a) {
    var ax = a[4], ay = a[5], az = a[6], aw = a[7], bx = -a[0], by = -a[1], bz = -a[2], bw = a[3];
    out[0] = (ax * bw + aw * bx + ay * bz - az * by) * 2;
    out[1] = (ay * bw + aw * by + az * bx - ax * bz) * 2;
    out[2] = (az * bw + aw * bz + ax * by - ay * bx) * 2;
    return out;
  }
  function translate2(out, a, v) {
    var ax1 = a[0], ay1 = a[1], az1 = a[2], aw1 = a[3], bx1 = v[0] * 0.5, by1 = v[1] * 0.5, bz1 = v[2] * 0.5, ax2 = a[4], ay2 = a[5], az2 = a[6], aw2 = a[7];
    out[0] = ax1;
    out[1] = ay1;
    out[2] = az1;
    out[3] = aw1;
    out[4] = aw1 * bx1 + ay1 * bz1 - az1 * by1 + ax2;
    out[5] = aw1 * by1 + az1 * bx1 - ax1 * bz1 + ay2;
    out[6] = aw1 * bz1 + ax1 * by1 - ay1 * bx1 + az2;
    out[7] = -ax1 * bx1 - ay1 * by1 - az1 * bz1 + aw2;
    return out;
  }
  function rotateX4(out, a, rad) {
    var bx = -a[0], by = -a[1], bz = -a[2], bw = a[3], ax = a[4], ay = a[5], az = a[6], aw = a[7], ax1 = ax * bw + aw * bx + ay * bz - az * by, ay1 = ay * bw + aw * by + az * bx - ax * bz, az1 = az * bw + aw * bz + ax * by - ay * bx, aw1 = aw * bw - ax * bx - ay * by - az * bz;
    rotateX3(out, a, rad);
    bx = out[0];
    by = out[1];
    bz = out[2];
    bw = out[3];
    out[4] = ax1 * bw + aw1 * bx + ay1 * bz - az1 * by;
    out[5] = ay1 * bw + aw1 * by + az1 * bx - ax1 * bz;
    out[6] = az1 * bw + aw1 * bz + ax1 * by - ay1 * bx;
    out[7] = aw1 * bw - ax1 * bx - ay1 * by - az1 * bz;
    return out;
  }
  function rotateY4(out, a, rad) {
    var bx = -a[0], by = -a[1], bz = -a[2], bw = a[3], ax = a[4], ay = a[5], az = a[6], aw = a[7], ax1 = ax * bw + aw * bx + ay * bz - az * by, ay1 = ay * bw + aw * by + az * bx - ax * bz, az1 = az * bw + aw * bz + ax * by - ay * bx, aw1 = aw * bw - ax * bx - ay * by - az * bz;
    rotateY3(out, a, rad);
    bx = out[0];
    by = out[1];
    bz = out[2];
    bw = out[3];
    out[4] = ax1 * bw + aw1 * bx + ay1 * bz - az1 * by;
    out[5] = ay1 * bw + aw1 * by + az1 * bx - ax1 * bz;
    out[6] = az1 * bw + aw1 * bz + ax1 * by - ay1 * bx;
    out[7] = aw1 * bw - ax1 * bx - ay1 * by - az1 * bz;
    return out;
  }
  function rotateZ4(out, a, rad) {
    var bx = -a[0], by = -a[1], bz = -a[2], bw = a[3], ax = a[4], ay = a[5], az = a[6], aw = a[7], ax1 = ax * bw + aw * bx + ay * bz - az * by, ay1 = ay * bw + aw * by + az * bx - ax * bz, az1 = az * bw + aw * bz + ax * by - ay * bx, aw1 = aw * bw - ax * bx - ay * by - az * bz;
    rotateZ3(out, a, rad);
    bx = out[0];
    by = out[1];
    bz = out[2];
    bw = out[3];
    out[4] = ax1 * bw + aw1 * bx + ay1 * bz - az1 * by;
    out[5] = ay1 * bw + aw1 * by + az1 * bx - ax1 * bz;
    out[6] = az1 * bw + aw1 * bz + ax1 * by - ay1 * bx;
    out[7] = aw1 * bw - ax1 * bx - ay1 * by - az1 * bz;
    return out;
  }
  function rotateByQuatAppend(out, a, q) {
    var qx = q[0], qy = q[1], qz = q[2], qw = q[3], ax = a[0], ay = a[1], az = a[2], aw = a[3];
    out[0] = ax * qw + aw * qx + ay * qz - az * qy;
    out[1] = ay * qw + aw * qy + az * qx - ax * qz;
    out[2] = az * qw + aw * qz + ax * qy - ay * qx;
    out[3] = aw * qw - ax * qx - ay * qy - az * qz;
    ax = a[4];
    ay = a[5];
    az = a[6];
    aw = a[7];
    out[4] = ax * qw + aw * qx + ay * qz - az * qy;
    out[5] = ay * qw + aw * qy + az * qx - ax * qz;
    out[6] = az * qw + aw * qz + ax * qy - ay * qx;
    out[7] = aw * qw - ax * qx - ay * qy - az * qz;
    return out;
  }
  function rotateByQuatPrepend(out, q, a) {
    var qx = q[0], qy = q[1], qz = q[2], qw = q[3], bx = a[0], by = a[1], bz = a[2], bw = a[3];
    out[0] = qx * bw + qw * bx + qy * bz - qz * by;
    out[1] = qy * bw + qw * by + qz * bx - qx * bz;
    out[2] = qz * bw + qw * bz + qx * by - qy * bx;
    out[3] = qw * bw - qx * bx - qy * by - qz * bz;
    bx = a[4];
    by = a[5];
    bz = a[6];
    bw = a[7];
    out[4] = qx * bw + qw * bx + qy * bz - qz * by;
    out[5] = qy * bw + qw * by + qz * bx - qx * bz;
    out[6] = qz * bw + qw * bz + qx * by - qy * bx;
    out[7] = qw * bw - qx * bx - qy * by - qz * bz;
    return out;
  }
  function rotateAroundAxis(out, a, axis, rad) {
    if (Math.abs(rad) < EPSILON) {
      return copy5(out, a);
    }
    var axisLength = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
    rad = rad * 0.5;
    var s = Math.sin(rad);
    var bx = s * axis[0] / axisLength;
    var by = s * axis[1] / axisLength;
    var bz = s * axis[2] / axisLength;
    var bw = Math.cos(rad);
    var ax1 = a[0], ay1 = a[1], az1 = a[2], aw1 = a[3];
    out[0] = ax1 * bw + aw1 * bx + ay1 * bz - az1 * by;
    out[1] = ay1 * bw + aw1 * by + az1 * bx - ax1 * bz;
    out[2] = az1 * bw + aw1 * bz + ax1 * by - ay1 * bx;
    out[3] = aw1 * bw - ax1 * bx - ay1 * by - az1 * bz;
    var ax = a[4], ay = a[5], az = a[6], aw = a[7];
    out[4] = ax * bw + aw * bx + ay * bz - az * by;
    out[5] = ay * bw + aw * by + az * bx - ax * bz;
    out[6] = az * bw + aw * bz + ax * by - ay * bx;
    out[7] = aw * bw - ax * bx - ay * by - az * bz;
    return out;
  }
  function add4(out, a, b) {
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    out[2] = a[2] + b[2];
    out[3] = a[3] + b[3];
    out[4] = a[4] + b[4];
    out[5] = a[5] + b[5];
    out[6] = a[6] + b[6];
    out[7] = a[7] + b[7];
    return out;
  }
  function multiply3(out, a, b) {
    var ax0 = a[0], ay0 = a[1], az0 = a[2], aw0 = a[3], bx1 = b[4], by1 = b[5], bz1 = b[6], bw1 = b[7], ax1 = a[4], ay1 = a[5], az1 = a[6], aw1 = a[7], bx0 = b[0], by0 = b[1], bz0 = b[2], bw0 = b[3];
    out[0] = ax0 * bw0 + aw0 * bx0 + ay0 * bz0 - az0 * by0;
    out[1] = ay0 * bw0 + aw0 * by0 + az0 * bx0 - ax0 * bz0;
    out[2] = az0 * bw0 + aw0 * bz0 + ax0 * by0 - ay0 * bx0;
    out[3] = aw0 * bw0 - ax0 * bx0 - ay0 * by0 - az0 * bz0;
    out[4] = ax0 * bw1 + aw0 * bx1 + ay0 * bz1 - az0 * by1 + ax1 * bw0 + aw1 * bx0 + ay1 * bz0 - az1 * by0;
    out[5] = ay0 * bw1 + aw0 * by1 + az0 * bx1 - ax0 * bz1 + ay1 * bw0 + aw1 * by0 + az1 * bx0 - ax1 * bz0;
    out[6] = az0 * bw1 + aw0 * bz1 + ax0 * by1 - ay0 * bx1 + az1 * bw0 + aw1 * bz0 + ax1 * by0 - ay1 * bx0;
    out[7] = aw0 * bw1 - ax0 * bx1 - ay0 * by1 - az0 * bz1 + aw1 * bw0 - ax1 * bx0 - ay1 * by0 - az1 * bz0;
    return out;
  }
  var mul3 = multiply3;
  function scale4(out, a, b) {
    out[0] = a[0] * b;
    out[1] = a[1] * b;
    out[2] = a[2] * b;
    out[3] = a[3] * b;
    out[4] = a[4] * b;
    out[5] = a[5] * b;
    out[6] = a[6] * b;
    out[7] = a[7] * b;
    return out;
  }
  var dot4 = dot3;
  function lerp3(out, a, b, t) {
    var mt = 1 - t;
    if (dot4(a, b) < 0) t = -t;
    out[0] = a[0] * mt + b[0] * t;
    out[1] = a[1] * mt + b[1] * t;
    out[2] = a[2] * mt + b[2] * t;
    out[3] = a[3] * mt + b[3] * t;
    out[4] = a[4] * mt + b[4] * t;
    out[5] = a[5] * mt + b[5] * t;
    out[6] = a[6] * mt + b[6] * t;
    out[7] = a[7] * mt + b[7] * t;
    return out;
  }
  function invert2(out, a) {
    var sqlen = squaredLength4(a);
    out[0] = -a[0] / sqlen;
    out[1] = -a[1] / sqlen;
    out[2] = -a[2] / sqlen;
    out[3] = a[3] / sqlen;
    out[4] = -a[4] / sqlen;
    out[5] = -a[5] / sqlen;
    out[6] = -a[6] / sqlen;
    out[7] = a[7] / sqlen;
    return out;
  }
  function conjugate(out, a) {
    out[0] = -a[0];
    out[1] = -a[1];
    out[2] = -a[2];
    out[3] = a[3];
    out[4] = -a[4];
    out[5] = -a[5];
    out[6] = -a[6];
    out[7] = a[7];
    return out;
  }
  var length4 = length3;
  var len2 = length4;
  var squaredLength4 = squaredLength3;
  var sqrLen2 = squaredLength4;
  function normalize4(out, a) {
    var magnitude = squaredLength4(a);
    if (magnitude > 0) {
      magnitude = Math.sqrt(magnitude);
      var a0 = a[0] / magnitude;
      var a1 = a[1] / magnitude;
      var a2 = a[2] / magnitude;
      var a3 = a[3] / magnitude;
      var b0 = a[4];
      var b1 = a[5];
      var b2 = a[6];
      var b3 = a[7];
      var a_dot_b = a0 * b0 + a1 * b1 + a2 * b2 + a3 * b3;
      out[0] = a0;
      out[1] = a1;
      out[2] = a2;
      out[3] = a3;
      out[4] = (b0 - a0 * a_dot_b) / magnitude;
      out[5] = (b1 - a1 * a_dot_b) / magnitude;
      out[6] = (b2 - a2 * a_dot_b) / magnitude;
      out[7] = (b3 - a3 * a_dot_b) / magnitude;
    }
    return out;
  }
  function str3(a) {
    return "quat2(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ", " + a[4] + ", " + a[5] + ", " + a[6] + ", " + a[7] + ")";
  }
  function exactEquals4(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5] && a[6] === b[6] && a[7] === b[7];
  }
  function equals3(a, b) {
    var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7];
    var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7];
    return Math.abs(a0 - b0) <= EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3)) && Math.abs(a4 - b4) <= EPSILON * Math.max(1, Math.abs(a4), Math.abs(b4)) && Math.abs(a5 - b5) <= EPSILON * Math.max(1, Math.abs(a5), Math.abs(b5)) && Math.abs(a6 - b6) <= EPSILON * Math.max(1, Math.abs(a6), Math.abs(b6)) && Math.abs(a7 - b7) <= EPSILON * Math.max(1, Math.abs(a7), Math.abs(b7));
  }

  // node_modules/.pnpm/gl-matrix@3.4.4/node_modules/gl-matrix/esm/vec2.js
  var vec2_exports = {};
  __export(vec2_exports, {
    add: () => add5,
    angle: () => angle2,
    ceil: () => ceil2,
    clone: () => clone5,
    copy: () => copy6,
    create: () => create7,
    cross: () => cross2,
    dist: () => dist2,
    distance: () => distance2,
    div: () => div2,
    divide: () => divide2,
    dot: () => dot5,
    equals: () => equals4,
    exactEquals: () => exactEquals5,
    floor: () => floor2,
    forEach: () => forEach3,
    fromValues: () => fromValues5,
    inverse: () => inverse2,
    len: () => len3,
    length: () => length5,
    lerp: () => lerp4,
    max: () => max2,
    min: () => min2,
    mul: () => mul4,
    multiply: () => multiply4,
    negate: () => negate2,
    normalize: () => normalize5,
    random: () => random2,
    rotate: () => rotate2,
    round: () => round3,
    scale: () => scale5,
    scaleAndAdd: () => scaleAndAdd2,
    set: () => set5,
    signedAngle: () => signedAngle,
    sqrDist: () => sqrDist2,
    sqrLen: () => sqrLen3,
    squaredDistance: () => squaredDistance2,
    squaredLength: () => squaredLength5,
    str: () => str4,
    sub: () => sub3,
    subtract: () => subtract3,
    transformMat2: () => transformMat2,
    transformMat2d: () => transformMat2d,
    transformMat3: () => transformMat32,
    transformMat4: () => transformMat42,
    zero: () => zero2
  });
  function create7() {
    var out = new ARRAY_TYPE(2);
    if (ARRAY_TYPE != Float32Array) {
      out[0] = 0;
      out[1] = 0;
    }
    return out;
  }
  function clone5(a) {
    var out = new ARRAY_TYPE(2);
    out[0] = a[0];
    out[1] = a[1];
    return out;
  }
  function fromValues5(x, y) {
    var out = new ARRAY_TYPE(2);
    out[0] = x;
    out[1] = y;
    return out;
  }
  function copy6(out, a) {
    out[0] = a[0];
    out[1] = a[1];
    return out;
  }
  function set5(out, x, y) {
    out[0] = x;
    out[1] = y;
    return out;
  }
  function add5(out, a, b) {
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    return out;
  }
  function subtract3(out, a, b) {
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    return out;
  }
  function multiply4(out, a, b) {
    out[0] = a[0] * b[0];
    out[1] = a[1] * b[1];
    return out;
  }
  function divide2(out, a, b) {
    out[0] = a[0] / b[0];
    out[1] = a[1] / b[1];
    return out;
  }
  function ceil2(out, a) {
    out[0] = Math.ceil(a[0]);
    out[1] = Math.ceil(a[1]);
    return out;
  }
  function floor2(out, a) {
    out[0] = Math.floor(a[0]);
    out[1] = Math.floor(a[1]);
    return out;
  }
  function min2(out, a, b) {
    out[0] = Math.min(a[0], b[0]);
    out[1] = Math.min(a[1], b[1]);
    return out;
  }
  function max2(out, a, b) {
    out[0] = Math.max(a[0], b[0]);
    out[1] = Math.max(a[1], b[1]);
    return out;
  }
  function round3(out, a) {
    out[0] = round(a[0]);
    out[1] = round(a[1]);
    return out;
  }
  function scale5(out, a, b) {
    out[0] = a[0] * b;
    out[1] = a[1] * b;
    return out;
  }
  function scaleAndAdd2(out, a, b, scale7) {
    out[0] = a[0] + b[0] * scale7;
    out[1] = a[1] + b[1] * scale7;
    return out;
  }
  function distance2(a, b) {
    var x = b[0] - a[0], y = b[1] - a[1];
    return Math.sqrt(x * x + y * y);
  }
  function squaredDistance2(a, b) {
    var x = b[0] - a[0], y = b[1] - a[1];
    return x * x + y * y;
  }
  function length5(a) {
    var x = a[0], y = a[1];
    return Math.sqrt(x * x + y * y);
  }
  function squaredLength5(a) {
    var x = a[0], y = a[1];
    return x * x + y * y;
  }
  function negate2(out, a) {
    out[0] = -a[0];
    out[1] = -a[1];
    return out;
  }
  function inverse2(out, a) {
    out[0] = 1 / a[0];
    out[1] = 1 / a[1];
    return out;
  }
  function normalize5(out, a) {
    var x = a[0], y = a[1];
    var len4 = x * x + y * y;
    if (len4 > 0) {
      len4 = 1 / Math.sqrt(len4);
    }
    out[0] = a[0] * len4;
    out[1] = a[1] * len4;
    return out;
  }
  function dot5(a, b) {
    return a[0] * b[0] + a[1] * b[1];
  }
  function cross2(out, a, b) {
    var z = a[0] * b[1] - a[1] * b[0];
    out[0] = out[1] = 0;
    out[2] = z;
    return out;
  }
  function lerp4(out, a, b, t) {
    var ax = a[0], ay = a[1];
    out[0] = ax + t * (b[0] - ax);
    out[1] = ay + t * (b[1] - ay);
    return out;
  }
  function random2(out, scale7) {
    scale7 = scale7 === void 0 ? 1 : scale7;
    var r = RANDOM() * 2 * Math.PI;
    out[0] = Math.cos(r) * scale7;
    out[1] = Math.sin(r) * scale7;
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
  function transformMat32(out, a, m) {
    var x = a[0], y = a[1];
    out[0] = m[0] * x + m[3] * y + m[6];
    out[1] = m[1] * x + m[4] * y + m[7];
    return out;
  }
  function transformMat42(out, a, m) {
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
  function angle2(a, b) {
    var ax = a[0], ay = a[1], bx = b[0], by = b[1];
    return Math.abs(Math.atan2(ay * bx - ax * by, ax * bx + ay * by));
  }
  function signedAngle(a, b) {
    var ax = a[0], ay = a[1], bx = b[0], by = b[1];
    return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  }
  function zero2(out) {
    out[0] = 0;
    out[1] = 0;
    return out;
  }
  function str4(a) {
    return "vec2(" + a[0] + ", " + a[1] + ")";
  }
  function exactEquals5(a, b) {
    return a[0] === b[0] && a[1] === b[1];
  }
  function equals4(a, b) {
    var a0 = a[0], a1 = a[1];
    var b0 = b[0], b1 = b[1];
    return Math.abs(a0 - b0) <= EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1));
  }
  var len3 = length5;
  var sub3 = subtract3;
  var mul4 = multiply4;
  var div2 = divide2;
  var dist2 = distance2;
  var sqrDist2 = squaredDistance2;
  var sqrLen3 = squaredLength5;
  var forEach3 = (function() {
    var vec = create7();
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

  // packages/render-engine/src/outline/arm.ts
  var DEFAULT_SECTIONS = 8;
  var ARM_SECTIONS = 16;
  var ARM_JOINT_RINGS = 3;
  var ARM_JOINT_RADIUS_RATIO = 2;
  var ARM_WRIST_RINGS = 2;
  var ARM_WRIST_RADIUS_RATIO = 1.5;
  var ARM_SHOULDER_INSET_X = 0.02;
  var ARM_SHOULDER_INSET_Y = 0.035;
  var ARM_SHOULDER_DEPTH_BIAS = 0.08;
  function shoulderRoot(shoulder, height) {
    const insetX = ARM_SHOULDER_INSET_X * height;
    const insetY = ARM_SHOULDER_INSET_Y * height;
    const inward = Math.abs(shoulder.x) < 1e-6 ? 0 : shoulder.x > 0 ? -insetX : insetX;
    return { x: shoulder.x + inward, y: shoulder.y - insetY };
  }
  function isArmPart(partId) {
    return partId === "armL" || partId === "armR";
  }
  function armOutlineVertexCount(sections = ARM_SECTIONS, jointRings = ARM_JOINT_RINGS, wristRings = ARM_WRIST_RINGS) {
    return 2 * (2 * sections + jointRings + wristRings + 3);
  }
  function halfWidthAt(profile, t) {
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    for (let i = 0; i < profile.length - 1; i += 1) {
      const left = profile[i];
      const right = profile[i + 1];
      if (clamped < left.t || clamped > right.t) continue;
      const span2 = right.t - left.t;
      const u = span2 === 0 ? 0 : (clamped - left.t) / span2;
      return left.halfWidth * (1 - u) + right.halfWidth * u;
    }
    throw new Error("profile");
  }
  function widthProfile(profile) {
    return (t) => halfWidthAt(profile, t);
  }
  function wristHalfWidth(handDir, lateral, thickness, halfWidth, halfThickness) {
    const dir = normalize6(handDir);
    const nx = -dir.y;
    const ny = dir.x;
    const across = halfWidth * (lateral.x * nx + lateral.y * ny);
    const deep = halfThickness * (thickness.x * nx + thickness.y * ny);
    return Math.hypot(across, deep);
  }
  function buildArmOutline(input) {
    const sections = Math.max(2, Math.floor(input.sections ?? DEFAULT_SECTIONS));
    const { shoulder, elbow, wrist } = input;
    const shoulderDepth = input.shoulderDepth ?? 0;
    const elbowDepth = input.elbowDepth ?? 0;
    const wristDepth = input.wristDepth ?? 0;
    const positions = [];
    const depths = [];
    const upperDir = direction(shoulder, elbow);
    const lowerDir = direction(elbow, wrist);
    const upperNormal = perpendicular(upperDir);
    const lowerNormal = perpendicular(lowerDir);
    const jointRings = Math.max(0, Math.floor(input.jointRings ?? ARM_JOINT_RINGS));
    const jointWidth = Math.min(input.upperWidth(1), input.lowerWidth(0));
    const radius = Math.max(1e-4, jointWidth * ARM_JOINT_RADIUS_RATIO);
    const start = { x: elbow.x - upperDir.x * radius, y: elbow.y - upperDir.y * radius };
    const end = { x: elbow.x + lowerDir.x * radius, y: elbow.y + lowerDir.y * radius };
    const handDir = normalize6(input.handDir ?? lowerDir);
    const wristRings = Math.max(0, Math.floor(input.wristRings ?? ARM_WRIST_RINGS));
    const wristStartWidth = input.lowerWidth(1);
    const wristWidth = Math.max(0, input.wristWidth ?? wristStartWidth);
    const wristRadius = Math.max(1e-4, wristStartWidth * ARM_WRIST_RADIUS_RATIO);
    const wristStart = {
      x: wrist.x - lowerDir.x * wristRadius,
      y: wrist.y - lowerDir.y * wristRadius
    };
    for (let s = 0; s <= sections; s += 1) {
      const t = s / sections;
      const center = s === sections ? start : lerpPoint(shoulder, start, t);
      emit(center, upperNormal, input.upperWidth(t), lerp5(shoulderDepth, elbowDepth, t), positions, depths);
    }
    for (let j = 1; j <= jointRings; j += 1) {
      const u = j / (jointRings + 1);
      const center = bezier2(start, elbow, end, u);
      const tangent = bezierTangent(start, elbow, end, u);
      emit(center, perpendicular(tangent), jointWidth, elbowDepth, positions, depths);
    }
    for (let s = 0; s <= sections; s += 1) {
      const t = s / sections;
      const center = s === 0 ? end : lerpPoint(end, wristStart, t);
      emit(center, lowerNormal, input.lowerWidth(t), lerp5(elbowDepth, wristDepth, t), positions, depths);
    }
    const control1 = { x: wristStart.x + lowerDir.x * (wristRadius / 3), y: wristStart.y + lowerDir.y * (wristRadius / 3) };
    const control2 = { x: wrist.x - handDir.x * (wristRadius / 3), y: wrist.y - handDir.y * (wristRadius / 3) };
    for (let j = 1; j <= wristRings; j += 1) {
      const u = j / (wristRings + 1);
      const center = cubic(wristStart, control1, control2, wrist, u);
      const tangent = cubicTangent(wristStart, control1, control2, wrist, u);
      const half = wristStartWidth + (wristWidth - wristStartWidth) * u;
      emit(center, perpendicular(tangent), half, wristDepth, positions, depths);
    }
    emit(wrist, perpendicular(handDir), wristWidth, wristDepth, positions, depths);
    const indices = [];
    const ring = 2;
    const total = 2 * sections + jointRings + wristRings + 3;
    for (let r = 0; r + 1 < total; r += 1) {
      const a = r * ring;
      const b = a + 1;
      const c = a + ring;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
    return {
      positions: new Float32Array(positions),
      indices: new Uint16Array(indices),
      depths: new Float32Array(depths)
    };
  }
  function emit(center, normal, half, depth, positions, depths) {
    const w = Math.max(0, half);
    positions.push(center.x + normal.x * w, center.y + normal.y * w);
    positions.push(center.x - normal.x * w, center.y - normal.y * w);
    depths.push(depth, depth);
  }
  function bezier2(a, control, b, t) {
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * control.y + t * t * b.y
    };
  }
  function bezierTangent(a, control, b, t) {
    const u = 1 - t;
    const x = 2 * u * (control.x - a.x) + 2 * t * (b.x - control.x);
    const y = 2 * u * (control.y - a.y) + 2 * t * (b.y - control.y);
    const length6 = Math.hypot(x, y);
    if (length6 < 1e-9) return { x: 1, y: 0 };
    return { x: x / length6, y: y / length6 };
  }
  function normalize6(d) {
    const length6 = Math.hypot(d.x, d.y);
    if (length6 < 1e-9) return { x: 0, y: -1 };
    return { x: d.x / length6, y: d.y / length6 };
  }
  function cubic(a, c1, c2, b, t) {
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    return {
      x: uu * u * a.x + 3 * uu * t * c1.x + 3 * u * tt * c2.x + tt * t * b.x,
      y: uu * u * a.y + 3 * uu * t * c1.y + 3 * u * tt * c2.y + tt * t * b.y
    };
  }
  function cubicTangent(a, c1, c2, b, t) {
    const u = 1 - t;
    return normalize6({
      x: 3 * u * u * (c1.x - a.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (b.x - c2.x),
      y: 3 * u * u * (c1.y - a.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (b.y - c2.y)
    });
  }
  function direction(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length6 = Math.hypot(dx, dy);
    if (length6 < 1e-9) return { x: 0, y: -1 };
    return { x: dx / length6, y: dy / length6 };
  }
  function perpendicular(d) {
    return { x: -d.y, y: d.x };
  }
  function lerpPoint(a, b, t) {
    return { x: lerp5(a.x, b.x, t), y: lerp5(a.y, b.y, t) };
  }
  function lerp5(a, b, t) {
    return a + (b - a) * t;
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
    const a = swingSign * (skeleton.bindSwing[bone] + swing);
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

  // packages/render-engine/src/mesh/texture.ts
  var TEXTURE_EDGE = 4;
  function createTriangleTexture(fill2, triangle) {
    const baseR = byteChannel(fill2.r);
    const baseG = byteChannel(fill2.g);
    const baseB = byteChannel(fill2.b);
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
  function createMeshTextures(indices, fill2) {
    if (indices.length < 3 || indices.length % 3 !== 0) throw new Error("mesh");
    const triangleCount = indices.length / 3;
    const textures = [];
    const triangleTexture = new Uint16Array(triangleCount);
    const uvs = new Float32Array(indices.length * 2);
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      textures.push(createTriangleTexture(fill2, triangle));
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
      for (let byte2 = 0; byte2 < image.rgb.length; byte2 += 1) {
        const value = image.rgb[byte2];
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
  var TUBE_SIDES = 24;
  var AXIAL_STEPS = 12;

  // packages/render-engine/src/mesh/humanoid.ts
  function createHumanoidMeshes(humanoid2, parts) {
    if (parts.skeleton !== humanoid2.skeleton) throw new Error("skeleton");
    const rig = writeBindRig(humanoid2);
    const meshes = [];
    for (let i = 0; i < parts.parts.length; i += 1) {
      const part = parts.parts[i];
      if (part.kind === "skinned") {
        meshes.push(skinnedMesh(part, humanoid2.skeleton, humanoid2.proportions, rig));
      } else {
        meshes.push(rigidMesh(part.id, part.bone, humanoid2.skeleton, humanoid2.proportions, part.fill));
      }
    }
    return { meshes };
  }
  function draft(skinned) {
    return { positions: [], indices: [], seam: [], endShare: [], skinned };
  }
  function skinnedMesh(part, skeleton, proportions, rig) {
    if (part.id === "torso") return torsoMesh(part, skeleton, proportions, rig);
    if (part.id === "armL" || part.id === "armR") return armOutlineMesh(part, skeleton, proportions, rig);
    if (part.id === "legL" || part.id === "legR") return legMesh(part, skeleton, proportions, rig);
    throw new Error("part");
  }
  function torsoMesh(part, skeleton, proportions, rig) {
    const d = draft(true);
    const spine = frameOf(rig, skeleton, findBone(skeleton, "spine"));
    const chest = frameOf(rig, skeleton, findBone(skeleton, "chest"));
    const neck = frameOf(rig, skeleton, findBone(skeleton, "neck"));
    const tS = 1 - proportions.shoulderDropY / proportions.chestLength;
    const chestTs = chestStations(tS);
    const spineRings = [];
    for (let k = 0; k <= AXIAL_STEPS; k += 1) {
      const t = k / AXIAL_STEPS;
      const ring = addRing(
        d,
        ringPoints(spine, t, torsoSectionAt(proportions, t * proportions.spineLength), TORSO_FRONT)
      );
      setShare(d, ring, Math.max(0, 1 - 2 * t), 0);
      spineRings.push(ring);
    }
    markSeam(d, spineRings[0]);
    link(d.indices, spineRings);
    const chestRings = [spineRings[spineRings.length - 1]];
    for (let i = 1; i < chestTs.length; i += 1) {
      const t = chestTs[i];
      const ring = addRing(
        d,
        ringPoints(chest, t, torsoSectionAt(proportions, proportions.spineLength + t * proportions.chestLength), TORSO_FRONT)
      );
      setShare(d, ring, 0, 0);
      chestRings.push(ring);
    }
    link(d.indices, chestRings);
    const neckRings = [chestRings[chestRings.length - 1]];
    for (let k = 1; k <= AXIAL_STEPS; k += 1) {
      const t = k / AXIAL_STEPS;
      const ring = addRing(d, ringPoints(neck, t, sectionAt(proportions.neckProfile, t), TORSO_FRONT));
      const headShare = t >= 0.5 ? 2 * t - 1 : 0;
      setShare(d, ring, 0, headShare);
      neckRings.push(ring);
    }
    markSeam(d, neckRings[neckRings.length - 1]);
    link(d.indices, neckRings);
    return finish(part.id, "character", d, part.fill);
  }
  function armOutlineMesh(part, skeleton, proportions, rig) {
    const side = part.id === "armL" ? "L" : "R";
    const shoulder = originOf(rig, findBone(skeleton, `upperArm${side}`));
    const elbow = originOf(rig, findBone(skeleton, `lowerArm${side}`));
    const hand = findBone(skeleton, `hand${side}`);
    const wrist = originOf(rig, hand);
    const axis = axisOf(rig, hand);
    const handLength = bindLength(skeleton, hand);
    const handTip = {
      x: wrist.x + axis.x * handLength,
      y: wrist.y + axis.y * handLength
    };
    const handDir = { x: handTip.x - wrist.x, y: handTip.y - wrist.y };
    const handBase = hand * RIGID_STRIDE;
    const wristWidth = wristHalfWidth(
      handDir,
      { x: rig[handBase + 6], y: rig[handBase + 7] },
      { x: rig[handBase + 3], y: rig[handBase + 4] },
      proportions.palmWrist.halfWidth,
      proportions.palmWrist.halfThickness
    );
    const root = shoulderRoot({ x: shoulder.x, y: shoulder.y }, proportions.height);
    const outline = buildArmOutline({
      shoulder: root,
      elbow: { x: elbow.x, y: elbow.y },
      wrist: { x: wrist.x, y: wrist.y },
      handDir,
      wristWidth,
      upperWidth: widthProfile(proportions.upperArmProfile),
      lowerWidth: widthProfile(proportions.lowerArmProfile),
      sections: ARM_SECTIONS
    });
    const vertexCount = armOutlineVertexCount(ARM_SECTIONS);
    const positions = new Float32Array(vertexCount * 3);
    for (let v = 0; v < vertexCount; v += 1) {
      positions[v * 3] = outline.positions[v * 2];
      positions[v * 3 + 1] = outline.positions[v * 2 + 1];
      positions[v * 3 + 2] = 0;
    }
    const seam2 = new Uint8Array(vertexCount);
    seam2[0] = 1;
    seam2[1] = 1;
    seam2[vertexCount - 2] = 1;
    seam2[vertexCount - 1] = 1;
    return {
      partId: part.id,
      space: "character",
      positions,
      indices: outline.indices,
      ...createMeshTextures(outline.indices, part.fill),
      seam: seam2,
      endShare: new Float32Array(vertexCount * 2)
    };
  }
  function legMesh(part, skeleton, proportions, rig) {
    const d = draft(true);
    const side = part.id === "legL" ? 1 : -1;
    const spine = frameOf(rig, skeleton, findBone(skeleton, "spine"));
    const thigh = frameOf(rig, skeleton, findBone(skeleton, `thigh${side > 0 ? "L" : "R"}`));
    const shin = frameOf(rig, skeleton, findBone(skeleton, `shin${side > 0 ? "L" : "R"}`));
    const foot = frameOf(rig, skeleton, findBone(skeleton, `foot${side > 0 ? "L" : "R"}`));
    const rim = hipRimPoints(spine, proportions, side);
    const end = ringPoints(thigh, 3 / 8, sectionAt(proportions.thighProfile, 3 / 8), LIMB_FRONT);
    const collar = addCollar(d, rim, end, thigh, proportions.thighProfile, 0, true, null, LIMB_FRONT, 3 / 8);
    markSeam(d, collar[0]);
    link(d.indices, collar);
    const thighTail = addProfile(
      d,
      thigh,
      proportions.thighProfile,
      [3 / 8, 5 / 8, 7 / 8, 1],
      collar[collar.length - 1],
      LIMB_FRONT
    );
    link(d.indices, thighTail);
    const shinRings = addProfile(
      d,
      shin,
      proportions.shinProfile,
      [0, 1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8],
      thighTail[thighTail.length - 1],
      LIMB_FRONT
    );
    link(d.indices, shinRings);
    const ankleRim = footHoleRimPoints(proportions, side).map((point) => transformPartPoint(foot, point));
    const ankleRings = addCollar(
      d,
      ringPoints(shin, 5 / 8, sectionAt(proportions.shinProfile, 5 / 8), LIMB_FRONT),
      ankleRim,
      shin,
      null,
      1,
      false,
      shinRings[shinRings.length - 1],
      LIMB_FRONT
    );
    markSeam(d, ankleRings[ankleRings.length - 1]);
    link(d.indices, ankleRings);
    return finish(part.id, "character", d, part.fill);
  }
  function rigidMesh(partId, bone, skeleton, proportions, fill2) {
    const length6 = bindLength(skeleton, bone);
    const name = boneName(skeleton, bone);
    if (name === "head") return headMesh(partId, length6, proportions, fill2);
    if (name === "handL" || name === "handR") {
      return handMesh(partId, name === "handL" ? 1 : -1, length6, proportions, fill2);
    }
    if (name === "footL" || name === "footR") return footMesh(partId, proportions, fill2);
    throw new Error("part");
  }
  function headMesh(partId, length6, proportions, fill2) {
    const d = draft(false);
    const frame = {
      ox: 0,
      oy: 0,
      oz: 0,
      ax: 1,
      ay: 0,
      az: 0,
      nx: 0,
      ny: 1,
      nz: 0,
      ux: 0,
      uy: 0,
      uz: 1,
      length: length6
    };
    const rings = addProfile(d, frame, proportions.headProfile, uniformStations(), null, HEAD_FRONT);
    markSeam(d, rings[0]);
    link(d.indices, rings);
    addCap(d, rings[rings.length - 1], true);
    return finish(partId, "part", d, fill2);
  }
  function handMesh(partId, side, length6, proportions, fill2) {
    const d = draft(false);
    const palmEnd = proportions.palmFraction * length6;
    const palm = palmTube(d, palmEnd, proportions.palmWrist, proportions.palmKnuckle);
    markSeam(d, palm[0]);
    const thumbX = proportions.thumbAlong * length6;
    const thumbY = -proportions.thumbDrop;
    const thumbZ = side * proportions.thumbOffsetZ;
    const hole = thumbHole(palmEnd, thumbX, thumbY, thumbZ);
    linkExcept(d.indices, palm, (interval, j) => interval === hole.interval && hole.omitted.has(j));
    const fingers = [];
    for (let f = 0; f < 4; f += 1) {
      const spread = side * proportions.fingerOffsets[f];
      const tip = proportions.fingerLengths[f] * length6;
      const root = tubeAlongX(
        d,
        palmEnd,
        0,
        spread,
        tip,
        0,
        spread,
        proportions.fingerRadius,
        proportions.fingerTipRadius
      );
      link(d.indices, root);
      addCap(d, root[root.length - 1], true);
      const ring = root[0];
      for (let j = 0; j < TUBE_SIDES; j += 1) {
        clampPalmThickness(d.positions, ring + j, proportions.palmKnuckle.halfThickness);
      }
      fingers.push(ring);
    }
    const thumb = tubeAlongX(
      d,
      thumbX,
      thumbY,
      thumbZ,
      proportions.thumbTipAlong * length6,
      thumbY,
      side * proportions.thumbTipZ,
      proportions.thumbRadius
    );
    link(d.indices, thumb);
    addCap(d, thumb[thumb.length - 1], true);
    weldPalmEnd(d.indices, d.positions, palm[palm.length - 1], fingers);
    weldThumb(d.indices, d.positions, palm, hole, thumb[0]);
    return finish(partId, "part", d, fill2);
  }
  function palmPoint(section2, theta) {
    const power = 2 / 3;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    return {
      y: section2.halfThickness * Math.sign(cos) * Math.pow(Math.abs(cos), power),
      z: section2.halfWidth * Math.sign(sin) * Math.pow(Math.abs(sin), power)
    };
  }
  function palmTube(d, length6, wrist, knuckle) {
    const rings = [];
    for (let k = 0; k <= AXIAL_STEPS; k += 1) {
      const u = k / AXIAL_STEPS;
      const section2 = {
        halfWidth: wrist.halfWidth + (knuckle.halfWidth - wrist.halfWidth) * u,
        halfThickness: wrist.halfThickness + (knuckle.halfThickness - wrist.halfThickness) * u
      };
      const points = [];
      for (let j = 0; j < TUBE_SIDES; j += 1) {
        const theta = j * 2 * Math.PI / TUBE_SIDES;
        const { y, z } = palmPoint(section2, theta);
        points.push({ x: length6 * u, y, z });
      }
      rings.push(addRing(d, points));
    }
    return rings;
  }
  function footMesh(partId, proportions, fill2) {
    const d = draft(false);
    const side = partId === "footL" ? 1 : -1;
    const x0 = -proportions.heelBack;
    const x1 = proportions.footLength;
    const rings = [];
    for (let k = 0; k <= AXIAL_STEPS; k += 1) {
      const t = k / AXIAL_STEPS;
      rings.push(addRing(d, footSection(proportions, t, x0, x1, side)));
    }
    linkExcept(
      d.indices,
      rings,
      (interval, j) => interval >= FOOT_HOLE_LO && interval < FOOT_HOLE_HI && j >= 1 && j <= 6
    );
    for (const vertex of footHoleRimIndices(rings)) d.seam[vertex] = 1;
    addCap(d, rings[0], false);
    addCap(d, rings[rings.length - 1], true);
    return finish(partId, "part", d, fill2);
  }
  function chestStations(tS) {
    const ts = [];
    for (let i = 0; i <= 16; i += 1) ts.push(i / 16);
    void tS;
    return ts;
  }
  function hipRimPoints(spine, proportions, side) {
    const base = torsoSectionAt(proportions, 0);
    const half = TUBE_SIDES / 2;
    const crotchCount = TUBE_SIDES - (half + 1);
    const drop = proportions.thighLength / 10;
    const crotch = (m) => {
      const beta = m * Math.PI / (crotchCount + 1);
      const depth = beta <= Math.PI / 2 ? base.backDepth : base.frontDepth;
      return { x: -depth * Math.cos(beta), y: spine.oy - drop * Math.sin(beta), z: 0 };
    };
    const rim = [];
    if (side > 0) {
      for (let k = 0; k <= half; k += 1) {
        rim.push(sample(spine, 0, base, (half - k + TUBE_SIDES) % TUBE_SIDES, TORSO_FRONT));
      }
      for (let m = 1; m <= crotchCount; m += 1) rim.push(crotch(m));
    } else {
      rim.push(sample(spine, 0, base, half, TORSO_FRONT));
      for (let m = crotchCount; m >= 1; m -= 1) rim.push(crotch(m));
      rim.push(sample(spine, 0, base, 0, TORSO_FRONT));
      for (let j = TUBE_SIDES - 1; j >= half + 1; j -= 1) {
        rim.push(sample(spine, 0, base, j, TORSO_FRONT));
      }
    }
    return rim;
  }
  var FOOT_HOLE_LO = Math.round(1 / 6 * AXIAL_STEPS);
  var FOOT_HOLE_MID = FOOT_HOLE_LO + 1;
  var FOOT_HOLE_HI = FOOT_HOLE_LO + 2;
  var FOOT_HOLE_CM = TUBE_SIDES / 4;
  var FOOT_HOLE_C1 = (TUBE_SIDES - 2) / 2;
  function footHoleRimPoints(proportions, side = 1) {
    const x0 = -proportions.heelBack;
    const x1 = proportions.footLength;
    const at = (ring, j) => footSection(proportions, ring / AXIAL_STEPS, x0, x1, side)[j];
    const rim = [];
    for (let j = FOOT_HOLE_CM; j <= FOOT_HOLE_C1; j += 1) rim.push(at(FOOT_HOLE_HI, j));
    rim.push(at(FOOT_HOLE_MID, FOOT_HOLE_C1));
    for (let j = FOOT_HOLE_C1; j >= 1; j -= 1) rim.push(at(FOOT_HOLE_LO, j));
    rim.push(at(FOOT_HOLE_MID, 1));
    for (let j = 1; j < FOOT_HOLE_CM; j += 1) rim.push(at(FOOT_HOLE_HI, j));
    return rim;
  }
  function footHoleRimIndices(rings) {
    const at = (ring, j) => rings[ring] + j;
    const rim = [];
    for (let j = FOOT_HOLE_CM; j <= FOOT_HOLE_C1; j += 1) rim.push(at(FOOT_HOLE_HI, j));
    rim.push(at(FOOT_HOLE_MID, FOOT_HOLE_C1));
    for (let j = FOOT_HOLE_C1; j >= 1; j -= 1) rim.push(at(FOOT_HOLE_LO, j));
    rim.push(at(FOOT_HOLE_MID, 1));
    for (let j = 1; j < FOOT_HOLE_CM; j += 1) rim.push(at(FOOT_HOLE_HI, j));
    return rim;
  }
  function addCollar(d, from, to, frame, profile, chainEnd, writeFirst, reuseFirst = null, frontSign = LIMB_FRONT, tEnd = 1) {
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
        const tk = clamp01(i / AXIAL_STEPS * tEnd);
        const wall = profile === null ? b : sample(frame, tk, sectionAt(profile, tk), k, frontSign);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
        const c = {
          x: 0.35 * mid.x + 0.65 * wall.x,
          y: 0.35 * mid.y + 0.65 * wall.y,
          z: 0.35 * mid.z + 0.65 * wall.z
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
  function addProfile(d, frame, profile, ts, reuseFirst, frontSign) {
    const rings = [];
    for (let i = 0; i < ts.length; i += 1) {
      if (i === 0 && reuseFirst !== null) {
        rings.push(reuseFirst);
        continue;
      }
      const ring = addRing(d, ringPoints(frame, ts[i], sectionAt(profile, ts[i]), frontSign));
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
  function finish(partId, space, d, fill2) {
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
      ...createMeshTextures(indices, fill2),
      seam: seam2,
      endShare
    };
  }
  function footSection(proportions, t, x0, x1, side = 1) {
    const x = x0 + (x1 - x0) * t;
    const heelRound = t < 0.12 ? 0.22 + 0.78 * Math.sqrt(Math.max(0, 1 - ((0.12 - t) / 0.12) ** 2)) : 1;
    const toeBox = t > 0.8 ? 1 + 0.1 * Math.sin((t - 0.8) / 0.2 * Math.PI) : 1;
    const arch = 6e-3 * proportions.height * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.2) / 0.5)));
    const halfWidth = radiusAt(proportions.footHalfWidth, t) * heelRound * toeBox;
    const instep = radiusAt(proportions.footInstep, t) * heelRound;
    const points = [];
    for (let j = 0; j < TUBE_SIDES; j += 1) {
      const theta = j * 2 * Math.PI / TUBE_SIDES;
      const lifted = Math.max(0, (Math.sin(theta) + 1) / 2);
      const medial = Math.max(0, -side * Math.cos(theta));
      points.push({
        x,
        y: -proportions.ankleHeight + instep * lifted + arch * medial,
        z: -halfWidth * Math.cos(theta)
      });
    }
    return points;
  }
  function transformPartPoint(frame, point) {
    return {
      x: frame.ox + frame.ax * point.x + frame.nx * point.y + frame.ux * point.z,
      y: frame.oy + frame.ay * point.x + frame.ny * point.y + frame.uy * point.z,
      z: frame.oz + frame.az * point.x + frame.nz * point.y + frame.uz * point.z
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
  function clampPalmThickness(positions, vertex, halfThickness) {
    const y = positions[vertex * 3 + 1];
    const limit = halfThickness * 0.98;
    if (Math.abs(y) <= limit) return;
    positions[vertex * 3 + 1] = Math.sign(y) * limit;
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
        const tri2 = options[k];
        if (tri2 === null || tri2 === void 0 || !free(tri2[0], tri2[1], tri2[2])) continue;
        const p = tri2[0];
        const q = tri2[1];
        const r = tri2[2];
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
  function tubeAlongX(d, x0, y0, z0, x1, y1, z1, radius, tipRadius = radius) {
    const rings = [];
    for (let k = 0; k <= AXIAL_STEPS; k += 1) {
      const u = k / AXIAL_STEPS;
      const taper = radius + (tipRadius - radius) * u;
      const knuckle = 35e-5 * Math.exp(-(((u - 0.55) / 0.12) ** 2));
      const at = taper + knuckle;
      const points = [];
      for (let j = 0; j < TUBE_SIDES; j += 1) {
        const theta = j * 2 * Math.PI / TUBE_SIDES;
        points.push({
          x: x0 + (x1 - x0) * u,
          y: y0 + (y1 - y0) * u + at * Math.cos(theta),
          z: z0 + (z1 - z0) * u + at * Math.sin(theta)
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
  var TORSO_FRONT = -1;
  var LIMB_FRONT = 1;
  var HEAD_FRONT = -1;
  function torsoSectionAt(proportions, heightAboveHip) {
    const total = proportions.spineLength + proportions.chestLength;
    return sectionAt(proportions.torsoProfile, heightAboveHip / total);
  }
  function sectionAt(profile, t) {
    for (let i = 0; i < profile.length - 1; i += 1) {
      const left = profile[i];
      const right = profile[i + 1];
      if (t < left.t || t > right.t) continue;
      const span2 = right.t - left.t;
      const u = span2 === 0 ? 0 : (t - left.t) / span2;
      return {
        halfWidth: left.halfWidth * (1 - u) + right.halfWidth * u,
        frontDepth: left.frontDepth * (1 - u) + right.frontDepth * u,
        backDepth: left.backDepth * (1 - u) + right.backDepth * u,
        exponent: left.exponent * (1 - u) + right.exponent * u
      };
    }
    throw new Error("section");
  }
  function sectionPoint(section2, theta, frontSign) {
    const power = 2 / section2.exponent;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const towardFront = cos >= 0 === frontSign > 0;
    const depth = (towardFront ? section2.frontDepth : section2.backDepth) * Math.pow(Math.abs(cos), power);
    return {
      along: cos >= 0 ? depth : -depth,
      lateral: section2.halfWidth * Math.sign(sin) * Math.pow(Math.abs(sin), power)
    };
  }
  function ringPoints(frame, t, section2, frontSign) {
    const points = [];
    for (let j = 0; j < TUBE_SIDES; j += 1) points.push(sample(frame, t, section2, j, frontSign));
    return points;
  }
  function sample(frame, t, section2, j, frontSign) {
    const theta = j * 2 * Math.PI / TUBE_SIDES;
    const { along, lateral } = sectionPoint(section2, theta, frontSign);
    const at = frame.length * t;
    return {
      x: frame.ox + frame.ax * at + frame.nx * along + frame.ux * lateral,
      y: frame.oy + frame.ay * at + frame.ny * along + frame.uy * lateral,
      z: frame.oz + frame.az * at + frame.nz * along + frame.uz * lateral
    };
  }
  function clamp01(value) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }
  function frameOf(rig, skeleton, bone) {
    const base = bone * RIGID_STRIDE;
    const ax = rig[base];
    const ay = rig[base + 1];
    const az = rig[base + 2];
    const length6 = bindLength(skeleton, bone);
    let ux = -az * ax;
    let uy = -az * ay;
    let uz = 1 - az * az;
    const norm = Math.hypot(ux, uy, uz) || 1;
    ux /= norm;
    uy /= norm;
    uz /= norm;
    return {
      ox: rig[base + 9],
      oy: rig[base + 10],
      oz: rig[base + 11],
      ax,
      ay,
      az,
      nx: uy * az - uz * ay,
      ny: uz * ax - ux * az,
      nz: ux * ay - uy * ax,
      ux,
      uy,
      uz,
      length: length6
    };
  }
  function radiusAt(profile, t) {
    for (let i = 0; i < profile.length - 1; i += 1) {
      const left = profile[i];
      const right = profile[i + 1];
      if (t < left.t || t > right.t) continue;
      const span2 = right.t - left.t;
      const u = span2 === 0 ? 0 : (t - left.t) / span2;
      return left.radius * (1 - u) + right.radius * u;
    }
    throw new Error("radius");
  }
  function originOf(rig, bone) {
    const base = bone * RIGID_STRIDE;
    return { x: rig[base + 9], y: rig[base + 10], z: rig[base + 11] };
  }
  function axisOf(rig, bone) {
    const base = bone * RIGID_STRIDE;
    return { x: rig[base], y: rig[base + 1], z: rig[base + 2] };
  }
  function writeBindRig(humanoid2) {
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
      parent.set(rig.subarray(parentIndex * RIGID_STRIDE, (parentIndex + 1) * RIGID_STRIDE));
      multiplyRigid(combined, parent, local);
      rig.set(combined, dst);
    }
    return rig;
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
  function claimFill(builder, id, fill2) {
    if (builder.finished) throw new Error("part set already finished");
    if (builder.parts.length >= MAX_PARTS) throw new Error("too many parts");
    if (typeof id !== "string" || id.length === 0) throw new Error("id");
    for (let i = 0; i < builder.parts.length; i += 1) {
      if (builder.parts[i].id === id) throw new Error("duplicate part id");
    }
    if (fill2 === void 0 || fill2 === null || typeof fill2 !== "object" || !inUnit(fill2.r) || !inUnit(fill2.g) || !inUnit(fill2.b)) {
      throw new Error("fill");
    }
    return { r: fill2.r, g: fill2.g, b: fill2.b };
  }
  function inUnit(value) {
    return Number.isFinite(value) && value >= 0 && value <= 1;
  }

  // packages/render-engine/src/part/rigid.ts
  function addRigid(builder, spec) {
    const fill2 = claimFill(builder, spec.id, spec.fill);
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
      fill: fill2
    };
    const index = builder.parts.length;
    builder.parts.push(part);
    return index;
  }

  // packages/render-engine/src/part/skin.ts
  function addSkinned(builder, spec) {
    const fill2 = claimFill(builder, spec.id, spec.fill);
    const source = spec.bones;
    if (source === void 0 || source.length < 2) throw new Error("bones");
    const boneCount = builder.skeleton.boneCount;
    const bones = [];
    for (let i = 0; i < source.length; i += 1) {
      const bone = source[i];
      if (!Number.isInteger(bone) || bone < 0 || bone >= boneCount) {
        throw new Error("bones");
      }
      if (i > 0) {
        const parent = parentOf(builder.skeleton, bone);
        const ok = spec.allowFork ? parent !== PARENT_NONE && source.slice(0, i).includes(parent) : parent === source[i - 1];
        if (!ok) throw new Error("bones");
      }
      bones.push(bone);
    }
    const part = {
      kind: "skinned",
      id: spec.id,
      bones,
      fill: fill2
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
    { id: "armL", kind: "skinned", bones: ["chest", "clavicleL", "upperArmL", "lowerArmL", "handL"] },
    { id: "handL", kind: "rigid", bones: ["handL"] },
    { id: "armR", kind: "skinned", bones: ["chest", "clavicleR", "upperArmR", "lowerArmR", "handR"] },
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
        const parent = parentOf(skeleton, bones[b]);
        const ok = entry.id === "torso" ? parent !== PARENT_NONE && bones.slice(0, b).includes(parent) : parent === bones[b - 1];
        if (!ok) throw new Error("bones");
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
      const fill2 = HUMANOID_FILL[entry.id];
      const bones = resolved[i];
      if (entry.kind === "rigid") {
        addRigid(builder, {
          id: entry.id,
          bone: bones[0],
          translationX: 0,
          translationY: 0,
          rotation: 0,
          fill: fill2
        });
      } else {
        addSkinned(builder, {
          id: entry.id,
          bones,
          allowFork: entry.id === "torso",
          fill: fill2
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
    pushRadial(out, positions, correction.twistGain, context, twistAngle, "uniform");
    pushRadial(out, positions, correction.bendGain, context, bendAngle, "bend");
    return out;
  }
  function twistAngle(pose2, bone) {
    return Math.abs(poseTwist(pose2, bone));
  }
  function bendAngle(pose2, bone) {
    return Math.hypot(poseSwing(pose2, bone), poseRotation(pose2, bone));
  }
  function pushRadial(out, positions, gain, context, angleOf, mode) {
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
      let signed = 1;
      if (mode === "bend") {
        const parentAxis = parentBindAxis(bindRig, skeleton, bestBone);
        if (parentAxis !== null) {
          const bx = axis.ay * parentAxis.az - axis.az * parentAxis.ay;
          const by = axis.az * parentAxis.ax - axis.ax * parentAxis.az;
          const bz = axis.ax * parentAxis.ay - axis.ay * parentAxis.ax;
          const sx = by * axis.az - bz * axis.ay;
          const sy = bz * axis.ax - bx * axis.az;
          const sz = bx * axis.ay - by * axis.ax;
          const side = px * sx + py * sy + pz * sz;
          signed = side >= 0 ? 1 : -0.6;
        }
      }
      const push = signed * r * gain * (1 - Math.cos(bestPhi)) * blend2;
      const inv = 1 / r;
      out[v * 3] = out[v * 3] + px * inv * push;
      out[v * 3 + 1] = out[v * 3 + 1] + py * inv * push;
      out[v * 3 + 2] = out[v * 3 + 2] + pz * inv * push;
    }
  }
  function isCorrectionBone(name) {
    return name.startsWith("upperArm") || name.startsWith("lowerArm") || name.startsWith("thigh") || name.startsWith("shin");
  }
  function parentBindAxis(bindRig, skeleton, bone) {
    const parent = skeleton.parent[bone];
    if (parent < 0) return null;
    const base = parent * RIGID_STRIDE;
    return { ax: bindRig[base], ay: bindRig[base + 1], az: bindRig[base + 2] };
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
  function findSlot(set6, partId) {
    for (let i = 0; i < set6.slots.length; i += 1) {
      if (set6.slots[i].partId === partId) return i;
    }
    return SLOT_NONE;
  }
  function drawOrder(out, set6, facing) {
    if (!isFacing(facing)) throw new Error("facing");
    const count = set6.slots.length;
    if (out.length !== count) throw new Error("order");
    const order = new Array(count);
    for (let i = 0; i < count; i += 1) order[i] = i;
    const near2 = nearSide(facing);
    const far = farSide(facing);
    order.sort((a, b) => compareSlot(set6, a, b, near2, far));
    for (let i = 0; i < count; i += 1) out[i] = set6.slots[order[i]].partId;
    return out;
  }
  function compareSlot(set6, a, b, near2, far) {
    const sa = set6.slots[a];
    const sb = set6.slots[b];
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
    const rig = writeBindRig2(humanoid2);
    const weights = [];
    for (let i = 0; i < parts.parts.length; i += 1) {
      const part = parts.parts[i];
      const mesh = meshes.meshes[i];
      if (mesh.partId !== part.id) throw new Error("mesh");
      if (part.kind !== "skinned" || isArmPart(part.id)) continue;
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
      const length6 = bindLength(skeleton, bone);
      if (length6 <= 1e-5 || borrowed(part.id, boneName(skeleton, bone))) continue;
      const base = bone * RIGID_STRIDE;
      const x0 = rig[base + 9];
      const y0 = rig[base + 10];
      const z0 = rig[base + 11];
      segments.push({
        slot: i,
        x0,
        y0,
        z0,
        x1: x0 + rig[base] * length6,
        y1: y0 + rig[base + 1] * length6,
        z1: z0 + rig[base + 2] * length6,
        length: length6
      });
    }
    const influences = part.bones.length;
    const vertexCount = positions.length / 3;
    const weights = new Float32Array(vertexCount * influences);
    const twistU = new Float32Array(vertexCount);
    const headSlot = 0;
    const tailSlot = influences - 1;
    const names = part.bones.map((bone) => boneName(skeleton, bone));
    const clavicleSlot = part.id.startsWith("arm") ? 1 : names.indexOf("clavicleL");
    const clavicles = names.indexOf("clavicleR");
    const originOf3 = (slot) => {
      const base = part.bones[slot] * RIGID_STRIDE;
      return { x: rig[base + 9], y: rig[base + 10], z: rig[base + 11] };
    };
    const clavicle0 = clavicleSlot >= 0 ? originOf3(clavicleSlot) : { x: 0, y: 0, z: 0 };
    const pelvisSlot = names.indexOf("pelvis");
    const pelvis0 = pelvisSlot >= 0 ? originOf3(pelvisSlot) : { x: 0, y: 0, z: 0 };
    for (let v = 0; v < vertexCount; v += 1) {
      const x = positions[v * 3];
      const y = positions[v * 3 + 1];
      const z = positions[v * 3 + 2];
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      let bestT = 0;
      for (let s = 0; s < segments.length; s += 1) {
        const proj = project(x, y, z, segments[s]);
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
        if (endSlot === headSlot && clavicleSlot >= 0 && part.id.startsWith("arm")) {
          const clavicleShare = 0.5 * (1 - e);
          column[0] += e * (1 - clavicleShare);
          column[clavicleSlot] += e * clavicleShare;
        } else {
          column[endSlot] += e;
        }
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
    if (best > 0) {
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
    if (best + 1 < segments.length) {
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
  function project(x, y, z, seg) {
    const dx = seg.x1 - seg.x0;
    const dy = seg.y1 - seg.y0;
    const dz = seg.z1 - seg.z0;
    const len22 = dx * dx + dy * dy + dz * dz;
    let t = ((x - seg.x0) * dx + (y - seg.y0) * dy + (z - seg.z0) * dz) / len22;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    const cx = seg.x0 + dx * t;
    const cy = seg.y0 + dy * t;
    const cz = seg.z0 + dz * t;
    return { t, dist: Math.hypot(x - cx, y - cy, z - cz) };
  }
  function writeBindRig2(humanoid2) {
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
      parent.set(rig.subarray(parentIndex * RIGID_STRIDE, (parentIndex + 1) * RIGID_STRIDE));
      multiplyRigid(combined, parent, local);
      rig.set(combined, dst);
    }
    return rig;
  }

  // packages/render-engine/src/compile/compile.ts
  function compileHumanoid(humanoid2) {
    const parts = createHumanoidParts(humanoid2.skeleton);
    const slots2 = createHumanoidSlots();
    const meshes = createHumanoidMeshes(humanoid2, parts);
    const weights = createHumanoidWeights(humanoid2, parts, meshes);
    return compileRig({
      humanoid: humanoid2,
      parts,
      slots: slots2,
      meshes,
      weights,
      correction: createCorrection()
    });
  }
  function compileRig(input) {
    const { humanoid: humanoid2, parts, slots: slots2, meshes, weights, correction } = input;
    if (parts.skeleton !== humanoid2.skeleton) throw new Error("skeleton");
    assertSlots(parts, slots2);
    assertMeshes(parts, meshes);
    assertWeights(parts, meshes, weights);
    assertChains(humanoid2);
    assertBindSwing(humanoid2);
    const bindRig = writeBindRig3(humanoid2);
    const inverseBind = invertAll(bindRig, humanoid2.skeleton.boneCount);
    const foot = createFootShape(humanoid2.proportions.footLength, humanoid2.proportions.ankleHeight);
    return {
      skeleton: humanoid2.skeleton,
      proportions: humanoid2.proportions,
      foot,
      parts,
      slots: slots2,
      meshes,
      weights,
      correction,
      bindRig,
      inverseBind,
      joints: humanoid2.joints
    };
  }
  function assertSlots(parts, slots2) {
    if (slots2.slots.length !== parts.parts.length) throw new Error("slot");
    for (let i = 0; i < parts.parts.length; i += 1) {
      if (findSlot(slots2, parts.parts[i].id) < 0) throw new Error("slot");
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
      if (part.kind === "rigid" || isArmPart(part.id)) {
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
  function assertBindSwing(humanoid2) {
    const skeleton = humanoid2.skeleton;
    for (let bone = 0; bone < skeleton.boneCount; bone += 1) {
      const swing = skeleton.bindSwing[bone];
      if (!Number.isFinite(swing) || Math.abs(swing) > Math.PI / 2 + 1e-6) {
        throw new Error("bindSwing");
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
    const length6 = bindLength(skeleton, parent);
    const translation = bindTranslation(createVec2(), skeleton, child);
    if (Math.abs(translation[0] - length6) > LENGTH_EPSILON || Math.abs(translation[1]) > LENGTH_EPSILON) {
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
    const inverse3 = new Float32Array(bindRig.length);
    const source = new Float32Array(RIGID_STRIDE);
    const inv = new Float32Array(RIGID_STRIDE);
    for (let bone = 0; bone < boneCount; bone += 1) {
      const dst = bone * RIGID_STRIDE;
      source.set(bindRig.subarray(dst, dst + RIGID_STRIDE));
      if (!invertRigid(inv, source)) throw new Error("bind");
      inverse3.set(inv, dst);
    }
    return inverse3;
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
  function sampleTexture(texture2, u, v) {
    if (!Number.isFinite(u) || !Number.isFinite(v)) throw new Error("uv");
    const uu = u < 0 ? 0 : u > 1 ? 1 : u;
    const vv = v < 0 ? 0 : v > 1 ? 1 : v;
    const sx = Math.min(texture2.width - 1, Math.floor(uu * texture2.width));
    const sy = Math.min(texture2.height - 1, Math.floor(vv * texture2.height));
    const index = (sy * texture2.width + sx) * 3;
    return {
      r: texture2.rgb[index] / 255,
      g: texture2.rgb[index + 1] / 255,
      b: texture2.rgb[index + 2] / 255
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
    if (part.kind === "skinned" && isArmPart(part.id)) {
      writeArmOutline(out, compiled2, fk2, part.id);
      return;
    }
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
    const inverse3 = compiled2.inverseBind;
    const vertexCount = positions.length / 3;
    const local = new Float32Array(RIGID_STRIDE);
    const scaled = new Float32Array(RIGID_STRIDE);
    const parent = new Float32Array(RIGID_STRIDE);
    const composed = new Float32Array(RIGID_STRIDE);
    const inverseSlice = new Float32Array(RIGID_STRIDE);
    const m4 = mat4_exports.create();
    const bone = quat2_exports.create();
    const acc = quat2_exports.create();
    const point = vec3_exports.create();
    const translation = vec3_exports.create();
    for (let v = 0; v < vertexCount; v += 1) {
      const x = positions[v * 3];
      const y = positions[v * 3 + 1];
      const z = positions[v * 3 + 2];
      const twistScale = found.twistU[v];
      let weightSum = 0;
      quat2_exports.identity(acc);
      for (let i = 0; i < part.bones.length; i += 1) {
        const weight = found.weights[v * found.influences + i];
        if (weight === 0) continue;
        const boneIndex = part.bones[i];
        const distributed = isTwistDistributed(boneName(compiled2.skeleton, boneIndex));
        applyScaledMatrix(
          scaled,
          local,
          parent,
          fk2,
          compiled2,
          pose2,
          boneIndex,
          distributed ? twistScale : 1
        );
        inverseSlice.set(
          inverse3.subarray(boneIndex * RIGID_STRIDE, boneIndex * RIGID_STRIDE + RIGID_STRIDE)
        );
        multiplyRigid(composed, distributed ? scaled : fkSlice(fk2, boneIndex), inverseSlice);
        writeMat4(m4, composed);
        quat2_exports.fromMat4(bone, m4);
        if (weightSum > 0 && acc[0] * bone[0] + acc[1] * bone[1] + acc[2] * bone[2] + acc[3] * bone[3] < 0) {
          quat2_exports.scale(bone, bone, -1);
        }
        for (let k = 0; k < 8; k += 1) acc[k] += weight * bone[k];
        weightSum += weight;
      }
      if (weightSum === 0) {
        out[v * 3] = x;
        out[v * 3 + 1] = y;
        out[v * 3 + 2] = z;
        continue;
      }
      quat2_exports.normalize(acc, acc);
      quat2_exports.getTranslation(translation, acc);
      point[0] = x;
      point[1] = y;
      point[2] = z;
      vec3_exports.transformQuat(point, point, acc);
      out[v * 3] = point[0] + translation[0];
      out[v * 3 + 1] = point[1] + translation[1];
      out[v * 3 + 2] = point[2] + translation[2];
    }
  }
  function originOf2(fk2, bone) {
    const base = bone * RIGID_STRIDE;
    if (bone < 0 || base + 11 >= fk2.length) throw new Error("fk");
    return { x: fk2[base + 9], y: fk2[base + 10], z: fk2[base + 11] };
  }
  function armOutlineBones(compiled2, fk2, partId) {
    const side = partId === "armL" ? "L" : partId === "armR" ? "R" : null;
    if (side === null) throw new Error("part");
    const shoulder = originOf2(fk2, findBone(compiled2.skeleton, `upperArm${side}`));
    const elbow = originOf2(fk2, findBone(compiled2.skeleton, `lowerArm${side}`));
    const hand = findBone(compiled2.skeleton, `hand${side}`);
    const wrist = originOf2(fk2, hand);
    const axis = hand * RIGID_STRIDE;
    const length6 = bindLength(compiled2.skeleton, hand);
    const handTip = {
      x: wrist.x + fk2[axis] * length6,
      y: wrist.y + fk2[axis + 1] * length6,
      z: wrist.z + fk2[axis + 2] * length6
    };
    const handLateral = { x: fk2[axis + 6], y: fk2[axis + 7], z: fk2[axis + 8] };
    const handThicknessAxis = { x: fk2[axis + 3], y: fk2[axis + 4], z: fk2[axis + 5] };
    return {
      shoulder,
      elbow,
      wrist,
      handTip,
      handLateral,
      handThicknessAxis,
      palmHalfWidth: compiled2.proportions.palmWrist.halfWidth,
      palmHalfThickness: compiled2.proportions.palmWrist.halfThickness,
      upperWidth: widthProfile(compiled2.proportions.upperArmProfile),
      lowerWidth: widthProfile(compiled2.proportions.lowerArmProfile),
      sections: ARM_SECTIONS,
      height: compiled2.proportions.height
    };
  }
  function writeArmOutline(out, compiled2, fk2, partId) {
    const bones = armOutlineBones(compiled2, fk2, partId);
    const root = shoulderRoot({ x: bones.shoulder.x, y: bones.shoulder.y }, bones.height);
    const handDir = {
      x: bones.handTip.x - bones.wrist.x,
      y: bones.handTip.y - bones.wrist.y
    };
    const wristWidth = wristHalfWidth(
      handDir,
      { x: bones.handLateral.x, y: bones.handLateral.y },
      { x: bones.handThicknessAxis.x, y: bones.handThicknessAxis.y },
      bones.palmHalfWidth,
      bones.palmHalfThickness
    );
    const outline = buildArmOutline({
      shoulder: root,
      elbow: { x: bones.elbow.x, y: bones.elbow.y },
      wrist: { x: bones.wrist.x, y: bones.wrist.y },
      handDir,
      wristWidth,
      upperWidth: bones.upperWidth,
      lowerWidth: bones.lowerWidth,
      sections: bones.sections
    });
    if (outline.positions.length / 2 !== out.length / 3) throw new Error("mesh");
    for (let v = 0; v < out.length / 3; v += 1) {
      out[v * 3] = outline.positions[v * 2];
      out[v * 3 + 1] = outline.positions[v * 2 + 1];
      out[v * 3 + 2] = 0;
    }
  }
  function fkSlice(fk2, bone) {
    return fk2.subarray(bone * RIGID_STRIDE, bone * RIGID_STRIDE + RIGID_STRIDE);
  }
  function writeMat4(out, rigid) {
    out[0] = rigid[0];
    out[1] = rigid[1];
    out[2] = rigid[2];
    out[3] = 0;
    out[4] = rigid[3];
    out[5] = rigid[4];
    out[6] = rigid[5];
    out[7] = 0;
    out[8] = rigid[6];
    out[9] = rigid[7];
    out[10] = rigid[8];
    out[11] = 0;
    out[12] = rigid[9];
    out[13] = rigid[10];
    out[14] = rigid[11];
    out[15] = 1;
  }
  function applyScaledMatrix(scaled, local, parent, fk2, compiled2, pose2, bone, twistScale) {
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

  // packages/render-engine/src/pipeline2d/scene.ts
  function createRenderScene(slots2, skins) {
    const slotIds = /* @__PURE__ */ new Set();
    for (const slot of slots2) {
      if (slot.id.length === 0 || slotIds.has(slot.id)) throw new Error("slot");
      slotIds.add(slot.id);
      if (!Number.isFinite(slot.order)) throw new Error("order");
      checkColor(slot.tint);
      if (!["normal", "add", "multiply", "screen"].includes(slot.blend)) throw new Error("blend");
      if (slot.mask !== null && typeof slot.mask !== "string") throw new Error("mask");
    }
    const skinIds = /* @__PURE__ */ new Set();
    const attachments = /* @__PURE__ */ new Map();
    for (const skin of skins) {
      if (skin.id.length === 0 || skinIds.has(skin.id)) throw new Error("skin");
      skinIds.add(skin.id);
      const local = /* @__PURE__ */ new Set();
      for (const attachment2 of skin.attachments) {
        if (attachment2.id.length === 0 || local.has(attachment2.id)) throw new Error("attachment");
        if (attachment2.skin !== skin.id) throw new Error("attachment");
        local.add(attachment2.id);
        if (attachments.has(attachment2.id)) throw new Error("attachment");
        attachments.set(attachment2.id, attachment2);
        validateMesh2(attachment2.mesh);
        validateMaterial(attachment2);
        if (attachment2.outline !== null) validateOutline(attachment2.outline);
      }
    }
    for (const slot of slots2) {
      if (slot.attachment !== null && !attachments.has(slot.attachment)) throw new Error("attachment");
    }
    return {
      slots: slots2.slice(),
      skins: skins.slice()
    };
  }
  function findRenderAttachment(scene, attachmentId) {
    for (const skin of scene.skins) {
      for (const attachment2 of skin.attachments) {
        if (attachment2.id === attachmentId) return attachment2;
      }
    }
    return null;
  }
  function attachmentOf(scene, slot) {
    if (slot.attachment === null) return null;
    return findRenderAttachment(scene, slot.attachment);
  }
  function meshBounds(positions) {
    if (positions.length < 2 || positions.length % 2 !== 0) throw new Error("mesh");
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < positions.length; i += 2) {
      const x = positions[i];
      const y = positions[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("mesh");
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  function validateMesh2(mesh) {
    const count = mesh.positions.length / 2;
    if (mesh.positions.length === 0 || mesh.positions.length % 2 !== 0) throw new Error("mesh");
    for (const value of mesh.positions) if (!Number.isFinite(value)) throw new Error("mesh");
    if (mesh.indices.length < 3 || mesh.indices.length % 3 !== 0) throw new Error("mesh");
    for (const index of mesh.indices) {
      if (index >= count) throw new Error("mesh");
    }
    if (mesh.uvs.length !== 0 && mesh.uvs.length !== count * 2) throw new Error("mesh");
    for (const value of mesh.uvs) if (!Number.isFinite(value)) throw new Error("mesh");
    if (mesh.colors.length !== 0 && mesh.colors.length !== count * 4) throw new Error("mesh");
    if (mesh.seam.length !== 0 && mesh.seam.length !== count) throw new Error("mesh");
    if (mesh.depth.length !== count) throw new Error("depth");
    for (const value of mesh.depth) if (!Number.isFinite(value)) throw new Error("depth");
    const weighted = mesh.weights.length !== 0 || mesh.boneIndices.length !== 0;
    if (weighted) {
      if (mesh.weights.length !== count * 4 || mesh.boneIndices.length !== count * 4) {
        throw new Error("weights");
      }
      for (const value of mesh.weights) {
        if (!Number.isFinite(value) || value < 0) throw new Error("weights");
      }
    }
    if (mesh.bounds !== null) {
      for (const value of [mesh.bounds.x, mesh.bounds.y, mesh.bounds.width, mesh.bounds.height]) {
        if (!Number.isFinite(value)) throw new Error("bounds");
      }
      if (mesh.bounds.width < 0 || mesh.bounds.height < 0) throw new Error("bounds");
    }
  }
  function validateMaterial(attachment2) {
    const material = attachment2.material;
    if (material.kind === "flat") {
      checkColor(material.color);
      return;
    }
    if (material.kind !== "atlas") throw new Error("material");
    if (!Number.isInteger(material.page) || material.page < 0) throw new Error("material");
    for (const value of [
      material.region.x,
      material.region.y,
      material.region.width,
      material.region.height
    ]) {
      if (!Number.isFinite(value)) throw new Error("material");
    }
    if (material.region.width <= 0 || material.region.height <= 0) throw new Error("material");
    checkColor(material.tint);
    if (material.filter !== "linear" && material.filter !== "nearest") throw new Error("material");
  }
  function validateOutline(outline) {
    if (!Number.isFinite(outline.widthPx) || outline.widthPx <= 0) throw new Error("outline");
    checkColor(outline.color);
    if (!["round", "bevel", "miter"].includes(outline.join)) throw new Error("outline");
    if (!["butt", "round", "square"].includes(outline.cap)) throw new Error("outline");
    if (!Number.isFinite(outline.depthBias)) throw new Error("outline");
  }
  function checkColor(color) {
    for (const value of [color.r, color.g, color.b, color.a]) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("tint");
    }
  }

  // packages/render-engine/src/pipeline2d/types.ts
  var RENDER_PACKET_VERSION = 2;

  // packages/render-engine/src/pipeline2d/packet.ts
  function buildRenderPackets(scene) {
    const packets = [];
    for (let i = 0; i < scene.slots.length; i += 1) {
      const slot = scene.slots[i];
      const attachment2 = attachmentOf(scene, slot);
      if (attachment2 === null) continue;
      packets.push(buildRenderPacket(slot, attachment2));
    }
    return sortRenderPackets(packets);
  }
  function sortRenderPackets(packets) {
    const entries = packets.map((packet, index) => ({ packet, index, depth: averageDepth(packet.depth) }));
    entries.sort((a, b) => {
      if (a.packet.order !== b.packet.order) return a.packet.order - b.packet.order;
      if (a.depth !== b.depth) return b.depth - a.depth;
      return a.index - b.index;
    });
    return entries.map((entry) => entry.packet);
  }
  function averageDepth(depth) {
    if (depth.length === 0) return 0;
    let sum = 0;
    for (const value of depth) sum += value;
    return sum / depth.length;
  }
  function buildRenderPacket(slot, attachment2) {
    const mesh = attachment2.mesh;
    const count = mesh.positions.length / 2;
    const material = attachment2.material;
    const tint = material.kind === "atlas" ? multiply5(slot.tint, material.tint) : slot.tint;
    const base = material.kind === "flat" ? material.color : { r: 1, g: 1, b: 1, a: 1 };
    const colors = new Uint8Array(count * 4);
    if (mesh.colors.length === 0) {
      for (let v = 0; v < count; v += 1) {
        colors[v * 4] = byte(base.r * tint.r);
        colors[v * 4 + 1] = byte(base.g * tint.g);
        colors[v * 4 + 2] = byte(base.b * tint.b);
        colors[v * 4 + 3] = byte(base.a * tint.a);
      }
    } else {
      for (let v = 0; v < count; v += 1) {
        colors[v * 4] = byte(mesh.colors[v * 4] / 255 * tint.r);
        colors[v * 4 + 1] = byte(mesh.colors[v * 4 + 1] / 255 * tint.g);
        colors[v * 4 + 2] = byte(mesh.colors[v * 4 + 2] / 255 * tint.b);
        colors[v * 4 + 3] = byte(mesh.colors[v * 4 + 3] / 255 * tint.a);
      }
    }
    const uvs = mesh.uvs.length === 0 ? new Float32Array(count * 2) : mesh.uvs.slice();
    return {
      version: RENDER_PACKET_VERSION,
      partId: attachment2.id,
      vertices: mesh.positions.slice(),
      uvs,
      indices: mesh.indices.slice(),
      colors,
      seam: mesh.seam.length === 0 ? new Uint8Array(count) : mesh.seam.slice(),
      outline: attachment2.outline,
      atlasPage: material.kind === "atlas" ? material.page : -1,
      atlasKey: attachment2.atlasKey ?? attachment2.id,
      materialId: material.kind === "atlas" ? material.page : -1,
      blend: slot.blend,
      mask: slot.mask,
      order: slot.order,
      depth: mesh.depth.slice(),
      bounds: mesh.bounds ?? meshBounds(mesh.positions)
    };
  }
  function multiply5(a, b) {
    return { r: a.r * b.r, g: a.g * b.g, b: a.b * b.b, a: a.a * b.a };
  }
  function byte(value) {
    const rounded = Math.round(value * 255);
    if (rounded < 0) return 0;
    if (rounded > 255) return 255;
    return rounded;
  }

  // packages/render-engine/src/pipeline2d/outline.ts
  var CIRCLE_SEGMENTS = 12;
  function buildOutlineRibbon(packet, scale7, widthPx) {
    if (packet.outline === null) return null;
    const width = widthPx ?? packet.outline.widthPx;
    if (!(scale7 > 0) || !(width > 0)) return null;
    const half = width / (2 * scale7);
    const edges = boundaryEdges(packet);
    if (edges.length === 0) return null;
    const positions = [];
    const indices = [];
    const boundary2 = /* @__PURE__ */ new Set();
    for (const edge of edges) {
      const from = edge.net > 0 ? edge.lo : edge.hi;
      const to = edge.net > 0 ? edge.hi : edge.lo;
      const ax = packet.vertices[from * 2];
      const ay = packet.vertices[from * 2 + 1];
      const bx = packet.vertices[to * 2];
      const by = packet.vertices[to * 2 + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const length6 = Math.hypot(dx, dy);
      if (length6 < 1e-9) continue;
      const nx = dy / length6 * half;
      const ny = -dx / length6 * half;
      const base = positions.length / 2;
      positions.push(ax + nx, ay + ny, ax - nx, ay - ny, bx + nx, by + ny, bx - nx, by - ny);
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      boundary2.add(from);
      boundary2.add(to);
    }
    for (const vertex of boundary2) {
      if (packet.seam[vertex] === 1) continue;
      const cx = packet.vertices[vertex * 2];
      const cy = packet.vertices[vertex * 2 + 1];
      const center = positions.length / 2;
      positions.push(cx, cy);
      for (let i = 0; i < CIRCLE_SEGMENTS; i += 1) {
        const angle3 = i / CIRCLE_SEGMENTS * Math.PI * 2;
        positions.push(cx + Math.cos(angle3) * half, cy + Math.sin(angle3) * half);
      }
      for (let i = 0; i < CIRCLE_SEGMENTS; i += 1) {
        indices.push(center, center + 1 + i, center + 1 + (i + 1) % CIRCLE_SEGMENTS);
      }
    }
    if (indices.length === 0) return null;
    return { positions: new Float32Array(positions), indices: new Uint16Array(indices) };
  }
  function boundaryEdges(packet) {
    const edges = /* @__PURE__ */ new Map();
    const positions = packet.vertices;
    const indices = packet.indices;
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t];
      const b = indices[t + 1];
      const c = indices[t + 2];
      const ax = positions[a * 2];
      const ay = positions[a * 2 + 1];
      const cross4 = (positions[b * 2] - ax) * (positions[c * 2 + 1] - ay) - (positions[b * 2 + 1] - ay) * (positions[c * 2] - ax);
      const turn = cross4 < 0 ? -1 : 1;
      add6(edges, a, b, turn);
      add6(edges, b, c, turn);
      add6(edges, c, a, turn);
    }
    const result = [];
    for (const edge of edges.values()) {
      if (edge.net === 0) continue;
      if (packet.seam[edge.lo] === 1 && packet.seam[edge.hi] === 1) continue;
      result.push(edge);
    }
    return result;
  }
  function add6(edges, from, to, turn) {
    const lo = from < to ? from : to;
    const hi = from < to ? to : from;
    const key = `${lo}:${hi}`;
    const dir = from === lo ? turn : -turn;
    const found = edges.get(key);
    if (found === void 0) {
      edges.set(key, { lo, hi, net: dir });
    } else {
      found.net += dir;
    }
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
      const cross4 = (screen[b * 2] - ax) * (screen[c * 2 + 1] - ay) - (screen[b * 2 + 1] - ay) * (screen[c * 2] - ax);
      out[t] = a;
      if (cross4 < -WINDING_EPSILON) {
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
      if (part.arm !== void 0) {
        const outline = projectArm(part.arm, view);
        if (outline.positions.length / 2 !== part.positions.length / 3) throw new Error("arm");
        const indices2 = windIndices(new Uint16Array(part.indices.length), part.indices, outline.positions);
        let depth2 = 0;
        for (let v = 0; v < outline.depths.length; v += 1) depth2 += outline.depths[v];
        projected.push({
          partId: part.partId,
          positions: outline.positions,
          indices: indices2,
          depth: depth2 / outline.depths.length,
          seam: part.seam,
          depths: outline.depths
        });
        continue;
      }
      const positions = new Float32Array(part.positions.length / 3 * 2);
      const depth = projectPositions(positions, part.positions, view);
      const indices = windIndices(new Uint16Array(part.indices.length), part.indices, positions);
      projected.push({ partId: part.partId, positions, indices, depth, seam: part.seam });
    }
    return projected;
  }
  function projectArm(arm, view) {
    const sin = SIN[view];
    const cos = COS[view];
    const root = shoulderRoot(
      { x: arm.shoulder.x * cos + arm.shoulder.z * sin, y: arm.shoulder.y },
      arm.height
    );
    const wrist = { x: arm.wrist.x * cos + arm.wrist.z * sin, y: arm.wrist.y };
    const handTip = {
      x: arm.handTip.x * cos + arm.handTip.z * sin,
      y: arm.handTip.y
    };
    const handDir = { x: handTip.x - wrist.x, y: handTip.y - wrist.y };
    const wristWidth = wristHalfWidth(
      handDir,
      {
        x: arm.handLateral.x * cos + arm.handLateral.z * sin,
        y: arm.handLateral.y
      },
      {
        x: arm.handThicknessAxis.x * cos + arm.handThicknessAxis.z * sin,
        y: arm.handThicknessAxis.y
      },
      arm.palmHalfWidth,
      arm.palmHalfThickness
    );
    return buildArmOutline({
      shoulder: root,
      elbow: { x: arm.elbow.x * cos + arm.elbow.z * sin, y: arm.elbow.y },
      wrist,
      handDir,
      wristWidth,
      upperWidth: arm.upperWidth,
      lowerWidth: arm.lowerWidth,
      sections: arm.sections,
      shoulderDepth: arm.shoulder.z * cos - arm.shoulder.x * sin + ARM_SHOULDER_DEPTH_BIAS * arm.height,
      elbowDepth: arm.elbow.z * cos - arm.elbow.x * sin,
      wristDepth: arm.wrist.z * cos - arm.wrist.x * sin
    });
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

  // packages/render-engine/src/pipeline2d/hand3d.ts
  var SIDES2 = 6;
  function buildHandVolumeParts(compiled2, fk2, view, side) {
    if (!Number.isInteger(view) || view < 0 || view >= VIEW_COUNT) throw new Error("view");
    const parts = [];
    const hand = findBone(compiled2.skeleton, `hand${side}`);
    if (hand < 0) throw new Error("bone");
    const handLength = bindLength(compiled2.skeleton, hand);
    const palmLength = compiled2.proportions.palmFraction * handLength;
    const palm = buildPalm(compiled2, fk2, hand, side, palmLength);
    parts.push(projectPart(`hand${side}`, palm.positions, palm.indices, view));
    const fingers = ["thumb", "index", "middle", "ring", "pinky"];
    for (const finger of fingers) {
      const count = finger === "thumb" ? 2 : 3;
      for (let s = 1; s <= count; s += 1) {
        const bone = findBone(compiled2.skeleton, `${finger}${s}${side}`);
        if (bone < 0) continue;
        const base = origin(fk2, bone);
        const axis = normalize7(axisOf2(fk2, bone));
        const length6 = bindLength(compiled2.skeleton, bone);
        if (length6 <= 1e-6) continue;
        const radius0 = finger === "thumb" ? compiled2.proportions.thumbRadius * 0.8 : compiled2.proportions.fingerRadius;
        const radius1 = finger === "thumb" ? radius0 * 0.8 : compiled2.proportions.fingerTipRadius;
        const mesh = buildSegment(base, axis, length6, radius0, radius1);
        parts.push(projectPart(`hand${side}`, mesh.positions, mesh.indices, view));
      }
    }
    return parts.filter((part) => part.positions.length > 0);
  }
  function buildPalm(compiled2, fk2, hand, side, length6) {
    const o = origin(fk2, hand);
    const a = normalize7(axisOf2(fk2, hand));
    const u = perpendicular2(a, { x: 0, y: 0, z: 1 });
    const n = cross3(a, u);
    const wrist = compiled2.proportions.palmWrist;
    const knuckle = compiled2.proportions.palmKnuckle;
    const d = { positions: [], indices: [] };
    const rings = [];
    const widths = [wrist.halfWidth, knuckle.halfWidth];
    const thicks = [wrist.halfThickness, knuckle.halfThickness];
    for (let r = 0; r < 2; r += 1) {
      const center = add7(o, scale6(a, length6 * r / 1));
      const ring = [];
      for (const [su, sn] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
        ring.push(addTo(d, add7(center, add7(scale6(u, su * widths[r]), scale6(n, sn * thicks[r])))));
      }
      rings.push(ring);
    }
    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      quad(d, rings[0][i], rings[0][j], rings[1][j], rings[1][i]);
    }
    tri(d, rings[0][0], rings[0][2], rings[0][1]);
    tri(d, rings[0][0], rings[0][3], rings[0][2]);
    tri(d, rings[1][0], rings[1][1], rings[1][2]);
    tri(d, rings[1][0], rings[1][2], rings[1][3]);
    void side;
    return d;
  }
  function buildSegment(base, axis, length6, radius0, radius1) {
    const u = perpendicular2(axis, { x: 0, y: 0, z: 1 });
    const n = cross3(axis, u);
    const d = { positions: [], indices: [] };
    const rings = [];
    for (let r = 0; r < 2; r += 1) {
      const radius = r === 0 ? radius0 : radius1;
      const center = add7(base, scale6(axis, r === 0 ? 0 : length6));
      const ring = [];
      for (let i = 0; i < SIDES2; i += 1) {
        const angle3 = i / SIDES2 * Math.PI * 2;
        ring.push(addTo(d, add7(center, add7(scale6(u, Math.cos(angle3) * radius), scale6(n, Math.sin(angle3) * radius)))));
      }
      rings.push(ring);
    }
    for (let i = 0; i < SIDES2; i += 1) {
      const j = (i + 1) % SIDES2;
      quad(d, rings[0][i], rings[0][j], rings[1][j], rings[1][i]);
    }
    for (let i = 1; i + 1 < SIDES2; i += 1) tri(d, rings[1][0], rings[1][i], rings[1][i + 1]);
    return d;
  }
  function projectPart(partId, positions3D, indices3D, view) {
    const source = Float32Array.from(positions3D);
    const screen = new Float32Array(source.length / 3 * 2);
    const depth = projectPositions(screen, source, view);
    const indices = windIndices(new Uint16Array(indices3D), Uint16Array.from(indices3D), screen);
    return {
      partId,
      positions: screen,
      indices,
      depth,
      seam: new Uint8Array(source.length / 3)
    };
  }
  function origin(fk2, bone) {
    const i = bone * 12;
    return { x: fk2[i + 9], y: fk2[i + 10], z: fk2[i + 11] };
  }
  function axisOf2(fk2, bone) {
    const i = bone * 12;
    return { x: fk2[i], y: fk2[i + 1], z: fk2[i + 2] };
  }
  function addTo(d, p) {
    const index = d.positions.length / 3;
    d.positions.push(p.x, p.y, p.z);
    return index;
  }
  function tri(d, a, b, c) {
    d.indices.push(a, b, c);
  }
  function quad(d, a, b, c, e) {
    tri(d, a, b, c);
    tri(d, a, c, e);
  }
  function add7(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }
  function scale6(a, k) {
    return { x: a.x * k, y: a.y * k, z: a.z * k };
  }
  function cross3(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  }
  function normalize7(a) {
    const length6 = Math.hypot(a.x, a.y, a.z);
    if (length6 <= 1e-9) return { x: 1, y: 0, z: 0 };
    return { x: a.x / length6, y: a.y / length6, z: a.z / length6 };
  }
  function perpendicular2(a, fallback) {
    const dot6 = a.x * fallback.x + a.y * fallback.y + a.z * fallback.z;
    const candidate = add7(fallback, scale6(a, -dot6));
    const length6 = Math.hypot(candidate.x, candidate.y, candidate.z);
    if (length6 > 1e-5) return normalize7(candidate);
    return normalize7(cross3(a, { x: 1, y: 0, z: 0 }));
  }

  // packages/render-engine/src/pipeline2d/volumetric.ts
  function buildVolumetricPackets(parts) {
    const packets = [];
    for (const part of parts) {
      const fill2 = HUMANOID_FILL[part.partId] ?? { r: 0.7, g: 0.7, b: 0.7 };
      const color = { r: fill2.r, g: fill2.g, b: fill2.b, a: 1 };
      const count = part.positions.length / 2;
      if (count === 0) continue;
      const colors = new Uint8Array(count * 4);
      const depth = new Float32Array(count);
      for (let v = 0; v < count; v += 1) {
        colors[v * 4] = Math.round(color.r * 255);
        colors[v * 4 + 1] = Math.round(color.g * 255);
        colors[v * 4 + 2] = Math.round(color.b * 255);
        colors[v * 4 + 3] = 255;
        depth[v] = part.depths?.[v] ?? part.depth;
      }
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let v = 0; v < count; v += 1) {
        minX = Math.min(minX, part.positions[v * 2]);
        maxX = Math.max(maxX, part.positions[v * 2]);
        minY = Math.min(minY, part.positions[v * 2 + 1]);
        maxY = Math.max(maxY, part.positions[v * 2 + 1]);
      }
      packets.push({
        version: 2,
        partId: part.partId,
        vertices: part.positions,
        uvs: new Float32Array(count * 2),
        indices: part.indices,
        colors,
        seam: part.seam,
        outline: {
          widthPx: 1.5,
          color: { r: 0.08, g: 0.08, b: 0.08, a: 1 },
          join: "round",
          cap: "round",
          depthBias: 0
        },
        atlasPage: -1,
        atlasKey: part.partId,
        materialId: -1,
        blend: "normal",
        mask: null,
        order: 0,
        depth,
        bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
      });
    }
    return sortRenderPackets(packets);
  }

  // packages/render-engine/src/pipeline2d/atlas.ts
  function packAtlas(items, options = {}) {
    const padding = Math.max(0, Math.floor(options.padding ?? 2));
    const maxWidth = Math.max(1, Math.floor(options.maxWidth ?? 256));
    const sorted = items.slice().sort((a, b) => b.height - a.height || b.width - a.width);
    const regions = [];
    let x = padding;
    let y = padding;
    let rowHeight = 0;
    let usedWidth = 0;
    for (const item of sorted) {
      if (!Number.isInteger(item.width) || !Number.isInteger(item.height) || item.width <= 0 || item.height <= 0) {
        throw new Error("atlas");
      }
      if (item.width + padding * 2 > maxWidth) throw new Error("atlas");
      if (x + item.width + padding > maxWidth) {
        x = padding;
        y += rowHeight + padding;
        rowHeight = 0;
      }
      regions.push({ id: item.id, x, y, width: item.width, height: item.height });
      x += item.width + padding;
      rowHeight = Math.max(rowHeight, item.height);
      usedWidth = Math.max(usedWidth, x);
    }
    const width = nextPowerOfTwo(Math.max(1, usedWidth));
    const height = nextPowerOfTwo(Math.max(1, y + rowHeight + padding));
    return { width, height, padding, pma: options.pma ?? true, regions };
  }
  function sampleAtlas(out, image, region, u, v, filter = "linear") {
    if (!Number.isFinite(u) || !Number.isFinite(v)) throw new Error("uv");
    const localU = clamp012(u);
    const localV = clamp012(v);
    if (filter === "nearest") {
      const x2 = Math.min(region.width - 1, Math.floor(localU * region.width));
      const y2 = Math.min(region.height - 1, Math.floor(localV * region.height));
      read(out, image, region.x + x2, region.y + y2);
      return;
    }
    const x = region.x + localU * (region.width - 1) + 0.5;
    const y = region.y + localV * (region.height - 1) + 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(region.x + region.width - 1, x0 + 1);
    const y1 = Math.min(region.y + region.height - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const c00 = readColor(image, x0, y0);
    const c10 = readColor(image, x1, y0);
    const c01 = readColor(image, x0, y1);
    const c11 = readColor(image, x1, y1);
    out.r = lerp6(lerp6(c00.r, c10.r, fx), lerp6(c01.r, c11.r, fx), fy);
    out.g = lerp6(lerp6(c00.g, c10.g, fx), lerp6(c01.g, c11.g, fx), fy);
    out.b = lerp6(lerp6(c00.b, c10.b, fx), lerp6(c01.b, c11.b, fx), fy);
    out.a = lerp6(lerp6(c00.a, c10.a, fx), lerp6(c01.a, c11.a, fx), fy);
  }
  function blendColor(dst, src, mode) {
    const a = src.a;
    const outA = a + dst.a * (1 - a);
    if (outA <= 0) {
      dst.r = 0;
      dst.g = 0;
      dst.b = 0;
      dst.a = 0;
      return;
    }
    let r;
    let g;
    let b;
    if (mode === "normal") {
      r = src.r * a + dst.r * dst.a * (1 - a);
      g = src.g * a + dst.g * dst.a * (1 - a);
      b = src.b * a + dst.b * dst.a * (1 - a);
    } else {
      const add9 = mode === "add" ? (x, y) => x + y : mode === "multiply" ? (x, y) => x * y : (x, y) => x + y - x * y;
      r = add9(src.r, dst.r) * a + dst.r * dst.a * (1 - a);
      g = add9(src.g, dst.g) * a + dst.g * dst.a * (1 - a);
      b = add9(src.b, dst.b) * a + dst.b * dst.a * (1 - a);
    }
    dst.r = r / outA;
    dst.g = g / outA;
    dst.b = b / outA;
    dst.a = outA;
  }
  function readColor(image, x, y) {
    const i = (y * image.width + x) * 4;
    const a = image.rgba[i + 3] / 255;
    if (image.pma && a > 0) {
      return {
        r: image.rgba[i] / 255 / a,
        g: image.rgba[i + 1] / 255 / a,
        b: image.rgba[i + 2] / 255 / a,
        a
      };
    }
    return { r: image.rgba[i] / 255, g: image.rgba[i + 1] / 255, b: image.rgba[i + 2] / 255, a };
  }
  function read(out, image, x, y) {
    const color = readColor(image, x, y);
    out.r = color.r;
    out.g = color.g;
    out.b = color.b;
    out.a = color.a;
  }
  function nextPowerOfTwo(value) {
    let result = 1;
    while (result < value) result *= 2;
    return result;
  }
  function clamp012(value) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }
  function lerp6(a, b, t) {
    return a + (b - a) * t;
  }

  // packages/render-engine/src/pipeline2d/raster.ts
  function paintPackets(target, packets, options) {
    if (target.pixels.length !== target.width * target.height * 4) throw new Error("target");
    const { scale: scale7, originX, originY } = options.transform;
    if (!(scale7 > 0)) throw new Error("transform");
    const supersample = options.supersample ?? 1;
    const fillMode = options.fillMode ?? "smooth";
    const edges = options.edges ?? "silhouette";
    for (const packet of packets) {
      const mask = packet.mask === null ? void 0 : options.masks?.get(packet.mask);
      fillPacket(target, packet, { scale: scale7, originX, originY }, options.atlas, mask, supersample, fillMode);
      if (packet.outline !== null && edges !== "none") {
        outlinePacket(target, packet, { scale: scale7, originX, originY }, mask, supersample);
      }
      if (packet.outline !== null && edges === "triangles") {
        edgePacket(target, packet, { scale: scale7, originX, originY }, mask, supersample, options.edgeWidthPx ?? 1);
      }
    }
  }
  function rasterizeMask(packet, width, height, transform, options = {}) {
    const mask = new Uint8Array(width * height);
    const positions = packet.vertices;
    const minWorldY = options.minWorldY ?? Number.NEGATIVE_INFINITY;
    for (let t = 0; t < packet.indices.length; t += 3) {
      const ia = packet.indices[t];
      const ib = packet.indices[t + 1];
      const ic = packet.indices[t + 2];
      const ax = transform.originX + positions[ia * 2] * transform.scale;
      const ay = transform.originY - positions[ia * 2 + 1] * transform.scale;
      const bx = transform.originX + positions[ib * 2] * transform.scale;
      const by = transform.originY - positions[ib * 2 + 1] * transform.scale;
      const cx = transform.originX + positions[ic * 2] * transform.scale;
      const cy = transform.originY - positions[ic * 2 + 1] * transform.scale;
      const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(denom) <= 1e-8) continue;
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = minY; y <= maxY; y += 1) {
        const worldY = (transform.originY - (y + 0.5)) / transform.scale;
        if (worldY < minWorldY) continue;
        for (let x = minX; x <= maxX; x += 1) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
          const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          mask[y * width + x] = 255;
        }
      }
    }
    if (options.invert === true) {
      for (let i = 0; i < mask.length; i += 1) mask[i] = 255 - mask[i];
    }
    return mask;
  }
  function fillPacket(target, packet, transform, atlas, mask, supersample, fillMode) {
    const positions = packet.vertices;
    const count = positions.length / 2;
    const ref = atlas?.regions.get(packet.atlasKey);
    const page = ref === void 0 ? void 0 : atlas?.pages[ref.page];
    const region = ref?.region;
    const useAtlas = page !== void 0 && region !== void 0 && packet.uvs.length === count * 2;
    const vertexColors = new Float32Array(count * 4);
    if (useAtlas) {
      const sampled = { r: 0, g: 0, b: 0, a: 0 };
      for (let v = 0; v < count; v += 1) {
        sampleAtlas(sampled, page, region, packet.uvs[v * 2], packet.uvs[v * 2 + 1], "linear");
        vertexColors[v * 4] = sampled.r;
        vertexColors[v * 4 + 1] = sampled.g;
        vertexColors[v * 4 + 2] = sampled.b;
        vertexColors[v * 4 + 3] = sampled.a;
      }
    } else {
      for (let v = 0; v < count; v += 1) {
        vertexColors[v * 4] = (packet.colors[v * 4] ?? 255) / 255;
        vertexColors[v * 4 + 1] = (packet.colors[v * 4 + 1] ?? 255) / 255;
        vertexColors[v * 4 + 2] = (packet.colors[v * 4 + 2] ?? 255) / 255;
        vertexColors[v * 4 + 3] = (packet.colors[v * 4 + 3] ?? 255) / 255;
      }
    }
    const indices = packet.indices;
    for (let t = 0; t < indices.length; t += 3) {
      const ia = indices[t];
      const ib = indices[t + 1];
      const ic = indices[t + 2];
      const ax = transform.originX + positions[ia * 2] * transform.scale;
      const ay = transform.originY - positions[ia * 2 + 1] * transform.scale;
      const bx = transform.originX + positions[ib * 2] * transform.scale;
      const by = transform.originY - positions[ib * 2 + 1] * transform.scale;
      const cx = transform.originX + positions[ic * 2] * transform.scale;
      const cy = transform.originY - positions[ic * 2 + 1] * transform.scale;
      const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(denom) <= 1e-8) continue;
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const maxX = Math.min(target.width - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const maxY = Math.min(target.height - 1, Math.ceil(Math.max(ay, by, cy)));
      const ar = vertexColors[ia * 4];
      const ag = vertexColors[ia * 4 + 1];
      const ab = vertexColors[ia * 4 + 2];
      const aa = vertexColors[ia * 4 + 3];
      const br = vertexColors[ib * 4];
      const bg = vertexColors[ib * 4 + 1];
      const bb = vertexColors[ib * 4 + 2];
      const ba = vertexColors[ib * 4 + 3];
      const cr = vertexColors[ic * 4];
      const cg = vertexColors[ic * 4 + 1];
      const cb = vertexColors[ic * 4 + 2];
      const ca = vertexColors[ic * 4 + 3];
      const fixed = fillMode === "triangle" ? { r: (ar + br + cr) / 3, g: (ag + bg + cg) / 3, b: (ab + bb + cb) / 3, a: (aa + ba + ca) / 3 } : null;
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
          const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const maskA = mask === void 0 ? 1 : (mask[y * target.width + x] ?? 0) / 255;
          if (maskA <= 0) continue;
          if (fixed !== null) {
            writePixel(target, x, y, fixed.r, fixed.g, fixed.b, fixed.a * maskA, packet.blend);
          } else {
            writePixel(
              target,
              x,
              y,
              ar * w0 + br * w1 + cr * w2,
              ag * w0 + bg * w1 + cg * w2,
              ab * w0 + bb * w1 + cb * w2,
              (aa * w0 + ba * w1 + ca * w2) * maskA,
              packet.blend
            );
          }
        }
      }
    }
    void supersample;
  }
  function edgePacket(target, packet, transform, mask, supersample, widthPx) {
    const outline = packet.outline;
    const width = Math.max(0.25, widthPx) * supersample;
    const seen = /* @__PURE__ */ new Set();
    const positions = packet.vertices;
    const indices = packet.indices;
    for (let t = 0; t < indices.length; t += 3) {
      for (let e = 0; e < 3; e += 1) {
        const from = indices[t + e];
        const to = indices[t + (e + 1) % 3];
        const lo = from < to ? from : to;
        const hi = from < to ? to : from;
        const key = `${lo}:${hi}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const ax = transform.originX + positions[lo * 2] * transform.scale;
        const ay = transform.originY - positions[lo * 2 + 1] * transform.scale;
        const bx = transform.originX + positions[hi * 2] * transform.scale;
        const by = transform.originY - positions[hi * 2 + 1] * transform.scale;
        const dx = bx - ax;
        const dy = by - ay;
        const length6 = Math.hypot(dx, dy);
        if (length6 < 1e-9) continue;
        const nx = dy / length6 * (width / 2);
        const ny = -dx / length6 * (width / 2);
        fillScreenTriangle(target, ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, outline.color, mask, packet.blend);
        fillScreenTriangle(target, ax + nx, ay + ny, bx - nx, by - ny, ax - nx, ay - ny, outline.color, mask, packet.blend);
      }
    }
  }
  function outlinePacket(target, packet, transform, mask, supersample) {
    const outline = packet.outline;
    const ribbon = buildOutlineRibbon(packet, transform.scale, outline.widthPx * supersample);
    if (ribbon === null) return;
    for (let t = 0; t < ribbon.indices.length; t += 3) {
      const ia = ribbon.indices[t];
      const ib = ribbon.indices[t + 1];
      const ic = ribbon.indices[t + 2];
      const ax = transform.originX + ribbon.positions[ia * 2] * transform.scale;
      const ay = transform.originY - ribbon.positions[ia * 2 + 1] * transform.scale;
      const bx = transform.originX + ribbon.positions[ib * 2] * transform.scale;
      const by = transform.originY - ribbon.positions[ib * 2 + 1] * transform.scale;
      const cx = transform.originX + ribbon.positions[ic * 2] * transform.scale;
      const cy = transform.originY - ribbon.positions[ic * 2 + 1] * transform.scale;
      const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(denom) <= 1e-8) continue;
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const maxX = Math.min(target.width - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const maxY = Math.min(target.height - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
          const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
          const maskA = mask === void 0 ? 1 : (mask[y * target.width + x] ?? 0) / 255;
          if (maskA <= 0) continue;
          writePixel(target, x, y, outline.color.r, outline.color.g, outline.color.b, outline.color.a * maskA, packet.blend);
        }
      }
    }
  }
  function fillScreenTriangle(target, ax, ay, bx, by, cx, cy, color, mask, mode) {
    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denom) <= 1e-8) return;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(target.width - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(target.height - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
        const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const maskA = mask === void 0 ? 1 : (mask[y * target.width + x] ?? 0) / 255;
        if (maskA <= 0) continue;
        writePixel(target, x, y, color.r, color.g, color.b, color.a * maskA, mode);
      }
    }
  }
  function writePixel(target, x, y, r, g, b, a, mode) {
    if (a <= 0) return;
    const i = (y * target.width + x) * 4;
    if (mode === "normal" && a >= 0.999) {
      target.pixels[i] = Math.round(r * 255);
      target.pixels[i + 1] = Math.round(g * 255);
      target.pixels[i + 2] = Math.round(b * 255);
      target.pixels[i + 3] = 255;
      return;
    }
    const dst = {
      r: target.pixels[i] / 255,
      g: target.pixels[i + 1] / 255,
      b: target.pixels[i + 2] / 255,
      a: target.pixels[i + 3] / 255
    };
    blendColor(dst, { r, g, b, a }, mode);
    target.pixels[i] = Math.round(dst.r * 255);
    target.pixels[i + 1] = Math.round(dst.g * 255);
    target.pixels[i + 2] = Math.round(dst.b * 255);
    target.pixels[i + 3] = Math.round(dst.a * 255);
  }

  // packages/render-engine/src/pipeline2d/limb.ts
  var SKIN = "base";
  var OUTLINE = {
    widthPx: 2.5,
    color: { r: 0.08, g: 0.08, b: 0.08, a: 1 },
    join: "round",
    cap: "round",
    depthBias: 0
  };
  function frontPoint(point) {
    return { x: point.z, y: point.y };
  }
  function frontDepth(point) {
    return -point.x;
  }
  function outlineToMesh(positions, indices, depths) {
    const count = positions.length / 2;
    if (depths.length !== count) throw new Error("depth");
    const seam2 = new Uint8Array(count);
    seam2[0] = 1;
    seam2[1] = 1;
    seam2[count - 2] = 1;
    seam2[count - 1] = 1;
    return {
      positions,
      uvs: new Float32Array(0),
      indices,
      colors: new Uint8Array(0),
      boneIndices: new Uint16Array(0),
      weights: new Float32Array(0),
      seam: seam2,
      depth: depths,
      bounds: meshBounds(positions)
    };
  }
  var ARM_YOKE_RINGS = 2;
  function buildArmParts(compiled2, fk2, side, fill2) {
    const bones = armOutlineBones(compiled2, fk2, `arm${side}`);
    const shoulder = frontPoint(bones.shoulder);
    const elbow = frontPoint(bones.elbow);
    const wrist = frontPoint(bones.wrist);
    const handTip = frontPoint(bones.handTip);
    const handDir = { x: handTip.x - wrist.x, y: handTip.y - wrist.y };
    const wristWidth = wristHalfWidth(
      handDir,
      { x: bones.handLateral.z, y: bones.handLateral.y },
      { x: bones.handThicknessAxis.z, y: bones.handThicknessAxis.y },
      bones.palmHalfWidth,
      bones.palmHalfThickness
    );
    const outline = buildArmOutline({
      shoulder: shoulderRoot(shoulder, bones.height),
      elbow,
      wrist,
      handDir,
      wristWidth,
      upperWidth: bones.upperWidth,
      lowerWidth: bones.lowerWidth,
      sections: ARM_SECTIONS,
      shoulderDepth: frontDepth(bones.shoulder),
      elbowDepth: frontDepth(bones.elbow),
      wristDepth: frontDepth(bones.wrist)
    });
    const ringCount = outline.positions.length / 4;
    const cut = Math.max(1, Math.min(ARM_YOKE_RINGS, ringCount - 2));
    const arm = {
      id: `arm${side}`,
      skin: SKIN,
      mesh: outlineToMesh(outline.positions, outline.indices, outline.depths),
      material: { kind: "flat", color: fill2 },
      outline: OUTLINE
    };
    return { arm, outline, cut };
  }
  function buildLegAttachment(compiled2, fk2, side, fill2) {
    const suffix = side;
    const hipBone = findBone(compiled2.skeleton, `thigh${suffix}`);
    const kneeBone = findBone(compiled2.skeleton, `shin${suffix}`);
    const ankleBone = findBone(compiled2.skeleton, `foot${suffix}`);
    for (const bone of [hipBone, kneeBone, ankleBone]) {
      if (bone < 0) throw new Error("bone");
    }
    const hip = origin2(fk2, hipBone);
    const knee = origin2(fk2, kneeBone);
    const ankle = origin2(fk2, ankleBone);
    const outline = buildArmOutline({
      shoulder: frontPoint(hip),
      elbow: frontPoint(knee),
      wrist: frontPoint(ankle),
      upperWidth: widthProfile(compiled2.proportions.thighProfile),
      lowerWidth: widthProfile(compiled2.proportions.shinProfile),
      sections: ARM_SECTIONS,
      wristRings: 0,
      shoulderDepth: frontDepth(hip),
      elbowDepth: frontDepth(knee),
      wristDepth: frontDepth(ankle)
    });
    return {
      id: `leg${side}`,
      skin: SKIN,
      mesh: outlineToMesh(outline.positions, outline.indices, outline.depths),
      material: { kind: "flat", color: fill2 },
      outline: OUTLINE
    };
  }
  function origin2(fk2, bone) {
    if (bone < 0) throw new Error("bone");
    const base = bone * 12;
    return { x: fk2[base + 9], y: fk2[base + 10], z: fk2[base + 11] };
  }

  // packages/render-engine/src/pipeline2d/geometry.ts
  function fanShape(points) {
    if (points.length < 3) throw new Error("shape");
    let cx = 0;
    let cy = 0;
    let cd = 0;
    for (const point of points) {
      cx += point.x;
      cy += point.y;
      cd += point.depth;
    }
    cx /= points.length;
    cy /= points.length;
    cd /= points.length;
    const positions = new Float32Array((points.length + 1) * 2);
    const depth = new Float32Array(points.length + 1);
    const indices = new Uint16Array(points.length * 3);
    for (let i = 0; i < points.length; i += 1) {
      positions[i * 2] = points[i].x;
      positions[i * 2 + 1] = points[i].y;
      depth[i] = points[i].depth;
      indices[i * 3] = points.length;
      indices[i * 3 + 1] = i;
      indices[i * 3 + 2] = (i + 1) % points.length;
    }
    positions[points.length * 2] = cx;
    positions[points.length * 2 + 1] = cy;
    depth[points.length] = cd;
    return { positions, indices, depth };
  }
  function ellipseShape(center, u, n, halfU, halfN, segments, depth) {
    const count = Math.max(3, Math.floor(segments));
    const points = [];
    for (let i = 0; i < count; i += 1) {
      const angle3 = i / count * Math.PI * 2;
      const a = Math.cos(angle3) * halfU;
      const b = Math.sin(angle3) * halfN;
      points.push({
        x: center.x + u.x * a + n.x * b,
        y: center.y + u.y * a + n.y * b,
        depth
      });
    }
    return fanShape(points);
  }
  function gridShape(rows) {
    if (rows.length < 2) throw new Error("shape");
    const columns = rows[0].length;
    if (columns < 2) throw new Error("shape");
    let count = 0;
    for (const row of rows) {
      if (row.length !== columns) throw new Error("shape");
      count += row.length;
    }
    const positions = new Float32Array(count * 2);
    const depth = new Float32Array(count);
    const indices = [];
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = 0; j < columns; j += 1) {
        const v = i * columns + j;
        positions[v * 2] = rows[i][j].x;
        positions[v * 2 + 1] = rows[i][j].y;
        depth[v] = rows[i][j].depth;
      }
    }
    for (let i = 0; i + 1 < rows.length; i += 1) {
      for (let j = 0; j + 1 < columns; j += 1) {
        const a = i * columns + j;
        const b = a + 1;
        const c = a + columns;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    return { positions, indices: Uint16Array.from(indices), depth };
  }
  function ellipseGridShape(center, u, n, halfU, halfN, segments, rings, depth) {
    const count = Math.max(3, Math.floor(segments));
    const ringCount = Math.max(1, Math.floor(rings));
    const vertexCount = 1 + count * ringCount;
    const positions = new Float32Array(vertexCount * 2);
    const depths = new Float32Array(vertexCount);
    const indices = [];
    positions[0] = center.x;
    positions[1] = center.y;
    depths[0] = depth;
    for (let r = 1; r <= ringCount; r += 1) {
      const radius = r / ringCount;
      for (let i = 0; i < count; i += 1) {
        const angle3 = i / count * Math.PI * 2;
        const a = Math.cos(angle3) * halfU * radius;
        const b = Math.sin(angle3) * halfN * radius;
        const v = 1 + (r - 1) * count + i;
        positions[v * 2] = center.x + u.x * a + n.x * b;
        positions[v * 2 + 1] = center.y + u.y * a + n.y * b;
        depths[v] = depth;
      }
    }
    for (let i = 0; i < count; i += 1) {
      indices.push(0, 1 + i, 1 + (i + 1) % count);
    }
    for (let r = 1; r < ringCount; r += 1) {
      const inner = 1 + (r - 1) * count;
      const outer = 1 + r * count;
      for (let i = 0; i < count; i += 1) {
        const j = (i + 1) % count;
        indices.push(inner + i, outer + i, outer + j, inner + i, outer + j, inner + j);
      }
    }
    return { positions, indices: Uint16Array.from(indices), depth: depths };
  }
  function quadShape(a, b, c, d) {
    return {
      positions: Float32Array.from([
        a.x,
        a.y,
        b.x,
        b.y,
        c.x,
        c.y,
        d.x,
        d.y
      ]),
      indices: Uint16Array.from([0, 1, 2, 0, 2, 3]),
      depth: Float32Array.from([a.depth, b.depth, c.depth, d.depth])
    };
  }
  function mergeShapes(shapes) {
    let vertexCount = 0;
    let indexCount = 0;
    for (const shape of shapes) {
      vertexCount += shape.positions.length / 2;
      indexCount += shape.indices.length;
    }
    const positions = new Float32Array(vertexCount * 2);
    const depth = new Float32Array(vertexCount);
    const indices = new Uint16Array(indexCount);
    let vo = 0;
    let io = 0;
    for (const shape of shapes) {
      const count = shape.positions.length / 2;
      positions.set(shape.positions, vo * 2);
      depth.set(shape.depth, vo);
      for (let i = 0; i < shape.indices.length; i += 1) indices[io + i] = shape.indices[i] + vo;
      vo += count;
      io += shape.indices.length;
    }
    return { positions, indices, depth };
  }
  function shapeToMesh(shape, seam2 = new Uint8Array(0)) {
    if (shape.depth.length !== shape.positions.length / 2) throw new Error("depth");
    return {
      positions: shape.positions,
      uvs: new Float32Array(0),
      indices: shape.indices,
      colors: new Uint8Array(0),
      boneIndices: new Uint16Array(0),
      weights: new Float32Array(0),
      seam: seam2,
      depth: shape.depth,
      bounds: meshBounds(shape.positions)
    };
  }

  // packages/render-engine/src/pipeline2d/humanoid2d.ts
  var SKIN2 = "base";
  function buildHumanoid2DScene(compiled2, fk2) {
    const torso = buildTorsoAttachment(compiled2, fk2);
    const partL = buildArmParts(compiled2, fk2, "L", fill("armL"));
    const partR = buildArmParts(compiled2, fk2, "R", fill("armR"));
    const attachments = [
      buildLegAttachment(compiled2, fk2, "L", fill("legL")),
      buildLegAttachment(compiled2, fk2, "R", fill("legR")),
      buildFootAttachment(compiled2, fk2, "L", fill("footL")),
      buildFootAttachment(compiled2, fk2, "R", fill("footR")),
      torso,
      partL.arm,
      partR.arm,
      buildShoulderYoke(torso, partL.outline, partL.cut, "L", fill("armL")),
      buildShoulderYoke(torso, partR.outline, partR.cut, "R", fill("armR")),
      buildGapFill(torso, partL.arm, "L", fill("armL")),
      buildGapFill(torso, partR.arm, "R", fill("armR")),
      buildSkinnedHandAttachment(compiled2, fk2, "L", fill("handL")),
      buildSkinnedHandAttachment(compiled2, fk2, "R", fill("handR")),
      buildHeadAttachment(compiled2, fk2)
    ];
    return createRenderScene(slots(compiled2, fk2), [{ id: SKIN2, attachments }]);
  }
  function torsoShoulderBoost(t) {
    const up = Math.min(1, Math.max(0, (t - 0.1) / 0.25));
    const down = Math.min(1, Math.max(0, (0.82 - t) / 0.2));
    const smooth = (x) => x * x * (3 - 2 * x);
    return 0.035 * smooth(up) * smooth(down);
  }
  function buildTorsoAttachment(compiled2, fk2) {
    const pelvis = origin3(fk2, findBone(compiled2.skeleton, "pelvis"));
    const neck = origin3(fk2, findBone(compiled2.skeleton, "head"));
    const sections = 24;
    const columns = 5;
    const rows = [];
    for (let i = 0; i <= sections; i += 1) {
      const t = i / sections;
      const x = neck.z * t + pelvis.z * (1 - t);
      const y = neck.y * t + pelvis.y * (1 - t);
      const depth = -(neck.x * t + pelvis.x * (1 - t));
      const width = halfWidthAt(compiled2.proportions.torsoProfile, t) + torsoShoulderBoost(t);
      const row = [];
      for (let j = 0; j <= columns; j += 1) {
        const u = j / columns;
        row.push({ x: x - width + u * width * 2, y, depth });
      }
      rows.push(row);
    }
    return attachment("torso", shapeToMesh(gridShape(rows)), fill("torso"));
  }
  function buildHeadAttachment(compiled2, fk2) {
    const bone = findBone(compiled2.skeleton, "head");
    const head = origin3(fk2, bone);
    const axis = axisOf3(fk2, bone);
    const u = { x: axis.z, y: axis.y };
    const n = { x: -u.y, y: u.x };
    const length6 = bindLength(compiled2.skeleton, bone);
    const center = { x: head.z + u.x * length6 * 0.5, y: head.y + u.y * length6 * 0.5 };
    const halfWidth = maxHalfWidth(compiled2.proportions.headProfile);
    return attachment(
      "head",
      shapeToMesh(ellipseGridShape(center, u, n, length6 * 0.5, halfWidth, 24, 3, frontDepth(head))),
      fill("head")
    );
  }
  function buildHandAttachment(compiled2, fk2, side, color) {
    const bone = findBone(compiled2.skeleton, `hand${side}`);
    const wrist3 = origin3(fk2, bone);
    const axis = axisOf3(fk2, bone);
    const u = normalize22({ x: axis.z, y: axis.y });
    const n = { x: -u.y, y: u.x };
    const wrist = frontPoint(wrist3);
    const length6 = bindLength(compiled2.skeleton, bone);
    const depth = frontDepth(wrist3);
    const p = compiled2.proportions;
    const palm = p.palmFraction * length6;
    const wristWidth = p.palmWrist.halfWidth;
    const knuckleWidth = p.palmKnuckle.halfWidth;
    const at = (along, across) => ({
      x: wrist.x + u.x * along + n.x * across,
      y: wrist.y + u.y * along + n.y * across,
      depth
    });
    const shapes = [
      ellipseShape(wrist, u, n, wristWidth * 1.05, wristWidth * 0.85, 16, depth),
      quadShape(
        at(0, -wristWidth),
        at(0, wristWidth),
        at(palm, knuckleWidth),
        at(palm, -knuckleWidth)
      )
    ];
    const fingers = [
      ["thumb", 2, p.thumbRadius],
      ["index", 3, p.fingerRadius],
      ["middle", 3, p.fingerRadius],
      ["ring", 3, p.fingerRadius],
      ["pinky", 3, p.fingerRadius]
    ];
    for (const [finger, segments, radius] of fingers) {
      for (let s = 0; s < segments; s += 1) {
        const name = `${finger}${s + 1}${side}`;
        const fingerBone = findBone(compiled2.skeleton, name);
        if (fingerBone < 0) continue;
        const base3 = origin3(fk2, fingerBone);
        const baseAxis = axisOf3(fk2, fingerBone);
        const baseU = normalize22({ x: baseAxis.z, y: baseAxis.y });
        const baseN = { x: -baseU.y, y: baseU.x };
        const base = frontPoint(base3);
        const segmentLength = bindLength(compiled2.skeleton, fingerBone);
        const projected = Math.hypot(baseAxis.z, baseAxis.y) * segmentLength;
        const next = findBone(compiled2.skeleton, `${finger}${s + 2}${side}`);
        const tip = next < 0 ? {
          x: base.x + baseU.x * projected,
          y: base.y + baseU.y * projected,
          depth: frontDepth(base3)
        } : frontPoint(origin3(fk2, next));
        const t0 = s / segments;
        const t1 = (s + 1) / segments;
        const baseRadius = finger === "thumb" ? radius * (1 - t0 * 0.3) : p.fingerRadius + (p.fingerTipRadius - p.fingerRadius) * t0;
        const tipRadius = finger === "thumb" ? radius * (1 - t1 * 0.3) : p.fingerRadius + (p.fingerTipRadius - p.fingerRadius) * t1;
        shapes.push(
          quadShape(
            { x: base.x + baseN.x * baseRadius, y: base.y + baseN.y * baseRadius, depth: frontDepth(base3) },
            { x: base.x - baseN.x * baseRadius, y: base.y - baseN.y * baseRadius, depth: frontDepth(base3) },
            { x: tip.x - baseN.x * tipRadius, y: tip.y - baseN.y * tipRadius, depth: frontDepth(base3) },
            { x: tip.x + baseN.x * tipRadius, y: tip.y + baseN.y * tipRadius, depth: frontDepth(base3) }
          )
        );
      }
    }
    return attachment(`hand${side}`, shapeToMesh(mergeShapes(shapes)), color);
  }
  function buildSkinnedHandAttachment(compiled2, fk2, side, color) {
    const bind = buildHandAttachment(compiled2, compiled2.bindRig, side, color);
    const mesh = bind.mesh;
    const count = mesh.positions.length / 2;
    const boneNames = [
      `hand${side}`,
      ...[1, 2, 3].flatMap((s) => ["thumb", "index", "middle", "ring", "pinky"].filter((finger) => !(finger === "thumb" && s === 3)).map((finger) => `${finger}${s}${side}`))
    ];
    const bones = boneNames.map((name) => findBone(compiled2.skeleton, name)).filter((bone) => bone >= 0);
    const weights = new Float32Array(count * 4);
    const boneIndices = new Uint16Array(count * 4);
    const matrixCache = /* @__PURE__ */ new Map();
    const matrixOf = (bone) => {
      const found = matrixCache.get(bone);
      if (found !== void 0) return found;
      const matrix = new Float32Array(RIGID_STRIDE);
      multiplyRigid(
        matrix,
        fk2.subarray(bone * RIGID_STRIDE, bone * RIGID_STRIDE + RIGID_STRIDE),
        compiled2.inverseBind.subarray(bone * RIGID_STRIDE, bone * RIGID_STRIDE + RIGID_STRIDE)
      );
      matrixCache.set(bone, matrix);
      return matrix;
    };
    const positions = new Float32Array(count * 2);
    const depths = new Float32Array(count);
    for (let v = 0; v < count; v += 1) {
      const p = {
        x: -mesh.depth[v],
        y: mesh.positions[v * 2 + 1],
        z: mesh.positions[v * 2]
      };
      const distances = [];
      for (const bone of bones) {
        const base = bone * RIGID_STRIDE;
        const ox = compiled2.bindRig[base + 9];
        const oy = compiled2.bindRig[base + 10];
        const oz = compiled2.bindRig[base + 11];
        const ax = compiled2.bindRig[base];
        const ay = compiled2.bindRig[base + 1];
        const az = compiled2.bindRig[base + 2];
        const length6 = bindLength(compiled2.skeleton, bone);
        const dx = p.x - ox;
        const dy = p.y - oy;
        const dz = p.z - oz;
        const t = Math.max(0, Math.min(1, (dx * ax + dy * ay + dz * az) / Math.max(1e-9, length6 * length6)));
        const ex = dx - ax * length6 * t;
        const ey = dy - ay * length6 * t;
        const ez = dz - az * length6 * t;
        distances.push({ bone, distance: Math.hypot(ex, ey, ez) });
      }
      distances.sort((a, b) => a.distance - b.distance);
      const first = distances[0];
      const second = distances[1];
      const d0 = Math.max(1e-4, first.distance);
      const d1 = second === void 0 ? Infinity : Math.max(1e-4, second.distance);
      let w0 = 1;
      let w1 = 0;
      if (Number.isFinite(d1) && d1 < d0 * 4) {
        w0 = 1 / (d0 * d0);
        w1 = 1 / (d1 * d1);
        const sum = w0 + w1;
        w0 /= sum;
        w1 /= sum;
      }
      boneIndices[v * 4] = first.bone;
      boneIndices[v * 4 + 1] = second?.bone ?? 0;
      weights[v * 4] = w0;
      weights[v * 4 + 1] = w1;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let i = 0; i < 2; i += 1) {
        const weight = weights[v * 4 + i];
        if (weight === 0) continue;
        const matrix = matrixOf(boneIndices[v * 4 + i]);
        sx += weight * (matrix[0] * p.x + matrix[3] * p.y + matrix[6] * p.z + matrix[9]);
        sy += weight * (matrix[1] * p.x + matrix[4] * p.y + matrix[7] * p.z + matrix[10]);
        sz += weight * (matrix[2] * p.x + matrix[5] * p.y + matrix[8] * p.z + matrix[11]);
      }
      positions[v * 2] = sz;
      positions[v * 2 + 1] = sy;
      depths[v] = -sx;
    }
    return {
      ...bind,
      mesh: {
        ...mesh,
        positions,
        depth: depths,
        weights,
        boneIndices,
        bounds: meshBounds(positions)
      }
    };
  }
  function buildFootAttachment(compiled2, fk2, side, color) {
    const bone = findBone(compiled2.skeleton, `foot${side}`);
    const ankle3 = origin3(fk2, bone);
    const ankle = frontPoint(ankle3);
    const width = maxRadius(compiled2.proportions.footHalfWidth);
    const height = Math.max(0.024, compiled2.proportions.ankleHeight * 0.8);
    const depth = frontDepth(ankle3);
    const upper = ellipseGridShape(
      { x: ankle.x, y: ankle.y - height * 0.55 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      width * 0.96,
      height * 0.5,
      20,
      2,
      depth
    );
    const sole = quadShape(
      { x: ankle.x - width * 1.03, y: ankle.y - height, depth },
      { x: ankle.x + width * 1.03, y: ankle.y - height, depth },
      { x: ankle.x + width * 1.03, y: ankle.y - height + 0.012, depth },
      { x: ankle.x - width * 1.03, y: ankle.y - height + 0.012, depth }
    );
    return attachment(`foot${side}`, shapeToMesh(mergeShapes([upper, sole])), color);
  }
  function extremeAt(vertices, y, sign) {
    let result = sign === 1 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    let any = false;
    for (let i = 0; i < vertices.length; i += 2) {
      if (Math.abs(vertices[i + 1] - y) > 0.03) continue;
      any = true;
      const x = vertices[i];
      result = sign === 1 ? Math.max(result, x) : Math.min(result, x);
    }
    return any ? result : Number.NaN;
  }
  function buildGapFill(torso, arm, side, color) {
    const sideSign = side === "L" ? 1 : -1;
    const rows = [];
    if (arm.mesh.bounds !== null && arm.mesh.bounds.width > arm.mesh.bounds.height * 0.9) {
      const y = 1.25;
      const x = sideSign * 0.16;
      rows.push([{ x, y, depth: 0 }, { x: x + sideSign * 2e-3, y, depth: 0 }]);
      rows.push([{ x, y: y + 0.01, depth: 0 }, { x: x + sideSign * 2e-3, y: y + 0.01, depth: 0 }]);
      return attachment(`gap${side}`, shapeToMesh(gridShape(rows)), color, null, `arm${side}`);
    }
    for (let y = 0.95; y <= 1.45; y += 0.01) {
      const torsoX = boundaryX(torso.mesh, y, sideSign);
      const armX = boundaryX(arm.mesh, y, -sideSign);
      if (!Number.isFinite(torsoX) || !Number.isFinite(armX)) continue;
      const gap = sideSign * (armX - torsoX);
      if (gap <= 5e-4) continue;
      rows.push([
        { x: torsoX, y, depth: 0 },
        { x: armX, y, depth: 0 }
      ]);
    }
    if (rows.length < 2) {
      const y = 1.25;
      const x = sideSign * 0.16;
      rows.push([{ x, y, depth: 0 }, { x: x + sideSign * 2e-3, y, depth: 0 }]);
      rows.push([{ x, y: y + 0.01, depth: 0 }, { x: x + sideSign * 2e-3, y: y + 0.01, depth: 0 }]);
    }
    return attachment(`gap${side}`, shapeToMesh(gridShape(rows)), color, null, `arm${side}`);
  }
  function boundaryX(mesh, y, sign) {
    let result = sign === 1 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const positions = mesh.positions;
    const indices = mesh.indices;
    for (let t = 0; t < indices.length; t += 3) {
      for (let e = 0; e < 3; e += 1) {
        const a = indices[t + e];
        const b = indices[t + (e + 1) % 3];
        const ay = positions[a * 2 + 1];
        const by = positions[b * 2 + 1];
        if (y < Math.min(ay, by) || y > Math.max(ay, by) || Math.abs(by - ay) < 1e-9) continue;
        const u = (y - ay) / (by - ay);
        const x = positions[a * 2] + (positions[b * 2] - positions[a * 2]) * u;
        result = sign === 1 ? Math.max(result, x) : Math.min(result, x);
      }
    }
    return result;
  }
  function buildShoulderYoke(torso, outline, cut, side, color) {
    const sideSign = side === "L" ? 1 : -1;
    const rows = [];
    for (let r = 0; r <= cut; r += 1) {
      const i = r * 4;
      const y = (outline.positions[i + 1] + outline.positions[i + 3]) / 2;
      const outer = sideSign === 1 ? Math.max(outline.positions[i], outline.positions[i + 2]) : Math.min(outline.positions[i], outline.positions[i + 2]);
      const torsoX = extremeAt(torso.mesh.positions, y, sideSign);
      const inner = Number.isFinite(torsoX) ? torsoX : outer - sideSign * 0.03;
      rows.push([
        { x: inner, y, depth: 0 },
        { x: outer, y, depth: 0 }
      ]);
    }
    return attachment(`shoulder${side}`, shapeToMesh(gridShape(rows)), color, null, `arm${side}`);
  }
  function armDepth(compiled2, fk2, side) {
    const bones = [`upperArm${side}`, `lowerArm${side}`, `hand${side}`];
    let sum = 0;
    for (const name of bones) sum += origin3(fk2, findBone(compiled2.skeleton, name)).x;
    return sum / bones.length;
  }
  function legDepth(compiled2, fk2, side) {
    const bones = [`thigh${side}`, `shin${side}`, `foot${side}`];
    let sum = 0;
    for (const name of bones) sum += origin3(fk2, findBone(compiled2.skeleton, name)).x;
    return sum / bones.length;
  }
  function slots(compiled2, fk2) {
    const chestX = origin3(fk2, findBone(compiled2.skeleton, "chest")).x;
    const armLX = armDepth(compiled2, fk2, "L");
    const armRX = armDepth(compiled2, fk2, "R");
    const legLX = legDepth(compiled2, fk2, "L");
    const legRX = legDepth(compiled2, fk2, "R");
    const armLFront = armLX >= chestX - 1e-4;
    const armRFront = armRX >= chestX - 1e-4;
    const legLFront = legLX > legRX + 1e-4;
    const legRFront = legRX > legLX + 1e-4;
    const list = [
      { id: "legL", order: legLFront ? 0.2 : 0, attachment: "legL" },
      { id: "legR", order: legRFront ? 0.2 : 0, attachment: "legR" },
      { id: "footL", order: legLFront ? 1.2 : 1, attachment: "footL" },
      { id: "footR", order: legRFront ? 1.2 : 1, attachment: "footR" },
      { id: "torso", order: 2, attachment: "torso" },
      // 手臂按当前深度动态放到躯干前/后；肩口 mask 只裁根部。
      { id: "armL", order: armLFront ? 3 : 1.5, attachment: "armL" },
      { id: "armR", order: armRFront ? 3 : 1.5, attachment: "armR" },
      { id: "gapL", order: 1.5, attachment: "gapL" },
      { id: "gapR", order: 1.5, attachment: "gapR" },
      { id: "shoulderL", order: armLFront ? 3.5 : 1.7, attachment: "shoulderL" },
      { id: "shoulderR", order: armRFront ? 3.5 : 1.7, attachment: "shoulderR" },
      { id: "handL", order: armLFront ? 4 : 1.6, attachment: "handL" },
      { id: "handR", order: armRFront ? 4 : 1.6, attachment: "handR" },
      { id: "head", order: 5, attachment: "head" }
    ];
    return list.map((item) => ({
      ...item,
      tint: { r: 1, g: 1, b: 1, a: 1 },
      blend: "normal",
      mask: item.id === "armL" || item.id === "armR" ? "shoulder" : null
    }));
  }
  function attachment(id, mesh, color, outline = {
    widthPx: 2.5,
    color: { r: 0.08, g: 0.08, b: 0.08, a: 1 },
    join: "round",
    cap: "round",
    depthBias: 0
  }, atlasKey) {
    return {
      id,
      skin: SKIN2,
      mesh,
      material: { kind: "flat", color },
      outline,
      ...atlasKey === void 0 ? {} : { atlasKey }
    };
  }
  function fill(part) {
    const color = HUMANOID_FILL[part];
    return { r: color.r, g: color.g, b: color.b, a: 1 };
  }
  function origin3(fk2, bone) {
    if (bone < 0) throw new Error("bone");
    const base = bone * 12;
    return { x: fk2[base + 9], y: fk2[base + 10], z: fk2[base + 11] };
  }
  function axisOf3(fk2, bone) {
    if (bone < 0) throw new Error("bone");
    const base = bone * 12;
    return { x: fk2[base], y: fk2[base + 1], z: fk2[base + 2] };
  }
  function maxHalfWidth(profile) {
    let max3 = 0;
    for (const sample3 of profile) max3 = Math.max(max3, sample3.halfWidth);
    return max3;
  }
  function maxRadius(profile) {
    let max3 = 0;
    for (const sample3 of profile) max3 = Math.max(max3, sample3.radius);
    return max3;
  }
  function normalize22(v) {
    const length6 = Math.hypot(v.x, v.y);
    if (length6 < 1e-9) return { x: 0, y: -1 };
    return { x: v.x / length6, y: v.y / length6 };
  }

  // packages/render-engine/src/pipeline2d/humanoidAtlas.ts
  var PART_IDS = [
    "torso",
    "head",
    "armL",
    "handL",
    "armR",
    "handR",
    "legL",
    "footL",
    "legR",
    "footR"
  ];
  function createHumanoidAtlas() {
    const atlas = packAtlas(
      PART_IDS.map((id) => ({ id, width: 40, height: 80 })),
      { padding: 2, maxWidth: 256, pma: false }
    );
    const image = {
      width: atlas.width,
      height: atlas.height,
      rgba: new Uint8Array(atlas.width * atlas.height * 4),
      pma: atlas.pma
    };
    const regions = /* @__PURE__ */ new Map();
    for (const region of atlas.regions) {
      regions.set(region.id, { page: 0, region });
      const fill2 = HUMANOID_FILL[region.id];
      for (let y = 0; y < region.height; y += 1) {
        const shade = 1.1 - y / Math.max(1, region.height - 1) * 0.3;
        for (let x = 0; x < region.width; x += 1) {
          const i = ((region.y + y) * atlas.width + region.x + x) * 4;
          image.rgba[i] = clamp(fill2.r * shade);
          image.rgba[i + 1] = clamp(fill2.g * shade);
          image.rgba[i + 2] = clamp(fill2.b * shade);
          image.rgba[i + 3] = 255;
        }
      }
    }
    return { pages: [{ atlas, image }], regions };
  }
  function applyHumanoidAtlas(scene, atlas) {
    const skins = scene.skins.map((skin) => ({
      id: skin.id,
      attachments: skin.attachments.map((attachment2) => {
        const key = attachment2.atlasKey ?? attachment2.id;
        const ref = atlas.regions.get(key);
        if (ref === void 0) return attachment2;
        return atlasAttachment(attachment2, ref.region, ref.page);
      })
    }));
    return createRenderScene(scene.slots, skins);
  }
  function sampleHumanoid2DAtlasPackets(compiled2, pose2, atlas) {
    if (pose2.skeleton !== compiled2.skeleton) throw new Error("pose");
    const fk2 = new Float32Array(compiled2.skeleton.boneCount * 12);
    evaluateFk(fk2, compiled2, pose2, compiled2.skeleton.boneCount);
    return buildRenderPackets(applyHumanoidAtlas(buildHumanoid2DScene(compiled2, fk2), atlas));
  }
  function atlasAttachment(attachment2, region, page) {
    const mesh = attachment2.mesh;
    const bounds2 = mesh.bounds ?? { x: 0, y: 0, width: 1, height: 1 };
    const width = Math.max(1e-6, bounds2.width);
    const height = Math.max(1e-6, bounds2.height);
    const uvs = new Float32Array(mesh.positions.length / 2 * 2);
    for (let v = 0; v < mesh.positions.length / 2; v += 1) {
      const localU = (mesh.positions[v * 2] - bounds2.x) / width;
      const localV = (mesh.positions[v * 2 + 1] - bounds2.y) / height;
      uvs[v * 2] = (1 + localU * (region.width - 2)) / region.width;
      uvs[v * 2 + 1] = (1 + localV * (region.height - 2)) / region.height;
    }
    const nextMesh = { ...mesh, uvs };
    return {
      ...attachment2,
      mesh: nextMesh,
      material: {
        kind: "atlas",
        page,
        region,
        tint: { r: 1, g: 1, b: 1, a: 1 },
        filter: "linear"
      }
    };
  }
  function clamp(value) {
    const byte2 = Math.round(value * 255);
    if (byte2 < 0) return 0;
    if (byte2 > 255) return 255;
    return byte2;
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
      quads: (grouped.get(index) ?? []).map((edge) => quad2(edge, width))
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
      const cross4 = (positions[b * 2] - ax) * (positions[c * 2 + 1] - ay) - (positions[b * 2 + 1] - ay) * (positions[c * 2] - ax);
      const turn = cross4 < 0 ? -1 : 1;
      add8(nets, a, b, turn);
      add8(nets, b, c, turn);
      add8(nets, c, a, turn);
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
  function add8(nets, from, to, turn) {
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
  function quad2(edge, width) {
    const dx = edge.x1 - edge.x0;
    const dy = edge.y1 - edge.y0;
    const length6 = Math.hypot(dx, dy) || 1;
    const nx = dy / length6;
    const ny = -dx / length6;
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

  // preview/raster.ts
  var buffer = {
    width: 0,
    height: 0,
    pixels: null,
    depth: new Float32Array(0)
  };
  function beginFrame(width, height, pixels, background) {
    if (width <= 0 || height <= 0) throw new Error("size");
    if (pixels.length !== width * height * 4) throw new Error("pixels");
    if (buffer.width !== width || buffer.height !== height) {
      buffer.width = width;
      buffer.height = height;
      buffer.depth = new Float32Array(width * height);
    }
    buffer.pixels = pixels;
    buffer.depth.fill(Number.POSITIVE_INFINITY);
    pixels.fill(0);
    for (let i = 0; i < width * height; i += 1) {
      pixels[i * 4] = background[0];
      pixels[i * 4 + 1] = background[1];
      pixels[i * 4 + 2] = background[2];
      pixels[i * 4 + 3] = 255;
    }
    return { width, height, pixels, depth: buffer.depth };
  }
  function barycentric(ax, ay, bx, by, cx, cy) {
    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    return Math.abs(denom) <= 1e-8 ? null : { denom };
  }
  function bounds(surface, ax, ay, bx, by, cx, cy) {
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(surface.width - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(surface.height - 1, Math.ceil(Math.max(ay, by, cy)));
    return minX > maxX || minY > maxY ? null : { minX, maxX, minY, maxY };
  }
  function flatTriangle(surface, point, z, color, depthTest = true) {
    const [ax, ay, bx, by, cx, cy] = point;
    const basis = barycentric(ax, ay, bx, by, cx, cy);
    const box = bounds(surface, ax, ay, bx, by, cx, cy);
    if (basis === null || box === null) return;
    const { denom } = basis;
    const { width, pixels, depth } = surface;
    for (let y = box.minY; y <= box.maxY; y += 1) {
      for (let x = box.minX; x <= box.maxX; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
        const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
        if (w0 < -1e-6 || w1 < -1e-6 || 1 - w0 - w1 < -1e-6) continue;
        const pixel = y * width + x;
        if (depthTest && z >= depth[pixel]) continue;
        pixels[pixel * 4] = color[0];
        pixels[pixel * 4 + 1] = color[1];
        pixels[pixel * 4 + 2] = color[2];
        pixels[pixel * 4 + 3] = 255;
        if (depthTest) depth[pixel] = z;
      }
    }
  }
  function shadedTriangle(surface, point, z, shade, depthTest = true) {
    const [ax, ay, bx, by, cx, cy] = point;
    const basis = barycentric(ax, ay, bx, by, cx, cy);
    const box = bounds(surface, ax, ay, bx, by, cx, cy);
    if (basis === null || box === null) return;
    const { denom } = basis;
    const { width, pixels, depth } = surface;
    const [za, zb, zc] = z;
    for (let y = box.minY; y <= box.maxY; y += 1) {
      for (let x = box.minX; x <= box.maxX; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
        const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
        if (w0 < -1e-6 || w1 < -1e-6 || 1 - w0 - w1 < -1e-6) continue;
        const pixel = y * width + x;
        const value = w0 * za + w1 * zb + (1 - w0 - w1) * zc;
        if (depthTest && value >= depth[pixel]) continue;
        const color = shade(px, py);
        if (color === null) continue;
        pixels[pixel * 4] = color[0];
        pixels[pixel * 4 + 1] = color[1];
        pixels[pixel * 4 + 2] = color[2];
        pixels[pixel * 4 + 3] = 255;
        if (depthTest) depth[pixel] = value;
      }
    }
  }

  // preview/webgl2.ts
  var VERT = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
in vec4 a_color;
out vec2 v_uv;
out vec4 v_color;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}`;
  var FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
uniform sampler2D u_atlas;
uniform sampler2D u_mask;
uniform bool u_useAtlas;
uniform bool u_useMask;
uniform vec2 u_res;
out vec4 outColor;
void main() {
  vec4 c = u_useAtlas ? texture(u_atlas, v_uv) * v_color : v_color;
  if (u_useMask) {
    vec2 muv = vec2(gl_FragCoord.x / u_res.x, 1.0 - gl_FragCoord.y / u_res.y);
    if (texture(u_mask, muv).r < 0.5) discard;
  }
  outColor = c;
}`;
  var PacketWebGLRenderer = class {
    canvas;
    gl;
    program;
    vao;
    vbo;
    ibo;
    edgeVao;
    edgeVbo;
    atlasTextures = [];
    mask;
    ranges = [];
    edgeRanges = [];
    uRes;
    uUseAtlas;
    uUseMask;
    lastFill = new Float32Array(0);
    stats = { packets: 0, vertices: 0, edgeVertices: 0, error: 0, viewport: [], uRes: [], uScale: 0, uOrigin: [], buffer: [], scissor: false, scissorBox: [] };
    constructor() {
      this.canvas = document.createElement("canvas");
      const gl = this.canvas.getContext("webgl2", { alpha: false, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
      if (gl === null) throw new Error("webgl2");
      this.gl = gl;
      this.program = program(gl);
      this.vao = vao(gl);
      this.vbo = buffer2(gl);
      this.ibo = buffer2(gl);
      this.edgeVao = vao(gl);
      this.edgeVbo = buffer2(gl);
      for (let i = 0; i < 4; i += 1) this.atlasTextures.push(texture(gl));
      this.mask = texture(gl);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 8);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bindVertexArray(this.edgeVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeVbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 8);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
      gl.bindVertexArray(null);
      gl.useProgram(this.program);
      this.uRes = loc(gl, this.program, "u_res");
      this.uUseAtlas = loc(gl, this.program, "u_useAtlas");
      this.uUseMask = loc(gl, this.program, "u_useMask");
      gl.uniform1i(loc(gl, this.program, "u_atlas"), 0);
      gl.uniform1i(loc(gl, this.program, "u_mask"), 1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
    }
    render(packets, atlas, frame, width, height, mask) {
      const gl = this.gl;
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(92 / 255, 92 / 255, 92 / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.uploadAtlas(atlas);
      if (mask !== null) this.uploadMask(mask, width, height);
      gl.useProgram(this.program);
      gl.uniform2f(this.uRes, width, height);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.mask);
      let vertices = 0;
      let edgeVertices = 0;
      for (const packet of packets) {
        const count = packet.vertices.length / 2;
        const ref = atlas.regions.get(packet.atlasKey);
        const region = ref?.region;
        const page = ref === void 0 ? void 0 : atlas.pages[ref.page];
        const fill2 = new Float32Array(count * 8);
        for (let v = 0; v < count; v += 1) {
          const px = packet.vertices[v * 2] * frame.scale + frame.originX;
          const py = frame.originY - packet.vertices[v * 2 + 1] * frame.scale;
          fill2[v * 8] = px / width * 2 - 1;
          fill2[v * 8 + 1] = 1 - py / height * 2;
          const localU = packet.uvs[v * 2] ?? 0;
          const localV = packet.uvs[v * 2 + 1] ?? 0;
          fill2[v * 8 + 2] = region === void 0 || page === void 0 ? localU : (region.x + localU * region.width) / page.atlas.width;
          fill2[v * 8 + 3] = region === void 0 || page === void 0 ? localV : (region.y + localV * region.height) / page.atlas.height;
          fill2[v * 8 + 4] = (packet.colors[v * 4] ?? 255) / 255;
          fill2[v * 8 + 5] = (packet.colors[v * 4 + 1] ?? 255) / 255;
          fill2[v * 8 + 6] = (packet.colors[v * 4 + 2] ?? 255) / 255;
          fill2[v * 8 + 7] = (packet.colors[v * 4 + 3] ?? 255) / 255;
        }
        this.lastFill = fill2;
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, fill2, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(packet.indices), gl.DYNAMIC_DRAW);
        if (ref !== void 0 && page !== void 0) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this.atlasTextures[ref.page]);
        }
        gl.uniform1i(this.uUseAtlas, ref !== void 0 && page !== void 0 && packet.atlasPage >= 0 ? 1 : 0);
        gl.uniform1i(this.uUseMask, packet.mask !== null && mask !== null ? 1 : 0);
        gl.drawElements(gl.TRIANGLES, packet.indices.length, gl.UNSIGNED_SHORT, 0);
        vertices += count;
        const edge = [];
        const seen = /* @__PURE__ */ new Set();
        for (let t = 0; t < packet.indices.length; t += 3) {
          for (let e = 0; e < 3; e += 1) {
            const a = packet.indices[t + e];
            const b = packet.indices[t + (e + 1) % 3];
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            const key = `${lo}:${hi}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (packet.seam[lo] === 1 && packet.seam[hi] === 1) continue;
            const lx = (packet.vertices[lo * 2] * frame.scale + frame.originX) / width * 2 - 1;
            const ly = 1 - (frame.originY - packet.vertices[lo * 2 + 1] * frame.scale) / height * 2;
            const hx = (packet.vertices[hi * 2] * frame.scale + frame.originX) / width * 2 - 1;
            const hy = 1 - (frame.originY - packet.vertices[hi * 2 + 1] * frame.scale) / height * 2;
            edge.push(
              lx,
              ly,
              0,
              0,
              0.08,
              0.08,
              0.08,
              1,
              hx,
              hy,
              0,
              0,
              0.08,
              0.08,
              0.08,
              1
            );
          }
        }
        if (edge.length > 0) {
          gl.bindVertexArray(this.edgeVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeVbo);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(edge), gl.DYNAMIC_DRAW);
          gl.uniform1i(this.uUseAtlas, 0);
          gl.uniform1i(this.uUseMask, 0);
          gl.drawArrays(gl.LINES, 0, edge.length / 8);
          edgeVertices += edge.length / 8;
        }
      }
      gl.bindVertexArray(null);
      this.stats.packets = packets.length;
      this.stats.vertices = vertices;
      this.stats.edgeVertices = edgeVertices;
      this.stats.error = gl.getError();
      this.stats.viewport = Array.from(gl.getParameter(gl.VIEWPORT));
      this.stats.uRes = Array.from(gl.getUniform(this.program, this.uRes) ?? []);
      this.stats.buffer = [gl.drawingBufferWidth, gl.drawingBufferHeight];
      this.stats.scissor = gl.isEnabled(gl.SCISSOR_TEST);
      this.stats.scissorBox = Array.from(gl.getParameter(gl.SCISSOR_BOX));
    }
    uploadAtlas(atlas) {
      const gl = this.gl;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      for (let i = 0; i < atlas.pages.length && i < this.atlasTextures.length; i += 1) {
        const page = atlas.pages[i];
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.atlasTextures[i]);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          page.atlas.width,
          page.atlas.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          page.image.rgba
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
    }
    uploadMask(mask, width, height) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.mask);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, mask);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
  };
  function program(gl) {
    const vertex = shader(gl, gl.VERTEX_SHADER, VERT);
    const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAG);
    const result = gl.createProgram();
    if (result === null) throw new Error("program");
    gl.attachShader(result, vertex);
    gl.attachShader(result, fragment);
    gl.bindAttribLocation(result, 0, "a_pos");
    gl.bindAttribLocation(result, 1, "a_uv");
    gl.bindAttribLocation(result, 2, "a_color");
    gl.linkProgram(result);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result) ?? "link");
    return result;
  }
  function shader(gl, kind, source) {
    const result = gl.createShader(kind);
    if (result === null) throw new Error("shader");
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result) ?? "compile");
    return result;
  }
  function vao(gl) {
    const result = gl.createVertexArray();
    if (result === null) throw new Error("vao");
    return result;
  }
  function buffer2(gl) {
    const result = gl.createBuffer();
    if (result === null) throw new Error("buffer");
    return result;
  }
  function texture(gl) {
    const result = gl.createTexture();
    if (result === null) throw new Error("texture");
    return result;
  }
  function loc(gl, program2, name) {
    const result = gl.getUniformLocation(program2, name);
    if (result === null) throw new Error("uniform");
    return result;
  }

  // preview/main.ts
  var HEIGHT = 1.8;
  var FRONT_VIEW = 90;
  var FACING = 1;
  var STEP = 5;
  function renderMode() {
    const mode = new URLSearchParams(window.location.search).get("mode");
    if (mode === "2d" || mode === "volume" || mode === "webgl" || mode === "flat" || mode === "texture") return mode;
    return "webgl";
  }
  function volumeView() {
    const raw = Number(new URLSearchParams(window.location.search).get("view") ?? FRONT_VIEW);
    if (!Number.isFinite(raw)) return FRONT_VIEW;
    return (Math.round(raw) % 360 + 360) % 360;
  }
  var FINGER_LABEL = {
    thumb: "\u62C7\u6307",
    index: "\u793A\u6307",
    middle: "\u4E2D\u6307",
    ring: "\u65E0\u540D\u6307",
    pinky: "\u5C0F\u6307"
  };
  function fingerUi(name) {
    const match = /^(thumb|index|middle|ring|pinky)([123])([LR])$/.exec(name);
    if (match === null) return { group: "\u624B\u6307", label: name };
    const side = match[3] === "L" ? "\u5DE6\u624B" : "\u53F3\u624B";
    const segment = match[1] === "thumb" ? match[2] === "1" ? "\u8FD1\u8282" : "\u8FDC\u8282" : match[2] === "1" ? "\u8FD1\u8282" : match[2] === "2" ? "\u4E2D\u8282" : "\u8FDC\u8282";
    return { group: `${side} \xB7 \u624B\u6307`, label: `${FINGER_LABEL[match[1]]} ${segment}` };
  }
  var BONE_UI = {
    pelvis: { group: "\u8EAF\u5E72", label: "\u9AA8\u76C6" },
    spine: { group: "\u8EAF\u5E72", label: "\u810A\u67F1" },
    chest: { group: "\u8EAF\u5E72", label: "\u80F8" },
    clavicleL: { group: "\u5DE6\u80A9", label: "\u9501\u9AA8" },
    clavicleR: { group: "\u53F3\u80A9", label: "\u9501\u9AA8" },
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
  var humanoidAtlas = createHumanoidAtlas();
  var pose = createPose(humanoid.skeleton);
  async function loadAtlas() {
    try {
      const name = new URLSearchParams(window.location.search).get("atlas") ?? "base";
      const meta = await fetch(`atlas/${name}.json`, { cache: "no-cache" }).then((response) => {
        if (!response.ok) throw new Error("atlas");
        return response.json();
      });
      const metas = meta.pages ?? [meta];
      const pages = [];
      const regions = /* @__PURE__ */ new Map();
      for (let page = 0; page < metas.length; page += 1) {
        const pageMeta = metas[page];
        const source = pageMeta.image ?? `${name}.png`;
        const image = await new Promise((resolve, reject) => {
          const element = new Image();
          element.onload = () => resolve(element);
          element.onerror = () => reject(new Error("atlas image"));
          element.src = `atlas/${source}`;
        });
        const canvas2 = document.createElement("canvas");
        canvas2.width = pageMeta.page.width;
        canvas2.height = pageMeta.page.height;
        const context = canvas2.getContext("2d");
        if (context === null) throw new Error("atlas 2d");
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas2.width, canvas2.height).data;
        pages.push({
          atlas: {
            width: pageMeta.page.width,
            height: pageMeta.page.height,
            padding: pageMeta.padding,
            pma: pageMeta.page.pma,
            regions: pageMeta.regions
          },
          image: {
            width: canvas2.width,
            height: canvas2.height,
            rgba: new Uint8Array(data.buffer.slice(0)),
            pma: pageMeta.page.pma
          }
        });
        for (const region of pageMeta.regions) regions.set(region.id, { page, region });
      }
      humanoidAtlas = { pages, regions };
      window.__atlasPages = pages.length;
      draw();
    } catch {
    }
  }
  void loadAtlas();
  var fk = new Float32Array(humanoid.skeleton.boneCount * 12);
  var controls = buildControls(compiled);
  var tie = drawOrder(new Array(compiled.slots.slots.length), compiled.slots, FACING);
  var restFrame = contain(projectParts(sample2(compiled, pose, fk), FRONT_VIEW));
  var rest2DBounds = boundsOfPackets(sampleHumanoid2DAtlasPackets(compiled, pose, humanoidAtlas));
  var sliders = /* @__PURE__ */ new Map();
  var readouts = /* @__PURE__ */ new Map();
  var texturesReady = renderMode() !== "texture";
  mountPose(panel);
  new ResizeObserver(() => draw()).observe(canvas.parentElement ?? canvas);
  if (renderMode() === "texture") {
    void loadGrayTextures().then(() => {
      texturesReady = true;
      draw();
    }).catch((error) => showLoadError(error));
  } else {
    texturesReady = true;
    requestAnimationFrame(() => draw());
  }
  function showLoadError(error) {
    const stage = canvas.parentElement;
    if (stage === null) return;
    const note = document.createElement("pre");
    note.className = "error";
    note.textContent = `${error instanceof Error ? error.message : String(error)}

\u7EB9\u7406\u662F\u6309\u7F51\u683C\u9010\u4E09\u89D2\u5F62\u751F\u6210\u7684\u3002\u5148\u91CD\u5EFA\uFF1Apnpm --dir preview run build\uFF08\u6216\u5206\u6B65 build:engine / textures / bundle\uFF09\u3002`;
    stage.append(note);
  }
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
      slider.dataset.bone = control.bone;
      slider.dataset.axis = control.axis;
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
  async function fetchWithRetry(url, attempts = 4) {
    let last = new Error(`\u53D6\u4E0D\u5230 ${url}`);
    for (let i = 0; i < attempts; i += 1) {
      try {
        const response = await fetch(url);
        if (response.ok) return response;
        last = new Error(`${url} \u8FD4\u56DE ${response.status}`);
      } catch (error) {
        last = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 80 * (i + 1)));
    }
    throw last instanceof Error ? last : new Error(String(last));
  }
  async function loadGrayTextures() {
    const response = await fetchWithRetry("./textures/manifest.json");
    const manifest = await response.json();
    const packed = await fetchWithRetry("./textures/packed.bin");
    const bytes = new Uint8Array(await packed.arrayBuffer());
    const total = manifest.parts.reduce((sum, part) => sum + part.count, 0);
    if (bytes.length !== total) {
      throw new Error(`\u7EB9\u7406\u5305\u4E0E\u6E05\u5355\u5BF9\u4E0D\u4E0A\uFF1Apacked.bin ${bytes.length} \u5B57\u8282\uFF0C\u6E05\u5355 ${total} \u5F20`);
    }
    const byId = new Map(compiled.meshes.meshes.map((mesh) => [mesh.partId, mesh]));
    let offset = 0;
    for (const part of manifest.parts) {
      const mesh = byId.get(part.partId);
      if (mesh === void 0) throw new Error(`\u7EB9\u7406\u6E05\u5355\u91CC\u6709\u672A\u77E5\u90E8\u4EF6\uFF1A${part.partId}`);
      const triangles = mesh.indices.length / 3;
      if (triangles !== part.count) {
        throw new Error(
          `\u7EB9\u7406\u4E0E\u7F51\u683C\u5BF9\u4E0D\u4E0A\uFF1A${part.partId} \u6E05\u5355 ${part.count} \u5F20\uFF0C\u7F51\u683C ${triangles} \u4E2A\u4E09\u89D2\u5F62`
        );
      }
      const textures = [];
      for (let i = 0; i < part.count; i += 1) {
        const gray = bytes[offset + i];
        const rgb = new Uint8Array(manifest.edge * manifest.edge * 3);
        rgb.fill(gray);
        textures.push({ width: manifest.edge, height: manifest.edge, rgb });
      }
      offset += part.count;
      mesh.textures = textures;
    }
  }
  var DEPTH_BIAS = 1e-4;
  var VIEW_ANGLE = FRONT_VIEW * Math.PI / 180;
  var VIEW_COS = Math.cos(VIEW_ANGLE);
  var VIEW_SIN = Math.sin(VIEW_ANGLE);
  var STROKE_RGB = [20, 20, 20];
  var BACKGROUND_RGB = [92, 92, 92];
  function draw() {
    if (!texturesReady) return;
    const stage = canvas.parentElement;
    const cssWidth = stage?.clientWidth ?? window.innerWidth;
    const cssHeight = stage?.clientHeight ?? window.innerHeight;
    if (cssWidth < 2 || cssHeight < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    applyPose();
    if (renderMode() === "2d") {
      draw2D(width, height);
      return;
    }
    if (renderMode() === "volume") {
      drawVolume(width, height);
      return;
    }
    if (renderMode() === "webgl") {
      drawWebGL(width, height);
      return;
    }
    const sampled = sample2(compiled, pose, fk);
    const projected = projectParts(sampled, FRONT_VIEW);
    const filled = fillProjected(
      projected,
      compiled.parts.parts.map((part) => part.fill)
    );
    const stroked = strokeContours(filled, true);
    const order = depthOrder(new Array(projected.length), projected, tie);
    const frame = framing(projected, width, height);
    const depths = sampled.map((part, index) => projected[index].depths ?? vertexDepths(part.positions));
    const rawIndices = sampled.map((part) => part.indices);
    const partIndex = new Map(projected.map((part, index) => [part.partId, index]));
    const image = ctx.getImageData(0, 0, width, height);
    const surface = beginFrame(width, height, image.data, BACKGROUND_RGB);
    if (renderMode() === "texture") {
      paintTextures(textureProjected(compiled, projected), order, frame, surface, depths, rawIndices, partIndex);
    } else {
      paintFills(filled, order, frame, surface, depths, rawIndices, partIndex);
    }
    paintStrokes(stroked, order, frame, surface, projected, depths, partIndex);
    ctx.putImageData(image, 0, 0);
  }
  function vertexDepths(positions) {
    const out = new Float32Array(positions.length / 3);
    for (let v = 0; v < out.length; v += 1) {
      const x = positions[v * 3];
      const z = positions[v * 3 + 2];
      out[v] = z * VIEW_COS - x * VIEW_SIN;
    }
    return out;
  }
  function buildShoulderMask(packets, frame, width, height) {
    const torso = packets.find((packet) => packet.partId === "torso");
    if (torso === void 0) return null;
    const torsoMask = rasterizeMask(torso, width, height, {
      scale: frame.scale,
      originX: frame.originX,
      originY: frame.originY
    });
    const mask = new Uint8Array(width * height);
    mask.fill(255);
    evaluateFk(fk, compiled, pose, compiled.skeleton.boneCount);
    const radius = 0.1 * frame.scale;
    for (const name of ["upperArmL", "upperArmR"]) {
      const bone = findBone(compiled.skeleton, name);
      if (bone < 0) continue;
      const i = bone * 12;
      const cx = frame.originX + fk[i + 11] * frame.scale;
      const cy = frame.originY - fk[i + 10] * frame.scale;
      const minX = Math.max(0, Math.floor(cx - radius));
      const maxX = Math.min(width - 1, Math.ceil(cx + radius));
      const minY = Math.max(0, Math.floor(cy - radius));
      const maxY = Math.min(height - 1, Math.ceil(cy + radius));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          if (dx * dx + dy * dy > radius * radius) continue;
          if (torsoMask[y * width + x] !== 255) continue;
          mask[y * width + x] = 0;
        }
      }
    }
    return mask;
  }
  function draw2D(width, height) {
    if (webglRenderer !== null) webglRenderer.canvas.style.display = "none";
    canvas.style.visibility = "visible";
    const supersample = width * height <= 9e5 ? 2 : 1;
    const bufferWidth = width * supersample;
    const bufferHeight = height * supersample;
    const pixels = new Uint8ClampedArray(bufferWidth * bufferHeight * 4);
    const packets = sampleHumanoid2DAtlasPackets(compiled, pose, humanoidAtlas);
    const bounds2 = boundsOfPackets(packets);
    const frame = framing2DBounds(bounds2, bufferWidth, bufferHeight);
    const surface = beginFrame(bufferWidth, bufferHeight, pixels, BACKGROUND_RGB);
    const transform = { scale: frame.scale, originX: frame.originX, originY: frame.originY };
    const torso = packets.find((packet) => packet.partId === "torso");
    const masks = /* @__PURE__ */ new Map();
    const shoulderMask = buildShoulderMask(packets, frame, bufferWidth, bufferHeight);
    if (shoulderMask !== null) masks.set("shoulder", shoulderMask);
    paintPackets(surface, packets, {
      transform,
      atlas: { pages: humanoidAtlas.pages.map((page) => page.image), regions: humanoidAtlas.regions },
      masks,
      supersample,
      fillMode: "triangle",
      edges: "triangles",
      edgeWidthPx: 1
    });
    const image = ctx.getImageData(0, 0, width, height);
    downsample(pixels, bufferWidth, supersample, image.data, width, height);
    ctx.putImageData(image, 0, 0);
  }
  var webglRenderer = null;
  function paintWebGL(packets, frame, width, height, mask) {
    if (webglRenderer === null) {
      try {
        webglRenderer = new PacketWebGLRenderer();
        webglRenderer.canvas.style.position = "absolute";
        webglRenderer.canvas.style.inset = "0";
        webglRenderer.canvas.style.display = "none";
        webglRenderer.canvas.style.width = "100%";
        webglRenderer.canvas.style.height = "100%";
        canvas.parentElement?.append(webglRenderer.canvas);
      } catch (error) {
        ;
        window.__webglError = String(error);
        return false;
      }
    }
    webglRenderer.render(packets, humanoidAtlas, frame, width, height, mask);
    webglRenderer.canvas.style.display = "block";
    canvas.style.visibility = "hidden";
    return true;
  }
  function drawWebGL(width, height) {
    const all = sampleHumanoid2DAtlasPackets(compiled, pose, humanoidAtlas);
    const params = new URLSearchParams(window.location.search);
    const only = params.get("only");
    let packets = only === null ? all : all.filter((packet) => packet.partId === only);
    if (params.get("nobridge") === "1") packets = packets.filter((packet) => packet.partId !== "shoulderL" && packet.partId !== "shoulderR");
    if (params.get("debug") === "1" && all[0] !== void 0) {
      const base = all[0];
      packets = [{
        ...base,
        partId: "debug",
        vertices: Float32Array.from([-1, -1, 1, -1, 1, 1, -1, 1]),
        uvs: new Float32Array(8),
        indices: Uint16Array.from([0, 1, 2, 0, 2, 3]),
        colors: new Uint8Array(16).fill(255),
        atlasPage: -1,
        mask: null,
        depth: new Float32Array(4),
        bounds: { x: -1, y: 0, width: 2, height: 2 }
      }];
    }
    const bounds2 = boundsOfPackets(packets);
    const frame = framing2DBounds(bounds2, width, height);
    const transform = { scale: frame.scale, originX: frame.originX, originY: frame.originY };
    const mask = new URLSearchParams(window.location.search).get("nomask") === "1" ? null : buildShoulderMask(packets, frame, width, height);
    if (!paintWebGL(packets, frame, width, height, mask)) draw2D(width, height);
  }
  function drawVolume(width, height) {
    const sampled = sample2(compiled, pose, fk);
    const view = volumeView();
    const projected = projectParts(sampled, view).filter(
      (part) => part.partId !== "handL" && part.partId !== "handR"
    );
    const hands = [
      ...buildHandVolumeParts(compiled, fk, view, "L"),
      ...buildHandVolumeParts(compiled, fk, view, "R")
    ];
    const packets = buildVolumetricPackets([...projected, ...hands]);
    const bounds2 = boundsOfPackets(packets);
    const frame = framing2DBounds(bounds2, width, height);
    if (paintWebGL(packets, frame, width, height, null)) return;
    const image = ctx.getImageData(0, 0, width, height);
    const surface = beginFrame(width, height, image.data, BACKGROUND_RGB);
    paintPackets(surface, packets, {
      transform: { scale: frame.scale, originX: frame.originX, originY: frame.originY },
      fillMode: "triangle",
      edges: "triangles",
      edgeWidthPx: 1,
      supersample: 1
    });
    ctx.putImageData(image, 0, 0);
  }
  function downsample(source, sourceWidth, factor, target, width, height) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let sy = 0; sy < factor; sy += 1) {
          for (let sx = 0; sx < factor; sx += 1) {
            const i = ((y * factor + sy) * sourceWidth + (x * factor + sx)) * 4;
            r += source[i];
            g += source[i + 1];
            b += source[i + 2];
          }
        }
        const n = factor * factor;
        const o = (y * width + x) * 4;
        target[o] = r / n;
        target[o + 1] = g / n;
        target[o + 2] = b / n;
        target[o + 3] = 255;
      }
    }
  }
  function boundsOfPackets(packets) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const packet of packets) {
      for (let i = 0; i < packet.vertices.length; i += 2) {
        minX = Math.min(minX, packet.vertices[i]);
        maxX = Math.max(maxX, packet.vertices[i]);
        minY = Math.min(minY, packet.vertices[i + 1]);
        maxY = Math.max(maxY, packet.vertices[i + 1]);
      }
    }
    return { minX, maxX, minY, maxY };
  }
  function framing2DBounds(bounds2, width, height) {
    const current = fit(containBounds(bounds2), width, height);
    const baseline = fit(containBounds(rest2DBounds), width, height);
    const scale7 = Math.min(current.scale, baseline.scale);
    const cx = (rest2DBounds.minX + rest2DBounds.maxX) / 2;
    const cy = (rest2DBounds.minY + rest2DBounds.maxY) / 2;
    return {
      ...containBounds(bounds2),
      scale: scale7,
      originX: width / 2 - cx * scale7,
      originY: height / 2 + cy * scale7
    };
  }
  function containBounds(bounds2) {
    const spanX = Math.max(1e-4, bounds2.maxX - bounds2.minX);
    const spanY = Math.max(1e-4, bounds2.maxY - bounds2.minY);
    return {
      minX: bounds2.minX - spanX * 0.12,
      maxX: bounds2.maxX + spanX * 0.12,
      minY: bounds2.minY - spanY * 0.06,
      maxY: bounds2.maxY + spanY * 0.06
    };
  }
  function paintFills(parts, order, frame, surface, depths, rawIndices, partIndex) {
    const byId = new Map(parts.map((part) => [part.partId, part]));
    for (const id of order) {
      const part = byId.get(id);
      if (part === void 0) continue;
      const index = partIndex.get(id);
      if (index === void 0) continue;
      const depth = depths[index];
      const raw = rawIndices[index];
      const positions = part.positions;
      const indices = part.indices;
      const color = [
        Math.round(part.fill.r * 255),
        Math.round(part.fill.g * 255),
        Math.round(part.fill.b * 255)
      ];
      for (let t = 0; t < indices.length; t += 3) {
        if (!isArmPart(part.partId) && backFacing(positions, raw, t)) continue;
        const ia = indices[t];
        const ib = indices[t + 1];
        const ic = indices[t + 2];
        shadedTriangle(
          surface,
          [
            frame.originX + positions[ia * 2] * frame.scale,
            frame.originY - positions[ia * 2 + 1] * frame.scale,
            frame.originX + positions[ib * 2] * frame.scale,
            frame.originY - positions[ib * 2 + 1] * frame.scale,
            frame.originX + positions[ic * 2] * frame.scale,
            frame.originY - positions[ic * 2 + 1] * frame.scale
          ],
          [depth[ia], depth[ib], depth[ic]],
          () => color
        );
      }
    }
  }
  function paintTextures(parts, order, frame, surface, depths, rawIndices, partIndex) {
    const uv = new Float32Array(2);
    const corners = new Float32Array(6);
    const byId = new Map(parts.map((part) => [part.partId, part]));
    for (let oi = 0; oi < order.length; oi += 1) {
      const id = order[oi];
      const part = byId.get(id);
      if (part === void 0 || part.textures.length === 0) continue;
      const index = partIndex.get(id);
      if (index === void 0) continue;
      const partDepth = depths[index];
      const raw = rawIndices[index];
      const positions = part.positions;
      const indices = part.indices;
      for (let t = 0; t < indices.length; t += 3) {
        if (backFacing(positions, raw, t)) continue;
        const ia = indices[t];
        const ib = indices[t + 1];
        const ic = indices[t + 2];
        const ax = frame.originX + positions[ia * 2] * frame.scale;
        const ay = frame.originY - positions[ia * 2 + 1] * frame.scale;
        const bx = frame.originX + positions[ib * 2] * frame.scale;
        const by = frame.originY - positions[ib * 2 + 1] * frame.scale;
        const cx = frame.originX + positions[ic * 2] * frame.scale;
        const cy = frame.originY - positions[ic * 2 + 1] * frame.scale;
        const texture2 = part.textures[part.triangleTexture[t / 3]];
        if (texture2 === void 0) continue;
        corners.set(part.uvs.subarray(t * 2, t * 2 + 6));
        shadedTriangle(
          surface,
          [ax, ay, bx, by, cx, cy],
          [partDepth[ia], partDepth[ib], partDepth[ic]],
          (px, py) => {
            triangleUv(uv, ax, ay, bx, by, cx, cy, px, py, corners);
            const color = sampleTexture(texture2, uv[0], uv[1]);
            return [Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255)];
          }
        );
      }
    }
  }
  function backFacing(positions, raw, t) {
    const a = raw[t];
    const b = raw[t + 1];
    const c = raw[t + 2];
    const ax = positions[a * 2];
    const ay = positions[a * 2 + 1];
    const bx = positions[b * 2];
    const by = positions[b * 2 + 1];
    const cx = positions[c * 2];
    const cy = positions[c * 2 + 1];
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) <= 0;
  }
  function paintStrokes(parts, order, frame, surface, projected, depths, partIndex) {
    const byId = new Map(parts.map((part) => [part.partId, part]));
    for (let oi = 0; oi < order.length; oi += 1) {
      const id = order[oi];
      const part = byId.get(id);
      if (part === void 0) continue;
      const index = partIndex.get(id);
      if (index === void 0) continue;
      const screen = projected[index].positions;
      const partDepth = depths[index];
      for (const quad3 of part.quads) {
        const z = quadDepth(quad3.positions, screen, partDepth) - DEPTH_BIAS;
        const q = quad3.indices;
        const points = quad3.positions;
        const at = (i) => [
          frame.originX + points[i * 2] * frame.scale,
          frame.originY - points[i * 2 + 1] * frame.scale
        ];
        const p0 = at(q[0]);
        const p1 = at(q[1]);
        const p2 = at(q[2]);
        const p3 = at(q[3]);
        const p4 = at(q[4]);
        const p5 = at(q[5]);
        flatTriangle(surface, [p0[0], p0[1], p1[0], p1[1], p2[0], p2[1]], z, STROKE_RGB, false);
        flatTriangle(surface, [p3[0], p3[1], p4[0], p4[1], p5[0], p5[1]], z, STROKE_RGB, false);
      }
    }
  }
  function quadDepth(quad3, screen, partDepth) {
    const cx = (quad3[0] + quad3[4]) / 2;
    const cy = (quad3[1] + quad3[5]) / 2;
    let best = Number.POSITIVE_INFINITY;
    let depth = 0;
    for (let v = 0; v < partDepth.length; v += 1) {
      const dx = screen[v * 2] - cx;
      const dy = screen[v * 2 + 1] - cy;
      const distance3 = dx * dx + dy * dy;
      if (distance3 < best) {
        best = distance3;
        depth = partDepth[v];
      }
    }
    return Number.isFinite(best) ? depth : 0;
  }
  function framing(parts, width, height) {
    const current = fit(contain(parts), width, height);
    const baseline = fit(restFrame, width, height);
    const scale7 = Math.min(current.scale, baseline.scale);
    const cx = (restFrame.minX + restFrame.maxX) / 2;
    const cy = (restFrame.minY + restFrame.maxY) / 2;
    return {
      ...restFrame,
      scale: scale7,
      originX: width / 2 - cx * scale7,
      originY: height / 2 + cy * scale7
    };
  }
  function applyPose() {
    for (const control of controls) {
      const slider = sliders.get(control.id);
      const radians = (slider === void 0 ? 0 : Number(slider.value)) * Math.PI / 180;
      const bone = findBone(humanoid.skeleton, control.bone);
      if (control.axis === "rotation") setPoseRotation(pose, bone, radians);
      else if (control.axis === "swing") setPoseSwing(pose, bone, radians);
      else setPoseTwist(pose, bone, radians);
    }
    const preset = new URLSearchParams(window.location.search).get("pose");
    if (preset !== null) {
      const bone = (name) => compiled.skeleton.name.indexOf(name);
      if (preset === "arm-behind") {
        setPoseSwing(pose, bone("upperArmL"), -Math.PI / 2);
        setPoseRotation(pose, bone("lowerArmL"), 0.6);
      } else if (preset === "arm-across") {
        setPoseRotation(pose, bone("upperArmL"), 1.2);
        setPoseSwing(pose, bone("upperArmL"), 0.9);
        setPoseRotation(pose, bone("lowerArmL"), -1.6);
      } else if (preset === "cross-legs") {
        setPoseRotation(pose, bone("thighL"), 0.8);
        setPoseRotation(pose, bone("thighR"), -0.2);
      } else if (preset === "elbow120") {
        setPoseRotation(pose, bone("lowerArmL"), 2);
      } else if (preset === "wrist45") {
        setPoseRotation(pose, bone("handL"), 0.8);
      } else if (preset === "arm90") {
        setPoseSwing(pose, bone("upperArmL"), Math.PI / 2);
      } else if (preset === "tpose") {
        setPoseSwing(pose, bone("upperArmL"), Math.PI / 2);
        setPoseSwing(pose, bone("upperArmR"), Math.PI / 2);
      } else if (preset === "fingers") {
        for (const name of ["index1L", "index2L", "index3L", "middle1L", "middle2L", "middle3L"]) {
          setPoseRotation(pose, bone(name), 1.1);
        }
      }
    }
    applyClavicleFollow(pose, compiled);
  }
  function sample2(rig, current, rigFromBone) {
    evaluateFk(rigFromBone, rig, current, rig.skeleton.boneCount);
    return rig.meshes.meshes.map((mesh, index) => {
      const positions = new Float32Array(mesh.positions.length);
      skinMesh(positions, rig, rigFromBone, index, current);
      if (isArmPart(mesh.partId)) {
        return {
          partId: mesh.partId,
          positions,
          indices: mesh.indices,
          seam: mesh.seam,
          arm: armOutlineBones(rig, rigFromBone, mesh.partId)
        };
      }
      return { partId: mesh.partId, positions, indices: mesh.indices, seam: mesh.seam };
    });
  }
  function buildControls(rig) {
    const list = [];
    for (const joint of rig.joints) {
      const bone = BONE_NAMES[joint.bone];
      if (bone === void 0) continue;
      if (bone.startsWith("clavicle")) continue;
      const ui = BONE_UI[bone];
      addAxis(list, bone, ui, "rotation", 1, joint.rotation);
      addAxis(list, bone, ui, "swing", joint.swingSign, joint.swing);
      addAxis(list, bone, ui, "twist", joint.twistSign, joint.twist);
    }
    for (const joint of rig.joints) {
      if (BONE_NAMES[joint.bone] !== void 0) continue;
      const name = rig.skeleton.name[joint.bone];
      if (name === void 0 || !/^(thumb|index|middle|ring|pinky)[123][LR]$/.test(name)) continue;
      addAxis(list, name, fingerUi(name), "rotation", 1, joint.rotation);
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
  function fit(bounds2, width, height) {
    const scale7 = Math.min(width / (bounds2.maxX - bounds2.minX), height / (bounds2.maxY - bounds2.minY));
    const usedW = (bounds2.maxX - bounds2.minX) * scale7;
    const usedH = (bounds2.maxY - bounds2.minY) * scale7;
    return {
      ...bounds2,
      scale: scale7,
      originX: (width - usedW) / 2 - bounds2.minX * scale7,
      originY: (height - usedH) / 2 + bounds2.maxY * scale7
    };
  }
  function degrees(radians) {
    return Math.round(radians * 180 / Math.PI);
  }
  function formatDeg(value) {
    if (value < 0) return `\u2212${Math.abs(value)}\xB0`;
    if (value > 0) return `+${value}\xB0`;
    return "0\xB0";
  }
  window.__draw = draw;
  window.__webgl = () => webglRenderer !== null;
  Object.defineProperty(window, "__webglRenderer", { get: () => webglRenderer });
})();
