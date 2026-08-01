// ============================================================
// Poker Table VTT — scripts/poker-settings.mjs
// ============================================================

import { getStakesConfig, CURRENCY_KEYS } from "./currency.mjs";
import { UNO_RULE_IDS, getUnoRules }      from "./uno-game.mjs";

const MODULE_ID = "poker-table-vtt";

// Локализация: ключи POKER.* в lang/ru.json и lang/en.json
const L = (k) => game.i18n.localize(`POKER.${k}`);

export const CARD_SKINS = [
  // ── CSS-only skins ─────────────────────────────────────────
  { id:"classic",   label:"Классика",   desc:"Фиолетовый",  image:false },
  { id:"tavern",    label:"Таверна",    desc:"Коричневый",  image:false },
  { id:"ocean",     label:"Океан",      desc:"Синий",       image:false },
  { id:"forest",    label:"Лес",        desc:"Зелёный",     image:false },
  { id:"gold",      label:"Золото",     desc:"Золотой",     image:false },
  { id:"obsidian",  label:"Обсидиан",   desc:"Тёмный",      image:false },
  // ── Image skins ────────────────────────────────────────────
  { id:"mucha",        label:"Муча",        desc:"Лесной узор",    image:true, file:"card-back-mucha.jpg" },
  { id:"elegant",      label:"Элегант",     desc:"Чёрное золото",  image:true, file:"back-elegant.jpg" },
  { id:"tarot",        label:"Таро",        desc:"Мистика",        image:true, file:"back-tarot.jpg" },
  { id:"angel",        label:"Ангел",       desc:"Барокко",        image:true, file:"back-angel.jpg" },
  { id:"justice",      label:"Правосудие",  desc:"Богиня",         image:true, file:"back-justice.jpg" },
  { id:"edem",         label:"Эдем",        desc:"Космос",         image:true, file:"back-edem.jpg" },
  { id:"godwar",       label:"Война богов", desc:"Ангелы",         image:true, file:"back-godwar.jpg" },
  { id:"angelsky",     label:"Ангел неба",  desc:"Луна",           image:true, file:"back-angel-sky.jpg" },
  { id:"marlboro",     label:"Marlboro",    desc:"Стиль",          image:true, file:"back-marlboro.jpg" },
  { id:"angelred",     label:"Красный ангел",desc:"Апокалипсис",   image:true, file:"back-angel-red.jpg" },
  { id:"galaxy",       label:"Галактика",   desc:"Космос",         image:true, file:"back-galaxy.jpg" },
  { id:"japan",        label:"Япония",      desc:"Фудзи",          image:true, file:"back-japan.jpg" },
  { id:"darksouls",    label:"Dark Souls",  desc:"Мрак",           image:true, file:"back-darksouls.jpg" },
  { id:"blackhole",    label:"Чёрная дыра", desc:"Огонь",          image:true, file:"back-blackhole.jpg" },
  { id:"universe",     label:"Вселенная",   desc:"Астрология",     image:true, file:"back-universe.jpg" },
  { id:"catvangogh",   label:"Кот Ван Гог", desc:"Арт",            image:true, file:"back-cat-vangogh.jpg" },
  { id:"vangogh",      label:"Ван Гог",     desc:"Звёздная ночь",  image:true, file:"back-vangogh.jpg" },
  { id:"starnight",    label:"Звёздная ночь",desc:"Луна",          image:true, file:"back-starnight.jpg" },
  { id:"star",         label:"Звезда",      desc:"Золото",         image:true, file:"back-star.jpg" },
];

export const FELT_PRESETS = [
  { color:"#1a5c2a", label:"Изумруд"  },
  { color:"#1a3a5c", label:"Сапфир"   },
  { color:"#5c1a1a", label:"Гранат"   },
  { color:"#3a1a5c", label:"Аметист"  },
  { color:"#5c4a1a", label:"Янтарь"   },
  { color:"#2a2a2a", label:"Антрацит" },
  { color:"#1a5c50", label:"Бирюза"   },
  { color:"#4a3a1a", label:"Дуб"      },
];

