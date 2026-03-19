const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const {
  createRoom,
  attachPlayer,
  startHand,
  buildRoomView,
  applyAction,
} = require("./game-core");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const rooms = new Map();
let waitingSocket = null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".toml": "text/plain; charset=utf-8",
};

function send(socket, message) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

function roomForSocket(socket) {
  return socket.roomCode ? rooms.get(socket.roomCode) : null;
}

function buildViewForSocket(room, socket) {
  return buildRoomView(room, socket.playerIndex);
}

function broadcast(room) {
  room.players.forEach((player, index) => {
    player.socket.playerIndex = index;
    send(player.socket, { type: "room_state", room: buildRoomView(room, index) });
  });
}

function createAndAttachRoom(socket, name) {
  const room = createRoom();
  const player = attachPlayer(room, name);
  room.players[0].socket = socket;
  socket.roomCode = room.roomCode;
  socket.playerIndex = 0;
  socket.playerId = player.id;
  socket.playerToken = player.token;
  rooms.set(room.roomCode, room);
  return { room, player };
}

function joinExistingRoom(room, socket, name) {
  const player = attachPlayer(room, name);
  room.players[room.players.length - 1].socket = socket;
  socket.roomCode = room.roomCode;
  socket.playerIndex = room.players.length - 1;
  socket.playerId = player.id;
  socket.playerToken = player.token;
  if (room.players.length === 2 && room.phase === "waiting") {
    startHand(room);
  }
  return player;
}

function removeWaitingSocket(socket) {
  if (waitingSocket && waitingSocket === socket) {
    waitingSocket = null;
  }
}

function cleanupSocket(socket) {
  removeWaitingSocket(socket);
  const room = roomForSocket(socket);
  if (!room) return;

  room.players = room.players.filter((player) => player.id !== socket.playerId);
  if (room.players.length === 0) {
    rooms.delete(room.roomCode);
    return;
  }

  room.phase = "waiting";
  room.currentPlayer = 0;
  room.updatedAt = Date.now();
  broadcast(room);
}

const server = http.createServer((req, res) => {
  const requestPath = req.url === "/" ? "/index.html" : decodeURIComponent(req.url);
  const safeRelativePath = path.normalize(requestPath).replace(/^([/\\])+/, "");
  const filePath = path.join(ROOT, safeRelativePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(content);
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  send(socket, { type: "welcome", id: crypto.randomUUID() });

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: "error", message: "Invalid message." });
      return;
    }

    const name = String(message.name || "").trim().slice(0, 24);

    if (message.type === "create_room") {
      if (!name) {
        send(socket, { type: "error", message: "Name is required." });
        return;
      }
      const { room } = createAndAttachRoom(socket, name);
      send(socket, { type: "info", message: `Room ${room.roomCode} created. Waiting for another player.` });
      broadcast(room);
      return;
    }

    if (message.type === "join_room") {
      if (!name) {
        send(socket, { type: "error", message: "Name is required." });
        return;
      }
      const room = rooms.get(String(message.roomCode || "").toUpperCase());
      if (!room) {
        send(socket, { type: "error", message: "Room not found." });
        return;
      }
      if (room.players.length >= 2) {
        send(socket, { type: "error", message: "Room is already full." });
        return;
      }
      joinExistingRoom(room, socket, name);
      broadcast(room);
      return;
    }

    if (message.type === "quick_match") {
      if (!name) {
        send(socket, { type: "error", message: "Name is required." });
        return;
      }
      if (waitingSocket && waitingSocket.readyState === 1 && !waitingSocket.roomCode) {
        const { room } = createAndAttachRoom(waitingSocket, waitingSocket.pendingName);
        joinExistingRoom(room, socket, name);
        waitingSocket = null;
        startHand(room);
        broadcast(room);
        return;
      }
      socket.pendingName = name;
      waitingSocket = socket;
      send(socket, { type: "info", message: "Looking for another player..." });
      return;
    }

    if (message.type === "action") {
      const room = roomForSocket(socket);
      if (!room) {
        send(socket, { type: "error", message: "You are not in a room." });
        return;
      }
      const result = applyAction(room, socket.playerIndex, message.action, message.payload || {});
      if (!result.ok) {
        send(socket, { type: "error", message: result.error });
        return;
      }
      broadcast(room);
      return;
    }
  });

  socket.on("close", () => {
    cleanupSocket(socket);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Card Clash Duel server running at http://localhost:${PORT}`);
});
