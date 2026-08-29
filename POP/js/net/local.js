/** In-tab relay (BroadcastChannel) — stejný protokol jako server.py, jen pro stejný prohlížeč. */

const CHANNEL = "populous-mp-relay";
const MAX_PLAYERS = 4;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function makeCode(rooms) {
  let code = "";
  for (let i = 0; i < 4; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return rooms.has(code) ? makeCode(rooms) : code;
}

function roomPublic(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    players: [...room.players.values()].map((p, i) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      spawn: Number.isInteger(p.spawn) ? p.spawn : i
    }))
  };
}

function assignRandomSpawns(room, slotCount = 4) {
  const slots = Array.from({ length: slotCount }, (_, i) => i);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = slots[i];
    slots[i] = slots[j];
    slots[j] = t;
  }
  let i = 0;
  for (const p of room.players.values()) {
    p.spawn = slots[i % slotCount];
    i++;
  }
}

/** Jedna záložka drží stav místností a odpovídá ostatním. */
export class LocalRelayHost {
  constructor() {
    this.bc = new BroadcastChannel(CHANNEL);
    this.rooms = new Map();
    this.clients = new Map();
    this.bc.onmessage = (ev) => this.#onMessage(ev.data);
    this.bc.postMessage({ kind: "relay_announce" });
  }

  stop() {
    this.bc.close();
  }

  #reply(to, msg) {
    this.bc.postMessage({ kind: "to_client", to, msg });
  }

  #broadcast(room, msg) {
    for (const id of room.players.keys()) this.#reply(id, msg);
  }

  #leave(playerId) {
    const meta = this.clients.get(playerId);
    if (!meta?.roomCode) return;
    const room = this.rooms.get(meta.roomCode);
    meta.roomCode = null;
    if (!room) return;
    const leaving = room.players.get(playerId);
    room.players.delete(playerId);
    if (!room.players.size) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === playerId) room.hostId = room.players.keys().next().value;
    this.#broadcast(room, { type: "room", room: roomPublic(room) });
    this.#broadcast(room, {
      type: "peer_left",
      playerId,
      name: leaving?.name || "?"
    });
    if (room.phase === "playing") {
      room.phase = "lobby";
      room.seed = null;
      this.#broadcast(room, { type: "room", room: roomPublic(room) });
      this.#broadcast(room, { type: "match_aborted", reason: "Hráč opustil hru." });
    }
  }

  #onMessage(data) {
    if (!data || typeof data !== "object") return;
    if (data.kind === "relay_ping") {
      this.bc.postMessage({ kind: "relay_pong" });
      return;
    }
    if (data.kind === "client_hello") {
      const playerId = data.playerId;
      this.clients.set(playerId, { roomCode: null });
      this.#reply(playerId, { type: "welcome", playerId });
      return;
    }
    if (data.kind === "client_bye") {
      this.#leave(data.playerId);
      this.clients.delete(data.playerId);
      return;
    }
    if (data.kind !== "from_client") return;

    const playerId = data.playerId;
    const msg = data.msg;
    const meta = this.clients.get(playerId);
    if (!meta || !msg?.type) return;

    if (msg.type === "create") {
      this.#leave(playerId);
      const code = makeCode(this.rooms);
      const room = {
        code,
        hostId: playerId,
        phase: "lobby",
        seed: null,
        players: new Map(),
        seq: 0
      };
      room.players.set(playerId, {
        id: playerId,
        name: String(msg.name || "Hráč").slice(0, 18),
        color: Number(msg.color) || 0xc41c12
      });
      this.rooms.set(code, room);
      meta.roomCode = code;
      this.#reply(playerId, { type: "room", room: roomPublic(room) });
      return;
    }

    if (msg.type === "join") {
      const code = String(msg.code || "").toUpperCase().trim();
      const room = this.rooms.get(code);
      if (!room) {
        this.#reply(playerId, { type: "error", message: "Místnost neexistuje." });
        return;
      }
      if (room.phase !== "lobby") {
        this.#reply(playerId, { type: "error", message: "Hra už běží." });
        return;
      }
      if (room.players.size >= MAX_PLAYERS) {
        this.#reply(playerId, { type: "error", message: "Místnost je plná (max 4)." });
        return;
      }
      this.#leave(playerId);
      room.players.set(playerId, {
        id: playerId,
        name: String(msg.name || "Hráč").slice(0, 18),
        color: Number(msg.color) || 0xc41c12
      });
      meta.roomCode = code;
      this.#broadcast(room, { type: "room", room: roomPublic(room) });
      return;
    }

    if (msg.type === "profile") {
      const room = meta.roomCode ? this.rooms.get(meta.roomCode) : null;
      const player = room?.players.get(playerId);
      if (!player || room.phase !== "lobby") return;
      if (msg.name != null) player.name = String(msg.name).slice(0, 18);
      if (msg.color != null) player.color = Number(msg.color) || player.color;
      this.#broadcast(room, { type: "room", room: roomPublic(room) });
      return;
    }

    if (msg.type === "leave") {
      this.#leave(playerId);
      this.#reply(playerId, { type: "left" });
      return;
    }

    if (msg.type === "start") {
      const room = meta.roomCode ? this.rooms.get(meta.roomCode) : null;
      if (!room || room.hostId !== playerId) {
        this.#reply(playerId, { type: "error", message: "Start může jen hostitel." });
        return;
      }
      if (room.phase !== "lobby") return;
      room.phase = "playing";
      let mapId = Number(msg.mapId);
      if (!Number.isInteger(mapId) || mapId < 0 || mapId > 9) mapId = 0;
      room.mapId = mapId;
      room.seed = mapId;
      room.seq = 0;
      assignRandomSpawns(room, 4);
      const publicRoom = roomPublic(room);
      for (const id of room.players.keys()) {
        this.#reply(id, {
          type: "started",
          mapId,
          seed: mapId,
          room: publicRoom,
          you: id
        });
      }
      return;
    }

    if (msg.type === "intent") {
      const room = meta.roomCode ? this.rooms.get(meta.roomCode) : null;
      if (!room || room.phase !== "playing" || !room.players.has(playerId)) return;
      room.seq += 1;
      this.#broadcast(room, {
        type: "intent",
        seq: room.seq,
        from: playerId,
        intent: msg.intent
      });
    }
  }
}

