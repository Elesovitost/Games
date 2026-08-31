import { SPELLS } from "./defs.js";

/** Po dokončení castu — aktivuj neviditelnost. */
export function applyInvisibility(sys, wizard = sys.wizard) {
  const w = wizard ?? sys.wizard;
  const def = SPELLS.invisibility;
  if (!w || w.dead || !def) return;
  w.beginInvisibility({
    hold: def.holdTime,
    localOpacity: def.localOpacity,
    remoteOpacity: def.remoteOpacity
  });
}
