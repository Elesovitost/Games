import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame, surfaceOffsetDir, slerpDirection } from "./utils.js";
import { surfaceDist } from "./spells/fx-common.js";
import { spawnWaterWake } from "./spells/water-fx.js";
import { BURN_DURATION, CHAR_COLOR, attachFireQueued, tintMeshBlack, setBurnGlow } from "./burn.js";
import { attackerBodyRadius } from "./blockers.js";
import {
  mulberry32,
  aboveCore,
  isLand as isLandAI,
  isWaterAt,
  terrainGrade,
  stepToward as stepTowardAI,
  turnFacingToward,
  pickWanderTarget,
  bearingOf,
  scatterOnLand,
  aoeFalloff,
  claimHit
} from "./animalsAI.js";
import { applyEntityNet } from "./net/world-sync.js";
import { spawnSoul, updateSoul, disposeSoul, SOUL_DELAY } from "./soul.js";

/** Kolik jich je po planetě. */
const COUNT = 40;
const MAX_HP = 20;
/** Útok: 1,5× rychlost kouzelníka (`CONFIG.wizardSpeed`). */
const HUNT_SPEED = CONFIG.wizardSpeed * 1.5;
/** Pomalé bloumání v idle. */
const WALK_SPEED = 0.85;
const SWIM_SPEED = 3;
/** Vidí kouzelníka na tato metry a hned se za ním vydá. */
const VISION = 30;
/** Dosah klovnutí předními pařáty (m). */
const PECK_RANGE = 1.5;
/** Odstup od kouzelníka, aby se nepřekrývali (m). */
const STANDOFF = 1.2;
const PECK_INTERVAL = 1;
const PECK_DAMAGE = 10;
/** V idle bloumá jen v tomto okruhu kolem svého spawnu (m). */
const HOME_RADIUS = 12;
/** Jednou za 5 minut se nejbližší attacker každého kouzelníka vydá zabít. */
const ORDER_PERIOD = 300;
const LAND_MARGIN = 0.35;
const GRADE_MAX = 1.15;
const MIN_R = CONFIG.wizardMinTerrainR + 0.05;
/** Plave k nejbližšímu břehu — jak daleko se hledá (m) a jak často přepočítá. */
const SHORE_PROBE_STEP = 12;
const SHORE_PROBES = 12;
const SHORE_RETARGET = 2.5;
/** Rozestup při spawnu (m) — 40 kusů difuzně po planetě. */
const SPAWN_SEP = 9;
/** Nesmí vzniknout blíž než tolik metrů od spawn pointu. */
const SPAWN_CLEAR = 50;
/** Délka těla po normalizaci (m). */
const BODY_LEN = 1.7;
/** Smyčka běhu se spouští jen v doslechu — ať 40 kusů nedrží 40 bufferů. */
const RUN_SFX_DIST = 50;
/** Jak dlouho po posledním zásahu hlídače ještě utíká (s). */
const ZAP_HOLD = 0.55;
/** Rozměry kráčejících nohou (lokální jednotky těla před normalizací). */
const LEG_HIP_X = 0.12;
const LEG_HIP_Y = 0.44;
const LEG_FEMUR = 0.3;
const LEG_TIBIA = 0.42;
const LEG_TARSUS = 0.26;
/** Klidové úhly segmentů — stehno vzhůru ven, holeň dolů ven, chodidlo kolmo k zemi. */
const LEG_FEMUR_A = 0.85;
const LEG_KNEE_A = 1.85;
const LEG_ANKLE_A = 0.44;

const _localX = new THREE.Vector3(1, 0, 0);

function mat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.78,
    metalness: opts.metalness ?? 0.05
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
 * Kudlanka se třemi očima: protáhlý zadeček zvednutý dozadu, hruď s krovkami,
 * trojúhelník očí (dvě velké + jedno temenní), tykadla a přední loupeživé paže
 * složené „k modlitbě“. Čtyři kráčející nohy (střední + zadní pár).
 */
