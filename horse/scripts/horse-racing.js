/**
 * Horse Racing Totalizator — GTA SA style
 * Foundry VTT v12/v13
 */

const MODULE_ID    = 'horse-racing';
const SOCKET_EVENT = 'module.burn-gambling'; // единый канал контейнера

const HORSES = [
  { id: 'white',  name: 'Лошадь 1', color: '#dddddd', dark: '#888' },
  { id: 'yellow', name: 'Лошадь 2', color: '#f5c518', dark: '#a07800' },
  { id: 'blue',   name: 'Лошадь 3', color: '#3a9eff', dark: '#1a5fa8' },
  { id: 'green',  name: 'Лошадь 4', color: '#3ddd3d', dark: '#1a7a1a' },
  { id: 'red',    name: 'Лошадь 5', color: '#ff4444', dark: '#a01a1a' },
];

const ODDS_POOL = [1.5, 2, 2.5, 3, 4, 5, 6, 8];

// ─────────────────────────────────────────────
Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'raceState', {
    scope: 'world', config: false, type: Object, default: {}
  });
  game.settings.register(MODULE_ID, 'playerBalances', {
    scope: 'world', config: false, type: Object, default: {}
  });
  game.settings.register(MODULE_ID, 'currencyName', {
    name: 'Название валюты', scope: 'world', config: true, type: String, default: 'монет'
  });
});

Hooks.once('ready', () => {
  game.socket.on(SOCKET_EVENT, handleSocket);

  // v13.351 no longer fires getSceneControlButtons.
  // Inject button directly into DOM after controls render.
  setTimeout(() => _doInject(), 600);
  setTimeout(() => _doInject(), 2500);
  Hooks.on('renderSceneControls', () => _doInject());
  Hooks.on('renderApplication',   () => _doInject());

  Hooks.on('chatMessage', (_log, msg) => {
    if (msg.trim().toLowerCase() === '/races') { openApp(); return false; }
  });
});

function _doInject() {
  if (game.modules.get("burnhub")?.active) return; // с BurnHub кнопка в папке 🔥 Burn; без него — своя (видна всем)
  if (document.getElementById('hr-toolbar-btn')) return;

  // Foundry v13.351 structure:
  // <aside id="scene-controls">
  //   <menu class="flexcol" data-tooltip-direction="RIGHT">
  //     <li><button class="control ui-control layer icon ..."></button></li>
  //   </menu>
  // </aside>
  const menu = document.querySelector('#scene-controls menu') ||
               document.querySelector('#scene-controls');
  if (!menu) {
    console.warn('[horse-racing] scene-controls not found');
    return;
  }

  const li  = document.createElement('li');
  li.id     = 'hr-toolbar-btn';

  const btn = document.createElement('button');
  btn.type      = 'button';
  btn.className = 'control ui-control layer icon fa-solid fa-horse-head';
  btn.title     = 'Тотализатор';
  btn.setAttribute('aria-label', 'Тотализатор');
  btn.setAttribute('data-tooltip', 'Тотализатор');
  btn.addEventListener('click', openApp);

  li.appendChild(btn);
  menu.appendChild(li);
  console.log('[horse-racing] Toolbar button injected OK');
}

function openApp() {
  // Строгий синглтон: во время асинхронного рендера instance уже есть,
  // но rendered ещё false — старая проверка плодила второе окно.
  if (HorseRacingApp.instance) {
    HorseRacingApp.instance.render(true);
    // bringToTop только у отрендеренного окна: у окна в процессе первого
    // рендера element ещё null — был краш getComputedStyle(null)
    if (HorseRacingApp.instance.rendered) HorseRacingApp.instance.bringToTop();
    return;
  }
  new HorseRacingApp().render(true);
}

