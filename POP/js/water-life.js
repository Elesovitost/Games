import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame, surfaceOffsetDir, slerpDirection } from "./utils.js";
import { mulberry32, bearingOf } from "./animalsAI.js";

/** Pod tímto počtem vertexů = jezírko, bez života. */
const TINY_VERTS = 70;
/** Velryby jen v největších plochách. */
const WHALE_VERTS = 420;
const AMOEBA_DEPTH = 0.5;
const AMOEBA_MAX = 56;
const FISH_MAX = 32;
const WHALE_MAX = 6;
/** Konzervativní velikost při výběru místa — ať se tam vejde i velký kus. */
const WHALE_SITE_SIZE = 1.15;
/** Nízká hodnota = velryba se otáčí pomalu a plynule, žádné trhavé obraty. */
const WHALE_TURN_K = 1.1;

function depthAt(terrain, dir) {
  return CONFIG.waterLevel - terrain.height(dir);
}

/**
 * Velryba potřebuje hlubokou vodu kolem trupu a volný výhled — jinak vleze
 * do zátoky, zasekne se a fitSubmerge ji začne házet nahoru/dolů.
 */
function whaleSiteOk(terrain, dir, size, east, north, trial) {
  const hullDown = 0.78 * size;
  const minD = hullDown + 1.35 * size;
  const d = depthAt(terrain, dir);
  if (d < minD || d > 14) return false;
  tangentFrame(dir, east, north);
  const need = hullDown + 0.55 * size;
  const span = 3.55 * size;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const r = k % 2 === 0 ? span : span * 0.55;
    surfaceOffsetDir(dir, east, north, a, r, trial);
    if (depthAt(terrain, trial) < need) return false;
  }
  const reach = Math.max(7.5, 5.5 + span);
  let open = 0;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    surfaceOffsetDir(dir, east, north, a, reach, trial);
    if (depthAt(terrain, trial) >= minD) open++;
  }
  return open >= 5;
}

function mat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.62,
    metalness: opts.metalness ?? 0.08
  });
  if (opts.emissive != null) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 0.65;
  }
  if (opts.opacity != null) {
    m.transparent = true;
    m.opacity = opts.opacity;
    m.depthWrite = opts.depthWrite ?? true;
  }
  return m;
}

function sph(geo, material, rx, ry, rz, x, y, z, shadow = true) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.scale.set(rx, ry, rz);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  return mesh;
}

function cyl(geo, material, r, h, x, y, z, shadow = true) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.scale.set(r, h, r);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  return mesh;
}

function buildNeighbors(indexAttr, count) {
  const n = new Array(count);
  for (let i = 0; i < count; i++) n[i] = [];
  for (let f = 0; f < indexAttr.count; f += 3) {
    const a = indexAttr.getX(f);
    const b = indexAttr.getX(f + 1);
    const c = indexAttr.getX(f + 2);
    n[a].push(b, c);
    n[b].push(a, c);
    n[c].push(a, b);
  }
  return n;
}

function vertDir(pos, i, out) {
  return out.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
}

/** Souvislé vodní plochy z terénu. */
export function findWaterBodies(terrain) {
  const pos = terrain.geometry.attributes.position;
  const idx = terrain.geometry.index;
  const n = pos.count;
  const W = CONFIG.waterLevel;
  const wet = new Uint8Array(n);
  const depths = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = W - Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
    depths[i] = d;
    wet[i] = d > 0.12 ? 1 : 0;
  }
  const nbr = buildNeighbors(idx, n);
  const seen = new Uint8Array(n);
  const bodies = [];
  const stack = [];
  const tmp = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    if (!wet[i] || seen[i]) continue;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    const verts = [];
    const shore = [];
    const deep = [];
    let maxDepth = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    while (stack.length) {
      const v = stack.pop();
      verts.push(v);
      const d = depths[v];
      if (d > maxDepth) maxDepth = d;
      vertDir(pos, v, tmp);
      cx += tmp.x;
      cy += tmp.y;
      cz += tmp.z;
      const list = nbr[v];
      let nearLand = false;
      for (let k = 0; k < list.length; k++) {
        const u = list[k];
        if (!wet[u]) nearLand = true;
        else if (!seen[u]) {
          seen[u] = 1;
          stack.push(u);
        }
      }
      if (nearLand && d > 0.38 && d < 2.35) shore.push(v);
      if (d > 2.4) deep.push(v);
    }
    const cl = Math.hypot(cx, cy, cz) || 1;
    bodies.push({
      verts,
      shore,
      deep,
      count: verts.length,
      maxDepth,
      centroid: new THREE.Vector3(cx / cl, cy / cl, cz / cl)
    });
  }
  bodies.sort((a, b) => b.count - a.count);
  return { bodies, pos };
}

