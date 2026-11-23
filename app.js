import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js";

const $ = (selector) => document.querySelector(selector);
const boardElement = $("#chessboard");
const promotionModal = $("#promotion-modal");
const promotionOptions = $("#promotion-options");
const toastElement = $("#toast");

const PIECES = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚"
};
const PIECE_VALUES = { p: 100, n: 320, b: 335, r: 500, q: 950, k: 20000 };
const INITIAL_COUNTS = {
  w: { p: 8, n: 2, b: 2, r: 2, q: 1 },
  b: { p: 8, n: 2, b: 2, r: 2, q: 1 }
};
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

function renderBoard() {
  const fragment = document.createDocumentFragment();
  const ranks = flipped ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const files = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const history = game.history({ verbose: true });
  const lastMove = history[history.length - 1];
  const checkedKing = game.isCheck() ? getKingSquare(game.turn()) : null;
  const legalTargets = new Map();

  for (const move of selectedMoves) {
    legalTargets.set(move.to, move);
  }

  for (let row = 0; row < 8; row += 1) {
    const rank = ranks[row];
    for (let col = 0; col < 8; col += 1) {
      const file = files[col];
      const square = squareName(file, rank);
      const piece = game.get(square);
      const cell = document.createElement("button");
      const isLight = (file + rank) % 2 === 1;
      cell.type = "button";
      cell.className = "square " + (isLight ? "light" : "dark");
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
  const leftLabels = flipped ? ["1", "2", "3", "4", "5", "6", "7", "8"] : ["8", "7", "6", "5", "4", "3", "2", "1"];
  const bottomLabels = flipped ? ["h", "g", "f", "e", "d", "c", "b", "a"] : ["a", "b", "c", "d", "e", "f", "g", "h"];
  $(".board-coordinates-left").innerHTML = leftLabels.map((label) => "<span>" + label + "</span>").join("");
  $(".board-coordinates-bottom").innerHTML = bottomLabels.map((label) => "<span>" + label + "</span>").join("");
  boardElement.setAttribute("aria-label", flipped ? "Chess board, black side nearest" : "Chess board, white side nearest");
}

function capturedPieces(capturedBy) {
  const board = game.board();
  const remaining = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 }
  };
  for (const row of board) {
    for (const piece of row) {
      if (piece && piece.type !== "k") remaining[piece.color][piece.type] += 1;
    }
  }
  const capturedColor = opposite(capturedBy);
  const order = ["q", "r", "b", "n", "p"];
  let output = "";
  for (const type of order) {
    const count = Math.max(0, INITIAL_COUNTS[capturedColor][type] - remaining[capturedColor][type]);
    output += PIECES[capturedColor + type].repeat(count);
  }
  return output || "—";
}