// ─────────────────────────────────────────────
// SOCKET
// ─────────────────────────────────────────────
function handleSocket(data) {
  switch (data.type) {
    case 'openApp':   openApp(); break;
    case 'syncState': HorseRacingApp.instance?.onSync(data.state, data.balances); break;
    case 'placeBet':  if (game.user.isGM) gmHandleBet(data.userId, data.horseId, data.amount); break;
    case 'startRace': HorseRacingApp.instance?.beginRace(data.winner, data.speeds); break;
  }
}
function emit(data) { game.socket.emit(SOCKET_EVENT, data); }

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
function getState()    { return game.settings.get(MODULE_ID, 'raceState')      || {}; }
function getBalances() { return game.settings.get(MODULE_ID, 'playerBalances') || {}; }

async function saveState(s) {
  await game.settings.set(MODULE_ID, 'raceState', s);
  broadcastSync(s);
}
async function saveBalances(b) {
  await game.settings.set(MODULE_ID, 'playerBalances', b);
  broadcastSync(getState(), b);
}
function broadcastSync(state, balances) {
  const bal = balances ?? getBalances();
  emit({ type: 'syncState', state, balances: bal });
  HorseRacingApp.instance?.onSync(state, bal);
}

async function gmHandleBet(userId, horseId, amount) {
  const state = getState();
  if (state.phase !== 'betting') return;
  const bal = getBalances();
  const isGmUser = game.users.get(userId)?.isGM;
  if (!isGmUser) { // ГМ ставит из бесконечного кошелька, баланс не трогаем
    if ((bal[userId] || 0) < amount) return;
    bal[userId] = (bal[userId] || 0) - amount;
  }
  if (!state.bets) state.bets = {};
  if (!state.bets[userId]) state.bets[userId] = {};
  state.bets[userId][horseId] = (state.bets[userId][horseId] || 0) + amount;
  await game.settings.set(MODULE_ID, 'playerBalances', bal);
  await game.settings.set(MODULE_ID, 'raceState', state);
  broadcastSync(state, bal);
}

// ─────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────
class HorseRacingApp extends Application {
  static instance = null;
  _interval  = null;
  _bgOffset  = 0;
  _positions = {};
  _speeds    = {};
  _winner    = null;
  _done      = false;

