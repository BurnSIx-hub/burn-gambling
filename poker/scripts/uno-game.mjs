// ============================================================
// Card Games VTT — scripts/uno-game.mjs
// UNO · 108 карт · 2–6 игроков
// v5: Stacking (+2/+4) включён всегда + 14 опциональных хоумрулов.
// Набор правил фиксируется при старте партии (S.rules) — смена
// настроек не влияет на идущую игру.
// ============================================================

const MODULE_ID = "poker-table-vtt";
const COLORS = ["red", "yellow", "green", "blue"];
const HAND_LIMIT = 15;
const DIGITS = ["0","1","2","3","4","5","6","7","8","9"];

// ── House rules ───────────────────────────────────────────────
// Stacking is NOT here — it is a core rule, always on.
export const UNO_RULE_IDS = [
  "jumpIn",        // вклиниться вне очереди точной копией карты
  "sevenZero",     // 7 — обмен рукой, 0 — все передают руки по кругу
  "twoCards",      // две одинаковые цифры за один ход (Shift+клик)
  "forcePlay",     // есть чем ходить — нельзя брать
  "drawOne",       // взятая карта, если играбельна, играется сразу
  "silentUno",     // не нужно кричать UNO, ловли нет
  "killStop",      // карта того же значения играется вне очереди
  "suddenDeath",   // без подсчёта очков в конце
  "bluff4",        // челлендж блефа на Wild+4
  "progressive",   // каждый полный круг все берут +1
  "emptyPile",     // сброс не перетасовывается
  "doubleReverse", // для 2 игроков Reverse = Skip
  "handLimit",     // максимум 15 карт в руке
  "quitting",      // добровольный выход со сбросом карт
];

export function getUnoRules() {
  let saved = {};
  try { saved = game.settings.get(MODULE_ID, "unoRules") || {}; } catch (e) {}
  const rules = {};
  for (const id of UNO_RULE_IDS) rules[id] = !!saved[id];
  return rules;
}

// Card schema:
//   { color: "red"|"yellow"|"green"|"blue"|"wild", value: "0".."9"|"skip"|"reverse"|"draw2"|"wild"|"wild4" }

