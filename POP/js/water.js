import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { createIcosphereGeometry } from "./icosphere.js";
import {
  tangentFrame,
  tmp,
  buildVertexFaceAdjacency,
  recomputeNormalsPartial,
  capWithMargin,
  dirNearCaps
} from "./utils.js";
import { createCapUniforms } from "./cap-material.js";

const WATER_VERT = `
uniform float uTime;
uniform float uLevel;
uniform vec3 uViewAxis;
uniform float uVisibleDot;
attribute float aShore;
attribute float aMask;
varying vec3 vN;
varying vec3 vW;
varying float vShore;
varying float vMask;

void main() {
  vec3 dir = normalize(position);
  if (dot(dir, normalize(uViewAxis)) < uVisibleDot) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float t = uTime * 0.7;
  /** Velký pomalý příboj + drobné vlnky — v metrech, aby to bylo vidět i zblízka. */
  float swell =
    sin(dir.x * 3.1 + dir.z * 2.4 + t * 0.35) * 0.05
  + sin(dir.y * 2.6 - dir.x * 1.8 + t * 0.27) * 0.035;
  float ripples =
    sin(dir.x * 52.0 + dir.z * 41.0 + t * 1.1) * 0.028
  + sin(dir.y * 47.0 - dir.x * 38.0 - t * 0.85) * 0.02
  + sin(dir.z * 61.0 + dir.y * 29.0 + t * 1.35) * 0.014;
  float w = swell + ripples;
  float r = uLevel + w * (1.0 - aShore * 0.7);
  vec3 pos = dir * r;
  vShore = aShore;
  vMask = aMask;
  vN = normalize(mat3(modelMatrix) * dir);
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAG = `
uniform float uTime;
uniform vec3 uColor;
varying vec3 vN;
varying vec3 vW;
varying float vShore;
varying float vMask;

