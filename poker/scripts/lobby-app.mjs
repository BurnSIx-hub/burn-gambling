// ============================================================
// Card Games VTT — scripts/lobby-app.mjs  (Foundry V13/V14)
// ApplicationV2 — pure innerHTML, no Handlebars
// ============================================================

import { PokerGame }     from "./poker-game.mjs";
import { BlackjackGame } from "./blackjack-game.mjs";
import { DurakGame }     from "./durak-game.mjs";
import { UnoGame }       from "./uno-game.mjs";
import { PokerSettings } from "./poker-settings.mjs";
import { fmt, getStakesConfig, setDisplayStakes, isCurrencyMode, getActorFunds } from "./currency.mjs";

const MAX_PLAYERS = 6;
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

// Локализация: ключи POKER.* в lang/ru.json и lang/en.json
const L  = (k)    => game.i18n.localize(`POKER.${k}`);
const LF = (k, d) => game.i18n.format(`POKER.${k}`, d);

// Лениво — на момент загрузки модуля i18n ещё не готов
const GAMES = () => [
  { key:"poker",       icon:"♠",  name:L("Game.Poker"),      desc:L("Game.PokerDesc") },
  { key:"blackjack",   icon:"21", name:L("Game.Blackjack"),  desc:L("Game.BlackjackDesc") },
  { key:"durak",       icon:"🃏", name:L("Game.Durak"),      desc:L("Game.DurakDesc") },
  { key:"durak-perev", icon:"↩",  name:L("Game.DurakPerev"), desc:L("Game.DurakPerevDesc") },
  { key:"uno",         icon:"🎴", name:L("Game.Uno"),        desc:L("Game.UnoDesc") },
];

export class LobbyApp extends foundry.applications.api.ApplicationV2 {
  constructor(options={}) {
    super(options);
    this._step         = "players";
    this._players      = [];
    // GM side: { gameKey: [{id, name}, ...] }
    this._votes        = {};
    // Non-GM side (received from GM)
    this._voteNames    = {};  // { gameKey: [name, ...] }
    this._myVote       = null;
    this._votingActive = false;
    window._lobbyApp   = this;
  }

  static DEFAULT_OPTIONS = {
    id: "lobby-app",
    window: { title: "⚜ Card Games", resizable: true },
    position: { width: 820, height: 720 },
    classes: ["poker-dialog"],
  };

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

  _replaceHTML(result, content, _opts) { content.replaceChildren(result); }
  _onRender(_ctx, _opts) { this._draw(); }
  _root() { return this.element?.querySelector("#poker-root") ?? null; }

  _draw() {
    if (!game.user.isGM && !this._votingActive) { this._drawWait(); return; }
    if (this._step === "players" && !game.user.isGM) { this._drawWait(); return; }
    this._step === "players" ? this._drawPlayers() : this._drawGames();
  }

  _drawWait() {
    const root = this._root(); if (!root) return;
    root.innerHTML = `
      <div id="poker-title">⚜ CARD GAMES ⚜</div>
      <div class="wait-screen">
        <div class="wt">⚜ CARD GAMES ⚜</div>
        <div class="ws">${L("Lobby.WaitingGM")}</div>
        <div class="wait-spin">🃏</div>
      </div>`;
  }

