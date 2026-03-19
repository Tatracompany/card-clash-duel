const state = {
  socket: null,
  room: null,
  loading: false,
  selectedCardIds: [],
  guestName: loadGuestName(),
  previewCard: null,
  lastDrawResultNonce: 0,
  previewTimer: null,
  reconnectTimer: null,
  reconnectAttempts: 0,
};

const $ = (id) => document.getElementById(id);
const els = {
  banner: $("statusBanner"),
  lobby: $("lobbyPanel"),
  game: $("gamePanel"),
  lobbyText: $("lobbyText"),
  roomCode: $("roomCodeLabel"),
  inviteLink: $("inviteLinkLabel"),
  players: $("roomPlayers"),
  opponentName: $("opponentName"),
  opponentHint: $("opponentHint"),
  opponentHand: $("opponentHand"),
  score1: $("score1"),
  score2: $("score2"),
  handInfo: $("handInfoText"),
  trump: $("trumpSuitText"),
  floatingTrump: $("floatingTrumpText"),
  phaseTitle: $("phaseTitle"),
  status: $("statusText"),
  played1: $("playedCard1"),
  played2: $("playedCard2"),
  trickPile: $("trickPile"),
  handTitle: $("handTitle"),
  handHint: $("handHint"),
  hand: $("handContainer"),
  copyInvite: $("copyInviteButton"),
  confirmCard: $("confirmCardButton"),
  bidPanel: $("bidPanel"),
  suitPanel: $("suitPickerPanel"),
  suitText: $("suitPickerText"),
  drawPanel: $("drawPanel"),
  drawPrompt: $("drawPrompt"),
  drawnCard: $("drawnCard"),
  keepFirst: $("keepFirstButton"),
  rejectFirst: $("rejectFirstButton"),
  drawPreviewPanel: $("drawPreviewPanel"),
  drawPreviewText: $("drawPreviewText"),
  drawPreviewCard: $("drawPreviewCard"),
};

const bidButtons = Array.from(document.querySelectorAll(".bid-button"));
const suitButtons = Array.from(document.querySelectorAll(".suit-button"));
const suitOrder = { Heart: 0, Diamond: 1, Spade: 2, Clover: 3, Gray: 4, Color: 5 };
const rankOrder = { A: 0, K: 1, Q: 2, J: 3, 10: 4, 9: 5, 8: 6, 7: 7, 6: 8, Joker: 9 };
const suitGlyphs = {
  Heart: "&hearts;",
  Diamond: "&diams;",
  Spade: "&spades;",
  Clover: "&clubs;",
  Gray: "&#10022;",
  Color: "&#10022;",
};
const pipLayouts = {
  A: ["cc"],
  6: ["tl", "tr", "ml", "mr", "bl", "br"],
  7: ["tl", "tr", "tc", "ml", "mr", "bl", "br"],
  8: ["tl", "tr", "tc", "ml", "mr", "bl", "br", "bc"],
  9: ["tl", "tr", "tc", "ml", "mr", "cc", "bl", "br", "bc"],
  10: ["tl", "tr", "tc", "ml", "mr", "ict", "icb", "bl", "br", "bc"],
};

function setBanner(text) {
  els.banner.textContent = text;
}

function suitGlyph(suit) {
  return suitGlyphs[suit] || "?";
}

function pipMarkup(rank, suit) {
  const positions = pipLayouts[rank] || ["cc"];
  return `
    <div class="pip-layout pip-count-${positions.length}">
      ${positions.map((position) => `<span class="pip pip-${position}">${suitGlyph(suit)}</span>`).join("")}
    </div>
  `;
}

function faceCardMarkup(card) {
  return `
    <div class="face-layout">
      <div class="face-rank-mark">${card.rank}</div>
      <div class="face-suit-mark">${suitGlyph(card.suit)}</div>
      <div class="face-rank-mark mirrored">${card.rank}</div>
    </div>
  `;
}

