import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame, tmp } from "./utils.js";

/** Bod na povrchu: střed + posun v tečné rovině (metry). */
export function sampleGround(terrain, up, east, north, ox, oy, lift, out) {
  out.copy(up)
    .multiplyScalar(CONFIG.planetR)
    .addScaledVector(east, ox)
    .addScaledVector(north, oy)
    .normalize();
  const h = terrain.height(out);
  out.multiplyScalar(h + lift);
  return out;
}

export function makeSurfaceRingGeo(segs = 40) {
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

export function drapeRing(geo, terrain, up, east, north, rIn, rOut, lift = 0.07) {
  const pos = geo.attributes.position;
  const segs = pos.count / 2;
  const p = tmp.dir;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    p.copy(up).multiplyScalar(CONFIG.planetR)
      .addScaledVector(east, c * rIn)
      .addScaledVector(north, s * rIn)
      .normalize();
    let h = terrain.height(p);
    p.multiplyScalar(h + lift);
    pos.setXYZ(i * 2, p.x, p.y, p.z);

    p.copy(up).multiplyScalar(CONFIG.planetR)
      .addScaledVector(east, c * rOut)
      .addScaledVector(north, s * rOut)
      .normalize();
    h = terrain.height(p);
    p.multiplyScalar(h + lift);
    pos.setXYZ(i * 2 + 1, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
}

export function createSurfaceRingMesh(material, segs = 40) {
  const mesh = new THREE.Mesh(makeSurfaceRingGeo(segs), material);
  mesh.renderOrder = 6;
  mesh.raycast = () => {};
  mesh.frustumCulled = false;
  return mesh;
}

export function frameAt(localPos, terrain, east, north, upOut) {
  const up = upOut || tmp.n;
  up.copy(localPos).normalize();
  tangentFrame(up, east, north);
  const h = terrain.height(up);
  return h;
}

/** Vzdálenost po povrchu (oblouk × průměrná výška terénu). */
export function surfaceDistance(terrain, fromDir, toLocal) {
  tmp.dir.copy(fromDir).normalize();
  tmp.dir2.copy(toLocal).normalize();
  const ang = tmp.dir.angleTo(tmp.dir2);
  const h0 = terrain.height(tmp.dir);
  const h1 = terrain.height(tmp.dir2);
  return ang * (h0 + h1) * 0.5;
}
