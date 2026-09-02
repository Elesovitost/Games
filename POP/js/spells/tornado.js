import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { SPELLS } from "./defs.js";
import { surfaceDist } from "./fx-common.js";
import { isWaterAt } from "./water-fx.js";
import { tangentFrame, tmp } from "../utils.js";

export function dirSeed(d) {
  const x = Math.sin(d.x * 12.9898 + d.y * 78.233 + d.z * 37.719) * 43758.5453;
  return x - Math.floor(x);
}

function makeRng(seed) {
  let s = (seed * 1e6) | 0 || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const TURNS = 20;
const HEIGHT = 9.2;
const TOP_HEIGHT = HEIGHT * 0.96;
const R_BOTTOM = 0.15;
const R_TOP = 3.85;
const RINGS = 44;
const SEGS = 16;
const SPIRAL_STEPS = TURNS * 14;
const MAIN_SPIRALS = 4;
const BLUR_SPIRALS = 3;
const FADE_DUR = 1.15;
const DUST_COLORS = [0x8a7a62, 0x9a8870, 0x756656, 0xa09078, 0x6a5c4e, 0xb0a090];

function surfaceAt(terrain, dir) {
  const th = terrain.height(dir);
  return th < CONFIG.waterLevel + 0.06 ? CONFIG.waterLevel : th;
}

/** Skutečný terén — kouzelník padá sem i pod vodou. */
function terrainFloor(terrain, dir) {
  return terrain.height(dir);
}

function radiusAt(u) {
  return R_BOTTOM + (R_TOP - R_BOTTOM) * Math.pow(u, 1.5);
}

function spawnDust(sys, pos, vel, opts = {}) {
  if (!sys.smokePuffs) sys.smokePuffs = [];
  const mat = new THREE.MeshBasicMaterial({
    color: opts.color ?? DUST_COLORS[(Math.random() * DUST_COLORS.length) | 0],
    transparent: true,
    opacity: opts.opacity ?? 0.35 + Math.random() * 0.25,
    depthWrite: false
  });
  const s = opts.size ?? 0.06 + Math.random() * 0.14;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(s, 5, 4), mat);
  mesh.position.copy(pos);
  sys.planetGroup.add(mesh);
  sys.smokePuffs.push({
    mesh,
    mat,
    vel: vel.clone(),
    t: 0,
    life: opts.life ?? 0.45 + Math.random() * 0.55,
    grow: opts.grow ?? 0.35 + Math.random() * 0.2
  });
}

function funnelWobble(u, pathT, seed, strand = 0) {
  const w = u * u;
  return {
    rMul:
      1 +
      w *
        (0.1 * Math.sin(u * 24.1 + pathT * 1.4 + seed * 11 + strand) +
          0.06 * Math.sin(u * 41.3 - pathT * 0.7 + seed * 5)),
    angOff:
      w *
      (0.28 * Math.sin(u * 17.5 + pathT * 0.85 + seed * 7 + strand * 0.6) +
        0.14 * Math.sin(u * 33.2 + seed * 3)),
    yOff: w * 0.09 * Math.sin(u * 29.7 + pathT * 1.1 + seed * 2.3)
  };
}

function bendOffset(u, pathT, bendPhase, seed = 0) {
  const bend = u * u * (0.4 + 0.6 * u);
  const bx =
    Math.sin(pathT * 1.05 + u * 2.4 + bendPhase) * 1.08 * bend +
    0.24 * bend * Math.sin(u * 8.7 + pathT * 0.55 + seed * 4.1);
  const bz =
    Math.cos(pathT * 0.82 + u * 1.85 + bendPhase * 0.65) * 0.95 * bend +
    0.2 * bend * Math.cos(u * 7.3 - pathT * 0.48 + seed * 2.7);
  return { bx, bz };
}

