import { LocalNetClient } from "./local.js";

/**
 * Zkusí WebSocket (python relay). Když nejde, spadne na BroadcastChannel
 * (funguje hned mezi okny stejného prohlížeče — bez serveru).
 */
export class NetClient {
  constructor(url) {
    this.url = url;
    this.handlers = Object.create(null);
    this.playerId = null;
    this.connected = false;
    this.transport = "none";
    this.ws = null;
    this.local = null;
    this.queue = [];
    this._connecting = null;
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  connect() {
    if (this.connected) return Promise.resolve();
    if (this._connecting) return this._connecting;
    this._connecting = this.#connectAuto().finally(() => {
      this._connecting = null;
    });
    return this._connecting;
  }

  async #connectAuto() {
    const wsOk = await this.#tryWebSocket(700);
    if (wsOk) return;
    await this.#useLocal();
  }

  #tryWebSocket(timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch {
        resolve(false);
        return;
      }
      this.ws = ws;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          if (this.ws === ws) this.ws = null;
        }
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), timeoutMs);

      ws.addEventListener("open", () => {
        this.connected = true;
        this.transport = "ws";
        this.#emit("open", { transport: "ws" });
        for (const msg of this.queue) ws.send(JSON.stringify(msg));
        this.queue.length = 0;
        done(true);
      });
      ws.addEventListener("error", () => {
        if (!this.connected) done(false);
      });
      ws.addEventListener("close", () => {
        if (this.transport === "ws" && this.connected) {
          this.connected = false;
          this.#emit("close", {});
        } else if (!settled) done(false);
      });
      ws.addEventListener("message", (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === "welcome") this.playerId = msg.playerId;
        this.#emit(msg.type, msg);
      });
    });
  }

  async #useLocal() {
    this.local = new LocalNetClient((type, msg) => {
      if (type === "welcome") this.playerId = msg.playerId;
      this.#emit(type, msg);
    });
    await this.local.connect();
    this.playerId = this.local.playerId;
    this.connected = true;
    this.transport = "local";
    for (const msg of this.queue) this.local.send(msg);
    this.queue.length = 0;
    this.#emit("info", {
      message: "Lokální MP (okna na tomto PC). Pro hru po síti: start-mp.bat"
    });
  }

  disconnect() {
    this.queue.length = 0;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    if (this.local) {
      this.local.disconnect();
      this.local = null;
    }
    this.connected = false;
    this.transport = "none";
    this.playerId = null;
  }

  send(msg) {
    if (this.transport === "ws" && this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    if (this.transport === "local" && this.local) {
      this.local.send(msg);
      return true;
    }
    this.queue.push(msg);
    this.connect();
    return true;
  }

  #emit(type, msg) {
    const fn = this.handlers[type];
    if (fn) fn(msg);
  }
}