function buildUnoDeck() {
  const d = [];
  for (const c of COLORS) {
    d.push({ color: c, value: "0" });                                       // one 0
    for (const v of ["1","2","3","4","5","6","7","8","9"]) {                // two 1-9
      d.push({ color: c, value: v });
      d.push({ color: c, value: v });
    }
    for (const v of ["skip","reverse","draw2"]) {                           // two of each action
      d.push({ color: c, value: v });
      d.push({ color: c, value: v });
    }
  }
  for (let i = 0; i < 4; i++) d.push({ color: "wild", value: "wild" });
  for (let i = 0; i < 4; i++) d.push({ color: "wild", value: "wild4" });
  // Shuffle
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// Basic playability (no stacking context)
export function canPlayUno(card, topColor, topValue) {
  if (card.color === "wild") return true;             // wilds always playable
  if (card.color === topColor) return true;           // color match
  if (card.value === topValue) return true;           // value match
  return false;
}

// Full playability for the ACTIVE player, including the +2/+4 stack:
// while a draw stack is pending only the same draw card may be played.
export function canPlayUnoFull(card, S) {
  if ((S.pendingDraw || 0) > 0) {
    if (S.pendingType === "draw2") return card.value === "draw2";
    if (S.pendingType === "wild4") return card.value === "wild4" && !S.rules?.bluff4;
    return false;
  }
  const top = S.discard[S.discard.length - 1];
  return canPlayUno(card, S.topColor, top?.value);
}

// Card points for the endgame summary (when Sudden Death is off)
function cardPoints(c) {
  if (DIGITS.includes(c.value)) return parseInt(c.value);
  if (c.value === "wild" || c.value === "wild4") return 50;
  return 20; // skip / reverse / draw2
}

export const unoInitialState = () => ({
  phase: "setup",          // setup | playing | needColor | needSwap | challenge | gameover
  rules: {},               // house rules captured at startGame
  players: [],             // { name, actorId, userId, hand: [], saidUno: false }
  deck: [],
  discard: [],             // top card is discard[discard.length-1]
  topColor: "",            // effective color (set on wild via chosen color)
  direction: 1,            // 1 = clockwise (index+1), -1 = counter-clockwise
  activeIdx: 0,            // whose turn
  pendingDraw: 0,          // accumulated +2/+4 stack waiting to be taken
  pendingType: null,       // "draw2" | "wild4" — what can be stacked on top
  pendingWildBy: -1,       // index of player who just played a wild and must choose color
  challenge: null,         // { by, victim, prevColor } — Wild+4 bluff check (rule bluff4)
  swapBy: -1,              // index of player who played a 7 and picks a swap target (rule sevenZero)
  turnCount: 0,            // for the progressive rule
  log: [],
  winner: null,
  startedAt: 0,
});

export class UnoGame {
  constructor() { this.S = unoInitialState(); window._unoGame = this; }

  push() {
    window._pokerEmit?.("UNO_STATE", { state: this.S });
    window._unoApp?.onStateUpdate(this.S);
  }
  log(msg) { this.S.log.unshift(msg); if (this.S.log.length > 60) this.S.log.pop(); }
  _lz(k, d) { return d ? game.i18n.format(`POKER.UNO.${k}`, d) : game.i18n.localize(`POKER.UNO.${k}`); }

  startGame({ players }) {
    const built = players.map(p => {
      const actor = p.actorId ? game.actors.get(p.actorId) : null;
      return {
        name:    actor?.name ?? game.i18n.localize("POKER.P.Player"),
        actorId: p.actorId,
        userId:  p.userId,
        hand:    [],
        saidUno: false,
      };
    });
    this.S = unoInitialState();
    this.S.rules = getUnoRules();
    this.S.players = built;
    this.S.startedAt = Date.now();
    this.log(game.i18n.localize("POKER.UNO.LogStarted") + built.map(p => p.name).join(", "));
    this._logActiveRules();
    this._deal();
  }

  _logActiveRules() {
    const on = UNO_RULE_IDS.filter(id => this.S.rules[id])
      .map(id => game.i18n.localize(`POKER.UnoRule.${id}`));
    if (on.length) this.log(this._lz("LogRulesOn", { rules: on.join(", ") }));
  }

  _deal() {
    this.S.deck = buildUnoDeck();
    this.S.discard = [];
    this.S.pendingWildBy = -1;
    this.S.pendingDraw = 0;
    this.S.pendingType = null;
    this.S.challenge = null;
    this.S.swapBy = -1;
    this.S.turnCount = 0;
    window._pokerSound?.("new_round.mp3");

    for (const p of this.S.players) {
      p.hand = [];
      p.saidUno = false;
      for (let i = 0; i < 7; i++) {
        const c = this.S.deck.pop();
        if (c) p.hand.push(c);
      }
    }
    window._pokerSound?.("dealing.mp3");

    // Reveal first card. If wild — pick random color. If action — log and let it take effect.
    let starter = this.S.deck.pop();
    // Re-draw if it's a Wild Draw Four (rule variant — simpler to avoid edge case)
    let safety = 0;
    while (starter && starter.value === "wild4" && safety++ < 20) {
      this.S.deck.unshift(starter);
      starter = this.S.deck.pop();
    }
    this.S.discard.push(starter);

    if (starter.color === "wild") {
      this.S.topColor = COLORS[Math.floor(Math.random() * 4)];
      this.log(game.i18n.format("POKER.UNO.LogStartWild",{color:this._colorRu(this.S.topColor)}));
    } else {
      this.S.topColor = starter.color;
    }

    // Random starting player
    this.S.activeIdx = Math.floor(Math.random() * this.S.players.length);
    this.S.direction = 1;
    this.S.phase = "playing";

    // Apply starter's action effect to first player
    if (starter.value === "skip") {
      this.log(game.i18n.format("POKER.UNO.LogFirstSkip",{name:this.S.players[this.S.activeIdx].name}));
      this.S.activeIdx = this._next(this.S.activeIdx);
    } else if (starter.value === "reverse") {
      this.S.direction = -1;
      this.log(game.i18n.localize("POKER.UNO.LogFirstReverse"));
    } else if (starter.value === "draw2") {
      const p = this.S.players[this.S.activeIdx];
      this._drawCards(p, 2);
      this.log(game.i18n.format("POKER.UNO.LogFirstDraw2",{name:p.name}));
      this.S.activeIdx = this._next(this.S.activeIdx);
    }

    this.log(game.i18n.format("POKER.UNO.LogFirstCard",{card:this._cardName(starter),name:this.S.players[this.S.activeIdx].name}));
    this.push();
  }

  _next(from) {
    const n = this.S.players.length;
    return (from + this.S.direction + n) % n;
  }

  _cardName(card) {
    if (!card) return "—";
    const colors = { red:"🔴", yellow:"🟡", green:"🟢", blue:"🔵", wild:"⚫" };
    const values = { skip:"⏭", reverse:"🔄", draw2:"+2", wild:"Wild", wild4:"Wild+4" };
    return `${colors[card.color] ?? ""} ${values[card.value] ?? card.value}`;
  }

  _colorRu(c) {
    const lz = k => game.i18n.localize(`POKER.UNO.${k}`);
    return { red:lz("ColorRed"), yellow:lz("ColorYellow"), green:lz("ColorGreen"), blue:lz("ColorBlue") }[c] ?? c;
  }

  _drawCards(player, count) {
    for (let i = 0; i < count; i++) {
      // hand limit: stop silently at the cap
      if (this.S.rules.handLimit && player.hand.length >= HAND_LIMIT) {
        this.log(this._lz("LogHandLimit", { name: player.name, n: HAND_LIMIT }));
        break;
      }
      if (this.S.deck.length === 0) this._reshuffle();
      if (this.S.deck.length === 0) break; // truly out
      const c = this.S.deck.pop();
      if (c) player.hand.push(c);
    }
    player.saidUno = false;
    window._pokerSound?.("one_card.mp3");
  }

  _reshuffle() {
    // Empty pile rule: the discard is never reshuffled back
    if (this.S.rules.emptyPile) return;
    if (this.S.discard.length <= 1) return;
    const top = this.S.discard.pop();
    const cards = this.S.discard.splice(0);
    for (const c of cards) if (c.value === "wild" || c.value === "wild4") c.color = "wild";
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    this.S.deck = cards;
    this.S.discard = [top];
    this.log(game.i18n.localize("POKER.UNO.LogReshuffled"));
  }

  // ── Play a card ─────────────────────────────────────────────
  // secondIdx — second identical digit (rule twoCards)
  playCard({ playerIdx, cardIdx, chosenColor, secondIdx }) {
    if (this.S.phase !== "playing") return;
    const p = this.S.players[playerIdx];
    if (!p) return;
    const card = p.hand[cardIdx];
    if (!card) return;
    const top = this.S.discard[this.S.discard.length - 1];

    const outOfTurn = playerIdx !== this.S.activeIdx;
    if (outOfTurn) {
      // Jump-in / Kill-Stop: only on a "clean" table
      if (this.S.pendingWildBy >= 0 || (this.S.pendingDraw || 0) > 0 || this.S.challenge || this.S.swapBy >= 0) return;
      if (!top || card.color === "wild") return;
      const jump = this.S.rules.jumpIn   && card.color === top.color && card.value === top.value;
      const kill = this.S.rules.killStop && card.value === top.value && top.color !== "wild";
      if (!jump && !kill) return;
      this.log(this._lz(jump ? "LogJumpIn" : "LogKillStop", { name: p.name }));
    } else {
      if (this.S.pendingWildBy >= 0) return; // must choose color first
      if (!canPlayUnoFull(card, this.S)) {
        ui.notifications?.warn(game.i18n.localize(
          (this.S.pendingDraw || 0) > 0 ? "POKER.UNO.MustStackOrDraw" : "POKER.UNO.CantPlay"));
        this.push(); return;
      }
    }

    // Two identical digits in one move (rule twoCards)
    let second = null;
    if (this.S.rules.twoCards && Number.isInteger(secondIdx) && secondIdx !== cardIdx
        && (this.S.pendingDraw || 0) === 0) {
      const c2 = p.hand[secondIdx];
      if (c2 && DIGITS.includes(card.value) && c2.value === card.value) second = secondIdx;
    }

    // Remove from hand (higher index first to keep the other index valid)
    let playedSecond = null;
    if (second !== null) {
      const hi = Math.max(cardIdx, second), lo = Math.min(cardIdx, second);
      const cHi = p.hand.splice(hi, 1)[0];
      const cLo = p.hand.splice(lo, 1)[0];
      playedSecond = (hi === cardIdx) ? cLo : cHi;       // the "other" card
    } else {
      p.hand.splice(cardIdx, 1);
    }
    window._pokerSound?.("put_card.mp3");

    const played = { ...card };
    this.S.discard.push(played);
    this.log(game.i18n.format("POKER.UNO.LogPlays",{name:p.name,card:this._cardName(played)}));
    if (playedSecond) {
      const ps = { ...playedSecond };
      this.S.discard.push(ps);
      this.log(this._lz("LogPlaysSecond", { name: p.name, card: this._cardName(ps) }));
      this.S.topColor = ps.color;
    }

    // Wild — needs color choice
    if (played.value === "wild" || played.value === "wild4") {
      if (chosenColor && COLORS.includes(chosenColor)) {
        const prevColor = this.S.topColor;
        played.color = chosenColor;
        this.S.topColor = chosenColor;
        this.log(game.i18n.format("POKER.UNO.LogChooses",{name:p.name,color:this._colorRu(chosenColor)}));
        this._postPlay(played, playerIdx, prevColor);
      } else {
        this.S.pendingWildBy = playerIdx;
        this.S.activeIdx = playerIdx;   // jump-in with wild is excluded above; keep turn consistent
        this.S.phase = "needColor";
        this.push();
        return;
      }
    } else {
      if (!playedSecond) this.S.topColor = played.color;
      this._postPlay(playedSecond ? { ...playedSecond } : played, playerIdx, null);
    }
  }

  chooseColor({ playerIdx, color }) {
    if (this.S.pendingWildBy !== playerIdx) return;
    if (!COLORS.includes(color)) return;
    const top = this.S.discard[this.S.discard.length - 1];
    if (!top) return;
    const prevColor = this.S.topColor;
    top.color = color;
    this.S.topColor = color;
    this.log(game.i18n.format("POKER.UNO.LogChooses",{name:this.S.players[playerIdx].name,color:this._colorRu(color)}));
    this.S.pendingWildBy = -1;
    this.S.phase = "playing";
    this._postPlay(top, playerIdx, prevColor);
  }

  _postPlay(played, playerIdx, prevColor) {
    const p = this.S.players[playerIdx];

    // Check win
    if (p.hand.length === 0) {
      this._win(p);
      return;
    }

    // 7-0 rule: swaps happen before the turn passes
    if (this.S.rules.sevenZero && played.value === "7") {
      this.S.swapBy = playerIdx;
      this.S.phase = "needSwap";
      this.push();
      return;
    }
    if (this.S.rules.sevenZero && played.value === "0") {
      this._rotateHands();
    }

    // Apply action effects
    let nextIdx = this._next(playerIdx);

    switch (played.value) {
      case "skip": {
        this.log(game.i18n.format("POKER.UNO.LogSkip",{name:this.S.players[nextIdx].name}));
        nextIdx = this._next(nextIdx);
        break;
      }
      case "reverse": {
        this.S.direction *= -1;
        if (this.S.players.length === 2) {
          if (this.S.rules.doubleReverse) {
            // reverse acts as skip — same player goes again
            this.log(game.i18n.format("POKER.UNO.LogSkipReverse2",{name:this.S.players[nextIdx].name}));
            nextIdx = playerIdx;
          } else {
            nextIdx = this._next(playerIdx);
            this.log(game.i18n.localize("POKER.UNO.LogDirChanged"));
          }
        } else {
          nextIdx = this._next(playerIdx);
          this.log(game.i18n.localize("POKER.UNO.LogDirChanged"));
        }
        break;
      }
      case "draw2": {
        // Core stacking rule: the victim may stack another +2 or take the pile
        this.S.pendingDraw = (this.S.pendingDraw || 0) + 2;
        this.S.pendingType = "draw2";
        this.log(this._lz("LogStackPlus", { name: this.S.players[nextIdx].name, n: this.S.pendingDraw }));
        break;
      }
      case "wild4": {
        if (this.S.rules.bluff4) {
          // Bluff challenge: the victim may check the bluffer's hand
          this.S.challenge = { by: playerIdx, victim: nextIdx, prevColor: prevColor || this.S.topColor };
          this.S.phase = "challenge";
          this.S.activeIdx = nextIdx;
          this.log(this._lz("LogChallengeOffer", { name: this.S.players[nextIdx].name }));
          this.push();
          return;
        }
        this.S.pendingDraw = (this.S.pendingDraw || 0) + 4;
        this.S.pendingType = "wild4";
        this.log(this._lz("LogStackPlus", { name: this.S.players[nextIdx].name, n: this.S.pendingDraw }));
        break;
      }
      // "wild" and digits: no extra effect
    }

    this.S.activeIdx = nextIdx;
    this._tickTurn();
    this.push();
  }

  _win(p) {
    this.S.winner = p.name;
    this.S.phase = "gameover";
    this.log(game.i18n.format("POKER.UNO.LogWin",{name:p.name}));
    // Points summary, unless Sudden Death
    if (!this.S.rules.suddenDeath) {
      let total = 0;
      for (const q of this.S.players) {
        if (q === p || !q.hand.length) continue;
        const pts = q.hand.reduce((s, c) => s + cardPoints(c), 0);
        total += pts;
        this.log(this._lz("LogPoints", { name: q.name, n: pts }));
      }
      if (total > 0) this.log(this._lz("LogPointsTotal", { name: p.name, n: total }));
    }
    window._pokerSound?.("new_round.mp3");
    this.push();
  }

  _rotateHands() {
    const n = this.S.players.length;
    const hands = this.S.players.map(q => q.hand);
    for (let i = 0; i < n; i++) {
      const to = (i + this.S.direction + n) % n;
      this.S.players[to].hand = hands[i];
    }
    for (const q of this.S.players) q.saidUno = false;
    this.log(this._lz("LogZeroRotate"));
    window._pokerSound?.("dealing.mp3");
  }

  // 7-rule: the player who played a 7 picks whom to swap hands with
  swapHands({ playerIdx, targetIdx }) {
    if (this.S.phase !== "needSwap" || this.S.swapBy !== playerIdx) return;
    const p = this.S.players[playerIdx];
    const t = this.S.players[targetIdx];
    if (!t || targetIdx === playerIdx) return;
    [p.hand, t.hand] = [t.hand, p.hand];
    p.saidUno = false; t.saidUno = false;
    this.log(this._lz("LogSevenSwap", { name: p.name, target: t.name }));
    window._pokerSound?.("dealing.mp3");
    this.S.swapBy = -1;
    this.S.phase = "playing";
    this.S.activeIdx = this._next(playerIdx);
    this._tickTurn();
    this.push();
  }

  // Wild+4 bluff challenge (rule bluff4)
  challengeWild4({ playerIdx, doChallenge }) {
    const ch = this.S.challenge;
    if (!ch || this.S.phase !== "challenge" || playerIdx !== ch.victim) return;
    const bluffer = this.S.players[ch.by];
    const victim  = this.S.players[ch.victim];
    this.S.challenge = null;
    this.S.phase = "playing";

    if (!doChallenge) {
      this._drawCards(victim, 4);
      this.log(this._lz("LogChallengeTake", { name: victim.name }));
      this.S.activeIdx = this._next(ch.victim);
    } else {
      // Bluff = the bluffer still had a card of the previous color
      const hadColor = bluffer.hand.some(c => c.color === ch.prevColor);
      if (hadColor) {
        this._drawCards(bluffer, 4);
        this.log(this._lz("LogChallengeBluff", { name: bluffer.name, color: this._colorRu(ch.prevColor) }));
        this.S.activeIdx = ch.victim; // honest challenger plays on
      } else {
        this._drawCards(victim, 6);
        this.log(this._lz("LogChallengeFair", { name: victim.name }));
        this.S.activeIdx = this._next(ch.victim);
      }
    }
    this._tickTurn();
    this.push();
  }

  // Voluntary quit (rule quitting)
  quitGame({ playerIdx }) {
    if (!this.S.rules.quitting) return;
    if (this.S.phase !== "playing" && this.S.phase !== "needColor") return;
    const p = this.S.players[playerIdx];
    if (!p) return;

    // cards go under the discard pile
    this.S.discard.unshift(...p.hand.map(c =>
      (c.value === "wild" || c.value === "wild4") ? { ...c, color: "wild" } : c));
    this.log(this._lz("LogQuit", { name: p.name }));

    // clean pending states tied to this player
    if (this.S.pendingWildBy === playerIdx) {
      // their wild stays on top with a random color
      this.S.pendingWildBy = -1;
      this.S.phase = "playing";
      this.S.topColor = COLORS[Math.floor(Math.random() * 4)];
      const top = this.S.discard[this.S.discard.length - 1];
      if (top) top.color = this.S.topColor;
    }
    if (this.S.swapBy === playerIdx) { this.S.swapBy = -1; this.S.phase = "playing"; }
    if (this.S.challenge && (this.S.challenge.by === playerIdx || this.S.challenge.victim === playerIdx)) {
      this.S.challenge = null; this.S.phase = "playing";
      this.S.pendingDraw = 0; this.S.pendingType = null;
    }

    const wasActive = this.S.activeIdx === playerIdx;
    const nextAfter = wasActive ? this._next(playerIdx) : this.S.activeIdx;

    this.S.players.splice(playerIdx, 1);

    // re-point indices after removal
    const fix = idx => (idx > playerIdx ? idx - 1 : idx);
    this.S.activeIdx     = fix(nextAfter) % Math.max(1, this.S.players.length);
    if (this.S.pendingWildBy >= 0) this.S.pendingWildBy = fix(this.S.pendingWildBy);
    if (this.S.swapBy >= 0)        this.S.swapBy        = fix(this.S.swapBy);
    if (this.S.challenge) {
      this.S.challenge.by     = fix(this.S.challenge.by);
      this.S.challenge.victim = fix(this.S.challenge.victim);
    }

    if (this.S.players.length === 1) {
      this._win(this.S.players[0]);
      return;
    }
    this.push();
  }

  // ── Draw ────────────────────────────────────────────────────
  drawCard({ playerIdx }) {
    if (this.S.phase !== "playing") return;
    if (playerIdx !== this.S.activeIdx) return;
    if (this.S.pendingWildBy >= 0) return;
    const p = this.S.players[playerIdx];
    if (!p) return;

    // Pending +2/+4 stack: drawing means taking the whole pile
    if ((this.S.pendingDraw || 0) > 0) {
      const n = this.S.pendingDraw;
      this._drawCards(p, n);
      this.log(this._lz("LogStackTaken", { name: p.name, n }));
      this.S.pendingDraw = 0;
      this.S.pendingType = null;
      this.S.activeIdx = this._next(playerIdx);
      this._tickTurn();
      this.push();
      return;
    }

    // Force play: you must play if you can
    if (this.S.rules.forcePlay && p.hand.some(c => canPlayUnoFull(c, this.S))) {
      ui.notifications?.warn(game.i18n.localize("POKER.UNO.ForcePlayWarn"));
      this.push(); return;
    }

    // Empty pile: deck may truly run out — the turn just passes
    if (this.S.deck.length === 0 && this.S.rules.emptyPile) {
      this.log(this._lz("LogDeckEmptyPass", { name: p.name }));
      this.S.activeIdx = this._next(playerIdx);
      this._tickTurn();
      this.push();
      return;
    }

    this._drawCards(p, 1);
    const drawn = p.hand[p.hand.length - 1];
    this.log(game.i18n.format("POKER.UNO.LogDraws",{name:p.name})+(drawn ? ` (${this._cardName(drawn)})` : ""));

    // Draw 1 rule: a playable drawn card is played immediately
    if (this.S.rules.drawOne && drawn && canPlayUnoFull(drawn, this.S)) {
      this.log(this._lz("LogDrawPlay", { name: p.name }));
      this.playCard({ playerIdx, cardIdx: p.hand.length - 1 });
      return;
    }

    this.S.activeIdx = this._next(playerIdx);
    this._tickTurn();
    this.push();
  }

  // Progressive rule: every full circle everyone draws one more card
  _tickTurn() {
    if (!this.S.rules.progressive) return;
    this.S.turnCount++;
    const n = this.S.players.length;
    if (n > 0 && this.S.turnCount % n === 0) {
      for (const q of this.S.players) this._drawCards(q, 1);
      this.log(this._lz("LogProgressive"));
    }
  }

  // Player declares UNO (when they will have 1 card after current play, OR they have 1 already)
  sayUno({ playerIdx }) {
    if (this.S.rules.silentUno) return; // not needed under Silent UNO
    const p = this.S.players[playerIdx];
    if (!p) return;
    if (p.hand.length > 2) {
      ui.notifications?.warn(game.i18n.localize("POKER.UNO.UnoOnly12"));
      return;
    }
    p.saidUno = true;
    this.log(game.i18n.format("POKER.UNO.LogUnoShout",{name:p.name}));
    this.push();
  }

  // Someone catches a player who has 1 card and didn't say UNO → +2 penalty
  catchUno({ targetIdx, catcherIdx }) {
    if (this.S.rules.silentUno) return; // no catching under Silent UNO
    const target = this.S.players[targetIdx];
    if (!target) return;
    if (target.hand.length !== 1) {
      ui.notifications?.warn(game.i18n.localize("POKER.UNO.NotOneCard"));
      return;
    }
    if (target.saidUno) {
      ui.notifications?.info(game.i18n.localize("POKER.UNO.AlreadySaid"));
      return;
    }
    this._drawCards(target, 2);
    const catcher = this.S.players[catcherIdx];
    this.log(game.i18n.format("POKER.UNO.LogCatch",{catcher:catcher?.name ?? game.i18n.localize("POKER.UNO.Someone"),target:target.name}));
    this.push();
  }

  resetToSetup() {
    this.S = unoInitialState();
    this.push();
  }

  rematch() {
    // Same players, fresh deal; rules are re-captured from settings
    const players = this.S.players.map(p => ({
      name: p.name, actorId: p.actorId, userId: p.userId, hand: [], saidUno: false,
    }));
    this.S = unoInitialState();
    this.S.rules = getUnoRules();
    this.S.players = players;
    this.S.startedAt = Date.now();
    this.log(game.i18n.localize("POKER.UNO.LogRematch") + players.map(p => p.name).join(", "));
    this._logActiveRules();
    this._deal();
  }
}