function buildTornadoVisual(seed) {
  const g = new THREE.Group();
  const ringVerts = (RINGS + 1) * (SEGS + 1);
  const positions = new Float32Array(ringVerts * 3);
  const indices = [];
  for (let r = 0; r < RINGS; r++) {
    for (let s = 0; s < SEGS; s++) {
      const a = r * (SEGS + 1) + s;
      indices.push(a, a + (SEGS + 1), a + 1, a + 1, a + (SEGS + 1), a + 2);
    }
  }

  const shellMat = new THREE.MeshStandardMaterial({
    color: 0x9a9488,
    emissive: 0x3a3835,
    emissiveIntensity: 0.08,
    transparent: true,
    opacity: 0.2,
    roughness: 0.95,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const shellGeo = new THREE.BufferGeometry();
  shellGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  shellGeo.setIndex(indices);
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.renderOrder = 2;
  g.add(shell);

  const spiralCount = MAIN_SPIRALS + BLUR_SPIRALS;
  const spiralPosArrays = [];
  const spiralGeos = [];
  const spiralMats = [];
  for (let sp = 0; sp < spiralCount; sp++) {
    const arr = new Float32Array((SPIRAL_STEPS + 1) * 3);
    spiralPosArrays.push(arr);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const blur = sp >= MAIN_SPIRALS;
    const mat = new THREE.LineBasicMaterial({
      color: blur ? 0xa8b0b8 : sp === 0 ? 0xd8e4ec : 0x98a4ae,
      transparent: true,
      opacity: blur ? 0.1 + (sp - MAIN_SPIRALS) * 0.04 : 0.42 - sp * 0.07,
      depthWrite: false
    });
    const line = new THREE.Line(geo, mat);
    line.renderOrder = blur ? 3 : 4;
    g.add(line);
    spiralGeos.push(geo);
    spiralMats.push(mat);
  }

  const baseMat = new THREE.MeshBasicMaterial({
    color: 0x9a8a72,
    transparent: true,
    opacity: 0.35,
    depthWrite: false
  });
  const base = new THREE.Mesh(new THREE.RingGeometry(R_BOTTOM * 0.5, R_BOTTOM * 2.4, 20), baseMat);
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.02;
  g.add(base);

  return {
    group: g,
    shellGeo,
    positions,
    spiralPosArrays,
    spiralGeos,
    shellMat,
    spiralMats,
    baseMat,
    spiralCount,
    mainSpiralCount: MAIN_SPIRALS,
    seed,
    bendPhase: seed * Math.PI * 2
  };
}

function fillFunnel(positions, pathT, spiralPhase, bendPhase, seed) {
  let vi = 0;
  for (let r = 0; r <= RINGS; r++) {
    const u = r / RINGS;
    const yBase = u * HEIGHT;
    const radBase = radiusAt(u);
    const twist = u * TURNS * Math.PI * 2 + spiralPhase;
    const { bx, bz } = bendOffset(u, pathT, bendPhase, seed);
    const ringWob = funnelWobble(u, pathT, seed, r * 0.07);
    for (let s = 0; s <= SEGS; s++) {
      const ang = (s / SEGS) * Math.PI * 2 + twist + ringWob.angOff;
      const rad = radBase * ringWob.rMul * (1 + 0.04 * Math.sin(s * 2.3 + u * 18 + seed));
      positions[vi++] = Math.cos(ang) * rad + bx;
      positions[vi++] = yBase + ringWob.yOff;
      positions[vi++] = Math.sin(ang) * rad + bz;
    }
  }
}

function fillSpiral(arr, pathT, spiralPhase, bendPhase, strand, seed) {
  const blur = strand >= MAIN_SPIRALS;
  const mainStrand = strand % MAIN_SPIRALS;
  const strandOff = (mainStrand / MAIN_SPIRALS) * Math.PI * 2;
  const phaseOff = blur ? (strand - MAIN_SPIRALS) * 0.13 - 0.13 : 0;
  const radScale = blur ? 1.05 + (strand - MAIN_SPIRALS) * 0.035 : 1;
  let vi = 0;
  for (let i = 0; i <= SPIRAL_STEPS; i++) {
    const u = i / SPIRAL_STEPS;
    const wob = funnelWobble(u, pathT, seed, strand);
    const y = u * HEIGHT + wob.yOff;
    const rad = radiusAt(u) * (0.92 - mainStrand * 0.06) * wob.rMul * radScale;
    const ang = u * TURNS * Math.PI * 2 + spiralPhase + strandOff + phaseOff + wob.angOff;
    const { bx, bz } = bendOffset(u, pathT, bendPhase, seed);
    arr[vi++] = Math.cos(ang) * rad + bx;
    arr[vi++] = y;
    arr[vi++] = Math.sin(ang) * rad + bz;
  }
}

function updateVisual(visual, pathT, spiralPhase) {
  fillFunnel(visual.positions, pathT, spiralPhase, visual.bendPhase, visual.seed);
  visual.shellGeo.attributes.position.needsUpdate = true;
  visual.shellGeo.computeVertexNormals();
  for (let sp = 0; sp < visual.spiralCount; sp++) {
    fillSpiral(visual.spiralPosArrays[sp], pathT, spiralPhase, visual.bendPhase, sp, visual.seed);
    visual.spiralGeos[sp].attributes.position.needsUpdate = true;
  }
}

function placeOnSurface(group, dir, terrain, lift = 0.02) {
  const h = surfaceAt(terrain, dir);
  group.position.copy(dir).multiplyScalar(h + lift);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
}

/** Stejné ukotvení jako CastSpiral — střed spirálky při kouzlení. */
function placeAtSpiral(group, dir, terrain) {
  const h = terrain.height(dir);
  group.position.copy(dir).multiplyScalar(h + 0.08);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
}

function spawnGroundDust(sys, t) {
  tangentFrame(t.dir, tmp.east, tmp.north);
  const up = t.dir;
  const base = t.group.position;
  const count = 3 + ((Math.random() * 3) | 0);

  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2 + t.spiralPhase * 0.15;
    const r = R_BOTTOM * 0.5 + Math.random() * 2.4;
    const lift = 0.04 + Math.random() * 1.6;
    const pos = base
      .clone()
      .addScaledVector(tmp.east, Math.cos(ang) * r)
      .addScaledVector(tmp.north, Math.sin(ang) * r)
      .addScaledVector(up, lift);
    const spin = 2.5 + Math.random() * 4;
    const vel = tmp.east
      .clone()
      .multiplyScalar(Math.cos(ang + Math.PI * 0.5) * spin + (Math.random() - 0.5) * 2)
      .addScaledVector(tmp.north, Math.sin(ang + Math.PI * 0.5) * spin + (Math.random() - 0.5) * 2)
      .addScaledVector(up, 1.4 + Math.random() * 3.2);
    spawnDust(sys, pos, vel, {
      size: 0.08 + Math.random() * 0.18,
      opacity: 0.28 + Math.random() * 0.22,
      life: 0.55 + Math.random() * 0.65
    });
  }
}

function spawnWaterMist(sys, t) {
  if (!sys.waterSpray) sys.waterSpray = [];
  tangentFrame(t.dir, tmp.east, tmp.north);
  const up = t.dir;
  const base = t.dir.clone().multiplyScalar(CONFIG.waterLevel + 0.035);
  const count = 2 + ((Math.random() * 4) | 0);

  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2 + t.spiralPhase * 0.2;
    const r = 0.2 + Math.random() * 2.2;
    const speed = 1.8 + Math.random() * 4.2;
    const vel = tmp.east
      .clone()
      .multiplyScalar(Math.cos(ang) * speed * 0.55)
      .addScaledVector(tmp.north, Math.sin(ang) * speed * 0.55)
      .addScaledVector(up, 2.5 + Math.random() * 5.5);
    const mat = new THREE.MeshBasicMaterial({
      color: Math.random() > 0.4 ? 0xc8e4f4 : 0xf0f8ff,
      transparent: true,
      opacity: 0.55 + Math.random() * 0.25,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.02 + Math.random() * 0.045, 4, 3),
      mat
    );
    mesh.position
      .copy(base)
      .addScaledVector(tmp.east, Math.cos(ang) * r)
      .addScaledVector(tmp.north, Math.sin(ang) * r)
      .addScaledVector(up, Math.random() * 0.5);
    sys.planetGroup.add(mesh);
    sys.waterSpray.push({
      mesh,
      mat,
      vel,
      t: 0,
      life: 0.28 + Math.random() * 0.38,
      gravity: up.clone().multiplyScalar(-14),
      drag: 0.86
    });
  }
}

