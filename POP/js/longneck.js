import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame, surfaceOffsetDir, slerpDirection } from "./utils.js";
import { surfaceDist } from "./spells/fx-common.js";

const COUNT = 6;
const WALK_SPEED = 1.15;
const DODGE_DIST = 10;
const DODGE_DUR = 0.48;
const GRADE_MAX = 1.35;

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSphereDir(rng) {
  const u = rng();
  const v = rng();
  const theta = Math.PI * 2 * u;
  const z = 2 * v - 1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new THREE.Vector3(r * Math.cos(theta), z, r * Math.sin(theta));
}

function mat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.8,
    metalness: opts.metalness ?? 0.04
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

function cyl(geo, material, r, h, x, y, z) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.scale.set(r, h, r);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function canStand(terrain, dir) {
  return terrain.height(dir) >= CONFIG.wizardMinTerrainR + 0.04;
}

function isLandSpawn(terrain, dir, east, north) {
  const h = terrain.height(dir);
  if (h < CONFIG.waterLevel + 0.25) return false;
  const eps = 0.08;
  const t = dir.clone().addScaledVector(east, eps).normalize();
  const t2 = dir.clone().addScaledVector(north, eps).normalize();
  const grade = Math.max(Math.abs(terrain.height(t) - h), Math.abs(terrain.height(t2) - h)) / eps;
  return grade < GRADE_MAX;
}

/**
 * Zavalitý dvounohý prohlížeč — dlouhý krk, oči na stoncích, jí ze země i ze stromů.
 */
export function createLongneckMesh(mats, geos) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const S = geos.sphere;
  const C = geos.cyl;

  body.add(sph(S, mats.hide, 0.42, 0.38, 0.4, 0, 1.12, -0.04));
  body.add(sph(S, mats.belly, 0.58, 0.48, 0.52, 0, 0.78, 0.08));
  body.add(sph(S, mats.belly, 0.38, 0.28, 0.32, 0, 0.62, 0.28));
  body.add(sph(S, mats.hide, 0.22, 0.16, 0.18, 0, 1.38, 0.12));

  const hips = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.22, 0.72, 0.02);
    hip.add(cyl(C, mats.hide, 0.11, 0.42, 0, -0.22, 0));
    const shin = new THREE.Group();
    shin.position.set(0, -0.42, 0);
    shin.add(cyl(C, mats.dark, 0.09, 0.36, 0, -0.16, 0));
    shin.add(sph(S, mats.dark, 0.14, 0.07, 0.18, 0, -0.36, 0.05));
    hip.add(shin);
    body.add(hip);
    hips.push({ hip, shin, side });
  }

  const tail = new THREE.Group();
  tail.position.set(0, 0.85, -0.42);
  tail.add(sph(S, mats.hide, 0.14, 0.12, 0.22, 0, 0, -0.12));
  tail.add(sph(S, mats.sail, 0.08, 0.07, 0.16, 0, -0.02, -0.32));
  body.add(tail);

  const neck1 = new THREE.Group();
  neck1.position.set(0, 1.42, 0.22);
  neck1.add(sph(S, mats.hide, 0.14, 0.12, 0.22, 0, 0.06, 0.16));
  const neck2 = new THREE.Group();
  neck2.position.set(0, 0.08, 0.34);
  neck2.add(sph(S, mats.hide, 0.12, 0.11, 0.24, 0, 0.04, 0.16));
  const neck3 = new THREE.Group();
  neck3.position.set(0, 0.04, 0.36);
  neck3.add(sph(S, mats.hide, 0.11, 0.1, 0.22, 0, 0.03, 0.14));
  neck2.add(neck3);
  neck1.add(neck2);

  const head = new THREE.Group();
  head.position.set(0, 0.04, 0.32);
  head.add(sph(S, mats.hide, 0.16, 0.14, 0.18, 0, 0.02, 0.04));
  head.add(sph(S, mats.dark, 0.06, 0.05, 0.08, 0, -0.02, 0.16));
  head.add(sph(S, mats.belly, 0.05, 0.04, 0.1, 0, -0.06, 0.1));

  const stalks = [];
  const defs = [
    { x: -0.08, y: 0.12, z: 0.02, tilt: -0.32, h: 0.34 },
    { x: 0.08, y: 0.13, z: -0.02, tilt: 0.34, h: 0.38 },
    { x: 0.0, y: 0.16, z: 0.06, tilt: 0.04, h: 0.28 }
  ];
  for (const s of defs) {
    const g = new THREE.Group();
    g.position.set(s.x, s.y, s.z);
    g.rotation.z = s.tilt;
    g.add(cyl(C, mats.sail, 0.022, s.h, 0, s.h * 0.5, 0));
    g.add(sph(S, mats.eye, 0.05, 0.05, 0.05, 0, s.h + 0.02, 0.02));
    g.userData.tilt = s.tilt;
    head.add(g);
    stalks.push(g);
  }
  neck3.add(head);
  body.add(neck1);

  const bbox = new THREE.Box3().setFromObject(body);
  body.position.y -= bbox.min.y;
  bbox.setFromObject(body);
  const h = Math.max(0.4, bbox.max.y - bbox.min.y);
  root.scale.setScalar(2.35 / h);
  root.add(body);
  root.frustumCulled = false;
  root.userData.parts = { body, neck1, neck2, neck3, head, tail, hips, stalks };
  return root;
}