function jokerMarkup(card) {
  return `
    <div class="joker-layout ${card.suit === "Color" ? "color-joker" : "gray-joker"}">
      <div class="joker-side">JOKER</div>
      <div class="joker-center-mark">
        <div class="joker-icon">${card.suit === "Color" ? "&#10022;" : "&#9822;"}</div>
        <div class="joker-name">${card.suit === "Color" ? "COLOR" : "GRAY"}</div>
      </div>
      <div class="joker-side mirrored">JOKER</div>
    </div>
  `;
}

function sessionStoreKey() {
  return "card-clash-room-sessions";
}

function readSessions() {
  try {
    return JSON.parse(localStorage.getItem(sessionStoreKey()) || "{}");
  } catch {
    return {};
  }
}

function saveRoomSession(roomCode, session) {
  if (!roomCode || !session?.playerId || !session?.token) return;
  const sessions = readSessions();
  sessions[roomCode] = session;
  localStorage.setItem(sessionStoreKey(), JSON.stringify(sessions));
}

function getRoomSession(roomCode) {
  if (!roomCode) return null;
  const sessions = readSessions();
  return sessions[roomCode] || null;
}

function clearRoomSession(roomCode) {
  if (!roomCode) return;
  const sessions = readSessions();
  delete sessions[roomCode];
  localStorage.setItem(sessionStoreKey(), JSON.stringify(sessions));
}

function currentRoomCode() {
  return state.room?.roomCode || new URLSearchParams(location.search).get("room") || "";
}

function scheduleReconnect() {
  if (state.reconnectTimer) return;
  const delay = Math.min(4000, 1200 + state.reconnectAttempts * 600);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    state.reconnectAttempts += 1;
    connect();
  }, delay);
}

function showDrawPreview(card) {
  state.previewCard = card;
  if (state.previewTimer) {
    clearTimeout(state.previewTimer);
  }
  state.previewTimer = setTimeout(() => {
    state.previewCard = null;
    state.previewTimer = null;
    render();
  }, 1500);
}

function loadGuestName() {
  const key = "card-clash-guest-name";
  const existing = localStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const generated = `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
  localStorage.setItem(key, generated);
  return generated;
}

function send(type, payload = {}) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    setBanner("Connection lost. Refresh to reconnect.");
    return;
  }
  state.socket.send(JSON.stringify({ type, ...payload }));
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  state.socket = new WebSocket(`${protocol}//${location.host}`);

  state.socket.addEventListener("open", () => {
    state.reconnectAttempts = 0;
    setBanner("Connected. Start a private room or use quick match.");
    const roomCode = new URLSearchParams(location.search).get("room");
    if (roomCode) {
      state.loading = true;
      render();
      const savedSession = getRoomSession(roomCode.toUpperCase());
      if (savedSession) {
        send("resume_room", { roomCode: roomCode.toUpperCase(), ...savedSession });
      } else {
        send("join_room", { name: state.guestName, roomCode: roomCode.toUpperCase() });
      }
    }
  });

  state.socket.addEventListener("close", () => {
    setBanner("Disconnected. Trying to reconnect...");
    scheduleReconnect();
  });

  state.socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "info" || message.type === "error") {
      state.loading = false;
      if (message.type === "error" && message.message === "Could not restore your seat.") {
        clearRoomSession(currentRoomCode().toUpperCase());
      }
      setBanner(message.message);
      render();
      return;
    }
    if (message.type === "room_state") {
      state.room = message.room;
      state.loading = false;
       if (state.room.session) {
        saveRoomSession(state.room.roomCode, state.room.session);
      }
      const handIds = new Set(state.room.yourHand.map((card) => card.id));
      state.selectedCardIds = state.selectedCardIds.filter((cardId) => handIds.has(cardId));
      if (state.room.phase !== "discard" && state.selectedCardIds.length > 1) {
        state.selectedCardIds = state.selectedCardIds.slice(0, 1);
      }
      if (state.room.drawResult && state.room.drawResultNonce > state.lastDrawResultNonce) {
        state.lastDrawResultNonce = state.room.drawResultNonce;
        showDrawPreview(state.room.drawResult);
      }
      render();
    }
  });
}

