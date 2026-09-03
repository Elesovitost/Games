import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { slerpDirection, surfaceOffsetDir } from "./utils.js";

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

/** Souš — nad hladinou o `waterMargin` a nad jádrem planety o `minR`. */
export function isLand(terrain, dir, waterMargin, minR) {
  const h = terrain.height(dir);
  return h >= CONFIG.waterLevel + waterMargin && h >= minR;
}

/** Voda — terén pod hladinou (s malou rezervou u břehu na pěnu/vlny). */
export function isWaterAt(terrain, dir, margin = 0.06) {
  return terrain.height(dir) < CONFIG.waterLevel + margin;
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