class Longneck {
  constructor(herd, id, dir, rng) {
    this.herd = herd;
    this.id = id;
    this.terrain = herd.terrain;
    this.rng = rng;
    this.mesh = createLongneckMesh(herd.mats, herd.geos);
    const size = 0.85 + rng() * 0.4;
    this.size = size;
    this.mesh.scale.multiplyScalar(size);
    herd.planetGroup.add(this.mesh);
    this.parts = this.mesh.userData.parts;

    this.dir = dir.clone().normalize();
    this.facing = new THREE.Vector3();
    this.targetDir = new THREE.Vector3();
    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._move = new THREE.Vector3();
    this._step = new THREE.Vector3();
    this._basisX = new THREE.Vector3();
    this._mat = new THREE.Matrix4();
    this._trial = new THREE.Vector3();
    this._from = new THREE.Vector3();
    this.phase = rng() * 80;
    this.walkPhase = rng() * Math.PI * 2;
    this.state = "wander";
    this.stateT = 1 + rng() * 2;
    this.neckPose = 0.12;
    this.neckTarget = 0.12;
    this.dodgeT = 0;
    this.dodgeCool = 0;
    this.dodgeHop = 0;
    this.treeDir = null;
    this.dead = false;

    tangentFrame(this.dir, this._east, this.facing);
    this.#pickWander();
    this.#applyPose();
  }