function cardMarkup(card) {
  if (!card) return "?";
  const isRed = card.suit === "Heart" || card.suit === "Diamond";
  const colorClass = isRed ? "red" : "black";
  const center = card.rank === "Joker"
    ? `
      <div class="card-center joker-center">
        <div class="joker-title">${card.suit === "Color" ? "JOKER" : "JOKER"}</div>
        <div class="joker-glyph">${card.suit === "Color" ? "★" : "♛"}</div>
        <div class="joker-subtitle">${card.suit === "Color" ? "COLOR" : "GRAY"}</div>
      </div>
    `
    : `
      <div class="card-center">
        <div class="center-rank">${card.rank}</div>
        <div class="center-suit">${card.symbol}</div>
      </div>
    `;
  return `
    <div class="card-face ${colorClass}">
      <div class="card-corner top">
        <div class="corner-rank">${card.rank}</div>
        <div class="corner-suit">${card.symbol}</div>
      </div>
      ${center}
      <div class="card-corner bottom">
        <div class="corner-rank">${card.rank}</div>
        <div class="corner-suit">${card.symbol}</div>
      </div>
    </div>
  `;
}

function deckStyleCardMarkup(card) {
  if (!card) return "?";
  const isRed = card.suit === "Heart" || card.suit === "Diamond";
  const colorClass = isRed ? "red" : "black";
  const center = card.rank === "Joker"
    ? jokerMarkup(card)
    : ["J", "Q", "K"].includes(card.rank)
      ? faceCardMarkup(card)
      : pipMarkup(card.rank, card.suit);
  return `
    <div class="card-face ${colorClass}">
      <div class="card-corner top">
        <div class="corner-rank">${card.rank}</div>
        <div class="corner-suit">${suitGlyph(card.suit)}</div>
      </div>
      ${center}
      <div class="card-corner bottom">
        <div class="corner-rank">${card.rank}</div>
        <div class="corner-suit">${suitGlyph(card.suit)}</div>
      </div>
    </div>
  `;
}

function renderPlayed(el, card) {
  if (!card) {
    el.className = "played-card empty";
    el.textContent = "";
    return;
  }
  el.className = "played-card revealed";
  el.innerHTML = deckStyleCardMarkup(card);
}

function hideActionPanels() {
  els.bidPanel.hidden = true;
  els.suitPanel.hidden = true;
  els.drawPanel.hidden = true;
  els.drawPreviewPanel.hidden = true;
}

function getConfirmCardLabel(room) {
  if (room.phase === "discard") {
    return state.selectedCardIds.length === 3
      ? "Discard 3 Selected Cards"
      : `Select 3 Cards (${state.selectedCardIds.length}/3)`;
  }
  if (room.phase === "play") return "Play Selected Card";
  return "Confirm Card";
}

function renderOpponentHand(room) {
  els.opponentHand.innerHTML = "";
  const total = room.opponentHandCount || 0;
  const displayCount = Math.min(total, 8);
  const midpoint = Math.max(displayCount - 1, 0) / 2;

  for (let index = 0; index < displayCount; index += 1) {
    const back = document.createElement("div");
    back.className = "card-back";
    const offset = index - midpoint;
    back.style.setProperty("--offset", `${offset}`);
    back.style.setProperty("--lift", `${Math.abs(offset) * 2}px`);
    back.style.setProperty("--rotation", `${offset * 6}deg`);
    els.opponentHand.appendChild(back);
  }

  if (total > 8) {
    const counter = document.createElement("div");
    counter.className = "card-back counter";
    counter.textContent = `+${total - 8}`;
    els.opponentHand.appendChild(counter);
  }
}

