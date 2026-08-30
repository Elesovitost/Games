import * as THREE from "./three.js";

/** Sdílené GPU/geometrie — alokace jednou při startu. */
export const SharedResources = {
  /** Kruhové prstence pro kouzla (40 segmentů). */
  spellRingGeo: null,
  spellColumnGeo: null,
  wizardModel: null,
  _warmed: false
};

export function initSharedResources() {
  if (SharedResources._warmed) return;
  SharedResources.spellRingGeo = makeRingGeo(32);
  SharedResources.spellColumnGeo = new THREE.CylinderGeometry(0.05, 0.18, 2.4, 8, 1, true);
  SharedResources._warmed = true;
}

function makeRingGeo(segs) {
  const pos = new Float32Array(segs * 2 * 3);
  const index = new Uint16Array(segs * 6);
  let w = 0;
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    const b = ((i + 1) % segs) * 2;
    index[w++] = a;
    index[w++] = a + 1;
    index[w++] = b + 1;
    index[w++] = a;
    index[w++] = b + 1;
    index[w++] = b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  return geo;
}

/** Zkompiluje shadery a probudí WebGL kontext. */
export async function warmRenderer(renderer, scene, camera) {
  initSharedResources();
  if (typeof renderer.compileAsync === "function") {
    await renderer.compileAsync(scene, camera);
  } else {
    renderer.compile(scene, camera);
  }
  renderer.render(scene, camera);
}
