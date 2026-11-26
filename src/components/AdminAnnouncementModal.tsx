import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  EyeOff,
  ImagePlus,
  Megaphone,
  RefreshCw,
  Send,
  ShieldCheck,
  Smile,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  sanitizeAnnouncementImageDataUrl,
  type CloudAnnouncementKind,
  type CloudPublicAnnouncement,
} from '../services/cloudSync';
import { AppSounds } from '../utils/sound';
import { AnnouncementBanner } from './AnnouncementBanner';

interface AdminAnnouncementModalProps {
  isOpen: boolean;
  onClose: () => void;
  isAdminSignedIn: boolean;
  announcement: CloudPublicAnnouncement | null;
  busy: boolean;
  error: string;
  onAdminSignIn: () => Promise<void>;
  onSaveAnnouncement: (input: {
    active: boolean;
    kind: CloudAnnouncementKind;
    title: string;
    message: string;
    imageDataUrl?: string;
  }) => Promise<void>;
}

const QUICK_EMOJIS = [
  '🎉',
  '🔥',
  '💰',
  '🎁',
  '🚨',
  '📢',
  '⏰',
  '✅',
  '🏆',
  '🌟',
  '🙏',
  '📞',
  '💥',
  '⭐',
  '🪔',
  '🎊',
  '❤️',
  '👍',
  '🎯',
  '📣',
  '🤑',
  '⚡',
  '📅',
  '🔔',
];

const QUICK_TEMPLATES: Array<{
  label: string;
  kind: CloudAnnouncementKind;
  title: string;
  message: string;
}> = [
  {
    label: '🎉 Special Offer',
    kind: 'offer',
    title: '🎉 Special Offer — KK Agency 🔥',
    message:
      'Aaj ke special offer ka fayda uthayein! 💰 Zyada jankari ke liye Admin se contact karein. 📞',
  },
  {
    label: '🚨 Urgent Alert',
    kind: 'urgent',
    title: '🚨 Urgent Notice — Timing Update ⏰',
    message:
      'Sabhi Master & Sub-Master dhyan dein: aaj ki entry samay se pehle submit kar dein. ✅',
  },
  {
    label: '📢 Holiday Notice',
    kind: 'notice',
    title: '📢 Important Agency Notice 📅',
    message:
      'Aaj ka schedule update ho gaya hai. Kripya apna bill aur sheet regular check karein. 🙏',
  },
];

// Keep compressed photo small (~40–85 KB base64) so it loads instantly on mobile
// and stays ultra-cheap on Firebase Spark Free Tier daily read units.
const TARGET_IMAGE_DATA_URL_CHARS = 92000;
const HARD_MAX_IMAGE_DATA_URL_CHARS = 152000;

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Photo read nahi ho paya. Koi JPEG ya PNG photo chunein.'));
    img.src = src;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Photo load nahi ho paya.'));
      }
    };
    reader.onerror = () => reject(new Error('Photo read karne me problem aayi.'));
    reader.readAsDataURL(file);
  });
}

async function compressAnnouncementPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Kripya sirf Image / Photo file chunein (JPG, PNG, WebP).');
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('Photo bahut bada hai (20 MB limit). Chhota photo chunein.');
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadImageElement(rawDataUrl);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) {
    throw new Error('Valid photo nahi mil paya. Doosra photo try karein.');
  }

  const attempts: Array<{ maxSide: number; quality: number }> = [
    { maxSide: 720, quality: 0.72 },
    { maxSide: 640, quality: 0.62 },
    { maxSide: 540, quality: 0.54 },
    { maxSide: 440, quality: 0.46 },
    { maxSide: 360, quality: 0.42 },
  ];

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser photo compress support nahi kar raha.');
  }

  let bestDataUrl = '';
  for (const step of attempts) {
    const scale = Math.min(1, step.maxSide / Math.max(srcW, srcH));
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));
    canvas.width = targetW;
    canvas.height = targetH;
    // White background so transparent PNGs convert cleanly to JPEG
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const encoded = canvas.toDataURL('image/jpeg', step.quality);
    bestDataUrl = encoded;
    if (encoded.length <= TARGET_IMAGE_DATA_URL_CHARS) {
      break;
    }
  }

  const sanitized = sanitizeAnnouncementImageDataUrl(bestDataUrl);
  if (!sanitized || sanitized.length > HARD_MAX_IMAGE_DATA_URL_CHARS) {
    throw new Error('Photo size zyada bada hai. Kripya koi chhota ya crop kiya hua photo chunein.');
  }
  return sanitized;
}

