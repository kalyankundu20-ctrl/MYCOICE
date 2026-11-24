import { Check, CheckCheck, Copy, Download, ExternalLink, Loader2, Send, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Fragment, useEffect, useState } from 'react';
import { formatINRWhole } from '../engine/calculations';
import {
  BillReceiptPayload,
  buildBillImageFilename,
  copyBillCardImage,
  renderBillReceiptPngBlob,
  sendBillCardDirectToWhatsApp,
  triggerBlobDownload,
} from '../utils/billImageGenerator';
import { AppSounds } from '../utils/sound';

interface MessagePreviewModalProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  message: string;
  waUrl: string;
  billData?: BillReceiptPayload;
  onClose: () => void;
}

/**
 * Safely renders WhatsApp inline formatting (*bold*, _italic_) into React elements without HTML injection.
 */
function renderWhatsAppInline(line: string) {
  const tokens: Array<{ type: 'text' | 'bold' | 'italic'; value: string }> = [];
  const regex = /(\*[^*\n]+\*|_[^_\n]+_)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIdx) {
      tokens.push({ type: 'text', value: line.slice(lastIdx, match.index) });
    }
    const raw = match[0];
    if (raw.startsWith('*') && raw.endsWith('*')) {
      tokens.push({ type: 'bold', value: raw.slice(1, -1) });
    } else if (raw.startsWith('_') && raw.endsWith('_')) {
      tokens.push({ type: 'italic', value: raw.slice(1, -1) });
    }
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < line.length) {
    tokens.push({ type: 'text', value: line.slice(lastIdx) });
  }
  return tokens.map((tok, i) => {
    if (tok.type === 'bold') {
      return (
        <strong key={i} className="font-extrabold text-slate-950">
          {tok.value}
        </strong>
      );
    }
    if (tok.type === 'italic') {
      return (
        <em key={i} className="italic text-slate-600">
          {tok.value}
        </em>
      );
    }
    return <Fragment key={i}>{tok.value}</Fragment>;
  });
}