void main() {
  if (vMask < 0.04) discard;
  /** Maska je teď plynulá (ne 0/1) — okraj přiblendujeme, ať nekopíruje hrany hrubé sítě. */
  float edge = smoothstep(0.04, 0.6, vMask);
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.2);
  vec3 col = uColor;
  col += vec3(0.4, 0.55, 0.75) * fres * 0.22;

  float ripple = sin(vW.x * 0.55 + vW.z * 0.42 + uTime * 1.2) * 0.5
    + sin(vW.y * 0.48 - vW.x * 0.33 - uTime * 0.9) * 0.5;
  col += vec3(0.035, 0.055, 0.075) * ripple * (1.0 - vShore);

  /** Pěna u břehu — pulzuje a "leze" ke břehu, aby voda nepůsobila staticky. */
  float pulse = 0.5 + 0.5 * sin(uTime * 1.8 - vShore * 8.0);
  float crawl = fract(vShore * 3.0 - uTime * 0.35);
  float band = smoothstep(0.72, 1.0, crawl) + smoothstep(0.72, 1.0, 1.0 - crawl) * 0.4;
  float foam = smoothstep(0.4, 0.95, vShore) * (0.22 + 0.22 * pulse + band * 0.16);
  col = mix(col, vec3(0.9, 0.95, 1.0), foam);

  float alpha = (0.85 + fres * 0.08 + foam * 0.03) * edge;
  gl_FragColor = vec4(col, alpha);
}
`;

export class Water {
  constructor(planetGroup, terrain) {
    this.time = 0;
    this.terrain = terrain;
    this.planetGroup = planetGroup;
    this.capUniforms = createCapUniforms();
    this.#buildMesh();
  }

  #buildMesh() {
    if (this.mesh) {
      this.planetGroup.remove(this.mesh);
      this.mesh.geometry.dispose();
    }

    const geo = createIcosphereGeometry(CONFIG.waterLevel, CONFIG.waterSubdiv);
    this.#fillShore(geo);
    /** Sousednost pro dílčí přepočet normál — jen okolí pobřeží dotčené morphem. */
    this.adjacency = buildVertexFaceAdjacency(geo.index, geo.attributes.position.count);
    this._normalAccum = new Float32Array(geo.attributes.position.count * 3);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLevel: { value: CONFIG.waterLevel },
        uViewAxis: this.capUniforms.uViewAxis,
        uVisibleDot: this.capUniforms.uVisibleDot,
        uColor: {
          value: new THREE.Color(
            CONFIG.waterColor[0] * 1.15,
            CONFIG.waterColor[1] * 1.15,
            CONFIG.waterColor[2] * 1.05
          )
        }
      },
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    this.planetGroup.add(this.mesh);
  }

  setViewAxis(viewAxis) {
    this.capUniforms.uViewAxis.value.copy(viewAxis);
  }

  update(dt) {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
  }

  /** Po resetu / velké změně terénu — obnov masku vody / pobřeží úplně. */
  refreshShore() {
    if (!this.mesh) return;
    this.#fillShore(this.mesh.geometry);
    this.mesh.geometry.attributes.aShore.needsUpdate = true;
    this.mesh.geometry.attributes.aMask.needsUpdate = true;
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * Po morphu pevniny — obnov masku pobřeží jen v okolí aktivních morphů
   * (`terrain.morphs`), ne na celé vodní ploše. Bez morphů = plný refresh.
   */
  refreshShoreNear(morphs, margin = 2.4) {
    if (!this.mesh) return;
    if (!morphs?.length) {
      this.refreshShore();
      return;
    }
    const geo = this.mesh.geometry;
    const pos = geo.attributes.position;
    const shoreAttr = geo.attributes.aShore;
    const maskAttr = geo.attributes.aMask;
    const shore = shoreAttr.array;
    const mask = maskAttr.array;
    const dir = tmp.dir;
    const east = tmp.east;
    const north = tmp.north;
    const sample = tmp.dir2;
    const caps = morphs.map((m) => capWithMargin(m.cap, margin));

    const touched = [];
    for (let i = 0; i < pos.count; i++) {
      dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      if (!dirNearCaps(dir, caps)) continue;
      this.#shoreAt(i, pos, shore, mask, dir, east, north, sample);
      touched.push(i);
    }
    if (!touched.length) return;

    shoreAttr.needsUpdate = true;
    maskAttr.needsUpdate = true;
    pos.needsUpdate = true;
    this.#recomputeNormalsFor(touched);
  }

  #recomputeNormalsFor(vertList) {
    const faces = new Set();
    for (const v of vertList) {
      for (let j = this.adjacency.start[v]; j < this.adjacency.start[v + 1]; j++) {
        faces.add(this.adjacency.list[j]);
      }
    }
    const verts = new Set();
    const idx = this.mesh.geometry.index;
    for (const f of faces) {
      verts.add(idx.getX(f * 3));
      verts.add(idx.getX(f * 3 + 1));
      verts.add(idx.getX(f * 3 + 2));
    }
    recomputeNormalsPartial(this.mesh.geometry, faces, verts, this._normalAccum);
  }

  #shoreAt(i, pos, shore, mask, dir, east, north, sample) {
    const surf = this.terrain.sampleSurface(dir);
    const elev = surf.h - CONFIG.waterLevel;
    const wet = surf.wet;
    /**
     * Vodní síť je o stupeň hrubší než terén (waterSubdiv < icoSubdiv), takže
     * binární maska (0/1) na jednom vertexu dávala rovné hrany podél
     * trojúhelníků sítě — ostré "mnohoúhelníky" na břehu. Místo skoku
     * roztáhneme masku do plynulého přechodu přes širší výškové pásmo, takže
     * hranice vody se stočí přes víc vertexů/trojúhelníků a opíše skutečný
     * tvar terénu místo hran sítě. Stojí to jen trochu jiná aritmetika,
     * žádná další geometrie ani vzorky navíc.
     *
     * `wet` = spojení s původním mořem. Suchá vnitrozemská jáma pod hladinou
     * má wet=0, voda se tam neukáže, dokud se nepropojí s oceánem.
     */
    const FADE_END = 1.4;
    if (wet < 0.04 || elev > FADE_END) {
      mask[i] = 0;
      shore[i] = 0;
      return;
    }
    const t = Math.max(0, elev) / FADE_END;
    const s = t * t * (3 - 2 * t);
    mask[i] = (1 - s) * wet;

    if (elev <= 0.08) {
      tangentFrame(dir, east, north);
      let near = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        sample.copy(dir)
          .addScaledVector(east, Math.cos(a) * 0.01)
          .addScaledVector(north, Math.sin(a) * 0.01)
          .normalize();
        const he = this.terrain.height(sample) - CONFIG.waterLevel;
        if (he > 0.08) near = Math.max(near, 0.7);
        else if (he > 0.03) near = Math.max(near, 0.35);
      }
      shore[i] = near;
    } else {
      shore[i] = 0;
    }
    pos.setXYZ(i, dir.x * CONFIG.waterLevel, dir.y * CONFIG.waterLevel, dir.z * CONFIG.waterLevel);
  }

  #fillShore(geo) {
    const pos = geo.attributes.position;
    const shore = new Float32Array(pos.count);
    const mask = new Float32Array(pos.count);
    const east = tmp.east;
    const north = tmp.north;
    const dir = tmp.dir;
    const sample = tmp.dir2;

    for (let i = 0; i < pos.count; i++) {
      dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      this.#shoreAt(i, pos, shore, mask, dir, east, north, sample);
    }

    geo.setAttribute("aShore", new THREE.BufferAttribute(shore, 1));
    geo.setAttribute("aMask", new THREE.BufferAttribute(mask, 1));
    geo.computeVertexNormals();
  }
}
