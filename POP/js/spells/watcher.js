import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { SPELLS } from "./defs.js";
import { surfaceDist } from "./fx-common.js";

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _yUp = new THREE.Vector3(0, 1, 0);
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _local = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _arcMid = new THREE.Vector3();
const _arcSide = new THREE.Vector3();
const _arcSide2 = new THREE.Vector3();
const _arcAlong = new THREE.Vector3();

const VINE_RISE = 0.85;
const CALYX_GROW = 0.5;
const EYE_GROW = 0.55;
const STEM_H = 2.35;
const EYE_R = 0.84;
/** Pomalá rotace kalichu+oka kolem svislé osy (rad/s). */
const HEAD_SPIN = 0.55;
const EYE_LOOK_MAX = 0.45;
const BLIND_SEC = 20;
const ARC_POINTS = 18;
const ARC_LOS_SAMPLES = 16;
const ARC_LOS_CLEAR = 0.22;
const ZAP_SPARKS = 12;
const ZAP_PULSE = 0.14;

const COLOR_SCLERA = 0xf4f4ef;
const COLOR_IRIS = 0xb8922e;
const COLOR_BLIND_SCLERA = 0xc02028;
const COLOR_BLIND_IRIS = 0x5a0a10;
const COLOR_CORRUPT_SCLERA = 0x4a080c;
const COLOR_CORRUPT_IRIS = 0x050508;

function ownerVineColors(hex) {
  const base = new THREE.Color(Number(hex) || 0x3a8048);
  const out = [];
  for (let i = 0; i < 6; i++) {
    const c = base.clone();
    const t = i / 5 - 0.5;
    c.offsetHSL(t * 0.04, 0.06 + t * 0.1, t * 0.18);
    out.push(c.getHex());
  }
  return out;
}

function ownerIrisHex(hex) {
  return Number(hex) || COLOR_IRIS;
}

function irisRestHex(w) {
  return ownerIrisHex(w?.irisBase ?? COLOR_IRIS);
}

function syncWatcherOwnerColor(w, hex) {
  const color = ownerIrisHex(hex);
  if (w._ownerColorSynced === color) return;
  w._ownerColorSynced = color;
  w.irisBase = color;

  const vineMats = w.vines?.userData?.mats;
  if (vineMats?.length && !w.corrupted) {
    const colors = ownerVineColors(color);
    for (let i = 0; i < vineMats.length; i++) {
      vineMats[i]?.color?.setHex(colors[i % colors.length]);
    }
  }

  if (!w.corrupted && !(w.blindT > 0)) {
    setEyeColors(w, COLOR_SCLERA, color);
  }
}

let _nextId = 1;

function vineMat(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.88,
    metalness: 0.02
  });
}

function makeVineCurve(i, count) {
  const a0 = (i / count) * Math.PI * 2 + 0.15;
  const spread = 0.18 + (i % 3) * 0.06;
  const twist = 1.1 + (i % 4) * 0.35;
  const pts = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    const h = t * STEM_H;
    const rad = spread * (1 - t * 0.55) * (0.55 + 0.45 * Math.sin(t * Math.PI));
    const ang = a0 + t * twist * Math.PI * 1.4;
    pts.push(
      new THREE.Vector3(
        Math.cos(ang) * rad + Math.sin(t * 9 + i) * 0.04 * (1 - t),
        h,
        Math.sin(ang) * rad + Math.cos(t * 7 + i * 1.3) * 0.035 * (1 - t)
      )
    );
  }
  return new THREE.CatmullRomCurve3(pts);
}

function makeVines(ownerHex) {
  const root = new THREE.Group();
  const geos = [];
  const mats = [];
  const colors = ownerVineColors(ownerHex);
  const count = 6;
  for (let i = 0; i < count; i++) {
    const curve = makeVineCurve(i, count);
    const radius = 0.04 + (i % 3) * 0.012;
    const geo = new THREE.TubeGeometry(curve, 20, radius, 5, false);
    const mat = vineMat(colors[i % colors.length]);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    geos.push(geo);
    mats.push(mat);
  }
  root.userData.geos = geos;
  root.userData.mats = mats;
  root.scale.set(1, 0.001, 1);
  return root;
}

function makeCalyx() {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4cae5a,
    roughness: 0.72,
    metalness: 0.04,
    side: THREE.DoubleSide
  });
  const matDark = new THREE.MeshStandardMaterial({
    color: 0x2f7a3c,
    roughness: 0.8,
    metalness: 0.03,
    side: THREE.DoubleSide
  });
  const geos = [];
  const mats = [mat, matDark];

  /** Jen listy kolem stonku — bez misky/disku mezi okem a stonkem. */
  const leafN = 5;
  for (let i = 0; i < leafN; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), i % 2 ? mat : matDark);
    leaf.scale.set(0.42, 0.7, 0.14);
    const a = (i / leafN) * Math.PI * 2;
    /** Ven + mírně dolů — kolem spodku oka, ne přes duhovku. */
    leaf.position.set(Math.cos(a) * 0.38, -0.06, Math.sin(a) * 0.38);
    leaf.rotation.y = -a;
    leaf.rotation.x = 0.85;
    leaf.castShadow = true;
    root.add(leaf);
    geos.push(leaf.geometry);
  }

  root.userData.geos = geos;
  root.userData.mats = mats;
  root.scale.setScalar(0.001);
  return root;
}

