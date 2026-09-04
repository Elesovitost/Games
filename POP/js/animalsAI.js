import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { slerpDirection, surfaceOffsetDir, tangentFrame } from "./utils.js";
import { landSegmentIndex } from "./maps.js";

/**
 * Sdílené vzorce chování zvířat (hejna v critter.js, longneck.js,
 * vodní tvorové ve water-life.js). Cíl: jedno místo pro PRNG, pohyb
 * po geodetice, test chůze/vody a výběr náhodného cíle — jednotlivé
 * druhy si jen dosadí vlastní konstanty (rychlost, marže, dosah).
 */

/** Deterministický PRNG (mulberry32) — stejný seed = stejné chování/rozestavění. */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rovnoměrně náhodný směr na jednotkové kouli. */
export function randomSphereDir(rng) {
  const u = rng();
  const v = rng();
  const theta = Math.PI * 2 * u;
  const z = 2 * v - 1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new THREE.Vector3(r * Math.cos(theta), z, r * Math.sin(theta));
}

/** Je bod dost vysoko nad jádrem planety (mimo terén propadlý pod minR)? */
export function aboveCore(terrain, dir, minR) {
  return terrain.height(dir) >= minR;
}

/** Souš — nad hladinou, nebo suchá jáma bez nateklého moře. */
export function isLand(terrain, dir, waterMargin, minR) {
  const h = terrain.height(dir);
  if (h < minR) return false;
  const wet = terrain.wetness(dir);
  if (wet > 0.45) return false;
  if (h < CONFIG.waterLevel + waterMargin) return wet < 0.2;
  return true;
}

/** Voda — nateklá z původního moře. */
export function isWaterAt(terrain, dir, margin = 0.06) {
  return terrain.wetness(dir) > 0.45;
}

const _g1 = new THREE.Vector3();
const _g2 = new THREE.Vector3();

/** Sklon terénu v okolí bodu (numerická derivace ve dvou tečných směrech). */
export function terrainGrade(terrain, dir, east, north, eps = 0.08) {
  const h = terrain.height(dir);
  _g1.copy(dir).addScaledVector(east, eps).normalize();
  _g2.copy(dir).addScaledVector(north, eps).normalize();
  return Math.max(Math.abs(terrain.height(_g1) - h), Math.abs(terrain.height(_g2) - h)) / eps;
}

/**
 * Krok po geodetice směrem k `target`. Otočí `dir` o `min(omega, distM/R)`.
 * Pokud je zadán `walkable` a nová pozice neprojde, krok se vrátí zpět.
 * `stepScratch` je vektor typu Vector3 vlastněný voláním (bez alokace).
 * @returns {{ arrived: boolean, blocked: boolean }}
 */
export function stepToward(dir, target, distM, walkable, stepScratch) {
  const dot = Math.min(1, Math.max(-1, dir.dot(target)));
  const omega = Math.acos(dot);
  if (omega < 1e-8) return { arrived: true, blocked: false };
  const angle = Math.min(omega, distM / CONFIG.planetR);
  stepScratch.crossVectors(dir, target);
  if (stepScratch.lengthSq() < 1e-12) {
    dir.copy(target);
  } else {
    stepScratch.normalize();
    dir.applyAxisAngle(stepScratch, angle).normalize();
  }
  if (walkable && !walkable(dir)) {
    dir.applyAxisAngle(stepScratch, -angle).normalize();
    return { arrived: true, blocked: true };
  }
  return { arrived: omega <= angle + 1e-6, blocked: false };
}

/** Plynule natočí `facing` směrem k pohybu (kolmá složka k `target` v tečné rovině). */
export function turnFacingToward(facing, dir, target, moveScratch, rate) {
  moveScratch.copy(target).addScaledVector(dir, -dir.dot(target));
  if (moveScratch.lengthSq() > 1e-8) {
    moveScratch.normalize();
    slerpDirection(facing, facing, moveScratch, rate);
  }
}

/**
 * Vybere náhodný bod na kouli v okruhu `[distMin, distMax]`; pokud `walkable`
 * odmítne, zkusí to samé na opačnou stranu (kratší dosah `fallbackFactor`).
 */
