const crypto = require("crypto");

const BID_VALUES = [5, 6, 7, 8, 9];
const TRUMP_SUITS = ["Heart", "Diamond", "Spade", "Clover"];

function randomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function randomToken() {
  return crypto.randomUUID();
}

function createDeck() {
  const symbols = { Spade: "♠", Heart: "♥", Diamond: "♦", Clover: "♣", Joker: "★" };
  const ordered = [
    ["A", "Spade", 14], ["A", "Heart", 14], ["A", "Diamond", 14], ["A", "Clover", 14],
    ["Joker", "Gray", 16], ["Joker", "Color", 17],
    ["K", "Spade", 13], ["K", "Heart", 13], ["K", "Diamond", 13], ["K", "Clover", 13],
    ["Q", "Spade", 12], ["Q", "Heart", 12], ["Q", "Diamond", 12], ["Q", "Clover", 12],
    ["J", "Spade", 11], ["J", "Heart", 11], ["J", "Diamond", 11], ["J", "Clover", 11],
    ["10", "Spade", 10], ["10", "Heart", 10], ["10", "Diamond", 10], ["10", "Clover", 10],
    ["9", "Spade", 9], ["9", "Heart", 9], ["9", "Diamond", 9], ["9", "Clover", 9],
    ["8", "Spade", 8], ["8", "Heart", 8], ["8", "Diamond", 8], ["8", "Clover", 8],
    ["7", "Spade", 7], ["7", "Heart", 7], ["7", "Diamond", 7], ["7", "Clover", 7],
    ["6", "Heart", 6], ["6", "Diamond", 6],
  ];
  return ordered.map(([rank, suit, power], index) => ({
    id: `${index + 1}-${rank}-${suit}`,
    rank,
    suit,
    power,
    symbol: symbols[suit] || symbols.Joker,
  }));
}

function shuffle(cards) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardLabel(card) {
  return card.rank === "Joker" ? `${card.suit} Joker` : `${card.rank} of ${card.suit}`;
}

function publicCard(card) {
  if (!card) return null;
  return {
    id: card.id,
    rank: card.rank,
    suit: card.suit,
    symbol: card.symbol,
    label: cardLabel(card),
  };
}

function createRoom(roomCode = randomCode()) {
  return {
    roomCode,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    players: [],
    matchPoints: [0, 0],
    phase: "waiting",
    deck: [],
    discardPile: [],
    hands: [[], []],
    bids: [null, null],
    passedBid: [false, false],
    bidWinner: null,
    contractor: null,
    contractTarget: null,
    trumpSuit: null,
    currentPlayer: 0,
    scores: [0, 0],
    roundsPlayed: 0,
    selectedCards: [null, null],
    lastTrickWinner: null,
    discardCounts: [0, 0],
    drawQueue: [],
    drawChoice: null,
  };
}

function attachPlayer(room, name) {
  const player = {
    id: crypto.randomUUID(),
    token: randomToken(),
    name: String(name || "").trim().slice(0, 24),
  };
  room.players.push(player);
  room.updatedAt = Date.now();
  return player;
}

function startHand(room) {
  const deck = shuffle(createDeck());
  room.phase = "bid";
  room.deck = deck.slice(10);
  room.discardPile = [];
  room.hands = [deck.slice(0, 5), deck.slice(5, 10)];
  room.bids = [null, null];
  room.passedBid = [false, false];
  room.bidWinner = null;
  room.contractor = null;
  room.contractTarget = null;
  room.trumpSuit = null;
  room.currentPlayer = 0;
  room.scores = [0, 0];
  room.roundsPlayed = 0;
  room.selectedCards = [null, null];
  room.lastTrickWinner = null;
  room.discardCounts = [0, 0];
  room.drawQueue = [];
  room.drawChoice = null;
  room.updatedAt = Date.now();
}

function findPlayerIndex(room, playerId, token) {
  return room.players.findIndex((player) => player.id === playerId && player.token === token);
}

function draw(room) {
  return room.deck.shift() || null;
}

function refillHands(room) {
  let index = 0;
  while (room.deck.length > 0 && (room.hands[0].length < 9 || room.hands[1].length < 9)) {
    if (room.hands[index].length < 9) {
      room.hands[index].push(draw(room));
    }
    index = index === 0 ? 1 : 0;
  }
}

function getStrength(room, card) {
  if (card.suit === "Color") return 1000;
  if (card.suit === room.trumpSuit) {
    if (card.rank === "A") return 950;
    if (card.rank === "K") return 930;
    if (card.rank === "Q") return 920;
    if (card.rank === "J") return 910;
    return 900 + card.power;
  }
  if (card.suit === "Gray") return 940;
  return card.power;
}

