import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import {
  lerp3,
  tangentFrame,
  tmp,
  surfaceOffsetDir,
  buildVertexFaceAdjacency,
  recomputeNormalsPartial
} from "./utils.js";
import { createNoise } from "./noise.js";
import { createIcosphereGeometry } from "./icosphere.js";
import { generateHeights } from "./maps.js";
import { applyCapClip, createCapUniforms } from "./cap-material.js";
import { applyGrassDetail } from "./grass-material.js";

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
    applyGrassDetail(this.material, 1.25);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.#buildGrid();
    /** Sousednost pro dílčí přepočet normál — jen dotčená oblast morphu, ne celá planeta. */
    this.adjacency = buildVertexFaceAdjacency(this.geometry.index, this.geometry.attributes.position.count);
    this._normalAccum = new Float32Array(this.geometry.attributes.position.count * 3);
    this._touchedFaces = new Set();
    this._touchedVerts = new Set();
  }

  /** Sada trojúhelníků/vrcholů dotčených danou sadou vrcholů (pro přepočet normál). */
  #facesForIndices(indices) {
    const faces = new Set();
    for (let k = 0; k < indices.length; k++) {
      const v = indices[k];
      for (let j = this.adjacency.start[v]; j < this.adjacency.start[v + 1]; j++) {
        faces.add(this.adjacency.list[j]);
      }
    }
    const verts = new Set();
    const idx = this.geometry.index;
    for (const f of faces) {
      verts.add(idx.getX(f * 3));
      verts.add(idx.getX(f * 3 + 1));
      verts.add(idx.getX(f * 3 + 2));
    }
    return { faces, verts };
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
    /** Mokrý písek u čáry vody — tmavší, "prosycený" tón, plynule přejde do sucha. */
    const wetW = Math.max(0.05, sandW * 0.3);
    if (elev < wetW) {
      const u = smoothFalloff(elev / wetW);
      lerp3(out, [0.4, 0.34, 0.24], [0.68, 0.52, 0.34], u);
      out[0] += grain * 0.04;
      out[1] += grain * 0.03;
      out[2] += grain * 0.018;
      return out;
    }
    if (elev < sandW) {
      const u = smoothFalloff((elev - wetW) / Math.max(sandW - wetW, 0.05));
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

    const rockStart = 3.5;
    const rockFull = 5;
    if (elev > rockStart) {
      const rockT = smoothFalloff(Math.min(1, (elev - rockStart) / (rockFull - rockStart)));
      const gray = [
        0.44 + grain * 0.06 + beachN * 0.015,
        0.42 + grain * 0.05 + beachN * 0.015,
        0.4 + grain * 0.04
      ];
      lerp3(out, out, gray, rockT);
      if (elev > rockFull) {
        const highT = smoothFalloff(Math.min(1, (elev - rockFull) / 6));
        lerp3(out, out, [0.35, 0.34, 0.32], highT * 0.4);
      }
    }
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
    this.morphVersion = 0;
    this.scorchMask = new Float32Array(count);
    this.scorchCoreMask = new Float32Array(count);
    this.tornadoTrailMask = new Float32Array(count);
    this.iceTrailLife = new Float32Array(count);
  }

  /** Sdílené kreslení kruhu na terén (m). */
  #paintDisk(centerDir, radiusM, apply) {
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
      if (dist > radiusM * 1.15) continue;

      const edgeT = 1 - dist / Math.max(radiusM, 1e-5);
      const tCl = Math.min(1, Math.max(0, edgeT));
      const mask = tCl * tCl * (3 - 2 * tCl);
      if (mask <= 0.001) continue;

      if (!apply(i, mask)) continue;
      const h = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      this.#writeColor(i, h, col);
      colAttr.setXYZ(i, col[0], col[1], col[2]);
      any = true;
    }
    if (any) colAttr.needsUpdate = true;
  }

  /** Trvalá šedá stopa tornáda. */
  paintTornadoTrail(centerDir, radiusM = 2.1) {
    this.#paintDisk(centerDir, radiusM, (i, mask) => {
      const prev = this.tornadoTrailMask[i];
      const next = Math.min(1, Math.max(prev, mask * 0.94));
      if (next <= prev + 1e-5) return false;
      this.tornadoTrailMask[i] = next;
      return true;
    });
  }

  /** Bílá ledová stopa — život v sekundách (max 10). */
  paintIceTrail(centerDir, radiusM = 1.7, life = 10) {
    this.#paintDisk(centerDir, radiusM, (i, mask) => {
      const next = Math.max(this.iceTrailLife[i], mask * life);
      if (next <= this.iceTrailLife[i] + 1e-5) return false;
      this.iceTrailLife[i] = next;
      return true;
    });
  }

  /** Zeslabení mizejících ledových stop. */
  updateIceTrails(dt) {
    const pos = this.geometry.attributes.position;
    const colAttr = this.geometry.attributes.color;
    const col = tmp.col;
    let any = false;
    for (let i = 0; i < this.iceTrailLife.length; i++) {
      const life = this.iceTrailLife[i];
      if (life <= 0) continue;
      this.iceTrailLife[i] = Math.max(0, life - dt);
      const h = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      this.#writeColor(i, h, col);
      colAttr.setXYZ(i, col[0], col[1], col[2]);
      any = true;
    }
    if (any) colAttr.needsUpdate = true;
  }

  /**
   * Spálená zem v radiu (m). `solidRadiusMeters` vytvoří trvalé plně černé
   * jádro; vnější část stále používá měkký nepravidelný přechod.
   */
  scorch(centerDir, radiusMeters, irregular = false, solidRadiusMeters = 0) {
    const radius = radiusMeters * 1.35;
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

      let rEff = radius;
      if (irregular) {
        const px = dx - ndx;
        const py = dy - ndy;
        const pz = dz - ndz;
        const n =
          Math.sin(px * 37.1 + py * 19.7 + pz * 53.3) * 0.5 +
          Math.sin(px * 71.3 - py * 41.9 + pz * 13.1) * 0.5;
        const u = n * 0.5 + 0.5;
        rEff = radius * (0.9 + u * 0.12);
      }

      const fadeEnd = rEff * 1.38;
      const t = 1 - dist / Math.max(fadeEnd, 1e-5);
      if (t <= 0 && dist > solidRadiusMeters) continue;
      const tCl = Math.min(1, Math.max(0, t));
      const w = tCl * tCl * tCl * (tCl * (tCl * 6 - 15) + 10);
      const mask = dist <= solidRadiusMeters ? 1 : Math.pow(tCl, 0.32) * w;
      this.scorchMask[i] = Math.min(1, Math.max(this.scorchMask[i], mask * 0.96));
      if (dist <= solidRadiusMeters) this.scorchCoreMask[i] = 1;
      const h = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      this.#writeColor(i, h, col);
      colAttr.setXYZ(i, col[0], col[1], col[2]);
      any = true;
    }
    if (any) colAttr.needsUpdate = true;
  }

  /**
   * Spálenina podle libovolného pole — `field(dx, dy, dz)` vrací intenzitu 0..1
   * pro směr vrcholu. Používá stopa lávy, která není kruhová.
   */
  scorchField(centerDir, radiusMeters, field) {
    const clen = Math.hypot(centerDir.x, centerDir.y, centerDir.z) || 1;
    const ndx = centerDir.x / clen;
    const ndy = centerDir.y / clen;
    const ndz = centerDir.z / clen;
    const cosR = Math.cos(Math.min(Math.PI, radiusMeters / CONFIG.planetR));
    const pos = this.geometry.attributes.position;
    const colAttr = this.geometry.attributes.color;
    const col = tmp.col;
    let any = false;

    for (let i = 0; i < pos.count; i++) {
      const dx = this.dirs[i * 3];
      const dy = this.dirs[i * 3 + 1];
      const dz = this.dirs[i * 3 + 2];
      if (dx * ndx + dy * ndy + dz * ndz < cosR) continue;
      const mask = field(dx, dy, dz);
      if (!(mask > 0.004)) continue;
      const next = Math.min(1, Math.max(this.scorchMask[i], mask));
      if (next <= this.scorchMask[i] + 1e-4) continue;
      this.scorchMask[i] = next;
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
    const inv = 1 / (Math.hypot(dx, dy, dz) || 1);
    const beachN = this.noise.fbm(dx * inv * 11.2 + 17, dy * inv * 11.2, dz * inv * 11.2);
    const grain = this.noise.fbm(dx * inv * 34 + 41, dy * inv * 34, dz * inv * 34);
    const s = this.scorchMask[i];
    if (s > 0.001) {
      const patch = grain * 0.56 + beachN * 0.44;
      const mottle = patch * patch * (3 - 2 * patch);
      const core = this.scorchCoreMask[i];
      const eff = Math.max(s * (0.72 + 0.28 * mottle), core * 0.94);
      const tone = 0.016 + mottle * 0.042;
      const br = tone * (0.72 + 0.28 * mottle);
      const bg = tone * (0.97 + 0.03 * mottle);
      const bb = tone * (0.9 + 0.08 * mottle);
      col[0] = col[0] * (1 - eff) + br * eff;
      col[1] = col[1] * (1 - eff) + bg * eff;
      col[2] = col[2] * (1 - eff) + bb * eff;
    }

    const tornado = this.tornadoTrailMask[i];
    if (tornado > 0.001) {
      const u = tornado * tornado * (3 - 2 * tornado);
      const gr = 0.36 + grain * 0.04;
      const gg = 0.35 + grain * 0.035;
      const gb = 0.33 + grain * 0.03;
      col[0] = col[0] * (1 - u) + gr * u;
      col[1] = col[1] * (1 - u) + gg * u;
      col[2] = col[2] * (1 - u) + gb * u;
    }

    const iceLife = this.iceTrailLife[i];
    if (iceLife > 0.001) {
      const t = Math.min(1, iceLife / 10);
      const u = t * t * (3 - 2 * t);
      const wr = 0.88 + beachN * 0.03;
      const wg = 0.92 + beachN * 0.025;
      const wb = 0.97 + beachN * 0.02;
      col[0] = col[0] * (1 - u) + wr * u;
      col[1] = col[1] * (1 - u) + wg * u;
      col[2] = col[2] * (1 - u) + wb * u;
    }
  }

  /**
   * Elevace (+1) nebo deprese (−1) kolem bodu — plynulý morph ~spellDuration.
   * `opts.radius` / `opts.amount` (m) přebijí výchozí hodnoty kouzla (kráter komety).
   * @returns {boolean}
   */
  beginMorph(centerDir, sign, duration = CONFIG.spellDuration, opts = {}) {
    const cx = centerDir.x;
    const cy = centerDir.y;
    const cz = centerDir.z;
    const clen = Math.hypot(cx, cy, cz) || 1;
    const ndx = cx / clen;
    const ndy = cy / clen;
    const ndz = cz / clen;

    const radiusM = opts.radius ?? CONFIG.spellRadius;
    const amountM = opts.amount ?? CONFIG.spellAmount;
    const cosR = Math.cos(radiusM / CONFIG.planetR);
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
      let d = sign * amountM * w;
      const h1 = Math.min(CONFIG.maxR * 0.98, Math.max(CONFIG.minR, h0 + d));
      d = h1 - h0;
      if (Math.abs(d) < 1e-4) continue;
      indices.push(i);
      startH.push(h0);
      deltaH.push(d);
    }
    if (!indices.length) return false;

    const { faces, verts } = this.#facesForIndices(indices);
    this.morphs.push({
      indices,
      startH,
      deltaH,
      /** duration 0 = hotovo hned v příštím snímku (okamžitý kráter) */
      duration: Math.max(0.001, duration),
      elapsed: 0,
      normalFaces: faces,
      normalVerts: verts,
      cap: { x: ndx, y: ndy, z: ndz, cos: cosR }
    });
    return true;
  }

  /** Průměrná úroveň terénu na patě sopky — kráter pak stojí vodorovně. */
  #volcanoBaseLevel(center, east, north, radiusM) {
    const probe = new THREE.Vector3();
    let sum = 0;
    for (let k = 0; k < 24; k++) {
      const az = (k / 24) * Math.PI * 2;
      surfaceOffsetDir(center, east, north, az, radiusM, probe);
      sum += Math.max(CONFIG.waterLevel, this.height(probe));
    }
    return sum / 24;
  }

  /** Azimut nejnižšího okolí — tam se prolomí okraj kráteru a poteče láva. */
  #downhillAzimuth(center, east, north, radiusM) {
    const probe = new THREE.Vector3();
    let bestAz = 0;
    let bestH = Infinity;
    for (let k = 0; k < 32; k++) {
      const az = (k / 32) * Math.PI * 2;
      surfaceOffsetDir(center, east, north, az, radiusM, probe);
      const h = this.height(probe);
      if (h < bestH) {
        bestH = h;
        bestAz = az;
      }
    }
    return bestAz;
  }

  /**
   * Sopka — mírně konkávní svahy (nejstrmější pod okrajem, u paty splývají
   * s terénem), vodorovný okraj kráteru, ploché dno a dva průlomy v okraji —
   * hlavní na straně spádu terénu, menší protilehlý.
   * @returns {{center:THREE.Vector3, baseLevel:number, rimLevel:number,
   *   floorLevel:number, craterRadius:number, floorRadius:number,
   *   coneRadius:number, notchAzimuth:number}|null}
   */
  beginVolcanoMorph(centerDir, opts = {}) {
    const center = new THREE.Vector3().copy(centerDir).normalize();
    const east = new THREE.Vector3();
    const north = new THREE.Vector3();
    tangentFrame(center, east, north);

    const coneR = opts.coneRadius ?? 14;
    const rimH = opts.coneHeight ?? 7;
    const craterR = opts.craterRadius ?? 3.4;
    const craterD = opts.craterDepth ?? 2.4;
    const floorR = opts.craterFloorRadius ?? craterR * 0.47;
    /** >1 = konkávní svah; 1 = přímý kužel */
    const flankPow = opts.flankPow ?? 1.4;
    const notchDrop = opts.notchDrop ?? 1;
    const secondaryNotchDrop = opts.secondaryNotchDrop ?? notchDrop * 0.45;
    const gullyAmp = opts.gullyAmp ?? 0.35;
    const gullyCount = opts.gullyCount ?? 9;
    const outlineAmp = opts.outlineAmp ?? 0.1;
    const duration = opts.duration ?? CONFIG.spellDuration;

    const floorH = rimH - craterD;
    const centerH = this.height(center);
    const baseLevel = Math.max(
      this.#volcanoBaseLevel(center, east, north, coneR * 0.98),
      centerH - rimH * 0.55
    );
    const notchAz = this.#downhillAzimuth(center, east, north, coneR * 0.9);

    const maxR = coneR * (1 + outlineAmp);
    const cosR = Math.cos(maxR / CONFIG.planetR);
    const pos = this.geometry.attributes.position;
    const indices = [];
    const startH = [];
    const deltaH = [];
    const tangent = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      const dx = this.dirs[i * 3];
      const dy = this.dirs[i * 3 + 1];
      const dz = this.dirs[i * 3 + 2];
      const dot = dx * center.x + dy * center.y + dz * center.z;
      if (dot < cosR) continue;

      const r = Math.acos(Math.min(1, Math.max(-1, dot))) * CONFIG.planetR;
      const nz = this.noise.fbm(dx * 8.5 + 91, dy * 8.5 - 17, dz * 8.5 + 5);
      const rEff = coneR * (1 + nz * outlineAmp);
      const x = r / rEff;
      if (x >= 1) continue;

      let az = 0;
      if (r > 0.05) {
        tangent.set(dx, dy, dz).addScaledVector(center, -dot);
        az = Math.atan2(tangent.dot(north), tangent.dot(east));
      }

      const xFloor = floorR / rEff;
      const xRim = craterR / rEff;
      let prof;
      let rimW;
      if (x <= xFloor) {
        prof = floorH;
        rimW = 0;
      } else if (x <= xRim) {
        rimW = smoothFalloff((x - xFloor) / Math.max(1e-4, xRim - xFloor));
        prof = floorH + (rimH - floorH) * rimW;
      } else {
        const u = (x - xRim) / Math.max(1e-4, 1 - xRim);
        prof = rimH * Math.pow(1 - u, flankPow);
        rimW = Math.max(0, 1 - u / 0.4);
        const gullyW = Math.sin(Math.PI * Math.min(1, u / 0.85));
        prof -= gullyAmp * gullyW * (0.5 + 0.5 * Math.cos(gullyCount * az + nz * 3.1));
      }

      let dAz = az - notchAz;
      if (dAz > Math.PI) dAz -= Math.PI * 2;
      else if (dAz < -Math.PI) dAz += Math.PI * 2;
      const downhill = Math.max(0, Math.cos(dAz));
      const uphill = Math.max(0, -Math.cos(dAz));
      prof -= rimW * (
        notchDrop * downhill * downhill +
        secondaryNotchDrop * uphill * uphill
      );
      /** Jemná nepravidelnost okraje — další slabá místa pro přelití */
      prof -= rimW * 0.07 * (0.5 + 0.5 * Math.cos(3 * az + nz * 4.2));

      /** Kráter a okraj vodorovně, pata plynule do stávajícího terénu */
      const level = 1 - smoothFalloff(
        Math.min(1, Math.max(0, (x - xRim) / Math.max(1e-4, 1 - xRim)))
      );

      const h0 = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      let h1 = h0 + prof + (baseLevel - h0) * level;
      if (x > xRim) h1 = Math.max(h1, h0);
      h1 = Math.min(CONFIG.maxR * 0.98, Math.max(CONFIG.minR, h1));

      const d = h1 - h0;
      if (Math.abs(d) < 1e-4) continue;
      indices.push(i);
      startH.push(h0);
      deltaH.push(d);
    }
    if (!indices.length) return null;

    const { faces, verts } = this.#facesForIndices(indices);
    this.morphs.push({
      indices,
      startH,
      deltaH,
      duration,
      elapsed: 0,
      normalFaces: faces,
      normalVerts: verts,
      onComplete: opts.onComplete ?? null,
      cap: { x: center.x, y: center.y, z: center.z, cos: cosR }
    });

    return {
      center,
      baseLevel,
      rimLevel: baseLevel + rimH,
      floorLevel: baseLevel + floorH,
      craterRadius: craterR,
      floorRadius: floorR,
      coneRadius: coneR,
      notchAzimuth: notchAz
    };
  }

  /** @returns {boolean} true pokud ještě běží nějaký morph */
  updateMorphs(dt) {
    if (!this.morphs.length) return false;
    this.morphVersion++;
    const pos = this.geometry.attributes.position;
    const colAttr = this.geometry.attributes.color;
    const col = tmp.col;
    let any = false;
    this._touchedFaces.clear();
    this._touchedVerts.clear();

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
      for (const f of morph.normalFaces) this._touchedFaces.add(f);
      for (const v of morph.normalVerts) this._touchedVerts.add(v);
      if (u >= 1) {
        const done = morph.onComplete;
        this.morphs.splice(m, 1);
        done?.();
      } else {
        any = true;
      }
    }

    pos.needsUpdate = true;
    colAttr.needsUpdate = true;
    /** Jen dotčená oblast — ne celá planeta (výrazně levnější na mobilu). */
    recomputeNormalsPartial(this.geometry, this._touchedFaces, this._touchedVerts, this._normalAccum);
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
