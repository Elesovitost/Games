import * as THREE from "./three.js";
import { CONFIG } from "./config.js";

/** Uniformy pro clip viditelné čtvrtiny planety (local space). */
export function createCapUniforms() {
  return {
    uViewAxis: { value: new THREE.Vector3(0, 1, 0) },
    uVisibleDot: { value: CONFIG.visibleCapDot }
  };
}

const CAP_INJECT = `
uniform vec3 uViewAxis;
uniform float uVisibleDot;
`;

const CAP_BEGIN = `
#include <begin_vertex>
if (dot(normalize(position), normalize(uViewAxis)) < uVisibleDot) {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

/** Přidá cap clip do vertex shaderu. */
export function applyCapClip(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uViewAxis = uniforms.uViewAxis;
    shader.uniforms.uVisibleDot = uniforms.uVisibleDot;
    shader.vertexShader = CAP_INJECT + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", CAP_BEGIN);
  };
  material.customProgramCacheKey = () => "cap_clip";
}
