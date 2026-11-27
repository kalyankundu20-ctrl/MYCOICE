import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Link2,
  RefreshCw,
  Trash2,
  Unlink,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import {
  extractSpreadsheetId,
  GoogleSheetSyncConfig,
  GoogleSheetTabInfo,
} from '../services/googleSheetsSync';
import { SessionId } from '../types/ledger';
import { AppSounds } from '../utils/sound';

interface GoogleSheetsSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: GoogleSheetSyncConfig;
  hasAccessToken: boolean;
  connectionMode: 'none' | 'always-on' | 'oauth';
  connectedEmail: string;
  availableTabs: GoogleSheetTabInfo[];
  syncing: boolean;
  connecting: boolean;
  lastSyncedAt: string;
  rowCounts: Record<SessionId, number>;
  errorMessage: string;
  onSignInGoogleSheets: () => Promise<void>;
  onConnectSpreadsheet: (spreadsheetId: string) => Promise<void>;
  onUpdateConfig: (patch: Partial<GoogleSheetSyncConfig>) => void;
  onSyncNow: () => Promise<void>;
  onDisconnectSheet: () => void;
  onClearSyncedRows: () => void;
}

function formatSyncTime(iso: string): string {
  if (!iso) return 'Not synced yet';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function GoogleSheetsSyncModal({
  isOpen,
  onClose,
  config,
  hasAccessToken,
  connectionMode,
  connectedEmail,
  availableTabs,
  syncing,
  connecting,
  lastSyncedAt,
  rowCounts,
  errorMessage,
  onSignInGoogleSheets,
  onConnectSpreadsheet,
  onUpdateConfig,
  onSyncNow,
  onDisconnectSheet,
  onClearSyncedRows,
}: GoogleSheetsSyncModalProps) {
  const [sheetInput, setSheetInput] = useState(config.spreadsheetId || '');
  const [localInputError, setLocalInputError] = useState('');
  const [confirmClearRows, setConfirmClearRows] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSheetInput(config.spreadsheetId || '');
      setLocalInputError('');
      setConfirmClearRows(false);
    }
  }, [isOpen, config.spreadsheetId]);

  const totalSyncedRows = rowCounts['1PM'] + rowCounts['6PM'] + rowCounts['8PM'];
  const isAlwaysOn = connectionMode === 'always-on';
  const isOAuthActive = connectionMode === 'oauth' || hasAccessToken;

  const handleConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = extractSpreadsheetId(sheetInput);
    if (!id) {
      setLocalInputError('Valid Google Sheet link ya Spreadsheet ID paste karein.');
      return;
    }
    setLocalInputError('');
    AppSounds.tap();
    await onConnectSpreadsheet(id);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="gsheets-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/55 backdrop-blur-[2px] p-0 pt-[env(safe-area-inset-top)] sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gsheets-sync-title"
        >
          <motion.div
            key="gsheets-modal-card"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl bg-white rounded-t-3xl sm:rounded-3xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]"
          >
            {/* Header */}
            <div className="kk-brand-gradient text-white px-5 py-4 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-300/35 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-200" />
                </span>
                <div className="min-w-0">
                  <h2 id="gsheets-sync-title" className="text-base font-black tracking-tight truncate">
                    Google Sheets Live Sync
                  </h2>
                  <p className="text-[11px] text-indigo-100 font-medium truncate">
                    Google Sheet me jo bhi entry hogi wo seedha 1PM, 6PM, 8PM me aayegi
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  onClose();
                }}
                aria-label="Close Google Sheets Sync"
                className="p-2 rounded-xl hover:bg-white/15 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)+1.25rem))] overflow-y-auto space-y-4 flex-1 bg-slate-50/70">
              {(errorMessage || localInputError) && (
                <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-900 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{localInputError || errorMessage}</span>
                </div>
              )}

              {/* Step 1: 24/7 Always-On Connection & Google Sign-In */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-extrabold text-slate-900">
                      1. 24/7 Live Connection Status
                    </div>
                    <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                      {isAlwaysOn
                        ? '24/7 Always-On Direct Sync chalu hai — app band karke kholne par bhi kabhi disconnect nahi hoga'
                        : isOAuthActive
                          ? `Connected${connectedEmail ? `: ${connectedEmail}` : ''} (Google Account Live Sync)`
                          : 'Hamesha connected rakhne ke liye Sheet ko "Anyone with the link (Viewer)" karein ya Google se sign in karein'}
                    </p>
                  </div>
                  {(isAlwaysOn || isOAuthActive) && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-extrabold text-emerald-700 shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{isAlwaysOn ? '24/7 Active' : 'Active'}</span>
                    </span>
                  )}
                </div>

                {/* Permanent 24/7 Never-Disconnect Tip */}
                <div className="px-3 py-2.5 rounded-xl bg-emerald-50/80 border border-emerald-200/90 text-[11px] text-emerald-950 leading-relaxed">
                  <strong className="font-extrabold">Kabhi Disconnect Na Ho (24/7 Permanent):</strong>{' '}
                  Google Sheets app me apni sheet kholein → <strong>Share</strong> →{' '}
                  <strong>General access</strong> → <strong>Anyone with the link (Viewer)</strong> on
                  kar dein. Ek baar on karne ke baad app restart ya agle din bhi apne aap live connected
                  rahega!
                </div>

                {!hasAccessToken ? (
                  <button
                    type="button"
                    disabled={connecting}
                    onClick={() => {
                      AppSounds.tap();
                      void onSignInGoogleSheets();
                    }}
                    className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl bg-white hover:bg-slate-50 active:bg-slate-100 border border-slate-300 shadow-xs text-sm font-bold text-slate-800 cursor-pointer transition-colors disabled:opacity-60"
                  >
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      className="w-5 h-5 shrink-0 block"
                      aria-hidden="true"
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                      <path fill="none" d="M0 0h48v48H0z" />
                    </svg>
                    <span>
                      {connecting
                        ? 'Connecting...'
                        : isAlwaysOn
                          ? 'Sign in with Google (Optional for Private Sheets)'
                          : 'Sign in with Google'}
                    </span>
                  </button>
                ) : (
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      disabled={connecting}
                      onClick={() => {
                        AppSounds.tap();
                        void onSignInGoogleSheets();
                      }}
                      className="text-xs font-bold text-[var(--kk-brand)] hover:underline cursor-pointer"
                    >
                      Switch / Reconnect Google Account
                    </button>
                  </div>
                )}
              </div>

              {/* Step 2: Spreadsheet URL / ID */}
              <form
                onSubmit={handleConnectSubmit}
                className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3"
              >
                <div>
                  <div className="text-xs font-extrabold text-slate-900">
                    2. Apni Google Sheet ka Link Paste Karein
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                    Google Sheets app me Share → Copy link karke yahan paste karein
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Link2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={sheetInput}
                      onChange={(e) => {
                        setSheetInput(e.target.value);
                        setLocalInputError('');
                      }}
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                      className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm font-mono-tabular bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={syncing || connecting}
                    className="px-4 py-2 text-xs font-extrabold text-white bg-[var(--kk-brand)] hover:bg-[var(--kk-brand-hover)] rounded-xl cursor-pointer transition-colors disabled:opacity-50 shrink-0"
                  >
                    {syncing ? 'Loading...' : config.spreadsheetId ? 'Load / Update Sheet' : 'Connect Sheet'}
                  </button>
                </div>

                {(config.spreadsheetTitle || config.spreadsheetId) && (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-50/80 border border-emerald-200 text-xs">
                    <div className="min-w-0">
                      <div className="font-extrabold text-emerald-950 truncate">
                        {config.spreadsheetTitle || 'Connected Google Sheet'}
                      </div>
                      <div className="text-[11px] font-mono-tabular text-emerald-800 truncate">
                        ID: {config.spreadsheetId}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        AppSounds.tap();
                        onDisconnectSheet();
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-rose-700 bg-white hover:bg-rose-50 border border-rose-200 rounded-lg cursor-pointer shrink-0"
                    >
                      <Unlink className="w-3 h-3" />
                      <span>Unlink</span>
                    </button>
                  </div>
                )}
              </form>

              {/* Step 3: Tab Mapping & Live Auto-Sync Controls */}
              {config.spreadsheetId && (
                <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-extrabold text-slate-900">
                        3. Sheet Tabs &amp; Live Auto-Sync
                      </div>
                      <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                        Last sync: <strong className="text-slate-700">{formatSyncTime(lastSyncedAt)}</strong>
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={syncing}
                      onClick={() => {
                        AppSounds.tap();
                        void onSyncNow();
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-extrabold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl cursor-pointer transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                      <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
                    </button>
                  </div>

                  {/* Session Tab Dropdowns */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(['1PM', '6PM', '8PM'] as SessionId[]).map((sid) => {
                      const currentTab = config.tabMapping[sid] || '';
                      return (
                        <label
                          key={sid}
                          className="block p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1"
                        >
                          <div className="flex items-center justify-between text-[11px] font-extrabold text-slate-700">
                            <span>{sid} Tab</span>
                            <span className="font-mono-tabular text-emerald-700">
                              {rowCounts[sid]} rows
                            </span>
                          </div>
                          {availableTabs.length > 0 ? (
                            <select
                              value={currentTab}
                              onChange={(e) =>
                                onUpdateConfig({
                                  tabMapping: {
                                    ...config.tabMapping,
                                    [sid]: e.target.value,
                                  },
                                })
                              }
                              className="w-full px-2 py-1.5 text-xs font-bold bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                            >
                              <option value="">-- Skip --</option>
                              {availableTabs.map((t) => (
                                <option key={t.sheetId} value={t.title}>
                                  {t.title}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={currentTab}
                              placeholder={sid}
                              onChange={(e) =>
                                onUpdateConfig({
                                  tabMapping: {
                                    ...config.tabMapping,
                                    [sid]: e.target.value,
                                  },
                                })
                              }
                              className="w-full px-2 py-1.5 text-xs font-bold bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
                            />
                          )}
                        </label>
                      );
                    })}
                  </div>

                  {/* Auto-Sync Toggle & Interval */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                    <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.autoSync}
                        onChange={(e) => {
                          AppSounds.tap();
                          onUpdateConfig({ autoSync: e.target.checked });
                        }}
                        className="w-4 h-4 accent-emerald-600 cursor-pointer"
                      />
                      <span>Live Auto-Sync On</span>
                    </label>

                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-semibold text-slate-500">Every:</span>
                      {[10, 15, 30].map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => {
                            AppSounds.tap();
                            onUpdateConfig({ pollSeconds: sec });
                          }}
                          className={`px-2.5 py-1 text-[11px] font-bold font-mono-tabular rounded-lg border cursor-pointer transition-colors ${
                            config.pollSeconds === sec
                              ? 'bg-[var(--kk-brand)] text-white border-[var(--kk-brand)]'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Google Sheet se aane wala data app ke manual entries aur Seller mobile entries ko delete nahi karega — dono saath me live merge honge.
                  </p>

                  {totalSyncedRows > 0 && (
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                      {!confirmClearRows ? (
                        <button
                          type="button"
                          onClick={() => {
                            AppSounds.warning();
                            setConfirmClearRows(true);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 hover:text-rose-800 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove Google Sheet Rows ({totalSyncedRows})</span>
                        </button>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-1.5 w-full justify-between">
                          <span className="text-[11px] font-bold text-rose-900">
                            App se sirf Google Sheet synced rows hatayein?
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                AppSounds.remove();
                                onClearSyncedRows();
                                setConfirmClearRows(false);
                              }}
                              className="px-2.5 py-1 text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer"
                            >
                              Yes, Remove
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmClearRows(false)}
                              className="px-2 py-1 text-[11px] font-bold text-slate-700 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
