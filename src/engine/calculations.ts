import {
  AgencyConfig,
  ComputedTicketRow,
  LimitPrizeRow,
  LimitPrizeSessionGroup,
  OverLimitBreakdownGroup,
  OverLimitSellerShare,
  ParsedWinningNumber,
  PrizeListRow,
  RowStatusType,
  Seller,
  SellerBillRow,
  SessionComputation,
  SessionId,
  TicketEntryRow,
  WinningRawBySession,
} from '../types/ledger';

export const SESSIONS: SessionId[] = ['1PM', '6PM', '8PM'];
export const DEFAULT_LIMIT_WHATSAPP = '918918692554';

export function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

export function pad5(num: number): string {
  return ('00000' + num).slice(-5);
}

export function formatINR(num: number): string {
  const rounded = Math.round(num * 100) / 100;
  return rounded.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  });
}

export function formatINRWhole(num: number): string {
  return Math.round(num).toLocaleString('en-IN');
}

export function formatDateDDMMYYYY(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatDateDDMM(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}`;
}

/**
 * Extracts numeric multiplier from Item string (e.g. "M5" -> 5, "D10" -> 10, "E20" -> 20, "25" -> 25).
 * Mirrors VALUE(MID(C2, 2, LEN(C2))) and REGEXREPLACE(E2, "[^0-9]", "").
 */
export function parseItemMultiplier(itemStr: string): number {
  const cleaned = String(itemStr || '').trim();
  if (!cleaned) return 0;
  // Prefer digits after prefix letter if standard format like M5, D10, E20
  const digitsOnly = cleaned.replace(/[^0-9]/g, '');
  if (!digitsOnly) return 0;
  const parsed = parseInt(digitsOnly, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Computes rangeEndInt using suffix-length shorthand matching Google Sheets:
 * - If customRange > 0: startNumInt + customRange - 1
 * - Else if endNumStr has 1..4 digits (e.g. "7", "29", "557", "2239"): replaces the last N digits
 *   of startNumInt and rolls forward by 10^N if candidate < startNumInt
 * - Else if endNumStr has 5+ digits: uses full integer (clamped >= startNumInt)
 * - Else: startNumInt
 */
export function getRangeEndInt(startNumInt: number, endNumStr: string, customRange: number): number {
  let rangeEndInt = startNumInt;
  const trimmedEnd = String(endNumStr || '').trim();

  if (customRange > 0) {
    rangeEndInt = startNumInt + customRange - 1;
  } else if (trimmedEnd !== '' && !Number.isNaN(Number(trimmedEnd))) {
    const parsedEnd = parseInt(trimmedEnd, 10);
    if (Number.isFinite(parsedEnd) && parsedEnd >= 0) {
      if (trimmedEnd.length < 5) {
        const mod = Math.pow(10, trimmedEnd.length);
        const prefixVal = Math.floor(startNumInt / mod) * mod;
        let candidate = prefixVal + (parsedEnd % mod);
        if (candidate < startNumInt) {
          candidate += mod;
        }
        rangeEndInt = candidate;
      } else {
        rangeEndInt = parsedEnd >= startNumInt ? parsedEnd : startNumInt;
      }
    }
  }

  if (rangeEndInt > 99999) rangeEndInt = 99999;
  return rangeEndInt;
}

/**
 * Mirrors Excel formulas for Qty (Col F) and Range (Col G) without #DIV/0! errors.
 */
export function computeRowQtyAndRange(row: TicketEntryRow): {
  itemMultiplier: number;
  qty: number;
  range: number;
  startNumInt: number | null;
  rangeEndInt: number | null;
} {
  const itemMultiplier = parseItemMultiplier(row.item);
  const startTrimmed = String(row.start || '').trim();
  const endTrimmed = String(row.end || '').trim();
  const hasStart = startTrimmed !== '' && !Number.isNaN(Number(startTrimmed));
  const startNumInt = hasStart ? parseInt(startTrimmed, 10) : null;

  const customQty = row.qtyOverride.trim() !== '' ? Number(row.qtyOverride) : null;
  const customRangeInput = row.rangeOverride.trim() !== '' ? Number(row.rangeOverride) : null;

  if (startNumInt === null || startNumInt < 0 || startNumInt > 99999) {
    const fallbackQty = customQty !== null && !Number.isNaN(customQty) ? customQty : 0;
    const fallbackRange =
      customRangeInput !== null && !Number.isNaN(customRangeInput)
        ? customRangeInput
        : itemMultiplier > 0 && fallbackQty > 0
          ? round2(fallbackQty / itemMultiplier)
          : 0;
    return {
      itemMultiplier,
      qty: fallbackQty,
      range: fallbackRange,
      startNumInt,
      rangeEndInt: null,
    };
  }

  // If user manually overrode Range
  if (customRangeInput !== null && !Number.isNaN(customRangeInput) && customRangeInput > 0) {
    const rangeEndInt = getRangeEndInt(startNumInt, endTrimmed, customRangeInput);
    const qty =
      customQty !== null && !Number.isNaN(customQty)
        ? customQty
        : round2(customRangeInput * itemMultiplier);
    return {
      itemMultiplier,
      qty,
      range: customRangeInput,
      startNumInt,
      rangeEndInt,
    };
  }

  // If user manually overrode Qty
  if (customQty !== null && !Number.isNaN(customQty) && customQty > 0) {
    const computedRange = itemMultiplier > 0 ? round2(customQty / itemMultiplier) : 1;
    const rangeEndInt = getRangeEndInt(
      startNumInt,
      endTrimmed,
      endTrimmed === '' && computedRange >= 1 ? Math.round(computedRange) : 0
    );
    const numberCount = Math.max(1, rangeEndInt - startNumInt + 1);
    // Prevent impossible fractional tickets per number (e.g. Qty=5 across 10 numbers = 0.5/number)
    // when an explicit END range & ITEM multiplier are both set
    if (endTrimmed !== '' && itemMultiplier > 0 && numberCount > 1 && customQty % numberCount !== 0) {
      return {
        itemMultiplier,
        qty: numberCount * itemMultiplier,
        range: numberCount,
        startNumInt,
        rangeEndInt,
      };
    }
    return {
      itemMultiplier,
      qty: customQty,
      range: endTrimmed !== '' ? numberCount : computedRange,
      startNumInt,
      rangeEndInt,
    };
  }

  // Standard formula mode
  const rangeEndInt = getRangeEndInt(startNumInt, endTrimmed, 0);
  const numberCount = Math.max(1, rangeEndInt - startNumInt + 1);
  const qty = itemMultiplier > 0 ? numberCount * itemMultiplier : 0;
  const range = itemMultiplier > 0 ? numberCount : 0;

  return {
    itemMultiplier,
    qty,
    range,
    startNumInt,
    rangeEndInt,
  };
}

/**
 * Exact port of Apps Script formatLimitGroup(limVal, nums, prefixChar).
 */
export function formatLimitGroup(
  limVal: number,
  nums: number[],
  prefixChar: string
): { text: string; lineTotal: number } {
  const ranges: Array<[number, number]> = [];
  let rangeStart = nums[0];
  let prev = nums[0];

  for (let i = 1; i < nums.length; i++) {
    const curr = nums[i];
    if (curr === prev + 1) {
      prev = curr;
    } else {
      ranges.push([rangeStart, prev]);
      rangeStart = curr;
      prev = curr;
    }
  }
  ranges.push([rangeStart, prev]);

  const lines: string[] = [];
  let groupTotal = 0;

  for (let r = 0; r < ranges.length; r++) {
    const s = ranges[r][0];
    const e = ranges[r][1];
    const countInRange = e - s + 1;
    const lineSum = round2(limVal * countInRange);
    groupTotal += lineSum;

    const sStr = pad5(s);
    if (s === e) {
      lines.push(`${prefixChar}${limVal}=${sStr}`);
    } else {
      const eStr = pad5(e);
      const rangeLabel =
        sStr.slice(0, 3) === eStr.slice(0, 3)
          ? `${sStr}-${eStr.slice(-2)}`
          : `${sStr}-${eStr}`;
      lines.push(`${prefixChar}${limVal}=${rangeLabel}=${lineSum}`);
    }
  }

  return {
    text: lines.join('\n'),
    lineTotal: round2(groupTotal),
  };
}

export function isMyChoiceName(name: string): boolean {
  const compact = String(name || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return compact === 'MYCHOICE' || compact === 'MYCOICE';
}

export function isExcludedEntryName(name: string, excludedUpperList: string[]): boolean {
  const clean = String(name || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!clean) return false;
  if (excludedUpperList.some((ex) => ex.replace(/\s+/g, ' ') === clean)) return true;
  if (isMyChoiceName(clean) && excludedUpperList.some((ex) => isMyChoiceName(ex))) return true;
  return false;
}

/**
 * Exact port of processLimitStatusAndAutofill for a single session (1PM / 6PM / 8PM).
 */
export function processSessionRows(
  rows: TicketEntryRow[],
  sessionId: SessionId,
  config: AgencyConfig
): SessionComputation {
  const prefix = config.sheetPrefixMap[sessionId] || 'M';
  const thresholdLimit = config.limitThreshold + 0.001;
  const excludedUpper = (config.excludedPrizeNames || [])
    .map((n) => n.trim().toUpperCase())
    .filter(Boolean);
  const numberTotals = new Float64Array(100000);
  const lastRowForNumber = new Int32Array(100000);
  lastRowForNumber.fill(-1);

  let lastValidName = '';
  let totalQty = 0;

  interface ParsedMeta {
    isInvalid: boolean;
    startNumInt: number;
    rangeEndInt: number;
  }

  const rowComputed = rows.map((row, i) => {
    const currName = row.name.trim();
    const itemStr = row.item.trim();
    const startStr = row.start.trim();
    const endStr = row.end.trim();

    const hasRealData = itemStr !== '' || startStr !== '' || endStr !== '';
    if (currName !== '') {
      lastValidName = currName;
    }
    const resolvedName = currName !== '' ? currName : hasRealData ? lastValidName : '';
    const isExcluded = isExcludedEntryName(resolvedName, excludedUpper);

    const metrics = computeRowQtyAndRange(row);
    if (!isExcluded) {
      totalQty += metrics.qty;
    }

    let parsedMeta: ParsedMeta | null = null;
    if (startStr !== '') {
      if (
        Number.isNaN(Number(startStr)) ||
        metrics.qty <= 0 ||
        metrics.startNumInt === null ||
        metrics.startNumInt < 0 ||
        metrics.startNumInt > 99999 ||
        metrics.rangeEndInt === null
      ) {
        parsedMeta = { isInvalid: true, startNumInt: 0, rangeEndInt: 0 };
      } else {
        const totalNumbersInRow = Math.max(1, metrics.rangeEndInt - metrics.startNumInt + 1);
        const qtyPerNumber = metrics.qty / totalNumbersInRow;

        for (let n = metrics.startNumInt; n <= metrics.rangeEndInt; n++) {
          numberTotals[n] += qtyPerNumber;
          lastRowForNumber[n] = i;
        }

        parsedMeta = {
          isInvalid: false,
          startNumInt: metrics.startNumInt,
          rangeEndInt: metrics.rangeEndInt,
        };
      }
    }

    return {
      row,
      rowIndex: i,
      resolvedName,
      isExcluded,
      metrics,
      parsedMeta,
    };
  });

  let overLimitTotal = 0;
  const overLimitLines: string[] = [];

  const computedRows: ComputedTicketRow[] = rowComputed.map((entry, j) => {
    const pRow = entry.parsedMeta;
    let limitStatus = '';
    let statusType: RowStatusType = 'empty';

    if (!pRow) {
      limitStatus = '';
      statusType = 'empty';
    } else if (pRow.isInvalid) {
      limitStatus = '⚠️ Invalid Qty/End';
      statusType = 'invalid';
    } else {
      const limitGroups: Record<string, number[]> = Object.create(null);
      const limitKeys: number[] = [];
      let hasEarlierOverLimitEntry = false;

      for (let num = pRow.startNumInt; num <= pRow.rangeEndInt; num++) {
        const total = numberTotals[num];
        if (total > thresholdLimit) {
          if (lastRowForNumber[num] === j) {
            const roundedExcess = round2(total - config.limitThreshold);
            const key = String(roundedExcess);
            if (!limitGroups[key]) {
              limitGroups[key] = [];
              limitKeys.push(roundedExcess);
            }
            limitGroups[key].push(num);
          } else {
            hasEarlierOverLimitEntry = true;
          }
        }
      }

      if (limitKeys.length > 0) {
        limitKeys.sort((a, b) => a - b);
        const formattedLines: string[] = [];
        let rowGrandTotal = 0;

        for (let k = 0; k < limitKeys.length; k++) {
          const limVal = limitKeys[k];
          const nums = limitGroups[String(limVal)];
          const groupInfo = formatLimitGroup(limVal, nums, prefix);
          formattedLines.push(groupInfo.text);
          rowGrandTotal += groupInfo.lineTotal;
        }

        overLimitTotal += rowGrandTotal;
        limitStatus = formattedLines.join('\n');
        overLimitLines.push(limitStatus);
        statusType = 'overlimit';
      } else if (hasEarlierOverLimitEntry) {
        limitStatus = '⚠️ OK';
        statusType = 'warning';
      } else {
        limitStatus = '✅ OK';
        statusType = 'ok';
      }
    }

    return {
      ...entry.row,
      rowIndex: entry.rowIndex,
      resolvedName: entry.resolvedName,
      isExcludedFromCount: entry.isExcluded,
      itemMultiplier: entry.metrics.itemMultiplier,
      qty: entry.metrics.qty,
      range: entry.metrics.range,
      startNumInt: entry.metrics.startNumInt,
      rangeEndInt: entry.metrics.rangeEndInt,
      limitStatus,
      statusType,
    };
  });

  const lowerBound = (arr: number[], target: number) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const buildBreakdownGroups = (
    nums: number[],
    baseThreshold: number,
    idPrefix: string
  ): OverLimitBreakdownGroup[] => {
    if (nums.length === 0) return [];
    const perNumSellerMap = new Map<
      number,
      Map<string, { qty: number; rowCount: number; items: Set<string> }>
    >();

    for (const entry of rowComputed) {
      const pRow = entry.parsedMeta;
      if (!pRow || pRow.isInvalid) continue;
      const totalNumbersInRow = Math.max(1, pRow.rangeEndInt - pRow.startNumInt + 1);
      const qtyPerNum = round2(entry.metrics.qty / totalNumbersInRow);
      const sellerName = (entry.resolvedName || '').trim().toUpperCase() || 'UNASSIGNED';
      const itemLabel = entry.row.item.trim().toUpperCase() || '-';

      let idx = lowerBound(nums, pRow.startNumInt);
      while (idx < nums.length && nums[idx] <= pRow.rangeEndInt) {
        const num = nums[idx];
        let sellerMap = perNumSellerMap.get(num);
        if (!sellerMap) {
          sellerMap = new Map();
          perNumSellerMap.set(num, sellerMap);
        }
        let rec = sellerMap.get(sellerName);
        if (!rec) {
          rec = { qty: 0, rowCount: 0, items: new Set<string>() };
          sellerMap.set(sellerName, rec);
        }
        rec.qty = round2(rec.qty + qtyPerNum);
        rec.rowCount += 1;
        rec.items.add(itemLabel);
        idx++;
      }
    }

    const groups: OverLimitBreakdownGroup[] = [];
    let activeSig = '';
    for (const num of nums) {
      const totalQtyPerNum = round2(numberTotals[num]);
      const excessQtyPerNum = round2(Math.max(0, totalQtyPerNum - baseThreshold));
      const sellerMap = perNumSellerMap.get(num);
      const sellers: OverLimitSellerShare[] = sellerMap
        ? Array.from(sellerMap.entries())
            .map(([sellerName, rec]) => ({
              sellerName,
              qty: rec.qty,
              rowCount: rec.rowCount,
              items: Array.from(rec.items),
            }))
            .sort((a, b) => b.qty - a.qty || a.sellerName.localeCompare(b.sellerName))
        : [];

      const lastIdx = lastRowForNumber[num];
      const lastEntry = lastIdx >= 0 ? rowComputed[lastIdx] : undefined;
      const lastSellerName =
        (lastEntry?.resolvedName || '').trim().toUpperCase() || 'UNASSIGNED';

      const sig = `${totalQtyPerNum}|${excessQtyPerNum}|${lastIdx}|${sellers
        .map((s) => `${s.sellerName}:${s.qty}:${s.rowCount}`)
        .join(',')}`;

      const prevGroup = groups[groups.length - 1];
      if (prevGroup && prevGroup.endInt + 1 === num && activeSig === sig) {
        prevGroup.endInt = num;
        prevGroup.endNum = pad5(num);
        prevGroup.count += 1;
      } else {
        activeSig = sig;
        const padded = pad5(num);
        groups.push({
          id: `${sessionId}-${idPrefix}-${padded}`,
          startNum: padded,
          endNum: padded,
          startInt: num,
          endInt: num,
          count: 1,
          totalQtyPerNum,
          excessQtyPerNum,
          lastRowIndex: lastIdx,
          lastSellerName,
          sellers,
        });
      }
    }
    return groups;
  };

  // Build per-seller Over-Limit Breakdown Groups ("Kis kis sath limit over hua")
  const overLimitNums: number[] = [];
  const over10Nums: number[] = [];
  const watch10Limit = 10 + 0.001;
  for (let n = 0; n < 100000; n++) {
    const val = numberTotals[n];
    if (val > thresholdLimit) {
      overLimitNums.push(n);
    }
    if (val > watch10Limit) {
      over10Nums.push(n);
    }
  }

  const overLimitGroups = buildBreakdownGroups(overLimitNums, config.limitThreshold, 'limgrp');
  const watchOver10Groups = config.disableOver10Watch
    ? []
    : config.limitThreshold <= 10
      ? overLimitGroups
      : buildBreakdownGroups(over10Nums, 10, 'over10');

  // Attach matching overLimitBreakdowns ONLY to the last row where each number finishes
  const finalComputedRows: ComputedTicketRow[] =
    watchOver10Groups.length === 0 && overLimitGroups.length === 0
      ? computedRows
      : computedRows.map((row) => {
          if (row.startNumInt === null || row.rangeEndInt === null || row.statusType === 'invalid') {
            return row;
          }
          if (row.statusType === 'warning') {
            return row;
          }
          const sourceGroups =
            row.statusType === 'overlimit' ? overLimitGroups : watchOver10Groups;
          const matching = sourceGroups.filter((g) => g.lastRowIndex === row.rowIndex);
          return matching.length > 0 ? { ...row, overLimitBreakdowns: matching } : row;
        });

  overLimitTotal = round2(overLimitTotal);
  const waLines = [...overLimitLines];
  if (overLimitTotal > 0) {
    waLines.push(`Total ${overLimitTotal}`);
  }
  const waMessage = waLines.join('\n');
  const limitWaPhone = normalizePhone(config.whatsappNumber) || DEFAULT_LIMIT_WHATSAPP;
  const waUrl =
    overLimitTotal > 0
      ? `https://wa.me/${limitWaPhone}?text=${encodeURIComponent(waMessage)}`
      : '';

  return {
    sessionId,
    prefix,
    rows: finalComputedRows,
    numberTotals,
    totalQty: round2(totalQty),
    overLimitTotal,
    overLimitLines,
    overLimitGroups,
    watchOver10Groups,
    waMessage,
    waUrl,
  };
}

