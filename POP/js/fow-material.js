import * as THREE from "./three.js";
import { CONFIG } from "./config.js";

/** Max FOV zdrojů ve shaderu (1 wizard + až 5 Hlídačů). */
export const FOW_MAX_EYES = 6;

/** Sdílené FoW uniformy (terrain + water). */
export function createFowUniforms() {
  const eyes = [];
  const radii = [];
  for (let i = 0; i < FOW_MAX_EYES; i++) {
    eyes.push(new THREE.Vector3(0, 1, 0));
    radii.push(CONFIG.fowRadiusM);
  }
  return {
    uFowEnabled: { value: CONFIG.fowEnabledDefault ? 1 : 0 },
    /** @deprecated single-eye — drženo kvůli zpětné kompatibilitě zápisů */
    uFowEye: { value: eyes[0] },
    uFowRadius: { value: CONFIG.fowRadiusM },
    uFowEyes: { value: eyes },
    uFowRadii: { value: radii },
    uFowEyeCount: { value: 1 },
    uFowSoft: { value: CONFIG.fowSoftM },
    uPlanetR: { value: CONFIG.planetR }
  };
}

const FOW_ATTR = `
attribute float aFowExplore;
attribute float aFowMemH;
attribute vec3 aFowMemColor;
uniform float uFowEnabled;
uniform vec3 uFowEyes[${FOW_MAX_EYES}];
uniform float uFowRadii[${FOW_MAX_EYES}];
uniform int uFowEyeCount;
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
  float inFov = 0.0;
  for (int i = 0; i < ${FOW_MAX_EYES}; i++) {
    if (i >= uFowEyeCount) break;
    float angDist = acos(clamp(dot(fowDir, normalize(uFowEyes[i])), -1.0, 1.0)) * uPlanetR;
    float r = uFowRadii[i];
    inFov = max(inFov, 1.0 - smoothstep(r - uFowSoft, r, angDist));
  }
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
    /** Měkký okraj neodkrytého (měkká explore maska + smoothstep). */
    float exploredSoft = smoothstep(0.0, 0.95, vFowExplored);
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
    float exploredSoft = smoothstep(0.0, 0.95, vFowExplored);
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
      uFowEyes: uniforms.uFowEyes,
      uFowRadii: uniforms.uFowRadii,
      uFowEyeCount: uniforms.uFowEyeCount,
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
  material.customProgramCacheKey = () => "fow4_" + (prevCacheKey ? prevCacheKey() : "");
}
