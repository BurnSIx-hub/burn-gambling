// ============================================================
// Card Games VTT — scripts/durak-game.mjs
// Подкидной + Переводной Дурак · 36 карт (6–A) · 2–6 игроков
// ============================================================

const SUITS = ["♠","♥","♦","♣"];
const RANKS = ["6","7","8","9","10","J","Q","K","A"];
const RANK_ORDER = { "6":0,"7":1,"8":2,"9":3,"10":4,"J":5,"Q":6,"K":7,"A":8 };

function buildDeck36() {
  const d=[];
  for (const s of SUITS) for (const r of RANKS) d.push({rank:r,suit:s});
  return d.sort(()=>Math.random()-0.5);
}
function rv(card) { return RANK_ORDER[card.rank]??0; }
function canBeat(attack, defense, trump) {
  if (defense.suit===attack.suit) return rv(defense)>rv(attack);
  if (defense.suit===trump && attack.suit!==trump) return true;
  return false;
}

export const durakInitialState = () => ({
  phase: "setup",       // setup | playing | gameover
  variant: "podkidnoy", // podkidnoy | perevodny
  players: [],
  deck: [],
  trump: null,
  trumpSuit: "",
  table: [],            // [{attack, defense|null}]
  attackerIdx: 0,
  defenderIdx: 1,
  activeIdx: 0,
  translators: [],      // indices of players who translated this round (переводной)
  log: [],
  loser: null,
});

export class DurakGame {
  constructor() { this.S = durakInitialState(); window._durakGame = this; }

  push() {
    window._pokerEmit?.("DURAK_STATE", { state: this.S });
    window._durakApp?.onStateUpdate(this.S);
  }
  log(msg) { this.S.log.unshift(msg); if(this.S.log.length>60) this.S.log.pop(); }

  startGame({ players, variant = "podkidnoy" }) {
    const built = players.map(p => {
      const actor = p.actorId ? game.actors.get(p.actorId) : null;
      return { name:actor?.name??game.i18n.localize("POKER.P.Player"), actorId:p.actorId, userId:p.userId, hand:[], outOfGame:false };
    });
    this.S.players  = built;
    this.S.variant  = variant;
    const vName = game.i18n.localize(variant === "perevodny" ? "POKER.DK.VPerevod" : "POKER.DK.VPodkid");
    this.log(game.i18n.format("POKER.DK.LogStarted",{variant:vName}) + built.map(p=>p.name).join(", "));
    this._deal();
  }

  _deal() {
    this.S.deck = buildDeck36();
    this.S.trump = this.S.deck.shift();
    this.S.trumpSuit = this.S.trump.suit;
    this.S.translators = [];
    window._pokerSound?.("new_round.mp3");
    for (const p of this.S.players) {
      p.hand = []; p.outOfGame = false;
      for (let i=0; i<6; i++) { const c=this.S.deck.pop(); if(c) p.hand.push(c); }
    }
    window._pokerSound?.("dealing.mp3");
    this.S.deck.unshift(this.S.trump);

    let minTrump=99, firstAtt=0;
    this.S.players.forEach((p,i) => {
      p.hand.forEach(c => {
        if (c.suit===this.S.trumpSuit && rv(c)<minTrump) { minTrump=rv(c); firstAtt=i; }
      });
    });
    this.S.attackerIdx = firstAtt;
    this.S.defenderIdx = this._nextAlive(firstAtt);
    this.S.activeIdx   = firstAtt;
    this.S.table = [];
    this.S.phase = "playing";
    this.log(game.i18n.format("POKER.DK.LogTrump",{card:this.S.trump.rank+this.S.trump.suit,name:this.S.players[firstAtt].name}));
    this.push();
  }

  _nextAlive(from) {
    const n = this.S.players.length;
    for (let i=1; i<=n; i++) {
      const idx=(from+i)%n;
      if (!this.S.players[idx].outOfGame) return idx;
    }
    return from;
  }

