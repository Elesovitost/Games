const PLANET_R = 80;

export const CONFIG = {
  planetR: PLANET_R,
  waterLevel: PLANET_R + 0.35,
  icoSubdiv: 7,
  heightGrid: 64,
  minR: PLANET_R * 0.72,
  maxR: PLANET_R * 1.42,
  wizardR: 0.16,
  wizardHeight: 0.82,
  wizardSpeed: 0.038,
  rotSpeed: 0.12,
  spellRadius: 8,
  swampRadius: 2,
  lavaRadius: 2.6,
  lavaLife: 60,
  lavaFade: 2.2,
  scorchRadius: 2.4,
  spellAmount: 2.4,
  spellDuration: 5,
  dragonLife: 30,
  dragonAlt: 1.15,
  dragonOrbit: 0.034,
  dragonSpeed: 0.95,
  fireballSpeed: 22,
  camHeight: 21,
  camBack: 17,
  camLook: 13,
  focusDir: [0, 0.2, 1],
  spawnFocus: [
    [0, 0.2, 1],
    [1, 0.2, 0],
    [0, 0.2, -1],
    [-1, 0.2, 0]
  ],
  netUrl: (typeof location !== "undefined"
    ? `ws://${location.hostname || "localhost"}:2567`
    : "ws://localhost:2567"),
  defaultTerrainSeed: 20260829,
  landColor: [0.26, 0.52, 0.16],
  waterColor: [0.05, 0.18, 0.52],
  sandColor: [0.9, 0.76, 0.46],
  swampColor: [0.22, 0.08, 0.16],
  spellLabels: {
    elevate: "Elevace",
    depress: "Deprese",
    dragon: "Vyvolat draka",
    lava: "Láva",
    lightning: "Blesk",
    fireball: "Ohnivá koule"
  }
};
