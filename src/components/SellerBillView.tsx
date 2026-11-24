import { AlertTriangle, ArrowUpRight, Check, Copy, ExternalLink, Eye, EyeOff, FileText, LayoutGrid, Loader2, Plus, RotateCcw, Send, ShieldAlert, Table2, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useMemo, useState } from 'react';
import { formatDateDDMMYYYY, formatINR, formatLimitGroup, isMyChoiceName, round2 } from '../engine/calculations';
import { OverLimitBreakdownGroup, Seller, SellerBillRow, SessionComputation, SessionId } from '../types/ledger';
import { BillReceiptPayload, sendBillCardDirectToWhatsApp } from '../utils/billImageGenerator';
import { AppSounds } from '../utils/sound';
import { ActiveFormulaSession, FormulaNumberInput, SheetFormulaBar } from './FormulaNumberInput';

/** Bill tab only separates entries whose output limit ("jo limit nikla") is strictly > 10 (e.g. M15, M20=61070; NOT M5 or M10). */
const BILL_EXCESS_LIMIT_CUTOFF = 10;

const SESSION_META: Record<SessionId, { label: string; badgeClass: string }> = {
  '1PM': { label: '1PM Morning', badgeClass: 'bg-indigo-950 text-amber-300' },
  '6PM': { label: '6PM Day', badgeClass: 'bg-sky-900 text-sky-100' },
  '8PM': { label: '8PM Evening', badgeClass: 'bg-slate-900 text-emerald-300' },
};

function formatGroupLimitCode(prefix: string, grp: OverLimitBreakdownGroup): string {
  if (grp.startNum === grp.endNum) {
    return `${prefix}${grp.excessQtyPerNum}=${grp.startNum}`;
  }
  const rangeLabel =
    grp.startNum.slice(0, 3) === grp.endNum.slice(0, 3)
      ? `${grp.startNum}-${grp.endNum.slice(-2)}`
      : `${grp.startNum}-${grp.endNum}`;
  const lineSum = round2(grp.excessQtyPerNum * grp.count);
  return `${prefix}${grp.excessQtyPerNum}=${rangeLabel}=${lineSum}`;
}

interface SellerBillViewProps {
  date: string;
  onChangeDate: (newDate: string) => void;
  bills: SellerBillRow[];
  onUpdateSeller: (sellerId: string, patch: Partial<Seller>) => void;
  onAddSeller: (seller: Omit<Seller, 'id'>) => void;
  onDeleteSeller: (sellerId: string) => void;
  onRolloverDay: () => void;
  onPreviewMessage: (
    title: string,
    subtitle: string,
    message: string,
    waUrl: string,
    billData?: BillReceiptPayload
  ) => void;
  hideRollover?: boolean;
  readOnlyDate?: boolean;
  lockedSellerId?: string;
  sessionComputations?: Record<SessionId, SessionComputation>;
  limitThreshold?: number;
  onOpenSession?: (sessionId: SessionId) => void;
}

