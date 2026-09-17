import * as THREE from "../three.js";
import { applyWorldPacket } from "./world-sync.js";

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
      if (intent.color != null) {
        w.setRobeColor(intent.color);
        game.spawnMarkers?.syncFromWizards(game.wizards);
      }
      w.applyNetPose(intent.dir, intent.facing, intent);
    },

    knock(fromId, intent) {
      const w = game.wizards.get(String(fromId));
      if (!w || !w.remote) return;
      w.applyKnockdown(intent.amt, intent.from, {
        seq: intent.seq,
        hp: intent.hp,
        rotations: intent.rotations ?? undefined,
        rollDistance: intent.rollDistance ?? undefined,
        awayFrom: intent.away ? intent.from : undefined,
        reverseRoll: !!intent.reverseRoll
      });
    },

    color(fromId, intent) {
      const w = game.wizards.get(String(fromId));
      if (!w || intent.color == null) return;
      w.setRobeColor(intent.color);
      game.spawnMarkers?.syncFromWizards(game.wizards);
    },

    /** Pose už nese pohyb; destination na remote se nepoužívá. */
    walk() {},

    /** Mrtvé zvíře — rychlý intent od hosta; world snapshot je záloha. */
    beast(_fromId, intent) {
      if (game.session?.isHost) return;
      const kind = intent.who || "c";
      const herd =
        kind === "l"
          ? game.longnecks
          : kind === "w"
            ? game.worms
            : kind === "a"
              ? game.attackers
              : game.critters;
      herd?.kill?.(intent.id, intent.dir, intent.from);
    },

    /**
     * Klovnutí kudlanky zasáhlo wizarda, který je pro hosta remote.
     * Simulaci vede host, poškození si aplikuje jen oběť na svém lokálním wizardovi.
     */
    bite(_fromId, intent) {
      if (!game.session?.isMp || game.session?.isHost) return;
      const w = game.wizards.get(String(intent.target));
      if (!w || w.remote || w.dead) return;
      const f = intent.from;
      const fromDir = Array.isArray(f) && f.length === 3 ? new THREE.Vector3(f[0], f[1], f[2]) : undefined;
      w.takeDamage(intent.amount ?? 10, { fromDir, knock: false });
    },

    /** Hostovský snímek zvířat a vodního života. */
    world(_fromId, intent) {
      if (game.session?.isHost) return;
      applyWorldPacket(game, intent);
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

export function createIntentRouter(handlers) {
  return (fromId, intent) => {
    if (!intent?.kind) return;
    const fn = handlers[intent.kind];
    if (fn) fn(fromId, intent);
  };
}
