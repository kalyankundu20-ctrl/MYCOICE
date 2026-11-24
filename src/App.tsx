import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { Archive, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AdminAnnouncementModal } from './components/AdminAnnouncementModal';
import { AnnouncementBanner } from './components/AnnouncementBanner';
import { AppShell } from './components/AppShell';
import { ArchiveView } from './components/ArchiveView';
import { GoogleSheetsSyncModal } from './components/GoogleSheetsSyncModal';
import { LimitPrizeView } from './components/LimitPrizeView';
import { LiveChainEntriesPanel } from './components/LiveChainEntriesPanel';
import { MessagePreviewModal } from './components/MessagePreviewModal';
import { PrizeListView } from './components/PrizeListView';
import { SellerBillView } from './components/SellerBillView';
import { SellerIdManagerModal } from './components/SellerIdManagerModal';
import { SellerLoginView } from './components/SellerLoginView';
import { SellerPortalApp } from './components/SellerPortalApp';
import { SessionSheetView } from './components/SessionSheetView';
import { SettingsDrawer } from './components/SettingsDrawer';
import { WinningNumberView } from './components/WinningNumberView';
import { BillReceiptPayload } from './utils/billImageGenerator';
import {
  auth,
  clearGoogleSheetsAccessToken,
  ensureAnonymousSellerAuth,
  formatFirebaseAuthError,
  getGoogleSheetsAccessToken,
  googleProvider,
  isGoogleSheetsTokenExpiringSoon,
  popupRedirectResolver,
  signInForGoogleSheets,
  subscribeGoogleSheetsTokenState,
  trySilentGoogleSheetsTokenRefresh,
} from './firebase';
import {
  autoDetectSessionTabs,
  createDefaultGoogleSheetConfig,
  fetchSessionRowsSmart,
  fetchSpreadsheetMetadata,
  GoogleSheetSyncConfig,
  GoogleSheetTabInfo,
  isGoogleSheetRowId,
  loadGoogleSheetConfig,
  saveGoogleSheetConfig,
  SheetPrivateAuthRequiredError,
  SheetsAuthExpiredError,
} from './services/googleSheetsSync';
import {
  AGENCY_ID,
  bootstrapAdminAgency,
  CloudAgencyDoc,
  CloudAnnouncementKind,
  CloudPartyDoc,
  CloudPartyPrivateDoc,
  CloudPartySheetDoc,
  CloudPublicAnnouncement,
  computeFullAncestorChainFromParties,
  createOrSyncSellerParty,
  createSubSellerForMasterByAdmin,
  deleteSellerPartyCloud,
  deleteSubSellerParty,
  generateEasyLoginId,
  generateEasyPassword,
  loadUserCloudSession,
  loginSellerWithIdPassword,
  lookupPartyInvite,
  makePartyIdFromSeller,
  normalizeLoginId,
  pushAdminSheetRowsForParty,
  readCachedPublicAnnouncement,
  resetSellerAccessKey,
  resolveTopLevelMasterParty,
  sanitizeSheetEntriesForCloud,
  savePartyArchiveCloud,
  savePublicAnnouncementCloud,
  serializeSheetEntries,
  subscribeAdminParties,
  subscribeAdminPartyPrivates,
  subscribeAdminSheets,
  subscribePublicAnnouncement,
  syncAdminAgencyState,
  syncSubSellerChainLineage,
  toggleSellerChainRole,
  toggleSellerPartyActive,
  updatePartyLoginCredentials,
  updateSubSellerParty,
} from './services/cloudSync';
import {
  createBlankRows,
  createEmptyAppState,
  createEmptyRow,
  getTodayIsoDate,
} from './data/initialState';
import {
  computeSellerBills,
  formatDateDDMM,
  generatePrizeAndLimitData,
  getRangeEndInt,
  isMyChoiceName,
  parseItemMultiplier,
  parseWinningNumbers,
  processSessionRows,
  round2,
} from './engine/calculations';
import {
  AgencyConfig,
  AppState,
  DaySnapshot,
  PrizeListRow,
  Seller,
  SessionComputation,
  SessionId,
  SheetTab,
  TicketEntryRow,
} from './types/ledger';
import { AppSounds, initSoundEngine, setSoundEnabled, wakeSoundEngine } from './utils/sound';
import {
  PERMANENT_SELLERS_KEY,
  readIndexedDbEnvelope,
  readLocalStorageEnvelope,
  readPermanentSellersIdb,
  readPermanentSellersLocal,
  requestPersistentStorage,
  STORAGE_KEY,
  writeIndexedDbEnvelope,
  writeLocalStorageSafe,
  writePermanentSellers,
} from './utils/storage';
import { applyDocumentTheme } from './utils/theme';

const CLOUD_SESSION_CACHE_KEY = 'kk_agency_cloud_session_v1';

type CachedCloudSession =
  | { uid: string; kind: 'admin'; agencyId: string; ownerUid: string }
  | { uid: string; kind: 'seller'; agencyId: string; partyId: string; loginId?: string };

function readCachedCloudSession(): CachedCloudSession | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(CLOUD_SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedCloudSession>;
    if (!parsed || typeof parsed.uid !== 'string' || !parsed.uid) return null;
    if (
      parsed.kind === 'admin' &&
      typeof parsed.agencyId === 'string' &&
      typeof parsed.ownerUid === 'string'
    ) {
      return {
        uid: parsed.uid,
        kind: 'admin',
        agencyId: parsed.agencyId,
        ownerUid: parsed.ownerUid,
      };
    }
    if (
      parsed.kind === 'seller' &&
      typeof parsed.agencyId === 'string' &&
      typeof parsed.partyId === 'string'
    ) {
      return {
        uid: parsed.uid,
        kind: 'seller',
        agencyId: parsed.agencyId,
        partyId: parsed.partyId,
        loginId: typeof parsed.loginId === 'string' ? parsed.loginId : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeCachedCloudSession(session: CachedCloudSession): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(CLOUD_SESSION_CACHE_KEY, JSON.stringify(session));
  } catch {
    // ignore storage quota errors
  }
}

function clearCachedCloudSession(): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(CLOUD_SESSION_CACHE_KEY);
  } catch {
    // ignore storage errors
  }
}

function isRowBlank(r: TicketEntryRow): boolean {
  return (
    !r.name.trim() &&
    !r.item.trim() &&
    !r.start.trim() &&
    !r.end.trim() &&
    !r.qtyOverride.trim() &&
    !r.rangeOverride.trim()
  );
}

function sanitizeRowQtyOverride(r: TicketEntryRow): TicketEntryRow {
  const qStr = r.qtyOverride.trim();
  const sStr = r.start.trim();
  const eStr = r.end.trim();
  if (!qStr || !sStr || !eStr) return r;
  const mult = parseItemMultiplier(r.item);
  const sInt = parseInt(sStr, 10);
  const qVal = Number(qStr);
  if (mult > 0 && Number.isFinite(sInt) && Number.isFinite(qVal) && qVal > 0) {
    const eInt = getRangeEndInt(sInt, eStr, 0);
    const numCount = Math.max(1, eInt - sInt + 1);
    if (numCount > 1 && qVal % numCount !== 0) {
      return { ...r, qtyOverride: '' };
    }
  }
  return r;
}

function normalizeRowsKeepOneTrailing(rows: TicketEntryRow[]): TicketEntryRow[] {
  if (!Array.isArray(rows) || rows.length === 0) return createBlankRows(1);
  const nonBlank = rows.filter((r) => !isRowBlank(r)).map(sanitizeRowQtyOverride);
  return [...nonBlank, createEmptyRow()];
}

function computeResolvedNames(rows: TicketEntryRow[]): string[] {
  let lastValidName = '';
  return rows.map((row) => {
    const currName = row.name.trim();
    if (currName !== '') {
      lastValidName = currName;
    }
    const hasRealData =
      row.item.trim() !== '' || row.start.trim() !== '' || row.end.trim() !== '';
    return currName !== '' ? currName : hasRealData ? lastValidName : '';
  });
}

function preserveInheritedNamesAndCompact(
  prevRows: TicketEntryRow[],
  nextRows: TicketEntryRow[],
  explicitlyClearedNameIds?: Set<string>
): TicketEntryRow[] {
  const prevResolved = computeResolvedNames(prevRows);
  const prevResolvedById = new Map<string, string>();
  prevRows.forEach((r, idx) => {
    prevResolvedById.set(r.id, prevResolved[idx]);
  });

  let currentDonor = '';
  const adjusted = nextRows.map((row) => {
    if (isRowBlank(row)) return row;
    const currName = row.name.trim();
    if (currName !== '') {
      currentDonor = currName;
      return row;
    }
    if (explicitlyClearedNameIds?.has(row.id)) {
      return row;
    }
    const expectedName = prevResolvedById.get(row.id) || '';
    if (expectedName && currentDonor.toUpperCase() !== expectedName.toUpperCase()) {
      currentDonor = expectedName;
      return { ...row, name: expectedName };
    }
    return row;
  });

  return normalizeRowsKeepOneTrailing(adjusted);
}

function preserveSavedSnapshots(history: DaySnapshot[]): DaySnapshot[] {
  if (!Array.isArray(history) || history.length === 0) return [];
  return history;
}

function normalizeLoadedState(parsed: Partial<AppState> | null | undefined): AppState {
  if (!parsed || !Array.isArray(parsed.sellers) || !parsed.entries) {
    return createEmptyAppState();
  }
  const emptyBase = createEmptyAppState();
  const loadedItemOptions = parsed.config?.itemOptions;
  const needsItemMigration =
    !Array.isArray(loadedItemOptions) ||
    loadedItemOptions.length === 0 ||
    loadedItemOptions.some((opt) => /^S\d+$/i.test(String(opt).trim()));

  return {
    ...emptyBase,
    ...parsed,
    sellers: parsed.sellers.map((s) => {
      if (s.due < 0) {
        return {
          ...s,
          due: 0,
          joma: round2((s.joma || 0) + Math.abs(s.due)),
        };
      }
      return s;
    }),
    extraNames: Array.isArray(parsed.extraNames) ? parsed.extraNames : [],
    entries: {
      '1PM': normalizeRowsKeepOneTrailing(parsed.entries['1PM'] || []),
      '6PM': normalizeRowsKeepOneTrailing(parsed.entries['6PM'] || []),
      '8PM': normalizeRowsKeepOneTrailing(parsed.entries['8PM'] || []),
    },
    config: {
      ...emptyBase.config,
      ...(parsed.config || {}),
      limitThreshold:
        typeof parsed.config?.limitThreshold === 'number' && parsed.config.limitThreshold >= 1
          ? parsed.config.limitThreshold
          : 10,
      sellerLimitThreshold:
        typeof parsed.config?.sellerLimitThreshold === 'number' &&
        parsed.config.sellerLimitThreshold >= 1
          ? parsed.config.sellerLimitThreshold
          : 20,
      excludedPrizeNames: (() => {
        const list = Array.isArray(parsed.config?.excludedPrizeNames)
          ? parsed.config.excludedPrizeNames
          : [];
        return list.some((n) => isMyChoiceName(n)) ? list : ['MY CHOICE', ...list];
      })(),
      autoArchiveDaily: false,
      soundEnabled:
        typeof parsed.config?.soundEnabled === 'boolean' ? parsed.config.soundEnabled : true,
      ...(needsItemMigration ? { itemOptions: emptyBase.config.itemOptions } : {}),
      ...((parsed.config?.themeVersion ?? 1) < 3
        ? { theme: emptyBase.config.theme, themeVersion: 3 }
        : {}),
      ...((parsed.config?.whatsappVersion ?? 0) < 1 || !parsed.config?.whatsappNumber?.trim()
        ? { whatsappNumber: emptyBase.config.whatsappNumber, whatsappVersion: 1 }
        : {}),
    },
    winningRaw: {
      ...emptyBase.winningRaw,
      ...(parsed.winningRaw || {}),
    },
    history: preserveSavedSnapshots(
      Array.isArray(parsed.history) ? parsed.history : []
    ),
    recycleBin: preserveSavedSnapshots(
      Array.isArray(parsed.recycleBin) ? parsed.recycleBin : []
    ),
  };
}

function mergeWithPermanentSellers(
  primarySellers: Seller[],
  vaultSellers: Seller[]
): Seller[] {
  if (!Array.isArray(vaultSellers) || vaultSellers.length === 0) {
    return primarySellers;
  }
  const existingByKey = new Set(
    primarySellers.map((s) => `${s.id}::${s.name.trim().toUpperCase()}`)
  );
  const existingNames = new Set(primarySellers.map((s) => s.name.trim().toUpperCase()));
  const existingIds = new Set(primarySellers.map((s) => s.id));

  const missingFromPrimary: Seller[] = [];
  for (const vs of vaultSellers) {
    const key = `${vs.id}::${vs.name.trim().toUpperCase()}`;
    const nameKey = vs.name.trim().toUpperCase();
    if (!existingByKey.has(key) && !existingIds.has(vs.id) && (!nameKey || !existingNames.has(nameKey))) {
      missingFromPrimary.push(vs);
    }
  }
  return missingFromPrimary.length > 0 ? [...primarySellers, ...missingFromPrimary] : primarySellers;
}

function loadInitialEnvelope(): { state: AppState; updatedAt: number } {
  const env = readLocalStorageEnvelope();
  const sellerVault = readPermanentSellersLocal();
  if (!env) {
    const empty = createEmptyAppState();
    if (sellerVault && sellerVault.sellers.length > 0) {
      return {
        state: normalizeLoadedState({ ...empty, sellers: sellerVault.sellers }),
        updatedAt: sellerVault.updatedAt || 0,
      };
    }
    return { state: empty, updatedAt: 0 };
  }
  const normalized = normalizeLoadedState(env.state);
  const mergedSellers =
    sellerVault && sellerVault.sellers.length > 0
      ? mergeWithPermanentSellers(normalized.sellers, sellerVault.sellers)
      : normalized.sellers;
  return {
    state: { ...normalized, sellers: mergedSellers },
    updatedAt: env.updatedAt || 0,
  };
}

