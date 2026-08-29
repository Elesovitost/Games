import { NetClient } from "./client.js";
import { CONFIG } from "../config.js";
import { castSpell, inSpellRange } from "../spells.js";
import * as THREE from "../three.js";

const LS_NAME = "populous.playerName";
const LS_COLOR = "populous.wizardColor";
const LS_TRANSPORT = "populous.mpTransport";
const LS_HOST = "populous.mpHost";

export const WIZARD_COLORS = [
  { id: "red", hex: 0xc41c12, label: "Červená" },
  { id: "blue", hex: 0x2a5cff, label: "Modrá" },
  { id: "green", hex: 0x2a9a3a, label: "Zelená" },
  { id: "gold", hex: 0xc9a227, label: "Zlatá" },
  { id: "violet", hex: 0x7a3cff, label: "Fialová" },
  { id: "teal", hex: 0x1a8a8a, label: "Tyrkys" }
];

export function loadProfile() {
  let name = localStorage.getItem(LS_NAME) || "";
  if (!name.trim()) name = "Hráč";
  let color = Number(localStorage.getItem(LS_COLOR));
  if (!WIZARD_COLORS.some((c) => c.hex === color)) color = WIZARD_COLORS[0].hex;
  return { name: name.slice(0, 18), color };
}

export function saveProfile(name, color) {
  localStorage.setItem(LS_NAME, String(name || "Hráč").slice(0, 18));
  localStorage.setItem(LS_COLOR, String(color));
}

export function loadMpPrefs() {
  const transport = localStorage.getItem(LS_TRANSPORT) === "network" ? "network" : "local";
  const host = localStorage.getItem(LS_HOST) || CONFIG.defaultNetHost;
  return { transport, host };
}

export function saveMpPrefs(transport, host) {
  localStorage.setItem(LS_TRANSPORT, transport === "network" ? "network" : "local");
  if (host != null) localStorage.setItem(LS_HOST, String(host).trim() || CONFIG.defaultNetHost);
}

export class MultiplayerSession {
  constructor(game) {
    const prefs = loadMpPrefs();
    this.game = game;
    this.net = new NetClient(CONFIG.netUrlFor(prefs.host));
    this.net.setPrefer(prefs.transport);
    this.mpTransport = prefs.transport;
    this.mpHost = prefs.host;
    this.mode = "1p";
    this.room = null;
    this.playing = false;
    this.lastSeq = 0;
    this.#bindNet();
  }

  get isMp() {
    return this.mode === "mp";
  }

  get isPlaying() {
    return this.isMp && this.playing;
  }

  get isHost() {
    return !!(this.room && this.net.playerId === this.room.hostId);
  }

  get localId() {
    return this.net.playerId;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (mode === "1p") {
      this.leave();
      this.disconnect();
      this.mode = "1p";
      this.playing = false;
      this.room = null;
      this.game.enterSolo();
      return;
    }
    this.mode = "mp";
    this.playing = false;
    this.#applyNetConfig();
    this.net.connect();
    this.game.enterLobby();
  }

  async setTransport(transport, host) {
    const next = transport === "network" ? "network" : "local";
    const nextHost = (host != null ? String(host).trim() : this.mpHost) || CONFIG.defaultNetHost;
    const changed = next !== this.mpTransport || nextHost !== this.mpHost || !this.net.connected;

    this.mpTransport = next;
    this.mpHost = nextHost;
    saveMpPrefs(next, nextHost);

    if (!changed && this.mode === "mp") return;

    this.leave();
    this.room = null;
    this.playing = false;
    this.#applyNetConfig();
    if (this.mode === "mp") {
      await this.net.reconnect();
      this.game.onMpRoom(null);
    }
  }