function createAmoeba(geos, rng) {
  const hue = rng();
  const skin = mat(0xffffff, {
    roughness: 0.28,
    metalness: 0.12,
    emissive: 0xffffff,
    emissiveIntensity: 0.7
  });
  skin.color.setHSL(hue, 0.88, 0.52);
  skin.emissive.setHSL(hue, 0.95, 0.38);
  const core = mat(0xffffff, {
    roughness: 0.22,
    emissive: 0xffffff,
    emissiveIntensity: 1.1
  });
  core.color.setHSL((hue + 0.18) % 1, 1, 0.55);
  core.emissive.setHSL((hue + 0.18) % 1, 1, 0.48);

  const root = new THREE.Group();
  const blobs = [];
  const n = 5 + ((rng() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const sx = 0.07 + rng() * 0.13;
    const sy = sx * (0.7 + rng() * 0.45);
    const sz = sx * (0.75 + rng() * 0.4);
    const m = sph(geos.sphere, i === 0 ? core : skin, sx, sy, sz, (rng() - 0.5) * 0.22, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.22, false);
    root.add(m);
    blobs.push({
      mesh: m,
      s: sx,
      sy,
      sz,
      phase: rng() * Math.PI * 2,
      ox: m.position.x,
      oy: m.position.y,
      oz: m.position.z
    });
  }
  root.frustumCulled = false;
  return { mesh: root, mats: [skin, core], blobs, hue };
}

function createStalkFish(geos, rng) {
  const hue = 0.48 + rng() * 0.35;
  const hide = mat(0x2a8a7a, { roughness: 0.45, metalness: 0.18 });
  hide.color.setHSL(hue, 0.55, 0.38);
  const belly = mat(0xc8f0d8, { roughness: 0.5 });
  belly.color.setHSL(hue, 0.35, 0.62);
  const dark = mat(0x142028, { roughness: 0.4 });
  const eye = mat(0xffee88, { emissive: 0xffaa22, emissiveIntensity: 1.15, roughness: 0.25 });
  const S = geos.sphere;
  const C = geos.cyl;

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.add(sph(S, hide, 0.13, 0.1, 0.3, 0, 0.02, 0.04));
  body.add(sph(S, belly, 0.09, 0.055, 0.24, 0, -0.05, 0.04));
  body.add(sph(S, dark, 0.045, 0.03, 0.04, 0, -0.01, 0.28));
  body.add(sph(S, hide, 0.035, 0.1, 0.12, 0.11, 0.05, 0.02));
  body.add(sph(S, hide, 0.035, 0.1, 0.12, -0.11, 0.05, 0.02));
  const tail = sph(S, hide, 0.02, 0.12, 0.1, 0, 0.02, -0.34);
  body.add(tail);

  const stalks = [];
  const defs = [
    { x: -0.05, z: 0.2, h: 0.52, tilt: -0.18 },
    { x: 0.06, z: 0.16, h: 0.62, tilt: 0.22 },
    { x: 0.0, z: 0.26, h: 0.44, tilt: 0.05 }
  ];
  for (const s of defs) {
    const g = new THREE.Group();
    g.position.set(s.x, 0.08, s.z);
    g.rotation.z = s.tilt;
    g.add(cyl(C, hide, 0.018, s.h, 0, s.h * 0.5, 0, false));
    g.add(sph(S, eye, 0.055, 0.055, 0.055, 0, s.h + 0.02, 0.02, false));
    body.add(g);
    stalks.push({ g, h: s.h });
  }
  root.add(body);
  root.frustumCulled = false;
  return { mesh: root, mats: [hide, belly, dark, eye], body, tail, stalks };
}

function createWhale(geos, rng) {
  const hide = mat(0x3a4a62, { roughness: 0.78, metalness: 0.12 });
  hide.color.setHSL(0.58 + rng() * 0.08, 0.28, 0.28 + rng() * 0.08);
  const plate = mat(0x2a3344, { roughness: 0.86 });
  const belly = mat(0x8aa0a8, { roughness: 0.7 });
  const eye = mat(0xa8ff66, { emissive: 0x66ff22, emissiveIntensity: 0.9, roughness: 0.3 });
  const S = geos.sphere;
  const C = geos.cyl;

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.add(sph(S, hide, 1.05, 0.7, 2.55, 0, 0.08, 0.15));
  body.add(sph(S, belly, 0.82, 0.32, 2.15, 0, -0.42, 0.1));
  for (let i = 0; i < 5; i++) {
    body.add(sph(S, plate, 0.28 - i * 0.02, 0.14, 0.32, 0, 0.72, 1.35 - i * 0.7));
  }
  const head = new THREE.Group();
  head.position.set(0, 0.12, 2.45);
  head.add(sph(S, hide, 0.88, 0.62, 1.05, 0, 0.04, 0.15));
  head.add(sph(S, belly, 0.65, 0.22, 0.78, 0, -0.38, 0.1));
  head.add(sph(S, plate, 0.22, 0.28, 0.22, 0.42, 0.28, 0.55));
  head.add(sph(S, plate, 0.22, 0.28, 0.22, -0.42, 0.28, 0.55));

  const stalks = [];
  const sdefs = [
    { x: -0.38, y: 0.52, z: 0.28, h: 0.9, tilt: -0.25 },
    { x: 0.38, y: 0.54, z: 0.22, h: 1.05, tilt: 0.28 },
    { x: 0.0, y: 0.62, z: 0.48, h: 0.72, tilt: 0.0 }
  ];
  for (const s of sdefs) {
    const g = new THREE.Group();
    g.position.set(s.x, s.y, s.z);
    g.rotation.z = s.tilt;
    g.add(cyl(C, plate, 0.055, s.h, 0, s.h * 0.5, 0));
    g.add(sph(S, eye, 0.15, 0.15, 0.15, 0, s.h + 0.05, 0.04));
    head.add(g);
    stalks.push({ g, tilt: s.tilt });
  }
  body.add(head);
  body.add(sph(S, hide, 0.18, 0.55, 0.85, 1.05, -0.08, 0.45));
  body.add(sph(S, hide, 0.18, 0.55, 0.85, -1.05, -0.08, 0.45));
  const tail = new THREE.Group();
  tail.position.set(0, 0.02, -2.35);
  tail.add(sph(S, hide, 0.38, 0.32, 0.85, 0, 0, -0.35));
  tail.add(sph(S, hide, 1.25, 0.1, 0.42, 0, 0.04, -1.05));
  body.add(tail);
  root.add(body);
  root.frustumCulled = false;
  root.scale.setScalar(1.02);
  return {
    mesh: root,
    mats: [hide, plate, belly, eye],
    body,
    head,
    tail,
    stalks,
    hullHalfLen: 3.55,
    hullHalfW: 1.15,
    hullDown: 0.78,
    hullUp: 0.82
  };
}

class WaterCritter {
  constructor(life, kind, dir, rng, built) {
    this.life = life;
    this.terrain = life.terrain;
    this.kind = kind;
    this.rng = rng;
    this.mesh = built.mesh;
    this.mats = built.mats;
    this.parts = built;
    life.planetGroup.add(this.mesh);

    const size = 0.25 + rng() * 1;
    this.size = size;
    this.mesh.scale.multiplyScalar(size);

    this.dir = dir.clone().normalize();
    this.facing = new THREE.Vector3();
    this.targetDir = new THREE.Vector3();
    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._basisX = new THREE.Vector3();
    this._mat = new THREE.Matrix4();
    this._step = new THREE.Vector3();
    this._trial = new THREE.Vector3();
    this._move = new THREE.Vector3();
    this._prev = new THREE.Vector3();
    this._world = new THREE.Vector3();
    this._probe = new THREE.Vector3();
    this._stuckDir = new THREE.Vector3();
    this.phase = rng() * 100;
    this.stateT = 1 + rng() * 4;
    this.submerge = kind === "amoeba" ? AMOEBA_DEPTH * size : kind === "fish" ? 0.24 * size : 2.2 * size;
    this.mode = "cruise";
    /** Kratší úvodní plavba v hloubce — vynořuje se dřív a pak i častěji. */
    this.modeT = 5 + rng() * 6;
    this.hue = built.hue ?? rng();
    this.hullHalfLen = (built.hullHalfLen ?? 0.35) * size;
    this.hullHalfW = (built.hullHalfW ?? 0.2) * size;
    this.hullDown = (built.hullDown ?? 0.12) * size;
    this._stuckT = 0;

    tangentFrame(this.dir, this._east, this.facing);
    if (kind === "whale" && !this.#ok(this.dir)) this.#relocate();
    this._stuckDir.copy(this.dir);
    this.#pickTarget();
    this.#applyPose();
  }

  #minDepth() {
    const s = this.size;
    if (this.kind === "amoeba") return 0.42 * s;
    if (this.kind === "fish") return 0.35 * s;
    return this.hullDown + 1.35 * s;
  }

  #maxDepth() {
    if (this.kind === "amoeba") return 2.25;
    if (this.kind === "fish") return 8;
    return 14;
  }

  #ok(dir) {
    const d = depthAt(this.terrain, dir);
    if (d < this.#minDepth() || d > this.#maxDepth()) return false;
    if (this.kind !== "whale") return true;
    return whaleSiteOk(this.terrain, dir, this.size, this._east, this._north, this._probe);
  }

  #hullClear(dir, facing, submerge, margin = 0.28 * this.size) {
    facing.addScaledVector(dir, -facing.dot(dir));
    if (facing.lengthSq() < 1e-8) tangentFrame(dir, this._east, facing);
    else facing.normalize();
    this._basisX.crossVectors(dir, facing).normalize();
    const originR = CONFIG.waterLevel - submerge;
    this._world.copy(dir).multiplyScalar(originR);
    const L = this.hullHalfLen;
    const W = this.hullHalfW;
    const D = this.hullDown;
    const pts = [
      [0, -D, 0],
      [0, -D, L * 0.92],
      [0, -D, -L * 0.92],
      [0, -D, L * 0.45],
      [0, -D, -L * 0.45],
      [W * 0.75, -D * 0.75, 0],
      [-W * 0.75, -D * 0.75, 0],
      [W * 0.45, -D * 0.7, L * 0.5],
      [-W * 0.45, -D * 0.7, L * 0.5],
      [W * 0.4, -D * 0.65, -L * 0.5],
      [-W * 0.4, -D * 0.65, -L * 0.5]
    ];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      this._trial.copy(this._world)
        .addScaledVector(this._basisX, p[0])
        .addScaledVector(dir, p[1])
        .addScaledVector(facing, p[2]);
      const len = this._trial.length();
      if (len < 1e-5) continue;
      this._trial.multiplyScalar(1 / len);
      if (len < this.terrain.height(this._trial) + margin) return false;
    }
    return true;
  }

  #fitSubmerge(desired) {
    const s0 = this.size;
    const cap = depthAt(this.terrain, this.dir) - this.hullDown - 0.32 * s0;
    let s = Math.min(desired, Math.max(0.3 * s0, cap));
    if (this.#hullClear(this.dir, this.facing, s)) return s;
    for (let k = 0; k < 16; k++) {
      s -= 0.12 * s0;
      if (s < 0.28 * s0) break;
      if (this.#hullClear(this.dir, this.facing, s)) return s;
    }
    return Math.max(0.28 * s0, Math.min(desired, cap));
  }

  #pickTarget() {
    tangentFrame(this.dir, this._east, this._north);
    const dist = this.kind === "whale"
      ? 9 + this.rng() * 16
      : this.kind === "fish"
        ? 4 + this.rng() * 9
        : 2 + this.rng() * 5;
    if (this.kind === "whale") {
      /** Vějíř kolem aktuálního směru plavání — žádné náhlé obraty o 90°/180°. */
      const curAng = bearingOf(this.facing, this._east, this._north);
      const spread = Math.PI * 0.4;
      let bestD = -1;
      let found = false;
      for (let k = 0; k < 12; k++) {
        const ang = curAng + ((k / 11) * 2 - 1) * spread + (this.rng() - 0.5) * 0.15;
        const dlen = dist * (0.5 + this.rng() * 0.7);
        surfaceOffsetDir(this.dir, this._east, this._north, ang, dlen, this._trial);
        if (!this.#ok(this._trial)) continue;
        const d = depthAt(this.terrain, this._trial);
        if (d > bestD) {
          bestD = d;
          this.targetDir.copy(this._trial);
          found = true;
        }
      }
      if (found) return;
      /** Slepá ulička v předním vějíři — výjimečně dovol i širší ohled. */
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2 + this.rng() * 0.22;
        const dlen = dist * (0.5 + this.rng() * 0.7);
        surfaceOffsetDir(this.dir, this._east, this._north, ang, dlen, this._trial);
        if (!this.#ok(this._trial)) continue;
        const d = depthAt(this.terrain, this._trial);
        if (d > bestD) {
          bestD = d;
          this.targetDir.copy(this._trial);
          found = true;
        }
      }
      if (found) return;
    } else {
      for (let k = 0; k < 10; k++) {
        const ang = this.rng() * Math.PI * 2;
        surfaceOffsetDir(this.dir, this._east, this._north, ang, dist, this.targetDir);
        if (this.#ok(this.targetDir)) return;
      }
    }
    surfaceOffsetDir(this.dir, this._east, this._north, this.rng() * Math.PI * 2, dist * 0.4, this.targetDir);
  }

  #stepToward(target, distM, dt = 0.016, turnK = 5) {
    this._prev.copy(this.dir);
    const dot = Math.min(1, Math.max(-1, this.dir.dot(target)));
    const omega = Math.acos(dot);
    if (omega < 1e-8) return true;
    const angle = Math.min(omega, distM / CONFIG.planetR);
    this._step.crossVectors(this.dir, target);
    if (this._step.lengthSq() < 1e-12) this.dir.copy(target);
    else {
      this._step.normalize();
      this.dir.applyAxisAngle(this._step, angle).normalize();
    }
    if (!this.#ok(this.dir)) {
      this.dir.copy(this._prev);
      return false;
    }
    this._move.copy(target).addScaledVector(this.dir, -this.dir.dot(target));
    if (this._move.lengthSq() > 1e-8) {
      this._move.normalize();
      slerpDirection(this.facing, this.facing, this._move, 1 - Math.exp(-dt * turnK));
    }
    return omega <= angle + 1e-6;
  }

  #applyPose() {
    this.facing.addScaledVector(this.dir, -this.facing.dot(this.dir));
    if (this.facing.lengthSq() < 1e-8) tangentFrame(this.dir, this._east, this.facing);
    else this.facing.normalize();
    this._basisX.crossVectors(this.dir, this.facing).normalize();
    this.facing.crossVectors(this._basisX, this.dir).normalize();
    this._mat.makeBasis(this._basisX, this.dir, this.facing);
    const r = CONFIG.waterLevel - this.submerge;
    this.mesh.position.copy(this.dir).multiplyScalar(r);
    this.mesh.quaternion.setFromRotationMatrix(this._mat);
    this.mesh.visible = depthAt(this.terrain, this.dir) > 0.2;
  }

  #relocate() {
    tangentFrame(this.dir, this._east, this._north);
    let best = null;
    let bestD = -1;
    const radii = [3.2, 5.5, 8, 12, 18, 28];
    for (let r = 0; r < radii.length; r++) {
      const rad = radii[r];
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        surfaceOffsetDir(this.dir, this._east, this._north, ang, rad, this._trial);
        if (!this.#ok(this._trial)) continue;
        const d = depthAt(this.terrain, this._trial);
        if (d > bestD) {
          bestD = d;
          if (!best) best = this._world;
          best.copy(this._trial);
        }
      }
      if (best && bestD > this.#minDepth() + 1.4) break;
    }
    if (best) {
      this.dir.copy(best);
      return;
    }
    const haven = this.life.pickWhaleHaven?.(this.rng);
    if (haven) this.dir.copy(haven);
  }

  #nudgeToDeep(dt) {
    tangentFrame(this.dir, this._east, this._north);
    let bestD = depthAt(this.terrain, this.dir);
    let found = false;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      surfaceOffsetDir(this.dir, this._east, this._north, a, 3.4, this._trial);
      if (!this.#ok(this._trial)) continue;
      const d = depthAt(this.terrain, this._trial);
      if (d > bestD + 0.08) {
        bestD = d;
        this.targetDir.copy(this._trial);
        found = true;
      }
    }
    if (!found) return false;
    /** Voláno jen pro velryby (uvíznutí na cestě) — stejné pomalé otáčení jako jinde. */
    this.#stepToward(this.targetDir, 0.7 * dt, dt, WHALE_TURN_K);
    return true;
  }

  update(dt) {
    this.phase += dt;
    if (!this.#ok(this.dir)) this.#relocate();

    if (this.kind === "whale") this.#updateWhale(dt);
    else if (this.kind === "fish") this.#updateFish(dt);
    else this.#updateAmoeba(dt);

    this.#applyPose();
  }

  #updateAmoeba(dt) {
    this.submerge = AMOEBA_DEPTH * this.size + Math.sin(this.phase * 1.4) * 0.06 * this.size;
    this.stateT -= dt;
    const speed = 0.22 + Math.sin(this.phase * 0.7) * 0.06;
    if (this.#stepToward(this.targetDir, speed * dt, dt) || this.stateT <= 0) {
      this.#pickTarget();
      this.stateT = 2.5 + this.rng() * 3.5;
    }
    this.hue = (this.hue + dt * 0.07) % 1;
    const skin = this.mats[0];
    const core = this.mats[1];
    skin.color.setHSL(this.hue, 0.88, 0.52);
    skin.emissive.setHSL(this.hue, 0.95, 0.38);
    core.color.setHSL((this.hue + 0.18) % 1, 1, 0.55);
    core.emissive.setHSL((this.hue + 0.18) % 1, 1, 0.48);
    for (const b of this.parts.blobs) {
      const w = 1 + Math.sin(this.phase * 2.4 + b.phase) * 0.28;
      b.mesh.scale.set(b.s * w, (b.sy ?? b.s) * w, (b.sz ?? b.s) * w);
      b.mesh.position.set(
        b.ox + Math.sin(this.phase * 1.6 + b.phase) * 0.03,
        b.oy + Math.cos(this.phase * 1.9 + b.phase) * 0.025,
        b.oz + Math.sin(this.phase * 1.3 + b.phase * 1.4) * 0.03
      );
    }
  }

  #updateFish(dt) {
    this.submerge = 0.22 * this.size + Math.sin(this.phase * 1.1) * 0.05 * this.size;
    this.stateT -= dt;
    const speed = 0.42;
    if (this.#stepToward(this.targetDir, speed * dt, dt) || this.stateT <= 0) {
      this.#pickTarget();
      this.stateT = 3 + this.rng() * 5;
    }
    const body = this.parts.body;
    body.rotation.y = Math.sin(this.phase * 3.2) * 0.18;
    body.position.y = Math.sin(this.phase * 2.1) * 0.03;
    this.parts.tail.rotation.y = Math.sin(this.phase * 6.2) * 0.55;
    for (let i = 0; i < this.parts.stalks.length; i++) {
      const s = this.parts.stalks[i];
      s.g.rotation.x = Math.sin(this.phase * 1.15 + i * 1.3) * 0.22;
      s.g.rotation.z = Math.sin(this.phase * 0.85 + i) * 0.28;
    }
  }

  #updateWhale(dt) {
    this.modeT -= dt;
    let desired = this.submerge;
    this._world.copy(this.dir);
    if (this.mode === "cruise") {
      desired = (2.05 + Math.sin(this.phase * 0.35) * 0.12) * this.size;
      const arrived = this.#stepToward(this.targetDir, 0.6 * dt, dt, WHALE_TURN_K);
      if (arrived) this.#pickTarget();
      else if (this.dir.dot(this._world) > 0.99998) this.#nudgeToDeep(dt);
      if (this.modeT <= 0) {
        this.mode = "rise";
        this.modeT = 3.6;
      }
    } else if (this.mode === "rise") {
      const u = 1 - this.modeT / 3.6;
      desired = THREE.MathUtils.lerp(2.1, 0.5, u * u * (3 - 2 * u)) * this.size;
      this.#stepToward(this.targetDir, 0.22 * dt, dt, WHALE_TURN_K);
      if (this.modeT <= 0) {
        this.mode = "look";
        this.modeT = 4.5 + this.rng() * 3;
      }
    } else if (this.mode === "look") {
      desired = (0.48 + Math.sin(this.phase * 0.9) * 0.06) * this.size;
      const head = this.parts.head;
      head.rotation.y = Math.sin(this.phase * 0.55) * 0.55;
      head.rotation.x = Math.sin(this.phase * 0.4) * 0.12;
      if (this.modeT <= 0) {
        this.mode = "dive";
        this.modeT = 3.8;
        this.#pickTarget();
      }
    } else {
      const u = 1 - this.modeT / 3.8;
      desired = THREE.MathUtils.lerp(0.5, 2.15, u * u * (3 - 2 * u)) * this.size;
      this.#stepToward(this.targetDir, 0.4 * dt, dt, WHALE_TURN_K);
      this.parts.head.rotation.y *= 1 - dt * 2;
      this.parts.head.rotation.x *= 1 - dt * 2;
      if (this.modeT <= 0) {
        this.mode = "cruise";
        /** Kratší plavba v hloubce — vynořuje se častěji než dřív. */
        this.modeT = 7 + this.rng() * 7;
      }
    }

    /**
     * "Uvíznutí" má smysl testovat jen v cruise — v rise/look/dive stojí
     * (nebo skoro stojí) na místě zcela záměrně, to není uvíznutí. Práh
     * odpovídá jen ~0,5 m posunu, ať i pomalé plavání test spolehlivě
     * vynuluje a nedojde k falešnému "teleportu" na nové místo.
     */
    if (this.mode === "cruise") {
      if (this.dir.dot(this._stuckDir) > 0.99998) this._stuckT += dt;
      else {
        this._stuckT = 0;
        this._stuckDir.copy(this.dir);
      }
      if (this._stuckT > 2.4) {
        this.#relocate();
        this.#pickTarget();
        this.mode = "cruise";
        this.modeT = 10 + this.rng() * 8;
        this._stuckT = 0;
        this._stuckDir.copy(this.dir);
      }
    } else {
      this._stuckT = 0;
      this._stuckDir.copy(this.dir);
    }

    const fitted = this.#fitSubmerge(desired);
    const k = 1 - Math.exp(-dt * 3.2);
    this.submerge += (fitted - this.submerge) * k;
    if ((this.mode === "rise" || this.mode === "look") && this.submerge > 1.15 * this.size) {
      this.mode = "cruise";
      this.modeT = 5 + this.rng() * 5;
      this.#pickTarget();
    }

    this.parts.body.rotation.x = Math.sin(this.phase * 0.7) * 0.04;
    this.parts.tail.rotation.y = Math.sin(this.phase * 1.15) * (this.mode === "look" ? 0.12 : 0.28);
    const look = this.mode === "look" ? 1 : 0.25;
    for (let i = 0; i < this.parts.stalks.length; i++) {
      const s = this.parts.stalks[i];
      s.g.rotation.x = Math.sin(this.phase * 0.9 + i * 1.1) * 0.35 * look;
      s.g.rotation.z = s.tilt + Math.sin(this.phase * 0.7 + i) * 0.4 * look;
    }
  }

  dispose() {
    this.life.planetGroup.remove(this.mesh);
    for (const m of this.mats) m.dispose();
  }
}

