import { Filter, Search, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { AppSounds } from '../utils/sound';

export interface NameFilterOption {
  key: string;
  label: string;
  meta?: string;
}

interface NameFilterPopoverProps {
  options: NameFilterOption[];
  selectedKeys: Set<string> | null;
  onChange: (nextKeys: Set<string> | null) => void;
  title?: string;
  variant?: 'header-dark' | 'toolbar-light';
  align?: 'left' | 'right';
}

export function NameFilterPopover({
  options,
  selectedKeys,
  onChange,
  title = 'Name',
  variant = 'toolbar-light',
  align = 'left',
}: NameFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState<{ top: number; left: number; width: number }>({
    top: 80,
    left: 12,
    width: 300,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);

  const isActive = selectedKeys !== null;

  const openMenu = () => {
    AppSounds.tap();
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const popWidth = Math.min(316, vw - 24);
      const rawLeft = align === 'right' ? rect.right - popWidth : rect.left;
      const clampedLeft = Math.max(12, Math.min(rawLeft, vw - popWidth - 12));
      const estHeight = 365;
      let top = rect.bottom + 6;
      if (top + estHeight > vh - 12 && rect.top > 200) {
        top = Math.max(12, vh - estHeight - 12);
      }
      setCoords({ top, left: clampedLeft, width: popWidth });
    }
    if (selectedKeys !== null) {
      setDraft(new Set(selectedKeys));
    } else {
      setDraft(new Set(options.map((o) => o.key)));
    }
    setQuery('');
    setOpen((prev) => !prev);
  };

  const applySet = (nextSet: Set<string>) => {
    AppSounds.tap();
    if (options.length > 0 && options.every((o) => nextSet.has(o.key))) {
      onChange(null);
    } else {
      onChange(new Set(nextSet));
    }
    setOpen(false);
  };

  const resetFilter = () => {
    AppSounds.tap();
    onChange(null);
    setOpen(false);
  };

  const qLower = query.trim().toLowerCase();
  const visibleOptions = options.filter(
    (opt) => !qLower || opt.label.toLowerCase().includes(qLower)
  );

  const selectedLabel =
    selectedKeys === null
      ? title
      : selectedKeys.size === 0
        ? `${title}: None`
        : selectedKeys.size === 1
          ? Array.from(selectedKeys)[0] === '__BLANK__'
            ? '(Blanks)'
            : Array.from(selectedKeys)[0]
          : `${title} (${selectedKeys.size})`;

  return (
    <div className={variant === 'header-dark' ? 'relative w-full' : 'relative inline-block'}>
      {variant === 'header-dark' ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={openMenu}
          aria-label={`Filter by ${title}`}
          title={`Filter by ${title} (Google Sheets style)`}
          className={`w-full flex items-center justify-between gap-0.5 px-1 py-1 rounded-md cursor-pointer transition-colors ${
            isActive
              ? 'bg-emerald-500/25 text-emerald-200'
              : 'hover:bg-white/10 text-white'
          }`}
        >
          <span className="truncate">{title}</span>
          <Filter
            className={`w-2.5 h-2.5 sm:w-3 sm:h-3 shrink-0 ${
              isActive ? 'text-emerald-300' : 'text-indigo-200'
            }`}
          />
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={openMenu}
          aria-label={`Filter by ${title}`}
          className={`h-8 inline-flex items-center gap-1.5 px-2.5 text-[11px] font-bold rounded-xl border cursor-pointer transition-colors whitespace-nowrap ${
            isActive
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-800'
          }`}
        >
          <Filter
            className={`w-3 h-3 shrink-0 ${
              isActive ? 'text-emerald-700' : 'text-slate-600'
            }`}
          />
          <span className="max-w-[110px] truncate">{selectedLabel}</span>
          {isActive && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />
          )}
        </button>
      )}

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-900/15"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label={`Filter by ${title}`}
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
            }}
            className="fixed z-50 max-h-[calc(100vh-24px)] overflow-y-auto bg-white border border-slate-200 rounded-2xl shadow-2xl p-3 space-y-2.5 text-slate-950 font-sans font-normal normal-case text-left"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-extrabold text-[var(--kk-brand)] flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-emerald-700" />
                <span>Filter by {title}</span>
              </span>
              {isActive && (
                <button
                  type="button"
                  onClick={resetFilter}
                  className="text-[11px] font-bold text-rose-700 hover:underline cursor-pointer"
                >
                  Clear filter
                </button>
              )}
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search seller name..."
                className="w-full h-9 sm:h-8 pl-8 pr-7 text-base sm:text-xs font-medium text-slate-950 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--kk-brand)]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear filter search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-800 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] font-bold px-0.5">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    AppSounds.tap();
                    const next = new Set(draft);
                    for (const opt of visibleOptions) {
                      next.add(opt.key);
                    }
                    setDraft(next);
                  }}
                  className="text-[var(--kk-brand)] hover:underline cursor-pointer"
                >
                  Select all
                </button>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  onClick={() => {
                    AppSounds.tap();
                    if (!qLower) {
                      setDraft(new Set());
                    } else {
                      const next = new Set(draft);
                      for (const opt of visibleOptions) {
                        next.delete(opt.key);
                      }
                      setDraft(next);
                    }
                  }}
                  className="text-slate-600 hover:text-slate-950 hover:underline cursor-pointer"
                >
                  Clear
                </button>
              </div>
              <span className="text-slate-500 font-mono-tabular">
                {draft.size}/{options.length}
              </span>
            </div>

            <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-slate-50/40">
              {visibleOptions.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-500 font-medium">
                  No matching names.
                </div>
              ) : (
                visibleOptions.map((opt) => {
                  const checked = draft.has(opt.key);
                  return (
                    <div
                      key={opt.key}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 hover:bg-slate-100/80 transition-colors"
                    >
                      <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            AppSounds.tap();
                            setDraft((prev) => {
                              const next = new Set(prev);
                              if (next.has(opt.key)) next.delete(opt.key);
                              else next.add(opt.key);
                              return next;
                            });
                          }}
                          className="w-4 h-4 sm:w-3.5 sm:h-3.5 accent-emerald-700 cursor-pointer shrink-0"
                        />
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {opt.label}
                        </span>
                      </label>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {opt.meta && (
                          <span className="text-[10px] font-mono-tabular font-semibold text-slate-500">
                            {opt.meta}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => applySet(new Set([opt.key]))}
                          className="px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md cursor-pointer"
                        >
                          Only
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => applySet(draft)}
                className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl cursor-pointer"
              >
                OK
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
