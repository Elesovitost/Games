import { CONFIG } from "./config.js";
import { surfaceDistance } from "./surface.js";

/** Combat konstanty — radius A, damage ve středu X (klesá k 0 na okraji). */
export const COMBAT = {
  maxHp: 100,
  maxLives: 3,
  lightning: { radius: 4.2, damage: 48 },
  fireball: { radius: 3.6, damage: 42 },
  dragonBreath: { radius: 3.2, damage: 28 },
  dragonSpawn: { radius: 3.0, damage: 16 },
  morph: { radius: 5.0, damage: 14 },
  lavaDps: 22
};

/** Lineární pokles damage od středu k okraji. */
export function falloffDamage(centerDmg, radius, dist) {
  if (radius <= 0 || dist >= radius) return 0;
  const t = 1 - dist / radius;
  return centerDmg * t;
}

export function applyRadialDamage(game, centerLocal, radius, centerDamage) {
  if (!game?.wizards || !centerLocal) return;
  for (const w of game.wizards.values()) {
    if (w.state !== "alive") continue;
    const dist = surfaceDistance(game.terrain, w.dir, centerLocal);
    const dmg = falloffDamage(centerDamage, radius, dist);
    if (dmg >= 0.4) w.takeDamage(dmg);
  }
}

export function applyLavaDps(game, dt) {
  const lava = game.lava;
  if (!lava?.list?.length) return;
  for (const w of game.wizards.values()) {
    if (w.state !== "alive") continue;
    let dps = 0;
    for (const p of lava.list) {
      if (p.age >= p.life) continue;
      const remain = p.life - p.age;
      if (remain < p.fadeTime * 0.35) continue;
      const dist = surfaceDistance(game.terrain, p.up, w.dir);
      if (dist <= p.rad * 0.92) dps += COMBAT.lavaDps;
    }
    if (dps > 0) w.takeDamage(dps * dt);
  }
}
