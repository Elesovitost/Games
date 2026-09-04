import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { tangentFrame, surfaceOffsetDir, slerpDirection } from "../utils.js";
import { surfaceDist } from "./fx-common.js";
import { SPELLS } from "./defs.js";
import { tintMeshBlack, CHAR_COLOR } from "../burn.js";

const DEF = SPELLS.demon;
const SPEED = CONFIG.wizardSpeed * (DEF.speedMul ?? 1.5);
const BODY_R = 0.72;
const HUNT = DEF.life ?? 5;
const CATCH_R = DEF.catchRadius ?? 1;
const MERGE_R = 0.35;
const EMERGE = 0.65;
const REACH = 0.4;
const MORPH = 1.05;
const BLACKEN_AT = 0.32;
const FALL_AT = 0.78;
const SCREAM = 0.72;
const MELT = 0.9;
const HEIGHT = 1.56;
const DAMAGE = DEF.damage ?? 101;
const PUDDLE_R = 1.7;
const ARM_L1 = 0.36;
const ARM_L2 = 0.34;
const LEG_L1 = 0.38;
const LEG_L2 = 0.36;
const ARM_Z_FRONT = 0.66;
const ARM_Z_BACK = 0.1;
const LEG_Z_FRONT = -0.16;
const LEG_Z_BACK = -0.68;

function mat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.88,
    metalness: opts.metalness ?? 0.04,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    depthWrite: opts.depthWrite ?? !opts.transparent
  });
  if (opts.emissive != null) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 0.7;
  }
  return m;
}

