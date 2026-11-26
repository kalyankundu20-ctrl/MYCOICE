import {
  AlertTriangle,
  ArrowDown,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  Eraser,
  LayoutGrid,
  Pencil,
  Plus,
  Redo2,
  Scissors,
  Search,
  Table2,
  Trash2,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  formatINR,
  formatSessionRowsForCopy,
  pad5,
  parsePastedTicketText,
} from '../engine/calculations';
import {
  ComputedTicketRow,
  SessionComputation,
  SessionId,
  TicketEntryRow,
} from '../types/ledger';
import { AppSounds } from '../utils/sound';

type EditableColKey = 'name' | 'item' | 'start' | 'end' | 'qtyOverride';
const EDITABLE_COLS: EditableColKey[] = [
  'name',
  'item',
  'start',
  'end',
  'qtyOverride',
];

interface CellCoord {
  rowIdx: number;
  colIdx: number;
}

interface RowMetric {
  rowIdx: number;
  top: number;
  bottom: number;
}

interface ColMetric {
  colIdx: number;
  left: number;
  right: number;
}

interface SheetGeometry {
  rows: RowMetric[];
  cols: ColMetric[];
}

interface OverlayBoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function computeBoxFromGeometry(
  geom: SheetGeometry,
  anchor: CellCoord,
  focus: CellCoord
): OverlayBoxRect | null {
  const minRow = Math.min(anchor.rowIdx, focus.rowIdx);
  const maxRow = Math.max(anchor.rowIdx, focus.rowIdx);
  const minCol = Math.min(anchor.colIdx, focus.colIdx);
  const maxCol = Math.max(anchor.colIdx, focus.colIdx);
  const topRow = geom.rows[minRow];
  const bottomRow = geom.rows[maxRow];
  const leftCol = geom.cols[minCol];
  const rightCol = geom.cols[maxCol];
  if (!topRow || !bottomRow || !leftCol || !rightCol) return null;
  return {
    left: leftCol.left,
    top: topRow.top,
    width: Math.max(4, rightCol.right - leftCol.left),
    height: Math.max(4, bottomRow.bottom - topRow.top),
  };
}

interface SessionSheetViewProps {
  sessionId: SessionId;
  computation: SessionComputation;
  rawRows: TicketEntryRow[];
  availableNames: string[];
  itemOptions: string[];
  limitThreshold: number;
  highlightedRowIds?: string[];
  onDismissPasteHighlight?: () => void;
  canUndo: boolean;
  onUndo: () => void;
  canRedo: boolean;
  onRedo: () => void;
  onUpdateRow: (rowId: string, patch: Partial<TicketEntryRow>) => void;
  onDeleteRow: (rowId: string) => void;
  onDeleteRows: (rowIds: string[]) => void;
  onClearCells: (targets: Array<{ rowId: string; fields: EditableColKey[] }>) => void;
  onBatchPatchRows: (patches: Array<{ rowId: string; patch: Partial<TicketEntryRow> }>) => void;
  onAddRows: (count: number) => void;
  onQuickAddEntry: (entry: Omit<TicketEntryRow, 'id'>) => void;
  onBulkAddEntries: (entries: Array<Omit<TicketEntryRow, 'id'>>, targetRowId?: string) => void;
  onClearSession: () => void;
  onPreviewMessage: (title: string, subtitle: string, message: string, waUrl: string) => void;
  lockedPartyName?: string;
  hideLimitDispatch?: boolean;
  readOnly?: boolean;
  lockNotice?: ReactNode;
}

const SESSION_ACCENT: Record<
  SessionId,
  { badgeBg: string; badgeText: string; label: string }
> = {
  '1PM': {
    badgeBg: 'bg-amber-400/20 border-amber-300/40',
    badgeText: 'text-amber-200',
    label: '1PM Morning',
  },
  '6PM': {
    badgeBg: 'bg-sky-400/20 border-sky-300/40',
    badgeText: 'text-sky-200',
    label: '6PM Day',
  },
  '8PM': {
    badgeBg: 'bg-violet-400/20 border-violet-300/40',
    badgeText: 'text-violet-200',
    label: '8PM Evening',
  },
};