  #height() {
    return this.terrain.height(this.dir);
  }

  #snap(hop = 0) {
    this.mesh.position.copy(this.dir).multiplyScalar(this.#height() + hop);
  }

  #applyPose() {
    this.facing.addScaledVector(this.dir, -this.facing.dot(this.dir));
    if (this.facing.lengthSq() < 1e-8) tangentFrame(this.dir, this._east, this.facing);
    else this.facing.normalize();
    this._basisX.crossVectors(this.dir, this.facing).normalize();
    this.facing.crossVectors(this._basisX, this.dir).normalize();
    this._mat.makeBasis(this._basisX, this.dir, this.facing);
    this.mesh.quaternion.setFromRotationMatrix(this._mat);
    this.#snap(this.dodgeHop);
  }

  #pickWander() {
    tangentFrame(this.dir, this._east, this._north);
    const dist = 4 + this.rng() * 10;
    const ang = this.rng() * Math.PI * 2;
    surfaceOffsetDir(this.dir, this._east, this._north, ang, dist, this.targetDir);
    if (!canStand(this.terrain, this.targetDir)) {
      surfaceOffsetDir(this.dir, this._east, this._north, ang + Math.PI, dist * 0.7, this.targetDir);
    }
  }

  #stepToward(target, distM) {
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
    if (!canStand(this.terrain, this.dir)) {
      this.dir.applyAxisAngle(this._step.lengthSq() > 1e-12 ? this._step : this._east, -angle).normalize();
      return true;
    }
    this._move.copy(target).addScaledVector(this.dir, -this.dir.dot(target));
    if (this._move.lengthSq() > 1e-8) {
      this._move.normalize();
      slerpDirection(this.facing, this.facing, this._move, 0.22);
    }
    return omega <= angle + 1e-6;
  }

  #nearestTree() {
    const list = this.herd.trees?.placements;
    if (!list?.length) return null;
    let best = null;
    let bestD = 22;
    for (const p of list) {
      if (p.burning || p.charred) continue;
      const d = surfaceDist(this.dir, p.dir);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ? { p: best, dist: bestD } : null;
  }

  dodgeFrom(hazardDir) {
    if (this.dodgeT > 0 || this.dodgeCool > 0) return false;
    tangentFrame(this.dir, this._east, this._north);
    this._move.copy(hazardDir).addScaledVector(this.dir, -hazardDir.dot(this.dir));
    if (this._move.lengthSq() < 1e-8) tangentFrame(this.dir, this._east, this._move);
    else this._move.normalize().multiplyScalar(-1);
    const baseAng = Math.atan2(this._move.dot(this._north), this._move.dot(this._east));
    let found = null;
    for (const extra of [0, 0.5, -0.5, 1.0, -1.0, Math.PI]) {
      surfaceOffsetDir(this.dir, this._east, this._north, baseAng + extra, DODGE_DIST, this._trial);
      if (!canStand(this.terrain, this._trial)) continue;
      if (surfaceDist(this._trial, hazardDir) < surfaceDist(this.dir, hazardDir) + 3) continue;
      found = this._trial.clone();
      break;
    }
    if (!found) {
      surfaceOffsetDir(this.dir, this._east, this._north, baseAng, DODGE_DIST, this._trial);
      if (!canStand(this.terrain, this._trial)) return false;
      found = this._trial.clone();
    }
    this._from.copy(this.dir);
    this.targetDir.copy(found);
    this.dodgeT = DODGE_DUR;
    this.dodgeCool = 1.15;
    this.state = "dodge";
    this.neckTarget = -0.25;
    return true;
  }

  update(dt) {
    if (this.gone) return;
    this.phase += dt;
    if (this.dodgeCool > 0) this.dodgeCool -= dt;

    if (this.state === "dodge" && this.dodgeT > 0) {
      this.dodgeT -= dt;
      const u = 1 - Math.max(0, this.dodgeT) / DODGE_DUR;
      const ease = u * u * (3 - 2 * u);
      slerpDirection(this.dir, this._from, this.targetDir, ease);
      this._move.copy(this.targetDir).addScaledVector(this._from, -this.targetDir.dot(this._from));
      if (this._move.lengthSq() > 1e-8) slerpDirection(this.facing, this.facing, this._move.normalize(), 0.45);
      this.dodgeHop = Math.sin(u * Math.PI) * 1.55 * this.size;
      this.parts.body.rotation.x = Math.sin(u * Math.PI) * -0.22;
      if (this.dodgeT <= 0) {
        this.dodgeHop = 0;
        this.parts.body.rotation.x = 0;
        this.state = "wander";
        this.stateT = 1.2 + this.rng() * 2;
        this.#pickWander();
      }
      this.#poseNeck(dt);
      this.#applyPose();
      return;
    }

    this.dodgeHop = 0;
    this.stateT -= dt;
    let speed = 0;
    this.neckTarget = 0.1;

    if (this.state === "graze") {
      this.neckTarget = 1.05 + Math.sin(this.phase * 2.1) * 0.08;
      this.parts.head.rotation.y = Math.sin(this.phase * 1.4) * 0.2;
      if (this.stateT <= 0) {
        this.state = "wander";
        this.stateT = 2 + this.rng() * 3;
        this.#pickWander();
      }
    } else if (this.state === "browse") {
      const tree = this.treeDir;
      const dist = tree ? surfaceDist(this.dir, tree) : 99;
      const reach = 1.9 * this.size;
      if (!tree || dist > 16) {
        this.state = "wander";
        this.stateT = 1.5;
        this.treeDir = null;
      } else if (dist > reach) {
        speed = WALK_SPEED;
        this.targetDir.copy(tree);
        this.neckTarget = -0.15;
      } else {
        this.neckTarget = -0.72 + Math.sin(this.phase * 2.4) * 0.1;
        this.parts.head.rotation.y = Math.sin(this.phase * 1.8) * 0.18;
        speed = 0;
        if (this.stateT <= 0) {
          this.state = "wander";
          this.stateT = 2 + this.rng() * 3;
          this.treeDir = null;
          this.#pickWander();
        }
      }
    } else {
      speed = WALK_SPEED;
      if (this.stateT <= 0) {
        const r = this.rng();
        if (r < 0.38) {
          this.state = "graze";
          this.stateT = 2.4 + this.rng() * 2.8;
        } else if (r < 0.7) {
          const near = this.#nearestTree();
          if (near) {
            this.state = "browse";
            this.treeDir = near.p.dir;
            this.targetDir.copy(near.p.dir);
            this.stateT = 5 + this.rng() * 4;
          } else {
            this.#pickWander();
            this.stateT = 3 + this.rng() * 4;
          }
        } else {
          this.#pickWander();
          this.stateT = 3 + this.rng() * 5;
        }
      }
    }

    if (speed > 0) {
      const arrived = this.#stepToward(this.targetDir, speed * dt);
      this.walkPhase += dt * speed * 2.1;
      if (arrived && this.state === "wander") {
        this.state = "graze";
        this.stateT = 1.6 + this.rng() * 2;
      }
    }

    const gait = speed > 0.05 ? 1 : 0.12;
    for (const leg of this.parts.hips) {
      const swing = Math.sin(this.walkPhase + (leg.side > 0 ? 0 : Math.PI)) * 0.48 * gait;
      leg.hip.rotation.x = swing;
      leg.shin.rotation.x = Math.max(0, -swing) * 0.55 + 0.08;
    }
    this.parts.tail.rotation.y = Math.sin(this.phase * 1.3) * 0.22;
    if (this.state !== "browse" && this.state !== "graze") {
      this.parts.head.rotation.y *= 0.88;
    }
    this.#poseNeck(dt);
    this.#applyPose();
  }

  #poseNeck(dt) {
    this.neckPose += (this.neckTarget - this.neckPose) * Math.min(1, dt * 2.4);
    const p = this.parts;
    p.neck1.rotation.x = this.neckPose * 0.42;
    p.neck2.rotation.x = this.neckPose * 0.38;
    p.neck3.rotation.x = this.neckPose * 0.32;
    for (let i = 0; i < p.stalks.length; i++) {
      p.stalks[i].rotation.x = Math.sin(this.phase * 1.6 + i) * 0.16 + this.neckPose * 0.08;
      p.stalks[i].rotation.z = (p.stalks[i].userData.tilt || 0) + Math.sin(this.phase * 1.1 + i * 0.9) * 0.12;
    }
  }

  dispose() {
    this.herd.planetGroup.remove(this.mesh);
  }
}