export function createAttackerMesh(mats, geos) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const S = geos.sphere;
  const C = geos.cyl;
  const N = geos.cone;

  // ---- zadeček ----
  const abdomen = new THREE.Group();
  abdomen.position.set(0, 0.46, -0.1);
  abdomen.rotation.x = 0.36;
  abdomen.add(sph(S, mats.hide, 0.17, 0.16, 0.42, 0, 0, -0.32));
  for (let i = 0; i < 4; i++) {
    abdomen.add(
      sph(S, mats.dark, 0.172 - i * 0.014, 0.162 - i * 0.014, 0.045, 0, 0, -0.06 - i * 0.16)
    );
  }
  body.add(abdomen);

  // ---- hruď + krovky ----
  body.add(sph(S, mats.hide, 0.15, 0.14, 0.3, 0, 0.46, 0.12));
  body.add(sph(S, mats.belly, 0.13, 0.1, 0.26, 0, 0.36, 0.12));
  for (const s of [-1, 1]) {
    const wing = sph(S, mats.arm, 0.07, 0.035, 0.32, s * 0.1, 0.575, -0.02);
    wing.rotation.set(0.12, 0, -s * 0.12);
    body.add(wing);
  }
  body.add(sph(S, mats.arm, 0.16, 0.05, 0.19, 0, 0.585, 0.22));

  // ---- hlava se třemi očima ----
  const head = new THREE.Group();
  head.position.set(0, 0.56, 0.4);
  head.add(sph(S, mats.hide, 0.15, 0.12, 0.13, 0, 0, 0));
  head.add(sph(S, mats.belly, 0.1, 0.055, 0.1, 0, -0.06, 0.05));
  head.add(sph(S, mats.eye, 0.055, 0.07, 0.06, -0.1, 0.03, 0.05));
  head.add(sph(S, mats.eye, 0.055, 0.07, 0.06, 0.1, 0.03, 0.05));
  head.add(sph(S, mats.eyeGlow, 0.035, 0.035, 0.035, 0, 0.115, 0.06));
  for (const s of [-1, 1]) {
    head.add(sph(S, mats.dark, 0.022, 0.02, 0.05, s * 0.045, -0.1, 0.1));
  }
  const antennae = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group();
    a.position.set(s * 0.06, 0.09, 0.1);
    a.rotation.set(-0.55, 0, -s * 0.45);
    a.add(cyl(C, mats.dark, 0.012, 0.4, 0, 0.2, 0));
    const tip = new THREE.Group();
    tip.position.set(0, 0.4, 0);
    tip.add(cyl(C, mats.dark, 0.008, 0.26, 0, 0.13, 0));
    a.add(tip);
    head.add(a);
    antennae.push({ root: a, tip });
  }
  body.add(head);

  // ---- přední loupeživé paže ----
  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.14, 0.5, 0.28);
    shoulder.add(cyl(C, mats.arm, 0.045, 0.34, 0, 0.17, 0));
    const elbow = new THREE.Group();
    elbow.position.set(0, 0.34, 0);
    elbow.add(cyl(C, mats.arm, 0.038, 0.32, 0, 0.16, 0));
    for (let i = 0; i < 4; i++) {
      elbow.add(sph(S, mats.dark, 0.012, 0.05, 0.012, 0, 0.08 + i * 0.07, -0.04));
    }
    const claw = new THREE.Mesh(N, mats.dark);
    claw.scale.set(0.03, 0.09, 0.03);
    claw.position.set(0, 0.35, 0);
    claw.castShadow = true;
    elbow.add(claw);
    shoulder.add(elbow);
    body.add(shoulder);
    arms.push({ shoulder, elbow, side: s });
  }

  /** Rozměry těla bez nohou — podle nich se škáluje a počítá „položení na bok“. */
  const torso = new THREE.Box3().setFromObject(body);

  // ---- čtyři kráčející nohy (střední + zadní pár): stehno → holeň → chodidlo ----
  const legs = [];
  for (const s of [-1, 1]) {
    const zs = [0.06, -0.26];
    for (let k = 0; k < zs.length; k++) {
      const hip = new THREE.Group();
      hip.position.set(s * LEG_HIP_X, LEG_HIP_Y, zs[k]);
      hip.add(sph(S, mats.hide, 0.062, 0.055, 0.062, 0, 0, 0));
      hip.add(cyl(C, mats.hide, 0.044, LEG_FEMUR, 0, LEG_FEMUR * 0.5, 0));

      const knee = new THREE.Group();
      knee.position.set(0, LEG_FEMUR, 0);
      knee.add(sph(S, mats.dark, 0.05, 0.05, 0.05, 0, 0, 0));
      knee.add(cyl(C, mats.dark, 0.033, LEG_TIBIA, 0, LEG_TIBIA * 0.5, 0));

      const ankle = new THREE.Group();
      ankle.position.set(0, LEG_TIBIA, 0);
      ankle.add(cyl(C, mats.dark, 0.023, LEG_TARSUS, 0, LEG_TARSUS * 0.5, 0));
      ankle.add(sph(S, mats.dark, 0.042, 0.032, 0.055, 0, LEG_TARSUS, 0.022));

      knee.add(ankle);
      hip.add(knee);
      body.add(hip);
      legs.push({ hip, knee, ankle, side: s, k });
    }
  }

  /**
   * Než se změří výška, složí se nohy do klidové pózy (stejné úhly, jaké nastavuje
   * `#animate` v klidu). V bind póze totiž trčí kolmo vzhůru, takže by nejnižším
   * bodem bylo břicho — kudlanka by pak stála zanořená po břicho.
   */
  for (const leg of legs) {
    leg.hip.rotation.z = -leg.side * LEG_FEMUR_A;
    leg.knee.rotation.z = -leg.side * LEG_KNEE_A;
    leg.ankle.rotation.z = -leg.side * LEG_ANKLE_A;
  }
  /** Rozměry celého těla v klidové póze — chodidla určují rovinu, na které kudlanka stojí. */
  const b0 = new THREE.Box3().setFromObject(body);
  const s = BODY_LEN / Math.max(0.3, torso.max.z - torso.min.z);
  /** Chodidla na terénu (+ drobná marže, ať se špička nezaryje do svahu). */
  body.position.y += -b0.min.y + 0.015;
  root.scale.setScalar(s);
  root.userData.height = (b0.max.y - b0.min.y) * s;
  root.userData.lieLift = Math.max(0.16, -torso.min.x);
  root.add(body);

  root.frustumCulled = false;
  root.userData.parts = { body, abdomen, head, antennae, arms, legs };
  root.userData.bodyBaseY = body.position.y;
  return root;
}

function isLand(terrain, dir) {
  return isLandAI(terrain, dir, LAND_MARGIN, MIN_R);
}

function isWalkable(terrain, dir, east, north) {
  if (!isLand(terrain, dir)) return false;
  return terrainGrade(terrain, dir, east, north) < GRADE_MAX;
}

/** Je `dir` aspoň `minM` metrů od každého spawn pointu? */
function clearOfSpawns(dir, spawnDirs, minM) {
  if (!(minM > 0) || !spawnDirs?.length) return true;
  for (const s of spawnDirs) {
    const dx = s.x ?? s[0];
    const dy = s.y ?? s[1];
    const dz = s.z ?? s[2];
    const dot = Math.min(1, Math.max(-1, dir.x * dx + dir.y * dy + dir.z * dz));
    if (Math.acos(dot) * CONFIG.planetR < minM) return false;
  }
  return true;
}

