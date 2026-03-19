const SESSION_KEY = "card-clash-session";
const POLL_MS = 2000;

const state = {
  room: null,
  session: loadSession(),
  pollTimer: null,
  loading: false,
};

const $ = (id) => document.getElementById(id);
const els = {
  banner: $("statusBanner"),
  lobby: $("lobbyPanel"),
  game: $("gamePanel"),
  name: $("nameInput"),
  roomCodeInput: $("roomCodeInput"),
  roomCode: $("roomCodeLabel"),
  players: $("roomPlayers"),
  score1: $("score1"),
  score2: $("score2"),
  handInfo: $("handInfoText"),
  trump: $("trumpSuitText"),
  phaseTitle: $("phaseTitle"),
  status: $("statusText"),
  played1: $("playedCard1"),
  played2: $("playedCard2"),
  handTitle: $("handTitle"),
  handHint: $("handHint"),
  hand: $("handContainer"),
  continue: $("continueButton"),
  bidPanel: $("bidPanel"),
  suitPanel: $("suitPickerPanel"),
  suitText: $("suitPickerText"),
  drawPanel: $("drawPanel"),
  drawPrompt: $("drawPrompt"),
  drawnCard: $("drawnCard"),
  keepFirst: $("keepFirstButton"),
  rejectFirst: $("rejectFirstButton"),
};

const bidButtons = Array.from(document.querySelectorAll(".bid-button"));
const suitButtons = Array.from(document.querySelectorAll(".suit-button"));
const suitOrder = { Heart: 0, Diamond: 1, Spade: 2, Clover: 3, Gray: 4, Color: 5 };
const rankOrder = { A: 0, K: 1, Q: 2, J: 3, 10: 4, 9: 5, 8: 6, 7: 7, 6: 8, Joker: 9 };

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  state.session = session;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  state.session = null;
  localStorage.removeItem(SESSION_KEY);
}

function setBanner(text) {
  els.banner.textContent = text;
}

