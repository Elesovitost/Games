import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { tangentFrame, disposeObject, tmp } from "./utils.js";

const LAVA_VERT = `
attribute float aEdge;
varying vec2 vUv;
varying float vEdge;
void main() {
  vUv = uv;
  vEdge = aEdge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const LAVA_FRAG = `
uniform float uTime;
uniform float uFade;
varying vec2 vUv;
varying float vEdge;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p *= 2.05;
    a *= 0.5;
  }
  return s;
}

void main() {
  float soft = smoothstep(0.0, 0.28, vEdge);
  if (soft < 0.02) discard;

  vec2 p = vUv - 0.5;
  float n = fbm(p * 5.5 + uTime * 0.18);
  float n2 = fbm(p * 11.0 - uTime * 0.25);
  float crust = smoothstep(0.35, 0.75, n);
  vec3 cold = vec3(0.35, 0.08, 0.02);
  vec3 hot = vec3(1.0, 0.42, 0.06);
  vec3 core = vec3(1.0, 0.82, 0.28);
  vec3 col = mix(hot, cold, crust * 0.75);
  col = mix(col, core, (1.0 - crust) * n2 * 0.7);
  float glow = (1.0 - crust) * (0.4 + 0.25 * sin(uTime * 3.0 + n * 8.0));
  col += vec3(1.0, 0.35, 0.05) * glow;

  float alpha = soft * uFade * (0.88 + n2 * 0.1);
  gl_FragColor = vec4(col, alpha);
}
`;

function hash2(ax, ay) {
  const s = Math.sin(ax * 127.1 + ay * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function createBubble() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshBasicMaterial({
      color: 0xffcc44,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      fog: false
    })
  );
}

function buildLavaMesh(terrain, centerLocal, baseRad, seed) {
  const up = centerLocal.clone().normalize();
  tangentFrame(up, tmp.east, tmp.north);
  const east = tmp.east.clone();
  const north = tmp.north.clone();
  const rings = 10;
  const segs = 36;
  const edgeR = new Float32Array(segs);
  for (let s = 0; s < segs; s++) {
    const a = (s / segs) * Math.PI * 2;
    const n1 = hash2(seed + Math.cos(a) * 3.1, seed + Math.sin(a) * 3.1);
    const n2 = hash2(seed * 1.7 + Math.cos(a * 2.3), seed * 0.9 + Math.sin(a * 2.3));
    edgeR[s] = baseRad * (0.72 + n1 * 0.38 + n2 * 0.18);
  }

  const positions = [];
  const uvs = [];
  const edges = [];
  const indices = [];

  const centerH = terrain.height(up);
  const centerPos = up.clone().multiplyScalar(centerH + 0.06);
  positions.push(centerPos.x, centerPos.y, centerPos.z);
  uvs.push(0.5, 0.5);
  edges.push(1);

  const dir = tmp.dir;
  const sample = tmp.dir2;
  for (let r = 1; r <= rings; r++) {
    const rt = r / rings;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const rad = edgeR[s] * rt;
      const jitter = 1 + (hash2(seed + r * 0.3 + s * 0.17, seed * 2.1) - 0.5) * 0.06 * rt;
      sample.copy(up)
        .addScaledVector(east, Math.cos(a) * rad * jitter / CONFIG.planetR)
        .addScaledVector(north, Math.sin(a) * rad * jitter / CONFIG.planetR)
        .normalize();
      const h = terrain.height(sample);
      dir.copy(sample).multiplyScalar(h + 0.05 + (1 - rt) * 0.02);
      positions.push(dir.x, dir.y, dir.z);
      uvs.push(0.5 + Math.cos(a) * rt * 0.5, 0.5 + Math.sin(a) * rt * 0.5);
      const soft = 1 - Math.pow(rt, 1.35);
      edges.push(Math.max(0, soft - (hash2(s * 0.4, r * 0.7 + seed) * 0.12 * rt)));
    }
  }

  for (let s = 0; s < segs; s++) {
    const a = 1 + s;
    const b = 1 + ((s + 1) % segs);
    indices.push(0, a, b);
  }
  for (let r = 0; r < rings - 1; r++) {
    const row = 1 + r * segs;
    const next = 1 + (r + 1) * segs;
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      const a = row + s;
      const b = row + s2;
      const c = next + s;
      const d = next + s2;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute("aEdge", new THREE.Float32BufferAttribute(edges, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return { geo, up, east, north, centerPos, edgeR };
}

export class LavaPools {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.seed = 1;
  }

  spawn(localPos, seed) {
    if (seed != null) this.seed = seed >>> 0;
    else this.seed += 1.618;
    const rad = CONFIG.lavaRadius;
    const built = buildLavaMesh(this.game.terrain, localPos, rad, this.seed);
    const group = new THREE.Group();

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFade: { value: 1 }
      },
      vertexShader: LAVA_VERT,
      fragmentShader: LAVA_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false
    });
    const disc = new THREE.Mesh(built.geo, mat);
    disc.renderOrder = 3;
    disc.raycast = () => {};
    group.add(disc);

    const light = new THREE.PointLight(0xff6611, 2.8, rad * 6);
    light.position.copy(built.centerPos).addScaledVector(built.up, 0.55);
    group.add(light);

    let s = (this.seed * 1000) >>> 0;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };

    const bubbles = [];
    for (let i = 0; i < 16; i++) {
      const b = createBubble();
      const a = rnd() * Math.PI * 2;
      const rr = rnd() * 0.75;
      b.userData.phase = rnd() * Math.PI * 2;
      b.userData.speed = 0.7 + rnd() * 0.9;
      b.userData.ox = Math.cos(a) * rad * rr;
      b.userData.oy = Math.sin(a) * rad * rr;
      b.userData.size = 0.05 + rnd() * 0.09;
      b.scale.setScalar(b.userData.size);
      b.raycast = () => {};
      group.add(b);
      bubbles.push(b);
    }

    this.game.planetGroup.add(group);
    this.list.push({
      group,
      disc,
      light,
      bubbles,
      mat,
      up: built.up,
      east: built.east,
      north: built.north,
      center: built.centerPos,
      rad,
      age: 0,
      life: CONFIG.lavaLife,
      fadeTime: CONFIG.lavaFade
    });
  }

  clear() {
    for (const p of this.list) {
      this.game.planetGroup.remove(p.group);
      disposeObject(p.group);
    }
    this.list.length = 0;
    this.seed = 1;
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      const remain = p.life - p.age;
      let fade = 1;
      if (remain <= p.fadeTime) fade = Math.max(0, remain / p.fadeTime);
      fade *= Math.min(1, p.age / 0.35);

      p.mat.uniforms.uTime.value = p.age;
      p.mat.uniforms.uFade.value = fade;
      p.light.intensity = 2.8 * fade * (0.75 + 0.25 * Math.sin(p.age * 4.5));

      for (let k = 0; k < p.bubbles.length; k++) {
        const b = p.bubbles[k];
        const t = (p.age * b.userData.speed + b.userData.phase) % 1.6;
        const u = t / 1.6;
        const ox = b.userData.ox;
        const oy = b.userData.oy;
        tmp.dir.copy(p.up)
          .addScaledVector(p.east, ox / CONFIG.planetR)
          .addScaledVector(p.north, oy / CONFIG.planetR)
          .normalize();
        const gh = this.game.terrain.height(tmp.dir);
        const lift = u * 0.4;
        const pop = u > 0.75 ? 1 + (u - 0.75) * 3 : 1;
        b.position.copy(tmp.dir).multiplyScalar(gh + 0.08 + lift);
        b.visible = fade > 0.08;
        b.scale.setScalar(b.userData.size * pop * (0.7 + fade * 0.3));
        b.material.opacity = (u < 0.75 ? 0.9 : 1.4 * (1 - u)) * fade;
      }

      if (p.age >= p.life) {
        this.game.planetGroup.remove(p.group);
        disposeObject(p.group);
        this.list.splice(i, 1);
      }
    }
  }
}
