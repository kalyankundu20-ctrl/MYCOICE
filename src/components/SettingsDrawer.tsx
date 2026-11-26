import { Archive, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { formatDateDDMMYYYY, formatINR } from '../engine/calculations';
import { AgencyConfig, AppState, DaySnapshot } from '../types/ledger';
import { AppSounds } from '../utils/sound';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  state: AppState;
  onChangeBillingDate: (newDate: string) => void;
  onUpdateConfig: (patch: Partial<AgencyConfig>) => void;
  onUpdateExtraNames: (names: string[]) => void;
  onRestoreSnapshot: (snapshot: DaySnapshot) => void;
  onArchiveNow: () => void;
  onOpenArchiveSheet: () => void;
}

export function SettingsDrawer({
  isOpen,
  onClose,
  state,
  onChangeBillingDate,
  onUpdateConfig,
  onUpdateExtraNames,
  onRestoreSnapshot,
  onArchiveNow,
  onOpenArchiveSheet,
}: SettingsDrawerProps) {
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="settings-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/45 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
        >
          <motion.div
            key="settings-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white h-full overflow-y-auto overscroll-y-contain border-l border-slate-200 shadow-2xl flex flex-col"
          >
            <div className="bg-[var(--kk-brand)] text-white sticky top-0 z-10 pt-[env(safe-area-inset-top)] transition-colors">
              <div className="px-5 py-3.5 flex items-center justify-between gap-2">
                <h2 id="settings-title" className="text-sm font-bold">
                  Agency Settings &amp; Archive
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    AppSounds.tap();
                    onClose();
                  }}
                  aria-label="Close settings"
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-5 pb-[max(2.25rem,env(safe-area-inset-bottom))] space-y-6 flex-1 min-w-0">
              {/* Limit & WhatsApp Config */}
              <section className="space-y-3 min-w-0">
                <h3 className="text-xs font-bold text-slate-900">
                  Date &amp; Agency Configuration
                </h3>
                <label className="block space-y-1 min-w-0">
                  <span className="text-xs font-semibold text-slate-700">
                    Active Billing Date (Customize Date)
                  </span>
                  <input
                    type="date"
                    value={state.date}
                    onChange={(e) => {
                      if (e.target.value) onChangeBillingDate(e.target.value);
                    }}
                    className="block w-full min-w-0 max-w-full box-border px-3 py-2 text-sm font-mono-tabular font-bold bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700">
                    Agency WhatsApp Number (for Send limit &amp; Send prize)
                  </span>
                  <input
                    type="text"
                    value={state.config.whatsappNumber}
                    placeholder="e.g. 918918692554"
                    onChange={(e) =>
                      onUpdateConfig({
                        whatsappNumber: e.target.value.replace(/\D/g, ''),
                        whatsappVersion: 1,
                      })
                    }
                    className="w-full px-3 py-2 text-sm font-mono-tabular bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                  />
                </label>

                <div className="space-y-3 rounded-xl border border-slate-200/90 bg-slate-50/60 p-3">
                  <div className="space-y-1.5">
                    <label className="block space-y-1">
                      <span className="text-xs font-semibold text-slate-700">
                        Admin Limit Threshold (per ticket number)
                      </span>
                      <input
                        type="number"
                        min={1}
                        value={state.config.limitThreshold}
                        onChange={(e) =>
                          onUpdateConfig({ limitThreshold: Math.max(1, Number(e.target.value) || 10) })
                        }
                        className="w-full px-3 py-2 text-sm font-mono-tabular bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                      />
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-slate-500">Quick set:</span>
                      {[10, 15, 20].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => {
                            AppSounds.tap();
                            onUpdateConfig({ limitThreshold: val });
                          }}
                          className={`px-2.5 py-0.5 text-[11px] font-bold font-mono-tabular rounded-lg border cursor-pointer transition-colors ${
                            state.config.limitThreshold === val
                              ? 'bg-[var(--kk-brand)] text-white border-[var(--kk-brand)]'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-200/80 space-y-1.5">
                    <label className="block space-y-1">
                      <span className="text-xs font-semibold text-slate-700">
                        Seller &amp; Sub-Seller Limit Threshold (per ticket number)
                      </span>
                      <input
                        type="number"
                        min={1}
                        value={state.config.sellerLimitThreshold ?? 20}
                        onChange={(e) =>
                          onUpdateConfig({
                            sellerLimitThreshold: Math.max(1, Number(e.target.value) || 20),
                          })
                        }
                        className="w-full px-3 py-2 text-sm font-mono-tabular bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                      />
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-slate-500">Quick set:</span>
                      {[10, 15, 20, 25].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => {
                            AppSounds.tap();
                            onUpdateConfig({ sellerLimitThreshold: val });
                          }}
                          className={`px-2.5 py-0.5 text-[11px] font-bold font-mono-tabular rounded-lg border cursor-pointer transition-colors ${
                            (state.config.sellerLimitThreshold ?? 20) === val
                              ? 'bg-[var(--kk-brand)] text-white border-[var(--kk-brand)]'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700">
                    Excluded Names (skip Qty &amp; Prize List; counted in Limit)
                  </span>
                  <input
                    type="text"
                    value={state.config.excludedPrizeNames.join(', ')}
                    placeholder="e.g. MY CHOICE"
                    onChange={(e) =>
                      onUpdateConfig({
                        excludedPrizeNames: e.target.value
                          .split(',')
                          .map((s) => s.trim().toUpperCase())
                          .filter(Boolean),
                      })
                    }
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700">
                    Extra Sheet Names (appear in Name dropdown)
                  </span>
                  <input
                    type="text"
                    value={state.extraNames.join(', ')}
                    placeholder="e.g. MY CHOICE"
                    onChange={(e) =>
                      onUpdateExtraNames(
                        e.target.value
                          .split(',')
                          .map((s) => s.trim().toUpperCase())
                          .filter(Boolean)
                      )
                    }
                    className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                  />
                </label>
              </section>

              <hr className="border-slate-200" />

              {/* Archive Sheet Controls */}
              <section className="space-y-3">
                <h3 className="text-xs font-bold text-slate-900">
                  Archive Sheet ({state.history.length})
                </h3>

                <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl">
                  <div className="text-xs font-bold text-emerald-950">
                    Permanent Save Active (No Auto-Clear)
                  </div>
                  <div className="text-xs text-emerald-800 mt-0.5">
                    All sellers, ticket entries, and winning numbers stay permanently saved until you manually tap Close Day or Archive &amp; New Date.
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      onArchiveNow();
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors cursor-pointer"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>Archive &amp; New Date</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      AppSounds.tap();
                      onClose();
                      onOpenArchiveSheet();
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-[var(--kk-brand)] bg-[var(--kk-tint)] hover:opacity-90 border border-[var(--kk-tint-border)] rounded-xl transition-colors cursor-pointer"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>View Archive</span>
                  </button>
                </div>

                {state.history.length > 0 && (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {state.history.slice(0, 5).map((snap) => (
                      <div
                        key={snap.id}
                        className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2"
                      >
                        <div className="text-xs space-y-0.5">
                          <div className="font-bold text-slate-900">
                            {formatDateDDMMYYYY(snap.date)}
                          </div>
                          <div className="text-slate-600 font-mono-tabular">
                            Sold: {formatINR(snap.totalSold)} · Net: ₹{formatINR(snap.totalNetPayable)}
                          </div>
                        </div>
                        {confirmRestoreId === snap.id ? (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                AppSounds.tap();
                                setConfirmRestoreId(null);
                              }}
                              className="px-2 py-1 text-[11px] font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmRestoreId(null);
                                onRestoreSnapshot(snap);
                                onClose();
                              }}
                              className="px-2.5 py-1 text-[11px] font-bold text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg cursor-pointer"
                            >
                              Confirm
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              AppSounds.tap();
                              setConfirmRestoreId(snap.id);
                            }}
                            className="px-2.5 py-1 text-xs font-bold text-[var(--kk-brand)] bg-white border border-slate-200 hover:bg-slate-100 rounded-lg cursor-pointer shrink-0"
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
