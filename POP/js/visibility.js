import * as THREE from "./three.js";
import { CONFIG } from "./config.js";

const _frustum = new THREE.Frustum();
const _projScreen = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const _world = new THREE.Vector3();

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

/** Bod na planetě (local space planetGroup) — je v zorném poli? */
export function isPlanetPointVisible(camera, planetGroup, localPoint, radius = 6) {
  const r = localPoint.length() || CONFIG.planetR;
  _world.copy(localPoint).normalize().multiplyScalar(r);
  planetGroup.localToWorld(_world);
  return isWorldPointVisible(camera, _world, radius);
}

/** Směr na povrchu planety (normalizovaný local vektor). */
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
 * Menší stínová mapa nad planetou — cíl slunce zůstává ve středu,
 * aby stíny neplavaly s hráčem.
 */
export function configureShadowFrustum(sun, frustumHalf = 72) {
  if (!sun?.castShadow) return;
  sun.target.position.set(0, 0, 0);
  const cam = sun.shadow.camera;
  cam.left = -frustumHalf;
  cam.right = frustumHalf;
  cam.top = frustumHalf;
  cam.bottom = -frustumHalf;
  cam.updateProjectionMatrix();
}