function compareCards(room, card1, card2) {
  const joker1 = card1.suit === "Gray" || card1.suit === "Color";
  const joker2 = card2.suit === "Gray" || card2.suit === "Color";
  if (joker1 && !joker2) return -1;
  if (!joker1 && joker2) return 1;
  if (joker1 && joker2) return -1;
  const s1 = getStrength(room, card1);
  const s2 = getStrength(room, card2);
  if (s1 === s2) return 0;
  return s1 > s2 ? 1 : -1;
}

function buildHandInfo(room) {
  if (room.contractTarget && room.contractor !== null) {
    return `Contract: P${room.contractor + 1} bid ${room.contractTarget} | Tricks: P1 ${room.scores[0]} - P2 ${room.scores[1]} | Match to 21`;
  }
  const b1 = room.passedBid[0] ? "Pass" : room.bids[0] ?? "?";
  const b2 = room.passedBid[1] ? "Pass" : room.bids[1] ?? "?";
  return `Bids: P1 ${b1} | P2 ${b2} | Match to 21`;
}

function buildPhaseTitle(room, playerIndex) {
  if (room.players.length < 2) return "Waiting For Opponent";
  const ownTurn = room.currentPlayer === playerIndex;
  switch (room.phase) {
    case "gameOver": return "Match Over";
    case "handSummary": return "Hand Summary";
    case "bid": return ownTurn ? "Your Bid" : "Opponent Bidding";
    case "bidReveal": return "Bid Result";
    case "chooseTrump": return room.bidWinner === playerIndex ? "Choose Trump" : "Opponent Choosing Trump";
    case "discard": return ownTurn ? "Discard 3 Cards" : "Opponent Discarding";
    case "draw": return ownTurn ? "Draw Choice" : "Opponent Draw Choice";
    case "refill": return ownTurn ? "Draw To 9" : "Opponent Drawing";
    case "refillSummary": return "Hands Ready";
    case "play": return ownTurn ? `Trick ${room.roundsPlayed + 1}: Your Turn` : `Trick ${room.roundsPlayed + 1}: Opponent Turn`;
    case "reveal": return `Trick ${room.roundsPlayed} Result`;
    default: return "Room";
  }
}

function buildStatusText(room, playerIndex) {
  if (room.players.length < 2) return `Room ${room.roomCode} is waiting for a second player.`;
  const ownTurn = room.currentPlayer === playerIndex;
  switch (room.phase) {
    case "bid": {
      const high = Math.max(...room.bids.filter((v) => v !== null), 4);
      return ownTurn
        ? (high >= 5 ? `Bid higher than ${high} or pass.` : "Choose an opening bid from 5 to 9 or pass.")
        : "Waiting for the other player to bid.";
    }
    case "bidReveal":
      return room.passedBid[0] && room.passedBid[1]
        ? "Both players passed. A random player will be forced to bid 5."
        : `Player ${room.bidWinner + 1} wins the bid with ${room.bids[room.bidWinner]}.`;
    case "chooseTrump":
      return room.bidWinner === playerIndex ? "Pick the strongest suit." : "Waiting for trump choice.";
    case "discard":
      return ownTurn ? `Discard ${3 - room.discardCounts[playerIndex]} more card(s).` : "Waiting for the other player to discard.";
    case "draw":
      return ownTurn ? "Keep the first card or reject it and take the second." : "Waiting for the other player's draw choice.";
    case "refill":
      return ownTurn ? "Draw one card from the deck." : "Waiting for the other player to draw.";
    case "refillSummary":
      return "Both players reached 9 cards. The hand is ready.";
    case "play":
      return ownTurn ? "Choose one card for this trick." : room.selectedCards[0] ? "Waiting for the trick to resolve." : "Waiting for the first play.";
    case "reveal":
      return room.lastTrickWinner === null ? "This trick tied." : `Player ${room.lastTrickWinner + 1} wins the trick.`;
    case "handSummary": {
      const made = room.scores[room.contractor] >= room.contractTarget;
      return made
        ? `Player ${room.contractor + 1} made the bid and earns ${room.contractTarget} point(s).`
        : `Player ${room.contractor + 1} missed the bid and earns no points.`;
    }
    case "gameOver": {
      const winner = room.matchPoints[0] >= 21 ? 0 : 1;
      return `Player ${winner + 1} reaches ${room.matchPoints[winner]} points and wins the match.`;
    }
    default:
      return "Waiting.";
  }
}

