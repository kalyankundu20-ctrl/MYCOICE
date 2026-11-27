import { Check, Palette, Volume2, VolumeX, X } from 'lucide-react';
import { AgencyConfig, AppState, DaySnapshot } from '../types/ledger';
import { AppSounds, setSoundEnabled } from '../utils/sound';
import { APP_THEMES, applyDocumentTheme, AppThemeId, resolveThemeOption } from '../utils/theme';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  state: AppState;
  onChangeBillingDate: (newDate: string) => void;
  onUpdateConfig: (patch: Partial<AgencyConfig>) => void;
  onUpdateExtraNames: (names: string[]) => void;
  onRestoreSnapshot?: (snapshot: DaySnapshot) => void;
  onArchiveNow?: () => void;
  onOpenArchiveSheet?: () => void;
}

export function SettingsDrawer({
  isOpen,
  onClose,
  state,
  onChangeBillingDate,
  onUpdateConfig,
  onUpdateExtraNames,
}: SettingsDrawerProps) {
  const activeTheme = resolveThemeOption(state.config.theme).id;
  const soundOn = state.config.soundEnabled !== false;

  const handleSelectTheme = (themeId: AppThemeId) => {
    applyDocumentTheme(themeId);
    onUpdateConfig({ theme: themeId, themeVersion: 4 });
    AppSounds.tap();
  };

  const handleToggleSound = () => {
    const next = !soundOn;
    setSoundEnabled(next);
    onUpdateConfig({ soundEnabled: next });
    if (next) {
      AppSounds.success();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/45"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="kk-drawer-in w-full max-w-md bg-white dark:bg-[#0D1629] text-slate-900 dark:text-slate-100 h-full overflow-y-auto overscroll-y-contain border-l border-slate-200 dark:border-slate-700/60 shadow-2xl flex flex-col"
      >
            <div className="kk-brand-gradient kk-header-bar text-white sticky top-0 z-10 pt-[env(safe-area-inset-top)] transition-colors">
              <div className="px-5 py-3.5 flex items-center justify-between gap-2">
                <h2 id="settings-title" className="text-sm font-bold">
                  Agency Settings
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
              {/* Date & Agency Config */}
              <section className="space-y-3 min-w-0">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                  Date &amp; Agency Configuration
                </h3>
                <label className="block space-y-1 min-w-0">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Active Billing Date (Customize Date)
                  </span>
                  <input
                    type="date"
                    value={state.date}
                    onChange={(e) => {
                      if (e.target.value) onChangeBillingDate(e.target.value);
                    }}
                    className="block w-full min-w-0 max-w-full box-border px-3 py-2 text-sm font-mono-tabular font-bold bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 text-slate-950 dark:text-white rounded-xl focus:bg-white dark:focus:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
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
                    className="w-full px-3 py-2 text-sm font-mono-tabular bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 text-slate-950 dark:text-white rounded-xl focus:bg-white dark:focus:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                  />
                </label>

                <div className="space-y-3 rounded-xl border border-slate-200/90 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-900/55 p-3">
                  <div className="space-y-1.5">
                    <label className="block space-y-1">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Admin Limit Threshold (per ticket number)
                      </span>
                      <input
                        type="number"
                        min={1}
                        value={state.config.limitThreshold}
                        onChange={(e) =>
                          onUpdateConfig({ limitThreshold: Math.max(1, Number(e.target.value) || 10) })
                        }
                        className="w-full px-3 py-2 text-sm font-mono-tabular bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-700 text-slate-950 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                      />
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Quick set:</span>
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
                              ? 'bg-[var(--kk-brand)] dark:bg-sky-600 text-white border-[var(--kk-brand)] dark:border-sky-400'
                              : 'bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700/70 space-y-1.5">
                    <label className="block space-y-1">
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
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
                        className="w-full px-3 py-2 text-sm font-mono-tabular bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-700 text-slate-950 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                      />
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Quick set:</span>
                      {[10, 15, 20].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => {
                            AppSounds.tap();
                            onUpdateConfig({ sellerLimitThreshold: val });
                          }}
                          className={`px-2.5 py-0.5 text-[11px] font-bold font-mono-tabular rounded-lg border cursor-pointer transition-colors ${
                            (state.config.sellerLimitThreshold ?? 20) === val
                              ? 'bg-[var(--kk-brand)] dark:bg-sky-600 text-white border-[var(--kk-brand)] dark:border-sky-400'
                              : 'bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
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
                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 text-slate-950 dark:text-white rounded-xl focus:bg-white dark:focus:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
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
                    className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 text-slate-950 dark:text-white rounded-xl focus:bg-white dark:focus:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                  />
                </label>
              </section>

              <hr className="border-slate-200 dark:border-slate-700/70" />

              {/* App Theme Selector */}
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-[var(--kk-tint)] border border-[var(--kk-tint-border)] text-[var(--kk-brand)] dark:text-teal-300 flex items-center justify-center">
                      <Palette className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-slate-900 dark:text-white">App Theme</h3>
                      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Choose your executive color style
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {APP_THEMES.map((theme) => {
                    const isSelected = activeTheme === theme.id;
                    const isFeatured = theme.id === 'aurora-live';
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => handleSelectTheme(theme.id)}
                        className={`group relative text-left rounded-xl p-2.5 border transition-all cursor-pointer ${
                          isFeatured ? 'col-span-2' : ''
                        } ${
                          isSelected
                            ? 'border-[var(--kk-brand)] dark:border-teal-400 bg-[var(--kk-tint)] shadow-xs ring-1 ring-[var(--kk-brand)]/25 dark:ring-teal-400/35'
                            : 'border-slate-200 dark:border-slate-700/75 bg-white dark:bg-slate-900/75 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50/70 dark:hover:bg-slate-800/80'
                        }`}
                      >
                        <div
                          className="relative overflow-hidden h-9 rounded-lg mb-2 flex items-center justify-between px-2.5 shadow-inner border border-white/15"
                          style={{
                            backgroundImage:
                              theme.id === 'aurora-live'
                                ? 'radial-gradient(circle at 22% 72%, rgba(168,85,247,0.58) 0%, transparent 48%), radial-gradient(circle at 82% 24%, rgba(52,245,197,0.68) 0%, transparent 46%), linear-gradient(135deg, #061329 0%, #1D3B8A 48%, #0F766E 100%)'
                                : `linear-gradient(135deg, ${theme.brand} 0%, ${theme.brandMid} 55%, ${theme.brandEnd} 100%)`,
                          }}
                        >
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`w-2.5 h-2.5 rounded-full ring-2 ring-white/30 ${
                                theme.id === 'aurora-live' ? 'animate-pulse' : ''
                              }`}
                              style={{ backgroundColor: theme.accentDot }}
                            />
                            {theme.id === 'aurora-live' && (
                              <span className="text-[9px] font-black tracking-wider uppercase text-teal-100">
                                LIVE
                              </span>
                            )}
                          </span>
                          {isSelected && (
                            <span className="w-5 h-5 rounded-full bg-white text-slate-900 flex items-center justify-center shadow-xs">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-bold text-slate-900 dark:text-white leading-tight">
                          {theme.name}
                        </div>
                        <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                          {theme.tagline}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <hr className="border-slate-200 dark:border-slate-700/70" />

              {/* App Sound Control (Classic Click permanently active) */}
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-[var(--kk-tint)] border border-[var(--kk-tint-border)] text-[var(--kk-brand)] dark:text-teal-300 flex items-center justify-center">
                      {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-slate-900 dark:text-white">App Sound</h3>
                      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Classic Click · Snappy keypad
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleToggleSound}
                    aria-pressed={soundOn}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-lg border transition-colors cursor-pointer ${
                      soundOn
                        ? 'bg-[var(--kk-brand)] dark:bg-sky-600 text-white border-[var(--kk-brand)] dark:border-sky-400'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {soundOn ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                    <span>{soundOn ? 'Sound ON' : 'Muted'}</span>
                  </button>
                </div>
              </section>
            </div>
      </div>
    </div>
  );
}
