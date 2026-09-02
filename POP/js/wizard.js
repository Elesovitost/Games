import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame, tmp, slerpDirection } from "./utils.js";
import {
  applyInterpolatedPose,
  applyKnockFromSnapshot,
  poseSnapshotFromIntent
} from "./net/wizard-sync.js";
import { WalkFootprints } from "./spells/fx-aim.js";

const ROBE = 0x1a2848;
const ROBE_DARK = 0x0c1424;
const GOLD = 0xd4a837;
const GOLD_DIM = 0xa88628;
const FACE_VOID = 0x060810;

function mat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.88,
    metalness: opts.metalness ?? 0.02
  });
  if (opts.emissive) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 0.4;
  }
  return m;
}

function box(w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Minecraft-style blokový kouzelník (lokální Y = nahoru od povrchu, +Z = obličej). */
export function createWizardMesh(robeColor = ROBE) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const robe = Number(robeColor) || ROBE;
  const robeDark = new THREE.Color(robe).multiplyScalar(0.42).getHex();
  const robeMat = mat(robe);
  const robeDarkMat = mat(robeDark);
  robeMat.userData.robeRole = "main";
  robeDarkMat.userData.robeRole = "dark";
  const goldMat = mat(GOLD, { roughness: 0.55, metalness: 0.35 });
  const goldDimMat = mat(GOLD_DIM, { roughness: 0.6, metalness: 0.25 });
  const voidMat = mat(FACE_VOID, { roughness: 1 });

  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.12, 0.52, 0);
  leftLeg.add(box(0.22, 0.34, 0.22, robeDarkMat, 0, -0.13, 0));
  leftLeg.add(box(0.14, 0.32, 0.06, robeMat, 0.06, -0.2, 0.2));
  leftLeg.add(box(0.26, 0.09, 0.32, robeDarkMat, 0, -0.36, 0.1));

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.12, 0.52, 0);
  rightLeg.add(box(0.22, 0.34, 0.22, robeDarkMat, 0, -0.13, 0));
  rightLeg.add(box(0.14, 0.32, 0.06, robeMat, -0.06, -0.2, 0.2));
  rightLeg.add(box(0.26, 0.09, 0.32, robeDarkMat, 0, -0.36, 0.1));

  // Dlouhý hábit
  body.add(box(0.62, 1.12, 0.38, robeMat, 0, 0.72, 0));
  body.add(box(0.66, 0.08, 0.42, goldMat, 0, 0.16, 0.01));
  body.add(box(0.08, 1.05, 0.1, goldMat, 0, 0.7, 0.2));
  body.add(box(0.58, 0.32, 0.34, robeMat, 0, 1.38, 0));
  body.add(box(0.12, 0.18, 0.08, goldMat, 0, 1.52, 0.18));
  body.add(box(0.26, 0.16, 0.3, robeMat, -0.34, 1.46, -0.03));
  body.add(box(0.26, 0.16, 0.3, robeMat, 0.34, 1.46, -0.03));
  body.add(box(0.22, 0.1, 0.28, goldDimMat, -0.34, 1.48, 0.02));
  body.add(box(0.22, 0.1, 0.28, goldDimMat, 0.34, 1.48, 0.02));

  // Hlava v kápi — černý stín místo obličeje
  body.add(box(0.4, 0.4, 0.38, voidMat, 0, 1.72, 0.04));
  body.add(box(0.52, 0.46, 0.42, robeDarkMat, 0, 1.74, -0.05));
  body.add(box(0.54, 0.14, 0.46, robeDarkMat, 0, 1.98, -0.02));
  body.add(box(0.46, 0.22, 0.12, robeDarkMat, 0, 1.62, -0.22));
  body.add(box(0.48, 0.06, 0.08, goldMat, 0, 1.58, 0.22));
  body.add(box(0.06, 0.4, 0.08, goldMat, -0.22, 1.74, 0.22));
  body.add(box(0.06, 0.4, 0.08, goldMat, 0.22, 1.74, 0.22));
  body.add(box(0.44, 0.06, 0.08, goldMat, 0, 1.94, 0.18));

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.38, 1.34, 0);
  leftArm.add(box(0.22, 0.3, 0.22, robeMat, 0, -0.12, 0));
  leftArm.add(box(0.24, 0.08, 0.24, goldMat, 0, -0.34, 0));
  leftArm.add(box(0.2, 0.16, 0.2, robeDarkMat, 0, -0.48, 0));

  const rightArm = new THREE.Group();
  rightArm.position.set(0.38, 1.34, 0);
  rightArm.add(box(0.22, 0.3, 0.22, robeMat, 0, -0.12, 0));
  rightArm.add(box(0.24, 0.08, 0.24, goldMat, 0, -0.34, 0));
  rightArm.add(box(0.2, 0.16, 0.2, robeDarkMat, 0, -0.48, 0));

  // Cast FX — krouží kolem těla v barvě hráče (ne světélko v ruce)
  const castFx = new THREE.Group();
  castFx.visible = false;
  castFx.position.set(0, 1.05, 0);
  const castBase = new THREE.Color(robe);
  const castBright = castBase.clone().lerp(new THREE.Color(0xffffff), 0.4);
  const castSoft = castBase.clone().lerp(new THREE.Color(0x000000), 0.15);
  const castOrbs = [];
  const castMats = [];

  const mkGlowMat = (hex, opacity = 0.85) => {
    const m = new THREE.MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity,
      depthWrite: false
    });
    castMats.push(m);
    return m;
  };

  for (let i = 0; i < 14; i++) {
    const bright = i % 3 !== 2;
    const col = bright ? castBright.getHex() : castSoft.getHex();
    const size = bright ? 0.055 + (i % 3) * 0.02 : 0.07 + (i % 2) * 0.025;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(size, 6, 5),
      mkGlowMat(col, 0.55 + (i % 4) * 0.1)
    );
    mesh.frustumCulled = false;
    castFx.add(mesh);
    castOrbs.push({
      mesh,
      kind: "orb",
      r: 0.55 + (i % 5) * 0.12,
      y0: -0.35 + (i % 7) * 0.14,
      speed: 1.4 + (i % 4) * 0.55 + (i % 2) * 0.35,
      phase: (i / 14) * Math.PI * 2,
      bob: 0.08 + (i % 3) * 0.04,
      spin: 2 + (i % 5)
    });
  }

  for (let i = 0; i < 6; i++) {
    const w = 0.04 + (i % 3) * 0.02;
    const h = 0.1 + (i % 2) * 0.06;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, w * 0.6),
      mkGlowMat(i % 2 ? castBright.getHex() : castBase.getHex(), 0.7)
    );
    mesh.frustumCulled = false;
    castFx.add(mesh);
    castOrbs.push({
      mesh,
      kind: "shard",
      r: 0.7 + (i % 3) * 0.15,
      y0: -0.15 + (i % 4) * 0.18,
      speed: -(1.1 + i * 0.22),
      phase: (i / 6) * Math.PI * 2 + 0.4,
      bob: 0.1,
      spin: 3.5 + i * 0.4
    });
  }

  const castRings = [];
  for (let i = 0; i < 2; i++) {
    const ringMat = mkGlowMat(castBright.getHex(), 0.28 + i * 0.08);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.72 + i * 0.22, 0.018, 6, 28),
      ringMat
    );
    ring.rotation.x = Math.PI / 2 + (i === 0 ? 0.35 : -0.45);
    ring.rotation.z = i * 0.6;
    ring.frustumCulled = false;
    castFx.add(ring);
    castRings.push({ mesh: ring, speed: i === 0 ? 1.8 : -1.35 });
  }

  body.add(leftArm, rightArm);
  body.add(leftLeg, rightLeg);
  body.add(castFx);
  root.add(body);
  root.frustumCulled = false;

  // Nohy na y=0, celková výška = wizardHeightM (2 m)
  const bbox = new THREE.Box3().setFromObject(body);
  body.position.y -= bbox.min.y;
  bbox.setFromObject(body);
  const meshH = bbox.max.y - bbox.min.y;
  root.scale.setScalar(CONFIG.wizardHeightM / meshH);

  root.userData.parts = {
    body,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    castFx,
    castOrbs,
    castRings,
    castMats
  };
  return root;
}