class Attacker {
  constructor(herd, id, dir, rng) {
    this.herd = herd;
    this.id = id;
    /** Značka pro hlídače (SPELLS.watcher) — smaží kudlanky jinou silou než wizardy. */
    this.isAttacker = true;
    this.terrain = herd.terrain;
    this.mesh = createAttackerMesh(herd.mats, herd.geos);
    const size = 0.9 + rng() * 0.3;
    this.mesh.scale.multiplyScalar(size);
    this.size = size;
    this.blockR = attackerBodyRadius({ size });
    this.bodyHalfHeight = 0.5 * (this.mesh.userData.height ?? 0.6) * size;
    this.bodyBaseY = this.mesh.userData.bodyBaseY ?? 0;
    this.lieLift = this.mesh.userData.lieLift ?? 0.3;
    herd.planetGroup.add(this.mesh);
    this.parts = this.mesh.userData.parts;

    this.dir = dir.clone().normalize();
    this.home = this.dir.clone();
    this.facing = new THREE.Vector3();
    this.targetDir = new THREE.Vector3();
    this._moveDir = new THREE.Vector3();
    this._away = new THREE.Vector3();
    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._move = new THREE.Vector3();
    this._step = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._basisX = new THREE.Vector3();
    this._mat = new THREE.Matrix4();
    this._pitchQ = new THREE.Quaternion();
    this._trial = new THREE.Vector3();
    this._trial2 = new THREE.Vector3();
    this._knockAway = new THREE.Vector3();
    this._knockAxis = new THREE.Vector3();

    tangentFrame(this.dir, this._east, this._north);
    this.facing.copy(this._north);
    this.phase = rng() * 100;
    this.walkPhase = rng() * Math.PI * 2;
    this.rng = rng;
    this.state = "wander";
    this.stateT = 0.5 + rng() * 1.5;
    this._speed = 0;
    this.peckT = rng() * PECK_INTERVAL;
    this.striking = false;
    this.strikeT = 0;
    this.avoidT = 0;
    this.avoidSign = 1;
    this.shoreT = 0;
    this.wakeT = 0;
    this.charm = null;
    this.target = null;
    /** Rozkaz „jdi ho zabít“ z pětiminutového cyklu. */
    this.order = null;
    this.demonHold = false;

    this.remote = false;
    this.netMoving = false;
    /** Tornádo: chycení a let (viz spells/tornado.js). */
    this.tornado = null;
    this.netTornado = false;
    this.netRadius = 0;
    this._tornadoMoveMul = 1;
    this._tornadoPullSpeed = 0;
    this._tornadoPullDir = null;
    this._tornadoSource = null;
    this.gone = false;
    this.vanished = false;
    this.dead = false;
    this.dieT = 0;
    this._soul = null;
    this.soulDelay = null;
    this.slideLeft = 0;
    this.slideSpeed = 0;
    this.knockFrom = null;

    this.burning = false;
    this.charred = false;
    this.burnT = 0;
    this._fire = null;
    this._burnMats = [];

    /** Zvuky: smyčka běhu + hrana „právě začal útočit“. */
    this.sfxRun = null;
    this._wasHunting = false;

    /**
     * Hlídač ho smaží — dokud `zapT` běží, peláší od zdroje (viz #stateFlee).
     * `zapT` se odečítá v update.
     */
    this.zapT = 0;
    this.zapSrc = new THREE.Vector3();

    this.maxHp = MAX_HP;
    this.hp = MAX_HP;
    this.#pickHomeWander();
    this.#snap();
    this.#applyPose();
  }

  /** Hypnóza — jen znehybní, dokud kouzlo běží. */
  beginFreeze(hold) {
    if (this.remote || this.dead || this.gone) return;
    this.charm = { t: 0, hold: hold ?? 12 };
  }

  /**
   * Hlídač ho právě smaží — obnoví paniku a směr, odkud to jde.
   * Volá se každý frame, co oblouk svítí; `zapT` pak sám vyprchá.
   */
  onZapped(sourceDir) {
    if (this.remote || this.dead || this.gone) return;
    this.zapT = ZAP_HOLD;
    if (sourceDir) this.zapSrc.copy(sourceDir).normalize();
  }

  /** Tornádo — chycení a vynesení do vzduchu. */
  beginTornadoCapture(centerDir, source = null) {
    if (this.remote || this.tornado || this.dead) return false;
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

  /** Vtah po povrchu k tornádu (dokud není chycený). */
  pullOnSurface(towardDir, stepM) {
    if (this.remote || this.tornado || this.dead) return false;
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

  #applyTornadoPose() {
    const td = this.tornado;
    if (!td) return;
    const side = td.sideZ ?? 0;
    if (td.phase === "climb") {
      this.parts.body.rotation.set(
        Math.sin(td.spinY * 1.8) * (td.preAmp || 0) * 0.3,
        td.spinY,
        -side
      );
    } else {
      this.parts.body.rotation.set(0, td.bodyRoll || 0, -side);
    }
    this.parts.body.position.set(0, this.bodyBaseY, 0);
  }

  #height() {
    return this.terrain.height(this.dir);
  }