  #applyNetConfig() {
    this.net.setPrefer(this.mpTransport);
    this.net.setUrl(CONFIG.netUrlFor(this.mpHost));
  }

  create(name, color) {
    saveProfile(name, color);
    this.#applyNetConfig();
    this.net.connect();
    this.net.send({ type: "create", name, color });
  }

  join(code, name, color) {
    saveProfile(name, color);
    this.#applyNetConfig();
    this.net.connect();
    this.net.send({ type: "join", code, name, color });
  }

  updateProfile(name, color) {
    saveProfile(name, color);
    if (this.room && this.room.phase === "lobby") {
      this.net.send({ type: "profile", name, color });
    }
  }

  startMatch() {
    this.net.send({ type: "start" });
  }

  leave() {
    if (this.net.connected) this.net.send({ type: "leave" });
    this.room = null;
    this.playing = false;
    this.lastSeq = 0;
  }

  disconnect() {
    this.leave();
    this.net.disconnect();
  }

  /** @returns {boolean} true if handled by network (caller should not apply locally) */
  requestWalk(localTarget) {
    if (!this.isPlaying) return false;
    this.net.send({
      type: "intent",
      intent: {
        kind: "walk",
        x: localTarget.x,
        y: localTarget.y,
        z: localTarget.z
      }
    });
    return true;
  }

  /** @returns {boolean} true if handled by network */
  requestCast(spellId, localPos) {
    if (!this.isPlaying) return false;
    const w = this.game.wizard;
    if (!w || !inSpellRange(this.game, w, localPos, spellId)) {
      this.game.ui.toast("Mimo dosah kouzla.");
      return true;
    }
    this.net.send({
      type: "intent",
      intent: {
        kind: "cast",
        spell: spellId,
        x: localPos.x,
        y: localPos.y,
        z: localPos.z,
        fromX: w.dir.x,
        fromY: w.dir.y,
        fromZ: w.dir.z,
        seed: (Math.random() * 0xffffffff) >>> 0
      }
    });
    return true;
  }

  #bindNet() {
    this.net.on("info", (msg) => {
      if (msg.message) this.game.ui.toast(msg.message);
    });
    this.net.on("error", (msg) => {
      if (msg.message) this.game.ui.toast(msg.message);
    });
    this.net.on("open", () => {
      this.game.onMpRoom(this.room);
    });
    this.net.on("close", () => {
      if (this.mode === "mp" && this.net.transport === "ws") {
        this.game.ui.toast("Odpojeno od serveru");
      }
      this.playing = false;
      this.room = null;
      this.game.onMpRoom(null);
    });
    this.net.on("room", (msg) => {
      this.room = msg.room;
      this.playing = msg.room.phase === "playing";
      this.game.onMpRoom(msg.room);
    });
    this.net.on("started", (msg) => {
      this.room = msg.room;
      this.playing = true;
      this.lastSeq = 0;
      if (msg.you) this.net.playerId = String(msg.you);
      this.game.beginMatch({
        seed: msg.seed,
        players: msg.room.players,
        localId: msg.you != null ? String(msg.you) : String(this.net.playerId || "")
      });
      this.game.onMpRoom(msg.room);
    });
    this.net.on("match_aborted", (msg) => {
      this.playing = false;
      this.game.ui.toast(msg.reason || "Hra přerušena");
      this.game.enterLobby();
    });
    this.net.on("intent", (msg) => this.#applyIntent(msg));
    this.net.on("peer_left", (msg) => {
      this.game.ui.toast((msg.name || "Hráč") + " odešel");
    });
    this.net.on("left", () => {
      this.room = null;
      this.playing = false;
      this.game.onMpRoom(null);
    });
  }

  #applyIntent(msg) {
    if (!this.playing) return;
    if (msg.seq != null && msg.seq <= this.lastSeq) return;
    if (msg.seq != null) this.lastSeq = msg.seq;

    const intent = msg.intent;
    if (!intent) return;
    const wizard = this.game.getWizard(msg.from);
    if (!wizard) return;

    if (intent.kind === "walk") {
      const target = new THREE.Vector3(intent.x, intent.y, intent.z);
      const ok = wizard.walkTo(target, () => {});
      if (ok && msg.from === this.localId) {
        this.game.pointerUi.setWalkTarget(target);
      }
      return;
    }

    if (intent.kind === "cast") {
      const pos = new THREE.Vector3(intent.x, intent.y, intent.z);
      if (!inSpellRange(this.game, wizard, pos, intent.spell)) return;
      castSpell(this.game, intent.spell, pos, {
        wizard,
        fromDir: new THREE.Vector3(intent.fromX, intent.fromY, intent.fromZ),
        seed: intent.seed,
        clearSpellUi: msg.from === this.localId,
        skipRangeCheck: true
      });
    }
  }
}
