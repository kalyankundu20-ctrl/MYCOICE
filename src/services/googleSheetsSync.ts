import { SessionId, TicketEntryRow } from '../types/ledger';

export interface GoogleSheetTabInfo {
  sheetId: number;
  title: string;
}

export interface GoogleSheetMetadata {
  spreadsheetId: string;
  title: string;
  tabs: GoogleSheetTabInfo[];
}

export interface GoogleSheetSyncConfig {
  spreadsheetId: string;
  spreadsheetTitle: string;
  tabMapping: Record<SessionId, string>;
  autoSync: boolean;
  pollSeconds: number;
}

export type GoogleSheetSyncMode = 'always-on' | 'oauth';

export interface GoogleSheetSyncResult {
  entriesBySession: Record<SessionId, TicketEntryRow[]>;
  rowCounts: Record<SessionId, number>;
  sellerNames: string[];
  syncedAt: string;
  syncMode: GoogleSheetSyncMode;
}

export class SheetsAuthExpiredError extends Error {
  constructor(message = 'Google Sheets permission expired. Please sign in with Google again.') {
    super(message);
    this.name = 'SheetsAuthExpiredError';
  }
}

export class SheetPrivateAuthRequiredError extends Error {
  constructor(
    message = 'Yeh Google Sheet abhi Private (Restricted) hai. 24/7 bina disconnect sync ke liye Google Sheets me Share -> Anyone with the link (Viewer) karein, ya "Sign in with Google" dabayein.'
  ) {
    super(message);
    this.name = 'SheetPrivateAuthRequiredError';
  }
}

const STORAGE_KEY = 'kk_agency_gsheet_sync_cfg_v1';
export const GSHEET_ROW_ID_PREFIX = 'gsheet::';

export function isGoogleSheetRowId(rowId: string): boolean {
  if (typeof rowId !== 'string') return false;
  return (
    rowId.startsWith(GSHEET_ROW_ID_PREFIX) ||
    rowId.startsWith(`admin::${GSHEET_ROW_ID_PREFIX}`)
  );
}

export function createDefaultGoogleSheetConfig(): GoogleSheetSyncConfig {
  return {
    spreadsheetId: '',
    spreadsheetTitle: '',
    tabMapping: {
      '1PM': '',
      '6PM': '',
      '8PM': '',
    },
    autoSync: true,
    pollSeconds: 10,
  };
}

/**
 * Non-sensitive spreadsheet ID & tab preferences only (OAuth tokens are NEVER stored here).
 */
export function loadGoogleSheetConfig(): GoogleSheetSyncConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultGoogleSheetConfig();
    const parsed = JSON.parse(raw) as Partial<GoogleSheetSyncConfig>;
    return {
      spreadsheetId: typeof parsed.spreadsheetId === 'string' ? parsed.spreadsheetId.trim() : '',
      spreadsheetTitle: typeof parsed.spreadsheetTitle === 'string' ? parsed.spreadsheetTitle : '',
      tabMapping: {
        '1PM': typeof parsed.tabMapping?.['1PM'] === 'string' ? parsed.tabMapping['1PM'] : '',
        '6PM': typeof parsed.tabMapping?.['6PM'] === 'string' ? parsed.tabMapping['6PM'] : '',
        '8PM': typeof parsed.tabMapping?.['8PM'] === 'string' ? parsed.tabMapping['8PM'] : '',
      },
      autoSync: parsed.autoSync !== false,
      pollSeconds:
        typeof parsed.pollSeconds === 'number' && parsed.pollSeconds >= 5 && parsed.pollSeconds <= 120
          ? parsed.pollSeconds
          : 10,
    };
  } catch {
    return createDefaultGoogleSheetConfig();
  }
}