function renderHand(room) {
  els.hand.innerHTML = "";
  const sortedHand = [...room.yourHand].sort((left, right) => {
    const suitDiff = (suitOrder[left.suit] ?? 99) - (suitOrder[right.suit] ?? 99);
    if (suitDiff !== 0) return suitDiff;
    return (rankOrder[left.rank] ?? 99) - (rankOrder[right.rank] ?? 99);
  });
  const handCount = Math.max(sortedHand.length, 1);
  const handWidth = (els.hand.clientWidth || els.hand.parentElement?.clientWidth || window.innerWidth - 40) - 8;
  const isCompact = window.innerWidth <= 680;
  const maxWidth = isCompact ? 56 : 80;
  const minWidth = isCompact ? 30 : 46;
  const overlapTarget = isCompact ? 0.66 : 0.54;
  const computedWidth = Math.floor(handWidth / (1 + (handCount - 1) * (1 - overlapTarget)));
  const cardWidth = Math.max(minWidth, Math.min(maxWidth, computedWidth));
  const overlap = Math.round(cardWidth * overlapTarget);
  els.hand.style.setProperty("--card-width", `${cardWidth}px`);
  els.hand.style.setProperty("--card-overlap", `${overlap}px`);
  const midpoint = Math.max(sortedHand.length - 1, 0) / 2;

  sortedHand.forEach((card, index) => {
    const button = document.createElement("button");
    button.className = "hand-card";
    button.type = "button";
    button.disabled = !room.actions.canChooseHandCard || state.loading;
    const offset = index - midpoint;
    button.style.setProperty("--offset", `${offset}`);
    button.style.setProperty("--lift", `${Math.abs(offset) * 5}px`);
    button.style.setProperty("--rotation", `${offset * 4.5}deg`);
    button.style.zIndex = String(100 + index);
    if (state.selectedCardIds.includes(card.id)) {
      button.classList.add(room.phase === "discard" ? "discard-selected" : "selected");
    }
    if (room.followSuit && card.rank !== "Joker" && card.suit !== room.followSuit) {
      button.classList.add("muted");
    }
    button.innerHTML = deckStyleCardMarkup(card);
    button.addEventListener("click", () => {
      if (!room.actions.canChooseHandCard || state.loading) return;
      if (room.phase === "discard") {
        if (state.selectedCardIds.includes(card.id)) {
          state.selectedCardIds = state.selectedCardIds.filter((id) => id !== card.id);
        } else if (state.selectedCardIds.length < 3) {
          state.selectedCardIds = [...state.selectedCardIds, card.id];
        } else {
          state.selectedCardIds = [...state.selectedCardIds.slice(1), card.id];
        }
      } else {
        state.selectedCardIds = [card.id];
      }
      render();
    });
    els.hand.appendChild(button);
  });
}

function renderRoom(room) {
  els.lobby.hidden = true;
  els.game.hidden = false;
  hideActionPanels();

  els.roomCode.textContent = room.roomCode ? `Room: ${room.roomCode}` : "Quick Match";
  const inviteUrl = room.roomCode ? `${location.origin}?room=${encodeURIComponent(room.roomCode)}` : "";
  if (room.roomCode) {
    const currentRoom = new URLSearchParams(location.search).get("room");
    if (currentRoom !== room.roomCode) {
      history.replaceState({}, "", `?room=${encodeURIComponent(room.roomCode)}`);
    }
  }
  els.inviteLink.textContent = inviteUrl || "Create a room to get a link";
  els.players.textContent = `You: ${room.you.name} | Opponent: ${room.opponent ? room.opponent.name : "Waiting..."}`;
  els.opponentName.textContent = room.opponent ? room.opponent.name : "Waiting...";
  els.opponentHint.textContent = `${room.opponentHandCount || 0} card${room.opponentHandCount === 1 ? "" : "s"}`;
  els.score1.textContent = String(room.matchPoints[0]);
  els.score2.textContent = String(room.matchPoints[1]);
  els.handInfo.textContent = room.handInfo;
  els.trump.textContent = room.trumpSuit || "Not chosen yet";
  els.floatingTrump.textContent = room.trumpSuit || "Not chosen";
  els.phaseTitle.textContent = room.phaseTitle;
  els.status.textContent = room.statusText;
  renderPlayed(els.played1, room.playedCards[0]);
  renderPlayed(els.played2, room.playedCards[1]);
  const hasPlayedCards = Boolean(room.playedCards[0] || room.playedCards[1]);
  if (els.trickPile) {
    els.trickPile.classList.toggle("empty-state", !hasPlayedCards);
  }
  if (els.handTitle) els.handTitle.textContent = room.handTitle;
  if (els.handHint) els.handHint.textContent = room.handHint;
  renderOpponentHand(room);
  renderHand(room);

  els.copyInvite.hidden = !room.roomCode;
  els.copyInvite.disabled = state.loading || !room.roomCode;
  els.confirmCard.hidden = !room.actions.canChooseHandCard;
  els.confirmCard.disabled = !room.actions.canChooseHandCard
    || state.loading
    || (room.phase === "discard" ? state.selectedCardIds.length !== 3 : state.selectedCardIds.length !== 1);
  els.confirmCard.textContent = getConfirmCardLabel(room);

  if (room.actions.canBid) {
    els.bidPanel.hidden = false;
    bidButtons.forEach((button) => {
      const bid = button.dataset.bid;
      button.disabled = state.loading || (bid !== "pass" && !room.allowedBids.includes(Number(bid)));
    });
  }

  if (room.actions.canChooseTrump) {
    els.suitPanel.hidden = false;
    els.suitText.textContent = room.suitPrompt;
    suitButtons.forEach((button) => {
      button.disabled = state.loading;
    });
  }

  if (room.actions.canChooseDraw && room.drawChoice) {
    els.drawPanel.hidden = false;
    els.drawPrompt.textContent = room.drawPrompt;
    els.drawnCard.className = "played-card revealed";
    els.drawnCard.innerHTML = deckStyleCardMarkup(room.drawChoice.firstCard);
    els.keepFirst.disabled = state.loading;
    els.rejectFirst.disabled = state.loading;
  } else {
    els.drawnCard.className = "played-card empty";
    els.drawnCard.textContent = "?";
  }

  if (state.previewCard) {
    els.drawPreviewPanel.hidden = false;
    els.drawPreviewText.textContent = `You were forced to take ${roomCardLabel(state.previewCard)}.`;
    els.drawPreviewCard.className = "played-card revealed";
    els.drawPreviewCard.innerHTML = deckStyleCardMarkup(state.previewCard);
  } else {
    els.drawPreviewCard.className = "played-card empty";
    els.drawPreviewCard.textContent = "?";
  }
}