export function SellerBillView({
  date,
  bills,
  onUpdateSeller,
  onAddSeller,
  onDeleteSeller,
  onRolloverDay,
  onPreviewMessage,
  hideRollover = false,
  lockedSellerId,
  sessionComputations,
  limitThreshold = 10,
  onOpenSession,
}: SellerBillViewProps) {
  const [viewMode, setViewMode] = useState<'all' | 'cards' | 'limit'>('all');
  const [limitSessionFilter, setLimitSessionFilter] = useState<'ALL' | SessionId>('ALL');
  const [copiedLimitKey, setCopiedLimitKey] = useState<string | null>(null);
  const [showRateMobile, setShowRateMobile] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMobile, setNewMobile] = useState('91');
  const [newRate, setNewRate] = useState('10');
  const [newDue, setNewDue] = useState(0);
  const [confirmRollover, setConfirmRollover] = useState(false);
  const [activeFormula, setActiveFormula] = useState<ActiveFormulaSession | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    seller: SellerBillRow;
    step: 1 | 2;
  } | null>(null);
  const [sendingBillId, setSendingBillId] = useState<string | null>(null);
  const [waCardToast, setWaCardToast] = useState<{
    message: string;
    waUrl: string;
  } | null>(null);

  const handleActiveFormulaChange = useCallback(
    (session: ActiveFormulaSession | null, ownerId: string) => {
      if (session === null) {
        setActiveFormula((prev) => (prev && prev.id === ownerId ? null : prev));
      } else {
        setActiveFormula(session);
      }
    },
    []
  );

  const requestDeleteSeller = (seller: SellerBillRow) => {
    if (lockedSellerId && seller.id === lockedSellerId) return;
    AppSounds.warning();
    setDeleteConfirm({ seller, step: 1 });
  };

  const openBillPreview = (row: SellerBillRow) => {
    AppSounds.tap();
    const dateStr = formatDateDDMMYYYY(date);
    onPreviewMessage(
      `${row.name} — Bill Card`,
      `${dateStr} • Net ₹${formatINR(row.total)}`,
      row.waMessage,
      '',
      { bill: row, dateStr }
    );
  };

  const handleSendBillCard = async (row: SellerBillRow) => {
    if (sendingBillId) return;
    const dateStr = formatDateDDMMYYYY(date);
    setSendingBillId(row.id);
    try {
      const res = await sendBillCardDirectToWhatsApp({ bill: row, dateStr });
      AppSounds.success();
      const msg =
        res.method === 'copied_direct'
          ? res.hasNumber
            ? `${row.name} ka Bill Card copy ho gaya — WhatsApp chat me bas Paste → Send karein.`
            : `${row.name} ka Bill Card copy ho gaya — WhatsApp me Paste karein (number Rate & Mob me add karein).`
          : `${row.name} ka Bill Card PNG save ho gaya — WhatsApp chat me attach karke bhej dein.`;
      setWaCardToast({ message: msg, waUrl: res.waUrl });
      window.setTimeout(() => {
        setWaCardToast((curr) => (curr?.message === msg ? null : curr));
      }, 6500);
    } catch {
      openBillPreview(row);
    } finally {
      setSendingBillId(null);
    }
  };

  const visibleBills = useMemo(
    () => bills.filter((b) => !isMyChoiceName(b.name)),
    [bills]
  );

  const overLimitSummary = useMemo(() => {
    const order: SessionId[] = ['1PM', '6PM', '8PM'];
    const sessions = order.map((sid) => {
      const comp = sessionComputations?.[sid];
      const prefix = comp?.prefix ?? (sid === '1PM' ? 'M' : sid === '6PM' ? 'D' : 'E');
      const allGroups = comp?.overLimitGroups ?? [];
      // Only include entries where the calculated limit output itself is > 10 (e.g. M15, M20=61070 — NOT M5 or M10)
      const groups = allGroups.filter(
        (g) => g.excessQtyPerNum > BILL_EXCESS_LIMIT_CUTOFF + 0.001
      );
      const numberCount = groups.reduce((acc, g) => acc + g.count, 0);

      // Build exact sheet-style limit lines and total ONLY from these >10 limit-output entries
      const numsByExcess = new Map<number, number[]>();
      for (const grp of groups) {
        const key = round2(grp.excessQtyPerNum);
        let arr = numsByExcess.get(key);
        if (!arr) {
          arr = [];
          numsByExcess.set(key, arr);
        }
        for (let n = grp.startInt; n <= grp.endInt; n++) {
          arr.push(n);
        }
      }

      const sortedExcessKeys = Array.from(numsByExcess.keys()).sort((a, b) => a - b);
      const formattedLines: string[] = [];
      let filteredTotal = 0;
      for (const limVal of sortedExcessKeys) {
        const nums = (numsByExcess.get(limVal) || []).sort((a, b) => a - b);
        if (nums.length === 0) continue;
        const info = formatLimitGroup(limVal, nums, prefix);
        formattedLines.push(info.text);
        filteredTotal += info.lineTotal;
      }
      filteredTotal = round2(filteredTotal);

      const waLines = [...formattedLines];
      if (filteredTotal > 0) {
        waLines.push(`Total ${filteredTotal}`);
      }
      const waMessage = waLines.join('\n');
      const waBase = comp?.waUrl ? comp.waUrl.split('?')[0] : '';
      const waUrl =
        filteredTotal > 0 && waBase
          ? `${waBase}?text=${encodeURIComponent(waMessage)}`
          : '';

      return {
        sessionId: sid,
        prefix,
        overLimitTotal: filteredTotal,
        groups,
        numberCount,
        waMessage,
        waUrl,
      };
    });
    const activeSessions = sessions.filter((s) => s.overLimitTotal > 0);
    const grandTotal = round2(activeSessions.reduce((acc, s) => acc + s.overLimitTotal, 0));
    const totalNumbers = activeSessions.reduce((acc, s) => acc + s.numberCount, 0);
    const combinedCopyText =
      activeSessions.length === 1
        ? activeSessions[0].waMessage
        : activeSessions
            .map((s) => `${s.sessionId} (${s.prefix})\n${s.waMessage}`)
            .join('\n\n');
    return {
      sessions,
      activeSessions,
      grandTotal,
      totalNumbers,
      combinedCopyText,
    };
  }, [sessionComputations]);

  const handleCopyLimitText = useCallback(async (key: string, text: string) => {
    if (!text) return;
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
    AppSounds.success();
    setCopiedLimitKey(key);
    window.setTimeout(() => {
      setCopiedLimitKey((curr) => (curr === key ? null : curr));
    }, 1800);
  }, []);

  const totals = visibleBills.reduce(
    (acc, row) => ({
      mor: acc.mor + row.mor,
      day: acc.day + row.day,
      eve: acc.eve + row.eve,
      sold: acc.sold + row.sold,
      bill: acc.bill + row.bill,
      prize: acc.prize + row.prizeTotal,
      fresh: acc.fresh + row.fresh,
      amt1pm: acc.amt1pm + row.amt1pm,
      amt6pm: acc.amt6pm + row.amt6pm,
      amt8pm: acc.amt8pm + row.amt8pm,
      joma: acc.joma + row.joma,
      due: acc.due + row.due,
      total: acc.total + row.total,
      rate: acc.rate + row.rate,
    }),
    {
      mor: 0,
      day: 0,
      eve: 0,
      sold: 0,
      bill: 0,
      prize: 0,
      fresh: 0,
      amt1pm: 0,
      amt6pm: 0,
      amt8pm: 0,
      joma: 0,
      due: 0,
      total: 0,
      rate: 0,
    }
  );

  const handleCreateSeller = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim().toUpperCase();
    if (!trimmed) return;
    AppSounds.add();
    onAddSeller({
      name: trimmed,
      mobile: newMobile.trim(),
      rate: parseFloat(newRate) || 10,
      due: newDue || 0,
      joma: 0,
    });
    setNewName('');
    setNewMobile('91');
    setNewRate('10');
    setNewDue(0);
    setShowAddForm(false);
  };

  return (
    <div className="space-y-1.5 sm:space-y-3">
      <AnimatePresence>
        {waCardToast && (
          <motion.div
            key="wa-card-toast"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-2xl px-3.5 py-2.5 text-xs font-bold flex items-center justify-between gap-2 shadow-xs"
          >
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* Executive KPI Summary Strip */}
      <section aria-label="Daily agency summary" className="grid grid-cols-2 lg:grid-cols-5 gap-1.5 sm:gap-2.5">
        <div className="kk-surface-card rounded-2xl px-2.5 py-1.5 sm:px-4 sm:py-3">
          <div className="text-[10.5px] sm:text-[11px] font-semibold text-slate-500 leading-tight">Total Tickets Sold</div>
          <div className="mt-0.5 sm:mt-1 text-base sm:text-xl font-bold font-mono-tabular text-slate-950 leading-tight">
            {formatINR(totals.sold)}
          </div>
        </div>
        <div className="kk-surface-card rounded-2xl px-2.5 py-1.5 sm:px-4 sm:py-3">
          <div className="text-[10.5px] sm:text-[11px] font-semibold text-slate-500 leading-tight">Gross Bill</div>
          <div className="mt-0.5 sm:mt-1 text-base sm:text-xl font-bold font-mono-tabular text-slate-950 leading-tight">
            ₹{formatINR(totals.bill)}
          </div>
        </div>
        <div className="kk-surface-card rounded-2xl px-2.5 py-1.5 sm:px-4 sm:py-3">
          <div className="text-[10.5px] sm:text-[11px] font-semibold text-slate-500 leading-tight">Seller Prizes (-)</div>
          <div className="mt-0.5 sm:mt-1 text-base sm:text-xl font-bold font-mono-tabular text-emerald-700 leading-tight">
            ₹{formatINR(totals.prize)}
          </div>
        </div>
        <div className="kk-surface-card rounded-2xl px-2.5 py-1.5 sm:px-4 sm:py-3">
          <div className="text-[10.5px] sm:text-[11px] font-semibold text-slate-500 leading-tight">Fresh Bill (=)</div>
          <div
            className={`mt-0.5 sm:mt-1 text-base sm:text-xl font-bold font-mono-tabular leading-tight ${
              totals.fresh > 0
                ? 'text-emerald-700'
                : totals.fresh < 0
                  ? 'text-rose-600'
                  : 'text-slate-950'
            }`}
          >
            ₹{formatINR(totals.fresh)}
          </div>
        </div>
        <div className="col-span-2 lg:col-span-1 kk-brand-gradient text-white rounded-2xl px-4 py-2.5 sm:px-5 sm:py-4 flex flex-col items-center justify-center text-center">
          <div className="text-xs sm:text-[13px] font-semibold tracking-wide text-white/80">
            Net Payable Total
          </div>
          <div
            className={`mt-0.5 sm:mt-1 text-3xl sm:text-[32px] lg:text-2xl xl:text-[28px] leading-tight font-extrabold font-mono-tabular tracking-tight ${
              totals.total > 0
                ? 'text-emerald-300'
                : totals.total < 0
                  ? 'text-rose-300'
                  : 'text-white'
            }`}
          >
            ₹{formatINR(totals.total)}
          </div>
        </div>
      </section>

      {/* Toolbar */}
      <div className="kk-surface-card flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 rounded-2xl px-2 py-1.5 sm:px-3 sm:py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 border border-slate-200 rounded-xl">
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                setViewMode('all');
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${
                viewMode === 'all' ? 'bg-white text-[var(--kk-brand)] shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              <span>All Cols</span>
            </button>
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                setViewMode('cards');
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${
                viewMode === 'cards' ? 'bg-white text-[var(--kk-brand)] shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Cards</span>
            </button>
            {sessionComputations && (
              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  setViewMode('limit');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${
                  viewMode === 'limit'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : overLimitSummary.grandTotal > 0
                      ? 'text-rose-700 hover:text-rose-900 bg-rose-50/90'
                      : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Limit &gt;{BILL_EXCESS_LIMIT_CUTOFF}</span>
                {overLimitSummary.grandTotal > 0 && (
                  <span
                    className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono-tabular font-extrabold ${
                      viewMode === 'limit'
                        ? 'bg-white/20 text-white'
                        : 'bg-rose-600 text-white'
                    }`}
                  >
                    {formatINR(overLimitSummary.grandTotal)}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              AppSounds.tap();
              setShowRateMobile((prev) => !prev);
            }}
            title={showRateMobile ? 'Hide Rate & Mobile Number' : 'Show Rate & Mobile Number'}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold border rounded-xl cursor-pointer whitespace-nowrap transition-colors ${
              showRateMobile
                ? 'text-[var(--kk-brand)] bg-indigo-50 border-indigo-300'
                : 'text-slate-700 bg-slate-100 hover:bg-slate-200 border-slate-200'
            }`}
          >
            {showRateMobile ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{showRateMobile ? 'Hide Rate/Mob' : 'Rate & Mob'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              AppSounds.tap();
              setShowAddForm((prev) => !prev);
            }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Seller</span>
          </button>

          {!hideRollover &&
            (!confirmRollover ? (
              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  setConfirmRollover(true);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-[var(--kk-brand)] hover:bg-[var(--kk-brand-hover)] rounded-xl cursor-pointer whitespace-nowrap transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Close Day</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-300 rounded-xl px-2.5 py-1">
                <span className="text-[11px] font-bold text-amber-950">Carry +Total→DUE, -Total→JOMA?</span>
                <button
                  type="button"
                  onClick={() => {
                    onRolloverDay();
                    setConfirmRollover(false);
                  }}
                  className="px-2 py-0.5 text-[11px] font-bold text-white bg-amber-700 hover:bg-amber-800 rounded-lg cursor-pointer"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRollover(false)}
                  className="px-1.5 py-0.5 text-[11px] font-bold text-slate-800 cursor-pointer"
                >
                  No
                </button>
              </div>
            ))}
        </div>
      </div>

      {/* Inline Add Seller Form */}
      {showAddForm && (
        <form
          onSubmit={handleCreateSeller}
          className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-xs grid grid-cols-2 sm:flex sm:flex-wrap items-end gap-2.5"
        >
          <label className="flex flex-col gap-1 text-xs font-bold text-slate-800">
            <span>Seller Name</span>
            <input
              type="text"
              required
              placeholder="RAHUL"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-950 bg-slate-50 border border-slate-200 rounded-xl uppercase sm:w-36 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-slate-800">
            <span>WhatsApp Mobile</span>
            <input
              type="text"
              placeholder="919876543210"
              value={newMobile}
              onChange={(e) => setNewMobile(e.target.value)}
              className="px-3 py-1.5 text-xs font-semibold font-mono-tabular text-slate-950 bg-slate-50 border border-slate-200 rounded-xl sm:w-36 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-slate-800">
            <span>Rate (₹)</span>
            <input
              type="number"
              step="0.05"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              className="px-3 py-1.5 text-xs font-semibold font-mono-tabular text-slate-950 bg-slate-50 border border-slate-200 rounded-xl sm:w-20 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-slate-800">
            <span>Due (₹)</span>
            <FormulaNumberInput
              id="new-seller-due"
              label="NEW · DUE"
              value={newDue}
              onCommit={(val) => setNewDue(val)}
              onActiveSessionChange={handleActiveFormulaChange}
              placeholder="0"
              className="px-3 py-1.5 text-xs font-semibold font-mono-tabular text-slate-950 bg-slate-50 border border-slate-200 rounded-xl sm:w-28 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
            />
          </label>
          <div className="col-span-2 flex items-center gap-2">
            <button
              type="submit"
              className="px-4 py-1.5 text-xs font-bold text-white bg-[var(--kk-brand)] hover:bg-[var(--kk-brand-hover)] rounded-xl cursor-pointer"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ALL COLUMNS MODE — Screen 1 fits NAME→FRESH edge-to-edge on mobile, sticky thead & sticky bottom TOTAL always visible on screen */}
      {viewMode === 'all' ? (
        <div className="kk-surface-card rounded-2xl overflow-hidden mb-1 sm:mb-3">
          <div className="max-h-[calc(100dvh-460px)] min-h-[220px] sm:max-h-[65vh] overflow-auto overscroll-contain ledger-scroll">
            <table className="w-max min-w-full sm:min-w-[860px] border-collapse text-[13px] sm:text-[14px]">
              <thead className="sticky top-0 z-20">
                <tr className="kk-table-head text-slate-100 text-[11px] sm:text-xs font-bold uppercase tracking-[0.02em] sm:tracking-[0.04em] align-middle">
                  <th className="bill-col-name sticky top-0 left-0 z-30 bg-[var(--kk-brand)] sm:min-w-[124px] px-2 sm:px-3 py-2 sm:py-3 text-left border-r border-white/15 whitespace-nowrap shadow-[2px_0_6px_-2px_rgba(0,0,0,0.28)]">
                    NAME
                  </th>
                  <th className="bill-col-sess bg-[var(--kk-brand)] px-1 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">MOR</th>
                  <th className="bill-col-sess bg-[var(--kk-brand)] px-1 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">DAY</th>
                  <th className="bill-col-sess bg-[var(--kk-brand)] px-1 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">EVE</th>
                  <th className="bill-col-sold bg-[var(--kk-brand)] px-1 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">SOLD</th>
                  <th className="bill-col-bill bg-[var(--kk-brand)] px-1 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">BILL</th>
                  <th className="bill-col-fresh bg-[var(--kk-brand)] px-1.5 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">FRESH</th>
                  <th className="bg-[var(--kk-brand)] px-2 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">1PM ₹</th>
                  <th className="bg-[var(--kk-brand)] px-2 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">6PM ₹</th>
                  <th className="bg-[var(--kk-brand)] px-2 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">8PM ₹</th>
                  <th className="bg-[var(--kk-brand)] px-2 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">
                    JOMA<span className="hidden sm:inline"> (-)</span>
                  </th>
                  <th className="bg-[var(--kk-brand)] px-2 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">
                    DUE<span className="hidden sm:inline"> (+)</span>
                  </th>
                  <th className="bg-[var(--kk-brand)] px-2.5 sm:px-3 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">TOTAL</th>
                  {showRateMobile && (
                    <>
                      <th className="bg-[var(--kk-brand)] px-2 sm:px-2.5 py-2 sm:py-3 text-left border-r border-white/10 whitespace-nowrap">MOBILE</th>
                      <th className="bg-[var(--kk-brand)] px-2 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">RATE</th>
                    </>
                  )}
                  <th className="bg-[var(--kk-brand)] px-2 sm:px-2.5 py-2 sm:py-3 text-center whitespace-nowrap">SEND</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 text-slate-950 font-mono-tabular">
                {visibleBills.length === 0 ? (
                  <tr>
                    <td
                      colSpan={showRateMobile ? 16 : 14}
                      className="px-4 py-8 text-center font-sans text-sm font-medium text-slate-500"
                    >
                      No sellers added yet. Tap &ldquo;+ Add Seller&rdquo; to create a seller.
                    </td>
                  </tr>
                ) : (
                  visibleBills.map((row, idx) => (
                    <tr
                      key={row.id}
                      className={`align-middle ${
                        idx % 2 === 1 ? 'bg-slate-50/75' : 'bg-white'
                      } hover:bg-indigo-50/40 transition-colors`}
                    >
                      <td
                        className={`bill-col-name sticky left-0 z-10 sm:min-w-[124px] px-2 sm:px-3 py-1.5 sm:py-3 border-r border-slate-200/90 font-sans font-extrabold text-[13px] sm:text-[14px] text-slate-900 whitespace-nowrap shadow-[2px_0_6px_-2px_rgba(15,23,42,0.08)] ${
                          idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'
                        }`}
                      >
                        <span className="block whitespace-nowrap">{row.name}</span>
                      </td>
                      <td className="bill-col-sess px-1 sm:px-2.5 py-1.5 sm:py-3 text-right font-semibold border-r border-slate-200/70 whitespace-nowrap">{formatINR(row.mor)}</td>
                      <td className="bill-col-sess px-1 sm:px-2.5 py-1.5 sm:py-3 text-right font-semibold border-r border-slate-200/70 whitespace-nowrap">{formatINR(row.day)}</td>
                      <td className="bill-col-sess px-1 sm:px-2.5 py-1.5 sm:py-3 text-right font-semibold border-r border-slate-200/70 whitespace-nowrap">{formatINR(row.eve)}</td>
                      <td className="bill-col-sold px-1 sm:px-2.5 py-1.5 sm:py-3 text-right font-extrabold text-[var(--kk-brand)] bg-indigo-50/40 border-r border-slate-200/70 whitespace-nowrap">
                        {formatINR(row.sold)}
                      </td>
                      <td className="bill-col-bill px-1 sm:px-2.5 py-1.5 sm:py-3 text-right font-bold border-r border-slate-200/70 whitespace-nowrap">{formatINR(row.bill)}</td>
                      <td
                        className={`bill-col-fresh px-1.5 sm:px-2.5 py-1.5 sm:py-3 text-right font-extrabold border-r border-slate-200/70 whitespace-nowrap ${
                          row.fresh > 0
                            ? 'text-emerald-700'
                            : row.fresh < 0
                              ? 'text-rose-600'
                              : 'text-slate-900'
                        }`}
                      >
                        {formatINR(row.fresh)}
                      </td>
                      <td className={`px-2 sm:px-2.5 py-1.5 sm:py-3 text-right border-r border-slate-200/70 whitespace-nowrap ${row.amt1pm > 0 ? 'font-bold text-emerald-700' : 'font-semibold'}`}>
                        {formatINR(row.amt1pm)}
                      </td>
                      <td className={`px-2 sm:px-2.5 py-1.5 sm:py-3 text-right border-r border-slate-200/70 whitespace-nowrap ${row.amt6pm > 0 ? 'font-bold text-emerald-700' : 'font-semibold'}`}>
                        {formatINR(row.amt6pm)}
                      </td>
                      <td className={`px-2 sm:px-2.5 py-1.5 sm:py-3 text-right border-r border-slate-200/70 whitespace-nowrap ${row.amt8pm > 0 ? 'font-bold text-emerald-700' : 'font-semibold'}`}>
                        {formatINR(row.amt8pm)}
                      </td>
                      <td className="p-1 sm:p-1.5 border-r border-slate-200/70">
                        <FormulaNumberInput
                          id={`bill-joma-${row.id}`}
                          label={`${row.name} · JOMA`}
                          value={row.joma}
                          onCommit={(val) => onUpdateSeller(row.id, { joma: val })}
                          onActiveSessionChange={handleActiveFormulaChange}
                          compactBillWrapper
                          placeholder="0"
                          className={`ios-compact-input-bill w-full sm:h-9 px-2 text-right text-[13.5px] sm:text-[14px] font-bold font-mono-tabular rounded-lg sm:rounded-md border focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)] transition-colors ${
                            row.joma !== 0
                              ? 'bg-white border-slate-300 text-slate-950'
                              : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-950 placeholder:text-slate-400'
                          }`}
                        />
                      </td>
                      <td className="p-1 sm:p-1.5 border-r border-slate-200/70">
                        <FormulaNumberInput
                          id={`bill-due-${row.id}`}
                          label={`${row.name} · DUE`}
                          value={row.due}
                          onCommit={(val) => onUpdateSeller(row.id, { due: val })}
                          onActiveSessionChange={handleActiveFormulaChange}
                          compactBillWrapper
                          placeholder="0"
                          className={`ios-compact-input-bill w-full sm:h-9 px-2 text-right text-[13.5px] sm:text-[14px] font-bold font-mono-tabular rounded-lg sm:rounded-md border focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)] transition-colors ${
                            row.due !== 0
                              ? 'bg-white border-slate-300 text-slate-950'
                              : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-950 placeholder:text-slate-400'
                          }`}
                        />
                      </td>
                      <td
                        className={`px-2.5 sm:px-3 py-2.5 sm:py-3 text-right text-[13.5px] sm:text-[14.5px] font-extrabold bg-indigo-50/40 border-r border-slate-200/70 whitespace-nowrap ${
                          row.total > 0
                            ? 'text-emerald-700'
                            : row.total < 0
                              ? 'text-rose-600'
                              : 'text-slate-900'
                        }`}
                      >
                        {formatINR(row.total)}
                      </td>
                      {showRateMobile && (
                        <>
                          <td className="p-1 sm:p-1.5 border-r border-slate-200/70 min-w-[120px]">
                            <div className="ios-compact-wrap-bill">
                              <input
                                type="text"
                                inputMode="tel"
                                value={row.mobile}
                                onChange={(e) => onUpdateSeller(row.id, { mobile: e.target.value })}
                                className="ios-compact-input-bill w-full sm:h-9 px-2 text-[13px] font-semibold font-mono-tabular text-slate-950 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg sm:rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)] transition-colors"
                              />
                            </div>
                          </td>
                          <td className="p-1 sm:p-1.5 border-r border-slate-200/70 min-w-[64px]">
                            <div className="ios-compact-wrap-bill">
                              <input
                                type="number"
                                inputMode="decimal"
                                step="0.05"
                                value={row.rate}
                                onChange={(e) =>
                                  onUpdateSeller(row.id, { rate: parseFloat(e.target.value) || 0 })
                                }
                                className="ios-compact-input-bill w-full sm:h-9 px-2 text-right text-[13.5px] sm:text-[14px] font-bold font-mono-tabular text-slate-950 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg sm:rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)] transition-colors"
                              />
                            </div>
                          </td>
                        </>
                      )}
                      <td className="px-2 py-1.5 text-center font-sans whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openBillPreview(row)}
                            title={`View ${row.name} Bill Card`}
                            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-bold text-[var(--kk-brand)] bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg cursor-pointer transition-colors"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Card</span>
                          </button>
                          <button
                            type="button"
                            disabled={sendingBillId !== null}
                            onClick={() => void handleSendBillCard(row)}
                            title={`Send ${row.name} Bill Card on WhatsApp`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer transition-colors disabled:opacity-60"
                          >
                            {sendingBillId === row.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                            <span>Send</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDeleteSeller(row)}
                            className="p-1.5 text-slate-500 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-lg cursor-pointer transition-colors"
                            title={`Delete ${row.name}`}
                            aria-label={`Delete ${row.name}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {visibleBills.length > 0 && (
                <tfoot className="sticky bottom-0 z-20 shadow-[0_-2px_8px_rgba(15,36,96,0.22)]">
                  <tr className="kk-table-head text-white text-[13px] sm:text-[14px] font-extrabold font-mono-tabular align-middle">
                    <td className="bill-col-name sticky bottom-0 left-0 z-30 bg-[var(--kk-brand)] sm:min-w-[124px] px-2 sm:px-3 py-2 sm:py-3 font-sans text-[11.5px] sm:text-[13px] uppercase tracking-wide border-r border-white/15 whitespace-nowrap shadow-[2px_0_6px_-2px_rgba(0,0,0,0.28)]">
                      TOTAL ({visibleBills.length})
                    </td>
                    <td className="bill-col-sess bg-[var(--kk-brand)] px-1 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">{formatINR(totals.mor)}</td>
                    <td className="bill-col-sess bg-[var(--kk-brand)] px-1 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">{formatINR(totals.day)}</td>
                    <td className="bill-col-sess bg-[var(--kk-brand)] px-1 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">{formatINR(totals.eve)}</td>
                    <td className="bill-col-sold bg-[var(--kk-brand)] px-1 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">{formatINR(totals.sold)}</td>
                    <td className="bill-col-bill bg-[var(--kk-brand)] px-1 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">{formatINR(totals.bill)}</td>
                    <td
                      className={`bill-col-fresh bg-[var(--kk-brand)] px-1.5 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap ${
                        totals.fresh > 0
                          ? 'text-emerald-300'
                          : totals.fresh < 0
                            ? 'text-rose-300'
                            : 'text-white'
                      }`}
                    >
                      {formatINR(totals.fresh)}
                    </td>
                    <td className="bg-[var(--kk-brand)] px-2 sm:px-2.5 py-2 sm:py-3 text-right text-emerald-300 border-r border-white/10 whitespace-nowrap">{formatINR(totals.amt1pm)}</td>
                    <td className="bg-[var(--kk-brand)] px-2 sm:px-2.5 py-2 sm:py-3 text-right text-emerald-300 border-r border-white/10 whitespace-nowrap">{formatINR(totals.amt6pm)}</td>
                    <td className="bg-[var(--kk-brand)] px-2 sm:px-2.5 py-2 sm:py-3 text-right text-emerald-300 border-r border-white/10 whitespace-nowrap">{formatINR(totals.amt8pm)}</td>
                    <td className="bg-[var(--kk-brand)] px-2 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">{formatINR(totals.joma)}</td>
                    <td className="bg-[var(--kk-brand)] px-2 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">{formatINR(totals.due)}</td>
                    <td
                      className={`bg-[var(--kk-brand)] px-2.5 sm:px-3 py-2 sm:py-3 text-right text-[13.5px] sm:text-[15px] border-r border-white/10 whitespace-nowrap ${
                        totals.total > 0
                          ? 'text-emerald-300'
                          : totals.total < 0
                            ? 'text-rose-300'
                            : 'text-white'
                      }`}
                    >
                      ₹{formatINR(totals.total)}
                    </td>
                    {showRateMobile && (
                      <>
                        <td className="bg-[var(--kk-brand)] px-2 sm:px-2.5 py-2 sm:py-3 font-sans border-r border-white/10 whitespace-nowrap">MOBILE</td>
                        <td className="bg-[var(--kk-brand)] px-2 sm:px-2.5 py-2 sm:py-3 text-right border-r border-white/10 whitespace-nowrap">{formatINR(totals.rate)}</td>
                      </>
                    )}
                    <td className="bg-[var(--kk-brand)] px-2 sm:px-2.5 py-2 sm:py-3 text-center font-sans tracking-wide whitespace-nowrap">KK AGENCY</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      ) : viewMode === 'cards' ? (
        /* CARDS VIEW */
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {visibleBills.map((row) => (
            <div
              key={row.id}
              className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs flex flex-col"
            >
              <div className="px-4 py-3 bg-[var(--kk-brand)] text-white flex items-center justify-between">
                <span className="text-base font-extrabold tracking-tight">{row.name}</span>
                {showRateMobile && (
                  <span className="text-xs font-mono-tabular font-semibold text-white/80">
                    ₹{row.rate}
                  </span>
                )}
              </div>

              <div className="p-4 space-y-3 text-sm">
                <div className="grid grid-cols-4 gap-2 text-center bg-slate-50 border border-slate-200 rounded-xl p-2.5 font-mono-tabular">
                  <div>
                    <div className="font-sans text-[11px] font-bold text-amber-800">MOR</div>
                    <div className="mt-0.5 text-sm font-extrabold text-slate-950">{formatINR(row.mor)}</div>
                  </div>
                  <div>
                    <div className="font-sans text-[11px] font-bold text-sky-800">DAY</div>
                    <div className="mt-0.5 text-sm font-extrabold text-slate-950">{formatINR(row.day)}</div>
                  </div>
                  <div>
                    <div className="font-sans text-[11px] font-bold text-violet-800">EVE</div>
                    <div className="mt-0.5 text-sm font-extrabold text-slate-950">{formatINR(row.eve)}</div>
                  </div>
                  <div>
                    <div className="font-sans text-[11px] font-bold text-[var(--kk-brand)]">SOLD</div>
                    <div className="mt-0.5 text-sm font-extrabold text-[var(--kk-brand)]">{formatINR(row.sold)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 font-mono-tabular">
                  <div className="border border-slate-200 rounded-xl p-2.5">
                    <div className="font-sans text-[11px] font-bold text-slate-600">BILL</div>
                    <div className="mt-0.5 text-sm font-extrabold text-slate-950">₹{formatINR(row.bill)}</div>
                  </div>
                  <div className="border border-emerald-200 bg-emerald-50/60 rounded-xl p-2.5">
                    <div className="font-sans text-[11px] font-bold text-emerald-800">PRIZE (-)</div>
                    <div className="mt-0.5 text-sm font-extrabold text-emerald-700">₹{formatINR(row.prizeTotal)}</div>
                  </div>
                  <div className="border border-slate-200 rounded-xl p-2.5">
                    <div className="font-sans text-[11px] font-bold text-slate-600">FRESH</div>
                    <div
                      className={`mt-0.5 text-sm font-extrabold ${
                        row.fresh > 0
                          ? 'text-emerald-700'
                          : row.fresh < 0
                            ? 'text-rose-600'
                            : 'text-slate-950'
                      }`}
                    >
                      ₹{formatINR(row.fresh)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-sky-900">JOMA (-)</span>
                    <FormulaNumberInput
                      id={`card-joma-${row.id}`}
                      label={`${row.name} · JOMA`}
                      value={row.joma}
                      onCommit={(val) => onUpdateSeller(row.id, { joma: val })}
                      onActiveSessionChange={handleActiveFormulaChange}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm font-mono-tabular font-bold text-slate-950 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-amber-900">DUE (+)</span>
                    <FormulaNumberInput
                      id={`card-due-${row.id}`}
                      label={`${row.name} · DUE`}
                      value={row.due}
                      onCommit={(val) => onUpdateSeller(row.id, { due: val })}
                      onActiveSessionChange={handleActiveFormulaChange}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm font-mono-tabular font-bold text-slate-950 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                    />
                  </label>
                </div>

                {showRateMobile && (
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <label className="col-span-2 space-y-1">
                      <span className="text-xs font-bold text-slate-600">Mobile</span>
                      <input
                        type="text"
                        value={row.mobile}
                        onChange={(e) => onUpdateSeller(row.id, { mobile: e.target.value })}
                        className="w-full px-3 py-2 text-sm font-mono-tabular font-semibold text-slate-950 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-bold text-slate-600">Rate (₹)</span>
                      <input
                        type="number"
                        step="0.05"
                        value={row.rate}
                        onChange={(e) =>
                          onUpdateSeller(row.id, { rate: parseFloat(e.target.value) || 0 })
                        }
                        className="w-full px-3 py-2 text-sm font-mono-tabular font-bold text-right text-slate-950 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                      />
                    </label>
                  </div>
                )}

                <div className="pt-2.5 border-t border-slate-200 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-slate-600">NET PAYABLE</div>
                    <div
                      className={`text-lg font-extrabold font-mono-tabular ${
                        row.total > 0
                          ? 'text-emerald-700'
                          : row.total < 0
                            ? 'text-rose-600'
                            : 'text-slate-950'
                      }`}
                    >
                      ₹{formatINR(row.total)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openBillPreview(row)}
                      title={`View ${row.name} Bill Card`}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-[var(--kk-brand)] bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl cursor-pointer transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Bill Card</span>
                    </button>
                    <button
                      type="button"
                      disabled={sendingBillId !== null}
                      onClick={() => void handleSendBillCard(row)}
                      title={`Send ${row.name} Bill Card on WhatsApp`}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl cursor-pointer transition-colors disabled:opacity-60"
                    >
                      {sendingBillId === row.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      <span>Send Card</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => requestDeleteSeller(row)}
                      className="p-2 text-slate-500 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-xl cursor-pointer transition-colors"
                      title={`Delete ${row.name}`}
                      aria-label={`Delete ${row.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {visibleBills.length > 0 && (
          <div className="mt-3.5 bg-[var(--kk-brand)] text-white border border-[var(--kk-brand)] rounded-2xl overflow-hidden shadow-xs">
            <div className="px-4 py-3 flex items-center justify-between text-sm font-bold border-b border-white/10">
              <span>TOTAL ({visibleBills.length} Sellers)</span>
              <span
                className={`font-mono-tabular text-base font-extrabold ${
                  totals.total > 0
                    ? 'text-emerald-300'
                    : totals.total < 0
                      ? 'text-rose-300'
                      : 'text-white'
                }`}
              >
                ₹{formatINR(totals.total)}
              </span>
            </div>
            {/* Mobile spacious rows */}
            <div className="sm:hidden font-mono-tabular">
              <div className="grid grid-cols-4 text-center border-b border-white/10">
                <div className="px-2 py-2.5 border-r border-white/10">
                  <div className="font-sans text-[11px] font-semibold text-indigo-200">MOR</div>
                  <div className="mt-0.5 text-sm font-bold">{formatINR(totals.mor)}</div>
                </div>
                <div className="px-2 py-2.5 border-r border-white/10">
                  <div className="font-sans text-[11px] font-semibold text-indigo-200">DAY</div>
                  <div className="mt-0.5 text-sm font-bold">{formatINR(totals.day)}</div>
                </div>
                <div className="px-2 py-2.5 border-r border-white/10">
                  <div className="font-sans text-[11px] font-semibold text-indigo-200">EVE</div>
                  <div className="mt-0.5 text-sm font-bold">{formatINR(totals.eve)}</div>
                </div>
                <div className="px-2 py-2.5">
                  <div className="font-sans text-[11px] font-semibold text-indigo-200">SOLD</div>
                  <div className="mt-0.5 text-sm font-bold">{formatINR(totals.sold)}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 text-center border-b border-white/10">
                <div className="px-2 py-2.5 border-r border-white/10">
                  <div className="font-sans text-[11px] font-semibold text-indigo-200">BILL</div>
                  <div className="mt-0.5 text-sm font-bold break-all">₹{formatINR(totals.bill)}</div>
                </div>
                <div className="px-2 py-2.5 border-r border-white/10">
                  <div className="font-sans text-[11px] font-semibold text-emerald-300">PRIZE</div>
                  <div className="mt-0.5 text-sm font-bold text-emerald-300 break-all">₹{formatINR(totals.prize)}</div>
                </div>
                <div className="px-2 py-2.5">
                  <div className="font-sans text-[11px] font-semibold text-indigo-200">JOMA</div>
                  <div className="mt-0.5 text-sm font-bold break-all">₹{formatINR(totals.joma)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 text-center">
                <div className="px-2.5 py-3 border-r border-white/10">
                  <div className="font-sans text-[11px] font-semibold text-amber-300">DUE (+)</div>
                  <div className="mt-0.5 text-sm font-bold text-amber-200 break-all">₹{formatINR(totals.due)}</div>
                </div>
                <div className="px-2.5 py-3">
                  <div className="font-sans text-[11px] font-semibold text-indigo-200">TOTAL</div>
                  <div
                    className={`mt-0.5 text-base font-extrabold break-all ${
                      totals.total > 0
                        ? 'text-emerald-300'
                        : totals.total < 0
                          ? 'text-rose-300'
                          : 'text-white'
                    }`}
                  >
                    ₹{formatINR(totals.total)}
                  </div>
                </div>
              </div>
            </div>

            {/* Tablet/Desktop 9-column row */}
            <div className="hidden sm:grid sm:grid-cols-9 text-center font-mono-tabular">
              <div className="px-2 py-2.5 border-r border-white/10">
                <div className="font-sans text-[11px] font-semibold text-indigo-200">MOR</div>
                <div className="mt-0.5 text-xs font-bold">{formatINR(totals.mor)}</div>
              </div>
              <div className="px-2 py-2.5 border-r border-white/10">
                <div className="font-sans text-[11px] font-semibold text-indigo-200">DAY</div>
                <div className="mt-0.5 text-xs font-bold">{formatINR(totals.day)}</div>
              </div>
              <div className="px-2 py-2.5 border-r border-white/10">
                <div className="font-sans text-[11px] font-semibold text-indigo-200">EVE</div>
                <div className="mt-0.5 text-xs font-bold">{formatINR(totals.eve)}</div>
              </div>
              <div className="px-2 py-2.5 border-r border-white/10">
                <div className="font-sans text-[11px] font-semibold text-indigo-200">SOLD</div>
                <div className="mt-0.5 text-xs font-bold">{formatINR(totals.sold)}</div>
              </div>
              <div className="px-2 py-2.5 border-r border-white/10">
                <div className="font-sans text-[11px] font-semibold text-indigo-200">BILL</div>
                <div className="mt-0.5 text-xs font-bold break-all">{formatINR(totals.bill)}</div>
              </div>
              <div className="px-2 py-2.5 border-r border-white/10">
                <div className="font-sans text-[11px] font-semibold text-emerald-300">PRIZE</div>
                <div className="mt-0.5 text-xs font-bold text-emerald-300 break-all">{formatINR(totals.prize)}</div>
              </div>
              <div className="px-2 py-2.5 border-r border-white/10">
                <div className="font-sans text-[11px] font-semibold text-indigo-200">JOMA</div>
                <div className="mt-0.5 text-xs font-bold break-all">{formatINR(totals.joma)}</div>
              </div>
              <div className="px-2 py-2.5 border-r border-white/10">
                <div className="font-sans text-[11px] font-semibold text-amber-300">DUE</div>
                <div className="mt-0.5 text-xs font-bold text-amber-200 break-all">{formatINR(totals.due)}</div>
              </div>
              <div className="px-2 py-2.5">
                <div className="font-sans text-[11px] font-semibold text-indigo-200">TOTAL</div>
                <div
                  className={`mt-0.5 text-xs font-extrabold break-all ${
                    totals.total > 0
                      ? 'text-emerald-300'
                      : totals.total < 0
                        ? 'text-rose-300'
                        : 'text-white'
                  }`}
                >
                  {formatINR(totals.total)}
                </div>
              </div>
            </div>
          </div>
        )}
        </>
      ) : null}

      {/* SEPARATE OVER-LIMIT (limit output > 10, e.g. M15, M20=61070) SECTION */}
      {sessionComputations && (viewMode === 'limit' || overLimitSummary.grandTotal > 0) && (
        <section
          aria-label={`Limit output above ${BILL_EXCESS_LIMIT_CUTOFF}`}
          className="bg-white border border-rose-200 rounded-2xl overflow-hidden shadow-xs"
        >
          <div className="bg-rose-700 text-white px-3.5 sm:px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-amber-200" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-extrabold tracking-tight">
                    Limit &gt;{BILL_EXCESS_LIMIT_CUTOFF} (Above {BILL_EXCESS_LIMIT_CUTOFF} Limit)
                  </h2>
                  {overLimitSummary.grandTotal > 0 && (
                    <span className="px-2 py-0.5 rounded-lg bg-white text-rose-700 text-[11px] font-mono-tabular font-extrabold">
                      Total {formatINR(overLimitSummary.grandTotal)}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-rose-100 font-medium">
                  {overLimitSummary.grandTotal > 0
                    ? `${overLimitSummary.totalNumbers} number${overLimitSummary.totalNumbers === 1 ? '' : 's'} with limit >${BILL_EXCESS_LIMIT_CUTOFF} (e.g. M15, M20+) across ${overLimitSummary.activeSessions.map((s) => s.sessionId).join(' · ')}`
                    : `No numbers have limit output above ${BILL_EXCESS_LIMIT_CUTOFF} (M10 / D10 / E10 and below stay in sheet)`}
                </p>
              </div>
            </div>

            {overLimitSummary.grandTotal > 0 && (
              <button
                type="button"
                onClick={() => handleCopyLimitText('ALL', overLimitSummary.combinedCopyText)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-white/15 hover:bg-white/25 text-white border border-white/20 rounded-xl cursor-pointer transition-colors"
              >
                {copiedLimitKey === 'ALL' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-200" />
                    <span>Copied All</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy All</span>
                  </>
                )}
              </button>
            )}
          </div>

          {overLimitSummary.grandTotal === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
                <Check className="w-4 h-4" />
                <span>No limit above {BILL_EXCESS_LIMIT_CUTOFF} right now</span>
              </div>
            </div>
          ) : (
            <div className="p-3 sm:p-3.5 space-y-3">
              {/* Session Filter Tabs when multiple sessions have over-limit */}
              {overLimitSummary.activeSessions.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      setLimitSessionFilter('ALL');
                    }}
                    className={`px-2.5 py-1 text-xs font-bold rounded-xl border cursor-pointer transition-colors ${
                      limitSessionFilter === 'ALL'
                        ? 'bg-rose-700 text-white border-rose-700'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    All ({formatINR(overLimitSummary.grandTotal)})
                  </button>
                  {overLimitSummary.activeSessions.map((sess) => (
                    <button
                      key={sess.sessionId}
                      type="button"
                      onClick={() => {
                        AppSounds.tap();
                        setLimitSessionFilter(sess.sessionId);
                      }}
                      className={`px-2.5 py-1 text-xs font-bold rounded-xl border cursor-pointer transition-colors ${
                        limitSessionFilter === sess.sessionId
                          ? 'bg-rose-700 text-white border-rose-700'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {sess.sessionId} ({formatINR(sess.overLimitTotal)})
                    </button>
                  ))}
                </div>
              )}

              {/* Per-Session Separated Over-Limit Cards */}
              {overLimitSummary.activeSessions
                .filter(
                  (sess) =>
                    limitSessionFilter === 'ALL' ||
                    overLimitSummary.activeSessions.length === 1 ||
                    sess.sessionId === limitSessionFilter
                )
                .map((sess) => {
                  const meta = SESSION_META[sess.sessionId];
                  const copyKey = `SESS-${sess.sessionId}`;
                  return (
                    <div
                      key={sess.sessionId}
                      className="border border-rose-200/90 rounded-2xl overflow-hidden bg-white"
                    >
                      {/* Session Header Bar */}
                      <div className="px-3 py-2.5 bg-rose-50/80 border-b border-rose-200/80 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded-lg text-[11px] font-extrabold font-mono-tabular ${meta.badgeClass}`}
                          >
                            {sess.sessionId} · {sess.prefix}
                          </span>
                          <span className="text-xs font-extrabold text-rose-900 font-mono-tabular">
                            Total {formatINR(sess.overLimitTotal)}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-600">
                            ({sess.numberCount} {sess.numberCount === 1 ? 'no' : 'nos'})
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleCopyLimitText(copyKey, sess.waMessage)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer transition-colors"
                          >
                            {copiedLimitKey === copyKey ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-700" />
                                <span className="text-emerald-700">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              AppSounds.tap();
                              onPreviewMessage(
                                `${sess.sessionId} Limit >${BILL_EXCESS_LIMIT_CUTOFF}`,
                                `Total ${formatINR(sess.overLimitTotal)} (above ${BILL_EXCESS_LIMIT_CUTOFF} limit output)`,
                                sess.waMessage,
                                sess.waUrl
                              );
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer transition-colors"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Preview</span>
                          </button>

                          {sess.waUrl && (
                            <a
                              href={sess.waUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => AppSounds.success()}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
                            >
                              <Send className="w-3 h-3" />
                              <span>Send limit</span>
                            </a>
                          )}

                          {onOpenSession && (
                            <button
                              type="button"
                              onClick={() => onOpenSession(sess.sessionId)}
                              className="inline-flex items-center gap-0.5 px-2 py-1 text-[11px] font-bold text-[var(--kk-brand)] bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg cursor-pointer transition-colors"
                              title={`Open ${sess.sessionId} sheet`}
                            >
                              <span>Sheet</span>
                              <ArrowUpRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Over-Limit Rows Table */}
                      <div className="overflow-x-auto ledger-scroll">
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-900 text-slate-100 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider">
                              <th className="px-2.5 py-2 text-left border-r border-white/10 whitespace-nowrap">
                                LIMIT CODE
                              </th>
                              <th className="px-2.5 py-2 text-center border-r border-white/10 whitespace-nowrap">
                                NUMBER
                              </th>
                              <th className="px-2 py-2 text-right border-r border-white/10 whitespace-nowrap">
                                QTY
                              </th>
                              <th className="px-2 py-2 text-right border-r border-white/10 whitespace-nowrap">
                                OVER
                              </th>
                              <th className="px-2.5 py-2 text-left whitespace-nowrap">
                                SELLER
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-rose-100">
                            {sess.groups.map((grp) => {
                              const limitCode = formatGroupLimitCode(sess.prefix, grp);
                              const totalExcess = round2(grp.excessQtyPerNum * grp.count);
                              return (
                                <tr
                                  key={grp.id}
                                  className="hover:bg-rose-50/50 transition-colors"
                                >
                                  <td className="px-2.5 py-2 border-r border-slate-100 whitespace-nowrap">
                                    <span className="inline-block px-2 py-0.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 font-mono-tabular font-extrabold text-xs">
                                      {limitCode}
                                    </span>
                                  </td>
                                  <td className="px-2.5 py-2 text-center font-mono-tabular font-bold text-slate-900 border-r border-slate-100 whitespace-nowrap">
                                    {grp.startNum === grp.endNum ? (
                                      grp.startNum
                                    ) : (
                                      <span>
                                        {grp.startNum}–{grp.endNum}{' '}
                                        <span className="text-[10px] text-slate-500">
                                          ({grp.count})
                                        </span>
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-2 py-2 text-right font-mono-tabular font-bold text-slate-900 border-r border-slate-100 whitespace-nowrap">
                                    {grp.totalQtyPerNum}
                                    <span className="text-[10px] font-semibold text-slate-400">
                                      /{limitThreshold}
                                    </span>
                                  </td>
                                  <td className="px-2 py-2 text-right font-mono-tabular font-extrabold text-rose-700 border-r border-slate-100 whitespace-nowrap">
                                    +{totalExcess}
                                  </td>
                                  <td className="px-2.5 py-2 text-left">
                                    <div className="flex flex-wrap items-center gap-1">
                                      {grp.sellers.map((s) => (
                                        <span
                                          key={`${grp.id}-${s.sellerName}`}
                                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-900 whitespace-nowrap"
                                        >
                                          <span>{s.sellerName}</span>
                                          <span className="font-mono-tabular text-rose-700">
                                            ({s.qty})
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="bg-rose-50/70 border-t border-rose-200 text-rose-950 font-bold">
                              <td colSpan={3} className="px-2.5 py-2 text-xs">
                                {sess.sessionId} Over-Limit Total
                              </td>
                              <td className="px-2 py-2 text-right font-mono-tabular text-xs font-extrabold text-rose-700 whitespace-nowrap">
                                Total {formatINR(sess.overLimitTotal)}
                              </td>
                              <td className="px-2.5 py-2 text-right whitespace-nowrap">
                                {sess.waUrl && (
                                  <a
                                    href={sess.waUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => AppSounds.success()}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                                  >
                                    <Send className="w-3 h-3" />
                                    <span>Send limit</span>
                                  </a>
                                )}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      )}
      {/* Two-Step Double Permission Modal for Deleting a Seller */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-[2px] p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-seller-title"
          >
            <motion.div
              key={`${deleteConfirm.seller.id}-${deleteConfirm.step}`}
              initial={{ opacity: 0, scale: 0.94, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 6 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-md bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xl"
            >
              <div
                className={`px-5 py-3.5 text-white flex items-center justify-between ${
                  deleteConfirm.step === 1 ? 'bg-[var(--kk-brand)]' : 'bg-red-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  {deleteConfirm.step === 1 ? (
                    <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-white shrink-0" />
                  )}
                  <h3 id="delete-seller-title" className="text-sm font-bold">
                    {deleteConfirm.step === 1
                      ? 'Permission 1 of 2 · Remove Seller?'
                      : 'Permission 2 of 2 · Final Delete Confirmation'}
                  </h3>
                </div>
                <span className="text-[11px] font-mono-tabular font-bold bg-white/15 px-2 py-0.5 rounded-md">
                  {deleteConfirm.step}/2
                </span>
              </div>

              <div className="p-5 space-y-4">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between font-bold text-slate-950 text-sm">
                    <span>{deleteConfirm.seller.name}</span>
                    <span className="font-mono-tabular text-[var(--kk-brand)]">
                      Total: ₹{formatINR(deleteConfirm.seller.total)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600 font-mono-tabular">
                    <span>Sold: {formatINR(deleteConfirm.seller.sold)}</span>
                    <span>·</span>
                    <span>Bill: ₹{formatINR(deleteConfirm.seller.bill)}</span>
                    <span>·</span>
                    <span>Due: ₹{formatINR(deleteConfirm.seller.due)}</span>
                  </div>
                </div>

                {deleteConfirm.step === 1 ? (
                  <p className="text-xs sm:text-sm font-medium text-slate-700 leading-relaxed">
                    Are you sure you want to delete <strong className="text-slate-950">{deleteConfirm.seller.name}</strong> from Seller Bill? A second confirmation will follow before removing.
                  </p>
                ) : (
                  <p className="text-xs sm:text-sm font-semibold text-red-800 leading-relaxed">
                    Final confirmation: Deleting <strong className="text-red-950">{deleteConfirm.seller.name}</strong> will permanently remove their Due (₹{formatINR(deleteConfirm.seller.due)}) and Seller Bill card from this sheet.
                  </p>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      if (deleteConfirm.step === 2) {
                        setDeleteConfirm({ ...deleteConfirm, step: 1 });
                      } else {
                        setDeleteConfirm(null);
                      }
                    }}
                    className="px-3.5 py-2 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl cursor-pointer"
                  >
                    {deleteConfirm.step === 2 ? 'Back' : 'Cancel'}
                  </button>

                  {deleteConfirm.step === 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        AppSounds.warning();
                        setDeleteConfirm({ ...deleteConfirm, step: 2 });
                      }}
                      className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl cursor-pointer"
                    >
                      Yes, Ask Final Permission →
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        AppSounds.remove();
                        onDeleteSeller(deleteConfirm.seller.id);
                        setDeleteConfirm(null);
                      }}
                      className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl cursor-pointer shadow-xs"
                    >
                      Confirm Delete Permanently
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Google-Sheets-style fx Quick Formula Bar (visible while editing JOMA / DUE) */}
      <SheetFormulaBar session={activeFormula} />
    </div>
  );
}