function estimateDataUrlKB(dataUrl: string): number {
  if (!dataUrl) return 0;
  const commaIdx = dataUrl.indexOf(',');
  const b64Len = commaIdx >= 0 ? dataUrl.length - commaIdx - 1 : dataUrl.length;
  return Math.max(1, Math.round((b64Len * 0.75) / 1024));
}

export function AdminAnnouncementModal({
  isOpen,
  onClose,
  isAdminSignedIn,
  announcement,
  busy,
  error,
  onAdminSignIn,
  onSaveAnnouncement,
}: AdminAnnouncementModalProps) {
  const [kind, setKind] = useState<CloudAnnouncementKind>('offer');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const [activeField, setActiveField] = useState<'title' | 'message'>('message');
  const [localError, setLocalError] = useState('');

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLocalError('');
    if (announcement) {
      setKind(announcement.kind || 'offer');
      setTitle(announcement.title || '');
      setMessage(announcement.message || '');
      setImageDataUrl(sanitizeAnnouncementImageDataUrl(announcement.imageDataUrl));
    } else {
      setKind('offer');
      setTitle('');
      setMessage('');
      setImageDataUrl('');
    }
  }, [isOpen, announcement]);

  const isCurrentlyLive = Boolean(
    announcement?.active &&
      (announcement.title.trim() || announcement.message.trim() || Boolean(announcement.imageDataUrl))
  );
  const hasContent = Boolean(title.trim() || message.trim() || imageDataUrl);

  const handleInsertEmoji = (emoji: string) => {
    AppSounds.tap();
    setLocalError('');
    if (activeField === 'title') {
      const el = titleInputRef.current;
      const start = el?.selectionStart ?? title.length;
      const end = el?.selectionEnd ?? title.length;
      const next = (title.slice(0, start) + emoji + title.slice(end)).slice(0, 120);
      setTitle(next);
      requestAnimationFrame(() => {
        if (!el) return;
        const pos = Math.min(next.length, start + emoji.length);
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    } else {
      const el = messageInputRef.current;
      const start = el?.selectionStart ?? message.length;
      const end = el?.selectionEnd ?? message.length;
      const next = (message.slice(0, start) + emoji + message.slice(end)).slice(0, 1000);
      setMessage(next);
      requestAnimationFrame(() => {
        if (!el) return;
        const pos = Math.min(next.length, start + emoji.length);
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    }
  };

  const handlePhotoSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLocalError('');
    setImageBusy(true);
    try {
      const compressed = await compressAnnouncementPhoto(file);
      setImageDataUrl(compressed);
      AppSounds.success();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Photo add karne me problem aayi.');
    } finally {
      setImageBusy(false);
    }
  };

  const handlePublish = async () => {
    if (!hasContent) {
      setLocalError('Kripya Headline, Message ya Photo me se kam se kam ek add karein.');
      return;
    }
    setLocalError('');
    AppSounds.tap();
    await onSaveAnnouncement({
      active: true,
      kind,
      title: title.trim(),
      message: message.trim(),
      imageDataUrl,
    });
  };

  const handlePause = async () => {
    setLocalError('');
    AppSounds.tap();
    await onSaveAnnouncement({
      active: false,
      kind,
      title: title.trim(),
      message: message.trim(),
      imageDataUrl,
    });
  };

  const handleClear = async () => {
    setLocalError('');
    AppSounds.remove();
    setTitle('');
    setMessage('');
    setImageDataUrl('');
    await onSaveAnnouncement({
      active: false,
      kind: 'offer',
      title: '',
      message: '',
      imageDataUrl: '',
    });
  };

  const displayError = localError || error;
  const imageKB = estimateDataUrlKB(imageDataUrl);

  if (!isOpen) return null;

  return (
    <div
      onClick={() => {
        AppSounds.tap();
        onClose();
      }}
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-end sm:items-center justify-center pt-[max(3.25rem,calc(env(safe-area-inset-top)+0.75rem))] px-0 pb-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ad-modal-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="kk-modal-in w-full sm:max-w-lg max-h-full sm:max-h-[86dvh] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="kk-brand-gradient text-white px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-amber-400/20 text-amber-300 ring-1 ring-amber-300/40 flex items-center justify-center shrink-0">
              <Megaphone className="w-4.5 h-4.5" />
            </span>
            <div className="min-w-0">
              <h2 id="ad-modal-title" className="text-sm sm:text-base font-extrabold tracking-tight truncate">
                Advertisement &amp; Urgent Message
              </h2>
              <p className="text-[11px] font-medium text-indigo-100 truncate">
                Photo, Emoji &amp; Offer — Sabhi Master &amp; Sub-Master ko live dikhega
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              AppSounds.tap();
              onClose();
            }}
            aria-label="Close advertisement modal"
            className="p-2 rounded-xl text-white/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Always-Visible Pinned Live/Off Status Strip (never hidden behind top notch or scroll) */}
        <div
          className={`shrink-0 px-4 py-2.5 border-b flex items-center justify-between gap-2 text-xs font-bold ${
            isCurrentlyLive
              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
              : 'bg-slate-100/95 border-slate-200 text-slate-800'
          }`}
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                isCurrentlyLive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
              }`}
            />
            <span className="leading-snug">
              {isCurrentlyLive
                ? 'LIVE — Sabhi Master, Sub-Master & Link par show ho raha hai'
                : 'OFF — Abhi koi advertisement live nahi hai'}
            </span>
          </span>
          {isCurrentlyLive ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-700 text-[10px] font-extrabold uppercase tracking-wide shrink-0">
              OFF
            </span>
          )}
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-4 sm:p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4">

              {!isAdminSignedIn ? (
                <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 space-y-3">
                  <div className="text-xs font-bold text-amber-950 leading-relaxed">
                    Sabhi Master, Sub-Master aur App Link par live Offer / Photo / Urgent Message bhejne ke liye pehle Admin Google Sign-In karein.
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      AppSounds.tap();
                      void onAdminSignIn();
                    }}
                    className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-55"
                  >
                    {busy ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="w-4 h-4 text-emerald-300" />
                    )}
                    <span>Admin Google Sign-In Karein</span>
                  </button>
                </div>
              ) : (
                <>
                  {/* Banner Type Selector */}
                  <div className="space-y-1.5">
                    <div className="text-xs font-extrabold text-slate-800">
                      Message Type Chunein
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          {
                            id: 'offer' as const,
                            label: 'Special Offer',
                            sub: 'Gold Ad Banner',
                            icon: Sparkles,
                            activeCls:
                              'bg-[#0B1E47] text-white border-amber-400 ring-2 ring-amber-300/60',
                            idleCls:
                              'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100',
                          },
                          {
                            id: 'urgent' as const,
                            label: 'Urgent Alert',
                            sub: 'Red Highlight',
                            icon: AlertTriangle,
                            activeCls:
                              'bg-rose-700 text-white border-rose-500 ring-2 ring-rose-300/60',
                            idleCls:
                              'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100',
                          },
                          {
                            id: 'notice' as const,
                            label: 'Notice',
                            sub: 'Clean Update',
                            icon: Megaphone,
                            activeCls:
                              'bg-indigo-700 text-white border-indigo-500 ring-2 ring-indigo-300/60',
                            idleCls:
                              'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100',
                          },
                        ]
                      ).map((opt) => {
                        const OptIcon = opt.icon;
                        const selected = kind === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              AppSounds.tap();
                              setKind(opt.id);
                            }}
                            className={`rounded-xl border px-2.5 py-2.5 text-left transition-all cursor-pointer ${
                              selected ? opt.activeCls : opt.idleCls
                            }`}
                          >
                            <OptIcon className="w-4 h-4 mb-1" />
                            <div className="text-xs font-extrabold leading-tight">{opt.label}</div>
                            <div
                              className={`text-[10px] font-semibold mt-0.5 ${
                                selected ? 'opacity-85' : 'text-slate-500'
                              }`}
                            >
                              {opt.sub}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Quick Templates */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-bold text-slate-500">Quick Templates:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_TEMPLATES.map((tpl) => (
                        <button
                          key={tpl.label}
                          type="button"
                          onClick={() => {
                            AppSounds.tap();
                            setKind(tpl.kind);
                            setTitle(tpl.title);
                            setMessage(tpl.message);
                            setLocalError('');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-[11px] font-bold text-slate-800 transition-colors cursor-pointer"
                        >
                          {tpl.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Headline Input */}
                  <label className="block space-y-1">
                    <div className="flex items-center justify-between text-xs font-extrabold text-slate-800">
                      <span>Headline / Offer Title</span>
                      <span className="text-[11px] font-mono-tabular text-slate-400">
                        {title.length}/120
                      </span>
                    </div>
                    <input
                      ref={titleInputRef}
                      type="text"
                      maxLength={120}
                      value={title}
                      onFocus={() => setActiveField('title')}
                      onChange={(e) => {
                        setTitle(e.target.value);
                        if (localError) setLocalError('');
                      }}
                      placeholder="e.g. 🎉 Special Diwali Offer! / 🚨 Urgent 1PM Cutoff"
                      className="w-full px-3.5 py-2.5 text-sm font-bold text-slate-950 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-[var(--kk-brand)] focus:outline-none placeholder:font-medium placeholder:text-slate-400"
                    />
                  </label>

                  {/* Message Body */}
                  <label className="block space-y-1">
                    <div className="flex items-center justify-between text-xs font-extrabold text-slate-800">
                      <span>Full Message / Advertisement Details</span>
                      <span className="text-[11px] font-mono-tabular text-slate-400">
                        {message.length}/1000
                      </span>
                    </div>
                    <textarea
                      ref={messageInputRef}
                      rows={3}
                      maxLength={1000}
                      value={message}
                      onFocus={() => setActiveField('message')}
                      onChange={(e) => {
                        setMessage(e.target.value);
                        if (localError) setLocalError('');
                      }}
                      placeholder="Apna offer, bonus rate, holiday timing ya urgent message yahan likhein..."
                      className="w-full px-3.5 py-2.5 text-sm font-medium text-slate-950 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-[var(--kk-brand)] focus:outline-none resize-none placeholder:text-slate-400 leading-relaxed"
                    />
                  </label>

                  {/* Quick Emoji Picker */}
                  <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-800">
                        <Smile className="w-4 h-4 text-amber-500" />
                        <span>Quick Emoji Add Karein</span>
                      </span>
                      <div className="inline-flex items-center rounded-lg bg-white border border-slate-200 p-0.5 text-[10px] font-bold">
                        <button
                          type="button"
                          onClick={() => setActiveField('title')}
                          className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                            activeField === 'title'
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Title
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveField('message')}
                          className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                            activeField === 'message'
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Message
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-8 sm:grid-cols-12 gap-1">
                      {QUICK_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => handleInsertEmoji(emoji)}
                          title={`Add ${emoji} to ${activeField === 'title' ? 'Headline' : 'Message'}`}
                          className="h-8 rounded-lg bg-white hover:bg-amber-50 active:scale-95 border border-slate-200 hover:border-amber-300 text-base flex items-center justify-center transition-all cursor-pointer"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Photo / Poster Upload */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-slate-800">
                        Photo / Poster (Optional)
                      </span>
                      {imageDataUrl && (
                        <span className="text-[11px] font-bold text-emerald-700">
                          Ready ({imageKB} KB — Fast Load)
                        </span>
                      )}
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => void handlePhotoSelect(e)}
                      className="hidden"
                    />

                    {!imageDataUrl ? (
                      <button
                        type="button"
                        disabled={busy || imageBusy}
                        onClick={() => {
                          AppSounds.tap();
                          fileInputRef.current?.click();
                        }}
                        className="w-full py-3.5 px-4 rounded-2xl border-2 border-dashed border-slate-300 hover:border-[var(--kk-brand)] bg-slate-50 hover:bg-indigo-50/40 text-slate-700 transition-colors flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-55"
                      >
                        {imageBusy ? (
                          <RefreshCw className="w-5 h-5 animate-spin text-[var(--kk-brand)]" />
                        ) : (
                          <ImagePlus className="w-5 h-5 text-[var(--kk-brand)]" />
                        )}
                        <div className="text-left">
                          <div className="text-xs font-extrabold text-slate-900">
                            {imageBusy ? 'Photo Compress Ho Raha Hai...' : 'Gallery se Photo / Poster Chunein'}
                          </div>
                          <div className="text-[10.5px] font-semibold text-slate-500">
                            Auto-compress hoga — Master &amp; Sub-Master sabhi ko fast dikhega
                          </div>
                        </div>
                      </button>
                    ) : (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2.5 space-y-2">
                        <div className="relative rounded-xl overflow-hidden bg-slate-900/5 border border-slate-200">
                          <img
                            src={imageDataUrl}
                            alt="Selected advertisement preview"
                            className="w-full max-h-44 object-contain mx-auto block"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busy || imageBusy}
                            onClick={() => {
                              AppSounds.tap();
                              fileInputRef.current?.click();
                            }}
                            className="flex-1 py-2 px-3 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-xs font-extrabold text-slate-800 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-55"
                          >
                            <ImagePlus className="w-3.5 h-3.5" />
                            <span>Photo Badlein</span>
                          </button>
                          <button
                            type="button"
                            disabled={busy || imageBusy}
                            onClick={() => {
                              AppSounds.remove();
                              setImageDataUrl('');
                            }}
                            className="py-2 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-extrabold text-rose-700 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-55"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Hatayein</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Live Preview */}
                  {hasContent && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                        Live Preview (Master / Sub-Master &amp; Link View)
                      </div>
                      <AnnouncementBanner
                        announcement={{
                          active: true,
                          kind,
                          title: title.trim(),
                          message: message.trim(),
                          imageDataUrl,
                          updatedAtMs: 0,
                        }}
                        variant="login"
                        forceVisible
                      />
                    </div>
                  )}

                  {displayError && (
                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-800 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                      <span>{displayError}</span>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="pt-1 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy || imageBusy || !hasContent}
                      onClick={() => void handlePublish()}
                      className="flex-1 min-w-[170px] py-3 px-4 rounded-xl kk-brand-gradient text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 shadow-md hover:opacity-95 disabled:opacity-50 transition-opacity cursor-pointer"
                    >
                      {busy ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      <span>{isCurrentlyLive ? 'Update Live Ad' : 'Publish Live to All'}</span>
                    </button>

                    {isCurrentlyLive && (
                      <button
                        type="button"
                        disabled={busy || imageBusy}
                        onClick={() => void handlePause()}
                        className="py-3 px-3.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300 text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <EyeOff className="w-4 h-4" />
                        <span>Hide</span>
                      </button>
                    )}

                    {(hasContent || isCurrentlyLive) && (
                      <button
                        type="button"
                        disabled={busy || imageBusy}
                        onClick={() => void handleClear()}
                        title="Clear & remove advertisement"
                        className="py-3 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Clear</span>
                      </button>
                    )}
                  </div>
                </>
              )}
        </div>
      </div>
    </div>
  );
}
