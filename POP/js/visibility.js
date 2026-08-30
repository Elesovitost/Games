import * as THREE from "./three.js";
import { CONFIG } from "./config.js";

const _frustum = new THREE.Frustum();
const _projScreen = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _world = new THREE.Vector3();
const _planetCenter = new THREE.Vector3();
const _invMatrix = new THREE.Matrix4();

/** Plocha viditelné čtvrtiny koule ≈ 25 % — úhel 60° od osy pohledu. */
export const VISIBLE_CAP_DOT = CONFIG.visibleCapDot ?? 0.5;

/** Stínová mapa nad celou planetou — menší frustum dělá tmavý terén s receiveShadow. */
export const PLANET_SHADOW_HALF = CONFIG.shadowCapHalf ?? Math.ceil(CONFIG.maxR * 1.12);
export const SHADOW_CAP_HALF = PLANET_SHADOW_HALF;

/** Aktualizuje a vrátí frustum kamery. */
export function cameraFrustum(camera) {
  _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projScreen);
  return _frustum;
}

export function isWorldPointVisible(camera, worldPoint, radius = 6) {
  cameraFrustum(camera);
  _sphere.set(worldPoint, radius);
  return _frustum.intersectsSphere(_sphere);
}

export function isPlanetPointVisible(camera, planetGroup, localPoint, radius = 6) {
  const r = localPoint.length() || CONFIG.planetR;
  _world.copy(localPoint).normalize().multiplyScalar(r);
  planetGroup.localToWorld(_world);
  return isWorldPointVisible(camera, _world, radius);
}

export function isSurfaceDirVisible(camera, planetGroup, dir, radius = 8) {
  _world.copy(dir).normalize().multiplyScalar(CONFIG.planetR);
  planetGroup.localToWorld(_world);
  return isWorldPointVisible(camera, _world, radius);
}

export function isObjectVisible(camera, obj, radius = 6) {
  if (!obj) return true;
  obj.getWorldPosition(_world);
  return isWorldPointVisible(camera, _world, radius);
}

/**
 * Směr od středu planety ke kameře (local space planetGroup).
 * Viditelná „horní čtvrtina“ = body s dot(směr, viewAxis) >= VISIBLE_CAP_DOT.
 */
export function getPlanetViewAxis(camera, planetGroup, out) {
  _planetCenter.set(0, 0, 0);
  planetGroup.localToWorld(_planetCenter);
  out.copy(camera.position).sub(_planetCenter).normalize();
  _invMatrix.copy(planetGroup.matrixWorld).invert();
  out.transformDirection(_invMatrix);
  if (out.lengthSq() > 1e-10) out.normalize();
  return out;
}

export function isInVisibleCap(localDir, viewAxis, dotThreshold = VISIBLE_CAP_DOT) {
  const len = localDir.length() || 1;
  const dot = (localDir.x * viewAxis.x + localDir.y * viewAxis.y + localDir.z * viewAxis.z) / len;
  return dot >= dotThreshold;
}

export function configureShadowFrustum(sun, frustumHalf = SHADOW_CAP_HALF) {
  if (!sun?.castShadow) return;
  sun.target.position.set(0, 0, 0);
  const half = Math.max(frustumHalf, SHADOW_CAP_HALF);
  const cam = sun.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 20;
  cam.far = 560;
  cam.updateProjectionMatrix();
}

export function updateSunShadow(sun, planetGroup) {
  if (!sun?.castShadow) return;
  sun.target.position.set(0, 0, 0);
  if (planetGroup) planetGroup.updateMatrixWorld(true);
  sun.updateMatrixWorld(true);
  sun.target.updateMatrixWorld(true);
}
