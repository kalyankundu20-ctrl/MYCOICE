import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  CloudOff,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  LayoutGrid,
  Link2,
  Loader2,
  Lock,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  Radio,
  RefreshCw,
  Send,
  ShieldAlert,
  Smartphone,
  Table2,
  Trash2,
  Users,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useMemo, useState } from 'react';
import { formatDateDDMMYYYY, formatINR, processSessionRows } from '../engine/calculations';
import {
  buildSellerInviteWhatsAppUrl,
  buildSellerPortalUrl,
  CloudPartyDoc,
  CloudPartyPrivateDoc,
  CloudPartySheetDoc,
  collectDescendantPartyIds,
  createSubSellerParty,
  deleteSubSellerParty,
  resetSubSellerAccessKey,
  toggleSellerChainRole,
  toggleSubSellerActive,
  updatePartyLoginCredentials,
  updateSubSellerParty,
} from '../services/cloudSync';
import { AgencyConfig, SellerBillRow, SessionId } from '../types/ledger';
import { BillReceiptPayload, sendBillCardDirectToWhatsApp } from '../utils/billImageGenerator';
import { AppSounds } from '../utils/sound';
import { ActiveFormulaSession, FormulaNumberInput, SheetFormulaBar } from './FormulaNumberInput';

function formatCleanError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('{') || trimmed.includes('"authInfo"')) {
    if (trimmed.includes('permission') || trimmed.includes('PERMISSION_DENIED')) {
      return `${fallback} — Ek baar page refresh ya dubara login karke try karein.`;
    }
    return fallback;
  }
  if (trimmed.includes('permission') || trimmed.includes('PERMISSION_DENIED')) {
    return `${fallback} — Ek baar page refresh ya dubara login karke try karein.`;
  }
  return trimmed;
}

interface MasterChainTabProps {
  masterUid: string;
  masterParty: CloudPartyDoc;
  billingDate: string;
  subParties: CloudPartyDoc[];
  allChainParties?: CloudPartyDoc[];
  subPrivates: CloudPartyPrivateDoc[];
  subSheets: CloudPartySheetDoc[];
  subBillsByPartyId: Record<string, SellerBillRow>;
  config: AgencyConfig;
  adminPreviewMode: boolean;
  onPreviewMessage: (
    title: string,
    subtitle: string,
    message: string,
    waUrl: string,
    billData?: BillReceiptPayload
  ) => void;
  /** When true, hides KPI cards & Chain ID management cards so it embeds cleanly inside My Bill tab */
  billSheetOnly?: boolean;
  onOpenManageChain?: () => void;
}

