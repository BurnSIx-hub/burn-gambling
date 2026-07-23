// ============================================================
// Card Games VTT — scripts/currency.mjs
// Stakes engine: toy chips (default) or character-sheet currency.
// Shared by poker & blackjack. Settings are captured into game
// state at startGame, so changing them never affects a running game.
// ============================================================

const MODULE_ID = "poker-table-vtt";

export const CURRENCY_KEYS = ["cp", "sp", "ep", "gp", "pp"];

// Current stakes config from world settings (GM-controlled)
export function getStakesConfig() {
  let mode = "none", key = "gp", stack = 1000;
  try {
    mode  = game.settings.get(MODULE_ID, "stakesMode")     || "none";
    key   = game.settings.get(MODULE_ID, "stakesCurrency") || "gp";
    stack = Number(game.settings.get(MODULE_ID, "chipStack"));
  } catch (e) { /* settings not registered yet */ }
  if (mode !== "currency") mode = "none";
  if (!CURRENCY_KEYS.includes(key)) key = "gp";
  if (!stack || isNaN(stack) || stack < 1) stack = 1000;
  return { mode, key, stack: Math.round(stack) };
}

export function isCurrencyMode(stakes) {
  return stakes?.mode === "currency";
}

// ── Display ───────────────────────────────────────────────────
// fmt() follows the stakes of the table being shown. Apps call
// setDisplayStakes(state.stakes) on every state update, so each
// client formats with the table's actual currency.
let _display = { mode: "none", key: "gp" };

export function setDisplayStakes(stakes) {
  if (stakes?.mode) _display = { mode: stakes.mode, key: stakes.key || "gp" };
}

export function fmt(v) {
  const n = (v === null || v === undefined || isNaN(v)) ? 0 : v;
  if (_display.mode === "currency") {
    return `${n} ${game.i18n.localize(`POKER.Cur.${_display.key}`)}`;
  }
  return `${n}🪙`;
}

// ── Actor funds (currency mode only; chips never touch the sheet) ──
export function getActorFunds(actor, stakes) {
  if (!actor || !isCurrencyMode(stakes)) return 0;
  const cur = actor.system?.currency;
  if (!cur) return 0;
  const v = parseFloat(cur[stakes.key] ?? 0);
  return isNaN(v) ? 0 : Math.round(v * 100) / 100;
}

export async function deductFunds(actor, amount, stakes) {
  if (!actor || !game.user.isGM || !isCurrencyMode(stakes)) return;
  const cur = actor.system?.currency;
  if (!cur) return;
  const val = parseFloat(cur[stakes.key] ?? 0) || 0;
  await actor.update({ [`system.currency.${stakes.key}`]: Math.max(0, Math.round((val - amount) * 100) / 100) });
}

export async function addFunds(actor, amount, stakes) {
  if (!actor || !game.user.isGM || !isCurrencyMode(stakes)) return;
  const cur = actor.system?.currency;
  if (!cur) return;
  const val = parseFloat(cur[stakes.key] ?? 0) || 0;
  await actor.update({ [`system.currency.${stakes.key}`]: Math.round((val + amount) * 100) / 100 });
}

// Starting funds for a seat: chip stack, or what the sheet holds
export function startingFunds(actor, stakes) {
  return isCurrencyMode(stakes) ? getActorFunds(actor, stakes) : stakes.stack;
}
