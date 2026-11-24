import { AlertTriangle, Archive, Calendar, ChevronDown, ChevronRight, Download, RotateCcw, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { formatDateDDMMYYYY, formatINR, isMyChoiceName } from '../engine/calculations';
import { DaySnapshot } from '../types/ledger';
import { AppSounds } from '../utils/sound';
import { NameFilterPopover } from './NameFilterPopover';

interface ArchiveViewProps {
  billingDate: string;
  onChangeBillingDate?: (newDate: string) => void;
  snapshots: DaySnapshot[];
  recycleBin?: DaySnapshot[];
  onArchiveNow: () => void;
  onRestoreSnapshot?: (snapshot: DaySnapshot) => void;
  onUpdateSnapshotDate: (snapshotId: string, newDate: string) => void;
  onDeleteSnapshot: (snapshotId: string) => void;
  onRecoverFromBin?: (snapshotId: string) => void;
  onPermanentDeleteFromBin?: (snapshotId: string) => void;
  onEmptyRecycleBin?: () => void;
  title?: string;
  subtitle?: string;
  archiveButtonLabel?: string;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  hideRestore?: boolean;
  hideLimitPrize?: boolean;
  readOnly?: boolean;
}

export function ArchiveView({
  snapshots,
  recycleBin = [],
  onArchiveNow,
  onRestoreSnapshot,
  onUpdateSnapshotDate,
  onDeleteSnapshot,
  onRecoverFromBin,
  onPermanentDeleteFromBin,
  onEmptyRecycleBin,
  title,
  subtitle,
  archiveButtonLabel = 'Archive & New Date',
  secondaryActionLabel,
  onSecondaryAction,
  hideRestore = false,
  hideLimitPrize = false,
  readOnly = false,
}: ArchiveViewProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedNames, setSelectedNames] = useState<Set<string> | null>(null);
  const [pendingDeleteSnap, setPendingDeleteSnap] = useState<DaySnapshot | null>(null);
  const [pendingRestoreSnap, setPendingRestoreSnap] = useState<DaySnapshot | null>(null);
  const [editingDateSnap, setEditingDateSnap] = useState<DaySnapshot | null>(null);
  const [editingDateValue, setEditingDateValue] = useState<string>('');
  const [recycleBinOpen, setRecycleBinOpen] = useState<boolean>(false);
  const [pendingPermDeleteSnap, setPendingPermDeleteSnap] = useState<DaySnapshot | null>(null);
  const [confirmEmptyBin, setConfirmEmptyBin] = useState<boolean>(false);

  const handleExportCsv = () => {
    const header = [
      'Archive Date',
      'Saved At',
      'Trigger',
      'Seller',
      'MOR',
      'DAY',
      'EVE',
      'SOLD',
      'Bill',
      'Prize',
      'Fresh',
      'Joma',
      'Due',
      'Total',
      'Limit Grand Total',
    ].join(',');

    const rows: string[] = [header];
    for (const snap of snapshots) {
      const sellers = snap.sellerSummaries || [];
      if (sellers.length === 0) {
        rows.push(
          [
            snap.date,
            snap.savedAt,
            snap.trigger || 'manual',
            'ALL',
            0,
            0,
            0,
            snap.totalSold,
            snap.totalBill,
            snap.totalPrize,
            snap.totalBill - snap.totalPrize,
            0,
            0,
            snap.totalNetPayable,
            snap.limitGrandTotal,
          ].join(',')
        );
      } else {
        for (const s of sellers) {
          rows.push(
            [
              snap.date,
              snap.savedAt,
              snap.trigger || 'manual',
              `"${s.name}"`,
              s.mor,
              s.day,
              s.eve,
              s.sold,
              s.bill,
              s.prizeTotal,
              s.fresh,
              s.joma,
              s.due,
              s.total,
              snap.limitGrandTotal,
            ].join(',')
          );
        }
      }
    }

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kk-agency-archive-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="kk-surface-card rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-950">
            {title || `Daily Archive Records (${snapshots.length})`}
          </h2>
          <p className="text-xs font-medium text-slate-600 mt-0.5">
            {subtitle ||
              "Archiving saves today's snapshot, carries +Total → Due & -Total → Joma to the new date, and auto-deletes records after 30 days."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!readOnly && (
            <button
              type="button"
              onClick={onArchiveNow}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors cursor-pointer"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>{archiveButtonLabel}</span>
            </button>
          )}

          {!readOnly && secondaryActionLabel && onSecondaryAction && (
            <button
              type="button"
              onClick={onSecondaryAction}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white kk-brand-gradient hover:opacity-95 rounded-xl transition-opacity cursor-pointer shadow-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{secondaryActionLabel}</span>
            </button>
          )}

          {snapshots.length > 0 && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          )}
        </div>
      </div>

      {snapshots.length === 0 ? (
        <div className="kk-surface-card rounded-2xl p-10 text-center space-y-2">
          <p className="text-sm font-bold text-slate-900">
            No archived daily records yet.
          </p>
          <p className="text-xs font-medium text-slate-600">
            Click &ldquo;Archive Current State&rdquo; above or use &ldquo;Close Day&rdquo; on Seller Bill.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {snapshots.map((snap) => {
            const isExpanded = expandedId === snap.id;
            const sellerSummaries = (snap.sellerSummaries || []).filter(
              (s) => !isMyChoiceName(s.name)
            );
            const prizeList = snap.prizeList || [];
            const limitGroups = snap.limitPrizeGroups || [];
            const overLimits = snap.overLimitTotals || { '1PM': 0, '6PM': 0, '8PM': 0 };

            const visibleSummaries = sellerSummaries.filter(
              (s) =>
                selectedNames === null ||
                selectedNames.has(s.name.trim().toUpperCase())
            );
            const sellerTotals = visibleSummaries.reduce(
              (acc, s) => ({
                mor: acc.mor + s.mor,
                day: acc.day + s.day,
                eve: acc.eve + s.eve,
                sold: acc.sold + s.sold,
                bill: acc.bill + s.bill,
                prizeTotal: acc.prizeTotal + s.prizeTotal,
                fresh: acc.fresh + s.fresh,
                joma: acc.joma + s.joma,
                due: acc.due + s.due,
                total: acc.total + s.total,
              }),
              {
                mor: 0,
                day: 0,
                eve: 0,
                sold: 0,
                bill: 0,
                prizeTotal: 0,
                fresh: 0,
                joma: 0,
                due: 0,
                total: 0,
              }
            );

            return (
              <div
                key={snap.id}
                className="kk-card-lift kk-surface-card rounded-2xl overflow-hidden"
              >
                <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      setExpandedId(isExpanded ? null : snap.id);
                    }}
                    className="flex items-center gap-2.5 text-left cursor-pointer"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-[var(--kk-brand)] shrink-0 transition-transform" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-700 shrink-0 transition-transform" />
                    )}
                    <div>
                      <div className="text-sm font-bold text-slate-950 flex flex-wrap items-center gap-1.5">
                        <span>{formatDateDDMMYYYY(snap.date)}</span>
                        <span className="text-xs font-semibold text-slate-600">
                          · {snap.trigger === 'day-close' ? 'Day Close' : snap.trigger === 'daily-auto' ? 'Daily Auto' : 'Manual'}
                          {' · '}
                          {new Date(snap.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-700 font-mono-tabular mt-0.5">
                        Sold: {formatINR(snap.totalSold)} · Bill: ₹{formatINR(snap.totalBill)} · Prize: ₹{formatINR(snap.totalPrize)} · Net:{' '}
                        <span
                          className={
                            snap.totalNetPayable > 0
                              ? 'text-emerald-700 font-bold'
                              : snap.totalNetPayable < 0
                                ? 'text-rose-600 font-bold'
                                : ''
                          }
                        >
                          ₹{formatINR(snap.totalNetPayable)}
                        </span>
                        {!hideLimitPrize && <> · Limit Prize: ₹{formatINR(snap.limitGrandTotal)}</>}
                      </div>
                    </div>
                  </button>

                  {!readOnly && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        title="Customize archived date"
                        onClick={(e) => {
                          e.stopPropagation();
                          AppSounds.tap();
                          setEditingDateSnap(snap);
                          setEditingDateValue(snap.date);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl cursor-pointer transition-colors"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Date</span>
                      </button>
                      {!hideRestore && onRestoreSnapshot && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            AppSounds.tap();
                            setPendingRestoreSnap(snap);
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-[var(--kk-brand)] bg-[var(--kk-tint)] hover:opacity-90 border border-[var(--kk-tint-border)] rounded-xl transition-colors cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Restore</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          AppSounds.warning();
                          setPendingDeleteSnap(snap);
                        }}
                        title="Move archived record to Recycle Bin"
                        className="p-1.5 text-slate-600 hover:text-red-700 hover:bg-red-50 border border-slate-200 rounded-xl transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-slate-200 p-4 space-y-4 bg-slate-50/70">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-700 font-mono-tabular">
                        <span>1PM Limit: <strong className="text-slate-950">{formatINR(overLimits['1PM'] || 0)}</strong></span>
                        <span>6PM Limit: <strong className="text-slate-950">{formatINR(overLimits['6PM'] || 0)}</strong></span>
                        <span>8PM Limit: <strong className="text-slate-950">{formatINR(overLimits['8PM'] || 0)}</strong></span>
                        <span>Prize Matches: <strong className="text-slate-950">{prizeList.length}</strong></span>
                      </div>
                      {sellerSummaries.length > 0 && (
                        <NameFilterPopover
                          title="Name"
                          options={sellerSummaries.map((s) => ({
                            key: s.name.trim().toUpperCase(),
                            label: s.name,
                            meta: `₹${formatINR(s.total)}`,
                          }))}
                          selectedKeys={selectedNames}
                          onChange={setSelectedNames}
                          variant="toolbar-light"
                          align="right"
                        />
                      )}
                    </div>

                    {sellerSummaries.length > 0 && (
                      <>
                        {/* Mobile: Full-visibility seller breakdown + TOTAL card (no horizontal clipping) */}
                        <div className="md:hidden space-y-2">
                          {visibleSummaries.map((s) => (
                            <div
                              key={s.name}
                              className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs"
                            >
                              <div className="bg-[var(--kk-brand)] text-white px-3 py-1.5 flex items-center justify-between text-xs font-bold">
                                <span>{s.name}</span>
                                <span
                                  className={`font-mono-tabular ${
                                    s.total > 0
                                      ? 'text-emerald-300'
                                      : s.total < 0
                                        ? 'text-rose-300'
                                        : 'text-white'
                                  }`}
                                >
                                  Total: ₹{formatINR(s.total)}
                                </span>
                              </div>
                              <div className="grid grid-cols-4 text-center border-b border-slate-200 bg-slate-50 font-mono-tabular text-[11px]">
                                <div className="p-1.5 border-r border-slate-200">
                                  <div className="font-sans text-[9px] font-bold text-amber-800">MOR</div>
                                  <div className="font-bold text-slate-950">{formatINR(s.mor)}</div>
                                </div>
                                <div className="p-1.5 border-r border-slate-200">
                                  <div className="font-sans text-[9px] font-bold text-sky-800">DAY</div>
                                  <div className="font-bold text-slate-950">{formatINR(s.day)}</div>
                                </div>
                                <div className="p-1.5 border-r border-slate-200">
                                  <div className="font-sans text-[9px] font-bold text-violet-800">EVE</div>
                                  <div className="font-bold text-slate-950">{formatINR(s.eve)}</div>
                                </div>
                                <div className="p-1.5 bg-indigo-50/70">
                                  <div className="font-sans text-[9px] font-bold text-[var(--kk-brand)]">SOLD</div>
                                  <div className="font-bold text-[var(--kk-brand)]">{formatINR(s.sold)}</div>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 text-center border-b border-slate-200 font-mono-tabular text-[11px]">
                                <div className="p-1.5 border-r border-slate-200">
                                  <div className="font-sans text-[9px] font-bold text-slate-600">BILL</div>
                                  <div className="font-bold text-slate-950">₹{formatINR(s.bill)}</div>
                                </div>
                                <div className="p-1.5 border-r border-slate-200 bg-emerald-50/50">
                                  <div className="font-sans text-[9px] font-bold text-emerald-800">PRIZE</div>
                                  <div className="font-bold text-emerald-700">₹{formatINR(s.prizeTotal)}</div>
                                </div>
                                <div className="p-1.5">
                                  <div className="font-sans text-[9px] font-bold text-slate-600">FRESH</div>
                                  <div
                                    className={`font-bold ${
                                      s.fresh > 0
                                        ? 'text-emerald-700'
                                        : s.fresh < 0
                                          ? 'text-rose-600'
                                          : 'text-slate-950'
                                    }`}
                                  >
                                    ₹{formatINR(s.fresh)}
                                  </div>
                                </div>
                              </div>
                              <div className="grid grid-cols-3 text-center font-mono-tabular text-[11px]">
                                <div className="p-1.5 border-r border-slate-200">
                                  <div className="font-sans text-[9px] font-bold text-sky-800">JOMA</div>
                                  <div className="font-bold text-slate-950">₹{formatINR(s.joma)}</div>
                                </div>
                                <div className="p-1.5 border-r border-slate-200">
                                  <div className="font-sans text-[9px] font-bold text-amber-800">DUE</div>
                                  <div className="font-bold text-slate-950">₹{formatINR(s.due)}</div>
                                </div>
                                <div className="p-1.5 bg-indigo-50/70">
                                  <div className="font-sans text-[9px] font-bold text-[var(--kk-brand)]">TOTAL</div>
                                  <div
                                    className={`font-extrabold ${
                                      s.total > 0
                                        ? 'text-emerald-700'
                                        : s.total < 0
                                          ? 'text-rose-600'
                                          : 'text-slate-950'
                                    }`}
                                  >
                                    ₹{formatINR(s.total)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}

                          <div className="bg-[var(--kk-brand)] text-white rounded-xl overflow-hidden shadow-xs">
                            <div className="px-3 py-2 flex items-center justify-between text-xs font-bold border-b border-white/10">
                              <span>TOTAL ({visibleSummaries.length} Sellers)</span>
                              <span
                                className={`font-mono-tabular text-sm ${
                                  sellerTotals.total > 0
                                    ? 'text-emerald-300'
                                    : sellerTotals.total < 0
                                      ? 'text-rose-300'
                                      : 'text-white'
                                }`}
                              >
                                ₹{formatINR(sellerTotals.total)}
                              </span>
                            </div>
                            <div className="grid grid-cols-4 text-center border-b border-white/10 font-mono-tabular text-[10.5px]">
                              <div className="p-1.5 border-r border-white/10">
                                <div className="font-sans text-[9px] text-indigo-200">MOR</div>
                                <div className="font-bold">{formatINR(sellerTotals.mor)}</div>
                              </div>
                              <div className="p-1.5 border-r border-white/10">
                                <div className="font-sans text-[9px] text-indigo-200">DAY</div>
                                <div className="font-bold">{formatINR(sellerTotals.day)}</div>
                              </div>
                              <div className="p-1.5 border-r border-white/10">
                                <div className="font-sans text-[9px] text-indigo-200">EVE</div>
                                <div className="font-bold">{formatINR(sellerTotals.eve)}</div>
                              </div>
                              <div className="p-1.5">
                                <div className="font-sans text-[9px] text-indigo-200">SOLD</div>
                                <div className="font-bold">{formatINR(sellerTotals.sold)}</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 text-center border-b border-white/10 font-mono-tabular text-[10.5px]">
                              <div className="p-1.5 border-r border-white/10">
                                <div className="font-sans text-[9px] text-indigo-200">BILL</div>
                                <div className="font-bold">₹{formatINR(sellerTotals.bill)}</div>
                              </div>
                              <div className="p-1.5 border-r border-white/10">
                                <div className="font-sans text-[9px] text-emerald-300">PRIZE</div>
                                <div className="font-bold text-emerald-300">₹{formatINR(sellerTotals.prizeTotal)}</div>
                              </div>
                              <div className="p-1.5">
                                <div className="font-sans text-[9px] text-indigo-200">FRESH</div>
                                <div
                                  className={`font-bold ${
                                    sellerTotals.fresh > 0
                                      ? 'text-emerald-300'
                                      : sellerTotals.fresh < 0
                                        ? 'text-rose-300'
                                        : 'text-white'
                                  }`}
                                >
                                  ₹{formatINR(sellerTotals.fresh)}
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 text-center font-mono-tabular text-[10.5px]">
                              <div className="p-1.5 border-r border-white/10">
                                <div className="font-sans text-[9px] text-indigo-200">JOMA</div>
                                <div className="font-bold">₹{formatINR(sellerTotals.joma)}</div>
                              </div>
                              <div className="p-1.5 border-r border-white/10">
                                <div className="font-sans text-[9px] text-amber-300">DUE</div>
                                <div className="font-bold text-amber-200">₹{formatINR(sellerTotals.due)}</div>
                              </div>
                              <div className="p-1.5">
                                <div className="font-sans text-[9px] text-indigo-200">TOTAL</div>
                                <div
                                  className={`font-extrabold ${
                                    sellerTotals.total > 0
                                      ? 'text-emerald-300'
                                      : sellerTotals.total < 0
                                        ? 'text-rose-300'
                                        : 'text-white'
                                  }`}
                                >
                                  ₹{formatINR(sellerTotals.total)}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Desktop Full 11-Column Table */}
                        <div className="hidden md:block overflow-x-auto kk-surface-card rounded-xl">
                          <table className="w-full border-collapse text-xs">
                            <thead>
                              <tr className="kk-table-head text-white text-[10.5px] font-bold uppercase tracking-[0.03em]">
                                <th className="px-1.5 py-1.5 text-left border-r border-white/10">
                                  <NameFilterPopover
                                    title="Seller"
                                    options={sellerSummaries.map((s) => ({
                                      key: s.name.trim().toUpperCase(),
                                      label: s.name,
                                      meta: `₹${formatINR(s.total)}`,
                                    }))}
                                    selectedKeys={selectedNames}
                                    onChange={setSelectedNames}
                                    variant="header-dark"
                                    align="left"
                                  />
                                </th>
                                <th className="px-2.5 py-2.5 text-right border-r border-white/10">MOR</th>
                                <th className="px-2.5 py-2.5 text-right border-r border-white/10">DAY</th>
                                <th className="px-2.5 py-2.5 text-right border-r border-white/10">EVE</th>
                                <th className="px-2.5 py-2.5 text-right border-r border-white/10">SOLD</th>
                                <th className="px-2.5 py-2.5 text-right border-r border-white/10">Bill</th>
                                <th className="px-2.5 py-2.5 text-right border-r border-white/10">Prize</th>
                                <th className="px-2.5 py-2.5 text-right border-r border-white/10">Fresh</th>
                                <th className="px-2.5 py-2.5 text-right border-r border-white/10">Joma</th>
                                <th className="px-2.5 py-2.5 text-right border-r border-white/10">Due</th>
                                <th className="px-2.5 py-2.5 text-right">Total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/80 font-mono-tabular text-slate-950">
                              {visibleSummaries.map((s) => (
                                <tr key={s.name} className="even:bg-slate-50/55 odd:bg-white hover:bg-indigo-50/35 transition-colors">
                                  <td className="px-2.5 py-2 font-sans font-bold text-slate-900 border-r border-slate-200/70">
                                    {s.name}
                                  </td>
                                  <td className="px-2.5 py-2 text-right border-r border-slate-200/70">{formatINR(s.mor)}</td>
                                  <td className="px-2.5 py-2 text-right border-r border-slate-200/70">{formatINR(s.day)}</td>
                                  <td className="px-2.5 py-2 text-right border-r border-slate-200/70">{formatINR(s.eve)}</td>
                                  <td className="px-2.5 py-2 text-right font-bold border-r border-slate-200/70">{formatINR(s.sold)}</td>
                                  <td className="px-2.5 py-2 text-right border-r border-slate-200/70">₹{formatINR(s.bill)}</td>
                                  <td className="px-2.5 py-2 text-right font-semibold text-emerald-700 border-r border-slate-200/70">₹{formatINR(s.prizeTotal)}</td>
                                  <td
                                    className={`px-2.5 py-2 text-right font-bold border-r border-slate-200/70 ${
                                      s.fresh > 0
                                        ? 'text-emerald-700'
                                        : s.fresh < 0
                                          ? 'text-rose-600'
                                          : 'text-slate-900'
                                    }`}
                                  >
                                    ₹{formatINR(s.fresh)}
                                  </td>
                                  <td className="px-2.5 py-2 text-right border-r border-slate-200/70">₹{formatINR(s.joma)}</td>
                                  <td className="px-2.5 py-2 text-right border-r border-slate-200/70">₹{formatINR(s.due)}</td>
                                  <td
                                    className={`px-2.5 py-2 text-right font-bold ${
                                      s.total > 0
                                        ? 'text-emerald-700'
                                        : s.total < 0
                                          ? 'text-rose-600'
                                          : 'text-slate-900'
                                    }`}
                                  >
                                    ₹{formatINR(s.total)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="kk-table-head text-white font-bold font-mono-tabular">
                                <td className="px-2.5 py-2.5 font-sans uppercase tracking-wider border-r border-white/10">TOTAL</td>
                                <td className="px-2.5 py-2.5 text-right border-r border-white/10">{formatINR(sellerTotals.mor)}</td>
                                <td className="px-2.5 py-2.5 text-right border-r border-white/10">{formatINR(sellerTotals.day)}</td>
                                <td className="px-2.5 py-2.5 text-right border-r border-white/10">{formatINR(sellerTotals.eve)}</td>
                                <td className="px-2.5 py-2.5 text-right border-r border-white/10">{formatINR(sellerTotals.sold)}</td>
                                <td className="px-2.5 py-2.5 text-right border-r border-white/10">₹{formatINR(sellerTotals.bill)}</td>
                                <td className="px-2.5 py-2.5 text-right text-emerald-300 border-r border-white/10">₹{formatINR(sellerTotals.prizeTotal)}</td>
                                <td
                                  className={`px-2.5 py-2.5 text-right border-r border-white/10 ${
                                    sellerTotals.fresh > 0
                                      ? 'text-emerald-300'
                                      : sellerTotals.fresh < 0
                                        ? 'text-rose-300'
                                        : 'text-white'
                                  }`}
                                >
                                  ₹{formatINR(sellerTotals.fresh)}
                                </td>
                                <td className="px-2.5 py-2.5 text-right border-r border-white/10">₹{formatINR(sellerTotals.joma)}</td>
                                <td className="px-2.5 py-2.5 text-right border-r border-white/10">₹{formatINR(sellerTotals.due)}</td>
                                <td
                                  className={`px-2.5 py-2.5 text-right ${
                                    sellerTotals.total > 0
                                      ? 'text-emerald-300'
                                      : sellerTotals.total < 0
                                        ? 'text-rose-300'
                                        : 'text-white'
                                  }`}
                                >
                                  ₹{formatINR(sellerTotals.total)}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </>
                    )}

                    {limitGroups.length > 0 && (
                      <div className="text-xs text-slate-900 space-y-1">
                        <div className="font-bold">Limit Prize Breakdown</div>
                        <div className="font-mono-tabular font-semibold space-y-0.5">
                          {limitGroups.map((g) => (
                            <div key={g.sessionId}>
                              {g.sessionId}: {g.rows.length} entries · Total ₹{formatINR(g.sessionTotal)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {/* Recycle Bin Section */}
      {!readOnly && onRecoverFromBin && (
        <div className="kk-surface-card rounded-2xl overflow-hidden">
          <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                setRecycleBinOpen((prev) => !prev);
              }}
              className="flex items-center gap-2.5 text-left cursor-pointer min-w-0"
            >
              {recycleBinOpen ? (
                <ChevronDown className="w-4 h-4 text-slate-600 shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
              )}
              <Trash2 className="w-4 h-4 text-rose-600 shrink-0" />
              <div>
                <div className="text-sm font-bold text-slate-950">
                  Recycle Bin ({recycleBin.length})
                </div>
                <div className="text-[11px] font-medium text-slate-600">
                  Delete ki gayi archive dates yahan safe rehti hain — jab chahein Recover karein
                </div>
              </div>
            </button>

            {recycleBin.length > 0 && onEmptyRecycleBin && (
              <button
                type="button"
                onClick={() => {
                  AppSounds.warning();
                  setConfirmEmptyBin(true);
                }}
                className="px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl cursor-pointer transition-colors shrink-0"
              >
                Empty Bin
              </button>
            )}
          </div>

          <AnimatePresence initial={false}>
            {recycleBinOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden border-t border-slate-200 bg-slate-50/70"
              >
                {recycleBin.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs font-semibold text-slate-500">
                    Recycle Bin khali hai.
                  </div>
                ) : (
                  <div className="p-3 space-y-2.5">
                    {recycleBin.map((binSnap) => (
                      <div
                        key={binSnap.id}
                        className="bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-950 flex flex-wrap items-center gap-1.5">
                            <span>{formatDateDDMMYYYY(binSnap.date)}</span>
                            <span className="text-[11px] font-semibold text-slate-500">
                              · Deleted{' '}
                              {binSnap.deletedAt
                                ? new Date(binSnap.deletedAt).toLocaleDateString('en-IN', {
                                    day: '2-digit',
                                    month: 'short',
                                  }) +
                                  ' ' +
                                  new Date(binSnap.deletedAt).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : ''}
                            </span>
                          </div>
                          <div className="text-[11px] font-semibold text-slate-600 font-mono-tabular mt-0.5">
                            Sold: {formatINR(binSnap.totalSold)} · Bill: ₹{formatINR(binSnap.totalBill)} · Prize: ₹{formatINR(binSnap.totalPrize)} · Net:{' '}
                            <span
                              className={
                                binSnap.totalNetPayable > 0
                                  ? 'text-emerald-700 font-bold'
                                  : binSnap.totalNetPayable < 0
                                    ? 'text-rose-600 font-bold'
                                    : ''
                              }
                            >
                              ₹{formatINR(binSnap.totalNetPayable)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              AppSounds.success();
                              onRecoverFromBin(binSnap.id);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl cursor-pointer transition-colors"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Recover</span>
                          </button>
                          {onPermanentDeleteFromBin && (
                            <button
                              type="button"
                              onClick={() => {
                                AppSounds.warning();
                                setPendingPermDeleteSnap(binSnap);
                              }}
                              title="Delete permanently"
                              className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 border border-rose-200 rounded-xl cursor-pointer transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Restore Archive Confirmation Modal */}
      <AnimatePresence>
        {pendingRestoreSnap && onRestoreSnapshot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4"
            onClick={() => {
              AppSounds.tap();
              setPendingRestoreSnap(null);
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
              <div className="px-4 py-3.5 bg-indigo-50 border-b border-indigo-200 flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-indigo-100 text-indigo-700 shrink-0">
                  <RotateCcw className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm font-extrabold text-indigo-950">
                    Confirm Restore Archive?
                  </h3>
                  <p className="text-[11px] font-semibold text-indigo-800">
                    Confirm karein tabhi date restore hogi
                  </p>
                </div>
              </div>

              <div className="p-4 space-y-3">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1">
                  <div className="font-bold font-mono-tabular text-slate-950">
                    Date: {formatDateDDMMYYYY(pendingRestoreSnap.date)}
                  </div>
                  <div className="font-mono-tabular text-slate-700">
                    Sold: {formatINR(pendingRestoreSnap.totalSold)} · Bill: ₹{formatINR(pendingRestoreSnap.totalBill)}
                  </div>
                  <div className="font-mono-tabular text-slate-700">
                    Prize: ₹{formatINR(pendingRestoreSnap.totalPrize)} · Net: ₹{formatINR(pendingRestoreSnap.totalNetPayable)}
                  </div>
                </div>
                <p className="text-xs font-medium text-slate-600">
                  Kya aap <strong>{formatDateDDMMYYYY(pendingRestoreSnap.date)}</strong> ka archive data restore karke dekhna chahte hain?
                </p>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      setPendingRestoreSnap(null);
                    }}
                    className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = pendingRestoreSnap;
                      setPendingRestoreSnap(null);
                      onRestoreSnapshot(target);
                    }}
                    className="px-4 py-2 text-xs font-bold text-white kk-brand-gradient hover:opacity-95 rounded-xl cursor-pointer transition-opacity"
                  >
                    Yes, Restore
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Archive Date Modal (isolated from Restore button so mobile taps never open Calendar by mistake) */}
      <AnimatePresence>
        {editingDateSnap && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4"
            onClick={() => {
              AppSounds.tap();
              setEditingDateSnap(null);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: 'spring', stiffness: 460, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xs bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[var(--kk-brand)] shrink-0" />
                <h3 className="text-sm font-extrabold text-slate-950">Change Archive Date</h3>
              </div>
              <div className="p-4 space-y-3">
                <input
                  type="date"
                  value={editingDateValue}
                  onChange={(e) => setEditingDateValue(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm font-bold font-mono-tabular text-slate-950 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-[var(--kk-brand)] focus:outline-none"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      setEditingDateSnap(null);
                    }}
                    className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!editingDateValue}
                    onClick={() => {
                      if (editingDateValue) {
                        AppSounds.success();
                        onUpdateSnapshotDate(editingDateSnap.id, editingDateValue);
                      }
                      setEditingDateSnap(null);
                    }}
                    className="px-4 py-2 text-xs font-bold text-white kk-brand-gradient hover:opacity-95 rounded-xl cursor-pointer disabled:opacity-50"
                  >
                    Save Date
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Archive Delete (Move to Recycle Bin) Confirmation Modal */}
      <AnimatePresence>
        {pendingDeleteSnap && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4"
            onClick={() => {
              AppSounds.tap();
              setPendingDeleteSnap(null);
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
                  <AlertTriangle className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm font-extrabold text-rose-950">
                    {onRecoverFromBin ? 'Move Archive to Recycle Bin?' : 'Delete Archived Record?'}
                  </h3>
                  <p className="text-[11px] font-semibold text-rose-800">
                    {onRecoverFromBin
                      ? 'Deleted record Recycle Bin me safe rahega'
                      : 'Permission required before deleting'}
                  </p>
                </div>
              </div>

              <div className="p-4 space-y-3">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1">
                  <div className="font-bold font-mono-tabular text-slate-950">
                    Date: {formatDateDDMMYYYY(pendingDeleteSnap.date)}
                  </div>
                  <div className="font-mono-tabular text-slate-700">
                    Sold: {formatINR(pendingDeleteSnap.totalSold)} · Bill: ₹{formatINR(pendingDeleteSnap.totalBill)}
                  </div>
                  <div className="font-mono-tabular text-slate-700">
                    Prize: ₹{formatINR(pendingDeleteSnap.totalPrize)} · Net: ₹{formatINR(pendingDeleteSnap.totalNetPayable)}
                  </div>
                </div>
                <p className="text-xs font-medium text-slate-600">
                  {onRecoverFromBin
                    ? 'Is archive date ko delete karne ke baad yeh Recycle Bin me chala jayega — aap jab chahein wapas Recover kar sakte hain.'
                    : 'Kya aap sach me is archive record ko delete karna chahte hain?'}
                </p>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      setPendingDeleteSnap(null);
                    }}
                    className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.remove();
                      onDeleteSnapshot(pendingDeleteSnap.id);
                      setPendingDeleteSnap(null);
                    }}
                    className="px-3.5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl cursor-pointer transition-colors"
                  >
                    {onRecoverFromBin ? 'Move to Bin' : 'Yes, Delete'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Permanent Delete from Recycle Bin Modal */}
      <AnimatePresence>
        {pendingPermDeleteSnap && onPermanentDeleteFromBin && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4"
            onClick={() => {
              AppSounds.tap();
              setPendingPermDeleteSnap(null);
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
                  <AlertTriangle className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm font-extrabold text-rose-950">
                    Delete Permanently?
                  </h3>
                  <p className="text-[11px] font-semibold text-rose-800">
                    Recycle Bin se hamesha ke liye hat jayega
                  </p>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-xs font-medium text-slate-600">
                  Kya aap <strong>{formatDateDDMMYYYY(pendingPermDeleteSnap.date)}</strong> ko Recycle Bin se permanently delete karna chahte hain?
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      setPendingPermDeleteSnap(null);
                    }}
                    className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.remove();
                      onPermanentDeleteFromBin(pendingPermDeleteSnap.id);
                      setPendingPermDeleteSnap(null);
                    }}
                    className="px-3.5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl cursor-pointer"
                  >
                    Delete Forever
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty Recycle Bin Confirmation Modal */}
      <AnimatePresence>
        {confirmEmptyBin && onEmptyRecycleBin && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4"
            onClick={() => {
              AppSounds.tap();
              setConfirmEmptyBin(false);
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
                  <AlertTriangle className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm font-extrabold text-rose-950">Empty Recycle Bin?</h3>
                  <p className="text-[11px] font-semibold text-rose-800">
                    Saare {recycleBin.length} deleted archives permanently hat jayenge
                  </p>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-xs font-medium text-slate-600">
                  Kya aap Recycle Bin ko poori tarah khali karna chahte hain?
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      setConfirmEmptyBin(false);
                    }}
                    className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.remove();
                      onEmptyRecycleBin();
                      setConfirmEmptyBin(false);
                    }}
                    className="px-3.5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl cursor-pointer"
                  >
                    Yes, Empty Bin
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
