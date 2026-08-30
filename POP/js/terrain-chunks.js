import * as THREE from "./three.js";

/** Počet chunků = CHUNK_LON × CHUNK_LAT */
export const CHUNK_LON = 8;
export const CHUNK_LAT = 4;
export const CHUNK_COUNT = CHUNK_LON * CHUNK_LAT;

function chunkIdForCentroid(cx, cy, cz) {
  const len = Math.hypot(cx, cy, cz) || 1;
  const nx = cx / len;
  const ny = cy / len;
  const nz = cz / len;
  let u = Math.atan2(nz, nx);
  if (u < 0) u += Math.PI * 2;
  const v = Math.acos(Math.max(-1, Math.min(1, ny)));
  const li = Math.min(CHUNK_LON - 1, (u / (Math.PI * 2) * CHUNK_LON) | 0);
  const lj = Math.min(CHUNK_LAT - 1, (v / Math.PI * CHUNK_LAT) | 0);
  return lj * CHUNK_LON + li;
}

/**
 * @param {THREE.BufferGeometry} masterGeo
 * @param {THREE.Material} material
 */
export function buildTerrainChunks(masterGeo, material) {
  const mPos = masterGeo.attributes.position;
  const mCol = masterGeo.attributes.color;
  const mIdx = masterGeo.index;
  const buckets = Array.from({ length: CHUNK_COUNT }, () => ({
    masterIndices: [],
    masterSet: new Map(),
    triIndices: []
  }));

  for (let f = 0; f < mIdx.count; f += 3) {
    const ia = mIdx.getX(f);
    const ib = mIdx.getX(f + 1);
    const ic = mIdx.getX(f + 2);
    const ax = mPos.getX(ia);
    const ay = mPos.getY(ia);
    const az = mPos.getZ(ia);
    const bx = mPos.getX(ib);
    const by = mPos.getY(ib);
    const bz = mPos.getZ(ib);
    const cx = mPos.getX(ic);
    const cy = mPos.getY(ic);
    const cz = mPos.getZ(ic);
    const centX = (ax + bx + cx) / 3;
    const centY = (ay + by + cy) / 3;
    const centZ = (az + bz + cz) / 3;
    const id = chunkIdForCentroid(centX, centY, centZ);
    const bucket = buckets[id];

    const local = (mi) => {
      let li = bucket.masterSet.get(mi);
      if (li === undefined) {
        li = bucket.masterIndices.length;
        bucket.masterSet.set(mi, li);
        bucket.masterIndices.push(mi);
      }
      return li;
    };
    bucket.triIndices.push(local(ia), local(ib), local(ic));
  }

  const chunks = [];
  for (let id = 0; id < CHUNK_COUNT; id++) {
    const bucket = buckets[id];
    const n = bucket.masterIndices.length;
    if (!n || !bucket.triIndices.length) continue;

    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const mi = bucket.masterIndices[i];
      positions[i * 3] = mPos.getX(mi);
      positions[i * 3 + 1] = mPos.getY(mi);
      positions[i * 3 + 2] = mPos.getZ(mi);
      colors[i * 3] = mCol.getX(mi);
      colors[i * 3 + 1] = mCol.getY(mi);
      colors[i * 3 + 2] = mCol.getZ(mi);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(bucket.triIndices);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = true;
    chunks.push({ id, mesh, geometry: geo, masterIndices: bucket.masterIndices });
  }
  return chunks;
}

/** master vert → indexy chunků v poli chunks. */
export function buildVertexChunkRefs(chunks, vertCount) {
  const refs = new Array(vertCount);
  for (let ci = 0; ci < chunks.length; ci++) {
    const map = chunks[ci].masterIndices;
    for (let i = 0; i < map.length; i++) {
      const mi = map[i];
      let list = refs[mi];
      if (!list) refs[mi] = list = [];
      if (list[list.length - 1] !== ci) list.push(ci);
    }
  }
  return refs;
}

/**
 * @param {Set<number>|null} dirtyVerts
 * @param {Set<number>|null} dirtyChunks — indexy v poli chunks
 */
export function syncTerrainChunks(
  masterGeo,
  chunks,
  dirtyVerts = null,
  dirtyChunks = null,
  recomputeNormals = false,
  updateBounds = false
) {
  const mPos = masterGeo.attributes.position;
  const mCol = masterGeo.attributes.color;
  const all = !dirtyVerts && !dirtyChunks;

  for (let ci = 0; ci < chunks.length; ci++) {
    if (!all && dirtyChunks && !dirtyChunks.has(ci)) continue;

    const chunk = chunks[ci];
    const cp = chunk.geometry.attributes.position;
    const cc = chunk.geometry.attributes.color;
    const map = chunk.masterIndices;
    let changed = false;

    if (all) {
      for (let i = 0; i < map.length; i++) {
        const mi = map[i];
        cp.setXYZ(i, mPos.getX(mi), mPos.getY(mi), mPos.getZ(mi));
        cc.setXYZ(i, mCol.getX(mi), mCol.getY(mi), mCol.getZ(mi));
      }
      changed = true;
    } else if (dirtyVerts) {
      for (let i = 0; i < map.length; i++) {
        const mi = map[i];
        if (!dirtyVerts.has(mi)) continue;
        cp.setXYZ(i, mPos.getX(mi), mPos.getY(mi), mPos.getZ(mi));
        cc.setXYZ(i, mCol.getX(mi), mCol.getY(mi), mCol.getZ(mi));
        changed = true;
      }
    }

    if (!changed) continue;
    cp.needsUpdate = true;
    cc.needsUpdate = true;
    if (recomputeNormals) chunk.geometry.computeVertexNormals();
    if (updateBounds) chunk.geometry.computeBoundingSphere();
  }
}

/** Normaly jen u dotčených chunků — rozložené do více snímků. */
export function recomputeChunkNormals(chunks, chunkIndices) {
  for (let i = 0; i < chunkIndices.length; i++) {
    chunks[chunkIndices[i]]?.geometry.computeVertexNormals();
  }
}
