import { NetClient, loadProfile, saveProfile } from "./client.js";
import { CONFIG } from "../config.js";

/**
 * Multiplayer session — relay intents přes WebSocket.
 * Host zakládá lobby, ostatní se připojí přes IP (a kód místnosti).
 */
export class MultiplayerSession {
  constructor(game) {
    this.game = game;
    this.client = new NetClient();
    this.room = null;
    this.localId = null;
    this.isMp = false;
    this.playing = false;
    this._poseAcc = 0;

    this.client.onMessage = (msg) => this.#onMsg(msg);
    this.client.onClose = () => {
      if (!this.isMp) return;
      this.game.lobby?.setStatus("Spojení ztraceno.");
      if (this.playing) this.game.enterSolo?.();
      this.#reset();
      this.game.lobby?.render(null);
    };
  }

  get isHost() {
    return this.room && this.localId && this.room.hostId === this.localId;
  }

  get isPlaying() {
    return this.playing;
  }

  #reset() {
    this.room = null;
    this.localId = null;
    this.isMp = false;
    this.playing = false;
  }

  async create(name, color) {
    saveProfile({ name, color, host: "localhost" });
    await this.client.connect("localhost");
    this.isMp = true;
    this.localId = String(this.client.playerId);
    this.client.send({ type: "create", name, color });
  }

  async join(host, name, color, code) {
    saveProfile({ name, color, host });
    await this.client.connect(host);
    this.isMp = true;
    this.localId = String(this.client.playerId);
    this.client.send({
      type: "join",
      code: code || "",
      name,
      color
    });
  }

  leave() {
    this.client.send({ type: "leave" });
    this.client.disconnect();
    this.#reset();
  }

  startMatch() {
    if (!this.isHost) return;
    this.client.send({ type: "start", mapId: 0 });
  }

  sendIntent(intent) {
    if (!this.isMp || !this.playing) return false;
    return this.client.send({ type: "intent", intent });
  }

  /** Periodický pose sync pro vzdálené hráče. */
  tickPose(dt) {
    if (!this.isMp || !this.playing) return;
    this._poseAcc += dt;
    if (this._poseAcc < CONFIG.netPoseInterval) return;
    this._poseAcc = 0;
    const w = this.game.wizard;
    if (!w || w.dead) return;
    this.sendIntent({
      kind: "pose",
      dir: [w.dir.x, w.dir.y, w.dir.z],
      facing: [w.facing.x, w.facing.y, w.facing.z],
      moving: !!w.moving,
      casting: !!w.casting,
      hp: w.hp,
      knock: w.knockdown
        ? {
            seq: w.knockdown.seq,
            amt: w.knockdown.amount,
            from: [
              w.knockdown.fromDir.x,
              w.knockdown.fromDir.y,
              w.knockdown.fromDir.z
            ]
          }
        : null,
      tornado: w.tornado
        ? {
            phase: w.tornado.phase,
            spinY: w.tornado.spinY,
            sideZ: w.tornado.sideZ ?? 0,
            bodyRoll: w.tornado.bodyRoll || 0,
            preAmp: w.tornado.preAmp || 0,
            pos: [w.mesh.position.x, w.mesh.position.y, w.mesh.position.z]
          }
        : null
    });
  }

  #onMsg(msg) {
    if (msg.type === "welcome") {
      this.localId = String(msg.playerId);
      return;
    }
    if (msg.type === "error") {
      this.game.lobby?.setStatus(msg.message || "Chyba");
      return;
    }
    if (msg.type === "room") {
      this.room = msg.room;
      this.game.lobby?.render(this.room);
      return;
    }
    if (msg.type === "left") {
      this.#reset();
      this.game.lobby?.render(null);
      this.game.enterSolo?.();
      return;
    }
    if (msg.type === "started") {
      this.room = msg.room;
      this.playing = true;
      this.localId = String(msg.you || this.localId || this.client.playerId);
      this.game.beginMatch?.({
        players: msg.room.players,
        localId: this.localId,
        mapId: msg.mapId ?? 0
      });
      this._poseAcc = 1;
      this.game.lobby?.render(this.room);
      return;
    }
    if (msg.type === "match_aborted") {
      this.playing = false;
      this.game.lobby?.setStatus(msg.reason || "Hra přerušena");
      this.game.enterSolo?.();
      this.game.lobby?.render(this.room);
      return;
    }
    if (msg.type === "intent") {
      if (String(msg.from) === String(this.localId)) return;
      this.game.applyRemoteIntent?.(msg.from, msg.intent);
    }
  }
}

export { loadProfile, saveProfile };