  #inWater() {
    return isWaterAt(this.terrain, this.dir);
  }

  #listener() {
    return this.herd.fx?.getListenerDir?.() ?? null;
  }

  #playSfx(id) {
    const audio = this.herd.fx?.audio;
    const listener = this.#listener();
    if (!audio || !listener) return;
    audio.playAt(id, this.dir, listener);
  }

  /**
   * Zvuky podle stavu (funguje i pro remote, kde stav chodí ze sítě):
   * zavrčení při zahájení útoku, smyčka běhu, klovnutí.
   */
  #tickSfx() {
    const hunting = !this.dead && (this.state === "hunt" || this.state === "attack");
    if (hunting && !this._wasHunting) this.#playSfx("attackerAttack");
    this._wasHunting = hunting;
    /** Běh zní i při útěku před hlídačem. */
    const running = this.state === "hunt" || this.state === "flee";
    this.#setRunLoop(running && this._speed > 0.05);
  }

  #setRunLoop(on) {
    const audio = this.herd.fx?.audio;
    if (!audio) return;
    if (!on) {
      if (!this.sfxRun) return;
      this.herd.fx._sfxLoops?.delete(this.sfxRun);
      audio.stopSfxLoop(this.sfxRun, 0.2);
      this.sfxRun = null;
      return;
    }
    const listener = this.#listener();
    if (!listener) return;
    if (this.sfxRun?.alive) {
      audio.updateSfxLoop(this.sfxRun, this.dir, listener);
      return;
    }
    this.sfxRun = null;
    if (surfaceDist(this.dir, listener) > RUN_SFX_DIST) return;
    const handle = audio.startSfxLoop("attackerRun", this.dir, listener);
    if (!handle) return;
    this.sfxRun = handle;
    this.herd.fx._sfxLoops?.add(handle);
  }

  #snap() {
    if (this.#inWater()) {
      /** Ve vodě plave — ponořený do poloviny těla (i když zrovna pronásleduje). */
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
    /** Naklop tělo podle svahu, ať to na kopcích nevypadá, že levituje. */
    const pitch = this.#slopePitch();
    if (pitch) this.mesh.quaternion.multiply(this._pitchQ.setFromAxisAngle(_localX, pitch));
  }

  #slopePitch() {
    /** Na hladině se neklání podle dna — pitch má smysl jen na souši. */
    if (this.#inWater() || this.tornado) return 0;
    this._trial.copy(this.dir).addScaledVector(this.facing, 0.35).normalize();
    this._trial2.copy(this.dir).addScaledVector(this.facing, -0.35).normalize();
    const hF = this.terrain.height(this._trial);
    const hB = this.terrain.height(this._trial2);
    const pitch = -Math.atan2(hF - hB, 0.7) * 0.6;
    return Math.max(-0.42, Math.min(0.42, pitch));
  }

  #pickHomeWander() {
    for (let i = 0; i < 3; i++) {
      tangentFrame(this.home, this._east, this._north);
      pickWanderTarget(this.home, this._east, this._north, this.rng, 2, HOME_RADIUS, (d) => {
        if (!isLand(this.terrain, d)) return false;
        return this.herd.blockers?.clear(d, this.blockR, { ignore: this }) ?? true;
      }, this.targetDir);
      if (isLand(this.terrain, this.targetDir)) return;
    }
  }

  /** Zamíří daleko rovně vpřed — prodloužení plavání. */
  #aimStraightAhead(distM) {
    tangentFrame(this.dir, this._east, this._north);
    const ang = bearingOf(this.facing, this._east, this._north);
    surfaceOffsetDir(this.dir, this._east, this._north, ang, distM, this.targetDir);
  }

  /** Najdi nejkratší směr k souši (vějíř azimutů) a zamíř tam. */
  #aimToShore() {
    tangentFrame(this.dir, this._east, this._north);
    let bestAng = 0;
    let bestD = Infinity;
    let found = false;
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      for (let k = 1; k <= SHORE_PROBES; k++) {
        const dist = k * SHORE_PROBE_STEP;
        surfaceOffsetDir(this.dir, this._east, this._north, ang, dist, this._trial);
        if (isLand(this.terrain, this._trial) && aboveCore(this.terrain, this._trial, MIN_R)) {
          if (dist < bestD) {
            bestD = dist;
            bestAng = ang;
            found = true;
          }
          break;
        }
      }
    }
    if (!found) {
      this.#aimStraightAhead(SHORE_PROBE_STEP * SHORE_PROBES);
      return;
    }
    surfaceOffsetDir(this.dir, this._east, this._north, bestAng, Math.max(14, bestD), this.targetDir);
  }

  #enterSwim() {
    this.state = "swim";
    this.shoreT = 0;
    /** Hon i útěk vodu řeší samy (`allowWater`), sem se chodí jen plavat ke břehu. */
    this.#aimToShore();
  }

  #exitSwim() {
    this.state = "wander";
    this.stateT = 1.2 + this.rng() * 2;
    this.#pickHomeWander();
  }

  #stepToward(target, distM, allowWater = false) {
    const walkable = (d) => {
      if (!allowWater && !isLand(this.terrain, d)) return false;
      if (allowWater && !aboveCore(this.terrain, d, MIN_R)) return false;
      return this.herd.blockers?.clear(d, this.blockR, { ignore: this }) ?? true;
    };
    const res = stepTowardAI(this.dir, target, distM, walkable, this._step);
    this.#snap();
    return res;
  }

  #startAvoid() {
    if (this.avoidT > 0) return;
    this.avoidT = 0.6 + this.rng() * 0.7;
    this.avoidSign = this.rng() < 0.5 ? -1 : 1;
  }

  /** Kam skutečně jít: k cíli, při zaseknutí do strany (hledá cestu kolem). */
  #steerToward(targetDir, dt) {
    this._moveDir.copy(targetDir);
    if (!(this.avoidT > 0)) return;
    this.avoidT -= dt;
    tangentFrame(this.dir, this._east, this._north);
    this._look.copy(targetDir).addScaledVector(this.dir, -targetDir.dot(this.dir));
    const base = this._look.lengthSq() > 1e-8 ? bearingOf(this._look.normalize(), this._east, this._north) : 0;
    surfaceOffsetDir(this.dir, this._east, this._north, base + this.avoidSign * 0.95, 6, this._moveDir);
  }

  /** Nejbližší viditelný kouzelník do VISION (neviditelné míjí jako hlídač). */
  #updateTarget(wizards) {
    if (this.order && (this.order.dead || this.order.eliminated)) this.order = null;
    if (this.order) {
      this.target = this.order;
      return;
    }
    let best = null;
    let bestD = VISION;
    for (const w of wizards || []) {
      if (!w || w.dead || w.gone || w.eliminated) continue;
      if (w.invis) continue;
      const d = surfaceDist(this.dir, w.dir);
      if (d <= bestD) {
        bestD = d;
        best = w;
      }
    }
    this.target = best;
  }

  #stateWander(dt) {
    this.state = "wander";
    this.stateT -= dt;
    this._speed = WALK_SPEED;
    if (this.stateT <= 0) {
      this.#pickHomeWander();
      this.stateT = 2.5 + this.rng() * 4;
    }
    const res = this.#stepToward(this.targetDir, this._speed * dt, false);
    if (res.blocked) this.#startAvoid();
    if (res.arrived) {
      /** Došel — chvíli postoj (bloumání). */
      this._speed = 0;
      this.stateT = Math.min(this.stateT, 0.8 + this.rng() * 2);
    } else {
      turnFacingToward(this.facing, this.dir, this.targetDir, this._move, 1 - Math.exp(-dt * 4));
    }
  }

  #stateHunt(dt) {
    this.state = "hunt";
    const t = this.target;
    if (surfaceDist(this.dir, t.dir) <= PECK_RANGE) {
      this.state = "attack";
      this.peckT = Math.min(this.peckT, 0.45);
      return;
    }
    this._speed = this.#inWater() ? SWIM_SPEED : HUNT_SPEED;
    this.#steerToward(t.dir, dt);
    /** `allowWater` — za kouzelníkem jde i do vody, nezastaví se na břehu. */
    const res = this.#stepToward(this._moveDir, this._speed * dt, true);
    if (res.blocked) this.#startAvoid();
    turnFacingToward(this.facing, this.dir, this._moveDir, this._move, 1 - Math.exp(-dt * 7));
  }

  /**
   * Smaží ho hlídač — peláší přímo od zdroje, dokud nevyběhne z dostřelu.
   * Přebije to jen hon za kouzelníkem (ten řeší `update` výš).
   */
  #stateFlee(dt) {
    this.state = "flee";
    tangentFrame(this.dir, this._east, this._north);
    /** Tangenciální složka zdroje, otočená opačně = směr po povrchu pryč. */
    this._look.copy(this.zapSrc).addScaledVector(this.dir, -this.zapSrc.dot(this.dir));
    if (this._look.lengthSq() < 1e-8) this._look.copy(this._north);
    else this._look.normalize();
    this._away.copy(this._look).multiplyScalar(-1);
    this._speed = HUNT_SPEED;
    this.#steerToward(this._away, dt);
    const res = this.#stepToward(this._moveDir, this._speed * dt, true);
    if (res.blocked) this.#startAvoid();
    turnFacingToward(this.facing, this.dir, this._moveDir, this._move, 1 - Math.exp(-dt * 7));
  }

  /** Drží se u kouzelníka a klove předními pařáty 1× za sekundu. */
  #stateAttack(dt) {
    const t = this.target;
    this.state = "attack";
    const d = surfaceDist(this.dir, t.dir);
    if (d < STANDOFF * 0.8) {
      /** Kouzelník se navalil — couvni, ať se těla nepřekrývají. */
      tangentFrame(this.dir, this._east, this._north);
      this._look.copy(t.dir).addScaledVector(this.dir, -t.dir.dot(this.dir));
      if (this._look.lengthSq() < 1e-8) this._look.copy(this._north);
      else this._look.normalize();
      this._away.copy(this._look).multiplyScalar(-1);
      this._speed = WALK_SPEED;
      this.#stepToward(this._away, this._speed * dt, true);
    } else {
      this._speed = 0;
    }
    turnFacingToward(this.facing, this.dir, t.dir, this._move, 1 - Math.exp(-dt * 8));

    this.peckT -= dt;
    if (this.peckT <= 0 && d <= PECK_RANGE * 1.25) {
      this.peckT = PECK_INTERVAL;
      this.striking = true;
      this.strikeT = 0;
      this.#playSfx("attackerClaw");
      t.takeDamage(PECK_DAMAGE, { fromDir: this.dir, knock: false });
      /** Remote hráč si poškození aplikuje sám (viz net/intents.js → bite). */
      if (t.remote && !this.remote) {
        this.herd.session?.sendIntent?.({
          kind: "bite",
          target: String(t.id),
          amount: PECK_DAMAGE,
          from: [this.dir.x, this.dir.y, this.dir.z]
        });
      }
    }
  }

  #stateSwim(dt) {
    this.state = "swim";
    this._speed = SWIM_SPEED;
    if (!this.#inWater()) {
      this.#exitSwim();
      return;
    }
    this.shoreT -= dt;
    if (this.shoreT <= 0 || surfaceDist(this.dir, this.targetDir) < 4) {
      this.#aimToShore();
      this.shoreT = SHORE_RETARGET;
    }
    this.#stepToward(this.targetDir, this._speed * dt, true);
    turnFacingToward(this.facing, this.dir, this.targetDir, this._move, 1 - Math.exp(-dt * 4));

    this.wakeT -= dt;
    if (this.wakeT <= 0) {
      spawnWaterWake(this.herd.fx, this.dir, this.facing, {
        size: 0.55 + this.size * 0.5,
        back: 0.4 + this.size * 0.3,
        opacity: 0.34,
        life: 0.55
      });
      this.wakeT = 0.24 + this.rng() * 0.1;
    }
  }

  #animate(dt, speed) {
    const parts = this.parts;
    const moving = speed > 0.05;
    if (this.striking) {
      this.strikeT += dt;
      if (this.strikeT >= 0.34) this.striking = false;
    }
    /** Kráčející nohy se hýbou úměrně rychlosti; v klidu jen dýchá. */
    const amp = moving ? Math.min(1, 0.55 + speed * 0.25) : 0;
    this.walkPhase += dt * (moving ? 2 + speed * 1.2 : 0.55);

    parts.body.rotation.x = 0;
    parts.body.rotation.z = moving ? Math.sin(this.walkPhase) * 0.05 * amp : Math.sin(this.phase * 1.3) * 0.012;
    parts.body.rotation.y = moving ? Math.sin(this.walkPhase) * 0.04 * amp : 0;
    parts.body.position.y =
      this.bodyBaseY +
      (moving ? Math.abs(Math.sin(this.walkPhase)) * 0.014 : Math.sin(this.phase * 1.7) * 0.004);

    if (this.#inWater()) {
      /** Ve vodě nohy složí k tělu a pádluje jimi. */
      for (const leg of parts.legs) {
        const off = (leg.k + (leg.side > 0 ? 1 : 0)) * Math.PI;
        const paddle = Math.sin(this.walkPhase * 1.7 + off);
        leg.hip.rotation.y = paddle * 0.22;
        leg.hip.rotation.z = -leg.side * (1.35 + paddle * 0.16);
        leg.knee.rotation.z = -leg.side * 2.45;
        leg.ankle.rotation.z = -leg.side * 0.15;
      }
    } else {
      /**
       * Krok: diagonální páry (střední L + zadní P) jdou proti sobě.
       * Zvedá se stehno a chodidlo se přitom stáhne, takže se při kroku nezaryje.
       */
      for (const leg of parts.legs) {
        const off = (leg.k + (leg.side > 0 ? 1 : 0)) * Math.PI;
        const swing = Math.sin(this.walkPhase + off);
        const lift = Math.max(0, Math.cos(this.walkPhase + off));
        leg.hip.rotation.y = swing * 0.34 * amp;
        leg.hip.rotation.z = -leg.side * (LEG_FEMUR_A - lift * 0.42 * amp);
        leg.knee.rotation.z = -leg.side * (LEG_KNEE_A + lift * 0.12 * amp);
        leg.ankle.rotation.z = -leg.side * (LEG_ANKLE_A - lift * 0.28 * amp);
      }
    }

    // přední paže — složené „k modlitbě", při klovnutí vpřed
    const restSh = 0.95;
    const restEl = -2.6;
    let sh = restSh;
    let el = restEl;
    if (this.striking) {
      const u = Math.min(1, this.strikeT / 0.34);
      if (u < 0.3) {
        const k = u / 0.3;
        sh = THREE.MathUtils.lerp(restSh, restSh - 0.28, k);
        el = THREE.MathUtils.lerp(restEl, restEl - 0.2, k);
      } else if (u < 0.62) {
        const k = (u - 0.3) / 0.32;
        const e = k * k * (3 - 2 * k);
        sh = THREE.MathUtils.lerp(restSh - 0.28, 1.5, e);
        el = THREE.MathUtils.lerp(restEl - 0.2, -0.2, e);
      } else {
        const k = (u - 0.62) / 0.38;
        const e = k * k * (3 - 2 * k);
        sh = THREE.MathUtils.lerp(1.5, restSh, e);
        el = THREE.MathUtils.lerp(-0.2, restEl, e);
      }
    }
    const raised = this.state === "hunt" ? 0.16 : 0;
    const armBob = moving ? Math.sin(this.walkPhase * 2) * 0.03 * amp : 0;
    for (const arm of parts.arms) {
      arm.shoulder.rotation.x = sh + raised + armBob;
      arm.shoulder.rotation.z = -arm.side * 0.42;
      arm.elbow.rotation.x = el;
    }

    // hlava — v útoku skloněná na kořist
    const look = this.state === "attack" || this.state === "hunt" ? -0.12 : Math.sin(this.phase * 1.1) * 0.05;
    parts.head.rotation.x += (look - parts.head.rotation.x) * Math.min(1, dt * 5);
    parts.head.rotation.y = moving ? Math.sin(this.walkPhase) * 0.05 : Math.sin(this.phase * 0.9) * 0.04;

    // tykadla + zadeček
    for (let i = 0; i < parts.antennae.length; i++) {
      const a = parts.antennae[i];
      const t = this.phase * 2.3 + i * 1.7;
      a.root.rotation.x = -0.55 + Math.sin(t) * 0.1;
      a.tip.rotation.x = Math.sin(t + 0.9) * 0.16;
    }
    parts.abdomen.rotation.x = 0.36 + Math.sin(this.phase * 1.4) * 0.03;
    parts.abdomen.rotation.y = moving ? Math.sin(this.walkPhase * 0.9) * 0.045 : 0;
  }

  takeDamage(amount, opts = {}) {
    if (this.remote && !opts.fromNet) return false;
    if (this.dead || this.gone || amount <= 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (opts.ignite) this.ignite();
    if (this.hp > 0) return false;
    return this.die(opts);
  }

  die(opts = {}) {
    if (this.remote && !opts.fromNet) return false;
    if (this.dead || this.gone) return false;
    this.dead = true;
    this.state = "dead";
    this.tornado = null;
    this.charm = null;
    this.#setRunLoop(false);
    this._wasHunting = false;
    this.order = null;
    this.target = null;
    this.dieT = 0;
    this.soulDelay = SOUL_DELAY;
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
      this.knockFrom = null;
      this._knockAway.set(0, 0, 0);
    } else {
      this.#setKnockFrom(fromDir);
      if (this._knockAway.lengthSq() > 1e-8) {
        this.slideLeft = 2.2 + this.rng() * 1.2;
        this.slideSpeed = this.slideLeft / 0.5;
      } else {
        this.slideLeft = 0;
        this.slideSpeed = 0;
      }
    }
    if (!opts.fromNet) this.herd.onDied?.(this);
    const listener = this.herd.fx?.getListenerDir?.();
    if (listener) this.herd.fx.audio?.playAt("critterDeath", this.dir, listener);
    return true;
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
    if (this._knockAway.lengthSq() < 1e-8) tangentFrame(this.dir, this._east, this._knockAway);
    else this._knockAway.normalize();
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
    if (!isLand(this.terrain, this.dir) || !(this.herd.blockers?.clear(this.dir, this.blockR, { ignore: this }) ?? true)) {
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

  #deathPose(dt) {
    this.dieT = Math.min(1, this.dieT + dt / 0.45);
    const u = this.dieT * this.dieT * (3 - 2 * this.dieT);
    this.parts.body.rotation.z = u * (Math.PI * 0.5);
    this.parts.body.rotation.x = 0;
    this.parts.body.rotation.y = 0;
    this.parts.body.position.y = this.bodyBaseY + u * this.lieLift;
    for (const leg of this.parts.legs) {
      leg.hip.rotation.y *= 1 - dt * 6;
      /** Slož nohy k tělu, ať mrtvola neleží roztažená jako živá. */
      leg.hip.rotation.z = THREE.MathUtils.lerp(leg.hip.rotation.z, -leg.side * 1.5, 0.12);
      leg.knee.rotation.z = THREE.MathUtils.lerp(leg.knee.rotation.z, -leg.side * 2.38, 0.12);
      leg.ankle.rotation.z = THREE.MathUtils.lerp(leg.ankle.rotation.z, leg.side * 0.5, 0.12);
    }
  }

  #tickSoul(dt) {
    this._soul = updateSoul(this._soul, this.herd.planetGroup, this.dir, dt);
    if (!this.dead || this._soul || this.soulDelay == null) return;
    this.soulDelay -= dt;
    if (this.soulDelay > 0) return;
    this.soulDelay = null;
    this.#applyPose();
    this._soul = spawnSoul(this.herd.planetGroup, this.mesh);
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
    this._fire = attachFireQueued(this.mesh, { pad: 1.4 });
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

  syncBurn(burning, charred) {
    if (charred) {
      if (!this.burning && !this.charred) this.ignite();
      if (!this.charred) this.#charBody();
    } else if (burning && !this.burning && !this.charred) {
      this.ignite();
    }
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

  #presentRemote(dt) {
    let speed = 0;
    if (this.netMoving) {
      speed =
        this.state === "hunt" || this.state === "flee"
          ? HUNT_SPEED
          : this.state === "swim"
            ? SWIM_SPEED
            : WALK_SPEED;
    }
    if (this.state === "attack") {
      this.peckT -= dt;
      if (this.peckT <= 0) {
        this.peckT = PECK_INTERVAL;
        this.striking = true;
        this.strikeT = 0;
        this.#playSfx("attackerClaw");
      }
    }
    this._speed = speed;
    this.#snap();
    this.#applyPose();
    this.#animate(dt, speed);
    this.#updateBurn(dt);
    this.#tickSfx();
  }

  #updateRemote(dt) {
    this.phase += dt;
    applyEntityNet(this);
    if (this.vanished) {
      this.mesh.visible = false;
      return;
    }
    if (this.dead) {
      this.#deathPose(dt);
      this.#snap();
      this.#applyPose();
      this.#updateBurn(dt);
      return;
    }
    if (this.tornado || this.netTornado) {
      /** Chycený tornádem (host to simuluje) — jen pose + výška z packetu. */
      this.#setRunLoop(false);
      this.#applyTornadoPose();
      if (this.netRadius > 1) this.mesh.position.copy(this.dir).multiplyScalar(this.netRadius);
      else this.#snap();
      this.#applyPose();
      this.#updateBurn(dt);
      return;
    }
    this.#presentRemote(dt);
  }

  update(dt, wizards) {
    this.#tickSoul(dt);
    if (this.remote) {
      this.#updateRemote(dt);
      return;
    }
    this.phase += dt;
    /**
     * Kudlanka se nezceluje — žádná regenerace. Smažení hlídače (2 HP/s)
     * tak není čím dorovnat a 20 HP skončí přesně za 10 s.
     */
    if (this.zapT > 0) this.zapT -= dt;
    if (this.dead) {
      this.netMoving = false;
      this.#deathPose(dt);
      this.#slideDead(dt);
      this.#snap();
      this.#applyPose();
      this.#updateBurn(dt);
      return;
    }

    if (this.tornado) {
      /** Chycený tornádem — rotuje a letí (pozici řeší spells/tornado.js). */
      this.netMoving = true;
      this.#setRunLoop(false);
      this.#applyTornadoPose();
      this.#applyPose();
      this.#updateBurn(dt);
      return;
    }

    if (this.demonHold) {
      /** Démon ho drží — znehybnělý, než se do něj vmorfuje. */
      this.netMoving = false;
      this.#setRunLoop(false);
      this.#snap();
      this.#applyPose();
      this.#animate(dt, 0);
      this.#updateBurn(dt);
      return;
    }

    if (this.charm) {
      /** Hypnóza — jen znehybnění po dobu trvání kouzla. */
      this.charm.t += dt;
      if (this.charm.t < this.charm.hold) {
        this.netMoving = false;
        this.#setRunLoop(false);
        this.#snap();
        this.#applyPose();
        this.#animate(dt, 0);
        this.#updateBurn(dt);
        return;
      }
      this.charm = null;
    }

    if (this._tornadoPullSpeed > 0) {
      /** Vtahuje ho tornádo — nech se táhnout, nešlape vlastní cestou. */
      this.netMoving = true;
      this.#setRunLoop(false);
      this.#applyPose();
      this.#updateBurn(dt);
      return;
    }

    this.#updateTarget(wizards);

    /** Má cíl (pronásleduje) → voda i hlídač jdou stranou; jinak se drží na souši. */
    const chasing = !!this.target;
    const fleeing = !chasing && this.zapT > 0;
    /** Na souši se drží, jen když nic nepronásleduje ani neutíká. */
    if (!chasing && !fleeing && this.state !== "swim" && this.#inWater()) this.#enterSwim();

    if (chasing && surfaceDist(this.dir, this.target.dir) <= PECK_RANGE) {
      this.#stateAttack(dt);
    } else if (chasing) {
      this.#stateHunt(dt);
    } else if (fleeing) {
      this.#stateFlee(dt);
    } else if (this.state === "swim") {
      this.#stateSwim(dt);
    } else {
      this.#stateWander(dt);
    }

    this.netMoving = this._speed > 0.05;
    this.#snap();
    this.#applyPose();
    this.#animate(dt, this._speed);
    this.#updateBurn(dt);
    this.#tickSfx();
  }

  dispose() {
    this.#setRunLoop(false);
    if (this._fire) {
      this._fire.dispose();
      this._fire = null;
    }
    for (const m of this._burnMats) m.dispose();
    this._burnMats.length = 0;
    this._soul = disposeSoul(this._soul, this.herd.planetGroup);
    this.herd.planetGroup.remove(this.mesh);
  }
}