export class PokerSettings {
  static register() {
    game.settings.register(MODULE_ID, "uiFont", {
      name: "POKER.Settings.UIFont", hint: "POKER.Settings.UIFontHint",
      scope: "client", config: false, type: String, default: "Caveat",
    });
    game.settings.register(MODULE_ID, "cardSkin", {
      name: "POKER.Settings.CardSkin",
      hint: "POKER.Settings.CardSkinHint",
      scope:"client", config:false, type:String, default:"classic",
    });
    game.settings.register(MODULE_ID, "feltColor", {
      name: "POKER.Settings.TableColor",
      hint: "POKER.Settings.TableColorHint",
      scope:"world", config:false, type:String, default:"#1a5c2a",
    });
    // ── Stakes (poker & blackjack): toy chips by default ──────
    game.settings.register(MODULE_ID, "stakesMode", {
      scope:"world", config:false, type:String, default:"none",
    });
    game.settings.register(MODULE_ID, "stakesCurrency", {
      scope:"world", config:false, type:String, default:"gp",
    });
    game.settings.register(MODULE_ID, "chipStack", {
      scope:"world", config:false, type:Number, default:1000,
    });
    // ── UNO house rules (object of booleans, see UNO_RULE_IDS) ─
    game.settings.register(MODULE_ID, "unoRules", {
      scope:"world", config:false, type:Object, default:{},
    });
    game.settings.registerMenu(MODULE_ID, "pokerSettingsMenu", {
      name:"POKER.Settings.MenuName", label:"POKER.Settings.MenuLabel",
      hint:"POKER.Settings.MenuHint", icon:"fas fa-dice",
      type:PokerSettingsApp, restricted:false,
    });
  }

  static getCardSkin()  { return game.settings.get(MODULE_ID,"cardSkin")  || "classic"; }
  static getUIFont()    { return game.settings.get(MODULE_ID,"uiFont")     || "Caveat"; }
  static async setUIFont(font) { await game.settings.set(MODULE_ID,"uiFont", font); }
  static getFeltColor() { return game.settings.get(MODULE_ID,"feltColor") || "#1a5c2a"; }
  static async setCardSkin(skin)   { await game.settings.set(MODULE_ID,"cardSkin",skin); }
  static async setFeltColor(color) {
    await game.settings.set(MODULE_ID,"feltColor",color);
    window._pokerEmit?.("SETTINGS_FELT_COLOR",{color});
  }

  // Returns CSS background-image value for a skin
  static skinBgStyle(skinId) {
    const s = CARD_SKINS.find(x=>x.id===skinId);
    if (!s?.image) return "";
    return `url('modules/burn-gambling/poker/assets/${s.file}')`;
  }
}

