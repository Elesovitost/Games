import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tmp } from "./utils.js";

/** Směr z unit icosphere vrcholu — nemění se při morphu. */
export function extractDirections(geometry, out) {
  const pos = geometry.attributes.position;
  const n = pos.count;
  if (!out || out.length !== n * 3) {
    out = new Float32Array(n * 3);
  }
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    out[i * 3] = x / len;
    out[i * 3 + 1] = y / len;
    out[i * 3 + 2] = z / len;
  }
  return out;
}

/** Zkopíruje výšku/barvu z logické geometrie do render chunku (stejný směr). */
export function syncChunkFromMaster(chunk, terrain, directions) {
  if (!terrain.buckets) return;
  const cp = chunk.geometry.attributes.position;
  const cc = chunk.geometry.attributes.color;
  const mCol = terrain.geometry.attributes.color;
  const map = chunk.masterIndices;
  let changed = false;

  for (let i = 0; i < map.length; i++) {
    const vi = map[i];
    const dx = directions[vi * 3];
    const dy = directions[vi * 3 + 1];
    const dz = directions[vi * 3 + 2];
    if (dx === undefined) continue;
    tmp.dir.set(dx, dy, dz);
    const h = terrain.height(tmp.dir);
    cp.setXYZ(i, dx * h, dy * h, dz * h);
    const mi = terrain.nearestVertexIndex(tmp.dir);
    if (mi >= 0) {
      cc.setXYZ(i, mCol.getX(mi), mCol.getY(mi), mCol.getZ(mi));
    } else {
      terrain.colorFromHeight(h, 0, tmp.col, dx, dy, dz);
      cc.setXYZ(i, tmp.col[0], tmp.col[1], tmp.col[2]);
    }
    changed = true;
  }

  if (!changed) return;
  cp.needsUpdate = true;
  cc.needsUpdate = true;
  chunk.geometry.computeVertexNormals();
  chunk.geometry.computeBoundingSphere();
}

export function syncAllChunksFromMaster(chunks, terrain, directions) {
  for (let i = 0; i < chunks.length; i++) {
    syncChunkFromMaster(chunks[i], terrain, directions);
  }
}

/** Chunky v dosahu kouzla (úhlově). */
export function syncChunksNear(chunks, terrain, directions, centerLocal, radius) {
  const cx = centerLocal.x;
  const cy = centerLocal.y;
  const cz = centerLocal.z;
  const clen = Math.hypot(cx, cy, cz) || 1;
  const cnx = cx / clen;
  const cny = cy / clen;
  const cnz = cz / clen;
  const angLimit = radius / Math.max(clen, CONFIG.planetR) + 0.12;

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const d = c.centroidDir;
    const dot = d.x * cnx + d.y * cny + d.z * cnz;
    if (dot < Math.cos(angLimit)) continue;
    syncChunkFromMaster(c, terrain, directions);
  }
}
