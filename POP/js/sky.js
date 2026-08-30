import * as THREE from "./three.js";
import { CONFIG } from "./config.js";
import { disposeObject } from "./utils.js";

const DEFAULT_SKY_OPTS = {
  cloudCount: 42,
  cloudCastShadow: false,
  skyDome: [40, 24],
  atmSphere: [48, 32],
  cloudShell: [48, 28],
  proceduralCloudShell: true
};

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = `
varying vec3 vDir;
void main() {
  float h = clamp(vDir.y * 0.78 + 0.22, 0.0, 1.0);
  vec3 zenith = vec3(0.12, 0.32, 0.72);
  vec3 mid = vec3(0.38, 0.62, 0.92);
  vec3 horizon = vec3(0.78, 0.72, 0.58);
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.34, h));
  col = mix(col, zenith, smoothstep(0.28, 0.98, h));
  float glow = pow(1.0 - abs(vDir.y), 5.0) * 0.22;
  col += vec3(1.0, 0.78, 0.42) * glow;
  gl_FragColor = vec4(col, 1.0);
}
`;

const ATM_VERT = `
varying vec3 vN;
varying vec3 vView;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = cameraPosition - w.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ATM_FRAG = `
varying vec3 vN;
varying vec3 vView;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.6);
  vec3 col = mix(vec3(0.35, 0.58, 1.0), vec3(1.0, 0.78, 0.48), fres * 0.4);
  gl_FragColor = vec4(col, fres * 0.34);
}
`;

const SHELL_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SHELL_FRAG = `
uniform float uTime;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.17, 0.23));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = p * 2.11 + 17.3;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 p = vDir * 4.2 + vec3(uTime * 0.01, 0.0, uTime * 0.006);
  float n = fbm(p);
  float n2 = fbm(p * 1.8 + 9.0);
  float cloud = smoothstep(0.5, 0.78, n * 0.65 + n2 * 0.35);
  cloud *= smoothstep(-0.15, 0.1, vDir.y) * smoothstep(0.95, 0.35, vDir.y);
  float shade = 0.92 + n2 * 0.08;
  vec3 col = vec3(1.0, 1.0, 1.0) * shade;
  float alpha = cloud * 0.28;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

function makeCloudTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const blobs = [
    [0.5, 0.5, 0.42, 1],
    [0.32, 0.48, 0.3, 0.95],
    [0.68, 0.48, 0.32, 0.95],
    [0.4, 0.36, 0.26, 0.88],
    [0.6, 0.36, 0.24, 0.88],
    [0.5, 0.64, 0.28, 0.9],
    [0.24, 0.54, 0.2, 0.75],
    [0.76, 0.54, 0.2, 0.75],
    [0.45, 0.55, 0.22, 0.7],
    [0.55, 0.44, 0.2, 0.7]
  ];
  for (let i = 0; i < blobs.length; i++) {
    const [ux, uy, ur, a] = blobs[i];
    const x = ux * size;
    const y = uy * size;
    const r = ur * size;
    const g = ctx.createRadialGradient(x, y, r * 0.05, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.4, `rgba(255,255,255,${a * 0.7})`);
    g.addColorStop(0.75, `rgba(255,255,255,${a * 0.25})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function randomDir(rng) {
  const u = rng();
  const v = rng();
  const theta = 2 * Math.PI * u;
  const y = 2 * v - 1;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  return new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta));
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Sky {
  constructor(world, opts = {}) {
    this.world = world;
    this.time = 0;
    this.opts = { ...DEFAULT_SKY_OPTS, ...opts };
    this.cloudRoot = new THREE.Group();
    world.add(this.cloudRoot);
    this.meshes = [];
    this.shell = null;
    this.#initMaterials();
    this.#addDome();
    this.#addAtmosphere();
    this.#addCloudShell();
    this.#spawnClouds();
  }

  rebuild(opts = {}) {
    this.dispose();
    this.opts = { ...DEFAULT_SKY_OPTS, ...opts };
    this.time = 0;
    this.cloudRoot = new THREE.Group();
    this.world.add(this.cloudRoot);
    this.meshes = [];
    this.shell = null;
    this.#initMaterials();
    this.#addDome();
    this.#addAtmosphere();
    this.#addCloudShell();
    this.#spawnClouds();
  }

  #initMaterials() {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });
    this.atmMat = new THREE.ShaderMaterial({
      vertexShader: ATM_VERT,
      fragmentShader: ATM_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      fog: false
    });
    this.shellMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false
    });
  }

  dispose() {
    if (this.cloudRoot) {
      this.world.remove(this.cloudRoot);
      disposeObject(this.cloudRoot);
    }
    for (const m of this.meshes) {
      this.world.remove(m);
      disposeObject(m);
    }
    this.meshes.length = 0;
    this.shell = null;
    this.skyMat?.dispose();
    this.atmMat?.dispose();
    this.shellMat?.dispose();
  }

  #addDome() {
    const [w, h] = this.opts.skyDome;
    const skyDome = new THREE.Mesh(new THREE.SphereGeometry(380, w, h), this.skyMat);
    skyDome.renderOrder = -10;
    skyDome.raycast = () => {};
    this.world.add(skyDome);
    this.meshes.push(skyDome);
  }

  #addAtmosphere() {
    const [w, h] = this.opts.atmSphere;
    const atm = new THREE.Mesh(new THREE.SphereGeometry(116, w, h), this.atmMat);
    atm.renderOrder = -5;
    atm.raycast = () => {};
    this.world.add(atm);
    this.meshes.push(atm);
  }

  #addCloudShell() {
    if (!this.opts.proceduralCloudShell) return;
    const [w, h] = this.opts.cloudShell;
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(148, w, h), this.shellMat);
    this.shell.renderOrder = -4;
    this.shell.raycast = () => {};
    this.world.add(this.shell);
    this.meshes.push(this.shell);
  }

  #spawnClouds() {
    const tex = makeCloudTexture();
    const geo = new THREE.PlaneGeometry(1, 1);
    const rng = mulberry(20260829);
    const zAxis = new THREE.Vector3(0, 0, 1);
    const count = this.opts.cloudCount;
    const allowShadow = this.opts.cloudCastShadow;

    for (let i = 0; i < count; i++) {
      const dir = randomDir(rng);
      if (dir.y < -0.35) dir.y = Math.abs(dir.y) * 0.4;
      dir.normalize();

      const big = rng() > 0.55;
      const base = big ? 28 + rng() * 36 : 10 + rng() * 14;
      const altitude = 125 + rng() * 30 + (big ? 8 : 0);
      const cluster = new THREE.Group();
      cluster.position.copy(dir).multiplyScalar(altitude);
      cluster.quaternion.setFromUnitVectors(zAxis, dir);

      const puffs = big ? 7 + (rng() * 5) | 0 : 4 + (rng() * 3) | 0;
      for (let k = 0; k < puffs; k++) {
        const mat = new THREE.MeshBasicMaterial({
          map: tex,
          color: 0xffffff,
          transparent: true,
          opacity: 0.88 + rng() * 0.12,
          depthWrite: false,
          alphaTest: 0.08,
          side: THREE.DoubleSide,
          fog: false
        });
        const puff = new THREE.Mesh(geo, mat);
        if (allowShadow) {
          puff.customDepthMaterial = new THREE.MeshDepthMaterial({
            depthPacking: THREE.RGBADepthPacking,
            map: tex,
            alphaTest: 0.72
          });
        }
        const sx = base * (0.65 + rng() * 0.75);
        const sy = base * (0.45 + rng() * 0.45);
        puff.scale.set(sx, sy, 1);
        puff.position.set(
          (rng() - 0.5) * base * 0.95,
          (rng() - 0.5) * base * 0.35,
          (rng() - 0.5) * base * 0.4
        );
        puff.rotation.z = (rng() - 0.5) * 1.1;
        puff.castShadow = allowShadow && big && rng() > 0.55;
        puff.receiveShadow = false;
        puff.raycast = () => {};
        cluster.add(puff);
      }

      this.cloudRoot.add(cluster);
    }
  }

  update(dt) {
    this.time += dt;
    if (this.shell) this.shellMat.uniforms.uTime.value = this.time;
    this.cloudRoot.rotation.y += dt * 0.0035;
  }
}

export function applySunQuality(sun, opts = {}) {
  if (!sun) return;
  sun.castShadow = opts.shadows !== false;
  if (!opts.shadows) return;
  const size = opts.shadowMapSize || 2048;
  sun.shadow.mapSize.set(size, size);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.08;
  sun.shadow.radius = opts.shadowRadius ?? 2;
  const half = opts.shadowFrustumHalf ?? 72;
  const cam = sun.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.updateProjectionMatrix();
}

export function createSun(world, opts = {}) {
  const sun = new THREE.DirectionalLight(0xfff1c8, 2.05);
  sun.position.set(220, 180, -70);
  sun.target.position.set(0, 0, 0);
  const cam = sun.shadow.camera;
  cam.near = 40;
  cam.far = 520;
  applySunQuality(sun, opts);
  world.add(sun);
  world.add(sun.target);
  return sun;
}

/** @param {THREE.Vector3|[number,number,number]} focusDir @param {{ alt?: number }=} opts */
export function cameraPose(focusDir, opts = {}) {
  let up;
  if (focusDir && typeof focusDir.x === "number") {
    up = new THREE.Vector3(focusDir.x, focusDir.y, focusDir.z).normalize();
  } else if (Array.isArray(focusDir) && focusDir.length >= 3) {
    up = new THREE.Vector3(focusDir[0], focusDir[1], focusDir[2]).normalize();
  } else {
    up = new THREE.Vector3(CONFIG.focusDir[0], CONFIG.focusDir[1], CONFIG.focusDir[2]).normalize();
  }
  const alt = opts.alt || 0;
  const focus = up.clone().multiplyScalar(CONFIG.planetR + alt);
  return cameraPoseAt(focus, up);
}

/** Pose kamery mířící na world bod s daným „nahoru“. */
export function cameraPoseAt(worldFocus, worldUp) {
  const up = worldUp.clone().normalize();
  let east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), up);
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0).cross(up);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const position = worldFocus.clone()
    .addScaledVector(up, CONFIG.camHeight)
    .addScaledVector(north, -CONFIG.camBack);
  const target = worldFocus.clone().addScaledVector(north, CONFIG.camLook);
  return { position, up, target };
}

export function applyCameraPose(camera, pose) {
  camera.position.copy(pose.position);
  camera.up.copy(pose.up);
  camera.lookAt(pose.target);
  camera.updateProjectionMatrix();
}

export function lerpCameraPose(camera, from, to, t) {
  const u = t * t * (3 - 2 * t);
  camera.position.lerpVectors(from.position, to.position, u);
  camera.up.copy(from.up).lerp(to.up, u).normalize();
  const target = from.target.clone().lerp(to.target, u);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

/** @param {THREE.Camera} camera @param {THREE.Vector3|[number,number,number]=} focusDir @param {{ alt?: number }=} opts */
export function placeCamera(camera, focusDir, opts = {}) {
  applyCameraPose(camera, cameraPose(focusDir, opts));
}
