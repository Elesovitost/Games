import { CONFIG } from "./config.js";
import { createNoise } from "./noise.js";
import { createIcosphereGeometry } from "./icosphere.js";
import { MAPS, generateMapHeights } from "./maps.js";

/** Předpočítané výšky vrcholů pro každou mapu — rychlé rebuildy bez generování. */
const cache = new Map();
let baseGeo = null;

function getBasePositions() {
  if (!baseGeo) {
    baseGeo = createIcosphereGeometry(CONFIG.planetR, CONFIG.icoSubdiv);
  }
  return baseGeo.attributes.position;
}

/** Načte výšky všech map do paměti. */
export function preloadAllMapHeights(onProgress) {
  const pos = getBasePositions();
  const count = pos.count;
  for (let i = 0; i < MAPS.length; i++) {
    const map = MAPS[i];
    if (!cache.has(map.index)) {
      const heights = new Float32Array(count);
      const noise = createNoise(map.seed >>> 0);
      generateMapHeights(map, heights, pos, noise);
      cache.set(map.index, heights);
    }
    onProgress?.((i + 1) / MAPS.length, map.name);
  }
}

/** Async varianta — mezi mapami yield na UI thread. */
export async function preloadAllMapHeightsAsync(onProgress) {
  const pos = getBasePositions();
  const count = pos.count;
  for (let i = 0; i < MAPS.length; i++) {
    const map = MAPS[i];
    if (!cache.has(map.index)) {
      const heights = new Float32Array(count);
      const noise = createNoise(map.seed >>> 0);
      generateMapHeights(map, heights, pos, noise);
      cache.set(map.index, heights);
    }
    onProgress?.((i + 1) / MAPS.length, map.name);
    await new Promise((r) => requestAnimationFrame(r));
  }
}

export function getCachedHeights(mapIndex) {
  return cache.get(mapIndex) || null;
}

export function clearMapHeightsCache() {
  cache.clear();
  if (baseGeo) {
    baseGeo.dispose();
    baseGeo = null;
  }
}
