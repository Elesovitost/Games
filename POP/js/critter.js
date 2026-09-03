import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame, surfaceOffsetDir, slerpDirection } from "./utils.js";
import { surfaceDist } from "./spells/fx-common.js";
import { BURN_DURATION, CHAR_COLOR, attachFireQueued, tintMeshBlack, setBurnGlow } from "./burn.js";
import {
  mulberry32,
  randomSphereDir,
  isLand as isLandAI,
  isWaterAt,
  terrainGrade,
  stepToward as stepTowardAI,
  turnFacingToward,
  pickWanderTarget,
  bearingOf
} from "./animalsAI.js";

const COUNT = 16;
const WALK_SPEED = 0.7;
const FLEE_SPEED = 4.2;
const FLEE_START = 6.5;
const FLEE_STOP = 13;
const LAND_MARGIN = 0.35;
const GRADE_MAX = 1.15;
const MIN_R = CONFIG.wizardMinTerrainR + 0.05;
/** Plave o něco pomaleji než panický útěk po souši, ale svižně. */
const SWIM_SPEED = 3;
/** Jak daleko od aktuálního místa se míří při plavání rovně — dost na
 * přeplavání i většího jezera, ať se cíl nemusí každý snímek přepočítávat. */
const SWIM_AIM_DIST = 80;

function mat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.82,
    metalness: opts.metalness ?? 0.04
  });
  if (opts.emissive != null) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 0.7;
  }
  m.userData._sharedHerd = true;
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

/**
 * Mimozemský "trojnohý šnekokrak" — zploštělé tělo, šroubovitý krk,
 * tři oční stonky, hřbetní plachty a šest nestejných nohou.
 */