let sharedHost = null;

export async function ensureLocalRelayHost() {
  const bc = new BroadcastChannel(CHANNEL);
  const found = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 180);
    bc.onmessage = (ev) => {
      if (ev.data?.kind === "relay_pong" || ev.data?.kind === "relay_announce") {
        clearTimeout(t);
        resolve(true);
      }
    };
    bc.postMessage({ kind: "relay_ping" });
  });
  bc.close();
  if (!found && !sharedHost) sharedHost = new LocalRelayHost();
  return true;
}

export class LocalNetClient {
  /** @param {(type: string, msg: object) => void} emit */
  constructor(emit) {
    this.playerId = makeId();
    this.emit = emit;
    this.connected = false;
    this.bc = null;
    this.queue = [];
  }

  async connect() {
    if (this.connected) return;
    await ensureLocalRelayHost();
    this.bc = new BroadcastChannel(CHANNEL);
    this.bc.onmessage = (ev) => {
      const data = ev.data;
      if (!data || data.kind !== "to_client" || data.to !== this.playerId) return;
      const msg = data.msg;
      if (!msg?.type) return;
      if (msg.type === "welcome") this.playerId = msg.playerId;
      this.emit(msg.type, msg);
    };
    this.connected = true;
    this.bc.postMessage({ kind: "client_hello", playerId: this.playerId });
    this.emit("open", { transport: "local" });
    for (const msg of this.queue) {
      this.bc.postMessage({ kind: "from_client", playerId: this.playerId, msg });
    }
    this.queue.length = 0;
  }

  disconnect() {
    if (this.bc) {
      this.bc.postMessage({ kind: "client_bye", playerId: this.playerId });
      this.bc.close();
      this.bc = null;
    }
    this.connected = false;
  }

  send(msg) {
    if (this.bc && this.connected) {
      this.bc.postMessage({ kind: "from_client", playerId: this.playerId, msg });
      return true;
    }
    this.queue.push(msg);
    this.connect();
    return true;
  }
}