export function MasterChainTab({
  masterUid,
  masterParty,
  billingDate,
  subParties,
  allChainParties = subParties,
  subPrivates,
  subSheets,
  subBillsByPartyId,
  config,
  adminPreviewMode,
  onPreviewMessage,
  billSheetOnly = false,
  onOpenManageChain,
}: MasterChainTabProps) {
  const [viewMode, setViewMode] = useState<'all' | 'cards'>('all');
  const [showRateMobile, setShowRateMobile] = useState(false);
  const [sendingSubBillId, setSendingSubBillId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const [waCardToast, setWaCardToast] = useState<{ message: string; waUrl: string } | null>(null);

  const openSubBillPreview = (subName: string, bill: SellerBillRow) => {
    AppSounds.tap();
    const dateStr = formatDateDDMMYYYY(billingDate);
    onPreviewMessage(
      `${subName} — Bill Card`,
      `${dateStr} • Net ₹${formatINR(bill.total)}`,
      bill.waMessage,
      '',
      { bill, dateStr }
    );
  };

  const handleSendSubBillCard = async (partyId: string, subName: string, bill: SellerBillRow) => {
    if (sendingSubBillId) return;
    const dateStr = formatDateDDMMYYYY(billingDate);
    setSendingSubBillId(partyId);
    try {
      const res = await sendBillCardDirectToWhatsApp({ bill, dateStr });
      AppSounds.success();
      const msg =
        res.method === 'copied_direct'
          ? res.hasNumber
            ? `${subName} ka Bill Card copy ho gaya — WhatsApp chat me bas Paste → Send karein.`
            : `${subName} ka Bill Card copy ho gaya — WhatsApp me Paste karein (number Rate & Mob me add karein).`
          : `${subName} ka Bill Card PNG save ho gaya — WhatsApp chat me attach karke bhej dein.`;
      setWaCardToast({ message: msg, waUrl: res.waUrl });
      window.setTimeout(() => {
        setWaCardToast((curr) => (curr?.message === msg ? null : curr));
      }, 6500);
    } catch {
      openSubBillPreview(subName, bill);
    } finally {
      setSendingSubBillId(null);
    }
  };
  const [newName, setNewName] = useState('');
  const [newRate, setNewRate] = useState(String(masterParty.rate || 10));
  const [newMobile, setNewMobile] = useState('91');
  const [newDue, setNewDue] = useState(0);
  const [newAllowChain, setNewAllowChain] = useState(false);
  const [busyAction, setBusyAction] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copiedToken, setCopiedToken] = useState('');
  const [expandedEntriesId, setExpandedEntriesId] = useState<string | null>(null);
  const [editingCredPartyId, setEditingCredPartyId] = useState<string | null>(null);
  const [editLoginId, setEditLoginId] = useState('');
  const [editLoginPass, setEditLoginPass] = useState('');
  const [activeFormula, setActiveFormula] = useState<ActiveFormulaSession | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    sub: CloudPartyDoc;
    step: 1 | 2;
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

  const privMap = useMemo(() => {
    const map: Record<string, CloudPartyPrivateDoc> = {};
    for (const pr of subPrivates) {
      map[pr.partyId] = pr;
    }
    return map;
  }, [subPrivates]);

  const sheetIds = useMemo(() => new Set(subSheets.map((s) => s.partyId)), [subSheets]);
  const partyById = useMemo(
    () => new Map<string, CloudPartyDoc>(allChainParties.map((p) => [p.partyId, p])),
    [allChainParties]
  );

  const subBillRows = useMemo(() => {
    const rows: Array<{
      sub: CloudPartyDoc;
      bill: SellerBillRow;
      priv?: CloudPartyPrivateDoc;
    }> = [];
    for (const sub of subParties) {
      const bill = subBillsByPartyId[sub.partyId];
      if (!bill) continue;
      rows.push({ sub, bill, priv: privMap[sub.partyId] });
    }
    return rows;
  }, [subParties, subBillsByPartyId, privMap]);

  const totals = useMemo(
    () =>
      subBillRows.reduce(
        (acc, { bill }) => ({
          mor: acc.mor + bill.mor,
          day: acc.day + bill.day,
          eve: acc.eve + bill.eve,
          sold: acc.sold + bill.sold,
          bill: acc.bill + bill.bill,
          prize: acc.prize + bill.prizeTotal,
          fresh: acc.fresh + bill.fresh,
          amt1pm: acc.amt1pm + bill.amt1pm,
          amt6pm: acc.amt6pm + bill.amt6pm,
          amt8pm: acc.amt8pm + bill.amt8pm,
          joma: acc.joma + bill.joma,
          due: acc.due + bill.due,
          total: acc.total + bill.total,
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
        }
      ),
    [subBillRows]
  );

  const connectedCount = subParties.filter((p) => Boolean(p.assignedUid) && p.active).length;

  const copyText = async (text: string, token: string) => {
    AppSounds.tap();
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
    setCopiedToken(token);
    window.setTimeout(() => {
      setCopiedToken((curr) => (curr === token ? '' : curr));
    }, 1800);
  };

  const handleCreateSub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPreviewMode) return;
    const cleanedName = newName.trim().toUpperCase();
    if (!cleanedName) return;
    const rateNum = parseFloat(newRate);
    setBusyAction('create');
    setErrorMsg('');
    try {
      const usedIds = new Set(
        subPrivates.map((p) => (p.loginId || '').trim().toUpperCase()).filter(Boolean)
      );
      await createSubSellerParty(
        masterUid,
        masterParty,
        {
          name: cleanedName,
          rate: Number.isFinite(rateNum) && rateNum >= 0 ? rateNum : masterParty.rate,
          mobile: newMobile.trim(),
          due: newDue || 0,
          allowChain: newAllowChain,
        },
        billingDate,
        usedIds
      );
      AppSounds.success();
      setNewName('');
      setNewMobile('91');
      setNewDue(0);
      setNewAllowChain(false);
      setShowAddForm(false);
    } catch (err) {
      setErrorMsg(formatCleanError(err, 'Sub-Seller add nahi ho saka'));
    } finally {
      setBusyAction('');
    }
  };

  const handleSaveSubCreds = async (e: React.FormEvent, sub: CloudPartyDoc) => {
    e.preventDefault();
    if (adminPreviewMode || !editLoginId.trim() || !editLoginPass.trim()) return;
    setBusyAction(`cred-${sub.partyId}`);
    setErrorMsg('');
    try {
      await updatePartyLoginCredentials(
        masterUid,
        { ...sub, parentMasterUid: masterUid },
        privMap[sub.partyId],
        editLoginId.trim(),
        editLoginPass.trim(),
        sheetIds.has(sub.partyId),
        false
      );
      AppSounds.success();
      setEditingCredPartyId(null);
    } catch (err) {
      setErrorMsg(formatCleanError(err, 'Login ID / Password update nahi ho saka'));
    } finally {
      setBusyAction('');
    }
  };

  const handleInlinePatchSub = async (
    sub: CloudPartyDoc,
    patch: { rate?: number; due?: number; joma?: number; mobile?: string }
  ) => {
    if (adminPreviewMode) return;
    setErrorMsg('');
    try {
      await updateSubSellerParty(sub, privMap[sub.partyId], patch);
    } catch (err) {
      setErrorMsg(formatCleanError(err, 'Update save nahi ho saka'));
    }
  };

  const handleConfirmDeleteSub = async () => {
    if (!deleteConfirm || adminPreviewMode) return;
    const target = deleteConfirm.sub;
    setDeleteConfirm(null);
    setBusyAction(`del-${target.partyId}`);
    setErrorMsg('');
    try {
      await deleteSubSellerParty(target);
      AppSounds.remove();
    } catch (err) {
      setErrorMsg(formatCleanError(err, 'Sub-Seller delete nahi ho saka'));
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="space-y-3.5">
      <AnimatePresence>
        {waCardToast && (
          <motion.div
            key="master-wa-card-toast"
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

      {/* Executive KPI Summary Strip (NO Cut Margin — strictly Sold, Bill, Prize, Fresh Bill, Net Payable) */}
      {!billSheetOnly && (
        <section aria-label="Sub-sellers billing summary" className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
          <div className="kk-surface-card rounded-2xl px-4 py-3">
            <div className="text-[11px] font-semibold text-slate-500">Sub-Sellers Sold</div>
            <div className="mt-1 text-xl font-bold font-mono-tabular text-slate-950">
              {formatINR(totals.sold)}
            </div>
            <div className="text-[10.5px] font-semibold text-emerald-700 mt-0.5">
              {subParties.length} Sub-Sellers · {connectedCount} Live
            </div>
          </div>
          <div className="kk-surface-card rounded-2xl px-4 py-3">
            <div className="text-[11px] font-semibold text-slate-500">Gross Bill</div>
            <div className="mt-1 text-xl font-bold font-mono-tabular text-slate-950">
              ₹{formatINR(totals.bill)}
            </div>
            <div className="text-[10.5px] font-semibold text-slate-500 mt-0.5">
              1PM + 6PM + 8PM
            </div>
          </div>
          <div className="kk-surface-card rounded-2xl px-4 py-3">
            <div className="text-[11px] font-semibold text-slate-500">Sub Prizes (-)</div>
            <div className="mt-1 text-xl font-bold font-mono-tabular text-emerald-700">
              ₹{formatINR(totals.prize)}
            </div>
            <div className="text-[10.5px] font-semibold text-slate-500 mt-0.5">
              Winning Total
            </div>
          </div>
          <div className="kk-surface-card rounded-2xl px-4 py-3">
            <div className="text-[11px] font-semibold text-slate-500">Fresh Bill (=)</div>
            <div
              className={`mt-1 text-xl font-bold font-mono-tabular ${
                totals.fresh > 0
                  ? 'text-emerald-700'
                  : totals.fresh < 0
                    ? 'text-rose-600'
                    : 'text-slate-950'
              }`}
            >
              ₹{formatINR(totals.fresh)}
            </div>
            <div className="text-[10.5px] font-semibold text-slate-500 mt-0.5">
              Bill − Prize
            </div>
          </div>
          <div className="col-span-2 lg:col-span-1 kk-brand-gradient text-white rounded-2xl px-4 py-3">
            <div className="text-[11px] font-semibold text-white/75">Net Payable Total</div>
            <div
              className={`mt-1 text-xl font-bold font-mono-tabular ${
                totals.total > 0
                  ? 'text-emerald-300'
                  : totals.total < 0
                    ? 'text-rose-300'
                    : 'text-white'
              }`}
            >
              ₹{formatINR(totals.total)}
            </div>
            <div className="text-[10.5px] font-semibold text-indigo-100 mt-0.5">
              Joma − / Due +
            </div>
          </div>
        </section>
      )}

      {adminPreviewMode && !billSheetOnly && (
        <div className="bg-amber-50 border border-amber-200 text-amber-950 rounded-2xl px-4 py-2.5 text-xs font-bold">
          Admin Preview Mode: Master Seller ({masterParty.name}) apne phone par login karke yahan se Sub-Sellers add, Joma/Due update aur WhatsApp par Bill bhej sakte hain.
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl px-4 py-2.5 text-xs font-bold">
          {errorMsg}
        </div>
      )}

      {/* Agent-Style Toolbar: [All Cols | Cards] + [Rate & Mob] + [+ Add Sub-Seller] */}
      <div className="kk-surface-card flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {billSheetOnly && (
            <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-black text-slate-950 mr-1">
              <Users className="w-4 h-4 text-[var(--kk-brand)] shrink-0" />
              <span>Sub-Sellers Bill ({subParties.length})</span>
            </span>
          )}
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

          {!adminPreviewMode && (
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                setShowAddForm((prev) => !prev);
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-[var(--kk-brand)] hover:bg-[var(--kk-brand-hover)] rounded-xl cursor-pointer whitespace-nowrap transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showAddForm ? 'Close' : 'Add Sub-Seller'}</span>
            </button>
          )}

          {billSheetOnly && onOpenManageChain && (
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                onOpenManageChain();
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-[var(--kk-brand)] bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl cursor-pointer whitespace-nowrap transition-colors"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>IDs &amp; Chain</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline Add Sub-Seller Form (mirrors Agent's Add Seller + Multi-Level Chain toggle) */}
      {showAddForm && !adminPreviewMode && (
        <form
          onSubmit={handleCreateSub}
          className="bg-white border border-slate-200 rounded-2xl p-3.5 shadow-xs space-y-2.5"
        >
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-end gap-2.5">
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-800">
              <span>Sub-Seller Name</span>
              <input
                type="text"
                required
                placeholder="RAJU"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-950 bg-slate-50 border border-slate-200 rounded-xl uppercase sm:w-36 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-800">
              <span>WhatsApp Mobile</span>
              <input
                type="tel"
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
                min="0"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                className="px-3 py-1.5 text-xs font-semibold font-mono-tabular text-slate-950 bg-slate-50 border border-slate-200 rounded-xl sm:w-20 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-800">
              <span>Due (₹)</span>
              <FormulaNumberInput
                id="new-sub-seller-due"
                label="NEW SUB · DUE"
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
                disabled={busyAction === 'create'}
                className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-xl cursor-pointer"
              >
                {busyAction === 'create' ? 'Saving...' : 'Save & Create ID'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 pt-1 border-t border-slate-100 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={newAllowChain}
              onChange={(e) => setNewAllowChain(e.target.checked)}
              className="w-4 h-4 rounded accent-[var(--kk-brand)] cursor-pointer"
            />
            <span className="text-[11px] font-bold text-slate-700">
              Multi-Level Chain ON: Is Sub-Seller ko bhi aage apne Sub-Seller IDs banane dein
            </span>
          </label>
        </form>
      )}

      {/* LIST-WISE SUB-SELLER BILLING TABLE (EXACT MIRROR OF AGENT'S BILL TAB) */}
      {viewMode === 'all' ? (
        <div className="kk-surface-card rounded-2xl overflow-hidden">
          <div className="overflow-x-auto ledger-scroll">
            <table className="w-max min-w-full sm:min-w-[860px] border-collapse text-[13px] sm:text-[14px]">
              <thead>
                <tr className="kk-table-head text-slate-100 text-[11px] sm:text-xs font-bold uppercase tracking-[0.02em] sm:tracking-[0.04em] align-middle">
                  <th className="bill-col-name sticky left-0 z-20 bg-[var(--kk-brand)] sm:min-w-[124px] px-2 sm:px-3 py-3 text-left border-r border-white/15 whitespace-nowrap shadow-[2px_0_6px_-2px_rgba(0,0,0,0.28)]">
                    NAME
                  </th>
                  <th className="bill-col-sess px-1 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">MOR</th>
                  <th className="bill-col-sess px-1 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">DAY</th>
                  <th className="bill-col-sess px-1 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">EVE</th>
                  <th className="bill-col-sold px-1 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">SOLD</th>
                  <th className="bill-col-bill px-1 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">BILL</th>
                  <th className="bill-col-fresh px-1.5 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">FRESH</th>
                  <th className="px-2 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">1PM ₹</th>
                  <th className="px-2 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">6PM ₹</th>
                  <th className="px-2 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">8PM ₹</th>
                  <th className="px-2 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">
                    JOMA<span className="hidden sm:inline"> (-)</span>
                  </th>
                  <th className="px-2 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">
                    DUE<span className="hidden sm:inline"> (+)</span>
                  </th>
                  <th className="px-2.5 sm:px-3 py-3 text-right border-r border-white/10 whitespace-nowrap">TOTAL</th>
                  {showRateMobile && (
                    <>
                      <th className="px-2 sm:px-2.5 py-3 text-left border-r border-white/10 whitespace-nowrap">MOBILE</th>
                      <th className="px-2 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">RATE</th>
                    </>
                  )}
                  <th className="px-2 sm:px-2.5 py-3 text-center whitespace-nowrap">SEND</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 text-slate-950 font-mono-tabular">
                {subBillRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={showRateMobile ? 16 : 14}
                      className="px-4 py-8 text-center font-sans text-sm font-medium text-slate-500"
                    >
                      Abhi koi Sub-Seller add nahi hua hai. &ldquo;+ Add Sub-Seller&rdquo; tap karke add karein.
                    </td>
                  </tr>
                ) : (
                  subBillRows.map(({ sub, bill, priv }, idx) => {
                    const mobile = priv?.mobile || '';
                    return (
                      <tr
                        key={sub.partyId}
                        className={`align-middle ${
                          !sub.active
                            ? 'bg-rose-50/45'
                            : idx % 2 === 1
                              ? 'bg-slate-50/75'
                              : 'bg-white'
                        } hover:bg-indigo-50/40 transition-colors`}
                      >
                        <td
                          className={`bill-col-name sticky left-0 z-10 sm:min-w-[124px] px-2 sm:px-3 py-3 border-r border-slate-200/90 font-sans font-extrabold text-[13px] sm:text-[14px] text-slate-900 whitespace-nowrap shadow-[2px_0_6px_-2px_rgba(15,23,42,0.08)] ${
                            !sub.active
                              ? 'bg-rose-50'
                              : idx % 2 === 1
                                ? 'bg-slate-50'
                                : 'bg-white'
                          }`}
                        >
                          <span className="block whitespace-nowrap">{sub.name}</span>
                        </td>
                        <td className="bill-col-sess px-1 sm:px-2.5 py-3 text-right font-semibold border-r border-slate-200/70 whitespace-nowrap">
                          {formatINR(bill.mor)}
                        </td>
                        <td className="bill-col-sess px-1 sm:px-2.5 py-3 text-right font-semibold border-r border-slate-200/70 whitespace-nowrap">
                          {formatINR(bill.day)}
                        </td>
                        <td className="bill-col-sess px-1 sm:px-2.5 py-3 text-right font-semibold border-r border-slate-200/70 whitespace-nowrap">
                          {formatINR(bill.eve)}
                        </td>
                        <td className="bill-col-sold px-1 sm:px-2.5 py-3 text-right font-extrabold text-[var(--kk-brand)] bg-indigo-50/40 border-r border-slate-200/70 whitespace-nowrap">
                          {formatINR(bill.sold)}
                        </td>
                        <td className="bill-col-bill px-1 sm:px-2.5 py-3 text-right font-bold border-r border-slate-200/70 whitespace-nowrap">
                          {formatINR(bill.bill)}
                        </td>
                        <td
                          className={`bill-col-fresh px-1.5 sm:px-2.5 py-3 text-right font-extrabold border-r border-slate-200/70 whitespace-nowrap ${
                            bill.fresh > 0
                              ? 'text-emerald-700'
                              : bill.fresh < 0
                                ? 'text-rose-600'
                                : 'text-slate-900'
                          }`}
                        >
                          {formatINR(bill.fresh)}
                        </td>
                        <td
                          className={`px-2 sm:px-2.5 py-2.5 sm:py-3 text-right border-r border-slate-200/70 whitespace-nowrap ${
                            bill.amt1pm > 0 ? 'font-bold text-emerald-700' : 'font-semibold'
                          }`}
                        >
                          {formatINR(bill.amt1pm)}
                        </td>
                        <td
                          className={`px-2 sm:px-2.5 py-2.5 sm:py-3 text-right border-r border-slate-200/70 whitespace-nowrap ${
                            bill.amt6pm > 0 ? 'font-bold text-emerald-700' : 'font-semibold'
                          }`}
                        >
                          {formatINR(bill.amt6pm)}
                        </td>
                        <td
                          className={`px-2 sm:px-2.5 py-2.5 sm:py-3 text-right border-r border-slate-200/70 whitespace-nowrap ${
                            bill.amt8pm > 0 ? 'font-bold text-emerald-700' : 'font-semibold'
                          }`}
                        >
                          {formatINR(bill.amt8pm)}
                        </td>
                        <td className="p-1 sm:p-1.5 border-r border-slate-200/70">
                          {adminPreviewMode ? (
                            <span className="block px-2 py-1.5 text-right text-[13.5px] font-bold">
                              {formatINR(bill.joma)}
                            </span>
                          ) : (
                            <FormulaNumberInput
                              id={`sub-bill-joma-${sub.partyId}`}
                              label={`${sub.name} · JOMA`}
                              value={bill.joma}
                              onCommit={(val) => void handleInlinePatchSub(sub, { joma: val })}
                              onActiveSessionChange={handleActiveFormulaChange}
                              compactBillWrapper
                              placeholder="0"
                              className={`ios-compact-input-bill w-full sm:h-9 px-2 text-right text-[13.5px] sm:text-[14px] font-bold font-mono-tabular rounded-lg sm:rounded-md border focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)] transition-colors ${
                                bill.joma !== 0
                                  ? 'bg-white border-slate-300 text-slate-950'
                                  : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-950 placeholder:text-slate-400'
                              }`}
                            />
                          )}
                        </td>
                        <td className="p-1 sm:p-1.5 border-r border-slate-200/70">
                          {adminPreviewMode ? (
                            <span className="block px-2 py-1.5 text-right text-[13.5px] font-bold">
                              {formatINR(bill.due)}
                            </span>
                          ) : (
                            <FormulaNumberInput
                              id={`sub-bill-due-${sub.partyId}`}
                              label={`${sub.name} · DUE`}
                              value={bill.due}
                              onCommit={(val) => void handleInlinePatchSub(sub, { due: val })}
                              onActiveSessionChange={handleActiveFormulaChange}
                              compactBillWrapper
                              placeholder="0"
                              className={`ios-compact-input-bill w-full sm:h-9 px-2 text-right text-[13.5px] sm:text-[14px] font-bold font-mono-tabular rounded-lg sm:rounded-md border focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)] transition-colors ${
                                bill.due !== 0
                                  ? 'bg-white border-slate-300 text-slate-950'
                                  : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-950 placeholder:text-slate-400'
                              }`}
                            />
                          )}
                        </td>
                        <td
                          className={`px-2.5 sm:px-3 py-2.5 sm:py-3 text-right text-[13.5px] sm:text-[14.5px] font-extrabold bg-indigo-50/40 border-r border-slate-200/70 whitespace-nowrap ${
                            bill.total > 0
                              ? 'text-emerald-700'
                              : bill.total < 0
                                ? 'text-rose-600'
                                : 'text-slate-900'
                          }`}
                        >
                          {formatINR(bill.total)}
                        </td>
                        {showRateMobile && (
                          <>
                            <td className="p-1 sm:p-1.5 border-r border-slate-200/70 min-w-[120px]">
                              <div className="ios-compact-wrap-bill">
                                <input
                                  type="tel"
                                  disabled={adminPreviewMode}
                                  defaultValue={mobile}
                                  key={`mob-${sub.partyId}-${mobile}`}
                                  onBlur={(e) => {
                                    const nextMob = e.target.value.trim();
                                    if (nextMob !== mobile) {
                                      void handleInlinePatchSub(sub, { mobile: nextMob });
                                    }
                                  }}
                                  placeholder="91..."
                                  className="ios-compact-input-bill w-full sm:h-9 px-2 text-[13px] font-semibold font-mono-tabular text-slate-950 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg sm:rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)] transition-colors disabled:opacity-75"
                                />
                              </div>
                            </td>
                            <td className="p-1 sm:p-1.5 border-r border-slate-200/70 min-w-[64px]">
                              <div className="ios-compact-wrap-bill">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.05"
                                  disabled={adminPreviewMode}
                                  defaultValue={sub.rate}
                                  key={`rate-${sub.partyId}-${sub.rate}`}
                                  onBlur={(e) => {
                                    const parsed = parseFloat(e.target.value);
                                    const nextRate = Number.isFinite(parsed) && parsed >= 0 ? parsed : sub.rate;
                                    if (nextRate !== sub.rate) {
                                      void handleInlinePatchSub(sub, { rate: nextRate });
                                    }
                                  }}
                                  className="ios-compact-input-bill w-full sm:h-9 px-2 text-right text-[13.5px] sm:text-[14px] font-bold font-mono-tabular text-slate-950 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg sm:rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)] transition-colors disabled:opacity-75"
                                />
                              </div>
                            </td>
                          </>
                        )}
                        <td className="px-2 py-1.5 text-center font-sans whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openSubBillPreview(sub.name, bill)}
                              title={`View ${sub.name} Bill Card`}
                              className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-bold text-[var(--kk-brand)] bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg cursor-pointer transition-colors"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>Card</span>
                            </button>
                            <button
                              type="button"
                              disabled={sendingSubBillId !== null}
                              onClick={() => void handleSendSubBillCard(sub.partyId, sub.name, bill)}
                              title={`Send ${sub.name} Bill Card on WhatsApp`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer transition-colors disabled:opacity-60"
                            >
                              {sendingSubBillId === sub.partyId ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Send className="w-3.5 h-3.5" />
                              )}
                              <span>Send</span>
                            </button>
                            {!adminPreviewMode && (
                              <button
                                type="button"
                                onClick={() => {
                                  AppSounds.warning();
                                  setDeleteConfirm({ sub, step: 1 });
                                }}
                                className="p-1.5 text-slate-500 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-lg cursor-pointer transition-colors"
                                title={`Delete ${sub.name}`}
                                aria-label={`Delete ${sub.name}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {subBillRows.length > 0 && (
                <tfoot>
                  <tr className="kk-table-head text-white text-[13px] sm:text-[14px] font-extrabold font-mono-tabular align-middle">
                    <td className="bill-col-name sticky left-0 z-10 bg-[var(--kk-brand)] sm:min-w-[124px] px-2 sm:px-3 py-3 font-sans text-[11.5px] sm:text-[13px] uppercase tracking-wide border-r border-white/15 whitespace-nowrap shadow-[2px_0_6px_-2px_rgba(0,0,0,0.28)]">
                      TOTAL ({subBillRows.length})
                    </td>
                    <td className="bill-col-sess px-1 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">
                      {formatINR(totals.mor)}
                    </td>
                    <td className="bill-col-sess px-1 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">
                      {formatINR(totals.day)}
                    </td>
                    <td className="bill-col-sess px-1 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">
                      {formatINR(totals.eve)}
                    </td>
                    <td className="bill-col-sold px-1 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">
                      {formatINR(totals.sold)}
                    </td>
                    <td className="bill-col-bill px-1 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">
                      {formatINR(totals.bill)}
                    </td>
                    <td
                      className={`bill-col-fresh px-1.5 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap ${
                        totals.fresh > 0
                          ? 'text-emerald-300'
                          : totals.fresh < 0
                            ? 'text-rose-300'
                            : 'text-white'
                      }`}
                    >
                      {formatINR(totals.fresh)}
                    </td>
                    <td className="px-2 sm:px-2.5 py-3 text-right text-emerald-300 border-r border-white/10 whitespace-nowrap">
                      {formatINR(totals.amt1pm)}
                    </td>
                    <td className="px-2 sm:px-2.5 py-3 text-right text-emerald-300 border-r border-white/10 whitespace-nowrap">
                      {formatINR(totals.amt6pm)}
                    </td>
                    <td className="px-2 sm:px-2.5 py-3 text-right text-emerald-300 border-r border-white/10 whitespace-nowrap">
                      {formatINR(totals.amt8pm)}
                    </td>
                    <td className="px-2 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">
                      {formatINR(totals.joma)}
                    </td>
                    <td className="px-2 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">
                      {formatINR(totals.due)}
                    </td>
                    <td
                      className={`px-2.5 sm:px-3 py-3 text-right text-[13.5px] sm:text-[15px] border-r border-white/10 whitespace-nowrap ${
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
                        <td className="px-2 sm:px-2.5 py-3 font-sans border-r border-white/10 whitespace-nowrap">
                          MOBILE
                        </td>
                        <td className="px-2 sm:px-2.5 py-3 text-right border-r border-white/10 whitespace-nowrap">
                          RATE
                        </td>
                      </>
                    )}
                    <td className="px-2 sm:px-2.5 py-3 text-center font-sans tracking-wide whitespace-nowrap">KK AGENCY</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      ) : (
        /* CARDS VIEW (Agent-style Bill Cards for each Sub-Seller) */
        <>
          {subBillRows.length === 0 ? (
            <div className="bg-white border border-slate-200/90 rounded-2xl p-8 text-center space-y-2 shadow-xs">
              <Users className="w-8 h-8 text-slate-300 mx-auto" />
              <div className="text-sm font-extrabold text-slate-800">
                Abhi koi Sub-Seller nahi bana hai
              </div>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Upar &ldquo;+ Add Sub-Seller&rdquo; tap karke naya Sub-Seller add karein aur WhatsApp par Bill ya Login ID bhejein.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
              {subBillRows.map(({ sub, bill, priv }) => {
                const mobile = priv?.mobile || '';
                return (
                  <div
                    key={sub.partyId}
                    className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs flex flex-col"
                  >
                    <div className="px-4 py-3 bg-[var(--kk-brand)] text-white flex items-center justify-between gap-2">
                      <span className="text-base font-extrabold tracking-tight break-words">
                        {sub.name}
                      </span>
                      {showRateMobile && (
                        <span className="text-xs font-mono-tabular font-semibold text-white/80 shrink-0">
                          ₹{sub.rate}
                        </span>
                      )}
                    </div>

                    <div className="p-4 space-y-3 text-sm">
                      <div className="grid grid-cols-4 gap-2 text-center bg-slate-50 border border-slate-200 rounded-xl p-2.5 font-mono-tabular">
                        <div>
                          <div className="font-sans text-[11px] font-bold text-amber-800">MOR</div>
                          <div className="mt-0.5 text-sm font-extrabold text-slate-950">
                            {formatINR(bill.mor)}
                          </div>
                        </div>
                        <div>
                          <div className="font-sans text-[11px] font-bold text-sky-800">DAY</div>
                          <div className="mt-0.5 text-sm font-extrabold text-slate-950">
                            {formatINR(bill.day)}
                          </div>
                        </div>
                        <div>
                          <div className="font-sans text-[11px] font-bold text-violet-800">EVE</div>
                          <div className="mt-0.5 text-sm font-extrabold text-slate-950">
                            {formatINR(bill.eve)}
                          </div>
                        </div>
                        <div>
                          <div className="font-sans text-[11px] font-bold text-[var(--kk-brand)]">SOLD</div>
                          <div className="mt-0.5 text-sm font-extrabold text-[var(--kk-brand)]">
                            {formatINR(bill.sold)}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 font-mono-tabular">
                        <div className="border border-slate-200 rounded-xl p-2.5">
                          <div className="font-sans text-[11px] font-bold text-slate-600">BILL</div>
                          <div className="mt-0.5 text-sm font-extrabold text-slate-950">
                            ₹{formatINR(bill.bill)}
                          </div>
                        </div>
                        <div className="border border-emerald-200 bg-emerald-50/60 rounded-xl p-2.5">
                          <div className="font-sans text-[11px] font-bold text-emerald-800">PRIZE (-)</div>
                          <div className="mt-0.5 text-sm font-extrabold text-emerald-700">
                            ₹{formatINR(bill.prizeTotal)}
                          </div>
                        </div>
                        <div className="border border-slate-200 rounded-xl p-2.5">
                          <div className="font-sans text-[11px] font-bold text-slate-600">FRESH</div>
                          <div
                            className={`mt-0.5 text-sm font-extrabold ${
                              bill.fresh > 0
                                ? 'text-emerald-700'
                                : bill.fresh < 0
                                  ? 'text-rose-600'
                                  : 'text-slate-950'
                            }`}
                          >
                            ₹{formatINR(bill.fresh)}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <label className="space-y-1">
                          <span className="text-xs font-bold text-sky-900">JOMA (-)</span>
                          {adminPreviewMode ? (
                            <div className="px-3 py-2 text-sm font-mono-tabular font-bold text-slate-950 bg-slate-50 border border-slate-200 rounded-xl">
                              {formatINR(bill.joma)}
                            </div>
                          ) : (
                            <FormulaNumberInput
                              id={`sub-card-joma-${sub.partyId}`}
                              label={`${sub.name} · JOMA`}
                              value={bill.joma}
                              onCommit={(val) => void handleInlinePatchSub(sub, { joma: val })}
                              onActiveSessionChange={handleActiveFormulaChange}
                              placeholder="0"
                              className="w-full px-3 py-2 text-sm font-mono-tabular font-bold text-slate-950 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                            />
                          )}
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-bold text-amber-900">DUE (+)</span>
                          {adminPreviewMode ? (
                            <div className="px-3 py-2 text-sm font-mono-tabular font-bold text-slate-950 bg-slate-50 border border-slate-200 rounded-xl">
                              {formatINR(bill.due)}
                            </div>
                          ) : (
                            <FormulaNumberInput
                              id={`sub-card-due-${sub.partyId}`}
                              label={`${sub.name} · DUE`}
                              value={bill.due}
                              onCommit={(val) => void handleInlinePatchSub(sub, { due: val })}
                              onActiveSessionChange={handleActiveFormulaChange}
                              placeholder="0"
                              className="w-full px-3 py-2 text-sm font-mono-tabular font-bold text-slate-950 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                            />
                          )}
                        </label>
                      </div>

                      {showRateMobile && (
                        <div className="grid grid-cols-3 gap-2 pt-1">
                          <label className="col-span-2 space-y-1">
                            <span className="text-xs font-bold text-slate-600">Mobile</span>
                            <input
                              type="tel"
                              disabled={adminPreviewMode}
                              defaultValue={mobile}
                              key={`cmob-${sub.partyId}-${mobile}`}
                              onBlur={(e) => {
                                const nextMob = e.target.value.trim();
                                if (nextMob !== mobile) {
                                  void handleInlinePatchSub(sub, { mobile: nextMob });
                                }
                              }}
                              className="w-full px-3 py-2 text-sm font-mono-tabular font-semibold text-slate-950 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-bold text-slate-600">Rate (₹)</span>
                            <input
                              type="number"
                              step="0.05"
                              disabled={adminPreviewMode}
                              defaultValue={sub.rate}
                              key={`crate-${sub.partyId}-${sub.rate}`}
                              onBlur={(e) => {
                                const parsed = parseFloat(e.target.value);
                                const nextRate = Number.isFinite(parsed) && parsed >= 0 ? parsed : sub.rate;
                                if (nextRate !== sub.rate) {
                                  void handleInlinePatchSub(sub, { rate: nextRate });
                                }
                              }}
                              className="w-full px-3 py-2 text-sm font-mono-tabular font-bold text-right text-slate-950 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                            />
                          </label>
                        </div>
                      )}

                      <div className="pt-2.5 border-t border-slate-200 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
                            NET PAYABLE
                          </div>
                          <div
                            className={`text-lg font-extrabold font-mono-tabular ${
                              bill.total > 0
                                ? 'text-emerald-700'
                                : bill.total < 0
                                  ? 'text-rose-600'
                                  : 'text-slate-950'
                            }`}
                          >
                            ₹{formatINR(bill.total)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openSubBillPreview(sub.name, bill)}
                            title={`View ${sub.name} Bill Card`}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-[var(--kk-brand)] bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl cursor-pointer transition-colors"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Bill Card</span>
                          </button>
                          <button
                            type="button"
                            disabled={sendingSubBillId !== null}
                            onClick={() => void handleSendSubBillCard(sub.partyId, sub.name, bill)}
                            title={`Send ${sub.name} Bill Card on WhatsApp`}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl cursor-pointer transition-colors disabled:opacity-60"
                          >
                            {sendingSubBillId === sub.partyId ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                            <span>Send Card</span>
                          </button>
                          {!adminPreviewMode && (
                            <button
                              type="button"
                              onClick={() => {
                                AppSounds.warning();
                                setDeleteConfirm({ sub, step: 1 });
                              }}
                              className="p-2 text-slate-500 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-xl cursor-pointer transition-colors"
                              title={`Delete ${sub.name}`}
                              aria-label={`Delete ${sub.name}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {subBillRows.length > 0 && (
            <div className="bg-[var(--kk-brand)] text-white border border-[var(--kk-brand)] rounded-2xl overflow-hidden shadow-xs">
              <div className="px-4 py-3 flex items-center justify-between text-sm font-bold border-b border-white/10">
                <span>TOTAL ({subBillRows.length} Sub-Sellers)</span>
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
              <div className="grid grid-cols-4 sm:grid-cols-8 text-center font-mono-tabular">
                <div className="px-2 py-2.5 border-r border-b sm:border-b-0 border-white/10">
                  <div className="font-sans text-[11px] font-semibold text-indigo-200">MOR</div>
                  <div className="mt-0.5 text-xs sm:text-sm font-bold">{formatINR(totals.mor)}</div>
                </div>
                <div className="px-2 py-2.5 border-r border-b sm:border-b-0 border-white/10">
                  <div className="font-sans text-[11px] font-semibold text-indigo-200">DAY</div>
                  <div className="mt-0.5 text-xs sm:text-sm font-bold">{formatINR(totals.day)}</div>
                </div>
                <div className="px-2 py-2.5 border-r border-b sm:border-b-0 border-white/10">
                  <div className="font-sans text-[11px] font-semibold text-indigo-200">EVE</div>
                  <div className="mt-0.5 text-xs sm:text-sm font-bold">{formatINR(totals.eve)}</div>
                </div>
                <div className="px-2 py-2.5 border-b sm:border-b-0 sm:border-r border-white/10">
                  <div className="font-sans text-[11px] font-semibold text-indigo-200">SOLD</div>
                  <div className="mt-0.5 text-xs sm:text-sm font-bold">{formatINR(totals.sold)}</div>
                </div>
                <div className="px-2 py-2.5 border-r border-white/10">
                  <div className="font-sans text-[11px] font-semibold text-indigo-200">BILL</div>
                  <div className="mt-0.5 text-xs sm:text-sm font-bold">₹{formatINR(totals.bill)}</div>
                </div>
                <div className="px-2 py-2.5 border-r border-white/10">
                  <div className="font-sans text-[11px] font-semibold text-emerald-300">PRIZE</div>
                  <div className="mt-0.5 text-xs sm:text-sm font-bold text-emerald-300">
                    ₹{formatINR(totals.prize)}
                  </div>
                </div>
                <div className="px-2 py-2.5 border-r border-white/10">
                  <div className="font-sans text-[11px] font-semibold text-indigo-200">JOMA</div>
                  <div className="mt-0.5 text-xs sm:text-sm font-bold">₹{formatINR(totals.joma)}</div>
                </div>
                <div className="px-2 py-2.5">
                  <div className="font-sans text-[11px] font-semibold text-amber-300">DUE</div>
                  <div className="mt-0.5 text-xs sm:text-sm font-bold text-amber-200">
                    ₹{formatINR(totals.due)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* SUB-SELLER LOGIN IDs, LIVE ENTRIES & CHAIN CONTROLS (Shown on full Chain tab) */}
      {!billSheetOnly && subParties.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs sm:text-sm font-black text-slate-900 flex items-center gap-1.5 uppercase tracking-wide">
              <KeyRound className="w-4 h-4 text-[var(--kk-brand)]" />
              <span>Sub-Seller Login IDs &amp; Live Chain Entries</span>
            </h3>
          </div>

          {subParties.map((sub) => {
            const bill = subBillsByPartyId[sub.partyId];
            const priv = privMap[sub.partyId];
            const mobile = priv?.mobile || '';
            const subLoginId = priv?.loginId || '';
            const subLoginPass = priv?.loginPassword || '';
            const subHasCreds = Boolean(subLoginId && subLoginPass);
            const inviteLink = subHasCreds
              ? buildSellerPortalUrl(subLoginId, false)
              : buildSellerPortalUrl(sub.accessKey, true);
            const { waUrl: inviteWaUrl } = buildSellerInviteWhatsAppUrl(
              sub.name,
              sub.rate,
              mobile,
              subHasCreds ? subLoginId : sub.accessKey,
              subLoginPass
            );
            const copyCredsText = subHasCreds
              ? `Login ID: ${subLoginId}\nPassword: ${subLoginPass}\nLink: ${inviteLink}`
              : sub.accessKey;
            const isClaimed = Boolean(sub.assignedUid);
            const isBusy = busyAction.includes(sub.partyId);
            const nestedDescIds = collectDescendantPartyIds(sub.partyId, allChainParties);
            const branchIds = new Set<string>([sub.partyId, ...Array.from(nestedDescIds)]);
            const branchSheets = subSheets.filter((s) => branchIds.has(s.partyId));
            const liveRows: Array<{
              key: string;
              sessionId: SessionId;
              sellerLabel: string;
              item: string;
              start: string;
              end: string;
              range: string;
              qty: number;
            }> = [];
            for (const sid of ['1PM', '6PM', '8PM'] as SessionId[]) {
              for (const sh of branchSheets) {
                const rawList =
                  sid === '1PM' ? sh.entries1PM : sid === '6PM' ? sh.entries6PM : sh.entries8PM;
                if (!rawList || rawList.length === 0) continue;
                const sName = (partyById.get(sh.partyId)?.name || sh.partyName || sub.name).trim();
                const comp = processSessionRows(
                  rawList.map((r, i) => ({ ...r, id: r.id || `${sh.partyId}-${i}`, name: sName })),
                  sid,
                  config
                );
                for (const proc of comp.rows) {
                  if (
                    proc.statusType === 'empty' &&
                    !proc.item.trim() &&
                    !proc.start.trim() &&
                    !proc.end.trim()
                  ) {
                    continue;
                  }
                  liveRows.push({
                    key: `${sid}-${sh.partyId}-${proc.id}`,
                    sessionId: sid,
                    sellerLabel: sh.partyId === sub.partyId ? sName : `${sName} (Sub)`,
                    item: proc.item || '—',
                    start: proc.start || '—',
                    end: proc.end || '—',
                    range: proc.range > 0 ? String(proc.range) : proc.rangeOverride.trim() || '—',
                    qty: proc.qty,
                  });
                }
              }
            }
            const isEntriesOpen = expandedEntriesId === sub.partyId;

            return (
              <div
                key={`chain-id-${sub.partyId}`}
                className={`bg-white border rounded-2xl p-4 shadow-xs space-y-3 ${
                  sub.active ? 'border-slate-200/90' : 'border-rose-200 bg-rose-50/35'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-black text-slate-950">{sub.name}</span>
                      {!sub.active ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[10.5px] font-extrabold">
                          <CloudOff className="w-3 h-3" />
                          Paused
                        </span>
                      ) : isClaimed ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10.5px] font-extrabold">
                          <Smartphone className="w-3 h-3" />
                          Phone Live
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10.5px] font-extrabold">
                          <KeyRound className="w-3 h-3" />
                          Ready to Login
                        </span>
                      )}
                      {sub.role === 'master' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-100 text-[var(--kk-brand)] text-[10.5px] font-extrabold">
                          <Users className="w-3 h-3" />
                          Sub-Master{nestedDescIds.size > 0 ? ` (+${nestedDescIds.size})` : ''}
                        </span>
                      )}
                    </div>
                    {mobile && (
                      <div className="text-[11px] font-mono-tabular text-slate-500 mt-0.5">
                        Mob: {mobile}
                      </div>
                    )}
                  </div>

                  {!adminPreviewMode && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          AppSounds.tap();
                          setBusyAction(`role-${sub.partyId}`);
                          try {
                            await toggleSellerChainRole(
                              sub,
                              sub.role === 'master' ? 'client' : 'master'
                            );
                          } catch (err) {
                            setErrorMsg(formatCleanError(err, 'Chain permission update nahi ho saka'));
                          } finally {
                            setBusyAction('');
                          }
                        }}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-xl border cursor-pointer disabled:opacity-50 ${
                          sub.role === 'master'
                            ? 'text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border-indigo-200'
                            : 'text-slate-700 bg-slate-100 hover:bg-slate-200 border-slate-200'
                        }`}
                      >
                        <Users className="w-3.5 h-3.5" />
                        <span>{sub.role === 'master' ? 'Chain ON' : 'Chain OFF'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          AppSounds.tap();
                          setBusyAction(`toggle-${sub.partyId}`);
                          try {
                            await toggleSubSellerActive(sub, !sub.active);
                          } catch (err) {
                            setErrorMsg(formatCleanError(err, 'Status update nahi ho saka'));
                          } finally {
                            setBusyAction('');
                          }
                        }}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-xl border cursor-pointer disabled:opacity-50 ${
                          sub.active
                            ? 'text-amber-800 bg-amber-50 hover:bg-amber-100 border-amber-200'
                            : 'text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'
                        }`}
                      >
                        {sub.active ? (
                          <>
                            <PauseCircle className="w-3.5 h-3.5" />
                            <span>Pause</span>
                          </>
                        ) : (
                          <>
                            <PlayCircle className="w-3.5 h-3.5" />
                            <span>Resume</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          AppSounds.warning();
                          setBusyAction(`reset-${sub.partyId}`);
                          try {
                            await resetSubSellerAccessKey(
                              masterUid,
                              sub,
                              sheetIds.has(sub.partyId),
                              priv
                            );
                          } catch (err) {
                            setErrorMsg(formatCleanError(err, 'Password reset nahi ho saka'));
                          } finally {
                            setBusyAction('');
                          }
                        }}
                        title="Purane phone ko logout karein aur naya Password banayein"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                        <span>New Pass</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Live Ticket Entries Toggle */}
                <div className="border border-emerald-200/80 rounded-xl overflow-hidden bg-emerald-50/30">
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      setExpandedEntriesId(isEntriesOpen ? null : sub.partyId);
                    }}
                    className="w-full px-3 py-2 flex items-center justify-between gap-2 text-xs font-extrabold text-emerald-950 hover:bg-emerald-50/70 transition-colors cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
                      <span>
                        Live Entries ({liveRows.length} rows)
                        {nestedDescIds.size > 0 ? ` · incl. ${nestedDescIds.size} sub-chain` : ''}
                      </span>
                    </span>
                    {isEntriesOpen ? (
                      <ChevronUp className="w-4 h-4 text-emerald-700" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-emerald-700" />
                    )}
                  </button>

                  {isEntriesOpen && (
                    <div className="border-t border-emerald-200/70 bg-white">
                      {liveRows.length === 0 ? (
                        <div className="px-3 py-3 text-[11px] font-semibold text-slate-500 text-center">
                          Abhi {sub.name} ki koi ticket entry nahi aayi hai. Entry hote hi yahan live dikhegi.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse text-[11px]">
                            <thead>
                              <tr className="bg-slate-50 text-slate-500 text-[10px] font-extrabold uppercase border-b border-slate-200">
                                <th className="py-1.5 px-2">Time</th>
                                <th className="py-1.5 px-2">Seller</th>
                                <th className="py-1.5 px-2">Item</th>
                                <th className="py-1.5 px-2">Start–End</th>
                                <th className="py-1.5 px-2 text-right">Qty</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-mono-tabular">
                              {liveRows.map((r) => (
                                <tr key={r.key}>
                                  <td className="py-1.5 px-2 font-black text-[var(--kk-brand)]">
                                    {r.sessionId}
                                  </td>
                                  <td className="py-1.5 px-2 font-sans font-bold text-slate-800 whitespace-nowrap">
                                    {r.sellerLabel}
                                  </td>
                                  <td className="py-1.5 px-2 font-bold text-slate-900">{r.item}</td>
                                  <td className="py-1.5 px-2 text-slate-700 whitespace-nowrap">
                                    {r.start}
                                    {r.end !== '—' ? ` – ${r.end}` : ''}
                                  </td>
                                  <td className="py-1.5 px-2 text-right font-black text-emerald-800">
                                    {formatINR(r.qty)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Sub-Seller Easy Login ID + Password + Share Strip */}
                <div className="bg-slate-50 border border-slate-200/90 rounded-xl px-3 py-2.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {subHasCreds ? (
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <div className="px-2.5 py-1 rounded-lg bg-white border border-indigo-200/80">
                          <div className="text-[9.5px] font-extrabold uppercase tracking-wider text-slate-500">
                            Login ID
                          </div>
                          <div className="text-xs sm:text-sm font-black font-mono-tabular text-[var(--kk-brand)] select-all">
                            {subLoginId}
                          </div>
                        </div>
                        <div className="px-2.5 py-1 rounded-lg bg-white border border-emerald-200/80">
                          <div className="text-[9.5px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5 text-emerald-700" />
                            <span>Password</span>
                          </div>
                          <div className="text-xs sm:text-sm font-black font-mono-tabular text-emerald-800 select-all">
                            {subLoginPass}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs font-bold text-amber-800">
                        &ldquo;Edit&rdquo; ya &ldquo;New Pass&rdquo; dabakar easy Login ID &amp; Password set karein
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {!adminPreviewMode && (
                        <button
                          type="button"
                          onClick={() => {
                            AppSounds.tap();
                            if (editingCredPartyId === sub.partyId) {
                              setEditingCredPartyId(null);
                              return;
                            }
                            setEditingCredPartyId(sub.partyId);
                            setEditLoginId(
                              subLoginId ||
                                sub.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12)
                            );
                            setEditLoginPass(subLoginPass || '');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => void copyText(copyCredsText, `id-${sub.partyId}`)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer"
                      >
                        {copiedToken === `id-${sub.partyId}` ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedToken === `id-${sub.partyId}` ? 'Copied' : 'ID/Pass'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void copyText(inviteLink, `link-${sub.partyId}`)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer"
                      >
                        {copiedToken === `link-${sub.partyId}` ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Link2 className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedToken === `link-${sub.partyId}` ? 'Copied' : 'Link'}</span>
                      </button>

                      {bill && (
                        <button
                          type="button"
                          disabled={sendingSubBillId !== null}
                          onClick={() => void handleSendSubBillCard(sub.partyId, sub.name, bill)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                        >
                          {sendingSubBillId === sub.partyId ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Send className="w-3.5 h-3.5" />
                          )}
                          <span>Bill Card</span>
                        </button>
                      )}

                      <a
                        href={inviteWaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => AppSounds.success()}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-[var(--kk-brand)] bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>WhatsApp ID</span>
                      </a>
                    </div>
                  </div>

                  {!adminPreviewMode && editingCredPartyId === sub.partyId && (
                    <form
                      onSubmit={(e) => void handleSaveSubCreds(e, sub)}
                      className="pt-2 border-t border-slate-200/80 grid grid-cols-1 sm:grid-cols-12 gap-2"
                    >
                      <input
                        type="text"
                        required
                        minLength={2}
                        maxLength={32}
                        value={editLoginId}
                        onChange={(e) =>
                          setEditLoginId(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))
                        }
                        placeholder="Login ID (e.g. RAJU)"
                        className="sm:col-span-5 px-2.5 py-1.5 text-xs font-black font-mono-tabular uppercase bg-white border border-slate-300 rounded-lg outline-none focus:border-[var(--kk-brand)]"
                      />
                      <input
                        type="text"
                        required
                        minLength={4}
                        maxLength={32}
                        value={editLoginPass}
                        onChange={(e) => setEditLoginPass(e.target.value)}
                        placeholder="Password (min 4 digits)"
                        className="sm:col-span-4 px-2.5 py-1.5 text-xs font-black font-mono-tabular bg-white border border-slate-300 rounded-lg outline-none focus:border-[var(--kk-brand)]"
                      />
                      <div className="sm:col-span-3 flex items-center gap-1">
                        <button
                          type="submit"
                          disabled={isBusy}
                          className="flex-1 px-2.5 py-1.5 text-xs font-extrabold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCredPartyId(null)}
                          className="px-2 py-1.5 text-xs font-bold text-slate-600 bg-slate-200/70 rounded-lg cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Two-Step Confirmation Modal for Deleting a Sub-Seller */}
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
          >
            <motion.div
              key={`${deleteConfirm.sub.partyId}-${deleteConfirm.step}`}
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
                  <h3 className="text-sm font-bold">
                    {deleteConfirm.step === 1
                      ? `Delete Sub-Seller "${deleteConfirm.sub.name}"?`
                      : `Final Confirmation: Remove "${deleteConfirm.sub.name}"`}
                  </h3>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                  {deleteConfirm.step === 1
                    ? `Kya aap "${deleteConfirm.sub.name}" ko apni Sub-Seller list se delete karna chahte hain? Unka login ID bhi band ho jayega.`
                    : `Final step: "${deleteConfirm.sub.name}" ka Sub-Seller account aur unki sheet permanently delete ho jayegi.`}
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(null)}
                    className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  {deleteConfirm.step === 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        AppSounds.warning();
                        setDeleteConfirm({ sub: deleteConfirm.sub, step: 2 });
                      }}
                      className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl cursor-pointer"
                    >
                      Yes, Continue
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleConfirmDeleteSub()}
                      className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl cursor-pointer"
                    >
                      Delete Permanently
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live Formula Bar for inline JOMA / DUE math expressions */}
      <SheetFormulaBar session={activeFormula} />
    </div>
  );
}
