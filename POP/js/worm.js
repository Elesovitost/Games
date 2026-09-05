import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame, surfaceOffsetDir } from "./utils.js";
import { surfaceDist } from "./spells/fx-common.js";
import { SPELLS } from "./spells/defs.js";
import {
  mulberry32,
  isLand as isLandAI,
  scatterOnLand,
  scatterOnLandBySegments,
  treeSwayZ,
  regenAnimalHp,
  aoeFalloff,
  claimHit
} from "./animalsAI.js";
import { applyEntityNet } from "./net/world-sync.js";
import { spawnSoul, updateSoul, disposeSoul, SOUL_DELAY } from "./soul.js";

const COUNT = 16;
const MAX_HP = 30;
/** 2× longneck (1.15). */
const WALK_SPEED = 2.3;
const TURN_RATE = 2.6;
const LAND_MARGIN = 0.28;
const MIN_R = CONFIG.wizardMinTerrainR + 0.05;
const LINKS = 16;
/** Kolik článků (od hlavy) vyjde z díry — zbytek zůstane pod zemí. */
const PEEK_LINKS = 2.4;
const RISE_DUR = 0.7;
const DIVE_DUR = 0.95;
/** Smrt venku — rychle zpátky do díry, pak teprve duše. */
const DEAD_BURY_DUR = 0.28;
const PEEK_HOLD_MIN = 2.4;
const PEEK_HOLD_MAX = 4.2;
const PATH_MIN_STEP = 0.018;

function mat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.78,
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

