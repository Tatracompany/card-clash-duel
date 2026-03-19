const { getStore } = require("@netlify/blobs");
const {
  createRoom,
  attachPlayer,
  startHand,
  buildRoomView,
  findPlayerIndex,
  applyAction,
} = require("../../game-core");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

async function saveRoom(room) {
  const roomsStore = getStore("rooms");
  await roomsStore.setJSON(`room:${room.roomCode}`, room);
}

async function loadRoom(roomCode) {
  const roomsStore = getStore("rooms");
  if (!roomCode) return null;
  return roomsStore.get(`room:${String(roomCode).toUpperCase()}`, { type: "json" });
}

async function clearQuickMatchIfMatches(playerId) {
  const metaStore = getStore("meta");
  const queue = await metaStore.get("quick-match", { type: "json" });
  if (queue && queue.playerId === playerId) {
    await metaStore.delete("quick-match");
  }
}

exports.handler = async (event) => {
  try {
    const metaStore = getStore("meta");
    const roomsStore = getStore("rooms");

    if (event.httpMethod === "GET") {
      const params = event.queryStringParameters || {};
      if (params.op !== "state") {
        return json(400, { error: "Unknown operation." });
      }
      const room = await loadRoom(params.roomCode);
      if (!room) {
        return json(404, { error: "Room not found." });
      }
      const playerIndex = findPlayerIndex(room, params.playerId, params.token);
      if (playerIndex === -1) {
        return json(403, { error: "Invalid player session." });
      }
      return json(200, { room: buildRoomView(room, playerIndex) });
    }

    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed." });
    }

    const body = JSON.parse(event.body || "{}");
    const op = body.op;
    const name = String(body.name || "").trim().slice(0, 24);

    if (op === "create_room") {
      if (!name) return json(400, { error: "Name is required." });
      const room = createRoom();
      const player = attachPlayer(room, name);
      await saveRoom(room);
      return json(200, {
        roomCode: room.roomCode,
        playerId: player.id,
        token: player.token,
        room: buildRoomView(room, 0),
      });
    }

    if (op === "join_room") {
      if (!name) return json(400, { error: "Name is required." });
      const room = await loadRoom(body.roomCode);
      if (!room) return json(404, { error: "Room not found." });
      if (room.players.length >= 2) return json(400, { error: "Room is already full." });
      const player = attachPlayer(room, name);
      if (room.players.length === 2 && room.phase === "waiting") {
        startHand(room);
      }
      await saveRoom(room);
      return json(200, {
        roomCode: room.roomCode,
        playerId: player.id,
        token: player.token,
        room: buildRoomView(room, 1),
      });
    }

    if (op === "quick_match") {
      if (!name) return json(400, { error: "Name is required." });
      const queue = await metaStore.get("quick-match", { type: "json" });
      if (queue && Date.now() - queue.createdAt < 10 * 60 * 1000) {
        const room = await loadRoom(queue.roomCode);
        if (room && room.players.length === 1) {
          const player = attachPlayer(room, name);
          startHand(room);
          await metaStore.delete("quick-match");
          await saveRoom(room);
          return json(200, {
            roomCode: room.roomCode,
            playerId: player.id,
            token: player.token,
            room: buildRoomView(room, 1),
          });
        }
      }

      const room = createRoom();
      const player = attachPlayer(room, name);
      await saveRoom(room);
      await metaStore.setJSON("quick-match", {
        roomCode: room.roomCode,
        playerId: player.id,
        createdAt: Date.now(),
      });
      return json(200, {
        roomCode: room.roomCode,
        playerId: player.id,
        token: player.token,
        room: buildRoomView(room, 0),
      });
    }

    if (op === "action") {
      const room = await loadRoom(body.roomCode);
      if (!room) return json(404, { error: "Room not found." });
      const playerIndex = findPlayerIndex(room, body.playerId, body.token);
      if (playerIndex === -1) return json(403, { error: "Invalid player session." });
      const result = applyAction(room, playerIndex, body.action, body.payload || {});
      if (!result.ok) return json(400, { error: result.error });
      await saveRoom(room);
      return json(200, { room: buildRoomView(room, playerIndex) });
    }

    if (op === "leave_room") {
      const room = await loadRoom(body.roomCode);
      if (!room) return json(200, { ok: true });
      const playerIndex = findPlayerIndex(room, body.playerId, body.token);
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        room.players = room.players.filter((entry) => entry.id !== player.id);
        room.phase = "waiting";
        room.updatedAt = Date.now();
        await clearQuickMatchIfMatches(player.id);
        if (room.players.length === 0) {
          await roomsStore.delete(`room:${room.roomCode}`);
        } else {
          await saveRoom(room);
        }
      }
      return json(200, { ok: true });
    }

    return json(400, { error: "Unknown operation." });
  } catch (error) {
    return json(500, { error: "Server error.", details: error.message });
  }
};
