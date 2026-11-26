import { Check, Copy, Eye, RotateCcw, Search, Send, Trophy } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeSellerPrizeDispatches,
  formatDateDDMM,
  formatINR,
  isMyChoiceName,
} from '../engine/calculations';
import { PrizeListRow, Seller, SessionId } from '../types/ledger';
import { AppSounds } from '../utils/sound';
import { NameFilterOption, NameFilterPopover } from './NameFilterPopover';

interface PrizeListViewProps {
  date: string;
  prizeList: PrizeListRow[];
  sellers: Seller[];
  excludedNames: string[];
  onPreviewMessage: (title: string, subtitle: string, message: string, waUrl: string) => void;
}

const CONFETTI_PIECES = [
  { id: 1, x: '8%', dx: -18, dy: -28, rot: -45, color: '#10b981', delay: 0.02, w: 6, h: 6 },
  { id: 2, x: '15%', dx: 14, dy: -36, rot: 70, color: '#f59e0b', delay: 0.05, w: 8, h: 4 },
  { id: 3, x: '22%', dx: -10, dy: -26, rot: 120, color: '#0f1742', delay: 0.08, w: 5, h: 5 },
  { id: 4, x: '31%', dx: 22, dy: -34, rot: -85, color: '#34d399', delay: 0.03, w: 7, h: 4 },
  { id: 5, x: '40%', dx: -16, dy: -40, rot: 45, color: '#fbbf24', delay: 0.09, w: 6, h: 6 },
  { id: 6, x: '50%', dx: 8, dy: -38, rot: -110, color: '#10b981', delay: 0.04, w: 8, h: 4 },
  { id: 7, x: '58%', dx: -20, dy: -30, rot: 95, color: '#38bdf8', delay: 0.07, w: 5, h: 5 },
  { id: 8, x: '67%', dx: 18, dy: -36, rot: -60, color: '#f59e0b', delay: 0.03, w: 7, h: 4 },
  { id: 9, x: '75%', dx: -12, dy: -32, rot: 130, color: '#10b981', delay: 0.06, w: 6, h: 6 },
  { id: 10, x: '83%', dx: 16, dy: -28, rot: -40, color: '#fbbf24', delay: 0.02, w: 8, h: 4 },
  { id: 11, x: '90%', dx: -14, dy: -34, rot: 80, color: '#34d399', delay: 0.08, w: 5, h: 5 },
  { id: 12, x: '26%', dx: 12, dy: 26, rot: -90, color: '#fbbf24', delay: 0.1, w: 5, h: 5 },
  { id: 13, x: '46%', dx: -14, dy: 28, rot: 65, color: '#10b981', delay: 0.06, w: 6, h: 4 },
  { id: 14, x: '64%', dx: 15, dy: 24, rot: -75, color: '#38bdf8', delay: 0.09, w: 5, h: 5 },
  { id: 15, x: '80%', dx: -10, dy: 26, rot: 115, color: '#f59e0b', delay: 0.05, w: 6, h: 4 },
];

function useAnimatedValue(target: number, triggerKey: number, durationMs = 680): number {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (target <= 0) {
      setDisplay(0);
      return;
    }

    let rafId = 0;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(target * eased));
      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        setDisplay(target);
      }
    };

    setDisplay(0);
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [target, triggerKey, durationMs]);

  return display;
}

function getRankBadgeClass(rank: string): string {
  const r = rank.toLowerCase();
  if (r.startsWith('1')) return 'bg-amber-100 text-amber-900 border-amber-300';
  if (r.startsWith('2')) return 'bg-emerald-100 text-emerald-900 border-emerald-300';
  if (r.startsWith('3')) return 'bg-sky-100 text-sky-900 border-sky-300';
  return 'bg-slate-100 text-slate-800 border-slate-200';
}

