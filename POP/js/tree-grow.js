/** Růst magického stromu — časová osa, ne geometrie. */

export const TREE_GROW_TIME = 20;
export const TREE_MAX_HEIGHT = 15;

/** Kostka je v plné velikosti; růst je vlna od země po větvích. */
export function treeSizeAt(_g) {
  return 1;
}

/** Tloušťka — tenký výhon, tloustne s růstem. */
export function treeThickAt(g) {
  const t = Math.min(1, Math.max(0, g));
  const u = t * t * (3 - 2 * t);
  return 0.22 + 0.78 * u;
}

/** Kam až od kořene (po dřevě) výhon dorostl. */
export function growthFront(g, maxPath) {
  const t = Math.min(1, Math.max(0, g));
  const u = t * t * (3 - 2 * t);
  return u * Math.max(0, maxPath);
}

/** 0→1, jak moc je úsek dřeva venku. Nula, dokud vlna nedojde na začátek úseku. */
export function pathAppear(front, pathStart, pathEnd) {
  const span = Math.max(1e-6, pathEnd - pathStart);
  if (front <= pathStart) return 0;
  if (front >= pathEnd) return 1;
  return (front - pathStart) / span;
}

/** List až poté, co dřevo doroste k jeho místu na větvi. */
export function leafAppearAlong(woodAppear, along, lag = 0.1) {
  const ready = woodAppear - along * 0.94;
  if (ready <= 0) return 0;
  const u = Math.min(1, ready / Math.max(1e-6, lag));
  return u * u * (3 - 2 * u);
}