async function api(method, payload = null, query = "") {
  const response = await fetch(`/api/game${query}`, {
    method,
    headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(payload) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function requireName() {
  const name = els.name.value.trim();
  if (!name) {
    setBanner("Enter your name first.");
    return null;
  }
  return name;
}

function cardMarkup(card) {
  if (!card) return "?";
  return `
    <div class="card-face">
      <div class="card-rank">${card.rank}</div>
      <div class="card-suit">${card.symbol}</div>
      <div class="card-power">${card.label}</div>
    </div>
  `;
}

function renderPlayed(el, card) {
  if (!card) {
    el.className = "played-card empty";
    el.textContent = "?";
    return;
  }
  el.className = "played-card revealed";
  el.innerHTML = cardMarkup(card);
}

function hideActionPanels() {
  els.bidPanel.hidden = true;
  els.suitPanel.hidden = true;
  els.drawPanel.hidden = true;
}

function renderHand(room) {
  els.hand.innerHTML = "";
  const sortedHand = [...room.yourHand].sort((left, right) => {
    const suitDiff = (suitOrder[left.suit] ?? 99) - (suitOrder[right.suit] ?? 99);
    if (suitDiff !== 0) {
      return suitDiff;
    }
    return (rankOrder[left.rank] ?? 99) - (rankOrder[right.rank] ?? 99);
  });

  sortedHand.forEach((card) => {
    const button = document.createElement("button");
    button.className = "hand-card";
    button.type = "button";
    button.disabled = !room.actions.canChooseHandCard || state.loading;
    button.innerHTML = `
      <div class="suit">${card.symbol}</div>
      <div class="rank">${card.rank}</div>
      <div class="power">${card.label}</div>
    `;
    button.addEventListener("click", () => performAction("choose_hand_card", { cardId: card.id }));
    els.hand.appendChild(button);
  });
}

function renderRoom(room) {
  els.lobby.hidden = true;
  els.game.hidden = false;
  hideActionPanels();

  els.roomCode.textContent = room.roomCode ? `Room: ${room.roomCode}` : "Quick Match";
  els.players.textContent = `You: ${room.you.name} | Opponent: ${room.opponent ? room.opponent.name : "Waiting..."}`;
  els.score1.textContent = String(room.matchPoints[0]);
  els.score2.textContent = String(room.matchPoints[1]);
  els.handInfo.textContent = room.handInfo;
  els.trump.textContent = room.trumpSuit || "Not chosen yet";
  els.phaseTitle.textContent = room.phaseTitle;
  els.status.textContent = room.statusText;
  els.handTitle.textContent = room.handTitle;
  els.handHint.textContent = room.handHint;
  renderPlayed(els.played1, room.playedCards[0]);
  renderPlayed(els.played2, room.playedCards[1]);
  renderHand(room);

  els.continue.hidden = !room.actions.canContinue;
  els.continue.disabled = !room.actions.canContinue || state.loading;

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
    els.drawnCard.innerHTML = cardMarkup(room.drawChoice.firstCard);
    els.keepFirst.disabled = state.loading;
    els.rejectFirst.disabled = state.loading;
  } else {
    els.drawnCard.className = "played-card empty";
    els.drawnCard.textContent = "?";
  }
}

function render() {
  if (!state.room) {
    els.lobby.hidden = false;
    els.game.hidden = true;
    return;
  }
  renderRoom(state.room);
}

async function syncState() {
  if (!state.session) return;
  try {
    const params = new URLSearchParams({
      op: "state",
      roomCode: state.session.roomCode,
      playerId: state.session.playerId,
      token: state.session.token,
    });
    const data = await api("GET", null, `?${params.toString()}`);
    state.room = data.room;
    render();
  } catch (error) {
    setBanner(error.message);
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(syncState, POLL_MS);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function beginSession(op, payload) {
  state.loading = true;
  render();
  try {
    const data = await api("POST", { op, ...payload });
    saveSession({
      roomCode: data.roomCode,
      playerId: data.playerId,
      token: data.token,
      name: payload.name,
    });
    state.room = data.room;
    startPolling();
    setBanner("Connected to room.");
  } catch (error) {
    setBanner(error.message);
  } finally {
    state.loading = false;
    render();
  }
}

async function performAction(action, payload = {}) {
  if (!state.session) return;
  state.loading = true;
  render();
  try {
    const data = await api("POST", {
      op: "action",
      roomCode: state.session.roomCode,
      playerId: state.session.playerId,
      token: state.session.token,
      action,
      payload,
    });
    state.room = data.room;
  } catch (error) {
    setBanner(error.message);
  } finally {
    state.loading = false;
    render();
  }
}

async function restoreSession() {
  if (!state.session) {
    render();
    return;
  }
  els.name.value = state.session.name || "";
  await syncState();
  startPolling();
}

$("quickMatchButton").addEventListener("click", () => {
  const name = requireName();
  if (name) beginSession("quick_match", { name });
});

$("createRoomButton").addEventListener("click", () => {
  const name = requireName();
  if (name) beginSession("create_room", { name });
});

$("joinRoomButton").addEventListener("click", () => {
  const name = requireName();
  const roomCode = els.roomCodeInput.value.trim().toUpperCase();
  if (!roomCode) {
    setBanner("Enter a room code to join.");
    return;
  }
  beginSession("join_room", { name, roomCode });
});

els.continue.addEventListener("click", () => performAction("continue"));
els.keepFirst.addEventListener("click", () => performAction("draw_keep_first"));
els.rejectFirst.addEventListener("click", () => performAction("draw_reject_first"));

bidButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const bid = button.dataset.bid;
    performAction("choose_bid", { bid: bid === "pass" ? "pass" : Number(bid) });
  });
});

suitButtons.forEach((button) => {
  button.addEventListener("click", () => performAction("choose_trump", { suit: button.dataset.suit }));
});

window.addEventListener("beforeunload", () => {
  stopPolling();
});

restoreSession();
