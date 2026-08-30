import { surfaceDistance } from "./surface.js";
import { RUNE_RADIUS } from "./spawns.js";

/** Combat konstanty — radius A, damage ve středu X (klesá k 0 na okraji). */
export const COMBAT = {
  maxHp: 100,
  maxLives: 3,
  lightning: { radius: 4.2, damage: 48 },
  fireball: { radius: 3.6, damage: 42 },
  dragonBreath: { radius: 3.2, damage: 28 },
  dragonSpawn: { radius: 3.0, damage: 16 },
  morph: { radius: 5.0, damage: 14 },
  lavaDps: 22,
  /** Léčení ve vlastním spawnu (runový kruh). */
  spawnHealRate: 1,
  spawnHealRadius: RUNE_RADIUS
};

/** Lineární pokles damage od středu k okraji. */
export function falloffDamage(centerDmg, radius, dist) {
  if (radius <= 0 || dist >= radius) return 0;
  const t = 1 - dist / radius;
  return centerDmg * t;
}

/**
 * @param {{ hostOnly?: boolean }} [opts]
 * hostOnly — v MP jen host (drak, láva); jinak každý klient jen svého kouzelníka.
 */
export function applyRadialDamage(game, centerLocal, radius, centerDamage, opts = {}) {
  if (!game?.wizards || !centerLocal) return;
  const session = game.session;
  const mp = session?.isPlaying;
  if (mp && opts.hostOnly && !session.isHost) return;
  for (const w of game.wizards.values()) {
    if (w.state !== "alive") continue;
    if (mp && !opts.hostOnly && w.id !== session.localId) continue;
    const dist = surfaceDistance(game.terrain, w.dir, centerLocal);
    const dmg = falloffDamage(centerDamage, radius, dist);
    if (dmg >= 0.4) w.takeDamage(dmg);
  }
}

export function applyLavaDps(game, dt) {
  const session = game.session;
  if (session?.isPlaying && !session.isHost) return;
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

/** V runovém kruhu vlastního spawnu: +1 HP/s. */
export function applySpawnRegen(game, dt) {
  const session = game.session;
  if (session?.isPlaying && !session.isHost) return;
  const terrain = game?.terrain;
  if (!terrain) return;
  const r = COMBAT.spawnHealRadius;
  const rate = COMBAT.spawnHealRate * dt;
  if (rate <= 0) return;
  for (const w of game.wizards.values()) {
    if (w.state !== "alive" || w.hp >= COMBAT.maxHp || !w.spawnFocus) continue;
    const center = terrain.pickStartDir(w.spawnFocus);
    if (surfaceDistance(terrain, w.dir, center) > r) continue;
    w.heal(rate);
  }
}
