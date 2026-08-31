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
    contactDamage: 25,
    color: 0xeef6ff,
    hint: "Klikni směr — ledová koule se 50 m kutálí."
  }
};