export class Wizard {
  constructor(planetGroup, terrain, spawnDir, opts = {}) {
    this.planetGroup = planetGroup;
    this.terrain = terrain;
    this.id = opts.id || "local";
    this.name = opts.name || "Čaroděj";
    this.color = Number(opts.color) || ROBE;
    this.remote = !!opts.remote;
    this.mesh = createWizardMesh(this.color);
    this.planetGroup.add(this.mesh);
    this.footprints = this.remote ? null : new WalkFootprints(planetGroup, terrain);
    this.#createSoftShadow();

    this.dir = new THREE.Vector3().fromArray(spawnDir).normalize();
    this.facing = new THREE.Vector3();
    this.targetDir = new THREE.Vector3();
    this.hasTarget = false;
    this.walkPhase = 0;
    this._lastStepHalf = -1;
    this.walkBlend = 0;
    this.wantsWalk = false;
    this.moving = false;
    this.casting = false;
    this.castT = 0;
    this.castDuration = 0;
    this._onCastComplete = null;
    this._castFace = new THREE.Vector3();

    this._right = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._move = new THREE.Vector3();
    this._stepDir = new THREE.Vector3();
    this._trial = new THREE.Vector3();
    this._basisX = new THREE.Vector3();
    this._mat = new THREE.Matrix4();
    this._invPlanet = new THREE.Matrix4();
    this._camRightLocal = new THREE.Vector3();
    this._slopeSample = new THREE.Vector3();
    this._speedMul = 1;
    this._tornadoMoveMul = 1;
    this._lavaMoveMul = 1;
    this._tornadoPullSpeed = 0;
    this._tornadoPullDir = null;
    this._tornadoSource = null;
    this._netPos = new THREE.Vector3();
    this._netHasPos = false;
    this.maxHp = CONFIG.wizardMaxHp;
    this.hp = this.maxHp;
    this.dead = false;
    this.ghost = null;
    this.ghostT = 0;
    this._ghostMats = [];
    this._netBuf = [];
    this.godMode = false;
    this._godGlow = [];
    this._godLight = null;
    this._godGlowT = 0;
    this.knockdown = null;
    this.tornado = null;
    this.invis = null;
    this._bodyMats = [];
    this._knockSeq = 0;
    this._lastKnockSeqApplied = 0;
    /** MP — po knockdownu pošle intent (nastaví main.js). */
    this.onKnockdown = null;
    /** Ukončení cast audia při #endCast (main.js). */
    this.onCastAudioStop = null;
    /** Dopad na zem — bodyfall (main.js). */
    this.onBodyFall = null;
    /** Výkřik při velkém zásahu / letu z tornáda (main.js). */
    this.onScream = null;
    /** Kroky — jen lokální hráč (main.js). */
    this.onFootstep = null;

    this.mesh.traverse((ch) => {
      if (!ch.isMesh || !ch.material || ch === this._softShadow) return;
      const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
      for (const m of mats) {
        if (m.userData._invisBaseOp == null) {
          m.userData._invisBaseOp = m.opacity ?? 1;
        }
        this._bodyMats.push(m);
        if (!m.isMeshStandardMaterial) continue;
        this._godGlow.push({
          mat: m,
          emissive: m.emissive.clone(),
          intensity: m.emissiveIntensity ?? 0
        });
      }
    });

    this.#placeOnLand(this.dir);
    tangentFrame(this.dir, tmp.east, tmp.north);
    this.facing.copy(tmp.north);
    this.#applyPose();
    if (!this.remote) this.#syncHealthUi();
  }

  /** Změna barvy hábitu (solo / před MP). */
  setRobeColor(hex) {
    this.color = Number(hex) || ROBE;
    const dark = new THREE.Color(this.color).multiplyScalar(0.42);
    for (const m of this._bodyMats) {
      if (m.userData.robeRole === "main") m.color.setHex(this.color);
      else if (m.userData.robeRole === "dark") m.color.copy(dark);
    }
    const parts = this.mesh.userData.parts;
    if (parts?.castOrbs) {
      const castBase = new THREE.Color(this.color);
      const castBright = castBase.clone().lerp(new THREE.Color(0xffffff), 0.4);
      const castSoft = castBase.clone().lerp(new THREE.Color(0x000000), 0.15);
      for (let i = 0; i < parts.castOrbs.length; i++) {
        const o = parts.castOrbs[i];
        if (!o.mesh?.material) continue;
        const bright = i % 3 !== 2;
        o.mesh.material.color.setHex(bright ? castBright.getHex() : castSoft.getHex());
      }
    }
  }