export function createCritterMesh(mats, geos) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const S = geos.sphere;
  const C = geos.cyl;
  const N = geos.cone;

  body.add(sph(S, mats.hide, 0.38, 0.22, 0.52, 0, 0.42, 0.04));
  body.add(sph(S, mats.belly, 0.3, 0.1, 0.44, 0, 0.24, 0.06));
  body.add(sph(S, mats.hide, 0.12, 0.14, 0.12, 0.32, 0.52, -0.1));
  body.add(sph(S, mats.sail, 0.1, 0.16, 0.1, -0.3, 0.56, 0.14));

  const sails = [];
  for (let i = 0; i < 5; i++) {
    const sail = new THREE.Mesh(N, mats.sail);
    const h = 0.38 + (i % 2) * 0.1;
    sail.scale.set(0.09, h, 0.14);
    sail.position.set(0, 0.58 + h * 0.35, -0.28 + i * 0.16);
    sail.rotation.z = (i - 2) * 0.18;
    sail.castShadow = true;
    body.add(sail);
    sails.push(sail);
  }

  const neck = new THREE.Group();
  neck.position.set(0, 0.5, 0.46);
  neck.add(sph(S, mats.hide, 0.1, 0.09, 0.2, 0, 0.04, 0.14));
  const neck2 = new THREE.Group();
  neck2.position.set(0, 0.02, 0.32);
  neck2.add(sph(S, mats.hide, 0.12, 0.1, 0.16, 0, 0.05, 0.1));
  neck.add(neck2);

  const head = new THREE.Group();
  head.position.set(0, 0.08, 0.28);
  head.add(sph(S, mats.hide, 0.2, 0.16, 0.18, 0, 0.05, 0.02));
  head.add(sph(S, mats.dark, 0.06, 0.08, 0.05, 0, 0.02, 0.16));
  head.add(sph(S, mats.belly, 0.05, 0.04, 0.12, 0, -0.06, 0.1));

  const stalks = [];
  const stalkDefs = [
    { x: -0.1, y: 0.18, z: 0.02, tilt: -0.35, h: 0.28 },
    { x: 0.1, y: 0.2, z: -0.04, tilt: 0.4, h: 0.3 },
    { x: 0.0, y: 0.24, z: 0.08, tilt: 0.05, h: 0.26 }
  ];
  for (const s of stalkDefs) {
    const g = new THREE.Group();
    g.position.set(s.x, s.y, s.z);
    g.rotation.z = s.tilt;
    g.add(cyl(C, mats.sail, 0.028, s.h, 0, s.h * 0.5, 0));
    const eye = sph(S, mats.eye, 0.055, 0.055, 0.055, 0, s.h + 0.02, 0.02);
    g.add(eye);
    head.add(g);
    stalks.push(g);
  }
  neck2.add(head);
  body.add(neck);

  const tail = new THREE.Group();
  tail.position.set(0, 0.36, -0.48);
  for (let i = 0; i < 4; i++) {
    const r = 0.09 - i * 0.012;
    const seg = sph(S, i % 2 ? mats.sail : mats.hide, r, r, r * 1.15, Math.sin(i * 0.9) * 0.07, Math.cos(i * 0.7) * 0.05, -i * 0.15);
    tail.add(seg);
  }
  body.add(tail);

  const legs = [];
  const hipZ = [-0.26, 0.04, 0.34];
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 3; k++) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.26, 0.3, hipZ[k]);
      const upper = cyl(C, mats.hide, 0.045, 0.26, 0, -0.12, 0);
      const shin = new THREE.Group();
      shin.position.set(0, -0.24, 0);
      shin.add(cyl(C, mats.dark, 0.036, 0.24, 0, -0.1, 0));
      shin.add(sph(S, mats.belly, 0.08, 0.04, 0.1, 0, -0.22, 0.03));
      hip.add(upper, shin);
      body.add(hip);
      legs.push({ hip, shin, side, k });
    }
  }

  const bbox = new THREE.Box3().setFromObject(body);
  body.position.y -= bbox.min.y;
  bbox.setFromObject(body);
  const h = Math.max(0.2, bbox.max.y - bbox.min.y);
  root.scale.setScalar(1.15 / h);
  /** Po otočení na bok (+Z rot) se z šířky stane výška — o tolik zvednout, ať neleží v zemi. */
  root.userData.lieLift = Math.max(0.14, -bbox.min.x);

  root.add(body);
  root.frustumCulled = false;
  root.userData.parts = { body, neck, neck2, head, tail, sails, stalks, legs };
  return root;
}

function isLand(terrain, dir) {
  return isLandAI(terrain, dir, LAND_MARGIN, MIN_R);
}

function isWalkable(terrain, dir, east, north) {
  if (!isLand(terrain, dir)) return false;
  return terrainGrade(terrain, dir, east, north) < GRADE_MAX;
}

class Critter {
  constructor(herd, id, dir, rng) {
    this.herd = herd;
    this.id = id;
    this.terrain = herd.terrain;
    this.mesh = createCritterMesh(herd.mats, herd.geos);
    const size = 0.25 + rng() * 1;
    this.mesh.scale.multiplyScalar(size);
    this.size = size;
    /** Přibl. polovina výšky těla (root je normalizovaný na 1.15×size) — pro plavání. */
    this.bodyHalfHeight = 0.575 * size;
    herd.planetGroup.add(this.mesh);
    this.parts = this.mesh.userData.parts;

    this.dir = dir.clone().normalize();
    this.facing = new THREE.Vector3();
    this.targetDir = new THREE.Vector3();
    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._move = new THREE.Vector3();
    this._step = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._basisX = new THREE.Vector3();
    this._mat = new THREE.Matrix4();
    this._yUp = new THREE.Vector3(0, 1, 0);
    this._trial = new THREE.Vector3();
    this._knockAway = new THREE.Vector3();
    this._knockAxis = new THREE.Vector3();
    this.lieLift = this.mesh.userData.lieLift ?? 0.28;
    this.tornado = null;
    this.diesOnTornadoLand = true;
    this.remote = false;
    this.godMode = false;
    this.burning = false;
    this.charred = false;
    this.burnT = 0;
    this._fire = null;
    this._burnMats = [];
    this._tornadoMoveMul = 1;
    this._tornadoPullSpeed = 0;
    this._tornadoPullDir = null;
    this._tornadoSource = null;

    tangentFrame(this.dir, this._east, this._north);
    this.facing.copy(this._north);
    this.phase = rng() * 100;
    this.neckX = 0.2;
    this.neckTarget = 0.2;
    this.dieT = 0;
    this.dead = false;
    this.slideLeft = 0;
    this.slideSpeed = 0;
    this.knockFrom = null;
    this.state = "wander";
    this.stateT = 0.4 + rng() * 1.2;
    this.walkPhase = rng() * Math.PI * 2;
    this.rng = rng;
    this.#pickWander();
    this.#snap();
    this.#applyPose();
  }