export class AttackerHerd {
  constructor(planetGroup, terrain, seed = CONFIG.defaultMapSeed) {
    this.planetGroup = planetGroup;
    this.terrain = terrain;
    this.seed = seed + 31337;
    this.list = [];
    this.onDied = null;
    this.blockers = null;
    this.fx = null;
    this.spawnDirs = null;
    this.remote = false;
    this.orderT = 0;
    this.geos = {
      sphere: new THREE.SphereGeometry(1, 20, 14),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
      cone: new THREE.ConeGeometry(1, 1, 10)
    };
    this.mats = {
      hide: mat(0x4a7a2c),
      belly: mat(0xa8c86a),
      arm: mat(0x3c6820, { roughness: 0.6 }),
      dark: mat(0x233a15, { roughness: 0.7 }),
      eye: mat(0x2a2205, { emissive: 0xffb43a, emissiveIntensity: 0.55, roughness: 0.3 }),
      eyeGlow: mat(0xffd070, { emissive: 0xffe0a0, emissiveIntensity: 0.95, roughness: 0.25 })
    };
    this.spawn();
  }

  /**
   * Rozmísti 40 útočníků difuzně po souši, nikdo blíž než `SPAWN_CLEAR`
   * metrů od spawn pointu. Když je pevniny málo, vzdálenost se postupně povolí.
   */
  spawn(spawnDirs) {
    if (spawnDirs) this.spawnDirs = spawnDirs;
    this.clear();
    const want = COUNT;
    const dirs = [];
    const blockR = attackerBodyRadius({ size: 1 });
    const margins = [SPAWN_CLEAR, 34, 22, 12, 0];
    for (const margin of margins) {
      if (dirs.length >= want) break;
      const need = want - dirs.length;
      const ok = (dir, e, n) => {
        if (!isWalkable(this.terrain, dir, e, n)) return false;
        if (this.blockers && !this.blockers.clear(dir, blockR)) return false;
        if (!clearOfSpawns(dir, this.spawnDirs, margin)) return false;
        for (const p of dirs) {
          if (surfaceDist(dir, p) < SPAWN_SEP * 0.75) return false;
        }
        return true;
      };
      const placed = scatterOnLand(need, ok, SPAWN_SEP);
      for (const d of placed) dirs.push(d);
    }
    for (let i = 0; i < dirs.length; i++) {
      const rng = mulberry32(this.seed + (i + 1) * 7331);
      this.list.push(new Attacker(this, i, dirs[i], rng));
    }
    if (this.remote) {
      for (const a of this.list) a.remote = true;
    }
  }

