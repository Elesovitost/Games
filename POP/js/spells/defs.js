export const SPELLS = {
  elevate: {
    id: "elevate",
    range: 14,
    castTime: 3,
    color: 0x6dff9a,
    hint: "Klikni v dosahu — vyroste kopec."
  },
  depress: {
    id: "depress",
    range: 14,
    castTime: 3,
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
    castTime: 2,
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
    castTime: 1.5,
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
    morphDuration: 3,
    color: 0xff3a18,

    /**
     * Tvar hory: pata 14 m, okraj kráteru 7 m nad patou → svah 43° pod
     * okrajem, 7° u paty (střední 33°), po celé délce konkávní.
     */
    coneRadius: 14,
    coneHeight: 7,
    /** >1 = konkávní svahy: nejstrmější pod okrajem, u paty splývají */
    flankPow: 1.4,
    craterRadius: 3.4,
    craterDepth: 2.4,
    craterFloorRadius: 1.6,
    /** Průlom v okraji kráteru na straně spádu (m) */
    notchDrop: 0.72,
    /** Menší protilehlý průlom — láva vyteče i na druhé straně */
    secondaryNotchDrop: 0.4,

    /** Láva — simulace výškového pole (m, m³, s) */
    lavaRadius: 76,
    /** Délka výlevu a objemový tok z jícnu — kráter (~49 m³) přeteče v 1,6 s */
    eruptTime: 8,
    eruptRate: 34,
    /** Ztuhlá vrstva, která už nikdy neodteče — láva se šíří, neodtéká */
    lavaCrust: 0.06,
    /** Kritický spád hladiny (mez tekutosti) — hustá tekutina, oblé laloky */
    lavaYield: 0.035,
    /** Tekutost — vyšší = rychlejší tok po spádu */
    lavaMobility: 160,
    /** Chladnutí ležící lávy na kůru (s) */
    lavaHeatTime: 7,
    /** Tuhnutí do trvalé spáleniny po konci výlevu (s) */
    lavaFreezeTime: 6,
    lavaDps: 20,
    hint: "3 s kouzlení, pak sopka — láva teče po spádu ~30 m, 20 HP/s. Zůstane spáleniště."
  },
  comet: {
    id: "comet",
    range: 18,
    castTime: 2,
    /** Od objevení v obrazovce do impaktu (s). */
    flightTime: 0.8,
    /** Průměr tělesa (m). */
    diameter: 5,
    /**
     * Přímý přílet začíná daleko na paprsku horní části obrazovky. Díky
     * perspektivě se těleso objeví jako tečka a plynule rychle naroste.
     */
    approachCameraDist: 220,
    approachNdcY: 0.94,
    approachHeight: 110,
    /** 0 = dráha z horní části obrazovky, 1 = čistě shora po normále. */
    approachVerticalBlend: 0.1,
    /** Okamžitá deprese a zóna odpaření v místě dopadu. */
    craterRadius: 5,
    craterDepth: 2.8,
    /** Zčernalá zem a damage radius (m). */
    scorchRadius: 10,
    damageRadius: 10,
    damageCenter: 200,
    damageEdge: 50,
    /** Mlha nad kráterem: držení a úplné rozplynutí (s). */
    dustHold: 5,
    dustFade: 5,
    color: 0xff8a2a,
    hint: "2 s kouzlení, 0,8 s přímý pád. Do 5 m vše zmizí, do 10 m damage 200→50 a hoří."
  },
  immortality: {
    id: "immortality",
    selfCast: true,
    range: 0,
    castTime: 1,
    holdTime: 5,
    /** 2× rychlost chůze */
    speed: 10,
    travel: 100,
    /** Poloměr koule kolem kouzelníka (m) */
    radius: 1.18,
    color: 0xffe08a,
    hint: "1 s kouzlení, 5 s nesmrtelnost. Klik = kutálení 2× chůze; po 100 m nebo čase koule praskne."
  },
  invisibility: {
    id: "invisibility",
    /** Klik na ikonu = rovnou cast (bez míření) */
    selfCast: true,
    range: 0,
    castTime: 3,
    holdTime: 10,
    /** Lokální hráč vidí sebe na 50 % */
    localOpacity: 0.5,
    /** Ostatní v MP nevidí vůbec */
    remoteOpacity: 0,
    color: 0xc8b8e8,
    hint: "Klikni — 3 s kouzlení, pak 10 s neviditelnost. Kouzlení zruší efekt."
  },
  earthquake: {
    id: "earthquake",
    range: 18,
    castTime: 3,
    effectRadius: 18,
    duration: 5,
    fallDamage: 10,
    walkGrace: 0.5,
    /** Jedna otočka, posun od epicentra */
    fallRotations: 1,
    fallDistance: 3,
    color: 0xc4a060,
    hint: "Klikni v dosahu — 18 m praskliny, 5 s třesení. V zóně padáš (−10 HP) dokud nevyjdeš."
  }
};
