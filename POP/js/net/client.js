import { CONFIG } from "../config.js";

const LS_NAME = "populous.mp.name";
const LS_COLOR = "populous.mp.color";
const LS_HOST = "populous.mp.host";
const LS_MUSIC = "populous.music.enabled";

export const WIZARD_COLORS = [
  { id: "red", hex: 0xc41c12, label: "Červená" },
  { id: "blue", hex: 0x1a5fcc, label: "Modrá" },
  { id: "green", hex: 0x1a9a3a, label: "Zelená" },
  { id: "gold", hex: 0xc9a227, label: "Zlatá" },
  { id: "purple", hex: 0x7a2d9a, label: "Fialová" },
  { id: "teal", hex: 0x1a8a8a, label: "Tyrkys" }
];

export function loadProfile() {
  const name = localStorage.getItem(LS_NAME) || "Hráč";
  const color = Number(localStorage.getItem(LS_COLOR)) || WIZARD_COLORS[0].hex;
  const host = localStorage.getItem(LS_HOST) || "localhost";
  return { name, color, host };
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
}

export function wsUrlFor(host) {
  const h = String(host || "localhost").trim() || "localhost";
  return `ws://${h}:${CONFIG.netPort}`;
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

  connect(host) {
    this.disconnect();
    const url = wsUrlFor(host);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve(this.playerId);
      };
      const timer = setTimeout(() => finish(new Error("Server neodpověděl (welcome)")), 8000);
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
