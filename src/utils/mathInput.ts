// Spreadsheet-style arithmetic expression parser & helper for JOMA / DUE inputs
// Supports: +, -, *, ×, /, ÷, (, ), decimals, commas, leading '=' and trailing '='
// Safe recursive-descent parser (no eval / new Function).

const DIGIT_MAP: Record<string, string> = {
  // Bengali digits
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
  // Devanagari digits
  '०': '0',
  '१': '1',
  '२': '2',
  '३': '3',
  '४': '4',
  '५': '5',
  '६': '6',
  '७': '7',
  '८': '8',
  '९': '9',
};

export function normalizeDigitsAndOperators(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (DIGIT_MAP[ch]) {
      out += DIGIT_MAP[ch];
    } else if (ch === '×' || ch === 'x' || ch === 'X') {
      out += '*';
    } else if (ch === '÷') {
      out += '/';
    } else if (ch === '−' || ch === '–' || ch === '—') {
      out += '-';
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Keeps only valid formula characters so users can type numbers and math operators cleanly.
 */
export function sanitizeFormulaInput(raw: string): string {
  const normalized = normalizeDigitsAndOperators(raw);
  return normalized.replace(/[^0-9.,+\-*/()=\s]/g, '');
}

/**
 * Returns true if the string contains a math formula (leading '=', trailing '=',
 * parentheses, or any binary operator +, -, *, /).
 * Note: a lone leading negative number like "-500" is treated as a plain number, not a formula.
 */
export function isFormulaExpression(raw: string): boolean {
  const trimmed = normalizeDigitsAndOperators(raw).replace(/,/g, '').trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('=') || trimmed.endsWith('=')) return true;
  if (/[()*/]/.test(trimmed)) return true;
  // Check for '+' anywhere, or '-' anywhere after index 0
  if (trimmed.includes('+')) return true;
  const withoutLeadingSign = trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
  return withoutLeadingSign.includes('-');
}

function roundMath(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type Token =
  | { type: 'num'; value: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/' }
  | { type: 'lparen' }
  | { type: 'rparen' };

function tokenize(expr: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  const len = expr.length;

  while (i < len) {
    const ch = expr[i];
    if (ch === ' ' || ch === '\t' || ch === ',') {
      i++;
      continue;
    }

    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let numStr = '';
      let dotCount = 0;
      while (i < len && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) {
        if (expr[i] === '.') {
          dotCount++;
          if (dotCount > 1) return null;
        }
        numStr += expr[i];
        i++;
      }
      if (numStr === '.') return null;
      const parsed = Number(numStr);
      if (!Number.isFinite(parsed)) return null;
      tokens.push({ type: 'num', value: parsed });
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }

    return null;
  }

  return tokens;
}

/**
 * Safely evaluates an arithmetic expression like:
 *  - "12000+300=" -> 12300
 *  - "=12000+300" -> 12300
 *  - "12000+300-500" -> 11800
 *  - "500*3/2" -> 750
 *  - "(1000+250)*2" -> 2500
 * Returns null if the expression is empty or incomplete/invalid.
 */
export function evaluateMathExpression(raw: string): number | null {
  let cleaned = normalizeDigitsAndOperators(raw).trim();
  if (!cleaned) return null;

  // Strip optional leading and/or trailing '='
  while (cleaned.startsWith('=')) cleaned = cleaned.slice(1).trim();
  while (cleaned.endsWith('=')) cleaned = cleaned.slice(0, -1).trim();
  if (!cleaned) return null;

  const tokens = tokenize(cleaned);
  if (!tokens || tokens.length === 0) return null;

  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const consume = (): Token => tokens[pos++];

  const parseExpression = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;

    while (true) {
      const next = peek();
      if (next && next.type === 'op' && (next.value === '+' || next.value === '-')) {
        consume();
        const right = parseTerm();
        if (right === null) return null;
        left = next.value === '+' ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  };

  const parseTerm = (): number | null => {
    let left = parseUnary();
    if (left === null) return null;

    while (true) {
      const next = peek();
      if (next && next.type === 'op' && (next.value === '*' || next.value === '/')) {
        consume();
        const right = parseUnary();
        if (right === null) return null;
        if (next.value === '/') {
          if (right === 0) return null;
          left = left / right;
        } else {
          left = left * right;
        }
      } else {
        break;
      }
    }
    return left;
  };

  const parseUnary = (): number | null => {
    const next = peek();
    if (next && next.type === 'op' && (next.value === '+' || next.value === '-')) {
      consume();
      const val = parseUnary();
      if (val === null) return null;
      return next.value === '-' ? -val : val;
    }
    return parsePrimary();
  };

  const parsePrimary = (): number | null => {
    const next = peek();
    if (!next) return null;

    if (next.type === 'num') {
      consume();
      return next.value;
    }

    if (next.type === 'lparen') {
      consume();
      const val = parseExpression();
      if (val === null) return null;
      const close = peek();
      if (!close || close.type !== 'rparen') return null;
      consume();
      return val;
    }

    return null;
  };

  const result = parseExpression();
  if (result === null || pos !== tokens.length || !Number.isFinite(result)) {
    return null;
  }

  return roundMath(result);
}

/**
 * Formats a numeric value for display inside a formula-capable cell.
 */
export function numberToDraftString(val: number): string {
  if (!Number.isFinite(val) || val === 0) return '';
  return String(roundMath(val));
}
