"use strict";
(() => {
  // packages/render-engine/src/view/project.ts
  var VIEW_COUNT = 360;
  var VIEW_STEP_DEG = 1;
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

  // packages/render-engine/src/mesh/strip.ts
  var TUBE_SIDES = 8;
  var S = Math.SQRT1_2;
  var RING_SIDE = [1, S, 0, -S, -1, -S, 0, S];
  var RING_LATERAL = [0, S, 1, S, 0, -S, -1, -S];

  // preview/mannequin.ts
  var MANNEQUIN_HEIGHT = 1.8;
  var FRONT_VIEW = 90;
  var CLAY = 0;
  var JOINT = 1;
  var REST_POSE = {
    shoulderFlexL: 0,
    shoulderAbdL: 0,
    shoulderRotL: 0,
    elbowL: 0,
    forearmL: 0,
    wristFlexL: 0,
    wristDevL: 0,
    shoulderFlexR: 0,
    shoulderAbdR: 0,
    shoulderRotR: 0,
    elbowR: 0,
    forearmR: 0,
    wristFlexR: 0,
    wristDevR: 0,
    hipFlexL: 0,
    hipAbdL: 0,
    hipRotL: 0,
    kneeL: 0,
    ankleFlexL: 0,
    ankleRollL: 0,
    hipFlexR: 0,
    hipAbdR: 0,
    hipRotR: 0,
    kneeR: 0,
    ankleFlexR: 0,
    ankleRollR: 0
  };
  function createMannequinMesh(height = MANNEQUIN_HEIGHT, pose = REST_POSE) {
    const body = measure(height);
    const mesh2 = new MeshBuilder();
    addTorso(mesh2, body);
    addHead(mesh2, body);
    addArm(mesh2, body, 1, pose.shoulderFlexL, pose.shoulderAbdL, pose.shoulderRotL, pose.elbowL, pose.forearmL, pose.wristFlexL, pose.wristDevL);
    addArm(mesh2, body, -1, pose.shoulderFlexR, pose.shoulderAbdR, pose.shoulderRotR, pose.elbowR, pose.forearmR, pose.wristFlexR, pose.wristDevR);
    const ankleL = addLeg(mesh2, body, 1, pose.hipFlexL, pose.hipAbdL, pose.hipRotL, pose.kneeL);
    const ankleR = addLeg(mesh2, body, -1, pose.hipFlexR, pose.hipAbdR, pose.hipRotR, pose.kneeR);
    addFoot(mesh2, body, pose.ankleFlexL, pose.ankleRollL, pose.hipRotL, ankleL, 1);
    addFoot(mesh2, body, pose.ankleFlexR, pose.ankleRollR, pose.hipRotR, ankleR, -1);
    return mesh2.build();
  }
  function measure(height) {
    const hipY = 0.5 * height;
    const thigh = 0.232 * height;
    const shin = 0.222 * height;
    return {
      height,
      headH: 0.125 * height,
      headW: 0.084 * height,
      headD: 0.096 * height,
      neckR: 0.024 * height,
      shoulderY: 0.828 * height,
      shoulderZ: 0.118 * height,
      hipY,
      hipZ: 0.06 * height,
      upper: 0.16 * height,
      fore: 0.142 * height,
      hand: 0.09 * height,
      thigh,
      shin,
      ankleY: hipY - thigh - shin,
      gap: 0.016 * height
    };
  }
  var MeshBuilder = class {
    xyz = [];
    quads = [];
    materials = [];
    material = CLAY;
    use(material) {
      this.material = material;
    }
    vertex(point) {
      const index = this.xyz.length / 3;
      this.xyz.push(point[0], point[1], point[2]);
      return index;
    }
    quad(a, b, c, d) {
      this.quads.push(a, b, c, d);
      this.materials.push(this.material);
    }
    get quadCount() {
      return this.quads.length / 4;
    }
    orient(fromQuad, inside) {
      for (let q = fromQuad; q < this.quadCount; q += 1) {
        const a = this.quads[q * 4];
        const b = this.quads[q * 4 + 1];
        const c = this.quads[q * 4 + 2];
        const d = this.quads[q * 4 + 3];
        const normal = quadNormal(this.xyz, a, b, c, d);
        if (normal === null) continue;
        const mid = centroid(this.xyz, a, b, c, d);
        const origin = inside(mid);
        if (dot(normal, sub(mid, origin)) >= 0) continue;
        if (d === a) {
          this.quads[q * 4 + 1] = c;
          this.quads[q * 4 + 2] = b;
        } else if (d === c) {
          this.quads[q * 4 + 1] = c;
          this.quads[q * 4 + 2] = b;
          this.quads[q * 4 + 3] = b;
        } else {
          this.quads[q * 4 + 1] = d;
          this.quads[q * 4 + 3] = b;
        }
      }
    }
    build() {
      return {
        positions: Float32Array.from(this.xyz),
        quads: Uint32Array.from(this.quads),
        materials: Uint8Array.from(this.materials)
      };
    }
  };
  function addTorso(mesh2, body) {
    const h = body.height;
    const shoulder = body.shoulderY;
    const hip = body.hipY;
    const waist = hip + 0.16 * h;
    const chest = shoulder - 0.08 * h;
    const stops = [
      { y: hip - 0.045 * h, z: 0.042 * h, x: 0.04 * h },
      { y: hip, z: 0.092 * h, x: 0.058 * h },
      { y: hip + 0.07 * h, z: 0.084 * h, x: 0.052 * h },
      { y: waist - 0.02 * h, z: 0.064 * h, x: 0.044 * h },
      { y: waist + 0.02 * h, z: 0.07 * h, x: 0.046 * h },
      { y: chest, z: 0.1 * h, x: 0.062 * h },
      { y: shoulder - 0.01 * h, z: 0.125 * h, x: 0.058 * h },
      { y: shoulder + 0.035 * h, z: 0.055 * h, x: 0.042 * h }
    ];
    mesh2.use(CLAY);
    addProfile(mesh2, stops, TUBE_SIDES);
    const bust = chest - 0.015 * h;
    mesh2.use(JOINT);
    addProfile(
      mesh2,
      [
        { y: bust - 6e-3 * h, z: 0.102 * h, x: 0.064 * h },
        { y: bust + 0.012 * h, z: 0.104 * h, x: 0.066 * h }
      ],
      TUBE_SIDES
    );
    addProfile(
      mesh2,
      [
        { y: waist - 0.014 * h, z: 0.072 * h, x: 0.05 * h },
        { y: waist + 0.014 * h, z: 0.072 * h, x: 0.05 * h }
      ],
      TUBE_SIDES
    );
    mesh2.use(CLAY);
  }
  function addHead(mesh2, body) {
    const top = body.height;
    const centerY = top - body.headH / 2;
    mesh2.use(CLAY);
    addEllipsoid(mesh2, [0, centerY, 0], [body.headD / 2, body.headH / 2, body.headW / 2], 1, TUBE_SIDES, TUBE_SIDES);
    const neckTop = centerY - body.headH * 0.42;
    const neckBase = body.shoulderY + 0.02 * body.height;
    mesh2.use(CLAY);
    addTube(
      mesh2,
      [
        [0, neckBase, 0],
        [0, (neckBase + neckTop) / 2, 0],
        [0, neckTop, 0]
      ],
      [body.neckR * 1.15, body.neckR, body.neckR * 0.92],
      circular,
      TUBE_SIDES
    );
    mesh2.use(JOINT);
    addTube(
      mesh2,
      [
        [0, neckBase - 6e-3 * body.height, 0],
        [0, neckBase + 8e-3 * body.height, 0]
      ],
      [body.neckR * 1.28, body.neckR * 1.28],
      circular,
      TUBE_SIDES
    );
    mesh2.use(CLAY);
  }
  function addArm(mesh2, body, side, flex, abd, rot, elbowAngle, forearm, wristFlex, wristDev) {
    const upperDir = shoulderDirection(side, flex, abd);
    const foreDir = flexForearm(upperDir, elbowAngle, rot);
    const twisted = handAxes(foreDir, rot + forearm);
    const flexed = bendToward(foreDir, twisted.up, wristFlex);
    const handDir = bendToward(flexed, twisted.front, wristDev);
    const basis = alignBasis(handDir, twisted.up, twisted.front);
    const root = [0, body.shoulderY, side * body.shoulderZ];
    const elbow = travel(root, upperDir, body.upper);
    const wrist = travel(elbow, foreDir, body.fore);
    band(mesh2, root, upperDir, 0.034 * body.height);
    segment(mesh2, travel(root, upperDir, body.gap), travel(elbow, upperDir, -body.gap * 0.6), 0.03 * body.height, 0.026 * body.height);
    band(mesh2, elbow, upperDir, 0.028 * body.height);
    segment(mesh2, travel(elbow, foreDir, body.gap * 0.7), travel(wrist, foreDir, -body.gap * 0.5), 0.024 * body.height, 0.02 * body.height);
    band(mesh2, wrist, foreDir, 0.02 * body.height);
    addHand(mesh2, body, wrist, handDir, basis.up, basis.front);
  }
  function addHand(mesh2, body, wrist, dir, up, front) {
    const palmLen = body.hand * 0.42;
    const fingerLen = body.hand - palmLen;
    const palmEnd = travel(wrist, dir, palmLen);
    mesh2.use(CLAY);
    addTube(
      mesh2,
      [wrist, midpoint(wrist, palmEnd), palmEnd],
      [0.02 * body.height, 0.026 * body.height, 0.022 * body.height],
      [0.012 * body.height, 0.011 * body.height, 0.01 * body.height],
      TUBE_SIDES
    );
    const fingerR = 7e-3 * body.height;
    for (let finger = 0; finger < 4; finger += 1) {
      const spread = (finger / 3 - 0.5) * 0.04 * body.height;
      const lift = (finger - 1.5) * 4e-3 * body.height;
      const root = add(add(palmEnd, mul(up, spread)), mul(front, lift));
      const tip = travel(add(root, mul(dir, -fingerR)), dir, fingerLen);
      addTube(mesh2, [root, tip], [fingerR, fingerR * 0.62], circular, TUBE_SIDES);
    }
    const thumbLen = body.hand * 0.28;
    const thumbDir = norm(add(add(mul(dir, 0.45), mul(up, -0.75)), mul(front, 0.35)));
    const thumbRoot = add(add(midpoint(wrist, palmEnd), mul(up, -0.016 * body.height)), mul(front, 6e-3 * body.height));
    const thumbTip = travel(thumbRoot, thumbDir, thumbLen);
    addTube(mesh2, [thumbRoot, thumbTip], [fingerR * 1.25, fingerR * 0.7], circular, TUBE_SIDES);
  }
  function addLeg(mesh2, body, side, flex, abd, rot, kneeAngle) {
    const hip = [0, body.hipY, side * body.hipZ];
    const thighDir = thighDirection(side, flex, abd);
    const knee = travel(hip, thighDir, body.thigh);
    const shinDir = kneeDirection(thighDir, kneeAngle, rot);
    const ankle = travel(knee, shinDir, body.shin);
    band(mesh2, travel(hip, thighDir, body.gap), thighDir, 0.046 * body.height);
    segment(mesh2, travel(hip, thighDir, body.gap * 1.8), travel(knee, thighDir, -body.gap), 0.046 * body.height, 0.034 * body.height);
    band(mesh2, knee, thighDir, 0.034 * body.height);
    segment(mesh2, travel(knee, shinDir, body.gap), travel(ankle, shinDir, -body.gap * 0.4), 0.032 * body.height, 0.022 * body.height);
    band(mesh2, ankle, shinDir, 0.022 * body.height);
    return ankle;
  }
  function addFoot(mesh2, body, pitch, roll, hipRot, ankle, side) {
    const length2 = 0.15 * body.height;
    const heel = -0.22 * length2;
    const width = 0.046 * body.height;
    const sole = body.ankleY;
    const yaw = side * (0.42 + hipRot);
    const inversion = side * roll;
    const stations = [
      { x: heel, y: 0.02 * body.height, rx: 0.018 * body.height, rz: width * 0.72 },
      { x: 0.02 * length2, y: 0.028 * body.height, rx: 0.024 * body.height, rz: width * 0.9 },
      { x: length2 * 0.5, y: 0.024 * body.height, rx: 0.02 * body.height, rz: width },
      { x: length2 * 0.82, y: 0.016 * body.height, rx: 0.014 * body.height, rz: width * 0.86 },
      { x: length2, y: 0.012 * body.height, rx: 0.01 * body.height, rz: width * 0.62 }
    ];
    const centers = stations.map((station) => yawFoot(ankle, station.x, station.y - sole, pitch, yaw));
    mesh2.use(CLAY);
    addTube(
      mesh2,
      centers,
      stations.map((station) => station.rx),
      stations.map((station) => station.rz),
      TUBE_SIDES,
      inversion
    );
    const toe = sub(yawFoot(ankle, 1, 0, pitch, yaw), ankle);
    const rolled = rollFrame(armFrame(toe), inversion);
    const last = stations[stations.length - 1];
    addFan(mesh2, centers[centers.length - 1], toe, rolled.side, rolled.front, last.rz, last.rx, TUBE_SIDES);
  }
  function addProfile(mesh2, samples, sides) {
    addTube(
      mesh2,
      samples.map((sample) => [0, sample.y, 0]),
      samples.map((sample) => sample.z),
      samples.map((sample) => sample.x),
      sides
    );
  }
  function segment(mesh2, from, to, radius0, radius1) {
    mesh2.use(CLAY);
    addTube(mesh2, [from, to], [radius0, radius1], circular, TUBE_SIDES);
  }
  function band(mesh2, center, axis, radius) {
    mesh2.use(JOINT);
    const half = radius * 0.22;
    addTube(mesh2, [travel(center, axis, -half), travel(center, axis, half)], [radius, radius], circular, TUBE_SIDES);
    mesh2.use(CLAY);
  }
  function addTube(mesh2, centers, radiusSide, radiusFront, sides, roll = 0) {
    const from = mesh2.quadCount;
    const rows = [];
    for (let i = 0; i < centers.length; i += 1) {
      const { side, front } = rollFrame(armFrame(tangentAt(centers, i)), roll);
      const rz = radiusSide[i];
      const rx = typeof radiusFront === "function" ? radiusFront(rz) : radiusFront[i];
      const row = [];
      for (let j = 0; j < sides; j += 1) {
        row.push(mesh2.vertex(ring(centers[i], side, front, rz, rx, j / sides * Math.PI * 2)));
      }
      rows.push(row);
    }
    for (let i = 0; i < centers.length - 1; i += 1) {
      for (let j = 0; j < sides; j += 1) {
        const j2 = (j + 1) % sides;
        mesh2.quad(rows[i][j], rows[i][j2], rows[i + 1][j2], rows[i + 1][j]);
      }
    }
    mesh2.orient(from, (mid) => nearest(centers, mid));
  }
  function circular(side) {
    return side;
  }
  function addFan(mesh2, center, axis, side, front, rx, rz, sides) {
    const from = mesh2.quadCount;
    const tip = mesh2.vertex(travel(center, axis, Math.min(rx, rz) * 0.2));
    const row = [];
    for (let j = 0; j < sides; j += 1) row.push(mesh2.vertex(ring(center, side, front, rz, rx, j / sides * Math.PI * 2)));
    for (let j = 0; j < sides; j += 1) mesh2.quad(row[j], row[(j + 1) % sides], tip, tip);
    mesh2.orient(from, () => center);
  }
  function addEllipsoid(mesh2, center, radii, zSign, lat, lon) {
    const from = mesh2.quadCount;
    const rows = [];
    for (let i = 0; i <= lat; i += 1) {
      const theta = i / lat * Math.PI;
      const count = i === 0 || i === lat ? 1 : lon;
      const row = [];
      for (let j = 0; j < count; j += 1) {
        const phi = j / lon * Math.PI * 2;
        row.push(
          mesh2.vertex([
            center[0] + radii[0] * Math.sin(theta) * Math.cos(phi),
            center[1] + radii[1] * Math.cos(theta),
            center[2] + zSign * radii[2] * Math.sin(theta) * Math.sin(phi)
          ])
        );
      }
      rows.push(row);
    }
    for (let i = 0; i < lat; i += 1) {
      const top = rows[i];
      const bottom = rows[i + 1];
      if (top.length === 1) {
        const pole = top[0];
        for (let j = 0; j < lon; j += 1) mesh2.quad(pole, bottom[j], bottom[(j + 1) % lon], pole);
      } else if (bottom.length === 1) {
        const pole = bottom[0];
        for (let j = 0; j < lon; j += 1) mesh2.quad(top[j], top[(j + 1) % lon], pole, pole);
      } else {
        for (let j = 0; j < lon; j += 1) {
          const j2 = (j + 1) % lon;
          mesh2.quad(top[j], top[j2], bottom[j2], bottom[j]);
        }
      }
    }
    mesh2.orient(from, () => center);
  }
  function shoulderDirection(side, flex, abd) {
    const frontal = [0, Math.sin(abd), side * Math.cos(abd)];
    return bendToward(frontal, [1, 0, 0], flex);
  }
  function flexForearm(upper, elbowAngle, shoulderRot) {
    let hinge = cross(upper, [1, 0, 0]);
    if (length(hinge) < 1e-4) hinge = cross(upper, [0, 1, 0]);
    hinge = rotateAround(hinge, upper, shoulderRot);
    return rotateAround(upper, hinge, -elbowAngle);
  }
  function handAxes(fore, twist) {
    const up = rotateAround(perpendicular(fore, [0, 1, 0]), fore, twist);
    const front = rotateAround(perpendicular(fore, [1, 0, 0]), fore, twist);
    return { up, front };
  }
  function alignBasis(dir, upHint, frontHint) {
    const front = perpendicular(dir, frontHint);
    let up = cross(front, dir);
    if (dot(up, upHint) < 0) up = mul(up, -1);
    return { up, front };
  }
  function thighDirection(side, flex, abd) {
    return bendToward(rotateSagittal([0, -1, 0], flex), [0, 0, side], abd);
  }
  function kneeDirection(thigh, kneeAngle, hipRot) {
    const vertical = [0, -1, 0];
    let hinge = rotateAround([0, 0, 1], vertical, hipRot);
    hinge = carry(hinge, vertical, thigh);
    if (length(cross(hinge, thigh)) < 1e-4) hinge = [0, 0, 1];
    return rotateAround(thigh, hinge, kneeAngle);
  }
  function carry(vector, from, to) {
    const axis = cross(from, to);
    const len = length(axis);
    if (len < 1e-6) return dot(from, to) >= 0 ? vector : mul(vector, -1);
    return rotateAround(vector, axis, Math.atan2(len, dot(from, to)));
  }
  function bendToward(direction, target, angle) {
    const parallel = dot(direction, target);
    const px = target[0] - direction[0] * parallel;
    const py = target[1] - direction[1] * parallel;
    const pz = target[2] - direction[2] * parallel;
    const len = Math.hypot(px, py, pz);
    if (len < 1e-4) return direction;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [direction[0] * c + px / len * s, direction[1] * c + py / len * s, direction[2] * c + pz / len * s];
  }
  function rotateAround(vector, axis, angle) {
    const unit = norm(axis);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const crossed = cross(unit, vector);
    const along = dot(unit, vector);
    return add(add(mul(vector, c), mul(crossed, s)), mul(unit, along * (1 - c)));
  }
  function rollFrame(frame, roll) {
    const c = Math.cos(roll);
    const s = Math.sin(roll);
    return {
      side: add(mul(frame.side, c), mul(frame.front, s)),
      front: add(mul(frame.front, c), mul(frame.side, -s))
    };
  }
  function rotateSagittal(direction, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return [direction[0] * c - direction[1] * s, direction[0] * s + direction[1] * c, direction[2]];
  }
  function placeFoot(ankle, localX, localY, pitch) {
    const c = Math.cos(pitch);
    const s = Math.sin(pitch);
    return [ankle[0] + c * localX - s * localY, ankle[1] + s * localX + c * localY, ankle[2]];
  }
  function yawFoot(ankle, localX, localY, pitch, yaw) {
    const placed = placeFoot(ankle, localX, localY, pitch);
    const dx = placed[0] - ankle[0];
    return [ankle[0] + dx * Math.cos(yaw), placed[1], ankle[2] + dx * Math.sin(yaw)];
  }
  function armFrame(direction) {
    const tangent = norm(direction);
    let front = sub([1, 0, 0], mul(tangent, tangent[0]));
    if (length(front) < 1e-4) front = [0, 1, 0];
    front = norm(front);
    if (front[0] < 0) front = mul(front, -1);
    return { side: cross(tangent, front), front };
  }
  function ring(center, side, front, radiusSide, radiusFront, phi) {
    const lateral = Math.sin(phi) * radiusSide;
    const forward = Math.cos(phi) * radiusFront;
    return [
      center[0] + front[0] * forward + side[0] * lateral,
      center[1] + front[1] * forward + side[1] * lateral,
      center[2] + front[2] * forward + side[2] * lateral
    ];
  }
  function tangentAt(centers, index) {
    return sub(centers[Math.min(index + 1, centers.length - 1)], centers[Math.max(index - 1, 0)]);
  }
  function nearest(centers, point) {
    let best = centers[0];
    let bestD = Infinity;
    for (let i = 0; i < centers.length; i += 1) {
      const center = centers[i];
      const d = distanceSq(center, point);
      if (d < bestD) {
        best = center;
        bestD = d;
      }
    }
    return best;
  }
  function perpendicular(direction, hint) {
    const tangent = norm(direction);
    const along = dot(tangent, hint);
    const side = sub(hint, mul(tangent, along));
    if (length(side) >= 1e-4) return norm(side);
    const fallback = Math.abs(tangent[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const alongFallback = dot(tangent, fallback);
    return norm(sub(fallback, mul(tangent, alongFallback)));
  }
  function quadNormal(xyz, a, b, c, d) {
    const tail = d === c || d === a ? c : d;
    const ax = xyz[a * 3];
    const ay = xyz[a * 3 + 1];
    const az = xyz[a * 3 + 2];
    const ux = xyz[b * 3] - ax;
    const uy = xyz[b * 3 + 1] - ay;
    const uz = xyz[b * 3 + 2] - az;
    const vx = xyz[tail * 3] - ax;
    const vy = xyz[tail * 3 + 1] - ay;
    const vz = xyz[tail * 3 + 2] - az;
    const normal = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const len = length(normal);
    return len < 1e-8 ? null : mul(normal, 1 / len);
  }
  function centroid(xyz, a, b, c, d) {
    const ids = d === a || d === c ? [a, b, c] : [a, b, c, d];
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      x += xyz[id * 3];
      y += xyz[id * 3 + 1];
      z += xyz[id * 3 + 2];
    }
    return [x / ids.length, y / ids.length, z / ids.length];
  }
  function add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  }
  function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }
  function mul(a, scale) {
    return [a[0] * scale, a[1] * scale, a[2] * scale];
  }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
  function length(a) {
    return Math.hypot(a[0], a[1], a[2]);
  }
  function norm(a) {
    const len = length(a);
    return len < 1e-8 ? [0, 1, 0] : mul(a, 1 / len);
  }
  function midpoint(a, b) {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  }
  function travel(origin, direction, distance) {
    const step = norm(direction);
    return [origin[0] + step[0] * distance, origin[1] + step[1] * distance, origin[2] + step[2] * distance];
  }
  function distanceSq(a, b) {
    const delta = sub(a, b);
    return dot(delta, delta);
  }

  // preview/main.ts
  var BACKGROUND = "#5c5c5c";
  var CLAY2 = [236, 236, 238];
  var JOINT_COLOR = [42, 42, 46];
  var GRID = "rgba(64, 255, 154, 0.95)";
  var LIGHT = normalize(0.45, 0.82, 0.2);
  var STEP = 5;
  var JOINTS = [
    { key: "shoulderFlexL", group: "\u5DE6\u81C2", label: "\u80A9\u5C48", min: -60, max: 130 },
    { key: "shoulderAbdL", group: "\u5DE6\u81C2", label: "\u80A9\u5C55", min: -120, max: 90 },
    { key: "shoulderRotL", group: "\u5DE6\u81C2", label: "\u80A9\u65CB", min: -70, max: 90 },
    { key: "elbowL", group: "\u5DE6\u81C2", label: "\u8098", min: -150, max: 10 },
    { key: "forearmL", group: "\u5DE6\u81C2", label: "\u524D\u81C2", min: -80, max: 80 },
    { key: "wristFlexL", group: "\u5DE6\u81C2", label: "\u8155\u5C48", min: -80, max: 70 },
    { key: "wristDevL", group: "\u5DE6\u81C2", label: "\u8155\u504F", min: -20, max: 30 },
    { key: "shoulderFlexR", group: "\u53F3\u81C2", label: "\u80A9\u5C48", min: -60, max: 130 },
    { key: "shoulderAbdR", group: "\u53F3\u81C2", label: "\u80A9\u5C55", min: -120, max: 90 },
    { key: "shoulderRotR", group: "\u53F3\u81C2", label: "\u80A9\u65CB", min: -70, max: 90 },
    { key: "elbowR", group: "\u53F3\u81C2", label: "\u8098", min: -150, max: 10 },
    { key: "forearmR", group: "\u53F3\u81C2", label: "\u524D\u81C2", min: -80, max: 80 },
    { key: "wristFlexR", group: "\u53F3\u81C2", label: "\u8155\u5C48", min: -80, max: 70 },
    { key: "wristDevR", group: "\u53F3\u81C2", label: "\u8155\u504F", min: -20, max: 30 },
    { key: "hipFlexL", group: "\u5DE6\u817F", label: "\u9ACB\u5C48", min: -30, max: 120 },
    { key: "hipAbdL", group: "\u5DE6\u817F", label: "\u9ACB\u5C55", min: -30, max: 45 },
    { key: "hipRotL", group: "\u5DE6\u817F", label: "\u9ACB\u65CB", min: -45, max: 45 },
    { key: "kneeL", group: "\u5DE6\u817F", label: "\u819D", min: -150, max: 10 },
    { key: "ankleFlexL", group: "\u5DE6\u817F", label: "\u8E1D\u5C48", min: -50, max: 20 },
    { key: "ankleRollL", group: "\u5DE6\u817F", label: "\u8E1D\u7FFB", min: -20, max: 35 },
    { key: "hipFlexR", group: "\u53F3\u817F", label: "\u9ACB\u5C48", min: -30, max: 120 },
    { key: "hipAbdR", group: "\u53F3\u817F", label: "\u9ACB\u5C55", min: -30, max: 45 },
    { key: "hipRotR", group: "\u53F3\u817F", label: "\u9ACB\u65CB", min: -45, max: 45 },
    { key: "kneeR", group: "\u53F3\u817F", label: "\u819D", min: -150, max: 10 },
    { key: "ankleFlexR", group: "\u53F3\u817F", label: "\u8E1D\u5C48", min: -50, max: 20 },
    { key: "ankleRollR", group: "\u53F3\u817F", label: "\u8E1D\u7FFB", min: -20, max: 35 }
  ];
  var canvas = document.querySelector("#view");
  var panel = document.querySelector("#pose");
  if (canvas === null || panel === null) throw new Error("view");
  var ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2d");
  var mesh = createMannequinMesh(MANNEQUIN_HEIGHT);
  var restProjected = new Float32Array(mesh.positions.length / 3 * 2);
  projectPositions(restProjected, mesh.positions, FRONT_VIEW);
  var sliders = /* @__PURE__ */ new Map();
  var readouts = /* @__PURE__ */ new Map();
  mountPose(panel);
  new ResizeObserver(() => draw()).observe(canvas.parentElement ?? canvas);
  draw();
  function mountPose(root) {
    const title = document.createElement("h1");
    title.textContent = "\u59FF\u52BF";
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "0\xB0 \u662F T \u5B57\u7AD9\u59FF\u3002\u80A9\u548C\u9ACB\u5404\u6709\u5C48\u3001\u5C55\u3001\u65CB\uFF0C\u8155\u548C\u8E1D\u5404\u6709\u5C48\u4F38\u4E0E\u4FA7\u5411\uFF0C\u8098\u3001\u819D\u3001\u524D\u81C2\u5404\u4E00\u4E2A\u94F0\u94FE\u3002\u5C48\u7684\u6B63\u89D2\u5EA6\u671D\u524D\uFF0C\u5C55\u7684\u6B63\u89D2\u5EA6\u79BB\u5F00\u8EAF\u5E72\u3002\u8098\u7684\u8D1F\u89D2\u5EA6\u671D\u524D\u5F2F\uFF0C\u819D\u7684\u8D1F\u89D2\u5EA6\u671D\u540E\u5F2F\u3002\u8155\u5C48\u6B63\u89D2\u5EA6\u624B\u6307\u5411\u4E0A\uFF0C\u8E1D\u5C48\u6B63\u89D2\u5EA6\u811A\u5C16\u4E0A\u62AC\u3002";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "reset";
    reset.textContent = "\u590D\u4F4D\u5230 0\xB0";
    reset.addEventListener("click", () => {
      for (const joint of JOINTS) {
        const slider = sliders.get(joint.key);
        if (slider === void 0) continue;
        slider.value = "0";
        writeReadout(joint);
      }
      poseMesh();
    });
    root.append(title, note, reset);
    let group = "";
    for (const joint of JOINTS) {
      if (joint.group !== group) {
        group = joint.group;
        const heading = document.createElement("h2");
        heading.textContent = group;
        root.append(heading);
      }
      const row = document.createElement("div");
      row.className = "joint";
      const name = document.createElement("span");
      name.textContent = joint.label;
      const down = document.createElement("button");
      down.type = "button";
      down.textContent = "\u2212";
      down.setAttribute("aria-label", `${joint.group}${joint.label}\u51CF ${STEP} \u5EA6`);
      const up = document.createElement("button");
      up.type = "button";
      up.textContent = "+";
      up.setAttribute("aria-label", `${joint.group}${joint.label}\u52A0 ${STEP} \u5EA6`);
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = String(joint.min);
      slider.max = String(joint.max);
      slider.step = "1";
      slider.value = "0";
      slider.setAttribute("aria-label", `${joint.group}${joint.label}`);
      const range = document.createElement("div");
      range.className = "range";
      row.append(name, down, slider, up, range);
      root.append(row);
      sliders.set(joint.key, slider);
      readouts.set(joint.key, range);
      const apply = () => {
        writeReadout(joint);
        poseMesh();
      };
      slider.addEventListener("input", apply);
      down.addEventListener("click", () => nudge(joint, -STEP));
      up.addEventListener("click", () => nudge(joint, STEP));
      writeReadout(joint);
    }
  }
  function nudge(joint, delta) {
    const slider = sliders.get(joint.key);
    if (slider === void 0) return;
    const next = Math.min(joint.max, Math.max(joint.min, Number(slider.value) + delta));
    slider.value = String(next);
    writeReadout(joint);
    poseMesh();
  }
  function writeReadout(joint) {
    const readout = readouts.get(joint.key);
    const slider = sliders.get(joint.key);
    if (readout === void 0 || slider === void 0) return;
    readout.textContent = `${formatDeg(Number(slider.value))} \xB7 \u53EF\u6D3B\u52A8 ${formatDeg(joint.min)} ~ ${formatDeg(joint.max)}`;
  }
  function poseMesh() {
    mesh = createMannequinMesh(MANNEQUIN_HEIGHT, currentPose());
    draw();
  }
  function currentPose() {
    return {
      shoulderFlexL: radians("shoulderFlexL"),
      shoulderAbdL: radians("shoulderAbdL"),
      shoulderRotL: radians("shoulderRotL"),
      elbowL: radians("elbowL"),
      forearmL: radians("forearmL"),
      wristFlexL: radians("wristFlexL"),
      wristDevL: radians("wristDevL"),
      shoulderFlexR: radians("shoulderFlexR"),
      shoulderAbdR: radians("shoulderAbdR"),
      shoulderRotR: radians("shoulderRotR"),
      elbowR: radians("elbowR"),
      forearmR: radians("forearmR"),
      wristFlexR: radians("wristFlexR"),
      wristDevR: radians("wristDevR"),
      hipFlexL: radians("hipFlexL"),
      hipAbdL: radians("hipAbdL"),
      hipRotL: radians("hipRotL"),
      kneeL: radians("kneeL"),
      ankleFlexL: radians("ankleFlexL"),
      ankleRollL: radians("ankleRollL"),
      hipFlexR: radians("hipFlexR"),
      hipAbdR: radians("hipAbdR"),
      hipRotR: radians("hipRotR"),
      kneeR: radians("kneeR"),
      ankleFlexR: radians("ankleFlexR"),
      ankleRollR: radians("ankleRollR")
    };
  }
  function radians(key) {
    return Number(sliders.get(key)?.value) * Math.PI / 180;
  }
  function draw() {
    const stage = canvas.parentElement;
    const cssWidth = stage?.clientWidth ?? window.innerWidth;
    const cssHeight = stage?.clientHeight ?? window.innerHeight;
    if (cssWidth < 2 || cssHeight < 2) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    const projected = new Float32Array(mesh.positions.length / 3 * 2);
    projectPositions(projected, mesh.positions, FRONT_VIEW);
    const order = frontQuads(mesh.positions, mesh.quads);
    const frame = contain(restProjected, canvas.width, canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = Math.max(1, dpr);
    ctx.lineJoin = "round";
    ctx.strokeStyle = GRID;
    for (let i = 0; i < order.length; i += 1) {
      const q = order[i];
      const a = mesh.quads[q * 4];
      const b = mesh.quads[q * 4 + 1];
      const c = mesh.quads[q * 4 + 2];
      const d = mesh.quads[q * 4 + 3];
      const normal = faceNormal(mesh.positions, a, b, c, d);
      const color = mesh.materials[q] === 1 ? JOINT_COLOR : CLAY2;
      ctx.beginPath();
      move(ctx, projected, frame, a);
      line(ctx, projected, frame, b);
      line(ctx, projected, frame, c);
      if (d !== c && d !== a) line(ctx, projected, frame, d);
      ctx.closePath();
      ctx.fillStyle = paint(color, normal === null ? 1 : blockShade(normal));
      ctx.fill();
      ctx.stroke();
    }
  }
  function frontQuads(positions, quads) {
    const count = quads.length / 4;
    const order = [];
    for (let q = 0; q < count; q += 1) {
      const a = quads[q * 4];
      const b = quads[q * 4 + 1];
      const c = quads[q * 4 + 2];
      const d = quads[q * 4 + 3];
      const normal = faceNormal(positions, a, b, c, d);
      if (normal === null || normal[0] <= -0.04) continue;
      order.push({ index: q, depth: centroidX(positions, a, b, c, d) });
    }
    order.sort((left, right) => left.depth - right.depth);
    return order.map((item) => item.index);
  }
  function contain(projected, width, height) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < projected.length; i += 2) {
      const x = projected[i];
      const y = projected[i + 1];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    maxY += 0.7;
    minY -= 0.25;
    const spanX = Math.max(1e-4, maxX - minX);
    const spanY = Math.max(1e-4, maxY - minY);
    const padX = spanX * 0.12;
    const padY = spanY * 0.04;
    minX -= padX;
    maxX += padX;
    minY -= padY;
    maxY += padY;
    const scale = Math.min(width / (maxX - minX), height / (maxY - minY));
    const usedW = (maxX - minX) * scale;
    const usedH = (maxY - minY) * scale;
    return {
      scale,
      originX: (width - usedW) / 2 - minX * scale,
      originY: (height - usedH) / 2 + maxY * scale
    };
  }
  function move(context, projected, frame, index) {
    context.moveTo(frame.originX + projected[index * 2] * frame.scale, frame.originY - projected[index * 2 + 1] * frame.scale);
  }
  function line(context, projected, frame, index) {
    context.lineTo(frame.originX + projected[index * 2] * frame.scale, frame.originY - projected[index * 2 + 1] * frame.scale);
  }
  function faceNormal(positions, a, b, c, d) {
    const tail = d === c || d === a ? c : d;
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax;
    const uy = positions[b * 3 + 1] - ay;
    const uz = positions[b * 3 + 2] - az;
    const vx = positions[tail * 3] - ax;
    const vy = positions[tail * 3 + 1] - ay;
    const vz = positions[tail * 3 + 2] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-8) return null;
    return [nx / len, ny / len, nz / len];
  }
  function centroidX(positions, a, b, c, d) {
    const ids = d === a || d === c ? [a, b, c] : [a, b, c, d];
    let sum = 0;
    for (let i = 0; i < ids.length; i += 1) sum += positions[ids[i] * 3];
    return sum / ids.length;
  }
  function blockShade(normal) {
    const nd = Math.max(0, normal[0] * LIGHT[0] + normal[1] * LIGHT[1] + normal[2] * LIGHT[2]);
    return 0.55 + 0.45 * nd;
  }
  function paint(color, shade) {
    const r = Math.round(color[0] * shade);
    const g = Math.round(color[1] * shade);
    const b = Math.round(color[2] * shade);
    return `rgb(${r} ${g} ${b})`;
  }
  function formatDeg(value) {
    if (value < 0) return `\u2212${Math.abs(value)}\xB0`;
    if (value > 0) return `+${value}\xB0`;
    return "0\xB0";
  }
  function normalize(x, y, z) {
    const len = Math.hypot(x, y, z);
    return [x / len, y / len, z / len];
  }
})();
