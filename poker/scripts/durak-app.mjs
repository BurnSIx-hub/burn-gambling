// ============================================================
// Card Games VTT — scripts/durak-app.mjs
// ============================================================

import { DurakGame, durakInitialState } from "./durak-game.mjs";
import { PokerSettings }                from "./poker-settings.mjs";

const MODULE_ID = "poker-table-vtt";
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

// Локализация: ключи POKER.* в lang/ru.json и lang/en.json
const L  = (k)    => game.i18n.localize(`POKER.${k}`);
const LF = (k, d) => game.i18n.format(`POKER.${k}`, d);

export class DurakApp extends foundry.applications.api.ApplicationV2 {
  constructor() {
    super();
    this._S = durakInitialState();
    this._showOthersCards = true;
    window._durakApp = this;
  }

  static DEFAULT_OPTIONS = {
    id: "durak-app",
    window: { title: "POKER.DK.Title", resizable: true },
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
        <div class="wt">${L("DK.WaitTitle")}</div>
        <div class="ws">${L("BJ.WaitStart")}</div>
        <div class="wait-spin">🃏</div></div>`;
      return;
    }

    const isPerevodny = S.variant === "perevodny";
    const titleName   = isPerevodny ? L("DK.PerevTitle") : L("DK.PodkidTitle");

    let myIdx = S.players.findIndex(p => p.userId === game.user.id);
    if (myIdx < 0 && !isGM) {
      const unassigned  = S.players.filter(p => !p.userId);
      const activeNonGM = game.users.filter(u => !u.isGM && u.active);
      if (unassigned.length === 1 && activeNonGM.length === 1 && activeNonGM[0].id === game.user.id)
        myIdx = S.players.findIndex(p => !p.userId);
    }
    const isAttacker = myIdx === S.attackerIdx;
    const isDefender = myIdx === S.defenderIdx;
    const isTranslator = (S.translators ?? []).includes(myIdx);

    const trumpHTML = S.trump ? `
      <div style="text-align:center;margin-bottom:8px">
        <span style="color:#c8a050;font-size:.9em">${L("DK.TrumpLabel")}</span>
        ${this._card(S.trump, false, skin)}
        <span style="font-size:1.4em">${S.trumpSuit}</span>
      </div>` : "";

    const deckHTML = `<div style="text-align:center;color:#a0c870;font-size:.9em;margin-bottom:6px">
      ${LF("DK.DeckCount",{n:S.deck.length})}</div>`;

    const visToggle = isGM ? `
      <div style="margin-top:10px;padding:6px 0;border-top:1px solid #2a4020">
        <label style="font-size:.8em;color:#7a9060;cursor:pointer;display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="dk-show-others" ${this._showOthersCards ? "checked" : ""}>
          <span>${L("DK.ShowOthers")}</span>
        </label>
      </div>` : "";

    const rulesExtra = isPerevodny
      ? `<div class="combo-item"><div class="combo-rank">↩</div><div><div class="combo-name">${L("DK.RuleTranslateName")}</div><div class="combo-desc">${L("DK.RuleTranslateDesc")}</div></div></div>`
      : `<div class="combo-item"><div class="combo-rank">+</div><div><div class="combo-name">${L("DK.RuleThrowName")}</div><div class="combo-desc">${L("DK.RuleThrowDesc")}</div></div></div>`;

    const tableCards = S.table.length === 0
      ? `<div style="color:#4a6a4a;font-size:.85em;letter-spacing:2px">${L("DK.EmptyTable")}</div>`
      : S.table.map((slot, ti) => `
          <div class="durak-slot">
            ${this._card(slot.attack, false, skin)}
            ${slot.defense
              ? `<div class="durak-def-arrow">▼</div>${this._card(slot.defense, false, skin)}`
              : (isDefender ? `<div class="hint" style="font-size:11px;margin-top:4px">${L("DK.PickCard")}</div>` : "")
            }
          </div>`).join("");

    // Ranks already on the table (for highlighting подкидные cards)
    const existingRanks = S.table.flatMap(t=>[t.attack?.rank, t.defense?.rank]).filter(Boolean);
    const noBeatenCards = !S.table.some(t => t.defense !== null);

    const players = S.players.map((p, i) => {
      const isMeP  = p.userId === game.user.id || i === myIdx;
      const isNPC  = !p.userId;
      let showHand;
      if      (S.phase === "gameover") showHand = true;
      else if (isMeP)                  showHand = true;
      else if (isGM)                   showHand = isNPC || this._showOthersCards;
      else                             showHand = false;

      const isAtt  = i === S.attackerIdx;
      const isDef  = i === S.defenderIdx;
      const isInAttackGroup = isAtt || (S.translators ?? []).includes(i);
      const actor  = p.actorId ? game.actors.get(p.actorId) : null;
      const av     = actor?.img && !actor.img.includes("mystery-man")
        ? `<img class="player-avatar" src="${esc(actor.img)}">`
        : `<div class="player-av-ph">🧙</div>`;
      const userObj = p.userId ? game.users.get(p.userId) : null;

      let cls = "player-seat";
      if (p.outOfGame)                               cls += " folded";
      if (isInAttackGroup && !p.outOfGame)           cls += " active";
      if (isMeP && !p.outOfGame)                     cls += " is-me";
      if (S.phase === "gameover" && p.name === S.loser) cls += " ncall";

      const handHTML = p.hand.map((c, ci) => {
        if (!showHand) return this._card(c, true, skin);

        const canInteractDef = isDef && (isMeP || (isGM && isNPC)) && !p.outOfGame && S.phase === "playing";
        // Any non-defender can throw: empty table → only attacker; non-empty → matching rank
        const canAtk = (isMeP || (isGM && isNPC))
          && !p.outOfGame
          && !isDef
          && S.phase === "playing"
          && (S.table.length === 0 ? isAtt : existingRanks.includes(c.rank));

        if (canAtk) {
          const red = c.suit==="♥"||c.suit==="♦";
          return `<div class="poker-card ${red?"red":"black"} durak-atk-card"
            data-pidx="${i}" data-cidx="${ci}" title="${L("DK.Attack")}">
            <div class="p-rank">${c.rank}</div><div class="p-suit">${c.suit}</div>
          </div>`;
        }

        if (canInteractDef) {
          const red = c.suit==="♥"||c.suit==="♦";
          const canTranslate = isPerevodny && noBeatenCards && S.table.length > 0
            && S.table.some(t => t.attack.rank === c.rank);
          if (canTranslate) {
            return `<div class="poker-card ${red?"red":"black"} durak-translate-card" data-hidx="${ci}"
              title="${L("DK.DefendTip")}">
              <div class="p-rank">${c.rank}</div><div class="p-suit">${c.suit}</div>
              <div class="dk-tr-badge">↩</div>
            </div>`;
          }
          return `<div class="poker-card ${red?"red":"black"} durak-def-card" data-hidx="${ci}">
            <div class="p-rank">${c.rank}</div><div class="p-suit">${c.suit}</div>
          </div>`;
        }

        return this._card(c, false, skin);
      }).join("");

      return `<div class="${cls}">
        <div class="player-header">${av}
          <div class="player-info">
            <div class="player-name">${esc(p.name)}
              ${isAtt ? '<span class="npc-badge" style="background:rgba(200,100,0,.3);border-color:#cc6600;color:#ffaa40">⚔ATK</span>' : ""}
              ${isDef ? '<span class="npc-badge" style="background:rgba(0,100,200,.3);border-color:#0066cc;color:#80b0ff">🛡DEF</span>' : ""}
              ${(S.translators??[]).includes(i) && !isDef ? '<span class="npc-badge" style="background:rgba(0,60,180,.3);border-color:#0055cc;color:#80a0ff">↩</span>' : ""}
              ${p.outOfGame ? `<span class="npc-badge" style="background:rgba(0,150,0,.3);border-color:#009900;color:#80ff80">${L("DK.OutBadge")}</span>` : ""}
              ${S.phase === "gameover" && p.name === S.loser ? `<span class="gm-badge">${L("DK.FoolBadge")}</span>` : ""}
            </div>
            ${userObj ? `<div class="player-tag">👤 ${esc(userObj.name)}</div>`
                      : `<div class="player-tag" style="color:#ffb840">🤖 NPC</div>`}
          </div>
        </div>
        <div class="player-status">${p.outOfGame ? L("DK.OutOfGame") : LF("DK.CardsN",{n:p.hand.length})}</div>
        <div class="hand-cards">${handHTML}</div>
        ${isGM && isNPC && !p.outOfGame ? this._npcControls(i, S) : ""}
      </div>`;
    }).join("");

    const banner = S.phase === "gameover"
      ? `<div id="result-banner" style="display:block">${LF("DK.FoolBanner",{name:esc(S.loser)})}</div>` : "";

    root.innerHTML = `
      <div id="poker-title">${titleName}${isGM ? '<span class="gm-badge">GM</span>' : ""}</div>
      <div id="poker-body">
        <div id="combo-guide" style="width:160px">
          <h3>${L("BJ.Rules")}</h3>
          ${trumpHTML}${deckHTML}
          <div class="combo-item"><div class="combo-rank">⚔</div><div><div class="combo-name">${L("DK.PhaseAttack")}</div><div class="combo-desc">${L("DK.RuleAttackDesc")}</div></div></div>
          <div class="combo-item"><div class="combo-rank">🛡</div><div><div class="combo-name">${L("DK.PhaseDefend")}</div><div class="combo-desc">${L("DK.RuleDefendDesc")}</div></div></div>
          <div class="combo-item"><div class="combo-rank">📥</div><div><div class="combo-name">${L("DK.PhaseTake")}</div><div class="combo-desc">${L("DK.RuleTakeDesc")}</div></div></div>
          ${rulesExtra}
          ${visToggle}
        </div>
        <div id="poker-main">
          ${banner}
          <div id="table-area" style="min-height:160px;margin-bottom:10px">
            <div id="table-label">${L("DK.TableLabel")}</div>
            <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap;padding:10px;min-height:120px;align-items:center">${tableCards}</div>
          </div>
          <div id="players-area">${players}</div>
        </div>
      </div>
      <div id="controls">${this._controls(S, myIdx, isAttacker, isDefender, isTranslator, isGM)}</div>
      <div id="log-area">${S.log.slice(0,25).map(l=>`<div>${esc(l)}</div>`).join("")}</div>
    `;
    this._bind(root, S, myIdx, isAttacker, isDefender, isGM);
  }

  _card(card, hidden=false, skin="classic") {
    if (!card || hidden) return `<div class="poker-card back skin-${skin}"></div>`;
    const red = card.suit==="♥"||card.suit==="♦";
    return `<div class="poker-card ${red?"red":"black"}">
      <div class="p-rank">${card.rank}</div><div class="p-suit">${card.suit}</div>
    </div>`;
  }

  _npcControls(playerIdx, S) {
    const isAtt    = playerIdx === S.attackerIdx;
    const isDef    = playerIdx === S.defenderIdx;
    const unbeaten = S.table.filter(t=>!t.defense).length;

    if (isDef && unbeaten > 0) {
      let html = `<div class="npc-controls">
        <button class="npc-act r sm" data-act="take" data-idx="${playerIdx}">📥 ${L("DK.PhaseTake")}</button>`;
      // Translate button for переводной NPC
      if (S.variant === "perevodny" && !S.table.some(t=>t.defense)) {
        const attackRanks = S.table.map(t=>t.attack.rank);
        const defP = S.players[playerIdx];
        if (defP?.hand.some(c => attackRanks.includes(c.rank))) {
          html += `<button class="npc-act b sm" data-act="translate-auto" data-idx="${playerIdx}">${L("DK.Translate")}</button>`;
        }
      }
      return html + `</div>`;
    }
    if (isAtt && !isDef && unbeaten === 0 && S.table.length > 0)
      return `<div class="npc-controls">
        <button class="npc-act b sm" data-act="pass" data-idx="${playerIdx}">${L("DK.NpcPass")}</button></div>`;
    return "";
  }

  _controls(S, myIdx, isAttacker, isDefender, isTranslator, isGM) {
    if (S.phase === "gameover") {
      if (!isGM) return `<div class="hint" style="padding:8px">${L("DK.WaitingGM")}</div>`;
      return `<div class="btn-row">
        <button id="dkbtn-rematch" class="g" style="font-size:1.05em;padding:10px 24px">${L("DK.RematchBtn")}</button>
        <button id="dkbtn-newgame" class="b">${L("DK.NewGameBtn")}</button>
        <button id="dkbtn-lobby">${L("DK.ChangeGameBtn")}</button>
      </div>`;
    }
    const unbeaten = S.table.filter(t=>!t.defense).length;
    let h = "";
    if (isAttacker) {
      if (unbeaten === 0 && S.table.length > 0)
        h += `<div class="btn-row"><button id="dkbtn-pass" class="g">${L("DK.PassBtn")}</button></div>`;
      h += `<div class="hint" style="padding:4px">${L("DK.HintAttack")}</div>`;
    } else if (isTranslator && !isDefender) {
      h += `<div class="hint" style="padding:4px">${L("DK.HintThrow")}</div>`;
    } else if (!isDefender && myIdx >= 0 && !S.players[myIdx]?.outOfGame && S.table.length > 0) {
      h += `<div class="hint" style="padding:4px">${L("DK.HintThrow")}</div>`;
    }
    if (isDefender) {
      if (unbeaten > 0)
        h += `<div class="btn-row"><button id="dkbtn-take" class="r" style="font-size:1.2em;padding:10px 30px">${L("DK.TakeBtn")}</button></div>`;
      if (S.variant === "perevodny" && !S.table.some(t=>t.defense) && S.table.length > 0)
        h += `<div class="hint" style="padding:4px">${L("DK.HintTranslate")}</div>`;
      h += `<div class="hint" style="padding:4px">${L("DK.HintDefend")}</div>`;
    }
    if (!isAttacker && !isDefender && !isTranslator && myIdx >= 0 && S.table.length === 0) {
      const att = S.players[S.attackerIdx];
      h = `<div class="hint" style="padding:8px">${LF("DK.Attacks",{name:esc(att?.name ?? "...")})}</div>`;
    }
    if (myIdx < 0 && !isGM) {
      const att = S.players[S.attackerIdx];
      h = `<div class="hint" style="padding:8px">${LF("DK.Attacks",{name:esc(att?.name ?? "...")})}</div>`;
    }
    return h;
  }

  _bind(root, S, myIdx, isAttacker, isDefender, isGM) {
    const g    = window._durakGame;
    const send = (action, data) => {
      if (isGM && g) {
        if      (action==="DURAK_REQ_ATTACK")    g.attack(data);
        else if (action==="DURAK_REQ_DEFEND")    g.defend(data);
        else if (action==="DURAK_REQ_TAKE")      g.takeCards(data);
        else if (action==="DURAK_REQ_PASS")      g.passTurn(data);
        else if (action==="DURAK_REQ_TRANSLATE") g.translate(data);
      } else window._pokerEmit?.(action, data);
    };

    root.querySelector("#dk-show-others")?.addEventListener("change", e => {
      this._showOthersCards = e.target.checked; this._draw();
    });

    // Attack: click card in non-defender seat (any non-defender can throw)
    root.querySelectorAll(".durak-atk-card").forEach(card => {
      card.addEventListener("click", () => send("DURAK_REQ_ATTACK", {
        playerIdx: parseInt(card.dataset.pidx),
        cardIdx:   parseInt(card.dataset.cidx),
      }));
    });

    // Defense + Translate: for the current defender's seat
    const defIdx  = S.defenderIdx;
    const defP    = S.players[defIdx];
    const defIsMe = defP && (defP.userId === game.user.id || myIdx === defIdx);
    const defIsNPC= defP && !defP.userId;

    if (defP && (isGM || defIsMe)) {
      // Slot selection (highlight which table card to beat)
      root.querySelectorAll(".durak-slot").forEach((slotEl, ti) => {
        if (S.table[ti] && !S.table[ti].defense) {
          slotEl.style.cursor = "pointer";
          slotEl.addEventListener("click", () => {
            root.querySelectorAll(".durak-slot").forEach(s => s.classList.remove("selected-slot"));
            slotEl.classList.add("selected-slot");
          });
        }
      });

      const defSeat = root.querySelectorAll(".player-seat")[defIdx];

      // Translate cards (переводной): click WITHOUT slot → translate; WITH slot → defend
      defSeat?.querySelectorAll(".durak-translate-card").forEach(cardEl => {
        const handIdx = parseInt(cardEl.dataset.hidx ?? "0");
        cardEl.style.cursor = "pointer";
        cardEl.addEventListener("click", () => {
          const selSlot = root.querySelector(".durak-slot.selected-slot");
          if (selSlot) {
            const ti = Array.from(root.querySelectorAll(".durak-slot")).indexOf(selSlot);
            send("DURAK_REQ_DEFEND", { playerIdx: defIdx, handCardIdx: handIdx, tableIdx: ti });
          } else {
            send("DURAK_REQ_TRANSLATE", { playerIdx: defIdx, cardIdx: handIdx });
          }
        });
      });

      // Regular defender cards: click WITH slot → defend
      defSeat?.querySelectorAll(".durak-def-card").forEach(cardEl => {
        const handIdx = parseInt(cardEl.dataset.hidx ?? "0");
        cardEl.style.cursor = "pointer";
        cardEl.addEventListener("click", () => {
          const selSlot = root.querySelector(".durak-slot.selected-slot");
          if (!selSlot) { ui.notifications?.warn(L("DK.PickTableCard")); return; }
          const ti = Array.from(root.querySelectorAll(".durak-slot")).indexOf(selSlot);
          send("DURAK_REQ_DEFEND", { playerIdx: defIdx, handCardIdx: handIdx, tableIdx: ti });
        });
      });
    }

    root.querySelector("#dkbtn-pass")?.addEventListener("click", () =>
      send("DURAK_REQ_PASS", { playerIdx: myIdx >= 0 ? myIdx : S.attackerIdx }));
    root.querySelector("#dkbtn-take")?.addEventListener("click", () =>
      send("DURAK_REQ_TAKE", { playerIdx: myIdx >= 0 ? myIdx : S.defenderIdx }));

    if (isGM && g) {
      root.querySelectorAll(".npc-act").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.idx);
          if (btn.dataset.act==="pass")           g.passTurn({playerIdx:idx});
          else if (btn.dataset.act==="take")      g.takeCards({playerIdx:idx});
          else if (btn.dataset.act==="translate-auto") {
            const attackRanks = g.S.table.map(t=>t.attack.rank);
            const cardIdx = g.S.players[idx]?.hand.findIndex(c => attackRanks.includes(c.rank)) ?? -1;
            if (cardIdx >= 0) g.translate({playerIdx:idx, cardIdx});
          }
        });
      });
    }

    root.querySelector("#dkbtn-rematch")?.addEventListener("click", () => {
      if (isGM && g) { window._pokerEmit?.("DURAK_REQ_REMATCH",{}); g.rematch(); }
    });
    root.querySelector("#dkbtn-newgame")?.addEventListener("click", () => {
      if (isGM && g) { window._pokerEmit?.("DURAK_REQ_NEWGAME",{}); g.resetToSetup(); }
    });
    root.querySelector("#dkbtn-lobby")?.addEventListener("click", () => {
      window._pokerEmit?.("OPEN_LOBBY",{}); window._openLobby?.();
    });
  }
}
