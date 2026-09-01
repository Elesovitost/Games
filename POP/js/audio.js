import { CONFIG } from "./config.js";
import { allIncantationUrls, INCANTATION_DIR, INCANTATION_BG } from "./incantations.js";

const CAST_BG_VOL = 0.1;
const CAST_VOICE_DELAY = 0.2;
const CAST_BG_FADE = 0.2;

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
  },
  bodyfall: {
    url: "./audio/bodyfall.mp3",
    refDist: CONFIG.sfxRefDist,
    halfDist: CONFIG.sfxHalfDist,
    maxDist: CONFIG.sfxMaxDist,
    gain: 1
  },
  scream1: {
    url: "./audio/scream1.mp3",
    refDist: CONFIG.sfxRefDist,
    halfDist: CONFIG.sfxHalfDist,
    maxDist: CONFIG.sfxMaxDist,
    gain: 1
  },
  scream2: {
    url: "./audio/scream2.mp3",
    refDist: CONFIG.sfxRefDist,
    halfDist: CONFIG.sfxHalfDist,
    maxDist: CONFIG.sfxMaxDist,
    gain: 1
  },
  scream3: {
    url: "./audio/scream3.mp3",
    refDist: CONFIG.sfxRefDist,
    halfDist: CONFIG.sfxHalfDist,
    maxDist: CONFIG.sfxMaxDist,
    gain: 1
  }
};

