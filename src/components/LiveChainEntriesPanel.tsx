import { ChevronDown, ChevronUp, Radio, Users } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { computeRowQtyAndRange, formatINR } from '../engine/calculations';
import { CloudPartyDoc, CloudPartySheetDoc } from '../services/cloudSync';
import { AgencyConfig, SessionId, TicketEntryRow } from '../types/ledger';
import { AppSounds } from '../utils/sound';

interface LiveChainEntriesPanelProps {
  sessionId: SessionId;
  chainSheets: CloudPartySheetDoc[];
  chainParties: CloudPartyDoc[];
  config: AgencyConfig;
  /** Optional root partyId (Master Seller's own partyId) to format lineage labels like "RAJU → SOMA" */
  rootMasterPartyId?: string;
  /** Optional mode label */
  mode?: 'admin' | 'master';
  defaultExpanded?: boolean;
}

interface ChainRowDisplay {
  key: string;
  partyId: string;
  partyName: string;
  lineageLabel: string;
  item: string;
  start: string;
  end: string;
  range: string;
  qty: number;
}

export const LiveChainEntriesPanel = memo(function LiveChainEntriesPanel({
  sessionId,
  chainSheets,
  chainParties,
  rootMasterPartyId,
  mode = 'master',
  defaultExpanded = true,
}: LiveChainEntriesPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [selectedPartyId, setSelectedPartyId] = useState<string>('ALL');
  const [visibleLimit, setVisibleLimit] = useState(100);

  useEffect(() => {
    setVisibleLimit(100);
  }, [sessionId, selectedPartyId, expanded]);

  const partyById = useMemo(() => {
    const map = new Map<string, CloudPartyDoc>();
    for (const p of chainParties) {
      map.set(p.partyId, p);
    }
    return map;
  }, [chainParties]);

  const buildLineageLabel = (sheet: CloudPartySheetDoc): string => {
    const selfParty = partyById.get(sheet.partyId);
    const selfName = (selfParty?.name || sheet.partyName || 'SUB').trim();
    const parts: string[] = [selfName];

    let parentId = selfParty?.parentMasterId || sheet.parentMasterId || '';
    const visited = new Set<string>([sheet.partyId]);
    while (parentId && !visited.has(parentId)) {
      if (rootMasterPartyId && parentId === rootMasterPartyId) break;
      visited.add(parentId);
      const parent = partyById.get(parentId);
      if (!parent) break;
      parts.push(parent.name.trim());
      parentId = parent.parentMasterId || '';
    }
    return parts.join(' → ');
  };

  const { allRows, sellerSummaries, totalQty } = useMemo(() => {
    const rows: ChainRowDisplay[] = [];
    const summaryMap = new Map<
      string,
      { partyId: string; partyName: string; lineageLabel: string; count: number; qty: number }
    >();
    let grandQty = 0;

    for (const sh of chainSheets) {
      const rawList: TicketEntryRow[] =
        sessionId === '1PM'
          ? sh.entries1PM || []
          : sessionId === '6PM'
            ? sh.entries6PM || []
            : sh.entries8PM || [];
      if (rawList.length === 0) continue;

      const selfParty = partyById.get(sh.partyId);
      const partyName = (selfParty?.name || sh.partyName || 'SUB').trim();
      const lineageLabel = buildLineageLabel(sh);

      let sellerQty = 0;
      let sellerRows = 0;
      for (let idx = 0; idx < rawList.length; idx++) {
        const r = rawList[idx];
        const itemTrim = String(r.item || '').trim();
        const startTrim = String(r.start || '').trim();
        const endTrim = String(r.end || '').trim();
        if (!itemTrim && !startTrim && !endTrim) continue;

        const metrics = computeRowQtyAndRange(r);
        sellerRows += 1;
        sellerQty += metrics.qty;
        grandQty += metrics.qty;
        rows.push({
          key: `${sh.partyId}::${r.id || idx}`,
          partyId: sh.partyId,
          partyName,
          lineageLabel,
          item: itemTrim || '—',
          start: startTrim || '—',
          end: endTrim || '—',
          range: metrics.range > 0 ? String(metrics.range) : String(r.rangeOverride || '').trim() || '—',
          qty: metrics.qty,
        });
      }

      if (sellerRows > 0) {
        summaryMap.set(sh.partyId, {
          partyId: sh.partyId,
          partyName,
          lineageLabel,
          count: sellerRows,
          qty: sellerQty,
        });
      }
    }

    return {
      allRows: rows,
      sellerSummaries: Array.from(summaryMap.values()),
      totalQty: grandQty,
    };
  }, [chainSheets, partyById, sessionId, rootMasterPartyId]);

  if (allRows.length === 0) {
    if (mode === 'admin') return null;
    return (
      <div className="bg-white border border-indigo-200/80 rounded-2xl px-4 py-3 flex items-center justify-between gap-2 shadow-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
            <Radio className="w-4 h-4 animate-pulse" />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-black text-slate-900">
              Live Chain Feed ({sessionId}) — Connected
            </div>
            <div className="text-[11px] font-medium text-slate-500">
              Aapke kisi bhi Chain / Sub-Seller ki {sessionId} entry hote hi yahan turant live dikh jayegi.
            </div>
          </div>
        </div>
        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-extrabold text-emerald-700">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
          LIVE
        </span>
      </div>
    );
  }

  const visibleRows =
    selectedPartyId === 'ALL'
      ? allRows
      : allRows.filter((r) => r.partyId === selectedPartyId);

  return (
    <div className="bg-white border border-emerald-200/90 rounded-2xl overflow-hidden shadow-xs">
      {/* Header Bar */}
      <button
        type="button"
        onClick={() => {
          AppSounds.tap();
          setExpanded((v) => !v);
        }}
        className="w-full px-3.5 py-2.5 bg-gradient-to-r from-emerald-50 via-teal-50/70 to-indigo-50/60 border-b border-emerald-200/70 flex items-center justify-between gap-2 cursor-pointer text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-black tracking-wide shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            LIVE CHAIN
          </span>
          <span className="text-xs sm:text-sm font-black text-slate-950 truncate">
            {mode === 'admin'
              ? `${sessionId} Sub-Seller Chain Entries`
              : `${sessionId} Chain Sellers Live Entries`}
          </span>
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-bold text-slate-600">
            <Users className="w-3 h-3 text-emerald-700" />
            {sellerSummaries.length} active
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="px-2 py-0.5 rounded-lg bg-white border border-emerald-200 text-[11px] font-black font-mono-tabular text-emerald-800">
            {allRows.length} rows · {formatINR(totalQty)} qty
          </span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-slate-600" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-600" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="p-3 space-y-2.5">
          {/* Chain Seller Filter Strip */}
          {sellerSummaries.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  setSelectedPartyId('ALL');
                }}
                className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-extrabold border cursor-pointer transition-colors ${
                  selectedPartyId === 'ALL'
                    ? 'kk-brand-gradient text-white border-transparent'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                All ({formatINR(totalQty)})
              </button>
              {sellerSummaries.map((s) => (
                <button
                  key={s.partyId}
                  type="button"
                  onClick={() => {
                    AppSounds.tap();
                    setSelectedPartyId(s.partyId);
                  }}
                  className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-extrabold border cursor-pointer transition-colors ${
                    selectedPartyId === s.partyId
                      ? 'kk-brand-gradient text-white border-transparent'
                      : 'bg-emerald-50/70 text-emerald-900 border-emerald-200 hover:bg-emerald-100/70'
                  }`}
                >
                  {s.lineageLabel} ({formatINR(s.qty)})
                </button>
              ))}
            </div>
          )}

          {/* Live Rows Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200/90">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100/90 text-slate-600 text-[10px] font-extrabold uppercase tracking-wider border-b border-slate-200">
                  <th className="py-2 px-2.5">Chain Seller</th>
                  <th className="py-2 px-2">Item</th>
                  <th className="py-2 px-2">Start</th>
                  <th className="py-2 px-2">End</th>
                  <th className="py-2 px-2">Range</th>
                  <th className="py-2 px-2.5 text-right">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono-tabular">
                {visibleRows.slice(0, visibleLimit).map((row) => (
                  <tr key={row.key} className="hover:bg-emerald-50/35">
                    <td className="py-2 px-2.5 font-sans font-extrabold text-slate-900 whitespace-nowrap">
                      {row.lineageLabel}
                    </td>
                    <td className="py-2 px-2 font-bold text-[var(--kk-brand)] whitespace-nowrap">
                      {row.item}
                    </td>
                    <td className="py-2 px-2 font-bold text-slate-800 whitespace-nowrap">
                      {row.start}
                    </td>
                    <td className="py-2 px-2 font-bold text-slate-800 whitespace-nowrap">
                      {row.end}
                    </td>
                    <td className="py-2 px-2 text-slate-600 whitespace-nowrap">
                      {row.range}
                    </td>
                    <td className="py-2 px-2.5 text-right font-black text-emerald-800 whitespace-nowrap">
                      {formatINR(row.qty)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibleRows.length > visibleLimit && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setVisibleLimit((cur) => cur + 200)}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer"
              >
                Show +200 more ({visibleRows.length - visibleLimit} left)
              </button>
              <button
                type="button"
                onClick={() => setVisibleLimit(visibleRows.length)}
                className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold cursor-pointer"
              >
                Show All ({visibleRows.length})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