export function normalizeRankLabel(rankStr: string): string {
  const lower = String(rankStr || '').toLowerCase();
  if (lower.includes('1')) return '1st';
  if (lower.includes('2')) return '2nd';
  if (lower.includes('3')) return '3rd';
  if (lower.includes('4')) return '4th';
  if (lower.includes('5')) return '5th';
  return rankStr.trim();
}

/**
 * Parses Winning Number column text (supports newlines, spaces, commas, or rank headers like "1st", "2nd Prize", "3rd", "4th", "5th").
 */
export function parseWinningNumbers(
  winningRaw: WinningRawBySession
): Record<SessionId, ParsedWinningNumber[]> {
  const result: Record<SessionId, ParsedWinningNumber[]> = {
    '1PM': [],
    '6PM': [],
    '8PM': [],
  };

  for (const session of SESSIONS) {
    const raw = winningRaw[session] || '';
    const normalizedRaw = raw.replace(/\s+(?=[1-5](?:st|nd|rd|th)\b)/gi, '\n');
    const lines = normalizedRaw.split(/\r?\n/);
    let currentRank = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const lower = trimmed.toLowerCase();
      // Check if line is a rank header (e.g. "1st", "2nd", "3rd", "4th", "5th", "1st Prize:")
      const hasOrdinal =
        lower.includes('st') ||
        lower.includes('nd') ||
        lower.includes('rd') ||
        lower.includes('th');

      // If line contains ordinal keyword and isn't purely a huge list of numbers, treat ordinal portion as rank header,
      // and also parse any numbers trailing on the same line (e.g., "1st: 54321")!
      if (hasOrdinal) {
        const rankMatch = trimmed.match(/([1-5](?:st|nd|rd|th)(?:\s*prize)?)/i);
        if (rankMatch) {
          currentRank = normalizeRankLabel(rankMatch[1]);
          const remainder = trimmed.replace(rankMatch[0], '').trim();
          if (!remainder) continue;
          extractNumbersIntoList(remainder, currentRank, result[session]);
          continue;
        }
        currentRank = normalizeRankLabel(trimmed);
        continue;
      }

      if (!currentRank) continue;
      extractNumbersIntoList(trimmed, currentRank, result[session]);
    }
  }

  return result;
}

