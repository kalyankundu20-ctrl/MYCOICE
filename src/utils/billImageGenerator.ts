import { formatINRWhole } from '../engine/calculations';
import { SellerBillRow } from '../types/ledger';

export interface BillReceiptPayload {
  bill: SellerBillRow;
  dateStr: string;
  agencyName?: string;
}

let cachedLogoImg: HTMLImageElement | null = null;
let logoLoadPromise: Promise<HTMLImageElement | null> | null = null;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (src === '/kk-logo.png' && cachedLogoImg) {
    return Promise.resolve(cachedLogoImg);
  }
  if (src === '/kk-logo.png' && logoLoadPromise) {
    return logoLoadPromise;
  }
  const p = new Promise<HTMLImageElement | null>((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (src === '/kk-logo.png') cachedLogoImg = img;
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
  if (src === '/kk-logo.png') {
    logoLoadPromise = p;
  }
  return p;
}

if (typeof window !== 'undefined') {
  void loadImage('/kk-logo.png');
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function formatSignedCurrency(val: number, signMode: 'none' | 'minus' | 'plus' | 'auto'): string {
  const absStr = formatINRWhole(Math.abs(val));
  if (signMode === 'minus') return `-₹${absStr}`;
  if (signMode === 'plus') return `+₹${absStr}`;
  if (signMode === 'auto') {
    if (val < 0) return `-₹${absStr}`;
    return `₹${absStr}`;
  }
  return `₹${absStr}`;
}

/**
 * Renders a crisp 2x Retina executive digital bill receipt PNG on an offscreen canvas.
 * Zero external dependencies; works offline on iOS Safari, Android Chrome, and Desktop.
 */
export async function renderBillReceiptPngBlob(payload: BillReceiptPayload): Promise<Blob> {
  const { bill, dateStr, agencyName = 'KK AGENCY' } = payload;

  const scale = 2;
  const W = 440;
  const pad = 22;
  const cardX = 16;
  const cardY = 16;
  const cardW = W - cardX * 2;
  const innerX = cardX + pad;
  const innerW = cardW - pad * 2;

  const ledgerRows: Array<{
    label: string;
    value: string;
    color: string;
    bold?: boolean;
  }> = [
    {
      label: 'Gross Ticket Bill',
      value: formatSignedCurrency(bill.bill, 'auto'),
      color: '#0F172A',
      bold: true,
    },
  ];
  if (bill.prizeTotal > 0) {
    ledgerRows.push({
      label: 'Winning Prize Less (-)',
      value: formatSignedCurrency(bill.prizeTotal, 'minus'),
      color: '#047857',
      bold: true,
    });
  }
  ledgerRows.push({
    label: 'Fresh Bill Net (=)',
    value: formatSignedCurrency(bill.fresh, 'auto'),
    color: bill.fresh < 0 ? '#BE123C' : '#0F172A',
    bold: true,
  });
  if (bill.joma !== 0) {
    ledgerRows.push({
      label: 'Joma Received (-)',
      value: formatSignedCurrency(Math.abs(bill.joma), 'minus'),
      color: '#0369A1',
    });
  }
  if (bill.due !== 0) {
    ledgerRows.push({
      label: 'Previous Due (+)',
      value: formatSignedCurrency(Math.abs(bill.due), 'plus'),
      color: '#B45309',
    });
  }

  const maxPrizesShown = 18;
  const shownPrizes = bill.prizes.slice(0, maxPrizesShown);
  const extraPrizeCount = Math.max(0, bill.prizes.length - shownPrizes.length);
  const hasPrizes = shownPrizes.length > 0;

  // Dynamic height calculation
  const headerH = 126;
  const metaH = 62;
  const sessionsH = 98;
  const ledgerHeaderH = 26;
  const ledgerBodyH = ledgerRows.length * 32 + 12;
  const netBoxH = 74;
  const prizeSectionH = hasPrizes
    ? 34 + shownPrizes.length * 24 + (extraPrizeCount > 0 ? 22 : 0) + 18
    : 0;
  const footerH = 48;

  const cardH =
    headerH +
    metaH +
    sessionsH +
    ledgerHeaderH +
    ledgerBodyH +
    netBoxH +
    prizeSectionH +
    footerH;
  const H = cardH + cardY * 2;

  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.scale(scale, scale);

  const fontSans = '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const fontMono = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

  // Soft outer backdrop
  ctx.fillStyle = '#E8EEF8';
  ctx.fillRect(0, 0, W, H);

  // Main card with subtle drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(11, 30, 71, 0.16)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 8;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 20);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();

  // Clip inside card
  ctx.save();
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 20);
  ctx.clip();

  // 1. Deep Sapphire Executive Header
  const headerGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + headerH);
  headerGrad.addColorStop(0, '#0B1E47');
  headerGrad.addColorStop(0.58, '#133170');
  headerGrad.addColorStop(1, '#1D469E');
  ctx.fillStyle = headerGrad;
  ctx.fillRect(cardX, cardY, cardW, headerH);

  // Subtle decorative geometric accent rings (top-right corner)
  ctx.strokeStyle = 'rgba(212, 175, 55, 0.16)';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(cardX + cardW - 22, cardY + 26, 56, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cardX + cardW - 22, cardY + 26, 86, 0, Math.PI * 2);
  ctx.stroke();

  // Gold hairline accent along header bottom
  const goldGrad = ctx.createLinearGradient(cardX, 0, cardX + cardW, 0);
  goldGrad.addColorStop(0, '#B88928');
  goldGrad.addColorStop(0.5, '#F2D06B');
  goldGrad.addColorStop(1, '#B88928');
  ctx.fillStyle = goldGrad;
  ctx.fillRect(cardX, cardY + headerH - 3, cardW, 3);

  // Brand logo or monogram emblem
  const logoImg = await loadImage('/kk-logo.png');
  const logoSize = 46;
  const logoX = innerX;
  const logoY = cardY + 22;
  if (logoImg) {
    ctx.save();
    drawRoundedRect(ctx, logoX, logoY, logoSize, logoSize, 12);
    ctx.clip();
    ctx.drawImage(logoImg, logoX, logoY, logoSize, logoSize);
    ctx.restore();
    drawRoundedRect(ctx, logoX, logoY, logoSize, logoSize, 12);
    ctx.strokeStyle = 'rgba(242, 208, 107, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    drawRoundedRect(ctx, logoX, logoY, logoSize, logoSize, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(242, 208, 107, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#F2D06B';
    ctx.font = `800 18px ${fontSans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('KK', logoX + logoSize / 2, logoY + logoSize / 2 + 1);
  }

  // Brand Title & Subtitle
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 20px ${fontSans}`;
  ctx.fillText(agencyName, logoX + logoSize + 13, cardY + 24);

  ctx.fillStyle = '#F2D06B';
  ctx.font = `700 10.5px ${fontSans}`;
  ctx.fillText('OFFICIAL DAILY BILL STATEMENT', logoX + logoSize + 13, cardY + 50);

  // Subtle status caption inside header bottom row
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = `600 11px ${fontMono}`;
  ctx.fillText(`BILL DATE : ${dateStr}`, innerX, cardY + 86);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#E2E8F0';
  ctx.font = `700 11px ${fontMono}`;
  ctx.fillText(`SOLD : ${formatINRWhole(bill.sold)} PCS`, innerX + innerW, cardY + 86);

  let y = cardY + headerH;

  // 2. Party Name Bar
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(cardX, y, cardW, metaH);
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cardX, y + metaH);
  ctx.lineTo(cardX + cardW, y + metaH);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#64748B';
  ctx.font = `700 10px ${fontSans}`;
  ctx.fillText('PARTY / SELLER NAME', innerX, y + 13);

  ctx.fillStyle = '#0B1E47';
  ctx.font = `800 20px ${fontSans}`;
  ctx.fillText(bill.name.toUpperCase(), innerX, y + 29);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#64748B';
  ctx.font = `700 10px ${fontSans}`;
  ctx.fillText('STATUS', innerX + innerW, y + 13);

  const statusText = bill.total < 0 ? 'ADVANCE / CR' : bill.total === 0 ? 'SETTLED' : 'PAYABLE';
  ctx.fillStyle = bill.total < 0 ? '#047857' : bill.total === 0 ? '#334155' : '#1D4ED8';
  ctx.font = `800 13px ${fontSans}`;
  ctx.fillText(statusText, innerX + innerW, y + 33);

  y += metaH;

  // 3. Session Summary 4-Box Strip
  const boxGap = 8;
  const boxW = (innerW - boxGap * 3) / 4;
  const boxY = y + 14;
  const boxH = 68;
  const sessionBoxes = [
    { label: '1PM MOR', qty: bill.mor, prize: bill.amt1pm, accent: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
    { label: '6PM DAY', qty: bill.day, prize: bill.amt6pm, accent: '#0369A1', bg: '#F0F9FF', border: '#BAE6FD' },
    { label: '8PM EVE', qty: bill.eve, prize: bill.amt8pm, accent: '#6D28D9', bg: '#F5F3FF', border: '#DDD6FE' },
    { label: 'TOTAL', qty: bill.sold, prize: bill.prizeTotal, accent: '#0B1E47', bg: '#EEF4FF', border: '#C7D7FE' },
  ];

  sessionBoxes.forEach((sb, i) => {
    const bx = innerX + i * (boxW + boxGap);
    drawRoundedRect(ctx, bx, boxY, boxW, boxH, 10);
    ctx.fillStyle = sb.bg;
    ctx.fill();
    ctx.strokeStyle = sb.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = sb.accent;
    ctx.font = `800 9.5px ${fontSans}`;
    ctx.fillText(sb.label, bx + boxW / 2, boxY + 10);

    ctx.fillStyle = '#0F172A';
    ctx.font = `800 15px ${fontMono}`;
    ctx.fillText(formatINRWhole(sb.qty), bx + boxW / 2, boxY + 26);

    ctx.fillStyle = sb.prize > 0 ? '#047857' : '#94A3B8';
    ctx.font = `700 9.5px ${fontMono}`;
    ctx.fillText(sb.prize > 0 ? `₹${formatINRWhole(sb.prize)}` : '—', bx + boxW / 2, boxY + 48);
  });

  y += sessionsH;

  // 4. Account Ledger Section
  ctx.textAlign = 'left';
  ctx.fillStyle = '#64748B';
  ctx.font = `800 10.5px ${fontSans}`;
  ctx.fillText('ACCOUNT SETTLEMENT', innerX, y + 6);

  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(innerX, y + 22);
  ctx.lineTo(innerX + innerW, y + 22);
  ctx.stroke();

  y += ledgerHeaderH;

  ledgerRows.forEach((lr, idx) => {
    const rowY = y + idx * 32;
    ctx.textAlign = 'left';
    ctx.fillStyle = lr.bold ? '#0F172A' : '#475569';
    ctx.font = `${lr.bold ? 700 : 600} 13px ${fontSans}`;
    ctx.fillText(lr.label, innerX, rowY + 8);

    ctx.textAlign = 'right';
    ctx.fillStyle = lr.color;
    ctx.font = `800 13.5px ${fontMono}`;
    ctx.fillText(lr.value, innerX + innerW, rowY + 7);

    if (idx < ledgerRows.length - 1) {
      ctx.strokeStyle = '#F1F5F9';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(innerX, rowY + 31);
      ctx.lineTo(innerX + innerW, rowY + 31);
      ctx.stroke();
    }
  });

  y += ledgerBodyH;

  // 5. Net Payable Executive Banner
  const netGrad = ctx.createLinearGradient(innerX, y, innerX + innerW, y + 58);
  if (bill.total < 0) {
    netGrad.addColorStop(0, '#065F46');
    netGrad.addColorStop(1, '#047857');
  } else {
    netGrad.addColorStop(0, '#0B1E47');
    netGrad.addColorStop(1, '#1B449C');
  }
  drawRoundedRect(ctx, innerX, y, innerW, 58, 14);
  ctx.fillStyle = netGrad;
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = `700 10px ${fontSans}`;
  ctx.fillText(
    bill.total < 0 ? 'NET ADVANCE BALANCE' : bill.total === 0 ? 'ACCOUNT SETTLED' : 'NET PAYABLE AMOUNT',
    innerX + 16,
    y + 13
  );

  ctx.fillStyle = '#F2D06B';
  ctx.font = `700 10.5px ${fontSans}`;
  ctx.fillText(dateStr, innerX + 16, y + 31);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 22px ${fontMono}`;
  ctx.fillText(formatSignedCurrency(bill.total, 'auto'), innerX + innerW - 16, y + 17);

  y += netBoxH;

  // 6. Winning Prize Breakdown (if any)
  if (hasPrizes) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#047857';
    ctx.font = `800 10.5px ${fontSans}`;
    ctx.fillText(`WINNING PRIZE LIST (${bill.prizes.length})`, innerX, y + 2);

    ctx.strokeStyle = '#D1FAE5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(innerX, y + 19);
    ctx.lineTo(innerX + innerW, y + 19);
    ctx.stroke();

    let py = y + 26;
    shownPrizes.forEach((p) => {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#334155';
      ctx.font = `700 11.5px ${fontMono}`;
      const rankTag = p.item ? `${p.rank} · ${p.item}` : p.rank;
      ctx.fillText(`${p.time}  ${p.number}  ${rankTag}`, innerX, py);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#047857';
      ctx.font = `800 11.5px ${fontMono}`;
      ctx.fillText(`₹${formatINRWhole(p.total)}`, innerX + innerW, py);
      py += 24;
    });

    if (extraPrizeCount > 0) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#64748B';
      ctx.font = `600 10.5px ${fontSans}`;
      ctx.fillText(`+${extraPrizeCount} more winning entries`, innerX, py);
    }

    y += prizeSectionH;
  }

  // 7. Footer Stamp
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(cardX, y, cardW, footerH);
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cardX, y);
  ctx.lineTo(cardX + cardW, y);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748B';
  ctx.font = `600 10.5px ${fontSans}`;
  ctx.fillText(`Thank you for your business · ${agencyName}`, cardX + cardW / 2, y + 18);

  ctx.restore();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to generate PNG'));
    }, 'image/png');
  });
}

export function buildBillImageFilename(sellerName: string, dateStr: string): string {
  const safeName = sellerName.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-') || 'SELLER';
  const safeDate = dateStr.replace(/[^0-9-]+/g, '-');
  return `KK-Bill-${safeName}-${safeDate}.png`;
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function canNativeShareImageFiles(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };
  if (typeof nav.share !== 'function') return false;
  if (typeof nav.canShare !== 'function') return true;
  try {
    const probe = new File([new Uint8Array([137, 80, 78, 71])], 'probe.png', {
      type: 'image/png',
    });
    return nav.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export function buildDirectWhatsAppNumberUrl(mobile?: string): {
  url: string;
  deepLinkUrl: string;
  hasNumber: boolean;
  cleanNumber: string;
} {
  const digits = String(mobile || '').replace(/\D/g, '');
  let full = '';
  if (digits.length === 10) {
    full = `91${digits}`;
  } else if (digits.length >= 11) {
    full = digits;
  }
  if (full) {
    return {
      url: `https://wa.me/${full}`,
      deepLinkUrl: `whatsapp://send?phone=${full}`,
      hasNumber: true,
      cleanNumber: full,
    };
  }
  return {
    url: 'https://api.whatsapp.com/send',
    deepLinkUrl: 'whatsapp://send',
    hasNumber: false,
    cleanNumber: '',
  };
}

