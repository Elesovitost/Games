import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { createIcosphereGeometry } from "./icosphere.js";
import { tangentFrame, tmp } from "./utils.js";
import { VISIBLE_CAP_DOT } from "./visibility.js";

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
  float w =
    sin(dir.x * 52.0 + dir.z * 41.0 + t * 1.1) * 0.006
  + sin(dir.y * 47.0 - dir.x * 38.0 - t * 0.85) * 0.004
  + sin(dir.z * 61.0 + dir.y * 29.0 + t * 1.35) * 0.003;
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
  if (vMask < 0.5) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.2);
  vec3 col = uColor;
  col += vec3(0.4, 0.55, 0.75) * fres * 0.18;

  float ripple = sin(vW.x * 0.55 + vW.z * 0.42 + uTime * 1.2) * 0.5
    + sin(vW.y * 0.48 - vW.x * 0.33 - uTime * 0.9) * 0.5;
  col += vec3(0.03, 0.05, 0.07) * ripple * (1.0 - vShore);

  float pulse = 0.5 + 0.5 * sin(uTime * 1.8 - vShore * 8.0);
  float foam = smoothstep(0.45, 0.95, vShore) * (0.25 + 0.2 * pulse);
  col = mix(col, vec3(0.88, 0.93, 0.98), foam);

  float alpha = 0.62 + fres * 0.12 + foam * 0.08;
  gl_FragColor = vec4(col, alpha);
}
`;

export class Water {
  constructor(planetGroup, terrain, opts = {}) {
    this.time = 0;
    this.terrain = terrain;
    this.planetGroup = planetGroup;
    this.waterSubdiv = opts.waterSubdiv ?? CONFIG.waterSubdiv ?? 5;
    this.viewAxis = new THREE.Vector3(0, 1, 0);
    this.capCull = true;
    this.#buildMesh();
  }

  #buildMesh() {
    if (this.mesh) {
      this.planetGroup.remove(this.mesh);
      this.mesh.geometry.dispose();
    }

    const geo = createIcosphereGeometry(CONFIG.waterLevel, this.waterSubdiv);
    this.#fillShore(geo, this.terrain);

    if (!this.material) {
      this.material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uLevel: { value: CONFIG.waterLevel },
          uViewAxis: { value: this.viewAxis.clone() },
          uVisibleDot: { value: VISIBLE_CAP_DOT },
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
    }

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.raycast = () => {};
    this.planetGroup.add(this.mesh);
  }

  rebuild(terrain) {
    this.terrain = terrain;
    this.#buildMesh();
  }

  refresh() {
    this.#fillShore(this.mesh.geometry, this.terrain);
  }

  #fillShore(geo, terrain) {
    const pos = geo.attributes.position;
    const shore = new Float32Array(pos.count);
    const mask = new Float32Array(pos.count);
    const east = tmp.east;
    const north = tmp.north;
    const dir = tmp.dir;
    const sample = tmp.dir2;

    for (let i = 0; i < pos.count; i++) {
      dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      const elev = terrain.height(dir) - CONFIG.waterLevel;
      if (elev > 0.08) {
        mask[i] = 0;
        shore[i] = 0;
        continue;
      }
      mask[i] = 1;
      tangentFrame(dir, east, north);
      let near = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        sample.copy(dir)
          .addScaledVector(east, Math.cos(a) * 0.01)
          .addScaledVector(north, Math.sin(a) * 0.01)
          .normalize();
        const he = terrain.height(sample) - CONFIG.waterLevel;
        if (he > 0.08) near = Math.max(near, 0.7);
        else if (he > 0.03) near = Math.max(near, 0.35);
      }
      shore[i] = near;
      pos.setXYZ(
        i,
        dir.x * CONFIG.waterLevel,
        dir.y * CONFIG.waterLevel,
        dir.z * CONFIG.waterLevel
      );
    }

    geo.setAttribute("aShore", new THREE.BufferAttribute(shore, 1));
    geo.setAttribute("aMask", new THREE.BufferAttribute(mask, 1));
    geo.computeVertexNormals();
  }

  applyQuality(q) {
    const subdiv = q.waterSubdiv ?? CONFIG.waterSubdiv ?? 5;
    const capDot = q.visibleCapDot;
    this.capCull = capDot != null && q.terrainChunked !== false;
    if (this.material?.uniforms?.uVisibleDot) {
      this.material.uniforms.uVisibleDot.value = this.capCull ? capDot : -2;
    }
    if (subdiv === this.waterSubdiv && this.mesh) return;
    this.waterSubdiv = subdiv;
    this.#buildMesh();
    if (this.material?.uniforms?.uVisibleDot) {
      this.material.uniforms.uVisibleDot.value = this.capCull ? capDot : -2;
    }
  }

  setViewAxis(viewAxis) {
    this.viewAxis.copy(viewAxis);
    if (this.material?.uniforms?.uViewAxis) {
      this.material.uniforms.uViewAxis.value.copy(viewAxis);
    }
  }

  update(dt) {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
  }
}
