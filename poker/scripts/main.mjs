// ============================================================
// Card Games VTT — scripts/main.mjs
// Hub: Poker · Blackjack · Durak
// ============================================================

import { PokerApp }      from "./poker-app.mjs";
import { BlackjackApp }  from "./blackjack-app.mjs";
import { DurakApp }      from "./durak-app.mjs";
import { UnoApp }        from "./uno-app.mjs";
import { LobbyApp }      from "./lobby-app.mjs";
import { PokerSettings } from "./poker-settings.mjs";

const MODULE_ID   = "poker-table-vtt";
const SOCKET_NAME = "module.burn-gambling"; // единый канал контейнера

// ── Register app classes so lobby-app can instantiate them ────
// (avoids circular import: lobby → poker-app → ... → lobby)
window._CardGameClasses = { PokerApp, BlackjackApp, DurakApp, UnoApp };

// ── Sound ─────────────────────────────────────────────────────
// Play sound locally
function gameSound(name) {
  const src = `modules/burn-gambling/poker/sounds/${name}`;
  try {
    // Foundry V13+: foundry.audio.AudioHelper; V12 fallback: global AudioHelper
    const AH = foundry.audio?.AudioHelper ?? (typeof AudioHelper !== "undefined" ? AudioHelper : null);
    if (AH?.play) AH.play({ src, volume: 0.8, autoplay: true, loop: false }, false);
    else { const a = new Audio(src); a.volume = 0.8; a.play().catch(() => {}); }
  } catch(e) {}
}

// Play sound for ALL clients (GM calls this after game actions)
function gameSoundAll(name) {
  gameSound(name); // play locally (GM)
  // Broadcast to all other clients
  game.socket?.emit(SOCKET_NAME, { action: "PLAY_SOUND", data: { name }, senderId: game.user.id });
}

window._pokerSound = gameSoundAll;

// ── Init ──────────────────────────────────────────────────────
Hooks.once("init", () => {
  PokerSettings.register();
  // v5.0: кастомная валюта "фишка" на листе персонажа больше не регистрируется —
  // фишки теперь виртуальные (режим "без ставок"), валюта берётся из настроек ГМа.
});

Hooks.once("ready", () => {
  window._pokerEmit = (action, data = {}) =>
    game.socket.emit(SOCKET_NAME, { action, data, senderId: game.user.id });
  game.socket.on(SOCKET_NAME, onMsg);
  registerHotkeys();
  // ── Reconnect: request state sync when joining ──────────────
  // When a player opens the window, they request current state from GM
  setTimeout(() => {
    if (!game.user.isGM) {
      game.socket.emit(SOCKET_NAME, { action: "REQ_RECONNECT", data: {}, senderId: game.user.id });
    }
  }, 500);

});

// ── Helpers ───────────────────────────────────────────────────
function openLobby() {
  if (!window._lobbyApp) window._lobbyApp = new LobbyApp();
  window._lobbyApp.render({force:true});
}
window._openLobby = openLobby;

function openPoker() {
  if (!window._pokerApp) window._pokerApp = new PokerApp();
  window._pokerApp.render({force:true});
}
function openBlackjack() {
  if (!window._bjApp) window._bjApp = new BlackjackApp();
  window._bjApp.render({force:true});
}
function openDurak() {
  if (!window._durakApp) window._durakApp = new DurakApp();
  window._durakApp.render({force:true});
  // After render completes, request fresh state from GM so non-GM sees current game
  if (!game.user.isGM) {
    setTimeout(() => {
      game.socket?.emit(SOCKET_NAME, { action: "REQ_RECONNECT", data: {}, senderId: game.user.id });
    }, 300);
  }
}
function openUno() {
  if (!window._unoApp) window._unoApp = new UnoApp();
  window._unoApp.render({force:true});
  if (!game.user.isGM) {
    setTimeout(() => {
      game.socket?.emit(SOCKET_NAME, { action: "REQ_RECONNECT", data: {}, senderId: game.user.id });
    }, 300);
  }
}
window._openPoker     = openPoker;
window._openBlackjack = openBlackjack;
window._openDurak     = openDurak;
window._openUno       = openUno;

