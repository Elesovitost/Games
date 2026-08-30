const PLANET_R = 80;

export const CONFIG = {
  planetR: PLANET_R,
  waterLevel: PLANET_R + 0.35,
  icoSubdiv: 6,
  waterSubdiv: 5,
  /** cos(60°) — render horní čtvrtiny směrem ke kameře */
  visibleCapDot: 0.5,
  heightGrid: 64,
  minR: PLANET_R * 0.72,
  maxR: PLANET_R * 1.42,
  camHeight: 21,
  camBack: 17,
  camLook: 13,
  focusDir: [1, 1, 1],
  rotSpeed: 0.18,
  shadowMapSize: 1024,
  shadowFrustumHalf: 128,
  pixelRatioMax: 1.35,
  resolutionScale: 0.92,
  landColor: [0.26, 0.52, 0.16],
  waterColor: [0.05, 0.18, 0.52],
  sandColor: [0.9, 0.76, 0.46],
  swampColor: [0.22, 0.08, 0.16],
  defaultMapSeed: 20260829
};