  _drawPlayers() {
    const root = this._root(); if (!root) return;

    // PCs always shown; NPCs only if flagged as important by GM.
    // Chips mode works in any system — currency on the sheet not required.
    const stakes = getStakesConfig();
    setDisplayStakes(stakes);
    const needCur = isCurrencyMode(stakes);
    const pcActors      = game.actors.filter(a => a.type === "character" && (!needCur || a.system?.currency));
    const allNPCs       = game.actors.filter(a => a.type === "npc"       && (!needCur || a.system?.currency));
    const importantNPCs = allNPCs.filter(a => !!a.flags?.["poker-table-vtt"]?.importantNPC);
    const actors        = [...pcActors, ...importantNPCs];

    const users = game.users.filter(u => !u.isGM && u.active);
    const aopts = actors.map(a =>
      `<option value="${a.id}">${esc(a.name)}${a.type === "npc" ? " ⭐" : ""}</option>`
    ).join("");
    const uopts = `<option value="">${L("Lobby.NpcManaged")}</option>` +
                  users.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join("");

    let slots = "";
    for (let i = 0; i < MAX_PLAYERS; i++) {
      slots += `<div class="setup-player">
        <label>${LF("Lobby.Seat", { n: i + 1 })}</label>
        <select id="ls-${i}"><option value="">${L("Lobby.Empty")}</option>${aopts}</select>
        <div class="setup-preview" id="lp-${i}">—</div>
        <select id="lu-${i}" class="setup-user">${uopts}</select>
      </div>`;
    }

    // NPC importance toggles
    const npcRows = allNPCs.length === 0
      ? `<div style="color:#5a7a5a;font-size:.85em;padding:6px 0">${L("Lobby.NoNpcs")}</div>`
      : allNPCs.map(a => {
          const isImp = !!a.flags?.["poker-table-vtt"]?.importantNPC;
          return `<label class="npc-imp-row${isImp ? " is-imp" : ""}">
            <input type="checkbox" data-actorid="${a.id}" ${isImp ? "checked" : ""}>
            <span>${esc(a.name)}</span>
          </label>`;
        }).join("");

    root.innerHTML = `
      <div id="poker-title">⚜ CARD GAMES ⚜<span class="gm-badge">GM</span></div>
      <div class="setup-hint">
        ${L("Lobby.SetupHint")}<br>
        <kbd>Numpad 7</kbd> — ${L("Lobby.OpenForAll")} &nbsp; <kbd>Shift+&lt;</kbd> — ${L("Lobby.OpenOwn")}
      </div>
      <div class="setup-players">${slots}</div>
      <details class="npc-imp-section">
        <summary>${L("Lobby.ImportantNpcs")} <span class="npc-imp-count">${importantNPCs.length}</span></summary>
        <div class="npc-imp-list">${npcRows}</div>
      </details>
      <div class="btn-row" style="padding:8px 14px 14px">
        <button id="lobby-next" class="g" style="font-size:1.1em;padding:10px 36px">${L("Lobby.Next")}</button>
      </div>`;

    // Preview update for each slot
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const sel = root.querySelector(`#ls-${i}`);
      const prv = root.querySelector(`#lp-${i}`);
      if (!sel || !prv) continue;
      const upd = () => {
        const a = game.actors.get(sel.value);
        if (!a) { prv.innerHTML = "—"; return; }
        const img = a.img && !a.img.includes("mystery-man") ? `<img src="${esc(a.img)}">` : "🧙";
        const st = getStakesConfig();
        const funds = isCurrencyMode(st) ? getActorFunds(a, st) : st.stack;
        prv.innerHTML = `${img}<span class="pp">${fmt(funds)}</span>`;
      };
      sel.addEventListener("change", upd); upd();
    }

    // Toggle NPC importance (async flag update + live dropdown patch)
    root.querySelectorAll("input[data-actorid]").forEach(cb => {
      cb.addEventListener("change", async () => {
        const actor = game.actors.get(cb.dataset.actorid);
        if (!actor) return;
        await actor.update({ "flags.poker-table-vtt.importantNPC": cb.checked });
        cb.closest(".npc-imp-row")?.classList.toggle("is-imp", cb.checked);
        // Recount badge
        const count = root.querySelectorAll("input[data-actorid]:checked").length;
        const badge = root.querySelector(".npc-imp-count");
        if (badge) badge.textContent = count;
        // Patch all 6 dropdowns live
        for (let i = 0; i < MAX_PLAYERS; i++) {
          const sel = root.querySelector(`#ls-${i}`);
          if (!sel) continue;
          const existing = sel.querySelector(`option[value="${actor.id}"]`);
          if (cb.checked && !existing) {
            const opt = document.createElement("option");
            opt.value = actor.id;
            opt.textContent = actor.name + " ⭐";
            sel.appendChild(opt);
          } else if (!cb.checked && existing) {
            if (sel.value === actor.id) {
              sel.value = "";
              root.querySelector(`#lp-${i}`)?.innerHTML && (root.querySelector(`#lp-${i}`).innerHTML = "—");
            }
            existing.remove();
          }
        }
      });
    });

