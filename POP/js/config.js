const PLANET_R = 80;

export const CONFIG = {
  planetR: PLANET_R,
  waterLevel: PLANET_R + 0.35,
  icoSubdiv: 7,
  /** GPU mesh — méně vrcholů, sync z logiky. */
  renderIcoSubdiv: 5,
  /** cos(60°) — viditelná čtvrtina koule směrem ke kameře. */
  visibleCapDot: 0.5,
  /** Ortho stín — celá planeta (bez tmavých ploch mimo frustum). */
  shadowCapHalf: 128,
  waterSubdiv: 5,
  heightGrid: 64,
  minR: PLANET_R * 0.72,
  maxR: PLANET_R * 1.42,
  wizardR: 0.16,
  wizardHeight: 1.64,
  wizardSpeed: 0.038,
  rotSpeed: 0.18,
  spellRadius: 8,
  swampRadius: 2,
  lavaRadius: 2.6,
  lavaLife: 60,
  lavaFade: 2.2,
  scorchRadius: 2.4,
  spellAmount: 2.4,
  spellDuration: 5,
  dragonLife: 30,
  dragonAlt: 6.2,
  dragonOrbit: 0.028,
  dragonSpeed: 0.72,
  dragonScale: 2,
  dragonBreathOn: 2,
  dragonBreathOff: 3,
  dragonScorchRadius: 0.7,
  fireballSpeed: 22,
  combat: {
    maxHp: 100,
    maxLives: 3
  },
  camHeight: 21,
  camBack: 17,
  camLook: 13,
  focusDir: [1, 1, 1],
  defaultMapId: 0,
  spawnFocus: [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1]
  ],
  netPort: 2567,
  defaultNetHost: "localhost",
  netUrlFor(host) {
    const h = String(host || this.defaultNetHost).trim() || this.defaultNetHost;
    return `ws://${h}:${this.netPort}`;
  },
  get netUrl() {
    return this.netUrlFor(
      typeof location !== "undefined" ? location.hostname || this.defaultNetHost : this.defaultNetHost
    );
  },
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
