import { CONFIG } from "./config.js";

/** Tetraedrální spawn — maximálně daleko od sebe. */
const TETRA_SPAWNS = [
  [1, 1, 1],
  [1, -1, -1],
  [-1, 1, -1],
  [-1, -1, 1]
].map((v) => {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
});

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function smoothFalloff(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Souostroví: 4 velké ostrovy na spawnech + spousta středních/malých,
 * víc pevniny, místy vyšší kopce.
 */
function sculptArchipelago(heights, ctx) {
  const { noise, pos, params } = ctx;
  const W = CONFIG.waterLevel;
  const spawns = params.spawns || TETRA_SPAWNS;
  const islandBoost = params.islandBoost ?? 1;
  const hillBoost = params.hillBoost ?? 1;
  const landBias = params.landBias ?? 0.08;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const inv = 1 / (Math.hypot(x, y, z) || 1);
    const nx = x * inv;
    const ny = y * inv;
    const nz = z * inv;

    // Velké ostrovy kolem spawnů (každý hráč na vlastním velkém ostrově)
    let continent = 0;
    for (let s = 0; s < spawns.length; s++) {
      const c = spawns[s];
      const d = nx * c[0] + ny * c[1] + nz * c[2];
      // ~38° poloměr jádra, měkký okraj
      const core = smoothstep(0.55, 0.92, d);
      continent = Math.max(continent, core);
    }

    // Střední ostrovy — špičky low-freq šumu
    const nA = noise.fbm(nx * 3.6 + 2.1, ny * 3.6, nz * 3.6);
    const nB = noise.fbm(nx * 5.8 - 4.2, ny * 5.8 + 1.3, nz * 5.8);
    const mid = Math.max(0, nA * 0.65 + nB * 0.45 - (0.12 - landBias)) * 1.55 * islandBoost;

    // Malé ostrůvky
    const nC = noise.fbm(nx * 11.5 + 9, ny * 11.5 - 3, nz * 11.5);
    const nD = noise.fbm(nx * 18.0 - 7, ny * 18.0, nz * 18.0 + 5);
    const small = Math.max(0, nC - 0.28 + landBias * 0.5) * 0.95 * islandBoost
      + Math.max(0, nD - 0.38) * 0.55 * islandBoost;

    // Mask pevniny
    let mask = continent * 1.15 + mid * 0.9 + small;
    mask = Math.min(1.35, mask);

    // Pobřežní šum — rozbití tvarů ostrovů
    const coast = noise.fbm(nx * 9.5 + 13, ny * 9.5, nz * 9.5);
    mask *= 0.88 + coast * 0.22;

    if (mask < 0.07) {
      heights[i] = W;
      continue;
    }

    // Terén na pevnině: plošiny + místy vysoké kopce
    const detail = noise.fbm(nx * 7.2 + 1, ny * 7.2, nz * 7.2) * 0.55
      + noise.fbm(nx * 16 + 20, ny * 16, nz * 16) * 0.22;
    const ridge = Math.abs(noise.fbm(nx * 4.1 + 30, ny * 4.1, nz * 4.1));
    const bigHill = Math.max(0, noise.fbm(nx * 2.4 - 8, ny * 2.4, nz * 2.4) - 0.18) * 4.2 * hillBoost;
    const midHill = Math.max(0, ridge - 0.35) * 2.4 * hillBoost;

    const elevBase = 0.12 + mask * 1.65;
    const elevHills = (detail * 0.9 + bigHill + midHill) * Math.min(1, mask * 1.2);
    let h = W + elevBase + elevHills;

    // Plážový přechod u okraje masky
    if (mask < 0.22) {
      const u = smoothFalloff(mask / 0.22);
      h = W + 0.04 + u * (h - W);
    }

    heights[i] = Math.min(CONFIG.maxR * 0.98, h);
  }
}

/** Kontinentálnější varianta — méně ostrůvků, větší pevniny. */
function sculptContinents(heights, ctx) {
  const { noise, pos, params } = ctx;
  const W = CONFIG.waterLevel;
  const spawns = params.spawns || TETRA_SPAWNS;
  const landBias = params.landBias ?? 0.12;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const inv = 1 / (Math.hypot(x, y, z) || 1);
    const nx = x * inv;
    const ny = y * inv;
    const nz = z * inv;

    let continent = 0;
    for (const c of spawns) {
      const d = nx * c[0] + ny * c[1] + nz * c[2];
      continent = Math.max(continent, smoothstep(0.35, 0.88, d));
    }
    const n = noise.fbm(nx * 2.8, ny * 2.8, nz * 2.8);
    const n2 = noise.fbm(nx * 7.5 + 5, ny * 7.5, nz * 7.5);
    let mask = continent * 0.95 + Math.max(0, n + landBias) * 0.55 + Math.max(0, n2 - 0.2) * 0.25;
    mask = Math.min(1.3, mask);
    if (mask < 0.08) {
      heights[i] = W;
      continue;
    }
    const hills = Math.max(0, noise.fbm(nx * 3.2 + 12, ny * 3.2, nz * 3.2) - 0.1) * 3.5
      + noise.fbm(nx * 10, ny * 10, nz * 10) * 0.4;
    heights[i] = Math.min(CONFIG.maxR * 0.98, W + 0.15 + mask * 1.7 + hills * Math.min(1, mask));
  }
}

