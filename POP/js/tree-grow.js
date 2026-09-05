/**
 * PROMPT — růst magického stromu
 *
 * Jedna vlna od země po dřevě. Nic nesmí vyrašit ve vzduchu a „doplout“ k sobě.
 *
 * 1. Dřevo existuje jen tam, kam už dorostla vlna od kořene (pathStart → pathEnd).
 *    Úsek se natahuje ze svého začátku (kmen / konec rodiče) ke špičce.
 * 2. Nejdřív tenký kmínek, tenké větvičky, drobné lístky.
 * 3. Už vyrostlé dřevo postupně sílí. Nová špička je vždy tenčí než starší dřevo.
 * 4. Nové větve jen z už hotového dřeva, až vlna dojde na jejich start.
 * 5. List jen na dřevě. Každá rostoucí větvička má na špičce lístek od prvního
 *    natažení; zvětšuje se s větví. Ostatní listy raší brzy po dřevu.
 * 6. Při g = 1 stejný kostlivec a stejné tloušťky / listy jako dřív.
 */

export const TREE_GROW_TIME = 20;
export const TREE_MAX_HEIGHT = 15;

function clamp01(t) {
  return Math.min(1, Math.max(0, t));
}

function smooth01(t) {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

/** Kostlivec je v cílové velikosti; mění se jen vlna a tloušťka. */
export function treeSizeAt(_g) {
  return 1;
}

/** Celkové sílení — výhon ~7 %, na konci 100 %. */
export function treeThickAt(g) {
  return 0.07 + 0.93 * smooth01(g);
}

/** Kam až od kořene (po dřevě) výhon dorostl. */
export function growthFront(g, maxPath) {
  return smooth01(g) * Math.max(0, maxPath);
}

/** 0→1, jak moc je úsek dřeva venku. Nula, dokud vlna nedojde na začátek úseku. */
export function pathAppear(front, pathStart, pathEnd) {
  const span = Math.max(1e-6, pathEnd - pathStart);
  if (front <= pathStart) return 0;
  if (front >= pathEnd) return 1;
  return (front - pathStart) / span;
}

/**
 * List na dřevě. `followTip` = na špičce od prvního natažení, roste s větví.
 * Ostatní vyrazí brzy po dřevu a zvětšují se s celkovým růstem.
 */
export function leafAppearAlong(woodAppear, along, g = 1, opts = {}) {
  const followTip = opts.followTip === true;
  const lag = opts.lag ?? (followTip ? 0.06 : 0.1);
  if (followTip) {
    if (woodAppear < 0.02) return 0;
    return woodAppear * (0.22 + 0.78 * smooth01(g));
  }
  const ready = woodAppear - along * 0.22;
  if (ready <= 0) return 0;
  const sprout = smooth01(ready / Math.max(1e-6, lag));
  return sprout * (0.2 + 0.8 * smooth01(g));
}