export function saveGoogleSheetConfig(cfg: GoogleSheetSyncConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Extracts a Google Spreadsheet ID from either a full Google Sheets URL or a raw ID string.
 */
export function extractSpreadsheetId(input: string): string {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  if (idParamMatch && idParamMatch[1]) {
    return idParamMatch[1];
  }
  // Raw spreadsheet ID (usually 25-60 URL-safe characters)
  if (/^[a-zA-Z0-9-_]{15,}$/.test(trimmed)) {
    return trimmed;
  }
  return '';
}

function escapeSheetTitleForA1(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

/**
 * Fetches spreadsheet title and actual tab names dynamically (never hardcodes "Sheet1").
 */
export async function fetchSpreadsheetMetadata(
  spreadsheetId: string,
  accessToken: string
): Promise<GoogleSheetMetadata> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}?fields=properties.title,sheets.properties(title,sheetId)`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    throw new SheetsAuthExpiredError('Google Sheets session expired. Tap "Sign in with Google" to reconnect.');
  }

  if (!res.ok) {
    let errDetail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      errDetail = body.error?.message || '';
    } catch {
      // ignore json error
    }
    if (res.status === 403) {
      throw new Error(
        errDetail ||
          'Is Google Sheet ko open karne ki permission nahi hai. Check karein ki same Gmail se login hai jis par ye sheet hai.'
      );
    }
    if (res.status === 404) {
      throw new Error('Google Sheet nahi mili. Sheet URL ya ID check karke dubara paste karein.');
    }
    throw new Error(errDetail || `Google Sheets error (${res.status})`);
  }

  const data = (await res.json()) as {
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };

  const tabs: GoogleSheetTabInfo[] = (data.sheets || [])
    .map((s) => ({
      sheetId: Number(s.properties?.sheetId ?? 0),
      title: String(s.properties?.title || '').trim(),
    }))
    .filter((t) => t.title.length > 0);

  return {
    spreadsheetId,
    title: String(data.properties?.title || 'Untitled Spreadsheet'),
    tabs,
  };
}

/**
 * Automatically maps spreadsheet tab names to 1PM, 6PM, 8PM sessions.
 */
export function autoDetectSessionTabs(
  tabs: GoogleSheetTabInfo[],
  existing?: Partial<Record<SessionId, string>>
): Record<SessionId, string> {
  const tabTitles = tabs.map((t) => t.title);
  const titleSet = new Set(tabTitles);

  const pickTab = (sessionId: SessionId, patterns: RegExp[]): string => {
    const prev = existing?.[sessionId];
    if (prev && titleSet.has(prev)) return prev;
    for (const pat of patterns) {
      const match = tabTitles.find((t) => pat.test(t.trim()));
      if (match) return match;
    }
    return '';
  };

  return {
    '1PM': pickTab('1PM', [/^1\s*pm$/i, /\b1\s*pm\b/i, /\bmorning\b/i, /^mor$/i]),
    '6PM': pickTab('6PM', [/^6\s*pm$/i, /\b6\s*pm\b/i, /\bday\b/i]),
    '8PM': pickTab('8PM', [/^8\s*pm$/i, /\b8\s*pm\b/i, /\bevening\b/i, /^eve$/i]),
  };
}

interface DetectedColumns {
  headerRowIdx: number;
  nameCol: number;
  itemCol: number;
  startCol: number;
  endCol: number;
}

/**
 * Auto-detects Name / Item / Start / End column positions from header rows.
 * Supports both Col B..E (like KK Agency Google Sheet with hidden Col A) and Col A..D.
 */
function detectColumns(values: string[][]): DetectedColumns {
  const maxHeaderScan = Math.min(5, values.length);
  for (let r = 0; r < maxHeaderScan; r++) {
    const row = values[r] || [];
    let nameCol = -1;
    let itemCol = -1;
    let startCol = -1;
    let endCol = -1;

    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || '')
        .trim()
        .toLowerCase();
      if (!cell) continue;
      if (nameCol === -1 && (cell === 'name' || cell === 'seller' || cell === 'party' || cell === 'seller name')) {
        nameCol = c;
      } else if (itemCol === -1 && (cell === 'item' || cell === 'code' || cell === 'type')) {
        itemCol = c;
      } else if (startCol === -1 && (cell === 'start' || cell === 'number' || cell === 'from' || cell === 'ticket')) {
        startCol = c;
      } else if (endCol === -1 && (cell === 'end' || cell === 'to')) {
        endCol = c;
      }
    }

    if (itemCol !== -1 && startCol !== -1) {
      return {
        headerRowIdx: r,
        nameCol: nameCol !== -1 ? nameCol : Math.max(0, itemCol - 1),
        itemCol,
        startCol,
        endCol: endCol !== -1 ? endCol : startCol + 1,
      };
    }
  }

  // Fallback: inspect data rows to check if Col B..E or Col A..D has item codes like M5/D10/E5
  const itemPattern = /^[MDE]\s*\d+/i;
  let col1Hits = 0;
  let col2Hits = 0;
  for (let r = 0; r < Math.min(20, values.length); r++) {
    const row = values[r] || [];
    if (itemPattern.test(String(row[1] || '').trim())) col1Hits++;
    if (itemPattern.test(String(row[2] || '').trim())) col2Hits++;
  }

  if (col2Hits >= col1Hits) {
    // KK Agency default layout: Col A hidden, Col B = Name, Col C = Item, Col D = Start, Col E = End
    return { headerRowIdx: 0, nameCol: 1, itemCol: 2, startCol: 3, endCol: 4 };
  }
  return { headerRowIdx: 0, nameCol: 0, itemCol: 1, startCol: 2, endCol: 3 };
}

function normalizeSheetCellText(val: unknown): string {
  return String(val ?? '').trim();
}

function normalizeTicketDigits(val: unknown): string {
  const raw = normalizeSheetCellText(val);
  if (!raw || raw === '-' || raw === '—') return '';
  return raw.replace(/\D/g, '').slice(0, 5);
}

function parseSessionSheetValues(
  sessionId: SessionId,
  values: string[][]
): { rows: TicketEntryRow[]; sellerNames: Set<string> } {
  const sellerNames = new Set<string>();
  if (!values || values.length === 0) {
    return { rows: [], sellerNames };
  }

  const cols = detectColumns(values);
  const rows: TicketEntryRow[] = [];

  for (let r = cols.headerRowIdx + 1; r < values.length; r++) {
    const rawRow = values[r] || [];
    const name = normalizeSheetCellText(rawRow[cols.nameCol]).toUpperCase();
    const item = normalizeSheetCellText(rawRow[cols.itemCol]).toUpperCase().replace(/\s+/g, '');
    const start = normalizeTicketDigits(rawRow[cols.startCol]);
    const end = normalizeTicketDigits(rawRow[cols.endCol]);

    // Skip footer/summary rows like "TOTAL" or completely blank rows
    if (!item && !start && !end) {
      continue;
    }
    if (name === 'TOTAL' || name === 'GRAND TOTAL' || name === 'NAME') {
      continue;
    }

    if (name) {
      sellerNames.add(name);
    }

    const sheetRowNumber = r + 1; // 1-indexed spreadsheet row number (matches Row 2, Row 3... in Google Sheets)
    rows.push({
      id: `${GSHEET_ROW_ID_PREFIX}${sessionId}::${sheetRowNumber}`,
      name,
      item,
      start,
      end,
      qtyOverride: '',
      rangeOverride: '',
    });
  }

  return { rows, sellerNames };
}

interface GvizCell {
  v?: string | number | boolean | null;
  f?: string | null;
}

interface GvizResponsePayload {
  status?: string;
  errors?: Array<{ reason?: string; message?: string; detailed_message?: string }>;
  table?: {
    cols?: Array<{ id?: string; label?: string; type?: string }>;
    rows?: Array<{ c?: Array<GvizCell | null> }>;
  };
}

function parseGvizJsonpText(rawText: string): GvizResponsePayload {
  const marker = 'setResponse(';
  const idx = rawText.indexOf(marker);
  if (idx === -1) {
    // Non-GViz HTML (for example Google login page when sheet is Restricted)
    throw new SheetPrivateAuthRequiredError();
  }
  const startBrace = rawText.indexOf('{', idx + marker.length);
  const endBrace = rawText.lastIndexOf('}');
  if (startBrace === -1 || endBrace === -1 || endBrace <= startBrace) {
    throw new SheetPrivateAuthRequiredError();
  }
  const jsonStr = rawText.slice(startBrace, endBrace + 1);
  return JSON.parse(jsonStr) as GvizResponsePayload;
}

function gvizCellToString(cell: GvizCell | null | undefined): string {
  if (!cell) return '';
  if (cell.f !== undefined && cell.f !== null && String(cell.f).trim() !== '') {
    return String(cell.f).trim();
  }
  if (cell.v !== undefined && cell.v !== null) {
    return String(cell.v).trim();
  }
  return '';
}

/**
 * Fetches a single tab directly via Google Sheets GViz JSON endpoint (requires zero OAuth token
 * and NEVER expires when the spreadsheet has "Anyone with the link -> Viewer" enabled).
 */
async function fetchTabValuesViaGviz(spreadsheetId: string, tabTitle: string): Promise<string[][]> {
  const params = new URLSearchParams();
  params.set('tqx', 'out:json');
  params.set('sheet', tabTitle);
  params.set('range', 'A1:H2500');
  params.set('headers', '0');
  params.set('_', String(Date.now()));

  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
    spreadsheetId
  )}/gviz/tq?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    // When a Google Sheet is Restricted/Private, Google redirects to accounts.google.com which fails CORS.
    // If the browser itself is offline, report offline cleanly.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Internet offline hai. Network aate hi Google Sheet auto-sync ho jayegi.');
    }
    throw new SheetPrivateAuthRequiredError();
  }

  if (res.status === 401 || res.status === 403) {
    throw new SheetPrivateAuthRequiredError();
  }
  if (res.status === 404) {
    throw new Error('Google Sheet nahi mili. Sheet URL ya ID check karke dubara paste karein.');
  }
  if (!res.ok) {
    throw new Error(`Google Sheets direct sync error (${res.status})`);
  }

  const text = await res.text();
  const payload = parseGvizJsonpText(text);

  if (payload.status === 'error') {
    const firstErr = payload.errors?.[0];
    const reason = String(firstErr?.reason || '').toLowerCase();
    if (reason === 'access_denied' || reason === 'not_logged_in' || reason === 'user_not_authenticated') {
      throw new SheetPrivateAuthRequiredError();
    }
    if (reason === 'no_data' || reason === 'empty_table') {
      return [];
    }
    throw new Error(firstErr?.detailed_message || firstErr?.message || 'Google Sheet tab load nahi ho paya.');
  }

  const cols = payload.table?.cols || [];
  const rows = payload.table?.rows || [];
  const grid: string[][] = [];

  const labelRow = cols.map((c) => String(c.label || '').trim());
  const hasLabels = labelRow.some((lbl) => lbl.length > 0);
  if (hasLabels) {
    grid.push(labelRow);
  }

  for (const r of rows) {
    const cells = r.c || [];
    grid.push(cells.map((cell) => gvizCellToString(cell)));
  }

  return grid;
}

/**
 * 24/7 Always-On Direct Sync for link-shared sheets ("Anyone with the link -> Viewer").
 * Works permanently across iPhone/Android restarts without OAuth token expiry!
 */
export async function fetchSessionRowsViaDirectGviz(
  spreadsheetId: string,
  tabMapping: Record<SessionId, string>
): Promise<GoogleSheetSyncResult> {
  const activePairs: Array<{ sessionId: SessionId; tabTitle: string }> = [];
  (['1PM', '6PM', '8PM'] as SessionId[]).forEach((sid) => {
    const title = (tabMapping[sid] || '').trim();
    if (title) {
      activePairs.push({ sessionId: sid, tabTitle: title });
    }
  });

  const emptyResult: GoogleSheetSyncResult = {
    entriesBySession: { '1PM': [], '6PM': [], '8PM': [] },
    rowCounts: { '1PM': 0, '6PM': 0, '8PM': 0 },
    sellerNames: [],
    syncedAt: new Date().toISOString(),
    syncMode: 'always-on',
  };

  if (activePairs.length === 0) {
    return emptyResult;
  }

  const grids = await Promise.all(
    activePairs.map((pair) => fetchTabValuesViaGviz(spreadsheetId, pair.tabTitle))
  );

  const entriesBySession: Record<SessionId, TicketEntryRow[]> = {
    '1PM': [],
    '6PM': [],
    '8PM': [],
  };
  const rowCounts: Record<SessionId, number> = {
    '1PM': 0,
    '6PM': 0,
    '8PM': 0,
  };
  const allSellers = new Set<string>();

  activePairs.forEach((pair, idx) => {
    const parsed = parseSessionSheetValues(pair.sessionId, grids[idx] || []);
    entriesBySession[pair.sessionId] = parsed.rows;
    rowCounts[pair.sessionId] = parsed.rows.length;
    parsed.sellerNames.forEach((n) => allSellers.add(n));
  });

  return {
    entriesBySession,
    rowCounts,
    sellerNames: Array.from(allSellers),
    syncedAt: new Date().toISOString(),
    syncMode: 'always-on',
  };
}

/**
 * Fetches live 1PM, 6PM, 8PM entry rows from the connected Google Sheet via official Sheets API v4.
 */
export async function fetchSessionRowsFromGoogleSheet(
  spreadsheetId: string,
  tabMapping: Record<SessionId, string>,
  accessToken: string
): Promise<GoogleSheetSyncResult> {
  const activePairs: Array<{ sessionId: SessionId; tabTitle: string; range: string }> = [];
  (['1PM', '6PM', '8PM'] as SessionId[]).forEach((sid) => {
    const title = (tabMapping[sid] || '').trim();
    if (title) {
      activePairs.push({
        sessionId: sid,
        tabTitle: title,
        range: `${escapeSheetTitleForA1(title)}!A1:H2500`,
      });
    }
  });

  const emptyResult: GoogleSheetSyncResult = {
    entriesBySession: { '1PM': [], '6PM': [], '8PM': [] },
    rowCounts: { '1PM': 0, '6PM': 0, '8PM': 0 },
    sellerNames: [],
    syncedAt: new Date().toISOString(),
    syncMode: 'oauth',
  };

  if (activePairs.length === 0) {
    return emptyResult;
  }

  const params = new URLSearchParams();
  activePairs.forEach((p) => params.append('ranges', p.range));
  params.set('valueRenderOption', 'FORMATTED_VALUE');
  params.set('majorDimension', 'ROWS');

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values:batchGet?${params.toString()}`;

  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    throw new SheetsAuthExpiredError('Google Sheets session expired. Tap "Sign in with Google" to reconnect.');
  }

  if (!res.ok) {
    let errDetail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      errDetail = body.error?.message || '';
    } catch {
      // ignore json parse errors
    }
    throw new Error(errDetail || `Google Sheets sync error (${res.status})`);
  }

  const data = (await res.json()) as {
    valueRanges?: Array<{ range?: string; values?: string[][] }>;
  };

  const valueRanges = data.valueRanges || [];
  const entriesBySession: Record<SessionId, TicketEntryRow[]> = {
    '1PM': [],
    '6PM': [],
    '8PM': [],
  };
  const rowCounts: Record<SessionId, number> = {
    '1PM': 0,
    '6PM': 0,
    '8PM': 0,
  };
  const allSellers = new Set<string>();

  activePairs.forEach((pair, idx) => {
    const vr = valueRanges[idx];
    const parsed = parseSessionSheetValues(pair.sessionId, vr?.values || []);
    entriesBySession[pair.sessionId] = parsed.rows;
    rowCounts[pair.sessionId] = parsed.rows.length;
    parsed.sellerNames.forEach((n) => allSellers.add(n));
  });

  return {
    entriesBySession,
    rowCounts,
    sellerNames: Array.from(allSellers),
    syncedAt: new Date().toISOString(),
    syncMode: 'oauth',
  };
}

/**
 * Smart dual-mode live sync:
 * 1. If an in-memory OAuth access token is present, uses official Sheets API v4.
 *    If that token expires (401), automatically falls back to 24/7 Always-On Direct Sync before failing.
 * 2. If no OAuth token is in memory (e.g., after reopening iPhone Home Screen app),
 *    automatically uses 24/7 Always-On Direct Sync so the sheet NEVER disconnects.
 */
export async function fetchSessionRowsSmart(
  spreadsheetId: string,
  tabMapping: Record<SessionId, string>,
  accessToken: string | null
): Promise<GoogleSheetSyncResult> {
  if (accessToken) {
    try {
      return await fetchSessionRowsFromGoogleSheet(spreadsheetId, tabMapping, accessToken);
    } catch (err) {
      if (err instanceof SheetsAuthExpiredError) {
        // Seamless fallback to 24/7 Always-On Direct Sync if the sheet is link-shared
        try {
          return await fetchSessionRowsViaDirectGviz(spreadsheetId, tabMapping);
        } catch {
          // If the sheet is strictly private, surface the original expired-auth error
          throw err;
        }
      }
      throw err;
    }
  }

  return await fetchSessionRowsViaDirectGviz(spreadsheetId, tabMapping);
}