  constructor(...args) { super(...args); HorseRacingApp.instance = this; }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'horse-racing-app',
      title: '🏇 Тотализатор',
      width: 900, height: 680,
      resizable: true,
      classes: ['horse-racing-window'],
      template: `modules/burn-gambling/horse/templates/racing.html`,
    });
  }

  getData() {
    const state    = getState();
    const balances = getBalances();
    const uid      = game.user.id;
    const currency = game.settings.get(MODULE_ID, 'currencyName');
    const myBets   = (state.bets || {})[uid] || {};

    const horses = (state.horses || HORSES.map(h => ({...h}))).map((h, i) => ({
      ...h,
      num:      i + 1, // номер в таблице ({{@index1}} не существует в Handlebars)
      myBet:    myBets[h.id] || 0,
      totalBet: this._poolFor(h.id, state.bets || {}),
    }));
    // «Шанс» — обратная величина коэффициента, нормированная к лучшей лошади
    const raws = horses.map(h => 1 / (h.odds || 2));
    const maxRaw = Math.max(...raws, 0.001);
    horses.forEach((h, i) => { h.chance = Math.round((raws[i] / maxRaw) * 100); });

    const players = game.users.filter(u => !u.isGM).map(u => ({
      id: u.id, name: u.name, balance: (balances[u.id] || 0),
    }));

    return {
      isGM:        game.user.isGM,
      phase:       state.phase || 'setup',
      horses,
      players,
      currency,
      myBal:       game.user.isGM ? '∞' : (balances[uid] || 0), // кошелёк ГМа бесконечен
      totalPool:   this._totalPool(state.bets || {}),
      winner:      state.winner || null,
      winnerHorse: horses.find(h => h.id === state.winner) || null,
      modulePath:  `modules/burn-gambling/horse`,
    };
  }

  _poolFor(id, bets) {
    let t = 0;
    for (const u of Object.values(bets)) t += u[id] || 0;
    return t;
  }
  _totalPool(bets) {
    let t = 0;
    for (const u of Object.values(bets)) for (const v of Object.values(u)) t += v;
    return t;
  }
  _randOdds() { return ODDS_POOL[Math.floor(Math.random() * ODDS_POOL.length)]; }

  // ── LISTENERS ──────────────────────────────
  activateListeners(html) {
    super.activateListeners(html);
    if (game.user.isGM) {
      // id кнопок уникальны на весь шаблон: jQuery вешает обработчик
      // только на первый дубликат id, остальные остаются мёртвыми.
      html.find('#btn-open-bets').on('click',     () => this.gmOpenBets());
      html.find('#btn-open-bets-r').on('click',   () => this.gmOpenBets()); // с экрана результатов
      html.find('#btn-start-race').on('click',    () => this.gmStart());
      html.find('#btn-give-coins').on('click',    () => this.gmGive());
      html.find('#btn-give-coins-b').on('click',  () => this.gmGive()); // на экране ставок
      html.find('#btn-open-all').on('click',      () => emit({ type: 'openApp' }));
      html.find('#btn-back-setup').on('click',    () => this.gmBackToSetup());
      html.find('#btn-back-results').on('click',  () => this.gmBackFromResults());
      html.find('.name-input').on('change',       e  => this.gmRename(e));

      // Восстановление: мир завис в фазе racing (окно закрыли во время гонки,
      // краш и т.п.) — анимации нет, значит доигрываем результат по
      // сохранённому победителю, иначе новую гонку не начать.
      if ((getState().phase === 'racing') && !this._interval && !this._raceActive) {
        this._resolved = false;
        setTimeout(() => this._resolve(), 400);
      }
    }
    html.find('.horse-row').on('click',   e => this.selectHorse(e, html));
    html.find('#btn-bet').on('click',     () => this.placeBet(html));
    html.find('#bet-amount').on('input',  e => this.updateBetBtn(html));
    html.find('.quick-bet').on('click',   e => {
      html.find('.quick-bet').removeClass('active');
      $(e.currentTarget).addClass('active');
      html.find('#bet-amount').val($(e.currentTarget).data('v'));
      this.updateBetBtn(html);
    });
  }

  selectHorse(e, html) {
    html.find('.horse-row').removeClass('selected');
    $(e.currentTarget).addClass('selected');
    const id   = $(e.currentTarget).data('horse');
    const h    = (getState().horses || HORSES).find(h => h.id === id);
    const odds = h?.odds || '—';
    html.find('#sel-name').text(h?.name || '—').css('color', h?.color || '#aaa');
    html.find('#sel-odds').text(`×${odds}`);
    this.updateBetBtn(html);
  }

  updateBetBtn(html) {
    const sel = html.find('.horse-row.selected').length > 0;
    const amt = parseInt(html.find('#bet-amount').val()) || 0;
    html.find('#btn-bet').prop('disabled', !sel || amt < 1);
  }

  async placeBet(html) {
    const horseId = html.find('.horse-row.selected').data('horse');
    const amount  = parseInt(html.find('#bet-amount').val()) || 0;
    if (!horseId || amount < 1) return;
    if (!game.user.isGM) { // у ГМа кошелёк бесконечный — без проверки
      const myBal = (getBalances())[game.user.id] || 0;
      if (myBal < amount) { ui.notifications.warn('Недостаточно средств!'); return; }
    }
    if (game.user.isGM) await gmHandleBet(game.user.id, horseId, amount);
    else emit({ type: 'placeBet', userId: game.user.id, horseId, amount });
    html.find('#bet-amount').val('');
    html.find('.horse-row').removeClass('selected');
    html.find('.quick-bet').removeClass('active');
    html.find('#btn-bet').prop('disabled', true);
    ui.notifications.info('Ставка принята!');
  }

  // ── GM ─────────────────────────────────────
  // «Новая гонка» удалена: «Открыть ставки» сама перебрасывает кэфы и
  // чистит ставки, отдельный сброс в setup был избыточен и путал.
  async gmOpenBets() {
    const s = getState();
    s.phase  = 'betting';
    s.horses = (s.horses || HORSES.map(h=>({...h}))).map(h => ({...h, odds: this._randOdds()}));
    s.bets   = {};
    await saveState(s);
    this.render(true);
    ChatMessage.create({ content: `🏇 <b>Ставки открыты!</b> Делайте ставки — гонка скоро начнётся.` });
  }

  /** ГМ: вернуться с экрана ставок на стартовый, вернув игрокам ставки */
  async gmBackToSetup() {
    const s   = getState();
    const bal = getBalances();
    for (const [uid, bets] of Object.entries(s.bets || {})) {
      if (game.users.get(uid)?.isGM) continue; // кошелёк ГМа бесконечен
      const sum = Object.values(bets).reduce((a, v) => a + v, 0);
      if (sum > 0) bal[uid] = (bal[uid] || 0) + sum;
    }
    s.bets  = {};
    s.phase = 'setup';
    await game.settings.set(MODULE_ID, 'playerBalances', bal);
    await saveState(s);
    this.render(true);
    ChatMessage.create({ content: '🏇 Приём ставок отменён, ставки возвращены.' });
  }

  /** ГМ: с экрана результатов назад на стартовый (ставки уже выплачены) */
  async gmBackFromResults() {
    const s = getState();
    s.phase = 'setup';
    await saveState(s);
    this.render(true);
  }

  async gmStart() {
    const s = getState();
    if (s.phase !== 'betting') return; // защита от двойного клика по СТАРТ
    s.phase  = 'racing';
    const forced = this.element?.find('#force-winner')?.val();
    const winner = (forced && forced !== 'random')
      ? forced
      : s.horses[Math.floor(Math.random() * s.horses.length)].id;
    s.winner = winner;
    const speeds = {};
    s.horses.forEach(h => {
      speeds[h.id] = h.id === winner ? 2.8 + Math.random() * 0.4 : 1.1 + Math.random() * 1.3;
    });
    await saveState(s);
    emit({ type: 'startRace', winner, speeds });
    this.beginRace(winner, speeds);
  }

  gmGive() {
    new Dialog({
      title: '💰 Выдать монеты',
      content: `<div style="padding:8px 0">
        <p style="color:#aaa;font-size:.85em;margin-bottom:8px">Игрок:</p>
        <select id="gc-p" style="width:100%;background:#1a1a2e;color:#eee;border:1px solid #555;border-radius:4px;padding:5px;margin-bottom:10px">
          <option value="all">— Всем игрокам —</option>
          ${game.users.filter(u=>!u.isGM).map(u=>`<option value="${u.id}">${u.name}</option>`).join('')}
        </select>
        <p style="color:#aaa;font-size:.85em;margin-bottom:8px">Сумма:</p>
        <input id="gc-a" type="number" min="1" value="100"
          style="width:100%;background:#1a1a2e;color:#eee;border:1px solid #555;border-radius:4px;padding:5px">
      </div>`,
      buttons: {
        ok: { icon:'<i class="fas fa-coins"></i>', label:'Выдать', callback: async html => {
          const who = html.find('#gc-p').val();
          const amt = parseInt(html.find('#gc-a').val()) || 0;
          if (amt < 1) return;
          const bal = getBalances();
          const ids = who === 'all' ? game.users.filter(u=>!u.isGM).map(u=>u.id) : [who];
          ids.forEach(id => { bal[id] = (bal[id]||0) + amt; });
          await saveBalances(bal);
          const cur = game.settings.get(MODULE_ID, 'currencyName');
          const name = who === 'all' ? 'всем игрокам' : game.users.get(who)?.name;
          ChatMessage.create({ content: `💰 Выдано <b>${amt} ${cur}</b> → ${name}.` });
          this.render(false);
        }},
        no: { label: 'Отмена' }
      }, default: 'ok',
    }).render(true);
  }

  gmRename(e) {
    const id = e.currentTarget.dataset.horse;
    const s  = getState();
    const h  = s.horses?.find(h => h.id === id);
    if (h) { h.name = e.currentTarget.value.trim() || 'Лошадь'; saveState(s); }
  }

  // ── SYNC ───────────────────────────────────
  onSync(state, balances) {
    if (!this.rendered) return;
    const cur  = game.settings.get(MODULE_ID, 'currencyName');
    const myBal = game.user.isGM ? '∞' : ((balances||{})[game.user.id] || 0);
    this.element.find('.my-balance').text(`${myBal} ${cur}`);
    (state.horses||[]).forEach(h => {
      this.element.find(`.odds-chip[data-horse="${h.id}"]`).text(`×${h.odds}`);
      this.element.find(`.pool-num[data-horse="${h.id}"]`).text(this._poolFor(h.id, state.bets||{}));
    });
    this.element.find('#total-pool').text(this._totalPool(state.bets||{}));
    // Экран гонки строится вручную в beginRace — рендер здесь стёр бы дорожки
    // (это и ломало гонку: syncState после gmStart вызывал полный ре-рендер).
    if (state.phase === 'racing') return;
    const curPhase = this.element.find('.hr-root').data('phase');
    if (curPhase !== state.phase) this.render(true);
  }

  /** Пока идёт анимация гонки, любые перерисовки запрещены —
   *  полный рендер уничтожает построенные вручную дорожки. */
  render(force, options = {}) {
    if (this._raceActive && !options.endRace) return this;
    return super.render(force, options);
  }

  // ── RACE ───────────────────────────────────
  beginRace(winner, speeds) {
    if (this._interval) clearInterval(this._interval);

    const state  = getState();
    const horses = state.horses || HORSES.map(h=>({...h}));

    this._winner     = winner;
    this._done       = false;
    this._resolved   = false;
    this._raceActive = true; // блокирует ре-рендеры до конца гонки
    this._bgOffset  = 0;
    this._positions = {};
    this._speeds    = {};
    horses.forEach(h => {
      this._positions[h.id] = 0;
      this._speeds[h.id]    = speeds[h.id] || 1.5;
    });

    // Switch to race screen FIRST.
    // ВАЖНО: только классами! .hidden объявлен с !important, поэтому
    // jQuery .show() его НЕ пробивает — экран гонки оставался скрыт
    // (чёрное окно, ширина трека мерилась у display:none элемента).
    this.element.find('.screen-betting, .screen-setup, .screen-results').addClass('hidden');
    const raceScreen = this.element.find('.screen-race');
    raceScreen.removeClass('hidden');

    // Build lanes HTML
    const lanesEl = this.element.find('#race-lanes')[0];
    if (!lanesEl) {
      console.error('[horse-racing] #race-lanes not found!');
      return;
    }

    lanesEl.innerHTML = horses.map((h, i) => `
      <div class="race-lane" data-horse="${h.id}">
        <div class="lane-num" style="background:${h.color};color:#111">${i+1}</div>
        <div class="lane-track" id="lt-${h.id}">
          <div class="horse-wrap" id="hw-${h.id}" style="left:0px">
            <img src="modules/burn-gambling/horse/assets/horses/horse_${h.id}_frame1.png"
                 id="hi-${h.id}" class="horse-img" alt="">
          </div>
          <div class="finish-pole"></div>
        </div>
      </div>
    `).join('');

    // Wait 200ms for browser to paint and calculate layout
    setTimeout(() => {
      // Measure track width from first lane
      const firstTrack = document.getElementById('lt-' + horses[0].id);
      const trackW = firstTrack ? Math.max(firstTrack.clientWidth - 200, 200) : 500;
      console.log('[horse-racing] Track width:', trackW);

      let tick = 0;
      const frames = [1,2,3,2];

      this._interval = setInterval(() => {
        if (this._done) return;
        tick++;
        const fi = frames[tick % 4];
        let finished = false;

        horses.forEach(h => {
          if (this._positions[h.id] >= trackW) return;
          const wobble = (Math.random() - 0.47) * 0.5;
          this._positions[h.id] = Math.min(
            this._positions[h.id] + (this._speeds[h.id] + wobble) * 1.3,
            trackW
          );

          const wrap = document.getElementById('hw-' + h.id);
          const img  = document.getElementById('hi-' + h.id);
          if (wrap) wrap.style.left = Math.round(this._positions[h.id]) + 'px';
          if (img)  img.src = `modules/burn-gambling/horse/assets/horses/horse_${h.id}_frame${fi}.png`;

          if (h.id === winner && this._positions[h.id] >= trackW) finished = true;
        });

        // Parallax — stop when race ends
        this._bgOffset = (this._bgOffset + 3) % 2000;
        const bg = document.getElementById('race-bg');
        if (bg) bg.style.backgroundPositionX = '-' + this._bgOffset + 'px';

        if (finished) {
          this._done = true;
          clearInterval(this._interval);
          // Show winner banner
          const wh = horses.find(h => h.id === winner);
          const bar = document.getElementById('winner-bar');
          const nm  = document.getElementById('winner-name');
          if (bar) bar.style.display = 'block';
          if (nm)  nm.textContent = wh?.name || winner;
          setTimeout(() => this._resolve(), 2000);
        }
      }, 80);
    }, 200);
  }

  async _resolve() {
    if (this._resolved) return; // защита от двойного вызова
    this._resolved   = true;
    this._raceActive = false;   // рендеры снова разрешены

    const state = getState();
    state.phase = 'results';
    const wh    = state.horses?.find(h => h.id === state.winner);
    const odds  = wh?.odds || 2;
    const cur   = game.settings.get(MODULE_ID, 'currencyName');

    if (game.user.isGM) {
      const bal  = getBalances();
      const pays = [];
      for (const [uid, bets] of Object.entries(state.bets||{})) {
        const bet = bets[state.winner] || 0;
        if (bet > 0) {
          const win = Math.floor(bet * odds);
          // ГМу выигрыш в баланс не пишем — его кошелёк бесконечен
          if (!game.users.get(uid)?.isGM) bal[uid] = (bal[uid]||0) + win;
          pays.push({ name: game.users.get(uid)?.name || uid, win });
        }
      }
      await game.settings.set(MODULE_ID, 'playerBalances', bal);
      await saveState(state);

      let msg = `🏆 <b>Победитель: ${wh?.name || state.winner}!</b> (×${odds})<br><br>`;
      msg += pays.length
        ? `<b>Выплаты:</b><br>` + pays.map(p=>`• ${p.name}: <b>${p.win} ${cur}</b>`).join('<br>')
        : `Никто не поставил на победителя.`;
      ChatMessage.create({ content: msg });
      this.render(true);
    }
    // Игроки не рендерятся сами: дождутся syncState от ГМа с фазой results,
    // иначе они бы перерисовали экран гонки со старой фазой racing.
  }

  close(...args) {
    if (this._interval) clearInterval(this._interval);
    this._raceActive = false;
    this._done = true;
    // Обнуляем синглтон, только если закрывается именно текущий экземпляр —
    // «зомби»-окно не должно красть ссылку у живого.
    if (HorseRacingApp.instance === this) HorseRacingApp.instance = null;
    return super.close(...args);
  }
}

window.HorseRacingApp = HorseRacingApp;

// ─── Экспорт для картотеки Gambling (scripts/catalog.js) ───
Hooks.once("ready", () => {
  game.burnGambling ??= {};
  game.burnGambling.openRacing = () => openApp();
});