function spawnGroundEffects(sys, t) {
  if (isWaterAt(sys, t.dir)) spawnWaterMist(sys, t);
  else spawnGroundDust(sys, t);
}

/** @returns {object} */
export function spawnTornado(sys, targetDir) {
  const anchor = targetDir.clone().normalize();
  const seed = dirSeed(anchor);
  const rng = makeRng(seed);
  const visual = buildTornadoVisual(seed);
  sys.planetGroup.add(visual.group);
  updateVisual(visual, 0, 0);
  placeAtSpiral(visual.group, anchor, sys.terrain);

  const t = {
    anchor,
    dir: anchor.clone(),
    visual,
    group: visual.group,
    spiralPhase: 0,
    t: 0,
    dustT: 0,
    life: SPELLS.tornado.life,
    pathT: 0,
    pathSpeed1: 0.5 + rng() * 0.4,
    pathSpeed2: 0.35 + rng() * 0.38,
    orbitR1: 3.2 + rng() * 3.8,
    orbitR2: 2.4 + rng() * 3.2,
    fading: false,
    fadeT: 0,
    lastTrailDir: anchor.clone(),
    sfx: null
  };
  const listener = sys.getListenerDir?.(tmp.dir2);
  if (listener && sys.audio) t.sfx = sys.audio.startTornado(t.dir, listener);
  if (!sys.tornados) sys.tornados = [];
  sys.tornados.push(t);
  return t;
}

