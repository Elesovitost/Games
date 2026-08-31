import * as THREE from "./three.js";
import { CONFIG } from "./config.js";

const _sunLocal = new THREE.Vector3();

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = `
uniform vec3 uSunDir;
varying vec3 vDir;

float smoothGrad(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float starField(vec3 dir) {
  float u = atan(dir.z, dir.x) * 0.15915494 + 0.5;
  float v = asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989 + 0.5;
  vec2 uv = vec2(u, v) * 520.0;
  vec2 id = floor(uv);
  vec2 f = fract(uv);
  float h = hash12(id);
  if (h < 0.982) return 0.0;
  vec2 pos = vec2(hash12(id + 17.3), hash12(id + 41.9));
  float d = length(f - pos);
  return exp(-d * d * 480.0) * (0.5 + 0.5 * hash12(id + 3.7));
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 sd = normalize(uSunDir);
  float sunDot = dot(dir, sd);

  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

  // Noc — protilehlá strana slunce
  vec3 nightZenith = vec3(0.012, 0.018, 0.045);
  vec3 nightHorizon = vec3(0.035, 0.042, 0.08);
  vec3 night = mix(nightHorizon, nightZenith, smoothGrad(0.05, 0.95, h));

  // Den — strana slunce
  vec3 dayZenith = vec3(0.34, 0.58, 0.94);
  vec3 dayHorizon = vec3(0.82, 0.78, 0.62);
  vec3 day = mix(dayHorizon, dayZenith, smoothGrad(0.06, 0.88, h));

  // Postupný přechod — mírně ostřejší než předchozí verze
  float dayAmt = sunDot * 0.5 + 0.5;
  dayAmt = pow(dayAmt, 0.62);
  dayAmt = smoothGrad(0.0, 1.0, dayAmt);
  vec3 col = mix(night, day, dayAmt);

  // Soumrak
  float twi = smoothGrad(-0.42, 0.06, sunDot) * (1.0 - smoothGrad(0.06, 0.68, sunDot));
  col += vec3(0.22, 0.10, 0.16) * twi * 0.20;
  col += vec3(0.18, 0.08, 0.04) * twi * (1.0 - h) * 0.16;

  // Teplé rozptýlení
  float scatter = smoothGrad(-0.22, 0.90, sunDot);
  col = mix(col, col + vec3(0.12, 0.09, 0.02), scatter * 0.32);

  // Obzor — den teplý, noc sotva viditelný
  float horiz = pow(1.0 - abs(dir.y), 5.0);
  col += mix(vec3(0.02, 0.025, 0.04), vec3(0.10, 0.09, 0.06), dayAmt) * horiz * 0.32;

  // Slunce (jen nad horizontem denní strany)
  float sunCore = pow(max(sunDot, 0.0), 120.0);
  float sunHalo = pow(max(sunDot, 0.0), 7.0);
  col += vec3(1.0, 0.95, 0.78) * sunCore * 0.82;
  col += vec3(1.0, 0.84, 0.50) * sunHalo * 0.18;

  // Hvězdy — noc plně, soumrak méně, den vůbec
  float starVis = 1.0 - smoothGrad(0.14, 0.58, dayAmt);
  starVis *= starVis;
  float horizonFade = smoothGrad(0.04, 0.28, abs(dir.y) + 0.06);
  float stars = starField(dir) * starVis * horizonFade;
  col += vec3(0.88, 0.93, 1.0) * stars * 1.25;

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  constructor(planetGroup) {
    this.group = planetGroup;
    const geo = new THREE.SphereGeometry(CONFIG.maxR * 3.2, 32, 18);
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { uSunDir: { value: new THREE.Vector3(0.6, 0.7, -0.3) } },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false
    });
    this.dome = new THREE.Mesh(geo, this.skyMat);
    this.dome.frustumCulled = false;
    this.dome.raycast = () => {};
    this.group.add(this.dome);
  }

  setSunDirection(sun) {
    if (!sun?.position) return;
    _sunLocal.copy(sun.position).normalize();
    this.skyMat.uniforms.uSunDir.value.copy(_sunLocal);
  }
}

/** Slunce v planetGroup — stejný prostor jako terén. */
export function createSun(planetGroup) {
  const sun = new THREE.DirectionalLight(0xfff1c8, 2.05);
  sun.position.set(220, 180, -70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(CONFIG.shadowMapSize, CONFIG.shadowMapSize);
  sun.shadow.radius = CONFIG.shadowSoftRadius;
  // Vyšší normalBias + mírný bias: méně acne / čárkování na svazích.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.08;
  sun.target.position.set(0, 0, 0);
  const cam = sun.shadow.camera;
  const sunDist = sun.position.length();
  const extent = CONFIG.shadowFrustumHalf + 8;
  cam.near = Math.max(1, sunDist - extent);
  cam.far = sunDist + extent;
  planetGroup.add(sun);
  planetGroup.add(sun.target);
  return sun;
}

export function cameraPose(focusDir) {
  const up = focusDir.clone().normalize();
  const focus = up.clone().multiplyScalar(CONFIG.planetR);
  let east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), up);
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0).cross(up);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const position = focus.clone()
    .addScaledVector(up, CONFIG.camHeight)
    .addScaledVector(north, -CONFIG.camBack);
  const target = focus.clone().addScaledVector(north, CONFIG.camLook);
  return { position, up, target };
}

export function placeCamera(camera, focusArr) {
  const focus = new THREE.Vector3(focusArr[0], focusArr[1], focusArr[2]);
  const pose = cameraPose(focus);
  camera.position.copy(pose.position);
  camera.up.copy(pose.up);
  camera.lookAt(pose.target);
  camera.updateProjectionMatrix();
}
