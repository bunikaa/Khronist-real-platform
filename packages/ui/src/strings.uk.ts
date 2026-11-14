import type { Shelfmark } from '@khronist/contracts'

export const strings = {
  brand: 'Хроніст',
  shelfmark: {
    place: (s: Shelfmark) => `${s.archive} · ф. ${s.fond}, оп. ${s.opys}, спр. ${s.sprava}`,
    page: (s: Shelfmark) => (s.folio === undefined ? `зобр. ${s.image}` : `арк. ${s.folio}`),
  },
  read: {
    promptTitle: 'Виділіть фрагмент скану',
    promptBody: 'Натисніть кнопку нижче або Alt + Shift + X, потім обведіть запис на аркуші.',
    selectFragment: 'Виділити фрагмент',
    selectingTitle: 'Обведіть запис на аркуші',
    selectingHint: 'Esc — скасувати',
    cancel: 'Скасувати',
  },
}
