import * as THREE from "./three.js";
import { CONFIG } from "./config.js";

export function lerp3(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

export function slerpDirection(out, a, b, t) {
  const dot = Math.min(Math.max(a.dot(b), -1), 1);
  if (dot > 0.9995) {
    out.copy(a).lerp(b, t).normalize();
    return out;
  }
  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  if (sinTheta < 1e-5) {
    out.copy(a).lerp(b, t).normalize();
    return out;
  }
  out.copy(a).multiplyScalar(Math.sin((1 - t) * theta) / sinTheta);
  out.addScaledVector(b, Math.sin(t * theta) / sinTheta);
  return out.normalize();
}

export function tangentFrame(n, east, north) {
  if (Math.abs(n.y) < 0.9) east.set(0, 1, 0).cross(n).normalize();
  else east.set(1, 0, 0).cross(n).normalize();
  north.crossVectors(n, east).normalize();
}

/** Bod na povrchu planety ve vzdálenosti distM (m) v azimutu angle od east/north. */
export function surfaceOffsetDir(center, east, north, angle, distM, out) {
  const omega = distM / CONFIG.planetR;
  const sinW = Math.sin(omega);
  const cosW = Math.cos(omega);
  return out
    .copy(center)
    .multiplyScalar(cosW)
    .addScaledVector(east, Math.cos(angle) * sinW)
    .addScaledVector(north, Math.sin(angle) * sinW)
    .normalize();
}

/** CSR sousednost vrchol → trojúhelníky (pro částečný přepočet normál). */
export function buildVertexFaceAdjacency(indexAttr, vertexCount) {
  const faceCount = indexAttr.count / 3;
  const counts = new Uint32Array(vertexCount);
  for (let f = 0; f < faceCount; f++) {
    counts[indexAttr.getX(f * 3)]++;
    counts[indexAttr.getX(f * 3 + 1)]++;
    counts[indexAttr.getX(f * 3 + 2)]++;
  }
  const start = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < vertexCount; i++) start[i + 1] = start[i] + counts[i];
  const list = new Uint32Array(start[vertexCount]);
  const cursor = start.slice(0, vertexCount);
  for (let f = 0; f < faceCount; f++) {
    for (let k = 0; k < 3; k++) {
      const v = indexAttr.getX(f * 3 + k);
      list[cursor[v]++] = f;
    }
  }
  return { start, list };
}

/** CSR sousednost vrchol → vrcholy (pro rozliv vody po síti). */
export function buildVertexVertexAdjacency(indexAttr, vertexCount) {
  const faceCount = indexAttr.count / 3;
  const buckets = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) buckets[i] = [];
  const link = (a, b) => {
    const list = buckets[a];
    for (let k = 0; k < list.length; k++) if (list[k] === b) return;
    list.push(b);
  };
  for (let f = 0; f < faceCount; f++) {
    const a = indexAttr.getX(f * 3);
    const b = indexAttr.getX(f * 3 + 1);
    const c = indexAttr.getX(f * 3 + 2);
    link(a, b); link(b, a);
    link(b, c); link(c, b);
    link(c, a); link(a, c);
  }
  const start = new Uint32Array(vertexCount + 1);
  for (let i = 0; i < vertexCount; i++) start[i + 1] = start[i] + buckets[i].length;
  const list = new Uint32Array(start[vertexCount]);
  for (let i = 0; i < vertexCount; i++) {
    const arr = buckets[i];
    const o = start[i];
    for (let k = 0; k < arr.length; k++) list[o + k] = arr[k];
  }
  return { start, list };
}

/**
 * Přepočet normál jen pro danou sadu trojúhelníků/vrcholů — stejný vzorec
 * jako BufferGeometry.computeVertexNormals, ale bez průchodu celou geometrií.
 * `accum` je perzistentní Float32Array(vertexCount*3) dodaný voláním kódem.
 */
export function recomputeNormalsPartial(geometry, faceSet, vertSet, accum) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const norm = geometry.attributes.normal;

  for (const v of vertSet) {
    accum[v * 3] = 0;
    accum[v * 3 + 1] = 0;
    accum[v * 3 + 2] = 0;
  }
  for (const f of faceSet) {
    const ia = idx.getX(f * 3);
    const ib = idx.getX(f * 3 + 1);
    const ic = idx.getX(f * 3 + 2);
    const abx = pos.getX(ia) - pos.getX(ib);
    const aby = pos.getY(ia) - pos.getY(ib);
    const abz = pos.getZ(ia) - pos.getZ(ib);
    const cbx = pos.getX(ic) - pos.getX(ib);
    const cby = pos.getY(ic) - pos.getY(ib);
    const cbz = pos.getZ(ic) - pos.getZ(ib);
    const nx = cby * abz - cbz * aby;
    const ny = cbz * abx - cbx * abz;
    const nz = cbx * aby - cby * abx;
    accum[ia * 3] += nx; accum[ia * 3 + 1] += ny; accum[ia * 3 + 2] += nz;
    accum[ib * 3] += nx; accum[ib * 3 + 1] += ny; accum[ib * 3 + 2] += nz;
    accum[ic * 3] += nx; accum[ic * 3 + 1] += ny; accum[ic * 3 + 2] += nz;
  }
  for (const v of vertSet) {
    const x = accum[v * 3];
    const y = accum[v * 3 + 1];
    const z = accum[v * 3 + 2];
    const len = Math.hypot(x, y, z) || 1;
    norm.setXYZ(v, x / len, y / len, z / len);
  }
  norm.needsUpdate = true;
}

/** Cap (střed + cos poloměru) rozšířený o okrajovou rezervu v metrech. */
export function capWithMargin(cap, marginM) {
  const r = Math.acos(Math.min(1, Math.max(-1, cap.cos))) * CONFIG.planetR + marginM;
  return { x: cap.x, y: cap.y, z: cap.z, cos: Math.cos(Math.min(Math.PI, r / CONFIG.planetR)) };
}

/** Je směr `dir` uvnitř některého z rozšířených capů? */
export function dirNearCaps(dir, caps) {
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i];
    if (dir.x * c.x + dir.y * c.y + dir.z * c.z >= c.cos) return true;
  }
  return false;
}

export function disposeObject(obj) {
  obj.traverse(function (ch) {
    if (ch.geometry) ch.geometry.dispose();
    if (ch.material) {
      if (Array.isArray(ch.material)) ch.material.forEach(function (m) { m.dispose(); });
      else ch.material.dispose();
    }
  });
}

export const tmp = {
  v: new THREE.Vector3(),
  n: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  dir2: new THREE.Vector3(),
  peek: new THREE.Vector3(),
  center: new THREE.Vector3(),
  east: new THREE.Vector3(),
  north: new THREE.Vector3(),
  col: [0, 0, 0]
};
