export type SessionId = '1PM' | '6PM' | '8PM';

export type SheetTab =
  | 'Seller Bill'
  | '1PM'
  | '6PM'
  | '8PM'
  | 'Winning Number'
  | 'Prize List'
  | 'Limit Prize'
  | 'Archive';

export interface Seller {
  id: string;
  name: string;
  mobile: string;
  rate: number;
  due: number;
  joma: number;
}

export interface TicketEntryRow {
  id: string;
  name: string;
  item: string;
  start: string;
  end: string;
  qtyOverride: string;
  rangeOverride: string;
}

export type RowStatusType = 'empty' | 'ok' | 'warning' | 'overlimit' | 'invalid';

export interface OverLimitSellerShare {
  sellerName: string;
  qty: number;
  rowCount: number;
  items: string[];
}

export interface OverLimitBreakdownGroup {
  id: string;
  startNum: string;
  endNum: string;
  startInt: number;
  endInt: number;
  count: number;
  totalQtyPerNum: number;
  excessQtyPerNum: number;
  lastRowIndex?: number;
  lastSellerName?: string;
  sellers: OverLimitSellerShare[];
}

export interface ComputedTicketRow extends TicketEntryRow {
  rowIndex: number;
  resolvedName: string;
  isExcludedFromCount?: boolean;
  itemMultiplier: number;
  qty: number;
  range: number;
  startNumInt: number | null;
  rangeEndInt: number | null;
  limitStatus: string;
  statusType: RowStatusType;
  overLimitBreakdowns?: OverLimitBreakdownGroup[];
}

export interface SessionComputation {
  sessionId: SessionId;
  prefix: string;
  rows: ComputedTicketRow[];
  numberTotals: Float64Array;
  sellerQtyByUpperName?: Record<string, number>;
  totalQty: number;
  overLimitTotal: number;
  overLimitLines: string[];
  overLimitGroups?: OverLimitBreakdownGroup[];
  watchOver10Groups?: OverLimitBreakdownGroup[];
  waMessage: string;
  waUrl: string;
}

export interface ParsedWinningNumber {
  fullInt: number | null;
  win4DigitsInt: number;
  rank: string;
  rawNumber: string;
  isFirstOrSecond: boolean;
}

export type WinningRawBySession = Record<SessionId, string>;

export interface PrizeListRow {
  id: string;
  time: SessionId;
  name: string;
  number: string;
  rank: string;
  item: string;
  prize: number;
  vc: number;
  svc: number;
  total: number;
}

export interface LimitPrizeRow {
  id: string;
  time: SessionId;
  number: string;
  rank: string;
  item: string;
  excessQty: number;
  prize: number;
  vc: number;
  total: number;
  sellers?: OverLimitSellerShare[];
}

export interface LimitPrizeSessionGroup {
  sessionId: SessionId;
  rows: LimitPrizeRow[];
  sessionTotal: number;
  waMessage: string;
  waUrl: string;
}

export interface SellerBillRow extends Seller {
  mor: number;
  day: number;
  eve: number;
  sold: number;
  amt1pm: number;
  amt6pm: number;
  amt8pm: number;
  bill: number;
  prizeTotal: number;
  fresh: number;
  total: number;
  prizes: PrizeListRow[];
  waMessage: string;
  waUrl: string;
}

export type AppThemeId =
  | 'cobalt'
  | 'graphite'
  | 'teal'
  | 'emerald'
  | 'obsidian'
  | 'crimson'
  | 'sapphire'
  | 'amethyst'
  | 'navy';

export type SoundPackId = 'rhodes' | 'celesta' | 'marimba' | 'minimal';

export interface AgencyConfig {
  limitThreshold: number;
  sellerLimitThreshold?: number;
  disableOver10Watch?: boolean;
  whatsappNumber: string;
  excludedPrizeNames: string[];
  sheetPrefixMap: Record<SessionId, string>;
  itemOptions: string[];
  autoArchiveDaily: boolean;
  pausedAutoArchiveDate?: string;
  soundEnabled: boolean;
  soundPack?: SoundPackId;
  theme?: AppThemeId;
  themeVersion?: number;
  whatsappVersion?: number;
}

export interface ArchivedSellerSummary {
  name: string;
  mor: number;
  day: number;
  eve: number;
  sold: number;
  bill: number;
  prizeTotal: number;
  fresh: number;
  joma: number;
  due: number;
  total: number;
}

export interface DaySnapshot {
  id: string;
  date: string;
  savedAt: string;
  deletedAt?: string;
  trigger: 'manual' | 'daily-auto' | 'day-close';
  totalSold: number;
  totalBill: number;
  totalPrize: number;
  totalNetPayable: number;
  limitGrandTotal: number;
  overLimitTotals: Record<SessionId, number>;
  sellerSummaries: ArchivedSellerSummary[];
  prizeList: PrizeListRow[];
  limitPrizeGroups: LimitPrizeSessionGroup[];
  sellers: Seller[];
  entries: Record<SessionId, TicketEntryRow[]>;
  winningRaw: WinningRawBySession;
}

export interface AppState {
  date: string; // YYYY-MM-DD
  config: AgencyConfig;
  sellers: Seller[];
  extraNames: string[];
  entries: Record<SessionId, TicketEntryRow[]>;
  winningRaw: WinningRawBySession;
  history: DaySnapshot[];
  recycleBin?: DaySnapshot[];
}