function sph(geo, material, rx, ry, rz, x, y, z) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.scale.set(rx, ry, rz);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addCapsule(parent, geos, material, radius, length, x, y, z) {
  const geo = new THREE.CapsuleGeometry(radius, length, 3, 8);
  geos.push(geo);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/**
 * Člověk na čtyřech: trup vodorovně podél +Z, ruce vepředu, nohy vzadu.
 * Kapsle visí po lokální −Y, ohyb je rotace X v rameni/lokti a kyčli/koleni.
 */
function createDemonMesh() {
  const S = new THREE.SphereGeometry(1, 12, 10);
  const hide = mat(0x171513, { roughness: 0.96, emissive: 0x080706, emissiveIntensity: 0.1 });
  const ash = mat(0x2c2925, { roughness: 0.92, emissive: 0x0c0a09, emissiveIntensity: 0.07 });
  const hairMat = mat(0x0b0a09, { roughness: 1, emissive: 0x050404, emissiveIntensity: 0.05 });
  const hairWet = mat(0x1a1815, { roughness: 0.86, emissive: 0x080706, emissiveIntensity: 0.04 });
  const eye = new THREE.MeshBasicMaterial({ color: 0xff1c08 });
  const eyeGlow = new THREE.MeshBasicMaterial({
    color: 0xff4020,
    transparent: true,
    opacity: 0.55,
    depthWrite: false
  });
  const mats = [hide, ash, hairMat, hairWet, eye, eyeGlow];
  const geos = [S];

  const root = new THREE.Group();
  const body = new THREE.Group();

  body.add(sph(S, hide, 0.2, 0.15, 0.28, 0, 0.58, 0.1));
  body.add(sph(S, ash, 0.17, 0.13, 0.18, 0, 0.54, -0.16));
  body.add(sph(S, hide, 0.16, 0.12, 0.14, 0, 0.56, 0.3));
  body.add(sph(S, hairWet, 0.18, 0.08, 0.26, 0, 0.68, 0.02));

  const head = new THREE.Group();
  head.position.set(0, 0.62, 0.46);
  head.add(sph(S, hide, 0.12, 0.11, 0.12, 0, 0.04, 0.02));
  head.add(sph(S, ash, 0.07, 0.06, 0.08, 0, 0, 0.1));
  head.add(sph(S, hairMat, 0.16, 0.15, 0.16, 0, 0.08, -0.03));
  head.add(sph(S, hairWet, 0.14, 0.18, 0.12, 0, 0.02, -0.08));

  const eyeL = sph(S, eye, 0.026, 0.026, 0.026, -0.04, 0.035, 0.12);
  const eyeR = sph(S, eye, 0.026, 0.026, 0.026, 0.04, 0.035, 0.12);
  const glowL = sph(S, eyeGlow, 0.05, 0.05, 0.05, -0.04, 0.035, 0.12);
  const glowR = sph(S, eyeGlow, 0.05, 0.05, 0.05, 0.04, 0.035, 0.12);
  for (const m of [eyeL, eyeR, glowL, glowR]) {
    m.castShadow = false;
    m.receiveShadow = false;
  }
  head.add(eyeL, eyeR, glowL, glowR);

  const glow = new THREE.PointLight(0xff2208, 1.05, 3.2, 2);
  glow.castShadow = false;
  glow.position.set(0, 0.04, 0.14);
  head.add(glow);

  const hair = [];
  for (let i = 0; i < 28; i++) {
    const t = i / 27;
    const side = Math.sin(i * 1.7) * (0.02 + t * 0.1);
    const back = -0.02 - (i % 6) * 0.022;
    const len = 0.48 + (i % 7) * 0.06;
    const strand = addCapsule(head, geos, i % 3 ? hairMat : hairWet, 0.01 + (i % 3) * 0.003, len, side, 0.1, back);
    strand.rotation.x = 1.18 + (i % 5) * 0.07;
    strand.rotation.z = side * 2.2;
    strand.userData.restX = strand.rotation.x;
    strand.userData.restZ = strand.rotation.z;
    strand.userData.ph = i * 0.51;
    hair.push(strand);
  }
  for (let i = 0; i < 22; i++) {
    const t = i / 21;
    const side = (i % 2 ? 1 : -1) * (0.012 + (i % 8) * 0.016 + t * 0.02);
    const fwd = 0.1 + (i % 5) * 0.012;
    const len = 0.95 + (i % 7) * 0.09 + (i % 3) * 0.04;
    const strand = addCapsule(
      head,
      geos,
      i % 2 ? hairMat : hairWet,
      0.008 + (i % 4) * 0.002,
      len,
      side,
      0.06 + (i % 4) * 0.012,
      fwd
    );
    strand.rotation.x = 2.35 + (i % 6) * 0.08;
    strand.rotation.z = side * 1.15;
    strand.userData.restX = strand.rotation.x;
    strand.userData.restZ = strand.rotation.z;
    strand.userData.ph = 40 + i * 0.63;
    strand.userData.front = true;
    strand.userData.amp = 0.16 + (i % 5) * 0.025;
    hair.push(strand);
  }
  body.add(head);

  const makeArm = (side) => {
    const root = new THREE.Group();
    root.position.set(side * 0.22, 0.64, 0.32);
    addCapsule(root, geos, hide, 0.052, ARM_L1 - 0.1, 0, -ARM_L1 * 0.5, 0);
    root.add(sph(S, ash, 0.055, 0.055, 0.055, 0, -ARM_L1, 0));
    const elbow = new THREE.Group();
    elbow.position.set(0, -ARM_L1, 0);
    addCapsule(elbow, geos, ash, 0.044, ARM_L2 - 0.1, 0, -ARM_L2 * 0.5, 0.02);
    elbow.add(sph(S, hide, 0.075, 0.038, 0.1, 0, -ARM_L2, 0.04));
    root.add(elbow);
    body.add(root);
    return { root, elbow, side, L1: ARM_L1, L2: ARM_L2 };
  };

  const makeLeg = (side) => {
    const root = new THREE.Group();
    root.position.set(side * 0.14, 0.6, -0.3);
    addCapsule(root, geos, hide, 0.058, LEG_L1 - 0.1, 0, -LEG_L1 * 0.5, 0);
    root.add(sph(S, ash, 0.06, 0.06, 0.06, 0, -LEG_L1, 0));
    const knee = new THREE.Group();
    knee.position.set(0, -LEG_L1, 0);
    addCapsule(knee, geos, ash, 0.048, LEG_L2 - 0.1, 0, -LEG_L2 * 0.5, 0.02);
    knee.add(sph(S, hide, 0.085, 0.038, 0.13, 0, -LEG_L2, 0.05));
    root.add(knee);
    body.add(root);
    return { root, knee, side, L1: LEG_L1, L2: LEG_L2 };
  };

  const arms = [makeArm(-1), makeArm(1)];
  const legs = [makeLeg(-1), makeLeg(1)];

  for (const strand of hair) head.remove(strand);
  const bbox = new THREE.Box3().setFromObject(body);
  body.position.y -= bbox.min.y;
  bbox.setFromObject(body);
  const h = Math.max(0.45, bbox.max.y - bbox.min.y);
  const worldScale = HEIGHT / h;
  for (const strand of hair) head.add(strand);
  root.scale.setScalar(worldScale);
  root.add(body);
  root.frustumCulled = false;
  root.userData.parts = {
    body,
    head,
    arms,
    legs,
    hair,
    mats,
    geos,
    restY: body.position.y,
    groundY: -body.position.y + 0.035,
    worldScale,
    light: glow
  };
  return root;
}

function living(e) {
  if (!e || e.dead || e.gone || e.vanished) return false;
  if (e.godMode || e.immortal) return false;
  if (e.state === "swim") return false;
  return true;
}

function pickPrey(sys, fromDir) {
  let best = null;
  let bestD = Infinity;
  const consider = (e) => {
    if (!living(e) || !e.dir) return;
    const d = surfaceDist(fromDir, e.dir);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  };
  for (const w of sys.getWizards?.() || []) consider(w);
  for (const c of sys.critters?.list || []) consider(c);
  for (const c of sys.longnecks?.list || []) consider(c);
  for (const c of sys.worms?.list || []) {
    if (c.exposed) consider(c);
  }
  return best;
}

function blockersOf(sys) {
  return sys.blockers || sys.wizard?.blockers || null;
}

function walkable(sys, dir) {
  const h = sys.terrain.height(dir);
  if (h <= CONFIG.wizardMinTerrainR) return false;
  return blockersOf(sys)?.clear(dir, BODY_R, { animals: false }) ?? true;
}

function tryStep(d, goal, maxDist, prev, stepAxis) {
  const dot = Math.min(1, Math.max(-1, d.dir.dot(goal)));
  const omega = Math.acos(dot);
  if (omega < 1e-8) return walkable(d.sys, d.dir);
  const angle = Math.min(omega, maxDist / CONFIG.planetR);
  if (angle < 1e-10) return false;
  prev.copy(d.dir);
  stepAxis.crossVectors(d.dir, goal);
  if (stepAxis.lengthSq() < 1e-12) d.dir.copy(goal);
  else d.dir.applyAxisAngle(stepAxis.normalize(), angle).normalize();
  if (!walkable(d.sys, d.dir)) {
    d.dir.copy(prev);
    return false;
  }
  return true;
}

function avoidWaypoints(hit, self, leftOut, rightOut) {
  tangentFrame(hit.dir, self._east, self._north);
  const wx = self.dir.dot(self._east);
  const wz = self.dir.dot(self._north);
  const ang = Math.atan2(wz, wx);
  const rad = hit.r + 0.45;
  surfaceOffsetDir(hit.dir, self._east, self._north, ang + Math.PI * 0.5, rad, leftOut);
  surfaceOffsetDir(hit.dir, self._east, self._north, ang - Math.PI * 0.5, rad, rightOut);
}

function stepToward(d, goal, maxDist) {
  d._from.copy(d.dir);
  let ok = false;
  if (tryStep(d, goal, maxDist, d._prev, d._axis)) {
    d._avoidSide = 0;
    ok = true;
  } else {
    const hit = blockersOf(d.sys)?.hitNear(d.dir, BODY_R, 3.6, goal, { animals: false });
    if (hit) {
      avoidWaypoints(hit, d, d._steerA, d._steerB);
      let side = d._avoidSide;
      if (!side) {
        side = surfaceDist(d._steerA, goal) <= surfaceDist(d._steerB, goal) ? 1 : -1;
      }
      let via = side > 0 ? d._steerA : d._steerB;
      if (tryStep(d, via, maxDist, d._prev, d._axis)) {
        d._avoidSide = side;
        ok = true;
      } else {
        side = -side;
        via = side > 0 ? d._steerA : d._steerB;
        if (tryStep(d, via, maxDist, d._prev, d._axis)) {
          d._avoidSide = side;
          ok = true;
        }
      }
    }
    if (!ok) {
      const probes = d._avoidSide >= 0
        ? [0.45, -0.45, 0.85, -0.85, 1.25, -1.25]
        : [-0.45, 0.45, -0.85, 0.85, -1.25, 1.25];
      for (const a of probes) {
        d._steerA.copy(goal).applyAxisAngle(d.dir, a);
        if (tryStep(d, d._steerA, maxDist, d._prev, d._axis)) {
          d._avoidSide = a >= 0 ? 1 : -1;
          ok = true;
          break;
        }
      }
    }
  }
  return ok ? surfaceDist(d._from, d.dir) : 0;
}

function snap(d) {
  const h = d.sys.terrain.height(d.dir);
  d.mesh.position.copy(d.dir).multiplyScalar(h);
}

function applyPose(d) {
  d.facing.addScaledVector(d.dir, -d.facing.dot(d.dir));
  if (d.facing.lengthSq() < 1e-8) tangentFrame(d.dir, d._east, d.facing);
  else d.facing.normalize();
  d._right.crossVectors(d.dir, d.facing).normalize();
  d.facing.crossVectors(d._right, d.dir).normalize();
  d._mat.makeBasis(d._right, d.dir, d.facing);
  d.mesh.quaternion.setFromRotationMatrix(d._mat);
}

function swayHair(d, extraX = 0) {
  const p = d.mesh.userData.parts;
  const t = d.t || 0;
  const step = d.walkPhase || 0;
  for (const h of p.hair) {
    if (h.userData.front) {
      const amp = h.userData.amp ?? 0.18;
      const ph = h.userData.ph;
      h.rotation.x = h.userData.restX + extraX + Math.sin(t * 2.1 + ph) * amp + Math.sin(step * 0.9 + ph) * amp * 0.45;
      h.rotation.z = h.userData.restZ + Math.sin(t * 1.55 + ph * 0.7) * amp * 0.7;
    } else {
      h.rotation.x = h.userData.restX + extraX + Math.sin(step * 0.7 + h.userData.ph) * 0.12;
      h.rotation.z = h.userData.restZ + Math.sin(step * 0.55 + h.userData.ph) * 0.09;
    }
  }
}

/**
 * 2-kostěný IK pro visící končetinu (−Y).
 * Kladné root.x = dozadu, záporné = dopředu. Loket/koleno se ohne, ať dlaň/chodidlo zůstane na cíli.
 */
function aimHangChain(root, mid, tx, ty, tz, L1, L2, bendSign) {
  let vx = tx - root.position.x;
  let vy = ty - root.position.y;
  let vz = tz - root.position.z;
  let d = Math.hypot(vx, vy, vz);
  const maxR = L1 + L2 - 0.014;
  const minR = Math.abs(L1 - L2) + 0.014;
  if (d < 1e-5) d = 1e-5;
  if (d > maxR) {
    const s = maxR / d;
    vx *= s;
    vy *= s;
    vz *= s;
    d = maxR;
  } else if (d < minR) {
    const s = minR / d;
    vx *= s;
    vy *= s;
    vz *= s;
    d = minR;
  }
  const cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
  const A = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const cosE = (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2);
  const E = Math.acos(Math.min(1, Math.max(-1, cosE)));
  const pitch = Math.atan2(vz, -vy);
  const roll = Math.atan2(vx, Math.hypot(vy, vz) + 1e-5);
  root.rotation.set(-(pitch + bendSign * A), 0, roll * 0.9);
  mid.rotation.set((Math.PI - E) * bendSign, 0, 0);
}

function ensureGait(d) {
  if (d.gait) return d.gait;
  const p = d.mesh.userData.parts;
  const gy = p.groundY;
  d.gait = {
    items: [
      { kind: "arm", limb: p.arms[0], z: ARM_Z_FRONT, y: gy, mode: "stance", swing: 0, fromZ: ARM_Z_FRONT, fromY: gy },
      { kind: "arm", limb: p.arms[1], z: ARM_Z_BACK, y: gy, mode: "stance", swing: 0, fromZ: ARM_Z_BACK, fromY: gy },
      { kind: "leg", limb: p.legs[0], z: LEG_Z_BACK, y: gy, mode: "stance", swing: 0, fromZ: LEG_Z_BACK, fromY: gy },
      { kind: "leg", limb: p.legs[1], z: LEG_Z_FRONT, y: gy, mode: "stance", swing: 0, fromZ: LEG_Z_FRONT, fromY: gy }
    ]
  };
  return d.gait;
}

/** Plant-and-push: dlaň/chodidlo drží místo, tělo se nad ním posune. Fáze z ušlých metrů. */
function poseCrawl(d, traveled, moving, squat = 0) {
  const p = d.mesh.userData.parts;
  const g = ensureGait(d);
  const scale = d.baseScale || 1;
  const dz = moving && traveled > 0 ? traveled / scale : 0;
  d.walkPhase += dz;
  const gy = p.groundY + squat * 0.15;
  const lift = 0.13;

  for (const it of g.items) {
    const front = it.kind === "arm" ? ARM_Z_FRONT : LEG_Z_FRONT;
    const back = it.kind === "arm" ? ARM_Z_BACK : LEG_Z_BACK;
    const span = Math.abs(front - back);
    if (it.mode === "stance") {
      it.z -= dz;
      it.y = gy;
      if (moving && dz > 0 && it.z <= back) {
        it.mode = "swing";
        it.swing = 0;
        it.fromZ = it.z;
        it.fromY = it.y;
      }
    } else {
      it.swing += dz / Math.max(0.1, span * 0.5);
      const u = Math.min(1, it.swing);
      const e = u * u * (3 - 2 * u);
      it.z = it.fromZ + (front - it.fromZ) * e;
      it.y = gy + Math.sin(u * Math.PI) * lift;
      if (u >= 1) {
        it.mode = "stance";
        it.z = front;
        it.y = gy;
      }
    }
    const x = it.limb.side * (it.kind === "arm" ? 0.24 : 0.15);
    const mid = it.kind === "arm" ? it.limb.elbow : it.limb.knee;
    aimHangChain(it.limb.root, mid, x, it.y, it.z, it.limb.L1, it.limb.L2, it.kind === "arm" ? -1 : 1);
  }

  p.body.position.y = p.restY - squat * 0.15;
  p.body.rotation.set(0.16 + squat * 0.16, 0, 0);
  p.head.rotation.set(-0.1 + Math.sin((d.t || 0) * 1.4) * 0.03, 0, 0);
  swayHair(d);
  if (p.light) p.light.intensity = 0.8 + 0.35 * (0.5 + 0.5 * Math.sin((d.t || 0) * 7.2));
}

function poseReach(d, traveled, u) {
  poseCrawl(d, traveled, traveled > 1e-4, 0);
  const p = d.mesh.userData.parts;
  const e = u * u * (3 - 2 * u);
  const gy = p.groundY;
  for (const arm of p.arms) {
    aimHangChain(
      arm.root,
      arm.elbow,
      arm.side * (0.22 - e * 0.16),
      gy + e * 0.16,
      ARM_Z_FRONT + 0.62 * e,
      arm.L1,
      arm.L2,
      -1
    );
  }
  p.body.rotation.x = 0.1 - e * 0.08;
  p.body.position.y = p.restY + e * 0.04;
  p.head.rotation.x = -0.18 - e * 0.12;
}

/** Vsáknutí: ruce zůstanou natažené v oběti, tělo se do ní zhroutí. */
function poseSoak(d, u) {
  const p = d.mesh.userData.parts;
  const e = u * u * (3 - 2 * u);
  const gy = p.groundY;
  p.body.position.y = p.restY + e * 0.22;
  p.body.rotation.set(0.06 - e * 0.2, 0, 0);
  p.head.rotation.set(-0.35 - e * 0.15, 0, 0);
  for (const arm of p.arms) {
    aimHangChain(
      arm.root,
      arm.elbow,
      arm.side * (0.06 - e * 0.02),
      gy + 0.22 + e * 0.28,
      ARM_Z_FRONT + 0.55 - e * 0.2,
      arm.L1,
      arm.L2,
      -1
    );
  }
  for (const leg of p.legs) {
    aimHangChain(
      leg.root,
      leg.knee,
      leg.side * 0.12,
      gy + e * 0.2,
      LEG_Z_FRONT + e * 0.18,
      leg.L1,
      leg.L2,
      1
    );
  }
  swayHair(d, -e * 0.35);
  if (p.light) p.light.intensity = 1.4 * (1 - e);
}

/** Podřep, hlava nahoru dozadu, řev. */
function poseScream(d, u) {
  poseCrawl(d, 0, false, u);
  const p = d.mesh.userData.parts;
  p.body.position.y = p.restY - u * 0.16;
  p.body.rotation.x = 0.38 + u * 0.12;
  p.head.rotation.x = -0.12 - u * 1.05;
  p.head.rotation.y = 0;
  p.head.rotation.z = 0;
  for (const arm of p.arms) {
    arm.root.rotation.x = -0.35 - u * 0.15;
    arm.root.rotation.z = arm.side * (0.28 + u * 0.18);
    arm.elbow.rotation.x = 1.35 + u * 0.25;
  }
  for (const leg of p.legs) {
    leg.root.rotation.x = 0.95 + u * 0.2;
    leg.knee.rotation.x = 1.35 + u * 0.4;
  }
  swayHair(d, -u * 0.7);
  if (p.light) p.light.intensity = 1.35 + u * 0.6;
}

function poseMelt(d, u) {
  poseScream(d, 1);
  const p = d.mesh.userData.parts;
  p.body.position.y = p.restY - 0.16 - u * 0.22;
  p.body.rotation.x = 0.5 + u * 0.35;
  p.head.rotation.x = -1.17 + u * 0.25;
  for (const arm of p.arms) {
    arm.root.rotation.z = arm.side * (0.46 + u * 0.35);
    arm.elbow.rotation.x = 1.6;
  }
  for (const leg of p.legs) {
    leg.root.rotation.z = -leg.side * u * 0.4;
    leg.knee.rotation.x = 1.75;
  }
}

function setOpacity(d, a) {
  const p = d.mesh.userData.parts;
  for (const m of p.mats) {
    m.transparent = a < 0.98;
    m.opacity = a;
    if ("depthWrite" in m) m.depthWrite = a > 0.4;
  }
  if (p.light) p.light.intensity = 1.05 * a;
}

function holdPrey(prey, on) {
  if (!prey) return;
  if (on) {
    if (typeof prey.beginDemonHold === "function") prey.beginDemonHold();
    else {
      prey.demonHold = true;
      prey.charm = null;
    }
  } else if (typeof prey.endDemonHold === "function") {
    prey.endDemonHold();
  } else {
    prey.demonHold = false;
  }
}

function blackenPrey(prey) {
  const root = prey?.mesh;
  if (!root) return;
  root.traverse((ch) => {
    if (!ch.isMesh || !ch.material) return;
    const list = Array.isArray(ch.material) ? ch.material : [ch.material];
    for (let i = 0; i < list.length; i++) {
      const src = list[i];
      if (src.userData?._sharedHerd || src.userData?._demonTinted) {
        const cloned = src.clone();
        cloned.userData._demonTinted = true;
        if (Array.isArray(ch.material)) ch.material[i] = cloned;
        else ch.material = cloned;
        if (!prey._demonMats) prey._demonMats = [];
        prey._demonMats.push(cloned);
      }
    }
  });
  tintMeshBlack(root, CHAR_COLOR);
}

function hurtPrey(prey, fromDir) {
  if (!prey || prey.gone) return;
  if (typeof prey.takeDamage === "function") {
    prey.takeDamage(DAMAGE, { fromDir, knock: false, noSlide: true, force: true });
  }
  if (!prey.dead && typeof prey.die === "function") {
    prey.die({ fromDir, force: true, noSlide: true });
  }
  holdPrey(prey, false);
}

function playDemonSfx(d, id, opts = {}) {
  const listener = d.sys.getListenerDir?.();
  if (!listener || !d.sys.audio) return;
  d.sys.audio.playAt(id, d.dir, listener, opts);
}

function startRunLoop(d) {
  if (d.sfxRun?.alive) return;
  const listener = d.sys.getListenerDir?.();
  if (!listener || !d.sys.audio) return;
  const handle = d.sys.audio.startSfxLoop("demonRun", d.dir, listener);
  if (!handle) return;
  d.sfxRun = handle;
  d.sys._sfxLoops?.add(handle);
}

function stopRunLoop(d, fade = 0.18) {
  if (!d.sfxRun) return;
  d.sys._sfxLoops?.delete(d.sfxRun);
  d.sys.audio?.stopSfxLoop(d.sfxRun, fade);
  d.sfxRun = null;
}

function updateRunLoop(d, running) {
  if (!running) {
    stopRunLoop(d);
    return;
  }
  startRunLoop(d);
  const listener = d.sys.getListenerDir?.();
  if (d.sfxRun?.alive && listener) {
    d.sys.audio.updateSfxLoop(d.sfxRun, d.dir, listener);
  }
}

function facePrey(d, prey) {
  if (!prey?.dir) return;
  d.facing.copy(prey.dir).addScaledVector(d.dir, -prey.dir.dot(d.dir));
  if (d.facing.lengthSq() > 1e-8) d.facing.normalize();
}

function walkTo(d, goal, dt) {
  const moved = stepToward(d, goal, SPEED * dt);
  d.facing.copy(goal).addScaledVector(d.dir, -goal.dot(d.dir));
  if (d.facing.lengthSq() > 1e-8) d.facing.normalize();
  snap(d);
  poseCrawl(d, moved, moved > 1e-4);
  applyPose(d);
  return moved;
}

function refreshPuddle(terrain, mark) {
  if (!mark?.mesh?.geometry) return;
  const pos = mark.mesh.geometry.attributes.position;
  const lift = mark.lift;
  const cx = mark.centerDir[0];
  const cy = mark.centerDir[1];
  const cz = mark.centerDir[2];
  const ch = terrain.height({ x: cx, y: cy, z: cz });
  pos.setXYZ(0, cx * (ch + lift), cy * (ch + lift), cz * (ch + lift));
  const ring = mark.ringDirs;
  for (let i = 0; i < mark.segments; i++) {
    const j = i * 3;
    const h = terrain.height({ x: ring[j], y: ring[j + 1], z: ring[j + 2] });
    pos.setXYZ(i + 1, ring[j] * (h + lift), ring[j + 1] * (h + lift), ring[j + 2] * (h + lift));
  }
  pos.needsUpdate = true;
  mark.mesh.geometry.computeVertexNormals();
}

function spawnDemonPuddle(sys, dir, radiusM) {
  const centerDir = dir.clone().normalize();
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  tangentFrame(centerDir, east, north);
  const R = radiusM;
  const segments = 28;
  const lift = 0.04;
  const positions = [];
  const indices = [];
  const ringDirs = [];
  const ch = sys.terrain.height(centerDir);
  positions.push(centerDir.x * (ch + lift), centerDir.y * (ch + lift), centerDir.z * (ch + lift));
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const wobble =
      0.72 +
      0.16 * Math.sin(angle * 2.4 + 1.1) +
      0.1 * Math.sin(angle * 5.1 + 0.4) +
      0.08 * Math.sin(angle * 9.7 + 2.2);
    const d = surfaceOffsetDir(centerDir, east, north, angle, R * wobble, new THREE.Vector3());
    ringDirs.push(d.x, d.y, d.z);
    const h = sys.terrain.height(d);
    positions.push(d.x * (h + lift), d.y * (h + lift), d.z * (h + lift));
    indices.push(0, i + 1, i + 1 < segments ? i + 2 : 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const puddleMat = new THREE.MeshStandardMaterial({
    color: 0x060504,
    roughness: 0.22,
    metalness: 0.22,
    emissive: 0x080605,
    emissiveIntensity: 0.18,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geo, puddleMat);
  mesh.renderOrder = 1;
  sys.planetGroup.add(mesh);
  const mark = {
    mesh,
    mat: puddleMat,
    centerDir: [centerDir.x, centerDir.y, centerDir.z],
    ringDirs,
    lift,
    segments,
    refresh: refreshPuddle,
    cap: {
      x: centerDir.x,
      y: centerDir.y,
      z: centerDir.z,
      cos: Math.cos((R * 0.95) / CONFIG.planetR)
    }
  };
  if (!sys.scorchMarks) sys.scorchMarks = [];
  sys.scorchMarks.push(mark);
  sys.terrain?.scorch?.(centerDir, radiusM * 1.15, true);
  return mark;
}

export function spawnDemon(sys, targetDir) {
  const dir = targetDir.clone().normalize();
  const mesh = createDemonMesh();
  const facing = new THREE.Vector3();
  tangentFrame(dir, new THREE.Vector3(), facing);
  const d = {
    sys,
    mesh,
    dir,
    facing,
    prey: pickPrey(sys, dir),
    phase: "emerge",
    t: 0,
    huntT: 0,
    reachT: 0,
    morphT: 0,
    screamT: 0,
    meltT: 0,
    walkPhase: 0,
    puddle: null,
    _avoidSide: 0,
    _east: new THREE.Vector3(),
    _north: new THREE.Vector3(),
    _right: new THREE.Vector3(),
    _prev: new THREE.Vector3(),
    _axis: new THREE.Vector3(),
    _steerA: new THREE.Vector3(),
    _steerB: new THREE.Vector3(),
    _from: new THREE.Vector3(),
    _mat: new THREE.Matrix4(),
    sfxRun: null
  };
  sys.planetGroup.add(mesh);
  d.baseScale = mesh.userData.parts.worldScale;
  snap(d);
  poseCrawl(d, 0, false);
  applyPose(d);
  playDemonSfx(d, "demonEnter");
  if (!sys.demons) sys.demons = [];
  sys.demons.push(d);
  return d;
}

export function updateDemons(sys, dt) {
  const list = sys.demons;
  if (!list?.length) return;
  for (let i = list.length - 1; i >= 0; i--) {
    if (!tickDemon(list[i], dt)) {
      disposeDemon(sys, list[i]);
      list.splice(i, 1);
    }
  }
}

function beginScream(d) {
  d.phase = "scream";
  d.screamT = 0;
  holdPrey(d.prey, false);
  stopRunLoop(d);
  playDemonSfx(d, "demonDie");
}

function tickDemon(d, dt) {
  d.t += dt;
  if (d.phase === "emerge") {
    const u = Math.min(1, d.t / EMERGE);
    const e = u * u * (3 - 2 * u);
    d.mesh.scale.setScalar(d.baseScale);
    snap(d);
    d.mesh.position.addScaledVector(d.dir, (e - 1) * 1.35);
    const crawlOut = e > 0.35 ? SPEED * dt * 0.35 : 0;
    poseCrawl(d, crawlOut, crawlOut > 0);
    applyPose(d);
    if (u >= 1) {
      d.phase = "hunt";
      d.huntT = 0;
      d.prey = pickPrey(d.sys, d.dir);
    }
    return true;
  }

  if (d.phase === "hunt") {
    d.huntT += dt;
    if (!living(d.prey)) d.prey = pickPrey(d.sys, d.dir);
    const prey = d.prey;
    const chasing = !!(prey?.dir && living(prey));
    updateRunLoop(d, chasing);
    if (chasing) {
      if (surfaceDist(d.dir, prey.dir) <= CATCH_R) {
        d.phase = "reach";
        d.reachT = 0;
        stopRunLoop(d, 0.08);
        playDemonSfx(d, "demonKill");
        holdPrey(prey, true);
        poseReach(d, 0, 0);
        applyPose(d);
        return true;
      }
      walkTo(d, prey.dir, dt);
    } else {
      snap(d);
      poseCrawl(d, 0, false);
      applyPose(d);
    }
    if (d.huntT >= HUNT) beginScream(d);
    return true;
  }

  if (d.phase === "reach") {
    d.reachT += dt;
    const u = Math.min(1, d.reachT / REACH);
    const prey = d.prey;
    let moved = 0;
    if (prey?.dir) {
      moved = stepToward(d, prey.dir, SPEED * dt);
      facePrey(d, prey);
    }
    snap(d);
    poseReach(d, moved, u);
    applyPose(d);
    if (u >= 1) d.phase = "approach";
    return true;
  }

  if (d.phase === "approach") {
    const prey = d.prey;
    if (!prey?.dir || (!living(prey) && !prey.demonHold)) {
      beginScream(d);
      return true;
    }
    const dist = surfaceDist(d.dir, prey.dir);
    if (dist <= MERGE_R) {
      d.phase = "morph";
      d.morphT = 0;
      poseSoak(d, 0);
      applyPose(d);
      return true;
    }
    const moved = stepToward(d, prey.dir, SPEED * dt);
    facePrey(d, prey);
    snap(d);
    poseReach(d, moved, 1);
    applyPose(d);
    return true;
  }

  if (d.phase === "morph") {
    d.morphT += dt;
    const u = Math.min(1, d.morphT / MORPH);
    const e = u * u * (3 - 2 * u);
    const prey = d.prey;
    poseSoak(d, u);
    if (prey?.dir) {
      slerpDirection(d.dir, d.dir, prey.dir, Math.min(1, dt * 6));
      facePrey(d, prey);
    }
    snap(d);
    d.mesh.position.addScaledVector(d.dir, 0.2 + e * 0.85);
    d.mesh.scale.setScalar(d.baseScale * (1 - e * 0.94));
    setOpacity(d, 1 - e);
    applyPose(d);
    if (u >= BLACKEN_AT && prey && !d._blackened) {
      d._blackened = true;
      blackenPrey(prey);
    }
    if (u >= FALL_AT && prey && !d._hit) {
      d._hit = true;
      if (!d._blackened) {
        d._blackened = true;
        blackenPrey(prey);
      }
      hurtPrey(prey, d.dir);
    }
    return u < 1;
  }

  if (d.phase === "scream") {
    d.screamT += dt;
    const u = Math.min(1, d.screamT / SCREAM);
    snap(d);
    poseScream(d, u);
    applyPose(d);
    if (u >= 1) {
      d.phase = "melt";
      d.meltT = 0;
      d.puddle = spawnDemonPuddle(d.sys, d.dir, PUDDLE_R);
    }
    return true;
  }

  d.meltT += dt;
  const u = Math.min(1, d.meltT / MELT);
  const e = u * u * (3 - 2 * u);
  snap(d);
  poseMelt(d, e);
  d.mesh.scale.set(d.baseScale * (1 + e * 0.55), d.baseScale * (1 - e * 0.9), d.baseScale * (1 + e * 0.35));
  d.mesh.position.addScaledVector(d.dir, -e * 0.22);
  setOpacity(d, 1 - e);
  applyPose(d);
  if (d.puddle?.mat) d.puddle.mat.opacity = 0.92 * e;
  return u < 1;
}

function disposeDemon(sys, d) {
  if (!d?.mesh) return;
  holdPrey(d.prey, false);
  stopRunLoop(d, 0.05);
  sys.planetGroup.remove(d.mesh);
  const p = d.mesh.userData.parts;
  if (p?.light) p.light.dispose();
  for (const m of p?.mats || []) m.dispose();
  for (const g of p?.geos || []) g.dispose();
}

export function disposeDemons(sys) {
  const list = sys.demons;
  if (!list) return;
  for (const d of list) disposeDemon(sys, d);
  list.length = 0;
}
