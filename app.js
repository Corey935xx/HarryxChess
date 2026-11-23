import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js";

const $ = (selector) => document.querySelector(selector);
const boardElement = $("#chessboard");
const promotionModal = $("#promotion-modal");
const promotionOptions = $("#promotion-options");
const howToModal = $("#how-to-modal");
const toastElement = $("#toast");

// Use the solid chess-piece glyph set for both sides, then colour it by side.
const PIECES = {
  wp: "♟", wn: "♞", wb: "♝", wr: "♜", wq: "♛", wk: "♚",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚"
};
const PIECE_VALUES = { p: 100, n: 320, b: 335, r: 500, q: 950, k: 20000 };
const PROMOTION_TYPES = ["q", "r", "b", "n"];
const MATE_SCORE = 100000;

let game = new Chess();
let mode = "ai";
let humanColor = "w";
let difficulty = "club";
let flipped = false;
let selectedSquare = null;
let selectedMoves = [];
let thinking = false;
let soundEnabled = true;
let pendingPromotion = null;
let inGame = false;
let toastTimer = null;

function opposite(color) {
  return color === "w" ? "b" : "w";
}

function squareName(file, rank) {
  return "abcdefgh"[file] + (rank + 1);
}

function getKingSquare(color) {
  const rows = game.board();
  for (let row = 0; row < 8; row += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = rows[row][file];
      if (piece && piece.type === "k" && piece.color === color) {
        return squareName(file, 7 - row);
      }
    }
  }
  return null;
}

function animateRenderedMove(animationData) {
  if (!animationData) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const animatePiece = (square, fromRect, toRect) => {
    if (!fromRect || !toRect) return;
    const cell = boardElement.querySelector('[data-square="' + square + '"]');
    const piece = cell?.querySelector(".chess-piece");
    if (!piece || typeof piece.animate !== "function") return;
    const dx = fromRect.left - toRect.left;
    const dy = fromRect.top - toRect.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    cell.style.zIndex = "8";
    piece.style.willChange = "transform";
    const animation = piece.animate(
      [
        { transform: "translate(" + dx + "px, " + dy + "px) translateY(-2%)" },
        { transform: "translateY(-2%)" }
      ],
      { duration: 210, easing: "cubic-bezier(.2,.75,.25,1)", fill: "both" }
    );
    animation.onfinish = () => {
      animation.cancel();
      piece.style.willChange = "";
      cell.style.zIndex = "";
    };
  };

  animatePiece(animationData.to, animationData.fromRect, animationData.toRect);
  if (animationData.rookTo) {
    animatePiece(animationData.rookTo, animationData.rookFromRect, animationData.rookToRect);
  }
}

function moveAnimationData(move) {
  if (!move || !boardElement.isConnected) return null;
  const rectFor = (square) => {
    const cell = boardElement.querySelector('[data-square="' + square + '"]');
    return cell ? cell.getBoundingClientRect() : null;
  };
  const data = {
    to: move.to,
    fromRect: rectFor(move.from),
    toRect: rectFor(move.to)
  };
  if (move.flags && (move.flags.includes("k") || move.flags.includes("q"))) {
    const rank = move.color === "w" ? "1" : "8";
    const kingSide = move.flags.includes("k");
    data.rookTo = (kingSide ? "f" : "d") + rank;
    data.rookFromRect = rectFor((kingSide ? "h" : "a") + rank);
    data.rookToRect = rectFor(data.rookTo);
  }
  return data;
}