function updateTornadoPath(t, dt) {
  t.pathT += dt;
  tangentFrame(t.anchor, tmp.east, tmp.north);
  const pt = t.pathT;
  const ox =
    Math.sin(pt * t.pathSpeed1) * t.orbitR1 +
    Math.sin(pt * t.pathSpeed2 * 0.73) * t.orbitR2 * 0.32;
  const oy =
    Math.sin(pt * t.pathSpeed2) * t.orbitR2 +
    Math.sin(pt * t.pathSpeed1 * 0.85) * t.orbitR1 * 0.26;
  t.dir
    .copy(t.anchor)
    .multiplyScalar(CONFIG.planetR)
    .addScaledVector(tmp.east, ox)
    .addScaledVector(tmp.north, oy)
    .normalize();
}

function wizardOrbitPos(terrain, centerDir, orbitAng, height, wallU, pathT, bendPhase, outPos, seed = 0) {
  tangentFrame(centerDir, tmp.east, tmp.north);
  const u = Math.min(0.98, wallU);
  const r = radiusAt(u) * 0.75;
  const { bx, bz } = bendOffset(u, pathT, bendPhase, seed);
  const baseR = surfaceAt(terrain, centerDir);
  outPos
    .copy(centerDir)
    .multiplyScalar(baseR)
    .addScaledVector(tmp.east, Math.cos(orbitAng) * r + bx)
    .addScaledVector(tmp.north, Math.sin(orbitAng) * r + bz)
    .addScaledVector(centerDir, height);
}

function beginThrow(w, td) {
  const sideFull = Math.PI * 0.5;
  tangentFrame(w.dir, tmp.east, tmp.north);
  const up = w.dir.clone();
  const tangent = tmp.east
    .clone()
    .multiplyScalar(Math.cos(td.orbitAng + 1.2))
    .addScaledVector(tmp.north, Math.sin(td.orbitAng + 1.2))
    .normalize();
  const rng = makeRng(dirSeed(td.centerDir) + td.spinY * 0.17);
  td.vel = tangent
    .multiplyScalar(11 + rng() * 5)
    .addScaledVector(up, 9 + rng() * 4);
  td.pos = w.mesh.position.clone();
  td.phase = "air";
  td.t = 0;
  td.sideZ = sideFull;
  td.spinVel = 16;
  td.rollVel = 18;
  td.source = null;
  w.onScream?.();
}