/**
 * Bod na jednotkové kouli: θ = úhel od osy pohledu (+Z), φ = azimut.
 * θ=0 přední pól (duhovka), θ=π zadní pól.
 */
function scleraDir(theta, phi, out = new THREE.Vector3()) {
  const st = Math.sin(theta);
  return out.set(st * Math.cos(phi), st * Math.sin(phi), Math.cos(theta));
}

/**
 * Žilka od zadního pólu (θ≈π) klikatě dopředu (θ klesá k okraji duhovky).
 */
function makeVeinPoints(irisAng, rSurf, phi0) {
  const pts = [];
  const _d = new THREE.Vector3();
  /** Start u zadního pólu, mírně mimo singularitu. */
  let theta = Math.PI - (0.08 + Math.random() * 0.18);
  let phi = phi0;
  const steps = 14 + ((Math.random() * 8) | 0);
  /** Dojde až k limbu — těsně před duhovkou. */
  const thetaEnd = irisAng + 0.05 + Math.random() * 0.08;
  const dTheta = (thetaEnd - theta) / steps;

  for (let i = 0; i <= steps; i++) {
    pts.push(scleraDir(theta, phi, _d).clone().multiplyScalar(rSurf));
    theta += dTheta * (0.75 + Math.random() * 0.5);
    /** Klikatění — větší změny azimutu. */
    phi += (Math.random() - 0.5) * 1.15;
    if (theta < thetaEnd) {
      theta = thetaEnd;
      pts.push(scleraDir(theta, phi, _d).clone().multiplyScalar(rSurf));
      break;
    }
  }
  return pts;
}