  #height() {
    return this.terrain.height(this.dir);
  }

  #snap() {
    if ((this.state === "flee" || this.state === "swim") && isWaterAt(this.terrain, this.dir)) {
      /** Ve vodě plove — ponoří se do poloviny výšky těla, zbytek čouhá nad hladinu. */
      this.mesh.position.copy(this.dir).multiplyScalar(CONFIG.waterLevel - this.bodyHalfHeight);
    } else {
      this.mesh.position.copy(this.dir).multiplyScalar(this.#height());
    }
  }

  #applyPose() {
    this.facing.addScaledVector(this.dir, -this.facing.dot(this.dir));
    if (this.facing.lengthSq() < 1e-8) {
      tangentFrame(this.dir, this._east, this.facing);
    } else {
      this.facing.normalize();
    }
    this._basisX.crossVectors(this.dir, this.facing).normalize();
    this.facing.crossVectors(this._basisX, this.dir).normalize();
    this._mat.makeBasis(this._basisX, this.dir, this.facing);
    this.mesh.quaternion.setFromRotationMatrix(this._mat);
  }

  #pickWander() {
    tangentFrame(this.dir, this._east, this._north);
    pickWanderTarget(this.dir, this._east, this._north, this.rng, 3.5, 12.5, (d) => isLand(this.terrain, d), this.targetDir);
  }

  /** Zamíří daleko rovně vpřed ve směru `facing` — použito při plavání. */
  #aimStraightAhead(distM) {
    tangentFrame(this.dir, this._east, this._north);
    const ang = bearingOf(this.facing, this._east, this._north);
    surfaceOffsetDir(this.dir, this._east, this._north, ang, distM, this.targetDir);
  }

  #enterSwim() {
    this.state = "swim";
    this.neckTarget = -0.1;
    this.#aimStraightAhead(SWIM_AIM_DIST);
  }

  #exitSwim() {
    this.state = "wander";
    this.stateT = 1.6 + this.rng() * 2.5;
    this.#pickWander();
  }

  #stepToward(target, distM, allowWater = false) {
    const walkable = allowWater ? null : (d) => isLand(this.terrain, d);
    const { arrived } = stepTowardAI(this.dir, target, distM, walkable, this._step);
    this.#snap();
    return arrived;
  }

  #nearestWizard(wizards) {
    let best = null;
    let bestD = Infinity;
    for (const w of wizards) {
      if (!w || w.dead) continue;
      if (w.invis && w.remote) continue;
      const d = surfaceDist(this.dir, w.dir);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    return { w: best, dist: bestD };
  }

  die(opts = {}) {
    if (this.dead) return false;
    if (this.tornado) this.endTornadoCapture();
    this.dead = true;
    this.state = "dead";
    this.dieT = 0;
    const atDir = opts.atDir;
    const fromDir = opts.fromDir;
    if (atDir) {
      this.dir.copy(atDir).normalize();
      this.#snap();
    }
    if (opts.vanish) {
      this.mesh.visible = false;
      this.vanished = true;
    }
    if (opts.ignite) this.ignite();
    if (opts.noSlide) {
      this.slideLeft = 0;
      this.slideSpeed = 0;
      this.#setKnockFrom(null);
    } else {
      this.#setKnockFrom(fromDir);
      if (this._knockAway.lengthSq() > 1e-8) {
        this.slideLeft = 2.4 + this.rng() * 1.4;
        this.slideSpeed = this.slideLeft / 0.52;
      } else {
        this.slideLeft = 0;
        this.slideSpeed = 0;
      }
    }
    if (!opts.fromNet) this.herd.onDied?.(this);
    return true;
  }

  ignite() {
    if (this.burning || this.charred) return;
    this.burning = true;
    this.burnT = 0;
    this.mesh.traverse((ch) => {
      if (!ch.isMesh || !ch.material) return;
      const src = ch.material;
      if (src.userData?._sharedHerd) {
        const cloned = src.clone();
        ch.material = cloned;
        this._burnMats.push(cloned);
      }
    });
    this._fire = attachFireQueued(this.mesh, { pad: 1.25 });
  }

  #charBody() {
    if (this.charred) return;
    this.charred = true;
    this.burning = false;
    if (this._fire) {
      this._fire.dispose();
      this._fire = null;
    }
    if (this._burnMats.length) {
      const col = new THREE.Color(CHAR_COLOR);
      for (const m of this._burnMats) {
        if (m.color) m.color.copy(col);
        if (m.emissive) {
          m.emissive.setHex(0x000000);
          m.emissiveIntensity = 0;
        }
        if ("roughness" in m) m.roughness = 0.97;
        m.needsUpdate = true;
      }
    } else {
      tintMeshBlack(this.mesh);
    }
  }

  #setKnockFrom(fromDir) {
    this.knockFrom = null;
    this._knockAway.set(0, 0, 0);
    if (!fromDir) return;
    const src = fromDir instanceof THREE.Vector3
      ? fromDir
      : new THREE.Vector3(fromDir[0], fromDir[1], fromDir[2]);
    if (src.lengthSq() < 1e-8) return;
    this.knockFrom = src.clone().normalize();
    this._knockAway.copy(this.knockFrom).addScaledVector(this.dir, -this.knockFrom.dot(this.dir));
    if (this._knockAway.lengthSq() < 1e-8) {
      tangentFrame(this.dir, this._east, this._knockAway);
    } else {
      this._knockAway.normalize();
    }
    this._knockAway.negate();
    this.facing.crossVectors(this.dir, this._knockAway);
    if (this.facing.lengthSq() < 1e-8) tangentFrame(this.dir, this._east, this.facing);
    else this.facing.normalize();
  }

  #slideDead(dt) {
    if (this.slideLeft <= 0 || this._knockAway.lengthSq() < 1e-8) return;
    const step = Math.min(this.slideLeft, this.slideSpeed * dt);
    this._knockAway.addScaledVector(this.dir, -this._knockAway.dot(this.dir));
    if (this._knockAway.lengthSq() < 1e-10) {
      this.slideLeft = 0;
      return;
    }
    this._knockAway.normalize();
    this._knockAxis.crossVectors(this.dir, this._knockAway);
    if (this._knockAxis.lengthSq() < 1e-10) {
      this.slideLeft = 0;
      return;
    }
    this._knockAxis.normalize();
    const prev = this._trial.copy(this.dir);
    this.dir.applyAxisAngle(this._knockAxis, step / CONFIG.planetR).normalize();
    if (!isLand(this.terrain, this.dir)) {
      this.dir.copy(prev);
      this.slideLeft = 0;
      this.#snap();
      return;
    }
    this.slideLeft -= step;
    this.facing.crossVectors(this.dir, this._knockAway);
    if (this.facing.lengthSq() > 1e-8) this.facing.normalize();
    this.#snap();
  }

  beginTornadoCapture(centerDir, source = null) {
    if (this.tornado || this.dead) return false;
    this.tornado = {
      phase: "climb",
      t: 0,
      source,
      centerDir: centerDir.clone(),
      spinY: 0,
      sideZ: 0,
      preAmp: 0,
      orbitAng: this.rng() * Math.PI * 2,
      height: 0,
      wallU: 0,
      bodyRoll: 0
    };
    return true;
  }

  endTornadoCapture() {
    this.tornado = null;
  }

  pullOnSurface(towardDir, stepM) {
    if (this.tornado || this.dead) return false;
    const target = towardDir.clone().normalize();
    const dot = Math.min(1, Math.max(-1, this.dir.dot(target)));
    const angle = Math.acos(dot);
    if (angle < 1e-5) return false;
    const t = Math.min(1, (stepM / CONFIG.planetR) / angle);
    slerpDirection(this._trial, this.dir, target, t);
    this.dir.copy(this._trial);
    this.#snap();
    return true;
  }

  onTornadoLand(centerDir) {
    this.die({ fromDir: centerDir });
  }

  #applyTornadoPose() {
    const td = this.tornado;
    if (!td) return;
    const parts = this.parts;
    const side = td.sideZ ?? 0;
    if (td.phase === "climb") {
      parts.body.rotation.set(
        Math.sin(td.spinY * 1.8) * (td.preAmp || 0) * 0.3,
        td.spinY,
        -side
      );
    } else {
      parts.body.rotation.set(0, td.bodyRoll || 0, -side);
    }
    parts.body.position.set(0, 0, 0);
  }

  update(dt, wizards) {
    this.phase += dt;
    if (this.dead) {
      this.dieT = Math.min(1, this.dieT + dt / 0.45);
      const u = this.dieT * this.dieT * (3 - 2 * this.dieT);
      this.parts.body.rotation.z = u * (Math.PI * 0.5);
      this.parts.body.rotation.x = 0;
      this.parts.body.rotation.y = 0;
      this.parts.body.position.set(0, u * this.lieLift, 0);
      this.parts.neck.rotation.x = THREE.MathUtils.lerp(this.parts.neck.rotation.x, 0.15, 0.12);
      for (const leg of this.parts.legs) {
        leg.hip.rotation.x *= 1 - dt * 8;
        leg.shin.rotation.x = THREE.MathUtils.lerp(leg.shin.rotation.x, 0.08, 0.2);
      }
      this.#slideDead(dt);
      this.#updateBurn(dt);
      this.#applyPose();
      return;
    }

    if (this.tornado) {
      this.#applyTornadoPose();
      this.#applyPose();
      return;
    }

    if (this._tornadoPullSpeed > 0) {
      this.#applyPose();
      return;
    }

    const near = this.#nearestWizard(wizards);
    if (near.w && near.dist < FLEE_START && this.state !== "flee" && this.state !== "swim") {
      this.state = "flee";
      this.stateT = 2.2 + this.rng() * 1.4;
    }

    this.stateT -= dt;
    let speed = 0;
    this.neckTarget = 0.18;

    if (this.state === "flee") {
      speed = FLEE_SPEED;
      this.neckTarget = -0.28;
      if (near.w) {
        tangentFrame(this.dir, this._east, this._north);
        this._look.copy(near.w.dir).addScaledVector(this.dir, -near.w.dir.dot(this.dir));
        if (this._look.lengthSq() > 1e-8) {
          this._look.normalize().multiplyScalar(-1);
          const ang = Math.atan2(this._look.dot(this._north), this._look.dot(this._east));
          surfaceOffsetDir(this.dir, this._east, this._north, ang, 9, this.targetDir);
        }
      }
      if (this.stateT <= 0 && (!near.w || near.dist > FLEE_STOP)) {
        this.state = "wander";
        this.stateT = 2 + this.rng() * 3;
        this.#pickWander();
      }
    } else if (this.state === "swim") {
      /** Plave rovně (bez ohledu na kouzelníka), dokud nenarazí na břeh. */
      speed = SWIM_SPEED;
      this.neckTarget = -0.1;
      if (isLand(this.terrain, this.dir)) {
        this.#exitSwim();
      } else if (surfaceDist(this.dir, this.targetDir) < 6) {
        this.#aimStraightAhead(SWIM_AIM_DIST);
      }
    } else if (this.state === "graze") {
      this.neckTarget = 0.92;
      speed = 0;
      if (this.stateT <= 0) {
        this.state = this.rng() < 0.45 ? "look" : "wander";
        this.stateT = this.state === "look" ? 1.2 + this.rng() * 1.4 : 2 + this.rng() * 4;
        if (this.state === "wander") this.#pickWander();
      }
    } else if (this.state === "look") {
      this.neckTarget = -0.62;
      speed = 0;
      const wobble = Math.sin(this.phase * 1.4) * 0.25;
      this.parts.head.rotation.y = wobble;
      if (this.stateT <= 0) {
        this.state = "wander";
        this.stateT = 1.5 + this.rng() * 3;
        this.#pickWander();
      }
    } else {
      speed = WALK_SPEED;
      if (this.stateT <= 0) {
        const r = this.rng();
        if (r < 0.4) {
          this.state = "graze";
          this.stateT = 2.2 + this.rng() * 3.5;
        } else if (r < 0.62) {
          this.state = "look";
          this.stateT = 1 + this.rng() * 1.6;
        } else {
          this.#pickWander();
          this.stateT = 3 + this.rng() * 5;
        }
      }
    }

    if (this.state !== "look") this.parts.head.rotation.y *= 0.85;

    if (speed > 0) {
      const allowWater = this.state === "flee" || this.state === "swim";
      const arrived = this.#stepToward(this.targetDir, speed * dt, allowWater);
      turnFacingToward(this.facing, this.dir, this.targetDir, this._move, 1 - Math.exp(-dt * 6));
      this.walkPhase += dt * speed * 2.4;
      if (arrived && this.state === "wander") {
        this.state = "graze";
        this.stateT = 1.8 + this.rng() * 3;
      }
      /** Utíkající zvíře doběhlo až do vody — přepni na rovné plavání ke břehu. */
      if (this.state === "flee" && isWaterAt(this.terrain, this.dir)) {
        this.#enterSwim();
      }
    }

    this.neckX += (this.neckTarget - this.neckX) * Math.min(1, dt * 3.2);
    this.parts.neck.rotation.x = this.neckX;
    this.parts.neck2.rotation.x = this.neckX * 0.35 + Math.sin(this.phase * 1.1) * 0.04;

    const gait = this.state === "flee" ? 1.6 : this.state === "swim" ? 0.5 : speed > 0.05 ? 1 : 0.15;
    for (const leg of this.parts.legs) {
      const off = leg.k * 2.1 + (leg.side > 0 ? 0 : Math.PI);
      const swing = Math.sin(this.walkPhase + off) * 0.42 * gait;
      leg.hip.rotation.x = swing;
      leg.shin.rotation.x = Math.max(0, -swing) * 0.7 + 0.15;
    }
    for (let i = 0; i < this.parts.sails.length; i++) {
      this.parts.sails[i].rotation.x = Math.sin(this.phase * 1.3 + i * 0.7) * 0.12;
    }
    for (let i = 0; i < this.parts.stalks.length; i++) {
      this.parts.stalks[i].rotation.x = Math.sin(this.phase * 2.1 + i) * 0.18
        + (this.state === "look" ? -0.35 : 0);
    }
    this.parts.tail.rotation.y = Math.sin(this.phase * 1.6) * 0.35;

    this.#snap();
    this.#applyPose();
  }

  #updateBurn(dt) {
    if (!this.burning || this.charred) return;
    this.burnT += dt;
    const left = BURN_DURATION - this.burnT;
    if (this._fire) {
      this._fire.setStrength(left < 1.2 ? Math.max(0, left / 1.2) : 1);
      this._fire.update(dt);
    }
    if (this._burnMats.length) setBurnGlow(this._burnMats, left < 1.2 ? Math.max(0, left / 1.2) : 1);
    if (this.burnT >= BURN_DURATION) this.#charBody();
  }

  dispose() {
    if (this._fire) {
      this._fire.dispose();
      this._fire = null;
    }
    for (const m of this._burnMats) m.dispose();
    this._burnMats.length = 0;
    this.herd.planetGroup.remove(this.mesh);
  }
}

