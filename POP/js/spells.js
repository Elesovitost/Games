import { CONFIG } from "./config.js";

/** Přidání kouzla: 1) tlačítko data-spell v index.html, 2) záznam tady */
export const SPELLS = {
  elevate: {
    color: 0x88ee66,
    cast(game, pos) {
      game.terrain.startMorph(pos, "elevate");
    }
  },
  depress: {
    color: 0x4488ff,
    cast(game, pos) {
      game.terrain.startMorph(pos, "depress");
    }
  },
  lava: {
    color: 0xff6622,
    cast(game, pos, opts) {
      if (!game.terrain.isLand(pos)) {
        game.effects.waterSplash(pos);
        return false;
      }
      game.lava.spawn(pos, opts?.seed);
    }
  },
  dragon: {
    color: 0xff7722,
    cast(game, pos, opts) {
      game.dragons.spawn(pos, { seed: opts?.seed });
    }
  },
  lightning: {
    color: 0xc8e8ff,
    cast(game, pos) {
      game.effects.lightning(pos);
      if (game.terrain.isLand(pos)) game.terrain.deform(pos, "scorch", CONFIG.scorchRadius);
      else game.effects.waterSplash(pos);
    }
  },
  fireball: {
    color: 0xff5522,
    skipTargetCast: true,
    cast(game, pos, opts) {
      const from = opts?.fromDir || opts?.wizard?.dir || game.wizard.dir;
      game.fireballs.launch(from, pos);
    }
  }
};

export function castSpell(game, id, localPos, opts = {}) {
  const spell = SPELLS[id];
  if (!spell) return;
  const wizard = opts.wizard || game.wizard;
  const result = spell.cast(game, localPos, { ...opts, wizard });
  if (!spell.skipTargetCast && result !== false) {
    game.effects.cast(localPos, spell.color, 1);
  }
  if (wizard?.mesh) {
    game.effects.cast(wizard.mesh.position.clone(), 0xffe29a, 0.55);
  }
  wizard?.place();
  if (opts.clearSpellUi !== false && (!opts.wizard || opts.wizard === game.wizard)) {
    game.ui.setSpell(null);
  }
}
