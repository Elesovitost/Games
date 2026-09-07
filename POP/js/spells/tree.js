import * as THREE from "../three.js";
import { CONFIG } from "../config.js";
import { slerpDirection, tangentFrame, surfaceOffsetDir } from "../utils.js";
import { surfaceDist } from "./fx-common.js";
import { MagicTree, TREE_FIREFLY_GROW } from "../magic-tree.js";
import { aoeFalloff, countTreeWorshippers } from "../animalsAI.js";
import { TREE_GROW_FLOOR } from "../tree-grow.js";

const _world = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _east = new THREE.Vector3();
const _north = new THREE.Vector3();

/** Max poloměr zvukové vlny u plně vzrostlého stromu (m). */
const SOUND_WAVE_R1 = 6.2;
const SOUND_WAVE_R0 = 0.28;
const SOUND_WAVE_LIFE = 2.4;
const SOUND_WAVE_SEGS = 48;
const SOUND_WAVE_WIDTH = 0.7;
const SOUND_WAVE_LIFT = 0.07;

/** @type {THREE.CanvasTexture|null} */
let _soundWaveMap = null;

function ensureSoundWaveMap() {
  if (_soundWaveMap) return _soundWaveMap;
  const res = 64;
  const c = document.createElement("canvas");
  c.width = c.height = res;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(res, res);
  const data = img.data;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const u = (x + 0.5) / res;
      const v = (y + 0.5) / res;
      // v: 0 vnitřní okraj pásu, 1 vnější — měkký pruh
      const band = Math.exp(-((v - 0.5) ** 2) / 0.045);
      const edge = Math.sin(Math.PI * v);
      const a = Math.max(0, band * 0.55 + edge * 0.65);
      const i = (y * res + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.max(0, Math.min(255, a * 230));
      void u;
    }
  }
  ctx.putImageData(img, 0, 0);
  _soundWaveMap = new THREE.CanvasTexture(c);
  _soundWaveMap.needsUpdate = true;
  _soundWaveMap.wrapS = THREE.RepeatWrapping;
  return _soundWaveMap;
}

function growWavePeriod(sys) {
  const d = sys.audio?.buffers?.get("treegrow")?.duration;
  if (d > 0.25) return d / 2;
  return 0.9;
}

function ensureWaveRoot(t) {
  if (t.waveRoot || t.disposed) return;
  t.waveRoot = new THREE.Group();
  t.waveRoot.frustumCulled = false;
  t.planetGroup.add(t.waveRoot);
}

