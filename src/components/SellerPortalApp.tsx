import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Award,
  Calendar,
  Check,
  Clock,
  Copy,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  RotateCcw,
  Send,
  Trophy,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBlankRows, createEmptyAppState, createEmptyRow } from '../data/initialState';
import {
  computeSellerBills,
  formatDateDDMMYYYY,
  formatINR,
  generatePrizeAndLimitData,
  parseWinningNumbers,
  processSessionRows,
  round2,
} from '../engine/calculations';
import {
  carryForwardSubSellerBalancesCloud,
  CloudAgencyDoc,
  CloudPartyDoc,
  CloudPartyPrivateDoc,
  CloudPartySheetDoc,
  CloudPublicAnnouncement,
  deletePartyArchiveCloud,
  sanitizeSheetEntriesForCloud,
  savePartyArchiveCloud,
  saveSellerOwnSheet,
  serializeSheetEntries,
  subscribeMasterSubChain,
  subscribePartyArchives,
  subscribeSellerPortal,
  updatePartyArchiveDateCloud,
} from '../services/cloudSync';
import {
  AgencyConfig,
  ArchivedSellerSummary,
  DaySnapshot,
  PrizeListRow,
  Seller,
  SellerBillRow,
  SessionComputation,
  SessionId,
  TicketEntryRow,
} from '../types/ledger';
import { BillReceiptPayload, sendBillCardDirectToWhatsApp } from '../utils/billImageGenerator';
import { AppSounds } from '../utils/sound';
import { AnnouncementBanner } from './AnnouncementBanner';
import { ArchiveView } from './ArchiveView';
import { getIstClockParts, getSellerSessionLockStatus, SessionLockStatus } from '../utils/sessionLock';
import { LiveChainEntriesPanel } from './LiveChainEntriesPanel';
import { MasterChainTab } from './MasterChainTab';
import { MessagePreviewModal } from './MessagePreviewModal';
import { PrizeListView } from './PrizeListView';
import { SessionSheetView } from './SessionSheetView';

type SellerTab = 'My Bill' | '1PM' | '6PM' | '8PM' | 'Prize List' | 'Chain' | 'Archive';

interface SellerPortalAppProps {
  uid: string;
  agencyId: string;
  partyId: string;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onSignOut: () => Promise<void>;
  adminPreviewMode?: boolean;
  onExitAdminPreview?: () => void;
  announcement?: CloudPublicAnnouncement | null;
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

function normalizeSellerRows(rows: TicketEntryRow[], sellerName: string): TicketEntryRow[] {
  const nonBlank = (Array.isArray(rows) ? rows : [])
    .filter((r) => !isRowBlank(r))
    .map((r) => ({
      ...r,
      name: sellerName,
    }));
  return [...nonBlank, createEmptyRow()];
}

const SELLER_NAV_ITEMS: Array<{
  id: SellerTab;
  label: string;
  shortLabel: string;
  icon: typeof FileSpreadsheet;
}> = [
  { id: 'My Bill', label: 'My Bill', shortLabel: 'Bill', icon: FileSpreadsheet },
  { id: '1PM', label: '1PM Morning', shortLabel: '1PM', icon: Clock },
  { id: '6PM', label: '6PM Day', shortLabel: '6PM', icon: Clock },
  { id: '8PM', label: '8PM Evening', shortLabel: '8PM', icon: Clock },
  { id: 'Prize List', label: 'Prize List', shortLabel: 'Prize', icon: Award },
];

export function SellerPortalApp({
  uid,
  agencyId,
  partyId,
  soundEnabled,
  onToggleSound,
  onSignOut,
  adminPreviewMode = false,
  onExitAdminPreview,
  announcement = null,
}: SellerPortalAppProps) {
  const [activeTab, setActiveTab] = useState<SellerTab>('My Bill');
  const [agency, setAgency] = useState<CloudAgencyDoc | null>(null);
  const [party, setParty] = useState<CloudPartyDoc | null>(null);
  const [sheetExists, setSheetExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revokedReason, setRevokedReason] = useState('');
  const [syncState, setSyncState] = useState<'synced' | 'saving' | 'error'>('synced');
  const [syncErrorMsg, setSyncErrorMsg] = useState<string>('');
  const [sendingMyBillCard, setSendingMyBillCard] = useState(false);
  const [waCardToast, setWaCardToast] = useState<{ message: string; waUrl: string } | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  // Master Chain Sub-Sellers State (active only when party.role === 'master')
  const [subParties, setSubParties] = useState<CloudPartyDoc[]>([]);
  const [allChainParties, setAllChainParties] = useState<CloudPartyDoc[]>([]);
  const [subPrivates, setSubPrivates] = useState<CloudPartyPrivateDoc[]>([]);
  const [subSheets, setSubSheets] = useState<CloudPartySheetDoc[]>([]);
  const [liveChainAlert, setLiveChainAlert] = useState<string>('');
  const prevSubSheetSigsRef = useRef<Record<string, string>>({});
  const subSheetsHydratedRef = useRef<boolean>(false);

  // Per-Party Daily Archive Records & Recycle Bin (Master, Sub-Master & Sub-Seller)
  const [partyArchives, setPartyArchives] = useState<DaySnapshot[]>([]);
  const [partyRecycleBin, setPartyRecycleBin] = useState<DaySnapshot[]>([]);
  const [restoredSnapshot, setRestoredSnapshot] = useState<DaySnapshot | null>(null);
  const [archiveToast, setArchiveToast] = useState<string>('');
  const [archiveBusy, setArchiveBusy] = useState<boolean>(false);

  const [entries, setEntries] = useState<Record<SessionId, TicketEntryRow[]>>({
    '1PM': createBlankRows(1),
    '6PM': createBlankRows(1),
    '8PM': createBlankRows(1),
  });
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

  const lastSerializedRef = useRef<string>('');
  const pendingSaveTimerRef = useRef<number | null>(null);
  const autoRetryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef<number>(0);
  const pendingDirtySessionsRef = useRef<Set<SessionId>>(new Set());
  const dirtyLocalRef = useRef(false);
  const latestEntriesRef = useRef<Record<SessionId, TicketEntryRow[]>>(entries);
  const partyRef = useRef<CloudPartyDoc | null>(null);
  const agencyRef = useRef<CloudAgencyDoc | null>(null);
  const sheetExistsRef = useRef(false);
  const scrollRef = useRef<HTMLElement | null>(null);

  latestEntriesRef.current = entries;
  partyRef.current = party;
  agencyRef.current = agency;
  sheetExistsRef.current = sheetExists;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const billingDate = agency?.date || getIstClockParts(new Date(nowTick)).isoDate;
  const isArchiveViewMode = Boolean(restoredSnapshot);
  const effectiveBillingDate = restoredSnapshot ? restoredSnapshot.date : billingDate;

  const sessionLockMap = useMemo<Record<SessionId, SessionLockStatus>>(() => {
    const now = new Date(nowTick);
    return {
      '1PM': getSellerSessionLockStatus('1PM', effectiveBillingDate, now),
      '6PM': getSellerSessionLockStatus('6PM', effectiveBillingDate, now),
      '8PM': getSellerSessionLockStatus('8PM', effectiveBillingDate, now),
    };
  }, [effectiveBillingDate, nowTick]);

  const isSessionEditLocked = useCallback(
    (sid: SessionId): boolean =>
      isArchiveViewMode || (!adminPreviewMode && sessionLockMap[sid].isLocked),
    [isArchiveViewMode, adminPreviewMode, sessionLockMap]
  );

  const archiveStorageKey = `kk-party-archives:${agencyId}:${partyId}`;
  const recycleBinStorageKey = `kk-party-recycle-bin:${agencyId}:${partyId}`;

  useEffect(() => {
    setRestoredSnapshot(null);
    try {
      const raw = window.localStorage.getItem(archiveStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setPartyArchives(parsed);
        }
      } else {
        setPartyArchives([]);
      }
    } catch {
      setPartyArchives([]);
    }

    try {
      const rawBin = window.localStorage.getItem(recycleBinStorageKey);
      if (rawBin) {
        const parsedBin = JSON.parse(rawBin);
        if (Array.isArray(parsedBin)) {
          const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
          const valid = parsedBin.filter((item: DaySnapshot) => {
            const ts = Date.parse(item.deletedAt || item.savedAt || '');
            return !Number.isFinite(ts) || ts >= cutoff;
          });
          setPartyRecycleBin(valid);
        }
      } else {
        setPartyRecycleBin([]);
      }
    } catch {
      setPartyRecycleBin([]);
    }

    const unsubArchives = subscribePartyArchives(agencyId, partyId, (cloudSnaps) => {
      setPartyArchives(cloudSnaps);
      setRestoredSnapshot((curr) => {
        if (!curr) return null;
        const fresh =
          cloudSnaps.find((s) => s.id === curr.id) ||
          cloudSnaps.find((s) => s.date === curr.date);
        return fresh || curr;
      });
      try {
        window.localStorage.setItem(archiveStorageKey, JSON.stringify(cloudSnaps));
      } catch {
        // Ignore storage quota errors
      }
    });

    return () => {
      unsubArchives();
    };
  }, [agencyId, partyId, archiveStorageKey, recycleBinStorageKey]);

  useEffect(() => {
    setLoading(true);
    setRevokedReason('');
    setParty(null);
    setSheetExists(false);
    setActiveTab('My Bill');
    setEntries({
      '1PM': createBlankRows(1),
      '6PM': createBlankRows(1),
      '8PM': createBlankRows(1),
    });
    setRecentlyPastedIds({ '1PM': [], '6PM': [], '8PM': [] });
    setSessionHistory({
      '1PM': { undo: [], redo: [] },
      '6PM': { undo: [], redo: [] },
      '8PM': { undo: [], redo: [] },
    });
    lastSerializedRef.current = '';
    dirtyLocalRef.current = false;
    pendingDirtySessionsRef.current.clear();

    const unsub = subscribeSellerPortal(agencyId, partyId, {
      onAgency: (docData) => {
        setAgency(docData);
      },
      onParty: (partyDoc) => {
        setParty(partyDoc);
        setLoading(false);
      },
      onSheet: (sheetDoc: CloudPartySheetDoc | null) => {
        setSheetExists(Boolean(sheetDoc));
        setLoading(false);
        if (!sheetDoc) return;
        // Skip overwriting while seller has an unsaved local keystroke pending debounce
        if (dirtyLocalRef.current && sheetDoc.updatedByUid === uid) return;

        const sName = partyRef.current?.name || sheetDoc.partyName || '';
        const next1 = normalizeSellerRows(sheetDoc.entries1PM || [], sName);
        const next6 = normalizeSellerRows(sheetDoc.entries6PM || [], sName);
        const next8 = normalizeSellerRows(sheetDoc.entries8PM || [], sName);
        const sig = serializeSheetEntries(
          sanitizeSheetEntriesForCloud(next1, sName),
          sanitizeSheetEntriesForCloud(next6, sName),
          sanitizeSheetEntriesForCloud(next8, sName)
        );

        // If Seller is mid-typing while Admin pushes rows, merge Admin's admin:: rows without losing Seller's keystroke
        if (dirtyLocalRef.current && sheetDoc.updatedByUid !== uid) {
          const mergeAdminIntoLocal = (
            localRows: TicketEntryRow[],
            remoteRows: TicketEntryRow[]
          ) => {
            const localOwn = localRows.filter((r) => !isRowBlank(r) && !r.id.startsWith('admin::'));
            const remoteAdmin = remoteRows.filter((r) => !isRowBlank(r) && r.id.startsWith('admin::'));
            return normalizeSellerRows([...remoteAdmin, ...localOwn], sName);
          };
          setEntries((prev) => ({
            '1PM': mergeAdminIntoLocal(prev['1PM'], next1),
            '6PM': mergeAdminIntoLocal(prev['6PM'], next6),
            '8PM': mergeAdminIntoLocal(prev['8PM'], next8),
          }));
          return;
        }

        if (sig !== lastSerializedRef.current) {
          lastSerializedRef.current = sig;
          setEntries({
            '1PM': next1,
            '6PM': next6,
            '8PM': next8,
          });
        }
      },
      onAccessRevoked: (reason) => {
        setRevokedReason(reason);
        setLoading(false);
      },
    });
    return () => {
      if (pendingSaveTimerRef.current !== null) {
        window.clearTimeout(pendingSaveTimerRef.current);
      }
      if (autoRetryTimerRef.current !== null) {
        window.clearTimeout(autoRetryTimerRef.current);
      }
      unsub();
    };
  }, [agencyId, partyId, uid]);

