// ============================================================
// Poker Table VTT — scripts/poker-app.mjs
// v4: Dealer button · Blinds · Round history · Reconnect
// ============================================================

import { PokerGame, fmt, initialState } from "./poker-game.mjs";
import { PokerSettings }                from "./poker-settings.mjs";
import { getStakesConfig, setDisplayStakes, isCurrencyMode, getActorFunds } from "./currency.mjs";

const MODULE_ID   = "poker-table-vtt";
const MAX_PLAYERS = 6;
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

// Локализация: ключи POKER.* в lang/ru.json и lang/en.json
const L  = (k)    => game.i18n.localize(`POKER.${k}`);
const LF = (k, d) => game.i18n.format(`POKER.${k}`, d);

// Лениво — на момент загрузки модуля i18n ещё не готов
const COMBOS = () => [
  {r:"1",  n:"Royal Flush",     d:L("P.ComboRoyal")},
  {r:"2",  n:"Straight Flush",  d:L("P.ComboStraightFlush")},
  {r:"3",  n:"Four of a Kind",  d:L("P.ComboQuads")},
  {r:"4",  n:"Full House",      d:L("P.ComboFullHouse")},
  {r:"5",  n:"Flush",           d:L("P.ComboFlush")},
  {r:"6",  n:"Straight",        d:L("P.ComboStraight")},
  {r:"7",  n:"Three of a Kind", d:L("P.ComboTrips")},
  {r:"8",  n:"Two Pair",        d:L("P.ComboTwoPair")},
  {r:"9",  n:"One Pair",        d:L("P.ComboPair")},
  {r:"10", n:"High Card",       d:L("P.ComboHigh")},
];

export class PokerApp extends foundry.applications.api.ApplicationV2 {
  constructor(){
    super();
    this._S = initialState();
    window._pokerApp = this;
    this._tab = "game"; // "game" | "history"
  }

  static DEFAULT_OPTIONS = {
    id: "poker-table-app",
    window: { title: "⚜ Poker Table", resizable: true },
    position: { width: 1920, height: 1080 },
    classes: ["poker-dialog"],
  };