  dispose() {
    this.planetGroup.remove(this.mesh);
    this.mesh.traverse((ch) => {
      ch.geometry?.dispose();
      if (ch.material) {
        if (Array.isArray(ch.material)) ch.material.forEach((m) => m.dispose());
        else ch.material.dispose();
      }
    });
    if (this.footprints) {
      this.planetGroup.remove(this.footprints.group);
      this.footprints.leftFoot.geometry.dispose();
      this.footprints.rightFoot.geometry.dispose();
      this.footprints.mat.dispose();
    }
    if (this.ghost) {
      this.planetGroup.remove(this.ghost);
      for (const m of this._ghostMats) m.dispose();
    }
    if (this._godLight) {
      this.mesh.remove(this._godLight);
      this._godLight.dispose();
      this._godLight = null;
    }
    if (this._softShadow) {
      this.mesh.remove(this._softShadow);
      this._softShadow.geometry.dispose();
      this._softShadowMat.dispose();
      this._softShadow = null;
      this._softShadowMat = null;
    }
  }

  /** Vzdálený hráč — přidá snímek pozice do bufferu pro interpolaci. */
  applyNetPose(dirArr, facingArr, flags = {}) {
    if (!this.remote) return;
    const t = performance.now() * 0.001;
    const snap = poseSnapshotFromIntent(flags, dirArr, facingArr);
    snap.time = t;

    const buf = this._netBuf;
    const last = buf[buf.length - 1];
    if (last && t - last.time < 0.001) {
      Object.assign(last, snap);
      return;
    }
    buf.push(snap);
    while (buf.length > 24) buf.shift();
  }

  /** Interpolace mezi síťovými snímky (~80 ms zpět v čase). */
  #updateNetPose() {
    const buf = this._netBuf;
    if (!buf.length) return;

    const renderT = performance.now() * 0.001 - CONFIG.netPoseInterpDelay;

    while (buf.length > 2 && buf[1].time <= renderT) {
      buf.shift();
    }

    const latest = buf[buf.length - 1];
    if (typeof latest.hp === "number" && !this.dead) this.hp = latest.hp;
    applyKnockFromSnapshot(this, latest.knock, latest.hp);

    if (buf.length === 1) {
      applyInterpolatedPose(this, buf[0], buf[0], 1, this._netPos);
    } else {
      const a = buf[0];
      const b = buf[1];
      const span = b.time - a.time;
      const alpha =
        span > 1e-6
          ? THREE.MathUtils.clamp((renderT - a.time) / span, 0, 1)
          : renderT >= b.time
            ? 1
            : 0;
      applyInterpolatedPose(this, a, b, alpha, this._netPos);
    }
    this._netHasPos = true;
    // Stejně jako lokální hráč: pozice z směru na aktuálním terénu (geodeticky).
    this.mesh.position.copy(this.dir).multiplyScalar(this.#height(this.dir));
  }

  get isBusy() {
    return this.casting || this.dead || !!this.knockdown || !!this.tornado;
  }

  beginTornadoCapture(centerDir, source = null) {
    if (this.tornado || this.dead || this.godMode || this.casting || this.knockdown) return false;
    this.breakInvisibility();
    this.#clearTarget();
    this.wantsWalk = false;
    this.moving = false;
    if (this.casting) this.#endCast();
    this.tornado = {
      phase: "climb",
      t: 0,
      source,
      centerDir: centerDir.clone(),
      spinY: 0,
      sideZ: 0,
      preAmp: 0,
      orbitAng: Math.random() * Math.PI * 2,
      height: 0,
      wallU: 0,
      bodyRoll: 0
    };
    return true;
  }

  endTornadoCapture() {
    this.tornado = null;
  }

  /** Vtah tornáda — posun po povrchu směrem k cíli (m). */
  pullOnSurface(towardDir, stepM) {
    if (this.tornado || this.dead || this.godMode || this.casting || this.knockdown) return false;
    const target = towardDir.clone().normalize();
    const dot = Math.min(1, Math.max(-1, this.dir.dot(target)));
    const angle = Math.acos(dot);
    if (angle < 1e-5) return false;
    const t = Math.min(1, (stepM / CONFIG.planetR) / angle);
    slerpDirection(this._trial, this.dir, target, t);
    if (!this.#isWalkable(this._trial)) return false;
    this.#snap(this._trial);
    return true;
  }

  /** Spustí pád a kotrmelce (MP / lokální sim). */
  applyKnockdown(amount, fromDirArr, opts = {}) {
    if (this.godMode || this.dead || amount <= 0) return;
    if (typeof opts.hp === "number") this.hp = opts.hp;
    const from =
      fromDirArr instanceof THREE.Vector3
        ? fromDirArr
        : new THREE.Vector3(fromDirArr[0], fromDirArr[1], fromDirArr[2]);
    if (from.lengthSq() < 1e-8 && !opts.awayFrom) return;
    this.#startKnockdown(amount, from, opts.seq, opts);
  }

  /** Testovací GOD MODE — nesmrtelnost, 3× rychlost, záře. */
  setGodMode(on) {
    this.godMode = !!on;
    if (this.godMode && this.dead) {
      this.dead = false;
      this.hp = this.maxHp;
      if (this.ghost) {
        this.planetGroup.remove(this.ghost);
        for (const m of this._ghostMats) m.dispose();
        this._ghostMats.length = 0;
        this.ghost = null;
      }
      this.#syncHealthUi();
    }
    this.#applyGodGlow(this.godMode);
  }

  #applyGodGlow(on) {
    if (on && !this._godLight) {
      this._godLight = new THREE.PointLight(0xffe066, 1.4, 6, 2);
      this._godLight.position.set(0, 1.1, 0.35);
      this.mesh.add(this._godLight);
    } else if (!on && this._godLight) {
      this.mesh.remove(this._godLight);
      this._godLight.dispose();
      this._godLight = null;
    }
    for (const g of this._godGlow) {
      if (on) {
        g.mat.emissive.setHex(0xffe066);
        g.mat.emissiveIntensity = 0.55;
      } else {
        g.mat.emissive.copy(g.emissive);
        g.mat.emissiveIntensity = g.intensity;
      }
    }
  }