function buildHandHint(room, playerIndex) {
  if (room.players.length < 2) return "Share the room code or send the Netlify URL to your friend.";
  if (room.phase === "discard" || room.phase === "play") return `${room.hands[playerIndex].length} card(s) in your hand.`;
  if (room.phase === "refill") return `${room.hands[playerIndex].length} of 9 cards ready.`;
  if (room.phase === "draw") return "If you keep the first card, the second is discarded unseen.";
  if (room.phase === "handSummary") return "Continue to deal the next hand unless someone reached 21.";
  return "Only your own hand is visible on this phone.";
}

function buildRoomView(room, playerIndex) {
  const highBid = Math.max(...room.bids.filter((v) => v !== null), 4);
  return {
    phase: room.phase,
    roomCode: room.roomCode,
    you: { name: room.players[playerIndex]?.name || "You" },
    opponent: room.players[playerIndex === 0 ? 1 : 0] ? { name: room.players[playerIndex === 0 ? 1 : 0].name } : null,
    opponentHandCount: room.players[playerIndex === 0 ? 1 : 0] ? room.hands[playerIndex === 0 ? 1 : 0].length : 0,
    matchPoints: room.matchPoints,
    handInfo: buildHandInfo(room),
    trumpSuit: room.trumpSuit,
    phaseTitle: buildPhaseTitle(room, playerIndex),
    statusText: buildStatusText(room, playerIndex),
    handTitle: room.players.length < 2 ? "Waiting Room" : "Your Hand",
    handHint: buildHandHint(room, playerIndex),
    yourHand: room.hands[playerIndex].map(publicCard),
    playedCards: room.selectedCards.map(publicCard),
    allowedBids: BID_VALUES.filter((bid) => bid > highBid),
    suitPrompt: "Choose the strongest suit.",
    drawChoice: ["draw", "refill"].includes(room.phase) && room.currentPlayer === playerIndex && room.drawChoice
      ? { firstCard: publicCard(room.drawChoice.firstCard) }
      : null,
    drawPrompt: ["draw", "refill"].includes(room.phase) && room.currentPlayer === playerIndex && room.drawChoice
      ? `${room.phase === "refill" ? "Refill card" : "First card"}: ${cardLabel(room.drawChoice.firstCard)}`
      : "",
    actions: {
      canBid: room.phase === "bid" && room.currentPlayer === playerIndex,
      canChooseTrump: room.phase === "chooseTrump" && room.bidWinner === playerIndex,
      canChooseHandCard: ["discard", "play"].includes(room.phase) && room.currentPlayer === playerIndex,
      canChooseDraw: ["draw", "refill"].includes(room.phase) && room.currentPlayer === playerIndex,
      canContinue: ["bidReveal", "refillSummary", "reveal", "handSummary"].includes(room.phase),
    },
  };
}

function startDrawTurn(room) {
  room.drawChoice = { firstCard: draw(room), secondCard: draw(room) };
  room.phase = "draw";
}

function finishHand(room) {
  if (room.scores[room.contractor] >= room.contractTarget) {
    room.matchPoints[room.contractor] += room.contractTarget;
  }
  room.phase = room.matchPoints[0] >= 21 || room.matchPoints[1] >= 21 ? "gameOver" : "handSummary";
}

function startManualRefill(room) {
  room.phase = "refill";
  room.currentPlayer = room.hands[0].length < 9 ? 0 : 1;
  startDrawTurn(room);
}

function advanceManualRefill(room) {
  const bothFull = room.hands[0].length >= 9 && room.hands[1].length >= 9;
  if (bothFull || room.deck.length === 0) {
    room.phase = "refillSummary";
    room.drawChoice = null;
    return;
  }

  if (room.hands[0].length < 9 && room.hands[1].length < 9) {
    room.currentPlayer = room.currentPlayer === 0 ? 1 : 0;
    startDrawTurn(room);
    return;
  }

  room.currentPlayer = room.hands[0].length < 9 ? 0 : 1;
  startDrawTurn(room);
}

