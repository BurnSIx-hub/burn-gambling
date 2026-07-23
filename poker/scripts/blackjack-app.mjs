// ============================================================
// Card Games VTT — scripts/blackjack-app.mjs
// ============================================================

import { BlackjackGame, bjInitialState, bjTotal, fmt } from "./blackjack-game.mjs";
import { PokerSettings } from "./poker-settings.mjs";
import { setDisplayStakes } from "./currency.mjs";

const MODULE_ID = "poker-table-vtt";
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

// Локализация: ключи POKER.* в lang/ru.json и lang/en.json
const L  = (k)    => game.i18n.localize(`POKER.${k}`);
const LF = (k, d) => game.i18n.format(`POKER.${k}`, d);

export class BlackjackApp extends foundry.applications.api.ApplicationV2 {
  constructor() { super(); this._S = bjInitialState(); window._bjApp = this; }

  static DEFAULT_OPTIONS = {
    id: "blackjack-app",
    window: { title: "POKER.BJ.Title", resizable: true },
    position: { width: 1920, height: 1080 },
    classes: ["poker-dialog"],
  };

  onStateUpdate(state) { this._S = state; setDisplayStakes(state?.stakes); this._draw(); }

  async _renderHTML(_ctx, _opts) {
    const c = PokerSettings.getFeltColor();
    const el = document.createElement("div");
    el.id = "poker-root";
    el.style.setProperty("--felt-color", c);
    const font = PokerSettings.getUIFont?.() ?? "Caveat";
    el.style.setProperty("--cg-font", `'${font}'`);
    el.style.setProperty("--cg-font-title", `'${font}'`);
    return el;
  }

  _replaceHTML(result, content, _opts) {
    content.replaceChildren(result);
    this._draw();
  }

  _root() { return this.element?.querySelector("#poker-root") ?? null; }