export class CritterHerd {
  constructor(planetGroup, terrain, seed = CONFIG.defaultMapSeed) {
    this.planetGroup = planetGroup;
    this.terrain = terrain;
    this.seed = seed + 7741;
    this.list = [];
    this.onDied = null;
    this.geos = {
      sphere: new THREE.SphereGeometry(1, 12, 10),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
      cone: new THREE.ConeGeometry(1, 1, 8)
    };
    this.mats = {
      hide: mat(0x6a3d7a),
      belly: mat(0xc4d45a),
      sail: mat(0x2ec4b6, { roughness: 0.55 }),
      dark: mat(0x241428),
      eye: mat(0xff6a18, { emissive: 0xff3a00, emissiveIntensity: 0.85, roughness: 0.35 })
    };
    this.spawn();
  }

  spawn() {
    this.clear();
    const rng = mulberry32(this.seed);
    const east = new THREE.Vector3();
    const north = new THREE.Vector3();
    let guard = 0;
    while (this.list.length < COUNT && guard++ < 1600) {
      const dir = randomSphereDir(rng);
      tangentFrame(dir, east, north);
      if (!isWalkable(this.terrain, dir, east, north)) continue;
      const id = this.list.length;
      const crng = mulberry32(this.seed + (id + 1) * 9973);
      this.list.push(new Critter(this, id, dir, crng));
    }
  }

