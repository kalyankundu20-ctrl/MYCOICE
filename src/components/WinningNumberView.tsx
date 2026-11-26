import {
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Eraser,
  Hash,
  Layers,
  Plus,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState } from 'react';
import { formatINR, SESSIONS } from '../engine/calculations';
import { ParsedWinningNumber, SessionId, WinningRawBySession } from '../types/ledger';
import { AppSounds } from '../utils/sound';

interface WinningNumberViewProps {
  winningRaw: WinningRawBySession;
  parsedWinning: Record<SessionId, ParsedWinningNumber[]>;
  prizeCount: number;
  prizeTotal: number;
  onChangeWinningRaw: (sessionId: SessionId, value: string) => void;
  onClearAllWinning: () => void;
  onOpenPrizeList: () => void;
}

const RANK_ORDER = ['1st', '2nd', '3rd', '4th', '5th'] as const;
type RankKey = (typeof RANK_ORDER)[number];

const SESSION_META: Record<SessionId, { drawName: string; badgeClass: string }> = {
  '1PM': { drawName: 'Morning Draw', badgeClass: 'bg-amber-400/20 text-amber-200 border-amber-300/30' },
  '6PM': { drawName: 'Day Draw', badgeClass: 'bg-sky-400/20 text-sky-200 border-sky-300/30' },
  '8PM': { drawName: 'Evening Draw', badgeClass: 'bg-indigo-400/20 text-indigo-200 border-indigo-300/30' },
};

const RANK_STYLE: Record<
  RankKey,
  {
    label: string;
    digitsHint: string;
    isFiveDigit: boolean;
    badge: string;
    cardBorder: string;
    chipClass: string;
  }
> = {
  '1st': {
    label: '1st Prize',
    digitsHint: '5 Digits',
    isFiveDigit: true,
    badge: 'bg-amber-100 text-amber-900 border-amber-300',
    cardBorder: 'border-l-amber-400',
    chipClass: 'bg-amber-50/70 border-amber-200/90 text-amber-950',
  },
  '2nd': {
    label: '2nd Prize',
    digitsHint: '5 Digits',
    isFiveDigit: true,
    badge: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    cardBorder: 'border-l-emerald-400',
    chipClass: 'bg-emerald-50/60 border-emerald-200/90 text-emerald-950',
  },
  '3rd': {
    label: '3rd Prize',
    digitsHint: 'Last 4 Digits',
    isFiveDigit: false,
    badge: 'bg-sky-100 text-sky-900 border-sky-300',
    cardBorder: 'border-l-sky-400',
    chipClass: 'bg-sky-50/60 border-sky-200/90 text-sky-950',
  },
  '4th': {
    label: '4th Prize',
    digitsHint: 'Last 4 Digits',
    isFiveDigit: false,
    badge: 'bg-indigo-100 text-indigo-900 border-indigo-300',
    cardBorder: 'border-l-indigo-400',
    chipClass: 'bg-indigo-50/60 border-indigo-200/90 text-indigo-950',
  },
  '5th': {
    label: '5th Prize',
    digitsHint: 'Last 4 Digits',
    isFiveDigit: false,
    badge: 'bg-slate-100 text-slate-800 border-slate-300',
    cardBorder: 'border-l-slate-400',
    chipClass: 'bg-slate-50 border-slate-200/90 text-slate-900',
  },
};

function groupParsedByRank(list: ParsedWinningNumber[]): Record<RankKey, string[]> {
  const buckets: Record<RankKey, string[]> = {
    '1st': [],
    '2nd': [],
    '3rd': [],
    '4th': [],
    '5th': [],
  };
  for (const item of list) {
    const r = item.rank as RankKey;
    if (buckets[r]) {
      buckets[r].push(item.rawNumber);
    }
  }
  return buckets;
}

function serializeBuckets(buckets: Record<RankKey, string[]>): string {
  const blocks: string[] = [];
  for (const rank of RANK_ORDER) {
    if (buckets[rank].length > 0) {
      blocks.push(`${rank}\n${buckets[rank].join(' ')}`);
    }
  }
  return blocks.join('\n');
}

function extractTokensForRank(text: string, isFiveDigit: boolean): string[] {
  const tokens = text.split(/[\s,;|/]+/);
  const extracted: string[] = [];
  for (const token of tokens) {
    const digits = token.replace(/\D/g, '');
    if (digits.length < 4) continue;
    if (isFiveDigit) {
      extracted.push(digits.slice(-5).padStart(5, '0'));
    } else {
      extracted.push(('0000' + digits).slice(-4));
    }
  }
  return extracted;
}

interface SessionCardProps {
  sessionId: SessionId;
  rawValue: string;
  parsedList: ParsedWinningNumber[];
  onChangeRaw: (value: string) => void;
}

