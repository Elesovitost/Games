import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { tangentFrame, tmp, surfaceOffsetDir } from "../utils.js";
import { SPELLS } from "./defs.js";
import { surfaceDist } from "./fx-common.js";
import { isWaterAt } from "./water-fx.js";

const LIFT = 0.06;
const TRUNK_COUNT = 10;
/** Jak rychle vlna dojde od středu k okraji zóny (s). */
const GROW_TIME = 0.55;
const CRACK_COLOR = 0x1a100c;
const ORDER_OPACITY = { 1: 0.94, 2: 0.86, 3: 0.72 };

function placeOnSurface(terrain, dir, out) {
  const h = terrain.height(dir) + LIFT;
  return out.copy(dir).multiplyScalar(h);
}

/**
 * Prasklina po povrchu — jen po souši (pod vodou se přeruší).
 * `dists[i]` = vzdálenost bodu od epicentra, kvůli vlně růstu.
 */
function buildCrackSegments(terrain, center, east, north, startAng, startDist, maxDist, abortChance) {
  const segments = [];
  let pts = [];
  let dists = [];
  let ang = startAng;
  let dist = startDist;
  const dir = new THREE.Vector3();
  const pos = new THREE.Vector3();

  while (dist < maxDist) {
    surfaceOffsetDir(center, east, north, ang, dist, dir);
    const wet = terrain.height(dir) < CONFIG.waterLevel + 0.06;
    if (wet) {
      if (pts.length >= 2) segments.push({ pts, dists });
      pts = [];
      dists = [];
    } else {
      placeOnSurface(terrain, dir, pos);
      pts.push(pos.clone());
      dists.push(dist);
    }
    ang += (Math.random() - 0.5) * 0.5;
    dist += 0.55 + Math.random() * 0.7;
    if (abortChance > 0 && Math.random() < abortChance) break;
  }
  if (pts.length >= 2) segments.push({ pts, dists });
  return segments;
}

function makeCrackMesh(pts, dists, opts = {}) {
  if (pts.length < 2) return null;
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const rest = new Float32Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) {
    rest[i * 3] = pts[i].x;
    rest[i * 3 + 1] = pts[i].y;
    rest[i * 3 + 2] = pts[i].z;
  }
  geo.userData.rest = rest;
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({
    color: opts.color ?? CRACK_COLOR,
    transparent: true,
    opacity: opts.opacity ?? 0.92,
    depthWrite: false
  });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.renderOrder = 3;
  line.visible = false;
  line.userData.baseOpacity = opts.opacity ?? 0.92;
  line.userData.isRing = !!opts.isRing;
  line.userData.dists = dists;
  return line;
}

function addCrack(group, lines, pts, dists, opts) {
  const line = makeCrackMesh(pts, dists, opts);
  if (!line) return;
  group.add(line);
  lines.push(line);
}

/**
 * Strom trhlin: kmen (1) → větve (2) → větvičky (3).
 * Růst se později odvíjí od `dists` — čím dál od epicentra, tím později.
 */
function growCrack(
  sys, group, lines, center, east, north,
  ang, startDist, maxDist, order, zoneRadius
) {
  const abort = order === 1 ? 0 : order === 2 ? 0.04 : 0.08;
  const segments = buildCrackSegments(
    sys.terrain, center, east, north, ang, startDist, maxDist, abort
  );
  for (const seg of segments) {
    addCrack(group, lines, seg.pts, seg.dists, {
      color: CRACK_COLOR,
      opacity: ORDER_OPACITY[order] ?? ORDER_OPACITY[3]
    });
  }
  if (order >= 3) return;

  const longest = segments.reduce((a, b) => (a.pts.length >= b.pts.length ? a : b), { pts: [] });
  if (longest.pts.length < 5) return;

  const branches = order === 1 ? 1 + (Math.random() < 0.75 ? 1 : 0) : (Math.random() < 0.65 ? 1 : 0);
  for (let b = 0; b < branches; b++) {
    const idx = 2 + Math.floor(Math.random() * (longest.pts.length - 4));
    const from = longest.dists[idx];
    const remain = zoneRadius - from;
    if (remain < 2.2) continue;
    const side = Math.random() < 0.5 ? 1 : -1;
    const branchAng = ang + side * (0.38 + Math.random() * 0.55);
    const branchMax = from + remain * (0.55 + Math.random() * 0.42);
    growCrack(
      sys, group, lines, center, east, north,
      branchAng, from, Math.min(zoneRadius, branchMax), order + 1, zoneRadius
    );
  }
}

