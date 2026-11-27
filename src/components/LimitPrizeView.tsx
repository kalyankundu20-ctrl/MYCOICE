import { ExternalLink, Eye } from 'lucide-react';
import { motion } from 'motion/react';
import { Fragment, memo } from 'react';
import { formatINR } from '../engine/calculations';
import { LimitPrizeSessionGroup } from '../types/ledger';
import { AppSounds } from '../utils/sound';

interface LimitPrizeViewProps {
  groups: LimitPrizeSessionGroup[];
  grandTotal: number;
  limitThreshold: number;
  onPreviewMessage: (title: string, subtitle: string, message: string, waUrl: string) => void;
}

export const LimitPrizeView = memo(function LimitPrizeView({
  groups,
  grandTotal,
  limitThreshold,
  onPreviewMessage,
}: LimitPrizeViewProps) {
  const totalLimitRows = groups.reduce((acc, g) => acc + g.rows.length, 0);
  const animateRows = totalLimitRows <= 40;

  return (
    <div className="space-y-3">
      <div className="kk-surface-card rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-950">Limit Prize Report</h2>
          <p className="text-xs font-medium text-slate-600 mt-0.5">
            Winning numbers exceeding {limitThreshold} tickets with excess Prize + VC payout.
          </p>
        </div>

        <div className="text-right">
          <div className="text-xs font-bold text-slate-600">Grand Total</div>
          <div className="text-lg font-bold font-mono-tabular text-red-700">
            ₹{formatINR(grandTotal)}
          </div>
        </div>
      </div>

      {/* Single-Screen Limit Prize Table (TIME to TOTAL — Exact Same Size as Prize List) */}
      <div className="kk-surface-card rounded-2xl overflow-hidden">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="bg-gradient-to-r from-rose-900 via-rose-800 to-red-800 text-rose-50 text-[9px] sm:text-xs font-bold uppercase tracking-normal sm:tracking-[0.03em]">
              <th className="w-[10%] px-1 sm:px-2.5 py-2.5 sm:py-3 text-left border-r border-white/10 truncate">TIME</th>
              <th className="w-[20%] px-1 sm:px-2.5 py-2.5 sm:py-3 text-center border-r border-white/10 truncate">NUMBER</th>
              <th className="w-[10%] px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-center border-r border-white/10 truncate">RANK</th>
              <th className="w-[10%] px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-center border-r border-white/10 truncate">ITEM</th>
              <th className="w-[16%] px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-right border-r border-white/10 truncate">PRIZE</th>
              <th className="w-[14%] px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-right border-r border-white/10 truncate">VC</th>
              <th className="w-[20%] px-1 sm:px-3 py-2.5 sm:py-3 text-right truncate">TOTAL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/80 dark:divide-slate-700/45 text-slate-950 dark:text-slate-100 text-[10.5px] sm:text-[13.5px] font-mono-tabular">
            {groups.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center font-sans text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-400">
                  No over-limit winning numbers detected.
                </td>
              </tr>
            ) : (
              groups.map((group, groupIdx) => (
                <Fragment key={group.sessionId}>
                  {group.rows.map((row, rowIdx) => {
                    const rowClass = `${
                      rowIdx % 2 === 1
                        ? 'bg-slate-50/55 dark:bg-slate-800/35'
                        : 'bg-white dark:bg-slate-900/45'
                    } hover:bg-rose-50/35 dark:hover:bg-rose-500/15 transition-colors align-middle`;
                    const rowCells = (
                      <>
                        <td className="px-1 sm:px-2.5 py-2.5 sm:py-3 font-sans font-bold text-slate-600 dark:text-slate-300 border-r border-slate-200/70 dark:border-slate-700/45 truncate">
                          {row.time}
                        </td>
                        <td className="px-1 sm:px-2.5 py-2.5 sm:py-3 text-center font-extrabold text-[var(--kk-brand)] dark:text-sky-300 border-r border-slate-200/70 dark:border-slate-700/45">
                          <div className="whitespace-nowrap">{row.number}</div>
                          {row.sellers && row.sellers.length > 0 && (
                            <div className="font-sans text-[9.5px] sm:text-xs font-semibold text-slate-600 dark:text-slate-300 leading-tight mt-0.5 whitespace-normal break-words">
                              {row.sellers.map((s) => `${s.sellerName}(${s.qty})`).join(' · ')}
                            </div>
                          )}
                        </td>
                        <td className="px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-center font-sans font-bold border-r border-slate-200/70 dark:border-slate-700/45">
                          <span className="inline-block px-1 sm:px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-[9.5px] sm:text-xs leading-tight">
                            {row.rank}
                          </span>
                        </td>
                        <td className="px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-center font-extrabold text-rose-700 dark:text-rose-400 border-r border-slate-200/70 dark:border-slate-700/45 whitespace-nowrap">
                          {row.item}
                        </td>
                        <td className="px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-right font-semibold border-r border-slate-200/70 dark:border-slate-700/45 tracking-[-0.03em] sm:tracking-normal whitespace-nowrap">
                          {formatINR(row.prize)}
                        </td>
                        <td className="px-0.5 sm:px-2.5 py-2.5 sm:py-3 text-right font-semibold border-r border-slate-200/70 dark:border-slate-700/45 tracking-[-0.03em] sm:tracking-normal whitespace-nowrap">
                          {formatINR(row.vc)}
                        </td>
                        <td className="px-1 sm:px-3 py-2.5 sm:py-3 text-right font-extrabold text-slate-950 dark:text-white tracking-[-0.03em] sm:tracking-normal whitespace-nowrap">
                          {formatINR(row.total)}
                        </td>
                      </>
                    );

                    if (!animateRows) {
                      return (
                        <tr key={row.id} className={rowClass}>
                          {rowCells}
                        </tr>
                      );
                    }

                    return (
                      <motion.tr
                        key={row.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.28,
                          delay: Math.min((groupIdx * 4 + rowIdx) * 0.045, 0.55),
                          ease: [0.22, 1, 0.36, 1],
                        }}
                        className={rowClass}
                      >
                        {rowCells}
                      </motion.tr>
                    );
                  })}

                  <tr className="bg-slate-50/90 dark:bg-slate-800/60 font-bold text-[10.5px] sm:text-[13.5px]">
                    <td colSpan={4} className="px-2 sm:px-3 py-2 border-r border-slate-200/70 dark:border-slate-700/45">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <a
                          href={group.waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => AppSounds.success()}
                          className="inline-flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap"
                        >
                          <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                          <span>Send {group.sessionId} prize</span>
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            AppSounds.tap();
                            onPreviewMessage(
                              `${group.sessionId} Limit Prize`,
                              `${group.sessionId} Total: ₹${formatINR(group.sessionTotal)}`,
                              group.waMessage,
                              group.waUrl
                            );
                          }}
                          className="inline-flex items-center gap-1 px-2 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-bold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer"
                        >
                          <Eye className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                          <span>Preview</span>
                        </button>
                      </div>
                    </td>
                    <td colSpan={3} className="px-2 sm:px-3.5 py-2 text-right font-mono-tabular font-extrabold text-slate-950 dark:text-white whitespace-nowrap">
                      {group.sessionId} ₹{formatINR(group.sessionTotal)}
                    </td>
                  </tr>
                </Fragment>
              ))
            )}
          </tbody>
          {groups.length > 0 && (
            <tfoot>
              <tr className="kk-table-head text-white font-extrabold text-[10.5px] sm:text-[13.5px]">
                <td colSpan={4} className="px-2 sm:px-3.5 py-2.5 sm:py-3 text-left uppercase tracking-wider truncate">
                  GRAND TOTAL
                </td>
                <td colSpan={3} className="px-2 sm:px-3.5 py-2.5 sm:py-3 text-right font-mono-tabular whitespace-nowrap">
                  ₹{formatINR(grandTotal)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
});
