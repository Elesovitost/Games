import * as THREE from "../three.js";

/**
 * Směrování vzdálených intentů.
 * walk: pohyb je přes pose (~20 Hz); walk intent je no-op (historicky / budoucí predikce).
 * knock: low-latency intent; pose.knock je záloha se stejným seq (dedupe).
 * cast: každý klient lokálně spustí castAs (FX + morph).
 */
export function createGameIntentHandlers(game) {
  return {
    pose(fromId, intent) {
      const w = game.wizards.get(String(fromId));
      if (!w) return;
      w.applyNetPose(intent.dir, intent.facing, intent);
    },

    knock(fromId, intent) {
      const w = game.wizards.get(String(fromId));
      if (!w || !w.remote) return;
      w.applyKnockdown(intent.amt, intent.from, {
        seq: intent.seq,
        hp: intent.hp
      });
    },

    /** Pose už nese pohyb; destination na remote se nepoužívá. */
    walk() {},

    cast(fromId, intent) {
      const w = game.wizards.get(String(fromId));
      if (!w) return;
      game.spells.castAs(
        w,
        intent.spell,
        new THREE.Vector3(intent.target[0], intent.target[1], intent.target[2])
      );
    }
  };
}

export function createIntentRouter(handlers) {
  return (fromId, intent) => {
    if (!intent?.kind) return;
    const fn = handlers[intent.kind];
    if (fn) fn(fromId, intent);
  };
}