function renderBoard(animationData = null) {
  const fragment = document.createDocumentFragment();
  const ranks = flipped ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const files = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const lastMove = game.history({ verbose: true }).at(-1);
  const checkedKing = game.isCheck() ? getKingSquare(game.turn()) : null;
  const legalTargets = new Map();

  for (const move of selectedMoves) legalTargets.set(move.to, move);

  for (let row = 0; row < 8; row += 1) {
    const rank = ranks[row];
    for (let col = 0; col < 8; col += 1) {
      const file = files[col];
      const square = squareName(file, rank);
      const piece = game.get(square);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "square " + ((file + rank) % 2 === 1 ? "light" : "dark");
      cell.dataset.square = square;
      cell.setAttribute("aria-label", square + (piece ? ", " + (piece.color === "w" ? "white " : "black ") + piece.type : ""));

      if (lastMove && (lastMove.from === square || lastMove.to === square)) cell.classList.add("last-move");
      if (selectedSquare === square) cell.classList.add("selected");
      if (checkedKing === square) cell.classList.add("in-check");

      const possibleMove = legalTargets.get(square);
      if (possibleMove) cell.classList.add(possibleMove.captured ? "legal-capture" : "legal-empty");

      if (piece) {
        const glyph = document.createElement("span");
        glyph.className = "chess-piece " + (piece.color === "w" ? "piece-white" : "piece-black");
        glyph.textContent = PIECES[piece.color + piece.type];
        cell.append(glyph);
      }
      fragment.append(cell);
    }
  }

  boardElement.replaceChildren(fragment);
  animateRenderedMove(animationData);
  const leftLabels = flipped ? ["1", "2", "3", "4", "5", "6", "7", "8"] : ["8", "7", "6", "5", "4", "3", "2", "1"];
  const bottomLabels = flipped ? ["h", "g", "f", "e", "d", "c", "b", "a"] : ["a", "b", "c", "d", "e", "f", "g", "h"];
  $(".board-coordinates-left").innerHTML = leftLabels.map((label) => "<span>" + label + "</span>").join("");
  $(".board-coordinates-bottom").innerHTML = bottomLabels.map((label) => "<span>" + label + "</span>").join("");
  boardElement.setAttribute("aria-label", flipped ? "Chess board, black side nearest" : "Chess board, white side nearest");
}

function difficultyLabel() {
  return ({ easy: "Casual", club: "Club player", expert: "Expert" })[difficulty];
}

function playerName(color) {
  if (mode === "local") return color === "w" ? "Player 1" : "Player 2";
  return color === humanColor ? "You" : "Harryx AI";
}

function updatePlayers() {
  const bottomColor = mode === "ai" ? humanColor : "w";
  const topColor = opposite(bottomColor);
  const bottomName = playerName(bottomColor);
  const topName = playerName(topColor);
  const detail = (color) => mode === "local"
    ? (color === "w" ? "White pieces · Player 1" : "Black pieces · Player 2")
    : (color === humanColor ? "Your pieces" : difficultyLabel() + " opponent");

  $("#top-player-name").textContent = topName;
  $("#top-player-detail").textContent = detail(topColor);
  $("#top-player-piece").textContent = PIECES[topColor + "k"];
  $("#top-player-piece").className = "player-piece " + (topColor === "w" ? "white-piece" : "black-piece");
  $("#top-side-label").textContent = topColor === "w" ? "WHITE" : "BLACK";

  $("#bottom-player-name").textContent = bottomName;
  $("#bottom-player-detail").textContent = detail(bottomColor);
  $("#bottom-player-piece").textContent = PIECES[bottomColor + "k"];
  $("#bottom-player-piece").className = "player-piece " + (bottomColor === "w" ? "white-piece" : "black-piece");
  $("#bottom-side-label").textContent = bottomColor === "w" ? "WHITE" : "BLACK";

  $("#game-mode-label").textContent = mode === "local"
    ? "TWO PLAYERS · LOCAL MATCH"
    : "SINGLE PLAYER · " + difficultyLabel().toUpperCase();
  $("#match-title").textContent = mode === "local" ? "Local match" : "Your match";
}

function statusLabel() {
  if (thinking) return "Harryx AI is thinking…";
  if (game.isCheckmate()) return "Checkmate";
  if (game.isStalemate()) return "Stalemate";
  if (game.isThreefoldRepetition()) return "Draw by repetition";
  if (game.isInsufficientMaterial()) return "Draw · insufficient material";
  if (game.isDraw()) return "Game drawn";
  const side = game.turn() === "w" ? "White" : "Black";
  return side + " to move" + (game.isCheck() ? " · Check" : "");
}

