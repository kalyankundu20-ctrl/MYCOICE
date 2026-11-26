import { AppState, TicketEntryRow } from '../types/ledger';

export function createEmptyRow(): TicketEntryRow {
  return {
    id: crypto.randomUUID
      ? crypto.randomUUID()
      : `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    item: '',
    start: '',
    end: '',
    qtyOverride: '',
    rangeOverride: '',
  };
}

export function createBlankRows(count = 1): TicketEntryRow[] {
  return Array.from({ length: count }, () => createEmptyRow());
}

export function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function createEmptyAppState(): AppState {
  return {
    date: getTodayIsoDate(),
    config: {
      limitThreshold: 10,
      sellerLimitThreshold: 20,
      whatsappNumber: '918918692554',
      excludedPrizeNames: ['MY CHOICE'],
      sheetPrefixMap: {
        '1PM': 'M',
        '6PM': 'D',
        '8PM': 'E',
      },
      itemOptions: [
        'M5',
        'M10',
        'M15',
        'M20',
        'D5',
        'D10',
        'D15',
        'D20',
        'E5',
        'E10',
        'E15',
        'E20',
      ],
      autoArchiveDaily: false,
      soundEnabled: true,
      soundPack: 'rhodes',
      theme: 'sapphire',
      themeVersion: 3,
      whatsappVersion: 1,
    },
    sellers: [],
    extraNames: ['MY CHOICE'],
    entries: {
      '1PM': createBlankRows(1),
      '6PM': createBlankRows(1),
      '8PM': createBlankRows(1),
    },
    winningRaw: {
      '1PM': '',
      '6PM': '',
      '8PM': '',
    },
    history: [],
  };
}

export const DEFAULT_APP_STATE: AppState = createEmptyAppState();