    root.querySelector("#lobby-next")?.addEventListener("click", () => {
      const players = this._collect(root);
      if (!players) return;
      this._players = players;
      this._votes   = {};
      this._step    = "games";
      window._pokerEmit?.("LOBBY_SHOW_GAMES", {});
      this._draw();
    });
  }

  _drawGames() {
    const root  = this._root(); if (!root) return;
    const isGM  = game.user.isGM;

    const getVoters = key => isGM
      ? (this._votes[key] ?? [])
      : (this._voteNames[key] ?? []).map(name => ({ name }));

    const gamesHTML = GAMES().map(g => {
      const voters   = getVoters(g.key);
      const isMyVote = this._myVote === g.key;
      const voteText = voters.length > 0
        ? `👍 ${voters.map(v => esc(v.name)).join(", ")}`
        : `<span style="color:#3a5a3a">—</span>`;
      const actionHint = isGM
        ? `<span class="game-action-hint gm">${L("Lobby.Start")}</span>`
        : isMyVote
          ? `<span class="game-action-hint voted">${L("Lobby.Voted")}</span>`
          : `<span class="game-action-hint">${L("Lobby.Vote")}</span>`;
      return `<div class="game-card${isMyVote ? " voted" : ""}" data-game="${g.key}">
        <div class="game-icon">${g.icon}</div>
        <div class="game-info">
          <div class="game-name">${g.name}</div>
          <div class="game-desc">${g.desc}</div>
        </div>
        <div class="vote-bar">${voteText}</div>
        ${actionHint}
      </div>`;
    }).join("");

    const subtitle = isGM
      ? `${L("Lobby.PlayersLabel")} <strong style="color:#f0c040">${this._players.length}</strong>
         &nbsp;·&nbsp;<span id="lobby-back" style="cursor:pointer;color:#80b0ff;text-decoration:underline">${L("Lobby.ChangeLineup")}</span>`
      : L("Lobby.VoteHint");

    root.innerHTML = `
      <div id="poker-title">${L("Lobby.ChooseGame")}${isGM ? '<span class="gm-badge">GM</span>' : ""}</div>
      <div class="setup-hint" style="text-align:center;padding-bottom:6px">${subtitle}</div>
      <div id="lobby-games">${gamesHTML}</div>`;

    root.querySelector("#lobby-back")?.addEventListener("click", () => {
      this._votes = {};
      window._pokerEmit?.("LOBBY_SHOW_WAIT", {});
      this._step = "players"; this._draw();
    });

    root.querySelectorAll(".game-card").forEach(card => {
      card.addEventListener("click", () => {
        const gameKey = card.dataset.game;
        if (isGM) {
          if (this._players.length === 0) { ui.notifications?.warn(L("Lobby.AddOnePlayer")); return; }
          this._launch(gameKey, this._players);
        } else {
          this._myVote = gameKey;
          window._pokerEmit?.("LOBBY_VOTE", { userId: game.user.id, userName: game.user.name, game: gameKey });
          this._draw();
        }
      });
    });
  }

  // Called on GM when a player votes
  handleVote(userId, userName, gameKey) {
    for (const key in this._votes) {
      this._votes[key] = (this._votes[key] || []).filter(v => v.id !== userId);
    }
    if (!this._votes[gameKey]) this._votes[gameKey] = [];
    this._votes[gameKey].push({ id: userId, name: userName });
    window._pokerEmit?.("LOBBY_VOTES_UPDATE", { votes: this._votes });
    if (this._step === "games") this._draw();
  }

  // Called on all clients when GM broadcasts vote update
  handleVotesUpdate(votes) {
    this._voteNames = {};
    for (const [key, voters] of Object.entries(votes || {})) {
      this._voteNames[key] = voters.map(v => v.name);
    }
    if (this._step === "games" || this._votingActive) this._draw();
  }

  _collect(root) {
    const players = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const sel = root.querySelector(`#ls-${i}`);
      const usr = root.querySelector(`#lu-${i}`);
      if (!sel?.value) continue;
      const actor = game.actors.get(sel.value);
      if (!actor) continue;
      players.push({
        name: actor.name, actorId: actor.id, userId: usr?.value || null,
        hand: [], bet: 0, folded: false,
      });
    }
    if (players.length < 2) { ui.notifications?.warn(L("Lobby.MinTwoPlayers")); return null; }
    return players;
  }

  _launch(game_type, players) {
    switch (game_type) {
      case "poker":
        window._openPoker?.();
        setTimeout(() => { new PokerGame().startGame({players}); window._pokerEmit?.("OPEN_POKER",{}); }, 100);
        break;
      case "blackjack":
        window._openBlackjack?.();
        setTimeout(() => { new BlackjackGame().startGame({players}); window._pokerEmit?.("OPEN_BLACKJACK",{}); }, 100);
        break;
      case "durak":
        window._openDurak?.();
        setTimeout(() => { new DurakGame().startGame({players, variant:"podkidnoy"}); window._pokerEmit?.("OPEN_DURAK",{}); }, 100);
        break;
      case "durak-perev":
        window._openDurak?.();
        setTimeout(() => { new DurakGame().startGame({players, variant:"perevodny"}); window._pokerEmit?.("OPEN_DURAK",{}); }, 100);
        break;
      case "uno":
        window._openUno?.();
        setTimeout(() => { new UnoGame().startGame({players}); window._pokerEmit?.("OPEN_UNO",{}); }, 100);
        break;
    }
    this.close();
  }
}