export function pickWanderTarget(dir, east, north, rng, distMin, distMax, walkable, out, fallbackFactor = 0.6) {
  const dist = distMin + rng() * (distMax - distMin);
  const ang = rng() * Math.PI * 2;
  surfaceOffsetDir(dir, east, north, ang, dist, out);
  if (walkable && !walkable(out)) {
    surfaceOffsetDir(dir, east, north, ang + Math.PI, dist * fallbackFactor, out);
  }
  return out;
}

/** Azimut vektoru `v` (v tečné rovině) vůči bázi east/north — pro navázání na surfaceOffsetDir. */
export function bearingOf(v, east, north) {
  return Math.atan2(v.dot(north), v.dot(east));
}

function surfDist(a, b) {
  const d = Math.min(1, Math.max(-1, a.dot(b)));
  return Math.acos(d) * CONFIG.planetR;
}

/** Fibonacci mřížka — rovnoměrně po kouli. */
export function fibonacciSphereDirs(n) {
  const out = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = ga * i;
    out.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
  }
  return out;
}

const _scEast = new THREE.Vector3();
const _scNorth = new THREE.Vector3();
const _scTrial = new THREE.Vector3();

/**
 * Rozmístit `n` bodů co nejrovnoměrněji na souši.
 * `ok(dir, east, north)` musí říct, jestli se tam dá stát.
 */
export function scatterOnLand(n, ok, minSep = 4) {
  const pool = fibonacciSphereDirs(Math.max(n * 40, 320));
  const candidates = gatherLandCandidates(pool, ok, null, 0);
  const placed = [];
  addSpreadPlacements(candidates, n, minSep, placed);
  return placed;
}

function tooClose(dir, placed, minSep) {
  for (let i = 0; i < placed.length; i++) {
    if (surfDist(dir, placed[i]) < minSep) return true;
  }
  return false;
}

function minSurfDist(dir, placed) {
  if (!placed.length) return 1e9;
  let m = Infinity;
  for (let i = 0; i < placed.length; i++) {
    const d = surfDist(dir, placed[i]);
    if (d < m) m = d;
  }
  return m;
}

function tryLandNear(seed, ok, spawnDirs, seg, out) {
  out.copy(seed).normalize();
  tangentFrame(out, _scEast, _scNorth);
  if ((spawnDirs == null || landSegmentIndex(out, spawnDirs) === seg) && ok(out, _scEast, _scNorth)) {
    return true;
  }
  for (let k = 1; k <= 10; k++) {
    tangentFrame(seed, _scEast, _scNorth);
    surfaceOffsetDir(seed, _scEast, _scNorth, k * 2.399 + (seg || 0), 4 + k * 3.4, out);
    if (spawnDirs && landSegmentIndex(out, spawnDirs) !== seg) continue;
    tangentFrame(out, _scEast, _scNorth);
    if (ok(out, _scEast, _scNorth)) return true;
  }
  return false;
}

function gatherLandCandidates(pool, ok, spawnDirs, seg) {
  const list = [];
  for (let i = 0; i < pool.length; i++) {
    const seed = pool[i];
    if (spawnDirs && landSegmentIndex(seed, spawnDirs) !== seg) continue;
    if (!tryLandNear(seed, ok, spawnDirs, seg, _scTrial)) continue;
    if (tooClose(_scTrial, list, 2.4)) continue;
    list.push(_scTrial.clone());
  }
  return list;
}

/** Farthest-point: nejdřív střed pevniny, pak vždy bod nejdál od už vybraných. */
function addSpreadPlacements(candidates, want, minSep, placed) {
  if (!candidates.length || want <= 0) return;
  const used = new Uint8Array(candidates.length);
  const local = [];

  const centroid = new THREE.Vector3();
  for (let i = 0; i < candidates.length; i++) centroid.add(candidates[i]);
  if (centroid.lengthSq() > 1e-12) centroid.normalize();
  else centroid.copy(candidates[0]);

  let nearest = -1;
  let nearestD = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    if (minSurfDist(candidates[i], placed) < minSep * 0.6) continue;
    const d = surfDist(candidates[i], centroid);
    if (d < nearestD) {
      nearestD = d;
      nearest = i;
    }
  }
  if (nearest >= 0) {
    used[nearest] = 1;
    local.push(candidates[nearest]);
    placed.push(candidates[nearest]);
  }

  let sep = minSep;
  for (let pass = 0; pass < 5 && local.length < want; pass++) {
    if (pass) sep *= 0.8;
    while (local.length < want) {
      let best = -1;
      let bestD = -1;
      for (let i = 0; i < candidates.length; i++) {
        if (used[i]) continue;
        const d = minSurfDist(candidates[i], placed);
        if (d < sep) continue;
        if (d > bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0) break;
      used[best] = 1;
      local.push(candidates[best]);
      placed.push(candidates[best]);
    }
  }
}