  // Any non-defender can attack / подкидывать (подкидной + переводной)
  attack({ playerIdx, cardIdx }) {
    const p = this.S.players[playerIdx];
    if (!p||p.outOfGame) return;
    if (this.S.phase!=="playing") return;
    if (playerIdx===this.S.defenderIdx) return;
    // Empty table: only attacker starts the round
    if (this.S.table.length===0 && playerIdx!==this.S.attackerIdx) return;

    const card = p.hand[cardIdx];
    if (!card) return;
    if (this.S.table.length>0) {
      const ranks = this.S.table.flatMap(t=>[t.attack?.rank, t.defense?.rank]).filter(Boolean);
      if (!ranks.includes(card.rank)) {
        ui.notifications?.warn(game.i18n.localize("POKER.DK.OnlySameRank"));
        this.push(); return;
      }
    }
    const maxAtk = Math.min(6, this.S.players[this.S.defenderIdx].hand.length + this.S.table.filter(t=>t.defense).length);
    if (this.S.table.length >= maxAtk) { this.push(); return; }

    p.hand.splice(cardIdx,1);
    window._pokerSound?.("put_card.mp3");
    this.S.table.push({ attack:card, defense:null });
    this.log(game.i18n.format("POKER.DK.LogAttack",{name:p.name,card:card.rank+card.suit}));
    this.S.activeIdx = this.S.defenderIdx;
    this.push();
  }

  // Переводной only: defender redirects attack by playing same rank
  translate({ playerIdx, cardIdx }) {
    if (this.S.variant !== "perevodny") return;
    if (playerIdx !== this.S.defenderIdx) return;
    if (this.S.phase !== "playing") return;
    if (this.S.table.length === 0) return;
    // Translation only possible if no cards beaten yet
    if (this.S.table.some(t => t.defense !== null)) return;

    const p = this.S.players[playerIdx];
    const card = p.hand[cardIdx];
    if (!card) return;

    const attackRanks = this.S.table.map(t => t.attack.rank);
    if (!attackRanks.includes(card.rank)) {
      ui.notifications?.warn(game.i18n.localize("POKER.DK.TranslateSameRank"));
      return;
    }

    const newDefIdx = this._nextAlive(playerIdx);
    const newDefCards = this.S.players[newDefIdx].hand.length;
    if (newDefCards <= this.S.table.length) {
      ui.notifications?.warn(game.i18n.localize("POKER.DK.CantAcceptTranslate"));
      return;
    }

    p.hand.splice(cardIdx, 1);
    window._pokerSound?.("put_card.mp3");
    this.S.table.push({ attack: card, defense: null });
    this.log(game.i18n.format("POKER.DK.LogTranslate",{name:p.name,card:card.rank+card.suit,target:this.S.players[newDefIdx].name}));

    if (!this.S.translators.includes(playerIdx)) this.S.translators.push(playerIdx);
    this.S.defenderIdx = newDefIdx;
    this.S.activeIdx   = newDefIdx;
    this.push();
  }

  defend({ playerIdx, handCardIdx, tableIdx }) {
    if (playerIdx!==this.S.defenderIdx) return;
    const p = this.S.players[playerIdx];
    const slot = this.S.table[tableIdx];
    if (!slot||slot.defense) return;
    const card = p.hand[handCardIdx];
    if (!card) return;
    if (!canBeat(slot.attack, card, this.S.trumpSuit)) {
      this.push(); return;
    }
    p.hand.splice(handCardIdx,1);
    window._pokerSound?.("put_card.mp3");
    slot.defense = card;
    this.log(game.i18n.format("POKER.DK.LogDefend",{name:p.name,a:slot.attack.rank+slot.attack.suit,d:card.rank+card.suit}));
    const unbeaten = this.S.table.filter(t=>!t.defense).length;
    if (unbeaten===0) this.S.activeIdx = this.S.attackerIdx;
    this.push();
  }

  takeCards({ playerIdx }) {
    if (playerIdx!==this.S.defenderIdx) return;
    const p = this.S.players[playerIdx];
    const taken = this.S.table.flatMap(t=>[t.attack,t.defense]).filter(Boolean);
    p.hand.push(...taken);
    this.log(game.i18n.format("POKER.DK.LogTake",{name:p.name,n:taken.length}));
    this.S.table = [];
    this.S.translators = [];
    const nextDef = this._nextAlive(this.S.defenderIdx);
    this.S.defenderIdx = this._nextAlive(nextDef);
    this.S.attackerIdx = nextDef;
    this.S.activeIdx   = nextDef;
    this._refill();
    this._checkEnd();
  }

