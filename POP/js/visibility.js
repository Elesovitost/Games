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

const _shadowTarget = new THREE.Vector3();

/** Stíny jen nad oblastí, kterou hráč vidí — vyšší rozlišení stínové mapy tam, kde záleží. */
export function focusShadowOnView(game, sun, frustumHalf = 58) {
  if (!sun?.castShadow) return;
  const w = game.wizard;
  if (w?.mesh) {
    _shadowTarget.copy(w.mesh.position);
  } else {
    _shadowTarget.set(0, CONFIG.planetR, 0);
  }
  sun.target.position.copy(_shadowTarget);
  const cam = sun.shadow.camera;
  const half = frustumHalf;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.updateProjectionMatrix();
}
