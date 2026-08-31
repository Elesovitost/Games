import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { lerp3, tmp } from "./utils.js";
import { createNoise } from "./noise.js";
import { createIcosphereGeometry } from "./icosphere.js";
import { generateHeights } from "./maps.js";
import { applyCapClip, createCapUniforms } from "./cap-material.js";

export class Terrain {
  constructor(planetGroup) {
    this.group = planetGroup;
    this.seed = CONFIG.defaultMapSeed >>> 0;
    this.noise = createNoise(this.seed);
    this.capUniforms = createCapUniforms();
    this.geometry = createIcosphereGeometry(CONFIG.planetR, CONFIG.icoSubdiv);
    this.#sculpt();
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.02
    });
    applyCapClip(this.material, this.capUniforms);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.#buildGrid();
  }

  setViewAxis(viewAxis) {
    this.capUniforms.uViewAxis.value.copy(viewAxis);
  }

  intersectPick(raycaster) {
    return raycaster.intersectObject(this.mesh, false);
  }

  isLand(localPoint) {
    return localPoint.length() > CONFIG.waterLevel + 0.05;
  }

  height(dir) {
    if (!this.buckets) this.#buildGrid();
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
        if (!bucket) continue;
        for (let b = 0; b < bucket.length; b++) {
          const vi = bucket[b];
          const x = p.getX(vi);
          const y = p.getY(vi);
          const z = p.getZ(vi);
          const vl = Math.hypot(x, y, z) || 1;
          const dot = (x * dx + y * dy + z * dz) / vl;
          if (dot > d1) {
            d3 = d2; l3 = l2;
            d2 = d1; l2 = l1;
            d1 = dot; l1 = vl;
          } else if (dot > d2) {
            d3 = d2; l3 = l2;
            d2 = dot; l2 = vl;
          } else if (dot > d3) {
            d3 = dot; l3 = vl;
          }
        }
      }
    }
    const w1 = 1 / Math.max(1e-5, 1 - d1);
    const w2 = 1 / Math.max(1e-5, 1 - d2);
    const w3 = 1 / Math.max(1e-5, 1 - d3);
    return (w1 * l1 + w2 * l2 + w3 * l3) / (w1 + w2 + w3);
  }

  colorFromHeight(h, out, x, y, z) {
    const elev = h - CONFIG.waterLevel;
    if (elev <= 0.02) {
      out[0] = CONFIG.waterColor[0];
      out[1] = CONFIG.waterColor[1];
      out[2] = CONFIG.waterColor[2];
      return out;
    }
    let beachN = 0;
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

  #sculpt() {
    const pos = this.geometry.attributes.position;
    const idx = this.geometry.index;
    const count = pos.count;
    const heights = new Float32Array(count);
    generateHeights(heights, pos, this.noise);
    this.#smoothCoast(heights, idx, count);
    this.dirs = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const col = tmp.col;
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const dirLen = Math.hypot(x, y, z) || 1;
      const dx = x / dirLen;
      const dy = y / dirLen;
      const dz = z / dirLen;
      this.dirs[i * 3] = dx;
      this.dirs[i * 3 + 1] = dy;
      this.dirs[i * 3 + 2] = dz;
      const h = heights[i];
      pos.setXYZ(i, dx * h, dy * h, dz * h);
      this.colorFromHeight(h, col, dx, dy, dz);
      colors[i * 3] = col[0];
      colors[i * 3 + 1] = col[1];
      colors[i * 3 + 2] = col[2];
    }
    this.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.geometry.computeVertexNormals();
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), CONFIG.maxR);
    this.morphs = [];
    this._morphDirty = false;
    this.scorchMask = new Float32Array(count);
  }

  /** Spálená zem v radiu (m). irregular = nepravidelný okraj. */
  scorch(centerDir, radiusMeters, irregular = false) {
    const clen = Math.hypot(centerDir.x, centerDir.y, centerDir.z) || 1;
    const ndx = centerDir.x / clen;
    const ndy = centerDir.y / clen;
    const ndz = centerDir.z / clen;
    const pos = this.geometry.attributes.position;
    const colAttr = this.geometry.attributes.color;
    const col = tmp.col;
    let any = false;

    for (let i = 0; i < pos.count; i++) {
      const dx = this.dirs[i * 3];
      const dy = this.dirs[i * 3 + 1];
      const dz = this.dirs[i * 3 + 2];
      const dot = Math.min(1, Math.max(-1, dx * ndx + dy * ndy + dz * ndz));
      const dist = Math.acos(dot) * CONFIG.planetR;

      let rEff = radiusMeters;
      if (irregular) {
        // Nepravidelný okraj podle směru od středu úderu
        const px = dx - ndx;
        const py = dy - ndy;
        const pz = dz - ndz;
        const n =
          Math.sin(px * 37.1 + py * 19.7 + pz * 53.3) * 0.5 +
          Math.sin(px * 71.3 - py * 41.9 + pz * 13.1) * 0.5;
        const u = n * 0.5 + 0.5;
        rEff = radiusMeters * (0.55 + u * 0.55);
      }
      if (dist > rEff) continue;

      const t = 1 - dist / Math.max(rEff, 1e-5);
      const w = t * t * (3 - 2 * t);
      this.scorchMask[i] = Math.min(1, Math.max(this.scorchMask[i], w * 0.95));
      const h = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      this.#writeColor(i, h, col);
      colAttr.setXYZ(i, col[0], col[1], col[2]);
      any = true;
    }
    if (any) colAttr.needsUpdate = true;
  }

  #writeColor(i, h, col) {
    const dx = this.dirs[i * 3];
    const dy = this.dirs[i * 3 + 1];
    const dz = this.dirs[i * 3 + 2];
    this.colorFromHeight(h, col, dx, dy, dz);
    const s = this.scorchMask[i];
    if (s > 0.001) {
      col[0] = col[0] * (1 - s) + 0.18 * s;
      col[1] = col[1] * (1 - s) + 0.14 * s;
      col[2] = col[2] * (1 - s) + 0.11 * s;
    }
  }

  /**
   * Elevace (+1) nebo deprese (−1) kolem bodu — plynulý morph ~spellDuration.
   * @returns {boolean}
   */
  beginMorph(centerDir, sign) {
    const cx = centerDir.x;
    const cy = centerDir.y;
    const cz = centerDir.z;
    const clen = Math.hypot(cx, cy, cz) || 1;
    const ndx = cx / clen;
    const ndy = cy / clen;
    const ndz = cz / clen;

    const cosR = Math.cos(CONFIG.spellRadius / CONFIG.planetR);
    const pos = this.geometry.attributes.position;
    const indices = [];
    const startH = [];
    const deltaH = [];

    for (let i = 0; i < pos.count; i++) {
      const dx = this.dirs[i * 3];
      const dy = this.dirs[i * 3 + 1];
      const dz = this.dirs[i * 3 + 2];
      const dot = dx * ndx + dy * ndy + dz * ndz;
      if (dot < cosR) continue;
      const t = (dot - cosR) / Math.max(1e-5, 1 - cosR);
      const w = t * t * (3 - 2 * t);
      const h0 = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      let d = sign * CONFIG.spellAmount * w;
      const h1 = Math.min(CONFIG.maxR * 0.98, Math.max(CONFIG.minR, h0 + d));
      d = h1 - h0;
      if (Math.abs(d) < 1e-4) continue;
      indices.push(i);
      startH.push(h0);
      deltaH.push(d);
    }
    if (!indices.length) return false;

    this.morphs.push({
      indices,
      startH,
      deltaH,
      duration: CONFIG.spellDuration,
      elapsed: 0
    });
    return true;
  }

  /** @returns {boolean} true pokud ještě běží nějaký morph */
  updateMorphs(dt) {
    if (!this.morphs.length) return false;
    const pos = this.geometry.attributes.position;
    const colAttr = this.geometry.attributes.color;
    const col = tmp.col;
    let any = false;

    for (let m = this.morphs.length - 1; m >= 0; m--) {
      const morph = this.morphs[m];
      morph.elapsed += dt;
      const u = Math.min(1, morph.elapsed / morph.duration);
      const s = u * u * (3 - 2 * u);
      for (let k = 0; k < morph.indices.length; k++) {
        const i = morph.indices[k];
        const h = morph.startH[k] + morph.deltaH[k] * s;
        const dx = this.dirs[i * 3];
        const dy = this.dirs[i * 3 + 1];
        const dz = this.dirs[i * 3 + 2];
        pos.setXYZ(i, dx * h, dy * h, dz * h);
        this.#writeColor(i, h, col);
        colAttr.setXYZ(i, col[0], col[1], col[2]);
      }
      if (u >= 1) this.morphs.splice(m, 1);
      else any = true;
    }

    pos.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this._morphDirty = true;
    return any || this.morphs.length > 0;
  }

  consumeMorphDirty() {
    const d = this._morphDirty;
    this._morphDirty = false;
    return d;
  }

  /** Obnoví terén do výchozího stavu (stejný seed, bez morphů a spálenin). */
  reset() {
    this.morphs = [];
    this._morphDirty = false;
    const pos = this.geometry.attributes.position;
    const count = pos.count;
    for (let i = 0; i < count; i++) {
      const dx = this.dirs[i * 3];
      const dy = this.dirs[i * 3 + 1];
      const dz = this.dirs[i * 3 + 2];
      pos.setXYZ(i, dx * CONFIG.planetR, dy * CONFIG.planetR, dz * CONFIG.planetR);
    }
    pos.needsUpdate = true;
    this.#sculpt();
    this.buckets = null;
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
        // Hluboké moře — nechat podvodní terén
        if (elev < -0.45) continue;
        if (elev <= 0.04 && elev >= -0.2) {
          heights[i] = CONFIG.waterLevel;
          continue;
        }
        if (elev > 1.2 || !cnt[i]) continue;
        const avg = acc[i] / cnt[i];
        const blend = elev < 0.7 ? 0.62 : 0.28;
        heights[i] = heights[i] * (1 - blend) + avg * blend;
        if (heights[i] < CONFIG.waterLevel && elev > -0.25) {
          heights[i] = CONFIG.waterLevel;
        }
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
  }
}

function smoothFalloff(t) {
  return t * t * (3 - 2 * t);
}
