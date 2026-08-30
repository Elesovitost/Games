import { CONFIG } from "./config.js";

/**
 * 4 spawny — tetraedr, maximálně od sebe, vždy stejná místa
 * (po resolve na pevninu poblíž seedu).
 */
export const SPAWN_SEEDS = [
  [1, 1, 1],
  [1, -1, -1],
  [-1, 1, -1],
  [-1, -1, 1]
].map((v) => {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
});

/** @deprecated alias */
export const SPAWNS = SPAWN_SEEDS;

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Pevnina s několika moři — dá se obejít po souši.
 * Lokální pánve = moře; hřebeny a vrcholy = hory.
 */
export function generateHeights(heights, pos, noise) {
  const W = CONFIG.waterLevel;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const inv = 1 / (Math.hypot(x, y, z) || 1);
    const nx = x * inv;
    const ny = y * inv;
    const nz = z * inv;

    // Velké pánve → několik moří (ne celý oceán)
    const basinA = noise.fbm(nx * 1.35 + 3.1, ny * 1.35 - 1.2, nz * 1.35);
    const basinB = noise.fbm(nx * 1.9 - 5.4, ny * 1.9 + 2.7, nz * 1.9 + 0.8);
    const basin = Math.min(basinA, basinB * 0.85 + 0.08);

    // Moře jen v hlubokých pánvích; pevnina zůstává propojená
    const sea = smoothstep(-0.02, -0.28, basin);
    if (sea > 0.72) {
      heights[i] = W;
      continue;
    }

    // Pobřeží / mělčina kolem moří
    if (sea > 0.35) {
      const shore = smoothstep(0.35, 0.72, sea);
      heights[i] = W + 0.04 + (1 - shore) * 0.55;
      continue;
    }

    // Základ pevniny
    const roll = noise.fbm(nx * 3.2 + 1.5, ny * 3.2, nz * 3.2);
    const detail = noise.fbm(nx * 8.5 + 11, ny * 8.5 - 4, nz * 8.5) * 0.55
      + noise.fbm(nx * 18 + 20, ny * 18, nz * 18) * 0.22;

    // Hřebeny a hory
    const ridge = Math.abs(noise.fbm(nx * 2.6 + 30, ny * 2.6, nz * 2.6));
    const range = Math.max(0, ridge - 0.22) * 5.8;
    const peakN = noise.fbm(nx * 5.5 + 41, ny * 5.5 - 9, nz * 5.5);
    const peaks = Math.max(0, peakN - 0.38);
    const mountains = peaks * peaks * 14 + Math.max(0, peakN - 0.5) * 3.5;

    const hills = Math.max(0, roll - 0.05) * 2.8;

    let h = W + 0.55 + hills + detail + range + mountains;
    // Mírný pokles k moři
    h -= sea * 1.2;

    heights[i] = Math.min(CONFIG.maxR * 0.98, Math.max(W + 0.08, h));
  }
}

/**
 * 4 pevninské spawny — vždy stejné (deterministicky u tetraedru).
 * @returns {number[][]}
 */
export function resolveLandSpawns(terrain, seeds = SPAWN_SEEDS) {
  const minLand = CONFIG.waterLevel + Math.max(CONFIG.wizardMinLand, 0.35);
  return seeds.map((seed) => findLandNear(terrain, seed, minLand));
}

/** Náhodný výběr mezi pevnými spawny. */
export function pickRandomSpawn(spawns) {
  if (!spawns?.length) return SPAWN_SEEDS[0];
  return spawns[(Math.random() * spawns.length) | 0];
}

function findLandNear(terrain, preferred, minLand) {
  const dir = { x: preferred[0], y: preferred[1], z: preferred[2] };
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir.x /= len; dir.y /= len; dir.z /= len;

  if (terrain.height(dir) >= minLand) return [dir.x, dir.y, dir.z];

  let east = { x: 0, y: 1, z: 0 };
  if (Math.abs(dir.y) > 0.9) east = { x: 1, y: 0, z: 0 };
  let ex = east.y * dir.z - east.z * dir.y;
  let ey = east.z * dir.x - east.x * dir.z;
  let ez = east.x * dir.y - east.y * dir.x;
  let el = Math.hypot(ex, ey, ez) || 1;
  ex /= el; ey /= el; ez /= el;
  let nx = dir.y * ez - dir.z * ey;
  let ny = dir.z * ex - dir.x * ez;
  let nz = dir.x * ey - dir.y * ex;

  for (let ring = 1; ring <= 48; ring++) {
    const offset = ring * 0.03;
    const steps = Math.max(8, ring * 4);
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      let tx = dir.x + ex * Math.cos(a) * offset + nx * Math.sin(a) * offset;
      let ty = dir.y + ey * Math.cos(a) * offset + ny * Math.sin(a) * offset;
      let tz = dir.z + ez * Math.cos(a) * offset + nz * Math.sin(a) * offset;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      if (terrain.height({ x: tx, y: ty, z: tz }) >= minLand) {
        return [tx, ty, tz];
      }
    }
  }
  return [dir.x, dir.y, dir.z];
}