  clear() {
    for (const a of this.list) a.dispose();
    this.list.length = 0;
  }

  dispose() {
    this.clear();
    for (const m of Object.values(this.mats)) m.dispose();
    for (const g of Object.values(this.geos)) g.dispose();
  }

  /** Jednou za ORDER_PERIOD sekund pošle nejbližšího útočníka na každého kouzelníka. */
  #tickOrders(dt, wizards) {
    this.orderT += dt;
    if (this.orderT < ORDER_PERIOD) return;
    this.orderT = 0;
    const used = new Set();
    for (const w of wizards || []) {
      if (!w || w.dead || w.gone || w.eliminated) continue;
      let best = null;
      let bestD = Infinity;
      for (const a of this.list) {
        if (a.dead || a.gone || a.remote || used.has(a)) continue;
        const d = surfaceDist(a.dir, w.dir);
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      if (!best) continue;
      best.order = w;
      used.add(best);
    }
  }

  /** Zásah v rádiusu — damage podle vzdálenosti (stejně jako zvířata). */
  hurtNear(centerDir, radiusM, dmgCenter, dmgEdge, opts = {}) {
    if (this.remote || !centerDir || radiusM <= 0) return false;
    let hit = false;
    const { hitSet, hitKey = "at", ignite, ...rest } = opts;
    for (const a of this.list) {
      if (a.dead || a.gone) continue;
      const dist = surfaceDist(a.dir, centerDir);
      if (dist > radiusM) continue;
      if (!claimHit(hitSet, `${hitKey}:${a.id}`)) continue;
      const damage = aoeFalloff(dist, radiusM, dmgCenter, dmgEdge);
      if (a.takeDamage(damage, { fromDir: centerDir, ignite, ...rest })) hit = true;
    }
    return hit;
  }