  _root(){ return this.element?.querySelector("#poker-root") ?? null; }

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
    this._rerender();
  }

  onStateUpdate(state){ this._S=state; setDisplayStakes(state?.stakes); this.applyFeltColor(); this._rerender(); }

  applyFeltColor(){
    const c=PokerSettings.getFeltColor();
    const r=this._root(); if(r)r.style.setProperty("--felt-color",c);
  }
  rerender(){ this._rerender(); }

  _rerender(){
    const root=this._root(); if(!root) return;
    const S=this._S;
    const skin=PokerSettings.getCardSkin();

    if(S.phase==="setup"){
      if(game.user.isGM){ root.innerHTML=this._renderSetup(); this._bindSetup(root); }
      else root.innerHTML=`<div class="wait-screen">
        <div class="wt">⚜ POKER TABLE ⚜</div>
        <div class="ws">${L("P.WaitGameStart")}</div>
        <div class="wait-spin">🃏</div></div>`;
      return;
    }

    const myIdx=S.players.findIndex(p=>p.userId===game.user.id);
    const myP=myIdx>=0?S.players[myIdx]:null;
    const bidx=this._bettorIdx(S);
    const isMyTurn=S.phase==="betting"&&bidx===myIdx&&myP&&!myP.folded&&!myP.allIn;

    const tabs=`<div id="poker-tabs">
      <span class="ptab${this._tab==="game"?" active":""}" data-tab="game">${L("P.TabGame")}</span>
      <span class="ptab${this._tab==="history"?" active":""}" data-tab="history">${L("P.TabHistory")}</span>
    </div>`;

    let main="";
    if(this._tab==="history"){
      main=this._renderHistory(S);
    } else {
      main=`
        <div id="poker-body">
          ${this._sidebar()}
          <div id="poker-main">
            ${S.resultBanner?`<div id="result-banner" style="display:block">${S.resultBanner}</div>`:""}
            <div id="phase-label">— ${this._pl(S.phase)} — &nbsp;
              ${S.roundNum?`<span style="font-size:.7em;color:#7a9060">${LF("P.Round",{n:S.roundNum})}</span>`:""}
            </div>
            ${this._table(S,skin)}
          </div>
        </div>
        <div id="controls">${this._controls(S,myIdx,myP,bidx,isMyTurn)}</div>
        <div id="log-area">${S.log.slice(0,25).map(l=>`<div>${esc(l)}</div>`).join("")}</div>`;
    }

    root.innerHTML=`<div id="poker-title">⚜ POKER ⚜${game.user.isGM?'<span class="gm-badge">GM</span>':""}</div>${tabs}${main}`;
    this._bindTabs(root);
    if(this._tab==="game") this._bindGame(root,S,myIdx,isMyTurn);
  }

  // ── History tab ───────────────────────────────────────────
  _renderHistory(S){
    const rows=S.roundHistory?.map(r=>`<tr>
      <td style="color:#f0c040">${r.round}</td>
      <td>${esc(r.winner)}</td>
      <td style="color:#80ff80">+${fmt(r.amount)}</td>
      <td style="color:#7a9060;font-size:.85em">${esc(r.combo)}</td>
    </tr>`).join("") || "";

    const stats=S.players?.map(p=>`<tr>
      <td>${esc(p.name)}</td>
      <td style="color:#80ff80">+${fmt(p.sessionWon||0)}</td>
      <td style="color:#ff8080">-${fmt(p.sessionLost||0)}</td>
      <td style="color:${(p.sessionWon||0)-(p.sessionLost||0)>=0?"#80ff80":"#ff8080"}">
        ${(p.sessionWon||0)-(p.sessionLost||0)>=0?"+":""}${fmt(Math.abs((p.sessionWon||0)-(p.sessionLost||0)))}
      </td>
    </tr>`).join("") || "";

    return `<div style="padding:14px 20px">
      <h3 style="color:#f0c040;font-family:'Cinzel Decorative',cursive;margin:0 0 10px">${L("P.HistStats")}</h3>
      <table class="hist-table" style="width:100%;margin-bottom:18px">
        <thead><tr><th>${L("P.Player")}</th><th>${L("P.HistWon")}</th><th>${L("P.HistLost")}</th><th>${L("P.HistTotal")}</th></tr></thead>
        <tbody>${stats}</tbody>
      </table>
      <h3 style="color:#f0c040;font-family:'Cinzel Decorative',cursive;margin:0 0 10px">${L("P.HistRounds")}</h3>
      ${rows?`<table class="hist-table" style="width:100%">
        <thead><tr><th>${L("P.HistRound")}</th><th>${L("P.HistWinner")}</th><th>${L("P.Bank")}</th><th>${L("P.HistCombo")}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`:`<div style="color:#4a6a4a;font-style:italic;padding:10px">${L("P.HistoryEmpty")}</div>`}
    </div>`;
  }

  // ── Setup ──────────────────────────────────────────────────
  _renderSetup(){
    const stakes=getStakesConfig();
    setDisplayStakes(stakes);
    // chips mode works in any system — currency on the sheet not required
    const actors=isCurrencyMode(stakes)
      ?game.actors.filter(a=>a.system?.currency)
      :game.actors.contents;
    const users=game.users.filter(u=>!u.isGM&&u.active);
    const aopts=actors.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join("");
    const uopts=`<option value="">${L("Lobby.NpcManaged")}</option>`+
      users.map(u=>`<option value="${u.id}">${u.name}</option>`).join("");
    let slots="";
    for(let i=0;i<MAX_PLAYERS;i++){
      slots+=`<div class="setup-player">
        <label>${LF("Lobby.Seat",{n:i+1})}</label>
        <select id="asel-${i}"><option value="">${L("Lobby.Empty")}</option>${aopts}</select>
        <div class="setup-preview" id="aprev-${i}">—</div>
        <select id="usel-${i}" class="setup-user">${uopts}</select>
      </div>`;
    }
    const stakesInfo=isCurrencyMode(stakes)
      ?LF("P.StakesInfoCurrency",{cur:L(`CurName.${stakes.key}`)})
      :LF("P.StakesInfoChips",{n:stakes.stack});
    return `<div id="setup-area">
      <h2>${L("P.SetupTitle")}<span class="gm-badge">GM</span></h2>
      <div class="setup-hint">
        ${L("P.SetupHint2")}<br>
        <span style="color:#f0c040">${stakesInfo}</span> · ${L("P.SetupHint3")}
      </div>
      <div class="setup-players">${slots}</div>
      <div class="setup-blinds">
        <label>${L("P.SmallBlindLabel")}</label>
        <input type="text" id="sb-input" value="1" style="width:60px">
        <label style="margin-left:14px">${L("P.BigBlindLabel")}</label>
        <input type="text" id="bb-input" value="2" style="width:60px">
        <span class="hint" style="margin-left:10px">${L("P.BlindsHint")}</span>
      </div>
      <div class="btn-row">
        <button id="btn-settings" class="b sm">${L("P.SettingsBtn")}</button>
        <button id="btn-start" class="g" style="font-size:1.1em;padding:10px 32px">${L("P.StartGame")}</button>
      </div>
    </div>`;
  }

  _bindSetup(root){
    for(let i=0;i<MAX_PLAYERS;i++){
      const sel=root.querySelector(`#asel-${i}`);
      const prev=root.querySelector(`#aprev-${i}`);
      if(!sel||!prev)continue;
      const upd=()=>{
        const a=game.actors.get(sel.value);
        if(!a){prev.innerHTML="—";return;}
        const img=a.img&&!a.img.includes("mystery-man")?`<img src="${esc(a.img)}">`:"🧙";
        const stakes=getStakesConfig();
        const funds=isCurrencyMode(stakes)?getActorFunds(a,stakes):stakes.stack;
        prev.innerHTML=`${img} <span class="pp">${fmt(funds)}</span>`;
      };
      sel.addEventListener("change",upd);upd();
    }
    root.querySelector("#btn-settings")?.addEventListener("click",()=>{
      const menu=game.settings.menus.get(`${MODULE_ID}.pokerSettingsMenu`);
      if(menu)new menu.type().render(true);
    });
    root.querySelector("#btn-start")?.addEventListener("click",()=>{
      const players=[],used=new Set();
      for(let i=0;i<MAX_PLAYERS;i++){
        const actorId=root.querySelector(`#asel-${i}`)?.value;
        if(!actorId)continue;
        if(used.has(actorId)){ui.notifications.warn(LF("P.DupSeat",{n:i+1}));return;}
        used.add(actorId);
        players.push({actorId,userId:root.querySelector(`#usel-${i}`)?.value||""});
      }
      if(players.length<2){ui.notifications.warn(L("Lobby.MinTwoPlayers"));return;}
      const sb=parseFloat(root.querySelector("#sb-input")?.value)||1;
      const bb=parseFloat(root.querySelector("#bb-input")?.value)||2;
      window._pokerEmit?.("OPEN_POKER",{});
      new PokerGame().startGame({players,smallBlind:sb,bigBlind:bb});
    });
  }

  // ── Table with dealer button ──────────────────────────────
  _table(S,skin){
    const comm=S.community.length===0
      ?`<span style="color:#4a6a4a;font-size:.9em;letter-spacing:2px">${L("P.WaitFlop")}</span>`
      :S.community.map(c=>this._card(c,false,skin)).join("");
    const seats=S.players.map((p,i)=>this._seat(p,i,S,skin)).join("");
    return `<div id="table-area">
      <div id="table-label">${L("P.CommunityCards")}</div>
      <div id="community-area">${comm}</div>
      <div id="pot-display">💰 ${L("P.Bank")} <span class="pp">${fmt(S.pot)}</span>
        ${S.smallBlindAmt?`<span style="font-size:.75em;color:#7a9060;margin-left:12px">${LF("P.Blinds",{sb:fmt(S.smallBlindAmt),bb:fmt(S.bigBlindAmt)})}</span>`:""}
      </div>
      <div id="players-area">${seats}</div>
    </div>`;
  }

  _card(card,hidden,skin="classic"){
    if(hidden)return`<div class="poker-card back skin-${skin}"></div>`;
    const red=card.suit==="♥"||card.suit==="♦";
    return`<div class="poker-card ${red?"red":"black"}">
      <div class="p-rank">${card.rank}</div>
      <div class="p-suit">${card.suit}</div>
    </div>`;
  }

  _seat(p,i,S,skin){
    const bidx=this._bettorIdx(S);
    const isTurn=S.phase==="betting"&&bidx===i;
    const isMe=p.userId===game.user.id;
    const isNpc=!p.userId;
    const isDealer=i===S.dealerIdx;
    const isSB=i===((S.dealerIdx+1)%S.players.length);
    const isBB=i===((S.dealerIdx+2)%S.players.length);
    const toCall=Math.round((S.currentBetLevel-(p.roundBet||0))*100)/100;
    const needCall=!p.folded&&!p.allIn&&toCall>0&&!isTurn&&S.phase==="betting";

    let cls="player-seat";
    if(isTurn)cls+=" active";
    if(p.folded)cls+=" folded";
    if(p.isWinner)cls+=" winner";
    if(needCall)cls+=" ncall";
    if(isMe&&!p.folded&&!p.isWinner)cls+=" is-me";
    if(isNpc)cls+=" is-npc";

    const showCards=game.user.isGM||isMe||S.phase==="showdown";
    const actor=p.actorId?game.actors.get(p.actorId):null;
    const av=actor?.img&&!actor.img.includes("mystery-man")
      ?`<img class="player-avatar" src="${esc(actor.img)}">`
      :`<div class="player-av-ph">🧙</div>`;
    const userObj=p.userId?game.users.get(p.userId):null;
    const userTag=userObj
      ?`<div class="player-tag">👤 ${esc(userObj.name)}</div>`
      :`<div class="player-tag" style="color:#ffb840">🤖 NPC</div>`;

    // Dealer/blind badges
    const badges=[
      isDealer?`<span class="dealer-chip">D</span>`:"",
      isSB?`<span class="blind-chip sb">SB</span>`:"",
      isBB?`<span class="blind-chip bb">BB</span>`:"",
      isNpc?`<span class="npc-badge">NPC</span>`:"",
    ].join("");

    const npcControls=(game.user.isGM&&isNpc&&isTurn&&S.phase==="betting")?`<div class="npc-controls">
      ${toCall>0
        ?`<button class="npc-act p" data-idx="${i}" data-act="call">${L("P.Call")}</button>`
        :`<button class="npc-act" data-idx="${i}" data-act="check">${L("P.Check")}</button>`}
      <button class="npc-act g" data-idx="${i}" data-act="allin">🔥 All-in</button>
      <button class="npc-act r" data-idx="${i}" data-act="fold">${L("P.FoldBtn")}</button>
    </div>`:"";

    return`<div class="${cls}">
      <div class="player-header">${av}
        <div class="player-info">
          <div class="player-name">${esc(p.name)}${isMe?'<span style="font-size:.6em;color:#4090ff"> ◀</span>':""} ${badges}</div>
          ${userTag}
        </div>
      </div>
      <div class="player-status">${p.folded?L("P.Fold"):p.allIn?"🔥 All-In":L("P.InGame")}&nbsp;|&nbsp;<span class="pp">${fmt(p.platinum)}</span></div>
      ${p.currentBet>0?`<div class="player-bets">${L("P.Placed")} <span class="pp">${fmt(p.currentBet)}</span></div>`:""}
      ${p.roundBet>0?`<div class="player-bets">${L("P.RoundBet")} <span class="pp">${fmt(p.roundBet)}</span></div>`:""}
      ${needCall?`<div class="player-ncall">${LF("P.ToCall",{n:fmt(toCall)})}</div>`:""}
      ${p.handRank&&S.phase==="showdown"?`<div class="player-bets" style="color:#80ff80">🃏 ${p.handRank}</div>`:""}
      <div class="hand-cards">${p.hand.map(c=>this._card(c,!showCards,skin)).join("")}</div>
      ${npcControls}
    </div>`;
  }

  _sidebar(){
    return`<div id="combo-guide"><h3>${L("P.CombosHeader")}</h3>
      ${COMBOS().map(c=>`<div class="combo-item">
        <div class="combo-rank">${c.r}</div>
        <div><div class="combo-name">${c.n}</div><div class="combo-desc">${c.d}</div></div>
      </div>`).join("")}
    </div>`;
  }

  _controls(S,myIdx,myP,bidx,isMyTurn){
    const isGM=game.user.isGM;
    let h="";
    if(S.phase==="showdown"){
      if(isGM)h=`<div class="btn-row">
        <button id="btn-newgame">${L("P.NewGame")}</button>
        <button id="btn-newround" class="g">${L("P.OneMoreRound")}</button>
        <button id="btn-settings" class="b sm">${L("P.SettingsBtn")}</button>
      </div>`;
      else h=`<div class="hint" style="padding:8px">${L("P.WaitingGM")}</div>`;
    } else if(S.phase==="betting"){
      const curP=bidx!==null?S.players[bidx]:null;
      if(curP)h+=`<div id="turn-bar">${L("P.Turn")} <strong>${esc(curP.name)}</strong>&nbsp;|&nbsp;<span class="pp">${fmt(curP.platinum)}</span></div>`;
      if(isMyTurn&&myIdx>=0){
        const toCall=Math.round((S.currentBetLevel-(myP.roundBet||0))*100)/100;
        if(toCall>0)h+=`<div id="call-hint">${L("P.NeedCall")} <span class="pp">${fmt(toCall)}</span></div>`;
        h+=`<div class="bet-row">
          <label>${L("P.BetLabel")}</label>
          <input type="text" id="bet-input" placeholder="${toCall>0?LF("P.MinBet",{n:toCall}):L("P.ExampleBet")}">
          <span class="hint">${L("P.PlatinumHint")}</span>
        </div>
        <div class="btn-row">
          ${toCall===0
            ?`<button id="btn-check">${L("P.Check")}</button>`
            :`<button id="btn-call" class="p">${LF("P.CallBtn",{n:fmt(toCall)})}</button>`}
          <button id="btn-raise" class="g">${L("P.RaiseBtn")}</button>
          <button id="btn-allin" class="o">🔥 All-In</button>
          <button id="btn-fold"  class="r">${L("P.FoldBtn")}</button>
        </div>`;
      } else if(!isGM&&myP&&!myP.folded){
        h+=`<div class="hint" style="padding:6px">${LF("P.WaitTurn",{name:curP?.name??"..."})}</div>`;
      }
      if(isGM)h+=`<div class="btn-row">
        <button id="btn-skip-bet" class="b">${L("P.FinishBetting")}</button>
        <button id="btn-settings" class="b sm">⚙</button>
      </div>`;
    } else {
      if(isGM){
        h+=`<div class="btn-row">`;
        if(S.phase==="preflop") h+=`<button id="btn-flop">${L("P.ToFlop")}</button>`;
        if(S.phase==="flop")    h+=`<button id="btn-turn">${L("P.ToTurn")}</button>`;
        if(S.phase==="turn")    h+=`<button id="btn-river">${L("P.ToRiver")}</button>`;
        if(S.phase==="river")   h+=`<button id="btn-showdown" class="g">${L("P.Showdown")}</button>`;
        h+=`<button id="btn-settings" class="b sm">⚙</button></div>`;
      } else {
        h+=`<div class="hint" style="padding:8px">${L("P.WaitingGM")}</div>`;
      }
    }
    return h;
  }

  _bindTabs(root){
    root.querySelectorAll(".ptab").forEach(tab=>{
      tab.addEventListener("click",()=>{
        this._tab=tab.dataset.tab;
        this._rerender();
      });
    });
  }

  _bindGame(root,S,myIdx,isMyTurn){
    const isGM=game.user.isGM;
    const g=window._pokerGame;
    root.querySelector("#btn-settings")?.addEventListener("click",()=>{
      const menu=game.settings.menus.get(`${MODULE_ID}.pokerSettingsMenu`);
      if(menu)new menu.type().render(true);
    });
    const send=(action,data)=>{
      if(isGM&&g){
        if(action==="POKER_REQ_BET")g.handleBet(data);
        else if(action==="POKER_REQ_FOLD")g.handleFold(data);
      } else window._pokerEmit?.(action,data);
    };
    if(isMyTurn){
      root.querySelector("#btn-check")?.addEventListener("click",()=>send("POKER_REQ_BET",{playerIdx:myIdx,amount:0}));
      root.querySelector("#btn-call")?.addEventListener("click",()=>{
        const toCall=Math.round((S.currentBetLevel-(S.players[myIdx].roundBet||0))*100)/100;
        send("POKER_REQ_BET",{playerIdx:myIdx,amount:toCall});
      });
      root.querySelector("#btn-raise")?.addEventListener("click",()=>{
        const val=parseFloat(root.querySelector("#bet-input")?.value?.trim());
        if(isNaN(val)||val<=0){ui.notifications.warn(L("P.EnterBet"));return;}
        send("POKER_REQ_BET",{playerIdx:myIdx,amount:val});
      });
      root.querySelector("#btn-allin")?.addEventListener("click",()=>{
        const pl=S.players[myIdx];
        if(!pl||pl.platinum<=0)return;
        send("POKER_REQ_BET",{playerIdx:myIdx,amount:pl.platinum});
      });
      root.querySelector("#btn-fold")?.addEventListener("click",()=>send("POKER_REQ_FOLD",{playerIdx:myIdx}));
      root.querySelector("#bet-input")?.addEventListener("keydown",e=>{if(e.key==="Enter")root.querySelector("#btn-raise")?.click();});
    }
    if(isGM&&g){
      root.querySelectorAll(".npc-act").forEach(btn=>{
        btn.addEventListener("click",()=>{
          const idx=parseInt(btn.dataset.idx);
          const act=btn.dataset.act;
          const npcP=S.players[idx];
          if(!npcP)return;
          if(act==="check")g.handleBet({playerIdx:idx,amount:0});
          else if(act==="call"){const tc=Math.round((S.currentBetLevel-(npcP.roundBet||0))*100)/100;g.handleBet({playerIdx:idx,amount:tc});}
          else if(act==="allin")g.handleBet({playerIdx:idx,amount:npcP.platinum});
          else if(act==="fold")g.handleFold({playerIdx:idx});
        });
      });
      const gm=(sel,fn)=>root.querySelector(sel)?.addEventListener("click",fn);
      gm("#btn-flop",    ()=>{window._pokerEmit?.("POKER_REQ_PHASE",{next:"flop"});   g.startBettingRound("flop");});
      gm("#btn-turn",    ()=>{window._pokerEmit?.("POKER_REQ_PHASE",{next:"turn"});   g.startBettingRound("turn");});
      gm("#btn-river",   ()=>{window._pokerEmit?.("POKER_REQ_PHASE",{next:"river"});  g.startBettingRound("river");});
      gm("#btn-showdown",()=>{window._pokerEmit?.("POKER_REQ_SHOWDOWN",{});           g.doShowdown();});
      gm("#btn-skip-bet",()=>{window._pokerEmit?.("POKER_REQ_SKIPBET",{});           g.finishBettingRound();});
      gm("#btn-newround", ()=>{window._pokerEmit?.("POKER_REQ_NEWROUND",{});          g.startRound();});
      gm("#btn-newgame",  ()=>{window._pokerEmit?.("POKER_REQ_NEWGAME",{});           g.resetToSetup();});
    }
  }

  _bettorIdx(S){
    if(!S.bettingOrder?.length)return null;
    return S.bettingOrder[S.bettingIdx%S.bettingOrder.length]??null;
  }
  _pl(ph){
    return({preflop:"Pre-Flop",flop:"Flop",turn:"Turn",river:"River",
            showdown:"Showdown",betting:L("P.PhaseBetting"),setup:L("P.PhasePrep")})[ph]||ph;
  }
}