function roomCardLabel(card) {
  if (!card) return "that card";
  return card.rank === "Joker" ? `${card.suit} Joker` : `${card.rank} of ${card.suit}`;
}

function render() {
  if (!state.room) {
    els.lobby.hidden = false;
    els.game.hidden = true;
    els.lobbyText.textContent = `You are ${state.guestName}. Start a private room and share the invite link with your friend.`;
    return;
  }
  renderRoom(state.room);
}

$("quickMatchButton").addEventListener("click", () => {
  state.loading = true;
  render();
  send("quick_match", { name: state.guestName });
});

$("playBotButton").addEventListener("click", () => {
  state.loading = true;
  render();
  send("play_bot", { name: state.guestName });
});

$("createRoomButton").addEventListener("click", () => {
  state.loading = true;
  render();
  send("create_room", { name: state.guestName });
});

els.copyInvite.addEventListener("click", async () => {
  if (!state.room?.roomCode) return;
  const inviteUrl = `${location.origin}?room=${encodeURIComponent(state.room.roomCode)}`;
  try {
    await navigator.clipboard.writeText(inviteUrl);
    setBanner("Invite link copied.");
  } catch {
    setBanner(inviteUrl);
  }
});

els.confirmCard.addEventListener("click", () => {
  if (!state.room) return;
  if (state.room.phase === "discard" && state.selectedCardIds.length !== 3) return;
  if (state.room.phase !== "discard" && state.selectedCardIds.length !== 1) return;
  state.loading = true;
  render();
  send("action", {
    action: "choose_hand_card",
    payload: state.room.phase === "discard"
      ? { cardIds: state.selectedCardIds }
      : { cardId: state.selectedCardIds[0] },
  });
});

els.keepFirst.addEventListener("click", () => {
  state.loading = true;
  render();
  send("action", { action: "draw_keep_first" });
});

els.rejectFirst.addEventListener("click", () => {
  state.loading = true;
  render();
  send("action", { action: "draw_reject_first" });
});

bidButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const bid = button.dataset.bid;
    state.loading = true;
    render();
    send("action", { action: "choose_bid", payload: { bid: bid === "pass" ? "pass" : Number(bid) } });
  });
});

suitButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.loading = true;
    render();
    send("action", { action: "choose_trump", payload: { suit: button.dataset.suit } });
  });
});

connect();
render();