  clear() {
    for (const c of this.list) c.dispose();
    this.list.length = 0;
  }

  dispose() {
    this.clear();
    for (const m of Object.values(this.mats)) m.dispose();
    for (const g of Object.values(this.geos)) g.dispose();
  }

  /** Zásah v rádiusu — zabije. Vrací true, pokud někdo umřel. */
  hurtNear(centerDir, radiusM) {
    if (!centerDir || radiusM <= 0) return false;
    let hit = false;
    for (const c of this.list) {
      if (c.dead) continue;
      if (surfaceDist(c.dir, centerDir) <= radiusM) {
        if (c.die({ fromDir: centerDir })) hit = true;
      }
    }
    return hit;
  }

  /**
   * Výbuch komety — v kráteru se zvíře odpaří, do damage radiusu uhoří.
   * Bez náhody, aby MP klienti dopadli stejně.
   */
  blastNear(centerDir, vaporizeR, damageR) {
    if (!centerDir) return false;
    let hit = false;
    for (const c of this.list) {
      if (c.dead) continue;
      const dist = surfaceDist(c.dir, centerDir);
      if (dist <= vaporizeR) {
        if (c.die({ noSlide: true, vanish: true })) hit = true;
      } else if (dist <= damageR) {
        if (c.die({ fromDir: centerDir, ignite: true })) hit = true;
      }
    }
    return hit;
  }

  kill(id, dirArr, fromArr) {
    const c = this.list[id];
    if (!c) return;
    const dir = dirArr
      ? new THREE.Vector3(dirArr[0], dirArr[1], dirArr[2])
      : null;
    c.die({ atDir: dir, fromDir: fromArr || null, fromNet: true });
  }

  update(dt, wizards) {
    for (const c of this.list) c.update(dt, wizards);
  }
}