// ── Socket hub ────────────────────────────────────────────────
function onMsg({ action, data }) {
  switch (action) {
    // Lobby & navigation
    case "OPEN_LOBBY":          openLobby(); break;
    case "OPEN_POKER":          openPoker();      window._lobbyApp?.close(); break;
    case "OPEN_BLACKJACK":      openBlackjack();  window._lobbyApp?.close(); break;
    case "OPEN_DURAK":          openDurak();       window._lobbyApp?.close(); break;
    case "OPEN_UNO":            openUno();         window._lobbyApp?.close(); break;

    // Lobby voting
    case "LOBBY_SHOW_GAMES":
      if (!game.user.isGM) {
        if (!window._lobbyApp) window._lobbyApp = new LobbyApp();
        window._lobbyApp._votingActive = true;
        window._lobbyApp._step         = "games";
        window._lobbyApp._myVote       = null;
        window._lobbyApp._voteNames    = {};
        window._lobbyApp.render({force:true});
      }
      break;
    case "LOBBY_SHOW_WAIT":
      if (!game.user.isGM && window._lobbyApp) {
        window._lobbyApp._votingActive = false;
        window._lobbyApp._step         = "players";
        window._lobbyApp.render({force:true});
      }
      break;
    case "LOBBY_VOTE":
      if (game.user.isGM) window._lobbyApp?.handleVote(data.userId, data.userName, data.game);
      break;
    case "LOBBY_VOTES_UPDATE":
      window._lobbyApp?.handleVotesUpdate(data.votes);
      break;

    // Sound
    case "PLAY_SOUND":          gameSound(data?.name); break;

    case "REQ_RECONNECT":
      // GM re-broadcasts current state to all clients
      if (game.user.isGM) {
        if (window._pokerGame)  window._pokerEmit("POKER_STATE",    { state: window._pokerGame.S });
        if (window._bjGame)     window._pokerEmit("BJ_STATE",       { state: window._bjGame.S });
        if (window._durakGame)  window._pokerEmit("DURAK_STATE",    { state: window._durakGame.S });
        if (window._unoGame)    window._pokerEmit("UNO_STATE",      { state: window._unoGame.S });
      }
      break;


    // Settings
    case "SETTINGS_FELT_COLOR":
      if (data?.color) game.settings.set(MODULE_ID, "feltColor", data.color)
        .then(() => { window._pokerApp?.applyFeltColor(); window._pokerApp?.rerender(); });
      break;

    // ── Poker ──────────────────────────────────────────────
    case "POKER_STATE":         window._pokerApp?.onStateUpdate(data.state); break;
    case "POKER_REQ_BET":       if (game.user.isGM) window._pokerGame?.handleBet(data); break;
    case "POKER_REQ_FOLD":      if (game.user.isGM) window._pokerGame?.handleFold(data); break;
    case "POKER_REQ_PHASE":     if (game.user.isGM) window._pokerGame?.startBettingRound(data?.next); break;
    case "POKER_REQ_SHOWDOWN":  if (game.user.isGM) window._pokerGame?.doShowdown(); break;
    case "POKER_REQ_NEWROUND":  if (game.user.isGM) window._pokerGame?.startRound(); break;
    case "POKER_REQ_NEWGAME":   if (game.user.isGM) window._pokerGame?.resetToSetup(); break;
    case "POKER_REQ_SKIPBET":   if (game.user.isGM) window._pokerGame?.finishBettingRound(); break;

    // ── Blackjack ──────────────────────────────────────────
    case "BJ_STATE":            window._bjApp?.onStateUpdate(data.state); break;
    case "BJ_REQ_BET":          if (game.user.isGM) window._bjGame?.placeBet(data); break;
    case "BJ_REQ_HIT":          if (game.user.isGM) window._bjGame?.playerHit(data); break;
    case "BJ_REQ_STAND":        if (game.user.isGM) window._bjGame?.playerStand(data); break;
    case "BJ_REQ_DOUBLE":       if (game.user.isGM) window._bjGame?.playerDouble(data); break;
    case "BJ_REQ_NEWROUND":     if (game.user.isGM) window._bjGame?.newRound(); break;
    case "BJ_REQ_NEWGAME":      if (game.user.isGM) window._bjGame?.resetToSetup(); break;

    // ── Durak ──────────────────────────────────────────────
    case "DURAK_STATE":         window._durakApp?.onStateUpdate(data.state); break;
    case "DURAK_REQ_ATTACK":    if (game.user.isGM) window._durakGame?.attack(data); break;
    case "DURAK_REQ_DEFEND":    if (game.user.isGM) window._durakGame?.defend(data); break;
    case "DURAK_REQ_TAKE":      if (game.user.isGM) window._durakGame?.takeCards(data); break;
    case "DURAK_REQ_PASS":      if (game.user.isGM) window._durakGame?.passTurn(data); break;
    case "DURAK_REQ_NEWGAME":    if (game.user.isGM) window._durakGame?.resetToSetup(); break;
    case "DURAK_REQ_REMATCH":    if (game.user.isGM) window._durakGame?.rematch(); break;
    case "DURAK_REQ_TRANSLATE":  if (game.user.isGM) window._durakGame?.translate(data); break;

    // ── UNO ────────────────────────────────────────────────
    case "UNO_STATE":           window._unoApp?.onStateUpdate(data.state); break;
    case "UNO_REQ_PLAY":        if (game.user.isGM) window._unoGame?.playCard(data); break;
    case "UNO_REQ_DRAW":        if (game.user.isGM) window._unoGame?.drawCard(data); break;
    case "UNO_REQ_COLOR":       if (game.user.isGM) window._unoGame?.chooseColor(data); break;
    case "UNO_REQ_UNO":         if (game.user.isGM) window._unoGame?.sayUno(data); break;
    case "UNO_REQ_CATCH":       if (game.user.isGM) window._unoGame?.catchUno(data); break;
    case "UNO_REQ_SWAP":        if (game.user.isGM) window._unoGame?.swapHands(data); break;
    case "UNO_REQ_CHALLENGE":   if (game.user.isGM) window._unoGame?.challengeWild4(data); break;
    case "UNO_REQ_QUIT":        if (game.user.isGM) window._unoGame?.quitGame(data); break;
    case "UNO_REQ_NEWGAME":     if (game.user.isGM) window._unoGame?.resetToSetup(); break;
    case "UNO_REQ_REMATCH":     if (game.user.isGM) window._unoGame?.rematch(); break;
  }
}

