import * as THREE from "./three.js";

export function createIcosphereGeometry(radius, subdivisions) {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [];
  function addVert(x, y, z) {
    const len = Math.hypot(x, y, z) || 1;
    const i = verts.length / 3;
    verts.push(x / len, y / len, z / len);
    return i;
  }
  addVert(-1, t, 0);
  addVert(1, t, 0);
  addVert(-1, -t, 0);
  addVert(1, -t, 0);
  addVert(0, -1, t);
  addVert(0, 1, t);
  addVert(0, -1, -t);
  addVert(0, 1, -t);
  addVert(t, 0, -1);
  addVert(t, 0, 1);
  addVert(-t, 0, -1);
  addVert(-t, 0, 1);

  let faces = new Uint32Array([
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
    1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
    4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1
  ]);

  const cache = new Map();
  function midpoint(a, b) {
    const key = a < b ? a * 1048576 + b : b * 1048576 + a;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const ia = a * 3;
    const ib = b * 3;
    const idx = addVert(
      verts[ia] + verts[ib],
      verts[ia + 1] + verts[ib + 1],
      verts[ia + 2] + verts[ib + 2]
    );
    cache.set(key, idx);
    return idx;
  }

  for (let s = 0; s < subdivisions; s++) {
    cache.clear();
    const next = new Uint32Array(faces.length * 4);
    let w = 0;
    for (let i = 0; i < faces.length; i += 3) {
      const a = faces[i];
      const b = faces[i + 1];
      const c = faces[i + 2];
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next[w++] = a; next[w++] = ab; next[w++] = ca;
      next[w++] = b; next[w++] = bc; next[w++] = ab;
      next[w++] = c; next[w++] = ca; next[w++] = bc;
      next[w++] = ab; next[w++] = bc; next[w++] = ca;
    }
    faces = next;
  }

  const positions = new Float32Array(verts.length);
  for (let i = 0; i < verts.length; i++) positions[i] = verts[i] * radius;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(faces, 1));
  return geo;
}