function makeWaveRibbonGeo() {
  const n = SOUND_WAVE_SEGS;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices = [];
  for (let i = 0; i < n; i++) {
    const i0 = i * 2;
    const i1 = i0 + 1;
    const j0 = ((i + 1) % n) * 2;
    const j1 = j0 + 1;
    indices.push(i0, i1, j1, i0, j1, j0);
    const u = i / n;
    uvs[i0 * 2] = u;
    uvs[i0 * 2 + 1] = 0;
    uvs[i1 * 2] = u;
    uvs[i1 * 2 + 1] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.setDrawRange(0, indices.length);
  return geo;
}

/** Přepíše ribbon na povrch terénu kolem středu (geodetický kruh). */
function writeWaveOnTerrain(terrain, centerDir, radiusM, widthM, lift, posAttr) {
  tangentFrame(centerDir, _east, _north);
  const half = widthM * 0.5;
  const rIn = Math.max(0.08, radiusM - half);
  const rOut = radiusM + half;
  for (let i = 0; i < SOUND_WAVE_SEGS; i++) {
    const a = (i / SOUND_WAVE_SEGS) * Math.PI * 2;
    surfaceOffsetDir(centerDir, _east, _north, a, rIn, _dir);
    let h = terrain.height(_dir) + lift;
    posAttr.setXYZ(i * 2, _dir.x * h, _dir.y * h, _dir.z * h);
    surfaceOffsetDir(centerDir, _east, _north, a, rOut, _dir);
    h = terrain.height(_dir) + lift;
    posAttr.setXYZ(i * 2 + 1, _dir.x * h, _dir.y * h, _dir.z * h);
  }
  posAttr.needsUpdate = true;
}

function spawnTreeSoundWave(sys, t) {
  ensureWaveRoot(t);
  if (!t.waveRoot || !sys?.terrain) return;
  const geo = makeWaveRibbonGeo();
  const mat = new THREE.MeshBasicMaterial({
    map: ensureSoundWaveMap(),
    color: t.color || 0xffe566,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  const g = Math.min(1, Math.max(0, t.growth));
  // malý strom = krátký dosah; plný o něco méně než dřívějších ~7.5 m
  const size = 0.12 + 0.88 * Math.pow(g, 0.75);
  const r0 = SOUND_WAVE_R0 * (0.7 + 0.3 * size);
  const r1 = SOUND_WAVE_R1 * size;
  writeWaveOnTerrain(sys.terrain, t.dir, r0, SOUND_WAVE_WIDTH * 0.55 * (0.65 + 0.35 * size), SOUND_WAVE_LIFT, geo.attributes.position);
  geo.computeBoundingSphere();
  t.waveRoot.add(mesh);
  t.soundWaves.push({
    mesh,
    mat,
    geo,
    t: 0,
    life: SOUND_WAVE_LIFE,
    r0,
    r1
  });
}

function disposeTreeSoundWaves(t) {
  if (!t) return;
  for (const w of t.soundWaves || []) {
    w.mesh.parent?.remove(w.mesh);
    w.geo.dispose();
    w.mat.dispose();
  }
  t.soundWaves = [];
  if (t.waveRoot) {
    t.planetGroup.remove(t.waveRoot);
    t.waveRoot = null;
  }
  t._waveEmitT = 0;
}

/** Export pro MagicTree.dispose. */
MagicTree.prototype.disposeSoundWaves = function disposeSoundWaves() {
  disposeTreeSoundWaves(this);
};

function updateTreeSoundWaves(sys, t, dt, active) {
  if (t.disposed) return;
  if (active) {
    t._waveEmitT += dt;
    const period = growWavePeriod(sys);
    while (t._waveEmitT >= period) {
      t._waveEmitT -= period;
      spawnTreeSoundWave(sys, t);
    }
  }

  const waves = t.soundWaves;
  if (!waves?.length) return;
  const terrain = sys.terrain;
  for (let i = waves.length - 1; i >= 0; i--) {
    const w = waves[i];
    w.t += dt;
    const u = Math.min(1, w.t / w.life);
    const ease = 1 - (1 - u) * (1 - u);
    const r = w.r0 + (w.r1 - w.r0) * ease;
    const width = SOUND_WAVE_WIDTH * (0.55 + u * 0.7);
    writeWaveOnTerrain(terrain, t.dir, r, width, SOUND_WAVE_LIFT, w.geo.attributes.position);
    w.geo.computeBoundingSphere();
    w.mat.color.setHex(t.color || 0xffe566);
    w.mat.opacity = Math.max(0, 0.18 * (1 - u));
    if (u >= 1) {
      w.mesh.parent?.remove(w.mesh);
      w.geo.dispose();
      w.mat.dispose();
      waves.splice(i, 1);
    }
  }
  if (!waves.length && !active && t.waveRoot) {
    t.planetGroup.remove(t.waveRoot);
    t.waveRoot = null;
  }
}

function syncTreeGrowSfx(sys, t) {
  const want = !t.disposed && t.growth >= TREE_FIREFLY_GROW;
  if (!want) {
    t.clearGrowSfx?.(sys.audio);
    return false;
  }
  const listener = sys.getListenerDir?.();
  if (!listener || !sys.audio) return false;
  if (!t.sfxGrow) {
    t.sfxGrow = sys.audio.startSfxLoop("treegrow", t.dir, listener);
    if (t.sfxGrow) {
      t._growAudio = sys.audio;
      t._waveEmitT = growWavePeriod(sys) * 0.15;
    }
  }
  if (t.sfxGrow) sys.audio.updateSfxLoop(t.sfxGrow, t.dir, listener);
  return !!t.sfxGrow || t.growth >= TREE_FIREFLY_GROW;
}

export function countMagicTreesForOwner(sys, ownerId) {
  const list = sys.magicTrees;
  if (!list?.length || ownerId == null) return 0;
  const oid = String(ownerId);
  let n = 0;
  for (const t of list) {
    if (!t || t.disposed) continue;
    if (String(t.ownerId) === oid) n++;
  }
  return n;
}

export function hasTreeSeedForOwner(sys, ownerId) {
  if (ownerId == null) return false;
  const oid = String(ownerId);
  for (const p of sys.projectiles || []) {
    if (p?.kind === "treeseed" && String(p.casterId) === oid) return true;
  }
  return false;
}

export function canPlantMagicTreeForOwner(sys, ownerId) {
  return countMagicTreesForOwner(sys, ownerId) === 0 && !hasTreeSeedForOwner(sys, ownerId);
}

export function getMagicTreeForOwner(sys, ownerId) {
  const list = sys.magicTrees;
  if (!list?.length || ownerId == null) return null;
  const oid = String(ownerId);
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i];
    if (!t || t.disposed) continue;
    if (String(t.ownerId) === oid) return t;
  }
  return null;
}

export function hasStandingTreeForOwner(sys, ownerId) {
  const t = getMagicTreeForOwner(sys, ownerId);
  return !!t && !t.disposed && t.growth >= TREE_GROW_FLOOR;
}

export function hurtMagicTreesNear(sys, centerDir, radiusM, dmgCenter, dmgEdge) {
  if (sys.worldRemote) return false;
  const list = sys.magicTrees;
  if (!list?.length || !centerDir || !(radiusM > 0)) return false;
  let hit = false;
  for (const t of list) {
    if (!t || t.disposed) continue;
    const dist = surfaceDist(centerDir, t.dir);
    if (dist >= radiusM) continue;
    const dmg = aoeFalloff(dist, radiusM, dmgCenter, dmgEdge);
    if (dmg <= 0) continue;
    if (t.takeDamage(dmg)) hit = true;
  }
  return hit;
}

/** DPS s proměnným faktorem podle pozice (láva). */
export function hurtMagicTreesAt(sys, factorFn, amount) {
  if (sys.worldRemote) return;
  if (!(amount > 0) || !factorFn) return;
  for (const t of sys.magicTrees || []) {
    if (!t || t.disposed) continue;
    const mul = factorFn(t.dir);
    if (mul <= 0) continue;
    t.takeDamage(amount * mul);
  }
}

export function syncMagicTreeHealthUi(sys) {
  const w = sys.wizard;
  if (!w || w.remote) return;
  const panel = document.getElementById("tree-health");
  const fill = document.getElementById("tree-health-fill");
  if (!panel || !fill) return;
  const tree = getMagicTreeForOwner(sys, w.id);
  if (!tree) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  const pct = (tree.hp / tree.maxHp) * 100;
  fill.style.width = `${pct}%`;
  fill.classList.toggle("low", pct <= 30);
  fill.classList.toggle("mid", pct > 30 && pct <= 60);
}

function makeSeedBall() {
  const group = new THREE.Group();
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 10, 8),
    new THREE.MeshBasicMaterial({
      color: 0xfff0a0,
      transparent: true,
      opacity: 0.42,
      depthWrite: false
    })
  );
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 10, 8),
    new THREE.MeshStandardMaterial({
      color: 0xffe566,
      emissive: 0xffcc33,
      emissiveIntensity: 1.35,
      roughness: 0.28,
      metalness: 0.08
    })
  );
  core.castShadow = false;
  const light = new THREE.PointLight(0xffe566, 1.6, 3.5, 2);
  light.castShadow = false;
  group.add(glow, core, light);
  group.userData = { glow, core, light };
  group.frustumCulled = false;
  return group;
}

