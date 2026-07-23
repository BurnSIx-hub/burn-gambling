/**
 * 🔥 Gambling — картотека азартных игр.
 * Контейнер объединяет бывшие модули poker-table-vtt (poker/) и
 * horse-racing (horse/). Их код работает как раньше; настройки хранятся
 * под старыми namespace, поэтому миграция данных не нужна.
 * Здесь — только окно-картотека и одна плитка в BurnHub.
 */

const { ApplicationV2 } = foundry.applications.api;

/** Карточки картотеки. run() зовёт функции, выставленные суб-модулями в ready. */
const CARDS = [
  {
    id: "cards",
    title: "Card Games",
    sub: "Покер, карты — общий игровой стол",
    icon: "fa-solid fa-dice",
    run: () => game.burnGambling?.openCards?.()
  },
  {
    id: "racing",
    title: "Horse Racing",
    sub: "Скачки-тотализатор со ставками",
    icon: "fa-solid fa-horse",
    run: () => game.burnGambling?.openRacing?.()
  }
];

class GamblingCatalog extends ApplicationV2 {
  static #instance = null;

  static DEFAULT_OPTIONS = {
    id: "burn-gambling-catalog",
    classes: ["burncat"],
    window: { title: "🔥 Gambling", icon: "fa-solid fa-sack-dollar" },
    position: { width: 420, height: "auto" }
  };

  static open() {
    this.#instance ??= new GamblingCatalog();
    this.#instance.render({ force: true });
  }

  async _renderHTML() {
    return CARDS.map((c) => `
      <button type="button" class="burncat-card" data-card="${c.id}">
        <i class="burncat-icon ${c.icon}"></i>
        <span class="burncat-text">
          <span class="burncat-title">${c.title}</span>
          <span class="burncat-sub">${c.sub}</span>
        </span>
        <i class="burncat-go fa-solid fa-chevron-right"></i>
      </button>`).join("");
  }

  _replaceHTML(result, content) {
    content.innerHTML = `<div class="burncat-list">${result}</div>`;
    content.querySelectorAll(".burncat-card").forEach((el) => {
      el.addEventListener("click", () => {
        const card = CARDS.find((c) => c.id === el.dataset.card);
        try {
          card?.run();
        } catch (err) {
          console.error("burn-gambling | карточка упала:", err);
          ui.notifications.error(`Gambling: «${card?.title}» — ошибка (см. консоль)`);
        }
      });
    });
  }
}

// Каждая карточка — отдельная плитка в папке 🔥 Burn (плоский список).
// Окно GamblingCatalog оставлено в коде на будущее.
Hooks.once("ready", () => {
  CARDS.forEach((c, i) => {
    Hooks.callAll("hubRegisterTile", {
      moduleId: `gambling-${c.id}`,
      title: c.title,
      icon: c.icon,
      order: 60 + i,
      onClick: c.run
    });
  });
});
