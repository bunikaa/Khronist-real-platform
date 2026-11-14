# apps/extension

Розширення Chrome (Manifest V3) на WXT 0.21 і React 19. Стилі й компоненти — з `@khronist/ui`.

## Запуск

- `pnpm --filter @khronist/extension dev` — WXT відкриває окремий Chrome із розширенням і перезбирає його при змінах.
- `pnpm --filter @khronist/extension build` — збірка в `.output/chrome-mv3`. Встановити: `chrome://extensions` → «Режим розробника» → «Завантажити розпаковане» → тека `.output/chrome-mv3`.
- `pnpm --filter @khronist/extension zip` — архів для GitHub Release.

`pnpm install` запускає `wxt prepare`, який генерує `.wxt/` з типами; без нього `tsconfig.json` не знайде базову конфігурацію.

## Що є

- `entrypoints/background.ts`: панель відкривається кліком по іконці (`sidePanel.setPanelBehavior`) і гарячою клавішею `Alt+Shift+X` (команда `open-panel` викликає `sidePanel.open`, як радить документація Chrome: відкриття лише у відповідь на дію користувача).
- `entrypoints/sidepanel/`: React-застосунок панелі; зараз лише `PanelHeader`.
- Дозволи: лише `sidePanel`. Нові дозволи додаються разом із функцією, якій вони потрібні.

Автоімпорти WXT вимкнено (`imports: false`): усе імпортується явно з `wxt/browser`, `wxt/utils/*` і пакетів.

Користувач може змінити гарячу клавішу на `chrome://extensions/shortcuts`; якщо `Alt+Shift+X` зайнята іншим розширенням, Chrome її не призначить.
