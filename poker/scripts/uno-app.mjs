// ============================================================
// Card Games VTT — scripts/uno-app.mjs
// ============================================================

import { UnoGame, unoInitialState, canPlayUno, canPlayUnoFull, UNO_RULE_IDS } from "./uno-game.mjs";
import { PokerSettings }                        from "./poker-settings.mjs";

const MODULE_ID = "poker-table-vtt";
const COLORS    = ["red","yellow","green","blue"];
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

// Локализация: ключи POKER.* в lang/ru.json и lang/en.json
const L  = (k)    => game.i18n.localize(`POKER.${k}`);
const LF = (k, d) => game.i18n.format(`POKER.${k}`, d);

export class UnoApp extends foundry.applications.api.ApplicationV2 {
  constructor() {
    super();
    this._S = unoInitialState();
    this._showOthersCards = true;
    window._unoApp = this;
  }

  static DEFAULT_OPTIONS = {
    id: "uno-app",
    window: { title: "🎴 UNO", resizable: true },
    position: { width: 1920, height: 1080 },
    classes: ["poker-dialog"],
  };

  onStateUpdate(state) {
    this._S = state;
    if (this._root()) this._draw();
    else this._pendingDraw = true;
  }

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
    if (this._pendingDraw) { this._pendingDraw = false; }
    this._draw();
  }

  _root() { return this.element?.querySelector("#poker-root") ?? null; }

  _draw() {
    const root = this._root(); if (!root) return;
    const S    = this._S;
    const skin = PokerSettings.getCardSkin();
    const isGM = game.user.isGM;

    if (S.phase === "setup") {
      root.innerHTML = `<div class="wait-screen">
        <div class="wt">🎴 UNO 🎴</div>
        <div class="ws">${L("UNO.WaitingGM")}</div>
        <div class="wait-spin">🎴</div></div>`;
      return;
    }

    // Find current user's seat
    let myIdx = S.players.findIndex(p => p.userId === game.user.id);
    if (myIdx < 0 && !isGM) {
      const unassigned  = S.players.filter(p => !p.userId);
      const activeNonGM = game.users.filter(u => !u.isGM && u.active);
      if (unassigned.length === 1 && activeNonGM.length === 1 && activeNonGM[0].id === game.user.id)
        myIdx = S.players.findIndex(p => !p.userId);
    }

    const top = S.discard[S.discard.length - 1] || null;
    const isMyTurn = myIdx === S.activeIdx;
    const needColor = S.phase === "needColor";
    const waitingForColorFromMe = needColor && S.pendingWildBy === myIdx;
    const R = S.rules || {};
    const pending = S.pendingDraw || 0;

    // Top card + color indicator
    const topCardHTML = top ? `
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
        ${this._unoCard(top, false)}
        <div class="uno-color-pill uno-pill-${S.topColor}">${this._colorRu(S.topColor)}</div>
      </div>` : `<div style="color:#4a6a4a">${L("UNO.EmptyDeck")}</div>`;

    const deckHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
        <div class="uno-card-back" id="uno-deck-card" title="${L("UNO.DrawCard")}">🎴</div>
        <div style="color:#a0c870;font-size:.85em">${LF("UNO.DeckLabel",{n:S.deck.length})}</div>
      </div>`;

    const dirArrow = S.direction === 1
      ? `<div class="uno-dir">${L("UNO.Clockwise")}</div>`
      : `<div class="uno-dir">${L("UNO.CounterCw")}</div>`;

    const visToggle = isGM ? `
      <div style="margin-top:10px;padding:6px 0;border-top:1px solid #2a4020">
        <label style="font-size:.8em;color:#7a9060;cursor:pointer;display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="uno-show-others" ${this._showOthersCards ? "checked" : ""}>
          <span>${L("UNO.ShowOthers")}</span>
        </label>
      </div>` : "";

    // Players
    const players = S.players.map((p, i) => {
      const isMeP  = p.userId === game.user.id || i === myIdx;
      const isNPC  = !p.userId;
      let showHand;
      if      (S.phase === "gameover") showHand = true;
      else if (isMeP)                  showHand = true;
      else if (isGM)                   showHand = isNPC || this._showOthersCards;
      else                             showHand = false;

      const isActive = i === S.activeIdx;
      const actor    = p.actorId ? game.actors.get(p.actorId) : null;
      const av       = actor?.img && !actor.img.includes("mystery-man")
        ? `<img class="player-avatar" src="${esc(actor.img)}">`
        : `<div class="player-av-ph">🎴</div>`;
      const userObj  = p.userId ? game.users.get(p.userId) : null;

      let cls = "player-seat";
      if (isActive)                                           cls += " active";
      if (isMeP)                                              cls += " is-me";
      if (S.phase === "gameover" && p.name === S.winner)      cls += " winner";

      // Hand rendering
      const mineOrMyNpc = isMeP || (isGM && isNPC);
      const handHTML = p.hand.map((c, ci) => {
        // Active player on their seat (or NPC controlled by GM)
        const canPlayHere = mineOrMyNpc && isActive && S.phase === "playing" && showHand;
        const playable = canPlayHere && canPlayUnoFull(c, S);
        // Jump-in / Kill-Stop: out-of-turn play on a clean table
        const outTurnOk = !isActive && mineOrMyNpc && showHand
          && S.phase === "playing" && pending === 0 && !S.challenge
          && S.pendingWildBy < 0 && (S.swapBy ?? -1) < 0
          && top && c.color !== "wild"
          && ((R.jumpIn && c.color === top.color && c.value === top.value)
           || (R.killStop && c.value === top.value && top.color !== "wild"));

        if (!showHand) return this._unoCardBack();
        let extra = "";
        if (canPlayHere) extra = playable ? " uno-playable" : " uno-unplayable";
        else if (outTurnOk) extra = " uno-playable";
        return this._unoCard(c, false, ci, i, extra);
      }).join("");

      // UNO badge: when player has 1 card and said it (hidden under Silent UNO)
      const unoBadge = (p.hand.length === 1 && !R.silentUno)
        ? (p.saidUno
            ? `<span class="npc-badge uno-said">🔊 UNO!</span>`
            : `<span class="npc-badge uno-missed" title="${L("UNO.MissedUnoTip")}">${L("UNO.MissedUno")}</span>`)
        : "";

      // UNO! button for THIS seat: visible if player has 1-2 cards and hasn't said it.
      // Available to: the seat owner (themselves) OR GM (for NPCs or to help)
      const canSayUno = !R.silentUno
        && (p.hand.length === 1 || p.hand.length === 2)
        && !p.saidUno
        && S.phase !== "gameover"
        && (isMeP || (isGM && isNPC));
      const sayUnoBtn = canSayUno
        ? `<button class="uno-say-btn o sm" data-pidx="${i}" title="${L("UNO.SayUnoTip")}">🔊 UNO!</button>`
        : "";

      // Catch button: visible to OTHERS when this player has 1 card and didn't say UNO.
      // Самому себя ловить нельзя. Under Silent UNO catching is off.
      const canCatch = !R.silentUno
        && p.hand.length === 1 && !p.saidUno
        && i !== myIdx
        && S.phase === "playing";
      const catchBtn = canCatch
        ? `<button class="uno-catch r sm" data-target="${i}">${L("UNO.Catch")}</button>`
        : "";

      // Voluntary quit (rule quitting): own seat, during play
      const quitBtn = (R.quitting && isMeP && (S.phase === "playing" || S.phase === "needColor") && S.players.length > 2)
        ? `<button class="uno-quit sm" data-pidx="${i}" title="${L("UNO.QuitTip")}">🚪 ${L("UNO.Quit")}</button>`
        : "";

      return `<div class="${cls}">
        <div class="player-header">${av}
          <div class="player-info">
            <div class="player-name">${esc(p.name)}
              ${isActive ? `<span class="npc-badge" style="background:rgba(0,150,0,.3);border-color:#009900;color:#80ff80">${L("UNO.TurnBadge")}</span>` : ""}
              ${unoBadge}
              ${S.phase === "gameover" && p.name === S.winner ? `<span class="gm-badge" style="background:rgba(0,200,80,.3);border-color:#30aa30;color:#80ff80">${L("UNO.WinBadge")}</span>` : ""}
            </div>
            ${userObj ? `<div class="player-tag">👤 ${esc(userObj.name)}</div>`
                      : `<div class="player-tag" style="color:#ffb840">🤖 NPC</div>`}
          </div>
        </div>
        <div class="player-status">${LF("UNO.CardsN",{n:p.hand.length})} ${sayUnoBtn} ${catchBtn} ${quitBtn}</div>
        <div class="hand-cards">${handHTML}</div>
        ${isGM && isNPC && i === S.activeIdx && S.phase === "playing" ? this._npcControls(i) : ""}
      </div>`;
    }).join("");

    // Color picker overlay (for player who just played a wild)
    const colorPicker = waitingForColorFromMe || (isGM && needColor) ? `
      <div class="uno-color-picker">
        <div class="uno-color-picker-title">${L("UNO.PickColorTitle")}</div>
        <div class="uno-color-picker-grid">
          ${COLORS.map(c => `<button class="uno-color-btn uno-pill-${c}" data-color="${c}" data-pidx="${S.pendingWildBy}">${this._colorRu(c)}</button>`).join("")}
        </div>
      </div>` : "";

    // Swap target picker (7-0 rule, for the player who played a 7)
    const swapMine = S.phase === "needSwap"
      && (S.swapBy === myIdx || (isGM && !S.players[S.swapBy]?.userId));
    const swapPicker = swapMine ? `
      <div class="uno-color-picker">
        <div class="uno-color-picker-title">${L("UNO.PickSwapTitle")}</div>
        <div class="uno-color-picker-grid">
          ${S.players.map((q, qi) => qi === S.swapBy ? "" :
            `<button class="uno-color-btn uno-swap-btn" data-target="${qi}" data-pidx="${S.swapBy}"
              style="background:#1a3a5c;border-color:#4080c0">${esc(q.name)} (${q.hand.length})</button>`).join("")}
        </div>
      </div>` : "";

    // +2/+4 stack banner
    const stackBanner = pending > 0 && S.phase === "playing" ? `
      <div style="text-align:center;margin-top:8px">
        <span style="background:rgba(200,40,40,.25);border:1px solid #c04040;border-radius:8px;
          padding:4px 14px;color:#ff9090;font-size:1.05em">
          ${LF("UNO.StackBanner",{n:pending,name:esc(S.players[S.activeIdx]?.name ?? "")})}
        </span>
      </div>` : "";

    const banner = S.phase === "gameover"
      ? `<div id="result-banner" style="display:block">${LF("UNO.WinnerBanner",{name:esc(S.winner)})}</div>` : "";

    root.innerHTML = `
      <div id="poker-title">🎴 UNO 🎴${isGM ? '<span class="gm-badge">GM</span>' : ""}</div>
      <div id="poker-body">
        <div id="combo-guide" style="width:170px">
          <h3>${L("BJ.Rules")}</h3>
          <div class="combo-item"><div class="combo-rank">▶</div><div><div class="combo-name">${L("UNO.PhasePlay")}</div><div class="combo-desc">${L("UNO.RulePlay")}</div></div></div>
          <div class="combo-item"><div class="combo-rank">⏭</div><div><div class="combo-name">Skip</div><div class="combo-desc">${L("UNO.RuleSkip")}</div></div></div>
          <div class="combo-item"><div class="combo-rank">🔄</div><div><div class="combo-name">Reverse</div><div class="combo-desc">${L("UNO.RuleReverse")}</div></div></div>
          <div class="combo-item"><div class="combo-rank">+2</div><div><div class="combo-name">Draw 2</div><div class="combo-desc">${L("UNO.RuleDraw2")}</div></div></div>
          <div class="combo-item"><div class="combo-rank">★</div><div><div class="combo-name">Wild</div><div class="combo-desc">${L("UNO.RuleWild")}</div></div></div>
          <div class="combo-item"><div class="combo-rank">+4</div><div><div class="combo-name">Wild+4</div><div class="combo-desc">${L("UNO.RuleWild4")}</div></div></div>
          <div class="combo-item"><div class="combo-rank">🔊</div><div><div class="combo-name">UNO!</div><div class="combo-desc">${L("UNO.RuleUno")}</div></div></div>
          ${this._activeRulesHTML(R)}
          ${visToggle}
        </div>
        <div id="poker-main">
          ${banner}
          <div id="table-area" style="min-height:200px;margin-bottom:10px">
            <div id="table-label">${L("DK.TableLabel")} ${dirArrow}</div>
            <div class="uno-table">
              ${deckHTML}
              ${topCardHTML}
            </div>
            ${stackBanner}
            ${colorPicker}
            ${swapPicker}
          </div>
          <div id="players-area">${players}</div>
        </div>
      </div>
      <div id="controls">${this._controls(S, myIdx, isMyTurn, isGM)}</div>
      <div id="log-area">${S.log.slice(0,25).map(l=>`<div>${esc(l)}</div>`).join("")}</div>
    `;
    this._bind(root, S, myIdx, isMyTurn, isGM);
  }

  // Render a UNO card face
  _unoCard(card, _hidden = false, cardIdx = -1, playerIdx = -1, extra = "") {
    const symbols = {
      "0":"0","1":"1","2":"2","3":"3","4":"4","5":"5","6":"6","7":"7","8":"8","9":"9",
      "skip":"⏭","reverse":"🔄","draw2":"+2","wild":"★","wild4":"+4",
    };
    const sym = symbols[card.value] ?? card.value;
    const colorCls = `uno-${card.color}`;
    const dataAttrs = cardIdx >= 0
      ? `data-cidx="${cardIdx}" data-pidx="${playerIdx}"`
      : "";
    return `<div class="uno-card ${colorCls}${extra}" ${dataAttrs}>
      <div class="uno-corner uno-tl">${sym}</div>
      <div class="uno-center">${sym}</div>
      <div class="uno-corner uno-br">${sym}</div>
    </div>`;
  }

  _unoCardBack() {
    return `<div class="uno-card uno-back"><div class="uno-center uno-logo">UNO</div></div>`;
  }

  _colorRu(c) {
    return { red:L("UNO.Red"), yellow:L("UNO.Yellow"), green:L("UNO.Green"), blue:L("UNO.Blue") }[c] ?? c;
  }

  // Sidebar block listing the table's active house rules
  _activeRulesHTML(R) {
    const on = UNO_RULE_IDS.filter(id => R[id]);
    if (!on.length) return "";
    return `<div style="margin-top:10px;padding:6px 0;border-top:1px solid #2a4020">
      <div style="font-size:.8em;color:#f0c040;margin-bottom:4px">🏠 ${L("UNO.HomeRulesHeader")}</div>
      ${on.map(id => `<div style="font-size:.75em;color:#a0c870;line-height:1.5" title="${L(`UnoRuleDesc.${id}`)}">• ${L(`UnoRule.${id}`)}</div>`).join("")}
    </div>`;
  }

  _npcControls(playerIdx) {
    return `<div class="npc-controls">
      <button class="npc-act b sm" data-act="draw" data-idx="${playerIdx}">${L("UNO.NpcDraw")}</button>
    </div>`;
  }

  _controls(S, myIdx, isMyTurn, isGM) {
    if (S.phase === "gameover") {
      if (!isGM) return `<div class="hint" style="padding:8px">${L("UNO.GameOver")}</div>`;
      return `<div class="btn-row">
        <button id="unobtn-rematch" class="g" style="font-size:1.05em;padding:10px 24px">${L("UNO.RematchBtn")}</button>
        <button id="unobtn-newgame" class="b">${L("DK.NewGameBtn")}</button>
        <button id="unobtn-lobby">${L("DK.ChangeGameBtn")}</button>
      </div>`;
    }

    if (S.phase === "needColor") {
      if (S.pendingWildBy === myIdx) {
        return `<div class="hint" style="padding:8px;color:#ffcc40">${L("UNO.PickColor")}</div>`;
      }
      if (isGM) {
        return `<div class="hint" style="padding:8px;color:#ffcc40">${LF("UNO.PickColorNpc",{name:esc(S.players[S.pendingWildBy]?.name)})}</div>`;
      }
      return `<div class="hint" style="padding:8px">${LF("UNO.WaitColor",{name:esc(S.players[S.pendingWildBy]?.name)})}</div>`;
    }

    // 7-rule: waiting for swap target
    if (S.phase === "needSwap") {
      const by = S.players[S.swapBy];
      if (S.swapBy === myIdx || (isGM && by && !by.userId)) {
        return `<div class="hint" style="padding:8px;color:#ffcc40">${L("UNO.PickSwap")}</div>`;
      }
      return `<div class="hint" style="padding:8px">${LF("UNO.WaitSwap",{name:esc(by?.name ?? "...")})}</div>`;
    }

    // Wild+4 bluff challenge: the victim decides
    if (S.phase === "challenge" && S.challenge) {
      const victim = S.players[S.challenge.victim];
      const by     = S.players[S.challenge.by];
      const canAct = S.challenge.victim === myIdx || (isGM && victim && !victim.userId);
      if (canAct) {
        return `<div id="turn-bar">${LF("UNO.ChallengeAsk",{name:esc(by?.name ?? "?")})}</div>
          <div class="btn-row">
            <button id="unobtn-challenge" class="r">${L("UNO.ChallengeBtn")}</button>
            <button id="unobtn-take4" class="b">${L("UNO.Take4Btn")}</button>
          </div>`;
      }
      return `<div class="hint" style="padding:8px">${LF("UNO.WaitChallenge",{name:esc(victim?.name ?? "...")})}</div>`;
    }

    const pending = S.pendingDraw || 0;
    let h = "";
    if (isMyTurn) {
      h += `<div class="btn-row">
        <button id="unobtn-draw" class="b">${pending > 0 ? LF("UNO.TakeNBtn",{n:pending}) : L("UNO.DrawBtn")}</button>
      </div>`;
      h += `<div class="hint" style="padding:4px">${pending > 0 ? L("UNO.HintStack") : L("UNO.HintPlay")}</div>`;
    } else {
      const act = S.players[S.activeIdx];
      h = `<div class="hint" style="padding:8px">${LF("UNO.Turn",{name:esc(act?.name ?? "...")})}</div>`;
    }
    return h;
  }

  _bind(root, S, myIdx, isMyTurn, isGM) {
    const g    = window._unoGame;
    const send = (action, data) => {
      if (isGM && g) {
        if      (action === "UNO_REQ_PLAY")      g.playCard(data);
        else if (action === "UNO_REQ_DRAW")      g.drawCard(data);
        else if (action === "UNO_REQ_COLOR")     g.chooseColor(data);
        else if (action === "UNO_REQ_UNO")       g.sayUno(data);
        else if (action === "UNO_REQ_CATCH")     g.catchUno(data);
        else if (action === "UNO_REQ_SWAP")      g.swapHands(data);
        else if (action === "UNO_REQ_CHALLENGE") g.challengeWild4(data);
        else if (action === "UNO_REQ_QUIT")      g.quitGame(data);
      } else {
        window._pokerEmit?.(action, data);
      }
    };

    // Toggle visibility of others' cards
    root.querySelector("#uno-show-others")?.addEventListener("change", e => {
      this._showOthersCards = e.target.checked; this._draw();
    });

    // Click on hand card → play. Shift+клик — сыграть две одинаковые цифры (rule twoCards)
    root.querySelectorAll(".uno-card[data-cidx]").forEach(cardEl => {
      cardEl.addEventListener("click", (ev) => {
        const pidx = parseInt(cardEl.dataset.pidx);
        const cidx = parseInt(cardEl.dataset.cidx);
        if (cardEl.classList.contains("uno-unplayable")) {
          ui.notifications?.warn(L("UNO.CantPlay"));
          return;
        }
        if (!cardEl.classList.contains("uno-playable")) return;
        const data = { playerIdx: pidx, cardIdx: cidx };
        if (ev.shiftKey && S.rules?.twoCards) {
          const hand = S.players[pidx]?.hand ?? [];
          const card = hand[cidx];
          if (card && "0123456789".includes(card.value)) {
            const secondIdx = hand.findIndex((c, i2) => i2 !== cidx && c.value === card.value);
            if (secondIdx >= 0) data.secondIdx = secondIdx;
            else ui.notifications?.warn(L("UNO.NoSecondCard"));
          }
        }
        send("UNO_REQ_PLAY", data);
      });
    });

    // Swap target buttons (7-0 rule)
    root.querySelectorAll(".uno-swap-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        send("UNO_REQ_SWAP", { playerIdx: parseInt(btn.dataset.pidx), targetIdx: parseInt(btn.dataset.target) });
      });
    });

    // Wild+4 challenge buttons
    root.querySelector("#unobtn-challenge")?.addEventListener("click", () => {
      send("UNO_REQ_CHALLENGE", { playerIdx: S.challenge?.victim, doChallenge: true });
    });
    root.querySelector("#unobtn-take4")?.addEventListener("click", () => {
      send("UNO_REQ_CHALLENGE", { playerIdx: S.challenge?.victim, doChallenge: false });
    });

    // Voluntary quit
    root.querySelectorAll(".uno-quit").forEach(btn => {
      btn.addEventListener("click", async () => {
        const pidx = parseInt(btn.dataset.pidx);
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: "UNO" },
          content: `<p>${L("UNO.QuitConfirm")}</p>`,
        }).catch(() => false);
        if (ok) send("UNO_REQ_QUIT", { playerIdx: pidx });
      });
    });

    // Click on deck → draw
    root.querySelector("#uno-deck-card")?.addEventListener("click", () => {
      if (S.phase !== "playing") return;
      // If GM is acting on behalf of NPC, allow drawing for active NPC
      const activeP = S.players[S.activeIdx];
      const activeIsNPC = activeP && !activeP.userId;
      if (isMyTurn) {
        send("UNO_REQ_DRAW", { playerIdx: myIdx });
      } else if (isGM && activeIsNPC) {
        send("UNO_REQ_DRAW", { playerIdx: S.activeIdx });
      }
    });

    // Color picker buttons
    root.querySelectorAll(".uno-color-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const color = btn.dataset.color;
        const pidx  = parseInt(btn.dataset.pidx);
        send("UNO_REQ_COLOR", { playerIdx: pidx, color });
      });
    });

    // UNO! buttons — one per applicable seat (own seat or NPC for GM)
    root.querySelectorAll(".uno-say-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const pidx = parseInt(btn.dataset.pidx);
        send("UNO_REQ_UNO", { playerIdx: pidx });
      });
    });

    // Catch buttons
    root.querySelectorAll(".uno-catch").forEach(btn => {
      btn.addEventListener("click", () => {
        const target = parseInt(btn.dataset.target);
        const catcher = myIdx >= 0 ? myIdx : -1;
        send("UNO_REQ_CATCH", { targetIdx: target, catcherIdx: catcher });
      });
    });

    // Draw button for me
    root.querySelector("#unobtn-draw")?.addEventListener("click", () => {
      send("UNO_REQ_DRAW", { playerIdx: myIdx });
    });

    // NPC controls (GM only)
    if (isGM && g) {
      root.querySelectorAll(".npc-act").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.idx);
          if (btn.dataset.act === "draw") g.drawCard({ playerIdx: idx });
        });
      });
    }

    // Endgame buttons
    root.querySelector("#unobtn-rematch")?.addEventListener("click", () => {
      if (isGM && g) { window._pokerEmit?.("UNO_REQ_REMATCH", {}); g.rematch(); }
    });
    root.querySelector("#unobtn-newgame")?.addEventListener("click", () => {
      if (isGM && g) { window._pokerEmit?.("UNO_REQ_NEWGAME", {}); g.resetToSetup(); }
    });
    root.querySelector("#unobtn-lobby")?.addEventListener("click", () => {
      window._pokerEmit?.("OPEN_LOBBY", {}); window._openLobby?.();
    });
  }
}
