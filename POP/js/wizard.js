import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame, tmp, slerpDirection, surfaceOffsetDir } from "./utils.js";
import {
  applyInterpolatedPose,
  applyKnockFromSnapshot,
  poseSnapshotFromIntent
} from "./net/wizard-sync.js";
import { WalkFootprints } from "./spells/fx-aim.js";
import {
  attachImmortalBubble,
  detachImmortalBubble
} from "./spells/immortality.js";
import { WIZARD_BODY_R } from "./blockers.js";
import { surfaceDist } from "./spells/fx-common.js";

const ROBE = 0x1a2848;
const GOLD = 0xd4a837;
const GOLD_DIM = 0xa88628;

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

function addMesh(parent, geo, material, x, y, z, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  if (rx || ry || rz) mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function mkBasic(color, opts = {}) {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}

/** Čaroděj v kápi (lokální Y = nahoru od povrchu, +Z = obličej). */
export function createWizardMesh(robeColor = ROBE) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const robe = Number(robeColor) || ROBE;
  const robeDark = new THREE.Color(robe).multiplyScalar(0.38).getHex();
  const robeDeeper = new THREE.Color(robe).multiplyScalar(0.22).getHex();
  const robeMat = mat(robe, { roughness: 0.86 });
  const robeDarkMat = mat(robeDark, { roughness: 0.9 });
  const robeDeepMat = mat(robeDeeper, { roughness: 0.92 });
  robeMat.userData.robeRole = "main";
  robeDarkMat.userData.robeRole = "dark";
  robeDeepMat.userData.robeRole = "deeper";
  const goldMat = mat(GOLD, { roughness: 0.48, metalness: 0.42 });
  const goldDimMat = mat(GOLD_DIM, { roughness: 0.58, metalness: 0.28 });
  const gloveMat = mat(0x1a1410, { roughness: 0.7 });
  const bootMat = mat(0x14100c, { roughness: 0.78 });
  const voidMat = mkBasic(0x000000);
  const liningMat = mkBasic(0x040308, { side: THREE.BackSide });
  const eyeGlowMat = mkBasic(0xffd56a);

  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.13, 0.78, 0.02);
  addMesh(leftLeg, new THREE.CapsuleGeometry(0.072, 0.24, 4, 8), robeDarkMat, 0, -0.15, 0);
  const leftShin = new THREE.Group();
  leftShin.position.set(0, -0.3, 0);
  leftLeg.add(leftShin);
  addMesh(leftShin, new THREE.CapsuleGeometry(0.06, 0.22, 4, 8), robeDeepMat, 0, -0.14, 0);
  addMesh(leftShin, new THREE.BoxGeometry(0.15, 0.09, 0.28), bootMat, 0, -0.32, 0.06);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.13, 0.78, 0.02);
  addMesh(rightLeg, new THREE.CapsuleGeometry(0.072, 0.24, 4, 8), robeDarkMat, 0, -0.15, 0);
  const rightShin = new THREE.Group();
  rightShin.position.set(0, -0.3, 0);
  rightLeg.add(rightShin);
  addMesh(rightShin, new THREE.CapsuleGeometry(0.06, 0.22, 4, 8), robeDeepMat, 0, -0.14, 0);
  addMesh(rightShin, new THREE.BoxGeometry(0.15, 0.09, 0.28), bootMat, 0, -0.32, 0.06);

  const frontGap = 1.12;
  const skirtPts = [
    new THREE.Vector2(0.46, 0.2),
    new THREE.Vector2(0.38, 0.36),
    new THREE.Vector2(0.29, 0.6),
    new THREE.Vector2(0.22, 0.86),
    new THREE.Vector2(0.19, 1.12)
  ];
  addMesh(
    body,
    new THREE.LatheGeometry(skirtPts, 20, frontGap * 0.5, Math.PI * 2 - frontGap),
    robeMat,
    0, 0, 0
  );
  const innerPts = skirtPts.map((p) => new THREE.Vector2(Math.max(0.04, p.x - 0.018), p.y));
  addMesh(
    body,
    new THREE.LatheGeometry(innerPts, 18, frontGap * 0.5, Math.PI * 2 - frontGap),
    liningMat,
    0, 0, 0
  );

  addMesh(body, new THREE.LatheGeometry([
    new THREE.Vector2(0.18, 1.1),
    new THREE.Vector2(0.22, 1.24),
    new THREE.Vector2(0.25, 1.4),
    new THREE.Vector2(0.23, 1.54),
    new THREE.Vector2(0.13, 1.62)
  ], 14), robeMat, 0, 0, 0);

  addMesh(body, new THREE.SphereGeometry(0.155, 10, 8), robeMat, -0.22, 1.46, 0);
  addMesh(body, new THREE.SphereGeometry(0.155, 10, 8), robeMat, 0.22, 1.46, 0);
  addMesh(body, new THREE.TorusGeometry(0.195, 0.026, 6, 16), goldMat, 0, 1.14, 0.02, Math.PI / 2, 0, 0);
  addMesh(body, new THREE.BoxGeometry(0.055, 0.38, 0.035), goldDimMat, 0, 1.36, 0.21);

  const cloak = new THREE.Group();
  cloak.position.set(0, 1.5, -0.04);
  body.add(cloak);
  const cloakPts = [
    new THREE.Vector2(0.14, 0.04),
    new THREE.Vector2(0.22, -0.28),
    new THREE.Vector2(0.32, -0.7),
    new THREE.Vector2(0.44, -1.12)
  ];
  addMesh(
    cloak,
    new THREE.LatheGeometry(cloakPts, 14, Math.PI - 1.15, 2.3),
    robeDarkMat,
    0, 0, 0
  );
  addMesh(
    cloak,
    new THREE.LatheGeometry(
      cloakPts.map((p) => new THREE.Vector2(Math.max(0.04, p.x - 0.02), p.y)),
      12,
      Math.PI - 1.15,
      2.3
    ),
    liningMat,
    0, 0, 0
  );

  const head = new THREE.Group();
  head.position.set(0, 1.64, 0.03);
  body.add(head);

  // Kápi: otevřená vpředu, uvnitř neosvětlená tma
  const hoodOpen = 1.58;
  const hoodPhi0 = Math.PI / 2 + hoodOpen * 0.5;
  const hoodPhiLen = Math.PI * 2 - hoodOpen;
  const cowl = addMesh(
    head,
    new THREE.SphereGeometry(0.255, 18, 14, hoodPhi0, hoodPhiLen),
    robeDarkMat,
    0, 0.1, -0.06
  );
  cowl.scale.set(1.04, 1.0, 1.12);
  const cowlInner = addMesh(
    head,
    new THREE.SphereGeometry(0.242, 18, 14, hoodPhi0, hoodPhiLen),
    liningMat,
    0, 0.1, -0.06
  );
  cowlInner.scale.set(1.04, 1.0, 1.12);
  addMesh(head, new THREE.SphereGeometry(0.12, 12, 10), robeDarkMat, 0, 0.26, -0.16).scale.set(0.92, 0.78, 1.08);
  addMesh(head, new THREE.SphereGeometry(0.1, 10, 8), robeDarkMat, 0, 0.2, 0.0).scale.set(1.45, 0.38, 0.62);
  addMesh(head, new THREE.SphereGeometry(0.095, 8, 6), robeDarkMat, -0.165, 0.05, 0.0);
  addMesh(head, new THREE.SphereGeometry(0.095, 8, 6), robeDarkMat, 0.165, 0.05, 0.0);
  addMesh(head, new THREE.TorusGeometry(0.13, 0.018, 6, 20), goldMat, 0, 0.06, 0.11, 0.18, 0, 0);

  const voidFill = addMesh(head, new THREE.SphereGeometry(0.13, 12, 10), voidMat, 0, 0.05, 0.02);
  voidFill.scale.set(0.92, 0.95, 0.68);

  const leftEye = addMesh(head, new THREE.SphereGeometry(0.028, 8, 6), eyeGlowMat, -0.038, 0.05, 0.122);
  const rightEye = addMesh(head, new THREE.SphereGeometry(0.028, 8, 6), eyeGlowMat, 0.038, 0.05, 0.122);
  for (const m of [leftEye, rightEye, voidFill, cowlInner]) {
    m.castShadow = false;
    m.receiveShadow = false;
  }

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.32, 1.42, 0);
  addMesh(leftArm, new THREE.CapsuleGeometry(0.055, 0.2, 4, 8), robeMat, 0, -0.13, 0);
  addMesh(leftArm, new THREE.TorusGeometry(0.058, 0.016, 5, 10), goldDimMat, 0, -0.26, 0, Math.PI / 2, 0, 0);
  const leftFore = new THREE.Group();
  leftFore.position.set(0, -0.28, 0);
  leftArm.add(leftFore);
  addMesh(leftFore, new THREE.CapsuleGeometry(0.048, 0.18, 4, 8), robeDarkMat, 0, -0.11, 0);
  addMesh(leftFore, new THREE.SphereGeometry(0.052, 8, 6), gloveMat, 0, -0.24, 0.015);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.32, 1.42, 0);
  addMesh(rightArm, new THREE.CapsuleGeometry(0.055, 0.2, 4, 8), robeMat, 0, -0.13, 0);
  addMesh(rightArm, new THREE.TorusGeometry(0.058, 0.016, 5, 10), goldDimMat, 0, -0.26, 0, Math.PI / 2, 0, 0);
  const rightFore = new THREE.Group();
  rightFore.position.set(0, -0.28, 0);
  rightArm.add(rightFore);
  addMesh(rightFore, new THREE.CapsuleGeometry(0.048, 0.18, 4, 8), robeDarkMat, 0, -0.11, 0);
  addMesh(rightFore, new THREE.SphereGeometry(0.052, 8, 6), gloveMat, 0, -0.24, 0.015);

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
    head,
    cloak,
    leftLeg,
    rightLeg,
    leftShin,
    rightShin,
    leftArm,
    rightArm,
    leftFore,
    rightFore,
    leftEye,
    rightEye,
    eyeGlowMat,
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
    this._idleT = Math.random() * 20;
    this._idleWait = 1.8 + Math.random() * 2.8;
    this._idleAct = null;
    this.wantsWalk = false;
    this.moving = false;
    this.casting = false;
    this.throwing = false;
    this._throwReleased = false;
    this._onThrowRelease = null;
    this.castT = 0;
    this.castDuration = 0;
    this._onCastComplete = null;
    this._castFace = new THREE.Vector3();

    this._right = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._move = new THREE.Vector3();
    this._stepDir = new THREE.Vector3();
    this._trial = new THREE.Vector3();
    this._prevDir = new THREE.Vector3();
    this._steerA = new THREE.Vector3();
    this._steerB = new THREE.Vector3();
    this._avoidSide = 0;
    this.blockers = opts.blockers ?? null;
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
    this.immortal = null;
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
    /** Prasknutí koule nesmrtelnosti (main.js). */
    this.onImmortalPop = null;

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
    const dark = new THREE.Color(this.color).multiplyScalar(0.38);
    const deeper = new THREE.Color(this.color).multiplyScalar(0.22);
    for (const m of this._bodyMats) {
      if (m.userData.robeRole === "main") m.color.setHex(this.color);
      else if (m.userData.robeRole === "dark") m.color.copy(dark);
      else if (m.userData.robeRole === "deeper") m.color.copy(deeper);
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

  get isImmortal() {
    return !!this.immortal;
  }

  get isBusy() {
    return this.casting || this.dead || !!this.knockdown || !!this.tornado;
  }

  beginTornadoCapture(centerDir, source = null) {
    if (this.tornado || this.dead || this.godMode || this.casting || this.knockdown || this.immortal) return false;
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
    if (this.tornado || this.dead || this.godMode || this.casting || this.knockdown || this.immortal) return false;
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
    if (this.godMode || this.dead || this.immortal || amount <= 0) return;
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
    if (this.remote || this.godMode || this.dead || this.immortal || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.#syncHealthUi();

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
    if (kd.phase === "fall" || kd.phase === "roll") {
      const onSide = kd.sideZ >= Math.PI * 0.4;
      if (onSide) return r * (0.4 + 0.6 * Math.abs(Math.sin(kd.barrelY)));
      return r * Math.sin(Math.min(kd.sideZ, Math.PI * 0.5));
    }
    const z = Math.min(Math.max(kd.sideZ, 0), Math.PI * 0.5);
    return r * Math.sin(z);
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
      riseDur: CONFIG.wizardKnockRiseDur,
      lieDur: CONFIG.wizardKnockLieDur
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
        kd.phase = "lie";
        kd.t = 0;
      }
      return;
    }

    if (kd.phase === "lie") {
      kd.sideZ = fallEnd;
      if (kd.t >= (kd.lieDur ?? CONFIG.wizardKnockLieDur)) {
        kd.phase = "rise";
        kd.t = 0;
        kd.riseFromY = kd.barrelY;
      }
      return;
    }

    if (kd.phase === "rise") {
      const u = Math.min(1, kd.t / kd.riseDur);
      const full = Math.PI * 2;
      const barrelTarget = Math.round(kd.minRot / full) * full;
      const unwind = Math.min(1, u / 0.22);
      const ue = unwind * unwind * (3 - 2 * unwind);
      kd.barrelY = (kd.riseFromY ?? kd.minRot) + (barrelTarget - (kd.riseFromY ?? kd.minRot)) * ue;
      kd.sideZ = this.#getUpSideZ(u);
      if (u >= 1) {
        kd.sideZ = 0;
        kd.barrelY = barrelTarget;
        this.knockdown = null;
      }
    }
  }

  #getUpSideZ(u) {
    const fall = Math.PI * 0.5;
    const x = Math.min(1, Math.max(0, u));
    if (x < 0.16) return fall * (1 - 0.06 * (x / 0.16));
    if (x < 0.46) {
      const t = (x - 0.16) / 0.3;
      const e = t * t * (3 - 2 * t);
      return fall * (0.94 - 0.4 * e);
    }
    if (x < 0.8) {
      const t = (x - 0.46) / 0.34;
      const e = 1 - (1 - t) ** 3;
      return fall * 0.54 * (1 - e) + 0.1 * (1 - e);
    }
    const t = (x - 0.8) / 0.2;
    const e = t * t * (3 - 2 * t);
    return 0.1 * (1 - e);
  }

  #getUpPitch(u) {
    const x = Math.min(1, Math.max(0, u));
    if (x < 0.2) return 0.08 + 0.12 * (x / 0.2);
    if (x < 0.5) {
      const t = (x - 0.2) / 0.3;
      return 0.2 + 0.22 * (t * t * (3 - 2 * t));
    }
    if (x < 0.82) {
      const t = (x - 0.5) / 0.32;
      const e = 1 - (1 - t) ** 2;
      return 0.42 * (1 - e) - 0.04 * e;
    }
    const t = (x - 0.82) / 0.18;
    return -0.04 * (1 - t * t * (3 - 2 * t));
  }

  #applyGetUpLimbs(parts, u) {
    const plant = Math.sin(Math.min(1, Math.max(0, u / 0.5)) * Math.PI);
    const crouch =
      u < 0.22
        ? (u / 0.22) * 0.5
        : u < 0.58
          ? 0.5 + ((u - 0.22) / 0.36) * 0.42
          : u < 0.9
            ? 0.92 * (1 - (u - 0.58) / 0.32)
            : 0;
    const headLift = 1 - Math.min(1, u / 0.7);

    parts.leftArm.rotation.set(-0.15 - 1.05 * plant, 0.08 * plant, 0.28 + 0.45 * plant);
    parts.rightArm.rotation.set(-0.25 - 1.2 * plant, -0.1 * plant, -0.35 - 0.4 * plant);
    if (parts.leftFore) parts.leftFore.rotation.set(-0.35 - 0.7 * plant, 0, 0);
    if (parts.rightFore) parts.rightFore.rotation.set(-0.45 - 0.85 * plant, 0, 0);

    parts.leftLeg.rotation.set(0.12 + 0.72 * crouch, 0, 0.06 * crouch);
    parts.rightLeg.rotation.set(0.08 + 0.58 * crouch, 0, -0.04 * crouch);
    if (parts.leftShin) parts.leftShin.rotation.set(0.2 + 0.7 * crouch, 0, 0);
    if (parts.rightShin) parts.rightShin.rotation.set(0.18 + 0.62 * crouch, 0, 0);

    if (parts.head) {
      parts.head.rotation.set(0.42 * headLift - 0.06 * plant, 0.1 * Math.sin(u * Math.PI), 0);
    }
    if (parts.cloak) parts.cloak.rotation.set(0.12 * crouch, 0, 0);
    if (parts.body) {
      parts.body.position.y = 0.04 * plant + 0.03 * Math.sin(Math.min(1, u) * Math.PI);
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
    this.#zeroExtraJoints(parts);

    if (kd.phase === "roll") {
      const tuck = 0.32 * Math.sin(kd.barrelY * 2);
      parts.leftLeg.rotation.x = tuck;
      parts.rightLeg.rotation.x = tuck;
      if (parts.leftShin) parts.leftShin.rotation.x = Math.abs(tuck) * 0.7;
      if (parts.rightShin) parts.rightShin.rotation.x = Math.abs(tuck) * 0.7;
    }

    if (kd.phase === "lie") {
      const stir = Math.sin(kd.t * 2.4) * 0.04;
      parts.body.rotation.x = 0.1 + stir;
      parts.leftLeg.rotation.set(0.28 + stir, 0, 0.05);
      parts.rightLeg.rotation.set(0.22, 0, -0.04);
      if (parts.leftShin) parts.leftShin.rotation.set(0.45, 0, 0);
      if (parts.rightShin) parts.rightShin.rotation.set(0.38, 0, 0);
      parts.leftArm.rotation.set(-0.35, 0, 0.45);
      parts.rightArm.rotation.set(0.25, 0, -0.7);
      if (parts.leftFore) parts.leftFore.rotation.set(-0.4, 0, 0);
      if (parts.rightFore) parts.rightFore.rotation.set(-0.15, 0, 0);
      if (parts.head) parts.head.rotation.set(0.45 + stir, 0.12, 0);
    }

    if (kd.phase === "rise") {
      const u = Math.min(1, kd.t / Math.max(0.001, kd.riseDur));
      parts.body.rotation.x = this.#getUpPitch(u);
      this.#applyGetUpLimbs(parts, u);
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
    this.#zeroExtraJoints(parts);

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
        if (parts.leftShin) parts.leftShin.rotation.x = Math.abs(tuck) * 0.7;
        if (parts.rightShin) parts.rightShin.rotation.x = Math.abs(tuck) * 0.7;
      }
    } else if (phase === "air") {
      parts.body.rotation.set(0, td.bodyRoll || 0, -side);
      const tuck = 0.28 * Math.sin((td.bodyRoll || 0) * 2);
      parts.leftLeg.rotation.x = tuck;
      parts.rightLeg.rotation.x = tuck;
      if (parts.leftShin) parts.leftShin.rotation.x = Math.abs(tuck) * 0.7;
      if (parts.rightShin) parts.rightShin.rotation.x = Math.abs(tuck) * 0.7;
    } else if (phase === "lie") {
      const stir = Math.sin((td.t || 0) * 2.4) * 0.04;
      parts.body.rotation.set(0.1 + stir, td.bodyRoll || 0, -side);
      parts.leftLeg.rotation.set(0.28 + stir, 0, 0.05);
      parts.rightLeg.rotation.set(0.22, 0, -0.04);
      if (parts.leftShin) parts.leftShin.rotation.set(0.45, 0, 0);
      if (parts.rightShin) parts.rightShin.rotation.set(0.38, 0, 0);
      parts.leftArm.rotation.set(-0.35, 0, 0.45);
      parts.rightArm.rotation.set(0.25, 0, -0.7);
      if (parts.leftFore) parts.leftFore.rotation.set(-0.4, 0, 0);
      if (parts.rightFore) parts.rightFore.rotation.set(-0.15, 0, 0);
      if (parts.head) parts.head.rotation.set(0.45 + stir, 0.12, 0);
    } else if (phase === "rise") {
      const u = Math.min(1, (td.t || 0) / (td.riseDur || CONFIG.wizardKnockRiseDur));
      parts.body.rotation.set(this.#getUpPitch(u), td.bodyRoll || 0, -side);
      this.#applyGetUpLimbs(parts, u);
    }

    if (parts.castFx) parts.castFx.visible = false;
  }

  #applyImmortalPose(parts, dt = 0) {
    const inv = this.immortal;
    if (!inv || !parts) return;
    this.#pulseEyes(parts, dt);
    const a = inv.spinZ;
    const cy = inv.sphere?.position.y ?? inv.radius;
    parts.body.rotation.order = "XYZ";
    parts.body.rotation.set(a, 0, 0);
    parts.body.position.set(0, cy * (1 - Math.cos(a)), -cy * Math.sin(a));
    parts.leftArm.rotation.set(0.08, 0, 0.1);
    parts.rightArm.rotation.set(0.08, 0, -0.1);
    parts.leftLeg.rotation.set(0, 0, 0);
    parts.rightLeg.rotation.set(0, 0, 0);
    this.#zeroExtraJoints(parts);
    if (parts.leftShin) parts.leftShin.rotation.set(0.04, 0, 0);
    if (parts.rightShin) parts.rightShin.rotation.set(0.04, 0, 0);
    if (parts.head) parts.head.rotation.set(0, 0, 0);
    if (parts.cloak) parts.cloak.rotation.set(0, 0, 0);
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
    this.endImmortality();
    this.#clearTarget();
    this.casting = false;
    this.throwing = false;
    this._onThrowRelease = null;
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
    if (this.#height(dir) <= CONFIG.wizardMinTerrainR) return false;
    if (this.godMode) return true;
    return this.blockers?.clear(dir, WIZARD_BODY_R) ?? true;
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
    if (this.dead || this.godMode || this.immortal || !this.#isHeadSubmerged()) return;
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

  /** Plynulý posun po povrchu směrem k cíli — když je strom/zvíře v cestě, obejde ho. */
  #stepTowardTarget(maxDist) {
    const remain = this.#remainToTarget();
    if (remain < 1e-8) return true;

    if (this.#tryStepToward(this.targetDir, maxDist)) {
      this._avoidSide = 0;
      return remain <= maxDist + 1e-6;
    }

    const hit = this.blockers?.hitNear(this.dir, WIZARD_BODY_R, 3.6, this.targetDir);
    if (hit) {
      this.#avoidWaypoints(hit, this._steerA, this._steerB);
      let side = this._avoidSide;
      if (!side) {
        side = surfaceDist(this._steerA, this.targetDir) <= surfaceDist(this._steerB, this.targetDir) ? 1 : -1;
      }
      let goal = side > 0 ? this._steerA : this._steerB;
      if (this.#tryStepToward(goal, maxDist)) {
        this._avoidSide = side;
        this.#faceAlongStep();
        return false;
      }
      side = -side;
      goal = side > 0 ? this._steerA : this._steerB;
      if (this.#tryStepToward(goal, maxDist)) {
        this._avoidSide = side;
        this.#faceAlongStep();
        return false;
      }
    }

    const probes = this._avoidSide >= 0
      ? [0.45, -0.45, 0.85, -0.85, 1.25, -1.25, 1.7, -1.7]
      : [-0.45, 0.45, -0.85, 0.85, -1.25, 1.25, -1.7, 1.7];
    for (const a of probes) {
      this._steerA.copy(this.targetDir).applyAxisAngle(this.dir, a);
      if (this.#tryStepToward(this._steerA, maxDist)) {
        this._avoidSide = a >= 0 ? 1 : -1;
        this.#faceAlongStep();
        return false;
      }
    }
    return false;
  }

  /** Otočí `dir` k `goal` o `maxDist`. Při blokaci vrátí krok zpět. */
  #tryStepToward(goal, maxDist) {
    const dot = Math.min(1, Math.max(-1, this.dir.dot(goal)));
    const omega = Math.acos(dot);
    if (omega < 1e-8) return this.#isWalkable(this.dir);
    const angle = Math.min(omega, maxDist / CONFIG.planetR);
    if (angle < 1e-10) return false;
    this._prevDir.copy(this.dir);
    this._stepDir.crossVectors(this.dir, goal);
    if (this._stepDir.lengthSq() < 1e-12) this.dir.copy(goal);
    else this.dir.applyAxisAngle(this._stepDir.normalize(), angle).normalize();
    if (!this.#isWalkable(this.dir)) {
      this.dir.copy(this._prevDir);
      return false;
    }
    this.mesh.position.copy(this.dir).multiplyScalar(this.#height(this.dir));
    return true;
  }

  #faceAlongStep() {
    this._move.copy(this.dir).addScaledVector(this._prevDir, -this.dir.dot(this._prevDir));
    if (this._move.lengthSq() > 1e-10) this._move.normalize();
  }

  /** Dva body vedle překážky (vlevo / vpravo), kam jít místo skrz ni. */
  #avoidWaypoints(hit, leftOut, rightOut) {
    tangentFrame(hit.dir, tmp.east, tmp.north);
    const wx = this.dir.dot(tmp.east);
    const wz = this.dir.dot(tmp.north);
    const ang = Math.atan2(wz, wx);
    const rad = hit.r + 0.45;
    surfaceOffsetDir(hit.dir, tmp.east, tmp.north, ang + Math.PI * 0.5, rad, leftOut);
    surfaceOffsetDir(hit.dir, tmp.east, tmp.north, ang - Math.PI * 0.5, rad, rightOut);
  }

  #clearTarget() {
    this.hasTarget = false;
    this.footprints?.hide();
  }

  clearDestination() {
    this.#clearTarget();
  }

  setDestination(localPoint, opts = {}) {
    this._trial.copy(localPoint).normalize();
    if (this.immortal && !this.remote) {
      const inv = this.immortal;
      this._move.copy(this._trial).addScaledVector(this.dir, -this.dir.dot(this._trial));
      if (this._move.lengthSq() < 1e-10) return false;
      if (!inv.rollDir) inv.rollDir = new THREE.Vector3();
      inv.rollDir.copy(this._move).normalize();
      inv.rolling = true;
      this.#clearTarget();
      this.footprints?.hide();
      return true;
    }
    if (this.isBusy) return false;
    if (!opts.allowUnwalkable && !this.#isWalkable(this._trial)) return false;
    this.targetDir.copy(this._trial);
    this.hasTarget = true;
    this._avoidSide = 0;
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

  #tickThrowRelease() {
    if (!this.throwing || this._throwReleased || !this._onThrowRelease) return;
    if (this.castT >= this.castDuration * 0.42) {
      this._throwReleased = true;
      const fn = this._onThrowRelease;
      this._onThrowRelease = null;
      fn();
    }
  }

  #endCast() {
    const wasCasting = this.casting;
    this.casting = false;
    this.throwing = false;
    this._onThrowRelease = null;
    this._throwReleased = false;
    if (wasCasting && !this.remote) this.onCastAudioStop?.();
    const cb = this._onCastComplete;
    this._onCastComplete = null;
    const parts = this.mesh.userData.parts;
    if (parts) {
      if (parts.castFx) parts.castFx.visible = false;
      parts.rightArm.rotation.set(0, 0, 0);
      parts.leftArm.rotation.set(0, 0, 0);
      this.#zeroExtraJoints(parts);
    }
    if (cb) cb();
  }

  beginImmortality(opts = {}) {
    if (this.dead) return;
    this.breakInvisibility();
    this.#clearTarget();
    this.wantsWalk = false;
    this.moving = false;
    const radius = Math.max(0.4, opts.radius ?? 1.18);
    if (!this.immortal) {
      this.immortal = {
        t: 0,
        hold: opts.hold ?? 5,
        speed: opts.speed ?? CONFIG.wizardSpeed * 2,
        travel: opts.travel ?? 100,
        radius,
        spinZ: 0,
        traveled: 0,
        rolling: false,
        rollDir: new THREE.Vector3(),
        sphere: attachImmortalBubble(this, radius)
      };
    }
    const inv = this.immortal;
    if (opts.hold != null) inv.hold = opts.hold;
    if (opts.speed != null) inv.speed = opts.speed;
    if (opts.travel != null) inv.travel = opts.travel;
    if (opts.t != null) inv.t = opts.t;
    if (opts.spinZ != null) inv.spinZ = opts.spinZ;
    if (opts.rolling != null) inv.rolling = !!opts.rolling;
    if (!inv.sphere) inv.sphere = attachImmortalBubble(this, inv.radius);
  }

  endImmortality() {
    const inv = this.immortal;
    if (!inv) return;
    this.onImmortalPop?.(this);
    detachImmortalBubble(this, inv.sphere);
    this.immortal = null;
    this.moving = false;
    const parts = this.mesh.userData.parts;
    if (parts?.body) {
      parts.body.rotation.set(0, 0, 0);
      parts.body.position.set(0, 0, 0);
    }
    this.mesh.position.copy(this.dir).multiplyScalar(this.#height(this.dir));
  }

  #updateImmortality(dt) {
    const inv = this.immortal;
    if (!inv) return;
    if (inv.sphere) {
      const pulse = 1 + 0.04 * Math.sin(inv.t * 7.2);
      inv.sphere.scale.setScalar(pulse);
      inv.sphere.rotation.x = inv.rolling ? inv.spinZ : 0;
    }
    if (this.remote) {
      inv.t += dt;
      return;
    }

    inv.t += dt;
    if (inv.t >= inv.hold) {
      this.endImmortality();
      return;
    }

    if (!inv.rolling || !inv.rollDir) return;

    this._move.copy(inv.rollDir).addScaledVector(this.dir, -this.dir.dot(inv.rollDir));
    if (this._move.lengthSq() < 1e-10) return;
    this._move.normalize();
    inv.rollDir.copy(this._move);

    const remainDist = Math.max(0, inv.travel - inv.traveled);
    const remainTime = Math.max(0, inv.hold - inv.t);
    let step = inv.speed * dt;
    step = Math.min(step, remainDist, remainTime * inv.speed);
    if (step < 1e-6) {
      this.endImmortality();
      return;
    }

    this._stepDir.crossVectors(this.dir, this._move);
    if (this._stepDir.lengthSq() < 1e-12) return;
    this._stepDir.normalize();
    this._prevDir.copy(this.dir);
    this.dir.applyAxisAngle(this._stepDir, step / CONFIG.planetR).normalize();
    if (!this.#isWalkable(this.dir)) {
      this.dir.copy(this._prevDir);
      inv.rolling = false;
      return;
    }
    this.facing.copy(this._move);
    inv.traveled += step;
    const ang = step / Math.max(0.2, inv.radius);
    inv.spinZ += ang;
    this.moving = true;

    if (inv.traveled >= inv.travel - 1e-4) this.endImmortality();
  }

  /** Začni vizuální show kouzlení směrem k cíli. onComplete po skončení. */
  startCast(targetDir, duration = CONFIG.spellDuration, onComplete = null, opts = {}) {
    if (this.isBusy || this.immortal) return false;
    // Kouzlení v neviditelnosti = okamžité zviditelnění
    this.breakInvisibility();
    this.#clearTarget();
    this.wantsWalk = false;
    this.casting = true;
    this.throwing = !!opts.throwing;
    this._throwReleased = false;
    this._onThrowRelease = opts.onRelease || null;
    this.castT = 0;
    this.castDuration = duration;
    this._onCastComplete = onComplete;
    this._castFace.copy(targetDir).normalize();
    this._castFace.addScaledVector(this.dir, -this._castFace.dot(this.dir));
    if (this._castFace.lengthSq() > 1e-8) {
      this.facing.copy(this._castFace).normalize();
    }
    const parts = this.mesh.userData.parts;
    if (parts?.castFx) parts.castFx.visible = !this.throwing;
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
    const bubble = this.immortal?.sphere;
    this.mesh.traverse((ch) => {
      if (!ch.isMesh || ch === this._softShadow) return;
      if (bubble && ch.parent === bubble) return;
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
        this.#tickThrowRelease();
        if (this.castT >= this.castDuration) this.#endCast();
      }
      this.#updateNetPose();
      if (this.knockdown) this.#updateKnockdown(dt);
      if (this.immortal) this.#updateImmortality(dt);
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

    if (this.immortal) this.#updateImmortality(dt);
    if (this.immortal) {
      this.mesh.position.copy(this.dir).multiplyScalar(this.#height(this.dir));
      this.#applyPose();
      this.#updateWalkBlend(dt);
      this.#updateGodGlow(dt);
      this.#animate(dt);
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
            if (this._move.lengthSq() > 1e-10) this.facing.copy(this._move);
            if (arrived || this.#remainToTarget() <= CONFIG.wizardArrive) {
              this.#clearTarget();
              this._avoidSide = 0;
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
      this.#tickThrowRelease();
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
      this.casting || this.dead || this.knockdown || this.tornado || this.immortal ? 0 : this.wantsWalk ? 1 : 0;
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

  #zeroExtraJoints(parts) {
    if (!parts) return;
    if (parts.head) parts.head.rotation.set(0, 0, 0);
    if (parts.cloak) parts.cloak.rotation.set(0, 0, 0);
    if (parts.leftFore) parts.leftFore.rotation.set(0, 0, 0);
    if (parts.rightFore) parts.rightFore.rotation.set(0, 0, 0);
    if (parts.leftShin) parts.leftShin.rotation.set(0, 0, 0);
    if (parts.rightShin) parts.rightShin.rotation.set(0, 0, 0);
  }

  #pulseEyes(parts, dt) {
    this._idleT += dt;
    if (this.godMode || !parts.eyeGlowMat) return;
    const t = 0.5 + 0.5 * Math.sin(this._idleT * 2.35);
    parts.eyeGlowMat.color.setRGB(1, 0.72 + 0.16 * t, 0.22 + 0.18 * t);
  }

  #idlePose(dt, walking) {
    const pose = {
      headX: Math.sin(this._idleT * 1.15) * 0.03,
      headY: 0,
      bodyX: Math.sin(this._idleT * 1.65) * 0.018,
      bodyZ: 0,
      cloakX: Math.sin(this._idleT * 0.85) * 0.04,
      armLX: 0.06,
      armLZ: 0.08,
      armRX: 0.06,
      armRZ: -0.08,
      foreL: 0.12,
      foreR: 0.12,
      armLY: 0,
      armRY: 0
    };

    if (walking) {
      this._idleAct = null;
      this._idleWait = 1.6 + Math.random() * 2.4;
      return pose;
    }

    this._idleWait -= dt;
    if (this._idleWait <= 0 && !this._idleAct) {
      const kinds = ["glance", "look", "hood", "shift", "clasp", "nod"];
      this._idleAct = {
        kind: kinds[(Math.random() * kinds.length) | 0],
        t: 0,
        dur: 1.35 + Math.random() * 1.5,
        sign: Math.random() < 0.5 ? -1 : 1
      };
    }

    if (!this._idleAct) return pose;

    this._idleAct.t += dt;
    const u = Math.min(1, this._idleAct.t / this._idleAct.dur);
    const env = Math.sin(u * Math.PI);
    const s = this._idleAct.sign;
    switch (this._idleAct.kind) {
      case "glance":
        pose.headY = s * 0.55 * env;
        pose.headX = -0.08 * env;
        break;
      case "look":
        pose.headY = s * 0.7 * Math.sin(u * Math.PI * 2);
        pose.headX = 0.12 * Math.sin(u * Math.PI);
        break;
      case "hood":
        pose.armRX = -1.35 * env;
        pose.armRZ = -0.35 * env;
        pose.foreR = -0.85 * env;
        pose.headX = 0.18 * env;
        pose.headY = s * 0.12 * env;
        break;
      case "shift":
        pose.bodyZ = s * 0.04 * env;
        pose.armLZ = 0.08 + s * 0.08 * env;
        pose.armRZ = -0.08 - s * 0.08 * env;
        break;
      case "clasp":
        pose.armLX = -0.45 * env;
        pose.armRX = -0.5 * env;
        pose.armLZ = 0.42 * env;
        pose.armRZ = -0.42 * env;
        pose.foreL = -0.55 * env;
        pose.foreR = -0.6 * env;
        pose.headX = 0.12 * env;
        break;
      case "nod":
        pose.headX = 0.28 * Math.sin(u * Math.PI * 2);
        break;
    }

    if (this._idleAct.t >= this._idleAct.dur) {
      this._idleAct = null;
      this._idleWait = 2.4 + Math.random() * 5;
    }
    return pose;
  }

  #animateCast(dt, parts) {
    const t = this.castT;
    const dur = Math.max(0.001, this.castDuration);
    const u = Math.min(1, t / dur);
    const raise = u < 0.14 ? u / 0.14 : u > 0.86 ? (1 - u) / 0.14 : 1;
    const weave = Math.sin(t * 6.4);
    const weave2 = Math.cos(t * 5.1);
    const pulse = 0.5 + 0.5 * Math.sin(t * 9);

    parts.body.rotation.set(-0.1 * raise, weave * 0.04 * raise, 0);
    parts.body.position.y = 0.02 * raise;
    if (parts.head) {
      parts.head.rotation.set(-0.28 * raise + weave2 * 0.05, weave * 0.1, 0);
    }
    if (parts.cloak) parts.cloak.rotation.set(0.18 * raise, 0, weave * 0.05);

    parts.leftArm.rotation.set(
      -0.4 - 1.05 * raise,
      weave * 0.12 * raise,
      0.28 + 0.42 * raise + weave2 * 0.1
    );
    parts.rightArm.rotation.set(
      -0.48 - 1.12 * raise,
      -weave * 0.12 * raise,
      -0.32 - 0.48 * raise - weave * 0.1
    );
    if (parts.leftFore) parts.leftFore.rotation.set(-0.35 - 0.45 * weave * raise, 0, 0);
    if (parts.rightFore) parts.rightFore.rotation.set(-0.4 - 0.4 * weave2 * raise, 0, 0);
    parts.leftLeg.rotation.set(0.04, 0, 0);
    parts.rightLeg.rotation.set(-0.04, 0, 0);
    if (parts.leftShin) parts.leftShin.rotation.set(0.08, 0, 0);
    if (parts.rightShin) parts.rightShin.rotation.set(0.08, 0, 0);

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
  }

  #animateThrow(parts) {
    const u = Math.min(1, this.castT / Math.max(0.001, this.castDuration));
    let swing = 0;
    if (u < 0.38) swing = u / 0.38;
    else if (u < 0.62) swing = 1 - (u - 0.38) / 0.24;
    else swing = Math.max(0, 0.18 * (1 - (u - 0.62) / 0.38));
    const follow = u > 0.4 ? Math.min(1, (u - 0.4) / 0.28) : 0;
    parts.body.rotation.set(-0.1 * swing, 0.16 * swing, 0);
    if (parts.head) parts.head.rotation.set(-0.12 * swing, 0.08 * swing, 0);
    parts.rightArm.rotation.set(
      -0.15 - 1.55 * swing + 0.85 * follow,
      0.12 * swing,
      -0.35 - 0.55 * swing
    );
    parts.leftArm.rotation.set(-0.22 - 0.18 * swing, 0, 0.22 + 0.12 * swing);
    if (parts.rightFore) parts.rightFore.rotation.set(-0.15 - 0.45 * swing, 0, 0);
    if (parts.leftFore) parts.leftFore.rotation.set(-0.12, 0, 0);
    parts.leftLeg.rotation.set(0.05, 0, 0);
    parts.rightLeg.rotation.set(-0.06, 0, 0);
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

    if (this.immortal?.rolling) {
      this.#applyImmortalPose(parts, dt);
      return;
    }

    this.#pulseEyes(parts, dt);

    if (this.casting) {
      if (this.throwing) this.#animateThrow(parts);
      else this.#animateCast(dt, parts);
      return;
    }

    const b = this.walkBlend;
    const idle = this.#idlePose(dt, b > 0.06);

    parts.leftArm.rotation.set(idle.armLX, idle.armLY, idle.armLZ);
    parts.rightArm.rotation.set(idle.armRX, idle.armRY, idle.armRZ);
    parts.leftLeg.rotation.set(0, 0, 0);
    parts.rightLeg.rotation.set(0, 0, 0);
    if (parts.leftFore) parts.leftFore.rotation.set(idle.foreL, 0, 0);
    if (parts.rightFore) parts.rightFore.rotation.set(idle.foreR, 0, 0);
    if (parts.leftShin) parts.leftShin.rotation.set(0.06, 0, 0);
    if (parts.rightShin) parts.rightShin.rotation.set(0.06, 0, 0);
    if (parts.head) parts.head.rotation.set(idle.headX, idle.headY, 0);
    if (parts.cloak) parts.cloak.rotation.set(idle.cloakX, 0, 0);
    if (parts.body) {
      parts.body.rotation.set(idle.bodyX, 0, idle.bodyZ);
      parts.body.position.y = 0;
    }

    if (b < 0.001) return;

    this.walkPhase += dt * (5.2 + 3.6 * this._speedMul) * (0.35 + 0.65 * b);
    const amp = (0.42 + 0.22 * this._speedMul) * b;
    const s = Math.sin(this.walkPhase) * amp;
    const kneeL = Math.max(0, -s) * 1.05 + 0.08 * b;
    const kneeR = Math.max(0, s) * 1.05 + 0.08 * b;

    parts.leftLeg.rotation.x = s;
    parts.rightLeg.rotation.x = -s;
    parts.leftLeg.rotation.z = 0;
    parts.rightLeg.rotation.z = 0;
    if (parts.leftShin) parts.leftShin.rotation.x = kneeL;
    if (parts.rightShin) parts.rightShin.rotation.x = kneeR;

    parts.leftArm.rotation.x = idle.armLX - s * 0.58;
    parts.rightArm.rotation.x = idle.armRX + s * 0.52;
    parts.leftArm.rotation.z = idle.armLZ + s * 0.06;
    parts.rightArm.rotation.z = idle.armRZ - s * 0.05;
    if (parts.leftFore) parts.leftFore.rotation.x = idle.foreL + Math.max(0, s) * 0.35;
    if (parts.rightFore) parts.rightFore.rotation.x = idle.foreR + Math.max(0, -s) * 0.35;

    if (parts.head) {
      parts.head.rotation.x = idle.headX + b * 0.04;
      parts.head.rotation.y = idle.headY - s * 0.04;
    }
    if (parts.cloak) {
      parts.cloak.rotation.x = idle.cloakX + 0.08 * b;
      parts.cloak.rotation.z = -s * 0.025;
    }
    if (parts.body) {
      parts.body.rotation.x = idle.bodyX + 0.045 * b;
      parts.body.rotation.y = s * 0.012;
      parts.body.rotation.z = idle.bodyZ * (1 - b);
      parts.body.position.y = Math.abs(Math.sin(this.walkPhase * 2)) * 0.022 * b;
    }

    this.#maybeFootstep();
  }
}
