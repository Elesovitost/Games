const PLANET_R = 80;

/**
 * Měřítko světa: 1 world unit = 1 metr.
 * Kouzelník ≈ 2 m. Poloměr planety = 80 m.
 */
export const CONFIG = {
  planetR: PLANET_R,
  /** Referenční výška kouzelníka (m) */
  wizardHeightM: 2,
  wizardMaxHp: 100,
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
  wizardSpeed: 10,
  /** Max. zrychlení z kopce */
  wizardDownhillBoost: 1.28,
  /** Min. rychlost v extrémním stoupání */
  wizardUphillMin: 0.14,
  /** Min. výška nad hladinou, aby kouzelník nešel do vody / mokré pláže */
  wizardMinLand: 0.15,
  /** Dojede na klik, když je blíž než tolik metrů po povrchu */
  wizardArrive: 0.55,
  spellDuration: 5,
  /** Poloměr morphu elevace/deprese (m) */
  spellRadius: 7.5,
  spellAmount: 4.2,
  /** Průměr cílové spirály (m) */
  spellSpiralDiameter: 1,
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
