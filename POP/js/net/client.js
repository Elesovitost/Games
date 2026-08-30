import { CONFIG } from "../config.js";

const LS_NAME = "populous.mp.name";
const LS_COLOR = "populous.mp.color";
const LS_HOST = "populous.mp.host";

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
      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }
      const fail = (err) => {
        if (settled) return;
        settled = true;
        reject(err || new Error("Nepodařilo se připojit k " + url));
      };
      this.ws.onopen = () => {
        if (settled) return;
        settled = true;
        this.onOpen?.();
        resolve();
      };
      this.ws.onerror = () => fail();
      this.ws.onclose = () => {
        this.ws = null;
        if (!settled) fail();
        else this.onClose?.();
      };
      this.ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === "welcome") this.playerId = msg.playerId;
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
