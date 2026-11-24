import { Check, Delete } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatINR } from '../engine/calculations';
import {
  evaluateMathExpression,
  isFormulaExpression,
  numberToDraftString,
  sanitizeFormulaInput,
} from '../utils/mathInput';
import { AppSounds } from '../utils/sound';

export interface ActiveFormulaSession {
  id: string;
  label: string;
  draft: string;
  preview: number | null;
  insertToken: (token: string) => void;
  evaluateNow: (shouldBlur?: boolean) => void;
  backspace: () => void;
  clear: () => void;
  close: () => void;
}

interface FormulaNumberInputProps {
  id: string;
  label: string;
  value: number;
  onCommit: (nextValue: number) => void;
  placeholder?: string;
  className?: string;
  compactBillWrapper?: boolean;
  onActiveSessionChange?: (session: ActiveFormulaSession | null, ownerId: string) => void;
}

export function FormulaNumberInput({
  id,
  label,
  value,
  onCommit,
  placeholder = '0',
  className = '',
  compactBillWrapper = false,
  onActiveSessionChange,
}: FormulaNumberInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(() => numberToDraftString(value));

  const draftRef = useRef(draft);
  draftRef.current = draft;

  const valueRef = useRef(value);
  valueRef.current = value;

  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const onActiveChangeRef = useRef(onActiveSessionChange);
  onActiveChangeRef.current = onActiveSessionChange;

  const handleRawChangeRef = useRef<(incoming: string) => void>(() => {});

  // Keep draft synchronized with external value when not actively editing
  useEffect(() => {
    if (!isFocused) {
      setDraft(numberToDraftString(value));
    }
  }, [value, isFocused]);

  const computePreview = useCallback((text: string): number | null => {
    if (!text.trim()) return 0;
    return evaluateMathExpression(text);
  }, []);

  const commitDraft = useCallback((rawText: string, playFeedback: boolean): string => {
    const trimmed = rawText.trim();
    if (!trimmed) {
      onCommitRef.current(0);
      return '';
    }
    const evaluated = evaluateMathExpression(trimmed);
    if (evaluated !== null) {
      onCommitRef.current(evaluated);
      if (playFeedback) AppSounds.tap();
      return evaluated === 0 ? '' : String(evaluated);
    }
    // If incomplete expression on blur, revert to last valid stored value
    return numberToDraftString(valueRef.current);
  }, []);

  const publishSession = useCallback(
    (nextDraft: string) => {
      if (!onActiveChangeRef.current) return;
      const preview = computePreview(nextDraft);

      const session: ActiveFormulaSession = {
        id,
        label,
        draft: nextDraft,
        preview,
        insertToken: (token: string) => {
          const el = inputRef.current;
          const current = draftRef.current;
          let updated: string;

          if (el && typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
            const start = el.selectionStart;
            const end = el.selectionEnd;
            updated = current.slice(0, start) + token + current.slice(end);
            const nextCaret = start + token.length;
            requestAnimationFrame(() => {
              try {
                el.setSelectionRange(nextCaret, nextCaret);
              } catch {
                // ignore
              }
            });
          } else {
            updated = current + token;
          }

          handleRawChangeRef.current(updated);
        },
        evaluateNow: (shouldBlur = false) => {
          const current = draftRef.current;
          const evaluated = evaluateMathExpression(current);
          if (evaluated !== null) {
            onCommitRef.current(evaluated);
            AppSounds.tap();
            const resultText = evaluated === 0 ? '' : String(evaluated);
            setDraft(resultText);
            draftRef.current = resultText;
            if (shouldBlur) {
              inputRef.current?.blur();
            } else {
              publishSession(resultText);
              requestAnimationFrame(() => {
                const el = inputRef.current;
                if (el) {
                  try {
                    el.setSelectionRange(resultText.length, resultText.length);
                  } catch {
                    // ignore
                  }
                }
              });
            }
          } else if (shouldBlur) {
            inputRef.current?.blur();
          }
        },
        backspace: () => {
          const el = inputRef.current;
          const current = draftRef.current;
          if (!current) return;
          let updated: string;
          if (el && typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
            const start = el.selectionStart;
            const end = el.selectionEnd;
            if (start !== end) {
              updated = current.slice(0, start) + current.slice(end);
            } else if (start > 0) {
              updated = current.slice(0, start - 1) + current.slice(end);
              const nextCaret = start - 1;
              requestAnimationFrame(() => {
                try {
                  el.setSelectionRange(nextCaret, nextCaret);
                } catch {
                  // ignore
                }
              });
            } else {
              updated = current;
            }
          } else {
            updated = current.slice(0, -1);
          }
          handleRawChangeRef.current(updated);
        },
        clear: () => {
          handleRawChangeRef.current('');
        },
        close: () => {
          inputRef.current?.blur();
        },
      };

      onActiveChangeRef.current(session, id);
    },
    [id, label, computePreview]
  );

  const handleRawChange = useCallback(
    (incoming: string) => {
      const sanitized = sanitizeFormulaInput(incoming);

      // Instant spreadsheet calculation: the moment the user types '=' at the end (e.g. "12000+300=")
      // immediately compute and replace cell with the answer (12300)!
      const trimmedRight = sanitized.trimEnd();
      if (trimmedRight.length > 1 && trimmedRight.endsWith('=')) {
        const exprWithoutTrailingEq = trimmedRight.slice(0, -1).trim();
        const evaluated = evaluateMathExpression(exprWithoutTrailingEq);
        if (evaluated !== null) {
          onCommitRef.current(evaluated);
          AppSounds.tap();
          const resultStr = evaluated === 0 ? '' : String(evaluated);
          setDraft(resultStr);
          draftRef.current = resultStr;
          publishSession(resultStr);
          requestAnimationFrame(() => {
            const el = inputRef.current;
            if (el) {
              try {
                el.setSelectionRange(resultStr.length, resultStr.length);
              } catch {
                // ignore
              }
            }
          });
          return;
        }
      }

      setDraft(sanitized);
      draftRef.current = sanitized;
      publishSession(sanitized);

      // If plain number or empty (no math operators), live-commit immediately so TOTAL updates in real time
      if (!sanitized.trim()) {
        onCommitRef.current(0);
      } else if (!isFormulaExpression(sanitized)) {
        const plain = evaluateMathExpression(sanitized);
        if (plain !== null) {
          onCommitRef.current(plain);
        }
      }
    },
    [publishSession]
  );

  handleRawChangeRef.current = handleRawChange;

  const handleFocus = () => {
    setIsFocused(true);
    const initial = numberToDraftString(value);
    setDraft(initial);
    draftRef.current = initial;
    publishSession(initial);
  };

  const handleBlur = () => {
    setIsFocused(false);
    const committed = commitDraft(draftRef.current, false);
    setDraft(committed);
    draftRef.current = committed;
    onActiveChangeRef.current?.(null, id);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const evaluated = evaluateMathExpression(draftRef.current);
      if (evaluated !== null) {
        onCommitRef.current(evaluated);
        AppSounds.tap();
        const resultStr = evaluated === 0 ? '' : String(evaluated);
        setDraft(resultStr);
        draftRef.current = resultStr;
        publishSession(resultStr);
      }
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      const reverted = numberToDraftString(valueRef.current);
      setDraft(reverted);
      draftRef.current = reverted;
      inputRef.current?.blur();
    }
  };

  const displayValue = isFocused ? draft : numberToDraftString(value);
  const sizerText = displayValue.length > 0 ? `${displayValue}   ` : '000000';

  const inputEl = (
    <input
      ref={inputRef}
      type="text"
      inputMode="text"
      enterKeyHint="done"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      aria-label={label}
      value={displayValue}
      placeholder={placeholder}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={(e) => handleRawChange(e.target.value)}
      onKeyDown={handleKeyDown}
      className={className}
    />
  );

  if (compactBillWrapper) {
    return (
      <div className="inline-grid items-center w-full min-w-[84px] sm:min-w-[96px]">
        <span
          aria-hidden="true"
          className="col-start-1 row-start-1 invisible px-2.5 text-right text-[14px] font-bold font-mono-tabular whitespace-pre select-none pointer-events-none"
        >
          {sizerText}
        </span>
        <div className="col-start-1 row-start-1 ios-compact-wrap-bill">{inputEl}</div>
      </div>
    );
  }

  return inputEl;
}