export function PrizeListView({
  date,
  prizeList,
  sellers,
  excludedNames,
  onPreviewMessage,
}: PrizeListViewProps) {
  const [sessionFilter, setSessionFilter] = useState<'ALL' | SessionId>('ALL');
  const [selectedNames, setSelectedNames] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState('');
  const [revealKey, setRevealKey] = useState(1);
  const [copiedSellerKey, setCopiedSellerKey] = useState<string | null>(null);
  const prevPrizeSignatureRef = useRef<string>('');

  const visiblePrizeList = useMemo(
    () => prizeList.filter((p) => !isMyChoiceName(p.name)),
    [prizeList]
  );

  const displayedExcludedNames = useMemo(() => {
    const list = excludedNames.map((n) => n.trim().toUpperCase()).filter(Boolean);
    return list.some((n) => isMyChoiceName(n)) ? list : ['MY CHOICE', ...list];
  }, [excludedNames]);

  const nameFilterOptions = useMemo<NameFilterOption[]>(() => {
    const map = new Map<string, { label: string; count: number; total: number }>();
    for (const p of visiblePrizeList) {
      if (sessionFilter !== 'ALL' && p.time !== sessionFilter) continue;
      const key = p.name.trim().toUpperCase();
      const prev = map.get(key);
      if (prev) {
        prev.count += 1;
        prev.total += p.total;
      } else {
        map.set(key, { label: p.name, count: 1, total: p.total });
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, info]) => ({
        key,
        label: info.label,
        meta: `${info.count} · ₹${formatINR(info.total)}`,
      }));
  }, [visiblePrizeList, sessionFilter]);

  const filtered = visiblePrizeList.filter((row) => {
    if (sessionFilter !== 'ALL' && row.time !== sessionFilter) return false;
    if (selectedNames !== null && !selectedNames.has(row.name.trim().toUpperCase())) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        row.name.toLowerCase().includes(q) ||
        row.number.toLowerCase().includes(q) ||
        row.rank.toLowerCase().includes(q) ||
        row.item.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totals = filtered.reduce(
    (acc, r) => ({
      prize: acc.prize + r.prize,
      vc: acc.vc + r.vc,
      svc: acc.svc + r.svc,
      total: acc.total + r.total,
    }),
    { prize: 0, vc: 0, svc: 0, total: 0 }
  );

  // Trigger celebratory reveal animation + ascending chime when prizeList appears or updates
  const prizeSignature = visiblePrizeList.map((p) => p.id).join('|');
  useEffect(() => {
    if (visiblePrizeList.length > 0 && prizeSignature !== prevPrizeSignatureRef.current) {
      prevPrizeSignatureRef.current = prizeSignature;
      setRevealKey((k) => k + 1);
      AppSounds.prizeReveal();
    } else if (visiblePrizeList.length === 0) {
      prevPrizeSignatureRef.current = '';
    }
  }, [visiblePrizeList.length, prizeSignature]);

  const animatedGrandTotal = useAnimatedValue(totals.total, revealKey);
  const animatedCount = useAnimatedValue(filtered.length, revealKey, 480);

  const sellerDispatches = useMemo(
    () =>
      computeSellerPrizeDispatches(
        filtered,
        sellers,
        date,
        sessionFilter === 'ALL' ? undefined : sessionFilter
      ),
    [filtered, sellers, date, sessionFilter]
  );

  const handleCopyPrizeMessage = async (sellerKey: string, message: string) => {
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      const el = document.createElement('textarea');
      el.value = message;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    AppSounds.success();
    setCopiedSellerKey(sellerKey);
    window.setTimeout(() => {
      setCopiedSellerKey((curr) => (curr === sellerKey ? null : curr));
    }, 1600);
  };

  const handleReplayReveal = () => {
    AppSounds.prizeReveal();
    setRevealKey((k) => k + 1);
  };

  return (
    <div className="space-y-3">
      {/* Animated Prize Reveal Hero Banner */}
      <AnimatePresence mode="wait">
        {visiblePrizeList.length > 0 && (
          <motion.div
            key={`banner-${revealKey}`}
            initial={{ opacity: 0, y: -10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden kk-brand-gradient text-white rounded-2xl px-4 py-3.5 shadow-sm"
          >
            {/* Contained confetti burst */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
              {CONFETTI_PIECES.map((c) => (
                <motion.span
                  key={`${revealKey}-${c.id}`}
                  initial={{
                    opacity: 0,
                    x: 0,
                    y: 0,
                    scale: 0.4,
                    rotate: 0,
                  }}
                  animate={{
                    opacity: [0, 1, 1, 0],
                    x: c.dx * 2.2,
                    y: c.dy * 1.4,
                    scale: [0.4, 1.15, 0.9, 0.5],
                    rotate: c.rot,
                  }}
                  transition={{
                    duration: 1.15,
                    delay: c.delay,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  style={{
                    position: 'absolute',
                    left: c.x,
                    top: '50%',
                    width: c.w,
                    height: c.h,
                    backgroundColor: c.color,
                    borderRadius: c.w === c.h ? '9999px' : '2px',
                  }}
                />
              ))}
            </div>

            <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <motion.div
                  initial={{ scale: 0.5, rotate: -18 }}
                  animate={{ scale: [0.5, 1.15, 1], rotate: [-18, 6, 0] }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0"
                >
                  <Trophy className="w-5 h-5 text-amber-300" />
                </motion.div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold tracking-tight text-white">
                      Prize List Revealed
                    </span>
                  </div>
                  <p className="text-xs font-medium text-indigo-100/90 mt-0.5 font-mono-tabular">
                    {animatedCount} {filtered.length === 1 ? 'winning ticket' : 'winning tickets'} matched
                    {sessionFilter !== 'ALL' ? ` • ${sessionFilter}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 ml-auto">
                <div className="text-right">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200/90">
                    Total Prize Payout
                  </div>
                  <motion.div
                    initial={{ scale: 0.92 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: 0.35, delay: 0.15 }}
                    className="text-lg sm:text-xl font-bold font-mono-tabular text-emerald-300 leading-tight"
                  >
                    ₹{formatINR(animatedGrandTotal)}
                  </motion.div>
                </div>

                <button
                  type="button"
                  onClick={handleReplayReveal}
                  title="Replay prize reveal animation"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-white bg-white/10 hover:bg-white/20 border border-white/15 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Replay</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header & Filters */}
      <div className="kk-surface-card rounded-2xl px-3.5 py-3 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 border border-slate-200 rounded-xl">
            {(['ALL', '1PM', '6PM', '8PM'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  setSessionFilter(s);
                }}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg cursor-pointer transition-colors ${
                  sessionFilter === s
                    ? 'bg-white text-[var(--kk-brand)] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {s === 'ALL' ? 'All' : s}
              </button>
            ))}
          </div>

          <NameFilterPopover
            title="Name"
            options={nameFilterOptions}
            selectedKeys={selectedNames}
            onChange={setSelectedNames}
            variant="toolbar-light"
            align="left"
          />

          <div className="relative flex-1 min-w-[130px] sm:flex-initial">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search number..."
              className="h-9 sm:h-auto pl-8 pr-2.5 py-1 sm:py-1.5 text-base sm:text-xs font-medium text-slate-950 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-xl w-full sm:w-48 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
            />
          </div>
        </div>

        <div className="text-xs font-semibold text-slate-600">
          Excluded: <span className="font-bold text-slate-950">{displayedExcludedNames.join(', ')}</span>
        </div>
      </div>

      {/* Seller-Wise Send Prize Links */}
      {sellerDispatches.length > 0 && (
        <section
          aria-label="Seller-wise send prize links"
          className="kk-surface-card rounded-2xl overflow-hidden"
        >
          <div className="px-3.5 py-2.5 kk-table-head text-white flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Send className="w-3.5 h-3.5 text-emerald-300" />
              <span className="text-xs sm:text-sm font-bold tracking-tight">
                Seller-Wise Send Prize
              </span>
              {sessionFilter !== 'ALL' && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-white/15 rounded-md">
                  {sessionFilter}
                </span>
              )}
            </div>
            <span className="text-[11px] font-semibold font-mono-tabular text-indigo-100">
              {sellerDispatches.length} {sellerDispatches.length === 1 ? 'seller' : 'sellers'}
            </span>
          </div>

          <div className="p-2.5 bg-slate-50/60 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {sellerDispatches.map((d) => {
              const isCopied = copiedSellerKey === d.sellerKey;
              return (
                <div
                  key={d.sellerKey}
                  className="bg-white border border-slate-200/90 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] hover:border-emerald-300/80 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-8 rounded-lg bg-emerald-50 border border-emerald-200/80 text-emerald-800 font-extrabold font-mono-tabular text-[11px] flex items-center justify-center shrink-0">
                      {d.time}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-950 truncate">
                          {d.name}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-500 font-mono-tabular shrink-0">
                          ({d.ticketCount})
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs font-extrabold font-mono-tabular text-emerald-700">
                          ₹{formatINR(d.total)}
                        </span>
                        <span className="text-[10px] font-semibold text-slate-400 truncate">
                          · {d.time} Total
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={d.waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => AppSounds.success()}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap"
                      title={`Send ${d.time} ${d.name} Prize List on WhatsApp`}
                    >
                      <Send className="w-3 h-3" />
                      <span>Send {d.time}</span>
                    </a>

                    <button
                      type="button"
                      onClick={() => handleCopyPrizeMessage(d.sellerKey, d.waMessage)}
                      className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                      title={`Copy ${d.time} ${d.name} prize message`}
                    >
                      {isCopied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-700" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        AppSounds.tap();
                        onPreviewMessage(
                          `${d.time} - ${d.name} Prize List`,
                          `Date: ${formatDateDDMM(date)} · ${d.ticketCount} winning • ₹${formatINR(d.total)}`,
                          d.waMessage,
                          d.waUrl
                        );
                      }}
                      className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                      title={`Preview ${d.time} ${d.name} prize message`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Single-Screen Prize List Table (TIME to TOTAL — 100% Fit on One Screen) */}
      <div className="kk-surface-card rounded-2xl overflow-hidden">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="bg-gradient-to-r from-emerald-900 via-emerald-800 to-teal-800 text-emerald-50 text-[9px] sm:text-xs font-bold uppercase tracking-normal sm:tracking-[0.03em]">
              <th className="w-[8%] px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-left border-r border-white/10 truncate">TIME</th>
              <th className="w-[16.5%] px-1 sm:px-2.5 py-2.5 sm:py-3 text-left border-r border-white/10">NAME</th>
              <th className="w-[11.5%] px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-center border-r border-white/10 truncate">NUMBER</th>
              <th className="w-[8.5%] px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-center border-r border-white/10 truncate">RANK</th>
              <th className="w-[7%] px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-center border-r border-white/10 truncate">ITEM</th>
              <th className="w-[12.5%] px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-right border-r border-white/10 truncate">PRIZE</th>
              <th className="w-[10%] px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-right border-r border-white/10 truncate">VC</th>
              <th className="w-[9.5%] px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-right border-r border-white/10 truncate">SVC</th>
              <th className="w-[16.5%] px-1 sm:px-3 py-2.5 sm:py-3 text-right truncate">TOTAL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/80 text-slate-950 text-[10.5px] sm:text-[13.5px] font-mono-tabular">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center font-sans text-xs sm:text-sm font-semibold text-slate-600">
                  No winning tickets matched yet.
                </td>
              </tr>
            ) : (
              filtered.map((row, idx) => (
                <motion.tr
                  key={`${revealKey}-${row.id}`}
                  initial={{
                    opacity: 0,
                    y: 12,
                    backgroundColor: 'rgba(16, 185, 129, 0.16)',
                  }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    backgroundColor: idx % 2 === 1 ? 'rgba(248, 250, 252, 0.7)' : 'rgba(255, 255, 255, 0)',
                  }}
                  transition={{
                    duration: 0.32,
                    delay: Math.min(idx * 0.045, 0.72),
                    ease: [0.22, 1, 0.36, 1],
                    backgroundColor: {
                      duration: 0.9,
                      delay: Math.min(idx * 0.045, 0.72) + 0.08,
                    },
                  }}
                  className="hover:bg-emerald-50/45 transition-colors align-middle"
                >
                  <td className="px-0.5 sm:px-2.5 py-2.5 sm:py-3 font-sans font-bold text-slate-600 border-r border-slate-200/70 truncate">
                    {row.time}
                  </td>
                  <td className="px-1 sm:px-2.5 py-2.5 sm:py-3 font-sans font-bold text-slate-950 border-r border-slate-200/70 whitespace-normal break-words leading-tight">
                    {row.name}
                  </td>
                  <td className="px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-center font-extrabold text-[var(--kk-brand)] border-r border-slate-200/70 tracking-[-0.02em] sm:tracking-normal whitespace-nowrap">
                    {row.number}
                  </td>
                  <td className="px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-center font-sans font-bold border-r border-slate-200/70">
                    <span
                      className={`inline-block px-1 sm:px-2 py-0.5 rounded border text-[9.5px] sm:text-xs leading-tight ${getRankBadgeClass(
                        row.rank
                      )}`}
                    >
                      {row.rank}
                    </span>
                  </td>
                  <td className="px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-center font-extrabold text-slate-800 border-r border-slate-200/70 whitespace-nowrap">
                    {row.item}
                  </td>
                  <td className="px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-right font-semibold border-r border-slate-200/70 tracking-[-0.03em] sm:tracking-normal whitespace-nowrap">
                    {formatINR(row.prize)}
                  </td>
                  <td className="px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-right font-semibold border-r border-slate-200/70 tracking-[-0.03em] sm:tracking-normal whitespace-nowrap">
                    {formatINR(row.vc)}
                  </td>
                  <td className="px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-right font-semibold border-r border-slate-200/70 tracking-[-0.03em] sm:tracking-normal whitespace-nowrap">
                    {formatINR(row.svc)}
                  </td>
                  <td className="px-1 sm:px-3 py-2.5 sm:py-3 text-right font-extrabold text-emerald-700 tracking-[-0.03em] sm:tracking-normal whitespace-nowrap">
                    {formatINR(row.total)}
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <motion.tr
                key={`total-${revealKey}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.3,
                  delay: Math.min(filtered.length * 0.045, 0.72) + 0.08,
                }}
                className="bg-slate-100 font-extrabold text-[10.5px] sm:text-[13.5px] font-mono-tabular text-slate-950 border-t border-slate-200 align-middle"
              >
                <td colSpan={5} className="px-1.5 sm:px-3 py-2.5 sm:py-3 font-sans text-left border-r border-slate-200 truncate">
                  TOTAL ({filtered.length})
                </td>
                <td className="px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-right border-r border-slate-200 tracking-[-0.03em] sm:tracking-normal whitespace-nowrap">
                  {formatINR(totals.prize)}
                </td>
                <td className="px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-right border-r border-slate-200 tracking-[-0.03em] sm:tracking-normal whitespace-nowrap">
                  {formatINR(totals.vc)}
                </td>
                <td className="px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-right border-r border-slate-200 tracking-[-0.03em] sm:tracking-normal whitespace-nowrap">
                  {formatINR(totals.svc)}
                </td>
                <td className="px-1 sm:px-3 py-2.5 sm:py-3 text-right text-emerald-800 tracking-[-0.03em] sm:tracking-normal whitespace-nowrap">
                  <span className="hidden sm:inline">₹</span>{formatINR(totals.total)}
                </td>
              </motion.tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
