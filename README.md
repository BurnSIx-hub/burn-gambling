# 🔥 Gambling

Модуль-картотека азартных игр для Foundry VTT (v13/v14). Объединяет две игры
в одном модуле; каждая открывается своей иконкой из папки **🔥 Burn**
(группа в Scene Controls, создаётся модулем [BurnHub](https://github.com/BurnSIx-hub/burnhub)).

## Игры

- **Card Games** (`poker/`) — карточный игровой стол (бывший `poker-table-vtt`).
- **Horse Racing** (`horse/`) — скачки-тотализатор со ставками (бывший `horse-racing`).

## Особенности слияния

Код прежних модулей перенесён в подпапки почти без изменений. Настройки миров
читаются под **старыми** namespace (`poker-table-vtt`, `horse-racing`), поэтому
данные существующих миров подхватываются без миграции. Socket-канал —
общий `module.burn-gambling` (сообщения различаются по типу).

## Интеграция с BurnHub

Каждая игра регистрирует свою плитку через публичный хук — без жёсткой
зависимости от хаба:

```js
Hooks.callAll("hubRegisterTile", { moduleId, title, icon, onClick, order });
```

Если BurnHub не установлен, вызов просто уходит в никуда.

## Установка

Сначала поставьте [BurnHub](https://github.com/BurnSIx-hub/burnhub) — без него
модуль не запустится (он объявлен как обязательная зависимость, а в официальном
каталоге пакетов Foundry его нет, поэтому автоматически он не подтянется):

```
https://github.com/BurnSIx-hub/burnhub/releases/latest/download/module.json
```

Затем сам модуль. В Foundry: *Add-on Modules → Install Module →* поле
**Manifest URL**:

```
https://github.com/BurnSIx-hub/burn-gambling/releases/latest/download/module.json
```

Такая установка даёт автообновление при следующих релизах.

Вручную: скачать `module.zip` из
[последнего релиза](https://github.com/BurnSIx-hub/burn-gambling/releases/latest)
и распаковать в `Data/modules/burn-gambling`.

## Лицензия

Код — MIT, см. [LICENSE](LICENSE). Встроенные шрифты (Alegreya, Caveat,
Pacifico) распространяются по SIL Open Font License 1.1 — см.
[NOTICE.md](NOTICE.md).

---
Автор: Vyazn & Claude