  // Subscribe to entire downline Chain (L2 + L3 + L4 + L5+) when this Seller has Master role
  const isMasterSeller = party?.role === 'master';
  useEffect(() => {
    if (!isMasterSeller || !party) {
      setSubParties([]);
      setAllChainParties([]);
      setSubPrivates([]);
      setSubSheets([]);
      prevSubSheetSigsRef.current = {};
      subSheetsHydratedRef.current = false;
      return;
    }
    prevSubSheetSigsRef.current = {};
    subSheetsHydratedRef.current = false;
    const unsubChain = subscribeMasterSubChain(
      agencyId,
      uid,
      party.partyId,
      adminPreviewMode,
      {
        onSubParties: setSubParties,
        onAllChainParties: setAllChainParties,
        onSubPrivates: setSubPrivates,
        onSubSheets: (incomingSheets) => {
          setSubSheets(incomingSheets);
          const changedNames: string[] = [];
          for (const sh of incomingSheets) {
            const sig = serializeSheetEntries(
              sh.entries1PM || [],
              sh.entries6PM || [],
              sh.entries8PM || []
            );
            const prevSig = prevSubSheetSigsRef.current[sh.partyId];
            if (subSheetsHydratedRef.current && prevSig !== undefined && prevSig !== sig) {
              changedNames.push(sh.partyName || 'Sub-Seller');
            }
            prevSubSheetSigsRef.current[sh.partyId] = sig;
          }
          subSheetsHydratedRef.current = true;
          if (changedNames.length > 0) {
            AppSounds.add();
            const msg = `Live Chain Entry aayi: ${Array.from(new Set(changedNames)).join(', ')}`;
            setLiveChainAlert(msg);
            window.setTimeout(() => {
              setLiveChainAlert((curr) => (curr === msg ? '' : curr));
            }, 4500);
          }
        },
      }
    );
    return () => {
      unsubChain();
    };
  }, [isMasterSeller, party?.partyId, agencyId, uid, adminPreviewMode]);

  const flushCloudSave = useCallback(
    async (
      entriesSnapshot: Record<SessionId, TicketEntryRow[]>,
      fallbackSessionId?: SessionId
    ) => {
      const currentParty = partyRef.current;
      const currentAgency = agencyRef.current;
      if (!currentParty || !currentAgency) return;

      const clean1 = sanitizeSheetEntriesForCloud(entriesSnapshot['1PM'], currentParty.name);
      const clean6 = sanitizeSheetEntriesForCloud(entriesSnapshot['6PM'], currentParty.name);
      const clean8 = sanitizeSheetEntriesForCloud(entriesSnapshot['8PM'], currentParty.name);
      const sig = serializeSheetEntries(clean1, clean6, clean8);

      const sessionsToSave = Array.from(pendingDirtySessionsRef.current);
      if (sessionsToSave.length === 0) {
        if (fallbackSessionId && (adminPreviewMode || !isSessionEditLocked(fallbackSessionId))) {
          sessionsToSave.push(fallbackSessionId);
        } else {
          (['1PM', '6PM', '8PM'] as SessionId[]).forEach((sid) => {
            if (adminPreviewMode || !isSessionEditLocked(sid)) {
              sessionsToSave.push(sid);
            }
          });
        }
      }
      pendingDirtySessionsRef.current.clear();

      setSyncState('saving');
      setSyncErrorMsg('');
      try {
        await saveSellerOwnSheet(
          uid,
          agencyId,
          currentParty,
          currentAgency.date,
          clean1,
          clean6,
          clean8,
          sheetExistsRef.current,
          sessionsToSave.length > 0 ? sessionsToSave : undefined
        );
        lastSerializedRef.current = sig;
        retryAttemptRef.current = 0;
        setSheetExists(true);
        dirtyLocalRef.current = false;
        setSyncState('synced');
        setSyncErrorMsg('');
      } catch (err) {
        sessionsToSave.forEach((s) => pendingDirtySessionsRef.current.add(s));
        // Keep dirtyLocalRef true while retrying so incoming stale snapshots don't wipe user's typed rows
        if (retryAttemptRef.current < 3) {
          const delayMs = 1200 * Math.pow(2, retryAttemptRef.current);
          retryAttemptRef.current += 1;
          setSyncState('saving');
          if (autoRetryTimerRef.current !== null) {
            window.clearTimeout(autoRetryTimerRef.current);
          }
          autoRetryTimerRef.current = window.setTimeout(() => {
            autoRetryTimerRef.current = null;
            void flushCloudSave(latestEntriesRef.current, fallbackSessionId);
          }, delayMs);
        } else {
          console.error('[KK CloudSync] Seller sheet save failed:', err);
          const rawErr = err instanceof Error ? err.message : String(err);
          const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
          setSyncErrorMsg(
            isOffline
              ? 'Internet connect nahi hai — network aate hi Retry dabayein.'
              : rawErr.includes('permission') || rawErr.includes('PERMISSION_DENIED')
                ? 'Entry save nahi hui — Retry dabayein ya 1 baar dubara login karein.'
                : 'Entry cloud par save nahi hui — Retry button dabayein.'
          );
          setSyncState('error');
        }
      }
    },
    [uid, agencyId, adminPreviewMode, isSessionEditLocked]
  );

  const scheduleCloudSave = useCallback(
    (nextEntries: Record<SessionId, TicketEntryRow[]>, changedSessionId: SessionId) => {
      const currentParty = partyRef.current;
      const currentAgency = agencyRef.current;
      if (!currentParty || !currentAgency) return;

      const clean1 = sanitizeSheetEntriesForCloud(nextEntries['1PM'], currentParty.name);
      const clean6 = sanitizeSheetEntriesForCloud(nextEntries['6PM'], currentParty.name);
      const clean8 = sanitizeSheetEntriesForCloud(nextEntries['8PM'], currentParty.name);
      const sig = serializeSheetEntries(clean1, clean6, clean8);
      if (sig === lastSerializedRef.current && pendingDirtySessionsRef.current.size === 0) return;

      dirtyLocalRef.current = true;
      retryAttemptRef.current = 0;
      pendingDirtySessionsRef.current.add(changedSessionId);
      setSyncState('saving');

      if (autoRetryTimerRef.current !== null) {
        window.clearTimeout(autoRetryTimerRef.current);
        autoRetryTimerRef.current = null;
      }
      if (pendingSaveTimerRef.current !== null) {
        window.clearTimeout(pendingSaveTimerRef.current);
      }

      pendingSaveTimerRef.current = window.setTimeout(() => {
        pendingSaveTimerRef.current = null;
        void flushCloudSave(nextEntries, changedSessionId);
      }, 360);
    },
    [flushCloudSave]
  );

