import * as THREE from "./three.js";
import { CONFIG } from "./config.js";

/** Sdílené FoW uniformy (terrain + water). */
export function createFowUniforms() {
  return {
    uFowEnabled: { value: CONFIG.fowEnabledDefault ? 1 : 0 },
    uFowEye: { value: new THREE.Vector3(0, 1, 0) },
    uFowRadius: { value: CONFIG.fowRadiusM },
    uFowSoft: { value: CONFIG.fowSoftM },
    uPlanetR: { value: CONFIG.planetR }
  };
}

const FOW_ATTR = `
attribute float aFowExplore;
attribute float aFowMemH;
attribute vec3 aFowMemColor;
uniform float uFowEnabled;
uniform vec3 uFowEye;
uniform float uFowRadius;
uniform float uFowSoft;
uniform float uPlanetR;
varying float vFowInFov;
varying float vFowExplored;
varying vec3 vFowMemColor;
`;

const FOW_VERT_APPLY = `
{
  float liveH = length(transformed);
  vec3 fowDir = liveH > 1e-5 ? transformed / liveH : vec3(0.0, 1.0, 0.0);
  float angDist = acos(clamp(dot(fowDir, normalize(uFowEye)), -1.0, 1.0)) * uPlanetR;
  float inFov = 1.0 - smoothstep(uFowRadius - uFowSoft, uFowRadius, angDist);
  vFowInFov = uFowEnabled < 0.5 ? 1.0 : inFov;
  vFowExplored = uFowEnabled < 0.5 ? 1.0 : aFowExplore;
  vFowMemColor = aFowMemColor;
  if (uFowEnabled > 0.5) {
    float memH = aFowMemH > 1e-3 ? aFowMemH : liveH;
    float useMem = aFowExplore * (1.0 - inFov);
    transformed = fowDir * mix(liveH, memH, useMem);
  }
}
`;

const FOW_FRAG_VARY = `
uniform float uFowEnabled;
varying float vFowInFov;
varying float vFowExplored;
varying vec3 vFowMemColor;
`;

const FOW_FRAG_APPLY = `
{
  if (uFowEnabled > 0.5) {
    /** Měkký okraj neodkrytého (interpolace aFowExplore + smoothstep). */
    float exploredSoft = smoothstep(0.04, 0.88, vFowExplored);
    float gray = dot(vFowMemColor, vec3(0.299, 0.587, 0.114));
    vec3 ghost = mix(vFowMemColor, vec3(gray), 0.62) * 0.42;
    vec3 shown = mix(ghost, diffuseColor.rgb, vFowInFov);
    float cover = max(vFowInFov, exploredSoft);
    diffuseColor.rgb = mix(vec3(0.0), shown, cover);
  }
}
`;

const FOW_FOG_KILL = `
{
  if (uFowEnabled > 0.5) {
    float exploredSoft = smoothstep(0.04, 0.88, vFowExplored);
    float cover = max(vFowInFov, exploredSoft);
    gl_FragColor.rgb = mix(vec3(0.0), gl_FragColor.rgb, cover);
    if (cover < 0.002) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
}
`;

/**
 * FoW inject do MeshStandardMaterial terénu (chain za cap + grass).
 * Vertex: paměťová výška mimo FOV. Fragment: černá / šedá paměť / live.
 */
export function applyFowTerrain(material, uniforms) {
  const prevOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    prevOnBeforeCompile?.(shader);
    Object.assign(shader.uniforms, {
      uFowEnabled: uniforms.uFowEnabled,
      uFowEye: uniforms.uFowEye,
      uFowRadius: uniforms.uFowRadius,
      uFowSoft: uniforms.uFowSoft,
      uPlanetR: uniforms.uPlanetR
    });

    shader.vertexShader = FOW_ATTR + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n" + FOW_VERT_APPLY
    );

    shader.fragmentShader = FOW_FRAG_VARY + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      "#include <color_fragment>\n" + FOW_FRAG_APPLY
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <fog_fragment>",
      "#include <fog_fragment>\n" + FOW_FOG_KILL
    );
  };
  const prevCacheKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => "fow2_" + (prevCacheKey ? prevCacheKey() : "");
}