function seedWorldPos(ball, planetGroup, out) {
  ball.getWorldPosition(out);
  planetGroup.worldToLocal(out);
  return out;
}

function attachToHand(sys, wizard, ball) {
  const parts = wizard?.mesh?.userData?.parts;
  const hand = parts?.rightFore ?? parts?.rightArm;
  if (hand) {
    ball.position.set(0, -0.26, 0.05);
    hand.add(ball);
    return true;
  }
  const lift = CONFIG.wizardHeightM * 0.72;
  ball.position.copy(wizard.mesh.position).addScaledVector(wizard.dir, lift);
  sys.planetGroup.add(ball);
  return false;
}

export function beginTreeSeed(sys, targetDir) {
  const w = sys.wizard;
  if (!w) return null;
  const ball = makeSeedBall();
  const inHand = attachToHand(sys, w, ball);
  const p = {
    kind: "treeseed",
    ball,
    held: true,
    inHand,
    target: targetDir.clone().normalize(),
    color: w.color,
    casterId: sys._castOwnerId,
    life: 10,
    flightT: 0,
    flightTime: 0.8,
    peak: 2.2,
    from: new THREE.Vector3(),
    fromDir: new THREE.Vector3(),
    sinking: false,
    sinkT: 0,
    planted: false
  };
  sys.projectiles.push(p);
  return p;
}

export function releaseTreeSeed(sys, p) {
  if (!p || !p.held || !p.ball) return;
  seedWorldPos(p.ball, sys.planetGroup, _world);
  if (p.ball.parent) p.ball.parent.remove(p.ball);
  sys.planetGroup.add(p.ball);
  p.ball.position.copy(_world);
  p.held = false;
  p.from.copy(_world);
  p.fromDir.copy(_world).normalize();
  const dist = surfaceDist(p.fromDir, p.target);
  p.flightTime = THREE.MathUtils.clamp(0.42 + dist * 0.03, 0.48, 1.28);
  p.peak = THREE.MathUtils.clamp(1.35 + dist * 0.13, 1.5, 4.6);
  p.flightT = 0;
}