  _draw() {
    const root = this._root(); if (!root) return;
    const S = this._S;
    const skin = PokerSettings.getCardSkin();

    if (S.phase==="setup") {
      root.innerHTML = `<div class="wait-screen"><div class="wt">♠ BLACKJACK ♠</div>
        <div class="ws">${L("BJ.WaitStart")}</div><div class="wait-spin">🃏</div></div>`;
      return;
    }

    let myIdx = S.players.findIndex(p=>p.userId===game.user.id);
    if (myIdx<0 && !game.user.isGM) {
      const unassigned=S.players.filter(p=>!p.userId);
      const activeNonGM=game.users.filter(u=>!u.isGM&&u.active);
      if (unassigned.length===1&&activeNonGM.length===1&&activeNonGM[0].id===game.user.id)
        myIdx=S.players.findIndex(p=>!p.userId);
    }
    const myP   = myIdx>=0 ? S.players[myIdx] : null;
    const isGM  = game.user.isGM;
    const curIdx = S.currentPlayerIdx;
    const isMyTurn = S.phase==="playing" && curIdx===myIdx && myP && !myP.done;

    // Dealer section
    const dealerTotal = S.dealer.hidden ? "?" : bjTotal(S.dealer.hand);
    const bankLow = S.dealerBank < 20;
    const dealerCards = S.dealer.hand.map((c,i) =>
      (i===1 && S.dealer.hidden) ? `<div class="poker-card back skin-${skin}"></div>` : this._card(c)
    ).join("");

    // Players
    const seats = S.players.map((p,i) => {
      const isTurn = S.phase==="playing" && i===curIdx;
      const isMe = p.userId===game.user.id || i===myIdx;
      let cls = "bj-seat";
      if (isTurn) cls+=" active";
      if (p.busted) cls+=" folded";
      if (p.isWinner) cls+=" winner";
      if (isMe&&!p.busted&&!p.isWinner) cls+=" is-me";
      const showCards = isGM || isMe || S.phase==="result" || S.phase==="dealer";
      const actor = p.actorId ? game.actors.get(p.actorId) : null;
      const av = actor?.img&&!actor.img.includes("mystery-man")
        ? `<img class="player-avatar" src="${esc(actor.img)}">`
        : `<div class="player-av-ph">🧙</div>`;
      const total = bjTotal(p.hand);
      const userObj = p.userId ? game.users.get(p.userId) : null;
      return `<div class="${cls}">
        <div class="player-header">${av}
          <div class="player-info">
            <div class="player-name">${esc(p.name)}${isMe?'<span style="font-size:.6em;color:#4090ff"> ◀</span>':""}</div>
            ${userObj?`<div class="player-tag">👤 ${esc(userObj.name)}</div>`:`<div class="player-tag" style="color:#ffb840">🤖 NPC</div>`}
          </div>
        </div>
        <div class="player-status">
          ${p.bet>0?`${L("BJ.BetLabel")} <span class="pp">${fmt(p.bet)}</span> &nbsp;|&nbsp; `:""}
          <span class="pp">${fmt(p.platinum)}</span>
        </div>
        ${p.result?`<div class="player-bets" style="color:${p.isWinner?"#80ff80":p.isPush?"#f0c040":"#ff8080"}">${p.result}</div>`:""}
        <div class="hand-cards">
          ${p.hand.map(c=>this._card(c, !showCards, skin)).join("")}
          ${p.hand.length>0?`<div class="bj-total ${total>21?"bust":total===21?"bj21":""}">${total>21?"💥":total===21?"🎯":""}${total}</div>`:""}
        </div>
        ${this._seatControls(S, p, i, isTurn, isGM, isMe)}
      </div>`;
    }).join("");

    root.innerHTML = `
      <div id="poker-title">♠ BLACKJACK ♠${isGM?'<span class="gm-badge">GM</span>':""}</div>
      <div id="poker-body">
        ${this._sidebar()}
        <div id="poker-main">
          <div id="bj-dealer">
            <div class="bj-dealer-label">${L("BJ.Dealer")} &nbsp; <span class="bj-dealer-total">${dealerTotal}</span>
          <span id="bj-dealer-bank" class="${bankLow?'low':''}">${L("P.Bank")} ${fmt(S.dealerBank)}</span></div>
            <div class="hand-cards" style="justify-content:center">${dealerCards}</div>
          </div>
          <div id="bj-players">${seats}</div>
        </div>
      </div>
      <div id="controls">${this._controls(S, myP, myIdx, isMyTurn, isGM)}</div>
      <div id="log-area">${S.log.slice(0,20).map(l=>`<div>${esc(l)}</div>`).join("")}</div>
    `;
    this._bind(root, S, myIdx, isMyTurn);
  }

  _card(card, hidden=false, skin="classic") {
    if (hidden) return `<div class="poker-card back skin-${skin}"></div>`;
    const red = card.suit==="♥"||card.suit==="♦";
    return `<div class="poker-card ${red?"red":"black"}">
      <div class="p-rank">${card.rank}</div><div class="p-suit">${card.suit}</div>
    </div>`;
  }

  _seatControls(S, p, i, isTurn, isGM, isMe) {
    // Betting phase
    if (S.phase==="betting" && p.bet===0 && !p.sittingOut) {
      if (isMe || (isGM && !p.userId)) {
        return `<div class="npc-controls">
          <input type="text" class="bj-bet-inp" data-idx="${i}" placeholder="${L("BJ.BetBtn")}" style="width:90px">
          <button class="bj-bet-btn g" data-idx="${i}">${L("BJ.PlaceBetBtn")}</button>
        </div>`;
      }
    }
    // Playing phase — NPC controls for GM
    if (isTurn && isGM && !p.userId && !p.done) {
      return `<div class="npc-controls">
        <button class="npc-act g" data-idx="${i}" data-act="hit">${L("BJ.NpcHit")}</button>
        <button class="npc-act b" data-idx="${i}" data-act="stand">${L("BJ.NpcStand")}</button>
        ${p.hand.length===2?`<button class="npc-act o" data-idx="${i}" data-act="double">×2</button>`:""}
      </div>`;
    }
    return "";
  }

  _controls(S, myP, myIdx, isMyTurn, isGM) {
    let h="";
    if (S.phase==="result") {
      if (isGM) h=`<div class="btn-row">
        <button id="bj-newround" class="g">${L("BJ.NewRound")}</button>
        <button id="bj-newgame">${L("BJ.ChangeGame")}</button>
      </div>`;
      else h=`<div class="hint" style="padding:8px">${L("BJ.WaitingGM")}</div>`;
    } else if (S.phase==="playing" && isMyTurn && myP && !myP.done) {
      const t = bjTotal(myP.hand);
      h=`<div id="turn-bar">${L("BJ.YourTurn")} <strong style="color:${t>21?"#ff6060":t===21?"#80ff80":"#f0c040"}">${t}</strong></div>
      <div class="btn-row">
        <button id="bj-hit" class="g">${L("BJ.Hit")}</button>
        <button id="bj-stand" class="r">${L("BJ.Stand")}</button>
        ${myP.hand.length===2?`<button id="bj-double" class="o">${L("BJ.Double")}</button>`:""}
      </div>`;
    } else if (S.phase==="playing") {
      const cur = S.players[S.currentPlayerIdx];
      h=`<div class="hint" style="padding:8px">${LF("BJ.TurnOf",{name:esc(cur?.name??"...")})}</div>`;
    } else if (S.phase==="betting") {
      const myBet = myP?.bet??0;
      if (myBet===0) h=`<div class="hint" style="padding:8px">${L("BJ.PlaceBet")}</div>`;
      else h=`<div class="hint" style="padding:8px">${LF("BJ.BetAccepted",{n:fmt(myBet)})}</div>`;
    } else if (S.phase==="dealer") {
      h=`<div class="hint" style="padding:8px">${L("BJ.DealerOpens")}</div>`;
    }
    return h;
  }

  _sidebar() {
    return `<div id="combo-guide" style="width:150px">
      <h3>${L("BJ.Rules")}</h3>
      <div class="combo-item"><div class="combo-rank">21</div><div><div class="combo-name">${L("BJ.ResBlackjack")}</div><div class="combo-desc">${L("BJ.RuleBJDesc")}</div></div></div>
      <div class="combo-item"><div class="combo-rank">W</div><div><div class="combo-name">${L("BJ.ResWin")}</div><div class="combo-desc">${L("BJ.RuleWinDesc")}</div></div></div>
      <div class="combo-item"><div class="combo-rank">=</div><div><div class="combo-name">${L("BJ.ResPush")}</div><div class="combo-desc">${L("BJ.RulePushDesc")}</div></div></div>
      <div class="combo-item"><div class="combo-rank">💥</div><div><div class="combo-name">${L("BJ.ResBust")}</div><div class="combo-desc">${L("BJ.RuleBustDesc")}</div></div></div>
      <div class="combo-item"><div class="combo-rank">17</div><div><div class="combo-name">${L("BJ.ResDealer")}</div><div class="combo-desc">${L("BJ.RuleDealerDesc")}</div></div></div>
      <div class="combo-item"><div class="combo-rank">×2</div><div><div class="combo-name">${L("BJ.ResDouble")}</div><div class="combo-desc">${L("BJ.RuleDoubleDesc")}</div></div></div>
    </div>`;
  }

  _bind(root, S, myIdx, isMyTurn) {
    const isGM = game.user.isGM;
    const g = window._bjGame;

    const send = (action, data) => {
      if (isGM && g) {
        if      (action==="BJ_REQ_HIT")    g.playerHit(data);
        else if (action==="BJ_REQ_STAND")  g.playerStand(data);
        else if (action==="BJ_REQ_DOUBLE") g.playerDouble(data);
      } else { window._pokerEmit?.(action, data); }
    };

    // Betting buttons
    root.querySelectorAll(".bj-bet-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.idx);
        const inp = root.querySelector(`.bj-bet-inp[data-idx="${idx}"]`);
        const v   = parseFloat(inp?.value?.trim());
        if (isNaN(v)||v<=0) { ui.notifications.warn(L("BJ.EnterBet")); return; }
        if (isGM&&g) g.placeBet({ playerIdx:idx, amount:v });
        else window._pokerEmit?.("BJ_REQ_BET", { playerIdx:idx, amount:v });
      });
    });
    root.querySelectorAll(".bj-bet-inp").forEach(inp => {
      inp.addEventListener("keydown", e => { if(e.key==="Enter") inp.nextElementSibling?.click(); });
    });

    // Player controls
    if (isMyTurn) {
      root.querySelector("#bj-hit")   ?.addEventListener("click", ()=>send("BJ_REQ_HIT",    {playerIdx:myIdx}));
      root.querySelector("#bj-stand") ?.addEventListener("click", ()=>send("BJ_REQ_STAND",  {playerIdx:myIdx}));
      root.querySelector("#bj-double")?.addEventListener("click", ()=>send("BJ_REQ_DOUBLE", {playerIdx:myIdx}));
    }

    // NPC controls
    if (isGM&&g) {
      root.querySelectorAll(".npc-act").forEach(btn => {
        btn.addEventListener("click", ()=>{
          const idx=parseInt(btn.dataset.idx), act=btn.dataset.act;
          if(act==="hit")    g.playerHit({playerIdx:idx});
          else if(act==="stand")  g.playerStand({playerIdx:idx});
          else if(act==="double") g.playerDouble({playerIdx:idx});
        });
      });
      root.querySelector("#bj-newround")?.addEventListener("click", ()=>{
        window._pokerEmit?.("BJ_REQ_NEWROUND",{}); g.newRound();
      });
      root.querySelector("#bj-newgame")?.addEventListener("click", ()=>{
        window._pokerEmit?.("OPEN_LOBBY",{}); window._openLobby?.();
      });
    }
  }
}
