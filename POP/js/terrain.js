import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { lerp3, tmp } from "./utils.js";
import { createNoise } from "./noise.js";
import { createIcosphereGeometry } from "./icosphere.js";
import { generateMapHeights, getDefaultMap, getMap } from "./maps.js";

const DEFAULT_TERRAIN_OPTS = {
  icoSubdiv: CONFIG.icoSubdiv,
  treeShadows: true
};

export class Terrain {
  constructor(planetGroup, mapId = CONFIG.defaultMapId, opts = {}) {
    this.group = planetGroup;
    this.jobs = [];
    this.trees = null;
    this.#setOpts(opts);
    this.map = getMap(mapId);
    this.mapId = this.map.index;
    this.seed = this.map.seed >>> 0;
    this.noise = createNoise(this.seed);
    this.geometry = createIcosphereGeometry(CONFIG.planetR, this.icoSubdiv);
    this.#sculpt();
    this.mesh = new THREE.Mesh(
      this.geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.88,
        metalness: 0.02
      })
    );
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    planetGroup.add(this.mesh);
    this.#buildGrid();
    this.#scatterTrees();
  }

  rebuild(mapId = CONFIG.defaultMapId, opts = {}) {
    this.jobs = [];
    if (opts.icoSubdiv != null || opts.treeShadows != null) this.#setOpts(opts);
    this.map = getMap(mapId);
    this.mapId = this.map.index;
    this.seed = this.map.seed >>> 0;
    this.noise = createNoise(this.seed);
    if (this.trees) {
      this.group.remove(this.trees);
      this.trees.geometry.dispose();
      this.trees.material.dispose();
      this.trees = null;
    }
    this.geometry.dispose();
    this.geometry = createIcosphereGeometry(CONFIG.planetR, this.icoSubdiv);
    this.#sculpt();
    this.mesh.geometry = this.geometry;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.#buildGrid();
    this.#scatterTrees();
  }

  #setOpts(opts) {
    this.icoSubdiv = opts.icoSubdiv ?? DEFAULT_TERRAIN_OPTS.icoSubdiv;
    this.treeShadows = opts.treeShadows ?? DEFAULT_TERRAIN_OPTS.treeShadows;
  }

  getSpawnFocus(slot = 0) {
    const list = this.map?.spawnFocus || getDefaultMap().spawnFocus;
    return list[slot % list.length];
  }

  colorFromHeight(h, n, out, x, y, z) {
    const elev = h - CONFIG.waterLevel;
    if (elev <= 0.02) {
      out[0] = CONFIG.waterColor[0];
      out[1] = CONFIG.waterColor[1];
      out[2] = CONFIG.waterColor[2];
      return out;
    }
    let beachN = n || 0;
    let grain = 0;
    if (x !== undefined) {
      const inv = 1 / (Math.hypot(x, y, z) || 1);
      beachN = this.noise.fbm(x * inv * 11.2 + 17, y * inv * 11.2, z * inv * 11.2);
      grain = this.noise.fbm(x * inv * 34 + 41, y * inv * 34, z * inv * 34);
    }
    const sandW = 0.46 + beachN * 0.34;
    if (elev < sandW) {
      const u = smoothFalloff(elev / Math.max(sandW, 0.05));
      lerp3(out, [0.68, 0.52, 0.34], CONFIG.sandColor, u);
      out[0] += grain * 0.07;
      out[1] += grain * 0.05;
      out[2] += grain * 0.025;
      return out;
    }
    if (elev < sandW + 0.1) {
      lerp3(out, CONFIG.sandColor, CONFIG.landColor, smoothFalloff((elev - sandW) / 0.1));
      return out;
    }
    lerp3(out, CONFIG.landColor, [0.22, 0.5, 0.16], Math.min(1, (elev - 0.55) / 2.8));
    out[0] += beachN * 0.025;
    out[1] += beachN * 0.035;
    return out;
  }

  isLand(localPoint) {
    return localPoint.length() > CONFIG.waterLevel + 0.05;
  }

  height(dir) {
    const p = this.geometry.attributes.position;
    const nlen = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / nlen;
    const dy = dir.y / nlen;
    const dz = dir.z / nlen;
    const key = this.#dirToGrid(dx, dy, dz);
    const iv = (key / CONFIG.heightGrid) | 0;
    const iu = key - iv * CONFIG.heightGrid;
    let d1 = -Infinity;
    let d2 = -Infinity;
    let d3 = -Infinity;
    let v1 = -1;
    let v2 = -1;
    let v3 = -1;
    let l1 = CONFIG.planetR;
    let l2 = CONFIG.planetR;
    let l3 = CONFIG.planetR;
    for (let dv = -1; dv <= 1; dv++) {
      const jv = iv + dv;
      if (jv < 0 || jv >= CONFIG.heightGrid) continue;
      for (let du = -1; du <= 1; du++) {
        let ju = iu + du;
        if (ju < 0) ju += CONFIG.heightGrid;
        else if (ju >= CONFIG.heightGrid) ju -= CONFIG.heightGrid;
        const bucket = this.buckets[jv * CONFIG.heightGrid + ju];
        for (let b = 0; b < bucket.length; b++) {
          const vi = bucket[b];
          const x = p.getX(vi);
          const y = p.getY(vi);
          const z = p.getZ(vi);
          const vl = Math.hypot(x, y, z) || 1;
          const dot = (x * dx + y * dy + z * dz) / vl;
          if (dot > d1) {
            d3 = d2; v3 = v2; l3 = l2;
            d2 = d1; v2 = v1; l2 = l1;
            d1 = dot; v1 = vi; l1 = vl;
          } else if (dot > d2) {
            d3 = d2; v3 = v2; l3 = l2;
            d2 = dot; v2 = vi; l2 = vl;
          } else if (dot > d3) {
            d3 = dot; v3 = vi; l3 = vl;
          }
        }
      }
    }
    const hit = this.#radialHit(dx, dy, dz, v1, v2, v3);
    if (hit > 0) return hit;
    const w1 = 1 / Math.max(1e-5, 1 - d1);
    const w2 = 1 / Math.max(1e-5, 1 - d2);
    const w3 = 1 / Math.max(1e-5, 1 - d3);
    return (w1 * l1 + w2 * l2 + w3 * l3) / (w1 + w2 + w3);
  }

  forEachNear(centerLocal, radius, fn) {
    const p = this.geometry.attributes.position;
    const cx = centerLocal.x;
    const cy = centerLocal.y;
    const cz = centerLocal.z;
    const key = this.#dirToGrid(cx, cy, cz);
    const iv = (key / CONFIG.heightGrid) | 0;
    const iu = key - iv * CONFIG.heightGrid;
    const cellAng = Math.PI / CONFIG.heightGrid;
    const ang = radius / Math.max(Math.hypot(cx, cy, cz), CONFIG.planetR) + cellAng;
    const span = Math.max(1, Math.ceil(ang / cellAng) + 1);
    for (let dv = -span; dv <= span; dv++) {
      const jv = iv + dv;
      if (jv < 0 || jv >= CONFIG.heightGrid) continue;
      for (let du = -span; du <= span; du++) {
        let ju = ((iu + du) % CONFIG.heightGrid + CONFIG.heightGrid) % CONFIG.heightGrid;
        const bucket = this.buckets[jv * CONFIG.heightGrid + ju];
        for (let b = 0; b < bucket.length; b++) {
          const i = bucket[b];
          const x = p.getX(i);
          const y = p.getY(i);
          const z = p.getZ(i);
          const dist = Math.hypot(x - cx, y - cy, z - cz);
          if (dist <= radius) fn(i, x, y, z, dist);
        }
      }
    }
  }

  deform(centerLocal, mode, radius) {
    const positions = this.geometry.attributes.position;
    const colorAttr = this.geometry.attributes.color;
    const amount = mode === "swamp" ? 0.18 : CONFIG.spellAmount;
    const rad = radius || CONFIG.spellRadius;
    const col = tmp.col;

    this.forEachNear(centerLocal, rad, (i, x, y, z, dist) => {
      const falloff = smoothFalloff(1 - dist / rad);
      const len0 = Math.hypot(x, y, z) || 1;
      const inv = 1 / len0;
      let len = len0;
      if (mode === "elevate" || mode === "depress") {
        this.colorFromHeight(len, 0, col, x, y, z);
        colorAttr.setXYZ(i, col[0], col[1], col[2]);
      } else if (mode === "swamp") {
        len = Math.max(CONFIG.waterLevel, len - amount * falloff);
        colorAttr.setXYZ(
          i,
          CONFIG.swampColor[0] * (0.75 + falloff * 0.2),
          CONFIG.swampColor[1] * (0.75 + falloff * 0.2),
          CONFIG.swampColor[2] * (0.75 + falloff * 0.2)
        );
      } else if (mode === "scorch") {
        if (len0 <= CONFIG.waterLevel + 0.08) return;
        colorAttr.setXYZ(
          i,
          colorAttr.getX(i) * (1 - falloff) + 0.03 * falloff,
          colorAttr.getY(i) * (1 - falloff) + 0.025 * falloff,
          colorAttr.getZ(i) * (1 - falloff) + 0.02 * falloff
        );
      }
      positions.setXYZ(i, x * inv * len, y * inv * len, z * inv * len);
    });

    positions.needsUpdate = true;
    colorAttr.needsUpdate = true;
    if (mode !== "scorch") this.geometry.computeVertexNormals();
  }

  startMorph(centerLocal, mode) {
    const indices = [];
    const falloff = [];
    this.forEachNear(centerLocal, CONFIG.spellRadius, (i, x, y, z, dist) => {
      const u = 1 - dist / CONFIG.spellRadius;
      indices.push(i);
      falloff.push(smoothFalloff(u));
    });
    this.jobs.push({
      mode,
      indices,
      falloff,
      elapsed: 0,
      duration: CONFIG.spellDuration,
      amount: CONFIG.spellAmount
    });
  }

  update(dt) {
    if (!this.jobs.length) return;
    const positions = this.geometry.attributes.position;
    const colorAttr = this.geometry.attributes.color;
    let changed = false;
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      const job = this.jobs[i];
      const prev = job.elapsed;
      job.elapsed = Math.min(job.elapsed + dt, job.duration);
      const deltaAmt = job.amount * (job.elapsed / job.duration - prev / job.duration);
      if (deltaAmt !== 0) {
        this.#applyMorphDelta(job, deltaAmt);
        changed = true;
      }
      if (job.elapsed >= job.duration) this.jobs.splice(i, 1);
    }
    if (changed) {
      positions.needsUpdate = true;
      colorAttr.needsUpdate = true;
      if (!this.jobs.length) this.geometry.computeVertexNormals();
    }
  }

  pickStartDir(focus) {
    const v = tmp.v;
    const pos = this.geometry.attributes.position;
    const f = focus.clone().normalize();
    let bestScore = -Infinity;
    const dir = f.clone();
    // Drž pevninu u spawnového slotu — ať se hráči nerozjíždí na stejný kontinent.
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      const len = v.length();
      if (len < CONFIG.waterLevel + 0.35) continue;
      const nx = v.x / len;
      const ny = v.y / len;
      const nz = v.z / len;
      const align = nx * f.x + ny * f.y + nz * f.z;
      if (align < 0.72) continue;
      const elev = len - CONFIG.waterLevel;
      const score = align * 3 + Math.min(elev, 4) * 0.04;
      if (score > bestScore) {
        bestScore = score;
        dir.set(nx, ny, nz);
      }
    }
    if (bestScore > -Infinity) return dir;
    // Žádná pevnina ve slotu — zůstaň ve směru slotu (i nad vodou).
    return f;
  }

  #sculpt() {
    const pos = this.geometry.attributes.position;
    const idx = this.geometry.index;
    const heights = new Float32Array(pos.count);
    generateMapHeights(this.map || getDefaultMap(), heights, pos, this.noise);
    this.#smoothCoast(heights, idx, pos.count);
    const colors = new Float32Array(pos.count * 3);
    const col = tmp.col;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const dirLen = Math.hypot(x, y, z) || 1;
      const h = heights[i];
      pos.setXYZ(i, (x / dirLen) * h, (y / dirLen) * h, (z / dirLen) * h);
      this.colorFromHeight(h, 0, col, x, y, z);
      colors[i * 3] = col[0];
      colors[i * 3 + 1] = col[1];
      colors[i * 3 + 2] = col[2];
    }
    this.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.geometry.computeVertexNormals();
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), CONFIG.maxR);
  }

  #smoothCoast(heights, idx, count) {
    const acc = new Float32Array(count);
    const cnt = new Uint8Array(count);
    for (let iter = 0; iter < 3; iter++) {
      acc.fill(0);
      cnt.fill(0);
      for (let f = 0; f < idx.count; f += 3) {
        const a = idx.getX(f);
        const b = idx.getX(f + 1);
        const c = idx.getX(f + 2);
        acc[a] += heights[b] + heights[c];
        cnt[a] += 2;
        acc[b] += heights[a] + heights[c];
        cnt[b] += 2;
        acc[c] += heights[a] + heights[b];
        cnt[c] += 2;
      }
      for (let i = 0; i < count; i++) {
        const elev = heights[i] - CONFIG.waterLevel;
        if (elev <= 0.02) {
          heights[i] = CONFIG.waterLevel;
          continue;
        }
        if (elev > 1.2 || !cnt[i]) continue;
        const avg = acc[i] / cnt[i];
        const blend = elev < 0.7 ? 0.62 : 0.28;
        heights[i] = heights[i] * (1 - blend) + avg * blend;
        if (heights[i] < CONFIG.waterLevel) heights[i] = CONFIG.waterLevel;
      }
    }
  }

  #dirToGrid(x, y, z) {
    const len = Math.hypot(x, y, z) || 1;
    const u = Math.atan2(z, x);
    const v = Math.acos(Math.max(-1, Math.min(1, y / len)));
    let iu = Math.floor((u + Math.PI) / (2 * Math.PI) * CONFIG.heightGrid);
    let iv = Math.floor(v / Math.PI * CONFIG.heightGrid);
    iu = Math.max(0, Math.min(CONFIG.heightGrid - 1, iu));
    iv = Math.max(0, Math.min(CONFIG.heightGrid - 1, iv));
    return iv * CONFIG.heightGrid + iu;
  }

  #buildGrid() {
    this.buckets = new Array(CONFIG.heightGrid * CONFIG.heightGrid);
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i] = [];
    const p = this.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      this.buckets[this.#dirToGrid(p.getX(i), p.getY(i), p.getZ(i))].push(i);
    }
    const idx = this.geometry.index;
    const counts = new Uint8Array(p.count);
    for (let f = 0; f < idx.count; f += 3) {
      counts[idx.getX(f)]++;
      counts[idx.getX(f + 1)]++;
      counts[idx.getX(f + 2)]++;
    }
    const offsets = new Uint32Array(p.count);
    let total = 0;
    for (let i = 0; i < p.count; i++) {
      offsets[i] = total;
      total += counts[i];
    }
    const adj = new Uint32Array(total);
    const write = new Uint8Array(p.count);
    for (let f = 0; f < idx.count; f += 3) {
      for (let k = 0; k < 3; k++) {
        const v = idx.getX(f + k);
        adj[offsets[v] + write[v]++] = f;
      }
    }
    this.faceAdj = adj;
    this.faceAdjOff = offsets;
    this.faceAdjCount = counts;
  }

  #radialHit(dx, dy, dz, v1, v2, v3) {
    const p = this.geometry.attributes.position;
    const idx = this.geometry.index;
    let bestT = 0;
    let bestScore = -1;
    const tryVert = (vi) => {
      if (vi < 0) return;
      const n = this.faceAdjCount[vi];
      const off = this.faceAdjOff[vi];
      for (let i = 0; i < n; i++) {
        const f = this.faceAdj[off + i];
        const ia = idx.getX(f);
        const ib = idx.getX(f + 1);
        const ic = idx.getX(f + 2);
        const hit = rayTriangle(
          dx, dy, dz,
          p.getX(ia), p.getY(ia), p.getZ(ia),
          p.getX(ib), p.getY(ib), p.getZ(ib),
          p.getX(ic), p.getY(ic), p.getZ(ic)
        );
        if (!hit) continue;
        if (hit.inside) {
          bestT = hit.t;
          bestScore = 1;
          return true;
        }
        if (hit.score > bestScore) {
          bestScore = hit.score;
          bestT = hit.t;
        }
      }
      return false;
    };
    if (tryVert(v1) || tryVert(v2) || tryVert(v3)) return bestT;
    return bestScore > -0.2 ? bestT : 0;
  }

  #applyMorphDelta(job, deltaAmt) {
    const positions = this.geometry.attributes.position;
    const colorAttr = this.geometry.attributes.color;
    const sign = job.mode === "elevate" ? 1 : -1;
    const col = tmp.col;
    for (let k = 0; k < job.indices.length; k++) {
      const i = job.indices[k];
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const len0 = Math.sqrt(x * x + y * y + z * z);
      const inv = 1 / Math.max(len0, 1e-6);
      let len = len0 + sign * deltaAmt * job.falloff[k];
      if (len < CONFIG.waterLevel) len = CONFIG.waterLevel;
      if (len > CONFIG.maxR) len = CONFIG.maxR;
      positions.setXYZ(i, x * inv * len, y * inv * len, z * inv * len);
      this.colorFromHeight(len, 0, col, x, y, z);
      colorAttr.setXYZ(i, col[0], col[1], col[2]);
    }
  }

  #scatterTrees() {
    const dummy = new THREE.Object3D();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const v = tmp.v;
    const pos = this.geometry.attributes.position;
    const matrices = [];
    for (let i = 0; i < pos.count; i++) {
      if ((i * 13 + 7) % 401 !== 0) continue;
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      const h = v.length();
      if (h < CONFIG.waterLevel + 0.7) continue;
      v.normalize();
      dummy.position.copy(v).multiplyScalar(h + 0.45);
      dummy.quaternion.setFromUnitVectors(yAxis, v);
      dummy.scale.setScalar(0.75 + ((i * 17) % 10) * 0.04);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }
    if (!matrices.length) return;
    const trees = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.32, 1.05, 6),
      new THREE.MeshStandardMaterial({ color: 0x2f6b2a, roughness: 0.9, flatShading: true }),
      matrices.length
    );
    for (let i = 0; i < matrices.length; i++) trees.setMatrixAt(i, matrices[i]);
    trees.instanceMatrix.needsUpdate = true;
    trees.castShadow = this.treeShadows;
    trees.receiveShadow = this.treeShadows;
    trees.raycast = function () {};
    this.trees = trees;
    this.group.add(trees);
  }
}

function smoothFalloff(t) {
  return t * t * (3 - 2 * t);
}

function rayTriangle(dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-12 && det < 1e-12) return null;
  const inv = 1 / det;
  const sx = -ax;
  const sy = -ay;
  const sz = -az;
  const u = (sx * px + sy * py + sz * pz) * inv;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (t <= 0) return null;
  const eps = 0.02;
  return {
    t,
    inside: u >= -eps && v >= -eps && u + v <= 1 + eps,
    score: Math.min(u, v, 1 - u - v)
  };
}