function spawnCrackVisuals(sys, centerDir, radiusM) {
  const center = centerDir.clone().normalize();
  tangentFrame(center, tmp.east, tmp.north);
  const group = new THREE.Group();
  group.frustumCulled = false;
  const lines = [];

  for (let i = 0; i < TRUNK_COUNT; i++) {
    const ang = (i / TRUNK_COUNT) * Math.PI * 2 + Math.random() * 0.32;
    const maxD = radiusM * (0.88 + Math.random() * 0.12);
    growCrack(
      sys, group, lines, center, tmp.east, tmp.north,
      ang, 0.25 + Math.random() * 0.35, maxD, 1, radiusM
    );
  }

  const ringSegs = [];
  let ringPts = [];
  let ringDists = [];
  const rdir = new THREE.Vector3();
  const rpos = new THREE.Vector3();
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    surfaceOffsetDir(center, tmp.east, tmp.north, a, radiusM, rdir);
    if (sys.terrain.height(rdir) < CONFIG.waterLevel + 0.06) {
      if (ringPts.length >= 2) ringSegs.push({ pts: ringPts, dists: ringDists });
      ringPts = [];
      ringDists = [];
    } else {
      placeOnSurface(sys.terrain, rdir, rpos);
      ringPts.push(rpos.clone());
      ringDists.push(radiusM);
    }
  }
  if (ringPts.length >= 2) ringSegs.push({ pts: ringPts, dists: ringDists });
  for (const seg of ringSegs) {
    addCrack(group, lines, seg.pts, seg.dists, {
      color: 0x8a6a40,
      opacity: 0.35,
      isRing: true
    });
  }

  sys.planetGroup.add(group);
  return { group, lines };
}

/** Odhalí čárky podle vzdálenosti od epicentra — vlna zevnitř ven. */
function revealCracks(quake) {
  const radius = quake.radius;
  const front = Math.min(radius, (quake.elapsed / GROW_TIME) * radius);
  quake.front = front;

  for (const line of quake.lines) {
    const dists = line.userData.dists;
    if (!dists) continue;
    if (line.userData.isRing) {
      const show = front >= radius * 0.92;
      line.visible = show;
      line.geometry.setDrawRange(0, show ? dists.length : 0);
      continue;
    }
    let n = 0;
    for (let i = 0; i < dists.length; i++) {
      if (dists[i] <= front) n = i + 1;
      else break;
    }
    line.geometry.setDrawRange(0, n);
    line.visible = n >= 2;
  }
}

function shakeCracks(quake, t) {
  const amp = 0.035 + 0.045 * Math.min(1, quake.life / Math.max(1e-5, quake.duration));
  const shake = amp * (0.5 + 0.5 * Math.abs(Math.sin(t * 22)));
  tangentFrame(quake.centerDir, tmp.east, tmp.north);

  for (const line of quake.lines) {
    if (!line.visible) continue;
    const rest = line.geometry.userData.rest;
    if (!rest) continue;
    const pos = line.geometry.attributes.position;
    const n = line.geometry.drawRange.count || pos.count;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      const phase = t * 18 + i * 0.7 + (quake.seed || 0);
      const ox = Math.sin(phase) * shake;
      const oy = Math.cos(phase * 1.3) * shake;
      pos.setXYZ(
        i,
        rest[j] + tmp.east.x * ox + tmp.north.x * oy,
        rest[j + 1] + tmp.east.y * ox + tmp.north.y * oy,
        rest[j + 2] + tmp.east.z * ox + tmp.north.z * oy
      );
    }
    pos.needsUpdate = true;
  }
}

function restoreCrackRest(quake) {
  for (const line of quake.lines) {
    const rest = line.geometry.userData.rest;
    if (!rest) continue;
    const pos = line.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const j = i * 3;
      pos.setXYZ(i, rest[j], rest[j + 1], rest[j + 2]);
    }
    pos.needsUpdate = true;
    line.geometry.setDrawRange(0, pos.count);
    line.visible = pos.count >= 2;
  }
}

