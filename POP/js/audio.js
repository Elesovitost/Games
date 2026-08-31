import { CONFIG } from "./config.js";

/** Katalog SFX — refDist = plná hlasitost, halfDist = −50 % / N m. */
export const SFX = {
  lightning: {
    url: "./audio/lightning.mp3",
    refDist: CONFIG.sfxRefDist,
    halfDist: CONFIG.sfxHalfDist,
    maxDist: CONFIG.sfxMaxDist,
    gain: 1
  },
  fireballImpact: {
    url: "./audio/fireball-impact.mp3",
    refDist: CONFIG.sfxRefDist,
    halfDist: CONFIG.sfxHalfDist,
    maxDist: CONFIG.sfxMaxDist,
    gain: 1
  },
  /** Procedurální syčení letu — bez url */
  fireballHiss: {
    refDist: CONFIG.sfxRefDist,
    halfDist: CONFIG.sfxHalfDist,
    maxDist: CONFIG.sfxMaxDist,
    gain: 0.72
  },
  /** Procedurální hukot tornáda */
  tornadoRumble: {
    refDist: CONFIG.sfxRefDist,
    halfDist: CONFIG.sfxHalfDist,
    maxDist: CONFIG.sfxMaxDist,
    gain: 1.35
  }
};

/** Vzdálenost po povrchu (m) mezi dvěma směry od středu planety. */
function surfaceDist(a, b) {
  const d = Math.min(1, Math.max(-1, a.dot(b)));
  return Math.acos(d) * CONFIG.planetR;
}

/**
 * Plná hlasitost do refDist, pak každých halfDist metrů cca na polovinu.
 * Nad maxDist / pod prahem → 0.
 */
export function distanceVolume(distM, refDist, maxDist, halfDist = 10) {
  if (distM >= maxDist) return 0;
  const d = Math.max(0, distM - refDist);
  const vol = Math.pow(0.5, d / Math.max(1e-6, halfDist));
  return vol < 0.01 ? 0 : vol;
}

