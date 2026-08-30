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
void main() {
  float h = clamp(vDir.y * 0.78 + 0.22, 0.0, 1.0);
  vec3 zenith = vec3(0.12, 0.32, 0.72);
  vec3 mid = vec3(0.38, 0.62, 0.92);
  vec3 horizon = vec3(0.78, 0.72, 0.58);
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.34, h));
  col = mix(col, zenith, smoothstep(0.28, 0.98, h));
  float glow = pow(1.0 - abs(vDir.y), 5.0) * 0.22;
  col += vec3(1.0, 0.78, 0.42) * glow;
  vec3 sd = normalize(uSunDir);
  float sunDot = max(dot(normalize(vDir), sd), 0.0);
  col += vec3(1.0, 0.94, 0.72) * pow(sunDot, 96.0) * 0.9;
  col += vec3(1.0, 0.82, 0.45) * pow(sunDot, 6.0) * 0.28;
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  constructor(planetGroup) {
    this.group = planetGroup;
    const geo = new THREE.SphereGeometry(CONFIG.maxR * 3.2, 40, 24);
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
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 2;
  sun.target.position.set(0, 0, 0);
  const cam = sun.shadow.camera;
  cam.near = 20;
  cam.far = 560;
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