function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

function openExternalLinkSafe(url: string, sameWindow = false): void {
  const a = document.createElement('a');
  a.href = url;
  if (!sameWindow) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function copyBillCardImage(
  payload: BillReceiptPayload
): Promise<'copied' | 'downloaded'> {
  const filename = buildBillImageFilename(payload.bill.name, payload.dateStr);
  const blobPromise = renderBillReceiptPngBlob(payload);

  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  ) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
      return 'copied';
    } catch {
      try {
        const resolvedBlob = await blobPromise;
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': resolvedBlob })]);
        return 'copied';
      } catch {
        // Fallback to direct PNG download if clipboard image write is blocked
      }
    }
  }
  const blob = await blobPromise;
  triggerBlobDownload(blob, filename);
  return 'downloaded';
}

export interface DirectWhatsAppCardResult {
  method: 'copied_direct' | 'downloaded_direct';
  waUrl: string;
  hasNumber: boolean;
  sellerName: string;
}

/**
 * Directly copies the HD Bill Card PNG to clipboard (NO OS Share Sheet / option menu)
 * and immediately opens that Seller's exact WhatsApp chat (https://wa.me/<number>) with zero text.
 */
export async function sendBillCardDirectToWhatsApp(
  payload: BillReceiptPayload
): Promise<DirectWhatsAppCardResult> {
  const filename = buildBillImageFilename(payload.bill.name, payload.dateStr);
  const wa = buildDirectWhatsAppNumberUrl(payload.bill.mobile);
  const blobPromise = renderBillReceiptPngBlob(payload);

  let copied = false;
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  ) {
    // Pass Promise<Blob> synchronously inside the tap gesture so iOS Safari honors clipboard image write
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
      copied = true;
    } catch {
      try {
        const resolvedBlob = await blobPromise;
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': resolvedBlob })]);
        copied = true;
      } catch {
        copied = false;
      }
    }
  }

  if (!copied) {
    const resolvedBlob = await blobPromise;
    triggerBlobDownload(resolvedBlob, filename);
  }

  if (isMobileDevice()) {
    openExternalLinkSafe(wa.deepLinkUrl, true);
  } else {
    openExternalLinkSafe(wa.url, false);
  }

  return {
    method: copied ? 'copied_direct' : 'downloaded_direct',
    waUrl: wa.url,
    hasNumber: wa.hasNumber,
    sellerName: payload.bill.name,
  };
}

export type ShareBillCardResult =
  | 'shared'
  | 'cancelled'
  | 'copied_and_saved'
  | 'downloaded';

/**
 * Sends ONLY the HD Bill Card PNG image via native Share Sheet (optional fallback)
 * with zero text payload attached.
 */
export async function shareBillCardImage(
  payload: BillReceiptPayload
): Promise<ShareBillCardResult> {
  const blob = await renderBillReceiptPngBlob(payload);
  const filename = buildBillImageFilename(payload.bill.name, payload.dateStr);
  const file = new File([blob], filename, { type: 'image/png' });

  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };

  if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare({ files: [file] }))) {
    try {
      await nav.share({ files: [file] });
      return 'shared';
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'AbortError') return 'cancelled';
    }
  }

  let copiedToClipboard = false;
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.write === 'function' &&
      typeof ClipboardItem !== 'undefined'
    ) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      copiedToClipboard = true;
    }
  } catch {
    copiedToClipboard = false;
  }
  triggerBlobDownload(blob, filename);
  return copiedToClipboard ? 'copied_and_saved' : 'downloaded';
}