export default function App() {
  const initialRef = useRef<{ state: AppState; updatedAt: number } | null>(null);
  if (!initialRef.current) {
    initialRef.current = loadInitialEnvelope();
  }

  const [state, setRawState] = useState<AppState>(initialRef.current.state);
  const latestStateRef = useRef<AppState>(initialRef.current.state);
  const lastSavedAtRef = useRef<number>(initialRef.current.updatedAt);
  const persistTimerRef = useRef<number | null>(null);

  const flushPersistNow = useCallback(() => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const curr = latestStateRef.current;
    const ts = lastSavedAtRef.current;
    writeLocalStorageSafe(curr, ts);
    void writeIndexedDbEnvelope(curr, ts);
  }, []);

  const setState = useCallback(
    (updater: AppState | ((prev: AppState) => AppState)) => {
      setRawState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (next === prev) return prev;
        const now = Math.max(Date.now(), lastSavedAtRef.current + 1);
        latestStateRef.current = next;
        lastSavedAtRef.current = now;
        if (next.sellers !== prev.sellers && next.sellers.length > 0) {
          writePermanentSellers(next.sellers, now);
        }
        const totalRows =
          (next.entries['1PM']?.length || 0) +
          (next.entries['6PM']?.length || 0) +
          (next.entries['8PM']?.length || 0);
        const delayMs = totalRows > 3000 ? 650 : totalRows > 300 ? 250 : 60;
        if (persistTimerRef.current !== null) {
          window.clearTimeout(persistTimerRef.current);
        }
        persistTimerRef.current = window.setTimeout(() => {
          persistTimerRef.current = null;
          writeLocalStorageSafe(latestStateRef.current, lastSavedAtRef.current);
          void writeIndexedDbEnvelope(latestStateRef.current, lastSavedAtRef.current);
        }, delayMs);
        return next;
      });
    },
    []
  );

  const [activeTab, setActiveTab] = useState<SheetTab>('Seller Bill');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sellerIdsOpen, setSellerIdsOpen] = useState(false);
  const [announcementModalOpen, setAnnouncementModalOpen] = useState(false);
  const [announcementBusy, setAnnouncementBusy] = useState(false);
  const [announcementError, setAnnouncementError] = useState('');
  const [publicAnnouncement, setPublicAnnouncement] = useState<CloudPublicAnnouncement | null>(
    () => readCachedPublicAnnouncement(AGENCY_ID)
  );
  const [archiveNotice, setArchiveNotice] = useState('');

  // Cloud Multi-User & Seller Mobile ID State
  const DEVICE_PORTAL_MODE_KEY = 'kk-device-portal-mode:v1';
  const readDevicePortalMode = (): 'admin' | 'seller' | null => {
    try {
      const v = window.localStorage.getItem(DEVICE_PORTAL_MODE_KEY);
      if (v === 'admin' || v === 'seller') return v;
    } catch {
      // Ignore storage errors
    }
    return null;
  };
  const writeDevicePortalMode = (mode: 'admin' | 'seller') => {
    try {
      window.localStorage.setItem(DEVICE_PORTAL_MODE_KEY, mode);
    } catch {
      // Ignore storage errors
    }
  };

  const initialUrlLoginParams = useMemo(() => {
    if (typeof window === 'undefined') {
      return { loginId: '', legacySellerId: '', forceLogin: false, forceAdmin: false };
    }
    const sp = new URLSearchParams(window.location.search);
    const rawId = sp.get('id')?.trim() || '';
    const legacySellerId = sp.get('sellerId')?.trim() || '';
    const forceLogin = sp.get('login') === '1';
    const forceAdmin = sp.get('admin') === '1';
    return {
      loginId: rawId ? normalizeLoginId(rawId) : '',
      legacySellerId,
      forceLogin,
      forceAdmin,
    };
  }, []);
  const hasUrlLoginTrigger = Boolean(
    initialUrlLoginParams.loginId ||
      initialUrlLoginParams.legacySellerId ||
      initialUrlLoginParams.forceLogin
  );
  const [devicePortalMode, setDevicePortalMode] = useState<'admin' | 'seller' | null>(() => {
    if (hasUrlLoginTrigger) {
      writeDevicePortalMode('seller');
      return 'seller';
    }
    if (initialUrlLoginParams.forceAdmin) {
      writeDevicePortalMode('admin');
      return 'admin';
    }
    return readDevicePortalMode();
  });
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [cloudSession, setCloudSession] = useState<
    | { kind: 'none' }
    | { kind: 'admin'; agencyId: string; ownerUid: string }
    | { kind: 'seller'; agencyId: string; partyId: string }
  >(() => {
    if (hasUrlLoginTrigger) return { kind: 'none' };
    const cached = readCachedCloudSession();
    if (!cached) return { kind: 'none' };
    if (cached.kind === 'admin') {
      return { kind: 'admin', agencyId: cached.agencyId, ownerUid: cached.ownerUid };
    }
    return { kind: 'seller', agencyId: cached.agencyId, partyId: cached.partyId };
  });
  const [sellerLoginMode, setSellerLoginMode] = useState<boolean>(hasUrlLoginTrigger);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const [cloudAgency, setCloudAgency] = useState<CloudAgencyDoc | null>(null);
  const [cloudParties, setCloudParties] = useState<CloudPartyDoc[]>([]);
  const [cloudPrivates, setCloudPrivates] = useState<CloudPartyPrivateDoc[]>([]);
  const [cloudSheets, setCloudSheets] = useState<CloudPartySheetDoc[]>([]);
  const [cloudHydrated, setCloudHydrated] = useState(false);
  const [adminPreviewParty, setAdminPreviewParty] = useState<{
    agencyId: string;
    partyId: string;
  } | null>(null);

  const lastAgencySigRef = useRef<string>('');
  const lastCloudSheetSigRef = useRef<Record<string, string>>({});
  const lastAdminPushSigRef = useRef<Record<string, string>>({});
  const subSheetMergedSigRef = useRef<Record<string, string>>({});
  const sheetsHydratedOnceRef = useRef<boolean>(false);
  const cloudPartiesRef = useRef<CloudPartyDoc[]>([]);
  const cloudPrivatesRef = useRef<CloudPartyPrivateDoc[]>([]);
  const cloudSheetsRef = useRef<CloudPartySheetDoc[]>([]);
  const cloudAgencyRef = useRef<CloudAgencyDoc | null>(null);

  cloudPartiesRef.current = cloudParties;
  cloudPrivatesRef.current = cloudPrivates;
  cloudSheetsRef.current = cloudSheets;
  cloudAgencyRef.current = cloudAgency;

  const skipAutoRolloverDateRef = useRef<string | null>(null);

  // Admin-only Restored Archive Mode (persisted locally so page reload NEVER overwrites
  // live Master / Sub-Master cloud date, sheets, or Due/Joma with an old restored date).
  type AdminRestoredArchiveMode = {
    restoredDate: string;
    liveDate: string;
    liveBackup: DaySnapshot;
  };
  const ADMIN_RESTORED_MODE_KEY = 'kk-admin-restored-archive-mode:v1';
  const [adminRestoredMode, setAdminRestoredMode] = useState<AdminRestoredArchiveMode | null>(() => {
    try {
      const raw = window.localStorage.getItem(ADMIN_RESTORED_MODE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AdminRestoredArchiveMode;
      if (parsed && parsed.restoredDate && parsed.liveDate && parsed.liveBackup) {
        return parsed;
      }
    } catch {
      // Ignore corrupt local flag
    }
    return null;
  });
  const isAdminRestoredView = Boolean(adminRestoredMode);
  const isAdminRestoredViewRef = useRef<boolean>(isAdminRestoredView);
  isAdminRestoredViewRef.current = isAdminRestoredView;

  const updateAdminRestoredMode = useCallback(
    (next: AdminRestoredArchiveMode | null) => {
      isAdminRestoredViewRef.current = Boolean(next);
      setAdminRestoredMode(next);
      try {
        if (next) {
          window.localStorage.setItem(ADMIN_RESTORED_MODE_KEY, JSON.stringify(next));
        } else {
          window.localStorage.removeItem(ADMIN_RESTORED_MODE_KEY);
        }
      } catch {
        // Ignore storage quota errors
      }
    },
    []
  );
  const [recentlyPastedIds, setRecentlyPastedIds] = useState<Record<SessionId, string[]>>({
    '1PM': [],
    '6PM': [],
    '8PM': [],
  });
  const [sessionHistory, setSessionHistory] = useState<
    Record<SessionId, { undo: TicketEntryRow[][]; redo: TicketEntryRow[][] }>
  >({
    '1PM': { undo: [], redo: [] },
    '6PM': { undo: [], redo: [] },
    '8PM': { undo: [], redo: [] },
  });
  const lastRowEditUndoRef = useRef<{ sessionId: SessionId; rowId: string; ts: number } | null>(
    null
  );
  const [previewModal, setPreviewModal] = useState<{
    isOpen: boolean;
    title: string;
    subtitle: string;
    message: string;
    waUrl: string;
    billData?: BillReceiptPayload;
  }>({
    isOpen: false,
    title: '',
    subtitle: '',
    message: '',
    waUrl: '',
    billData: undefined,
  });

  const showToast = useCallback((msg: string, ms = 4200) => {
    setArchiveNotice(msg);
    window.setTimeout(() => {
      setArchiveNotice((curr) => (curr === msg ? '' : curr));
    }, ms);
  }, []);

  // Live Google Sheets Sync state (access token is kept strictly in memory in firebase.ts)
  const [googleSheetsModalOpen, setGoogleSheetsModalOpen] = useState(false);
  const [gsheetConfig, setGsheetConfig] = useState<GoogleSheetSyncConfig>(() =>
    loadGoogleSheetConfig()
  );
  const [gsheetHasToken, setGsheetHasToken] = useState<boolean>(() =>
    Boolean(getGoogleSheetsAccessToken())
  );
  const [gsheetConnectionMode, setGsheetConnectionMode] = useState<'none' | 'always-on' | 'oauth'>(
    () => (getGoogleSheetsAccessToken() ? 'oauth' : 'none')
  );
  const [gsheetTabs, setGsheetTabs] = useState<GoogleSheetTabInfo[]>([]);
  const [gsheetSyncing, setGsheetSyncing] = useState(false);
  const [gsheetConnecting, setGsheetConnecting] = useState(false);
  const [gsheetLastSyncedAt, setGsheetLastSyncedAt] = useState('');
  const [gsheetRowCounts, setGsheetRowCounts] = useState<Record<SessionId, number>>({
    '1PM': 0,
    '6PM': 0,
    '8PM': 0,
  });
  const [gsheetError, setGsheetError] = useState('');
  const gsheetInFlightRef = useRef(false);
  const gsheetAuthPausedRef = useRef(false);
  const gsheetSilentTriedRef = useRef(false);
  const lastGsheetSigRef = useRef<string>('');
  const gsheetConfigRef = useRef(gsheetConfig);
  gsheetConfigRef.current = gsheetConfig;

  useEffect(() => {
    return subscribeGoogleSheetsTokenState((ready) => {
      setGsheetHasToken(ready);
      if (ready) {
        gsheetAuthPausedRef.current = false;
      }
    });
  }, []);

  useEffect(() => {
    saveGoogleSheetConfig(gsheetConfig);
  }, [gsheetConfig]);

  const mergeGoogleSheetEntriesIntoState = useCallback(
    (
      entriesBySession: Record<SessionId, TicketEntryRow[]>,
      sellerNames: string[],
      silentToast = false
    ) => {
      const sig = JSON.stringify(entriesBySession);
      if (sig === lastGsheetSigRef.current) {
        return false;
      }
      lastGsheetSigRef.current = sig;

      let totalIncoming = 0;
      (['1PM', '6PM', '8PM'] as SessionId[]).forEach((sid) => {
        totalIncoming += entriesBySession[sid].length;
      });

      setState((prev) => {
        const excludedUpper = new Set(
          (prev.config.excludedPrizeNames || []).map((n) => n.trim().toUpperCase())
        );
        const existingSellerNames = new Set(
          prev.sellers.map((s) => s.name.trim().toUpperCase())
        );
        const nextSellers = [...prev.sellers];
        for (const rawName of sellerNames) {
          const clean = rawName.trim().toUpperCase();
          if (!clean || excludedUpper.has(clean) || isMyChoiceName(clean)) continue;
          if (!existingSellerNames.has(clean)) {
            existingSellerNames.add(clean);
            nextSellers.push({
              id: `seller-gs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name: clean,
              mobile: '',
              rate: 10,
              due: 0,
              joma: 0,
            });
          }
        }

        const mergeSession = (sid: SessionId): TicketEntryRow[] => {
          const existing = prev.entries[sid] || [];
          // Keep ALL non-Google-Sheet rows (Admin manual/pasted + Seller/Sub-Seller phone rows) 100% intact
          const preserved = existing.filter(
            (r) =>
              !isGoogleSheetRowId(r.id) &&
              Boolean(
                r.name.trim() ||
                  r.item.trim() ||
                  r.start.trim() ||
                  r.end.trim() ||
                  r.qtyOverride.trim() ||
                  r.rangeOverride.trim()
              )
          );
          const merged = [...entriesBySession[sid], ...preserved];
          return merged.length > 0 ? merged : createBlankRows(1);
        };

        return {
          ...prev,
          sellers: nextSellers,
          entries: {
            '1PM': mergeSession('1PM'),
            '6PM': mergeSession('6PM'),
            '8PM': mergeSession('8PM'),
          },
        };
      });

      if (!silentToast && totalIncoming > 0) {
        AppSounds.add();
        showToast(`Google Sheet synced: ${totalIncoming} rows live`);
      }
      return true;
    },
    [setState, showToast]
  );

  const runGoogleSheetsSync = useCallback(
    async (overrideCfg?: GoogleSheetSyncConfig, manualTrigger = false) => {
      const cfg = overrideCfg || gsheetConfigRef.current;
      if (!cfg.spreadsheetId) return;
      if (!manualTrigger && gsheetAuthPausedRef.current) return;
      if (gsheetInFlightRef.current) return;

      gsheetInFlightRef.current = true;
      setGsheetSyncing(true);
      if (manualTrigger) {
        gsheetAuthPausedRef.current = false;
        setGsheetError('');
      }
      try {
        let token = getGoogleSheetsAccessToken();
        if (token && isGoogleSheetsTokenExpiringSoon()) {
          const refreshed = await trySilentGoogleSheetsTokenRefresh(
            auth.currentUser?.email || undefined
          );
          if (refreshed) token = refreshed;
        }

        let result;
        try {
          result = await fetchSessionRowsSmart(cfg.spreadsheetId, cfg.tabMapping, token);
        } catch (firstErr) {
          if (
            (firstErr instanceof SheetPrivateAuthRequiredError ||
              firstErr instanceof SheetsAuthExpiredError) &&
            !gsheetSilentTriedRef.current &&
            auth.currentUser?.email
          ) {
            gsheetSilentTriedRef.current = true;
            const refreshed = await trySilentGoogleSheetsTokenRefresh(auth.currentUser.email);
            if (refreshed) {
              result = await fetchSessionRowsSmart(cfg.spreadsheetId, cfg.tabMapping, refreshed);
            } else {
              throw firstErr;
            }
          } else {
            throw firstErr;
          }
        }

        gsheetAuthPausedRef.current = false;
        setGsheetConnectionMode(result.syncMode);
        setGsheetRowCounts(result.rowCounts);
        setGsheetLastSyncedAt(result.syncedAt);
        setGsheetError('');
        const changed = mergeGoogleSheetEntriesIntoState(
          result.entriesBySession,
          result.sellerNames,
          !manualTrigger && lastGsheetSigRef.current === ''
        );
        if (manualTrigger && !changed) {
          const total =
            result.rowCounts['1PM'] + result.rowCounts['6PM'] + result.rowCounts['8PM'];
          AppSounds.success();
          showToast(
            result.syncMode === 'always-on'
              ? `24/7 Google Sheet synced (${total} rows)`
              : `Google Sheet up to date (${total} rows)`
          );
        }
      } catch (err) {
        if (err instanceof SheetsAuthExpiredError) {
          clearGoogleSheetsAccessToken();
          setGsheetConnectionMode('none');
          gsheetAuthPausedRef.current = true;
          setGsheetError(err.message);
        } else if (err instanceof SheetPrivateAuthRequiredError) {
          setGsheetConnectionMode('none');
          gsheetAuthPausedRef.current = true;
          setGsheetError(err.message);
        } else {
          setGsheetError(
            err instanceof Error ? err.message : 'Google Sheets sync failed.'
          );
        }
      } finally {
        gsheetInFlightRef.current = false;
        setGsheetSyncing(false);
      }
    },
    [mergeGoogleSheetEntriesIntoState, showToast]
  );

  const handleConnectSpreadsheet = useCallback(
    async (spreadsheetId: string) => {
      const token = getGoogleSheetsAccessToken();
      gsheetAuthPausedRef.current = false;
      setGsheetSyncing(true);
      setGsheetError('');
      try {
        if (token) {
          const meta = await fetchSpreadsheetMetadata(spreadsheetId, token);
          setGsheetTabs(meta.tabs);
          const tabMapping = autoDetectSessionTabs(meta.tabs, gsheetConfigRef.current.tabMapping);
          const nextCfg: GoogleSheetSyncConfig = {
            ...gsheetConfigRef.current,
            spreadsheetId: meta.spreadsheetId,
            spreadsheetTitle: meta.title,
            tabMapping,
          };
          setGsheetConfig(nextCfg);
          lastGsheetSigRef.current = '';
          setGsheetSyncing(false);
          await runGoogleSheetsSync(nextCfg, true);
          return;
        }

        // No OAuth token in memory -> connect directly via 24/7 Always-On Direct Sync!
        const prevMap = gsheetConfigRef.current.tabMapping;
        const tabMapping: Record<SessionId, string> = {
          '1PM': prevMap['1PM']?.trim() || '1PM',
          '6PM': prevMap['6PM']?.trim() || '6PM',
          '8PM': prevMap['8PM']?.trim() || '8PM',
        };
        const nextCfg: GoogleSheetSyncConfig = {
          ...gsheetConfigRef.current,
          spreadsheetId,
          spreadsheetTitle:
            gsheetConfigRef.current.spreadsheetId === spreadsheetId &&
            gsheetConfigRef.current.spreadsheetTitle
              ? gsheetConfigRef.current.spreadsheetTitle
              : 'Google Sheet (24/7 Live)',
          tabMapping,
        };
        setGsheetConfig(nextCfg);
        lastGsheetSigRef.current = '';
        setGsheetSyncing(false);
        await runGoogleSheetsSync(nextCfg, true);
      } catch (err) {
        if (err instanceof SheetsAuthExpiredError) {
          clearGoogleSheetsAccessToken();
        }
        setGsheetError(
          err instanceof Error ? err.message : 'Google Sheet connect nahi ho payi.'
        );
      } finally {
        setGsheetSyncing(false);
      }
    },
    [runGoogleSheetsSync]
  );

  const handleSignInGoogleSheets = useCallback(async () => {
    setGsheetConnecting(true);
    setGsheetError('');
    gsheetAuthPausedRef.current = false;
    gsheetSilentTriedRef.current = false;
    try {
      await signInForGoogleSheets();
      setGsheetConnectionMode('oauth');
      AppSounds.success();
      const existingId = gsheetConfigRef.current.spreadsheetId;
      if (existingId) {
        await handleConnectSpreadsheet(existingId);
      } else {
        showToast('Google Sheets connected! Ab apni Sheet ka link paste karein.');
      }
    } catch (err) {
      setGsheetError(formatFirebaseAuthError(err));
    } finally {
      setGsheetConnecting(false);
    }
  }, [handleConnectSpreadsheet, showToast]);

  const handleUpdateGsheetConfig = useCallback(
    (patch: Partial<GoogleSheetSyncConfig>) => {
      setGsheetConfig((prev) => {
        const next: GoogleSheetSyncConfig = {
          ...prev,
          ...patch,
          tabMapping: patch.tabMapping ? { ...prev.tabMapping, ...patch.tabMapping } : prev.tabMapping,
        };
        if (patch.tabMapping && next.spreadsheetId) {
          lastGsheetSigRef.current = '';
          gsheetAuthPausedRef.current = false;
          window.setTimeout(() => {
            void runGoogleSheetsSync(next, true);
          }, 150);
        }
        return next;
      });
    },
    [runGoogleSheetsSync]
  );

  const handleDisconnectGoogleSheet = useCallback(() => {
    setGsheetConfig(createDefaultGoogleSheetConfig());
    setGsheetTabs([]);
    setGsheetConnectionMode('none');
    setGsheetRowCounts({ '1PM': 0, '6PM': 0, '8PM': 0 });
    setGsheetLastSyncedAt('');
    setGsheetError('');
    gsheetAuthPausedRef.current = false;
    lastGsheetSigRef.current = '';
  }, []);

  const handleClearGoogleSheetRows = useCallback(() => {
    setState((prev) => {
      const strip = (sid: SessionId) => {
        const remaining = (prev.entries[sid] || []).filter((r) => !isGoogleSheetRowId(r.id));
        return remaining.length > 0 ? remaining : createBlankRows(1);
      };
      return {
        ...prev,
        entries: {
          '1PM': strip('1PM'),
          '6PM': strip('6PM'),
          '8PM': strip('8PM'),
        },
      };
    });
    setGsheetRowCounts({ '1PM': 0, '6PM': 0, '8PM': 0 });
    lastGsheetSigRef.current = '';
    showToast('Google Sheet synced rows removed from app');
  }, [setState, showToast]);

  // 24/7 Live Auto-Sync effect: immediately syncs on app open, resume, reconnect, and every N seconds
  // Uses Always-On Direct Sync automatically when no OAuth token is in memory so it NEVER disconnects!
  useEffect(() => {
    if (!gsheetConfig.spreadsheetId || !gsheetConfig.autoSync) return;
    if (cloudSession.kind === 'seller' || isAdminRestoredView) return;

    gsheetAuthPausedRef.current = false;
    void runGoogleSheetsSync(undefined, false);

    const intervalMs = Math.max(5, gsheetConfig.pollSeconds || 10) * 1000;
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (isAdminRestoredViewRef.current) return;
      void runGoogleSheetsSync(undefined, false);
    };

    const timer = window.setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !isAdminRestoredViewRef.current) {
        gsheetAuthPausedRef.current = false;
        void runGoogleSheetsSync(undefined, false);
      }
    };
    const onOnline = () => {
      if (isAdminRestoredViewRef.current) return;
      gsheetAuthPausedRef.current = false;
      void runGoogleSheetsSync(undefined, false);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [
    gsheetHasToken,
    gsheetConfig.spreadsheetId,
    gsheetConfig.autoSync,
    gsheetConfig.pollSeconds,
    cloudSession.kind,
    isAdminRestoredView,
    runGoogleSheetsSync,
  ]);

  useEffect(() => {
    initSoundEngine();
    requestPersistentStorage();
    // Always mirror existing sellers into both localStorage & IndexedDB Permanent Seller Vault
    if (latestStateRef.current.sellers.length > 0) {
      writePermanentSellers(latestStateRef.current.sellers, Math.max(Date.now(), lastSavedAtRef.current));
    }
  }, []);

  useEffect(() => {
    setSoundEnabled(state.config.soundEnabled);
  }, [state.config.soundEnabled]);

  useEffect(() => {
    applyDocumentTheme(state.config.theme);
  }, [state.config.theme]);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  const clearLoginQueryParams = () => {
    if (typeof window === 'undefined') return;
    const cleanUrl = new URL(window.location.href);
    let changed = false;
    ['id', 'sellerId', 'login', 'admin'].forEach((k) => {
      if (cleanUrl.searchParams.has(k)) {
        cleanUrl.searchParams.delete(k);
        changed = true;
      }
    });
    if (changed) {
      window.history.replaceState({}, '', cleanUrl.toString());
    }
  };

  const hydrateCloudSessionForUser = useCallback(async (user: User) => {
    const sp =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const urlLoginId = sp?.get('id')?.trim() ? normalizeLoginId(sp.get('id') || '') : '';
    const urlSellerId = sp?.get('sellerId')?.trim() || '';
    const urlForceLogin = sp?.get('login') === '1';

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const resolved = await loadUserCloudSession(user.uid, user.email);
        if (resolved.kind === 'seller') {
          const prevCached = readCachedCloudSession();
          const savedLoginId =
            prevCached?.kind === 'seller' && prevCached.uid === user.uid
              ? prevCached.loginId
              : undefined;
          writeDevicePortalMode('seller');
          setDevicePortalMode('seller');
          setCloudSession(resolved);
          writeCachedCloudSession({
            uid: user.uid,
            kind: 'seller',
            agencyId: resolved.agencyId,
            partyId: resolved.partyId,
            loginId: savedLoginId,
          });
          if (urlLoginId) {
            if (savedLoginId && savedLoginId === urlLoginId) {
              setSellerLoginMode(false);
              clearLoginQueryParams();
            } else {
              // Opened another account's ?id=... link — show easy ID+Password login form
              setSellerLoginMode(true);
            }
          } else if (urlSellerId) {
            const invite = await lookupPartyInvite(urlSellerId);
            if (invite && invite.partyId !== resolved.partyId) {
              setSellerLoginMode(true);
            } else {
              setSellerLoginMode(false);
              clearLoginQueryParams();
            }
          } else if (urlForceLogin) {
            setSellerLoginMode(true);
          } else {
            setSellerLoginMode(false);
          }
          setCloudError('');
          return;
        }
        if (resolved.kind === 'admin') {
          const agencyDoc = await bootstrapAdminAgency(user.uid, latestStateRef.current);
          setCloudAgency(agencyDoc);
          const nextAdminSession = {
            kind: 'admin' as const,
            agencyId: agencyDoc.agencyId,
            ownerUid: agencyDoc.ownerUid,
          };
          writeDevicePortalMode('admin');
          setDevicePortalMode('admin');
          setCloudSession(nextAdminSession);
          writeCachedCloudSession({
            uid: user.uid,
            kind: 'admin',
            agencyId: agencyDoc.agencyId,
            ownerUid: agencyDoc.ownerUid,
          });
          setSellerLoginMode(false);
          if (urlSellerId) {
            const invite = await lookupPartyInvite(urlSellerId);
            if (invite && invite.agencyId === agencyDoc.agencyId) {
              setAdminPreviewParty({ agencyId: invite.agencyId, partyId: invite.partyId });
            }
          }
          if (urlLoginId || urlSellerId || urlForceLogin) {
            clearLoginQueryParams();
          }
          setCloudError('');
          return;
        }
        clearCachedCloudSession();
        setCloudSession({ kind: 'none' });
        setCloudError('');
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < 2) {
          await new Promise((resolve) => window.setTimeout(resolve, 900 * (attempt + 1)));
        }
      }
    }

    // Transient network error: preserve cached session so Admin/Seller never gets logged out!
    const cached = readCachedCloudSession();
    if (cached && cached.uid === user.uid) {
      if (cached.kind === 'admin') {
        setCloudSession({
          kind: 'admin',
          agencyId: cached.agencyId,
          ownerUid: cached.ownerUid,
        });
      } else {
        setCloudSession({
          kind: 'seller',
          agencyId: cached.agencyId,
          partyId: cached.partyId,
        });
      }
      setCloudError('');
    } else {
      setCloudError(formatFirebaseAuthError(lastErr));
      setCloudSession({ kind: 'none' });
    }
  }, []);

  // Listen to Firebase Auth state and resolve Admin vs Seller Mobile Portal permanently
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      setCloudError('');
      if (!user) {
        clearCachedCloudSession();
        setCloudSession({ kind: 'none' });
        setCloudAgency(null);
        setCloudParties([]);
        setCloudPrivates([]);
        setCloudSheets([]);
        setCloudHydrated(false);
        setAuthReady(true);
        return;
      }

      // Restore cached session immediately so page reloads never flash logged-out
      const cached = readCachedCloudSession();
      if (cached && cached.uid === user.uid) {
        if (cached.kind === 'admin') {
          setCloudSession({
            kind: 'admin',
            agencyId: cached.agencyId,
            ownerUid: cached.ownerUid,
          });
        } else {
          setCloudSession({
            kind: 'seller',
            agencyId: cached.agencyId,
            partyId: cached.partyId,
          });
        }
      }

      try {
        await hydrateCloudSessionForUser(user);
      } finally {
        setAuthReady(true);
      }
    });
    return () => unsub();
  }, [hydrateCloudSessionForUser]);

  // Global live listener for Admin's Advertisement / Offer / Urgent Message
  // Works on Login Link, Installed App, Admin Dashboard, and all Master / Sub-Master / Sub-Seller portals
  const activeAnnouncementAgencyId =
    cloudSession.kind === 'admin' || cloudSession.kind === 'seller'
      ? cloudSession.agencyId
      : AGENCY_ID;
  useEffect(() => {
    const unsub = subscribePublicAnnouncement(activeAnnouncementAgencyId, (ad) => {
      setPublicAnnouncement(ad);
    });
    return () => unsub();
  }, [activeAnnouncementAgencyId]);

  // Silent Keep-Alive & Auto-Reconnect: refresh auth token on wake/online and every 45 mins
  // so Admin & Seller logins stay permanently active without ever logging out unexpectedly.
  useEffect(() => {
    const keepAlive = () => {
      const user = auth.currentUser;
      if (!user) return;
      void user.getIdToken(false).catch(() => {});
      if (!cloudAgencyRef.current) {
        void hydrateCloudSessionForUser(user);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        keepAlive();
      }
    };

    window.addEventListener('online', keepAlive);
    document.addEventListener('visibilitychange', handleVisibility);
    const interval = window.setInterval(() => {
      const user = auth.currentUser;
      if (user) {
        void user.getIdToken(true).catch(() => {});
      }
    }, 45 * 60 * 1000);

    return () => {
      window.removeEventListener('online', keepAlive);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(interval);
    };
  }, [hydrateCloudSessionForUser]);

  // Helper: map Admin's direct local Seller objects to their Firestore Party docs (excluding sub-sellers)
  const partiesBySellerId = useMemo(() => {
    const map: Record<string, CloudPartyDoc> = {};
    const directParties = cloudParties.filter((p) => !p.parentMasterId);
    for (const seller of state.sellers) {
      const expectedId = makePartyIdFromSeller(seller);
      const upperName = seller.name.trim().toUpperCase();
      const match =
        directParties.find((p) => p.partyId === expectedId) ||
        directParties.find((p) => p.name.trim().toUpperCase() === upperName);
      if (match) {
        map[seller.id] = match;
      }
    }
    return map;
  }, [state.sellers, cloudParties]);

  const subSellersCountByMasterId = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const party of cloudParties) {
      if (party.parentMasterId) {
        counts[party.parentMasterId] = (counts[party.parentMasterId] || 0) + 1;
      }
    }
    return counts;
  }, [cloudParties]);

  const privatesByPartyId = useMemo(() => {
    const map: Record<string, CloudPartyPrivateDoc> = {};
    for (const priv of cloudPrivates) {
      map[priv.partyId] = priv;
    }
    return map;
  }, [cloudPrivates]);

  const adminChainSheets = useMemo(
    () => cloudSheets.filter((s) => Boolean(s.parentMasterId)),
    [cloudSheets]
  );

  const extractSellerRowsFromEntries = useCallback(
    (
      entriesObj: Record<SessionId, TicketEntryRow[]>,
      sellerName: string,
      partyId?: string
    ) => {
      const targetUpper = sellerName.trim().toUpperCase();
      const sellerPrefix = partyId ? `seller::${partyId}::` : '';
      const pick = (sid: SessionId): TicketEntryRow[] => {
        const rows = entriesObj[sid] || [];
        const resolved = computeResolvedNames(rows);
        const matched: TicketEntryRow[] = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (isRowBlank(row)) continue;
          // Never push sub-seller chain rows back into Master's own sheet
          if (row.id.startsWith('sub::')) continue;
          if (resolved[i].trim().toUpperCase() === targetUpper) {
            let cloudRowId = row.id;
            if (sellerPrefix && row.id.startsWith(sellerPrefix)) {
              // Unwrap seller's own phone-authored row ID so their sheet stays clean
              cloudRowId = row.id.slice(sellerPrefix.length) || row.id;
            } else {
              // Mark Admin's manually entered/pasted (or reassigned) rows with admin:: so remote seller edits NEVER delete them
              cloudRowId = row.id.startsWith('admin::') ? row.id : `admin::${row.id}`;
            }
            matched.push({ ...row, id: cloudRowId, name: sellerName });
          }
        }
        return matched;
      };
      return {
        '1PM': pick('1PM'),
        '6PM': pick('6PM'),
        '8PM': pick('8PM'),
      };
    },
    []
  );

  // Admin Real-time Subscriptions: parties, private contacts, and live seller sheets!
  useEffect(() => {
    if (cloudSession.kind !== 'admin' || !authUser) {
      setCloudHydrated(false);
      sheetsHydratedOnceRef.current = false;
      subSheetMergedSigRef.current = {};
      return;
    }
    const ownerUid = cloudSession.ownerUid;
    let gotParties = false;
    let gotPrivates = false;
    let gotSheets = false;
    sheetsHydratedOnceRef.current = false;
    const markHydrated = () => {
      if (gotParties && gotPrivates && gotSheets) {
        setCloudHydrated(true);
      }
    };

    const unsubParties = subscribeAdminParties(ownerUid, (parties) => {
      cloudPartiesRef.current = parties;
      setCloudParties(parties);
      gotParties = true;
      markHydrated();
    });
    const unsubPrivates = subscribeAdminPartyPrivates(ownerUid, (privates) => {
      cloudPrivatesRef.current = privates;
      setCloudPrivates(privates);
      gotPrivates = true;
      markHydrated();
    });
    const unsubSheets = subscribeAdminSheets(ownerUid, (sheets) => {
      cloudSheetsRef.current = sheets;
      setCloudSheets(sheets);
      gotSheets = true;
      markHydrated();
    });

    return () => {
      unsubParties();
      unsubPrivates();
      unsubSheets();
    };
  }, [cloudSession, authUser]);

  // Reactive Live Merge: once BOTH cloudParties and cloudSheets are hydrated,
  // merge every Direct Seller & Multi-Level Chain Sub-Seller sheet live into Admin's ledger
  // (including Admin Preview entries and deep L2/L3/L4/L5+ sub-sellers).
  useEffect(() => {
    if (cloudSession.kind !== 'admin' || !authUser || !cloudHydrated || isAdminRestoredView) return;
    const adminUid = authUser.uid;
    const isInitialHydration = !sheetsHydratedOnceRef.current;
    sheetsHydratedOnceRef.current = true;

    const changedRemoteSheets: {
      sheet: CloudPartySheetDoc;
      effectiveSellerName: string;
      rootMasterName: string;
      isSubSheet: boolean;
    }[] = [];

    for (const sheet of cloudSheets) {
      const sig = serializeSheetEntries(
        sheet.entries1PM || [],
        sheet.entries6PM || [],
        sheet.entries8PM || []
      );
      const isSubSheet = Boolean(sheet.parentMasterId);

      if (isSubSheet) {
        const rootMaster =
          resolveTopLevelMasterParty(sheet.partyId, cloudParties) ||
          cloudParties.find((p) => p.partyId === sheet.parentMasterId);
        const effectiveSellerName = (rootMaster?.name || sheet.partyName).trim();
        const compositeSig = `${effectiveSellerName.toUpperCase()}::${sig}`;
        if (compositeSig !== subSheetMergedSigRef.current[sheet.partyId]) {
          subSheetMergedSigRef.current[sheet.partyId] = compositeSig;
          changedRemoteSheets.push({
            sheet,
            effectiveSellerName,
            rootMasterName: rootMaster?.name || '',
            isSubSheet: true,
          });
        }
      } else {
        const prevSig = lastCloudSheetSigRef.current[sheet.partyId];
        const lastPushed = lastAdminPushSigRef.current[sheet.partyId];
        if (sheet.updatedByUid !== adminUid && sig !== prevSig) {
          lastCloudSheetSigRef.current[sheet.partyId] = sig;
          changedRemoteSheets.push({
            sheet,
            effectiveSellerName: sheet.partyName.trim(),
            rootMasterName: '',
            isSubSheet: false,
          });
        } else if (
          sheet.updatedByUid === adminUid &&
          lastPushed !== undefined &&
          sig !== lastPushed &&
          sig !== prevSig
        ) {
          // Updated via Admin Preview on a direct Seller — sync live back to Admin ledger
          lastCloudSheetSigRef.current[sheet.partyId] = sig;
          changedRemoteSheets.push({
            sheet,
            effectiveSellerName: sheet.partyName.trim(),
            rootMasterName: '',
            isSubSheet: false,
          });
        } else if (prevSig === undefined) {
          lastCloudSheetSigRef.current[sheet.partyId] = sig;
        }
      }
    }

    if (changedRemoteSheets.length === 0) return;

    setState((prev) => {
      const nextEntries: Record<SessionId, TicketEntryRow[]> = {
        '1PM': [...prev.entries['1PM']],
        '6PM': [...prev.entries['6PM']],
        '8PM': [...prev.entries['8PM']],
      };

      for (const item of changedRemoteSheets) {
        const { sheet, effectiveSellerName, isSubSheet } = item;
        const targetUpper = effectiveSellerName.toUpperCase();
        if (!targetUpper) continue;

        const subPrefix = `sub::${sheet.partyId}::`;
        const sellerPrefix = `seller::${sheet.partyId}::`;

        const mergeSession = (sid: SessionId, incomingRows: TicketEntryRow[]) => {
          const current = nextEntries[sid];
          const resolved = computeResolvedNames(current);
          const sanitizedIncoming = sanitizeSheetEntriesForCloud(
            incomingRows || [],
            effectiveSellerName
          );

          if (isSubSheet) {
            const kept: TicketEntryRow[] = [];
            for (let i = 0; i < current.length; i++) {
              if (isRowBlank(current[i])) continue;
              const row = current[i];
              if (!row.id.startsWith(subPrefix)) {
                kept.push(row.name.trim() ? row : { ...row, name: resolved[i] });
              }
            }
            const taggedIncoming = sanitizedIncoming.map((r) => ({
              ...r,
              id: r.id.startsWith(subPrefix) ? r.id : `${subPrefix}${r.id}`,
            }));
            nextEntries[sid] = normalizeRowsKeepOneTrailing([...kept, ...taggedIncoming]);
            return;
          }

          // Direct Seller / Master Sheet:
          // Partition incoming rows into Seller's own phone entries vs Admin's echoed admin:: rows.
          // NEVER delete Admin's manually entered or pasted rows when Master/Seller enters data!
          const incomingAdminRows = sanitizedIncoming.filter((r) => r.id.startsWith('admin::'));
          const incomingSellerRows = sanitizedIncoming.filter((r) => !r.id.startsWith('admin::'));
          const incomingSellerRawIds = new Set(incomingSellerRows.map((r) => r.id));

          const kept: TicketEntryRow[] = [];
          const keptIds = new Set<string>();
          for (let i = 0; i < current.length; i++) {
            if (isRowBlank(current[i])) continue;
            const row = current[i];
            const isOldTaggedSellerRow = row.id.startsWith(sellerPrefix);
            // Upgrade legacy pre-prefix seller rows matching incoming seller IDs without duplicating
            const isLegacyMatchingSellerRow =
              !row.id.startsWith('sub::') &&
              !row.id.startsWith('seller::') &&
              resolved[i].trim().toUpperCase() === targetUpper &&
              incomingSellerRawIds.has(row.id);

            if (!isOldTaggedSellerRow && !isLegacyMatchingSellerRow) {
              const preserved = row.name.trim() ? row : { ...row, name: resolved[i] };
              kept.push(preserved);
              keptIds.add(preserved.id);
              if (preserved.id.startsWith('admin::')) {
                keptIds.add(preserved.id.slice('admin::'.length));
              }
            }
          }

          // On initial hydration of a fresh/second Admin device, restore Admin's cloud-backed manual rows if missing locally
          const restoredAdminRows: TicketEntryRow[] = [];
          if (isInitialHydration) {
            for (const r of incomingAdminRows) {
              const rawAdminId = r.id.slice('admin::'.length);
              if (rawAdminId && !keptIds.has(rawAdminId) && !keptIds.has(r.id)) {
                restoredAdminRows.push({ ...r, id: rawAdminId });
                keptIds.add(rawAdminId);
              }
            }
          }

          const taggedSellerRows = incomingSellerRows.map((r) => ({
            ...r,
            id: r.id.startsWith(sellerPrefix) ? r.id : `${sellerPrefix}${r.id}`,
          }));

          nextEntries[sid] = normalizeRowsKeepOneTrailing([
            ...kept,
            ...restoredAdminRows,
            ...taggedSellerRows,
          ]);
        };

        mergeSession('1PM', sheet.entries1PM || []);
        mergeSession('6PM', sheet.entries6PM || []);
        mergeSession('8PM', sheet.entries8PM || []);
      }

      return {
        ...prev,
        entries: nextEntries,
      };
    });

    if (!isInitialHydration) {
      const names = changedRemoteSheets
        .map((item) =>
          item.isSubSheet
            ? `${item.sheet.partyName}${item.rootMasterName ? ` → ${item.rootMasterName}` : ' (Chain)'}`
            : item.sheet.partyName
        )
        .join(', ');
      AppSounds.add();
      showToast(`Live Entry synced: ${names}`);
    }
  }, [cloudSession, authUser, cloudHydrated, cloudParties, cloudSheets, isAdminRestoredView, setState, showToast]);

  // Admin -> Cloud Sync: Date, Limit Threshold, Item Options & Official Winning Numbers
  // Strictly paused while Admin is viewing a locally restored Archive date so Master/Sub-Master live data is NEVER affected.
  useEffect(() => {
    if (cloudSession.kind !== 'admin' || !cloudAgency || isAdminRestoredView) return;
    const sig = JSON.stringify({
      date: state.date,
      limitThreshold: state.config.limitThreshold,
      sellerLimitThreshold: state.config.sellerLimitThreshold ?? 20,
      excludedPrizeNames: state.config.excludedPrizeNames,
      itemOptions: state.config.itemOptions,
      winning1PM: state.winningRaw['1PM'],
      winning6PM: state.winningRaw['6PM'],
      winning8PM: state.winningRaw['8PM'],
    });
    if (sig === lastAgencySigRef.current) return;

    const timer = window.setTimeout(() => {
      if (isAdminRestoredViewRef.current) return;
      lastAgencySigRef.current = sig;
      void syncAdminAgencyState(latestStateRef.current).catch((err) => {
        setCloudError(err instanceof Error ? err.message : 'Agency sync error');
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [
    cloudSession,
    cloudAgency,
    isAdminRestoredView,
    state.date,
    state.config.limitThreshold,
    state.config.sellerLimitThreshold,
    state.config.excludedPrizeNames,
    state.config.itemOptions,
    state.winningRaw,
  ]);

  // Admin -> Cloud Sync: Sellers (Name, Rate, Due, Joma, Mobile) & Easy Login ID/Password creation
  const syncAllSellersToCloud = useCallback(async () => {
    if (
      cloudSession.kind !== 'admin' ||
      !authUser ||
      !cloudAgencyRef.current ||
      isAdminRestoredViewRef.current
    ) {
      return;
    }
    setCloudBusy(true);
    setCloudError('');
    try {
      const agencyDoc = cloudAgencyRef.current;
      const currState = latestStateRef.current;
      const usedLoginIds = new Set(
        cloudPrivatesRef.current
          .map((pr) => (pr.loginId || '').trim().toUpperCase())
          .filter(Boolean)
      );

      for (const seller of currState.sellers) {
        const expectedId = makePartyIdFromSeller(seller);
        const upperName = seller.name.trim().toUpperCase();
        const directParties = cloudPartiesRef.current.filter((p) => !p.parentMasterId);
        const existingParty =
          directParties.find((p) => p.partyId === expectedId) ||
          directParties.find((p) => p.name.trim().toUpperCase() === upperName);
        const existingPriv = existingParty
          ? cloudPrivatesRef.current.find((pr) => pr.partyId === existingParty.partyId)
          : undefined;
        const initialRows = extractSellerRowsFromEntries(
          currState.entries,
          seller.name,
          existingParty?.partyId || expectedId
        );
        await createOrSyncSellerParty(
          authUser.uid,
          agencyDoc.ownerUid,
          agencyDoc.adminUids,
          seller,
          existingParty,
          existingPriv,
          currState.date,
          initialRows,
          usedLoginIds
        );
      }

      // Also backfill easy Login ID + Password for any existing Sub-Sellers missing credentials
      const existingSheetIds = new Set(cloudSheetsRef.current.map((s) => s.partyId));
      for (const subParty of cloudPartiesRef.current) {
        if (!subParty.parentMasterId) continue;
        const subPriv = cloudPrivatesRef.current.find((pr) => pr.partyId === subParty.partyId);
        if (
          subPriv?.loginId &&
          subPriv?.loginPassword &&
          subParty.accessKey?.startsWith('cred_')
        ) {
          continue;
        }
        const loginId = subPriv?.loginId
          ? normalizeLoginId(subPriv.loginId)
          : generateEasyLoginId(subParty.name, usedLoginIds);
        const loginPassword = subPriv?.loginPassword || generateEasyPassword();
        await updatePartyLoginCredentials(
          authUser.uid,
          subParty,
          subPriv,
          loginId,
          loginPassword,
          existingSheetIds.has(subParty.partyId),
          false
        );
      }
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : 'Could not sync sellers to cloud.');
    } finally {
      setCloudBusy(false);
    }
  }, [cloudSession, authUser, extractSellerRowsFromEntries]);

  // Cloud -> Local Hydration: restore any direct sellers already saved in Firestore (e.g. on a fresh browser/phone)
  useEffect(() => {
    if (cloudSession.kind !== 'admin' || !cloudHydrated || cloudParties.length === 0) return;

    setState((prev) => {
      const existingIds = new Set(prev.sellers.map((s) => s.id));
      const existingNames = new Set(prev.sellers.map((s) => s.name.trim().toUpperCase()));
      const restoredFromCloud: Seller[] = [];

      for (const party of cloudParties) {
        if (party.role === 'admin' || party.parentMasterId) continue;
        const upperName = party.name.trim().toUpperCase();
        if (!upperName) continue;
        if (existingIds.has(party.partyId) || existingNames.has(upperName)) continue;
        const priv = cloudPrivates.find((pr) => pr.partyId === party.partyId);
        restoredFromCloud.push({
          id: party.partyId,
          name: upperName,
          mobile: priv?.mobile || '',
          rate: Number.isFinite(party.rate) ? party.rate : 10,
          due: Number.isFinite(party.due) ? party.due : 0,
          joma: Number.isFinite(party.joma) ? party.joma : 0,
        });
      }

      if (restoredFromCloud.length === 0) return prev;
      return {
        ...prev,
        sellers: [...prev.sellers, ...restoredFromCloud],
      };
    });
  }, [cloudSession, cloudHydrated, cloudParties, cloudPrivates, setState]);

  useEffect(() => {
    if (
      cloudSession.kind !== 'admin' ||
      !authUser ||
      !cloudAgency ||
      !cloudHydrated ||
      isAdminRestoredView
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (isAdminRestoredViewRef.current) return;
      void syncAllSellersToCloud();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    cloudSession,
    authUser,
    cloudAgency,
    cloudHydrated,
    isAdminRestoredView,
    state.sellers,
    syncAllSellersToCloud,
  ]);

  // Admin -> Cloud Sync: Push Admin's edits for a seller's 1PM/6PM/8PM rows to that seller's sheet
  // Optimized to a single O(N) pass across all 30,000+ rows instead of scanning per seller.
  // Strictly paused while Admin is viewing a locally restored Archive date so Master/Sub-Master live sheets are NEVER overwritten.
  useEffect(() => {
    if (
      cloudSession.kind !== 'admin' ||
      !authUser ||
      !cloudHydrated ||
      cloudParties.length === 0 ||
      isAdminRestoredView
    ) {
      return;
    }
    const adminUid = authUser.uid;
    const totalRows =
      (state.entries['1PM']?.length || 0) +
      (state.entries['6PM']?.length || 0) +
      (state.entries['8PM']?.length || 0);
    const debounceMs = totalRows > 3000 ? 1100 : 450;

    const timer = window.setTimeout(() => {
      if (isAdminRestoredViewRef.current) return;
      const currState = latestStateRef.current;
      const existingSheetIds = new Set(cloudSheetsRef.current.map((s) => s.partyId));
      const directParties = cloudPartiesRef.current.filter((p) => !p.parentMasterId);
      if (directParties.length === 0) return;

      // Single O(N) grouping pass per session by resolved seller name
      const partyByUpperName = new Map<string, CloudPartyDoc>();
      for (const party of directParties) {
        const up = party.name.trim().toUpperCase();
        if (up) partyByUpperName.set(up, party);
      }

      const grouped: Record<
        string,
        { '1PM': TicketEntryRow[]; '6PM': TicketEntryRow[]; '8PM': TicketEntryRow[] }
      > = {};
      for (const party of directParties) {
        grouped[party.partyId] = { '1PM': [], '6PM': [], '8PM': [] };
      }

      for (const sid of ['1PM', '6PM', '8PM'] as SessionId[]) {
        const rows = currState.entries[sid] || [];
        let lastValidName = '';
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const currName = row.name.trim();
          if (currName !== '') {
            lastValidName = currName;
          }
          if (isRowBlank(row)) continue;
          if (row.id.startsWith('sub::')) continue;
          const resolvedName = currName !== '' ? currName : lastValidName;
          if (!resolvedName) continue;
          const party = partyByUpperName.get(resolvedName.toUpperCase());
          if (!party) continue;

          const sellerPrefix = `seller::${party.partyId}::`;
          let cloudRowId = row.id;
          if (row.id.startsWith(sellerPrefix)) {
            cloudRowId = row.id.slice(sellerPrefix.length) || row.id;
          } else {
            cloudRowId = row.id.startsWith('admin::') ? row.id : `admin::${row.id}`;
          }
          grouped[party.partyId][sid].push({ ...row, id: cloudRowId, name: party.name });
        }
      }

      for (const party of directParties) {
        const sliced = grouped[party.partyId];
        const clean1 = sanitizeSheetEntriesForCloud(sliced['1PM'], party.name);
        const clean6 = sanitizeSheetEntriesForCloud(sliced['6PM'], party.name);
        const clean8 = sanitizeSheetEntriesForCloud(sliced['8PM'], party.name);
        const sig = serializeSheetEntries(clean1, clean6, clean8);
        if (sig !== lastCloudSheetSigRef.current[party.partyId]) {
          lastCloudSheetSigRef.current[party.partyId] = sig;
          lastAdminPushSigRef.current[party.partyId] = sig;
          void pushAdminSheetRowsForParty(
            adminUid,
            party,
            currState.date,
            clean1,
            clean6,
            clean8,
            existingSheetIds.has(party.partyId)
          ).catch(() => {});
        }
      }
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [
    cloudSession,
    authUser,
    cloudHydrated,
    cloudParties,
    isAdminRestoredView,
    state.entries,
    state.date,
  ]);

  // Admin Handoff & Multi-Level Lineage Backfill: keep parentMasterUid, ancestorMasterIds,
  // and ancestorMasterUids updated on every Sub-Seller (L2, L3, L4, L5+) and their sheets
  // so every ancestor Agent/Master in the chain receives live entries immediately.
  useEffect(() => {
    if (cloudSession.kind !== 'admin' || !authUser || !cloudHydrated || cloudParties.length === 0) {
      return;
    }
    const adminUid = authUser.uid;
    const privateIds = new Set(cloudPrivates.map((pr) => pr.partyId));
    const sheetByPartyId = new Map<string, CloudPartySheetDoc>();
    for (const s of cloudSheets) {
      sheetByPartyId.set(s.partyId, s);
    }

    const sameList = (a?: string[], b?: string[]): boolean => {
      const la = a || [];
      const lb = b || [];
      if (la.length !== lb.length) return false;
      for (let i = 0; i < la.length; i++) {
        if (la[i] !== lb[i]) return false;
      }
      return true;
    };

    for (const sub of cloudParties) {
      if (!sub.parentMasterId) continue;
      const lineage = computeFullAncestorChainFromParties(sub, cloudParties);
      const sheet = sheetByPartyId.get(sub.partyId);

      const partyNeedsUpdate =
        (sub.parentMasterUid || '') !== lineage.parentMasterUid ||
        !sameList(sub.ancestorMasterIds, lineage.ancestorMasterIds) ||
        !sameList(sub.ancestorMasterUids, lineage.ancestorMasterUids);

      const sheetNeedsUpdate = Boolean(
        sheet &&
          ((sheet.parentMasterUid || '') !== lineage.parentMasterUid ||
            !sameList(sheet.ancestorMasterIds, lineage.ancestorMasterIds) ||
            !sameList(sheet.ancestorMasterUids, lineage.ancestorMasterUids))
      );

      if (!partyNeedsUpdate && !sheetNeedsUpdate) continue;

      void syncSubSellerChainLineage(
        adminUid,
        sub,
        lineage,
        privateIds.has(sub.partyId),
        Boolean(sheet)
      ).catch(() => {});
    }
  }, [cloudSession, authUser, cloudHydrated, cloudParties, cloudPrivates, cloudSheets]);

  const handleAdminGoogleSignIn = async () => {
    setCloudBusy(true);
    setCloudError('');
    try {
      // Reuse already-signed-in verified Google account without triggering a popup if possible;
      // never reuse an Anonymous Seller session for Admin login.
      let user = auth.currentUser;
      if (!user || user.isAnonymous) {
        const cred = await signInWithPopup(auth, googleProvider, popupRedirectResolver);
        user = cred.user;
      }
      const resolved = await loadUserCloudSession(user.uid, user.email);
      if (resolved.kind === 'seller') {
        setCloudSession(resolved);
        writeCachedCloudSession({
          uid: user.uid,
          kind: 'seller',
          agencyId: resolved.agencyId,
          partyId: resolved.partyId,
        });
        setSellerIdsOpen(false);
        return;
      }
      const agencyDoc = await bootstrapAdminAgency(user.uid, latestStateRef.current);
      setCloudAgency(agencyDoc);
      writeDevicePortalMode('admin');
      setDevicePortalMode('admin');
      setCloudSession({
        kind: 'admin',
        agencyId: agencyDoc.agencyId,
        ownerUid: agencyDoc.ownerUid,
      });
      writeCachedCloudSession({
        uid: user.uid,
        kind: 'admin',
        agencyId: agencyDoc.agencyId,
        ownerUid: agencyDoc.ownerUid,
      });
      setSellerLoginMode(false);
      clearLoginQueryParams();
      AppSounds.success();
      showToast('Admin Cloud Sync Activated — Auto-Login Saved!');
    } catch (err) {
      setCloudError(formatFirebaseAuthError(err));
    } finally {
      setCloudBusy(false);
    }
  };

  const handleCloudSignOut = async () => {
    const wasSellerSession = cloudSession.kind === 'seller' || devicePortalMode === 'seller';
    setCloudBusy(true);
    try {
      clearCachedCloudSession();
      updateAdminRestoredMode(null);
      await signOut(auth);
      setCloudSession({ kind: 'none' });
      setCloudAgency(null);
      setCloudParties([]);
      setCloudPrivates([]);
      setCloudSheets([]);
      setAdminPreviewParty(null);
      clearLoginQueryParams();
      if (wasSellerSession) {
        writeDevicePortalMode('seller');
        setDevicePortalMode('seller');
        setSellerLoginMode(true);
      } else {
        setSellerLoginMode(false);
      }
    } finally {
      setCloudBusy(false);
    }
  };

  const handleSavePublicAnnouncement = async (input: {
    active: boolean;
    kind: CloudAnnouncementKind;
    title: string;
    message: string;
  }) => {
    if (cloudSession.kind !== 'admin' || !authUser) {
      setAnnouncementError('Pehle Admin Google Sign-In karein.');
      return;
    }
    setAnnouncementBusy(true);
    setAnnouncementError('');
    try {
      const saved = await savePublicAnnouncementCloud(
        authUser.uid,
        cloudSession.agencyId,
        cloudSession.ownerUid,
        input
      );
      setPublicAnnouncement(saved);
      AppSounds.success();
      if (saved.active) {
        showToast('Advertisement / Message sabhi App, Link, Master & Sub-Master par LIVE ho gaya!');
        setAnnouncementModalOpen(false);
      } else {
        showToast('Advertisement hide / clear kar diya gaya.');
      }
    } catch (err) {
      setAnnouncementError(formatFirebaseAuthError(err));
    } finally {
      setAnnouncementBusy(false);
    }
  };

  const handleLoginWithIdPassword = async (loginId: string, password: string) => {
    setCloudBusy(true);
    setCloudError('');
    try {
      // Direct ID + Password Login using Firebase Anonymous Auth (zero email, zero Google popup)
      const anonUser = await ensureAnonymousSellerAuth();
      const claimed = await loginSellerWithIdPassword(anonUser.uid, loginId, password);
      clearLoginQueryParams();
      writeDevicePortalMode('seller');
      setDevicePortalMode('seller');
      setCloudSession({
        kind: 'seller',
        agencyId: claimed.agencyId,
        partyId: claimed.partyId,
      });
      writeCachedCloudSession({
        uid: anonUser.uid,
        kind: 'seller',
        agencyId: claimed.agencyId,
        partyId: claimed.partyId,
        loginId: normalizeLoginId(loginId),
      });
      setSellerLoginMode(false);
      AppSounds.success();
    } catch (err) {
      setCloudError(formatFirebaseAuthError(err));
    } finally {
      setCloudBusy(false);
    }
  };

  const handleTogglePartyActive = async (party: CloudPartyDoc, nextActive: boolean) => {
    setCloudError('');
    try {
      await toggleSellerPartyActive(party, nextActive);
      showToast(
        nextActive
          ? `${party.name} Seller ID Activated`
          : `${party.name} Seller ID Paused`
      );
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : 'Failed to toggle seller status.');
    }
  };

  const handleTogglePartyChainRole = async (
    party: CloudPartyDoc,
    nextRole: 'master' | 'client'
  ) => {
    setCloudError('');
    try {
      await toggleSellerChainRole(party, nextRole);
      showToast(
        nextRole === 'master'
          ? `${party.name}: Chain System ON (ab aage Sub-Seller ID de sakta hai)`
          : `${party.name}: Chain System OFF (Direct Seller only)`
      );
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : 'Failed to update Chain role.');
    }
  };

  const handleResetPartyKey = async (party: CloudPartyDoc) => {
    if (!authUser) return;
    setCloudError('');
    try {
      const exists = cloudSheetsRef.current.some((s) => s.partyId === party.partyId);
      const existingPriv = cloudPrivatesRef.current.find((pr) => pr.partyId === party.partyId);
      const updated = await resetSellerAccessKey(authUser.uid, party, exists, existingPriv);
      showToast(
        `${party.name} New Password ready — ID: ${updated.loginId} · Pass: ${updated.loginPassword}`
      );
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : 'Failed to reset Password.');
    }
  };

  const handleUpdatePartyCredentials = async (
    party: CloudPartyDoc,
    loginId: string,
    loginPassword: string
  ) => {
    if (!authUser) return;
    setCloudError('');
    try {
      const exists = cloudSheetsRef.current.some((s) => s.partyId === party.partyId);
      const existingPriv = cloudPrivatesRef.current.find((pr) => pr.partyId === party.partyId);
      const updated = await updatePartyLoginCredentials(
        authUser.uid,
        party,
        existingPriv,
        loginId,
        loginPassword,
        exists,
        false
      );
      showToast(`${party.name} updated — ID: ${updated.loginId} · Pass: ${updated.loginPassword}`);
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : 'Failed to update Login ID & Password.');
      throw err;
    }
  };

  const handleEnableChainAll = async () => {
    if (cloudSession.kind !== 'admin') return;
    const targets = cloudPartiesRef.current.filter(
      (p) => !p.parentMasterId && p.role !== 'master'
    );
    if (targets.length === 0) {
      showToast('All direct Sellers already have Master Chain ON');
      return;
    }
    setCloudBusy(true);
    setCloudError('');
    try {
      for (const party of targets) {
        await toggleSellerChainRole(party, 'master');
      }
      AppSounds.success();
      showToast(`Chain System ON enabled for ${targets.length} Master Seller(s)`);
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : 'Failed to enable Chain for all.');
    } finally {
      setCloudBusy(false);
    }
  };

  const handleCreateSubSellerForMaster = async (
    parentMaster: CloudPartyDoc,
    subInput: { name: string; rate: number; mobile: string; allowChain: boolean }
  ) => {
    if (!authUser) return;
    setCloudError('');
    try {
      const usedLoginIds = new Set(
        cloudPrivatesRef.current
          .map((pr) => (pr.loginId || '').trim().toUpperCase())
          .filter(Boolean)
      );
      const created = await createSubSellerForMasterByAdmin(
        authUser.uid,
        parentMaster,
        subInput,
        latestStateRef.current.date,
        cloudPartiesRef.current,
        usedLoginIds
      );
      showToast(
        `${created.name} under ${parentMaster.name} — ID: ${created.loginId} · Pass: ${created.loginPassword}`
      );
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : 'Failed to assign Sub-Seller ID.');
      throw err;
    }
  };

  const handleDeleteSubParty = async (subParty: CloudPartyDoc) => {
    setCloudError('');
    try {
      // Collect the target sub-seller plus any nested L3+ descendants so no orphans remain
      const all = cloudPartiesRef.current;
      const toDelete: CloudPartyDoc[] = [];
      const visited = new Set<string>();
      const queue: CloudPartyDoc[] = [subParty];
      while (queue.length > 0) {
        const curr = queue.shift()!;
        if (visited.has(curr.partyId)) continue;
        visited.add(curr.partyId);
        toDelete.push(curr);
        for (const candidate of all) {
          if (candidate.parentMasterId === curr.partyId && !visited.has(candidate.partyId)) {
            queue.push(candidate);
          }
        }
      }

      for (const node of toDelete) {
        await deleteSubSellerParty(node);
        delete lastCloudSheetSigRef.current[node.partyId];
        delete subSheetMergedSigRef.current[node.partyId];
      }

      const prefixes = toDelete.map((n) => `sub::${n.partyId}::`);
      setState((prev) => {
        const stripSession = (rows: TicketEntryRow[]) =>
          normalizeRowsKeepOneTrailing(
            rows.filter((r) => !prefixes.some((pf) => r.id.startsWith(pf)))
          );
        return {
          ...prev,
          entries: {
            '1PM': stripSession(prev.entries['1PM']),
            '6PM': stripSession(prev.entries['6PM']),
            '8PM': stripSession(prev.entries['8PM']),
          },
        };
      });

      AppSounds.remove();
      showToast(
        toDelete.length > 1
          ? `Deleted ${subParty.name} and ${toDelete.length - 1} nested Sub-Seller(s)`
          : `Deleted Sub-Seller ${subParty.name}`
      );
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : 'Failed to delete Sub-Seller.');
    }
  };

  // Recover from IndexedDB & Permanent Seller Vault if newer than localStorage
  useEffect(() => {
    let cancelled = false;

    const syncFromNewestStore = async () => {
      const lsEnv = readLocalStorageEnvelope();
      const idbEnv = await readIndexedDbEnvelope();
      const lsVault = readPermanentSellersLocal();
      const idbVault = await readPermanentSellersIdb();
      if (cancelled) return;

      let winner = lsEnv;
      if (idbEnv && (!winner || idbEnv.updatedAt > winner.updatedAt)) {
        winner = idbEnv;
      }

      let newestVault = lsVault;
      if (idbVault && (!newestVault || idbVault.updatedAt > newestVault.updatedAt)) {
        newestVault = idbVault;
      }

      if (winner && winner.updatedAt > lastSavedAtRef.current) {
        const normalized = normalizeLoadedState(winner.state);
        const restoredSellers =
          newestVault && newestVault.sellers.length > 0
            ? mergeWithPermanentSellers(normalized.sellers, newestVault.sellers)
            : normalized.sellers;
        const nextNormalized = { ...normalized, sellers: restoredSellers };
        latestStateRef.current = nextNormalized;
        lastSavedAtRef.current = winner.updatedAt;
        writeLocalStorageSafe(nextNormalized, winner.updatedAt);
        if (restoredSellers.length > 0) {
          writePermanentSellers(restoredSellers, winner.updatedAt);
        }
        setRawState(nextNormalized);
      } else if (newestVault && newestVault.sellers.length > 0) {
        const merged = mergeWithPermanentSellers(
          latestStateRef.current.sellers,
          newestVault.sellers
        );
        if (merged.length > latestStateRef.current.sellers.length) {
          const ts = Math.max(Date.now(), newestVault.updatedAt);
          const recovered: AppState = {
            ...latestStateRef.current,
            sellers: merged,
          };
          latestStateRef.current = recovered;
          lastSavedAtRef.current = ts;
          writeLocalStorageSafe(recovered, ts);
          void writeIndexedDbEnvelope(recovered, ts);
          setRawState(recovered);
        }
      } else if (!lsEnv && lastSavedAtRef.current > 0) {
        writeLocalStorageSafe(latestStateRef.current, lastSavedAtRef.current);
      }
    };

    void syncFromNewestStore();

    const flushCurrent = () => {
      const ts = Math.max(Date.now(), lastSavedAtRef.current);
      lastSavedAtRef.current = ts;
      flushPersistNow();
      if (latestStateRef.current.sellers.length > 0) {
        writePermanentSellers(latestStateRef.current.sellers, ts);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushCurrent();
      } else if (document.visibilityState === 'visible') {
        void syncFromNewestStore();
      }
    };

    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        void syncFromNewestStore();
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === PERMANENT_SELLERS_KEY) {
        void syncFromNewestStore();
      }
    };

    window.addEventListener('pagehide', flushCurrent);
    window.addEventListener('beforeunload', flushCurrent);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('storage', handleStorage);

    return () => {
      cancelled = true;
      flushCurrent();
      window.removeEventListener('pagehide', flushCurrent);
      window.removeEventListener('beforeunload', flushCurrent);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('storage', handleStorage);
    };
  }, [flushPersistNow]);

  // Core Lottery Calculations — split per session so editing 1PM NEVER recomputes 6PM or 8PM!
  const comp1PM = useMemo(
    () => processSessionRows(state.entries['1PM'], '1PM', state.config),
    [state.entries['1PM'], state.config]
  );
  const comp6PM = useMemo(
    () => processSessionRows(state.entries['6PM'], '6PM', state.config),
    [state.entries['6PM'], state.config]
  );
  const comp8PM = useMemo(
    () => processSessionRows(state.entries['8PM'], '8PM', state.config),
    [state.entries['8PM'], state.config]
  );

  const sessionComputations = useMemo<Record<SessionId, SessionComputation>>(
    () => ({
      '1PM': comp1PM,
      '6PM': comp6PM,
      '8PM': comp8PM,
    }),
    [comp1PM, comp6PM, comp8PM]
  );

  // Defer secondary bill & prize recalculations during rapid 30,000-row sheet entry so typing stays 60fps
  const deferredSessionComputations = useDeferredValue(sessionComputations);

  const parsedWinning = useMemo(
    () => parseWinningNumbers(state.winningRaw),
    [state.winningRaw]
  );

  const { prizeList, limitPrizeGroups, limitGrandTotal } = useMemo(
    () => generatePrizeAndLimitData(deferredSessionComputations, parsedWinning, state.config),
    [deferredSessionComputations, parsedWinning, state.config]
  );

  const visibleSellersForBill = useMemo(
    () => state.sellers.filter((s) => !isMyChoiceName(s.name)),
    [state.sellers]
  );

  const sellerBills = useMemo(
    () =>
      computeSellerBills(
        visibleSellersForBill,
        deferredSessionComputations,
        prizeList,
        state.date
      ),
    [visibleSellersForBill, deferredSessionComputations, prizeList, state.date]
  );

  const availableNames = useMemo(() => {
    const names = [
      ...state.sellers.map((s) => s.name.trim().toUpperCase()),
      ...state.extraNames.map((n) => n.trim().toUpperCase()),
    ].filter(Boolean);
    if (!names.some((n) => isMyChoiceName(n))) {
      names.push('MY CHOICE');
    }
    return Array.from(new Set(names));
  }, [state.sellers, state.extraNames]);

  const limitPrizeCount = useMemo(
    () => limitPrizeGroups.reduce((acc, g) => acc + g.rows.length, 0),
    [limitPrizeGroups]
  );

  const commitSessionRows = useCallback(
    (sessionId: SessionId, nextRows: TicketEntryRow[]) => {
      const normalized = normalizeRowsKeepOneTrailing(nextRows);
      setState((prev) => ({
        ...prev,
        entries: {
          ...prev.entries,
          [sessionId]: normalized,
        },
      }));
    },
    [setState]
  );

  // Archive & Rollover Handlers
  const buildCurrentSnapshot = (trigger: DaySnapshot['trigger']): DaySnapshot => {
    const totalSold = round2(sellerBills.reduce((a, b) => a + b.sold, 0));
    const totalBill = round2(sellerBills.reduce((a, b) => a + b.bill, 0));
    const totalPrize = round2(sellerBills.reduce((a, b) => a + b.prizeTotal, 0));
    const totalNetPayable = round2(sellerBills.reduce((a, b) => a + b.total, 0));

    return {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date: state.date,
      savedAt: new Date().toISOString(),
      trigger,
      totalSold,
      totalBill,
      totalPrize,
      totalNetPayable,
      limitGrandTotal,
      overLimitTotals: {
        '1PM': sessionComputations['1PM'].overLimitTotal,
        '6PM': sessionComputations['6PM'].overLimitTotal,
        '8PM': sessionComputations['8PM'].overLimitTotal,
      },
      sellerSummaries: sellerBills.map((b) => ({
        name: b.name,
        mor: b.mor,
        day: b.day,
        eve: b.eve,
        sold: b.sold,
        bill: b.bill,
        prizeTotal: b.prizeTotal,
        fresh: b.fresh,
        joma: b.joma,
        due: b.due,
        total: b.total,
      })),
      prizeList,
      limitPrizeGroups,
      sellers: state.sellers,
      entries: state.entries,
      winningRaw: state.winningRaw,
    };
  };

  const getNextIsoDate = (isoDate: string): string => {
    const parts = isoDate.split('-').map(Number);
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      const dt = new Date(parts[0], parts[1] - 1, parts[2] + 1);
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return getTodayIsoDate();
  };

  const carryForwardSellerBalances = (): Seller[] =>
    sellerBills.map((b) => {
      const net = round2(b.total);
      return {
        id: b.id,
        name: b.name,
        mobile: b.mobile,
        rate: b.rate,
        due: net > 0 ? net : 0,
        joma: net < 0 ? round2(Math.abs(net)) : 0,
      };
    });

  const handleExitAdminRestoredMode = () => {
    if (!adminRestoredMode) return;
    AppSounds.tap();
    const { liveBackup, liveDate } = adminRestoredMode;
    const editedRestoredSnap = buildCurrentSnapshot('manual');

    // Clear restored flag FIRST so cloud live sync can resume cleanly on the live date
    updateAdminRestoredMode(null);
    const today = getTodayIsoDate();
    skipAutoRolloverDateRef.current = liveDate < today ? liveDate : null;

    // Reset sheet tracking refs so any Master/Sub-Master entries submitted while Admin
    // was viewing an old archive merge back into Admin's Live ledger immediately.
    lastAgencySigRef.current = '';
    lastCloudSheetSigRef.current = {};
    lastAdminPushSigRef.current = {};
    subSheetMergedSigRef.current = {};
    sheetsHydratedOnceRef.current = false;

    setState((prev) => {
      const nextHistory = [...prev.history];
      const restoredIdx = nextHistory.findIndex((h) => h.date === editedRestoredSnap.date);
      if (restoredIdx !== -1) {
        nextHistory[restoredIdx] = editedRestoredSnap;
      }

      const preservedCurrentSellers = prev.sellers.map((s) => ({
        ...s,
        due: 0,
        joma: 0,
      }));
      const mergedLiveSellers = mergeWithPermanentSellers(
        liveBackup.sellers,
        preservedCurrentSellers
      );

      return {
        ...prev,
        date: liveDate,
        config: {
          ...prev.config,
          pausedAutoArchiveDate: liveDate < today ? liveDate : undefined,
        },
        sellers: mergedLiveSellers,
        entries: {
          '1PM': normalizeRowsKeepOneTrailing(liveBackup.entries['1PM'] || []),
          '6PM': normalizeRowsKeepOneTrailing(liveBackup.entries['6PM'] || []),
          '8PM': normalizeRowsKeepOneTrailing(liveBackup.entries['8PM'] || []),
        },
        winningRaw: liveBackup.winningRaw,
        history: preserveSavedSnapshots(nextHistory).slice(0, 180),
      };
    });

    setRecentlyPastedIds({ '1PM': [], '6PM': [], '8PM': [] });
    setSessionHistory({
      '1PM': { undo: [], redo: [] },
      '6PM': { undo: [], redo: [] },
      '8PM': { undo: [], redo: [] },
    });
    showToast(`Back to Live (${formatDateDDMM(liveDate)}) · Master/Sub-Master live sync resumed`);
  };

  const performArchiveAndRollover = (
    trigger: DaySnapshot['trigger'] = 'manual',
    explicitNextDate?: string
  ) => {
    // Never accidentally close day / overwrite Master & Sub-Master while Admin is viewing a restored old archive
    if (adminRestoredMode) {
      const liveDateLabel = formatDateDDMM(adminRestoredMode.liveDate);
      handleExitAdminRestoredMode();
      showToast(
        `Pehle Live date (${liveDateLabel}) par wapas aa gaye — ab dubara Close Day / Archive dabayein.`,
        5200
      );
      return;
    }

    const snapshot = buildCurrentSnapshot(trigger);
    const nextDate = explicitNextDate || getNextIsoDate(state.date);

    skipAutoRolloverDateRef.current = null;
    setRecentlyPastedIds({ '1PM': [], '6PM': [], '8PM': [] });
    setSessionHistory({
      '1PM': { undo: [], redo: [] },
      '6PM': { undo: [], redo: [] },
      '8PM': { undo: [], redo: [] },
    });

    const nextSellers = carryForwardSellerBalances();

    setState((prev) => ({
      ...prev,
      date: nextDate,
      config: {
        ...prev.config,
        pausedAutoArchiveDate: undefined,
      },
      sellers: nextSellers,
      entries: {
        '1PM': createBlankRows(1),
        '6PM': createBlankRows(1),
        '8PM': createBlankRows(1),
      },
      winningRaw: { '1PM': '', '6PM': '', '8PM': '' },
      history: preserveSavedSnapshots([snapshot, ...prev.history]).slice(0, 180),
    }));

    if (cloudSession.kind === 'admin' && authUser) {
      const existingSheetIds = new Set(cloudSheetsRef.current.map((s) => s.partyId));
      const emptySig = serializeSheetEntries([], [], []);
      const billByName = new Map(
        sellerBills.map((b) => [b.name.trim().toUpperCase(), b] as const)
      );
      const sheetByPartyId = new Map(
        cloudSheetsRef.current.map((s) => [s.partyId, s] as const)
      );
      const carriedSubBalances = new Map<string, { party: CloudPartyDoc; due: number; joma: number }>();

      // Auto-save full isolated daily archive snapshot (bills + entries + prizes + winning numbers)
      // for EVERY active Master, Sub-Master & Sub-Seller so all of their data is archived when Admin closes day
      for (const party of cloudPartiesRef.current) {
        if (!party.active) continue;
        const partyUpper = party.name.trim().toUpperCase();
        const ownSheet = sheetByPartyId.get(party.partyId);
        const matchedTopBill = !party.parentMasterId ? billByName.get(partyUpper) : undefined;
        const directSubParties = cloudPartiesRef.current.filter(
          (sp) => sp.parentMasterId === party.partyId
        );

        // Collect all descendant sub-parties under this party (L2, L3, L4...)
        const descendantParties: typeof cloudPartiesRef.current = [];
        if (party.role === 'master' && directSubParties.length > 0) {
          const queue = [...directSubParties];
          const seenIds = new Set<string>([party.partyId]);
          while (queue.length > 0) {
            const cur = queue.shift()!;
            if (seenIds.has(cur.partyId)) continue;
            seenIds.add(cur.partyId);
            descendantParties.push(cur);
            for (const child of cloudPartiesRef.current) {
              if (child.parentMasterId === cur.partyId && !seenIds.has(child.partyId)) {
                queue.push(child);
              }
            }
          }
        }

        const collectOwnSessionRows = (sid: SessionId): TicketEntryRow[] => {
          const fromSheet =
            sid === '1PM'
              ? ownSheet?.entries1PM
              : sid === '6PM'
                ? ownSheet?.entries6PM
                : ownSheet?.entries8PM;
          if (fromSheet && fromSheet.length > 0) {
            return fromSheet.filter((r) => !isRowBlank(r));
          }
          if (!party.parentMasterId) {
            return (state.entries[sid] || []).filter(
              (r) => !isRowBlank(r) && r.name.trim().toUpperCase() === partyUpper
            );
          }
          return [];
        };

        const collectBranchEntriesForDirectSub = (directSubId: string, sid: SessionId): TicketEntryRow[] => {
          const branchIds = new Set<string>([directSubId]);
          const q = [directSubId];
          while (q.length > 0) {
            const curId = q.shift()!;
            for (const child of cloudPartiesRef.current) {
              if (child.parentMasterId === curId && !branchIds.has(child.partyId)) {
                branchIds.add(child.partyId);
                q.push(child.partyId);
              }
            }
          }
          const directParty = cloudPartiesRef.current.find((p) => p.partyId === directSubId);
          const branchName = (directParty?.name || 'SUB').trim();
          const rows: TicketEntryRow[] = [];
          for (const bid of branchIds) {
            const sh = sheetByPartyId.get(bid);
            const list =
              sid === '1PM' ? sh?.entries1PM : sid === '6PM' ? sh?.entries6PM : sh?.entries8PM;
            for (const r of list || []) {
              if (isRowBlank(r)) continue;
              rows.push({
                ...r,
                id: `branch::${bid}::${r.id}`,
                name: branchName,
              });
            }
          }
          return rows;
        };

        const partySummaries = [];
        const collectedSubPrizes: PrizeListRow[] = [];
        const partyArchiveSellers: Seller[] = [
          {
            id: party.partyId,
            name: party.name,
            mobile: '',
            rate: party.rate,
            due: party.due,
            joma: party.joma,
          },
        ];

        if (party.role === 'master' && directSubParties.length > 0) {
          // Include Master's own sheet prizes too if any
          const ownCompsForPrizes: Record<SessionId, SessionComputation> = {
            '1PM': processSessionRows(collectOwnSessionRows('1PM'), '1PM', state.config),
            '6PM': processSessionRows(collectOwnSessionRows('6PM'), '6PM', state.config),
            '8PM': processSessionRows(collectOwnSessionRows('8PM'), '8PM', state.config),
          };
          const ownPrizes = generatePrizeAndLimitData(ownCompsForPrizes, parsedWinning, state.config);
          collectedSubPrizes.push(...ownPrizes.prizeList);

          for (const sp of directSubParties) {
            partyArchiveSellers.push({
              id: sp.partyId,
              name: sp.name,
              mobile: '',
              rate: sp.rate,
              due: sp.due,
              joma: sp.joma,
            });
            const spComps: Record<SessionId, SessionComputation> = {
              '1PM': processSessionRows(collectBranchEntriesForDirectSub(sp.partyId, '1PM'), '1PM', state.config),
              '6PM': processSessionRows(collectBranchEntriesForDirectSub(sp.partyId, '6PM'), '6PM', state.config),
              '8PM': processSessionRows(collectBranchEntriesForDirectSub(sp.partyId, '8PM'), '8PM', state.config),
            };
            const spPrizeData = generatePrizeAndLimitData(
              spComps,
              parsedWinning,
              state.config
            );
            collectedSubPrizes.push(...spPrizeData.prizeList);
            const spSeller: Seller = {
              id: sp.partyId,
              name: sp.name,
              mobile: '',
              rate: sp.rate,
              due: sp.due,
              joma: sp.joma,
            };
            const [spBill] = computeSellerBills(
              [spSeller],
              spComps,
              spPrizeData.prizeList,
              state.date
            );
            if (spBill) {
              partySummaries.push({
                name: spBill.name,
                mor: spBill.mor,
                day: spBill.day,
                eve: spBill.eve,
                sold: spBill.sold,
                bill: spBill.bill,
                prizeTotal: spBill.prizeTotal,
                fresh: spBill.fresh,
                joma: spBill.joma,
                due: spBill.due,
                total: spBill.total,
              });
              // Queue carry-forward (+Total -> Due, -Total -> Joma) for this Sub-Seller on new date
              const netSub = round2(spBill.total);
              const nextSubDue = netSub > 0 ? netSub : 0;
              const nextSubJoma = netSub < 0 ? round2(Math.abs(netSub)) : 0;
              if (sp.due !== nextSubDue || sp.joma !== nextSubJoma) {
                carriedSubBalances.set(sp.partyId, {
                  party: sp,
                  due: nextSubDue,
                  joma: nextSubJoma,
                });
              }
            }
          }
          // Add any deeper descendant sellers so restored sheet names resolve accurately
          for (const dp of descendantParties) {
            if (!partyArchiveSellers.some((s) => s.id === dp.partyId)) {
              partyArchiveSellers.push({
                id: dp.partyId,
                name: dp.name,
                mobile: '',
                rate: dp.rate,
                due: dp.due,
                joma: dp.joma,
              });
            }
          }
        } else if (matchedTopBill) {
          partySummaries.push({
            name: matchedTopBill.name,
            mor: matchedTopBill.mor,
            day: matchedTopBill.day,
            eve: matchedTopBill.eve,
            sold: matchedTopBill.sold,
            bill: matchedTopBill.bill,
            prizeTotal: matchedTopBill.prizeTotal,
            fresh: matchedTopBill.fresh,
            joma: matchedTopBill.joma,
            due: matchedTopBill.due,
            total: matchedTopBill.total,
          });
        } else {
          // Sub-Seller / Sub-Master without sub-sellers: compute their own bill from their cloud sheet
          const ownComps: Record<SessionId, SessionComputation> = {
            '1PM': processSessionRows(collectOwnSessionRows('1PM'), '1PM', state.config),
            '6PM': processSessionRows(collectOwnSessionRows('6PM'), '6PM', state.config),
            '8PM': processSessionRows(collectOwnSessionRows('8PM'), '8PM', state.config),
          };
          const ownPrizeData = generatePrizeAndLimitData(ownComps, parsedWinning, state.config);
          collectedSubPrizes.push(...ownPrizeData.prizeList);
          const [ownBill] = computeSellerBills(
            [partyArchiveSellers[0]],
            ownComps,
            ownPrizeData.prizeList,
            state.date
          );
          if (ownBill) {
            partySummaries.push({
              name: ownBill.name,
              mor: ownBill.mor,
              day: ownBill.day,
              eve: ownBill.eve,
              sold: ownBill.sold,
              bill: ownBill.bill,
              prizeTotal: ownBill.prizeTotal,
              fresh: ownBill.fresh,
              joma: ownBill.joma,
              due: ownBill.due,
              total: ownBill.total,
            });
          }
        }

        // Build full restorable entries (own rows + descendant sub-seller rows tagged with sub::partyId::)
        const partyArchiveEntries: Record<SessionId, TicketEntryRow[]> = {
          '1PM': [],
          '6PM': [],
          '8PM': [],
        };
        for (const sid of ['1PM', '6PM', '8PM'] as SessionId[]) {
          const ownRows = collectOwnSessionRows(sid).map((r) => ({
            ...r,
            name: party.name,
          }));
          const descRows: TicketEntryRow[] = [];
          for (const dp of descendantParties) {
            const sh = sheetByPartyId.get(dp.partyId);
            const list =
              sid === '1PM' ? sh?.entries1PM : sid === '6PM' ? sh?.entries6PM : sh?.entries8PM;
            for (const r of list || []) {
              if (isRowBlank(r)) continue;
              descRows.push({
                ...r,
                id: `sub::${dp.partyId}::${r.id}`,
                name: dp.name,
              });
            }
          }
          partyArchiveEntries[sid] = [...ownRows, ...descRows];
        }

        const hasAnyPartyData =
          party.due !== 0 ||
          party.joma !== 0 ||
          Boolean(
            matchedTopBill &&
              (matchedTopBill.sold > 0 ||
                matchedTopBill.bill !== 0 ||
                matchedTopBill.prizeTotal !== 0 ||
                matchedTopBill.due !== 0 ||
                matchedTopBill.joma !== 0)
          ) ||
          partySummaries.some(
            (s) => s.sold > 0 || s.bill !== 0 || s.prizeTotal !== 0 || s.due !== 0 || s.joma !== 0
          ) ||
          partyArchiveEntries['1PM'].length > 0 ||
          partyArchiveEntries['6PM'].length > 0 ||
          partyArchiveEntries['8PM'].length > 0;

        if (partySummaries.length > 0 && hasAnyPartyData) {
          const pSold = round2(partySummaries.reduce((a, b) => a + b.sold, 0));
          const pBill = round2(partySummaries.reduce((a, b) => a + b.bill, 0));
          const pPrize = round2(partySummaries.reduce((a, b) => a + b.prizeTotal, 0));
          const pNet = round2(partySummaries.reduce((a, b) => a + b.total, 0));
          const summaryNameSet = new Set(partySummaries.map((s) => s.name.trim().toUpperCase()));
          const partyPrizes =
            collectedSubPrizes.length > 0
              ? collectedSubPrizes
              : prizeList.filter((pr) => summaryNameSet.has(pr.name.trim().toUpperCase()));
          const partySnap: DaySnapshot = {
            id: `snap-${party.partyId.slice(0, 14)}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            date: state.date,
            savedAt: snapshot.savedAt,
            trigger,
            totalSold: pSold,
            totalBill: pBill,
            totalPrize: pPrize,
            totalNetPayable: pNet,
            limitGrandTotal: 0,
            overLimitTotals: { '1PM': 0, '6PM': 0, '8PM': 0 },
            sellerSummaries: partySummaries,
            prizeList: partyPrizes,
            limitPrizeGroups: [],
            sellers: partyArchiveSellers,
            entries: partyArchiveEntries,
            winningRaw: {
              '1PM': state.winningRaw['1PM'] || '',
              '6PM': state.winningRaw['6PM'] || '',
              '8PM': state.winningRaw['8PM'] || '',
            },
          };
          void savePartyArchiveCloud(authUser.uid, party, partySnap, true).catch(() => {});
        }
      }

      // Carry forward every Sub-Seller's +Total -> Due and -Total -> Joma under Masters & Sub-Masters
      for (const item of carriedSubBalances.values()) {
        void updateSubSellerParty(item.party, undefined, {
          due: item.due,
          joma: item.joma,
        }).catch(() => {});
      }

      // Clear all Master, Sub-Master & Sub-Seller live sheets for the fresh nextDate
      for (const party of cloudPartiesRef.current) {
        lastCloudSheetSigRef.current[party.partyId] = emptySig;
        lastAdminPushSigRef.current[party.partyId] = emptySig;
        if (party.parentMasterId) {
          const rootMaster =
            resolveTopLevelMasterParty(party.partyId, cloudPartiesRef.current) ||
            cloudPartiesRef.current.find((p) => p.partyId === party.parentMasterId);
          const effectiveSellerName = (rootMaster?.name || party.name).trim();
          subSheetMergedSigRef.current[party.partyId] = `${effectiveSellerName.toUpperCase()}::${emptySig}`;
        }
        void pushAdminSheetRowsForParty(
          authUser.uid,
          party,
          nextDate,
          [],
          [],
          [],
          existingSheetIds.has(party.partyId)
        ).catch(() => {});
      }
    }

    showToast(
      `Archived ${formatDateDDMM(state.date)} (Admin + All Master/Sub-Master) · ${formatDateDDMM(nextDate)} ready`
    );
  };

  // NOTE: Automatic daily clear / rollover is permanently disabled.
  // All filled entries, winning numbers, sellers, and archive history remain saved
  // until the user explicitly triggers manual Close Day / Archive & New Date or Clear.

  const handleRestoreSnapshot = (snap: DaySnapshot) => {
    AppSounds.success();

    // If Admin is already in Restored Archive view and restores the original Live date,
    // cleanly exit Restored Archive mode back to Live Today.
    if (adminRestoredMode && snap.date === adminRestoredMode.liveDate) {
      handleExitAdminRestoredMode();
      setActiveTab('Seller Bill');
      return;
    }

    const today = getTodayIsoDate();
    skipAutoRolloverDateRef.current = snap.date < today ? snap.date : null;

    const switchingDates = state.date !== snap.date;
    const hasWorkingDayData =
      (['1PM', '6PM', '8PM'] as SessionId[]).some((sid) =>
        state.entries[sid].some((r) => !isRowBlank(r))
      ) ||
      (['1PM', '6PM', '8PM'] as SessionId[]).some(
        (sid) => state.winningRaw[sid].trim() !== ''
      ) ||
      state.sellers.some((s) => s.due !== 0 || s.joma !== 0);

    const currentDayBackup =
      switchingDates && hasWorkingDayData ? buildCurrentSnapshot('manual') : null;

    // Enter (or stay in) Admin-only Restored Archive mode BEFORE mutating state so
    // NO cloud sync effect pushes this restored date/entries/due/joma to Master or Sub-Master!
    if (!adminRestoredMode) {
      const liveSnapshot = buildCurrentSnapshot('manual');
      updateAdminRestoredMode({
        restoredDate: snap.date,
        liveDate: state.date,
        liveBackup: liveSnapshot,
      });
    } else {
      updateAdminRestoredMode({
        ...adminRestoredMode,
        restoredDate: snap.date,
      });
    }

    setState((prev) => {
      let nextHistory = [...prev.history];
      if (currentDayBackup) {
        const existingIdx = nextHistory.findIndex((h) => h.date === currentDayBackup.date);
        if (existingIdx !== -1) {
          nextHistory[existingIdx] = currentDayBackup;
        } else {
          nextHistory = [currentDayBackup, ...nextHistory];
        }
      }
      // Keep all permanently created sellers even when restoring an older archive date
      const preservedCurrentSellers = prev.sellers.map((s) => ({
        ...s,
        due: 0,
        joma: 0,
      }));
      const mergedRestoredSellers = mergeWithPermanentSellers(
        snap.sellers,
        preservedCurrentSellers
      );

      return {
        ...prev,
        date: snap.date,
        config: {
          ...prev.config,
          pausedAutoArchiveDate: snap.date < today ? snap.date : undefined,
        },
        sellers: mergedRestoredSellers,
        entries: {
          '1PM': normalizeRowsKeepOneTrailing(snap.entries['1PM'] || []),
          '6PM': normalizeRowsKeepOneTrailing(snap.entries['6PM'] || []),
          '8PM': normalizeRowsKeepOneTrailing(snap.entries['8PM'] || []),
        },
        winningRaw: snap.winningRaw,
        history: preserveSavedSnapshots(nextHistory).slice(0, 180),
      };
    });

    setRecentlyPastedIds({ '1PM': [], '6PM': [], '8PM': [] });
    setSessionHistory({
      '1PM': { undo: [], redo: [] },
      '6PM': { undo: [], redo: [] },
      '8PM': { undo: [], redo: [] },
    });
    setActiveTab('Seller Bill');
    showToast(
      `Restored ${formatDateDDMM(snap.date)} (Sirf Admin view · Master/Sub-Master live data unchanged)`,
      5000
    );
  };

  const handleChangeDate = (newDate: string) => {
    if (!newDate) return;
    const today = getTodayIsoDate();
    const paused = newDate < today ? newDate : undefined;
    skipAutoRolloverDateRef.current = paused || null;
    setState((prev) => ({
      ...prev,
      date: newDate,
      config: { ...prev.config, pausedAutoArchiveDate: paused },
    }));
  };

  // Seller CRUD Handlers
  const handleUpdateSeller = (sellerId: string, patch: Partial<Seller>) => {
    setState((prev) => ({
      ...prev,
      sellers: prev.sellers.map((s) => (s.id === sellerId ? { ...s, ...patch } : s)),
    }));
  };

  const handleAddSeller = (seller: Omit<Seller, 'id'>) => {
    const trimmedName = seller.name.trim().toUpperCase();
    if (!trimmedName) return;
    if (isMyChoiceName(trimmedName)) {
      setState((prev) => {
        const hasInExtra = prev.extraNames.some((n) => isMyChoiceName(n));
        return {
          ...prev,
          extraNames: hasInExtra ? prev.extraNames : [...prev.extraNames, trimmedName],
        };
      });
      showToast(`${trimmedName} saved for 1PM / 6PM / 8PM sheets (hidden on Bill)`);
      return;
    }
    const id = `seller-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setState((prev) => ({
      ...prev,
      sellers: [...prev.sellers, { ...seller, name: trimmedName, id }],
    }));
  };

  const handleDeleteSeller = (sellerId: string) => {
    const cloudParty = partiesBySellerId[sellerId];
    if (cloudSession.kind === 'admin' && cloudParty) {
      void deleteSellerPartyCloud(cloudParty).catch(() => {});
    }
    setState((prev) => {
      const remaining = prev.sellers.filter((s) => s.id !== sellerId);
      writePermanentSellers(remaining, Math.max(Date.now(), lastSavedAtRef.current + 1));
      return {
        ...prev,
        sellers: remaining,
      };
    });
  };

  // Session Sheet Entry Handlers (Undo/Redo, Edit, Paste, Delete, Clear)
  const pushUndoSnapshot = (sessionId: SessionId, rowsSnapshot: TicketEntryRow[]) => {
    const maxDepth = rowsSnapshot.length > 5000 ? 7 : 24;
    setSessionHistory((prev) => ({
      ...prev,
      [sessionId]: {
        undo: [...prev[sessionId].undo.slice(-maxDepth), rowsSnapshot],
        redo: [],
      },
    }));
  };

  const handleUndoSession = (sessionId: SessionId) => {
    const hist = sessionHistory[sessionId];
    if (hist.undo.length === 0) return;
    const previousRows = hist.undo[hist.undo.length - 1];
    const currentRows = state.entries[sessionId];
    const maxDepth = currentRows.length > 5000 ? 7 : 24;

    setSessionHistory((prev) => ({
      ...prev,
      [sessionId]: {
        undo: prev[sessionId].undo.slice(0, -1),
        redo: [...prev[sessionId].redo.slice(-maxDepth), currentRows],
      },
    }));
    commitSessionRows(sessionId, previousRows);
  };

  const handleRedoSession = (sessionId: SessionId) => {
    const hist = sessionHistory[sessionId];
    if (hist.redo.length === 0) return;
    const nextRows = hist.redo[hist.redo.length - 1];
    const currentRows = state.entries[sessionId];
    const maxDepth = currentRows.length > 5000 ? 7 : 24;

    setSessionHistory((prev) => ({
      ...prev,
      [sessionId]: {
        undo: [...prev[sessionId].undo.slice(-maxDepth), currentRows],
        redo: prev[sessionId].redo.slice(0, -1),
      },
    }));
    commitSessionRows(sessionId, nextRows);
  };

  const handleUpdateSessionRow = (
    sessionId: SessionId,
    rowId: string,
    patch: Partial<TicketEntryRow>
  ) => {
    const now = Date.now();
    const last = lastRowEditUndoRef.current;
    const shouldPushUndo =
      !last || last.sessionId !== sessionId || last.rowId !== rowId || now - last.ts > 1500;
    lastRowEditUndoRef.current = { sessionId, rowId, ts: now };

    const currentRows = latestStateRef.current.entries[sessionId];
    if (shouldPushUndo) {
      pushUndoSnapshot(sessionId, currentRows);
    }

    const idx = currentRows.findIndex((r) => r.id === rowId);
    if (idx === -1) return;

    const target = currentRows[idx];
    let merged = { ...target, ...patch };
    // Mirror Apps Script onEdit: if Item, Start, and End are all cleared (and Name wasn't edited directly), clear Name too
    const editedCDE = 'item' in patch || 'start' in patch || 'end' in patch;
    if (editedCDE && !('name' in patch)) {
      const hasCDE =
        merged.item.trim() !== '' ||
        merged.start.trim() !== '' ||
        merged.end.trim() !== '';
      if (!hasCDE && merged.name.trim() !== '') {
        merged = { ...merged, name: '' };
      }
    }
    merged = sanitizeRowQtyOverride(merged);

    const nextRows = currentRows.slice();
    if (isRowBlank(merged)) {
      if (idx === nextRows.length - 1) {
        nextRows[idx] = merged;
      } else {
        nextRows.splice(idx, 1);
        if (nextRows.length === 0 || !isRowBlank(nextRows[nextRows.length - 1])) {
          nextRows.push(createEmptyRow());
        }
      }
    } else {
      nextRows[idx] = merged;
      if (idx === nextRows.length - 1) {
        nextRows.push(createEmptyRow());
      }
    }

    setState((prev) => ({
      ...prev,
      entries: {
        ...prev.entries,
        [sessionId]: nextRows,
      },
    }));
  };

  const handleDeleteSessionRow = (sessionId: SessionId, rowId: string) => {
    const prevRows = state.entries[sessionId];
    pushUndoSnapshot(sessionId, prevRows);
    const filtered = prevRows.filter((r) => r.id !== rowId);
    commitSessionRows(sessionId, preserveInheritedNamesAndCompact(prevRows, filtered));
  };

  const handleDeleteSessionRows = (sessionId: SessionId, rowIds: string[]) => {
    if (rowIds.length === 0) return;
    const idSet = new Set(rowIds);
    const prevRows = state.entries[sessionId];
    pushUndoSnapshot(sessionId, prevRows);
    const filtered = prevRows.filter((r) => !idSet.has(r.id));
    commitSessionRows(sessionId, preserveInheritedNamesAndCompact(prevRows, filtered));
  };

  const handleClearSessionCells = (
    sessionId: SessionId,
    targets: Array<{
      rowId: string;
      fields: Array<'name' | 'item' | 'start' | 'end' | 'qtyOverride' | 'rangeOverride'>;
    }>
  ) => {
    if (targets.length === 0) return;
    const targetMap = new Map(targets.map((t) => [t.rowId, new Set(t.fields)]));
    const explicitlyClearedNameIds = new Set(
      targets.filter((t) => t.fields.includes('name')).map((t) => t.rowId)
    );
    const prevRows = state.entries[sessionId];
    pushUndoSnapshot(sessionId, prevRows);
    const updated = prevRows.map((row) => {
      const fields = targetMap.get(row.id);
      if (!fields) return row;
      return {
        ...row,
        name: fields.has('name') ? '' : row.name,
        item: fields.has('item') ? '' : row.item,
        start: fields.has('start') ? '' : row.start,
        end: fields.has('end') ? '' : row.end,
        qtyOverride: fields.has('qtyOverride') ? '' : row.qtyOverride,
        rangeOverride: fields.has('rangeOverride') ? '' : row.rangeOverride,
      };
    });
    commitSessionRows(
      sessionId,
      preserveInheritedNamesAndCompact(prevRows, updated, explicitlyClearedNameIds)
    );
  };

  const handleBatchPatchSessionRows = (
    sessionId: SessionId,
    patches: Array<{ rowId: string; patch: Partial<TicketEntryRow> }>
  ) => {
    if (patches.length === 0) return;
    const patchMap = new Map(patches.map((p) => [p.rowId, p.patch]));
    const prevRows = state.entries[sessionId];
    pushUndoSnapshot(sessionId, prevRows);
    const updated = prevRows.map((row) => {
      const p = patchMap.get(row.id);
      if (!p) return row;
      return { ...row, ...p };
    });
    commitSessionRows(sessionId, updated);
  };

  const handleAddSessionRows = (sessionId: SessionId, count: number) => {
    pushUndoSnapshot(sessionId, state.entries[sessionId]);
    setState((prev) => ({
      ...prev,
      entries: {
        ...prev.entries,
        [sessionId]: [...prev.entries[sessionId], ...createBlankRows(count)],
      },
    }));
  };

  const handleQuickAddEntry = (
    sessionId: SessionId,
    entry: Omit<TicketEntryRow, 'id'>
  ) => {
    const prevRows = state.entries[sessionId];
    pushUndoSnapshot(sessionId, prevRows);
    const rows = [...prevRows];
    let lastPopulatedIdx = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (!isRowBlank(rows[i])) {
        lastPopulatedIdx = i;
        break;
      }
    }
    const newRow: TicketEntryRow = {
      ...entry,
      id: createEmptyRow().id,
    };
    const nextRows = [
      ...rows.slice(0, lastPopulatedIdx + 1),
      newRow,
      ...rows.slice(lastPopulatedIdx + 1),
    ];
    commitSessionRows(sessionId, nextRows);
  };

  const handleBulkAddEntries = (
    sessionId: SessionId,
    entries: Array<Omit<TicketEntryRow, 'id'>>,
    targetRowId?: string
  ) => {
    if (entries.length === 0) return;
    const prevRows = state.entries[sessionId];
    pushUndoSnapshot(sessionId, prevRows);
    const newRows: TicketEntryRow[] = entries.map((entry, i) => ({
      ...entry,
      id: `${createEmptyRow().id}-${i}`,
    }));
    setRecentlyPastedIds((prev) => ({
      ...prev,
      [sessionId]: newRows.map((r) => r.id),
    }));

    const currentRows = [...prevRows];
    if (targetRowId) {
      const idx = currentRows.findIndex((r) => r.id === targetRowId);
      if (idx !== -1) {
        const merged = isRowBlank(currentRows[idx])
          ? [...currentRows.slice(0, idx), ...newRows, ...currentRows.slice(idx + 1)]
          : [...currentRows.slice(0, idx + 1), ...newRows, ...currentRows.slice(idx + 1)];
        commitSessionRows(sessionId, merged);
        return;
      }
    }

    let lastPopulatedIdx = -1;
    for (let i = currentRows.length - 1; i >= 0; i--) {
      if (!isRowBlank(currentRows[i])) {
        lastPopulatedIdx = i;
        break;
      }
    }
    const populated = currentRows.slice(0, lastPopulatedIdx + 1);
    commitSessionRows(sessionId, [...populated, ...newRows]);
  };

  const handleClearSession = (sessionId: SessionId) => {
    pushUndoSnapshot(sessionId, state.entries[sessionId]);
    setRecentlyPastedIds((prev) => ({ ...prev, [sessionId]: [] }));
    commitSessionRows(sessionId, []);
  };

  // Winning Numbers Handlers
  const handleChangeWinningRaw = (sessionId: SessionId, value: string) => {
    setState((prev) => ({
      ...prev,
      winningRaw: { ...prev.winningRaw, [sessionId]: value },
    }));
  };

  const handleClearAllWinning = () => {
    setState((prev) => ({
      ...prev,
      winningRaw: { '1PM': '', '6PM': '', '8PM': '' },
    }));
  };

  // Config & Preview Handlers
  const handleUpdateConfig = (patch: Partial<AgencyConfig>) => {
    setState((prev) => ({
      ...prev,
      config: { ...prev.config, ...patch },
    }));
  };

  const handleUpdateExtraNames = (extraNames: string[]) => {
    setState((prev) => ({ ...prev, extraNames }));
  };

  const handleOpenPreview = (
    title: string,
    subtitle: string,
    message: string,
    waUrl: string,
    billData?: BillReceiptPayload
  ) => {
    setPreviewModal({
      isOpen: true,
      title,
      subtitle,
      message,
      waUrl,
      billData,
    });
  };

  const handleToggleSound = () => {
    const next = !state.config.soundEnabled;
    setSoundEnabled(next);
    if (next) {
      wakeSoundEngine();
      AppSounds.tap();
    }
    handleUpdateConfig({ soundEnabled: next });
  };

  // Route 1A: Admin Previewing a Seller or Sub-Seller's Mobile App (with instant Back to Admin & NO time lock)
  if (cloudSession.kind === 'admin' && authUser && adminPreviewParty) {
    return (
      <SellerPortalApp
        key={adminPreviewParty.partyId}
        uid={authUser.uid}
        agencyId={adminPreviewParty.agencyId}
        partyId={adminPreviewParty.partyId}
        soundEnabled={state.config.soundEnabled}
        onToggleSound={handleToggleSound}
        onSignOut={handleCloudSignOut}
        adminPreviewMode
        onExitAdminPreview={() => setAdminPreviewParty(null)}
        announcement={publicAnnouncement}
      />
    );
  }

  // Route 2: Master / Sub-Master / Client Login (Link, Installed App, or Signed-Out non-Admin)
  // NEVER falls through to Admin Dashboard unless user is authenticated as Admin.
  const isLockedToSellerPortal = hasUrlLoginTrigger || devicePortalMode === 'seller';
  if (sellerLoginMode || (cloudSession.kind === 'none' && authReady)) {
    const canCancel = cloudSession.kind === 'admin';
    const showAdminSignIn =
      !isLockedToSellerPortal &&
      (initialUrlLoginParams.forceAdmin || devicePortalMode === 'admin');
    const allowLogoAdminUnlock = !isLockedToSellerPortal;
    return (
      <SellerLoginView
        busy={cloudBusy}
        error={cloudError}
        onLoginWithIdPassword={handleLoginWithIdPassword}
        showAdminSignIn={showAdminSignIn}
        allowLogoAdminUnlock={allowLogoAdminUnlock}
        onAdminGoogleSignIn={allowLogoAdminUnlock ? handleAdminGoogleSignIn : undefined}
        announcement={publicAnnouncement}
        onCancelToAdmin={
          canCancel
            ? () => {
                setCloudError('');
                clearLoginQueryParams();
                setSellerLoginMode(false);
              }
            : undefined
        }
      />
    );
  }

  // Route 1B: Signed-in Seller / Sub-Seller -> dedicated Mobile Portal App
  if (cloudSession.kind === 'seller') {
    if (!authUser) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center bg-[var(--kk-canvas)] p-6 text-center gap-3">
          <img
            src="/kk-logo.png"
            alt="KK Agency"
            referrerPolicy="no-referrer"
            className="w-16 h-16 rounded-2xl object-cover shadow-md"
          />
          <p className="text-sm font-bold text-slate-700">Loading KK Agency Portal...</p>
        </div>
      );
    }
    return (
      <SellerPortalApp
        key={cloudSession.partyId}
        uid={authUser.uid}
        agencyId={cloudSession.agencyId}
        partyId={cloudSession.partyId}
        soundEnabled={state.config.soundEnabled}
        onToggleSound={handleToggleSound}
        onSignOut={handleCloudSignOut}
        announcement={publicAnnouncement}
      />
    );
  }

  // While Firebase Auth is still resolving on a fresh/unauthenticated launch (not cached admin),
  // show a clean splash instead of flashing the Admin Dashboard to Master/Sub-Master users.
  if (cloudSession.kind !== 'admin' && !authReady) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-[var(--kk-canvas)] p-6 text-center gap-3">
        <img
          src="/kk-logo.png"
          alt="KK Agency"
          referrerPolicy="no-referrer"
          className="w-16 h-16 rounded-2xl object-cover shadow-md"
        />
        <p className="text-sm font-bold text-slate-700">Opening KK Agency...</p>
      </div>
    );
  }

  const isAnnouncementLive = Boolean(
    publicAnnouncement?.active &&
      (publicAnnouncement.title.trim() || publicAnnouncement.message.trim())
  );

  return (
    <AppShell
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      billingDate={state.date}
      onChangeBillingDate={handleChangeDate}
      onOpenSettings={() => setSettingsOpen(true)}
      onOpenSellerIds={() => setSellerIdsOpen(true)}
      onOpenAnnouncement={() => {
        setAnnouncementError('');
        setAnnouncementModalOpen(true);
      }}
      announcementActive={isAnnouncementLive}
      onOpenGoogleSheets={() => setGoogleSheetsModalOpen(true)}
      googleSheetsActive={Boolean(
        (gsheetConnectionMode !== 'none' || gsheetHasToken) &&
          gsheetConfig.spreadsheetId &&
          gsheetConfig.autoSync
      )}
      cloudConnected={cloudSession.kind === 'admin'}
      soundEnabled={state.config.soundEnabled}
      onToggleSound={handleToggleSound}
      counts={{
        sellers: sellerBills.length,
        overLimit1PM: sessionComputations['1PM'].overLimitTotal,
        overLimit6PM: sessionComputations['6PM'].overLimitTotal,
        overLimit8PM: sessionComputations['8PM'].overLimitTotal,
        prizes: prizeList.length,
        limitPrizes: limitPrizeCount,
        archives: state.history.length,
      }}
    >
      {isAnnouncementLive && (
        <div className="mb-3">
          <AnnouncementBanner
            announcement={publicAnnouncement}
            variant="admin"
            onEdit={() => {
              setAnnouncementError('');
              setAnnouncementModalOpen(true);
            }}
          />
        </div>
      )}
      <AnimatePresence>
        {archiveNotice && (
          <motion.div
            key="archive-notice"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
            className="mb-3 bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-2xl px-3.5 py-2.5 text-xs font-bold flex items-center justify-between gap-2 shadow-xs"
          >
            <span>{archiveNotice}</span>
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                setArchiveNotice('');
              }}
              className="text-emerald-800 hover:text-emerald-950 cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {adminRestoredMode && (
        <div className="mb-3 bg-indigo-50 border border-indigo-200 text-indigo-950 rounded-2xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2 text-xs min-w-0">
            <Archive className="w-4 h-4 text-indigo-700 shrink-0" />
            <div className="leading-snug">
              <span className="font-extrabold">
                Restored Archive · {formatDateDDMM(state.date)}
              </span>
              <span className="text-indigo-800 font-medium">
                {' '}· Sirf Admin view (Master / Sub-Master live data safe)
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleExitAdminRestoredMode}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Back to Live ({formatDateDDMM(adminRestoredMode.liveDate)})</span>
          </button>
        </div>
      )}

      {activeTab === 'Seller Bill' && (
        <SellerBillView
          date={state.date}
          onChangeDate={handleChangeDate}
          bills={sellerBills}
          onUpdateSeller={handleUpdateSeller}
          onAddSeller={handleAddSeller}
          onDeleteSeller={handleDeleteSeller}
          onRolloverDay={() => performArchiveAndRollover('day-close')}
          onPreviewMessage={handleOpenPreview}
          sessionComputations={sessionComputations}
          limitThreshold={state.config.limitThreshold}
          onOpenSession={(sid) => {
            AppSounds.tap();
            setActiveTab(sid);
          }}
        />
      )}

      {(activeTab === '1PM' || activeTab === '6PM' || activeTab === '8PM') && (
        <div className="space-y-4">
          {!isAdminRestoredView && (
            <LiveChainEntriesPanel
              sessionId={activeTab}
              chainSheets={adminChainSheets}
              chainParties={cloudParties}
              config={state.config}
              mode="admin"
              defaultExpanded={false}
            />
          )}
          <SessionSheetView
            sessionId={activeTab}
            computation={sessionComputations[activeTab]}
            rawRows={state.entries[activeTab]}
            availableNames={availableNames}
            itemOptions={state.config.itemOptions}
            limitThreshold={state.config.limitThreshold}
            highlightedRowIds={recentlyPastedIds[activeTab]}
            onDismissPasteHighlight={() =>
              setRecentlyPastedIds((prev) => ({ ...prev, [activeTab]: [] }))
            }
            onUpdateRow={(rowId, patch) => handleUpdateSessionRow(activeTab, rowId, patch)}
            onDeleteRow={(rowId) => handleDeleteSessionRow(activeTab, rowId)}
            onDeleteRows={(rowIds) => handleDeleteSessionRows(activeTab, rowIds)}
            onClearCells={(targets) => handleClearSessionCells(activeTab, targets)}
            onBatchPatchRows={(patches) => handleBatchPatchSessionRows(activeTab, patches)}
            canUndo={sessionHistory[activeTab].undo.length > 0}
            onUndo={() => handleUndoSession(activeTab)}
            canRedo={sessionHistory[activeTab].redo.length > 0}
            onRedo={() => handleRedoSession(activeTab)}
            onAddRows={(count) => handleAddSessionRows(activeTab, count)}
            onQuickAddEntry={(entry) => handleQuickAddEntry(activeTab, entry)}
            onBulkAddEntries={(entries, targetRowId) =>
              handleBulkAddEntries(activeTab, entries, targetRowId)
            }
            onClearSession={() => handleClearSession(activeTab)}
            onPreviewMessage={handleOpenPreview}
          />
        </div>
      )}

      {activeTab === 'Winning Number' && (
        <WinningNumberView
          winningRaw={state.winningRaw}
          parsedWinning={parsedWinning}
          prizeCount={prizeList.length}
          prizeTotal={prizeList.reduce((sum, p) => sum + p.total, 0)}
          onChangeWinningRaw={handleChangeWinningRaw}
          onClearAllWinning={handleClearAllWinning}
          onOpenPrizeList={() => setActiveTab('Prize List')}
        />
      )}

      {(activeTab === 'Prize List' || activeTab === 'Limit Prize') && (
        <div className="space-y-5">
          <PrizeListView
            date={state.date}
            prizeList={prizeList}
            sellers={state.sellers}
            excludedNames={state.config.excludedPrizeNames}
            onPreviewMessage={handleOpenPreview}
          />
          <LimitPrizeView
            groups={limitPrizeGroups}
            grandTotal={limitGrandTotal}
            limitThreshold={state.config.limitThreshold}
            onPreviewMessage={handleOpenPreview}
          />
        </div>
      )}

      {activeTab === 'Archive' && (
        <ArchiveView
          billingDate={state.date}
          onChangeBillingDate={handleChangeDate}
          snapshots={state.history}
          recycleBin={state.recycleBin || []}
          onArchiveNow={() => performArchiveAndRollover('manual')}
          onRestoreSnapshot={handleRestoreSnapshot}
          onUpdateSnapshotDate={(snapshotId, newDate) => {
            setState((prev) => ({
              ...prev,
              history: prev.history.map((h) =>
                h.id === snapshotId ? { ...h, date: newDate } : h
              ),
            }));
          }}
          onDeleteSnapshot={(snapshotId) => {
            const target = state.history.find((h) => h.id === snapshotId);
            setState((prev) => {
              const found = prev.history.find((h) => h.id === snapshotId);
              const nextHistory = prev.history.filter((h) => h.id !== snapshotId);
              if (!found) return { ...prev, history: nextHistory };
              const binned: DaySnapshot = { ...found, deletedAt: new Date().toISOString() };
              const existingBin = Array.isArray(prev.recycleBin) ? prev.recycleBin : [];
              return {
                ...prev,
                history: nextHistory,
                recycleBin: [binned, ...existingBin.filter((b) => b.id !== snapshotId)].slice(0, 120),
              };
            });
            if (target) {
              showToast(`${formatDateDDMM(target.date)} Recycle Bin me move ho gaya`);
            }
          }}
          onRecoverFromBin={(snapshotId) => {
            const target = (state.recycleBin || []).find((b) => b.id === snapshotId);
            setState((prev) => {
              const existingBin = Array.isArray(prev.recycleBin) ? prev.recycleBin : [];
              const found = existingBin.find((b) => b.id === snapshotId);
              if (!found) return prev;
              const { deletedAt: _removed, ...cleanSnap } = found;
              return {
                ...prev,
                history: preserveSavedSnapshots([
                  cleanSnap,
                  ...prev.history.filter((h) => h.id !== cleanSnap.id),
                ]).slice(0, 180),
                recycleBin: existingBin.filter((b) => b.id !== snapshotId),
              };
            });
            if (target) {
              showToast(`${formatDateDDMM(target.date)} Recycle Bin se Recover ho gaya!`);
            }
          }}
          onPermanentDeleteFromBin={(snapshotId) => {
            setState((prev) => ({
              ...prev,
              recycleBin: (prev.recycleBin || []).filter((b) => b.id !== snapshotId),
            }));
            showToast('Archive Recycle Bin se permanently delete ho gaya');
          }}
          onEmptyRecycleBin={() => {
            setState((prev) => ({
              ...prev,
              recycleBin: [],
            }));
            showToast('Recycle Bin khali ho gaya');
          }}
        />
      )}

      <MessagePreviewModal
        isOpen={previewModal.isOpen}
        title={previewModal.title}
        subtitle={previewModal.subtitle}
        message={previewModal.message}
        waUrl={previewModal.waUrl}
        billData={previewModal.billData}
        onClose={() => setPreviewModal((prev) => ({ ...prev, isOpen: false }))}
      />

      <SettingsDrawer
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        state={state}
        onChangeBillingDate={handleChangeDate}
        onUpdateConfig={handleUpdateConfig}
        onUpdateExtraNames={handleUpdateExtraNames}
        onRestoreSnapshot={handleRestoreSnapshot}
        onArchiveNow={() => performArchiveAndRollover('manual')}
        onOpenArchiveSheet={() => setActiveTab('Archive')}
      />

      <SellerIdManagerModal
        isOpen={sellerIdsOpen}
        onClose={() => setSellerIdsOpen(false)}
        isAdminSignedIn={cloudSession.kind === 'admin'}
        adminEmail={authUser?.email || null}
        cloudBusy={cloudBusy}
        cloudError={cloudError}
        sellers={visibleSellersForBill}
        allCloudParties={cloudParties}
        partiesBySellerId={partiesBySellerId}
        privatesByPartyId={privatesByPartyId}
        subSellersCountByMasterId={subSellersCountByMasterId}
        onAdminSignIn={handleAdminGoogleSignIn}
        onSignOut={handleCloudSignOut}
        onSyncAllSellersNow={syncAllSellersToCloud}
        onEnableChainAll={handleEnableChainAll}
        onTogglePartyActive={handleTogglePartyActive}
        onTogglePartyChainRole={handleTogglePartyChainRole}
        onResetPartyKey={handleResetPartyKey}
        onUpdatePartyCredentials={handleUpdatePartyCredentials}
        onCreateSubSellerForMaster={handleCreateSubSellerForMaster}
        onDeleteSubParty={handleDeleteSubParty}
        onAddSeller={handleAddSeller}
        onPreviewSeller={(party) => {
          setSellerIdsOpen(false);
          setAdminPreviewParty({ agencyId: party.agencyId, partyId: party.partyId });
        }}
        onOpenSellerLoginMode={() => {
          setCloudError('');
          setSellerLoginMode(true);
        }}
      />

      <GoogleSheetsSyncModal
        isOpen={googleSheetsModalOpen}
        onClose={() => setGoogleSheetsModalOpen(false)}
        config={gsheetConfig}
        hasAccessToken={gsheetHasToken}
        connectionMode={gsheetConnectionMode}
        connectedEmail={authUser?.email || ''}
        availableTabs={gsheetTabs}
        syncing={gsheetSyncing}
        connecting={gsheetConnecting}
        lastSyncedAt={gsheetLastSyncedAt}
        rowCounts={gsheetRowCounts}
        errorMessage={gsheetError}
        onSignInGoogleSheets={handleSignInGoogleSheets}
        onConnectSpreadsheet={handleConnectSpreadsheet}
        onUpdateConfig={handleUpdateGsheetConfig}
        onSyncNow={() => runGoogleSheetsSync(undefined, true)}
        onDisconnectSheet={handleDisconnectGoogleSheet}
        onClearSyncedRows={handleClearGoogleSheetRows}
      />

      <AdminAnnouncementModal
        isOpen={announcementModalOpen}
        onClose={() => setAnnouncementModalOpen(false)}
        isAdminSignedIn={cloudSession.kind === 'admin'}
        announcement={publicAnnouncement}
        busy={announcementBusy || cloudBusy}
        error={announcementError || cloudError}
        onAdminSignIn={handleAdminGoogleSignIn}
        onSaveAnnouncement={handleSavePublicAnnouncement}
      />
    </AppShell>
  );
}