function decayFlightSpin(td, dt) {
  td.spinY = (td.spinY || 0) + dt * (td.spinVel || 0);
  td.bodyRoll = (td.bodyRoll || 0) + dt * (td.rollVel || 0);
  td.spinVel = (td.spinVel || 0) * Math.exp(-2.4 * dt);
  td.rollVel = (td.rollVel || 0) * Math.exp(-2.6 * dt);
  if (Math.abs(td.spinVel) < 0.04) td.spinVel = 0;
  if (Math.abs(td.rollVel) < 0.04) td.rollVel = 0;
}

function collectTossables(sys) {
  const list = [];
  const wizards = sys.getWizards?.() || (sys.wizard ? [sys.wizard] : []);
  for (const w of wizards) if (w) list.push(w);
  if (sys.critters?.list) {
    for (const c of sys.critters.list) if (c) list.push(c);
  }
  return list;
}

function canBePulled(body) {
  if (!body || body.dead || body.godMode || body.tornado) return false;
  if (body.remote) return false;
  if (body.casting || body.knockdown) return false;
  return true;
}

function applyTornadoPull(sys, dt) {
  const def = SPELLS.tornado;
  const captureR = def.captureRadius;
  const list = collectTossables(sys);

  for (const body of list) {
    if (!canBePulled(body)) continue;
    if (!body._tornadoPullSpeed || !body._tornadoSource) continue;

    const t = body._tornadoSource;
    if (t.fading) continue;

    const dist = surfaceDist(t.dir, body.dir);
    if (dist > def.pullRadius) continue;

    if (dist <= captureR) {
      body.beginTornadoCapture(t.dir, t);
      continue;
    }

    body.pullOnSurface(t.dir, body._tornadoPullSpeed * dt);
  }
}

/** Před pohybem — nastaví zpomalení a rychlost vtahu podle vzdálenosti. */
export function prepareTornadoEffects(sys, _dt) {
  const list = collectTossables(sys);
  const tornados = sys.tornados;
  const def = SPELLS.tornado;
  const pullR = def.pullRadius;
  const innerR = def.innerRadius;

  for (const body of list) {
    body._tornadoMoveMul = 1;
    body._tornadoPullSpeed = 0;
    body._tornadoPullDir = null;
    body._tornadoSource = null;

    if (!canBePulled(body)) continue;
    if (!tornados?.length) continue;

    let bestDist = Infinity;
    let bestT = null;

    for (const t of tornados) {
      if (t.fading) continue;
      const dist = surfaceDist(t.dir, body.dir);
      if (dist > pullR || dist >= bestDist) continue;
      bestDist = dist;
      bestT = t;
    }

    if (!bestT) continue;

    body._tornadoPullDir = bestT.dir;
    body._tornadoSource = bestT;
    body._tornadoPullSpeed = def.pullSpeed;

    if (bestDist <= innerR) {
      body._tornadoMoveMul = 0;
    } else {
      body._tornadoMoveMul = 0.5 * ((bestDist - innerR) / (pullR - innerR));
    }
  }
}

/** Vtah + chycení — volat po pohybu kouzelníků. */
export function updateTornadoPull(sys, dt) {
  if (!sys.tornados?.length) return;
  applyTornadoPull(sys, dt);
}