// ── Settings Application ──────────────────────────────────────
export class PokerSettingsApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "poker-settings-app",
    window: { title: "POKER.Settings.Title", resizable: true },
    position: { width: 520, height: "auto" },
    classes: ["poker-dialog", "poker-settings-app"],
  };

  async _renderHTML(_ctx, _opts) {
    const el = document.createElement("div");
    el.className = "pset-frame";
    el.innerHTML = this._buildHTML(this.getData());
    return el;
  }

  _replaceHTML(result, content, _opts) {
    content.replaceChildren(result);
    this._onRender({}, {});
  }

  getData() {
    return {
      // Названия скинов/цветов локализуются на рендере (ключи POKER.Skin.* / POKER.Felt.*)
      skins:       CARD_SKINS.map(s => ({ ...s, label: L(`Skin.${s.id}`), desc: L(`SkinDesc.${s.id}`) })),
      feltPresets: FELT_PRESETS.map((p, i) => ({ ...p, label: L(`Felt.${i}`) })),
      currentSkin: PokerSettings.getCardSkin(),
      feltColor:   PokerSettings.getFeltColor(),
      currentFont: PokerSettings.getUIFont(),
      isGM:        game.user.isGM,
      stakes:      getStakesConfig(),
      unoRules:    getUnoRules(),
    };
  }

  // GM-only: stakes mode + UNO house rules
  _buildGMHTML({ stakes, unoRules }) {
    const curOpts = CURRENCY_KEYS.map(k =>
      `<option value="${k}" ${stakes.key===k?"selected":""}>${L(`CurName.${k}`)} (${L(`Cur.${k}`)})</option>`
    ).join("");

    const ruleRows = UNO_RULE_IDS.map(id => `
      <label class="uno-rule-row" title="${L(`UnoRuleDesc.${id}`)}"
        style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.92em;color:#e8d9a0">
        <input type="checkbox" class="uno-rule-cb" data-rule="${id}" ${unoRules[id]?"checked":""}>
        <span>${L(`UnoRule.${id}`)}</span>
      </label>`).join("");

    return `
      <div class="pset-group">
        <label>💰 ${L("Settings.StakesTitle")} <span style="font-size:.75em;color:#70a060">${L("Settings.ForAll")}</span></label>
        <div style="display:flex;flex-direction:column;gap:6px;margin:8px 0">
          <label style="cursor:pointer;color:#e8d9a0">
            <input type="radio" name="stakes-mode" value="none" ${stakes.mode!=="currency"?"checked":""}>
            ${L("Settings.StakesModeNone")}
          </label>
          <label style="cursor:pointer;color:#e8d9a0">
            <input type="radio" name="stakes-mode" value="currency" ${stakes.mode==="currency"?"checked":""}>
            ${L("Settings.StakesModeCurrency")}
          </label>
        </div>
        <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin:6px 0">
          <span>
            <label style="color:#a0c870">${L("Settings.StakesStack")}</label>
            <input type="number" id="stakes-stack" value="${stakes.stack}" min="10" max="1000000" step="10" style="width:90px">
          </span>
          <span>
            <label style="color:#a0c870">${L("Settings.StakesCurrencyLabel")}</label>
            <select id="stakes-currency">${curOpts}</select>
          </span>
        </div>
        <div class="hint">${L("Settings.StakesHint")}</div>
      </div>

      <div class="pset-group">
        <label>🎴 ${L("Settings.UnoRulesTitle")} <span style="font-size:.75em;color:#70a060">${L("Settings.ForAll")}</span></label>
        <div class="hint" style="margin-bottom:6px">${L("Settings.UnoRulesHint")}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 14px;max-height:240px;overflow-y:auto;padding-right:4px">
          ${ruleRows}
        </div>
      </div>`;
  }


  _buildHTML({ skins, feltPresets, currentSkin, feltColor, currentFont, isGM, stakes, unoRules }) {
    const skinBtns = skins.map(s => {
      const bg = s.image
        ? `style="background-image:${PokerSettings.skinBgStyle(s.id)};background-size:cover;background-position:center;"`
        : "";
      return `<div class="skin-opt${s.id===currentSkin?" selected":""}" data-skin="${s.id}" title="${s.label} — ${s.desc}">
        <div class="skin-preview skin-${s.id}" ${bg}></div>
        <span>${s.label}</span>
      </div>`;
    }).join("");

    const swatches = feltPresets.map(p =>
      `<div class="cswatch${p.color===feltColor?" selected":""}" title="${p.label}"
            data-color="${p.color}" style="background:${p.color}"></div>`
    ).join("");

    return `<div class="pset-scroll" style="padding:16px;background:#0d1a0f;color:#e8d9a0;font-family:'IM Fell English SC',serif">
      <h2 style="font-family:'Cinzel Decorative',cursive;color:#f0c040;text-align:center;margin-bottom:16px;font-size:1.1em">
        ${L("Settings.TableTitle")}
      </h2>

      <div class="pset-group">
        <label>🃏 ${L("Settings.SkinLabel")} <span style="font-size:.75em;color:#70a060">${L("Settings.OnlyYou")}</span></label>
        <div class="skin-grid" style="max-height:320px;overflow-y:auto;padding-right:4px">${skinBtns}</div>
        <div class="hint">${L("Settings.SkinHint2")}</div>
      </div>

      ${isGM ? this._buildGMHTML({ stakes, unoRules }) : ""}

      <div class="pset-group">
        <label>🟢 ${L("Settings.FeltLabel")} <span style="font-size:.75em;color:#70a060">${L("Settings.ForAll")}</span></label>
        <div class="color-swatches">${swatches}</div>
        <div class="color-custom">
          <label>${L("Settings.CustomColor")}</label>
          <input type="color" id="felt-custom-color" value="${feltColor}">
          <button id="felt-apply-custom" class="sm b">${L("Settings.Apply")}</button>
        </div>
      </div>

      <div class="pset-group">
        <label>⌨ ${L("Settings.Hotkeys")}</label>
        <div style="margin-top:16px">
          <label style="color:#f0c040;font-size:.9em;display:block;margin-bottom:8px">
            ✍️ ${L("Settings.UIFont")} <span style="font-size:.75em;color:#70a060">${L("Settings.OnlyYou")}</span>
          </label>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            ${["Caveat","Alegreya","Pacifico"].map(f => `
              <div id="font-${f}" class="font-choice${currentFont===f?" selected":""}"
                style="cursor:pointer;padding:10px 18px;border-radius:8px;border:2px solid ${currentFont===f?"#f0c040":"#3a5a3a"};
                background:${currentFont===f?"rgba(240,192,64,.15)":"rgba(0,0,0,.3)"};
                font-family:'${f}',cursive;font-size:1.3em;color:#e8d9a0;transition:all .2s">
                ${L("Settings.FontSample")} 🃏 ${f}
              </div>`).join("")}
          </div>
        </div>
        <div style="font-size:.85em;color:#a0c870;line-height:2">
          <div><kbd style="background:#1a2a1a;border:1px solid #3a5a3a;border-radius:4px;padding:2px 7px;color:#c0e0a0;font-family:monospace">Numpad 7</kbd> — ${L("Lobby.OpenForAll")} <span style="color:#ff8888">(GM)</span></div>
          <div><kbd style="background:#1a2a1a;border:1px solid #3a5a3a;border-radius:4px;padding:2px 7px;color:#c0e0a0;font-family:monospace">Shift + &lt;</kbd> — ${L("Lobby.OpenOwn")} ${L("Settings.AnyPlayer")}</div>
        </div>
      </div>

    </div>

    <div class="pset-footer">
      <button id="pset-save"  class="g" style="padding:8px 28px;font-size:1.05em;cursor:pointer">${L("Settings.Save")}</button>
      <button id="pset-close"           style="padding:8px 20px;font-size:1.05em;cursor:pointer">${L("Settings.Close")}</button>
    </div>`;
  }

  _onRender(_ctx, _opts) {
    const el = this.element;
    let _skin  = PokerSettings.getCardSkin();
    let _color = PokerSettings.getFeltColor();
    let _font  = PokerSettings.getUIFont();

    // Font choice clicks
    el.querySelectorAll(".font-choice, [id^='font-']").forEach(btn => {
      btn.addEventListener("click", () => {
        const font = btn.id.replace("font-", "");
        _font = font;
        el.querySelectorAll("[id^='font-']").forEach(b => {
          b.style.borderColor = "#3a5a3a";
          b.style.background  = "rgba(0,0,0,.3)";
        });
        btn.style.borderColor = "#f0c040";
        btn.style.background  = "rgba(240,192,64,.15)";
      });
    });

    el.querySelectorAll(".skin-opt").forEach(btn => {
      btn.addEventListener("click", () => {
        el.querySelectorAll(".skin-opt").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        _skin = btn.dataset.skin;
      });
    });

    el.querySelectorAll(".cswatch").forEach(sw => {
      sw.addEventListener("click", () => {
        el.querySelectorAll(".cswatch").forEach(s => s.classList.remove("selected"));
        sw.classList.add("selected");
        _color = sw.dataset.color;
        const picker = el.querySelector("#felt-custom-color");
        if (picker) picker.value = _color;
      });
    });

    el.querySelector("#felt-apply-custom")?.addEventListener("click", () => {
      const c = el.querySelector("#felt-custom-color")?.value;
      if (c) { el.querySelectorAll(".cswatch").forEach(s => s.classList.remove("selected")); _color = c; }
    });

    el.querySelector("#pset-save")?.addEventListener("click", async () => {
      // GM-only world settings: stakes + UNO house rules
      if (game.user.isGM) {
        const mode = el.querySelector('input[name="stakes-mode"]:checked')?.value || "none";
        const cur  = el.querySelector("#stakes-currency")?.value || "gp";
        const stk  = Math.max(1, parseInt(el.querySelector("#stakes-stack")?.value) || 1000);
        await game.settings.set(MODULE_ID, "stakesMode", mode);
        await game.settings.set(MODULE_ID, "stakesCurrency", cur);
        await game.settings.set(MODULE_ID, "chipStack", stk);
        const rules = {};
        el.querySelectorAll(".uno-rule-cb").forEach(cb => { rules[cb.dataset.rule] = cb.checked; });
        if (Object.keys(rules).length) await game.settings.set(MODULE_ID, "unoRules", rules);
      }
      await PokerSettings.setCardSkin(_skin);
      await PokerSettings.setUIFont(_font);
      // Применяем шрифт сразу
      document.querySelectorAll("#poker-root").forEach(r => {
        r.style.setProperty("--cg-font", `'${_font}'`);
        r.style.setProperty("--cg-font-title", `'${_font}'`);
      });
      await PokerSettings.setFeltColor(_color);
      ui.notifications.info(L("Settings.Saved"));
      this.close();
    });
    el.querySelector("#pset-close")?.addEventListener("click", () => this.close());
  }
}
