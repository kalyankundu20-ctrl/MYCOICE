import { Check, Palette, Volume2, VolumeX, X } from 'lucide-react';
import { useState } from 'react';
import { AgencyConfig, AppState, DaySnapshot } from '../types/ledger';
import {
  AppSounds,
  getSoundStyle,
  previewSoundStyle,
  setSoundEnabled,
  SOUND_STYLES,
  SoundStyleId,
} from '../utils/sound';
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
  const [activeSound, setActiveSound] = useState<SoundStyleId>(() => getSoundStyle());

  const activeTheme = resolveThemeOption(state.config.theme).id;
  const soundOn = state.config.soundEnabled !== false;

  const handleSelectTheme = (themeId: AppThemeId) => {
    applyDocumentTheme(themeId);
    onUpdateConfig({ theme: themeId, themeVersion: 3 });
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

  const handleSelectSoundStyle = (styleId: SoundStyleId) => {
    setActiveSound(styleId);
    if (!soundOn) {
      setSoundEnabled(true);
      onUpdateConfig({ soundEnabled: true });
    }
    previewSoundStyle(styleId);
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
        className="kk-drawer-in w-full max-w-md bg-white h-full overflow-y-auto overscroll-y-contain border-l border-slate-200 shadow-2xl flex flex-col"
      >
            <div className="kk-brand-gradient text-white sticky top-0 z-10 pt-[env(safe-area-inset-top)] transition-colors">
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

              {/* App Theme Selector */}
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-[var(--kk-tint)] border border-[var(--kk-tint-border)] text-[var(--kk-brand)] flex items-center justify-center">
                      <Palette className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-slate-900">App Theme</h3>
                      <p className="text-[11px] font-medium text-slate-500">
                        Choose your executive color style
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {APP_THEMES.map((theme) => {
                    const isSelected = activeTheme === theme.id;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => handleSelectTheme(theme.id)}
                        className={`group relative text-left rounded-xl p-2.5 border transition-all cursor-pointer ${
                          isSelected
                            ? 'border-[var(--kk-brand)] bg-[var(--kk-tint)] shadow-xs ring-1 ring-[var(--kk-brand)]/25'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70'
                        }`}
                      >
                        <div
                          className="h-9 rounded-lg mb-2 flex items-center justify-between px-2.5 shadow-inner"
                          style={{
                            backgroundImage: `linear-gradient(135deg, ${theme.brand} 0%, ${theme.brandMid} 55%, ${theme.brandEnd} 100%)`,
                          }}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full ring-2 ring-white/30"
                            style={{ backgroundColor: theme.accentDot }}
                          />
                          {isSelected && (
                            <span className="w-5 h-5 rounded-full bg-white text-slate-900 flex items-center justify-center shadow-xs">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-bold text-slate-900 leading-tight">
                          {theme.name}
                        </div>
                        <div className="text-[10px] font-medium text-slate-500 mt-0.5">
                          {theme.tagline}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <hr className="border-slate-200" />

              {/* Sound Style & Tone Controls */}
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-[var(--kk-tint)] border border-[var(--kk-tint-border)] text-[var(--kk-brand)] flex items-center justify-center">
                      {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-slate-900">App Sound &amp; Tone</h3>
                      <p className="text-[11px] font-medium text-slate-500">
                        Tap any tone to preview &amp; apply
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleToggleSound}
                    aria-pressed={soundOn}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-lg border transition-colors cursor-pointer ${
                      soundOn
                        ? 'bg-[var(--kk-brand)] text-white border-[var(--kk-brand)]'
                        : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                    }`}
                  >
                    {soundOn ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                    <span>{soundOn ? 'Sound ON' : 'Muted'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {SOUND_STYLES.map((style) => {
                    const isSelected = activeSound === style.id;
                    return (
                      <button
                        key={style.id}
                        type="button"
                        onClick={() => handleSelectSoundStyle(style.id)}
                        className={`text-left rounded-xl px-3 py-2.5 border transition-all cursor-pointer flex items-start justify-between gap-2 ${
                          isSelected
                            ? 'border-[var(--kk-brand)] bg-[var(--kk-tint)] ring-1 ring-[var(--kk-brand)]/25'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70'
                        }`}
                      >
                        <div className="min-w-0">
                          <div
                            className={`text-xs font-bold leading-tight ${
                              isSelected ? 'text-[var(--kk-brand)]' : 'text-slate-900'
                            }`}
                          >
                            {style.label}
                          </div>
                          <div className="text-[10px] font-medium text-slate-500 mt-0.5 truncate">
                            {style.desc}
                          </div>
                        </div>
                        {isSelected && (
                          <span className="w-4 h-4 rounded-full bg-[var(--kk-brand)] text-white flex items-center justify-center shrink-0 mt-0.5">
                            <Check className="w-2.5 h-2.5 stroke-[3]" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
      </div>
    </div>
  );
}