function cylZ(geo, material, r, h, x, y, z) {
  const mesh = cyl(geo, material, r, h, x, y, z);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function noShadow(obj) {
  obj.traverse((c) => {
    c.castShadow = false;
    c.receiveShadow = false;
  });
}

function isWalkLand(terrain, dir) {
  return isLandAI(terrain, dir, LAND_MARGIN, MIN_R);
}

function wrapPi(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Články se překrývají (kulička + trubka) — čelo vede, zbytek se sází po stopě.
 * Ridge = podzemní obrys.
 */
export function createWormMesh(mats, geos) {
  const root = new THREE.Group();
  const S = geos.sphere;
  const C = geos.cyl;
  const links = [];

  for (let i = 0; i < LINKS; i++) {
    const u = 1 - i / (LINKS - 1);
    const r = 0.24 + u * 0.2;
    const g = new THREE.Group();
    const flesh = new THREE.Group();
    flesh.add(sph(S, mats.hide, r * 1.02, r * 0.8, r * 1.38, 0, 0, 0));
    flesh.add(cylZ(C, mats.hide, r * 0.84, r * 1.65, 0, 0, -r * 0.42));
    if (i % 2) flesh.add(sph(S, mats.band, r * 1.08, r * 0.9, r * 0.38, 0, 0, 0.04));
    const ridge = new THREE.Group();
    ridge.add(sph(S, mats.ridge, r * 1.1, r * 0.34, r * 1.48, 0, 0, 0));
    ridge.add(cylZ(C, mats.ridge, r * 0.88, r * 1.7, 0, 0, -r * 0.42));
    noShadow(ridge);
    g.add(flesh, ridge);
    g.frustumCulled = false;
    root.add(g);
    links.push({ g, flesh, ridge, head: null, stalks: null });
  }

  const head = new THREE.Group();
  const hr = 0.48;
  head.add(sph(S, mats.hide, hr * 0.92, hr * 0.8, hr * 1.18, 0, 0.06, 0.1));
  head.add(sph(S, mats.belly, 0.22, 0.15, 0.26, 0, -0.05, 0.3));
  head.add(sph(S, mats.dark, 0.09, 0.07, 0.11, 0, -0.1, 0.44));
  const stalks = [];
  const defs = [
    { x: -0.14, y: 0.24, z: 0.2, tilt: -0.32, h: 0.22 },
    { x: 0.14, y: 0.26, z: 0.16, tilt: 0.34, h: 0.24 },
    { x: 0.0, y: 0.3, z: 0.34, tilt: 0.02, h: 0.18 }
  ];
  for (const s of defs) {
    const st = new THREE.Group();
    st.position.set(s.x, s.y, s.z);
    st.rotation.z = s.tilt;
    st.add(cyl(C, mats.band, 0.045, s.h, 0, s.h * 0.5, 0));
    st.add(sph(S, mats.eye, 0.11, 0.11, 0.11, 0, s.h + 0.05, 0.03));
    st.userData.tilt = s.tilt;
    head.add(st);
    stalks.push(st);
  }
  head.position.z = 0.32;
  links[0].g.add(head);
  links[0].head = head;
  links[0].stalks = stalks;

  root.frustumCulled = false;
  root.userData.parts = { links, head, stalks };
  return root;
}

class Worm {
  constructor(herd, id, dir, rng) {
    this.herd = herd;
    this.id = id;
    this.terrain = herd.terrain;
    this.rng = rng;
    this.mesh = createWormMesh(herd.mats, herd.geos);
    const size = 0.75 + rng() * 0.5;
    this.size = size;
    this.blockR = Math.max(0.38, 0.55 * size);
    this.spacing = 0.38 * size;
    this.peekR = Math.max(0.8, this.spacing * PEEK_LINKS);
    herd.planetGroup.add(this.mesh);
    this.parts = this.mesh.userData.parts;

    this.dir = dir.clone().normalize();
    this.home = dir.clone().normalize();
    this.facing = new THREE.Vector3();
    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._move = new THREE.Vector3();
    this._trial = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._posB = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._mat = new THREE.Matrix4();
    this.peekHole = new THREE.Vector3();
    this.peekFwd = new THREE.Vector3();

    this.phase = rng() * 80;
    this.eightT = rng() * Math.PI * 2;
    this.eightSign = rng() < 0.5 ? 1 : -1;
    this.eightAmp = 7 + rng() * 7;
    this.eightStretch = 0.65 + rng() * 0.5;
    this.eightYaw = rng() * Math.PI * 2;
    this.steerSide = rng() < 0.5 ? 1 : -1;
    this.wallT = 0;

    this.state = "tunnel";
    this.peekStage = null;
    this.peekT = 0;
    this.stateT = 3.5 + rng() * 5;
    this.dead = false;
    this.burying = false;
    this.buryU = 0;
    this.gone = false;
    this.remote = false;
    this.netMoving = false;
    this._soul = null;
    this.soulDelay = null;
    this.charm = null;
    this.demonHold = false;
    this.treeSlot = null;
    this.treeFocus = null;
    this.treeRingR = 5.4;
    this.arrivedTree = false;
    this.maxHp = MAX_HP;
    this.hp = MAX_HP;
    this.path = [];

    tangentFrame(this.dir, this._east, this.facing);
    this.peekFwd.copy(this.facing);
    this.#initPath();
    this.#poseLinks(0);
  }

  get lureable() {
    if (this.dead || this.gone) return false;
    if (this.state === "charm") return true;
    if (this.state === "peek" && this.peekStage === "hold") return true;
    if (this.state === "treeTrance" && this.arrivedTree) return true;
    return false;
  }

  get treeSensitive() {
    if (this.dead || this.gone) return false;
    if (this.state === "charm") return false;
    return true;
  }

  get exposed() {
    if (this.dead || this.gone) return false;
    if (this.state === "charm") return true;
    if (this.state === "peek") return this.peekStage !== "rise" || this.peekT > 0.35;
    if (this.state === "treeTrance") return this.arrivedTree;
    return false;
  }

  beginCharm(wizard, hold) {
    if (this.remote || this.dead || this.gone || !wizard) return;
    if (this.state !== "peek" || this.peekStage !== "hold") {
      if (this.state !== "charm") return;
    }
    this.charm = { wizard, t: 0, hold: hold ?? 20 };
    this.state = "charm";
    this.peekStage = null;
    this.arrivedTree = false;
  }

  #surfPos(dir, lift, out) {
    return out.copy(dir).multiplyScalar(this.terrain.height(dir) + lift);
  }

  #initPath() {
    this.path.length = 0;
    tangentFrame(this.dir, this._east, this._north);
    const bear = Math.atan2(this.facing.dot(this._north), this.facing.dot(this._east));
    const n = LINKS + 8;
    for (let i = n; i >= 0; i--) {
      surfaceOffsetDir(this.dir, this._east, this._north, bear + Math.PI, i * this.spacing, this._trial);
      const p = new THREE.Vector3();
      this.#surfPos(this._trial, 0.014, p);
      this.path.push(p);
    }
  }

  #pushPath(pos) {
    const last = this.path[this.path.length - 1];
    if (last && last.distanceTo(pos) < PATH_MIN_STEP) {
      last.copy(pos);
      return;
    }
    this.path.push(pos.clone());
    let len = 0;
    for (let i = this.path.length - 1; i > 0; i--) {
      len += this.path[i].distanceTo(this.path[i - 1]);
      if (len > this.spacing * (LINKS + 4)) {
        this.path.splice(0, i - 1);
        break;
      }
    }
  }

  #samplePath(distBack, out) {
    if (!this.path.length) return this.#surfPos(this.dir, 0.014, out);
    let left = distBack;
    for (let i = this.path.length - 1; i > 0; i--) {
      const a = this.path[i];
      const b = this.path[i - 1];
      const d = a.distanceTo(b);
      if (d < 1e-8) continue;
      if (left <= d) {
        out.lerpVectors(a, b, left / d);
        return out;
      }
      left -= d;
    }
    // Za koncem stopy: extrapoluj dál (ať se ocas neslepuje na path[0]).
    if (this.path.length >= 2 && left > 0) {
      out.subVectors(this.path[0], this.path[1]);
      if (out.lengthSq() > 1e-12) {
        out.normalize().multiplyScalar(left).add(this.path[0]);
        return out;
      }
    }
    return out.copy(this.path[0]);
  }

  #poseLinks(dt) {
    const links = this.parts.links;
    const peeking = this.state === "peek" || (this.state === "treeTrance" && this.arrivedTree) || this.burying;
    const surfaced = this.state === "charm" && !this.burying;
    let hasPrevFwd = false;
    for (let i = 0; i < LINKS; i++) {
      this.#samplePath(i * this.spacing, this._pos);
      const up = this._up.copy(this._pos).normalize();
      const h = this.terrain.height(up);
      const lift = this._pos.length() - h;
      const link = links[i];
      // Tečna vždy ze stopy (i za posledním článkem) — ne facing hlavy.
      this.#samplePath((i + 1) * this.spacing, this._posB);
      this._fwd.subVectors(this._pos, this._posB);
      if (this._fwd.lengthSq() < 1e-6) {
        if (hasPrevFwd) this._fwd.copy(this._move);
        else this._fwd.copy(this.facing);
      }
      this._fwd.normalize();
      this._move.copy(this._fwd);
      hasPrevFwd = true;
      this._right.crossVectors(up, this._fwd);
      if (this._right.lengthSq() < 1e-6) {
        this._right.crossVectors(this.peekFwd.lengthSq() > 1e-6 ? this.peekFwd : this.facing, this._fwd);
      }
      this._right.normalize();
      this._up.crossVectors(this._fwd, this._right).normalize();
      this._mat.makeBasis(this._right, this._up, this._fwd);
      const emerged = lift > 0.07;
      if (peeking && this.state === "treeTrance" && emerged) {
        const lean = treeSwayZ();
        this._pos.addScaledVector(this._right, lean * Math.max(0, lift));
        link.g.position.copy(this._pos);
        link.g.quaternion.setFromRotationMatrix(this._mat);
        if (this.peekFwd.lengthSq() > 1e-8) link.g.rotateOnWorldAxis(this.peekFwd, lean);
      } else {
        link.g.position.copy(this._pos);
        link.g.quaternion.setFromRotationMatrix(this._mat);
      }

      link.flesh.visible = emerged || surfaced;
      link.ridge.visible = !emerged && !surfaced;
      if (link.head) {
        link.head.visible = emerged || surfaced ||
          (this.state === "treeTrance" && this.arrivedTree);
      }
    }
    this.#poseHeadLook(dt, peeking || surfaced);
  }

  #poseHeadLook(dt, emerged) {
    const head = this.parts.head;
    const stalks = this.parts.stalks;
    if (!head) return;
    const look = this.state === "peek" && this.peekStage === "hold";
    const tree = this.state === "treeTrance" && this.arrivedTree;
    if (look) {
      head.rotation.y = Math.sin(this.phase * 1.15) * 0.72;
      head.rotation.x = Math.sin(this.phase * 0.7) * 0.18;
    } else if (tree) {
      head.rotation.y = treeSwayZ() * 0.35;
      head.rotation.x = -0.06;
    } else {
      head.rotation.y *= 0.85;
      head.rotation.x *= 0.85;
    }
    const stalkOn = emerged && (look || tree || this.state === "charm");
    for (let i = 0; i < stalks.length; i++) {
      const g = stalks[i];
      const u = stalkOn ? 1 : 0;
      g.scale.setScalar(0.12 + 0.88 * u);
      g.visible = u > 0.04;
      if (u > 0.5) {
        g.rotation.x = Math.sin(this.phase * 1.7 + i) * 0.22;
        g.rotation.z = (g.userData.tilt || 0) + Math.sin(this.phase * 1.25 + i * 1.1) * 0.18;
      }
    }
  }

  #eightPoint(t, out) {
    const wobble = 0.78 + 0.22 * Math.sin(this.phase * 0.33);
    const amp = this.eightAmp * wobble;
    const stretch = this.eightStretch + 0.14 * Math.sin(this.phase * 0.19);
    const x = amp * Math.sin(t);
    const z = amp * stretch * Math.sin(t) * Math.cos(t);
    const yaw = this.eightYaw + Math.sin(this.phase * 0.09) * 0.55;
    tangentFrame(this.home, this._east, this._north);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const rx = x * c - z * s;
    const rz = x * s + z * c;
    const dist = Math.hypot(rx, rz);
    const ang = Math.atan2(rz, rx);
    surfaceOffsetDir(this.home, this._east, this._north, ang, Math.max(0.4, dist), out);
  }

  #pickAim(out) {
    for (let k = 0; k < 16; k++) {
      this.#eightPoint(this.eightT + this.eightSign * k * 0.12, out);
      if (isWalkLand(this.terrain, out)) return out;
    }
    return out.copy(this.home);
  }

  #probe(ang, dist, out) {
    tangentFrame(this.dir, this._east, this._north);
    surfaceOffsetDir(this.dir, this._east, this._north, ang, dist, out);
    return isWalkLand(this.terrain, out) && this.terrain.height(out) >= MIN_R;
  }

  /** Čelo jede dopředu a zatáčí — nikdy neklouže bokem podél hrany. */
  #drive(dt, aim) {
    const step = WALK_SPEED * dt;
    tangentFrame(this.dir, this._east, this._north);
    let faceAng = Math.atan2(this.facing.dot(this._north), this.facing.dot(this._east));
    let want = faceAng;
    if (aim) {
      this._move.copy(aim).addScaledVector(this.dir, -aim.dot(this.dir));
      if (this._move.lengthSq() > 1e-8) {
        this._move.normalize();
        const aimAng = Math.atan2(this._move.dot(this._north), this._move.dot(this._east));
        want = faceAng + wrapPi(aimAng - faceAng);
      }
    }
    const maxTurn = TURN_RATE * dt;
    want = faceAng + Math.max(-maxTurn, Math.min(maxTurn, wrapPi(want - faceAng)));

    if (!this.#probe(want, step, this._trial)) {
      this.wallT += dt;
      let picked = null;
      for (let k = 1; k <= 16; k++) {
        const d = k * 0.2;
        if (this.#probe(faceAng + this.steerSide * d, step, this._trial)) {
          picked = faceAng + this.steerSide * d;
          break;
        }
        if (this.#probe(faceAng - this.steerSide * d, step, this._trial)) {
          picked = faceAng - this.steerSide * d;
          this.steerSide *= -1;
          break;
        }
      }
      if (picked == null) {
        const turn = faceAng + this.steerSide * maxTurn;
        tangentFrame(this.dir, this._east, this._north);
        this.facing
          .copy(this._east).multiplyScalar(Math.cos(turn))
          .addScaledVector(this._north, Math.sin(turn))
          .normalize();
        return false;
      }
      want = faceAng + Math.max(-maxTurn * 1.6, Math.min(maxTurn * 1.6, wrapPi(picked - faceAng)));
      if (!this.#probe(want, step, this._trial)) {
        if (!this.#probe(picked, step, this._trial)) return false;
        want = picked;
      }
    } else {
      this.wallT = Math.max(0, this.wallT - dt * 2);
    }

    this.dir.copy(this._trial).normalize();
    tangentFrame(this.dir, this._east, this._north);
    this.facing
      .copy(this._east).multiplyScalar(Math.cos(want))
      .addScaledVector(this._north, Math.sin(want))
      .normalize();
    this.facing.addScaledVector(this.dir, -this.facing.dot(this.dir));
    if (this.facing.lengthSq() < 1e-8) tangentFrame(this.dir, this._east, this.facing);
    else this.facing.normalize();
    this.#surfPos(this.dir, 0.014, this._pos);
    this.#pushPath(this._pos);
    return true;
  }

  #followEight(dt) {
    this.#pickAim(this._trial);
    if (surfaceDist(this.dir, this._trial) < 2.6 || this.wallT > 1.4) {
      this.eightT += this.eightSign * dt * (WALK_SPEED / Math.max(5.5, this.eightAmp));
      if (this.wallT > 1.4) this.wallT = 0;
    }
    this.#drive(dt, this._trial);
  }

  #holeSurf(out) {
    return this.#surfPos(this.peekHole, 0, out);
  }

  /** Hlava a kousek těla kolmo nahoru z díry; zbytek zůstane pod zemí. */
  #risePos(u, out) {
    this.#holeSurf(out);
    out.addScaledVector(this.peekHole, this.peekR * u);
    return out;
  }

  /** Oblouk z vrcholu dopředu zpět do země (ne ponoření na místě). */
  #divePos(u, out) {
    const R = this.peekR;
    const phi = u * (Math.PI * 0.5);
    this.#holeSurf(out);
    out.addScaledVector(this.peekHole, R * Math.cos(phi));
    out.addScaledVector(this.peekFwd, R * Math.sin(phi));
    return out;
  }

  #enterPeek() {
    this.state = "peek";
    this.peekStage = "rise";
    this.peekT = 0;
    this.peekHole.copy(this.dir);
    this.peekFwd.copy(this.facing).addScaledVector(this.dir, -this.facing.dot(this.dir));
    if (this.peekFwd.lengthSq() < 1e-8) tangentFrame(this.dir, this._east, this.peekFwd);
    else this.peekFwd.normalize();
  }

  #updatePeek(dt) {
    if (this.peekStage === "rise") {
      this.peekT = Math.min(1, this.peekT + dt / RISE_DUR);
      const u = this.peekT * this.peekT * (3 - 2 * this.peekT);
      this.#risePos(u, this._pos);
      this.#pushPath(this._pos);
      this.dir.copy(this.peekHole);
      if (this.peekT >= 1) {
        this.peekStage = "hold";
        this.stateT = PEEK_HOLD_MIN + this.rng() * (PEEK_HOLD_MAX - PEEK_HOLD_MIN);
      }
      return;
    }
    if (this.peekStage === "hold") {
      this.#risePos(1, this._pos);
      this.#pushPath(this._pos);
      this.dir.copy(this.peekHole);
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.peekStage = "dive";
        this.peekT = 0;
      }
      return;
    }
    this.peekT = Math.min(1, this.peekT + dt / DIVE_DUR);
    const u = this.peekT * this.peekT * (3 - 2 * this.peekT);
    this.#divePos(u, this._pos);
    this.#pushPath(this._pos);
    this.dir.copy(this._pos).normalize();
    if (this.peekT >= 1) {
      this.dir.copy(this._pos).normalize();
      this.facing.copy(this.peekFwd).addScaledVector(this.dir, -this.peekFwd.dot(this.dir));
      if (this.facing.lengthSq() < 1e-8) tangentFrame(this.dir, this._east, this.facing);
      else this.facing.normalize();
      this.#surfPos(this.dir, 0.014, this._pos);
      this.#pushPath(this._pos);
      this.state = "tunnel";
      this.peekStage = null;
      this.stateT = 4 + this.rng() * 6;
      if (this.rng() < 0.22) this.eightSign *= -1;
      this.eightYaw += (this.rng() - 0.5) * 0.7;
    }
  }

  takeDamage(amount, opts = {}) {
    if (this.remote && !opts.fromNet) return false;
    if (this.dead || this.gone || amount <= 0) return false;
    if (!this.exposed && !opts.force) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp > 0) return false;
    return this.die(opts);
  }

  die(opts = {}) {
    if (this.remote && !opts.fromNet) return false;
    if (this.dead) return false;
    if (!this.exposed && !opts.force) return false;
    this.#beginDeathBury(opts);
    this.dead = true;
    this.state = "dead";
    this.charm = null;
    this.treeSlot = null;
    this.treeFocus = null;
    if (opts.atDir) this.dir.copy(opts.atDir).normalize();
    if (opts.vanish) {
      this.gone = true;
      this.burying = false;
      this.soulDelay = SOUL_DELAY;
      this.mesh.visible = false;
    }
    if (!opts.fromNet) this.herd.onDied?.(this);
    return true;
  }

  #emergeU() {
    if (this.state === "charm" || this.charm) return 1;
    if (this.peekStage === "hold") return 1;
    if (this.peekStage === "rise") return Math.min(1, Math.max(0, this.peekT || 0));
    if (this.peekStage === "dive") return Math.max(0, 1 - (this.peekT || 0));
    if (this.state === "peek" || (this.state === "treeTrance" && this.arrivedTree)) return 1;
    const last = this.path[this.path.length - 1];
    if (!last) return 0;
    const lift = last.length() - this.terrain.height(this._up.copy(last).normalize());
    if (lift > 0.2) return Math.min(1, lift / Math.max(0.2, this.peekR));
    if (lift > 0.03) return 1;
    return 0;
  }

  #beginDeathBury(opts) {
    if (opts.vanish) {
      this.burying = false;
      this.buryU = 0;
      return;
    }
    const fromHole =
      this.peekStage === "rise" ||
      this.peekStage === "hold" ||
      this.peekStage === "dive" ||
      this.state === "peek" ||
      (this.state === "treeTrance" && this.arrivedTree);
    if (!fromHole || this.peekHole.lengthSq() < 1e-8) this.peekHole.copy(this.dir);
    this.peekFwd.copy(this.facing).addScaledVector(this.peekHole, -this.facing.dot(this.peekHole));
    if (this.peekFwd.lengthSq() < 1e-8) tangentFrame(this.peekHole, this._east, this.peekFwd);
    else this.peekFwd.normalize();
    this.buryU = Math.min(1, Math.max(0, this.#emergeU()));
    this.burying = this.buryU > 0.02;
    this.soulDelay = this.burying ? null : 0;
  }

  #tickDeathBury(dt) {
    if (!this.burying) return false;
    this.buryU = Math.max(0, this.buryU - dt / DEAD_BURY_DUR);
    this.#risePos(this.buryU, this._pos);
    this.#pushPath(this._pos);
    this.dir.copy(this.peekHole);
    this.#poseLinks(dt);
    if (this.buryU <= 0) {
      this.burying = false;
      this.soulDelay = 0;
    }
    return true;
  }

  #tickSoul(dt) {
    const g = this.herd.planetGroup;
    this._soul = updateSoul(this._soul, g, this.dir, dt);
    if (!this.dead || this._soul || this.soulDelay == null || this.burying) return;
    this.soulDelay -= dt;
    if (this.soulDelay > 0) return;
    this.soulDelay = null;
    this.#poseLinks(0);
    this._soul = spawnSoul(g, this.mesh);
    if (this._soul) {
      this._soul.mesh.traverse((ch) => {
        if (ch.isMesh) ch.visible = true;
      });
    }
    this.mesh.visible = false;
  }

  ignite() {
    if (!this.exposed || this.dead) return;
  }

  #updateRemote(dt) {
    this.phase += dt;
    applyEntityNet(this);
    if (this.gone) {
      this.mesh.visible = false;
      return;
    }
    if (this.dead) {
      if (!this.#tickDeathBury(dt)) this.#poseLinks(dt);
      return;
    }

    this.peekFwd.copy(this.facing).addScaledVector(this.dir, -this.facing.dot(this.dir));
    if (this.peekFwd.lengthSq() < 1e-8) tangentFrame(this.dir, this._east, this.peekFwd);
    else this.peekFwd.normalize();

    const peeking = this.state === "peek" || (this.state === "treeTrance" && this.arrivedTree);
    if (peeking) {
      this.peekHole.copy(this.dir);
      if (this.peekStage === "rise") this.#risePos(this.peekT || 0, this._pos);
      else if (this.peekStage === "dive") this.#divePos(this.peekT || 0, this._pos);
      else this.#risePos(1, this._pos);
      this.#pushPath(this._pos);
    } else {
      this.#surfPos(this.dir, this.state === "charm" ? 0.05 : 0.014, this._pos);
      this.#pushPath(this._pos);
    }
    this.netMoving = this.state === "tunnel" || this.state === "charm" ||
      (this.state === "treeTrance" && !this.arrivedTree);
    this.#poseLinks(dt);
  }

  update(dt) {
    this.#tickSoul(dt);
    if (this.gone) return;
    if (this.remote) {
      this.#updateRemote(dt);
      return;
    }
    this.phase += dt;
    if (!this.dead) regenAnimalHp(this, dt);

    if (this.dead) {
      if (!this.#tickDeathBury(dt)) this.#poseLinks(dt);
      return;
    }

    if (this.demonHold) {
      this.netMoving = false;
      this.#surfPos(this.dir, 0.014, this._pos);
      this.#pushPath(this._pos);
      this.#poseLinks(dt);
      return;
    }

    if (this.charm) {
      this.charm.t += dt;
      if (!this.charm.wizard || this.charm.wizard.dead || this.charm.t >= this.charm.hold) {
        this.charm = null;
        if (this.state === "charm") this.#enterPeekDiveFromHere();
      }
    }

    if (this.treeSlot && this.state !== "charm") {
      this.state = "treeTrance";
    } else if (this.state === "treeTrance") {
      this.arrivedTree = false;
      this.#enterPeekDiveFromHere();
    }

    if (this.state === "treeTrance" && this.treeSlot) {
      const dSlot = surfaceDist(this.dir, this.treeSlot);
      if (dSlot > 1.15) {
        this.arrivedTree = false;
        this.peekStage = null;
        this.peekT = 0;
        this.#surfPos(this.dir, 0.014, this._pos);
        this.#pushPath(this._pos);
        this.#drive(dt, this.treeSlot);
        this.#poseLinks(dt);
        return;
      }
      this.arrivedTree = true;
      this.#faceTree();
      if (this.peekStage !== "hold") {
        if (!this.peekStage) this.#enterPeek();
        this.#updatePeek(dt);
        if (this.peekStage === "dive") {
          this.peekStage = "hold";
          this.peekT = 1;
        }
      } else {
        this.#risePos(1, this._pos);
        this.#pushPath(this._pos);
      }
      this.#poseLinks(dt);
      return;
    }

    if (this.state === "charm" && this.charm?.wizard) {
      const w = this.charm.wizard;
      if (surfaceDist(this.dir, w.dir) > 2.8) this.#drive(dt, w.dir);
      else {
        this._move.copy(w.dir).addScaledVector(this.dir, -w.dir.dot(this.dir));
        if (this._move.lengthSq() > 1e-8) this.facing.copy(this._move.normalize());
        this.#surfPos(this.dir, 0.05, this._pos);
        this.#pushPath(this._pos);
      }
      this.#poseLinks(dt);
      return;
    }

    if (this.state === "peek") {
      this.#updatePeek(dt);
      this.#poseLinks(dt);
      return;
    }

    this.#followEight(dt);
    this.stateT -= dt;
    if (this.stateT <= 0) this.#enterPeek();
    this.#poseLinks(dt);
  }

  #faceTree() {
    const focus = this.treeFocus;
    if (!focus) return;
    const up = this.peekHole.lengthSq() > 1e-6 ? this.peekHole : this.dir;
    this.facing.copy(focus).addScaledVector(up, -focus.dot(up));
    if (this.facing.lengthSq() < 1e-8) tangentFrame(this.dir, this._east, this.facing);
    else this.facing.normalize();
    this.peekFwd.copy(this.facing);
  }

  #enterPeekDiveFromHere() {
    if (this.peekStage === "hold" || this.peekStage === "rise") {
      this.state = "peek";
      this.peekStage = "dive";
      this.peekT = 0;
      return;
    }
    this.state = "tunnel";
    this.peekStage = null;
    this.stateT = 3 + this.rng() * 4;
  }

  dispose() {
    this._soul = disposeSoul(this._soul, this.herd.planetGroup);
    this.herd.planetGroup.remove(this.mesh);
  }
}