function updateStatus() {
  const pill = $("#turn-status");
  pill.classList.toggle("thinking", thinking);
  pill.classList.toggle("finished", game.isGameOver());
  pill.querySelector("span").textContent = statusLabel();

  const hint = $("#board-hint");
  if (game.isGameOver()) hint.textContent = "Match complete.";
  else if (thinking) hint.textContent = "Harryx AI is considering its move…";
  else if (selectedSquare) hint.textContent = "Choose a highlighted square for your move.";
  else if (mode === "ai" && game.turn() !== humanColor) hint.textContent = "Waiting for Harryx AI…";
  else hint.textContent = "Select a piece to see its legal moves.";
}

function updateUI(animationData = null) {
  if (!inGame) return;
  renderBoard(animationData);
  updatePlayers();
  updateStatus();
  $("#result-banner").hidden = !game.isGameOver();
  if (game.isGameOver()) showResult();
}

function showResult() {
  let title = "Game drawn";
  let description = "A well-played match.";
  let icon = "½";
  if (game.isCheckmate()) {
    const winner = opposite(game.turn());
    title = mode === "ai" ? (winner === humanColor ? "You win!" : "Harryx AI wins") : (winner === "w" ? "White wins!" : "Black wins!");
    description = "Checkmate. The king has no legal escape.";
    icon = "♛";
  } else if (game.isStalemate()) {
    title = "Stalemate";
    description = "No legal moves remain, but the king is not in check.";
  } else if (game.isThreefoldRepetition()) {
    title = "Draw by repetition";
    description = "The same position has occurred three times.";
  } else if (game.isInsufficientMaterial()) {
    title = "Insufficient material";
    description = "Neither side has enough material to force checkmate.";
  } else if (game.isDraw()) {
    title = "Game drawn";
    description = "The match ended in a draw.";
  }
  $("#result-title").textContent = title;
  $("#result-description").textContent = description;
  $("#result-icon").textContent = icon;
}

function showToast(message) {
  toastElement.textContent = message;
  toastElement.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastElement.classList.remove("visible"), 2300);
}

function playSound(kind = "move") {
  if (!soundEnabled) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const frequencies = { move: 390, capture: 245, check: 520, end: 330 };
    oscillator.type = "sine";
    oscillator.frequency.value = frequencies[kind] || frequencies.move;
    gain.gain.setValueAtTime(.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.07, context.currentTime + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .15);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + .16);
    oscillator.onended = () => context.close();
  } catch (error) {
    // Browsers without Web Audio can still play the game normally.
  }
}

function clearSelection() {
  selectedSquare = null;
  selectedMoves = [];
}

function selectSquare(square) {
  selectedSquare = square;
  selectedMoves = game.moves({ square, verbose: true });
  renderBoard();
  updateStatus();
}

function handleSquareClick(event) {
  const squareButton = event.target.closest(".square");
  if (!squareButton || !inGame || thinking || game.isGameOver() || pendingPromotion) return;
  if (mode === "ai" && game.turn() !== humanColor) return;

  const square = squareButton.dataset.square;
  if (selectedSquare) {
    const destinationMoves = selectedMoves.filter((move) => move.to === square);
    if (destinationMoves.length) {
      const promotionMoves = destinationMoves.filter((move) => move.promotion);
      if (promotionMoves.length) openPromotion(square, promotionMoves);
      else playMove(selectedSquare, square);
      return;
    }
  }

  const piece = game.get(square);
  if (piece && piece.color === game.turn()) {
    const moves = game.moves({ square, verbose: true });
    if (moves.length) {
      selectSquare(square);
      return;
    }
  }
  clearSelection();
  renderBoard();
  updateStatus();
}

function openPromotion(to, moves) {
  pendingPromotion = { from: selectedSquare, to };
  promotionOptions.replaceChildren();
  const color = game.turn();
  for (const type of PROMOTION_TYPES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "promotion-choice";
    button.setAttribute("aria-label", "Promote to " + ({ q: "queen", r: "rook", b: "bishop", n: "knight" })[type]);
    button.textContent = PIECES[color + type];
    button.addEventListener("click", () => {
      if (moves.some((move) => move.promotion === type) && pendingPromotion) {
        playMove(pendingPromotion.from, pendingPromotion.to, type);
      }
    });
    promotionOptions.append(button);
  }
  promotionModal.hidden = false;
}