const SCREAM_IDS = ["scream1", "scream2", "scream3"];

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
    this._incantationBuffers = new Map();
    this._incantationLoading = new Map();
    this._castSessions = new Map();
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
    await Promise.all([
      ...withUrl.map((id) => this.#loadOne(id)),
      this.preloadIncantations()
    ]);
    this._ready = true;
  }

  async preloadIncantations() {
    const ctx = this.#ensureCtx();
    if (!ctx) return;
    await Promise.all(allIncantationUrls().map((url) => this.#loadIncantation(url)));
  }

  async #loadIncantation(url) {
    if (this._incantationBuffers.has(url)) return this._incantationBuffers.get(url);
    if (this._incantationLoading.has(url)) return this._incantationLoading.get(url);

    const p = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Incantation load failed: ${url} (${res.status})`);
      const raw = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(raw.slice(0));
      this._incantationBuffers.set(url, buf);
      this._incantationLoading.delete(url);
      return buf;
    })().catch((err) => {
      console.warn("[audio]", err);
      this._incantationLoading.delete(url);
      return null;
    });

    this._incantationLoading.set(url, p);
    return p;
  }

  #spatialMul(sourceDir, listenerDir) {
    if (!sourceDir || !listenerDir) return 0;
    const dist = surfaceDist(sourceDir, listenerDir);
    return distanceVolume(
      dist,
      CONFIG.sfxRefDist,
      CONFIG.sfxMaxDist,
      CONFIG.sfxHalfDist
    );
  }

  #createEchoConvolver() {
    const ctx = this.#ensureCtx();
    if (!ctx) return null;
    const rate = ctx.sampleRate;
    const length = rate * 2.0;
    const impulse = ctx.createBuffer(2, length, rate);
    for (let i = 0; i < 2; i++) {
      const channel = impulse.getChannelData(i);
      for (let j = 0; j < length; j++) {
        channel[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 4.0);
      }
    }
    const convolver = ctx.createConvolver();
    convolver.buffer = impulse;
    return convolver;
  }

  /**
   * Začátek kouzlení — BG 10 % po celou dobu castu, hláška +200 ms (větrný posun z demo).
   * @param {string} sessionId — typicky wizard.id
   * @param {string|null} voiceFile
   * @param {number} castDurationSec
   * @param {THREE.Vector3} sourceDir
   * @param {THREE.Vector3} listenerDir
   */
  startCastIncantation(sessionId, voiceFile, castDurationSec, sourceDir, listenerDir) {
    const ctx = this.#ensureCtx();
    if (!ctx || !sourceDir || !listenerDir) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    this.stopCastIncantation(sessionId, 0);

    const bgUrl = INCANTATION_DIR + INCANTATION_BG;
    const bgBuf = this._incantationBuffers.get(bgUrl);
    if (!bgBuf) {
      this.#loadIncantation(bgUrl).then((buf) => {
        if (buf && !this._castSessions.has(sessionId)) {
          this.startCastIncantation(sessionId, voiceFile, castDurationSec, sourceDir, listenerDir);
        }
      });
      return;
    }

    const spatialMul = this.#spatialMul(sourceDir, listenerDir);
    const now = ctx.currentTime;
    const fadeStart = now + Math.max(0, castDurationSec);
    const fadeEnd = fadeStart + CAST_BG_FADE;

    const spatialGain = ctx.createGain();
    spatialGain.gain.value = spatialMul;

    const bgEnvelope = ctx.createGain();
    bgEnvelope.gain.setValueAtTime(CAST_BG_VOL, now);
    bgEnvelope.gain.setValueAtTime(CAST_BG_VOL, fadeStart);
    bgEnvelope.gain.linearRampToValueAtTime(0, fadeEnd);

    const bgSource = ctx.createBufferSource();
    bgSource.buffer = bgBuf;
    bgSource.loop = true;
    bgSource.connect(bgEnvelope);
    bgEnvelope.connect(spatialGain);
    spatialGain.connect(this.master);
    bgSource.start(now);
    bgSource.stop(fadeEnd + 0.05);

    const handle = {
      sessionId,
      sourceDir: sourceDir.clone(),
      spatialGain,
      bgEnvelope,
      bgSource,
      voiceNodes: [],
      voiceWetGain: null,
      echoConvolver: null
    };
    this._castSessions.set(sessionId, handle);

    if (!voiceFile) return;

    const voiceUrl = INCANTATION_DIR + voiceFile;
    const voiceBuf = this._incantationBuffers.get(voiceUrl);
    if (!voiceBuf) {
      this.#loadIncantation(voiceUrl).then(() => {
        if (this._castSessions.get(sessionId) === handle) {
          this.#playWindVoice(handle, voiceUrl, now + CAST_VOICE_DELAY);
        }
      });
      return;
    }
    this.#playWindVoice(handle, voiceUrl, now + CAST_VOICE_DELAY);
  }

  /** Aktualizuje hlasitost probíhajících zaříkávání podle vzdálenosti od kamery. */
  updateCastSpatial(listenerDir, getSourceDir) {
    const ctx = this.ctx;
    if (!ctx || !listenerDir || !this._castSessions.size) return;
    const t = ctx.currentTime;
    for (const [id, handle] of this._castSessions) {
      const src = getSourceDir?.(id);
      if (src) handle.sourceDir.copy(src);
      const mul = this.#spatialMul(handle.sourceDir, listenerDir);
      handle.spatialGain.gain.setTargetAtTime(mul, t, 0.04);
    }
  }

  #playWindVoice(handle, voiceUrl, startTime) {
    const ctx = this.#ensureCtx();
    if (!ctx || !handle) return;
    const buffer = this._incantationBuffers.get(voiceUrl);
    if (!buffer) return;

    const echo = this.#createEchoConvolver();
    if (!echo) return;

    const voiceWetGain = ctx.createGain();
    voiceWetGain.gain.value = 0.35;
    echo.connect(voiceWetGain);
    voiceWetGain.connect(handle.spatialGain);
    handle.echoConvolver = echo;
    handle.voiceWetGain = voiceWetGain;

    const dryGain = ctx.createGain();
    dryGain.gain.value = 0.75;
    dryGain.connect(handle.spatialGain);

    const mainL = ctx.createBufferSource();
    mainL.buffer = buffer;
    mainL.playbackRate.value = 0.81;

    const mainR = ctx.createBufferSource();
    mainR.buffer = buffer;
    mainR.playbackRate.value = 0.77;

    const pannerL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const pannerR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pannerL) pannerL.pan.value = -0.4;
    if (pannerR) pannerR.pan.value = 0.4;

    mainL.connect(pannerL || dryGain);
    if (pannerL) pannerL.connect(dryGain);
    mainR.connect(pannerR || dryGain);
    if (pannerR) pannerR.connect(dryGain);
    mainL.connect(echo);

    mainL.start(startTime);
    mainR.start(startTime + 0.012);

    const duration = buffer.duration / 0.79;
    handle.voiceNodes.push(mainL, mainR, dryGain, voiceWetGain, echo);
    try {
      mainL.stop(startTime + duration + 0.1);
      mainR.stop(startTime + duration + 0.12);
    } catch (_) {
      /* noop */
    }
  }

  /** Ukončí podkres castu (fade). Hlášku nechá doběhnout, pokud stopVoice === false. */
  stopCastIncantation(sessionId, fadeSec = CAST_BG_FADE, stopVoice = true) {
    const handle = this._castSessions.get(String(sessionId));
    if (!handle) return;

    const ctx = this.#ensureCtx();
    if (!ctx) return;
    const t = ctx.currentTime;

    if (handle.bgEnvelope) {
      const cur = handle.bgEnvelope.gain.value;
      handle.bgEnvelope.gain.cancelScheduledValues(t);
      handle.bgEnvelope.gain.setValueAtTime(cur, t);
      handle.bgEnvelope.gain.linearRampToValueAtTime(0, t + fadeSec);
      handle.bgEnvelope = null;
    }
    if (handle.bgSource) {
      try {
        handle.bgSource.stop(t + fadeSec + 0.05);
      } catch (_) {
        /* already stopped */
      }
      handle.bgSource = null;
    }

    if (stopVoice) {
      for (const node of handle.voiceNodes || []) {
        if (node?.stop) {
          try {
            node.stop(t + 0.02);
          } catch (_) {
            /* noop */
          }
        }
      }
      handle.voiceNodes = [];
      this._castSessions.delete(String(sessionId));
    } else if (!handle.voiceNodes?.length) {
      this._castSessions.delete(String(sessionId));
    }
  }

  /** Konec vyvolávání — podkres fade, hláška dohraje. */
  stopCastBackground(sessionId, fadeSec = CAST_BG_FADE) {
    this.stopCastIncantation(sessionId, fadeSec, false);
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

  playRandomScream(sourceDir, listenerDir, opts = {}) {
    const id = SCREAM_IDS[(Math.random() * SCREAM_IDS.length) | 0];
    this.playAt(id, sourceDir, listenerDir, opts);
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
