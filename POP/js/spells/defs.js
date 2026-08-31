import { CONFIG } from "../config.js";

export const SPELLS = {
  elevate: {
    id: "elevate",
    range: 14,
    castTime: CONFIG.spellDuration,
    color: 0x6dff9a,
    hint: "Klikni v dosahu — vyroste kopec."
  },
  depress: {
    id: "depress",
    range: 14,
    castTime: CONFIG.spellDuration,
    color: 0x6aa8ff,
    hint: "Klikni v dosahu — vznikne prohlubeň."
  },
  lightning: {
    id: "lightning",
    range: 16,
    castTime: 2,
    burnRadius: 1,
    damageRadius: 4,
    damageCenter: 45,
    damageEdge: 5,
    color: 0xc8f0ff,
    hint: "Klikni v dosahu — blesk spálí zem."
  },
  fireball: {
    id: "fireball",
    range: 18,
    castTime: 1,
    burnRadius: 1,
    damageRadius: 4,
    damageCenter: 30,
    damageEdge: 5,
    speed: 26,
    /** Poloměr koule ≈ 15 cm → průměr 30 cm */
    radius: 0.15,
    color: 0xff7a28,
    hint: "Klikni v dosahu — ohnivá koule letí přímkou."
  },
  iceball: {
    id: "iceball",
    range: 27.5,
    castTime: 1,
    diameter: 3,
    travel: 50,
    speed: 16,
    contactDamage: 45,
    color: 0xeef6ff,
    hint: "Klikni směr — ledová koule se 50 m kutálí."
  },
  tornado: {
    id: "tornado",
    range: 16,
    castTime: 1,
    pullRadius: 10,
    innerRadius: 3,
    captureRadius: 0.6,
    pullSpeed: 3,
    fallDamage: 40,
    life: 18,
    color: 0xb8c4d4,
    hint: "Do 10 m vtahuje 3 m/s, chůze lineárně k nule ve 3 m."
  },
  volcano: {
    id: "volcano",
    range: 16,
    /** 3 s kouzlení, pak roste kopec — wizard může odejít */
    castPrepTime: 3,
    morphDuration: CONFIG.spellDuration,
    color: 0xff3a18,
    coneRadius: 11,
    coneHeight: 9,
    craterRadius: 2.2,
    craterDepth: 1.8,
    lavaRadius: 50,
    lavaDuration: 5,
    lavaDps: 20,
    lavaFillTime: 0.65,
    lavaFlowTime: 3.2,
    lavaFadeTime: 2.4,
    hint: "3 s kouzlení, pak sopka — láva až 50 m, 20 HP/s. Po zmizení spáleniště."
  }
};