function updateCapturedWizard(w, tornadoDir, pathT, bendPhase, dt, linkedTornado = null) {
  const td = w.tornado;
  if (!td) return;

  const inTornado = td.phase === "climb";
  if (inTornado) {
    if (!linkedTornado || td.source !== linkedTornado) return;
    td.centerDir.copy(tornadoDir);
  }

  td.t += dt;
  const sideFull = Math.PI * 0.5;
  const terrain = w.terrain;

  if (td.phase === "climb") {
    const dur = 2.6;
    const u = Math.min(1, td.t / dur);
    const ease = u * u * (3 - 2 * u);

    td.spinY += dt * (10 + ease * 30);
    td.orbitAng += dt * (5 + ease * 13);
    td.preAmp = ease * 0.32 * (1 - Math.max(0, (ease - 0.55) / 0.45));
    td.height = ease * TOP_HEIGHT;
    td.wallU = ease * 0.98;
    const tiltT = Math.max(0, (ease - 0.42) / 0.58);
    td.sideZ = tiltT * tiltT * sideFull;
    td.bodyRoll = (td.bodyRoll || 0) + dt * tiltT * 12;

    wizardOrbitPos(terrain, td.centerDir, td.orbitAng, td.height, td.wallU, pathT, bendPhase, w.mesh.position, linkedTornado?.visual?.seed ?? 0);
    w.dir.copy(w.mesh.position).normalize();

    if (u >= 1) {
      td.sideZ = sideFull;
      td.height = TOP_HEIGHT;
      beginThrow(w, td);
    }
    return;
  }

  if (td.phase === "air") {
    decayFlightSpin(td, dt);
    const up = td.pos.clone().normalize();
    td.vel.addScaledVector(up, -16 * dt);
    td.vel.multiplyScalar(0.992);
    td.pos.addScaledVector(td.vel, dt);

    const len = td.pos.length();
    if (len < 1e-4) return;
    w.dir.copy(td.pos).multiplyScalar(1 / len);
    const groundH = terrainFloor(terrain, w.dir);
    if (len <= groundH + 0.12) {
      w.mesh.position.copy(w.dir).multiplyScalar(groundH);
      w.onBodyFall?.();
      if (w.diesOnTornadoLand) {
        w.endTornadoCapture();
        w.die({ fromDir: td.centerDir });
        return;
      }
      if (!w.remote) {
        w.takeDamage(SPELLS.tornado.fallDamage, { fromDir: td.centerDir, knock: false });
      }
      td.phase = "lie";
      td.t = 0;
      td.preAmp = 0;
      td.sideZ = sideFull;
    } else {
      w.mesh.position.copy(td.pos);
    }
    return;
  }

  if (td.phase === "lie") {
    decayFlightSpin(td, dt);
    w.mesh.position.copy(w.dir).multiplyScalar(terrainFloor(terrain, w.dir));
    if (td.t >= 0.55) {
      td.phase = "rise";
      td.t = 0;
    }
    return;
  }

  if (td.phase === "rise") {
    decayFlightSpin(td, dt);
    const dur = 0.38;
    const u = Math.min(1, td.t / dur);
    const e = u * u * (3 - 2 * u);
    td.sideZ = sideFull * (1 - e);
    w.mesh.position.copy(w.dir).multiplyScalar(terrainFloor(terrain, w.dir));
    if (u >= 1) w.endTornadoCapture();
  }
}

function releaseTornadoVictims(list, t, forceThrow = false) {
  for (const w of list) {
    if (!w.tornado || w.tornado.source !== t) continue;
    const td = w.tornado;
    if (forceThrow && td.phase === "climb") {
      wizardOrbitPos(
        w.terrain,
        td.centerDir,
        td.orbitAng,
        td.height,
        td.wallU,
        t.pathT,
        t.visual.bendPhase,
        w.mesh.position,
        t.visual.seed
      );
      w.dir.copy(w.mesh.position).normalize();
      beginThrow(w, td);
    } else if (td.phase === "air" || td.phase === "lie" || td.phase === "rise") {
      td.source = null;
    } else if (td.phase === "climb") {
      w.endTornadoCapture();
    }
  }
}

/** Let / ležení / vstávání — běží i po zmizení tornáda. */
export function updateTornadoVictims(sys, dt) {
  const list = collectTossables(sys);
  for (const w of list) {
    const td = w.tornado;
    if (!td) continue;
    if (w.remote) continue;
    if (td.phase === "air" || td.phase === "lie" || td.phase === "rise") {
      updateCapturedWizard(w, td.centerDir, 0, 0, dt, null);
    }
  }
}

function setTornadoAlpha(t, alpha) {
  const a = Math.max(0, alpha);
  t.visual.shellMat.opacity = 0.2 * a;
  t.visual.baseMat.opacity = 0.35 * a;
  const mc = t.visual.mainSpiralCount ?? MAIN_SPIRALS;
  for (let sp = 0; sp < t.visual.spiralMats.length; sp++) {
    const blur = sp >= mc;
    t.visual.spiralMats[sp].opacity = (blur ? 0.1 + (sp - mc) * 0.04 : 0.42 - sp * 0.07) * a;
  }
}