export class LongneckHerd {
  constructor(planetGroup, terrain, seed = CONFIG.defaultMapSeed) {
    this.planetGroup = planetGroup;
    this.terrain = terrain;
    this.trees = null;
    this.seed = seed + 5519;
    this.list = [];
    this.geos = {
      sphere: new THREE.SphereGeometry(1, 12, 10),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 8)
    };
    this.mats = {
      hide: mat(0xb56a38),
      belly: mat(0xe8c478, { roughness: 0.72 }),
      sail: mat(0x7a4a2a, { roughness: 0.6 }),
      dark: mat(0x3a2418),
      eye: mat(0x66ddff, { emissive: 0x2299cc, emissiveIntensity: 0.8, roughness: 0.3 })
    };
    this.spawn();
  }

  spawn() {
    this.clear();
    const rng = mulberry32(this.seed);
    const east = new THREE.Vector3();
    const north = new THREE.Vector3();
    let guard = 0;
    while (this.list.length < COUNT && guard++ < 1400) {
      const dir = randomSphereDir(rng);
      tangentFrame(dir, east, north);
      if (!isLandSpawn(this.terrain, dir, east, north)) continue;
      const id = this.list.length;
      this.list.push(new Longneck(this, id, dir, mulberry32(this.seed + (id + 1) * 4409)));
    }
  }

  /** Odskočí z dosahu damage (~10 m). */
  dodgeNear(centerDir, radiusM) {
    if (!centerDir || radiusM <= 0) return false;
    let any = false;
    const reach = radiusM + 1.6;
    for (const c of this.list) {
      if (surfaceDist(c.dir, centerDir) > reach) continue;
      if (c.dodgeFrom(centerDir)) any = true;
    }
    return any;
  }

  /** Výbuch komety — v kráteru se odpaří, po okrajích uskočí. */
  blastNear(centerDir, vaporizeR, damageR) {
    if (!centerDir) return false;
    let any = false;
    for (const c of this.list) {
      if (c.gone) continue;
      const dist = surfaceDist(c.dir, centerDir);
      if (dist <= vaporizeR) {
        c.gone = true;
        c.mesh.visible = false;
        any = true;
      } else if (dist <= damageR + 1.6) {
        if (c.dodgeFrom(centerDir)) any = true;
      }
    }
    return any;
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
    for (const m of Object.values(this.mats)) m.dispose();
    for (const g of Object.values(this.geos)) g.dispose();
  }
}