function startSink(p) {
  p.sinking = true;
  p.sinkT = 0;
}

function disposeSeed(sys, p) {
  if (!p.ball) return;
  if (p.ball.parent) p.ball.parent.remove(p.ball);
  p.ball.traverse((ch) => {
    if (ch.isMesh) {
      ch.geometry?.dispose?.();
      ch.material?.dispose?.();
    }
    if (ch.isLight) ch.dispose();
  });
  p.ball = null;
}

function spawnGrownTree(sys, dir, color, ownerId) {
  if (!sys.magicTrees) sys.magicTrees = [];
  try {
    const tree = new MagicTree(sys.planetGroup, sys.terrain, dir, color, { ownerId });
    sys.magicTrees.push(tree);
    sys.trees?.placements?.push(tree.placement);
    return tree;
  } catch (err) {
    console.error("Strom se nepodařilo zasadit:", err);
    return null;
  }
}

/** @returns {boolean} keep projectile */
export function updateTreeSeed(sys, p, dt) {
  if (!p.ball) return false;
  if (p.held) {
    const casters = sys.getWizards?.() || (sys.wizard ? [sys.wizard] : []);
    const caster = casters.find((w) => w.id === p.casterId);
    if (caster?.dead) {
      disposeSeed(sys, p);
      return false;
    }
    return true;
  }

  if (p.sinking) {
    p.sinkT += dt;
    const u = Math.min(1, p.sinkT / 0.42);
    const ease = u * u;
    const h = sys.terrain.height(p.target);
    _aim.copy(p.target).multiplyScalar(h - ease * 0.55);
    p.ball.position.copy(_aim);
    const s = 1 - ease;
    p.ball.scale.setScalar(s);
    const light = p.ball.userData.light;
    if (light) light.intensity = 1.6 * (1 - ease);
    if (u >= 1) {
      if (!p.planted) spawnGrownTree(sys, p.target, p.color, p.casterId);
      p.planted = true;
      disposeSeed(sys, p);
      return false;
    }
    return true;
  }

  p.flightT += dt;
  const u = Math.min(1, p.flightT / Math.max(0.05, p.flightTime));
  slerpDirection(_dir, p.fromDir, p.target, u);
  const ground = sys.terrain.height(_dir);
  const fromH = p.from.length();
  const startLift = Math.max(0, fromH - sys.terrain.height(p.fromDir));
  const arc = 4 * p.peak * u * (1 - u);
  const lift = startLift * (1 - u) + arc;
  p.ball.position.copy(_dir).multiplyScalar(ground + lift);
  p.ball.rotation.y += dt * 6;
  p.ball.rotation.x += dt * 3.2;

  if (u >= 1) startSink(p);
  return true;
}

export function disposeTreeSeed(sys, p) {
  disposeSeed(sys, p);
}

export function updateMagicTrees(sys, dt) {
  const list = sys.magicTrees;
  if (!list?.length) return;
  const wizards = sys.getWizards?.() || (sys.wizard ? [sys.wizard] : []);
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i];
    if (t.disposed || t.placement?.gone) {
      t.clearGrowSfx?.(sys.audio);
      if (!t.disposed) t.dispose();
      list.splice(i, 1);
      continue;
    }
    if (t.ownerId) {
      const oid = String(t.ownerId);
      const w = wizards.find((wiz) => String(wiz.id) === oid);
      if (w) t.setColor(w.color);
    } else if (sys.wizard) {
      t.setColor(sys.wizard.color);
    }
    if (sys.worldRemote) {
      t.glowT += dt;
      t.applyGlow();
      t.pose();
    } else {
      const n = countTreeWorshippers(t.dir, sys.critters?.list, sys.longnecks?.list, sys.worms?.list);
      t.update(dt, n);
    }
    const sounding = syncTreeGrowSfx(sys, t);
    updateTreeSoundWaves(sys, t, dt, sounding);
  }
  syncMagicTreeHealthUi(sys);
}

export function disposeMagicTrees(sys) {
  if (!sys.magicTrees) return;
  for (const t of sys.magicTrees) {
    t.clearGrowSfx?.(sys.audio);
    disposeTreeSoundWaves(t);
    t.dispose();
  }
  sys.magicTrees.length = 0;
  if (sys.trees?.placements) {
    const keep = sys.trees.placements.filter((p) => !p.magic);
    sys.trees.placements.length = 0;
    sys.trees.placements.push(...keep);
  }
}