/**
 * Rozmístit `n` bodů spravedlivě do Voronoi segmentů kolem spawnů —
 * každý segment dostane stejně kusů, rozptýlených po celé souši buňky.
 */
export function scatterOnLandBySegments(n, ok, spawnDirs, minSep = 4) {
  const segs = spawnDirs?.length || 0;
  if (segs < 2) return scatterOnLand(n, ok, minSep);

  const per = Math.floor(n / segs);
  const extra = n - per * segs;
  const placed = [];
  const pool = fibonacciSphereDirs(Math.max(n * 40, 320));

  for (let s = 0; s < segs; s++) {
    const want = per + (s < extra ? 1 : 0);
    const candidates = gatherLandCandidates(pool, ok, spawnDirs, s);
    addSpreadPlacements(candidates, want, minSep, placed);
  }
  return placed;
}

export const TREE_TRANCE_RANGE = 20;
/** Stání na kružnici — dál než kmen + tělo longnecka, ať se nezasekávají. */
export const TREE_TRANCE_RING = 5.4;

const _trEast = new THREE.Vector3();
const _trNorth = new THREE.Vector3();
const _trTan = new THREE.Vector3();
let _treeSwayT = 0;

/** Společné naklánění u magického stromu. */
export function treeSwayZ() {
  return Math.sin(_treeSwayT * 1.05) * 0.32;
}

/**
 * Zvířata do 20 m od magického stromu dostanou slot na kružnici.
 * Přepisuje ostatní chování — volá se před `update` hejn.
 */
export function assignTreeTrance(critters, longnecks, trees, dt) {
  _treeSwayT += dt;
  const members = [];
  for (const c of critters || []) {
    if (!c || c.dead) continue;
    c.treeSlot = null;
    c.treeFocus = null;
    members.push(c);
  }
  for (const c of longnecks || []) {
    if (!c || c.dead || c.gone) continue;
    c.treeSlot = null;
    c.treeFocus = null;
    members.push(c);
  }
  const placements = trees?.placements;
  if (!placements?.length || !members.length) return;

  const groups = new Map();
  for (const a of members) {
    let best = null;
    let bestD = TREE_TRANCE_RANGE;
    for (const p of placements) {
      if (!p?.magic || p.gone || !p.dir) continue;
      const d = surfDist(a.dir, p.dir);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) continue;
    let g = groups.get(best);
    if (!g) {
      g = [];
      groups.set(best, g);
    }
    g.push(a);
  }

  for (const [p, list] of groups) {
    list.sort((a, b) => {
      const na = a.constructor.name;
      const nb = b.constructor.name;
      if (na !== nb) return na < nb ? -1 : 1;
      return (a.id ?? 0) - (b.id ?? 0);
    });
    tangentFrame(p.dir, _trEast, _trNorth);
    const ringR = TREE_TRANCE_RING;
    const minArc = 2.4 / ringR;
    const items = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      _trTan.copy(a.dir).addScaledVector(p.dir, -p.dir.dot(a.dir));
      let ang;
      if (_trTan.lengthSq() < 1e-8) ang = ((a.id ?? i) * 2.399) % (Math.PI * 2);
      else ang = Math.atan2(_trTan.dot(_trNorth), _trTan.dot(_trEast));
      items.push({ a, ang });
    }
    items.sort((x, y) => x.ang - y.ang);
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < items.length; i++) {
        const j = (i + 1) % items.length;
        let d = items[j].ang - items[i].ang;
        if (i === items.length - 1) d += Math.PI * 2;
        if (d < minArc) {
          const push = (minArc - d) * 0.5;
          items[i].ang -= push;
          items[j].ang += push;
        }
      }
    }
    for (let i = 0; i < items.length; i++) {
      const a = items[i].a;
      if (!a._treeSlot) a._treeSlot = new THREE.Vector3();
      surfaceOffsetDir(p.dir, _trEast, _trNorth, items[i].ang, ringR, a._treeSlot);
      a.treeSlot = a._treeSlot;
      a.treeFocus = p.dir;
      a.treeRingR = ringR;
    }
  }
}
