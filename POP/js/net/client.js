import { CONFIG } from "../config.js";

const LS_NAME = "populous.mp.name";
const LS_COLOR = "populous.mp.color";
const LS_HOST = "populous.mp.host";
const LS_MODE = "populous.mp.mode";
const LS_MUSIC = "populous.music.enabled";

export const WIZARD_COLORS = [
  { id: "red", hex: 0xc41c12, label: "Červená" },
  { id: "blue", hex: 0x1a5fcc, label: "Modrá" },
  { id: "green", hex: 0x1a9a3a, label: "Zelená" },
  { id: "gold", hex: 0xc9a227, label: "Zlatá" },
  { id: "purple", hex: 0x7a2d9a, label: "Fialová" },
  { id: "teal", hex: 0x1a8a8a, label: "Tyrkys" }
];

/** @returns {"local"|"internet"} */
export function normalizeNetMode(mode) {
  return mode === "internet" ? "internet" : "local";
}

export function loadProfile() {
  const name = localStorage.getItem(LS_NAME) || "Hráč";
  const color = Number(localStorage.getItem(LS_COLOR)) || WIZARD_COLORS[0].hex;
  const host = localStorage.getItem(LS_HOST) || "localhost";
  const mode = normalizeNetMode(localStorage.getItem(LS_MODE));
  return { name, color, host, mode };
}

export function loadMusicEnabled() {
  const v = localStorage.getItem(LS_MUSIC);
  return v === null ? true : v === "1";
}

export function saveMusicEnabled(on) {
  localStorage.setItem(LS_MUSIC, on ? "1" : "0");
}

export function saveProfile(p) {
  if (p.name != null) localStorage.setItem(LS_NAME, String(p.name).slice(0, 18));
  if (p.color != null) localStorage.setItem(LS_COLOR, String(p.color));
  if (p.host != null) localStorage.setItem(LS_HOST, String(p.host).trim());
  if (p.mode != null) localStorage.setItem(LS_MODE, normalizeNetMode(p.mode));
}

/** Hostname bez protokolu / trailing slash. */
export function normalizeHost(host) {
  return String(host || "localhost")
    .trim()
    .replace(/^(wss?|https?):\/\//i, "")
    .replace(/\/$/, "") || "localhost";
}

export function internetHost() {
  return normalizeHost(CONFIG.netInternetHost || "");
}

/** LAN / loopback → ws://host:port; jinak wss://host (Render apod.). */
export function wsUrlFor(host) {
  const h = normalizeHost(host);
  const local =
    h === "localhost" ||
    h === "127.0.0.1" ||
    /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(h);
  if (local) {
    const bare = h.includes(":") ? h : `${h}:${CONFIG.netPort}`;
    return `ws://${bare}`;
  }
  return `wss://${h}`;
}

export function hostForMode(mode, localHost) {
  if (normalizeNetMode(mode) === "internet") return internetHost();
  return normalizeHost(localHost || "localhost");
}

/** HTTPS GET probudí free-tier Render (health v server/index.js). */
export function wakeInternetServer() {
  const h = internetHost();
  if (!h || h.includes("YOUR-") || h === "localhost") {
    return Promise.resolve({ ok: false, reason: "missing" });
  }
  const url = `https://${h}/`;
  const ms = Number(CONFIG.netInternetConnectMs) || 90000;
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  return fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: ctrl?.signal
  })
    .then((r) => ({ ok: r.ok, reason: r.ok ? "ok" : "http" }))
    .catch(() => ({ ok: false, reason: "error" }))
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
}

export class NetClient {
  constructor() {
    this.ws = null;
    this.playerId = null;
    this.onMessage = null;
    this.onClose = null;
    this.onOpen = null;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * @param {string} host
   * @param {{ timeoutMs?: number }} [opts]
   */
  connect(host, opts = {}) {
    this.disconnect();
    const url = wsUrlFor(host);
    const local =
      normalizeHost(host) === "localhost" ||
      normalizeHost(host) === "127.0.0.1" ||
      /^(\d{1,3}\.){3}\d{1,3}/.test(normalizeHost(host));
    const timeoutMs =
      opts.timeoutMs ??
      (local ? 8000 : Number(CONFIG.netInternetConnectMs) || 90000);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve(this.playerId);
      };
      const timer = setTimeout(
        () => finish(new Error("Server neodpověděl (welcome)")),
        timeoutMs
      );
      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        clearTimeout(timer);
        finish(e);
        return;
      }
      this.ws.onopen = () => {
        /* čekáme na welcome s playerId */
      };
      this.ws.onerror = () => {
        clearTimeout(timer);
        finish(new Error("Nepodařilo se připojit k " + url));
      };
      this.ws.onclose = () => {
        clearTimeout(timer);
        if (!settled) finish(new Error("Spojení uzavřeno"));
        else {
          this.ws = null;
          this.onClose?.();
        }
      };
      this.ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === "welcome" && msg.playerId) {
          this.playerId = msg.playerId;
          if (!settled) {
            clearTimeout(timer);
            this.onOpen?.();
            finish();
          }
        }
        this.onMessage?.(msg);
      };
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.playerId = null;
  }

  send(msg) {
    if (!this.connected) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }
}