export class WaterLife {
  constructor(planetGroup, terrain, seed = CONFIG.defaultMapSeed) {
    this.planetGroup = planetGroup;
    this.terrain = terrain;
    this.seed = seed + 3301;
    this.list = [];
    this.whaleHavens = [];
    this._havenEast = new THREE.Vector3();
    this._havenNorth = new THREE.Vector3();
    this._havenTrial = new THREE.Vector3();
    this.geos = {
      sphere: new THREE.SphereGeometry(1, 14, 12),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 8)
    };
    this.spawn();
  }

  spawn() {
    this.clear();
    this.whaleHavens = [];
    const rng = mulberry32(this.seed);
    const { bodies, pos } = findWaterBodies(this.terrain);
    const tmp = new THREE.Vector3();
    let nA = 0;
    let nF = 0;
    let nW = 0;

    for (const body of bodies) {
      if (body.count < TINY_VERTS) continue;
      const lakes = body.count >= WHALE_VERTS;

      const amoebaPool = body.shore.length ? body.shore : body.verts;
      const amoebaWant = Math.min(10, Math.max(4, (amoebaPool.length / 11) | 0));
      for (let i = 0; i < amoebaWant && nA < AMOEBA_MAX && amoebaPool.length; i++) {
        const vi = amoebaPool[(rng() * amoebaPool.length) | 0];
        vertDir(pos, vi, tmp);
        if (depthAt(this.terrain, tmp) > 2.4) continue;
        this.list.push(new WaterCritter(this, "amoeba", tmp, mulberry32(this.seed + nA * 911), createAmoeba(this.geos, rng)));
        nA++;
      }

      const fishWant = lakes ? 8 : 6;
      const pool = body.verts;
      for (let i = 0; i < fishWant && nF < FISH_MAX && pool.length; i++) {
        let dir = null;
        for (let t = 0; t < 12; t++) {
          const vi = pool[(rng() * pool.length) | 0];
          vertDir(pos, vi, tmp);
          const d = depthAt(this.terrain, tmp);
          if (d > 0.5 && d < 6) {
            dir = tmp.clone();
            break;
          }
        }
        if (!dir) continue;
        this.list.push(new WaterCritter(this, "fish", dir, mulberry32(this.seed + 4000 + nF * 773), createStalkFish(this.geos, rng)));
        nF++;
      }

      if (!lakes || nW >= WHALE_MAX || body.maxDepth < 4.2) continue;
      const deep = body.deep.length ? body.deep : body.verts;
      for (let i = 0; i < deep.length && this.whaleHavens.length < 28; i += Math.max(1, (deep.length / 12) | 0)) {
        vertDir(pos, deep[i], tmp);
        if (!whaleSiteOk(this.terrain, tmp, WHALE_SITE_SIZE, this._havenEast, this._havenNorth, this._havenTrial)) continue;
        this.whaleHavens.push(tmp.clone());
      }
      const whaleWant = Math.min(2, WHALE_MAX - nW);
      for (let w = 0; w < whaleWant; w++) {
        let wdir = null;
        for (let t = 0; t < 28; t++) {
          const vi = deep[(rng() * deep.length) | 0];
          vertDir(pos, vi, tmp);
          if (depthAt(this.terrain, tmp) <= 3.6) continue;
          if (!whaleSiteOk(this.terrain, tmp, WHALE_SITE_SIZE, this._havenEast, this._havenNorth, this._havenTrial)) continue;
          wdir = tmp.clone();
          break;
        }
        if (!wdir) break;
        this.list.push(new WaterCritter(this, "whale", wdir, mulberry32(this.seed + 9000 + nW * 421), createWhale(this.geos, rng)));
        nW++;
      }
    }
  }

  pickWhaleHaven(rng) {
    if (!this.whaleHavens.length) return null;
    return this.whaleHavens[(rng() * this.whaleHavens.length) | 0];
  }

  clear() {
    for (const c of this.list) c.dispose();
    this.list.length = 0;
  }

  update(dt) {
    for (const c of this.list) c.update(dt);
  }

  dispose() {
    this.clear();
    this.geos.sphere.dispose();
    this.geos.cyl.dispose();
  }
}
