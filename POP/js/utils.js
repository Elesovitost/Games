import * as THREE from "./three.js";
import { CONFIG } from "./config.js";

export function lerp3(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

export function slerpDirection(out, a, b, t) {
  const dot = Math.min(Math.max(a.dot(b), -1), 1);
  if (dot > 0.9995) {
    out.copy(a).lerp(b, t).normalize();
    return out;
  }
  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  if (sinTheta < 1e-5) {
    out.copy(a).lerp(b, t).normalize();
    return out;
  }
  out.copy(a).multiplyScalar(Math.sin((1 - t) * theta) / sinTheta);
  out.addScaledVector(b, Math.sin(t * theta) / sinTheta);
  return out.normalize();
}

export function tangentFrame(n, east, north) {
  if (Math.abs(n.y) < 0.9) east.set(0, 1, 0).cross(n).normalize();
  else east.set(1, 0, 0).cross(n).normalize();
  north.crossVectors(n, east).normalize();
}

/** Bod na povrchu planety ve vzdálenosti distM (m) v azimutu angle od east/north. */
export function surfaceOffsetDir(center, east, north, angle, distM, out) {
  const omega = distM / CONFIG.planetR;
  const sinW = Math.sin(omega);
  const cosW = Math.cos(omega);
  return out
    .copy(center)
    .multiplyScalar(cosW)
    .addScaledVector(east, Math.cos(angle) * sinW)
    .addScaledVector(north, Math.sin(angle) * sinW)
    .normalize();
}

export function disposeObject(obj) {
  obj.traverse(function (ch) {
    if (ch.geometry) ch.geometry.dispose();
    if (ch.material) {
      if (Array.isArray(ch.material)) ch.material.forEach(function (m) { m.dispose(); });
      else ch.material.dispose();
    }
  });
}

export const tmp = {
  v: new THREE.Vector3(),
  n: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  dir2: new THREE.Vector3(),
  peek: new THREE.Vector3(),
  center: new THREE.Vector3(),
  east: new THREE.Vector3(),
  north: new THREE.Vector3(),
  col: [0, 0, 0]
};