  /** Výbuch komety — v kráteru se odpaří, do damage radiusu uhoří. */
  blastNear(centerDir, vaporizeR, damageR) {
    if (this.remote || !centerDir) return false;
    let hit = false;
    for (const a of this.list) {
      if (a.dead || a.gone) continue;
      const dist = surfaceDist(a.dir, centerDir);
      if (dist <= vaporizeR) {
        if (a.die({ noSlide: true, vanish: true })) hit = true;
      } else if (dist <= damageR) {
        const damage = aoeFalloff(dist, damageR, 200, 50);
        if (a.takeDamage(damage, { fromDir: centerDir, ignite: true })) hit = true;
      }
    }
    return hit;
  }

  /** Hypnóza — znehybní na dobu trvání kouzla. */
  freezeNear(centerDir, radiusM, hold) {
    if (this.remote || !centerDir || !(radiusM > 0)) return;
    for (const a of this.list) {
      if (a.dead || a.gone) continue;
      if (surfaceDist(a.dir, centerDir) <= radiusM) a.beginFreeze(hold);
    }
  }

  kill(id, dirArr, fromArr) {
    const a = this.list[id];
    if (!a) return;
    const dir = dirArr ? new THREE.Vector3(dirArr[0], dirArr[1], dirArr[2]) : null;
    a.die({ atDir: dir, fromDir: fromArr || null, fromNet: true });
  }

  update(dt, wizards) {
    if (!this.remote) this.#tickOrders(dt, wizards);
    for (const a of this.list) a.update(dt, wizards);
  }
}
