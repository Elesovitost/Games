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

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** Velká kružnice + tečný rám pro meandry podél pásu. */
function beltFrame(axis) {
  const [ax, ay, az] = norm3(axis[0], axis[1], axis[2]);
  let rx = 1;
  let ry = 0;
  let rz = 0;
  if (Math.abs(ax) > 0.72) {
    rx = 0;
    ry = 1;
  }
  let e1x = ay * rz - az * ry;
  let e1y = az * rx - ax * rz;
  let e1z = ax * ry - ay * rx;
  const e1l = Math.hypot(e1x, e1y, e1z) || 1;
  e1x /= e1l;
  e1y /= e1l;
  e1z /= e1l;
  return {
    ax,
    ay,
    az,
    e1x,
    e1y,
    e1z,
    e2x: ay * e1z - az * e1y,
    e2y: az * e1x - ax * e1z,
    e2z: ax * e1y - ay * e1x
  };
}

/**
 * Pásy kopců / hor — obepínají planetu (velké kružnice), kroutí se a mají sedla.
 * width/foot = pološířka v |n·p| (~ radiány); na R=80 m je 0.15 ≈ 12 m.
 */
const BELTS = [
  {
    ...beltFrame([0.18, 0.94, 0.28]),
    width: 0.15,
    meander: 0.055,
    foot: 0.33,
    base: 3.4,
    peak: 10.5,
    footH: 2.0,
    gap: -0.14,
    along: 2.7,
    sharp: 1.7,
    ox: 2.1
  },
  {
    ...beltFrame([0.91, 0.1, -0.4]),
    width: 0.125,
    meander: 0.048,
    foot: 0.27,
    base: 2.6,
    peak: 8.0,
    footH: 1.5,
    gap: -0.06,
    along: 3.3,
    sharp: 1.9,
    ox: 11.4
  },
  {
    ...beltFrame([0.36, -0.6, 0.71]),
    width: 0.26,
    meander: 0.07,
    foot: 0.44,
    base: 1.5,
    peak: 3.4,
    footH: 1.15,
    gap: -0.24,
    along: 2.0,
    sharp: 1.2,
    ox: 7.7
  },
  {
    ...beltFrame([-0.54, 0.47, 0.7]),
    width: 0.11,
    meander: 0.06,
    foot: 0.24,
    base: 2.0,
    peak: 6.2,
    footH: 1.25,
    gap: 0.1,
    along: 4.1,
    sharp: 1.75,
    ox: 19.2
  }
];

function beltHeight(nx, ny, nz, noise, b) {
  const u = nx * b.e1x + ny * b.e1y + nz * b.e1z;
  const v = nx * b.e2x + ny * b.e2y + nz * b.e2z;
  const meander = noise.fbm(u * 2.15 + b.ox, v * 2.15, 1.4) * b.meander;
  const dist = Math.abs(nx * b.ax + ny * b.ay + nz * b.az - meander);
  const core = smoothstep(b.width, b.width * 0.12, dist);
  const feet = smoothstep(b.foot, b.width * 0.4, dist);
  if (feet <= 0 && core <= 0) return 0;

  const along = noise.fbm(u * b.along + b.ox, v * b.along, 4.2);
  const present = smoothstep(b.gap, b.gap + 0.28, along);
  if (present <= 0.02) return 0;

  const peakN = Math.max(0, along - 0.12);
  const ridge = Math.pow(core, b.sharp) * (b.base + peakN * peakN * b.peak);
  const jag = noise.fbm(nx * 12 + b.ox, ny * 12, nz * 12);
  return present * (ridge * (0.8 + jag * 0.32) + feet * b.footH);
}