function extractNumbersIntoList(
  text: string,
  rank: string,
  target: ParsedWinningNumber[]
) {
  // Split on whitespace, commas, semicolons, pipes, dashes (if separated)
  const tokens = text.split(/[\s,;|/]+/);
  const rankLower = rank.toLowerCase();
  const isFirstOrSec = rankLower.includes('1') || rankLower.includes('2');

  for (const token of tokens) {
    // Strip non-digits (e.g. series prefixes like 84A 54321 -> check digits)
    const digits = token.replace(/\D/g, '');
    if (digits.length < 4) continue;

    // If token had >5 digits (e.g. serial+5digit combined), take last 5 for 1st/2nd or last 4 for others
    const num5 = digits.slice(-5);
    const num4 = ('0000' + digits).slice(-4);

    target.push({
      fullInt: isFirstOrSec ? parseInt(num5, 10) : null,
      win4DigitsInt: !isFirstOrSec ? parseInt(num4, 10) : -1,
      rank,
      rawNumber: isFirstOrSec ? num5.padStart(5, '0') : num4,
      isFirstOrSecond: isFirstOrSec,
    });
  }
}

export function getSellerPrizeRates(rankStr: string, sellerName: string): {
  prize: number;
  vc: number;
  svc: number;
} {
  const rank = normalizeRankLabel(rankStr);
  const compactName = String(sellerName || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const isSpecialSeller = compactName === 'TAPAN' || compactName === 'SONU';
  const isHeroSeller = compactName === 'HERO' || compactName === 'HEEO';

  switch (rank) {
    case '1st':
      return { prize: isSpecialSeller ? 25000 : 24750, vc: 2000, svc: isHeroSeller ? 0 : 400 };
    case '2nd':
      return { prize: isSpecialSeller ? 20000 : 19800, vc: 2000, svc: isHeroSeller ? 0 : 400 };
    case '3rd':
      return { prize: 2000, vc: 200, svc: isHeroSeller ? 0 : 40 };
    case '4th':
      return { prize: 700, vc: 150, svc: isHeroSeller ? 0 : 20 };
    case '5th':
      return { prize: 300, vc: 70, svc: isHeroSeller ? 0 : 10 };
    default:
      return { prize: 0, vc: 0, svc: 0 };
  }
}

export function computeSellerSvc(
  rankStr: string,
  sellerName: string,
  itemMultiplier: number
): number {
  const rates = getSellerPrizeRates(rankStr, sellerName);
  if (rates.svc === 0 || itemMultiplier <= 0) return 0;

  const compactName = String(sellerName || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  const svcQty = compactName === 'TAPAN' ? Math.min(10, itemMultiplier) : itemMultiplier;
  return round2(rates.svc * svcQty);
}

export function getLimitPrizeRates(rankStr: string): { prize: number; vc: number } {
  const r = String(rankStr || '').toLowerCase();
  if (r.includes('1')) return { prize: 25000, vc: 2000 };
  if (r.includes('2')) return { prize: 20000, vc: 2000 };
  if (r.includes('3')) return { prize: 2000, vc: 200 };
  if (r.includes('4')) return { prize: 700, vc: 150 };
  if (r.includes('5')) return { prize: 300, vc: 70 };
  return { prize: 0, vc: 0 };
}

/**
 * Generates both Prize List (seller payouts) and Limit Prize (excess over limit payouts)
 * mirroring generatePrizeList() + sheet Prize/VC/SVC formulas.
 */
export function generatePrizeAndLimitData(
  sessionComputations: Record<SessionId, SessionComputation>,
  winningMap: Record<SessionId, ParsedWinningNumber[]>,
  config: AgencyConfig
): {
  prizeList: PrizeListRow[];
  limitPrizeGroups: LimitPrizeSessionGroup[];
  limitGrandTotal: number;
} {
  const prizeList: PrizeListRow[] = [];
  const limitPrizeGroups: LimitPrizeSessionGroup[] = [];
  let limitGrandTotal = 0;

  const excludedUpper = config.excludedPrizeNames.map((n) => n.trim().toUpperCase());
  const thresholdLimit = config.limitThreshold + 0.001;

  for (const sessionId of SESSIONS) {
    const comp = sessionComputations[sessionId];
    const sessionWins = winningMap[sessionId] || [];
    const sheetPrefix = comp.prefix;

    // 1. Prize List (per row in 1PM / 6PM / 8PM, grouped by Seller inside each session like Apps Script)
    const sessionSellerOrder: string[] = [];
    const sessionSellerMap = new Map<string, PrizeListRow[]>();

    const pushSessionPrizeRow = (prizeRow: PrizeListRow) => {
      const sellerKey = prizeRow.name.trim().toUpperCase() || 'UNKNOWN';
      let bucket = sessionSellerMap.get(sellerKey);
      if (!bucket) {
        bucket = [];
        sessionSellerMap.set(sellerKey, bucket);
        sessionSellerOrder.push(sellerKey);
      }
      bucket.push(prizeRow);
    };

    for (const row of comp.rows) {
      if (row.startNumInt === null || row.rangeEndInt === null || row.statusType === 'invalid') {
        continue;
      }

      const cleanNameUpper = row.resolvedName.trim().toUpperCase();
      if (
        !cleanNameUpper ||
        isMyChoiceName(cleanNameUpper) ||
        isExcludedEntryName(cleanNameUpper, excludedUpper)
      ) {
        continue;
      }

      const itemUpper = row.item.trim().toUpperCase();
      const itemVal = row.itemMultiplier;
      const startFirstDigit = Math.floor(row.startNumInt / 10000);
      const endFirstDigit = Math.floor(row.rangeEndInt / 10000);

      for (const winObj of sessionWins) {
        if (winObj.isFirstOrSecond) {
          if (
            winObj.fullInt !== null &&
            winObj.fullInt >= row.startNumInt &&
            winObj.fullInt <= row.rangeEndInt
          ) {
            const numStr = pad5(winObj.fullInt);
            const rates = getSellerPrizeRates(winObj.rank, row.resolvedName);
            const prize = round2(rates.prize * itemVal);
            const vc = round2(rates.vc * itemVal);
            const svc = computeSellerSvc(winObj.rank, row.resolvedName, itemVal);
            pushSessionPrizeRow({
              id: `${sessionId}-${row.id}-${numStr}-${winObj.rank}`,
              time: sessionId,
              name: row.resolvedName,
              number: numStr,
              rank: winObj.rank,
              item: itemUpper,
              prize,
              vc,
              svc,
              total: round2(prize + vc + svc),
            });
          }
        } else {
          for (let dPrefix = startFirstDigit; dPrefix <= endFirstDigit; dPrefix++) {
            const constructedNum = dPrefix * 10000 + winObj.win4DigitsInt;
            if (constructedNum >= row.startNumInt && constructedNum <= row.rangeEndInt) {
              const numStr = pad5(constructedNum);
              const rates = getSellerPrizeRates(winObj.rank, row.resolvedName);
              const prize = round2(rates.prize * itemVal);
              const vc = round2(rates.vc * itemVal);
              const svc = computeSellerSvc(winObj.rank, row.resolvedName, itemVal);
              pushSessionPrizeRow({
                id: `${sessionId}-${row.id}-${numStr}-${winObj.rank}`,
                time: sessionId,
                name: row.resolvedName,
                number: numStr,
                rank: winObj.rank,
                item: itemUpper,
                prize,
                vc,
                svc,
                total: round2(prize + vc + svc),
              });
            }
          }
        }
      }
    }

    for (const sKey of sessionSellerOrder) {
      const bucket = sessionSellerMap.get(sKey);
      if (bucket) {
        for (const pRow of bucket) {
          prizeList.push(pRow);
        }
      }
    }

    // 2. Limit Prize (excess over LIMIT_THRESHOLD across all numbers 0..99999)
    const sessionLimitRows: LimitPrizeRow[] = [];
    let sessionTotal = 0;
    const sessionMsgLines: string[] = [];

    if (sessionWins.length > 0) {
      for (let numInt = 0; numInt < 100000; numInt++) {
        const totalQty = comp.numberTotals[numInt];
        if (totalQty > thresholdLimit) {
          const excessQty = round2(totalQty - config.limitThreshold);
          const numLast4Int = numInt % 10000;

          for (const winObj of sessionWins) {
            const isMatched = winObj.isFirstOrSecond
              ? winObj.fullInt === numInt
              : winObj.win4DigitsInt === numLast4Int;

            if (isMatched) {
              const rates = getLimitPrizeRates(winObj.rank);
              const prizeAmt = round2(rates.prize * excessQty);
              const vcAmt = round2(rates.vc * excessQty);
              const totalAmt = round2(prizeAmt + vcAmt);
              const numFormatted = pad5(numInt);

              const matchingGroup = comp.overLimitGroups?.find(
                (g) => numInt >= g.startInt && numInt <= g.endInt
              );

              sessionTotal += totalAmt;
              sessionLimitRows.push({
                id: `lim-${sessionId}-${numFormatted}-${winObj.rank}`,
                time: sessionId,
                number: numFormatted,
                rank: winObj.rank,
                item: `${sheetPrefix}${excessQty}`,
                excessQty,
                prize: prizeAmt,
                vc: vcAmt,
                total: totalAmt,
                sellers: matchingGroup?.sellers,
              });

              sessionMsgLines.push(
                `${sessionId} ${numFormatted} ${winObj.rank} ${sheetPrefix}${excessQty} = ${totalAmt}`
              );
            }
          }
        }
      }
    }

    if (sessionLimitRows.length > 0) {
      sessionTotal = round2(sessionTotal);
      limitGrandTotal += sessionTotal;
      const sessionTotalLabel = `${sessionId} Total ${sessionTotal}`;
      sessionMsgLines.push(sessionTotalLabel);
      const waMessage = sessionMsgLines.join('\n');
      const limitWaPhone = normalizePhone(config.whatsappNumber) || DEFAULT_LIMIT_WHATSAPP;
      const waUrl = `https://wa.me/${limitWaPhone}?text=${encodeURIComponent(waMessage)}`;

      limitPrizeGroups.push({
        sessionId,
        rows: sessionLimitRows,
        sessionTotal,
        waMessage,
        waUrl,
      });
    }
  }

  return {
    prizeList,
    limitPrizeGroups,
    limitGrandTotal: round2(limitGrandTotal),
  };
}

export function normalizePhone(rawPhone: string): string {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  return digits;
}

/**
 * Computes Seller Bill rows & generates exact Digital Invoice WhatsApp message per seller.
 */
export function computeSellerBills(
  sellers: Seller[],
  sessionComputations: Record<SessionId, SessionComputation>,
  prizeList: PrizeListRow[],
  isoDate: string
): SellerBillRow[] {
  const formattedDate = formatDateDDMMYYYY(isoDate);

  return sellers.map((seller) => {
    const sellerKey = seller.name.trim().toUpperCase();

    const sumSessionQty = (sessionId: SessionId) =>
      sessionComputations[sessionId].rows.reduce((acc, row) => {
        if (
          !row.isExcludedFromCount &&
          row.resolvedName.trim().toUpperCase() === sellerKey
        ) {
          return acc + row.qty;
        }
        return acc;
      }, 0);

    const mor = round2(sumSessionQty('1PM'));
    const day = round2(sumSessionQty('6PM'));
    const eve = round2(sumSessionQty('8PM'));
    const sold = round2(mor + day + eve);

    const bill = round2(
      round2(mor * seller.rate) + round2(day * seller.rate) + round2(eve * seller.rate)
    );

    const sellerPrizes = prizeList.filter(
      (p) => p.name.trim().toUpperCase() === sellerKey
    );
    const sumSessionPrize = (sessionId: SessionId) =>
      round2(
        sellerPrizes
          .filter((p) => p.time === sessionId)
          .reduce((acc, p) => acc + p.total, 0)
      );
    const amt1pm = sumSessionPrize('1PM');
    const amt6pm = sumSessionPrize('6PM');
    const amt8pm = sumSessionPrize('8PM');
    const prizeTotal = round2(sellerPrizes.reduce((acc, p) => acc + p.total, 0));

    const fresh = round2(bill - prizeTotal);
    const total = round2(fresh - seller.joma + seller.due);

    const waMessage = buildDigitalInvoiceMessage({
      dateStr: formattedDate,
      clientName: seller.name,
      mor,
      day,
      eve,
      sold,
      amt1pm,
      amt6pm,
      amt8pm,
      bill,
      prizeTotal,
      fresh,
      joma: seller.joma,
      due: seller.due,
      total,
      prizes: sellerPrizes,
    });

    const phone = normalizePhone(seller.mobile);
    const waUrl = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(waMessage)}`
      : '';

    return {
      ...seller,
      mor,
      day,
      eve,
      sold,
      amt1pm,
      amt6pm,
      amt8pm,
      bill,
      prizeTotal,
      fresh,
      total,
      prizes: sellerPrizes,
      waMessage,
      waUrl,
    };
  });
}

function formatLedgerRow(label: string, value: string, width = 27): string {
  const gap = Math.max(1, width - label.length - value.length);
  return `${label}${' '.repeat(gap)}${value}`;
}

function formatSignedRupee(val: number, forceSign?: '+' | '-'): string {
  const abs = formatINRWhole(Math.abs(val));
  if (forceSign === '-') return `-₹${abs}`;
  if (forceSign === '+') return `+₹${abs}`;
  return val < 0 ? `-₹${abs}` : `₹${abs}`;
}

function buildDigitalInvoiceMessage(params: {
  dateStr: string;
  clientName: string;
  mor: number;
  day: number;
  eve: number;
  sold: number;
  amt1pm: number;
  amt6pm: number;
  amt8pm: number;
  bill: number;
  prizeTotal: number;
  fresh: number;
  joma: number;
  due: number;
  total: number;
  prizes: PrizeListRow[];
}): string {
  const {
    dateStr,
    clientName,
    mor,
    day,
    eve,
    sold,
    amt1pm,
    amt6pm,
    amt8pm,
    bill,
    prizeTotal,
    fresh,
    joma,
    due,
    total,
    prizes,
  } = params;

  const W = 27;
  const thinLine = '─'.repeat(W);
  const doubleLine = '═'.repeat(W);
  const rule = '━━━━━━━━━━━━━━━━━━━━━━';
  const cleanName = clientName.trim().toUpperCase();
  const netLabel =
    total < 0 ? 'NET ADVANCE' : total === 0 ? 'NET SETTLED' : 'NET PAYABLE';
  const netFormatted = formatSignedRupee(total);

  const lines: string[] = [];
  lines.push('✦ *KK AGENCY* ✦');
  lines.push('_Official Daily Bill Statement_');
  lines.push(rule);
  lines.push(`*Party :* ${cleanName}`);
  lines.push(`*Date  :* ${dateStr}`);
  lines.push('');

  // Session Summary Table
  lines.push('*SESSION SUMMARY*');
  lines.push('```');
  if (mor > 0) lines.push(formatLedgerRow('Morning (1PM)', `${formatINRWhole(mor)}`, W));
  if (day > 0) lines.push(formatLedgerRow('Day     (6PM)', `${formatINRWhole(day)}`, W));
  if (eve > 0) lines.push(formatLedgerRow('Evening (8PM)', `${formatINRWhole(eve)}`, W));
  if (mor > 0 || day > 0 || eve > 0) lines.push(thinLine);
  lines.push(formatLedgerRow('TOTAL SOLD', `${formatINRWhole(sold)}`, W));
  if (amt1pm > 0) lines.push(formatLedgerRow('1PM Prize', formatSignedRupee(amt1pm), W));
  if (amt6pm > 0) lines.push(formatLedgerRow('6PM Prize', formatSignedRupee(amt6pm), W));
  if (amt8pm > 0) lines.push(formatLedgerRow('8PM Prize', formatSignedRupee(amt8pm), W));
  lines.push('```');
  lines.push('');

  // Account Ledger Table
  lines.push('*ACCOUNT LEDGER*');
  lines.push('```');
  if (bill !== 0) lines.push(formatLedgerRow('Gross Bill', formatSignedRupee(bill), W));
  if (prizeTotal > 0) lines.push(formatLedgerRow('Prize Less (-)', formatSignedRupee(prizeTotal, '-'), W));
  if (fresh !== 0) lines.push(formatLedgerRow('Fresh Net  (=)', formatSignedRupee(fresh), W));
  if (joma !== 0) lines.push(formatLedgerRow('Joma Paid  (-)', formatSignedRupee(Math.abs(joma), '-'), W));
  if (due !== 0) lines.push(formatLedgerRow('Prev Due   (+)', formatSignedRupee(Math.abs(due), '+'), W));
  lines.push(doubleLine);
  lines.push(formatLedgerRow(netLabel, netFormatted, W));
  lines.push('```');

  // Winning Prizes (only show full table when prizes exist)
  if (prizes.length > 0) {
    lines.push('');
    lines.push(`*WINNING PRIZES (${prizes.length})*`);
    lines.push('```');
    for (const p of prizes) {
      const paddedItem = p.item.length === 2 ? `${p.item} ` : p.item;
      const left = `${p.time} ${p.number} ${p.rank} ${paddedItem}`.trim();
      const right = formatSignedRupee(p.total);
      lines.push(formatLedgerRow(left, right, W));
    }
    lines.push(thinLine);
    lines.push(formatLedgerRow('TOTAL PRIZE', formatSignedRupee(prizeTotal), W));
    lines.push('```');
  }

  lines.push(rule);
  lines.push(`*${netLabel} : ${netFormatted}*`);
  lines.push('_Thank you for your business · KK Agency_');

  return lines.join('\n');
}

export interface SellerPrizeDispatch {
  sellerKey: string;
  time: SessionId;
  name: string;
  mobile: string;
  ticketCount: number;
  sessions: SessionId[];
  prizeSum: number;
  vcSum: number;
  svcSum: number;
  total: number;
  rows: PrizeListRow[];
  waMessage: string;
  waUrl: string;
}

export function buildSellerPrizeMessage(params: {
  dateStr: string;
  sellerName: string;
  sessionLabel?: string;
  rows: PrizeListRow[];
  total: number;
}): string {
  const { sellerName, sessionLabel, rows, total } = params;
  const timeKey = sessionLabel || rows[0]?.time || 'PRIZE';
  const lines: string[] = [];
  lines.push(`*${timeKey} - ${sellerName} Prize List*`);
  for (const p of rows) {
    const itemPart = p.item ? ` (${p.item})` : '';
    lines.push(`${p.number} | ${p.rank}${itemPart} = ${round2(p.total)}`);
  }
  lines.push(`${timeKey} Total = ${round2(total)}`);
  return lines.join('\n');
}

export function computeSellerPrizeDispatches(
  prizeRows: PrizeListRow[],
  sellers: Seller[],
  isoDate: string,
  sessionLabel?: string
): SellerPrizeDispatch[] {
  const sellerLookup = new Map<string, Seller>();
  for (const seller of sellers) {
    const key = seller.name.trim().toUpperCase();
    if (key && !sellerLookup.has(key)) {
      sellerLookup.set(key, seller);
    }
  }

  // Group per Session (1PM / 6PM / 8PM) and per Seller in order of appearance (matching Apps Script)
  const groupOrder: string[] = [];
  const groups = new Map<
    string,
    {
      time: SessionId;
      sellerKey: string;
      name: string;
      rows: PrizeListRow[];
      prizeSum: number;
      vcSum: number;
      svcSum: number;
      total: number;
    }
  >();

  for (const row of prizeRows) {
    const sKey = row.name.trim().toUpperCase();
    if (!sKey) continue;
    const compositeKey = `${row.time}::${sKey}`;
    let group = groups.get(compositeKey);
    if (!group) {
      const matchedSeller = sellerLookup.get(sKey);
      group = {
        time: row.time,
        sellerKey: sKey,
        name: matchedSeller?.name || row.name.trim(),
        rows: [],
        prizeSum: 0,
        vcSum: 0,
        svcSum: 0,
        total: 0,
      };
      groups.set(compositeKey, group);
      groupOrder.push(compositeKey);
    }
    group.rows.push(row);
    group.prizeSum = round2(group.prizeSum + row.prize);
    group.vcSum = round2(group.vcSum + row.vc);
    group.svcSum = round2(group.svcSum + row.svc);
    group.total = round2(group.total + row.total);
  }

  const formattedDate = formatDateDDMMYYYY(isoDate);

  return groupOrder.map((compositeKey) => {
    const g = groups.get(compositeKey)!;
    const seller = sellerLookup.get(g.sellerKey);
    const mobile = seller?.mobile || '';
    const phone = normalizePhone(mobile);
    const waMessage = buildSellerPrizeMessage({
      dateStr: formattedDate,
      sellerName: g.name,
      sessionLabel: sessionLabel || g.time,
      rows: g.rows,
      total: g.total,
    });
    const waUrl = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(waMessage)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(waMessage)}`;

    return {
      sellerKey: compositeKey,
      time: g.time,
      name: g.name,
      mobile,
      ticketCount: g.rows.length,
      sessions: [g.time],
      prizeSum: g.prizeSum,
      vcSum: g.vcSum,
      svcSum: g.svcSum,
      total: g.total,
      rows: g.rows,
      waMessage,
      waUrl,
    };
  });
}

export type ParsedTicketEntry = Omit<TicketEntryRow, 'id'>;

/**
 * Parses pasted text (from Gemini OCR lists, WhatsApp, or Excel/Sheets TSV)
 * into TicketEntryRow payloads for 1PM / 6PM / 8PM.
 * Supports formats like:
 * - E1062213 (prefix+multiplier+5-digit start)
 * - E5 64005 007 or E5 64005-007
 * - E5 47362
 * - M5=54321-25=25 / E10=62213
 * - Tab-separated spreadsheet rows (Name, Item, Start, End, Qty, Rng)
 * - Standalone Seller Name headers above a block of numbers
 */
export function parsePastedTicketText(
  rawText: string,
  options?: {
    defaultName?: string;
    defaultItem?: string;
    knownNames?: string[];
  }
): ParsedTicketEntry[] {
  const defaultItem = (options?.defaultItem || 'M5').trim().toUpperCase() || 'M5';
  const defaultPrefix = defaultItem.replace(/[^A-Z]/gi, '').toUpperCase() || 'M';
  const knownNamesSet = new Set(
    (options?.knownNames || []).map((n) => n.trim().toUpperCase()).filter(Boolean)
  );
  let activeName = (options?.defaultName || '').trim().toUpperCase();
  let hasAssignedFirstRowName = false;

  const results: ParsedTicketEntry[] = [];
  const rawLines = rawText.replace(/\r\n/g, '\n').split('\n');

  for (const rawLine of rawLines) {
    let line = rawLine.trim();
    if (!line) continue;

    // Skip markdown fences, labels, or pure date lines (e.g., 14/11/26)
    if (
      line.startsWith('```') ||
      /^text$/i.test(line) ||
      /^book$/i.test(line) ||
      /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(line)
    ) {
      continue;
    }

    // 1. Tab-separated spreadsheet rows (Google Sheets / Excel copy-paste)
    if (line.includes('\t')) {
      const cells = line.split('\t').map((c) => c.trim());
      // Drop leading row number or session label if copied with those columns
      let idx = 0;
      if (cells.length >= 3 && /^\d{1,4}$/.test(cells[idx]) && /^(1PM|6PM|8PM)$/i.test(cells[idx + 1])) {
        idx += 2;
      } else if (cells.length >= 2 && /^(1PM|6PM|8PM)$/i.test(cells[idx])) {
        idx += 1;
      }

      const slice = cells.slice(idx);
      if (slice.length > 0) {
        // Check if slice[0] is Seller Name (non-numeric, not an item code like S5/E10/M25)
        const c0Upper = slice[0].toUpperCase();
        const looksLikeItem0 = /^[A-Z]{1,2}\d{1,3}$/i.test(c0Upper);
        const looksLikeConcat0 = /^[A-Z]{1,2}\d{6,8}$/i.test(c0Upper);
        const looksLikeDigits0 = /^\d+$/.test(c0Upper);

        if (
          slice.length >= 3 &&
          !looksLikeItem0 &&
          !looksLikeConcat0 &&
          !looksLikeDigits0
        ) {
          const rowName = c0Upper.replace(/^↳\s*/, '');
          const rowItem = (slice[1] || defaultItem).toUpperCase();
          const rowStart = (slice[2] || '').replace(/\D/g, '').slice(0, 5);
          const rowEnd = (slice[3] || '').replace(/\D/g, '').slice(0, 5);
          const rowQty = (slice[4] || '').replace(/[^\d.]/g, '');
          const rowRng = (slice[5] || '').replace(/[^\d.]/g, '');

          if (rowName) {
            activeName = rowName;
          }
          if (rowStart || rowQty) {
            let safeQtyOverride = rowQty;
            const resolvedItem = rowItem || defaultItem;
            const mult = parseItemMultiplier(resolvedItem);
            if (rowStart && mult > 0 && rowQty) {
              const sInt = parseInt(rowStart, 10);
              const eInt = getRangeEndInt(sInt, rowEnd, 0);
              const numCount = Math.max(1, eInt - sInt + 1);
              const expectedQty = numCount * mult;
              const parsedQty = Number(rowQty);
              if (
                !Number.isFinite(parsedQty) ||
                parsedQty === expectedQty ||
                (rowEnd !== '' && numCount > 1 && parsedQty % numCount !== 0)
              ) {
                safeQtyOverride = '';
              }
            }
            results.push({
              name: rowName || (!hasAssignedFirstRowName ? activeName : ''),
              item: resolvedItem,
              start: rowStart,
              end: rowEnd,
              qtyOverride: safeQtyOverride,
              rangeOverride: rowRng,
            });
            hasAssignedFirstRowName = true;
            continue;
          }
        }
      }
      // Fall through to general parser with tabs normalized to spaces
      line = cells.filter(Boolean).join(' ');
    }

    // Normalize parentheses around multiplier like E(10) -> E10
    line = line.replace(/([A-Za-z])\s*\((\d+)\)/g, '$1$2');

    // Check if the whole line is a Seller Name header (e.g. "SUDEB" or "MY CHOICE")
    const lineUpper = line.toUpperCase();
    if (
      knownNamesSet.has(lineUpper) ||
      (/^[A-Z][A-Z\s]{1,20}$/.test(lineUpper) && !/\d/.test(lineUpper) && !/^(OK|ERR|TOTAL|LIMIT|PRIZE)$/i.test(lineUpper))
    ) {
      activeName = lineUpper;
      hasAssignedFirstRowName = false;
      continue;
    }

    // Check limit dispatch syntax: e.g. M5=54321-25=25 or E10=62213
    if (line.includes('=')) {
      const eqParts = line.split('=').map((p) => p.trim()).filter(Boolean);
      if (eqParts.length >= 2 && /^[A-Za-z]+\d{1,3}$/.test(eqParts[0])) {
        const eqItem = eqParts[0].toUpperCase();
        const numParts = eqParts[1].split(/[-–/\s]+/).map((p) => p.replace(/\D/g, '')).filter(Boolean);
        if (numParts.length >= 1 && numParts[0].length === 5) {
          results.push({
            name: !hasAssignedFirstRowName ? activeName : '',
            item: eqItem,
            start: numParts[0],
            end: numParts[1] ? numParts[1].slice(0, 5) : '',
            qtyOverride: '',
            rangeOverride: '',
          });
          hasAssignedFirstRowName = true;
          continue;
        }
      }
    }

    // Tokenize by spaces, tabs, commas
    let tokens = line.split(/[\s,;|]+/).filter(Boolean);
    if (tokens.length === 0) continue;

    // Check if leading token(s) form a known seller name or word name
    let explicitRowName = '';
    const firstUpper = tokens[0].toUpperCase();
    if (
      tokens.length >= 2 &&
      !(/^[A-Za-z]{1,2}\d+$/.test(firstUpper)) &&
      !/^\d/.test(firstUpper)
    ) {
      // Handle 2-word names like "MY CHOICE"
      const twoWord = `${firstUpper} ${(tokens[1] || '').toUpperCase()}`;
      if (knownNamesSet.has(twoWord) && tokens.length >= 3) {
        explicitRowName = twoWord;
        activeName = twoWord;
        tokens = tokens.slice(2);
      } else if (knownNamesSet.has(firstUpper) || /^[A-Z]{2,20}$/.test(firstUpper)) {
        explicitRowName = firstUpper;
        activeName = firstUpper;
        tokens = tokens.slice(1);
      }
    }

    if (tokens.length === 0) continue;

    let item = '';
    let start = '';
    let end = '';

    // Expand dash-joined start-end like "64005-007" into separate tokens (ignoring lone "-")
    const expandedTokens: string[] = [];
    for (const tok of tokens) {
      if (/^[-–—]+$/.test(tok)) continue;
      if (/^\d{5}[-–/]\d{1,5}$/.test(tok)) {
        const [s, e] = tok.split(/[-–/]/);
        expandedTokens.push(s, e);
      } else if (/^[A-Za-z]+\d{6,8}[-–/]\d{1,5}$/.test(tok)) {
        const [firstPart, e] = tok.split(/[-–/]/);
        expandedTokens.push(firstPart, e);
      } else {
        expandedTokens.push(tok);
      }
    }

    if (expandedTokens.length === 0) continue;

    const tok0 = expandedTokens[0];
    // Case A: Concatenated Item + 5-digit Start (e.g. E1062213, E2083823, E564005, S1054321)
    const concatMatch = tok0.match(/^([A-Za-z]{1,2})(\d{6,8})$/);
    if (concatMatch) {
      const prefixLetters = concatMatch[1].toUpperCase();
      const digits = concatMatch[2];
      const mult = digits.slice(0, -5);
      start = digits.slice(-5);
      item = `${prefixLetters}${mult}`;
      if (expandedTokens[1] && /^\d{1,5}$/.test(expandedTokens[1])) {
        end = expandedTokens[1];
      }
    } else {
      // Case B: Separate Item token (e.g. "M5", "M10", "D15", "E20")
      let numIdx = 0;
      if (/^[A-Za-z]{1,2}\d{1,3}$/.test(tok0)) {
        item = tok0.toUpperCase();
        numIdx = 1;
      } else if (
        /^\d{1,3}$/.test(tok0) &&
        expandedTokens[1] &&
        /^\d{5}$/.test(expandedTokens[1])
      ) {
        // Standalone multiplier before 5-digit number, e.g. "10 62213"
        item = `${defaultPrefix}${tok0}`;
        numIdx = 1;
      }

      const numericTokens = expandedTokens
        .slice(numIdx)
        .filter((t) => /^\d{1,5}$/.test(t));

      if (numericTokens.length >= 1) {
        const firstNum = numericTokens[0];
        if (firstNum.length === 5) {
          start = firstNum;
          if (numericTokens[1]) {
            end = numericTokens[1];
          }
        } else if (firstNum.length >= 3) {
          start = pad5(parseInt(firstNum, 10));
          if (numericTokens[1]) {
            end = numericTokens[1];
          }
        }
      }
    }

    if (start) {
      const rowName = explicitRowName || (!hasAssignedFirstRowName ? activeName : '');
      results.push({
        name: rowName,
        item: item || defaultItem,
        start,
        end,
        qtyOverride: '',
        rangeOverride: '',
      });
      hasAssignedFirstRowName = true;
    }
  }

  return results;
}

/**
 * Formats populated session rows into clean copyable text.
 * - 'compact': e.g. "E10 62213" or "E5 64005 007" (great for WhatsApp / pasting anywhere)
 * - 'sheet': Tab-separated "Name\tItem\tStart\tEnd" (great for Excel / Google Sheets / re-pasting)
 */
export function formatSessionRowsForCopy(
  rows: ComputedTicketRow[],
  format: 'compact' | 'sheet' = 'sheet',
  defaultItem = 'M5'
): string {
  const populated = rows.filter(
    (r) => r.name.trim() || r.item.trim() || r.start.trim() || r.end.trim()
  );
  if (populated.length === 0) return '';

  if (format === 'compact') {
    return populated
      .map((r) => {
        const prefixName = r.name.trim() ? `${r.name.trim()} ` : '';
        const itemStr = r.item.trim() || defaultItem;
        const endStr = r.end.trim() ? ` ${r.end.trim()}` : '';
        return `${prefixName}${itemStr} ${r.start.trim()}${endStr}`.trim();
      })
      .join('\n');
  }

  return populated
    .map((r) =>
      [
        r.name.trim() || r.resolvedName || '',
        r.item.trim() || defaultItem,
        r.start.trim(),
        r.end.trim(),
      ].join('\t')
    )
    .join('\n');
}