  const handleManualRetrySync = useCallback(() => {
    AppSounds.tap();
    retryAttemptRef.current = 0;
    if (autoRetryTimerRef.current !== null) {
      window.clearTimeout(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
    }
    if (pendingSaveTimerRef.current !== null) {
      window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    }
    const activeSid: SessionId | undefined =
      activeTab === '1PM' || activeTab === '6PM' || activeTab === '8PM' ? activeTab : undefined;
    void flushCloudSave(latestEntriesRef.current, activeSid);
  }, [activeTab, flushCloudSave]);

  const pushUndoSnapshot = (sessionId: SessionId, rows: TicketEntryRow[]) => {
    setSessionHistory((prev) => ({
      ...prev,
      [sessionId]: {
        undo: [...prev[sessionId].undo.slice(-24), rows.map((r) => ({ ...r }))],
        redo: [],
      },
    }));
  };

  const commitSessionRows = (sessionId: SessionId, rawNextRows: TicketEntryRow[]) => {
    if (isSessionEditLocked(sessionId)) return;
    const sellerName = party?.name || '';
    const normalized = normalizeSellerRows(rawNextRows, sellerName);
    setEntries((prev) => {
      const next = { ...prev, [sessionId]: normalized };
      scheduleCloudSave(next, sessionId);
      return next;
    });
  };

  const handleUpdateSessionRow = (
    sessionId: SessionId,
    rowId: string,
    patch: Partial<TicketEntryRow>
  ) => {
    if (isSessionEditLocked(sessionId)) return;
    const sellerName = party?.name || '';
    const prevRows = entries[sessionId];
    const updated = prevRows.map((r) => {
      if (r.id !== rowId) return r;
      const merged = { ...r, ...patch, name: sellerName };
      const clearedData =
        !merged.item.trim() && !merged.start.trim() && !merged.end.trim() && !merged.qtyOverride.trim();
      return clearedData ? { ...merged, name: '' } : merged;
    });
    commitSessionRows(sessionId, updated);
  };

  const handleDeleteSessionRow = (sessionId: SessionId, rowId: string) => {
    if (isSessionEditLocked(sessionId)) return;
    const prevRows = entries[sessionId];
    pushUndoSnapshot(sessionId, prevRows);
    commitSessionRows(
      sessionId,
      prevRows.filter((r) => r.id !== rowId)
    );
  };

  const handleDeleteSessionRows = (sessionId: SessionId, rowIds: string[]) => {
    if (isSessionEditLocked(sessionId)) return;
    if (rowIds.length === 0) return;
    const idSet = new Set(rowIds);
    const prevRows = entries[sessionId];
    pushUndoSnapshot(sessionId, prevRows);
    commitSessionRows(
      sessionId,
      prevRows.filter((r) => !idSet.has(r.id))
    );
  };

  const handleClearSessionCells = (
    sessionId: SessionId,
    targets: Array<{
      rowId: string;
      fields: Array<'name' | 'item' | 'start' | 'end' | 'qtyOverride'>;
    }>
  ) => {
    if (isSessionEditLocked(sessionId)) return;
    if (targets.length === 0) return;
    const map = new Map(targets.map((t) => [t.rowId, new Set(t.fields)]));
    const prevRows = entries[sessionId];
    pushUndoSnapshot(sessionId, prevRows);
    const updated = prevRows.map((row) => {
      const fields = map.get(row.id);
      if (!fields) return row;
      const next = { ...row };
      if (fields.has('item')) next.item = '';
      if (fields.has('start')) next.start = '';
      if (fields.has('end')) next.end = '';
      if (fields.has('qtyOverride')) next.qtyOverride = '';
      if (fields.has('item') || fields.has('start') || fields.has('end')) {
        next.qtyOverride = '';
        next.rangeOverride = '';
      }
      if (!next.item.trim() && !next.start.trim() && !next.end.trim() && !next.qtyOverride.trim()) {
        next.name = '';
      }
      return next;
    });
    commitSessionRows(sessionId, updated);
  };

  const handleBatchPatchSessionRows = (
    sessionId: SessionId,
    patches: Array<{ rowId: string; patch: Partial<TicketEntryRow> }>
  ) => {
    if (isSessionEditLocked(sessionId)) return;
    if (patches.length === 0) return;
    const sellerName = party?.name || '';
    const map = new Map(patches.map((p) => [p.rowId, p.patch]));
    const prevRows = entries[sessionId];
    pushUndoSnapshot(sessionId, prevRows);
    const updated = prevRows.map((row) => {
      const p = map.get(row.id);
      if (!p) return row;
      return { ...row, ...p, name: sellerName };
    });
    commitSessionRows(sessionId, updated);
  };

  const handleQuickAddEntry = (
    sessionId: SessionId,
    entry: Omit<TicketEntryRow, 'id'>
  ) => {
    if (isSessionEditLocked(sessionId)) return;
    const sellerName = party?.name || '';
    const prevRows = entries[sessionId];
    pushUndoSnapshot(sessionId, prevRows);
    const newRow: TicketEntryRow = {
      ...entry,
      name: sellerName,
      id: createEmptyRow().id,
    };
    commitSessionRows(sessionId, [...prevRows, newRow]);
  };

  const handleBulkAddEntries = (
    sessionId: SessionId,
    newEntries: Array<Omit<TicketEntryRow, 'id'>>,
    targetRowId?: string
  ) => {
    if (isSessionEditLocked(sessionId)) return;
    if (newEntries.length === 0) return;
    const sellerName = party?.name || '';
    const prevRows = entries[sessionId];
    pushUndoSnapshot(sessionId, prevRows);
    const newRows: TicketEntryRow[] = newEntries.map((e, i) => ({
      ...e,
      name: sellerName,
      id: `${createEmptyRow().id}-${i}`,
    }));
    setRecentlyPastedIds((prev) => ({
      ...prev,
      [sessionId]: newRows.map((r) => r.id),
    }));
    if (targetRowId) {
      const idx = prevRows.findIndex((r) => r.id === targetRowId);
      if (idx !== -1) {
        const merged = isRowBlank(prevRows[idx])
          ? [...prevRows.slice(0, idx), ...newRows, ...prevRows.slice(idx + 1)]
          : [...prevRows.slice(0, idx + 1), ...newRows, ...prevRows.slice(idx + 1)];
        commitSessionRows(sessionId, merged);
        return;
      }
    }
    commitSessionRows(sessionId, [...prevRows, ...newRows]);
  };

  const handleUndoSession = (sessionId: SessionId) => {
    if (isSessionEditLocked(sessionId)) return;
    const stack = sessionHistory[sessionId];
    if (stack.undo.length === 0) return;
    const prevSnapshot = stack.undo[stack.undo.length - 1];
    setSessionHistory((prev) => ({
      ...prev,
      [sessionId]: {
        undo: prev[sessionId].undo.slice(0, -1),
        redo: [...prev[sessionId].redo.slice(-24), entries[sessionId].map((r) => ({ ...r }))],
      },
    }));
    commitSessionRows(sessionId, prevSnapshot);
  };

  const handleRedoSession = (sessionId: SessionId) => {
    if (isSessionEditLocked(sessionId)) return;
    const stack = sessionHistory[sessionId];
    if (stack.redo.length === 0) return;
    const nextSnapshot = stack.redo[stack.redo.length - 1];
    setSessionHistory((prev) => ({
      ...prev,
      [sessionId]: {
        undo: [...prev[sessionId].undo.slice(-24), entries[sessionId].map((r) => ({ ...r }))],
        redo: prev[sessionId].redo.slice(0, -1),
      },
    }));
    commitSessionRows(sessionId, nextSnapshot);
  };

  // Calculations scoped strictly to this Seller's entries & Admin's official rate + winning numbers
  const sellerConfig: AgencyConfig = useMemo(() => {
    const base = createEmptyAppState().config;
    const sellerLimit =
      typeof agency?.sellerLimitThreshold === 'number' && agency.sellerLimitThreshold >= 1
        ? agency.sellerLimitThreshold
        : 20;
    return {
      ...base,
      limitThreshold: sellerLimit,
      sellerLimitThreshold: sellerLimit,
      disableOver10Watch: true,
      excludedPrizeNames:
        agency?.excludedPrizeNames && agency.excludedPrizeNames.length > 0
          ? agency.excludedPrizeNames
          : base.excludedPrizeNames,
      itemOptions:
        agency?.itemOptions && agency.itemOptions.length > 0
          ? agency.itemOptions
          : base.itemOptions,
    };
  }, [agency?.sellerLimitThreshold, agency?.excludedPrizeNames, agency?.itemOptions]);

  const limitThreshold = sellerConfig.limitThreshold;
  const excludedNames = sellerConfig.excludedPrizeNames;
  const itemOptions = sellerConfig.itemOptions;

  const isEntryBlank = (r: TicketEntryRow): boolean =>
    !String(r.start || '').trim() &&
    !String(r.end || '').trim() &&
    !String(r.qtyOverride || '').trim() &&
    !String(r.rangeOverride || '').trim();

  // Reconstruct archived own entries, sub-seller sheets, sub-parties, and winning numbers when Restore mode is active
  const restoredData = useMemo(() => {
    if (!restoredSnapshot || !party) return null;

    const ownEntries: Record<SessionId, TicketEntryRow[]> = {
      '1PM': [],
      '6PM': [],
      '8PM': [],
    };
    const subSheetMap = new Map<
      string,
      { name: string; '1PM': TicketEntryRow[]; '6PM': TicketEntryRow[]; '8PM': TicketEntryRow[] }
    >();

    for (const sid of ['1PM', '6PM', '8PM'] as SessionId[]) {
      const list = restoredSnapshot.entries?.[sid] || [];
      for (const r of list) {
        if (!r || isEntryBlank(r)) continue;
        if (r.id && r.id.startsWith('sub::')) {
          const parts = r.id.split('::');
          const subPid = parts[1] || r.name || 'sub';
          const origId = parts.slice(2).join('::') || r.id;
          let bucket = subSheetMap.get(subPid);
          if (!bucket) {
            bucket = {
              name: (r.name || 'SUB').trim(),
              '1PM': [],
              '6PM': [],
              '8PM': [],
            };
            subSheetMap.set(subPid, bucket);
          }
          bucket[sid].push({
            ...r,
            id: origId,
          });
        } else {
          ownEntries[sid].push(r);
        }
      }
    }

    const hasRestoredEntries =
      ownEntries['1PM'].length > 0 ||
      ownEntries['6PM'].length > 0 ||
      ownEntries['8PM'].length > 0 ||
      subSheetMap.size > 0;

    const partyUpper = party.name.trim().toUpperCase();
    const liveAllById = new Map<string, CloudPartyDoc>(
      (allChainParties.length > 0 ? allChainParties : subParties).map((p) => [p.partyId, p])
    );
    const liveDirectIds = new Set(subParties.map((p) => p.partyId));

    const snapOwnSeller = (restoredSnapshot.sellers || []).find(
      (s) => s.id === party.partyId || s.name.trim().toUpperCase() === partyUpper
    );
    const restoredPartyDoc: CloudPartyDoc = snapOwnSeller
      ? {
          ...party,
          rate: snapOwnSeller.rate,
          due: snapOwnSeller.due,
          joma: snapOwnSeller.joma,
        }
      : party;

    const restoredAllChain: CloudPartyDoc[] = [];
    const restoredDirectSubs: CloudPartyDoc[] = [];
    const seenSubIds = new Set<string>([party.partyId]);

    for (const s of restoredSnapshot.sellers || []) {
      if (!s || s.id === party.partyId || s.name.trim().toUpperCase() === partyUpper) continue;
      if (seenSubIds.has(s.id)) continue;
      seenSubIds.add(s.id);
      const liveMatch = liveAllById.get(s.id);
      const isDirect = liveMatch ? liveMatch.parentMasterId === party.partyId : true;
      const doc: CloudPartyDoc = liveMatch
        ? {
            ...liveMatch,
            name: s.name || liveMatch.name,
            rate: s.rate,
            due: s.due,
            joma: s.joma,
          }
        : {
            ...party,
            partyId: s.id,
            name: s.name,
            role: 'client',
            parentMasterId: party.partyId,
            parentMasterUid: party.assignedUid || '',
            assignedUid: '',
            rate: s.rate,
            due: s.due,
            joma: s.joma,
            active: true,
          };
      restoredAllChain.push(doc);
      if (isDirect || liveDirectIds.has(s.id)) {
        restoredDirectSubs.push(doc);
      }
    }

    // Fallback for older snapshots saved before `sellers` was populated: reconstruct sub-parties from sellerSummaries
    if (isMasterSeller && restoredDirectSubs.length === 0) {
      for (let i = 0; i < (restoredSnapshot.sellerSummaries || []).length; i += 1) {
        const sum = restoredSnapshot.sellerSummaries[i];
        const sumUpper = (sum.name || '').trim().toUpperCase();
        if (!sumUpper) continue;
        if (restoredSnapshot.sellerSummaries.length === 1 && sumUpper === partyUpper) continue;
        const liveByName = subParties.find((p) => p.name.trim().toUpperCase() === sumUpper);
        const pid = liveByName?.partyId || `arch-sub-${i}-${sumUpper.replace(/[^A-Z0-9]/g, '')}`;
        if (seenSubIds.has(pid)) continue;
        seenSubIds.add(pid);
        const derivedRate = sum.sold > 0 ? round2(sum.bill / sum.sold) : liveByName?.rate || 0;
        const doc: CloudPartyDoc = liveByName
          ? {
              ...liveByName,
              rate: derivedRate,
              due: sum.due,
              joma: sum.joma,
            }
          : {
              ...party,
              partyId: pid,
              name: sum.name,
              role: 'client',
              parentMasterId: party.partyId,
              parentMasterUid: party.assignedUid || '',
              assignedUid: '',
              rate: derivedRate,
              due: sum.due,
              joma: sum.joma,
              active: true,
            };
        restoredDirectSubs.push(doc);
        restoredAllChain.push(doc);
      }
    }

    // Also include any sub-sheet party that appeared in entries but wasn't in sellers
    for (const [subPid, bucket] of subSheetMap.entries()) {
      if (seenSubIds.has(subPid)) continue;
      seenSubIds.add(subPid);
      const liveMatch = liveAllById.get(subPid);
      const doc: CloudPartyDoc = liveMatch || {
        ...party,
        partyId: subPid,
        name: bucket.name,
        role: 'client',
        parentMasterId: party.partyId,
        parentMasterUid: party.assignedUid || '',
        assignedUid: '',
        rate: 0,
        due: 0,
        joma: 0,
        active: true,
      };
      restoredAllChain.push(doc);
      if (doc.parentMasterId === party.partyId) {
        restoredDirectSubs.push(doc);
      }
    }

    const restoredSubSheets: CloudPartySheetDoc[] = Array.from(subSheetMap.entries()).map(
      ([subPid, bucket]) => {
        const matched = restoredAllChain.find((p) => p.partyId === subPid);
        return {
          agencyId: party.agencyId,
          sheetId: subPid,
          partyId: subPid,
          partyName: matched?.name || bucket.name,
          role: matched?.role || 'client',
          ownerUid: party.ownerUid,
          adminUids: party.adminUids,
          assignedUid: matched?.assignedUid || '',
          parentMasterId: matched?.parentMasterId || party.partyId,
          parentMasterUid: matched?.parentMasterUid || party.assignedUid || '',
          date: restoredSnapshot.date,
          entries1PM: bucket['1PM'],
          entries6PM: bucket['6PM'],
          entries8PM: bucket['8PM'],
          updatedByUid: '',
        };
      }
    );

    const buildFallbackBillFromSummary = (
      id: string,
      sum: ArchivedSellerSummary,
      rateHint: number,
      prizesForSeller: PrizeListRow[]
    ): SellerBillRow => {
      const rate = rateHint > 0 ? rateHint : sum.sold > 0 ? round2(sum.bill / sum.sold) : 0;
      const amt1pm = round2(sum.mor * rate);
      const amt6pm = round2(sum.day * rate);
      const amt8pm = round2(sum.eve * rate);
      const dateLabel = formatDateDDMMYYYY(restoredSnapshot.date);
      const msg = [
        `*KK AGENCY BILL (${dateLabel})*`,
        `Name: *${sum.name}*`,
        `1PM: ${formatINR(sum.mor)} | 6PM: ${formatINR(sum.day)} | 8PM: ${formatINR(sum.eve)}`,
        `Total Sold: ${formatINR(sum.sold)}`,
        `Gross Bill: ₹${formatINR(sum.bill)}`,
        `Prize (-): ₹${formatINR(sum.prizeTotal)}`,
        `Fresh: ₹${formatINR(sum.fresh)}`,
        `Joma (-): ₹${formatINR(sum.joma)} | Due (+): ₹${formatINR(sum.due)}`,
        `*NET TOTAL: ₹${formatINR(sum.total)}*`,
      ].join('\n');
      return {
        id,
        name: sum.name,
        mobile: '',
        rate,
        due: sum.due,
        joma: sum.joma,
        mor: sum.mor,
        day: sum.day,
        eve: sum.eve,
        sold: sum.sold,
        amt1pm,
        amt6pm,
        amt8pm,
        bill: sum.bill,
        prizeTotal: sum.prizeTotal,
        fresh: sum.fresh,
        total: sum.total,
        prizes: prizesForSeller,
        waMessage: msg,
        waUrl: `https://wa.me/?text=${encodeURIComponent(msg)}`,
      };
    };

    return {
      snapshot: restoredSnapshot,
      partyDoc: restoredPartyDoc,
      ownEntries,
      subSheets: restoredSubSheets,
      subParties: restoredDirectSubs,
      allChainParties: restoredAllChain,
      hasRestoredEntries,
      winningRaw: {
        '1PM': restoredSnapshot.winningRaw?.['1PM'] || '',
        '6PM': restoredSnapshot.winningRaw?.['6PM'] || '',
        '8PM': restoredSnapshot.winningRaw?.['8PM'] || '',
      },
      buildFallbackBillFromSummary,
    };
  }, [restoredSnapshot, party, allChainParties, subParties, isMasterSeller]);

  const effectiveParty = restoredData ? restoredData.partyDoc : party;
  const effectiveEntries = restoredData ? restoredData.ownEntries : entries;
  const effectiveSubSheets = restoredData ? restoredData.subSheets : subSheets;
  const effectiveSubParties = restoredData ? restoredData.subParties : subParties;
  const effectiveAllChainParties = restoredData ? restoredData.allChainParties : allChainParties;

  // Live computations (always track current working day for Save Archive)
  const liveSessionComputations: Record<SessionId, SessionComputation> = useMemo(
    () => ({
      '1PM': processSessionRows(entries['1PM'], '1PM', sellerConfig),
      '6PM': processSessionRows(entries['6PM'], '6PM', sellerConfig),
      '8PM': processSessionRows(entries['8PM'], '8PM', sellerConfig),
    }),
    [entries, sellerConfig]
  );

  // Active view computations (switches cleanly to Restored Archive when viewing history)
  const sessionComputations: Record<SessionId, SessionComputation> = useMemo(
    () =>
      restoredData
        ? {
            '1PM': processSessionRows(effectiveEntries['1PM'], '1PM', sellerConfig),
            '6PM': processSessionRows(effectiveEntries['6PM'], '6PM', sellerConfig),
            '8PM': processSessionRows(effectiveEntries['8PM'], '8PM', sellerConfig),
          }
        : liveSessionComputations,
    [restoredData, effectiveEntries, sellerConfig, liveSessionComputations]
  );

  // Combined Chain Computations (Own + Sub-Sellers) for Master's Admin Bill & Individual Sub-Seller Bills
  const chainMasterRollupComputations: Record<SessionId, SessionComputation> = useMemo(() => {
    if (!isMasterSeller || !effectiveParty || effectiveSubSheets.length === 0) return sessionComputations;
    const combineForMaster = (sid: SessionId): TicketEntryRow[] => {
      const own = effectiveEntries[sid] || [];
      const subRows: TicketEntryRow[] = [];
      for (const sh of effectiveSubSheets) {
        const list =
          sid === '1PM' ? sh.entries1PM : sid === '6PM' ? sh.entries6PM : sh.entries8PM;
        for (const r of list || []) {
          subRows.push({
            ...r,
            id: `sub::${sh.partyId}::${r.id}`,
            name: effectiveParty.name,
          });
        }
      }
      return [...own, ...subRows];
    };
    return {
      '1PM': processSessionRows(combineForMaster('1PM'), '1PM', sellerConfig),
      '6PM': processSessionRows(combineForMaster('6PM'), '6PM', sellerConfig),
      '8PM': processSessionRows(combineForMaster('8PM'), '8PM', sellerConfig),
    };
  }, [isMasterSeller, effectiveParty, effectiveSubSheets, effectiveEntries, sellerConfig, sessionComputations]);

  // Map every descendant sheet (L2, L3, L4...) to its individual seller name for Prize List
  const chainIndividualComputations: Record<SessionId, SessionComputation> = useMemo(() => {
    if (!isMasterSeller || !effectiveParty || effectiveSubSheets.length === 0) return sessionComputations;
    const allById = new Map<string, CloudPartyDoc>(effectiveAllChainParties.map((p) => [p.partyId, p]));
    const combineNamed = (sid: SessionId): TicketEntryRow[] => {
      const own = effectiveEntries[sid] || [];
      const subRows: TicketEntryRow[] = [];
      for (const sh of effectiveSubSheets) {
        const matchedSub =
          allById.get(sh.partyId) || effectiveSubParties.find((p) => p.partyId === sh.partyId);
        const subName = (matchedSub?.name || sh.partyName || 'SUB').trim();
        const list =
          sid === '1PM' ? sh.entries1PM : sid === '6PM' ? sh.entries6PM : sh.entries8PM;
        for (const r of list || []) {
          subRows.push({
            ...r,
            id: `sub::${sh.partyId}::${r.id}`,
            name: subName,
          });
        }
      }
      return [...own, ...subRows];
    };
    return {
      '1PM': processSessionRows(combineNamed('1PM'), '1PM', sellerConfig),
      '6PM': processSessionRows(combineNamed('6PM'), '6PM', sellerConfig),
      '8PM': processSessionRows(combineNamed('8PM'), '8PM', sellerConfig),
    };
  }, [isMasterSeller, effectiveParty, effectiveSubSheets, effectiveAllChainParties, effectiveSubParties, effectiveEntries, sellerConfig, sessionComputations]);

  // Roll up nested L3/L4/L5+ sheets into their direct L2 branch under this Master for accurate direct Sub-Seller billing
  const chainDirectBranchComputations: Record<SessionId, SessionComputation> = useMemo(() => {
    if (!isMasterSeller || !effectiveParty || effectiveSubSheets.length === 0) return sessionComputations;
    const allById = new Map<string, CloudPartyDoc>(effectiveAllChainParties.map((p) => [p.partyId, p]));
    const directById = new Map<string, CloudPartyDoc>(effectiveSubParties.map((p) => [p.partyId, p]));

    const resolveDirectBranchName = (sh: CloudPartySheetDoc): string => {
      let currId = sh.partyId;
      let parentId = allById.get(currId)?.parentMasterId || sh.parentMasterId || '';
      const visited = new Set<string>();
      while (currId && !visited.has(currId)) {
        visited.add(currId);
        if (parentId === effectiveParty.partyId && directById.has(currId)) {
          return directById.get(currId)!.name.trim();
        }
        if (!parentId || parentId === effectiveParty.partyId) break;
        currId = parentId;
        parentId = allById.get(currId)?.parentMasterId || '';
      }
      return (directById.get(sh.partyId)?.name || allById.get(sh.partyId)?.name || sh.partyName || 'SUB').trim();
    };

    const combineBranches = (sid: SessionId): TicketEntryRow[] => {
      const subRows: TicketEntryRow[] = [];
      for (const sh of effectiveSubSheets) {
        const branchName = resolveDirectBranchName(sh);
        const list =
          sid === '1PM' ? sh.entries1PM : sid === '6PM' ? sh.entries6PM : sh.entries8PM;
        for (const r of list || []) {
          subRows.push({
            ...r,
            id: `branch::${sh.partyId}::${r.id}`,
            name: branchName,
          });
        }
      }
      return subRows;
    };
    return {
      '1PM': processSessionRows(combineBranches('1PM'), '1PM', sellerConfig),
      '6PM': processSessionRows(combineBranches('6PM'), '6PM', sellerConfig),
      '8PM': processSessionRows(combineBranches('8PM'), '8PM', sellerConfig),
    };
  }, [isMasterSeller, effectiveParty, effectiveSubSheets, effectiveAllChainParties, effectiveSubParties, sellerConfig, sessionComputations]);

  const parsedWinning = useMemo(
    () =>
      parseWinningNumbers(
        restoredData
          ? restoredData.winningRaw
          : {
              '1PM': agency?.winning1PM || '',
              '6PM': agency?.winning6PM || '',
              '8PM': agency?.winning8PM || '',
            }
      ),
    [restoredData, agency?.winning1PM, agency?.winning6PM, agency?.winning8PM]
  );

  const hasAnyWinningNumbers =
    parsedWinning['1PM'].length > 0 ||
    parsedWinning['6PM'].length > 0 ||
    parsedWinning['8PM'].length > 0 ||
    Boolean(restoredData && (restoredData.snapshot.prizeList?.length || 0) > 0);

  // Individual prize list (shows Master's own wins + every Chain Seller's wins separately by name)
  const { prizeList: computedPrizeList } = useMemo(
    () => generatePrizeAndLimitData(chainIndividualComputations, parsedWinning, sellerConfig),
    [chainIndividualComputations, parsedWinning, sellerConfig]
  );

  const prizeList: PrizeListRow[] = useMemo(() => {
    if (restoredData && !restoredData.hasRestoredEntries) {
      return restoredData.snapshot.prizeList || [];
    }
    if (restoredData && computedPrizeList.length === 0 && (restoredData.snapshot.prizeList?.length || 0) > 0) {
      return restoredData.snapshot.prizeList;
    }
    return computedPrizeList;
  }, [restoredData, computedPrizeList]);

  // Branch-rolled prize list (for deducting nested chain prizes from direct Sub-Seller bills)
  const { prizeList: branchRollupPrizeList } = useMemo(
    () => generatePrizeAndLimitData(chainDirectBranchComputations, parsedWinning, sellerConfig),
    [chainDirectBranchComputations, parsedWinning, sellerConfig]
  );

  // Master's rolled-up prize list (for Admin Bill deduction: own + entire chain combined under Master's name)
  const { prizeList: masterRollupPrizeList } = useMemo(
    () => generatePrizeAndLimitData(chainMasterRollupComputations, parsedWinning, sellerConfig),
    [chainMasterRollupComputations, parsedWinning, sellerConfig]
  );

  const sellerList: Seller[] = useMemo(() => {
    if (!effectiveParty) return [];
    const list: Seller[] = [
      {
        id: effectiveParty.partyId,
        name: effectiveParty.name,
        mobile: '',
        rate: effectiveParty.rate,
        due: effectiveParty.due,
        joma: effectiveParty.joma,
      },
    ];
    if (isMasterSeller) {
      const seen = new Set<string>([effectiveParty.partyId]);
      const sourceParties =
        effectiveAllChainParties.length > 0 ? effectiveAllChainParties : effectiveSubParties;
      for (const sp of sourceParties) {
        if (seen.has(sp.partyId)) continue;
        seen.add(sp.partyId);
        const priv = subPrivates.find((pr) => pr.partyId === sp.partyId);
        list.push({
          id: sp.partyId,
          name: sp.name,
          mobile: priv?.mobile || '',
          rate: sp.rate,
          due: sp.due,
          joma: sp.joma,
        });
      }
    }
    return list;
  }, [effectiveParty, isMasterSeller, effectiveAllChainParties, effectiveSubParties, subPrivates]);

  const myBill = useMemo(() => {
    if (!effectiveParty) return null;
    if (restoredData && !restoredData.hasRestoredEntries) {
      const snap = restoredData.snapshot;
      const partyUpper = effectiveParty.name.trim().toUpperCase();
      const matchedSum = (snap.sellerSummaries || []).find(
        (s) => s.name.trim().toUpperCase() === partyUpper
      );
      if (matchedSum) {
        return restoredData.buildFallbackBillFromSummary(
          effectiveParty.partyId,
          matchedSum,
          effectiveParty.rate,
          (snap.prizeList || []).filter((p) => p.name.trim().toUpperCase() === partyUpper)
        );
      }
      // Older Master snapshot where sellerSummaries only listed sub-sellers: build aggregate summary
      const mor = round2((snap.sellerSummaries || []).reduce((a, b) => a + b.mor, 0));
      const day = round2((snap.sellerSummaries || []).reduce((a, b) => a + b.day, 0));
      const eve = round2((snap.sellerSummaries || []).reduce((a, b) => a + b.eve, 0));
      const sold = round2(snap.totalSold || mor + day + eve);
      const bill = round2(effectiveParty.rate > 0 ? sold * effectiveParty.rate : snap.totalBill);
      const prizeTotal = round2(snap.totalPrize || 0);
      const fresh = round2(bill - prizeTotal);
      const total = round2(fresh + effectiveParty.due - effectiveParty.joma);
      return restoredData.buildFallbackBillFromSummary(
        effectiveParty.partyId,
        {
          name: effectiveParty.name,
          mor,
          day,
          eve,
          sold,
          bill,
          prizeTotal,
          fresh,
          joma: effectiveParty.joma,
          due: effectiveParty.due,
          total,
        },
        effectiveParty.rate,
        snap.prizeList || []
      );
    }
    const masterOnly: Seller[] = [
      {
        id: effectiveParty.partyId,
        name: effectiveParty.name,
        mobile: '',
        rate: effectiveParty.rate,
        due: effectiveParty.due,
        joma: effectiveParty.joma,
      },
    ];
    const bills = computeSellerBills(
      masterOnly,
      chainMasterRollupComputations,
      masterRollupPrizeList,
      effectiveBillingDate
    );
    return bills[0] || null;
  }, [effectiveParty, restoredData, chainMasterRollupComputations, masterRollupPrizeList, effectiveBillingDate]);

  const ownDirectSold = useMemo(() => {
    const q1 = sessionComputations['1PM'].totalQty || 0;
    const q6 = sessionComputations['6PM'].totalQty || 0;
    const q8 = sessionComputations['8PM'].totalQty || 0;
    return round2(q1 + q6 + q8);
  }, [sessionComputations]);

  const subBillsByPartyId: Record<string, SellerBillRow> = useMemo(() => {
    if (!isMasterSeller || effectiveSubParties.length === 0) return {};
    if (restoredData && !restoredData.hasRestoredEntries) {
      const map: Record<string, SellerBillRow> = {};
      const snap = restoredData.snapshot;
      for (const sp of effectiveSubParties) {
        const spUpper = sp.name.trim().toUpperCase();
        const matchedSum = (snap.sellerSummaries || []).find(
          (s) => s.name.trim().toUpperCase() === spUpper
        );
        if (matchedSum) {
          map[sp.partyId] = restoredData.buildFallbackBillFromSummary(
            sp.partyId,
            matchedSum,
            sp.rate,
            (snap.prizeList || []).filter((p) => p.name.trim().toUpperCase() === spUpper)
          );
        }
      }
      return map;
    }
    const subSellerList: Seller[] = effectiveSubParties.map((sp) => {
      const priv = subPrivates.find((pr) => pr.partyId === sp.partyId);
      return {
        id: sp.partyId,
        name: sp.name,
        mobile: priv?.mobile || '',
        rate: sp.rate,
        due: sp.due,
        joma: sp.joma,
      };
    });
    const bills = computeSellerBills(
      subSellerList,
      chainDirectBranchComputations,
      branchRollupPrizeList,
      effectiveBillingDate
    );
    const map: Record<string, SellerBillRow> = {};
    for (const b of bills) {
      map[b.id] = b;
    }
    return map;
  }, [
    isMasterSeller,
    effectiveSubParties,
    restoredData,
    subPrivates,
    chainDirectBranchComputations,
    branchRollupPrizeList,
    effectiveBillingDate,
  ]);

  if (loading) {
    return (
      <div className="h-full w-full overflow-y-auto bg-[var(--kk-canvas)] flex flex-col items-center justify-center p-6 gap-3 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="w-12 h-12 rounded-2xl kk-brand-gradient text-white flex items-center justify-center shadow-lg">
          <RefreshCw className="w-6 h-6 animate-spin" />
        </div>
        <div className="text-sm font-extrabold text-slate-900">Opening Seller App...</div>
      </div>
    );
  }

  if (revokedReason || !party || !effectiveParty) {
    return (
      <div className="h-full w-full overflow-y-auto bg-[var(--kk-canvas)] flex items-center justify-center p-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-sm w-full bg-white border border-rose-200 rounded-3xl p-6 text-center shadow-xl space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-black text-slate-950">Seller Access Paused</h2>
            <p className="text-xs font-medium text-slate-600">
              {revokedReason || 'Admin se apna active Seller ID confirm karein.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              AppSounds.tap();
              void onSignOut();
            }}
            className="w-full py-2.5 px-4 rounded-xl kk-brand-gradient text-white text-xs font-extrabold cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  const openMyBillCardModal = () => {
    if (!myBill) return;
    AppSounds.tap();
    const dateStr = formatDateDDMMYYYY(effectiveBillingDate);
    setPreviewModal({
      isOpen: true,
      title: `${myBill.name} — Bill Card`,
      subtitle: `${dateStr} • Net ₹${formatINR(myBill.total)}`,
      message: myBill.waMessage,
      waUrl: '',
      billData: { bill: myBill, dateStr },
    });
  };

  const handleSendMyBillCard = async () => {
    if (!myBill || sendingMyBillCard) return;
    const dateStr = formatDateDDMMYYYY(effectiveBillingDate);
    setSendingMyBillCard(true);
    try {
      const res = await sendBillCardDirectToWhatsApp({ bill: myBill, dateStr });
      AppSounds.success();
      const msg =
        res.method === 'copied_direct'
          ? 'Bill Card copy ho gaya — WhatsApp chat me bas Paste → Send karein.'
          : 'Bill Card PNG save ho gaya — WhatsApp chat me attach karke bhej dein.';
      setWaCardToast({ message: msg, waUrl: res.waUrl });
      window.setTimeout(() => {
        setWaCardToast((curr) => (curr?.message === msg ? null : curr));
      }, 6500);
    } catch {
      openMyBillCardModal();
    } finally {
      setSendingMyBillCard(false);
    }
  };

  const isSubSeller = Boolean(party.parentMasterId);

  const persistLocalPartyArchives = (next: DaySnapshot[]) => {
    setPartyArchives(next);
    try {
      window.localStorage.setItem(archiveStorageKey, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  };

  const persistPartyRecycleBin = (next: DaySnapshot[]) => {
    setPartyRecycleBin(next);
    try {
      window.localStorage.setItem(recycleBinStorageKey, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  };

  const showArchiveNotice = (msg: string) => {
    setArchiveToast(msg);
    window.setTimeout(() => {
      setArchiveToast((curr) => (curr === msg ? '' : curr));
    }, 4500);
  };

  const buildPartyArchiveSnapshot = (trigger: DaySnapshot['trigger']): DaySnapshot => {
    const directSubBills =
      isMasterSeller && effectiveSubParties.length > 0
        ? effectiveSubParties
            .map((sp) => subBillsByPartyId[sp.partyId])
            .filter((b): b is SellerBillRow => Boolean(b))
        : [];

    const summaryRows: SellerBillRow[] =
      directSubBills.length > 0 ? directSubBills : myBill ? [myBill] : [];

    const totalSold = round2(summaryRows.reduce((a, b) => a + b.sold, 0));
    const totalBill = round2(summaryRows.reduce((a, b) => a + b.bill, 0));
    const totalPrize = round2(summaryRows.reduce((a, b) => a + b.prizeTotal, 0));
    const totalNetPayable = round2(summaryRows.reduce((a, b) => a + b.total, 0));

    // Capture full non-PII seller roster (own party + sub-sellers) for exact Restore
    const archiveSellers: Seller[] = [
      {
        id: party.partyId,
        name: party.name,
        mobile: '',
        rate: party.rate,
        due: party.due,
        joma: party.joma,
      },
    ];
    const seenSellerIds = new Set<string>([party.partyId]);
    if (isMasterSeller) {
      const chainSource = allChainParties.length > 0 ? allChainParties : subParties;
      for (const sp of [...subParties, ...chainSource]) {
        if (seenSellerIds.has(sp.partyId)) continue;
        seenSellerIds.add(sp.partyId);
        archiveSellers.push({
          id: sp.partyId,
          name: sp.name,
          mobile: '',
          rate: sp.rate,
          due: sp.due,
          joma: sp.joma,
        });
      }
    }

    // Capture own non-blank entries + sub-sellers' non-blank entries (tagged sub::partyId::rowId)
    const allById = new Map<string, CloudPartyDoc>(
      (allChainParties.length > 0 ? allChainParties : subParties).map((p) => [p.partyId, p])
    );
    const archiveEntries: Record<SessionId, TicketEntryRow[]> = {
      '1PM': [],
      '6PM': [],
      '8PM': [],
    };
    for (const sid of ['1PM', '6PM', '8PM'] as SessionId[]) {
      const ownRows = (entries[sid] || [])
        .filter((r) => !isEntryBlank(r))
        .map((r) => ({ ...r, name: party.name }));
      const subRows: TicketEntryRow[] = [];
      if (isMasterSeller) {
        for (const sh of subSheets) {
          const matchedSub = allById.get(sh.partyId) || subParties.find((p) => p.partyId === sh.partyId);
          const subName = (matchedSub?.name || sh.partyName || 'SUB').trim();
          const list =
            sid === '1PM' ? sh.entries1PM : sid === '6PM' ? sh.entries6PM : sh.entries8PM;
          for (const r of list || []) {
            if (isEntryBlank(r)) continue;
            subRows.push({
              ...r,
              id: `sub::${sh.partyId}::${r.id}`,
              name: subName,
            });
          }
        }
      }
      archiveEntries[sid] = [...ownRows, ...subRows];
    }

    return {
      id: `snap-${party.partyId.slice(0, 16)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date: billingDate,
      savedAt: new Date().toISOString(),
      trigger,
      totalSold,
      totalBill,
      totalPrize,
      totalNetPayable,
      limitGrandTotal: 0,
      overLimitTotals: {
        '1PM': liveSessionComputations['1PM'].overLimitTotal,
        '6PM': liveSessionComputations['6PM'].overLimitTotal,
        '8PM': liveSessionComputations['8PM'].overLimitTotal,
      },
      sellerSummaries: summaryRows.map((b) => ({
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
      limitPrizeGroups: [],
      sellers: archiveSellers,
      entries: archiveEntries,
      winningRaw: {
        '1PM': agency?.winning1PM || '',
        '6PM': agency?.winning6PM || '',
        '8PM': agency?.winning8PM || '',
      },
    };
  };

  const handleRestorePartySnapshot = (snap: DaySnapshot) => {
    AppSounds.success();
    setRestoredSnapshot(snap);
    setActiveTab('My Bill');
  };

  const handleExitRestoredArchive = () => {
    AppSounds.tap();
    setRestoredSnapshot(null);
  };

  const handleSavePartyArchive = async () => {
    if (archiveBusy) return;
    if (restoredSnapshot) {
      setRestoredSnapshot(null);
      showArchiveNotice('Live Today view open ho gaya — ab Save Archive dabayein.');
      return;
    }
    setArchiveBusy(true);
    try {
      const snap = buildPartyArchiveSnapshot('manual');
      const saved = await savePartyArchiveCloud(uid, party, snap, adminPreviewMode);
      persistLocalPartyArchives([saved, ...partyArchives.filter((s) => s.id !== saved.id)].slice(0, 60));
      AppSounds.success();
      showArchiveNotice(`Archive saved (${formatDateDDMMYYYY(billingDate)})`);
    } catch {
      const snap = buildPartyArchiveSnapshot('manual');
      persistLocalPartyArchives([snap, ...partyArchives].slice(0, 60));
      AppSounds.success();
      showArchiveNotice(`Archive saved locally (${formatDateDDMMYYYY(billingDate)})`);
    } finally {
      setArchiveBusy(false);
    }
  };

  const handleArchiveAndCarryForwardSubs = async () => {
    if (archiveBusy || !isMasterSeller || subParties.length === 0 || adminPreviewMode) return;
    if (restoredSnapshot) {
      setRestoredSnapshot(null);
      showArchiveNotice('Pehle Live Today view open ho gaya — ab Archive & Carry Due/Joma dabayein.');
      return;
    }
    setArchiveBusy(true);
    try {
      const snap = buildPartyArchiveSnapshot('day-close');
      const saved = await savePartyArchiveCloud(uid, party, snap, false);
      persistLocalPartyArchives([saved, ...partyArchives.filter((s) => s.id !== saved.id)].slice(0, 60));
      await carryForwardSubSellerBalancesCloud(uid, party, subParties, subBillsByPartyId);
      AppSounds.success();
      showArchiveNotice(
        `Archive saved & Sub-Sellers +Total → Due / -Total → Joma carry-forward ho gaya!`
      );
    } catch {
      showArchiveNotice('Archive save karne me dikkat aayi — internet check karke dubara try karein.');
    } finally {
      setArchiveBusy(false);
    }
  };

  const handleUpdatePartyArchiveDate = async (snapshotId: string, newDate: string) => {
    const target = partyArchives.find((s) => s.id === snapshotId);
    if (!target) return;
    const nextList = partyArchives.map((s) =>
      s.id === snapshotId ? { ...s, date: newDate } : s
    );
    persistLocalPartyArchives(nextList);
    if (restoredSnapshot?.id === snapshotId) {
      setRestoredSnapshot((prev) => (prev ? { ...prev, date: newDate } : null));
    }
    try {
      await updatePartyArchiveDateCloud(agencyId, target, newDate);
    } catch {
      // Keep local update visible
    }
  };

  const handleDeletePartyArchive = async (snapshotId: string) => {
    const target = partyArchives.find((s) => s.id === snapshotId);
    const nextList = partyArchives.filter((s) => s.id !== snapshotId);
    persistLocalPartyArchives(nextList);
    if (target) {
      const binned: DaySnapshot = { ...target, deletedAt: new Date().toISOString() };
      persistPartyRecycleBin(
        [binned, ...partyRecycleBin.filter((s) => s.id !== snapshotId)].slice(0, 60)
      );
      showArchiveNotice(
        `${formatDateDDMMYYYY(target.date)} Recycle Bin me move ho gaya`
      );
    }
    if (restoredSnapshot?.id === snapshotId) {
      setRestoredSnapshot(null);
    }
    try {
      await deletePartyArchiveCloud(agencyId, snapshotId);
    } catch {
      // Keep local delete visible
    }
  };

  const handleRecoverPartyArchiveFromBin = async (snapshotId: string) => {
    const target = partyRecycleBin.find((s) => s.id === snapshotId);
    if (!target) return;
    const { deletedAt: _removed, ...cleanSnap } = target;
    persistPartyRecycleBin(partyRecycleBin.filter((s) => s.id !== snapshotId));
    persistLocalPartyArchives(
      [cleanSnap, ...partyArchives.filter((s) => s.id !== cleanSnap.id)].slice(0, 60)
    );
    showArchiveNotice(`${formatDateDDMMYYYY(cleanSnap.date)} Recycle Bin se Recover ho gaya!`);
    try {
      await savePartyArchiveCloud(uid, party, cleanSnap, adminPreviewMode);
    } catch {
      // Keep recovered record locally visible
    }
  };

  const handlePermanentDeletePartyFromBin = (snapshotId: string) => {
    persistPartyRecycleBin(partyRecycleBin.filter((s) => s.id !== snapshotId));
    showArchiveNotice('Archive Recycle Bin se permanently delete ho gaya');
  };

  const handleEmptyPartyRecycleBin = () => {
    persistPartyRecycleBin([]);
    showArchiveNotice('Recycle Bin khali ho gaya');
  };

  const renderSessionLockNotice = (sid: SessionId) => {
    if (isArchiveViewMode && restoredSnapshot) {
      return (
        <div className="bg-indigo-50 border border-indigo-200 text-indigo-950 rounded-2xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs shadow-xs">
          <span className="inline-flex items-center gap-1.5 font-extrabold">
            <Archive className="w-3.5 h-3.5 text-indigo-700 shrink-0" />
            <span>
              Restored Archive ({formatDateDDMMYYYY(restoredSnapshot.date)}) · {sid} Read-Only View
            </span>
          </span>
          <button
            type="button"
            onClick={handleExitRestoredArchive}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--kk-brand)] text-white text-[11px] font-extrabold cursor-pointer hover:opacity-90"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Back to Live</span>
          </button>
        </div>
      );
    }
    const st = sessionLockMap[sid];
    if (adminPreviewMode) {
      return (
        <div className="bg-amber-50 border border-amber-200 text-amber-950 rounded-2xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-extrabold">
            <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>
              Seller Cutoff: {st.cutoffLabel} IST{' '}
              {st.isLocked ? '(Sellers ke liye band)' : `(${st.remainingLabel})`}
            </span>
          </span>
          <span className="text-[11px] font-bold text-amber-800">
            Admin Preview — Editing Unlocked
          </span>
        </div>
      );
    }

    if (st.isLocked) {
      return (
        <div className="bg-rose-50 border border-rose-200 text-rose-950 rounded-2xl px-3.5 py-3 flex items-start gap-2.5 shadow-xs">
          <span className="w-8 h-8 rounded-xl bg-rose-100 border border-rose-200 text-rose-700 flex items-center justify-center shrink-0 mt-0.5">
            <Lock className="w-4 h-4" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <div className="text-xs sm:text-sm font-black text-rose-900">
              {st.reason === 'past-date'
                ? `${sid} Edit Locked (${formatDateDDMMYYYY(billingDate)})`
                : `${sid} Edit Band Ho Gaya (${st.cutoffLabel} IST Cutoff)`}
            </div>
            <p className="text-[11px] font-semibold text-rose-800/90 leading-snug">
              {st.reason === 'past-date'
                ? 'Purani date ki sheet ab locked hai. Sirf View aur Copy kar sakte hain.'
                : `${sid} session ka time (${st.cutoffLabel}) khatam ho gaya hai. Ab entry/edit band hai — sirf View aur Copy allowed hai.`}
            </p>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`rounded-2xl px-3.5 py-2.5 border flex flex-wrap items-center justify-between gap-2 text-xs ${
          st.isClosingSoon
            ? 'bg-amber-50 border-amber-200 text-amber-950'
            : 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
        }`}
      >
        <span className="inline-flex items-center gap-1.5 font-extrabold">
          <Clock
            className={`w-3.5 h-3.5 shrink-0 ${
              st.isClosingSoon ? 'text-amber-700' : 'text-emerald-700'
            }`}
          />
          <span>
            {sid} Entry Open · Cutoff {st.cutoffLabel} IST
          </span>
        </span>
        <span
          className={`font-mono-tabular font-black text-[11px] px-2 py-0.5 rounded-lg ${
            st.isClosingSoon
              ? 'bg-amber-200/80 text-amber-950'
              : 'bg-emerald-100 text-emerald-900'
          }`}
        >
          {st.remainingLabel}
        </span>
      </div>
    );
  };

  return (
    <div className="h-full w-full overflow-hidden bg-[var(--kk-canvas)] text-slate-950 flex flex-col">
      {/* Top Executive Seller Header (Solid Navy, Zero Blur, Safe-Area Full-Screen) */}
      <header className="shrink-0 z-30 kk-brand-gradient text-white border-b border-black/15 pt-[env(safe-area-inset-top)]">
        <div className="min-h-16 sm:min-h-[68px] py-2 px-3 sm:px-6 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <img
            src="/kk-logo.png"
            alt="KK Agency"
            referrerPolicy="no-referrer"
            className="w-10 h-10 rounded-xl object-cover shrink-0 shadow-md ring-1 ring-white/25"
          />
          <div className="min-w-0 flex flex-col gap-0.5">
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-[16px] sm:text-lg font-extrabold tracking-[-0.015em] text-white leading-tight truncate">
                {party.name}
              </span>
              {isSubSeller ? (
                <span className="text-[11px] font-semibold text-amber-200/90 whitespace-nowrap shrink-0">
                  · Sub-Seller
                </span>
              ) : isMasterSeller ? (
                <span className="text-[11px] font-semibold text-emerald-200/90 whitespace-nowrap shrink-0">
                  · Master
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2 text-[12px] text-white/85 font-mono-tabular font-semibold tracking-[0.02em]">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Calendar className="w-3.5 h-3.5 text-amber-300/95 shrink-0" aria-hidden="true" />
                {formatDateDDMMYYYY(effectiveBillingDate)}
              </span>
              {isArchiveViewMode ? (
                <span className="text-amber-300 text-[11px] font-bold whitespace-nowrap">
                  · Archive
                </span>
              ) : syncState === 'error' ? (
                <button
                  type="button"
                  onClick={handleManualRetrySync}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/25 border border-rose-300/40 text-rose-100 hover:bg-rose-500/40 text-[11px] cursor-pointer"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  <span>Retry</span>
                </button>
              ) : (
                <span className={syncState === 'saving' ? 'text-amber-200 text-[11px]' : 'text-emerald-200/90 text-[11px]'}>
                  · {syncState === 'saving' ? 'Saving...' : 'Live'}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onToggleSound}
            aria-label={soundEnabled ? 'Turn sound off' : 'Turn sound on'}
            className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 text-white cursor-pointer"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {adminPreviewMode && onExitAdminPreview ? (
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                onExitAdminPreview();
              }}
              className="inline-flex items-center gap-1 h-9 px-3 text-xs font-extrabold text-[var(--kk-brand)] bg-white hover:bg-slate-100 rounded-xl cursor-pointer shadow-xs"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Admin</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                void onSignOut();
              }}
              aria-label="Sign out"
              className="inline-flex items-center gap-1 h-9 px-2.5 text-xs font-bold text-[var(--kk-brand)] bg-white hover:bg-slate-100 rounded-xl cursor-pointer shadow-xs"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          )}
        </div>
        </div>
      </header>

      {/* Internal Scroll Viewport (eliminates iOS 26 top blur & freezes sheet headers flush at top-0) */}
      <main
        ref={scrollRef}
        data-kk-scroll-root="true"
        className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain bg-[var(--kk-canvas)]"
      >
        <div
          className={`px-2 pt-2 sm:px-5 sm:pt-4 max-w-[1200px] w-full mx-auto ${
            activeTab === '1PM' || activeTab === '6PM' || activeTab === '8PM'
              ? 'pb-1.5 sm:pb-3'
              : 'pb-24'
          }`}
        >
        {announcement?.active && (announcement.title.trim() || announcement.message.trim()) && (
          <div className="mb-3">
            <AnnouncementBanner announcement={announcement} variant="portal" />
          </div>
        )}
        {isArchiveViewMode && restoredSnapshot && (
          <div className="mb-3 kk-brand-gradient text-white rounded-2xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 shadow-sm border border-white/15">
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5 text-xs font-extrabold">
                <Archive className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                <span>Restored Archive · {formatDateDDMMYYYY(restoredSnapshot.date)}</span>
              </div>
              <div className="text-[11px] font-mono-tabular text-white/85">
                Sold: {formatINR(restoredSnapshot.totalSold)} · Bill: ₹{formatINR(restoredSnapshot.totalBill)} · Prize: ₹{formatINR(restoredSnapshot.totalPrize)} · Net:{' '}
                <span
                  className={
                    restoredSnapshot.totalNetPayable > 0
                      ? 'text-emerald-300 font-bold'
                      : restoredSnapshot.totalNetPayable < 0
                        ? 'text-rose-300 font-bold'
                        : 'text-white font-bold'
                  }
                >
                  ₹{formatINR(restoredSnapshot.totalNetPayable)}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleExitRestoredArchive}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-[var(--kk-brand)] hover:bg-slate-100 text-xs font-extrabold cursor-pointer shadow-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Back to Live ({formatDateDDMMYYYY(billingDate)})</span>
            </button>
          </div>
        )}
        {adminPreviewMode && onExitAdminPreview && (
          <div className="mb-3 bg-amber-400 text-slate-950 rounded-2xl px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-extrabold border border-amber-500/40 shadow-xs">
            <span className="truncate">
              Admin Preview: {party.name} ({isSubSeller ? 'Sub-Seller' : isMasterSeller ? 'Master Seller' : 'Seller'}) · Editing Unlocked
            </span>
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                onExitAdminPreview();
              }}
              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-950 text-white text-[11px] font-extrabold cursor-pointer hover:bg-slate-800"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Admin</span>
            </button>
          </div>
        )}
        {syncState === 'error' && syncErrorMsg && (
          <div className="mb-3 bg-rose-50 border border-rose-200 text-rose-900 rounded-2xl px-3.5 py-2.5 text-xs font-bold flex items-center justify-between gap-2 shadow-xs">
            <span className="leading-snug">{syncErrorMsg}</span>
            <button
              type="button"
              onClick={handleManualRetrySync}
              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-600 text-white text-[11px] font-extrabold cursor-pointer hover:bg-rose-700"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          </div>
        )}
        {waCardToast && (
          <div className="mb-3 bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-2xl px-3.5 py-2.5 text-xs font-bold flex items-center justify-between gap-2 shadow-xs">
            <span className="leading-snug">{waCardToast.message}</span>
            <a
              href={waCardToast.waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-extrabold whitespace-nowrap"
            >
              <ExternalLink className="w-3 h-3" />
              <span>WhatsApp</span>
            </a>
          </div>
        )}
        <AnimatePresence>
          {liveChainAlert && (
            <motion.div
              key="live-chain-alert"
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              className="mb-3 bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-2xl px-3.5 py-2.5 text-xs font-extrabold flex items-center justify-between gap-2 shadow-xs"
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping shrink-0" />
                <span className="truncate">{liveChainAlert}</span>
              </span>
              <button
                type="button"
                onClick={() => setLiveChainAlert('')}
                className="text-emerald-800 hover:text-emerald-950 shrink-0 cursor-pointer"
              >
                OK
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
          >
            {activeTab === 'My Bill' && myBill && (
              <div className="space-y-3.5">
                {/* Summary KPI Grid (Strictly Sold, Bill, Prize, Fresh / Net Total — NO cut margin) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="kk-surface-card rounded-2xl p-3.5">
                    <div className="text-[11px] font-bold text-slate-500">Total Sold</div>
                    <div className="text-xl sm:text-2xl font-black font-mono-tabular text-slate-950 mt-0.5">
                      {formatINR(myBill.sold)}
                    </div>
                    <div className="text-[11px] font-semibold text-slate-500 mt-0.5">
                      1PM + 6PM + 8PM
                    </div>
                  </div>
                  <div className="kk-surface-card rounded-2xl p-3.5">
                    <div className="text-[11px] font-bold text-slate-500">Gross Bill</div>
                    <div className="text-xl sm:text-2xl font-black font-mono-tabular text-slate-950 mt-0.5">
                      ₹{formatINR(myBill.bill)}
                    </div>
                    <div className="text-[11px] font-semibold font-mono-tabular mt-0.5">
                      <span className="text-slate-500">Fresh: </span>
                      <span
                        className={
                          myBill.fresh > 0
                            ? 'text-emerald-700 font-bold'
                            : myBill.fresh < 0
                              ? 'text-rose-600 font-bold'
                              : 'text-slate-700'
                        }
                      >
                        ₹{formatINR(myBill.fresh)}
                      </span>
                    </div>
                  </div>
                  <div className="kk-surface-card rounded-2xl p-3.5">
                    <div className="text-[11px] font-bold text-slate-500">Prize (-)</div>
                    <div className="text-xl sm:text-2xl font-black font-mono-tabular text-emerald-700 mt-0.5">
                      ₹{formatINR(myBill.prizeTotal)}
                    </div>
                    <div className="text-[11px] font-semibold text-emerald-700 mt-0.5">
                      {hasAnyWinningNumbers ? `${myBill.prizes.length} Wins` : 'Waiting Win #'}
                    </div>
                  </div>
                  <div className="kk-brand-gradient text-white rounded-2xl p-3.5 shadow-md">
                    <div className="text-[11px] font-bold text-indigo-100">Net Total</div>
                    <div
                      className={`text-xl sm:text-2xl font-black font-mono-tabular mt-0.5 ${
                        myBill.total > 0
                          ? 'text-emerald-300'
                          : myBill.total < 0
                            ? 'text-rose-300'
                            : 'text-white'
                      }`}
                    >
                      ₹{formatINR(myBill.total)}
                    </div>
                    <div className="text-[11px] font-semibold text-indigo-100 font-mono-tabular mt-0.5">
                      Joma − / Due +
                    </div>
                  </div>
                </div>

                {/* Detailed Breakdown Card: Time-Wise (1PM/6PM/8PM), Sold, Bill, Prize, Fresh, Joma, Due, Total */}
                <div className="kk-surface-card rounded-2xl overflow-hidden">
                  <div className="kk-table-head text-white px-4 py-3 flex items-center justify-between gap-2">
                    <span className="text-xs sm:text-sm font-extrabold break-words">
                      {myBill.name} — Daily Bill Summary
                    </span>
                    <div className="shrink-0 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={openMyBillCardModal}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold bg-white text-[var(--kk-brand)] rounded-lg cursor-pointer transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Bill Card</span>
                      </button>
                      <button
                        type="button"
                        disabled={sendingMyBillCard}
                        onClick={() => void handleSendMyBillCard()}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg cursor-pointer transition-colors disabled:opacity-60"
                      >
                        {sendingMyBillCard ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Send className="w-3.5 h-3.5" />
                        )}
                        <span>Send Card</span>
                      </button>
                    </div>
                  </div>

                  <div className="p-3.5 sm:p-4 space-y-2.5 font-mono-tabular">
                    {/* Row 1: Time-Wise Sold + Total Sold */}
                    <div className="grid grid-cols-4 gap-2">
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2 sm:p-2.5 text-center">
                        <div className="font-sans text-[10px] font-bold text-amber-800">1PM (MOR)</div>
                        <div className="text-sm sm:text-base font-black text-slate-950 mt-0.5">
                          {formatINR(myBill.mor)}
                        </div>
                        <div className="text-[10px] font-semibold text-emerald-700">
                          ₹{formatINR(myBill.amt1pm)}
                        </div>
                      </div>
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2 sm:p-2.5 text-center">
                        <div className="font-sans text-[10px] font-bold text-sky-800">6PM (DAY)</div>
                        <div className="text-sm sm:text-base font-black text-slate-950 mt-0.5">
                          {formatINR(myBill.day)}
                        </div>
                        <div className="text-[10px] font-semibold text-emerald-700">
                          ₹{formatINR(myBill.amt6pm)}
                        </div>
                      </div>
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2 sm:p-2.5 text-center">
                        <div className="font-sans text-[10px] font-bold text-violet-800">8PM (EVE)</div>
                        <div className="text-sm sm:text-base font-black text-slate-950 mt-0.5">
                          {formatINR(myBill.eve)}
                        </div>
                        <div className="text-[10px] font-semibold text-emerald-700">
                          ₹{formatINR(myBill.amt8pm)}
                        </div>
                      </div>
                      <div className="bg-indigo-50/70 border border-indigo-200/80 rounded-xl p-2 sm:p-2.5 text-center">
                        <div className="font-sans text-[10px] font-bold text-[var(--kk-brand)]">SOLD</div>
                        <div className="text-sm sm:text-base font-black text-[var(--kk-brand)] mt-0.5">
                          {formatINR(myBill.sold)}
                        </div>
                        <div className="text-[10px] font-semibold text-slate-600">
                          ₹{formatINR(myBill.bill)}
                        </div>
                      </div>
                    </div>

                    {/* Row 2: Prize, Fresh, Joma, Due, Total */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-xl p-2.5 text-center">
                        <div className="font-sans text-[10px] font-bold text-emerald-800">PRIZE (-)</div>
                        <div className="text-sm sm:text-base font-black text-emerald-800 mt-0.5">
                          ₹{formatINR(myBill.prizeTotal)}
                        </div>
                      </div>
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-center">
                        <div className="font-sans text-[10px] font-bold text-slate-600">FRESH BILL</div>
                        <div
                          className={`text-sm sm:text-base font-black mt-0.5 ${
                            myBill.fresh > 0
                              ? 'text-emerald-700'
                              : myBill.fresh < 0
                                ? 'text-rose-600'
                                : 'text-slate-950'
                          }`}
                        >
                          ₹{formatINR(myBill.fresh)}
                        </div>
                      </div>
                      <div className="bg-sky-50/70 border border-sky-200/80 rounded-xl p-2.5 text-center">
                        <div className="font-sans text-[10px] font-bold text-sky-900">JOMA (-)</div>
                        <div className="text-sm sm:text-base font-black text-sky-950 mt-0.5">
                          ₹{formatINR(myBill.joma)}
                        </div>
                      </div>
                      <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-2.5 text-center">
                        <div className="font-sans text-[10px] font-bold text-amber-900">DUE (+)</div>
                        <div className="text-sm sm:text-base font-black text-amber-950 mt-0.5">
                          ₹{formatINR(myBill.due)}
                        </div>
                      </div>
                      <div className="col-span-2 sm:col-span-1 bg-indigo-50/90 border border-indigo-200 rounded-xl p-2.5 text-center">
                        <div className="font-sans text-[10px] font-bold text-[var(--kk-brand)]">NET TOTAL</div>
                        <div
                          className={`text-base font-black mt-0.5 ${
                            myBill.total > 0
                              ? 'text-emerald-700'
                              : myBill.total < 0
                                ? 'text-rose-600'
                                : 'text-slate-950'
                          }`}
                        >
                          ₹{formatINR(myBill.total)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="px-4 pb-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1 font-semibold">
                      <Lock className="w-3 h-3 text-slate-400" />
                      {party.parentMasterId
                        ? 'Joma aur Due aapke Master ke dwara update hota hai'
                        : 'Joma aur Due Admin ke dwara update hota hai'}
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(['1PM', '6PM', '8PM'] as SessionId[]).map((sid) => {
                        const locked = isSessionEditLocked(sid);
                        const st = sessionLockMap[sid];
                        return (
                          <button
                            key={sid}
                            type="button"
                            onClick={() => {
                              AppSounds.tap();
                              setActiveTab(sid);
                            }}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold border rounded-lg cursor-pointer ${
                              locked
                                ? 'text-rose-700 bg-rose-50 hover:bg-rose-100 border-rose-200'
                                : st.isClosingSoon && !adminPreviewMode
                                  ? 'text-amber-900 bg-amber-50 hover:bg-amber-100 border-amber-200'
                                  : 'text-[var(--kk-brand)] bg-indigo-50 hover:bg-indigo-100 border-indigo-200'
                            }`}
                          >
                            {locked && <Lock className="w-3 h-3 shrink-0" />}
                            <span>{locked ? `${sid} Band` : `+ ${sid} Entry`}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Agent-Style List-Wise Sub-Sellers Bill Sheet (directly on Bill tab for Master Sellers!) */}
                {isMasterSeller && (
                  <MasterChainTab
                    masterUid={uid}
                    masterParty={effectiveParty}
                    billingDate={effectiveBillingDate}
                    subParties={effectiveSubParties}
                    allChainParties={
                      effectiveAllChainParties.length > 0
                        ? effectiveAllChainParties
                        : effectiveSubParties
                    }
                    subPrivates={subPrivates}
                    subSheets={effectiveSubSheets}
                    subBillsByPartyId={subBillsByPartyId}
                    config={sellerConfig}
                    adminPreviewMode={adminPreviewMode || isArchiveViewMode}
                    onPreviewMessage={(title, subtitle, message, waUrl, billData) =>
                      setPreviewModal({ isOpen: true, title, subtitle, message, waUrl, billData })
                    }
                    billSheetOnly={true}
                    onOpenManageChain={() => setActiveTab('Chain')}
                  />
                )}
              </div>
            )}

            {(activeTab === '1PM' || activeTab === '6PM' || activeTab === '8PM') && (
              <div className="space-y-4">
                {isMasterSeller && (
                  <LiveChainEntriesPanel
                    sessionId={activeTab}
                    chainSheets={effectiveSubSheets}
                    chainParties={
                      effectiveAllChainParties.length > 0
                        ? effectiveAllChainParties
                        : effectiveSubParties
                    }
                    config={sellerConfig}
                    rootMasterPartyId={effectiveParty.partyId}
                    mode="master"
                    defaultExpanded={true}
                  />
                )}
                <SessionSheetView
                  sessionId={activeTab}
                  computation={sessionComputations[activeTab]}
                  rawRows={effectiveEntries[activeTab]}
                  availableNames={[effectiveParty.name]}
                  itemOptions={itemOptions}
                  limitThreshold={limitThreshold}
                  highlightedRowIds={isArchiveViewMode ? [] : recentlyPastedIds[activeTab]}
                  onDismissPasteHighlight={() =>
                    setRecentlyPastedIds((prev) => ({ ...prev, [activeTab]: [] }))
                  }
                  onUpdateRow={(rowId, patch) => handleUpdateSessionRow(activeTab, rowId, patch)}
                  onDeleteRow={(rowId) => handleDeleteSessionRow(activeTab, rowId)}
                  onDeleteRows={(rowIds) => handleDeleteSessionRows(activeTab, rowIds)}
                  onClearCells={(targets) => handleClearSessionCells(activeTab, targets)}
                  onBatchPatchRows={(patches) => handleBatchPatchSessionRows(activeTab, patches)}
                  canUndo={!isArchiveViewMode && sessionHistory[activeTab].undo.length > 0}
                  onUndo={() => handleUndoSession(activeTab)}
                  canRedo={!isArchiveViewMode && sessionHistory[activeTab].redo.length > 0}
                  onRedo={() => handleRedoSession(activeTab)}
                  onAddRows={(count) => {
                    if (isSessionEditLocked(activeTab)) return;
                    pushUndoSnapshot(activeTab, entries[activeTab]);
                    setEntries((prev) => ({
                      ...prev,
                      [activeTab]: [...prev[activeTab], ...createBlankRows(count)],
                    }));
                  }}
                  onQuickAddEntry={(entry) => handleQuickAddEntry(activeTab, entry)}
                  onBulkAddEntries={(bulk, targetId) =>
                    handleBulkAddEntries(activeTab, bulk, targetId)
                  }
                  onClearSession={() => {
                    if (isSessionEditLocked(activeTab)) return;
                    pushUndoSnapshot(activeTab, entries[activeTab]);
                    setRecentlyPastedIds((prev) => ({ ...prev, [activeTab]: [] }));
                    const keptAdminRows = adminPreviewMode
                      ? []
                      : entries[activeTab].filter((r) => r.id.startsWith('admin::'));
                    commitSessionRows(activeTab, keptAdminRows);
                  }}
                  onPreviewMessage={(title, subtitle, message, waUrl) =>
                    setPreviewModal({ isOpen: true, title, subtitle, message, waUrl })
                  }
                  lockedPartyName={effectiveParty.name}
                  hideLimitDispatch={true}
                  readOnly={isSessionEditLocked(activeTab)}
                  lockNotice={renderSessionLockNotice(activeTab)}
                />
              </div>
            )}

            {activeTab === 'Prize List' && (
              <div className="space-y-4">
                {!hasAnyWinningNumbers ? (
                  <div className="kk-surface-card rounded-2xl p-8 text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
                      <Trophy className="w-6 h-6" />
                    </div>
                    <div className="space-y-1 max-w-md mx-auto">
                      <h2 className="text-sm sm:text-base font-black text-slate-950">
                        Winning Numbers Pending
                      </h2>
                      <p className="text-xs font-medium text-slate-600 leading-relaxed">
                        {isArchiveViewMode
                          ? 'Is archived date me koi winning number ya prize record nahi tha.'
                          : 'Admin abhi Winning Number enter nahi kiye hain. Jaise hi Admin Winning Number daalenge, aapki 1PM, 6PM aur 8PM Prize List yahan turant live dikh jayegi.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <PrizeListView
                    date={effectiveBillingDate}
                    prizeList={prizeList}
                    sellers={sellerList}
                    excludedNames={excludedNames}
                    onPreviewMessage={(title, subtitle, message, waUrl) =>
                      setPreviewModal({ isOpen: true, title, subtitle, message, waUrl })
                    }
                  />
                )}
              </div>
            )}
            {activeTab === 'Chain' && isMasterSeller && (
              <MasterChainTab
                masterUid={uid}
                masterParty={effectiveParty}
                billingDate={effectiveBillingDate}
                subParties={effectiveSubParties}
                allChainParties={
                  effectiveAllChainParties.length > 0
                    ? effectiveAllChainParties
                    : effectiveSubParties
                }
                subPrivates={subPrivates}
                subSheets={effectiveSubSheets}
                subBillsByPartyId={subBillsByPartyId}
                config={sellerConfig}
                adminPreviewMode={adminPreviewMode || isArchiveViewMode}
                onPreviewMessage={(title, subtitle, message, waUrl, billData) =>
                  setPreviewModal({ isOpen: true, title, subtitle, message, waUrl, billData })
                }
              />
            )}
            {activeTab === 'Archive' && (
              <div className="space-y-3">
                {archiveToast && (
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-2xl px-3.5 py-2.5 text-xs font-bold shadow-xs">
                    {archiveToast}
                  </div>
                )}
                <ArchiveView
                  billingDate={billingDate}
                  snapshots={partyArchives}
                  recycleBin={partyRecycleBin}
                  onArchiveNow={() => void handleSavePartyArchive()}
                  onRestoreSnapshot={handleRestorePartySnapshot}
                  onUpdateSnapshotDate={(id, nextDate) => void handleUpdatePartyArchiveDate(id, nextDate)}
                  onDeleteSnapshot={(id) => void handleDeletePartyArchive(id)}
                  onRecoverFromBin={(id) => void handleRecoverPartyArchiveFromBin(id)}
                  onPermanentDeleteFromBin={handlePermanentDeletePartyFromBin}
                  onEmptyRecycleBin={handleEmptyPartyRecycleBin}
                  title={`${party.name} — Daily Archive (${partyArchives.length})`}
                  partyOwnerName={party.name}
                  subtitle={
                    isMasterSeller && subParties.length > 0
                      ? 'Har din ka Bill, 1PM/6PM/8PM Sheet, Sub-Sellers aur Prize snapshot safe rehta hai (30 days history). Restore dabakar kisi bhi purane din ka poora details dekh sakte hain.'
                      : 'Aapka roz ka Bill, 1PM/6PM/8PM Sheet aur Prize record yahan 30 din tak safe rehta hai. Restore dabakar kisi bhi din ka poora details dekh sakte hain.'
                  }
                  archiveButtonLabel={archiveBusy ? 'Saving...' : 'Save Archive'}
                  secondaryActionLabel={
                    isMasterSeller && subParties.length > 0 && !adminPreviewMode
                      ? 'Archive & Carry Due/Joma'
                      : undefined
                  }
                  onSecondaryAction={
                    isMasterSeller && subParties.length > 0 && !adminPreviewMode
                      ? () => void handleArchiveAndCarryForwardSubs()
                      : undefined
                  }
                  hideRestore={false}
                  hideLimitPrize={true}
                />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        </div>
      </main>

      {/* Executive Seller Bottom Tab Bar (Solid, Zero Blur, Flex-Docked Edge-to-Edge) */}
      <nav
        aria-label="Seller mobile navigation"
        className={`shrink-0 z-30 bg-white border-t border-slate-200/90 shadow-[0_-4px_18px_rgba(15,36,96,0.08)] px-1 pt-1.5 pb-[max(0.65rem,env(safe-area-inset-bottom))] grid gap-0.5 ${
          isMasterSeller ? 'grid-cols-7' : 'grid-cols-6'
        }`}
      >
        {(isMasterSeller
          ? [
              ...SELLER_NAV_ITEMS,
              { id: 'Chain' as SellerTab, label: 'Sub-IDs Chain', shortLabel: 'Chain', icon: Users },
              { id: 'Archive' as SellerTab, label: 'Daily Archive', shortLabel: 'Archive', icon: Archive },
            ]
          : [
              ...SELLER_NAV_ITEMS,
              { id: 'Archive' as SellerTab, label: 'Daily Archive', shortLabel: 'Archive', icon: Archive },
            ]
        ).map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const hasPrizeDot = item.id === 'Prize List' && prizeList.length > 0;
          const isLockedSessionTab =
            (item.id === '1PM' || item.id === '6PM' || item.id === '8PM') &&
            isSessionEditLocked(item.id);
          return (
            <motion.button
              key={item.id}
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={() => {
                AppSounds.tap();
                setActiveTab(item.id);
              }}
              className={`relative min-w-0 flex flex-col items-center justify-center py-2 px-1 rounded-2xl transition-colors cursor-pointer ${
                isActive ? 'text-white' : 'text-slate-600 hover:bg-slate-100/90 hover:text-slate-950'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="sellerMobileTabBg"
                  transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                  aria-hidden="true"
                  className="absolute inset-0 kk-brand-gradient rounded-2xl shadow-[0_4px_14px_rgba(15,36,96,0.32)]"
                />
              )}
              {hasPrizeDot && (
                <span
                  aria-hidden="true"
                  className={`absolute top-1.5 right-2.5 z-20 w-2 h-2 rounded-full bg-emerald-500 ring-2 ${
                    isActive ? 'ring-[var(--kk-brand)]' : 'ring-white'
                  }`}
                />
              )}
              {isLockedSessionTab && (
                <span
                  aria-label={`${item.shortLabel} locked`}
                  className={`absolute top-1 right-1.5 z-20 w-4 h-4 rounded-full flex items-center justify-center ring-1 ${
                    isActive
                      ? 'bg-rose-500 text-white ring-white/80'
                      : 'bg-rose-100 text-rose-700 ring-rose-200'
                  }`}
                >
                  <Lock className="w-2.5 h-2.5" />
                </span>
              )}
              <Icon
                className="relative z-10 w-[21px] h-[21px] shrink-0"
                strokeWidth={isActive ? 2.35 : 1.95}
                aria-hidden="true"
              />
              <span
                className={`relative z-10 text-[11px] leading-none mt-1.5 whitespace-nowrap ${
                  isActive ? 'font-extrabold text-white' : 'font-bold'
                }`}
              >
                {item.shortLabel}
              </span>
            </motion.button>
          );
        })}
      </nav>

      <MessagePreviewModal
        isOpen={previewModal.isOpen}
        title={previewModal.title}
        subtitle={previewModal.subtitle}
        message={previewModal.message}
        waUrl={previewModal.waUrl}
        billData={previewModal.billData}
        onClose={() => setPreviewModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
