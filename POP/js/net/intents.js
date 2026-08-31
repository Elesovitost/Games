import * as THREE from "../three.js";

/** Směrování vzdálených intentů — nový intent přidej do createGameIntentHandlers. */
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

    walk(fromId, intent) {
      const w = game.wizards.get(String(fromId));
      if (!w) return;
      w.setDestination(
        new THREE.Vector3(intent.dir[0], intent.dir[1], intent.dir[2])
      );
    },

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
