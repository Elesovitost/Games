import { CONFIG } from "./config.js";

/**
 * Levná procedurální "textura" trávy — žádné textury, žádné UV, žádná nová
 * geometrie. Triplanar podle object-space pozice (bez švů na kouli), plynulý
 * value-noise (ne hrubý hash) pro shluky trávy + jemné protažené "stébla".
 * Cena navíc je pár desítek ALU operací na pixel — mnohem levnější než
 * jakýkoli texture sample, tedy OK i na telefonu. Efekt je čistě vizuální
 * funkce pozice (deterministická), takže není potřeba nic synchronizovat v MP.
 */

const GRASS_VERT_INJECT = `
varying vec3 vGrassPos;
`;

const GRASS_FRAG_INJECT = `
uniform float uGrassAmount;
uniform float uWaterLevel;
varying vec3 vGrassPos;

float grassHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/** Plynulý value-noise — shluky trávy, ne "TV šum". */
float grassNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = grassHash(i);
  float b = grassHash(i + vec2(1.0, 0.0));
  float c = grassHash(i + vec2(0.0, 1.0));
  float d = grassHash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/** Triplanar vzorek dané frekvence (vec2 = anizotropní protažení pro "stébla"). */
float grassTri(vec3 p, vec2 freq, vec3 w) {
  float nx = grassNoise(p.yz * freq);
  float ny = grassNoise(p.xz * freq);
  float nz = grassNoise(p.xy * freq);
  return nx * w.x + ny * w.y + nz * w.z;
}
`;

const GRASS_APPLY = `
{
  float gElev = length(vGrassPos) - uWaterLevel;
  float gBand = smoothstep(0.5, 1.05, gElev) * (1.0 - smoothstep(2.6, 3.7, gElev));
  if (gBand > 0.002) {
    vec3 gw = normalize(vGrassPos);
    gw *= gw;

    /** Velké barevné shluky louky (slunečné / stinné plochy) — jemnější zrno. */
    float clump = grassTri(vGrassPos, vec2(7.0, 7.0), gw);
    /** Jemné protažené "stébla" — anizotropní frekvence napodobí směr trávy. */
    float blades = grassTri(vGrassPos, vec2(26.0, 95.0), gw);
    /** Drobný jiskřivý detail na blízko — tlumený, ať nepůsobí zrnitě. */
    float fleck =
      grassHash(floor(vGrassPos.yz * 220.0)) * gw.x +
      grassHash(floor(vGrassPos.xz * 220.0)) * gw.y +
      grassHash(floor(vGrassPos.xy * 220.0)) * gw.z;

    float pattern = clump * 0.55 + blades * 0.35 + fleck * 0.1;
    /** Mírná kontrastní křivka — výraznější než čistý mix, ale ne hrubá. */
    pattern = clamp((pattern - 0.5) * 1.35 + 0.5, 0.0, 1.0);

    vec3 shadeTone = vec3(0.56, 0.68, 0.42);
    vec3 sunTone = vec3(1.32, 1.2, 0.56);
    vec3 shade = mix(shadeTone, sunTone, pattern);
    float amt = min(1.0, gBand * uGrassAmount);
    diffuseColor.rgb *= mix(vec3(1.0), shade, amt);
  }
}
`;

/** Přidá procedurální trávový detail do fragment shaderu materiálu terénu. */
export function applyGrassDetail(material, amount = 1) {
  const uniforms = {
    uGrassAmount: { value: amount },
    uWaterLevel: { value: CONFIG.waterLevel }
  };
  const prevOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    prevOnBeforeCompile?.(shader);
    shader.uniforms.uGrassAmount = uniforms.uGrassAmount;
    shader.uniforms.uWaterLevel = uniforms.uWaterLevel;

    shader.vertexShader = GRASS_VERT_INJECT + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "void main() {",
      "void main() {\n  vGrassPos = position;"
    );

    shader.fragmentShader = GRASS_FRAG_INJECT + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      "#include <color_fragment>\n" + GRASS_APPLY
    );
  };
  const prevCacheKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => "grass_" + (prevCacheKey ? prevCacheKey() : "");
  return uniforms;
}