const GENERATORS = {
  archipelago: sculptArchipelago,
  continents: sculptContinents
};

/**
 * Katalog map (~10). Výběr později přes index / id.
 * spawnFocus: 4 směry daleko od sebe, každý na velkém ostrově.
 */
export const MAPS = [
  {
    id: "archipelago",
    name: "Souostroví",
    seed: 20260829,
    generator: "archipelago",
    spawnFocus: TETRA_SPAWNS,
    params: { islandBoost: 1.05, hillBoost: 1.15, landBias: 0.1 }
  },
  {
    id: "twin-seas",
    name: "Dvojmoří",
    seed: 10442101,
    generator: "archipelago",
    spawnFocus: TETRA_SPAWNS,
    params: { islandBoost: 0.95, hillBoost: 1.35, landBias: 0.06 }
  },
  {
    id: "highlands",
    name: "Vysočina",
    seed: 77123945,
    generator: "archipelago",
    spawnFocus: TETRA_SPAWNS,
    params: { islandBoost: 0.9, hillBoost: 1.7, landBias: 0.14 }
  },
  {
    id: "islet-maze",
    name: "Bludiště ostrůvků",
    seed: 55280913,
    generator: "archipelago",
    spawnFocus: TETRA_SPAWNS,
    params: { islandBoost: 1.35, hillBoost: 0.85, landBias: 0.04 }
  },
  {
    id: "green-belt",
    name: "Zelený pás",
    seed: 33881702,
    generator: "continents",
    spawnFocus: TETRA_SPAWNS,
    params: { landBias: 0.16 }
  },
  {
    id: "broken-ring",
    name: "Rozbitý prstenec",
    seed: 91930448,
    generator: "archipelago",
    spawnFocus: TETRA_SPAWNS,
    params: { islandBoost: 1.15, hillBoost: 1.05, landBias: 0.09 }
  },
  {
    id: "four-realms",
    name: "Čtyři říše",
    seed: 64002817,
    generator: "continents",
    spawnFocus: TETRA_SPAWNS,
    params: { landBias: 0.2 }
  },
  {
    id: "storm-peaks",
    name: "Bouřné štíty",
    seed: 28115663,
    generator: "archipelago",
    spawnFocus: TETRA_SPAWNS,
    params: { islandBoost: 0.88, hillBoost: 1.9, landBias: 0.11 }
  },
  {
    id: "calm-shores",
    name: "Tiché břehy",
    seed: 40557290,
    generator: "archipelago",
    spawnFocus: TETRA_SPAWNS,
    params: { islandBoost: 1.0, hillBoost: 0.7, landBias: 0.13 }
  },
  {
    id: "wild-archipelago",
    name: "Divoké ostrovy",
    seed: 86753091,
    generator: "archipelago",
    spawnFocus: TETRA_SPAWNS,
    params: { islandBoost: 1.2, hillBoost: 1.4, landBias: 0.07 }
  }
].map((m, index) => ({
  ...m,
  index,
  spawns: m.spawnFocus,
  params: { ...m.params, spawns: m.spawnFocus }
}));

export function getMap(idOrIndex) {
  if (idOrIndex == null) return MAPS[0];
  if (typeof idOrIndex === "number" && idOrIndex >= 0 && idOrIndex < MAPS.length) {
    return MAPS[idOrIndex];
  }
  const asNum = Number(idOrIndex);
  if (Number.isInteger(asNum) && asNum >= 0 && asNum < MAPS.length) return MAPS[asNum];
  const byId = MAPS.find((m) => m.id === idOrIndex);
  if (byId) return byId;
  const seed = idOrIndex >>> 0;
  const bySeed = MAPS.find((m) => m.seed === seed);
  return bySeed || MAPS[0];
}

export function getDefaultMap() {
  return MAPS[0];
}

export function generateMapHeights(map, heights, pos, noise) {
  const gen = GENERATORS[map.generator] || sculptArchipelago;
  gen(heights, {
    noise,
    pos,
    params: map.params || { spawns: map.spawnFocus }
  });
}