function renderMoves() {
  const history = game.history({ verbose: true });
  $("#move-total").textContent = history.length + (history.length === 1 ? " ply" : " plies");
  $("#move-count").textContent = "MOVE " + (Math.floor(history.length / 2) + 1);
  if (!history.length) {
    $("#moves-list").innerHTML = '<div class="empty-moves"><span>♞</span><p>Your opening move starts here.</p></div>';
    $("#undo-move").disabled = true;
    return;
  }

  const rows = [];
  for (let index = 0; index < history.length; index += 2) {
    const whiteMove = history[index];
    const blackMove = history[index + 1];
    const whiteLatest = index === history.length - 1;
    const blackLatest = index + 1 === history.length - 1;
    rows.push(
      '<div class="move-pair">' +
        '<span class="move-number">' + (Math.floor(index / 2) + 1) + '.</span>' +
        '<span class="move-san' + (whiteLatest ? ' latest' : '') + '">' + whiteMove.san + '</span>' +
        '<span class="move-san' + (blackLatest ? ' latest' : '') + '">' + (blackMove ? blackMove.san : "") + '</span>' +
      '</div>'
    );
  }
  $("#moves-list").innerHTML = rows.join("");
  $("#moves-list").scrollTop = $("#moves-list").scrollHeight;
  $("#undo-move").disabled = thinking || history.length === 0;
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
    ? (color === "w" ? "White pieces" : "Black pieces")
    : (color === humanColor ? "Playing as " + (color === "w" ? "White" : "Black") : difficultyLabel() + " opponent");

  $("#top-player-name").textContent = topName;
  $("#top-player-detail").textContent = detail(topColor);
  $("#top-avatar").textContent = PIECES[topColor + "k"];
  $("#top-avatar").className = "avatar " + (topColor === "w" ? "avatar-light" : "avatar-dark");
  $("#bottom-player-name").textContent = bottomName;
  $("#bottom-player-detail").textContent = detail(bottomColor);
  $("#bottom-avatar").textContent = PIECES[bottomColor + "k"];
  $("#bottom-avatar").className = "avatar " + (bottomColor === "w" ? "avatar-light" : "avatar-dark");

  $("#white-player-name").textContent = playerName("w");
  $("#black-player-name").textContent = playerName("b");
  $("#white-player-sub").textContent = mode === "local" ? "White pieces · Player 1" : (humanColor === "w" ? "Your pieces" : difficultyLabel() + " AI");
  $("#black-player-sub").textContent = mode === "local" ? "Black pieces · Player 2" : (humanColor === "b" ? "Your pieces" : difficultyLabel() + " AI");
  $("#white-player-row").classList.toggle("active", game.turn() === "w" && !game.isGameOver());
  $("#black-player-row").classList.toggle("active", game.turn() === "b" && !game.isGameOver());
  $("#white-turn-dot").style.opacity = game.turn() === "w" && !game.isGameOver() ? "1" : "0";
  $("#black-turn-dot").style.opacity = game.turn() === "b" && !game.isGameOver() ? "1" : "0";
  $("#white-captured").textContent = capturedPieces("w");
  $("#black-captured").textContent = capturedPieces("b");
}

function difficultyLabel() {
  return ({ easy: "Casual", club: "Club", expert: "Expert" })[difficulty];
}

function statusLabel() {
  if (thinking) return "AI is thinking…";
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
}

function updateUI() {
  renderBoard();
  renderMoves();
  updatePlayers();
  updateStatus();
  $("#ai-settings").hidden = mode !== "ai";
  $("#local-note").hidden = mode !== "local";
  document.querySelectorAll(".mode-option").forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
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
    gain.gain.exponentialRampToValueAtTime(.075, context.currentTime + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .15);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + .16);
    oscillator.onended = () => context.close();
  } catch (error) {
    // Sound is an enhancement; a browser without Web Audio can still play normally.
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
}

function handleSquareClick(event) {
  const squareButton = event.target.closest(".square");
  if (!squareButton || thinking || game.isGameOver()) return;
  if (mode === "ai" && game.turn() !== humanColor) return;

  const square = squareButton.dataset.square;
  if (selectedSquare) {
    const destinationMoves = selectedMoves.filter((move) => move.to === square);
    if (destinationMoves.length) {
      const promotionMoves = destinationMoves.filter((move) => move.promotion);
      if (promotionMoves.length) {
        openPromotion(square, promotionMoves);
      } else {
        playMove(selectedSquare, square);
      }
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
      const moveExists = moves.some((move) => move.promotion === type);
      if (moveExists && pendingPromotion) playMove(pendingPromotion.from, pendingPromotion.to, type);
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
    const move = game.move({ from, to, promotion });
    clearSelection();
    closePromotion();
    playSound(move.captured ? "capture" : (game.isCheck() ? "check" : "move"));
    updateUI();
    if (game.isGameOver()) {
      playSound("end");
    } else if (mode === "ai" && game.turn() !== humanColor) {
      scheduleComputerMove();
    }
    return true;
  } catch (error) {
    showToast("That move isn't legal. Try another square.");
    clearSelection();
    updateUI();
    return false;
  }
}

function scheduleComputerMove() {
  if (mode !== "ai" || game.isGameOver() || game.turn() === humanColor || thinking) return;
  thinking = true;
  updateUI();
  window.setTimeout(() => {
    if (mode !== "ai" || game.isGameOver() || game.turn() === humanColor) {
      thinking = false;
      updateUI();
      return;
    }
    const bestMove = chooseComputerMove(game, difficulty);
    thinking = false;
    if (bestMove) {
      try {
        const move = game.move({
          from: bestMove.from,
          to: bestMove.to,
          promotion: bestMove.promotion || "q"
        });
        playSound(move.captured ? "capture" : (game.isCheck() ? "check" : "move"));
      } catch (error) {
        showToast("The AI couldn't complete its move. Start a new game to continue.");
      }
    }
    updateUI();
    if (game.isGameOver()) playSound("end");
  }, 180);
}

function evaluatePosition(position) {
  let whiteScore = 0;
  const rows = position.board();
  for (let row = 0; row < 8; row += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = rows[row][file];
      if (!piece) continue;
      const rank = 7 - row;
      const centre = 3.5 - (Math.abs(file - 3.5) + Math.abs(rank - 3.5)) / 2;
      let positional = 0;
      switch (piece.type) {
        case "p":
          positional = (piece.color === "w" ? rank : 7 - rank) * 7 + centre * 1.5;
          break;
        case "n":
          positional = centre * 10;
          break;
        case "b":
          positional = centre * 5;
          break;
        case "r":
          positional = (piece.color === "w" ? rank : 7 - rank) * 1.5;
          break;
        case "q":
          positional = centre * 2;
          break;
        case "k":
          positional = -centre * 3;
          break;
      }
      const value = PIECE_VALUES[piece.type] + positional;
      whiteScore += piece.color === "w" ? value : -value;
    }
  }
  return position.turn() === "w" ? whiteScore : -whiteScore;
}