function triggerQuakeFall(w, centerDir) {
  const def = SPELLS.earthquake;
  const dmg = def.fallDamage;
  w.takeDamage(dmg, { fromDir: centerDir, knock: false });
  if (!w.dead && !w.godMode) {
    w.applyKnockdown(dmg, centerDir, {
      awayFrom: centerDir,
      rotations: def.fallRotations ?? 1,
      rollDistance: def.fallDistance ?? 3
    });
  }
}

function victimKey(w) {
  return String(w.id ?? "local");
}

function updateVictims(sys, quake) {
  const def = SPELLS.earthquake;
  const radius = quake.front ?? 0;
  const list = sys.getWizards?.() || (sys.wizard ? [sys.wizard] : []);
  const now = quake.elapsed;
  const active = new Set();

  for (const w of list) {
    if (!w || w.dead || w.remote || w.godMode) continue;
    if (isWaterAt(sys, w.dir)) {
      quake.victims.delete(victimKey(w));
      continue;
    }
    const dist = surfaceDist(quake.centerDir, w.dir);
    if (dist > radius) {
      quake.victims.delete(victimKey(w));
      continue;
    }
    active.add(victimKey(w));
    let st = quake.victims.get(victimKey(w));
    if (!st) {
      st = { wasDown: false, graceUntil: -1 };
      quake.victims.set(victimKey(w), st);
    }

    if (w.knockdown || w.tornado) {
      st.wasDown = !!w.knockdown;
      continue;
    }

    if (st.wasDown) {
      st.wasDown = false;
      st.graceUntil = now + def.walkGrace;
      continue;
    }

    if (now < st.graceUntil) continue;

    triggerQuakeFall(w, quake.centerDir);
    st.wasDown = true;
  }

  for (const key of [...quake.victims.keys()]) {
    if (!active.has(key)) quake.victims.delete(key);
  }
}

export function spawnEarthquake(sys, targetDir) {
  const def = SPELLS.earthquake;
  const centerDir = targetDir.clone().normalize();
  const radius = def.effectRadius;
  const { group, lines } = spawnCrackVisuals(sys, centerDir, radius);

  const listener = sys.getListenerDir?.();
  const sfx =
    listener && sys.audio
      ? sys.audio.startSfxLoop("earthquake", centerDir, listener)
      : null;

  if (!sys.earthquakes) sys.earthquakes = [];
  sys.earthquakes.push({
    centerDir,
    group,
    lines,
    radius,
    front: 0,
    t: 0,
    elapsed: 0,
    life: def.duration,
    duration: def.duration,
    shaking: true,
    victims: new Map(),
    seed: Math.random() * 100,
    sfx
  });
}

export function updateEarthquakes(sys, dt) {
  if (!sys.earthquakes?.length) return;
  const listener = sys.getListenerDir?.();
  for (const q of sys.earthquakes) {
    if (!q.shaking) continue;

    q.t += dt;
    q.elapsed += dt;
    q.life -= dt;

    if (q.sfx?.alive && listener) {
      sys.audio?.updateSfxLoop(q.sfx, q.centerDir, listener);
    }

    revealCracks(q);
    shakeCracks(q, q.t);
    if (q.life > 0) updateVictims(sys, q);

    if (q.life <= 0) {
      q.shaking = false;
      sys.audio?.stopSfxLoop(q.sfx);
      q.sfx = null;
      q.victims.clear();
      restoreCrackRest(q);
      for (const line of q.lines) {
        if (!line.userData.isRing) continue;
        q.group.remove(line);
        line.geometry.dispose();
        line.material.dispose();
      }
      q.lines = q.lines.filter((l) => !l.userData.isRing);
      for (const line of q.lines) {
        /** Po otřesu zůstanou stopy — každá čárka jinak 10–50 % průhledná. */
        line.material.opacity = 0.5 + Math.random() * 0.4;
      }
    }
  }
}

function disposeOneEarthquake(sys, q) {
  sys.audio?.stopSfxLoop(q.sfx, 0.05);
  q.sfx = null;
  if (q.group) {
    sys.planetGroup.remove(q.group);
    for (const line of q.lines || []) {
      line.geometry.dispose();
      line.material.dispose();
    }
  }
  q.victims?.clear();
}

export function disposeEarthquakes(sys) {
  if (!sys.earthquakes) return;
  for (const q of sys.earthquakes) disposeOneEarthquake(sys, q);
  sys.earthquakes.length = 0;
}