  // Only original attacker can pass (end the round)
  passTurn({ playerIdx }) {
    if (playerIdx !== this.S.attackerIdx) return;
    const unbeaten = this.S.table.filter(t=>!t.defense).length;
    if (unbeaten>0) return;
    this.log(game.i18n.format("POKER.DK.LogDefended",{name:this.S.players[this.S.defenderIdx].name}));
    this.S.table = [];
    this.S.translators = [];
    const oldDef = this.S.defenderIdx;
    this.S.attackerIdx = oldDef;
    this.S.defenderIdx = this._nextAlive(oldDef);
    this.S.activeIdx   = oldDef;
    this._refill();
    this._checkEnd();
  }

  _refill() {
    const order = [];
    let cur = this.S.attackerIdx;
    for (let i=0; i<this.S.players.length; i++) {
      if (cur!==this.S.defenderIdx && !this.S.players[cur].outOfGame) order.push(cur);
      cur = this._nextAlive(cur);
    }
    order.push(this.S.defenderIdx);
    for (const idx of order) {
      const p = this.S.players[idx];
      while (p.hand.length<6 && this.S.deck.length>0) {
        const card = this.S.deck.pop();
        if (card) { p.hand.push(card); window._pokerSound?.("one_card.mp3"); }
      }
    }
  }

  _checkEnd() {
    this.S.players.forEach(p => {
      if (!p.outOfGame && p.hand.length===0 && this.S.deck.length===0) {
        p.outOfGame=true;
        this.log(game.i18n.format("POKER.DK.LogWentOut",{name:p.name}));
      }
    });
    const alive = this.S.players.filter(p=>!p.outOfGame);
    if (alive.length<=1) {
      this.S.phase="gameover";
      this.S.loser = alive[0]?.name ?? "???";
      this.log(game.i18n.format("POKER.DK.LogFool",{name:this.S.loser}));
      this.push(); return;
    }
    if (this.S.players[this.S.attackerIdx]?.outOfGame)
      this.S.attackerIdx = this._nextAlive(this.S.attackerIdx);
    if (this.S.players[this.S.defenderIdx]?.outOfGame)
      this.S.defenderIdx = this._nextAlive(this.S.defenderIdx);
    this.S.activeIdx = this.S.attackerIdx;
    this.push();
  }

  resetToSetup() { this.S.phase="setup"; this.push(); }

  rematch() {
    const loserName = this.S.loser;
    const variant   = this.S.variant;
    this.S.players.forEach(p => { p.hand = []; p.outOfGame = false; });
    this.S.table       = [];
    this.S.translators = [];
    this.S.loser       = null;
    this.S.log         = [];
    const vName = game.i18n.localize(variant === "perevodny" ? "POKER.DK.VPerevod" : "POKER.DK.VPodkid");
    this.log(game.i18n.format("POKER.DK.LogRematch",{variant:vName}) + this.S.players.map(p=>p.name).join(", "));
    this.S.deck  = buildDeck36();
    this.S.trump = this.S.deck.shift();
    this.S.trumpSuit = this.S.trump.suit;
    window._pokerSound?.("new_round.mp3");
    for (const p of this.S.players) {
      for (let i=0; i<6; i++) { const c=this.S.deck.pop(); if(c) p.hand.push(c); }
    }
    window._pokerSound?.("dealing.mp3");
    this.S.deck.unshift(this.S.trump);
    let firstAtt = this.S.players.findIndex(p=>p.name===loserName);
    if (firstAtt < 0) {
      let minTrump=99;
      this.S.players.forEach((p,i) => {
        p.hand.forEach(c => {
          if (c.suit===this.S.trumpSuit && rv(c)<minTrump) { minTrump=rv(c); firstAtt=i; }
        });
      });
    }
    if (firstAtt < 0) firstAtt = 0;
    this.S.attackerIdx = firstAtt;
    this.S.defenderIdx = this._nextAlive(firstAtt);
    this.S.activeIdx   = firstAtt;
    this.S.variant     = variant;
    this.S.phase       = "playing";
    this.log(game.i18n.format("POKER.DK.LogTrumpFool",{card:this.S.trump.rank+this.S.trump.suit,name:this.S.players[firstAtt].name}));
    this.push();
  }
}