function addScleraVeins(group, irisAng, geos, mats) {
  const R_VEIN = 1.018;
  const veinMat = new THREE.MeshStandardMaterial({
    color: 0xb03038,
    roughness: 0.65,
    metalness: 0.02,
    emissive: 0x4a1014,
    emissiveIntensity: 0.15
  });
  mats.push(veinMat);
  group.userData.veinMat = veinMat;

  const veinCount = 16;
  for (let i = 0; i < veinCount; i++) {
    const phi0 = (i / veinCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const pts = makeVeinPoints(irisAng, R_VEIN, phi0);
    if (pts.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(pts);
    const radius = 0.009 + Math.random() * 0.011;
    const geo = new THREE.TubeGeometry(curve, 20, radius, 4, false);
    group.add(new THREE.Mesh(geo, veinMat));
    geos.push(geo);

    /** Odbočka někde v polovině cesty (po boční skléře). */
    if (Math.random() < 0.65 && pts.length >= 6) {
      const midIdx = 3 + ((Math.random() * (pts.length - 5)) | 0);
      const mid = pts[midIdx];
      const midTheta = Math.acos(Math.min(1, Math.max(-1, mid.z / R_VEIN)));
      const midPhi = Math.atan2(mid.y, mid.x) + (Math.random() - 0.5) * 0.9;
      const branchPts = [];
      const _d = new THREE.Vector3();
      let th = midTheta;
      let ph = midPhi;
      const bSteps = 5 + ((Math.random() * 4) | 0);
      for (let b = 0; b < bSteps; b++) {
        branchPts.push(scleraDir(th, ph, _d).clone().multiplyScalar(R_VEIN));
        th -= 0.08 + Math.random() * 0.1;
        ph += (Math.random() - 0.5) * 1.2;
        if (th < irisAng + 0.06) break;
      }
      if (branchPts.length >= 2) {
        const bCurve = new THREE.CatmullRomCurve3(branchPts);
        const bGeo = new THREE.TubeGeometry(bCurve, 12, radius * 0.7, 4, false);
        group.add(new THREE.Mesh(bGeo, veinMat));
        geos.push(bGeo);
      }
    }
  }
}

/**
 * Anatomické oko: bílý bulbus + vypouklá žlutohnědá duhovka (sférická čepička)
 * a na ní vypouklá černá zornice. Žilky = trubičky na skléře pro θ > irisAng.
 *
 * Three.js SphereGeometry: theta=0 je pól +Y → rotace X = π/2 natočí pól na +Z.
 */
function makeEye(irisHex) {
  const group = new THREE.Group();
  const R = 1;
  /** Poloviční úhel duhovky / zornice (od středu oka, osa +Z). */
  const IRIS_ANG = 0.72;
  const PUPIL_ANG = 0.3;
  const R_IRIS = R * 1.012;
  const R_PUPIL = R * 1.024;

  const geos = [];
  const mats = [];

  const scleraMat = new THREE.MeshStandardMaterial({
    color: 0xf4f4ef,
    roughness: 0.38,
    metalness: 0.02
  });
  const irisMat = new THREE.MeshStandardMaterial({
    color: ownerIrisHex(irisHex),
    roughness: 0.48,
    metalness: 0.04
  });
  const pupilMat = new THREE.MeshStandardMaterial({
    color: 0x050508,
    roughness: 0.75,
    metalness: 0
  });
  mats.push(scleraMat, irisMat, pupilMat);

  const scleraGeo = new THREE.SphereGeometry(R, 28, 20);
  const sclera = new THREE.Mesh(scleraGeo, scleraMat);
  sclera.castShadow = true;
  sclera.receiveShadow = true;
  group.add(sclera);
  geos.push(scleraGeo);

  /** Žilky na skléře — až po postavení duhovky v úhlu, ale pod ní na θ. */
  addScleraVeins(group, IRIS_ANG, geos, mats);

  const irisGeo = new THREE.SphereGeometry(R_IRIS, 28, 14, 0, Math.PI * 2, 0, IRIS_ANG);
  const iris = new THREE.Mesh(irisGeo, irisMat);
  iris.rotation.x = Math.PI / 2;
  iris.castShadow = true;
  group.add(iris);
  geos.push(irisGeo);

  const pupilGeo = new THREE.SphereGeometry(R_PUPIL, 20, 10, 0, Math.PI * 2, 0, PUPIL_ANG);
  const pupil = new THREE.Mesh(pupilGeo, pupilMat);
  pupil.rotation.x = Math.PI / 2;
  group.add(pupil);
  geos.push(pupilGeo);

  group.userData.mats = mats;
  group.userData.geos = geos;
  group.userData.scleraMat = scleraMat;
  group.userData.irisMat = irisMat;
  group.userData.pupilMat = pupilMat;
  group.scale.setScalar(0.001);
  return group;
}

function pickLookTarget() {
  return {
    x: (Math.random() * 2 - 1) * EYE_LOOK_MAX * 0.55,
    y: (Math.random() * 2 - 1) * EYE_LOOK_MAX,
    hold: 0.18 + Math.random() * 0.55
  };
}

/**
 * Šedý FOW otisk Hlídače (jako ghost stromů) — klon se šedými materiály.
 */
export function ensureWatcherGhost(sys, w) {
  if (w.ghostGroup || !w.group || !sys?.planetGroup) return;
  const ghost = w.group.clone(true);
  ghost.traverse((ch) => {
    if (!ch.isMesh || !ch.material) return;
    const srcList = Array.isArray(ch.material) ? ch.material : [ch.material];
    const grayList = srcList.map((src) => {
      const m = src.clone();
      m.color?.setHex(0x6a6a6a);
      if (m.emissive) {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
      if (m.map) m.map = null;
      m.transparent = true;
      m.opacity = 0.52;
      m.depthWrite = false;
      return m;
    });
    ch.material = Array.isArray(ch.material) ? grayList : grayList[0];
    ch.castShadow = false;
    ch.receiveShadow = false;
    if (!w._ghostMats) w._ghostMats = [];
    w._ghostMats.push(...grayList);
  });
  ghost.position.copy(w.group.position);
  ghost.quaternion.copy(w.group.quaternion);
  ghost.scale.copy(w.group.scale);
  ghost.visible = false;
  ghost.frustumCulled = false;
  sys.planetGroup.add(ghost);
  w.ghostGroup = ghost;
}

function disposeWatcherGhost(sys, w) {
  if (!w.ghostGroup) return;
  if (w.ghostGroup.parent) w.ghostGroup.parent.remove(w.ghostGroup);
  for (const m of w._ghostMats || []) m.dispose?.();
  w._ghostMats = null;
  w.ghostGroup = null;
}

function setEyeColors(w, scleraHex, irisHex) {
  if (w.scleraMat?.color) w.scleraMat.color.setHex(scleraHex);
  if (w.irisMat?.color) w.irisMat.color.setHex(irisHex);
}

function blackenMats(mats, hex = 0x050508) {
  for (const m of mats || []) {
    if (!m) continue;
    if (m.color) m.color.setHex(hex);
    if (m.emissive) {
      m.emissive.setHex(0x000000);
      m.emissiveIntensity = 0;
    }
  }
}

function dropFow(sys, w) {
  if (!w.fowRegistered) return;
  sys.fow?.removeSource?.(w.id);
  w.fowRegistered = false;
}

/** True local player (ne remote) — castAs dočasně přepisuje sys.wizard. */
function isLocalOwner(sys, ownerId) {
  if (ownerId == null) return false;
  const list = sys.getWizards?.() || [];
  for (const w of list) {
    if (!w || w.remote) continue;
    if (String(w.id) === String(ownerId)) return !w.dead;
  }
  return false;
}

function restoreFow(sys, w) {
  if (w.corrupted || w.blindT > 0 || w.fowRegistered) return;
  if (!isLocalOwner(sys, w.ownerId)) return;
  sys.fow?.addSource?.(w.id, w.dir, SPELLS.watcher?.radius ?? 35);
  w.fowRegistered = true;
}

function applyBlind(sys, w) {
  if (w.corrupted) return;
  w.blindT = BLIND_SEC;
  setEyeColors(w, COLOR_BLIND_SCLERA, COLOR_BLIND_IRIS);
  dropFow(sys, w);
  w.seenIds?.clear?.();
}

function applyCorrupt(sys, w) {
  if (w.corrupted) return;
  w.corrupted = true;
  w.blindT = 0;
  w.demonHold = false;
  setEyeColors(w, COLOR_CORRUPT_SCLERA, COLOR_CORRUPT_IRIS);
  /** Cévy, liány i kalich — černé. */
  if (w.veinMat?.color) {
    w.veinMat.color.setHex(0x050508);
    if (w.veinMat.emissive) {
      w.veinMat.emissive.setHex(0x000000);
      w.veinMat.emissiveIntensity = 0;
    }
  }
  blackenMats(w.vines?.userData?.mats);
  blackenMats(w.calyx?.userData?.mats);
  if (w.pupilMat?.color) w.pupilMat.color.setHex(0x050508);
  dropFow(sys, w);
  w.seenIds?.clear?.();
  if (w.alarmSfx) {
    sys.audio?.stopWatcherAlarm?.(w.alarmSfx, 0.15);
    w.alarmSfx = null;
  }
}

function bindWatcherCombat(sys, entry) {
  entry.mesh = entry.group;
  entry.dead = false;
  entry.gone = false;
  entry.corrupted = false;
  entry.demonHold = false;
  entry.blindT = 0;
  entry.scleraMat = entry.eye?.userData?.scleraMat ?? null;
  entry.irisMat = entry.eye?.userData?.irisMat ?? null;
  entry.veinMat = entry.eye?.userData?.veinMat ?? null;
  entry.pupilMat = entry.eye?.userData?.pupilMat ?? null;

  entry.takeDamage = (_amount, opts = {}) => {
    if (entry.corrupted) return false;
    if (opts.force) {
      applyCorrupt(sys, entry);
      return true;
    }
    applyBlind(sys, entry);
    return false;
  };

  entry.die = (opts = {}) => {
    if (opts.force) applyCorrupt(sys, entry);
  };

  entry.applyNetCorrupt = (s) => applyCorrupt(s || sys, entry);
  entry.applyNetBlind = (s) => {
    const sp = s || sys;
    if (entry.corrupted) return;
    setEyeColors(entry, COLOR_BLIND_SCLERA, COLOR_BLIND_IRIS);
    dropFow(sp, entry);
  };
  entry.applyNetUnblind = (s) => {
    const sp = s || sys;
    if (entry.corrupted || entry.blindT > 0) return;
    setEyeColors(entry, COLOR_SCLERA, irisRestHex(entry));
    restoreFow(sp, entry);
  };

  entry.beginDemonHold = () => {
    entry.demonHold = true;
  };

  entry.endDemonHold = () => {
    entry.demonHold = false;
  };

  entry.applyDemonCorrupt = () => {
    applyCorrupt(sys, entry);
  };
}

export function countWatchersForOwner(sys, ownerId) {
  const list = sys.watchers;
  if (!list?.length) return 0;
  const oid = String(ownerId);
  let n = 0;
  for (const w of list) {
    if (String(w.ownerId) === oid) n++;
  }
  return n;
}

export function canSpawnWatcher(sys, ownerId) {
  const max = SPELLS.watcher?.maxCount ?? 5;
  return countWatchersForOwner(sys, ownerId) < max;
}

/** AOE hitbox — stejný falloff jako zvířata. */
export function hurtWatchersNear(sys, centerDir, radiusM, dmgCenter, dmgEdge, opts = {}) {
  if (sys.worldRemote) return false;
  const list = sys.watchers;
  if (!list?.length || !centerDir || !(radiusM > 0)) return false;
  let hit = false;
  const hitSet = opts.hitSet;
  const hitKey = opts.hitKey ?? "watcher";
  for (const w of list) {
    if (!w || w.corrupted) continue;
    if (hitSet) {
      const key = `${hitKey}:${w.id}`;
      if (hitSet.has(key)) continue;
    }
    const dist = surfaceDist(centerDir, w.dir);
    if (dist >= radiusM) continue;
    const t = dist / radiusM;
    const dmg = dmgCenter + (dmgEdge - dmgCenter) * t;
    if (!(dmg > 0)) continue;
    w.takeDamage?.(dmg, { fromDir: centerDir, ...opts });
    if (hitSet) hitSet.add(`${hitKey}:${w.id}`);
    hit = true;
  }
  return hit;
}

export function spawnWatcher(sys, targetDir) {
  const def = SPELLS.watcher;
  const ownerId = sys._castOwnerId ?? sys.wizard?.id ?? null;
  if (ownerId == null) return null;
  if (!canSpawnWatcher(sys, ownerId)) return null;

  const owner = (sys.getWizards?.() || []).find((w) => w && String(w.id) === String(ownerId));
  const ownerColor = owner?.color ?? def.color ?? 0xe8e0d0;

  const dir = targetDir.clone().normalize();
  const id = `watcher-${ownerId}-${_nextId++}`;

  const group = new THREE.Group();
  group.frustumCulled = false;

  const vines = makeVines(ownerColor);
  group.add(vines);

  const headPivot = new THREE.Group();
  headPivot.position.y = STEM_H;
  group.add(headPivot);

  const calyx = makeCalyx();
  headPivot.add(calyx);

  const eye = makeEye(ownerColor);
  /** Sedí v otevřeném kalichu, jasně nad listy. */
  eye.position.y = 0.55;
  headPivot.add(eye);

  sys.planetGroup.add(group);

  const entry = {
    id,
    ownerId,
    irisBase: ownerIrisHex(ownerColor),
    dir,
    group,
    vines,
    headPivot,
    calyx,
    eye,
    t: 0,
    idleT: 0,
    phase: "rise",
    look: pickLookTarget(),
    lookCur: { x: 0, y: 0 },
    seenIds: new Set(),
    fowRegistered: false,
    fowSeen: false
  };
  bindWatcherCombat(sys, entry);

  if (!sys.watchers) sys.watchers = [];
  sys.watchers.push(entry);
  poseWatcher(sys, entry);

  if (isLocalOwner(sys, ownerId)) {
    sys.fow?.addSource?.(id, dir, def.radius ?? 35);
    entry.fowRegistered = true;
  }

  return entry;
}

function poseWatcher(sys, w) {
  const ht = sys.terrain.height(w.dir);
  _pos.copy(w.dir).multiplyScalar(ht);
  _quat.setFromUnitVectors(_yUp, w.dir);
  w.group.position.copy(_pos);
  w.group.quaternion.copy(_quat);
}

function disposeGroupMeshes(root) {
  if (!root) return;
  const geos = root.userData?.geos;
  const mats = root.userData?.mats;
  const textures = root.userData?.textures;
  if (geos) for (const g of geos) g.dispose?.();
  if (mats) for (const m of mats) m.dispose?.();
  if (textures) for (const t of textures) t.dispose?.();
  root.traverse((ch) => {
    if (!ch.isMesh) return;
    if (!geos) ch.geometry?.dispose?.();
  });
}

function disposeWatcher(sys, w) {
  if (w.fowRegistered) {
    sys.fow?.removeSource?.(w.id);
    w.fowRegistered = false;
  }
  if (w.alarmSfx) {
    sys.audio?.stopWatcherAlarm?.(w.alarmSfx, 0.15);
    w.alarmSfx = null;
  }
  clearWatcherArc(sys, w);
  disposeWatcherGhost(sys, w);
  if (w.group?.parent) w.group.parent.remove(w.group);
  disposeGroupMeshes(w.vines);
  disposeGroupMeshes(w.calyx);
  disposeGroupMeshes(w.eye);
}

export function disposeWatchersForOwner(sys, ownerId) {
  const list = sys.watchers;
  if (!list?.length) return;
  const oid = String(ownerId);
  for (let i = list.length - 1; i >= 0; i--) {
    if (String(list[i].ownerId) !== oid) continue;
    disposeWatcher(sys, list[i]);
    list.splice(i, 1);
  }
  if (sys.onWatcherAlarmClear && String(sys.wizard?.id) === oid) {
    sys.onWatcherAlarmClear();
  }
}

export function disposeWatchers(sys) {
  const list = sys.watchers;
  if (!list?.length) return;
  for (const w of list) disposeWatcher(sys, w);
  list.length = 0;
  sys.onWatcherAlarmClear?.();
}

function triggerAlarm(sys, tower) {
  /** Jen UI rámeček majitele — žádný alarm SFX. */
  if (isLocalOwner(sys, tower.ownerId)) {
    sys.onWatcherAlarm?.(tower.dir.clone());
  }
}

function scanEnemies(sys, tower) {
  if (tower.corrupted || tower.blindT > 0 || !tower.fowRegistered) return;
  if (!isLocalOwner(sys, tower.ownerId)) return;

  const local = (sys.getWizards?.() || []).find((w) => w && !w.remote);
  if (!local || local.dead) return;

  const radius = SPELLS.watcher?.radius ?? 35;
  const wizards = sys.getWizards?.() || [];
  const present = new Set();

  for (const w of wizards) {
    if (!w || w === local || w.dead) continue;
    if (surfaceDist(tower.dir, w.dir) > radius) continue;
    const wid = String(w.id);
    present.add(wid);
    if (!tower.seenIds.has(wid)) {
      tower.seenIds.add(wid);
      triggerAlarm(sys, tower);
    }
  }

  for (const id of [...tower.seenIds]) {
    if (!present.has(id)) tower.seenIds.delete(id);
  }
}

function tickBlind(sys, w, dt) {
  if (w.corrupted || !(w.blindT > 0)) return;
  w.blindT -= dt;
  if (w.blindT > 0) return;
  w.blindT = 0;
  setEyeColors(w, COLOR_SCLERA, irisRestHex(w));
  restoreFow(sys, w);
}

/** Nejbližší cizí wizard v dosahu FOV hlídače. */
function pickZapTarget(sys, tower) {
  if (tower.corrupted || tower.blindT > 0) return null;
  const radius = SPELLS.watcher?.radius ?? 35;
  const oid = String(tower.ownerId);
  let best = null;
  let bestD = Infinity;
  for (const w of sys.getWizards?.() || []) {
    if (!w || w.dead || w.godMode) continue;
    if (String(w.id) === oid) continue;
    if (w.invis) continue;
    const d = surfaceDist(tower.dir, w.dir);
    if (d > radius || d >= bestD) continue;
    bestD = d;
    best = w;
  }
  return best;
}

function clearWatcherArc(sys, w) {
  const arc = w.arc;
  if (!arc) return;
  if (arc.line?.parent) arc.line.parent.remove(arc.line);
  arc.geo?.dispose?.();
  arc.mat?.dispose?.();
  w.arc = null;
}

function ensureWatcherArc(sys, w) {
  if (w.arc) return w.arc;
  const mat = new THREE.LineBasicMaterial({
    color: 0xb8f0ff,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const positions = new Float32Array(ARC_POINTS * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.renderOrder = 7;
  sys.planetGroup.add(line);
  w.arc = { line, geo, mat, positions };
  return w.arc;
}

function slerpDir(a, b, t, out) {
  const dot = Math.min(1, Math.max(-1, a.dot(b)));
  const omega = Math.acos(dot);
  if (omega < 1e-5) return out.copy(a);
  const so = Math.sin(omega);
  return out
    .copy(a)
    .multiplyScalar(Math.sin((1 - t) * omega) / so)
    .addScaledVector(b, Math.sin(t * omega) / so);
}

/**
 * Přímá viditelnost oko→cíl: chord nesmí zajít pod terén
 * (schování za kopec = v bezpečí i v dosahu).
 */
function hasTerrainLos(terrain, fromPos, toPos) {
  if (!terrain?.height) return true;
  for (let i = 1; i < ARC_LOS_SAMPLES; i++) {
    const u = i / ARC_LOS_SAMPLES;
    _arcMid.copy(fromPos).lerp(toPos, u);
    const r = _arcMid.length();
    if (r < 1e-4) continue;
    _local.copy(_arcMid).multiplyScalar(1 / r);
    if (r < terrain.height(_local) + ARC_LOS_CLEAR) return false;
  }
  return true;
}

function watcherBeamEnds(sys, w, target) {
  w.eye.updateWorldMatrix(true, false);
  target.mesh.updateWorldMatrix(true, false);
  w.eye.getWorldPosition(_from);
  target.mesh.getWorldPosition(_to);
  _to.addScaledVector(target.dir, CONFIG.wizardHeightM * 0.55);
  sys.planetGroup.worldToLocal(_from);
  sys.planetGroup.worldToLocal(_to);
}

/**
 * Oblouk po geodéze nad povrchem (zahnutí planety) + lehký jitter.
 * @returns {boolean} false = terén blokuje
 */
function updateWatcherArc(sys, w, target) {
  watcherBeamEnds(sys, w, target);
  if (!hasTerrainLos(sys.terrain, _from, _to)) {
    clearWatcherArc(sys, w);
    return false;
  }

  const arc = ensureWatcherArc(sys, w);
  const fromLen = _from.length();
  const toLen = _to.length();
  if (fromLen < 1e-4 || toLen < 1e-4) {
    clearWatcherArc(sys, w);
    return false;
  }

  _arcAlong.copy(_from).multiplyScalar(1 / fromLen);
  _arcSide.copy(_to).multiplyScalar(1 / toLen);

  const pos = arc.positions;
  pos[0] = _from.x;
  pos[1] = _from.y;
  pos[2] = _from.z;
  const last = (ARC_POINTS - 1) * 3;
  pos[last] = _to.x;
  pos[last + 1] = _to.y;
  pos[last + 2] = _to.z;

  const t = w.idleT || 0;
  const surfDist = surfaceDist(_arcAlong, _arcSide);
  const jitter = Math.min(0.4, 0.08 + surfDist * 0.012);

  for (let i = 1; i < ARC_POINTS - 1; i++) {
    const u = i / (ARC_POINTS - 1);
    slerpDir(_arcAlong, _arcSide, u, _local);
    const ground = sys.terrain.height(_local);
    const airR = fromLen * (1 - u) + toLen * u;
    const lift = Math.max(0.18, airR - ground);
    /** Výška nad povrchem → oblouk kopíruje zakřivení planety. */
    const r = ground + lift;
    _arcSide2.crossVectors(_local, _yUp);
    if (_arcSide2.lengthSq() < 1e-8) _arcSide2.set(1, 0, 0);
    else _arcSide2.normalize();
    _arcMid.crossVectors(_arcSide2, _local).normalize();
    const wave =
      Math.sin(u * 11.3 + t * 28) * jitter * (0.35 + 0.65 * Math.sin(u * Math.PI)) +
      Math.sin(u * 23.1 - t * 41 + i) * jitter * 0.35;
    const wave2 = Math.cos(u * 17.7 + t * 33 + i * 0.7) * jitter * 0.45;
    _pos.copy(_local).multiplyScalar(r);
    _pos.addScaledVector(_arcSide2, wave);
    _pos.addScaledVector(_arcMid, wave2);
    const j = i * 3;
    pos[j] = _pos.x;
    pos[j + 1] = _pos.y;
    pos[j + 2] = _pos.z;
  }

  arc.geo.attributes.position.needsUpdate = true;
  arc.mat.opacity = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(t * 40));
  /** FOW nesmí nechat oblouk skrytý ze starého frame. */
  if (arc.line.userData._fowFxHidden) {
    delete arc.line.userData._fowFxHidden;
    delete arc.line.userData._fowFxWasVisible;
  }
  arc.line.visible = true;
  return true;
}

function lockLookAtTarget(w, target, dt) {
  w.eye.updateWorldMatrix(true, false);
  target.mesh.updateWorldMatrix(true, false);
  w.eye.getWorldPosition(_from);
  target.mesh.getWorldPosition(_to);
  _to.addScaledVector(target.dir, 0.7);
  _local.copy(_to).sub(_from);
  _invQ.copy(w.group.quaternion).invert();
  _local.applyQuaternion(_invQ);

  const yaw = Math.atan2(_local.x, _local.z);
  /** Plynulé otočení hlavy k cíli (bez idle spin). */
  let dy = yaw - w.headPivot.rotation.y;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  w.headPivot.rotation.y += dy * Math.min(1, dt * 10);

  const horiz = Math.hypot(_local.x, _local.z);
  const pitch = Math.atan2(_local.y, Math.max(1e-4, horiz));
  const wantX = Math.max(-EYE_LOOK_MAX, Math.min(EYE_LOOK_MAX, -pitch * 0.5));
  w.lookCur.x += (wantX - w.lookCur.x) * Math.min(1, dt * 14);
  w.lookCur.y += (0 - w.lookCur.y) * Math.min(1, dt * 14);
  w.eye.rotation.x = w.lookCur.x;
  w.eye.rotation.y = w.lookCur.y;
}

function updateIdleMotion(w, dt) {
  w.idleT += dt;
  /** Otáčení dokola kolem svislé osy. */
  w.headPivot.rotation.y += dt * HEAD_SPIN;

  const look = w.look;
  look.hold -= dt;
  const snap = 16;
  w.lookCur.x += (look.x - w.lookCur.x) * Math.min(1, dt * snap);
  w.lookCur.y += (look.y - w.lookCur.y) * Math.min(1, dt * snap);
  /** Těkání do stran (saccady) — lokálně na bulbu. */
  w.eye.rotation.x = w.lookCur.x;
  w.eye.rotation.y = w.lookCur.y;
  if (look.hold <= 0) w.look = pickLookTarget();
}

/** Fixace pohledu + oblouk + DPS na cizího wizarda v dosahu (s LOS). */
function updateWatchZap(sys, w, dt) {
  const target = pickZapTarget(sys, w);
  if (!target) {
    clearWatcherArc(sys, w);
    updateIdleMotion(w, dt);
    return;
  }

  watcherBeamEnds(sys, w, target);
  if (!hasTerrainLos(sys.terrain, _from, _to)) {
    clearWatcherArc(sys, w);
    updateIdleMotion(w, dt);
    return;
  }

  w.idleT += dt;
  lockLookAtTarget(w, target, dt);
  updateWatcherArc(sys, w, target);
  pulseWizardZapSparks(target);

  const dps = SPELLS.watcher?.arcDps ?? 3;
  if (dps > 0) {
    target.takeDamage?.(dps * dt, { fromDir: w.dir, knock: false });
  }
}

function ensureWizardZapSparks(wizard) {
  if (wizard._zapFx) return wizard._zapFx;
  if (!wizard.mesh) return null;
  const group = new THREE.Group();
  group.position.set(0, 0.95, 0);
  group.frustumCulled = false;
  const sparks = [];
  for (let i = 0; i < ZAP_SPARKS; i++) {
    const mat = new THREE.LineBasicMaterial({
      color: i % 3 === 0 ? 0xffffff : i % 3 === 1 ? 0xb8f0ff : 0xffe8a8,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const positions = new Float32Array(6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.renderOrder = 8;
    group.add(line);
    sparks.push({ geo, mat, positions, line });
  }
  wizard.mesh.add(group);
  wizard._zapFx = { group, sparks, t: 0 };
  return wizard._zapFx;
}

function pulseWizardZapSparks(wizard) {
  if (!wizard) return;
  wizard._zapPulse = ZAP_PULSE;
}

function clearWizardZapSparks(wizard, sys = null) {
  const fx = wizard?._zapFx;
  if (fx) {
    if (fx.group.parent) fx.group.parent.remove(fx.group);
    for (const s of fx.sparks) {
      s.geo.dispose();
      s.mat.dispose();
    }
    wizard._zapFx = null;
  }
  if (wizard?._zapSfx) {
    (sys?.audio || wizard._zapAudio)?.stopSfxLoop?.(wizard._zapSfx, 0.12);
    wizard._zapSfx = null;
    wizard._zapAudio = null;
  }
  if (wizard) wizard._zapPulse = 0;
}

/** Sršení po těle wizarda, dokud ho oblouk zasahuje. */
function tickWizardZapSparks(sys, dt) {
  const listener = sys.getListenerDir?.();
  for (const wizard of sys.getWizards?.() || []) {
    if (!wizard) continue;
    if (!(wizard._zapPulse > 0)) {
      if (wizard._zapFx || wizard._zapSfx) clearWizardZapSparks(wizard, sys);
      continue;
    }
    wizard._zapPulse -= dt;
    const fx = ensureWizardZapSparks(wizard);
    if (fx) {
      fx.t += dt;
      const burst = 0.55 + 0.45 * Math.sin(fx.t * 55);
      for (let i = 0; i < fx.sparks.length; i++) {
        const s = fx.sparks[i];
        /** Nový výboj každý frame — sršení / crackle. */
        const az = Math.random() * Math.PI * 2;
        const el = (Math.random() - 0.5) * 1.4;
        const cosE = Math.cos(el);
        const dx = Math.cos(az) * cosE;
        const dy = Math.sin(el);
        const dz = Math.sin(az) * cosE;
        const r0 = 0.12 + Math.random() * 0.42;
        const len = 0.12 + Math.random() * 0.5;
        const fork = Math.random() < 0.35;
        const p = s.positions;
        p[0] = dx * r0;
        p[1] = dy * r0 * 0.85;
        p[2] = dz * r0;
        if (fork) {
          const az2 = az + (Math.random() - 0.5) * 1.2;
          p[3] = Math.cos(az2) * cosE * (r0 + len * 0.7);
          p[4] = dy * (r0 + len) * 0.7 + (Math.random() - 0.5) * 0.2;
          p[5] = Math.sin(az2) * cosE * (r0 + len * 0.7);
        } else {
          p[3] = dx * (r0 + len);
          p[4] = dy * (r0 + len);
          p[5] = dz * (r0 + len);
        }
        s.geo.attributes.position.needsUpdate = true;
        s.mat.opacity = (0.35 + Math.random() * 0.65) * burst;
        s.line.visible = Math.random() > 0.12;
      }
    }

    if (sys.audio && listener && wizard.dir) {
      if (!wizard._zapSfx?.alive) {
        wizard._zapSfx = sys.audio.startSfxLoop("electricity", wizard.dir, listener, {
          volume: 0.85
        });
        wizard._zapAudio = sys.audio;
      } else {
        sys.audio.updateSfxLoop(wizard._zapSfx, wizard.dir, listener);
      }
    }

    if (wizard._zapPulse <= 0) clearWizardZapSparks(wizard, sys);
  }
}

export function updateWatchers(sys, dt) {
  const list = sys.watchers;
  if (!list?.length) {
    tickWizardZapSparks(sys, dt);
    return;
  }

  const wizards = sys.getWizards?.() || [];
  const deadOwners = new Set();
  for (const wiz of wizards) {
    if (wiz?.dead) deadOwners.add(String(wiz.id));
  }

  for (let i = list.length - 1; i >= 0; i--) {
    const w = list[i];
    if (deadOwners.has(String(w.ownerId))) {
      disposeWatcher(sys, w);
      list.splice(i, 1);
      continue;
    }

    const owner = wizards.find((wiz) => wiz && String(wiz.id) === String(w.ownerId));
    if (owner) syncWatcherOwnerColor(w, owner.color);

    w.t += dt;
    poseWatcher(sys, w);
    if (!sys.worldRemote) tickBlind(sys, w, dt);
    if (w.fowRegistered && !isLocalOwner(sys, w.ownerId)) dropFow(sys, w);

    if (w.phase === "rise") {
      const u = Math.min(1, w.t / VINE_RISE);
      const ease = 1 - (1 - u) ** 3;
      w.vines.scale.set(1, Math.max(0.001, ease), 1);
      w.calyx.scale.setScalar(0.001);
      w.eye.scale.setScalar(0.001);
      if (u >= 1) {
        w.phase = "calyx";
        w.t = 0;
      }
    } else if (w.phase === "calyx") {
      w.vines.scale.set(1, 1, 1);
      const u = Math.min(1, w.t / CALYX_GROW);
      const ease = 1 - (1 - u) ** 3;
      w.calyx.scale.setScalar(Math.max(0.001, ease));
      w.eye.scale.setScalar(0.001);
      if (u >= 1) {
        w.phase = "eye";
        w.t = 0;
      }
    } else if (w.phase === "eye") {
      w.vines.scale.set(1, 1, 1);
      w.calyx.scale.setScalar(1);
      const u = Math.min(1, w.t / EYE_GROW);
      const ease = 1 - (1 - u) ** 3;
      w.eye.scale.setScalar(Math.max(0.001, ease * EYE_R));
      if (u >= 1) {
        w.phase = "idle";
        w.t = 0;
        w.idleT = 0;
        w.look = pickLookTarget();
      }
    } else {
      w.vines.scale.set(1, 1, 1);
      w.calyx.scale.setScalar(1);
      w.eye.scale.setScalar(EYE_R);
      updateWatchZap(sys, w, dt);
      scanEnemies(sys, w);
    }
  }

  tickWizardZapSparks(sys, dt);
}
