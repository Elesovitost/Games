import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { tangentFrame, tmp, surfaceOffsetDir } from "../utils.js";
import { SPELLS } from "./defs.js";
import { surfaceDist } from "./fx-common.js";
import { isWaterAt } from "./water-fx.js";

const LIFT = 0.06;
const CRACK_COUNT = 14;
const BRANCH_CHANCE = 0.45;

function placeOnSurface(terrain, dir, out) {
  const h = terrain.height(dir) + LIFT;
  return out.copy(dir).multiplyScalar(h);
}

/**
 * Prasklina po povrchu — jen po souši (pod vodou se přeruší).
 * @returns {THREE.Vector3[][]}
 */
function buildCrackSegments(terrain, center, east, north, startAng, startDist, maxDist) {
  const segments = [];
  let pts = [];
  let ang = startAng;
  let dist = startDist;
  const dir = new THREE.Vector3();
  const pos = new THREE.Vector3();

  while (dist < maxDist) {
    surfaceOffsetDir(center, east, north, ang, dist, dir);
    const wet = terrain.height(dir) < CONFIG.waterLevel + 0.06;
    if (wet) {
      if (pts.length >= 2) segments.push(pts);
      pts = [];
    } else {
      placeOnSurface(terrain, dir, pos);
      pts.push(pos.clone());
    }
    ang += (Math.random() - 0.5) * 0.55;
    dist += 0.7 + Math.random() * 1.1;
    if (Math.random() < 0.08) break;
  }
  if (pts.length >= 2) segments.push(pts);
  return segments;
}

function makeCrackMesh(pts, opts = {}) {
  if (pts.length < 2) return null;
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const rest = new Float32Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) {
    rest[i * 3] = pts[i].x;
    rest[i * 3 + 1] = pts[i].y;
    rest[i * 3 + 2] = pts[i].z;
  }
  geo.userData.rest = rest;
  const mat = new THREE.LineBasicMaterial({
    color: opts.color ?? 0x1a100c,
    transparent: true,
    opacity: opts.opacity ?? 0.92,
    depthWrite: false
  });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.renderOrder = 3;
  line.userData.baseOpacity = opts.opacity ?? 0.92;
  line.userData.isRing = !!opts.isRing;
  return line;
}

function addCrackSegments(group, lines, segments, opts) {
  for (const pts of segments) {
    const line = makeCrackMesh(pts, opts);
    if (line) {
      group.add(line);
      lines.push(line);
    }
  }
}

function spawnCrackVisuals(sys, centerDir, radiusM) {
  const center = centerDir.clone().normalize();
  tangentFrame(center, tmp.east, tmp.north);
  const group = new THREE.Group();
  group.frustumCulled = false;
  const lines = [];

  for (let i = 0; i < CRACK_COUNT; i++) {
    const ang = (i / CRACK_COUNT) * Math.PI * 2 + Math.random() * 0.35;
    const maxD = radiusM * (0.55 + Math.random() * 0.45);
    const segs = buildCrackSegments(
      sys.terrain,
      center,
      tmp.east,
      tmp.north,
      ang,
      0.4 + Math.random(),
      maxD
    );
    addCrackSegments(group, lines, segs);

    if (Math.random() < BRANCH_CHANCE && segs.length) {
      const longest = segs.reduce((a, b) => (a.length >= b.length ? a : b));
      if (longest.length > 4) {
        const branchAng = ang + (Math.random() < 0.5 ? 0.7 : -0.7);
        const branchStart = 2 + Math.random() * 6;
        const bsegs = buildCrackSegments(
          sys.terrain,
          center,
          tmp.east,
          tmp.north,
          branchAng,
          branchStart,
          Math.min(radiusM, branchStart + 4 + Math.random() * 6)
        );
        addCrackSegments(group, lines, bsegs);
      }
    }
  }

  // Prstenec zóny — jen na souši (přerušovaný)
  const ringSegs = [];
  let ringPts = [];
  const rdir = new THREE.Vector3();
  const rpos = new THREE.Vector3();
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    surfaceOffsetDir(center, tmp.east, tmp.north, a, radiusM, rdir);
    if (sys.terrain.height(rdir) < CONFIG.waterLevel + 0.06) {
      if (ringPts.length >= 2) ringSegs.push(ringPts);
      ringPts = [];
    } else {
      placeOnSurface(sys.terrain, rdir, rpos);
      ringPts.push(rpos.clone());
    }
  }
  if (ringPts.length >= 2) ringSegs.push(ringPts);
  addCrackSegments(group, lines, ringSegs, {
    color: 0x8a6a40,
    opacity: 0.35,
    isRing: true
  });

  sys.planetGroup.add(group);
  return { group, lines };
}

function shakeCracks(quake, t) {
  const amp = 0.08 + 0.12 * Math.min(1, quake.life / Math.max(1e-5, quake.duration));
  const shake = amp * (0.55 + 0.45 * Math.abs(Math.sin(t * 28)));
  tangentFrame(quake.centerDir, tmp.east, tmp.north);

  for (const line of quake.lines) {
    const rest = line.geometry.userData.rest;
    if (!rest) continue;
    const pos = line.geometry.attributes.position;
    const n = pos.count;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      const phase = t * 22 + i * 0.7 + (quake.seed || 0);
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
  const radius = def.effectRadius;
  const list = sys.getWizards?.() || (sys.wizard ? [sys.wizard] : []);
  const now = quake.elapsed;
  const active = new Set();

  for (const w of list) {
    if (!w || w.dead || w.remote || w.godMode) continue;
    // Ve vodě zemětřesení neházé
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
  const { group, lines } = spawnCrackVisuals(sys, centerDir, def.effectRadius);

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

    shakeCracks(q, q.t);
    if (q.life > 0) updateVictims(sys, q);

    if (q.life <= 0) {
      q.shaking = false;
      sys.audio?.stopSfxLoop(q.sfx);
      q.sfx = null;
      q.victims.clear();
      restoreCrackRest(q);
      // Prstenec zóny zmizí, praskliny zůstanou
      for (const line of q.lines) {
        if (!line.userData.isRing) continue;
        q.group.remove(line);
        line.geometry.dispose();
        line.material.dispose();
      }
      q.lines = q.lines.filter((l) => !l.userData.isRing);
      for (const line of q.lines) {
        line.material.opacity = line.userData.baseOpacity ?? 0.92;
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
