# apps/extension

Розширення Chrome (Manifest V3) на WXT 0.21 і React 19. Стилі й компоненти — з `@khronist/ui`.

## Запуск

- `pnpm --filter @khronist/extension dev` — WXT відкриває окремий Chrome із розширенням і перезбирає його при змінах.
- `pnpm --filter @khronist/extension build` — збірка в `.output/chrome-mv3`. Встановити: `chrome://extensions` → «Режим розробника» → «Завантажити розпаковане» → тека `.output/chrome-mv3`.
- `pnpm --filter @khronist/extension zip` — архів для GitHub Release.

`pnpm install` запускає `wxt prepare`, який генерує `.wxt/` з типами; без нього `tsconfig.json` не знайде базову конфігурацію.

## Що є

- `entrypoints/background.ts`: панель відкривається кліком по іконці (`sidePanel.setPanelBehavior`) і гарячою клавішею `Alt+Shift+X` (команда `open-panel` викликає `sidePanel.open`, як радить документація Chrome: відкриття лише у відповідь на дію користувача).
- `entrypoints/archium.content.ts`: content script на е-ресурсах ARCHIUM (поки лише `archium.cdiak.archives.gov.ua`). На сторінці переглядача `/file-viewer/:id` читає шифр і надсилає його панелі; перераховує при зміні адреси (`wxt:locationchange`, зокрема хеш `#file-…`) і коли застосунок дорендерює сторінку.
- `portal/archium.ts`: читання шифру. Фонд, опис і справа беруться з посилань `/fonds/`, `/inventories/`, `/files/` у блоці `.description-item` (не з підписів, бо в ARCHIUM є англійська версія). Номер зображення — `data-page` того елемента стрічки `#all-images`, чий `src` збігається з `img#main-image`, тобто того скану, що на екрані. Архів визначає хост: `archium.cdiak.archives.gov.ua` → «ЦДІАК України». Розмітку описано в `docs/portal-searcharchives.md`, розділ 6.
- `entrypoints/sidepanel/`: React-застосунок панелі. `useActivePage` питає content script активної вкладки (`tabs.sendMessage`), слухає його повідомлення й оновлюється при перемиканні вкладок. Повідомлення перевіряються схемами з `messages.ts`.
- Дозволи: лише `sidePanel`; доступ до сторінок ARCHIUM дає `content_scripts.matches`. Нові дозволи додаються разом із функцією, якій вони потрібні.

Тести (`pnpm --filter @khronist/extension test`, jsdom) читають шифр із `test/fixtures/archium-viewer.html` — скороченої розмітки переглядача справи ф. 127, оп. 1078, спр. 177.

Автоімпорти WXT вимкнено (`imports: false`): усе імпортується явно з `wxt/browser`, `wxt/utils/*` і пакетів.

Користувач може змінити гарячу клавішу на `chrome://extensions/shortcuts`; якщо `Alt+Shift+X` зайнята іншим розширенням, Chrome її не призначить.
