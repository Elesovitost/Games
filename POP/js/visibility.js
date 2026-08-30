import * as THREE from "./three.js";
import { CONFIG } from "./config.js";

const _planetCenter = new THREE.Vector3();
const _invMatrix = new THREE.Matrix4();

/** Směr od středu planety ke kameře (local space planetGroup). */
export function getPlanetViewAxis(camera, planetGroup, out) {
  _planetCenter.set(0, 0, 0);
  planetGroup.localToWorld(_planetCenter);
  out.copy(camera.position).sub(_planetCenter).normalize();
  _invMatrix.copy(planetGroup.matrixWorld).invert();
  out.transformDirection(_invMatrix);
  if (out.lengthSq() > 1e-10) out.normalize();
  return out;
}

export function configureShadowFrustum(sun, half = CONFIG.shadowFrustumHalf) {
  if (!sun?.castShadow) return;
  sun.target.position.set(0, 0, 0);
  const cam = sun.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  const sunDist = sun.position.length();
  const extent = half + 8;
  cam.near = Math.max(1, sunDist - extent);
  cam.far = sunDist + extent;
  cam.updateProjectionMatrix();
}

export function updateSunShadow(sun, planetGroup) {
  if (!sun) return;
  sun.target.position.set(0, 0, 0);
  planetGroup?.updateMatrixWorld(true);
  sun.updateMatrixWorld(true);
  sun.target.updateMatrixWorld(true);
}