function disposeTornado(sys, t) {
  if (t.sfx) {
    sys.audio?.stopTornado(t.sfx, 0.25);
    t.sfx = null;
  }
  sys.planetGroup.remove(t.group);
  const v = t.visual;
  v.shellGeo.dispose();
  v.shellMat.dispose();
  v.baseMat.dispose();
  for (const g of v.spiralGeos) g.dispose();
  for (const m of v.spiralMats) m.dispose();
}

export function updateTornados(sys, dt) {
  if (!sys.tornados?.length) return;

  for (let i = sys.tornados.length - 1; i >= 0; i--) {
    const t = sys.tornados[i];
    const list = collectTossables(sys);

    if (!t.fading && t.t >= t.life) {
      t.fading = true;
      t.fadeT = 0;
      releaseTornadoVictims(list, t, true);
    }

    if (t.fading) {
      t.fadeT += dt;
      const fu = Math.min(1, t.fadeT / FADE_DUR);
      const alpha = Math.pow(1 - fu, 1.6);
      setTornadoAlpha(t, alpha);
      const thin = Math.max(0.06, 1 - fu * 0.94);
      t.group.scale.set(thin, 1, thin);
      t.spiralPhase -= dt * 5 * (1 - fu * 0.5);
      updateVisual(t.visual, t.pathT, t.spiralPhase);

      if (t.sfx) {
        const listener = sys.getListenerDir?.(tmp.dir2);
        if (listener) sys.audio?.updateTornado(t.sfx, t.dir, listener, dt, alpha);
      }

      if (fu >= 1) {
        releaseTornadoVictims(list, t, false);
        disposeTornado(sys, t);
        sys.tornados.splice(i, 1);
      }
      continue;
    }

    t.t += dt;
    updateTornadoPath(t, dt);
    placeOnSurface(t.group, t.dir, sys.terrain);

    if (t.sfx) {
      const listener = sys.getListenerDir?.(tmp.dir2);
      if (listener) sys.audio?.updateTornado(t.sfx, t.dir, listener, dt, 1);
    }

    const trailStep = 0.38;
    const moved = surfaceDist(t.lastTrailDir, t.dir);
    if (moved >= trailStep) {
      const steps = Math.min(8, Math.ceil(moved / trailStep));
      for (let s = 1; s <= steps; s++) {
        const u = s / steps;
        tmp.v
          .copy(t.lastTrailDir)
          .multiplyScalar(1 - u)
          .addScaledVector(t.dir, u)
          .normalize();
        sys.terrain.paintTornadoTrail(tmp.v, 2.1);
      }
      t.lastTrailDir.copy(t.dir);
    }

    t.spiralPhase -= dt * 16;
    updateVisual(t.visual, t.pathT, t.spiralPhase);

    t.dustT += dt;
    if (t.dustT >= 0.032 && !t.fading) {
      t.dustT = 0;
      spawnGroundEffects(sys, t);
    }

    const pulse = 0.5 + 0.5 * Math.sin(t.t * 3.5);
    t.visual.shellMat.opacity = 0.16 + pulse * 0.1;
    t.visual.baseMat.opacity = 0.22 + pulse * 0.14;
    const mc = t.visual.mainSpiralCount ?? MAIN_SPIRALS;
    for (let sp = 0; sp < t.visual.spiralMats.length; sp++) {
      const blur = sp >= mc;
      const base = blur ? 0.1 + (sp - mc) * 0.04 : 0.42 - sp * 0.07;
      t.visual.spiralMats[sp].opacity = base + (blur ? 0 : pulse * 0.06);
    }

    for (const w of list) {
      if (w.remote) continue;
      if (w.tornado?.source === t) {
        updateCapturedWizard(w, t.dir, t.pathT, t.visual.bendPhase, dt, t);
      }
    }
  }
}

export function disposeTornados(sys) {
  if (!sys.tornados?.length) return;
  const list = collectTossables(sys);
  for (const t of sys.tornados) {
    releaseTornadoVictims(list, t, false);
    disposeTornado(sys, t);
  }
  sys.tornados.length = 0;
}
