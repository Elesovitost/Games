import { WebSocketServer } from "ws";
import { createServer } from "http";

const PORT = Number(process.env.PORT) || 2567;
const MAX_PLAYERS = 4;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Stejná paleta jako js/net/client.js WIZARD_COLORS. */
const WIZARD_COLORS = [0xc41c12, 0x1a5fcc, 0x1a9a3a, 0xc9a227, 0x7a2d9a, 0x1a8a8a];

/** @typedef {{ id: string, name: string, color: number, ws: import("ws").WebSocket }} Player */
/** @typedef {{ code: string, hostId: string, phase: "lobby"|"playing", seed: number|null, players: Map<string, Player>, seq: number }} Room */

/** @type {Map<string, Room>} */
const rooms = new Map();
/** @type {Map<import("ws").WebSocket, { playerId: string, roomCode: string|null }>} */
const sockets = new Map();

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function makeCode() {
  let code = "";
  for (let i = 0; i < 4; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return rooms.has(code) ? makeCode() : code;
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
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

function colorTaken(room, color, exceptId) {
  const c = Number(color);
  for (const p of room.players.values()) {
    if (p.id !== exceptId && Number(p.color) === c) return true;
  }
  return false;
}

function assignColor(room, preferred, exceptId) {
  const want = Number(preferred);
  if (WIZARD_COLORS.includes(want) && !colorTaken(room, want, exceptId)) return want;
  for (const c of WIZARD_COLORS) {
    if (!colorTaken(room, c, exceptId)) return c;
  }
  return WIZARD_COLORS[0];
}

function uniquifyColors(room) {
  const used = new Set();
  for (const p of room.players.values()) {
    let c = Number(p.color);
    if (!WIZARD_COLORS.includes(c) || used.has(c)) {
      c = WIZARD_COLORS.find((x) => !used.has(x)) ?? c;
    }
    p.color = c;
    used.add(c);
  }
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

function broadcast(room, msg, exceptWs = null) {
  const raw = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.ws !== exceptWs && p.ws.readyState === 1) p.ws.send(raw);
  }
}

function leaveRoom(ws) {
  const meta = sockets.get(ws);
  if (!meta?.roomCode) return;
  const room = rooms.get(meta.roomCode);
  meta.roomCode = null;
  if (!room) return;

  const leaving = room.players.get(meta.playerId);
  room.players.delete(meta.playerId);

  if (!room.players.size) {
    rooms.delete(room.code);
    return;
  }

  if (room.hostId === meta.playerId) {
    room.hostId = room.players.keys().next().value;
  }

  broadcast(room, { type: "room", room: roomPublic(room) });
  broadcast(room, {
    type: "peer_left",
    playerId: meta.playerId,
    name: leaving?.name || "?"
  });

  if (room.phase === "playing") {
    room.phase = "lobby";
    room.seed = null;
    broadcast(room, { type: "room", room: roomPublic(room) });
    broadcast(room, { type: "match_aborted", reason: "Hráč opustil hru." });
  }
}

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Populous MP relay OK\n");
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  const playerId = makeId();
  sockets.set(ws, { playerId, roomCode: null });
  send(ws, { type: "welcome", playerId });

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    const meta = sockets.get(ws);
    if (!meta || !msg || typeof msg.type !== "string") return;

    if (msg.type === "create") {
      leaveRoom(ws);
      const name = String(msg.name || "Hráč").slice(0, 18);
      const color = Number(msg.color) || 0xc41c12;
      const code = makeCode();
      /** @type {Room} */
      const room = {
        code,
        hostId: playerId,
        phase: "lobby",
        seed: null,
        players: new Map(),
        seq: 0
      };
      const player = { id: playerId, name, color: assignColor(room, color, playerId), ws };
      room.players.set(playerId, player);
      rooms.set(code, room);
      meta.roomCode = code;
      send(ws, { type: "room", room: roomPublic(room) });
      return;
    }

    if (msg.type === "join") {
      let code = String(msg.code || "").toUpperCase().trim();
      let room = code ? rooms.get(code) : null;
      if (!room && !code) {
        for (const r of rooms.values()) {
          if (r.phase === "lobby") {
            room = r;
            break;
          }
        }
      }
      if (!room) {
        send(ws, {
          type: "error",
          message: code
            ? "Místnost neexistuje."
            : "Žádná otevřená lobby. Host musí nejdřív založit hru."
        });
        return;
      }
      if (room.phase !== "lobby") {
        send(ws, { type: "error", message: "Hra už běží." });
        return;
      }
      if (room.players.size >= MAX_PLAYERS) {
        send(ws, { type: "error", message: "Místnost je plná (max 4)." });
        return;
      }
      if (room.players.has(playerId)) return;
      leaveRoom(ws);
      const name = String(msg.name || "Hráč").slice(0, 18);
      const color = Number(msg.color) || 0xc41c12;
      const assigned = assignColor(room, color, playerId);
      room.players.set(playerId, { id: playerId, name, color: assigned, ws });
      meta.roomCode = room.code;
      broadcast(room, { type: "room", room: roomPublic(room) });
      return;
    }

    if (msg.type === "profile") {
      const room = meta.roomCode ? rooms.get(meta.roomCode) : null;
      const player = room?.players.get(playerId);
      if (!player) return;
      if (msg.name != null && room.phase === "lobby") {
        player.name = String(msg.name).slice(0, 18);
      }
      if (msg.color != null) player.color = assignColor(room, msg.color, playerId);
      broadcast(room, { type: "room", room: roomPublic(room) });
      return;
    }

    if (msg.type === "leave") {
      leaveRoom(ws);
      send(ws, { type: "left" });
      return;
    }

    if (msg.type === "start") {
      const room = meta.roomCode ? rooms.get(meta.roomCode) : null;
      if (!room || room.hostId !== playerId) {
        send(ws, { type: "error", message: "Start může jen hostitel." });
        return;
      }
      if (room.phase !== "lobby") return;
      room.phase = "playing";
      let mapId = Number(msg.mapId);
      if (!Number.isInteger(mapId) || mapId < 0 || mapId > 9) mapId = 0;
      room.mapId = mapId;
      room.seed = mapId;
      room.seq = 0;
      uniquifyColors(room);
      assignRandomSpawns(room, 4);
      const publicRoom = roomPublic(room);
      for (const p of room.players.values()) {
        send(p.ws, {
          type: "started",
          mapId,
          seed: mapId,
          room: publicRoom,
          you: p.id
        });
      }
      return;
    }

    if (msg.type === "intent") {
      const room = meta.roomCode ? rooms.get(meta.roomCode) : null;
      if (!room || room.phase !== "playing") return;
      if (!room.players.has(playerId)) return;
      room.seq += 1;
      const sender = room.players.get(playerId);
      broadcast(room, {
        type: "intent",
        seq: room.seq,
        from: playerId,
        intent: msg.intent
      }, sender?.ws);
      return;
    }
  });

  ws.on("close", () => {
    leaveRoom(ws);
    sockets.delete(ws);
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Populous MP relay on ws://0.0.0.0:${PORT} (LAN OK)`);
});