// ── Hotkeys ───────────────────────────────────────────────────
function registerHotkeys() {
  document.addEventListener("keydown", e => {
    const t = e.target;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
    if (e.code === "Numpad7" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      if (!game.user.isGM) return;
      e.preventDefault();
      showToast(game.i18n.localize("POKER.Lobby.OpeningLobby"));
      window._pokerEmit("OPEN_LOBBY", {});
      openLobby();
      return;
    }
    if (e.shiftKey && !e.ctrlKey && !e.altKey) {
      const k = e.key;
      if (k === "<" || k === "«" || k === "б" || e.code === "Comma") {
        e.preventDefault(); showToast("🃏 Card Games"); openLobby();
      }
    }
  });
}

function showToast(msg) {
  document.getElementById("poker-hotkey-toast")?.remove();
  const el = document.createElement("div");
  el.id = "poker-hotkey-toast"; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

Hooks.on("getSceneControlButtons", controls => {
  if (game.modules.get("burnhub")?.active) return; // с BurnHub кнопка в папке 🔥 Burn; без него — своя (видна всем)
  // V13/V14: controls — объект { tokens: { tools: {...} }, ... }
  // Пробуем все возможные ключи
  const tokenGroup = controls["tokens"] ?? controls["token"] ?? controls["basic"];
  if (tokenGroup?.tools) {
    tokenGroup.tools["card-games"] = {
      name:     "card-games",
      title:    "Card Games (Shift+< / Numpad7)",
      icon:     "fas fa-dice",
      order:    Object.keys(tokenGroup.tools).length,
      button:   true,
      visible:  true,
      onChange: () => { openLobby(); },
    };
  }
});

// ─── Экспорт для картотеки Gambling (scripts/catalog.js) ───
Hooks.once("ready", () => {
  game.burnGambling ??= {};
  game.burnGambling.openCards = () => openLobby();
});