  #updateGodGlow(dt) {
    if (!this.godMode) return;
    this._godGlowT += dt;
    const pulse = 0.55 + 0.45 * Math.sin(this._godGlowT * 5.5);
    for (const g of this._godGlow) {
      g.mat.emissiveIntensity = 0.35 + pulse * 1.1;
    }
    if (this._godLight) this._godLight.intensity = 1.1 + pulse * 1.4;
  }

  takeDamage(amount, opts = {}) {
    // Vzdálený hráč: HP/knock jen ze sítě (pose + knock intent), ne z lokální simulace.
    if (this.remote || this.godMode || this.dead || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.#syncHealthUi();

    if (amount > 30) this.onScream?.();

    const fromDir = opts.fromDir;
    const canKnock =
      opts.knock !== false &&
      fromDir &&
      amount >= CONFIG.wizardKnockMinDamage &&
      this.hp > 0;
    if (canKnock) {
      this.#startKnockdown(amount, fromDir);
    }

    if (this.hp <= 0) this.#die();
  }

  heal(amount) {
    if (this.remote || this.dead || this.godMode || amount <= 0 || this.hp >= this.maxHp) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.#syncHealthUi();
  }

  #computeKnockRollDir(fromDir, out) {
    out.copy(this.dir).addScaledVector(fromDir, -this.dir.dot(fromDir));
    if (out.lengthSq() < 1e-8) tangentFrame(this.dir, tmp.east, out);
    else out.normalize();
  }

  #knockRollRadius() {
    return CONFIG.wizardHeightM * CONFIG.wizardKnockRollRadius;
  }

  /** Výška při kotoulu — kontakt se zemí */
  #knockLift(kd) {
    if (!kd) return 0;
    const r = this.#knockRollRadius();
    const onSide = kd.sideZ >= Math.PI * 0.4;
    if (onSide) return r * (0.4 + 0.6 * Math.abs(Math.sin(kd.barrelY)));
    return r * Math.sin(Math.min(kd.sideZ, Math.PI * 0.5));
  }

  #knockMove(kd, step) {
    if (this.remote || step <= 1e-5) return 0;
    const before = this._slopeSample.copy(this.dir);
    this._trial.copy(this.mesh.position).addScaledVector(kd.rollDir, step);
    if (this._trial.lengthSq() > 1e-8) {
      this._trial.normalize();
      if (this.#isWalkable(this._trial)) {
        this.#snap(this._trial);
        this.facing.copy(kd.rollDir);
        const d = Math.min(1, Math.max(-1, before.dot(this.dir)));
        return Math.acos(d) * CONFIG.planetR;
      }
    }
    return 0;
  }

  #startKnockdown(amount, fromDir, seq = null, opts = {}) {
    const nextSeq = seq ?? ++this._knockSeq;
    if (this.knockdown?.seq === nextSeq) return;
    if (nextSeq <= this._lastKnockSeqApplied) return;

    this._lastKnockSeqApplied = nextSeq;
    this.breakInvisibility();
    if (this.remote && amount > 30) this.onScream?.();
    this.#clearTarget();
    if (this.casting) this.#endCast();
    this.wantsWalk = false;
    this.moving = false;

    const ratio = Math.min(1, amount / this.maxHp);
    const rollDir = new THREE.Vector3();
    if (opts.awayFrom) {
      // Po tečně směrem od epicentra
      const c =
        opts.awayFrom instanceof THREE.Vector3
          ? opts.awayFrom
          : new THREE.Vector3(opts.awayFrom[0], opts.awayFrom[1], opts.awayFrom[2]);
      rollDir.copy(c).addScaledVector(this.dir, -c.dot(this.dir));
      if (rollDir.lengthSq() < 1e-8) tangentFrame(this.dir, tmp.east, rollDir);
      else rollDir.normalize();
      // Geodeticky pryč od středu: -(projekce epicentra na tečnu)
      rollDir.negate();
    } else {
      this.#computeKnockRollDir(fromDir, rollDir);
    }
    this.facing.copy(rollDir);

    const rotCount =
      typeof opts.rotations === "number"
        ? Math.max(0.5, opts.rotations)
        : 1 + ratio * CONFIG.wizardKnockExtraRotationsMax;
    const rollR = this.#knockRollRadius();
    const minRot = Math.PI * 2 * rotCount;
    const rollDist =
      typeof opts.rollDistance === "number"
        ? Math.max(0.5, opts.rollDistance)
        : minRot * rollR;
    const slideVel = rollDist * CONFIG.wizardKnockSlideFriction * 1.15;

    const fromStored =
      opts.awayFrom
        ? (opts.awayFrom instanceof THREE.Vector3
            ? opts.awayFrom.clone().normalize()
            : new THREE.Vector3(opts.awayFrom[0], opts.awayFrom[1], opts.awayFrom[2]).normalize())
        : fromDir.clone().normalize();

    this.knockdown = {
      seq: nextSeq,
      phase: "fall",
      t: 0,
      fallT: 0,
      amount,
      fromDir: fromStored,
      rollDir,
      sideZ: 0,
      barrelY: 0,
      slideVel,
      slideDist: 0,
      rollDist,
      minRot,
      rotations: rotCount,
      away: !!opts.awayFrom,
      riseDur: CONFIG.wizardKnockRiseDur
    };

    if (!this.remote && this.onKnockdown) this.onKnockdown(this.knockdown);
  }

  #updateKnockdown(dt) {
    const kd = this.knockdown;
    if (!kd) return;

    kd.t += dt;
    const r = this.#knockRollRadius();
    const fallEnd = Math.PI * 0.5;

    if (kd.phase === "fall") {
      kd.fallT += dt;
      const u = Math.min(1, kd.fallT / CONFIG.wizardKnockFallDur);
      const ease = 1 - (1 - u) ** 3;
      kd.sideZ = ease * fallEnd;
      const rollBlend = Math.max(0, (u - 0.4) / 0.6);
      const step = kd.slideVel * dt * (0.12 + 0.88 * rollBlend);
      const moved = this.#knockMove(kd, step);
      kd.slideDist += moved;
      // Rotace úměrná uražené vzdálenosti → přesný počet otoček na rollDist
      kd.barrelY += moved * (kd.minRot / Math.max(kd.rollDist, 0.01));
      if (u >= 1) {
        kd.phase = "roll";
        kd.sideZ = fallEnd;
        kd.t = 0;
        this.onBodyFall?.();
      }
      return;
    }

    if (kd.phase === "roll") {
      kd.sideZ = fallEnd;
      kd.slideVel *= Math.exp(-CONFIG.wizardKnockSlideFriction * dt);
      const step = kd.slideVel * dt;
      const moved = this.#knockMove(kd, step);
      kd.slideDist += moved;
      kd.barrelY += moved * (kd.minRot / Math.max(kd.rollDist, 0.01));

      const doneDist = kd.slideDist >= kd.rollDist * 0.98;
      const doneRot = kd.barrelY >= kd.minRot * 0.98;
      const stalled = moved < 1e-4 && kd.t > 0.35;
      if (doneDist || doneRot || stalled || kd.t > 4) {
        kd.barrelY = kd.minRot;
        kd.phase = "rise";
        kd.t = 0;
      }
      return;
    }

    if (kd.phase === "rise") {
      const u = Math.min(1, kd.t / kd.riseDur);
      const e = u * u * (3 - 2 * u);
      const full = Math.PI * 2;
      const barrelTarget = Math.round(kd.minRot / full) * full;
      kd.barrelY += (barrelTarget - kd.barrelY) * Math.min(1, dt * (6 + e * 10));
      kd.sideZ *= 1 - Math.min(1, dt * (5 + e * 8));
      if (u >= 1) {
        kd.sideZ = 0;
        kd.barrelY = barrelTarget;
        this.knockdown = null;
      }
    }
  }

  #applyKnockPose(parts) {
    const kd = this.knockdown;
    if (!kd || !parts) return;

    parts.body.position.set(0, 0, 0);
    parts.body.rotation.order = "ZYX";
    parts.body.rotation.set(0, kd.barrelY, -kd.sideZ);

    parts.leftLeg.rotation.set(0, 0, 0);
    parts.rightLeg.rotation.set(0, 0, 0);
    parts.leftArm.rotation.set(0, 0, 0);
    parts.rightArm.rotation.set(0, 0, 0);

    if (kd.phase === "roll") {
      const tuck = 0.32 * Math.sin(kd.barrelY * 2);
      parts.leftLeg.rotation.x = tuck;
      parts.rightLeg.rotation.x = tuck;
    }

    if (parts.castFx) parts.castFx.visible = false;
  }

  #applyTornadoPose(parts) {
    const td = this.tornado;
    if (!td || !parts) return;

    parts.body.position.set(0, 0, 0);
    parts.body.rotation.order = "ZYX";
    parts.leftLeg.rotation.set(0, 0, 0);
    parts.rightLeg.rotation.set(0, 0, 0);
    parts.leftArm.rotation.set(0, 0, 0);
    parts.rightArm.rotation.set(0, 0, 0);

    const side = td.sideZ ?? 0;
    const phase = td.phase;

    if (phase === "climb") {
      parts.body.rotation.set(
        Math.sin(td.spinY * 1.8) * (td.preAmp || 0) * 0.3,
        td.spinY,
        -side
      );
      const sway = Math.sin(td.spinY * 2.2) * 0.2 * (td.preAmp || 0);
      parts.leftArm.rotation.z = sway;
      parts.rightArm.rotation.z = -sway;
      if (side > 0.2) {
        const tuck = 0.25 * Math.sin((td.bodyRoll || 0) * 2);
        parts.leftLeg.rotation.x = tuck;
        parts.rightLeg.rotation.x = tuck;
      }
    } else if (phase === "air" || phase === "lie" || phase === "rise") {
      parts.body.rotation.set(0, td.bodyRoll || 0, -side);
      const tuck = 0.28 * Math.sin((td.bodyRoll || 0) * 2);
      parts.leftLeg.rotation.x = tuck;
      parts.rightLeg.rotation.x = tuck;
    }

    if (parts.castFx) parts.castFx.visible = false;
  }

  #syncHealthUi() {
    if (this.remote) return;
    const fill = document.getElementById("health-fill");
    const text = document.getElementById("health-text");
    const pct = (this.hp / this.maxHp) * 100;
    if (fill) {
      fill.style.width = `${pct}%`;
      fill.classList.toggle("low", pct <= 30);
      fill.classList.toggle("mid", pct > 30 && pct <= 60);
    }
    if (text) text.textContent = String(Math.ceil(this.hp));
  }

  #die() {
    if (this.dead || this.godMode) return;
    this.breakInvisibility();
    this.dead = true;
    this.knockdown = null;
    this.tornado = null;
    this.#clearTarget();
    this.casting = false;
    this._onCastComplete = null;
    this.moving = false;
    const parts = this.mesh.userData.parts;
    if (parts?.castFx) parts.castFx.visible = false;

    this.#spawnGhost();
  }

  #spawnGhost() {
    this.#applyPose();
    const ghost = this.mesh.clone(true);
    ghost.traverse((ch) => {
      if (!ch.isMesh || !ch.material) return;
      const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
      const next = mats.map((m) => {
        const gm = new THREE.MeshBasicMaterial({
          color: m.color ? m.color.clone() : new THREE.Color(0xc8e8ff),
          transparent: true,
          opacity: 0.45,
          depthWrite: false
        });
        this._ghostMats.push(gm);
        return gm;
      });
      ch.material = next.length === 1 ? next[0] : next;
      ch.castShadow = false;
      ch.receiveShadow = false;
    });
    ghost.position.copy(this.mesh.position);
    ghost.quaternion.copy(this.mesh.quaternion);
    ghost.scale.copy(this.mesh.scale);
    this.planetGroup.add(ghost);
    this.ghost = ghost;
    this.ghostT = 0;
  }

  #height(dir) {
    return this.terrain.height(dir);
  }

  #isWalkable(dir) {
    return this.#height(dir) > CONFIG.wizardMinTerrainR;
  }

  #isInWater() {
    return this.#height(this.dir) < CONFIG.waterLevel + 0.04;
  }

  #isHeadSubmerged() {
    const headH = this.#height(this.dir) + CONFIG.wizardHeightM - 0.12;
    return headH < CONFIG.waterLevel;
  }

  #waterSpeedMul() {
    return this.#isInWater() ? CONFIG.wizardWaterSpeedMul : 1;
  }

  #applyDrowning(dt) {
    if (this.dead || this.godMode || !this.#isHeadSubmerged()) return;
    this.takeDamage(CONFIG.wizardDrownHpPerSec * dt);
  }

  #snap(dir) {
    this.dir.copy(dir).normalize();
    this.mesh.position.copy(this.dir).multiplyScalar(this.#height(this.dir));
  }

  #remainToTarget() {
    if (!this.hasTarget) return Infinity;
    const dot = Math.min(1, Math.max(-1, this.dir.dot(this.targetDir)));
    return Math.acos(dot) * CONFIG.planetR;
  }

  /** Plynulý posun po povrchu směrem k cíli (max. maxDist metrů po oblouku). */
  #stepTowardTarget(maxDist) {
    const dot = Math.min(1, Math.max(-1, this.dir.dot(this.targetDir)));
    const omega = Math.acos(dot);
    if (omega < 1e-8) return true;

    const angle = Math.min(omega, maxDist / CONFIG.planetR);
    if (angle < 1e-10) return false;

    this._stepDir.crossVectors(this.dir, this.targetDir);
    if (this._stepDir.lengthSq() < 1e-12) {
      this.dir.copy(this.targetDir);
    } else {
      this._stepDir.normalize();
      this.dir.applyAxisAngle(this._stepDir, angle).normalize();
    }
    this.mesh.position.copy(this.dir).multiplyScalar(this.#height(this.dir));
    return omega <= angle + 1e-6;
  }

  #clearTarget() {
    this.hasTarget = false;
    this.footprints?.hide();
  }

  setDestination(localPoint) {
    if (this.isBusy) return false;
    this._trial.copy(localPoint).normalize();
    if (!this.#isWalkable(this._trial)) return false;
    this.targetDir.copy(this._trial);
    this.hasTarget = true;
    this.footprints?.show(this.targetDir, this.dir);
    return true;
  }

  /** Náhled cíle chůze pod kurzorem — jen dokud není kliknuto. */
  previewWalk(localPoint) {
    if (this.isBusy || this.hasTarget) return;
    this._trial.copy(localPoint).normalize();
    if (!this.#isWalkable(this._trial)) {
      this.footprints?.hide();
      return;
    }
    this.footprints?.show(this._trial, this.dir);
  }

  hideWalkPreview() {
    if (!this.hasTarget) this.footprints?.hide();
  }

  /** Rychlost podle sklonu: do kopce zpomalí, z kopce lehce zrychlí. */
  #slopeSpeedMul(moveDir) {
    const probe = 0.55;
    const h0 = this.#height(this.dir);
    this._slopeSample.copy(this.mesh.position).addScaledVector(moveDir, probe);
    if (this._slopeSample.lengthSq() < 1e-8) return 1;
    this._slopeSample.normalize();
    const h1 = this.#height(this._slopeSample);
    const grade = (h1 - h0) / probe;

    if (grade >= 0) {
      // 0 flat → 1, ~0.4 mírný → ~0.55, ~1.0 prudký → ~0.25, 1.6+ → min
      const mul = 1 / (1 + grade * grade * 3.2 + grade * 1.1);
      return Math.max(CONFIG.wizardUphillMin, mul);
    }
    // z kopce: grade záporný
    return Math.min(CONFIG.wizardDownhillBoost, 1 - grade * 0.4);
  }

  #endCast() {
    const wasCasting = this.casting;
    this.casting = false;
    if (wasCasting && !this.remote) this.onCastAudioStop?.();
    const cb = this._onCastComplete;
    this._onCastComplete = null;
    const parts = this.mesh.userData.parts;
    if (parts) {
      if (parts.castFx) parts.castFx.visible = false;
      parts.rightArm.rotation.set(0, 0, 0);
      parts.leftArm.rotation.set(0, 0, 0);
    }
    if (cb) cb();
  }

  /** Začni vizuální show kouzlení směrem k cíli. onComplete po skončení. */
  startCast(targetDir, duration = CONFIG.spellDuration, onComplete = null) {
    if (this.isBusy) return false;
    // Kouzlení v neviditelnosti = okamžité zviditelnění
    this.breakInvisibility();
    this.#clearTarget();
    this.wantsWalk = false;
    this.casting = true;
    this.castT = 0;
    this.castDuration = duration;
    this._onCastComplete = onComplete;
    this._castFace.copy(targetDir).normalize();
    this._castFace.addScaledVector(this.dir, -this._castFace.dot(this.dir));
    if (this._castFace.lengthSq() > 1e-8) {
      this.facing.copy(this._castFace).normalize();
    }
    const parts = this.mesh.userData.parts;
    if (parts?.castFx) parts.castFx.visible = true;
    return true;
  }

  /**
   * Neviditelnost: lokální hráč semitransparent, remote úplně skrytý.
   * Po hold sekundách se najednou znovu plně zviditelní.
   */
  beginInvisibility(opts = {}) {
    if (this.dead) return;
    this.invis = {
      t: 0,
      hold: opts.hold ?? 10,
      localOpacity: opts.localOpacity ?? 0.5,
      remoteOpacity: opts.remoteOpacity ?? 0
    };
    this.#applyInvisOpacity();
  }

  breakInvisibility() {
    if (!this.invis) return;
    this.invis = null;
    this.#setBodyOpacity(1);
    if (!this.dead) this.mesh.visible = true;
  }

  #invisOpacity() {
    const inv = this.invis;
    if (!inv) return 1;
    return this.remote ? inv.remoteOpacity : inv.localOpacity;
  }

  #applyInvisOpacity() {
    this.#setBodyOpacity(this.#invisOpacity());
  }

  #setBodyOpacity(op) {
    const hidden = this.remote && op < 0.02;
    if (!this.dead) this.mesh.visible = !hidden;

    for (const m of this._bodyMats) {
      const base = m.userData._invisBaseOp ?? 1;
      const o = Math.min(1, Math.max(0, base * op));
      m.transparent = o < 0.999;
      m.opacity = o;
      m.depthWrite = o > 0.85;
      m.needsUpdate = true;
    }

    // Shadow-map stín umí jen zap/vyp — při neviditelnosti vypnout a použít měkký stín s opacity
    const fullyVisible = op >= 0.995;
    this.mesh.traverse((ch) => {
      if (!ch.isMesh || ch === this._softShadow) return;
      ch.castShadow = fullyVisible && !hidden;
    });
    this.#updateSoftShadow(op, hidden);

    if (this.footprints?.group) {
      if (op <= 0.85) this.footprints.group.visible = false;
      else if (this.hasTarget) this.footprints.show(this.targetDir, this.dir);
    }
  }

  /** Měkký kontaktní stín pod nohama — opacity kopíruje neviditelnost. */
  #createSoftShadow() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.55, 28), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.03;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 1;
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.mesh.add(mesh);
    this._softShadow = mesh;
    this._softShadowMat = mat;
  }

  #updateSoftShadow(op, hidden = false) {
    if (!this._softShadow || !this._softShadowMat) return;
    if (hidden || op >= 0.995) {
      this._softShadow.visible = false;
      this._softShadowMat.opacity = 0;
      return;
    }
    // Stejná „síla“ stínu jako tělo — při 50 % neviditelnosti i stín na ~50 %
    const softOp = Math.max(0, Math.min(1, op)) * 0.55;
    this._softShadowMat.opacity = softOp;
    this._softShadow.visible = softOp > 0.02;
    this._softShadow.scale.setScalar(0.85 + (1 - op) * 0.25);
  }

  #updateInvisibility(dt) {
    if (!this.invis) return;
    this.invis.t += dt;
    if (this.invis.t >= this.invis.hold) {
      this.breakInvisibility();
    }
  }

  #placeOnLand(preferred) {
    this._trial.copy(preferred).normalize();
    if (this.#isWalkable(this._trial)) {
      this.#snap(this._trial);
      return;
    }
    tangentFrame(this._trial, tmp.east, tmp.north);
    for (let ring = 1; ring <= 24; ring++) {
      const angStep = Math.PI / Math.max(4, ring * 2);
      const offset = ring * 0.04;
      for (let a = 0; a < Math.PI * 2; a += angStep) {
        this._trial.copy(preferred)
          .addScaledVector(tmp.east, Math.cos(a) * offset)
          .addScaledVector(tmp.north, Math.sin(a) * offset)
          .normalize();
        if (this.#isWalkable(this._trial)) {
          this.#snap(this._trial);
          return;
        }
      }
    }
    this.#snap(preferred);
  }

  #applyPose() {
    this.facing.addScaledVector(this.dir, -this.facing.dot(this.dir));
    if (this.facing.lengthSq() < 1e-8) {
      tangentFrame(this.dir, tmp.east, this.facing);
    } else {
      this.facing.normalize();
    }
    this._basisX.crossVectors(this.dir, this.facing).normalize();
    this.facing.crossVectors(this._basisX, this.dir).normalize();
    this._mat.makeBasis(this._basisX, this.dir, this.facing);
    this.mesh.quaternion.setFromRotationMatrix(this._mat);
    // Mrtvý — leží na boku (překlopit kolem lokální X)
    if (this.dead) this.mesh.rotateOnAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  }

  update(dt, keys, camRight) {
    if (this.remote) {
      if (this.casting) {
        this.castT += dt;
        if (this.castT >= this.castDuration) this.#endCast();
      }
      this.#updateNetPose();
      if (this.knockdown) this.#updateKnockdown(dt);
      this.#applyPose();
      this.#updateWalkBlend(dt);
      this.#animate(dt);
      this.#updateInvisibility(dt);
      if (this.dead) this.#updateGhost(dt);
      return;
    }

    if (this.dead) {
      this.mesh.position.copy(this.dir).multiplyScalar(this.#height(this.dir));
      this.#applyPose();
      this.#updateGhost(dt);
      this.footprints?.update(dt);
      return;
    }

    if (this.knockdown) {
      this.#updateKnockdown(dt);
    }
    if (this.knockdown) {
      const lift = this.#knockLift(this.knockdown);
      this.mesh.position.copy(this.dir).multiplyScalar(this.#height(this.dir) + lift);
      this.#applyPose();
      this.#updateWalkBlend(dt);
      this.#updateGodGlow(dt);
      this.#animate(dt);
      this.#updateInvisibility(dt);
      this.footprints?.update(dt);
      return;
    }

    if (this.tornado) {
      this.#applyPose();
      this.#updateWalkBlend(dt);
      this.#updateGodGlow(dt);
      this.#animate(dt);
      this.#updateInvisibility(dt);
      this.footprints?.update(dt);
      return;
    }

    this._invPlanet.copy(this.planetGroup.matrixWorld).invert();
    this._camRightLocal.copy(camRight).transformDirection(this._invPlanet);

    this._right.copy(this._camRightLocal).addScaledVector(this.dir, -this._camRightLocal.dot(this.dir));
    if (this._right.lengthSq() < 1e-8) {
      tangentFrame(this.dir, this._right, this._fwd);
    } else {
      this._right.normalize();
      this._fwd.crossVectors(this.dir, this._right).normalize();
    }

    this._move.set(0, 0, 0);
    if (!this.casting) {
      if (this.hasTarget) {
        const remain = this.#remainToTarget();
        if (remain <= CONFIG.wizardArrive) {
          this.#clearTarget();
        } else {
          const dot = Math.min(1, Math.max(-1, this.dir.dot(this.targetDir)));
          this._move.copy(this.targetDir).addScaledVector(this.dir, -dot);
          if (this._move.lengthSq() > 1e-10) this._move.normalize();
          else this.#clearTarget();
        }
      }

      this.wantsWalk = this._move.lengthSq() > 1e-8;
      this.moving = this.wantsWalk || this.walkBlend > 0.06;

      if (this.wantsWalk && this.walkBlend > 0.02) {
        this._speedMul = this.#slopeSpeedMul(this._move) * this.#waterSpeedMul();
        const speed =
          CONFIG.wizardSpeed * (this.godMode ? CONFIG.godModeSpeedMul : 1);
        const tornadoMul = this._tornadoMoveMul ?? 1;
        const lavaMul = this._lavaMoveMul ?? 1;
        let step = speed * this._speedMul * this.walkBlend * tornadoMul * lavaMul * dt;

        if (this.hasTarget) {
          step = Math.min(step, this.#remainToTarget());
        }

        if (step > 1e-6) {
          if (this.hasTarget) {
            const arrived = this.#stepTowardTarget(step);
            this.facing.copy(this._move);
            if (!this.#isWalkable(this.dir)) {
              this.#clearTarget();
            } else if (arrived || this.#remainToTarget() <= CONFIG.wizardArrive) {
              this.#clearTarget();
            }
          } else {
            this._trial.copy(this.mesh.position).addScaledVector(this._move, step);
            if (this._trial.lengthSq() > 1e-8) {
              this._trial.normalize();
              if (this.#isWalkable(this._trial)) {
                this.#snap(this._trial);
                this.facing.copy(this._move);
              }
            }
          }
        }
      } else if (!this.wantsWalk) {
        this._speedMul = 1;
      }
    } else {
      this.wantsWalk = false;
      this.moving = false;
      this._speedMul = 1;
      this.castT += dt;
      if (this.castT >= this.castDuration) this.#endCast();
    }

    // Drž nohy na povrchu (morph pod ním)
    this.mesh.position.copy(this.dir).multiplyScalar(this.#height(this.dir));
    this.#applyDrowning(dt);

    this.#applyPose();
    this.#updateWalkBlend(dt);
    this.#updateGodGlow(dt);
    this.#animate(dt);
    this.#updateInvisibility(dt);
    this.footprints?.update(dt);
  }

  #updateGhost(dt) {
    if (!this.ghost) return;
    this.ghostT += dt;
    const rise = 2.8 * dt;
    this.ghost.position.addScaledVector(this.dir, rise);
    const fade = Math.max(0, 1 - this.ghostT / 3.2);
    for (const m of this._ghostMats) m.opacity = 0.45 * fade;
    if (this.ghostT >= 3.2) {
      this.planetGroup.remove(this.ghost);
      for (const m of this._ghostMats) m.dispose();
      this._ghostMats.length = 0;
      this.ghost = null;
    }
  }

  /** Plynulý rozjezd / dojezd chůze (0 = stojí, 1 = plná chůze). */
  #updateWalkBlend(dt) {
    const target =
      this.casting || this.dead || this.knockdown || this.tornado ? 0 : this.wantsWalk ? 1 : 0;
    const rate = target > this.walkBlend ? 3.2 : 4;
    this.walkBlend += (target - this.walkBlend) * Math.min(1, dt * rate);
    if (this.walkBlend < 0.003 && target === 0) {
      this.walkBlend = 0;
      this.walkPhase = 0;
      this._lastStepHalf = -1;
    } else if (target === 0 && this.walkBlend < 0.2) {
      const stand = Math.round(this.walkPhase / Math.PI) * Math.PI;
      this.walkPhase += (stand - this.walkPhase) * Math.min(1, dt * 8);
    }
  }

  /** Jedna noha na zem — volá onFootstep při každé půl-periodě chůze. */
  #maybeFootstep() {
    if (this.remote || this.walkBlend < 0.06 || !this.onFootstep) return;
    const half = Math.floor(this.walkPhase / Math.PI);
    if (half === this._lastStepHalf) return;
    this._lastStepHalf = half;
    const god = this.godMode ? CONFIG.godModeSpeedMul : 1;
    const speed =
      CONFIG.wizardSpeed *
      god *
      this._speedMul *
      this._tornadoMoveMul *
      this._lavaMoveMul *
      this.walkBlend;
    this.onFootstep({
      inWater: this.#isInWater(),
      speed,
      walkBlend: this.walkBlend
    });
  }

  #animate(dt) {
    const parts = this.mesh.userData.parts;
    if (!parts) return;

    if (this.knockdown) {
      this.#applyKnockPose(parts);
      return;
    }

    if (this.tornado) {
      this.#applyTornadoPose(parts);
      return;
    }

    if (this.casting) {
      if (parts.body) {
        parts.body.rotation.set(0, 0, 0);
        parts.body.position.y = 0;
      }
      const t = this.castT;
      const pulse = 0.5 + 0.5 * Math.sin(t * 9);

      // Obě ruce mírně od těla — channeling, ne světélko v dlani
      parts.rightArm.rotation.x = -0.55 + Math.sin(t * 1.4) * 0.05;
      parts.rightArm.rotation.z = -0.55 + Math.sin(t * 2.1) * 0.08;
      parts.leftArm.rotation.x = -0.55 + Math.cos(t * 1.4) * 0.05;
      parts.leftArm.rotation.z = 0.55 + Math.cos(t * 2.1) * 0.08;
      parts.leftLeg.rotation.x = 0;
      parts.rightLeg.rotation.x = 0;

      if (parts.castFx) {
        if (parts.castOrbs) {
          for (const o of parts.castOrbs) {
            const a = t * o.speed + o.phase;
            const y = o.y0 + Math.sin(t * o.spin + o.phase) * o.bob;
            o.mesh.position.set(Math.cos(a) * o.r, y, Math.sin(a) * o.r);
            if (o.kind === "shard") {
              o.mesh.rotation.set(t * o.spin, a, t * 1.7);
            }
            const s = 0.75 + pulse * 0.45;
            o.mesh.scale.setScalar(s);
            if (o.mesh.material) {
              o.mesh.material.opacity = 0.4 + pulse * 0.45;
            }
          }
        }
        if (parts.castRings) {
          for (const r of parts.castRings) {
            r.mesh.rotation.y = t * r.speed;
            r.mesh.rotation.z += dt * r.speed * 0.35;
            r.mesh.scale.setScalar(0.92 + pulse * 0.14);
            if (r.mesh.material) r.mesh.material.opacity = 0.22 + pulse * 0.28;
          }
        }
      }
      return;
    }

    parts.rightArm.rotation.set(0, 0, 0);
    parts.leftArm.rotation.set(0, 0, 0);
    parts.leftLeg.rotation.set(0, 0, 0);
    parts.rightLeg.rotation.set(0, 0, 0);
    if (parts.body) {
      parts.body.rotation.set(0, 0, 0);
      parts.body.position.y = 0;
    }

    const b = this.walkBlend;
    if (b < 0.001) return;

    this.walkPhase += dt * (5.5 + 4.2 * this._speedMul) * (0.35 + 0.65 * b);
    const amp = (0.58 + 0.34 * this._speedMul) * b;
    const s = Math.sin(this.walkPhase) * amp;
    const lift = 0.22 * b;

    parts.leftLeg.rotation.x = s + Math.max(0, s) * lift;
    parts.rightLeg.rotation.x = -s + Math.max(0, -s) * lift;
    parts.leftLeg.rotation.z = s * 0.12;
    parts.rightLeg.rotation.z = -s * 0.12;

    parts.leftArm.rotation.x = -s * 0.8;
    parts.rightArm.rotation.x = s * 0.65;
    parts.leftArm.rotation.z = s * 0.2;
    parts.rightArm.rotation.z = -s * 0.16;

    if (parts.body) {
      parts.body.position.y = Math.abs(Math.sin(this.walkPhase * 2)) * 0.04 * b;
    }

    this.#maybeFootstep();
  }
}