function closePromotion() {
  promotionModal.hidden = true;
  pendingPromotion = null;
}

function playMove(from, to, promotion = "q") {
  try {
    const plannedMove = game.moves({ verbose: true }).find((candidate) =>
      candidate.from === from && candidate.to === to &&
      (!candidate.promotion || candidate.promotion === promotion)
    );
    const animationData = moveAnimationData(plannedMove);
    const move = game.move({ from, to, promotion });
    clearSelection();
    closePromotion();
    playSound(move.captured ? "capture" : (game.isCheck() ? "check" : "move"));
    updateUI(animationData);
    if (game.isGameOver()) playSound("end");
    else if (mode === "ai" && game.turn() !== humanColor) scheduleComputerMove();
    return true;
  } catch (error) {
    showToast("That move isn't legal. Try another square.");
    clearSelection();
    updateUI();
    return false;
  }
}

function scheduleComputerMove() {
  if (!inGame || mode !== "ai" || game.isGameOver() || game.turn() === humanColor || thinking) return;
  thinking = true;
  updateUI();
  window.setTimeout(() => {
    if (!inGame || mode !== "ai" || game.isGameOver() || game.turn() === humanColor) {
      thinking = false;
      return;
    }
    const bestMove = chooseComputerMove(game, difficulty);
    thinking = false;
    let animationData = null;
    if (bestMove) {
      try {
        animationData = moveAnimationData(bestMove);
        const move = game.move({
          from: bestMove.from,
          to: bestMove.to,
          promotion: bestMove.promotion || "q"
        });
        playSound(move.captured ? "capture" : (game.isCheck() ? "check" : "move"));
      } catch (error) {
        animationData = null;
        showToast("The AI couldn't complete its move. Please start a new game.");
      }
    }
    updateUI(animationData);
    if (game.isGameOver()) playSound("end");
  }, 180);
}

function evaluatePosition(position) {
  let score = 0;
  const rows = position.board();
  for (let row = 0; row < 8; row += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = rows[row][file];
      if (!piece) continue;
      const rank = 7 - row;
      const centre = 3.5 - (Math.abs(file - 3.5) + Math.abs(rank - 3.5)) / 2;
      let positional = 0;
      switch (piece.type) {
        case "p": positional = (piece.color === "w" ? rank : 7 - rank) * 7 + centre * 1.5; break;
        case "n": positional = centre * 10; break;
        case "b": positional = centre * 5; break;
        case "r": positional = (piece.color === "w" ? rank : 7 - rank) * 1.5; break;
        case "q": positional = centre * 2; break;
        case "k": positional = -centre * 3; break;
      }
      const value = PIECE_VALUES[piece.type] + positional;
      score += piece.color === "w" ? value : -value;
    }
  }
  return position.turn() === "w" ? score : -score;
}

function moveOrderScore(move) {
  let score = 0;
  if (move.captured) score += 10 * PIECE_VALUES[move.captured] - PIECE_VALUES[move.piece] / 10;
  if (move.promotion) score += PIECE_VALUES[move.promotion] + 800;
  if (move.san && move.san.includes("#")) score += 100000;
  else if (move.san && move.san.includes("+")) score += 45;
  if (move.flags && (move.flags.includes("k") || move.flags.includes("q"))) score += 20;
  return score;
}

function orderMoves(moves) {
  return moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
}

