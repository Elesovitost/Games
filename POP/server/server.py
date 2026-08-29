#!/usr/bin/env python3
"""Populous MP relay — max 4 hráčů, host start, intent broadcast."""
from __future__ import annotations

import asyncio
import json
import os
import random
import string
import websockets

PORT = int(os.environ.get("PORT", "2567"))
MAX_PLAYERS = 4
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

sockets: dict = {}
rooms: dict = {}


def make_id() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=8))


def make_code() -> str:
    code = "".join(random.choices(CODE_CHARS, k=4))
    return make_code() if code in rooms else code


async def send(ws, msg: dict) -> None:
    try:
        await ws.send(json.dumps(msg, separators=(",", ":")))
    except Exception:
        pass


def room_public(room: dict) -> dict:
    return {
        "code": room["code"],
        "hostId": room["hostId"],
        "phase": room["phase"],
        "players": [
            {"id": p["id"], "name": p["name"], "color": p["color"]}
            for p in room["players"].values()
        ],
    }


async def broadcast(room: dict, msg: dict, except_ws=None) -> None:
    raw = json.dumps(msg, separators=(",", ":"))
    for p in room["players"].values():
        if p["ws"] is except_ws:
            continue
        try:
            await p["ws"].send(raw)
        except Exception:
            pass


async def leave_room(ws) -> None:
    meta = sockets.get(ws)
    if not meta or not meta.get("roomCode"):
        return
    code = meta["roomCode"]
    meta["roomCode"] = None
    room = rooms.get(code)
    if not room:
        return

    leaving = room["players"].pop(meta["playerId"], None)
    if not room["players"]:
        rooms.pop(code, None)
        return

    if room["hostId"] == meta["playerId"]:
        room["hostId"] = next(iter(room["players"]))

    await broadcast(room, {"type": "room", "room": room_public(room)})
    await broadcast(
        room,
        {
            "type": "peer_left",
            "playerId": meta["playerId"],
            "name": (leaving or {}).get("name", "?"),
        },
    )

    if room["phase"] == "playing":
        room["phase"] = "lobby"
        room["seed"] = None
        await broadcast(room, {"type": "room", "room": room_public(room)})
        await broadcast(room, {"type": "match_aborted", "reason": "Hráč opustil hru."})


async def handler(ws) -> None:
    player_id = make_id()
    sockets[ws] = {"playerId": player_id, "roomCode": None}
    await send(ws, {"type": "welcome", "playerId": player_id})

    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            if not isinstance(msg, dict) or "type" not in msg:
                continue
            meta = sockets[ws]
            mtype = msg["type"]

            if mtype == "create":
                await leave_room(ws)
                name = str(msg.get("name") or "Hráč")[:18]
                color = int(msg.get("color") or 0xC41C12)
                code = make_code()
                room = {
                    "code": code,
                    "hostId": player_id,
                    "phase": "lobby",
                    "seed": None,
                    "players": {},
                    "seq": 0,
                }
                room["players"][player_id] = {
                    "id": player_id,
                    "name": name,
                    "color": color,
                    "ws": ws,
                }
                rooms[code] = room
                meta["roomCode"] = code
                await send(ws, {"type": "room", "room": room_public(room)})
                continue

            if mtype == "join":
                code = str(msg.get("code") or "").upper().strip()
                room = rooms.get(code)
                if not room:
                    await send(ws, {"type": "error", "message": "Místnost neexistuje."})
                    continue
                if room["phase"] != "lobby":
                    await send(ws, {"type": "error", "message": "Hra už běží."})
                    continue
                if len(room["players"]) >= MAX_PLAYERS:
                    await send(ws, {"type": "error", "message": "Místnost je plná (max 4)."})
                    continue
                if player_id in room["players"]:
                    continue
                await leave_room(ws)
                name = str(msg.get("name") or "Hráč")[:18]
                color = int(msg.get("color") or 0xC41C12)
                room["players"][player_id] = {
                    "id": player_id,
                    "name": name,
                    "color": color,
                    "ws": ws,
                }
                meta["roomCode"] = code
                await broadcast(room, {"type": "room", "room": room_public(room)})
                continue

            if mtype == "profile":
                room = rooms.get(meta["roomCode"] or "")
                player = room["players"].get(player_id) if room else None
                if not player or room["phase"] != "lobby":
                    continue
                if msg.get("name") is not None:
                    player["name"] = str(msg["name"])[:18]
                if msg.get("color") is not None:
                    player["color"] = int(msg["color"]) or player["color"]
                await broadcast(room, {"type": "room", "room": room_public(room)})
                continue

            if mtype == "leave":
                await leave_room(ws)
                await send(ws, {"type": "left"})
                continue

            if mtype == "start":
                room = rooms.get(meta["roomCode"] or "")
                if not room or room["hostId"] != player_id:
                    await send(ws, {"type": "error", "message": "Start může jen hostitel."})
                    continue
                if room["phase"] != "lobby":
                    continue
                room["phase"] = "playing"
                room["seed"] = random.randint(0, 0xFFFFFFFF)
                room["seq"] = 0
                await broadcast(
                    room,
                    {"type": "started", "seed": room["seed"], "room": room_public(room)},
                )
                continue

            if mtype == "intent":
                room = rooms.get(meta["roomCode"] or "")
                if not room or room["phase"] != "playing":
                    continue
                if player_id not in room["players"]:
                    continue
                room["seq"] += 1
                await broadcast(
                    room,
                    {
                        "type": "intent",
                        "seq": room["seq"],
                        "from": player_id,
                        "intent": msg.get("intent"),
                    },
                )
    finally:
        await leave_room(ws)
        sockets.pop(ws, None)


async def main() -> None:
    async with websockets.serve(handler, "0.0.0.0", PORT, ping_interval=20):
        print(f"Populous MP relay on ws://localhost:{PORT}", flush=True)
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