/**
 * Web Audio SFX — přehrává lokálně s útlumem podle vzdálenosti
 * od místa, kam se hráč dívá (listenerDir).
 * V MP každý klient slyší se svou kamerou; sync přes síť není potřeba.
 */
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.buffers = new Map();
    this._loading = new Map();
    this._ready = false;
    this._noiseBuf = null;
  }

  #ensureCtx() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  #noiseBuffer() {
    if (this._noiseBuf) return this._noiseBuf;
    const ctx = this.#ensureCtx();
    if (!ctx) return null;
    const len = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // Lehce „hnědý“ šum — měkčí syčení než čistá bílá
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    this._noiseBuf = buf;
    return buf;
  }

  #spatialGain(id, sourceDir, listenerDir, mul = 1) {
    const def = SFX[id];
    if (!def || !sourceDir || !listenerDir) return 0;
    const dist = surfaceDist(sourceDir, listenerDir);
    return (
      distanceVolume(
        dist,
        def.refDist,
        def.maxDist,
        def.halfDist ?? CONFIG.sfxHalfDist
      ) *
      (def.gain ?? 1) *
      mul
    );
  }

  /** Prohlížeče vyžadují user gesture před zvukem. */
  unlock() {
    const ctx = this.#ensureCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  }

  async preload(ids = Object.keys(SFX)) {
    const ctx = this.#ensureCtx();
    if (!ctx) return;
    this.#noiseBuffer();
    const withUrl = ids.filter((id) => SFX[id]?.url);
    await Promise.all(withUrl.map((id) => this.#loadOne(id)));
    this._ready = true;
  }

  async #loadOne(id) {
    if (this.buffers.has(id)) return this.buffers.get(id);
    if (this._loading.has(id)) return this._loading.get(id);
    const def = SFX[id];
    if (!def?.url) return null;

    const p = (async () => {
      const res = await fetch(def.url);
      if (!res.ok) throw new Error(`SFX load failed: ${id} (${res.status})`);
      const raw = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(raw.slice(0));
      this.buffers.set(id, buf);
      this._loading.delete(id);
      return buf;
    })().catch((err) => {
      console.warn("[audio]", err);
      this._loading.delete(id);
      return null;
    });

    this._loading.set(id, p);
    return p;
  }

  /**
   * @param {string} id
   * @param {THREE.Vector3} sourceDir — směr místa efektu (normalizovaný)
   * @param {THREE.Vector3} listenerDir — kam se hráč dívá (view axis)
   * @param {{ volume?: number, rate?: number }} [opts]
   */
  playAt(id, sourceDir, listenerDir, opts = {}) {
    const def = SFX[id];
    const buf = this.buffers.get(id);
    const ctx = this.#ensureCtx();
    if (!def || !buf || !ctx || !sourceDir || !listenerDir) return;

    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const vol = this.#spatialGain(id, sourceDir, listenerDir, opts.volume ?? 1);
    if (vol < 0.01) return;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (opts.rate != null) src.playbackRate.value = opts.rate;

    const gain = ctx.createGain();
    gain.gain.value = Math.min(1, vol);
    src.connect(gain);
    gain.connect(this.master);
    src.start(0);
  }

  /**
   * Procedurální syčení letícího fireballu (loop). Vrací handle pro update/stop.
   */
  startHiss(sourceDir, listenerDir, opts = {}) {
    const ctx = this.#ensureCtx();
    const noise = this.#noiseBuffer();
    if (!ctx || !noise) return null;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;

    const hipass = ctx.createBiquadFilter();
    hipass.type = "highpass";
    hipass.frequency.value = 700;

    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1600 + Math.random() * 400;
    band.Q.value = 0.85;

    const gain = ctx.createGain();
    const base = opts.volume ?? 1;
    const vol = this.#spatialGain("fireballHiss", sourceDir, listenerDir, base);
    gain.gain.value = Math.min(1, vol);

    src.connect(hipass);
    hipass.connect(band);
    band.connect(gain);
    gain.connect(this.master);
    src.start();

    return {
      src,
      gain,
      band,
      hipass,
      base,
      alive: true,
      t: 0
    };
  }

  /** Aktualizace hlasitosti/barvy syčení podle pozice projektilu. */
  updateHiss(handle, sourceDir, listenerDir, dt = 0.016) {
    if (!handle?.alive) return;
    const ctx = this.ctx;
    if (!ctx) return;
    handle.t += dt;

    const vol = this.#spatialGain(
      "fireballHiss",
      sourceDir,
      listenerDir,
      handle.base
    );
    handle.gain.gain.setTargetAtTime(Math.min(1, vol), ctx.currentTime, 0.04);

    // Lehké „whoosh“ — filtr stoupá s letem
    const f = 1400 + Math.min(2200, handle.t * 900) + Math.sin(handle.t * 18) * 180;
    handle.band.frequency.setTargetAtTime(f, ctx.currentTime, 0.05);
  }

  /** Zastaví syčení (krátký fade do výbuchu). */
  stopHiss(handle, fade = 0.06) {
    if (!handle?.alive) return;
    handle.alive = false;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const cur = handle.gain.gain.value;
    handle.gain.gain.cancelScheduledValues(t);
    handle.gain.gain.setValueAtTime(cur, t);
    handle.gain.gain.linearRampToValueAtTime(0, t + fade);
    try {
      handle.src.stop(t + fade + 0.02);
    } catch (_) {
      /* already stopped */
    }
  }

  /**
   * Procedurální hukot tornáda: dunění + vítr + swirl.
   * @returns handle | null
   */
  startTornado(sourceDir, listenerDir, opts = {}) {
    const ctx = this.#ensureCtx();
    const noise = this.#noiseBuffer();
    if (!ctx || !noise) return null;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;

    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 160;
    low.Q.value = 0.7;

    const mid = ctx.createBiquadFilter();
    mid.type = "bandpass";
    mid.frequency.value = 420;
    mid.Q.value = 0.55;

    const swirl = ctx.createBiquadFilter();
    swirl.type = "bandpass";
    swirl.frequency.value = 1100;
    swirl.Q.value = 1.1;

    const gLow = ctx.createGain();
    gLow.gain.value = 1.05;
    const gMid = ctx.createGain();
    gMid.gain.value = 0.7;
    const gSwirl = ctx.createGain();
    gSwirl.gain.value = 0.32;

    const gain = ctx.createGain();
    const base = opts.volume ?? 1;
    const vol = this.#spatialGain("tornadoRumble", sourceDir, listenerDir, base);
    gain.gain.value = Math.max(0.01, vol);

    src.connect(low);
    src.connect(mid);
    src.connect(swirl);
    low.connect(gLow);
    mid.connect(gMid);
    swirl.connect(gSwirl);
    gLow.connect(gain);
    gMid.connect(gain);
    gSwirl.connect(gain);
    gain.connect(this.master);
    src.start();

    return {
      kind: "tornado",
      src,
      gain,
      low,
      mid,
      swirl,
      gLow,
      gMid,
      gSwirl,
      base,
      alive: true,
      t: 0
    };
  }

  updateTornado(handle, sourceDir, listenerDir, dt = 0.016, fadeMul = 1) {
    if (!handle?.alive) return;
    const ctx = this.ctx;
    if (!ctx) return;
    handle.t += dt;

    const vol =
      this.#spatialGain("tornadoRumble", sourceDir, listenerDir, handle.base) *
      Math.max(0, fadeMul);
    handle.gain.gain.setTargetAtTime(vol, ctx.currentTime, 0.08);

    const t = handle.t;
    // Víření — filtry se houpou
    handle.low.frequency.setTargetAtTime(
      120 + 50 * Math.sin(t * 1.7) + 30 * Math.sin(t * 0.4),
      ctx.currentTime,
      0.1
    );
    handle.mid.frequency.setTargetAtTime(
      380 + 90 * Math.sin(t * 2.3 + 1.1) + 40 * Math.sin(t * 0.65),
      ctx.currentTime,
      0.08
    );
    handle.swirl.frequency.setTargetAtTime(
      950 + 350 * Math.sin(t * 4.2) + 120 * Math.sin(t * 1.3 + 0.5),
      ctx.currentTime,
      0.05
    );
    handle.gSwirl.gain.setTargetAtTime(
      0.22 + 0.18 * (0.5 + 0.5 * Math.sin(t * 3.1)),
      ctx.currentTime,
      0.1
    );
  }

  stopTornado(handle, fade = 0.35) {
    if (!handle?.alive) return;
    handle.alive = false;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const cur = handle.gain.gain.value;
    handle.gain.gain.cancelScheduledValues(t);
    handle.gain.gain.setValueAtTime(cur, t);
    handle.gain.gain.linearRampToValueAtTime(0, t + fade);
    try {
      handle.src.stop(t + fade + 0.05);
    } catch (_) {
      /* already stopped */
    }
  }
}