function WhatsAppBubblePreview({ message }: { message: string }) {
  const blocks: Array<{ kind: 'text' | 'mono'; lines: string[] }> = [];
  const rawLines = message.split('\n');
  let inMono = false;
  let buf: string[] = [];

  for (const line of rawLines) {
    if (line.trim() === '```') {
      if (buf.length > 0) {
        blocks.push({ kind: inMono ? 'mono' : 'text', lines: buf });
        buf = [];
      }
      inMono = !inMono;
    } else {
      buf.push(line);
    }
  }
  if (buf.length > 0) {
    blocks.push({ kind: inMono ? 'mono' : 'text', lines: buf });
  }

  return (
    <div className="rounded-2xl bg-[#EAE4DA] p-3 sm:p-4 border border-slate-200/80 max-h-[54vh] overflow-y-auto">
      <div className="ml-auto max-w-[340px] bg-[#E7FFDB] border border-[#CBE8BD] rounded-2xl rounded-tr-sm px-3.5 py-2.5 shadow-xs text-[12.5px] leading-[1.45] text-slate-900">
        {blocks.map((block, bIdx) =>
          block.kind === 'mono' ? (
            <pre
              key={bIdx}
              className="my-1 px-2.5 py-2 rounded-lg bg-white/75 border border-emerald-900/10 font-mono-tabular text-[11px] leading-[1.5] text-slate-900 overflow-x-auto whitespace-pre"
            >
              {block.lines.join('\n')}
            </pre>
          ) : (
            <div key={bIdx} className="space-y-0.5">
              {block.lines.map((ln, lIdx) =>
                ln.trim() === '' ? (
                  <div key={lIdx} className="h-1.5" />
                ) : (
                  <div key={lIdx} className="break-words">
                    {renderWhatsAppInline(ln)}
                  </div>
                )
              )}
            </div>
          )
        )}
        <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px] font-mono-tabular text-slate-500">
          <span>WhatsApp</span>
          <CheckCheck className="w-3.5 h-3.5 text-sky-600" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function VisualBillReceiptCard({ billData }: { billData: BillReceiptPayload }) {
  const { bill, dateStr, agencyName = 'KK AGENCY' } = billData;
  const isAdvance = bill.total < 0;
  const isSettled = bill.total === 0;
  const statusLabel = isAdvance ? 'Advance / Credit' : isSettled ? 'Settled' : 'Payable';
  const formatSigned = (val: number, sign?: '+' | '-') => {
    const abs = formatINRWhole(Math.abs(val));
    if (sign === '-') return `-₹${abs}`;
    if (sign === '+') return `+₹${abs}`;
    return val < 0 ? `-₹${abs}` : `₹${abs}`;
  };

  return (
    <div className="max-h-[56vh] overflow-y-auto rounded-2xl bg-slate-100/90 p-2.5 sm:p-3.5 border border-slate-200/80">
      <div className="mx-auto max-w-[390px] bg-white rounded-2xl overflow-hidden border border-slate-200/90 shadow-md">
        {/* Executive Sapphire & Gold Header */}
        <div className="relative kk-brand-gradient text-white px-4 pt-4 pb-3.5 border-b-[3px] border-amber-400/90">
          <div className="flex items-center gap-3">
            <img
              src="/kk-logo.png"
              alt={agencyName}
              referrerPolicy="no-referrer"
              className="w-11 h-11 rounded-xl object-cover shrink-0 ring-1 ring-amber-300/60 shadow-sm bg-white/10"
            />
            <div className="min-w-0 flex-1">
              <div className="text-base font-black tracking-tight leading-tight text-white">
                {agencyName}
              </div>
              <div className="text-[10px] font-bold tracking-[0.14em] uppercase text-amber-300 mt-0.5">
                Official Daily Bill Statement
              </div>
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-white/15 flex items-center justify-between text-[11px] font-mono-tabular text-indigo-100">
            <span>Date: {dateStr}</span>
            <span className="font-bold text-white">Sold: {formatINRWhole(bill.sold)} pcs</span>
          </div>
        </div>

        {/* Party Header Strip */}
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200/80 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Party / Seller
            </div>
            <div className="text-lg font-black tracking-tight text-[var(--kk-brand)] truncate">
              {bill.name}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Balance Status
            </div>
            <div
              className={`text-xs font-extrabold ${
                isAdvance ? 'text-emerald-700' : isSettled ? 'text-slate-600' : 'text-blue-700'
              }`}
            >
              {statusLabel}
            </div>
          </div>
        </div>

        {/* 4-Column Session Breakdown */}
        <div className="px-4 pt-3.5 pb-2">
          <div className="grid grid-cols-4 gap-1.5 text-center font-mono-tabular">
            <div className="rounded-xl bg-amber-50/80 border border-amber-200/80 py-2 px-1">
              <div className="font-sans text-[9.5px] font-extrabold text-amber-800">1PM MOR</div>
              <div className="text-sm font-black text-slate-950 mt-0.5">{formatINRWhole(bill.mor)}</div>
              <div className="text-[9.5px] font-bold text-emerald-700">
                {bill.amt1pm > 0 ? `₹${formatINRWhole(bill.amt1pm)}` : '—'}
              </div>
            </div>
            <div className="rounded-xl bg-sky-50/80 border border-sky-200/80 py-2 px-1">
              <div className="font-sans text-[9.5px] font-extrabold text-sky-800">6PM DAY</div>
              <div className="text-sm font-black text-slate-950 mt-0.5">{formatINRWhole(bill.day)}</div>
              <div className="text-[9.5px] font-bold text-emerald-700">
                {bill.amt6pm > 0 ? `₹${formatINRWhole(bill.amt6pm)}` : '—'}
              </div>
            </div>
            <div className="rounded-xl bg-violet-50/80 border border-violet-200/80 py-2 px-1">
              <div className="font-sans text-[9.5px] font-extrabold text-violet-800">8PM EVE</div>
              <div className="text-sm font-black text-slate-950 mt-0.5">{formatINRWhole(bill.eve)}</div>
              <div className="text-[9.5px] font-bold text-emerald-700">
                {bill.amt8pm > 0 ? `₹${formatINRWhole(bill.amt8pm)}` : '—'}
              </div>
            </div>
            <div className="rounded-xl bg-indigo-50/90 border border-indigo-200/90 py-2 px-1">
              <div className="font-sans text-[9.5px] font-extrabold text-[var(--kk-brand)]">TOTAL</div>
              <div className="text-sm font-black text-[var(--kk-brand)] mt-0.5">
                {formatINRWhole(bill.sold)}
              </div>
              <div className="text-[9.5px] font-bold text-emerald-700">
                {bill.prizeTotal > 0 ? `₹${formatINRWhole(bill.prizeTotal)}` : '—'}
              </div>
            </div>
          </div>
        </div>

        {/* Account Settlement Ledger */}
        <div className="px-4 py-2.5">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 pb-1.5 border-b border-slate-200">
            Account Settlement
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            <div className="py-2 flex items-center justify-between">
              <span className="font-bold text-slate-800">Gross Ticket Bill</span>
              <span className="font-mono-tabular font-extrabold text-slate-950">
                {formatSigned(bill.bill)}
              </span>
            </div>
            {bill.prizeTotal > 0 && (
              <div className="py-2 flex items-center justify-between">
                <span className="font-bold text-emerald-800">Winning Prize Less (-)</span>
                <span className="font-mono-tabular font-extrabold text-emerald-700">
                  {formatSigned(bill.prizeTotal, '-')}
                </span>
              </div>
            )}
            <div className="py-2 flex items-center justify-between">
              <span className="font-bold text-slate-800">Fresh Bill Net (=)</span>
              <span
                className={`font-mono-tabular font-extrabold ${
                  bill.fresh < 0 ? 'text-rose-700' : 'text-slate-950'
                }`}
              >
                {formatSigned(bill.fresh)}
              </span>
            </div>
            {bill.joma !== 0 && (
              <div className="py-2 flex items-center justify-between">
                <span className="font-semibold text-slate-600">Joma Received (-)</span>
                <span className="font-mono-tabular font-extrabold text-sky-700">
                  {formatSigned(Math.abs(bill.joma), '-')}
                </span>
              </div>
            )}
            {bill.due !== 0 && (
              <div className="py-2 flex items-center justify-between">
                <span className="font-semibold text-slate-600">Previous Due (+)</span>
                <span className="font-mono-tabular font-extrabold text-amber-700">
                  {formatSigned(Math.abs(bill.due), '+')}
                </span>
              </div>
            )}
          </div>

          {/* Net Payable Hero Strip */}
          <div
            className={`mt-2.5 rounded-xl px-3.5 py-3 text-white flex items-center justify-between gap-2 ${
              isAdvance
                ? 'bg-gradient-to-r from-emerald-800 to-emerald-700'
                : 'kk-brand-gradient'
            }`}
          >
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/75">
                {isAdvance ? 'Net Advance Balance' : isSettled ? 'Account Settled' : 'Net Payable Amount'}
              </div>
              <div className="text-[11px] font-semibold text-amber-300 mt-0.5">{dateStr}</div>
            </div>
            <div className="text-xl font-black font-mono-tabular tracking-tight">
              {formatSigned(bill.total)}
            </div>
          </div>

          {/* Winning Prize Breakdown */}
          {bill.prizes.length > 0 && (
            <div className="mt-3 pt-2.5 border-t border-emerald-200/80">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800 mb-1.5">
                Winning Prizes ({bill.prizes.length})
              </div>
              <div className="space-y-1 font-mono-tabular text-[11px]">
                {bill.prizes.map((p, idx) => (
                  <div
                    key={`${p.time}-${p.number}-${idx}`}
                    className="flex items-center justify-between gap-2 text-slate-700"
                  >
                    <span className="truncate">
                      <span className="font-bold text-slate-900">{p.time}</span> {p.number}{' '}
                      <span className="text-slate-500">
                        {p.rank}
                        {p.item ? ` · ${p.item}` : ''}
                      </span>
                    </span>
                    <span className="font-extrabold text-emerald-700 shrink-0">
                      ₹{formatINRWhole(p.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200/80 text-center text-[10.5px] font-semibold text-slate-500">
          Thank you for your business · {agencyName}
        </div>
      </div>
    </div>
  );
}

export function MessagePreviewModal({
  isOpen,
  title,
  subtitle,
  message,
  waUrl,
  billData,
  onClose,
}: MessagePreviewModalProps) {
  const [copied, setCopied] = useState(false);
  const [imageBusy, setImageBusy] = useState<'share' | 'copy' | 'download' | null>(null);
  const [imageNote, setImageNote] = useState('');

  useEffect(() => {
    if (isOpen) {
      setImageNote('');
      setCopied(false);
    }
  }, [isOpen, billData]);

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(message);
      AppSounds.success();
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const el = document.createElement('textarea');
      el.value = message;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      AppSounds.success();
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleCopyCardImage = async () => {
    if (!billData || imageBusy) return;
    setImageBusy('copy');
    setImageNote('');
    try {
      const outcome = await copyBillCardImage(billData);
      AppSounds.success();
      if (outcome === 'copied') {
        setCopied(true);
        setImageNote('Bill Card image copied — WhatsApp chat me direct paste karein.');
        setTimeout(() => setCopied(false), 1800);
      } else {
        setImageNote('HD Bill Card PNG saved — WhatsApp me send kar dein.');
      }
    } catch {
      setImageNote('Card copy nahi ho saka. Save PNG use karein.');
    } finally {
      setImageBusy(null);
    }
  };

  const handleShareBillImage = async () => {
    if (!billData || imageBusy) return;
    setImageBusy('share');
    setImageNote('');
    try {
      const result = await sendBillCardDirectToWhatsApp(billData);
      AppSounds.success();
      if (result.method === 'copied_direct') {
        setCopied(true);
        setImageNote(
          result.hasNumber
            ? `${result.sellerName} ka Bill Card copy ho gaya — WhatsApp chat me bas Paste → Send karein.`
            : `${result.sellerName} ka Bill Card copy ho gaya — WhatsApp me chat chunein aur Paste → Send karein.`
        );
        setTimeout(() => setCopied(false), 2200);
      } else {
        setImageNote('HD Bill Card PNG save ho gaya — WhatsApp chat me attach karke bhej dein.');
      }
    } catch {
      setImageNote('Card share nahi ho saka. Save PNG ya Copy Card use karein.');
    } finally {
      setImageBusy(null);
    }
  };

  const handleDownloadBillImage = async () => {
    if (!billData || imageBusy) return;
    setImageBusy('download');
    setImageNote('');
    try {
      const blob = await renderBillReceiptPngBlob(billData);
      const filename = buildBillImageFilename(billData.bill.name, billData.dateStr);
      triggerBlobDownload(blob, filename);
      AppSounds.success();
      setImageNote('HD Bill Card PNG downloaded.');
    } catch {
      setImageNote('PNG download failed.');
    } finally {
      setImageBusy(null);
    }
  };

  const resolvedWaUrl =
    waUrl || `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="preview-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-[2px] p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wa-preview-title"
        >
          <motion.div
            key="preview-card"
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3.5 kk-brand-gradient text-white shrink-0">
              <div className="min-w-0">
                <h2 id="wa-preview-title" className="text-sm sm:text-base font-extrabold truncate">
                  {title}
                </h2>
                {subtitle && (
                  <p className="text-xs text-white/80 truncate mt-0.5">{subtitle}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  onClose();
                }}
                aria-label="Close preview"
                className="w-9 h-9 inline-flex items-center justify-center rounded-xl hover:bg-white/15 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-3.5 sm:p-5 space-y-3 overflow-y-auto">
              {billData ? (
                <VisualBillReceiptCard billData={billData} />
              ) : (
                <WhatsAppBubblePreview message={message} />
              )}

              {imageNote && (
                <div className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                  {imageNote}
                </div>
              )}

              {/* Action Bar */}
              {billData ? (
                <div className="pt-1 flex flex-wrap items-center justify-end gap-2">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    disabled={imageBusy !== null}
                    onClick={() => void handleDownloadBillImage()}
                    className="inline-flex items-center justify-center gap-1.5 h-10 px-3 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
                  >
                    {imageBusy === 'download' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>Save PNG</span>
                  </motion.button>

                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    disabled={imageBusy !== null}
                    onClick={() => void handleCopyCardImage()}
                    className="inline-flex items-center justify-center gap-1.5 h-10 px-3 text-xs font-bold text-[var(--kk-brand)] bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
                  >
                    {imageBusy === 'copy' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : copied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copied ? 'Card Copied' : 'Copy Card'}</span>
                  </motion.button>

                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    disabled={imageBusy !== null}
                    onClick={() => void handleShareBillImage()}
                    className="inline-flex items-center justify-center gap-1.5 h-10 px-4 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
                  >
                    {imageBusy === 'share' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>{imageBusy === 'share' ? 'Opening...' : 'Direct WhatsApp'}</span>
                  </motion.button>
                </div>
              ) : (
                <div className="pt-1 flex flex-wrap items-center justify-end gap-2">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    onClick={handleCopyText}
                    className="inline-flex items-center justify-center gap-1.5 h-10 px-3.5 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Text</span>
                      </>
                    )}
                  </motion.button>

                  <a
                    href={resolvedWaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => AppSounds.success()}
                    className="inline-flex items-center justify-center gap-1.5 h-10 px-4 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors whitespace-nowrap"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open WhatsApp</span>
                  </a>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