function SessionResultCard({
  sessionId,
  rawValue,
  parsedList,
  onChangeRaw,
}: SessionCardProps) {
  const [rankInputs, setRankInputs] = useState<Record<RankKey, string>>({
    '1st': '',
    '2nd': '',
    '3rd': '',
    '4th': '',
    '5th': '',
  });
  const [justPasted, setJustPasted] = useState(false);
  const [showManualPasteBox, setShowManualPasteBox] = useState(false);
  const [manualPasteText, setManualPasteText] = useState('');
  const [confirmClearSession, setConfirmClearSession] = useState(false);
  const pasteTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const meta = SESSION_META[sessionId];
  const buckets = groupParsedByRank(parsedList);

  const triggerPastedFeedback = () => {
    setJustPasted(true);
    setShowManualPasteBox(false);
    setManualPasteText('');
    window.setTimeout(() => setJustPasted(false), 1600);
  };

  const handleClipboardPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        onChangeRaw(text.trim());
        AppSounds.success();
        triggerPastedFeedback();
        return;
      }
    } catch {
      // Clipboard permission blocked by browser — show compact inline paste box
    }
    AppSounds.tap();
    setShowManualPasteBox(true);
    window.setTimeout(() => {
      pasteTextareaRef.current?.focus();
    }, 60);
  };

  const handleAddNumbersToRank = (rank: RankKey, rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;

    // If user pasted a full multi-rank official result inside a rank input, parse full result!
    if (/[1-5](?:st|nd|rd|th)\b/i.test(trimmed)) {
      onChangeRaw(trimmed);
      setRankInputs((prev) => ({ ...prev, [rank]: '' }));
      AppSounds.success();
      triggerPastedFeedback();
      return;
    }

    const added = extractTokensForRank(trimmed, RANK_STYLE[rank].isFiveDigit);
    if (added.length === 0) return;

    const nextBuckets: Record<RankKey, string[]> = {
      ...buckets,
      [rank]: [...buckets[rank], ...added],
    };
    onChangeRaw(serializeBuckets(nextBuckets));
    setRankInputs((prev) => ({ ...prev, [rank]: '' }));
    AppSounds.add();
  };

  const handleRemoveNumberAt = (rank: RankKey, indexToRemove: number) => {
    const nextBuckets: Record<RankKey, string[]> = {
      ...buckets,
      [rank]: buckets[rank].filter((_, idx) => idx !== indexToRemove),
    };
    onChangeRaw(serializeBuckets(nextBuckets));
    AppSounds.tap();
  };

  return (
    <div className="kk-surface-card rounded-2xl overflow-hidden flex flex-col">
      {/* Executive Draw Header */}
      <div className="kk-table-head text-white px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`px-2 py-0.5 rounded-lg border text-xs font-extrabold tracking-wide ${meta.badgeClass}`}>
            {sessionId}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold tracking-tight truncate">{meta.drawName}</div>
          </div>
        </div>
        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/12 border border-white/15 text-[11px] font-bold font-mono-tabular text-indigo-50 shrink-0">
          <Hash className="w-3 h-3 text-emerald-300" />
          <span>{parsedList.length} nos</span>
        </div>
      </div>

      {/* Action Strip (Rank Cards + 1-Tap Paste Result) */}
      <div className="px-3 py-2 bg-slate-50/90 border-b border-slate-200/80 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--kk-brand)]">
          <Layers className="w-3.5 h-3.5 shrink-0" />
          <span>Rank Cards</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleClipboardPaste()}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-xl border transition-colors cursor-pointer whitespace-nowrap ${
              justPasted
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white hover:bg-[var(--kk-tint)] text-[var(--kk-brand)] border-slate-200 hover:border-[var(--kk-tint-border)] shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
            }`}
          >
            {justPasted ? (
              <>
                <Check className="w-3 h-3" />
                <span>Pasted!</span>
              </>
            ) : (
              <>
                <ClipboardPaste className="w-3 h-3" />
                <span>Paste Result</span>
              </>
            )}
          </button>

          {rawValue.trim() &&
            (!confirmClearSession ? (
              <button
                type="button"
                onClick={() => {
                  AppSounds.warning();
                  setConfirmClearSession(true);
                }}
                title={`Clear ${sessionId} numbers`}
                className="p-1.5 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="inline-flex items-center gap-1 bg-rose-50 border border-rose-200 rounded-xl px-2 py-1">
                <span className="text-[10px] font-bold text-rose-900">Delete?</span>
                <button
                  type="button"
                  onClick={() => {
                    AppSounds.remove();
                    onChangeRaw('');
                    setConfirmClearSession(false);
                  }}
                  className="px-1.5 py-0.5 text-[10px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md cursor-pointer"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => {
                    AppSounds.tap();
                    setConfirmClearSession(false);
                  }}
                  className="px-1.5 py-0.5 text-[10px] font-bold text-slate-700 hover:bg-white rounded-md cursor-pointer"
                >
                  No
                </button>
              </div>
            ))}
        </div>
      </div>

      {/* Main Content Area: Structured 1st – 5th Rank Cards */}
      <div className="p-3 space-y-2.5 flex-1 bg-slate-50/40">
        {showManualPasteBox && (
          <div className="bg-white border border-[var(--kk-tint-border)] rounded-xl p-2.5 space-y-2 shadow-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-700">
                Paste {sessionId} result here (Long-press → Paste)
              </span>
              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  setShowManualPasteBox(false);
                  setManualPasteText('');
                }}
                aria-label="Close paste box"
                className="p-1 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <textarea
              ref={pasteTextareaRef}
              value={manualPasteText}
              onChange={(e) => setManualPasteText(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text').trim();
                if (pasted) {
                  e.preventDefault();
                  onChangeRaw(pasted);
                  AppSounds.success();
                  triggerPastedFeedback();
                }
              }}
              placeholder="Paste official draw result text..."
              rows={4}
              className="w-full p-2.5 text-sm sm:text-xs font-semibold font-mono-tabular text-slate-950 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]/35 focus:border-[var(--kk-brand)] resize-none"
            />
            <div className="flex justify-end">
              <button
                type="button"
                disabled={!manualPasteText.trim()}
                onClick={() => {
                  if (!manualPasteText.trim()) return;
                  onChangeRaw(manualPasteText.trim());
                  AppSounds.success();
                  triggerPastedFeedback();
                }}
                className="px-3 py-1.5 text-xs font-bold text-white kk-brand-gradient rounded-lg disabled:opacity-40 cursor-pointer"
              >
                Apply Result
              </button>
            </div>
          </div>
        )}

          {/* Structured 1st – 5th App Rank Cards */}
          {RANK_ORDER.map((rank) => {
            const style = RANK_STYLE[rank];
            const nums = buckets[rank];
            const inputVal = rankInputs[rank];

            return (
              <div
                key={rank}
                className="bg-white border border-slate-200/90 rounded-xl p-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-md border text-[11px] font-bold leading-none ${style.badge}`}
                    >
                      {style.label}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-400">
                      {style.digitsHint}
                    </span>
                  </div>
                  <span className="text-[11px] font-bold font-mono-tabular text-slate-500">
                    {nums.length > 0 ? `${nums.length} nos` : '—'}
                  </span>
                </div>

                {/* Parsed Number Tiles */}
                {nums.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {nums.map((num, idx) => (
                      <span
                        key={`${rank}-${idx}-${num}`}
                        className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-lg border text-xs font-bold font-mono-tabular ${style.chipClass}`}
                      >
                        <span>{num}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveNumberAt(rank, idx)}
                          aria-label={`Remove ${num} from ${rank}`}
                          className="p-0.5 rounded hover:bg-black/10 text-slate-500 hover:text-rose-700 transition-colors cursor-pointer"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Inline Quick Add / Multi-Number Paste Input */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAddNumbersToRank(rank, inputVal);
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    inputMode="numeric"
                    value={inputVal}
                    onChange={(e) =>
                      setRankInputs((prev) => ({ ...prev, [rank]: e.target.value }))
                    }
                    onPaste={(e) => {
                      const pasted = e.clipboardData.getData('text');
                      if (pasted && (pasted.includes('\n') || pasted.trim().split(/[\s,;|]+/).length > 1 || /[1-5](?:st|nd|rd|th)\b/i.test(pasted))) {
                        e.preventDefault();
                        handleAddNumbersToRank(rank, pasted);
                      }
                    }}
                    placeholder={
                      style.isFiveDigit
                        ? `+ Add 5-digit ${rank} no.`
                        : `+ Add/paste 4-digit ${rank} nos.`
                    }
                    className="flex-1 min-w-0 px-2.5 py-1 text-base sm:text-xs font-semibold font-mono-tabular text-slate-900 placeholder:font-sans placeholder:font-medium placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-1 focus:ring-[var(--kk-brand)]"
                  />
                  <button
                    type="submit"
                    disabled={!inputVal.trim()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-white bg-[var(--kk-brand)] hover:bg-[var(--kk-brand-hover)] disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer shrink-0"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add</span>
                  </button>
                </form>
              </div>
            );
          })}
        </div>

      {/* Clean Rank Breakdown Footer */}
      <div className="px-3.5 py-2.5 bg-white border-t border-slate-200/80 text-[11px] font-semibold text-slate-600 flex flex-wrap items-center justify-between gap-2">
        {parsedList.length === 0 ? (
          <span className="text-slate-400">No winning numbers entered for {sessionId}</span>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono-tabular">
            {RANK_ORDER.map((r) =>
              buckets[r].length > 0 ? (
                <span key={r} className="inline-flex items-center gap-1">
                  <strong className="text-slate-900 font-sans">{r}:</strong>
                  <span>{buckets[r].length}</span>
                </span>
              ) : null
            )}
          </div>
        )}
        {parsedList.length > 0 && (
          <span className="inline-flex items-center gap-1 text-emerald-700 font-bold text-[10px]">
            <CheckCircle2 className="w-3 h-3" />
            <span>Auto-Matched</span>
          </span>
        )}
      </div>
    </div>
  );
}

export function WinningNumberView({
  winningRaw,
  parsedWinning,
  prizeCount,
  prizeTotal,
  onChangeWinningRaw,
  onClearAllWinning,
  onOpenPrizeList,
}: WinningNumberViewProps) {
  const [activeMobileSession, setActiveMobileSession] = useState<SessionId>('1PM');
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const totalNumbersEntered = SESSIONS.reduce(
    (sum, s) => sum + (parsedWinning[s]?.length || 0),
    0
  );

  return (
    <div className="space-y-3.5">
      {/* Executive App Header */}
      <div className="kk-surface-card rounded-2xl px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl kk-brand-gradient text-amber-300 flex items-center justify-center shrink-0 shadow-xs">
            <Trophy className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-950 tracking-tight">
              Winning Numbers
            </h2>
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              1st & 2nd match 5 digits · 3rd–5th match last 4 digits · Paste or add by rank
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <AnimatePresence>
            {prizeCount > 0 && (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.92, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                onClick={() => {
                  AppSounds.tap();
                  onOpenPrizeList();
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl shadow-xs transition-colors cursor-pointer whitespace-nowrap"
              >
                <Trophy className="w-3.5 h-3.5 text-amber-300" />
                <span>
                  Prize List ({prizeCount} • ₹{formatINR(prizeTotal)})
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </motion.button>
            )}
          </AnimatePresence>

          {totalNumbersEntered > 0 && (
            !confirmClearAll ? (
              <button
                type="button"
                onClick={() => {
                  AppSounds.warning();
                  setConfirmClearAll(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors cursor-pointer"
              >
                <Eraser className="w-3.5 h-3.5" />
                <span>Clear All</span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-rose-50 border border-rose-300 rounded-xl">
                <span className="text-[11px] font-bold text-rose-900">Clear 1PM/6PM/8PM?</span>
                <button
                  type="button"
                  onClick={() => {
                    AppSounds.tap();
                    onClearAllWinning();
                    setConfirmClearAll(false);
                  }}
                  className="px-2 py-0.5 text-[11px] font-bold text-white bg-rose-700 hover:bg-rose-800 rounded-lg cursor-pointer"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(false)}
                  className="px-1.5 py-0.5 text-[11px] font-bold text-slate-700 cursor-pointer"
                >
                  No
                </button>
              </div>
            )
          )}
        </div>
      </div>

      {/* Mobile Native Segmented Draw Tabs (< lg) */}
      <div className="lg:hidden bg-white border border-slate-200/90 rounded-2xl p-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] grid grid-cols-3 gap-1">
        {SESSIONS.map((sessionId) => {
          const isActive = activeMobileSession === sessionId;
          const count = parsedWinning[sessionId]?.length || 0;
          return (
            <button
              key={sessionId}
              type="button"
              onClick={() => {
                AppSounds.tap();
                setActiveMobileSession(sessionId);
              }}
              className={`px-2 py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                isActive
                  ? 'kk-brand-gradient text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="text-xs font-bold">{sessionId}</span>
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold font-mono-tabular leading-none ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : count > 0
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Mobile Focused Single Session View (< lg) */}
      <div className="lg:hidden">
        <SessionResultCard
          key={activeMobileSession}
          sessionId={activeMobileSession}
          rawValue={winningRaw[activeMobileSession]}
          parsedList={parsedWinning[activeMobileSession] || []}
          onChangeRaw={(val) => onChangeWinningRaw(activeMobileSession, val)}
        />
      </div>

      {/* Desktop 3-Column Draw Studio (>= lg) */}
      <div className="hidden lg:grid lg:grid-cols-3 gap-3.5 items-start">
        {SESSIONS.map((sessionId) => (
          <SessionResultCard
            key={sessionId}
            sessionId={sessionId}
            rawValue={winningRaw[sessionId]}
            parsedList={parsedWinning[sessionId] || []}
            onChangeRaw={(val) => onChangeWinningRaw(sessionId, val)}
          />
        ))}
      </div>
    </div>
  );
}