interface SheetFormulaBarProps {
  session: ActiveFormulaSession | null;
}

const FORMULA_KEYS: Array<{ label: string; token: string; isEval?: boolean }> = [
  { label: '=', token: '=', isEval: true },
  { label: '+', token: '+' },
  { label: '−', token: '-' },
  { label: '×', token: '*' },
  { label: '÷', token: '/' },
  { label: '(', token: '(' },
  { label: ')', token: ')' },
];

export function SheetFormulaBar({ session }: SheetFormulaBarProps) {
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    if (!session || typeof window === 'undefined' || !window.visualViewport) {
      setKeyboardOffset(0);
      return;
    }

    const vv = window.visualViewport;
    const updateOffset = () => {
      const gap = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
      setKeyboardOffset(gap > 40 ? gap : 0);
    };

    updateOffset();
    vv.addEventListener('resize', updateOffset);
    vv.addEventListener('scroll', updateOffset);
    return () => {
      vv.removeEventListener('resize', updateOffset);
      vv.removeEventListener('scroll', updateOffset);
    };
  }, [session]);

  if (!session) return null;

  const hasFormula = isFormulaExpression(session.draft);
  const keepFocus = (e: React.PointerEvent | React.MouseEvent) => {
    e.preventDefault();
  };

  return (
    <div
      style={keyboardOffset > 0 ? { bottom: `${keyboardOffset}px` } : undefined}
      className={`fixed inset-x-0 z-40 px-2 pb-1.5 sm:px-4 pointer-events-none ${
        keyboardOffset > 0
          ? ''
          : 'bottom-[calc(4.85rem+env(safe-area-inset-bottom))] lg:bottom-3'
      }`}
    >
      <div className="mx-auto max-w-xl pointer-events-auto bg-white border border-slate-300 rounded-2xl shadow-[0_8px_28px_rgba(15,23,42,0.22)] overflow-hidden">
        {/* Top Formula Preview Bar */}
        <div className="flex items-center gap-2 px-2.5 py-2 border-b border-slate-200 bg-slate-50/90">
          <span className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[var(--kk-brand)] text-white font-serif italic font-bold text-sm select-none">
            fx
          </span>

          <div className="min-w-0 flex-1 flex items-center gap-2 overflow-x-auto">
            <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-wide text-[var(--kk-brand)] bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-md">
              {session.label}
            </span>
            <span className="font-mono-tabular text-sm font-bold text-slate-950 whitespace-nowrap">
              {session.draft || '0'}
            </span>
            {hasFormula && session.preview !== null && (
              <span className="font-mono-tabular text-sm font-extrabold text-emerald-700 whitespace-nowrap">
                = {formatINR(session.preview)}
              </span>
            )}
          </div>

          <button
            type="button"
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => session.evaluateNow(true)}
            aria-label="Calculate and apply"
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white cursor-pointer transition-transform"
          >
            <Check className="w-4 h-4 stroke-[2.75]" />
          </button>
        </div>

        {/* Quick Operator Keys Row */}
        <div className="grid grid-cols-8 gap-1 p-1.5 bg-slate-100/90">
          {FORMULA_KEYS.map((item) => (
            <button
              key={item.label}
              type="button"
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={() => {
                if (item.isEval) {
                  session.evaluateNow(false);
                } else {
                  session.insertToken(item.token);
                }
              }}
              className={`h-9 rounded-lg text-base font-extrabold font-mono-tabular flex items-center justify-center cursor-pointer active:scale-95 transition-transform select-none ${
                item.isEval
                  ? 'bg-[var(--kk-brand)] text-white shadow-xs'
                  : 'bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 shadow-[0_1px_0_rgba(15,23,42,0.08)]'
              }`}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => session.backspace()}
            aria-label="Backspace"
            className="h-9 rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-rose-50 hover:text-rose-700 shadow-[0_1px_0_rgba(15,23,42,0.08)] flex items-center justify-center cursor-pointer active:scale-95 transition-transform select-none"
          >
            <Delete className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
