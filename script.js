const state = {
  socket: null,
  room: null,
  loading: false,
  selectedCardId: null,
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
  opponentName: $("opponentName"),
  opponentHint: $("opponentHint"),
  opponentHand: $("opponentHand"),
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
  confirmCard: $("confirmCardButton"),
  drawOne: $("drawOneButton"),
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

function setBanner(text) {
  els.banner.textContent = text;
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
    setBanner("Connected. Create a room, join a room, or use quick match.");
  });

  state.socket.addEventListener("close", () => {
    setBanner("Disconnected. Refresh the page to reconnect.");
  });

  state.socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "info" || message.type === "error") {
      state.loading = false;
      setBanner(message.message);
      render();
      return;
    }
    if (message.type === "room_state") {
      state.room = message.room;
      state.loading = false;
      if (!state.room.yourHand.some((card) => card.id === state.selectedCardId)) {
        state.selectedCardId = null;
      }
      render();
    }
  });
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
  const isRed = card.suit === "Heart" || card.suit === "Diamond";
  const colorClass = isRed ? "red" : "black";
  const center = card.rank === "Joker"
    ? `<div class="card-center joker-word">${card.suit}</div>`
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

function getConfirmCardLabel(room) {
  if (room.phase === "discard") return "Discard Selected Card";
  if (room.phase === "play") return "Play Selected Card";
  return "Confirm Card";
}

function renderOpponentHand(room) {
  els.opponentHand.innerHTML = "";
  const total = room.opponentHandCount || 0;
  const displayCount = Math.min(total, 8);

  for (let index = 0; index < displayCount; index += 1) {
    const back = document.createElement("div");
    back.className = "card-back";
    back.style.setProperty("--offset", `${index}`);
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

  sortedHand.forEach((card) => {
    const button = document.createElement("button");
    button.className = "hand-card";
    button.type = "button";
    button.disabled = !room.actions.canChooseHandCard || state.loading;
    if (state.selectedCardId === card.id) {
      button.classList.add("selected");
    }
    button.innerHTML = cardMarkup(card);
    button.addEventListener("click", () => {
      if (!room.actions.canChooseHandCard || state.loading) return;
      state.selectedCardId = card.id;
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
  els.players.textContent = `You: ${room.you.name} | Opponent: ${room.opponent ? room.opponent.name : "Waiting..."}`;
  els.opponentName.textContent = room.opponent ? room.opponent.name : "Waiting...";
  els.opponentHint.textContent = `${room.opponentHandCount || 0} card${room.opponentHandCount === 1 ? "" : "s"}`;
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
  renderOpponentHand(room);
  renderHand(room);

  els.continue.hidden = !room.actions.canContinue;
  els.continue.disabled = !room.actions.canContinue || state.loading;
  els.confirmCard.hidden = !room.actions.canChooseHandCard;
  els.confirmCard.disabled = !room.actions.canChooseHandCard || state.loading || !state.selectedCardId;
  els.confirmCard.textContent = getConfirmCardLabel(room);
  els.drawOne.hidden = !room.actions.canDrawOne;
  els.drawOne.disabled = !room.actions.canDrawOne || state.loading;

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

$("quickMatchButton").addEventListener("click", () => {
  const name = requireName();
  if (!name) return;
  state.loading = true;
  render();
  send("quick_match", { name });
});

$("createRoomButton").addEventListener("click", () => {
  const name = requireName();
  if (!name) return;
  state.loading = true;
  render();
  send("create_room", { name });
});

$("joinRoomButton").addEventListener("click", () => {
  const name = requireName();
  if (!name) return;
  const roomCode = els.roomCodeInput.value.trim().toUpperCase();
  if (!roomCode) {
    setBanner("Enter a room code to join.");
    return;
  }
  state.loading = true;
  render();
  send("join_room", { name, roomCode });
});

els.continue.addEventListener("click", () => {
  state.loading = true;
  render();
  send("action", { action: "continue" });
});

els.confirmCard.addEventListener("click", () => {
  if (!state.selectedCardId) return;
  state.loading = true;
  render();
  send("action", { action: "choose_hand_card", payload: { cardId: state.selectedCardId } });
});

els.drawOne.addEventListener("click", () => {
  state.loading = true;
  render();
  send("action", { action: "draw_one_card" });
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
