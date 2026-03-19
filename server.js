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
const autoAdvanceTimers = new Map();
const botTimers = new Map();
const disconnectTimers = new Map();
let waitingSocket = null;
const AUTO_ADVANCE_PHASES = new Set(["bidReveal", "refillSummary", "reveal", "handSummary"]);
const RECONNECT_GRACE_MS = 120000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".toml": "text/plain; charset=utf-8",
};

function send(socket, message) {
  if (socket && socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

function roomForSocket(socket) {
  return socket.roomCode ? rooms.get(socket.roomCode) : null;
}

function buildViewForSocket(room, socket) {
  return buildRoomView(room, socket.playerIndex);
}

function clearRoomTimer(roomCode) {
  const timer = autoAdvanceTimers.get(roomCode);
  if (timer) {
    clearTimeout(timer);
    autoAdvanceTimers.delete(roomCode);
  }
}

function clearBotTimer(roomCode) {
  const timer = botTimers.get(roomCode);
  if (timer) {
    clearTimeout(timer);
    botTimers.delete(roomCode);
  }
}

function disconnectTimerKey(roomCode, playerId) {
  return `${roomCode}:${playerId}`;
}

function clearDisconnectTimer(roomCode, playerId) {
  const key = disconnectTimerKey(roomCode, playerId);
  const timer = disconnectTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(key);
  }
}

function scheduleAutoAdvance(room) {
  clearRoomTimer(room.roomCode);
  if (room.players.length < 2 || !AUTO_ADVANCE_PHASES.has(room.phase)) {
    return;
  }

  const timer = setTimeout(() => {
    const liveRoom = rooms.get(room.roomCode);
    if (!liveRoom || liveRoom.players.length < 2 || !AUTO_ADVANCE_PHASES.has(liveRoom.phase)) {
      clearRoomTimer(room.roomCode);
      return;
    }

    const result = applyAction(liveRoom, 0, "continue", {});
    if (result.ok) {
      broadcast(liveRoom);
    } else {
      clearRoomTimer(room.roomCode);
    }
  }, liveRoomDelay(room.phase));

  autoAdvanceTimers.set(room.roomCode, timer);
}

function liveRoomDelay(phase) {
  if (phase === "handSummary") return 2200;
  if (phase === "reveal") return 1600;
  return 1200;
}

function highestBid(room) {
  return Math.max(...room.bids.filter((value) => value !== null), 4);
}

function isJoker(card) {
  return card?.suit === "Gray" || card?.suit === "Color";
}

function cardStrengthForBot(room, card) {
  if (card.suit === "Color") return 1000;
  if (card.suit === "Gray") return room.trumpSuit ? 940 : 180;
  let value = card.power;
  if (card.rank === "A") value += 18;
  if (card.suit === room.trumpSuit) value += card.rank === "A" ? 80 : 40;
  return value;
}

function chooseBotBid(room, botIndex) {
  const hand = room.hands[botIndex];
  const score = hand.reduce((sum, card) => sum + cardStrengthForBot(room, card), 0);
  const high = highestBid(room);
  const target = score >= 95 ? 7 : score >= 82 ? 6 : 5;
  if (target > high) return target;
  return "pass";
}

function chooseBotTrump(room, botIndex) {
  const hand = room.hands[botIndex];
  return ["Heart", "Diamond", "Spade", "Clover"]
    .map((suit) => ({
      suit,
      score: hand.reduce((sum, card) => {
        if (card.suit !== suit) return sum;
        return sum + (card.rank === "A" ? 24 : card.rank === "K" ? 18 : card.rank === "Q" ? 15 : card.power);
      }, 0),
    }))
    .sort((left, right) => right.score - left.score)[0].suit;
}

function chooseBotDiscard(room, botIndex) {
  return [...room.hands[botIndex]]
    .sort((left, right) => cardStrengthForBot(room, left) - cardStrengthForBot(room, right))
    .slice(0, 3)
    .map((card) => card.id);
}

function chooseBotDrawAction(room, botIndex) {
  const firstCard = room.drawChoice?.firstCard;
  if (!firstCard) return "draw_keep_first";
  const score = cardStrengthForBot(room, firstCard);
  const wantsTrump = firstCard.suit === room.trumpSuit;
  const wantsJoker = isJoker(firstCard);
  return wantsJoker || wantsTrump || score >= 30 ? "draw_keep_first" : "draw_reject_first";
}

function chooseBotPlayCard(room, botIndex) {
  const hand = [...room.hands[botIndex]];
  const leadPlayer = room.trickLeader;
  const leadCard = room.selectedCards[leadPlayer];
  let legalCards = hand;

  if (room.phase === "play" && leadCard && room.selectedCards.some(Boolean)) {
    const sameSuitCards = hand.filter((card) => card.suit === leadCard.suit);
    const jokerCards = hand.filter((card) => isJoker(card));
    if (sameSuitCards.length > 0) {
      legalCards = [...sameSuitCards, ...jokerCards];
    }
  }

  const sorted = legalCards.sort((left, right) => cardStrengthForBot(room, left) - cardStrengthForBot(room, right));
  const isLeading = !room.selectedCards.some(Boolean);

  if (isLeading) {
    return sorted[Math.floor(sorted.length * 0.6)]?.id || sorted[0]?.id;
  }

  const winning = sorted.find((card) => {
    if (botIndex === leadPlayer) return false;
    const lead = room.selectedCards[leadPlayer];
    if (isJoker(card)) return true;
    if (isJoker(lead)) return false;
    if (card.suit === room.trumpSuit && lead.suit !== room.trumpSuit) return true;
    if (card.suit !== lead.suit && card.suit !== room.trumpSuit) return false;
    return cardStrengthForBot(room, card) > cardStrengthForBot(room, lead);
  });

  return (winning || sorted[0])?.id;
}

function botMoveForRoom(room, botIndex) {
  if (room.players.length < 2) return null;
  if (room.phase !== "discard" && room.currentPlayer !== botIndex) return null;

  switch (room.phase) {
    case "bid":
      return { action: "choose_bid", payload: { bid: chooseBotBid(room, botIndex) } };
    case "chooseTrump":
      return { action: "choose_trump", payload: { suit: chooseBotTrump(room, botIndex) } };
    case "discard":
      if (room.discardCounts?.[botIndex] >= 3) return null;
      return { action: "choose_hand_card", payload: { cardIds: chooseBotDiscard(room, botIndex) } };
    case "draw":
    case "refill":
      return { action: chooseBotDrawAction(room, botIndex), payload: {} };
    case "play": {
      const cardId = chooseBotPlayCard(room, botIndex);
      return cardId ? { action: "choose_hand_card", payload: { cardId } } : null;
    }
    default:
      return null;
  }
}

function scheduleBotTurn(room) {
  clearBotTimer(room.roomCode);
  const botIndex = room.players.findIndex((player) => player.isBot);
  if (botIndex === -1 || room.players.length < 2) return;

  const move = botMoveForRoom(room, botIndex);
  if (!move) return;

  const timer = setTimeout(() => {
    const liveRoom = rooms.get(room.roomCode);
    if (!liveRoom) {
      clearBotTimer(room.roomCode);
      return;
    }
    const liveBotIndex = liveRoom.players.findIndex((player) => player.isBot);
    if (liveBotIndex === -1) {
      clearBotTimer(room.roomCode);
      return;
    }

    const nextMove = botMoveForRoom(liveRoom, liveBotIndex);
    if (!nextMove) {
      clearBotTimer(room.roomCode);
      return;
    }

    const result = applyAction(liveRoom, liveBotIndex, nextMove.action, nextMove.payload || {});
    if (result.ok) {
      broadcast(liveRoom);
    } else {
      clearBotTimer(room.roomCode);
    }
  }, 700);

  botTimers.set(room.roomCode, timer);
}

function broadcast(room) {
  room.players.forEach((player, index) => {
    if (player.socket) {
      player.socket.playerIndex = index;
      send(player.socket, { type: "room_state", room: buildRoomView(room, index) });
    }
  });
  scheduleAutoAdvance(room);
  scheduleBotTurn(room);
}

function createAndAttachRoom(socket, name) {
  const room = createRoom();
  const player = attachPlayer(room, name);
  attachSocketToPlayer(room, 0, socket);
  rooms.set(room.roomCode, room);
  return { room, player };
}

function addBotPlayer(room, name = "Bot") {
  const player = attachPlayer(room, name);
  player.isBot = true;
  player.socket = null;
  return player;
}

function joinExistingRoom(room, socket, name) {
  const player = attachPlayer(room, name);
  attachSocketToPlayer(room, room.players.length - 1, socket);
  if (room.players.length === 2 && room.phase === "waiting") {
    startHand(room);
  }
  return player;
}

function attachSocketToPlayer(room, playerIndex, socket) {
  const player = room.players[playerIndex];
  player.socket = socket;
  player.disconnectedAt = null;
  socket.roomCode = room.roomCode;
  socket.playerIndex = playerIndex;
  socket.playerId = player.id;
  socket.playerToken = player.token;
  clearDisconnectTimer(room.roomCode, player.id);
  return player;
}

function resumeExistingPlayer(room, socket, playerId, token) {
  const playerIndex = room.players.findIndex((player) => player.id === playerId && player.token === token);
  if (playerIndex === -1) return null;
  return attachSocketToPlayer(room, playerIndex, socket);
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
  const player = room.players.find((entry) => entry.id === socket.playerId);
  if (!player || player.isBot) return;

  player.socket = null;
  player.disconnectedAt = Date.now();
  room.updatedAt = Date.now();
  broadcast(room);

  const key = disconnectTimerKey(room.roomCode, player.id);
  clearDisconnectTimer(room.roomCode, player.id);
  const timer = setTimeout(() => {
    const liveRoom = rooms.get(room.roomCode);
    if (!liveRoom) {
      disconnectTimers.delete(key);
      return;
    }
    const livePlayer = liveRoom.players.find((entry) => entry.id === player.id);
    if (!livePlayer || livePlayer.socket) {
      disconnectTimers.delete(key);
      return;
    }

    liveRoom.players = liveRoom.players.filter((entry) => entry.id !== player.id);
    const humansLeft = liveRoom.players.filter((entry) => !entry.isBot);
    if (liveRoom.players.length === 0 || humansLeft.length === 0) {
      clearRoomTimer(liveRoom.roomCode);
      clearBotTimer(liveRoom.roomCode);
      rooms.delete(liveRoom.roomCode);
      disconnectTimers.delete(key);
      return;
    }

    if (liveRoom.players.some((entry) => entry.isBot)) {
      liveRoom.players = liveRoom.players.filter((entry) => !entry.isBot);
      liveRoom.phase = "waiting";
      liveRoom.currentPlayer = 0;
    }
    liveRoom.updatedAt = Date.now();
    disconnectTimers.delete(key);
    broadcast(liveRoom);
  }, RECONNECT_GRACE_MS);
  disconnectTimers.set(key, timer);
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

    if (message.type === "resume_room") {
      const room = rooms.get(String(message.roomCode || "").toUpperCase());
      if (!room) {
        send(socket, { type: "error", message: "Previous room is no longer available." });
        return;
      }
      const player = resumeExistingPlayer(room, socket, String(message.playerId || ""), String(message.token || ""));
      if (!player) {
        send(socket, { type: "error", message: "Could not restore your seat." });
        return;
      }
      send(socket, { type: "info", message: `Reconnected to room ${room.roomCode}.` });
      broadcast(room);
      return;
    }

    if (message.type === "play_bot") {
      if (!name) {
        send(socket, { type: "error", message: "Name is required." });
        return;
      }
      const { room } = createAndAttachRoom(socket, name);
      addBotPlayer(room, "Table Bot");
      startHand(room);
      send(socket, { type: "info", message: `Bot match started in room ${room.roomCode}.` });
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