/**
 * Pevnina s několika moři — dá se obejít po souši.
 * Hory jsou v pásech (řetězce), ne náhodně po celé kouli.
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

    // Moře — pod hladinou je dno (lze chodit a nořit se)
    const sea = smoothstep(-0.02, -0.28, basin);
    if (sea > 0.72) {
      const deep = smoothstep(0.72, 1.0, sea);
      const bump = noise.fbm(nx * 7.2 + 4.1, ny * 7.2 - 2.3, nz * 7.2) * 0.7;
      const depth = 1.6 + deep * 4.2 + bump;
      heights[i] = W - depth;
      continue;
    }

    // Mělčina / pobřežní shelf pod vodou
    if (sea > 0.35) {
      const shore = smoothstep(0.35, 0.72, sea);
      const shelf = shore * 1.3;
      heights[i] = W - shelf + (1 - shore) * 0.45;
      continue;
    }

    const roll = noise.fbm(nx * 3.2 + 1.5, ny * 3.2, nz * 3.2);
    const detail = noise.fbm(nx * 8.5 + 11, ny * 8.5 - 4, nz * 8.5) * 0.4
      + noise.fbm(nx * 18 + 20, ny * 18, nz * 18) * 0.16;
    const hills = Math.max(0, roll - 0.08) * 1.45;

    let ranges = 0;
    for (let b = 0; b < BELTS.length; b++) {
      ranges += beltHeight(nx, ny, nz, noise, BELTS[b]);
    }

    let h = W + 0.5 + hills + detail + ranges;
    h -= sea * 1.2;

    heights[i] = Math.min(CONFIG.maxR * 0.98, Math.max(W + 0.08, h));
  }
}

function spawnSite(s) {
  const x = s.x ?? s[0];
  const y = s.y ?? s[1];
  const z = s.z ?? s[2];
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function segmentScore(dx, dy, dz, site, weight) {
  return dx * site[0] + dy * site[1] + dz * site[2] + (weight || 0);
}

/**
 * Neviditelný segment pevné pevniny: vážená Voronoi buňka kolem spawnu.
 * `spawns.weights` vyvažuje plochu souše (~stejně velká pole).
 */
export function landSegmentIndex(dir, spawns) {
  if (!spawns?.length) return 0;
  const dx = dir.x ?? dir[0];
  const dy = dir.y ?? dir[1];
  const dz = dir.z ?? dir[2];
  const weights = spawns.weights;
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < spawns.length; i++) {
    const s = spawns[i];
    const sx = s.x ?? s[0];
    const sy = s.y ?? s[1];
    const sz = s.z ?? s[2];
    const score = dx * sx + dy * sy + dz * sz + (weights ? weights[i] : 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Posune hranice Voronoi buněk, aby každá měla přibližně stejný počet
 * suchých vrcholů. Váhy zůstanou na poli spawnů (`spawns.weights`).
 */
export function balanceLandSegmentWeights(terrain, spawns) {
  const n = spawns?.length || 0;
  const weights = new Float64Array(n);
  if (!spawns || n < 2 || !terrain?.dirs) {
    if (spawns) spawns.weights = Array.from(weights);
    return spawns?.weights || [];
  }

  const dirs = terrain.dirs;
  const wet = terrain.wetMask;
  const vertCount = (dirs.length / 3) | 0;
  const land = [];
  for (let i = 0; i < vertCount; i++) {
    if (wet && wet[i] > 0.45) continue;
    land.push(i);
  }
  const landN = land.length;
  if (!landN) {
    spawns.weights = Array.from(weights);
    return spawns.weights;
  }

  const sites = spawns.map(spawnSite);
  const counts = new Float64Array(n);
  const target = landN / n;

  const assign = (dx, dy, dz) => {
    let best = 0;
    let bestScore = -Infinity;
    for (let s = 0; s < n; s++) {
      const score = segmentScore(dx, dy, dz, sites[s], weights[s]);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  };

  const centerWeights = () => {
    let mean = 0;
    for (let s = 0; s < n; s++) mean += weights[s];
    mean /= n;
    for (let s = 0; s < n; s++) weights[s] -= mean;
  };

  const keepSpawnsInside = () => {
    for (let s = 0; s < n; s++) {
      const site = sites[s];
      let best = 0;
      let bestScore = -Infinity;
      let self = 0;
      for (let i = 0; i < n; i++) {
        const score = segmentScore(site[0], site[1], site[2], sites[i], weights[i]);
        if (i === s) self = score;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best !== s) weights[s] += bestScore - self + 1e-4;
    }
  };

  for (let iter = 0; iter < 28; iter++) {
    counts.fill(0);
    for (let k = 0; k < landN; k++) {
      const i = land[k];
      counts[assign(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2])]++;
    }
    let maxErr = 0;
    for (let s = 0; s < n; s++) {
      const err = (target - counts[s]) / landN;
      maxErr = Math.max(maxErr, Math.abs(err));
      weights[s] += err * 0.42;
    }
    keepSpawnsInside();
    centerWeights();
    if (maxErr < 0.018) break;
  }

  keepSpawnsInside();
  centerWeights();
  spawns.weights = Array.from(weights);
  return spawns.weights;
}

/**
 * 4 pevninské spawny — vždy stejné (deterministicky u tetraedru).
 * Na výsledek naváže 4 přibližně stejně velké segmenty souše.
 * @returns {number[][]}
 */
export function resolveLandSpawns(terrain, seeds = SPAWN_SEEDS) {
  const minLand = CONFIG.waterLevel + Math.max(CONFIG.wizardMinLand, 0.35);
  const spawns = seeds.map((seed) => findLandNear(terrain, seed, minLand));
  balanceLandSegmentWeights(terrain, spawns);
  return spawns;
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
