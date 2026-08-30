import { CONFIG } from "./config.js";

/** 4 spawny — tetraedr, maximálně od sebe. */
export const SPAWNS = [
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

/** Jedna výchozí mapa — souostroví se 4 velkými ostrovy u spawnů. */
export function generateHeights(heights, pos, noise) {
  const W = CONFIG.waterLevel;
  const spawns = SPAWNS;

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
      continent = Math.max(continent, smoothstep(0.55, 0.92, d));
    }

    const nA = noise.fbm(nx * 3.6 + 2.1, ny * 3.6, nz * 3.6);
    const nB = noise.fbm(nx * 5.8 - 4.2, ny * 5.8 + 1.3, nz * 5.8);
    const mid = Math.max(0, nA * 0.65 + nB * 0.45 - 0.04) * 1.55;

    const nC = noise.fbm(nx * 11.5 + 9, ny * 11.5 - 3, nz * 11.5);
    const nD = noise.fbm(nx * 18.0 - 7, ny * 18.0, nz * 18.0 + 5);
    const small = Math.max(0, nC - 0.28) * 0.95 + Math.max(0, nD - 0.38) * 0.55;

    let mask = continent * 1.15 + mid * 0.9 + small;
    mask = Math.min(1.35, mask);

    const coast = noise.fbm(nx * 9.5 + 13, ny * 9.5, nz * 9.5);
    mask *= 0.88 + coast * 0.22;

    if (mask < 0.07) {
      heights[i] = W;
      continue;
    }

    const detail = noise.fbm(nx * 7.2 + 1, ny * 7.2, nz * 7.2) * 0.55
      + noise.fbm(nx * 16 + 20, ny * 16, nz * 16) * 0.22;
    const ridge = Math.abs(noise.fbm(nx * 4.1 + 30, ny * 4.1, nz * 4.1));
    const bigHill = Math.max(0, noise.fbm(nx * 2.4 - 8, ny * 2.4, nz * 2.4) - 0.18) * 4.2;
    const midHill = Math.max(0, ridge - 0.35) * 2.4;

    let h = W + 0.12 + mask * 1.65
      + (detail * 0.9 + bigHill + midHill) * Math.min(1, mask * 1.2);

    if (mask < 0.22) {
      const u = smoothstep(0, 0.22, mask);
      h = W + 0.04 + u * (h - W);
    }

    heights[i] = Math.min(CONFIG.maxR * 0.98, h);
  }
}