function applyAction(room, playerIndex, action, payload = {}) {
  if (room.players.length < 2) {
    return { ok: false, error: "Waiting for a second player." };
  }

  if (action === "choose_bid" && room.phase === "bid" && room.currentPlayer === playerIndex) {
    if (payload.bid === "pass") {
      room.passedBid[playerIndex] = true;
    } else {
      const bid = Number(payload.bid);
      const high = Math.max(...room.bids.filter((v) => v !== null), 4);
      if (!BID_VALUES.includes(bid) || bid <= high) {
        return { ok: false, error: "That bid is not allowed." };
      }
      room.bids[playerIndex] = bid;
      room.passedBid[playerIndex] = false;
    }
    if (playerIndex === 0) {
      room.currentPlayer = 1;
    } else if (room.passedBid[0] && room.passedBid[1]) {
      room.phase = "bidReveal";
    } else if (room.passedBid[0]) {
      room.bidWinner = 1;
      room.contractor = 1;
      room.contractTarget = room.bids[1];
      room.phase = "bidReveal";
    } else if (room.passedBid[1]) {
      room.bidWinner = 0;
      room.contractor = 0;
      room.contractTarget = room.bids[0];
      room.phase = "bidReveal";
    } else {
      room.bidWinner = room.bids[0] > room.bids[1] ? 0 : 1;
      room.contractor = room.bidWinner;
      room.contractTarget = room.bids[room.bidWinner];
      room.phase = "bidReveal";
    }
    room.updatedAt = Date.now();
    return { ok: true };
  }

  if (action === "continue" && ["bidReveal", "refillSummary", "reveal", "handSummary"].includes(room.phase)) {
    if (room.phase === "bidReveal") {
      if (room.passedBid[0] && room.passedBid[1]) {
        room.bidWinner = Math.random() < 0.5 ? 0 : 1;
        room.contractor = room.bidWinner;
        room.contractTarget = 5;
        room.bids[room.bidWinner] = 5;
      }
      room.phase = "chooseTrump";
    } else if (room.phase === "refillSummary") {
      room.phase = "play";
      room.currentPlayer = 0;
    } else if (room.phase === "reveal") {
      if (room.roundsPlayed >= 9) {
        finishHand(room);
      } else {
        room.selectedCards = [null, null];
        room.phase = "play";
        room.currentPlayer = 0;
      }
    } else if (room.phase === "handSummary") {
      startHand(room);
    }
    room.updatedAt = Date.now();
    return { ok: true };
  }

  if (action === "choose_trump" && room.phase === "chooseTrump" && room.bidWinner === playerIndex) {
    if (!TRUMP_SUITS.includes(payload.suit)) {
      return { ok: false, error: "Invalid trump suit." };
    }
    room.trumpSuit = payload.suit;
    room.phase = "discard";
    room.currentPlayer = 0;
    room.updatedAt = Date.now();
    return { ok: true };
  }

  if (action === "choose_hand_card" && ["discard", "play"].includes(room.phase) && room.currentPlayer === playerIndex) {
    const hand = room.hands[playerIndex];
    const index = hand.findIndex((card) => card.id === payload.cardId);
    if (index === -1) {
      return { ok: false, error: "Card not found in your hand." };
    }
    const [card] = hand.splice(index, 1);

    if (room.phase === "discard") {
      room.discardPile.push(card);
      room.discardCounts[playerIndex] += 1;
      if (playerIndex === 0 && room.discardCounts[0] === 3) {
        room.currentPlayer = 1;
      }
      if (playerIndex === 1 && room.discardCounts[1] === 3) {
        room.drawQueue = [room.bidWinner, room.bidWinner === 0 ? 1 : 0];
        room.currentPlayer = room.drawQueue[0];
        startDrawTurn(room);
      }
      room.updatedAt = Date.now();
      return { ok: true };
    }

    room.selectedCards[playerIndex] = card;
    if (playerIndex === 0) {
      room.currentPlayer = 1;
    } else {
      const result = compareCards(room, room.selectedCards[0], room.selectedCards[1]);
      room.lastTrickWinner = result === 0 ? null : result > 0 ? 0 : 1;
      if (result > 0) room.scores[0] += 1;
      if (result < 0) room.scores[1] += 1;
      room.roundsPlayed += 1;
      room.phase = "reveal";
    }
    room.updatedAt = Date.now();
    return { ok: true };
  }

  if (["draw_keep_first", "draw_reject_first"].includes(action) && ["draw", "refill"].includes(room.phase) && room.currentPlayer === playerIndex) {
    if (action === "draw_keep_first") {
      room.hands[playerIndex].push(room.drawChoice.firstCard);
      if (room.drawChoice.secondCard) room.discardPile.push(room.drawChoice.secondCard);
    } else {
      room.discardPile.push(room.drawChoice.firstCard);
      if (room.drawChoice.secondCard) room.hands[playerIndex].push(room.drawChoice.secondCard);
    }
    if (room.phase === "draw" && playerIndex === room.drawQueue[0]) {
      room.currentPlayer = room.drawQueue[1];
      startDrawTurn(room);
    } else if (room.phase === "draw") {
      room.drawChoice = null;
      startManualRefill(room);
    } else {
      room.drawChoice = null;
      advanceManualRefill(room);
    }
    room.updatedAt = Date.now();
    return { ok: true };
  }

  return { ok: false, error: "That action is not available right now." };
}

module.exports = {
  BID_VALUES,
  createRoom,
  attachPlayer,
  startHand,
  buildRoomView,
  findPlayerIndex,
  applyAction,
  randomCode,
};
