import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCopy,
  Code2,
  FileSpreadsheet,
  ImagePlus,
  Loader2,
  ScanLine,
  Trash2,
  X,
} from 'lucide-react';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '../firebase';
import { SessionId, TicketEntryRow } from '../types/ledger';
import { AppSounds } from '../utils/sound';

export interface ScannedSlipRow {
  prefix: string;
  number: string;
  range: string;
}

interface QueuedSlipPhoto {
  id: string;
  name: string;
  previewUrl: string;
  mimeType: string;
  base64Data: string;
}

interface AdminSlipScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  isAdminSignedIn: boolean;
  sellerNames: string[];
  activeSession?: SessionId;
  onInsertIntoSession?: (
    sessionId: SessionId,
    rows: Array<Omit<TicketEntryRow, 'id'>>
  ) => void;
}

async function compressPhotoForOcr(
  file: File
): Promise<{ previewUrl: string; mimeType: string; base64Data: string }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image load failed'));
      el.src = objectUrl;
    });

    const maxEdge = 1800;
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const targetW = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const targetH = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas unavailable');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    const base64Data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return {
      previewUrl: objectUrl,
      mimeType: 'image/jpeg',
      base64Data,
    };
  } catch {
    // Fallback to raw FileReader base64 if canvas decode fails (e.g. HEIC)
    const rawDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });
    const base64Data = rawDataUrl.includes(',')
      ? rawDataUrl.slice(rawDataUrl.indexOf(',') + 1)
      : rawDataUrl;
    return {
      previewUrl: objectUrl,
      mimeType: file.type || 'image/jpeg',
      base64Data,
    };
  }
}