function quiescence(position, alpha, beta, ply, remaining) {
  if (position.isGameOver()) return position.isCheckmate() ? -MATE_SCORE + ply : 0;
  const inCheck = position.isCheck();
  const standPat = evaluatePosition(position);
  if (!inCheck) {
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
  }
  if (remaining <= 0) return inCheck ? standPat - 35 : standPat;

  let moves = position.moves({ verbose: true });
  if (!inCheck) moves = moves.filter((move) => move.captured || move.promotion);
  orderMoves(moves);
  for (const move of moves) {
    position.move({ from: move.from, to: move.to, promotion: move.promotion });
    const score = -quiescence(position, -beta, -alpha, ply + 1, remaining - 1);
    position.undo();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(position, depth, alpha, beta, ply) {
  if (position.isGameOver()) return position.isCheckmate() ? -MATE_SCORE + ply : 0;
  if (depth <= 0) return quiescence(position, alpha, beta, ply, 2);

  const moves = orderMoves(position.moves({ verbose: true }));
  let bestScore = -Infinity;
  for (const move of moves) {
    position.move({ from: move.from, to: move.to, promotion: move.promotion });
    const score = -negamax(position, depth - 1, -beta, -alpha, ply + 1);
    position.undo();
    if (score > bestScore) bestScore = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return bestScore;
}

function chooseComputerMove(currentGame, level) {
  const maxDepth = ({ easy: 1, club: 2, expert: 3 })[level] || 2;
  const position = new Chess(currentGame.fen());
  const rootMoves = orderMoves(position.moves({ verbose: true }));
  if (!rootMoves.length) return null;

  let chosenMove = rootMoves[0];
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    let alpha = -Infinity;
    let bestScore = -Infinity;
    let bestMoves = [];
    for (const move of rootMoves) {
      position.move({ from: move.from, to: move.to, promotion: move.promotion });
      const score = -negamax(position, depth - 1, -Infinity, -alpha, 1);
      position.undo();
      if (score > bestScore) {
        bestScore = score;
        bestMoves = [move];
      } else if (score === bestScore) {
        bestMoves.push(move);
      }
      if (score > alpha) alpha = score;
    }
    if (bestMoves.length) chosenMove = bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }
  return chosenMove;
}

function refreshModeSetup() {
  document.querySelectorAll(".mode-choice").forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#ai-settings").hidden = mode !== "ai";
  $("#local-note").hidden = mode !== "local";
}

function startGame() {
  difficulty = $("#difficulty").value;
  humanColor = $("#human-color").value;
  game = new Chess();
  clearSelection();
  closePromotion();
  thinking = false;
  inGame = true;
  flipped = mode === "ai" && humanColor === "b";
  $("#home-screen").hidden = true;
  $("#game-screen").hidden = false;
  $("#home-header-actions").hidden = true;
  updateUI();
  if (mode === "ai" && humanColor === "b") scheduleComputerMove();
}

function returnToMenu() {
  inGame = false;
  thinking = false;
  clearSelection();
  closePromotion();
  $("#game-screen").hidden = true;
  $("#home-screen").hidden = false;
  $("#home-header-actions").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function startNewGame() {
  game = new Chess();
  clearSelection();
  closePromotion();
  thinking = false;
  flipped = mode === "ai" && humanColor === "b";
  updateUI();
  if (mode === "ai" && humanColor === "b") scheduleComputerMove();
}

function flipBoard() {
  flipped = !flipped;
  renderBoard();
}

function openHowToPlay() {
  howToModal.hidden = false;
  $("#close-how-to").focus();
}

function closeHowToPlay() {
  howToModal.hidden = true;
}

boardElement.addEventListener("click", handleSquareClick);

document.querySelectorAll(".mode-choice").forEach((button) => {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
    refreshModeSetup();
  });
});

$("#play-game").addEventListener("click", startGame);
$("#back-home").addEventListener("click", returnToMenu);
$("#restart-game").addEventListener("click", startNewGame);
$("#flip-board").addEventListener("click", flipBoard);
$("#result-new-game").addEventListener("click", startNewGame);

$("#header-how-to-play").addEventListener("click", openHowToPlay);
$("#how-to-play").addEventListener("click", openHowToPlay);
$("#close-how-to").addEventListener("click", closeHowToPlay);
$("#done-how-to").addEventListener("click", closeHowToPlay);
howToModal.addEventListener("click", (event) => {
  if (event.target === howToModal) closeHowToPlay();
});

promotionModal.addEventListener("click", (event) => {
  if (event.target === promotionModal) {
    closePromotion();
    clearSelection();
    updateUI();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!howToModal.hidden) closeHowToPlay();
    if (!promotionModal.hidden) {
      closePromotion();
      clearSelection();
      updateUI();
    }
  }
});

refreshModeSetup();