export class WormHerd {
  constructor(planetGroup, terrain, seed = CONFIG.defaultMapSeed) {
    this.planetGroup = planetGroup;
    this.terrain = terrain;
    this.blockers = null;
    this.fx = null;
    this.segments = null;
    this.seed = seed + 9029;
    this.list = [];
    this.remote = false;
    this.onDied = null;
    this.geos = {
      sphere: new THREE.SphereGeometry(1, 12, 10),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 8)
    };
    this.mats = {
      hide: mat(0xb84a58, { roughness: 0.72 }),
      band: mat(0x8c3544, { roughness: 0.68 }),
      belly: mat(0xe0a090, { roughness: 0.8 }),
      dark: mat(0x5a2830),
      eye: mat(0xa8ff44, { emissive: 0x6ad010, emissiveIntensity: 0.95, roughness: 0.28 }),
      ridge: new THREE.MeshBasicMaterial({
        color: 0x1c1610,
        transparent: true,
        opacity: 0.04,
        depthWrite: false
      })
    };
    this.spawn();
  }

  spawn(segments) {
    if (segments) this.segments = segments;
    this.clear();
    const ok = (dir) => isWalkLand(this.terrain, dir);
    const dirs = this.segments?.length
      ? scatterOnLandBySegments(COUNT, ok, this.segments, Math.max(16, CONFIG.planetR * 0.24))
      : scatterOnLand(COUNT, ok, Math.max(16, CONFIG.planetR * 0.24));
    for (let i = 0; i < dirs.length; i++) {
      this.list.push(new Worm(this, i, dirs[i], mulberry32(this.seed + (i + 1) * 7717)));
    }
    if (this.remote) {
      for (const c of this.list) c.remote = true;
    }
  }

  hurtNear(centerDir, radiusM, dmgCenter, dmgEdge, opts = {}) {
    if (this.remote || !centerDir || radiusM <= 0) return false;
    let hit = false;
    const { hitSet, hitKey = "w", ignite, ...rest } = opts;
    for (const c of this.list) {
      if (!c.exposed || c.dead) continue;
      const dist = surfaceDist(c.dir, centerDir);
      if (dist > radiusM) continue;
      if (!claimHit(hitSet, `${hitKey}:${c.id}`)) continue;
      const damage = aoeFalloff(dist, radiusM, dmgCenter, dmgEdge);
      if (c.takeDamage(damage, { fromDir: centerDir, ignite, ...rest })) hit = true;
    }
    return hit;
  }

  charmNear(centerDir, radiusM, wizard, hold) {
    if (this.remote || !centerDir || radiusM <= 0 || !wizard) return;
    for (const c of this.list) {
      if (!c.lureable || c.state === "treeTrance") continue;
      if (surfaceDist(c.dir, centerDir) <= radiusM) c.beginCharm(wizard, hold);
    }
  }

  blastNear(centerDir, vaporizeR, damageR) {
    if (this.remote || !centerDir) return false;
    let hit = false;
    for (const c of this.list) {
      if (c.dead) continue;
      const dist = surfaceDist(c.dir, centerDir);
      if (dist <= vaporizeR) {
        if (c.die({ force: true, vanish: true })) hit = true;
      } else if (c.exposed && dist <= damageR) {
        const damage = aoeFalloff(dist, damageR, SPELLS.comet.damageCenter, SPELLS.comet.damageEdge);
        if (c.takeDamage(damage, { fromDir: centerDir })) hit = true;
      }
    }
    return hit;
  }

  kill(id, dirArr, fromArr) {
    const c = this.list[id];
    if (!c) return;
    const dir = dirArr ? new THREE.Vector3(dirArr[0], dirArr[1], dirArr[2]) : null;
    c.die({ atDir: dir, fromDir: fromArr || null, fromNet: true, force: true });
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