async function copyTextSafe(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function AdminSlipScannerModal({
  isOpen,
  onClose,
  isAdminSignedIn,
  sellerNames,
  activeSession = '1PM',
  onInsertIntoSession,
}: AdminSlipScannerModalProps) {
  const [photos, setPhotos] = useState<QueuedSlipPhoto[]>([]);
  const [rows, setRows] = useState<ScannedSlipRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copiedMode, setCopiedMode] = useState<'none' | 'tsv' | 'code'>('none');
  const [insertSellerName, setInsertSellerName] = useState('');
  const [insertedNotice, setInsertedNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photosRef = useRef<QueuedSlipPhoto[]>([]);
  photosRef.current = photos;

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      for (const p of photosRef.current) {
        try {
          URL.revokeObjectURL(p.previewUrl);
        } catch {
          // Ignore revoke errors
        }
      }
    };
  }, []);

  const rawTsv = useMemo(
    () => rows.map((r) => `${r.prefix}\t${r.number}\t${r.range}`).join('\n'),
    [rows]
  );

  const singleCodeBlock = useMemo(
    () => (rawTsv ? `\`\`\`text\n${rawTsv}\n\`\`\`` : ''),
    [rawTsv]
  );

  if (!isOpen) return null;

  const handleFilesSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setErrorMsg('');
    setInsertedNotice('');

    const selected = Array.from(fileList).slice(0, Math.max(0, 20 - photos.length));
    if (selected.length === 0) {
      setErrorMsg('Maximum 20 photos ek baar me add kar sakte hain.');
      e.target.value = '';
      return;
    }

    const prepared: QueuedSlipPhoto[] = [];
    for (let i = 0; i < selected.length; i += 1) {
      const f = selected[i];
      try {
        const compressed = await compressPhotoForOcr(f);
        prepared.push({
          id: `slip-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
          name: f.name || `Photo ${photos.length + i + 1}`,
          previewUrl: compressed.previewUrl,
          mimeType: compressed.mimeType,
          base64Data: compressed.base64Data,
        });
      } catch {
        setErrorMsg(`Photo "${f.name}" read nahi ho payi.`);
      }
    }

    if (prepared.length > 0) {
      AppSounds.tap();
      setPhotos((prev) => [...prev, ...prepared]);
    }
    e.target.value = '';
  };

  const movePhoto = (idx: number, dir: -1 | 1) => {
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= photos.length) return;
    AppSounds.tap();
    setPhotos((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  };

  const removePhoto = (id: string) => {
    AppSounds.tap();
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) {
        try {
          URL.revokeObjectURL(target.previewUrl);
        } catch {
          // Ignore
        }
      }
      return prev.filter((p) => p.id !== id);
    });
  };

  const handleClearAll = () => {
    AppSounds.tap();
    for (const p of photos) {
      try {
        URL.revokeObjectURL(p.previewUrl);
      } catch {
        // Ignore
      }
    }
    setPhotos([]);
    setRows([]);
    setErrorMsg('');
    setProgressText('');
    setCopiedMode('none');
    setInsertedNotice('');
  };

  const handleScanPhotos = async () => {
    if (scanning) return;
    if (photos.length === 0) {
      setErrorMsg('Pehle kam se kam 1 slip photo select karein.');
      return;
    }
    const user = auth.currentUser;
    if (!isAdminSignedIn || !user) {
      setErrorMsg('Admin Cloud account sign-in zaroori hai.');
      return;
    }

    AppSounds.tap();
    setScanning(true);
    setErrorMsg('');
    setCopiedMode('none');
    setInsertedNotice('');
    setRows([]);

    try {
      const idToken = await user.getIdToken();
      const BATCH_SIZE = 2;
      const accumulatedRows: ScannedSlipRow[] = [];
      let carriedPrefix = '';

      for (let start = 0; start < photos.length; start += BATCH_SIZE) {
        const slice = photos.slice(start, start + BATCH_SIZE);
        const fromNum = start + 1;
        const toNum = start + slice.length;
        setProgressText(
          photos.length === 1
            ? 'Scanning Photo 1 of 1...'
            : `Scanning Photo ${fromNum}${toNum > fromNum ? `–${toNum}` : ''} of ${photos.length}...`
        );

        const resp = await fetch('/api/admin/scan-slips', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            images: slice.map((p) => ({
              mimeType: p.mimeType,
              data: p.base64Data,
              name: p.name,
            })),
            initialPrefix: carriedPrefix,
            startIndex: fromNum,
            totalImages: photos.length,
          }),
        });

        const payload = (await resp.json().catch(() => ({}))) as {
          rows?: ScannedSlipRow[];
          lastPrefix?: string;
          error?: string;
        };

        if (!resp.ok) {
          throw new Error(payload.error || `Scan error (${resp.status})`);
        }

        if (Array.isArray(payload.rows) && payload.rows.length > 0) {
          accumulatedRows.push(...payload.rows);
          setRows([...accumulatedRows]);
        }
        if (payload.lastPrefix) {
          carriedPrefix = payload.lastPrefix;
        }
      }

      if (accumulatedRows.length === 0) {
        setErrorMsg('In photos me koi valid 5-digit ticket line nahi mili. Clear photo upload karein.');
      } else {
        AppSounds.success();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Scan fail ho gaya. Dubara try karein.');
    } finally {
      setScanning(false);
      setProgressText('');
    }
  };

  const handleCopyTsv = async () => {
    if (!rawTsv) return;
    const ok = await copyTextSafe(rawTsv);
    if (ok) {
      AppSounds.success();
      setCopiedMode('tsv');
      window.setTimeout(() => setCopiedMode('none'), 2200);
    }
  };

  const handleCopyCodeBlock = async () => {
    if (!singleCodeBlock) return;
    const ok = await copyTextSafe(singleCodeBlock);
    if (ok) {
      AppSounds.success();
      setCopiedMode('code');
      window.setTimeout(() => setCopiedMode('none'), 2200);
    }
  };

  const handleInsertToLedger = (targetSession: SessionId) => {
    if (!onInsertIntoSession || rows.length === 0) return;
    const cleanName = insertSellerName.trim().toUpperCase();
    const mapped: Array<Omit<TicketEntryRow, 'id'>> = rows.map((r, idx) => ({
      name: idx === 0 ? cleanName : '',
      item: r.prefix,
      start: r.number,
      end: r.range,
      qtyOverride: '',
      rangeOverride: '',
    }));
    onInsertIntoSession(targetSession, mapped);
    AppSounds.success();
    setInsertedNotice(`${rows.length} rows added to ${targetSession} sheet ✓`);
    window.setTimeout(() => setInsertedNotice(''), 3500);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/65 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Admin Photo Slip Scanner"
    >
      <div className="w-full sm:max-w-2xl max-h-[94dvh] bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="kk-brand-gradient text-white px-4 py-3.5 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-cyan-400/20 border border-cyan-300/40 flex items-center justify-center shrink-0">
              <ScanLine className="w-5 h-5 text-cyan-200" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-extrabold tracking-tight leading-tight truncate">
                Slip Photo Extractor
              </h2>
              <p className="text-[11px] text-white/80 font-medium truncate">
                Admin Only · 3-Column Tab Format (M Prefix · 5-Digit · Range)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              AppSounds.tap();
              onClose();
            }}
            aria-label="Close scanner"
            className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center text-white cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 bg-slate-50/70">
          {/* Upload Controls */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5 shadow-2xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-extrabold text-slate-900">
                  1. Slip Photos Upload Karein (Sequence #1 → Last)
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Multi-photo select karein · Order adjust kar sakte hain
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {photos.length > 0 && (
                  <button
                    type="button"
                    disabled={scanning}
                    onClick={handleClearAll}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={scanning || photos.length >= 20}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl kk-brand-gradient text-white text-xs font-extrabold shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>{photos.length > 0 ? 'Add Photos' : 'Select Photos'}</span>
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFilesSelected}
                className="hidden"
              />
            </div>

            {photos.length === 0 ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-7 px-4 rounded-xl border-2 border-dashed border-slate-300 hover:border-cyan-500 hover:bg-cyan-50/40 transition-colors flex flex-col items-center justify-center gap-2 text-center cursor-pointer"
              >
                <ImagePlus className="w-7 h-7 text-slate-400" />
                <div className="text-xs font-bold text-slate-700">
                  Tap karke 1 ya zyada Slip Photos chunein
                </div>
                <div className="text-[11px] text-slate-500">
                  Auto: M5/M10/M15/M20 Prefix · 5-Digit · Range · BOX/BOOK/=50ps Excluded
                </div>
              </button>
            ) : (
              <div className="flex gap-2.5 overflow-x-auto pb-1">
                {photos.map((photo, idx) => (
                  <div
                    key={photo.id}
                    className="relative w-24 shrink-0 rounded-xl border border-slate-200 bg-slate-100 overflow-hidden shadow-2xs"
                  >
                    <div className="relative h-24 w-full bg-slate-900/5">
                      <img
                        src={photo.previewUrl}
                        alt={`Photo ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-slate-900/80 text-white text-[10px] font-extrabold font-mono-tabular">
                        #{idx + 1}
                      </span>
                      <button
                        type="button"
                        disabled={scanning}
                        onClick={() => removePhoto(photo.id)}
                        aria-label={`Remove photo ${idx + 1}`}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-xs cursor-pointer disabled:opacity-50"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between bg-white border-t border-slate-200 px-1 py-1">
                      <button
                        type="button"
                        disabled={scanning || idx === 0}
                        onClick={() => movePhoto(idx, -1)}
                        aria-label="Move left"
                        className="p-0.5 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-[10px] font-bold text-slate-500 truncate px-0.5">
                        P{idx + 1}
                      </span>
                      <button
                        type="button"
                        disabled={scanning || idx === photos.length - 1}
                        onClick={() => movePhoto(idx, 1)}
                        aria-label="Move right"
                        className="p-0.5 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              disabled={scanning || photos.length === 0}
              onClick={handleScanPhotos}
              className="w-full py-2.5 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-extrabold flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              {scanning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{progressText || 'Scanning Photos...'}</span>
                </>
              ) : (
                <>
                  <ScanLine className="w-4 h-4" />
                  <span>
                    Extract 3-Column Data ({photos.length} Photo{photos.length === 1 ? '' : 's'})
                  </span>
                </>
              )}
            </button>
          </div>

          {errorMsg && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-800 px-3.5 py-2.5 text-xs font-bold">
              {errorMsg}
            </div>
          )}

          {/* Output Area — Clean Single Code Block */}
          {singleCodeBlock && (
            <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5 shadow-2xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-extrabold text-slate-900">
                  Extracted Output ({rows.length} Line{rows.length === 1 ? '' : 's'} · Tab Separated)
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleCopyTsv}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-xs cursor-pointer"
                  >
                    {copiedMode === 'tsv' ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied for Excel/Sheets!</span>
                      </>
                    ) : (
                      <>
                        <ClipboardCopy className="w-3.5 h-3.5" />
                        <span>Copy Excel / Sheets</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyCodeBlock}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold cursor-pointer"
                  >
                    {copiedMode === 'code' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Code2 className="w-3.5 h-3.5" />
                        <span>Copy ```text</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <pre className="w-full max-h-72 overflow-auto rounded-xl bg-slate-950 text-emerald-300 p-3.5 text-xs font-mono leading-relaxed select-all whitespace-pre border border-slate-800">
                {singleCodeBlock}
              </pre>

              {onInsertIntoSession && (
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <div className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Direct KK Agency Sheet me Add Karein (Optional):</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      list="kk-scanner-seller-list"
                      value={insertSellerName}
                      onChange={(e) => setInsertSellerName(e.target.value)}
                      placeholder="Seller Name (optional)"
                      className="flex-1 min-w-[140px] h-9 px-3 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                    <datalist id="kk-scanner-seller-list">
                      {sellerNames.map((n) => (
                        <option key={n} value={n} />
                      ))}
                    </datalist>
                    {(['1PM', '6PM', '8PM'] as SessionId[]).map((sid) => (
                      <button
                        key={sid}
                        type="button"
                        onClick={() => handleInsertToLedger(sid)}
                        className={`h-9 px-3 rounded-xl text-xs font-extrabold cursor-pointer transition-colors ${
                          sid === activeSession
                            ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs'
                            : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200'
                        }`}
                      >
                        + {sid}
                      </button>
                    ))}
                  </div>
                  {insertedNotice && (
                    <div className="text-xs font-extrabold text-emerald-700">{insertedNotice}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