function orderMoves(moves) {
  return moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
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

function quiescence(position, alpha, beta, ply, remaining) {
  if (position.isCheckmate()) return -MATE_SCORE + ply;
  if (position.isDraw()) return 0;
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
  if (position.isCheckmate()) return -MATE_SCORE + ply;
  if (position.isDraw()) return 0;
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

function startNewGame(showMessage = true) {
  game = new Chess();
  clearSelection();
  closePromotion();
  thinking = false;
  flipped = mode === "ai" && humanColor === "b";
  updateUI();
  if (showMessage) showToast("A fresh game. Make your move.");
  if (mode === "ai" && humanColor === "b") scheduleComputerMove();
}

function changeMode(nextMode) {
  if (mode === nextMode) return;
  mode = nextMode;
  thinking = false;
  startNewGame(false);
  showToast(mode === "ai" ? "Playing against Harryx AI." : "Local two-player mode is ready.");
}

function undoMove() {
  if (thinking) return;
  const historyLength = game.history().length;
  if (!historyLength) return;
  game.undo();
  if (mode === "ai" && historyLength >= 2) game.undo();
  clearSelection();
  closePromotion();
  updateUI();
  showToast("Last turn undone.");
}

function flipBoard() {
  flipped = !flipped;
  renderBoard();
}

$("#chessboard").addEventListener("click", handleSquareClick);
document.querySelectorAll(".mode-option").forEach((button) => {
  button.addEventListener("click", () => changeMode(button.dataset.mode));
});
$("#difficulty").addEventListener("change", (event) => {
  difficulty = event.target.value;
  updatePlayers();
  showToast("Difficulty set to " + difficultyLabel() + ".");
});
$("#human-color").addEventListener("change", (event) => {
  humanColor = event.target.value;
  startNewGame(false);
  showToast("You're playing as " + (humanColor === "w" ? "White" : "Black") + ".");
});
$("#new-game").addEventListener("click", () => startNewGame());
$("#result-new-game").addEventListener("click", () => startNewGame());
$("#undo-move").addEventListener("click", undoMove);
$("#flip-board").addEventListener("click", flipBoard);
$("#sound-toggle").addEventListener("click", (event) => {
  soundEnabled = !soundEnabled;
  event.currentTarget.setAttribute("aria-pressed", String(soundEnabled));
  event.currentTarget.title = soundEnabled ? "Toggle sound off" : "Toggle sound on";
  showToast(soundEnabled ? "Move sounds enabled." : "Move sounds muted.");
});
promotionModal.addEventListener("click", (event) => {
  if (event.target === promotionModal) {
    closePromotion();
    clearSelection();
    renderBoard();
  }
});

updateUI();