export function SessionSheetView({
  sessionId,
  computation,
  availableNames,
  itemOptions,
  limitThreshold,
  highlightedRowIds,
  onDismissPasteHighlight,
  canUndo,
  onUndo,
  canRedo,
  onRedo,
  onUpdateRow,
  onDeleteRow,
  onDeleteRows,
  onClearCells,
  onBatchPatchRows,
  onAddRows,
  onQuickAddEntry,
  onBulkAddEntries,
  onClearSession,
  lockedPartyName,
  hideLimitDispatch = false,
  readOnly = false,
  lockNotice,
}: SessionSheetViewProps) {
  // Default to fit-to-screen table so ALL columns are visible on ONE screen with zero horizontal scroll!
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'all' | 'overlimit'>('all');
  const [confirmClear, setConfirmClear] = useState(false);
  const [inspectedOverLimitRow, setInspectedOverLimitRow] =
    useState<ComputedTicketRow | null>(null);
  const [pendingDeleteConfirm, setPendingDeleteConfirm] = useState<{
    mode: 'single' | 'bulk';
    rowIds: string[];
    summary: string;
  } | null>(null);

  // Google Sheets-style Selection State
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [rangeSelectMode, setRangeSelectMode] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditValue, setBulkEditValue] = useState('');
  const lastCheckedIdxRef = useRef<number | null>(null);
  const [rangeAnchor, setRangeAnchor] = useState<CellCoord | null>(null);
  const [rangeFocus, setRangeFocus] = useState<CellCoord | null>(null);
  const rangeAnchorRef = useRef<CellCoord | null>(null);
  const rangeFocusRef = useRef<CellCoord | null>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const cardListRef = useRef<HTMLDivElement>(null);
  const selectionBoxRef = useRef<HTMLDivElement>(null);
  const dragGeometryRef = useRef<SheetGeometry | null>(null);
  const [overlayRect, setOverlayRect] = useState<OverlayBoxRect | null>(null);
  const isMouseDraggingRef = useRef(false);
  const isHandleDraggingRef = useRef(false);
  const [isTouchDragging, setIsTouchDragging] = useState(false);
  const suppressFocusAnchorRef = useRef(false);
  const lastTouchInteractionAtRef = useRef<number>(0);
  const longPressTimerRef = useRef<number | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastTouchPointRef = useRef<{ x: number; y: number } | null>(null);
  const dragMetaRef = useRef<{
    anchorRow: number;
    anchorCol: number;
    startFocusCol: number;
    startX: number;
    startY: number;
    grabOffsetX: number;
    grabOffsetY: number;
    singleColLock: boolean;
    hasMoved: boolean;
  } | null>(null);

  rangeAnchorRef.current = rangeAnchor;
  rangeFocusRef.current = rangeFocus;

  const captureSheetGeometry = useCallback((): SheetGeometry | null => {
    const container = tableContainerRef.current;
    const tbody = tbodyRef.current;
    if (!container || !tbody) return null;
    const containerRect = container.getBoundingClientRect();
    const rowEls = tbody.querySelectorAll<HTMLTableRowElement>('tr[data-row-idx]');
    if (rowEls.length === 0) return null;

    const rows: RowMetric[] = [];
    for (let i = 0; i < rowEls.length; i++) {
      const tr = rowEls[i];
      const r = tr.getBoundingClientRect();
      rows.push({
        rowIdx: Number(tr.dataset.rowIdx),
        top: r.top - containerRect.top,
        bottom: r.bottom - containerRect.top,
      });
    }

    const firstRow = rowEls[0];
    const cols: ColMetric[] = [];
    for (let c = 0; c < EDITABLE_COLS.length; c++) {
      const td = firstRow.querySelector<HTMLElement>(`td[data-cell-col="${c}"]`);
      if (!td) continue;
      const r = td.getBoundingClientRect();
      cols.push({
        colIdx: c,
        left: r.left - containerRect.left,
        right: r.right - containerRect.left,
      });
    }
    if (cols.length === 0) return null;
    return { rows, cols };
  }, []);

  // Copy & Paste State
  const [pastePanelOpen, setPastePanelOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [copiedBanner, setCopiedBanner] = useState(false);
  const [pasteFeedback, setPasteFeedback] = useState('');
  const pasteTextareaRef = useRef<HTMLTextAreaElement>(null);

  const sessionPrefix =
    (computation.prefix || (sessionId === '1PM' ? 'M' : sessionId === '6PM' ? 'D' : 'E'))
      .trim()
      .toUpperCase() || 'M';
  const sessionDefaultItem = `${sessionPrefix}5`;
  const sessionItemOptions = useMemo(() => {
    const primary = ['5', '10', '15', '20'].map((n) => `${sessionPrefix}${n}`);
    const extras = itemOptions
      .map((opt) => opt.trim().toUpperCase())
      .filter(
        (opt) =>
          opt.startsWith(sessionPrefix) &&
          !primary.includes(opt) &&
          !/^S\d+$/i.test(opt)
      );
    return [...primary, ...extras];
  }, [itemOptions, sessionPrefix]);

  // Quick Entry Bar State
  const [qName, setQName] = useState(lockedPartyName || '');
  const [qItem, setQItem] = useState(sessionDefaultItem);
  const [qStart, setQStart] = useState('');
  const [qEnd, setQEnd] = useState('');
  const quickStartRef = useRef<HTMLInputElement>(null);
  const quickEndRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (lockedPartyName) {
      setQName(lockedPartyName);
    }
  }, [lockedPartyName]);

  // Clear stale selection and column filter when switching between 1PM / 6PM / 8PM
  useEffect(() => {
    setQItem(sessionDefaultItem);
    setSelectedRowIds(new Set());
    setRangeSelectMode(false);
    setBulkEditOpen(false);
    setBulkEditValue('');
    setRangeAnchor(null);
    setRangeFocus(null);
    lastCheckedIdxRef.current = null;
  }, [sessionId, sessionDefaultItem]);

  useEffect(() => {
    let dragRaf: number | null = null;

    const stopDragRaf = () => {
      if (dragRaf !== null) {
        window.cancelAnimationFrame(dragRaf);
        dragRaf = null;
      }
    };

    const cancelLongPress = () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      touchStartPosRef.current = null;
    };

    const resolveRowFromLocalY = (
      rows: RowMetric[],
      effY: number,
      currRowIdx: number
    ): number => {
      const last = rows.length - 1;
      if (last <= 0) return 0;
      const clampedCurr = Math.max(0, Math.min(last, currRowIdx));
      const currMetric = rows[clampedCurr];
      // 5px hysteresis band around current row stops micro-tremor jitter at borders
      if (effY >= currMetric.top - 5 && effY <= currMetric.bottom + 5) {
        return clampedCurr;
      }
      if (effY <= rows[0].top) return 0;
      if (effY >= rows[last].bottom) return last;

      // Binary search over monotonically increasing row tops
      let lo = 0;
      let hi = last;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const m = rows[mid];
        if (effY < m.top) {
          hi = mid - 1;
        } else if (effY > m.bottom) {
          lo = mid + 1;
        } else {
          return mid;
        }
      }
      return Math.max(0, Math.min(last, lo));
    };

    const resolveColFromLocalX = (
      cols: ColMetric[],
      effX: number,
      currColIdx: number
    ): number => {
      const last = cols.length - 1;
      if (last <= 0) return 0;
      const clampedCurr = Math.max(0, Math.min(last, currColIdx));
      const currMetric = cols[clampedCurr];
      if (effX >= currMetric.left - 6 && effX <= currMetric.right + 6) {
        return clampedCurr;
      }
      if (effX <= cols[0].left) return 0;
      if (effX >= cols[last].right) return last;
      for (let i = 0; i < cols.length; i++) {
        if (effX <= cols[i].right) return i;
      }
      return last;
    };

    const stepDragFrame = () => {
      dragRaf = null;
      if (!isHandleDraggingRef.current && !isMouseDraggingRef.current) return;
      const pt = lastTouchPointRef.current;
      const container = tableContainerRef.current;
      const geom = dragGeometryRef.current;
      const meta = dragMetaRef.current;
      const anchor = rangeAnchorRef.current;
      if (!pt || !container || !geom || !meta || !anchor) return;

      const { x, y } = pt;
      const containerRect = container.getBoundingClientRect();
      const localX = x - containerRect.left;
      const localY = y - containerRect.top;

      if (!meta.hasMoved) {
        if (Math.hypot(x - meta.startX, y - meta.startY) >= 5) {
          meta.hasMoved = true;
        }
      }

      if (meta.hasMoved) {
        const effX = localX - meta.grabOffsetX;
        const effY = localY - meta.grabOffsetY;
        const currFocus = rangeFocusRef.current || {
          rowIdx: meta.anchorRow,
          colIdx: meta.startFocusCol,
        };

        const targetRow = resolveRowFromLocalY(geom.rows, effY, currFocus.rowIdx);

        let targetCol = meta.startFocusCol;
        const startColMetric = geom.cols[meta.startFocusCol];
        if (meta.singleColLock && startColMetric) {
          // Generous +-24px corridor around the starting column so vertical thumb drag never jumps sideways
          const withinCorridor =
            effX >= startColMetric.left - 24 && effX <= startColMetric.right + 24;
          if (!withinCorridor && Math.abs(x - meta.startX) >= 30) {
            targetCol = resolveColFromLocalX(geom.cols, effX, currFocus.colIdx);
          }
        } else {
          targetCol = resolveColFromLocalX(geom.cols, effX, currFocus.colIdx);
        }

        if (targetRow !== currFocus.rowIdx || targetCol !== currFocus.colIdx) {
          const nextFocus = { rowIdx: targetRow, colIdx: targetCol };
          rangeFocusRef.current = nextFocus;

          // Instantaneous GPU-composited DOM box move before React even reconciles
          const boxEl = selectionBoxRef.current;
          const nextBox = computeBoxFromGeometry(geom, anchor, nextFocus);
          if (boxEl && nextBox) {
            boxEl.style.transform = `translate3d(${nextBox.left}px, ${nextBox.top}px, 0)`;
            boxEl.style.width = `${nextBox.width}px`;
            boxEl.style.height = `${nextBox.height}px`;
          }

          setRangeFocus(nextFocus);
        }
      }

      // Smooth phase-locked edge auto-scroll in the exact same 60fps RAF loop
      const bottomEdge = window.innerHeight - 132;
      const topEdge = 92;
      let scrollDelta = 0;

      if (y > bottomEdge) {
        const ratio = Math.min(1, (y - bottomEdge) / 88);
        scrollDelta = Math.round(2 + ratio * ratio * 13);
      } else if (y < topEdge) {
        const ratio = Math.min(1, (topEdge - y) / 76);
        scrollDelta = -Math.round(2 + ratio * ratio * 13);
      }

      if (scrollDelta !== 0) {
        const scrollRoot = tableContainerRef.current?.closest(
          '[data-kk-scroll-root="true"]'
        ) as HTMLElement | null;
        if (scrollRoot) {
          scrollRoot.scrollTop += scrollDelta;
        } else {
          window.scrollBy(0, scrollDelta);
        }
        dragRaf = window.requestAnimationFrame(stepDragFrame);
      }
    };

    const scheduleDragFrame = (x: number, y: number) => {
      lastTouchPointRef.current = { x, y };
      if (dragRaf === null) {
        dragRaf = window.requestAnimationFrame(stepDragFrame);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isHandleDraggingRef.current && !isMouseDraggingRef.current) return;
      scheduleDragFrame(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      if (isHandleDraggingRef.current) {
        e.preventDefault();
        scheduleDragFrame(touch.clientX, touch.clientY);
        return;
      }
      if (touchStartPosRef.current && longPressTimerRef.current !== null) {
        const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
        const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);
        if (dx > 7 || dy > 7) {
          cancelLongPress();
        }
      }
    };

    const handleEnd = (e?: Event) => {
      if (e && e.type.startsWith('touch')) {
        lastTouchInteractionAtRef.current = performance.now();
      }
      const wasDragging = isHandleDraggingRef.current || isMouseDraggingRef.current;
      cancelLongPress();
      stopDragRaf();
      isMouseDraggingRef.current = false;
      isHandleDraggingRef.current = false;
      dragMetaRef.current = null;
      dragGeometryRef.current = null;
      lastTouchPointRef.current = null;
      document.documentElement.style.overscrollBehaviorY = '';
      if (wasDragging) {
        suppressFocusAnchorRef.current = true;
        window.setTimeout(() => {
          suppressFocusAnchorRef.current = false;
        }, 320);
        setIsTouchDragging(false);
      } else {
        suppressFocusAnchorRef.current = false;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchend', handleEnd);
    window.addEventListener('touchcancel', handleEnd);
    return () => {
      cancelLongPress();
      stopDragRaf();
      document.documentElement.style.overscrollBehaviorY = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchend', handleEnd);
      window.removeEventListener('touchcancel', handleEnd);
    };
  }, []);

  // Play limit alert sound if over-limit total rises
  const prevOverLimitRef = useRef(computation.overLimitTotal);
  useEffect(() => {
    if (computation.overLimitTotal > prevOverLimitRef.current) {
      AppSounds.limitAlert();
    }
    prevOverLimitRef.current = computation.overLimitTotal;
  }, [computation.overLimitTotal]);

  const theme = SESSION_ACCENT[sessionId];

  const parsedPasteRows = useMemo(
    () =>
      parsePastedTicketText(pasteText, {
        defaultName: qName,
        defaultItem: qItem,
        knownNames: availableNames,
      }),
    [pasteText, qName, qItem, availableNames]
  );

  const showPasteNotice = useCallback((msg: string) => {
    setPasteFeedback(msg);
    window.setTimeout(() => {
      setPasteFeedback((curr) => (curr === msg ? '' : curr));
    }, 2800);
  }, []);

  const focusField = (selector: string) => {
    const immediate = document.querySelector<HTMLInputElement>(selector);
    if (immediate) {
      immediate.focus();
      return;
    }
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(selector);
      el?.focus();
    });
  };

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    if (!qStart.trim()) return;
    AppSounds.add();
    onQuickAddEntry({
      name: qName,
      item: qItem.trim().toUpperCase() || sessionDefaultItem,
      start: qStart.trim(),
      end: qEnd.trim(),
      qtyOverride: '',
      rangeOverride: '',
    });
    setQStart('');
    setQEnd('');
    quickStartRef.current?.focus();
  };

  const handlePasteFromClipboard = async () => {
    if (readOnly) return;
    AppSounds.tap();
    try {
      const clip = await navigator.clipboard.readText();
      if (clip && clip.trim()) {
        setPasteText(clip);
        return;
      }
    } catch {
      // Clipboard read blocked in iframe/browser — focus textarea for native paste
    }
    pasteTextareaRef.current?.focus();
  };

  const handleApplyBulkPaste = () => {
    if (readOnly) return;
    if (parsedPasteRows.length === 0) return;
    AppSounds.success();
    const targetId =
      selectedRowIds.size === 1 ? Array.from(selectedRowIds)[0] : undefined;
    onBulkAddEntries(parsedPasteRows, targetId);
    showPasteNotice(`Added ${parsedPasteRows.length} rows to ${sessionId}`);
    setPasteText('');
    setPastePanelOpen(false);
  };

  const writeClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }, []);

  const trimmedSearch = searchQuery.trim();
  const isNumberSearch = /^\d{1,5}$/.test(trimmedSearch);

  const rowMatchesNumberQuery = useCallback((r: ComputedTicketRow, q: string): boolean => {
    if (r.start.toLowerCase().includes(q) || r.end.toLowerCase().includes(q)) {
      return true;
    }
    // Also match middle numbers within the row's Start..End ticket range (e.g. searching 31857 matches 31855-59)
    if (/^\d{2,5}$/.test(q) && r.startNumInt !== null && r.rangeEndInt !== null) {
      const numQuery = parseInt(q, 10);
      if (q.length === 5) {
        return numQuery >= r.startNumInt && numQuery <= r.rangeEndInt;
      }
      if (r.rangeEndInt - r.startNumInt <= 1000) {
        for (let n = r.startNumInt; n <= r.rangeEndInt; n++) {
          if (pad5(n).includes(q)) return true;
        }
      } else {
        const mod = Math.pow(10, q.length);
        for (let n = r.startNumInt; n <= r.rangeEndInt; n++) {
          if (n % mod === numQuery) return true;
        }
      }
    }
    return false;
  }, []);

  const filteredRows = useMemo(
    () =>
      computation.rows.filter((r) => {
        if (
          statusFilter === 'overlimit' &&
          r.statusType !== 'overlimit' &&
          !(r.overLimitBreakdowns && r.overLimitBreakdowns.length > 0)
        ) {
          return false;
        }
        // On numeric search (e.g. 86307), keep ALL surrounding rows (upar & niche) visible
        // and scroll the matched number directly to the first visible row!
        if (!trimmedSearch || isNumberSearch) return true;
        const q = trimmedSearch.toLowerCase();
        const textMatch =
          r.resolvedName.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.item.toLowerCase().includes(q) ||
          r.start.toLowerCase().includes(q) ||
          r.end.toLowerCase().includes(q) ||
          r.limitStatus.toLowerCase().includes(q);

        return textMatch;
      }),
    [computation.rows, statusFilter, trimmedSearch, isNumberSearch]
  );

  const matchedRowIndices = useMemo(() => {
    if (!isNumberSearch) return [] as number[];
    const q = trimmedSearch.toLowerCase();
    const indices: number[] = [];
    for (let i = 0; i < filteredRows.length; i++) {
      if (rowMatchesNumberQuery(filteredRows[i], q)) {
        indices.push(i);
      }
    }
    return indices;
  }, [isNumberSearch, trimmedSearch, filteredRows, rowMatchesNumberQuery]);

  const matchedRowIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const idx of matchedRowIndices) {
      const row = filteredRows[idx];
      if (row) set.add(row.id);
    }
    return set;
  }, [matchedRowIndices, filteredRows]);

  const safeMatchIdx =
    matchedRowIndices.length > 0 ? Math.min(activeMatchIdx, matchedRowIndices.length - 1) : 0;
  const activeMatchVisibleIdx =
    matchedRowIndices.length > 0 ? matchedRowIndices[safeMatchIdx] : -1;
  const activeMatchedRowId =
    activeMatchVisibleIdx >= 0 ? filteredRows[activeMatchVisibleIdx]?.id ?? null : null;
  const aboveMatchCount = activeMatchVisibleIdx >= 0 ? activeMatchVisibleIdx : 0;
  const belowMatchCount =
    activeMatchVisibleIdx >= 0 ? Math.max(0, filteredRows.length - 1 - activeMatchVisibleIdx) : 0;

  useEffect(() => {
    setActiveMatchIdx(0);
  }, [trimmedSearch, statusFilter]);

  const scrollMatchedRowIntoPosition = useCallback(
    (peekAboveRows = 0, smooth = false) => {
      if (!isNumberSearch || !activeMatchedRowId) return;
      if (viewMode === 'table') {
        const scrollEl = tableScrollRef.current;
        const tbodyEl = tbodyRef.current;
        if (!scrollEl || !tbodyEl) return;
        const tr = tbodyEl.querySelector<HTMLTableRowElement>(
          `tr[data-row-id="${activeMatchedRowId}"]`
        );
        if (!tr) return;
        const theadHeight = theadRef.current?.getBoundingClientRect().height ?? 0;
        const scrollRect = scrollEl.getBoundingClientRect();
        const trRect = tr.getBoundingClientRect();
        const rowHeight = Math.max(trRect.height, 40);
        const targetTop =
          trRect.top - scrollRect.top + scrollEl.scrollTop - theadHeight - peekAboveRows * rowHeight;
        scrollEl.scrollTo({
          top: Math.max(0, targetTop),
          behavior: smooth ? 'smooth' : 'auto',
        });
      } else {
        const cardEl = cardListRef.current?.querySelector<HTMLElement>(
          `[data-card-row-id="${activeMatchedRowId}"]`
        );
        cardEl?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
      }
    },
    [isNumberSearch, activeMatchedRowId, viewMode]
  );

  useEffect(() => {
    if (!isNumberSearch || !activeMatchedRowId) return;
    const raf = window.requestAnimationFrame(() => {
      scrollMatchedRowIntoPosition(0, false);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isNumberSearch, activeMatchedRowId, viewMode, trimmedSearch, scrollMatchedRowIntoPosition]);

  // Normalized rectangular cell selection bounds (when >= 2 cells or Shift/Drag selected)
  const cellRangeBounds = useMemo(() => {
    if (!rangeAnchor || !rangeFocus) return null;
    const minRow = Math.min(rangeAnchor.rowIdx, rangeFocus.rowIdx);
    const maxRow = Math.max(rangeAnchor.rowIdx, rangeFocus.rowIdx);
    const minCol = Math.min(rangeAnchor.colIdx, rangeFocus.colIdx);
    const maxCol = Math.max(rangeAnchor.colIdx, rangeFocus.colIdx);
    const cellCount = (maxRow - minRow + 1) * (maxCol - minCol + 1);
    return { minRow, maxRow, minCol, maxCol, cellCount };
  }, [rangeAnchor, rangeFocus]);

  const hasMultiCellRange = Boolean(cellRangeBounds && cellRangeBounds.cellCount > 1);
  const hasSelection = selectedRowIds.size > 0 || hasMultiCellRange;

  // Live Google Sheets-style calculation over selected cells or checked rows
  const selectionCalc = useMemo(() => {
    if (selectedRowIds.size > 0) {
      const nums: number[] = [];
      let excludedRows = 0;
      for (const row of filteredRows) {
        if (!selectedRowIds.has(row.id)) continue;
        if (row.isExcludedFromCount) {
          excludedRows++;
          continue;
        }
        const qVal = row.qtyOverride !== '' ? Number(row.qtyOverride) : row.qty;
        if (Number.isFinite(qVal)) {
          nums.push(qVal);
        }
      }
      const sum = nums.reduce((a, b) => a + b, 0);
      const avg = nums.length > 0 ? sum / nums.length : 0;
      const max = nums.length > 0 ? Math.max(...nums) : 0;
      const min = nums.length > 0 ? Math.min(...nums) : 0;
      return {
        mode: 'rows' as const,
        count: selectedRowIds.size,
        numericCount: nums.length,
        excludedRows,
        sum: Math.round(sum * 100) / 100,
        avg: Math.round(avg * 100) / 100,
        max: Math.round(max * 100) / 100,
        min: Math.round(min * 100) / 100,
        canFillDown: false,
      };
    }

    if (!cellRangeBounds) return null;

    const nums: number[] = [];
    let nonEmptyCells = 0;
    let excludedRows = 0;

    for (let r = cellRangeBounds.minRow; r <= cellRangeBounds.maxRow; r++) {
      const row = filteredRows[r];
      if (!row) continue;
      if (row.isExcludedFromCount) {
        excludedRows++;
      }
      for (let c = cellRangeBounds.minCol; c <= cellRangeBounds.maxCol; c++) {
        if (c === 4) {
          if (row.isExcludedFromCount) continue;
          const v = row.qtyOverride !== '' ? Number(row.qtyOverride) : row.qty;
          const numericVal = Number.isFinite(v) ? v : 0;
          nums.push(numericVal);
          nonEmptyCells++;
        } else if (c === 2 || c === 3) {
          const raw = c === 2 ? row.start.trim() : row.end.trim();
          if (raw !== '' && !Number.isNaN(Number(raw))) {
            nums.push(Number(raw));
            nonEmptyCells++;
          }
        } else if (c === 0 || c === 1) {
          const raw = c === 0 ? (row.name.trim() || row.resolvedName.trim()) : row.item.trim();
          if (raw !== '') nonEmptyCells++;
        }
      }
    }

    const sum = nums.reduce((a, b) => a + b, 0);
    const avg = nums.length > 0 ? sum / nums.length : 0;
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    const min = nums.length > 0 ? Math.min(...nums) : 0;

    return {
      mode: 'cells' as const,
      count: cellRangeBounds.cellCount,
      nonEmptyCells,
      numericCount: nums.length,
      excludedRows,
      sum: Math.round(sum * 100) / 100,
      avg: Math.round(avg * 100) / 100,
      max: Math.round(max * 100) / 100,
      min: Math.round(min * 100) / 100,
      canFillDown: cellRangeBounds.maxRow > cellRangeBounds.minRow,
    };
  }, [selectedRowIds, filteredRows, cellRangeBounds]);

  // Keep persistent single-box Google Sheets overlay synced to table row/column geometry
  useLayoutEffect(() => {
    if (!cellRangeBounds || !rangeAnchor || !rangeFocus || viewMode !== 'table') {
      setOverlayRect(null);
      return;
    }
    const geom = dragGeometryRef.current || captureSheetGeometry();
    if (!geom) {
      setOverlayRect(null);
      return;
    }
    const box = computeBoxFromGeometry(geom, rangeAnchor, rangeFocus);
    setOverlayRect(box);
  }, [cellRangeBounds, rangeAnchor, rangeFocus, filteredRows, viewMode, captureSheetGeometry]);

  useEffect(() => {
    if (!cellRangeBounds || viewMode !== 'table') return;
    const container = tableContainerRef.current;
    if (!container) return;

    const refreshRect = () => {
      if (isHandleDraggingRef.current || isMouseDraggingRef.current) return;
      const anchor = rangeAnchorRef.current;
      const focus = rangeFocusRef.current;
      if (!anchor || !focus) return;
      const geom = captureSheetGeometry();
      if (!geom) return;
      setOverlayRect(computeBoxFromGeometry(geom, anchor, focus));
    };

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(refreshRect);
      ro.observe(container);
    }
    window.addEventListener('resize', refreshRect);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', refreshRect);
    };
  }, [cellRangeBounds, viewMode, captureSheetGeometry]);

  const clearSelection = useCallback(() => {
    setSelectedRowIds(new Set());
    setRangeSelectMode(false);
    setBulkEditOpen(false);
    setBulkEditValue('');
    setRangeAnchor(null);
    setRangeFocus(null);
    setOverlayRect(null);
    lastCheckedIdxRef.current = null;
  }, []);

  const startCornerHandleDrag = useCallback(
    (
      corner: 'topLeft' | 'bottomRight',
      e: React.TouchEvent<HTMLElement> | React.MouseEvent<HTMLElement>
    ) => {
      const isTouch = 'touches' in e;
      if (isTouch) {
        lastTouchInteractionAtRef.current = performance.now();
      } else if (performance.now() - lastTouchInteractionAtRef.current < 650) {
        return;
      }

      if (!cellRangeBounds) return;
      e.stopPropagation();
      if (!isTouch) {
        e.preventDefault();
      }

      const clientX = isTouch ? e.touches[0]?.clientX ?? 0 : e.clientX;
      const clientY = isTouch ? e.touches[0]?.clientY ?? 0 : e.clientY;

      const geom = captureSheetGeometry();
      const container = tableContainerRef.current;
      if (!geom || !container) return;

      const containerRect = container.getBoundingClientRect();
      const startLocalX = clientX - containerRect.left;
      const startLocalY = clientY - containerRect.top;

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      window.getSelection()?.removeAllRanges();
      AppSounds.tap();

      const fixedAnchor: CellCoord =
        corner === 'bottomRight'
          ? { rowIdx: cellRangeBounds.minRow, colIdx: cellRangeBounds.minCol }
          : { rowIdx: cellRangeBounds.maxRow, colIdx: cellRangeBounds.maxCol };
      const movingFocus: CellCoord =
        corner === 'bottomRight'
          ? { rowIdx: cellRangeBounds.maxRow, colIdx: cellRangeBounds.maxCol }
          : { rowIdx: cellRangeBounds.minRow, colIdx: cellRangeBounds.minCol };

      const targetRowMetric = geom.rows[movingFocus.rowIdx];
      const targetColMetric = geom.cols[movingFocus.colIdx];
      const handleDotX = targetColMetric
        ? corner === 'bottomRight'
          ? targetColMetric.right
          : targetColMetric.left
        : startLocalX;
      const handleDotY = targetRowMetric
        ? corner === 'bottomRight'
          ? targetRowMetric.bottom
          : targetRowMetric.top
        : startLocalY;

      const clampOffset = (v: number) => Math.max(-22, Math.min(22, v));
      const isSingleCol = cellRangeBounds.minCol === cellRangeBounds.maxCol;

      dragGeometryRef.current = geom;
      dragMetaRef.current = {
        anchorRow: fixedAnchor.rowIdx,
        anchorCol: fixedAnchor.colIdx,
        startFocusCol: movingFocus.colIdx,
        startX: clientX,
        startY: clientY,
        grabOffsetX: clampOffset(startLocalX - handleDotX),
        grabOffsetY: clampOffset(startLocalY - handleDotY),
        singleColLock: isSingleCol,
        hasMoved: false,
      };
      rangeAnchorRef.current = fixedAnchor;
      rangeFocusRef.current = movingFocus;
      lastTouchPointRef.current = { x: clientX, y: clientY };
      isHandleDraggingRef.current = true;
      document.documentElement.style.overscrollBehaviorY = 'none';
      setIsTouchDragging(true);
      setSelectedRowIds(new Set());
      setBulkEditOpen(false);
      setRangeAnchor(fixedAnchor);
      setRangeFocus(movingFocus);
    },
    [cellRangeBounds, captureSheetGeometry]
  );

  const handleToggleRowCheckbox = (
    rowId: string,
    visibleIdx: number,
    shiftKey: boolean
  ) => {
    AppSounds.tap();
    setRangeAnchor(null);
    setRangeFocus(null);

    const useRange = (shiftKey || rangeSelectMode) && lastCheckedIdxRef.current !== null;
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (useRange && lastCheckedIdxRef.current !== null) {
        const start = Math.min(lastCheckedIdxRef.current, visibleIdx);
        const end = Math.max(lastCheckedIdxRef.current, visibleIdx);
        const shouldSelect = rangeSelectMode ? true : !prev.has(rowId);
        for (let i = start; i <= end; i++) {
          const r = filteredRows[i];
          if (r) {
            if (shouldSelect) next.add(r.id);
            else next.delete(r.id);
          }
        }
      } else {
        if (next.has(rowId)) next.delete(rowId);
        else next.add(rowId);
      }
      return next;
    });
    if (rangeSelectMode) {
      setRangeSelectMode(false);
    }
    lastCheckedIdxRef.current = visibleIdx;
  };

  const allFilteredSelected =
    filteredRows.length > 0 && filteredRows.every((r) => selectedRowIds.has(r.id));

  const handleToggleSelectAll = () => {
    AppSounds.tap();
    setRangeAnchor(null);
    setRangeFocus(null);
    if (allFilteredSelected) {
      setSelectedRowIds(new Set());
    } else {
      setSelectedRowIds(new Set(filteredRows.map((r) => r.id)));
    }
  };

  const buildCopyTextFromSelection = useCallback((): string => {
    if (selectedRowIds.size > 0) {
      const chosen = filteredRows.filter((r) => selectedRowIds.has(r.id));
      return formatSessionRowsForCopy(chosen, 'sheet', sessionDefaultItem);
    }
    if (hasMultiCellRange && cellRangeBounds) {
      const lines: string[] = [];
      for (let r = cellRangeBounds.minRow; r <= cellRangeBounds.maxRow; r++) {
        const row = filteredRows[r];
        if (!row) continue;
        const vals: string[] = [];
        for (let c = cellRangeBounds.minCol; c <= cellRangeBounds.maxCol; c++) {
          const key = EDITABLE_COLS[c];
          vals.push(String(row[key] || ''));
        }
        lines.push(vals.join('\t'));
      }
      return lines.join('\n');
    }
    return formatSessionRowsForCopy(computation.rows, 'sheet', sessionDefaultItem);
  }, [selectedRowIds, filteredRows, hasMultiCellRange, cellRangeBounds, computation.rows, sessionDefaultItem]);

  const handleCopySelectionOrSheet = useCallback(async () => {
    const text = buildCopyTextFromSelection();
    if (!text) return;
    await writeClipboard(text);
    AppSounds.success();
    setCopiedBanner(true);
    if (selectedRowIds.size > 0) {
      showPasteNotice(`Copied ${selectedRowIds.size} selected row${selectedRowIds.size > 1 ? 's' : ''}`);
    } else if (hasMultiCellRange && cellRangeBounds) {
      showPasteNotice(`Copied ${cellRangeBounds.cellCount} selected cells`);
    }
    window.setTimeout(() => setCopiedBanner(false), 2000);
  }, [
    buildCopyTextFromSelection,
    writeClipboard,
    selectedRowIds.size,
    hasMultiCellRange,
    cellRangeBounds,
    showPasteNotice,
  ]);

  const handleClearSelection = useCallback(() => {
    if (readOnly) return;
    if (selectedRowIds.size > 0) {
      AppSounds.remove();
      onClearCells(
        Array.from(selectedRowIds).map((rowId) => ({
          rowId,
          fields: [...EDITABLE_COLS],
        }))
      );
      showPasteNotice(`Cleared ${selectedRowIds.size} row${selectedRowIds.size > 1 ? 's' : ''}`);
      clearSelection();
      return;
    }
    if (hasMultiCellRange && cellRangeBounds) {
      AppSounds.remove();
      const fields = EDITABLE_COLS.slice(
        cellRangeBounds.minCol,
        cellRangeBounds.maxCol + 1
      );
      const targets: Array<{ rowId: string; fields: EditableColKey[] }> = [];
      for (let r = cellRangeBounds.minRow; r <= cellRangeBounds.maxRow; r++) {
        const row = filteredRows[r];
        if (row) targets.push({ rowId: row.id, fields });
      }
      onClearCells(targets);
      showPasteNotice(`Cleared ${cellRangeBounds.cellCount} cells`);
      clearSelection();
    }
  }, [
    readOnly,
    selectedRowIds,
    hasMultiCellRange,
    cellRangeBounds,
    filteredRows,
    onClearCells,
    showPasteNotice,
    clearSelection,
  ]);

  const handleFillDownSelection = useCallback(() => {
    if (readOnly) return;
    if (!cellRangeBounds || cellRangeBounds.maxRow <= cellRangeBounds.minRow) return;
    const sourceRow = filteredRows[cellRangeBounds.minRow];
    if (!sourceRow) return;

    const patches: Array<{ rowId: string; patch: Partial<TicketEntryRow> }> = [];
    for (let r = cellRangeBounds.minRow + 1; r <= cellRangeBounds.maxRow; r++) {
      const targetRow = filteredRows[r];
      if (!targetRow) continue;
      const patch: Partial<TicketEntryRow> = {};
      for (let c = cellRangeBounds.minCol; c <= cellRangeBounds.maxCol; c++) {
        const key = EDITABLE_COLS[c];
        if (key === 'name') {
          patch.name = sourceRow.name || sourceRow.resolvedName || '';
        } else if (key === 'qtyOverride') {
          patch.qtyOverride =
            sourceRow.qtyOverride !== ''
              ? sourceRow.qtyOverride
              : sourceRow.qty > 0
                ? String(sourceRow.qty)
                : '';
        } else {
          patch[key] = sourceRow[key];
        }
      }
      patches.push({ rowId: targetRow.id, patch });
    }

    if (patches.length === 0) return;
    AppSounds.add();
    onBatchPatchRows(patches);
    showPasteNotice(`Filled down ${patches.length} row${patches.length > 1 ? 's' : ''}`);
  }, [readOnly, cellRangeBounds, filteredRows, onBatchPatchRows, showPasteNotice]);

  const handleOpenBulkEdit = useCallback(() => {
    if (readOnly) return;
    AppSounds.tap();
    if (hasMultiCellRange && cellRangeBounds) {
      const firstRow = filteredRows[cellRangeBounds.minRow];
      const key = EDITABLE_COLS[cellRangeBounds.minCol];
      if (firstRow && key) {
        const initVal =
          key === 'name'
            ? firstRow.name || firstRow.resolvedName || ''
            : key === 'qtyOverride'
              ? firstRow.qtyOverride !== ''
                ? firstRow.qtyOverride
                : firstRow.qty > 0
                  ? String(firstRow.qty)
                  : ''
              : String(firstRow[key] || '');
        setBulkEditValue(initVal);
      } else {
        setBulkEditValue('');
      }
      setBulkEditOpen(true);
      return;
    }
    if (selectedRowIds.size > 0) {
      const firstSelected = filteredRows.find((r) => selectedRowIds.has(r.id));
      setBulkEditValue(firstSelected?.item || sessionDefaultItem);
      setBulkEditOpen(true);
    }
  }, [hasMultiCellRange, cellRangeBounds, filteredRows, selectedRowIds, sessionDefaultItem]);

  const handleApplyBulkEdit = useCallback(
    (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (readOnly) return;
      const rawVal = bulkEditValue.trim();
      const patches: Array<{ rowId: string; patch: Partial<TicketEntryRow> }> = [];

      if (hasMultiCellRange && cellRangeBounds) {
        for (let r = cellRangeBounds.minRow; r <= cellRangeBounds.maxRow; r++) {
          const targetRow = filteredRows[r];
          if (!targetRow) continue;
          const patch: Partial<TicketEntryRow> = {};
          for (let c = cellRangeBounds.minCol; c <= cellRangeBounds.maxCol; c++) {
            const key = EDITABLE_COLS[c];
            if (key === 'name') {
              patch.name = rawVal.toUpperCase();
            } else if (key === 'item') {
              patch.item = rawVal.toUpperCase();
              patch.qtyOverride = '';
              patch.rangeOverride = '';
            } else if (key === 'start') {
              patch.start = rawVal.replace(/\D/g, '').slice(0, 5);
              patch.qtyOverride = '';
              patch.rangeOverride = '';
            } else if (key === 'end') {
              patch.end = rawVal.replace(/\D/g, '').slice(0, 5);
              patch.qtyOverride = '';
              patch.rangeOverride = '';
            } else if (key === 'qtyOverride') {
              patch.qtyOverride = rawVal.replace(/[^\d.]/g, '');
            }
          }
          patches.push({ rowId: targetRow.id, patch });
        }
      } else if (selectedRowIds.size > 0) {
        const cleanItem = rawVal.toUpperCase();
        for (const rowId of selectedRowIds) {
          patches.push({
            rowId,
            patch: { item: cleanItem, qtyOverride: '', rangeOverride: '' },
          });
        }
      }

      if (patches.length > 0) {
        AppSounds.success();
        onBatchPatchRows(patches);
        showPasteNotice(`Updated ${patches.length} row${patches.length > 1 ? 's' : ''}`);
      }
      setBulkEditOpen(false);
    },
    [
      readOnly,
      bulkEditValue,
      hasMultiCellRange,
      cellRangeBounds,
      filteredRows,
      selectedRowIds,
      onBatchPatchRows,
      showPasteNotice,
    ]
  );

  const handleDeleteSelectedRows = useCallback(() => {
    if (readOnly) return;
    let idsToDelete: string[] = [];
    if (selectedRowIds.size > 0) {
      idsToDelete = Array.from(selectedRowIds);
    } else if (hasMultiCellRange && cellRangeBounds) {
      for (let r = cellRangeBounds.minRow; r <= cellRangeBounds.maxRow; r++) {
        const row = filteredRows[r];
        if (row) idsToDelete.push(row.id);
      }
    }
    if (idsToDelete.length === 0) return;
    AppSounds.warning();
    setPendingDeleteConfirm({
      mode: 'bulk',
      rowIds: idsToDelete,
      summary: `${idsToDelete.length} selected ${idsToDelete.length === 1 ? 'row' : 'rows'} in ${sessionId}`,
    });
  }, [
    readOnly,
    selectedRowIds,
    hasMultiCellRange,
    cellRangeBounds,
    filteredRows,
    sessionId,
  ]);

  const handleCutSelection = useCallback(async () => {
    if (readOnly || !hasSelection) return;
    const text = buildCopyTextFromSelection();
    if (text) {
      await writeClipboard(text);
    }
    if (selectedRowIds.size > 0) {
      const count = selectedRowIds.size;
      AppSounds.remove();
      onDeleteRows(Array.from(selectedRowIds));
      showPasteNotice(`Cut ${count} row${count > 1 ? 's' : ''}`);
      clearSelection();
    } else {
      handleClearSelection();
    }
  }, [
    readOnly,
    hasSelection,
    buildCopyTextFromSelection,
    writeClipboard,
    selectedRowIds,
    onDeleteRows,
    showPasteNotice,
    clearSelection,
    handleClearSelection,
  ]);

  const handlePasteAtSelection = async () => {
    if (readOnly) return;
    AppSounds.tap();
    try {
      const clip = await navigator.clipboard.readText();
      if (clip && clip.trim()) {
        // If user selected a cell column/grid and copied plain column values, paste straight into selected cells
        if (hasMultiCellRange && cellRangeBounds) {
          const clipLines = clip
            .replace(/\r/g, '')
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
          const isSingleColSelection = cellRangeBounds.minCol === cellRangeBounds.maxCol;
          const colKey = EDITABLE_COLS[cellRangeBounds.minCol];
          const looksLikeSimpleValues =
            isSingleColSelection &&
            clipLines.length > 0 &&
            clipLines.every((l) => !l.includes('\t') && !l.includes('='));

          if (looksLikeSimpleValues && colKey) {
            const patches: Array<{ rowId: string; patch: Partial<TicketEntryRow> }> = [];
            for (let r = cellRangeBounds.minRow; r <= cellRangeBounds.maxRow; r++) {
              const targetRow = filteredRows[r];
              if (!targetRow) continue;
              const val = clipLines[(r - cellRangeBounds.minRow) % clipLines.length];
              const patch: Partial<TicketEntryRow> = {};
              if (colKey === 'name') {
                patch.name = val.toUpperCase();
              } else if (colKey === 'item') {
                patch.item = val.toUpperCase();
                patch.qtyOverride = '';
                patch.rangeOverride = '';
              } else if (colKey === 'start') {
                patch.start = val.replace(/\D/g, '').slice(0, 5);
                patch.qtyOverride = '';
                patch.rangeOverride = '';
              } else if (colKey === 'end') {
                patch.end = val.replace(/\D/g, '').slice(0, 5);
                patch.qtyOverride = '';
                patch.rangeOverride = '';
              } else if (colKey === 'qtyOverride') {
                patch.qtyOverride = val.replace(/[^\d.]/g, '');
              }
              patches.push({ rowId: targetRow.id, patch });
            }
            if (patches.length > 0) {
              AppSounds.success();
              onBatchPatchRows(patches);
              showPasteNotice(`Pasted into ${patches.length} cells`);
              clearSelection();
              return;
            }
          }
        }

        const parsed = parsePastedTicketText(clip, {
          defaultName: qName,
          defaultItem: qItem,
          knownNames: availableNames,
        });
        if (parsed.length > 0) {
          const targetId =
            selectedRowIds.size >= 1
              ? filteredRows.find((r) => selectedRowIds.has(r.id))?.id
              : cellRangeBounds
                ? filteredRows[cellRangeBounds.minRow]?.id
                : rangeAnchor
                  ? filteredRows[rangeAnchor.rowIdx]?.id
                  : undefined;
          AppSounds.success();
          onBulkAddEntries(parsed, targetId);
          showPasteNotice(`Pasted ${parsed.length} row${parsed.length > 1 ? 's' : ''}`);
          clearSelection();
          return;
        }
      }
    } catch {
      // Fallback to paste box if clipboard API requires gesture inside box
    }
    setPastePanelOpen(true);
    requestAnimationFrame(() => pasteTextareaRef.current?.focus());
  };

  const handleSmartCellPaste = (
    e: React.ClipboardEvent<HTMLInputElement>,
    targetRowId?: string
  ) => {
    if (readOnly) {
      e.preventDefault();
      return;
    }
    const raw = e.clipboardData.getData('text');
    if (!raw) return;
    const trimmed = raw.trim();
    const isStructuredOrBulk =
      trimmed.includes('\n') ||
      trimmed.includes('\t') ||
      trimmed.includes('=') ||
      /^[A-Za-z]{1,2}\d{6,8}/.test(trimmed) ||
      /\s/.test(trimmed) ||
      /^\d{5}[-–/]\d{1,5}$/.test(trimmed);

    if (!isStructuredOrBulk) return;

    const parsed = parsePastedTicketText(trimmed, {
      defaultName: targetRowId ? '' : qName,
      defaultItem: qItem,
      knownNames: availableNames,
    });
    if (parsed.length === 0) return;

    e.preventDefault();
    AppSounds.success();
    onBulkAddEntries(parsed, targetRowId);
    showPasteNotice(`Pasted ${parsed.length} row${parsed.length > 1 ? 's' : ''}`);
  };

  const handleSheetKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    const targetEl = e.target as HTMLElement | null;
    const tag = targetEl?.tagName?.toLowerCase();
    const isTextInput =
      tag === 'input' || tag === 'textarea' || tag === 'select';
    const inputHasSelection =
      tag === 'input' &&
      (targetEl as HTMLInputElement).selectionStart !==
        (targetEl as HTMLInputElement).selectionEnd;

    if (!readOnly && mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      if (canUndo && !isTextInput) {
        e.preventDefault();
        AppSounds.tap();
        onUndo();
        showPasteNotice('Undid last change');
      }
      return;
    }

    if (
      !readOnly &&
      mod &&
      (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))
    ) {
      if (canRedo && !isTextInput) {
        e.preventDefault();
        AppSounds.tap();
        onRedo();
        showPasteNotice('Redid change');
      }
      return;
    }

    if (mod && e.key.toLowerCase() === 'c' && hasSelection && !inputHasSelection) {
      e.preventDefault();
      void handleCopySelectionOrSheet();
      return;
    }

    if (!readOnly && mod && e.key.toLowerCase() === 'x' && hasSelection && !inputHasSelection) {
      e.preventDefault();
      void handleCutSelection();
      return;
    }

    if (mod && e.key.toLowerCase() === 'a' && !isTextInput) {
      e.preventDefault();
      AppSounds.tap();
      setSelectedRowIds(new Set(filteredRows.map((r) => r.id)));
      return;
    }

    if (
      !readOnly &&
      (e.key === 'Delete' || e.key === 'Backspace') &&
      hasSelection &&
      !isTextInput
    ) {
      e.preventDefault();
      if (selectedRowIds.size > 0) {
        handleDeleteSelectedRows();
      } else {
        handleClearSelection();
      }
      return;
    }

    if (e.key === 'Escape' && hasSelection) {
      e.preventDefault();
      clearSelection();
    }
  };

  const cardRows = (() => {
    const hasFilter = (searchQuery.trim() !== '' && !isNumberSearch) || statusFilter === 'overlimit';
    if (hasFilter) return filteredRows;
    const populated = filteredRows.filter(
      (r) => r.name || r.item || r.start || r.end || r.qtyOverride || r.rangeOverride
    );
    const firstEmpty = filteredRows.find(
      (r) => !r.name && !r.item && !r.start && !r.end && !r.qtyOverride && !r.rangeOverride
    );
    return firstEmpty ? [...populated, firstEmpty] : populated;
  })();

  const highlightedSet = useMemo(
    () => new Set(highlightedRowIds || []),
    [highlightedRowIds]
  );

  const pastedSummary = useMemo(() => {
    if (highlightedSet.size === 0) return null;
    let visibleCount = 0;
    let qtySum = 0;

    for (const row of filteredRows) {
      if (!highlightedSet.has(row.id)) continue;
      visibleCount++;
      if (row.isExcludedFromCount) continue;
      const qVal = row.qtyOverride !== '' ? Number(row.qtyOverride) : row.qty;
      if (Number.isFinite(qVal)) {
        qtySum += qVal;
      }
    }

    if (visibleCount === 0) return null;
    return {
      visibleCount,
      qtySum: Math.round(qtySum * 100) / 100,
    };
  }, [filteredRows, highlightedSet]);

  const overLimitRowCount = computation.rows.filter(
    (r) =>
      r.statusType === 'overlimit' ||
      (r.overLimitBreakdowns && r.overLimitBreakdowns.length > 0)
  ).length;
  const filledRowCount = computation.rows.filter(
    (r) =>
      (r.name || r.item || r.start || r.end || r.qtyOverride || r.rangeOverride) &&
      !r.isExcludedFromCount
  ).length;

  return (
    <div
      className="space-y-3 outline-none"
      tabIndex={-1}
      onKeyDown={handleSheetKeyDown}
    >
      {/* Executive Session Header + Quick Entry */}
      <form
        onSubmit={handleQuickSubmit}
        className="kk-surface-card rounded-2xl overflow-hidden"
      >
        <div className="kk-table-head text-white px-3.5 sm:px-4 py-2 sm:py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-bold min-w-0">
            <span
              className={`px-2 py-0.5 rounded-md border text-[11px] font-extrabold font-mono-tabular shrink-0 ${theme.badgeBg} ${theme.badgeText}`}
            >
              {sessionId}
            </span>
            <span className="truncate">
              {theme.label} · {computation.prefix}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] sm:text-xs font-mono-tabular font-semibold text-indigo-100 shrink-0">
            <span>Rows: <strong className="text-white">{filledRowCount}</strong></span>
            <span>Limit: <strong className="text-white">{limitThreshold}</strong></span>
            <span>Qty: <strong className="text-white">{formatINR(computation.totalQty)}</strong></span>
          </div>
        </div>

        {lockNotice && <div className="px-3 pt-2.5 pb-2.5">{lockNotice}</div>}

        {!readOnly && (
        <div className="p-2.5 sm:p-3 grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10.5px] font-bold text-slate-600 leading-tight">Name</span>
            <select
              value={qName}
              onChange={(e) => setQName(e.target.value)}
              className="w-full h-9 sm:h-9 px-2 text-base sm:text-xs font-bold text-slate-950 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
            >
              <option value="">(Auto prev)</option>
              {availableNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-0.5">
            <span className="text-[10.5px] font-bold text-slate-600 leading-tight">Item</span>
            <input
              type="text"
              list={`item-options-${sessionId}`}
              aria-label="Quick entry item"
              value={qItem}
              onChange={(e) => setQItem(e.target.value.toUpperCase())}
              placeholder={sessionDefaultItem}
              className="w-full h-9 sm:h-9 px-2 text-base sm:text-xs font-bold font-mono-tabular uppercase text-slate-950 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
            />
          </div>

          <label className="flex flex-col gap-0.5">
            <span className="text-[10.5px] font-bold text-slate-600 leading-tight">Start (or Paste)</span>
            <input
              ref={quickStartRef}
              type="text"
              inputMode="numeric"
              value={qStart}
              onChange={(e) => {
                const prevLen = qStart.length;
                const nextVal = e.target.value.replace(/\D/g, '').slice(0, 5);
                setQStart(nextVal);
                if (nextVal.length === 5 && prevLen < 5) {
                  quickEndRef.current?.focus();
                  quickEndRef.current?.select();
                }
              }}
              onPaste={(e) => handleSmartCellPaste(e)}
              placeholder="12200"
              className="w-full h-9 sm:h-9 px-2 text-base sm:text-xs font-bold font-mono-tabular text-slate-950 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
            />
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="text-[10.5px] font-bold text-slate-600 leading-tight">End</span>
            <input
              ref={quickEndRef}
              type="text"
              inputMode="numeric"
              value={qEnd}
              onChange={(e) => setQEnd(e.target.value.replace(/\D/g, '').slice(0, 5))}
              placeholder="09"
              className="w-full h-9 sm:h-9 px-2 text-base sm:text-xs font-bold font-mono-tabular text-slate-950 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
            />
          </label>

          <button
            type="submit"
            className="col-span-2 sm:col-span-1 h-9 inline-flex items-center justify-center gap-1.5 px-3 text-xs font-bold text-white bg-[var(--kk-brand)] hover:bg-[var(--kk-brand-hover)] rounded-xl transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Entry</span>
          </button>

          {/* One-tap Session Item Code Bar (M5..M20 / D5..D20 / E5..E20) */}
          <div className="col-span-2 sm:col-span-5 flex items-center gap-1.5 pt-0.5 overflow-x-auto no-scrollbar">
            <span className="text-[10.5px] font-semibold text-slate-500 shrink-0 mr-0.5">
              Quick Item:
            </span>
            {sessionItemOptions.slice(0, 6).map((opt) => {
              const active = qItem.trim().toUpperCase() === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    AppSounds.tap();
                    setQItem(opt);
                    quickStartRef.current?.focus();
                  }}
                  className={`shrink-0 px-2.5 py-0.5 text-[11px] font-bold font-mono-tabular rounded-lg border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[var(--kk-brand)] text-white border-[var(--kk-brand)] shadow-xs'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-[var(--kk-tint)] hover:text-[var(--kk-brand)] hover:border-[var(--kk-tint-border)]'
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
        )}
      </form>

      <datalist id={`item-options-${sessionId}`}>
        {sessionItemOptions.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>

      {pasteFeedback && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl px-3.5 py-2 text-xs font-bold flex items-center justify-between shadow-xs">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
            {pasteFeedback}
          </span>
          <button
            type="button"
            onClick={() => setPasteFeedback('')}
            className="text-emerald-800 hover:text-emerald-950 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Bulk Paste Box (E1062213 / E5 64005 007 / Excel / Sheets) */}
      {pastePanelOpen && !readOnly && (
        <div className="bg-white border-2 border-[var(--kk-brand)] rounded-2xl p-3.5 space-y-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs sm:text-sm font-bold text-slate-950">
                Paste Numbers in {sessionId}
              </div>
              <div className="text-[11px] font-medium text-slate-600">
                Supports E1062213, E5 64005 007, E5 47362, M5=54321-25, or Sheet rows
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePasteFromClipboard}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[var(--kk-brand)] bg-indigo-50 hover:bg-indigo-100 rounded-xl cursor-pointer"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                <span>Paste Clipboard</span>
              </button>
              <button
                type="button"
                onClick={() => setPastePanelOpen(false)}
                className="p-1.5 text-slate-600 hover:text-slate-950 bg-slate-100 rounded-xl cursor-pointer"
                aria-label="Close paste panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <textarea
            ref={pasteTextareaRef}
            rows={5}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={`Paste list here:\n${sessionPrefix}1062213\n${sessionPrefix}5 64005 007\n${sessionPrefix}15 47362\n${sessionPrefix}2060054`}
            className="w-full p-2.5 text-xs font-mono-tabular font-semibold text-slate-950 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold text-slate-700 font-mono-tabular">
              {parsedPasteRows.length > 0 ? (
                <span className="text-emerald-700">
                  Detected {parsedPasteRows.length} row{parsedPasteRows.length > 1 ? 's' : ''} · First:{' '}
                  {parsedPasteRows[0].item} {parsedPasteRows[0].start}
                  {parsedPasteRows[0].end ? `-${parsedPasteRows[0].end}` : ''}
                </span>
              ) : (
                <span className="text-slate-500">Paste numbers above to preview</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {pasteText && (
                <button
                  type="button"
                  onClick={() => setPasteText('')}
                  className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                >
                  Clear Box
                </button>
              )}
              <button
                type="button"
                disabled={parsedPasteRows.length === 0}
                onClick={handleApplyBulkPaste}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white bg-[var(--kk-brand)] hover:bg-[var(--kk-brand-hover)] disabled:opacity-40 rounded-xl cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add {parsedPasteRows.length || ''} Rows</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Structured Workspace Toolbar (Compact 2-Row Mobile Fit) */}
      <div className="kk-surface-card rounded-2xl p-2 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-1.5">
        {/* Row 1: Search + Filter + View Mode */}
        <div className="flex items-center gap-1.5 w-full lg:w-auto">
          <div className="relative flex-1 min-w-0 sm:flex-initial sm:w-48">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isNumberSearch && matchedRowIndices.length > 0) {
                  e.preventDefault();
                  if (matchedRowIndices.length > 1) {
                    setActiveMatchIdx((prev) => (prev + 1) % matchedRowIndices.length);
                  } else {
                    scrollMatchedRowIntoPosition(0, true);
                  }
                }
              }}
              placeholder="Search..."
              className="w-full h-8 pl-8 pr-7 text-base sm:text-xs font-medium text-slate-950 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-950 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 border border-slate-200 rounded-xl shrink-0">
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                setStatusFilter('all');
              }}
              className={`h-7 px-2 text-[11px] font-bold rounded-lg cursor-pointer transition-colors ${
                statusFilter === 'all' ? 'bg-white text-[var(--kk-brand)] shadow-xs' : 'text-slate-600'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                setStatusFilter('overlimit');
              }}
              className={`h-7 px-2 text-[11px] font-bold rounded-lg cursor-pointer transition-colors ${
                statusFilter === 'overlimit' ? 'bg-white text-red-700 shadow-xs' : 'text-slate-600'
              }`}
            >
              Limit ({overLimitRowCount})
            </button>
          </div>

          <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 border border-slate-200 rounded-xl shrink-0">
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                setViewMode('table');
              }}
              className={`h-7 inline-flex items-center gap-1 px-2 text-[11px] font-bold rounded-lg cursor-pointer transition-colors ${
                viewMode === 'table' ? 'bg-white text-[var(--kk-brand)] shadow-xs' : 'text-slate-600'
              }`}
              title="All columns grid"
            >
              <Table2 className="w-3 h-3" />
              <span className="hidden sm:inline">All Cols</span>
            </button>
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                setViewMode('cards');
              }}
              className={`h-7 inline-flex items-center gap-1 px-2 text-[11px] font-bold rounded-lg cursor-pointer transition-colors ${
                viewMode === 'cards' ? 'bg-white text-[var(--kk-brand)] shadow-xs' : 'text-slate-600'
              }`}
              title="Card view"
            >
              <LayoutGrid className="w-3 h-3" />
              <span className="hidden sm:inline">Cards</span>
            </button>
          </div>
        </div>

        {/* Row 2: Undo/Redo + Paste/Copy + Row Operations (Single Compact Row) */}
        <div className="flex items-center justify-between sm:justify-end gap-1 overflow-x-auto no-scrollbar">
          {!readOnly && (
            <>
              <div className="inline-flex items-center shrink-0">
                <button
                  type="button"
                  disabled={!canUndo}
                  onClick={() => {
                    AppSounds.tap();
                    onUndo();
                    showPasteNotice('Undid last change');
                  }}
                  className="h-7.5 inline-flex items-center gap-1 px-2 text-[11px] font-bold text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-l-xl cursor-pointer disabled:opacity-40 disabled:cursor-default"
                  title="Undo (Ctrl+Z)"
                >
                  <Undo2 className="w-3 h-3" />
                  <span>Undo</span>
                </button>
                <button
                  type="button"
                  disabled={!canRedo}
                  onClick={() => {
                    AppSounds.tap();
                    onRedo();
                    showPasteNotice('Redid change');
                  }}
                  className="h-7.5 inline-flex items-center gap-1 px-2 text-[11px] font-bold text-slate-800 bg-slate-50 hover:bg-slate-100 border border-l-0 border-slate-200 rounded-r-xl cursor-pointer disabled:opacity-40 disabled:cursor-default"
                  title="Redo (Ctrl+Y)"
                >
                  <Redo2 className="w-3 h-3" />
                  <span>Redo</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  setPastePanelOpen((v) => !v);
                }}
                className={`shrink-0 h-7.5 inline-flex items-center gap-1 px-2 text-[11px] font-bold rounded-xl border cursor-pointer transition-colors ${
                  pastePanelOpen
                    ? 'bg-[var(--kk-brand)] text-white border-[var(--kk-brand)]'
                    : 'bg-indigo-50 hover:bg-indigo-100 text-[var(--kk-brand)] border-indigo-200'
                }`}
              >
                <ClipboardPaste className="w-3 h-3" />
                <span>Paste</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => void handleCopySelectionOrSheet()}
            disabled={filledRowCount === 0 && !hasSelection}
            className={`shrink-0 h-7.5 inline-flex items-center gap-1 px-2 text-[11px] font-bold rounded-xl border cursor-pointer disabled:opacity-40 transition-colors ${
              copiedBanner
                ? 'bg-emerald-700 text-white border-emerald-700'
                : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
            }`}
          >
            {copiedBanner ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            <span>{copiedBanner ? 'Copied' : selectedRowIds.size > 0 ? `Copy (${selectedRowIds.size})` : 'Copy'}</span>
          </button>

          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  onAddRows(5);
                }}
                className="shrink-0 h-7.5 px-2 text-[11px] font-bold text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl cursor-pointer transition-colors"
              >
                +5
              </button>

              {!confirmClear ? (
                <button
                  type="button"
                  onClick={() => {
                    AppSounds.tap();
                    setConfirmClear(true);
                  }}
                  className="shrink-0 h-7.5 px-2 text-[11px] font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl cursor-pointer transition-colors"
                >
                  Clear
                </button>
              ) : (
                <div className="shrink-0 h-7.5 flex items-center gap-1 bg-red-50 border border-red-200 px-1.5 rounded-xl">
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.remove();
                      onClearSession();
                      clearSelection();
                      setConfirmClear(false);
                    }}
                    className="px-1.5 py-0.5 text-[11px] font-bold text-white bg-red-700 rounded-lg cursor-pointer"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="px-1 py-0.5 text-[11px] font-bold text-slate-800 cursor-pointer"
                  >
                    No
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {isNumberSearch && (
        <div
          className={`rounded-2xl px-3 py-1.5 flex items-center justify-between gap-2 text-xs font-bold border shadow-xs ${
            matchedRowIndices.length > 0
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-slate-50 border-slate-200 text-slate-600'
          }`}
        >
          {matchedRowIndices.length > 0 ? (
            <>
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    AppSounds.tap();
                    scrollMatchedRowIntoPosition(0, true);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500 text-white font-mono-tabular font-black text-[11px] cursor-pointer"
                  title="Jump searched number to first row"
                >
                  <span>{trimmedSearch}</span>
                  {matchedRowIndices.length > 1 && (
                    <span className="opacity-90">
                      ({safeMatchIdx + 1}/{matchedRowIndices.length})
                    </span>
                  )}
                </button>
                <span className="text-[11px] font-semibold text-amber-900/85 truncate">
                  Row #{activeMatchVisibleIdx + 1} · ↑{aboveMatchCount} upar · ↓{belowMatchCount} niche
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {aboveMatchCount > 0 && viewMode === 'table' && (
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      scrollMatchedRowIntoPosition(2, true);
                    }}
                    className="h-7 px-2 inline-flex items-center gap-0.5 rounded-lg bg-white hover:bg-amber-100 border border-amber-300 text-amber-950 text-[11px] font-extrabold cursor-pointer"
                    title="Upar ke 2 numbers bhi saath dekhein"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                    <span>Upar</span>
                  </button>
                )}
                {matchedRowIndices.length > 1 && (
                  <div className="inline-flex items-center">
                    <button
                      type="button"
                      aria-label="Previous matching number"
                      onClick={() => {
                        AppSounds.tap();
                        setActiveMatchIdx(
                          (prev) => (prev - 1 + matchedRowIndices.length) % matchedRowIndices.length
                        );
                      }}
                      className="h-7 w-7 inline-flex items-center justify-center rounded-l-lg bg-white hover:bg-amber-100 border border-amber-300 text-amber-950 cursor-pointer"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next matching number"
                      onClick={() => {
                        AppSounds.tap();
                        setActiveMatchIdx((prev) => (prev + 1) % matchedRowIndices.length);
                      }}
                      className="h-7 w-7 inline-flex items-center justify-center rounded-r-lg bg-white hover:bg-amber-100 border border-l-0 border-amber-300 text-amber-950 cursor-pointer"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <span className="text-[11px] font-semibold">
              <strong className="font-mono-tabular text-slate-900">{trimmedSearch}</strong> — koi matching number nahi mila
            </span>
          )}
        </div>
      )}

      {pastedSummary && (
        <div className="bg-blue-50 border-2 border-blue-600 text-blue-950 rounded-2xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 shadow-xs">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-600 text-white font-mono-tabular">
              <Calculator className="w-3.5 h-3.5" />
              <span>SUM: {formatINR(pastedSummary.qtySum)}</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={async () => {
                const chosen = filteredRows.filter((r) => highlightedSet.has(r.id));
                const text = formatSessionRowsForCopy(chosen, 'sheet', sessionDefaultItem);
                if (!text) return;
                await writeClipboard(text);
                AppSounds.success();
                showPasteNotice(`Copied ${chosen.length} pasted rows (Sum: ${formatINR(pastedSummary.qtySum)})`);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-blue-900 bg-white hover:bg-blue-100 border border-blue-300 rounded-lg cursor-pointer transition-colors"
            >
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </button>
            {onDismissPasteHighlight && (
              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  onDismissPasteHighlight();
                }}
                className="px-2.5 py-1 text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer transition-colors"
              >
                OK / Clear Border
              </button>
            )}
          </div>
        </div>
      )}

      {/* FIT-ON-ONE-SCREEN TABLE VIEW: 100% Width, Table-Fixed, Zero Horizontal Cutoff! */}
      {viewMode === 'table' ? (
        <div
          ref={tableScrollRef}
          className={
            isNumberSearch && matchedRowIndices.length > 0
              ? 'kk-surface-card rounded-2xl max-h-[58vh] overflow-y-auto overscroll-contain'
              : ''
          }
        >
        <div ref={tableContainerRef} className="relative">
          <div
            className={`${
              isNumberSearch && matchedRowIndices.length > 0
                ? 'select-none sm:select-auto'
                : 'kk-surface-card rounded-2xl overflow-hidden select-none sm:select-auto'
            } ${isTouchDragging ? 'touch-none' : ''}`}
          >
            <table className="w-full table-fixed border-collapse">
              <thead
                ref={theadRef}
                className={isNumberSearch && matchedRowIndices.length > 0 ? 'sticky top-0 z-20' : ''}
              >
                <tr className="kk-table-head text-white text-[10.5px] sm:text-xs font-bold uppercase tracking-[0.03em] whitespace-nowrap">
                  <th className="w-[5%] sm:w-[4%] px-0.5 py-2.5 sm:py-3 text-center border-r border-white/10">
                    <input
                      type="checkbox"
                      aria-label="Select all rows"
                      checked={allFilteredSelected}
                      onChange={handleToggleSelectAll}
                      className="w-4 h-4 accent-blue-500 cursor-pointer align-middle"
                    />
                  </th>
                  <th className="hidden sm:table-cell sm:w-[5.5%] px-1 py-2.5 sm:py-3 text-center border-r border-white/10">
                    Time
                  </th>
                  <th className="w-[22%] sm:w-[18%] px-0.5 sm:px-1.5 py-2.5 sm:py-3 text-center border-r border-white/10">
                    Name
                  </th>
                  <th className="w-[11.5%] sm:w-[9.5%] px-0.5 sm:px-1.5 py-2.5 sm:py-3 text-center border-r border-white/10">
                    Item
                  </th>
                  <th className="w-[13.5%] sm:w-[13%] px-0.5 sm:px-1.5 py-2.5 sm:py-3 text-center border-r border-white/10">
                    Start
                  </th>
                  <th className="w-[7.5%] sm:w-[8%] px-0.5 sm:px-1.5 py-2.5 sm:py-3 text-center border-r border-white/10">
                    End
                  </th>
                  <th className="w-[8.5%] sm:w-[9%] px-0.5 sm:px-1.5 py-2.5 sm:py-3 text-center border-r border-white/10">
                    Qty
                  </th>
                  <th className="w-[27.5%] sm:w-[28.5%] px-0.5 sm:px-2 py-2.5 sm:py-3 text-center border-r border-white/10 whitespace-nowrap">
                    Limit Status
                  </th>
                  <th className="w-[4.5%] sm:w-[4.5%] px-0.5 py-2.5 sm:py-3 text-center"></th>
                </tr>
              </thead>
            <tbody
              ref={tbodyRef}
              className={`divide-y divide-slate-200/80 text-slate-950 ${
                isTouchDragging ? 'pointer-events-none select-none' : ''
              }`}
            >
              {filteredRows.map((row, visibleIdx) => {
                const isAutofilled = row.name.trim() === '' && row.resolvedName !== '';
                const prevVisibleRow = filteredRows[visibleIdx - 1];
                const nextVisibleRow = filteredRows[visibleIdx + 1];
                const isRowSelected = selectedRowIds.has(row.id);
                const isPastedRow = highlightedSet.has(row.id);
                const isPastedTop =
                  isPastedRow && (!prevVisibleRow || !highlightedSet.has(prevVisibleRow.id));
                const isPastedBottom =
                  isPastedRow && (!nextVisibleRow || !highlightedSet.has(nextVisibleRow.id));
                const pastedQtyClass = !isPastedRow
                  ? 'border-r border-slate-200/70'
                  : [
                      'border-l-2 border-l-blue-600 border-r-2 border-r-blue-600 bg-blue-50/55',
                      isPastedTop ? 'border-t-2 border-t-blue-600' : '',
                      isPastedBottom ? 'border-b-2 border-b-blue-600' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');

                const cellMouseProps = (colIdx: number) => ({
                  'data-cell-row': visibleIdx,
                  'data-cell-col': colIdx,
                  onTouchStart: (e: React.TouchEvent<HTMLTableCellElement>) => {
                    lastTouchInteractionAtRef.current = performance.now();
                    const touch = e.touches[0];
                    if (!touch) return;
                    const startX = touch.clientX;
                    const startY = touch.clientY;

                    const beginTouchDrag = () => {
                      const geom = captureSheetGeometry();
                      if (!geom) return;
                      if (document.activeElement instanceof HTMLElement) {
                        document.activeElement.blur();
                      }
                      window.getSelection()?.removeAllRanges();
                      AppSounds.tap();
                      const coord = { rowIdx: visibleIdx, colIdx };
                      dragGeometryRef.current = geom;
                      dragMetaRef.current = {
                        anchorRow: visibleIdx,
                        anchorCol: colIdx,
                        startFocusCol: colIdx,
                        startX,
                        startY,
                        grabOffsetX: 0,
                        grabOffsetY: 0,
                        singleColLock: true,
                        hasMoved: false,
                      };
                      rangeAnchorRef.current = coord;
                      rangeFocusRef.current = coord;
                      lastTouchPointRef.current = { x: startX, y: startY };
                      isHandleDraggingRef.current = true;
                      document.documentElement.style.overscrollBehaviorY = 'none';
                      setIsTouchDragging(true);
                      setSelectedRowIds(new Set());
                      setBulkEditOpen(false);
                      setRangeAnchor(coord);
                      setRangeFocus(coord);
                    };

                    touchStartPosRef.current = { x: startX, y: startY };
                    if (longPressTimerRef.current !== null) {
                      window.clearTimeout(longPressTimerRef.current);
                    }
                    longPressTimerRef.current = window.setTimeout(() => {
                      longPressTimerRef.current = null;
                      beginTouchDrag();
                    }, 260);
                  },
                  onMouseDown: (e: React.MouseEvent<HTMLTableCellElement>) => {
                    if (performance.now() - lastTouchInteractionAtRef.current < 650) {
                      return;
                    }
                    suppressFocusAnchorRef.current = true;
                    window.setTimeout(() => {
                      suppressFocusAnchorRef.current = false;
                    }, 120);
                    if (e.shiftKey && rangeAnchor) {
                      e.preventDefault();
                      setSelectedRowIds(new Set());
                      setRangeFocus({ rowIdx: visibleIdx, colIdx });
                    } else {
                      const geom = captureSheetGeometry();
                      const coord = { rowIdx: visibleIdx, colIdx };
                      if (geom) {
                        dragGeometryRef.current = geom;
                        dragMetaRef.current = {
                          anchorRow: visibleIdx,
                          anchorCol: colIdx,
                          startFocusCol: colIdx,
                          startX: e.clientX,
                          startY: e.clientY,
                          grabOffsetX: 0,
                          grabOffsetY: 0,
                          singleColLock: false,
                          hasMoved: false,
                        };
                        lastTouchPointRef.current = { x: e.clientX, y: e.clientY };
                      }
                      rangeAnchorRef.current = coord;
                      rangeFocusRef.current = coord;
                      isMouseDraggingRef.current = true;
                      setSelectedRowIds(new Set());
                      setRangeAnchor(coord);
                      setRangeFocus(coord);
                    }
                  },
                });

                const handleCellInputFocus = (colIdx: number) => {
                  if (
                    suppressFocusAnchorRef.current ||
                    isMouseDraggingRef.current ||
                    isHandleDraggingRef.current
                  ) {
                    return;
                  }
                  const coord = { rowIdx: visibleIdx, colIdx };
                  rangeAnchorRef.current = coord;
                  rangeFocusRef.current = coord;
                  setSelectedRowIds(new Set());
                  setRangeAnchor(coord);
                  setRangeFocus(coord);
                };

                const isActiveSearchMatch = isNumberSearch && row.id === activeMatchedRowId;
                const isOtherSearchMatch =
                  isNumberSearch && !isActiveSearchMatch && matchedRowIdSet.has(row.id);

                return (
                  <tr
                    key={row.id}
                    data-row-id={row.id}
                    data-row-idx={visibleIdx}
                    className={`transition-colors ${
                      isActiveSearchMatch
                        ? 'bg-amber-100/95 ring-2 ring-inset ring-amber-500'
                        : isOtherSearchMatch
                          ? 'bg-amber-50/85 ring-1 ring-inset ring-amber-300'
                          : isRowSelected
                            ? 'bg-blue-50/90'
                            : row.statusType === 'overlimit'
                              ? 'bg-rose-50/75 hover:bg-rose-50'
                              : visibleIdx % 2 === 1
                                ? 'bg-slate-50/60 hover:bg-indigo-50/35'
                                : 'bg-white hover:bg-indigo-50/35'
                    }`}
                  >
                    <td className="p-0.5 text-center border-r border-slate-200/70">
                      <input
                        type="checkbox"
                        aria-label={`Select row ${row.rowIndex + 2}`}
                        checked={isRowSelected}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleRowCheckbox(row.id, visibleIdx, e.shiftKey);
                        }}
                        onChange={() => {}}
                        className="w-4 h-4 accent-blue-600 cursor-pointer align-middle"
                      />
                    </td>

                    <td className="hidden sm:table-cell px-0.5 py-2 sm:py-2.5 text-center border-r border-slate-200/70 text-[11px] sm:text-[13px] font-semibold font-mono-tabular text-slate-600">
                      {sessionId}
                    </td>

                    <td
                      {...cellMouseProps(0)}
                      className="relative p-0.5 sm:px-1.5 sm:py-1 border-r border-slate-200/70 align-middle"
                    >
                      <div className="relative min-h-[34px] sm:min-h-[36px] flex items-center">
                        <span
                          aria-hidden="true"
                          className={`block w-full px-1 sm:pl-1.5 sm:pr-5 py-1 text-[11px] sm:text-xs leading-[1.2] whitespace-normal break-words pointer-events-none ${
                            isAutofilled
                              ? 'text-slate-400 font-semibold'
                              : row.name
                                ? 'text-slate-900 font-extrabold'
                                : 'text-slate-400 font-medium'
                          }`}
                        >
                          {row.name || (isAutofilled ? `↳ ${row.resolvedName}` : '')}
                        </span>
                        <select
                          aria-label={`Row ${row.rowIndex + 2} Seller Name`}
                          disabled={readOnly}
                          value={row.name}
                          onFocus={() => handleCellInputFocus(0)}
                          onChange={(e) => !readOnly && onUpdateRow(row.id, { name: e.target.value })}
                          className={`absolute inset-0 w-full h-full opacity-0 text-[16px] sm:text-sm rounded-md disabled:cursor-default ${
                            readOnly ? 'cursor-default' : 'cursor-pointer'
                          }`}
                        >
                          <option value="">
                            {isAutofilled ? `↳ ${row.resolvedName}` : ''}
                          </option>
                          {availableNames.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="hidden sm:block w-3.5 h-3.5 text-slate-400 pointer-events-none absolute right-1 top-1/2 -translate-y-1/2" />
                      </div>
                    </td>

                    <td
                      {...cellMouseProps(1)}
                      className="relative p-0 sm:px-1 sm:py-1 border-r border-slate-200/70"
                    >
                      <div className="ios-compact-wrap">
                        <input
                          type="text"
                          disabled={readOnly}
                          list={readOnly ? undefined : `item-options-${sessionId}`}
                          aria-label={`Row ${row.rowIndex + 2} Item`}
                          value={row.item}
                          placeholder={sessionDefaultItem}
                          onFocus={() => handleCellInputFocus(1)}
                          onChange={(e) =>
                            !readOnly &&
                            onUpdateRow(row.id, {
                              item: e.target.value.toUpperCase(),
                              qtyOverride: '',
                              rangeOverride: '',
                            })
                          }
                          onPaste={(e) => handleSmartCellPaste(e, row.id)}
                          className="ios-compact-input w-full px-0 sm:px-1 py-1.5 sm:py-2 text-center text-xs sm:text-sm font-bold font-mono-tabular uppercase text-slate-800 placeholder:text-slate-300 bg-transparent focus:bg-slate-50 rounded-md focus:outline-none disabled:opacity-90"
                        />
                      </div>
                    </td>

                    <td
                      {...cellMouseProps(2)}
                      className="relative p-0 sm:px-1 sm:py-1 border-r border-slate-200/70"
                    >
                      <div className="ios-compact-wrap">
                        <input
                          type="text"
                          disabled={readOnly}
                          inputMode="numeric"
                          data-row-field={`table-start-${row.id}`}
                          aria-label={`Row ${row.rowIndex + 2} Start Number`}
                          value={row.start}
                          placeholder="00000"
                          onFocus={() => handleCellInputFocus(2)}
                          onChange={(e) => {
                            if (readOnly) return;
                            const prevLen = row.start.length;
                            const nextVal = e.target.value.replace(/\D/g, '').slice(0, 5);
                            onUpdateRow(row.id, {
                              start: nextVal,
                              qtyOverride: '',
                              rangeOverride: '',
                            });
                            if (nextVal.length === 5 && prevLen < 5) {
                              focusField(`input[data-row-field="table-end-${row.id}"]`);
                            }
                          }}
                          onPaste={(e) => handleSmartCellPaste(e, row.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              focusField(`input[data-row-field="table-end-${row.id}"]`);
                            }
                          }}
                          className="ios-compact-input w-full px-0.5 sm:px-1 py-1.5 sm:py-2 text-center text-xs sm:text-sm font-bold font-mono-tabular text-slate-900 placeholder:text-slate-300 bg-transparent focus:bg-slate-50 rounded-md focus:outline-none disabled:opacity-90"
                        />
                      </div>
                    </td>

                    <td
                      {...cellMouseProps(3)}
                      className="relative p-0 sm:px-1 sm:py-1 border-r border-slate-200/70"
                    >
                      <div className="ios-compact-wrap">
                        <input
                          type="text"
                          disabled={readOnly}
                          inputMode="numeric"
                          data-row-field={`table-end-${row.id}`}
                          aria-label={`Row ${row.rowIndex + 2} End Number`}
                          value={row.end}
                          placeholder="-"
                          onFocus={() => handleCellInputFocus(3)}
                          onChange={(e) =>
                            !readOnly &&
                            onUpdateRow(row.id, {
                              end: e.target.value.replace(/\D/g, '').slice(0, 5),
                              qtyOverride: '',
                              rangeOverride: '',
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && nextVisibleRow) {
                              e.preventDefault();
                              focusField(`input[data-row-field="table-start-${nextVisibleRow.id}"]`);
                            }
                          }}
                          className="ios-compact-input w-full px-0.5 sm:px-1 py-1.5 sm:py-2 text-center text-xs sm:text-sm font-bold font-mono-tabular text-slate-800 placeholder:text-slate-300 bg-transparent focus:bg-slate-50 rounded-md focus:outline-none disabled:opacity-90"
                        />
                      </div>
                    </td>

                    <td
                      {...cellMouseProps(4)}
                      className={`relative p-0 sm:px-1 sm:py-1 ${pastedQtyClass}`}
                    >
                      <div className="ios-compact-wrap">
                        <input
                          type="number"
                          disabled={readOnly}
                          aria-label={`Row ${row.rowIndex + 2} Qty`}
                          value={row.qtyOverride !== '' ? row.qtyOverride : row.qty || ''}
                          placeholder="0"
                          onFocus={() => handleCellInputFocus(4)}
                          onChange={(e) => !readOnly && onUpdateRow(row.id, { qtyOverride: e.target.value })}
                          className="ios-compact-input w-full px-0.5 sm:px-1.5 py-1.5 sm:py-2 text-center text-xs sm:text-sm font-bold font-mono-tabular text-slate-950 placeholder:text-slate-400 bg-transparent focus:bg-slate-50 rounded-md focus:outline-none disabled:opacity-90"
                        />
                      </div>
                    </td>

                    <td
                      title={row.limitStatus || undefined}
                      className="px-0.5 sm:px-1.5 py-1.5 sm:py-2 border-r border-slate-200/70 text-[10px] sm:text-xs font-mono-tabular text-center align-middle"
                    >
                      {row.statusType === 'ok' && (
                        row.overLimitBreakdowns && row.overLimitBreakdowns.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              AppSounds.tap();
                              setInspectedOverLimitRow(row);
                            }}
                            className="inline-flex items-center justify-center gap-0.5 font-bold text-emerald-700 whitespace-nowrap cursor-pointer hover:opacity-80"
                            title="Tap to see per-seller breakdown"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span>OK</span>
                          </button>
                        ) : (
                          <span className="inline-flex items-center justify-center gap-0.5 font-bold text-emerald-700 whitespace-nowrap">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span>OK</span>
                          </span>
                        )
                      )}
                      {row.statusType === 'warning' && (
                        <span className="inline-flex items-center justify-center gap-0.5 font-bold text-amber-700 whitespace-nowrap">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>OK</span>
                        </span>
                      )}
                      {row.statusType === 'invalid' && (
                        <span className="font-bold text-amber-700 whitespace-nowrap">
                          Invalid
                        </span>
                      )}
                      {row.statusType === 'overlimit' && (
                        <button
                          type="button"
                          onClick={() => {
                            AppSounds.tap();
                            setInspectedOverLimitRow(row);
                          }}
                          className="w-full text-center cursor-pointer hover:opacity-75"
                          title="Tap to see all sellers who contributed to over-limit"
                        >
                          {row.limitStatus.split('\n').map((line, idx) => (
                            <span
                              key={idx}
                              className="block whitespace-nowrap font-extrabold text-slate-950 tracking-[-0.02em] leading-[1.35]"
                            >
                              {line}
                            </span>
                          ))}
                        </button>
                      )}
                    </td>

                    <td className="p-0.5 text-center">
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => {
                            const labelParts = [
                              row.resolvedName || row.name || 'Blank row',
                              row.item || '',
                              row.start ? (row.end ? `${row.start}-${row.end}` : row.start) : '',
                              row.qty > 0 ? `Qty ${row.qty}` : '',
                            ].filter(Boolean);
                            AppSounds.warning();
                            setPendingDeleteConfirm({
                              mode: 'single',
                              rowIds: [row.id],
                              summary: labelParts.join(' · '),
                            });
                          }}
                          title="Delete row"
                          className="p-1 rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 mx-auto" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-xs font-semibold text-slate-600">
                    <span>No entries match the current filter.</span>
                  </td>
                </tr>
              )}
            </tbody>
            {computation.overLimitTotal > 0 && (
              <tfoot className="border-t-2 border-slate-300 bg-slate-50/90 text-[11px] sm:text-xs font-mono-tabular">
                <tr className="border-b border-slate-200/90">
                  <td className="border-r border-slate-200/70 py-1.5" />
                  <td className="hidden sm:table-cell border-r border-slate-200/70 py-1.5" />
                  <td className="border-r border-slate-200/70 py-1.5" />
                  <td className="border-r border-slate-200/70 py-1.5" />
                  <td className="border-r border-slate-200/70 py-1.5" />
                  <td className="border-r border-slate-200/70 py-1.5" />
                  <td className="border-r border-slate-200/70 py-1.5 text-center font-bold text-slate-800">
                    {computation.totalQty}
                  </td>
                  <td className="border-r border-slate-200/70 py-1.5 text-center font-extrabold text-slate-950 whitespace-nowrap">
                    Total {computation.overLimitTotal}
                  </td>
                  <td className="py-1.5" />
                </tr>
                {!hideLimitDispatch && (
                  <tr>
                    <td className="border-r border-slate-200/70 py-1.5" />
                    <td className="hidden sm:table-cell border-r border-slate-200/70 py-1.5" />
                    <td className="border-r border-slate-200/70 py-1.5" />
                    <td className="border-r border-slate-200/70 py-1.5" />
                    <td className="border-r border-slate-200/70 py-1.5" />
                    <td className="border-r border-slate-200/70 py-1.5" />
                    <td className="border-r border-slate-200/70 py-1.5 text-center font-semibold text-slate-400">
                      0
                    </td>
                    <td className="border-r border-slate-200/70 py-1.5 text-center whitespace-nowrap">
                      <a
                        href={computation.waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => AppSounds.success()}
                        className="font-bold text-blue-600 underline hover:text-blue-800 cursor-pointer"
                      >
                        Send limit
                      </a>
                    </td>
                    <td className="py-1.5" />
                  </tr>
                )}
              </tfoot>
            )}
          </table>
          </div>

          {/* Single Persistent Google Sheets Selection Box + Never-Unmounted Corner Handles */}
          {cellRangeBounds && overlayRect && (
            <div
              ref={selectionBoxRef}
              aria-hidden="true"
              style={{
                transform: `translate3d(${overlayRect.left}px, ${overlayRect.top}px, 0)`,
                width: `${overlayRect.width}px`,
                height: `${overlayRect.height}px`,
              }}
              className={`pointer-events-none absolute top-0 left-0 z-10 border-2 border-blue-600 will-change-transform ${
                hasMultiCellRange ? 'bg-blue-500/[0.14]' : 'bg-blue-500/[0.06]'
              }`}
            >
              <span
                key="sheet-handle-tl"
                role="presentation"
                aria-label="Drag selection start handle"
                onTouchStart={(e) => startCornerHandleDrag('topLeft', e)}
                onMouseDown={(e) => startCornerHandleDrag('topLeft', e)}
                className="pointer-events-auto absolute -top-[22px] -left-[22px] w-11 h-11 flex items-center justify-center z-20 touch-none cursor-nwse-resize select-none"
              >
                <span className="w-[11px] h-[11px] rounded-full bg-blue-600 ring-2 ring-white shadow-md pointer-events-none" />
              </span>
              <span
                key="sheet-handle-br"
                role="presentation"
                aria-label="Drag selection end handle"
                onTouchStart={(e) => startCornerHandleDrag('bottomRight', e)}
                onMouseDown={(e) => startCornerHandleDrag('bottomRight', e)}
                className="pointer-events-auto absolute -bottom-[22px] -right-[22px] w-11 h-11 flex items-center justify-center z-20 touch-none cursor-nwse-resize select-none"
              >
                <span className="w-[11px] h-[11px] rounded-full bg-blue-600 ring-2 ring-white shadow-md pointer-events-none" />
              </span>
            </div>
          )}
        </div>
        {isNumberSearch && matchedRowIndices.length > 0 && (
          <div aria-hidden="true" className="h-[38vh] pointer-events-none" />
        )}
        </div>
      ) : (
        /* CARDS VIEW */
        <div ref={cardListRef} className="space-y-3">
          {cardRows.map((row, cardIdx) => {
            const isAutofilled = row.name.trim() === '' && row.resolvedName !== '';
            const nextCardRow = cardRows[cardIdx + 1];
            const isCardSelected = selectedRowIds.has(row.id);
            const isCardPasted = highlightedSet.has(row.id);
            const isCardActiveMatch = isNumberSearch && row.id === activeMatchedRowId;
            const isCardOtherMatch =
              isNumberSearch && !isCardActiveMatch && matchedRowIdSet.has(row.id);
            return (
              <div
                key={row.id}
                data-card-row-id={row.id}
                className={`border rounded-2xl p-3.5 space-y-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
                  isCardActiveMatch
                    ? 'bg-amber-50 border-amber-500 ring-2 ring-amber-400'
                    : isCardOtherMatch
                      ? 'bg-amber-50/50 border-amber-300'
                      : isCardSelected
                        ? 'bg-blue-50/80 border-blue-500 ring-1 ring-blue-500'
                        : isCardPasted
                          ? 'bg-blue-50/45 border-blue-500'
                          : row.statusType === 'overlimit'
                            ? 'bg-rose-50/70 border-rose-200'
                            : 'bg-white border-slate-200/90'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Select row ${row.rowIndex + 2}`}
                    checked={isCardSelected}
                    onClick={(e) => handleToggleRowCheckbox(row.id, cardIdx, e.shiftKey)}
                    onChange={() => {}}
                    className="w-4 h-4 accent-[var(--kk-brand)] cursor-pointer shrink-0"
                  />
                  <span className="text-sm font-bold font-mono-tabular text-slate-700 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
                    {sessionId} · #{row.rowIndex + 2}
                  </span>
                  <select
                    aria-label={`Row ${row.rowIndex + 2} Seller Name`}
                    disabled={readOnly}
                    value={row.name}
                    onChange={(e) => !readOnly && onUpdateRow(row.id, { name: e.target.value })}
                    className={`flex-1 min-w-0 px-2.5 py-2 text-sm font-bold rounded-xl border border-slate-200 focus:border-[var(--kk-brand)] focus:outline-none disabled:opacity-90 ${
                      isAutofilled
                        ? 'text-[var(--kk-brand)] bg-slate-50'
                        : 'text-slate-950 bg-white'
                    }`}
                  >
                    <option value="">
                      {isAutofilled ? `↳ ${row.resolvedName}` : 'Select Seller'}
                    </option>
                    {availableNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        const labelParts = [
                          row.resolvedName || row.name || 'Blank row',
                          row.item || '',
                          row.start ? (row.end ? `${row.start}-${row.end}` : row.start) : '',
                          row.qty > 0 ? `Qty ${row.qty}` : '',
                        ].filter(Boolean);
                        AppSounds.warning();
                        setPendingDeleteConfirm({
                          mode: 'single',
                          rowIds: [row.id],
                          summary: labelParts.join(' · '),
                        });
                      }}
                      title="Delete row"
                      className="p-2 text-slate-600 hover:text-rose-700 bg-slate-100 border border-slate-200 rounded-xl cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold text-slate-600">Item</span>
                    <div className="ios-compact-wrap-md">
                      <input
                        type="text"
                        disabled={readOnly}
                        list={`item-options-${sessionId}`}
                        value={row.item}
                        placeholder={sessionDefaultItem}
                        onChange={(e) =>
                          !readOnly &&
                          onUpdateRow(row.id, {
                            item: e.target.value.toUpperCase(),
                            qtyOverride: '',
                            rangeOverride: '',
                          })
                        }
                        onPaste={(e) => handleSmartCellPaste(e, row.id)}
                        className="ios-compact-input-md w-full px-1.5 py-1.5 text-sm font-bold font-mono-tabular uppercase text-center text-slate-950 bg-slate-50 border border-slate-200 rounded-xl focus:border-[var(--kk-brand)] focus:outline-none disabled:opacity-90"
                      />
                    </div>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold text-slate-600">Start</span>
                    <div className="ios-compact-wrap-md">
                      <input
                        type="text"
                        disabled={readOnly}
                        inputMode="numeric"
                        data-row-field={`card-start-${row.id}`}
                        value={row.start}
                        placeholder="00000"
                        onChange={(e) => {
                          if (readOnly) return;
                          const prevLen = row.start.length;
                          const nextVal = e.target.value.replace(/\D/g, '').slice(0, 5);
                          onUpdateRow(row.id, {
                            start: nextVal,
                            qtyOverride: '',
                            rangeOverride: '',
                          });
                          if (nextVal.length === 5 && prevLen < 5) {
                            focusField(`input[data-row-field="card-end-${row.id}"]`);
                          }
                        }}
                        onPaste={(e) => handleSmartCellPaste(e, row.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            focusField(`input[data-row-field="card-end-${row.id}"]`);
                          }
                        }}
                        className="ios-compact-input-md w-full px-1 py-1.5 text-sm font-bold font-mono-tabular text-center text-slate-950 bg-slate-50 border border-slate-200 rounded-xl focus:border-[var(--kk-brand)] focus:outline-none disabled:opacity-90"
                      />
                    </div>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold text-slate-600">End</span>
                    <div className="ios-compact-wrap-md">
                      <input
                        type="text"
                        disabled={readOnly}
                        inputMode="numeric"
                        data-row-field={`card-end-${row.id}`}
                        value={row.end}
                        placeholder="-"
                        onChange={(e) =>
                          !readOnly &&
                          onUpdateRow(row.id, {
                            end: e.target.value.replace(/\D/g, '').slice(0, 5),
                            qtyOverride: '',
                            rangeOverride: '',
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && nextCardRow) {
                            e.preventDefault();
                            focusField(`input[data-row-field="card-start-${nextCardRow.id}"]`);
                          }
                        }}
                        className="ios-compact-input-md w-full px-1 py-1.5 text-sm font-bold font-mono-tabular text-center text-slate-950 bg-slate-50 border border-slate-200 rounded-xl focus:border-[var(--kk-brand)] focus:outline-none disabled:opacity-90"
                      />
                    </div>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold text-slate-600">Qty</span>
                    <div className="ios-compact-wrap-md">
                      <input
                        type="number"
                        disabled={readOnly}
                        value={row.qtyOverride !== '' ? row.qtyOverride : row.qty || ''}
                        placeholder="0"
                        onChange={(e) => !readOnly && onUpdateRow(row.id, { qtyOverride: e.target.value })}
                        className="ios-compact-input-md w-full px-1 py-1.5 text-sm font-bold font-mono-tabular text-right text-slate-950 bg-slate-50 border border-slate-200 rounded-xl focus:border-[var(--kk-brand)] focus:outline-none disabled:opacity-90"
                      />
                    </div>
                  </label>
                </div>

                {row.statusType !== 'empty' && (
                  <div className="pt-2 border-t border-slate-200 text-sm font-mono-tabular">
                    {row.statusType === 'ok' && (
                      <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Limit Status: OK</span>
                      </span>
                    )}
                    {row.statusType === 'warning' && (
                      <span className="inline-flex items-center gap-1 font-bold text-amber-800">
                        <AlertTriangle className="w-4 h-4" />
                        <span>OK (Merged on last row)</span>
                      </span>
                    )}
                    {row.statusType === 'invalid' && (
                      <span className="inline-flex items-center gap-1 font-bold text-amber-800">
                        <AlertTriangle className="w-4 h-4" />
                        <span>Invalid Qty / End</span>
                      </span>
                    )}
                    {row.statusType === 'overlimit' && (
                      <div className="space-y-1.5">
                        <div className="font-bold text-rose-700 whitespace-pre-line">
                          {row.limitStatus}
                        </div>
                        {row.overLimitBreakdowns && row.overLimitBreakdowns.length > 0 && (
                          <div className="space-y-1 font-sans">
                            {row.overLimitBreakdowns.map((grp) => (
                              <div key={grp.id} className="flex flex-wrap items-center gap-1.5">
                                <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white text-xs font-mono-tabular font-bold">
                                  {grp.startNum} Total {grp.totalQtyPerNum}
                                </span>
                                {grp.sellers.map((s) => (
                                  <span
                                    key={s.sellerName}
                                    className="px-2 py-0.5 rounded-md bg-white border border-rose-200 text-xs font-bold text-slate-900"
                                  >
                                    {s.sellerName}:{' '}
                                    <span className="font-mono-tabular text-rose-700">{s.qty}</span>
                                  </span>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Google Sheets-style Floating fx Live Calculation Bar (manual drag selection OR newly pasted data sum) */}
      <AnimatePresence>
        {hasSelection && selectionCalc ? (
          <motion.div
            key="fx-selection-bar"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
            role="region"
            aria-label="Selection actions"
            className={`fixed bottom-[calc(4.85rem+env(safe-area-inset-bottom))] left-2 right-2 lg:left-auto lg:right-6 lg:bottom-5 z-40 bg-white text-slate-900 border border-slate-300 rounded-2xl shadow-2xl overflow-hidden ${
              isTouchDragging ? 'pointer-events-none' : ''
            }`}
          >
            {/* Google Sheets fx Stats Row: fx | SUM | AVG | MAX | MIN | COUNT */}
            <div className="flex items-stretch border-b border-slate-200 bg-white overflow-x-auto no-scrollbar font-mono-tabular">
              <div className="shrink-0 px-3 py-2 flex items-center justify-center border-r border-slate-200 bg-slate-50">
                <span className="font-serif italic font-extrabold text-base text-blue-600 select-none">
                  fx
                </span>
              </div>
              {selectionCalc.numericCount > 0 ? (
                <>
                  <div className="shrink-0 px-3 py-2 border-r border-slate-200 text-xs font-extrabold text-slate-950 whitespace-nowrap bg-blue-50/60">
                    SUM: <span className="text-blue-700">{formatINR(selectionCalc.sum)}</span>
                  </div>
                  <div className="shrink-0 px-3 py-2 border-r border-slate-200 text-xs font-bold text-slate-700 whitespace-nowrap">
                    AVG: {formatINR(selectionCalc.avg)}
                  </div>
                  <div className="shrink-0 px-3 py-2 border-r border-slate-200 text-xs font-bold text-slate-700 whitespace-nowrap">
                    MAX: {formatINR(selectionCalc.max)}
                  </div>
                  <div className="shrink-0 px-3 py-2 border-r border-slate-200 text-xs font-bold text-slate-700 whitespace-nowrap">
                    MIN: {formatINR(selectionCalc.min)}
                  </div>
                  <div className="shrink-0 px-3 py-2 text-xs font-bold text-slate-600 whitespace-nowrap">
                    COUNT: {selectionCalc.count}
                  </div>
                </>
              ) : (
                <div className="px-3 py-2 text-xs font-sans font-bold text-slate-700 whitespace-nowrap">
                  COUNT: {selectionCalc.count} {selectionCalc.mode === 'rows' ? 'rows' : 'cells'}
                </div>
              )}
            </div>

            {!isTouchDragging && (
              <div className="px-2.5 py-2 bg-[var(--kk-brand)] text-white flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                  {selectedRowIds.size >= 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        AppSounds.tap();
                        setRangeSelectMode((v) => !v);
                      }}
                      className={`shrink-0 px-2.5 py-1.5 text-[11px] font-bold rounded-xl cursor-pointer border ${
                        rangeSelectMode
                          ? 'bg-sky-400 text-slate-950 border-sky-300'
                          : 'bg-white/15 hover:bg-white/25 text-white border-white/25'
                      }`}
                    >
                      {rangeSelectMode ? 'Tap End Row...' : 'Range'}
                    </button>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={handleOpenBulkEdit}
                      className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-xl cursor-pointer transition-colors ${
                        bulkEditOpen
                          ? 'bg-sky-400 text-slate-950'
                          : 'bg-white/15 hover:bg-white/25 text-white'
                      }`}
                    >
                      <Pencil className="w-3 h-3" />
                      <span>Edit</span>
                    </button>
                  )}
                  {!readOnly && selectionCalc.canFillDown && (
                    <button
                      type="button"
                      onClick={handleFillDownSelection}
                      className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl cursor-pointer"
                    >
                      <ArrowDown className="w-3 h-3" />
                      <span>Fill ↓</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleCopySelectionOrSheet()}
                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold bg-white text-[var(--kk-brand)] hover:bg-indigo-50 rounded-xl cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </button>
                  {!readOnly && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleCutSelection()}
                        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold bg-white/15 hover:bg-white/25 text-white rounded-xl cursor-pointer"
                      >
                        <Scissors className="w-3 h-3" />
                        <span>Cut</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handlePasteAtSelection()}
                        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold bg-indigo-500/40 hover:bg-indigo-500/60 border border-indigo-300/30 text-white rounded-xl cursor-pointer"
                      >
                        <ClipboardPaste className="w-3 h-3" />
                        <span>Paste</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleClearSelection}
                        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl cursor-pointer"
                      >
                        <Eraser className="w-3 h-3" />
                        <span>Clear</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteSelectedRows}
                        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Delete</span>
                      </button>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={clearSelection}
                  aria-label="Clear selection"
                  className="shrink-0 p-1 text-white/80 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {bulkEditOpen && !isTouchDragging && !readOnly && (
              <form
                onSubmit={handleApplyBulkEdit}
                className="flex items-center gap-2 px-2.5 py-2 bg-[var(--kk-brand)] border-t border-white/15"
              >
                {hasMultiCellRange && cellRangeBounds?.minCol === 0 && cellRangeBounds?.maxCol === 0 ? (
                  <select
                    value={bulkEditValue}
                    onChange={(e) => setBulkEditValue(e.target.value)}
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-sm font-bold text-slate-950 bg-white rounded-xl focus:outline-none"
                  >
                    <option value="">-- Select Seller --</option>
                    {availableNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    autoFocus
                    value={bulkEditValue}
                    onChange={(e) => setBulkEditValue(e.target.value)}
                    placeholder={
                      hasMultiCellRange && cellRangeBounds
                        ? `New ${EDITABLE_COLS[cellRangeBounds.minCol] === 'qtyOverride' ? 'Qty' : EDITABLE_COLS[cellRangeBounds.minCol].toUpperCase()} value...`
                        : 'New Item (e.g. E10)...'
                    }
                    className="flex-1 min-w-0 px-3 py-1.5 text-sm font-bold font-mono-tabular uppercase text-slate-950 bg-white rounded-xl focus:outline-none"
                  />
                )}
                <button
                  type="submit"
                  className="px-3.5 py-1.5 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-xl cursor-pointer shrink-0"
                >
                  Apply
                </button>
              </form>
            )}
          </motion.div>
        ) : pastedSummary ? (
          <motion.div
            key="fx-pasted-bar"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
            role="region"
            aria-label="Newly pasted data sum"
            className="fixed bottom-[calc(4.85rem+env(safe-area-inset-bottom))] left-2 right-2 lg:left-auto lg:right-6 lg:bottom-5 z-40 bg-[var(--kk-brand)] text-white border border-blue-400/40 rounded-2xl px-3 py-2 shadow-xl flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono-tabular">
              <span className="px-1.5 py-0.5 rounded-md bg-blue-500/35 border border-blue-400/50 font-extrabold italic text-sky-200">
                fx
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/25 border border-emerald-400/40 text-emerald-200 font-extrabold">
                <Calculator className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                <span>SUM: {formatINR(pastedSummary.qtySum)}</span>
              </span>
            </div>
            {onDismissPasteHighlight && (
              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  onDismissPasteHighlight();
                }}
                aria-label="Clear pasted sum bar"
                className="px-2.5 py-1 text-[11px] font-bold bg-white/15 hover:bg-white/25 text-white rounded-xl cursor-pointer ml-auto"
              >
                OK
              </button>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Over-Limit Contributor Inspector Modal */}
      <AnimatePresence>
        {inspectedOverLimitRow && inspectedOverLimitRow.overLimitBreakdowns && (
          <motion.div
            key="overlimit-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 backdrop-blur-[2px] p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Over-limit seller details"
            onClick={() => setInspectedOverLimitRow(null)}
          >
            <motion.div
              key="overlimit-modal-card"
              initial={{ opacity: 0, scale: 0.92, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 10 }}
              transition={{ type: 'spring', stiffness: 460, damping: 32 }}
              className="w-full max-w-md bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-gradient-to-r from-rose-900 via-rose-800 to-red-800 text-white px-4 py-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-rose-200 shrink-0" />
                    <span>Over-Limit Sellers Details</span>
                  </div>
                  <div className="text-[11px] text-rose-100 mt-0.5 truncate">
                    Row #{inspectedOverLimitRow.rowIndex + 2} · {inspectedOverLimitRow.resolvedName || 'Row'} ({inspectedOverLimitRow.item} {inspectedOverLimitRow.start}{inspectedOverLimitRow.end ? `-${inspectedOverLimitRow.end}` : ''})
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    AppSounds.tap();
                    setInspectedOverLimitRow(null);
                  }}
                  aria-label="Close over-limit details"
                  className="p-1.5 rounded-lg hover:bg-white/15 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 space-y-3 max-h-[65vh] overflow-y-auto">
                {inspectedOverLimitRow.overLimitBreakdowns.map((grp) => {
                  const numLabel =
                    grp.startNum === grp.endNum
                      ? grp.startNum
                      : `${grp.startNum}–${grp.endNum}`;
                  return (
                    <div
                      key={grp.id}
                      className="border border-rose-200/90 bg-rose-50/35 rounded-xl p-3 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-lg bg-[var(--kk-brand)] text-white text-xs font-extrabold font-mono-tabular">
                            {numLabel}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[11px] font-extrabold font-mono-tabular">
                            {sessionPrefix}{grp.excessQtyPerNum} over
                          </span>
                        </div>
                        <span className="text-xs font-bold font-mono-tabular text-slate-700">
                          Total {grp.totalQtyPerNum} / {limitThreshold}
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        {grp.sellers.map((s) => (
                          <div
                            key={s.sellerName}
                            className="bg-white border border-slate-200/90 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-bold text-slate-950 truncate">
                                {s.sellerName}
                              </span>
                              <span className="text-[10px] font-mono-tabular font-semibold text-slate-500">
                                {s.items.join(', ')} · {s.rowCount} {s.rowCount === 1 ? 'row' : 'rows'}
                              </span>
                            </div>
                            <span className="font-mono-tabular font-extrabold text-rose-700 shrink-0">
                              Qty {s.qty}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      const sellerList: string[] = [];
                      for (const grp of inspectedOverLimitRow.overLimitBreakdowns || []) {
                        for (const s of grp.sellers) {
                          if (!sellerList.includes(s.sellerName)) sellerList.push(s.sellerName);
                        }
                      }
                      setStatusFilter('overlimit');
                      if (sellerList.length === 1) {
                        setSearchQuery(sellerList[0]);
                      }
                      setInspectedOverLimitRow(null);
                    }}
                    className="px-3 py-1.5 text-xs font-bold text-white kk-brand-gradient rounded-xl cursor-pointer"
                  >
                    Show Over-Limit Rows
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      setInspectedOverLimitRow(null);
                    }}
                    className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Row Delete Permission Confirmation Modal */}
      <AnimatePresence>
        {pendingDeleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4"
            onClick={() => {
              AppSounds.tap();
              setPendingDeleteConfirm(null);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: 'spring', stiffness: 460, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="px-4 py-3.5 bg-rose-50 border-b border-rose-200 flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-rose-100 text-rose-700 shrink-0">
                  <Trash2 className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm font-extrabold text-rose-950">
                    {pendingDeleteConfirm.mode === 'bulk'
                      ? `Delete ${pendingDeleteConfirm.rowIds.length} Rows?`
                      : 'Delete Entry Row?'}
                  </h3>
                  <p className="text-[11px] font-semibold text-rose-800">
                    Permission required before deleting
                  </p>
                </div>
              </div>

              <div className="p-4 space-y-3">
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold font-mono-tabular text-slate-900">
                  {pendingDeleteConfirm.summary}
                </div>
                <p className="text-xs font-medium text-slate-600">
                  Kya aap is entry ko delete karna chahte hain?
                </p>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      setPendingDeleteConfirm(null);
                    }}
                    className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.remove();
                      if (pendingDeleteConfirm.mode === 'single') {
                        onDeleteRow(pendingDeleteConfirm.rowIds[0]);
                      } else {
                        onDeleteRows(pendingDeleteConfirm.rowIds);
                        showPasteNotice(
                          `Deleted ${pendingDeleteConfirm.rowIds.length} row${pendingDeleteConfirm.rowIds.length > 1 ? 's' : ''}`
                        );
                        clearSelection();
                      }
                      setPendingDeleteConfirm(null);
                    }}
                    className="px-3.5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl cursor-pointer transition-colors"
                  >
                    Yes, Delete
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
