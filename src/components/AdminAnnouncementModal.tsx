import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  EyeOff,
  Megaphone,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { CloudAnnouncementKind, CloudPublicAnnouncement } from '../services/cloudSync';
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
  }) => Promise<void>;
}

const QUICK_TEMPLATES: Array<{
  label: string;
  kind: CloudAnnouncementKind;
  title: string;
  message: string;
}> = [
  {
    label: 'Special Offer',
    kind: 'offer',
    title: 'Special Offer — KK Agency',
    message: 'Aaj ke special offer ka fayda uthayein! Zyada jankari ke liye Admin se contact karein.',
  },
  {
    label: 'Urgent Alert',
    kind: 'urgent',
    title: 'Urgent Notice — Timing Update',
    message: 'Sabhi Master & Sub-Master dhyan dein: aaj ki entry samay se pehle submit kar dein.',
  },
  {
    label: 'Holiday Notice',
    kind: 'notice',
    title: 'Important Agency Notice',
    message: 'Aaj ka schedule update ho gaya hai. Kripya apna bill aur sheet regular check karein.',
  },
];

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
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setLocalError('');
    if (announcement) {
      setKind(announcement.kind || 'offer');
      setTitle(announcement.title || '');
      setMessage(announcement.message || '');
    } else {
      setKind('offer');
      setTitle('');
      setMessage('');
    }
  }, [isOpen, announcement]);

  const isCurrentlyLive = Boolean(
    announcement?.active && (announcement.title.trim() || announcement.message.trim())
  );
  const hasContent = Boolean(title.trim() || message.trim());

  const handlePublish = async () => {
    if (!hasContent) {
      setLocalError('Kripya Headline ya Message me kuch likhein.');
      return;
    }
    setLocalError('');
    AppSounds.tap();
    await onSaveAnnouncement({
      active: true,
      kind,
      title: title.trim(),
      message: message.trim(),
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
    });
  };

  const handleClear = async () => {
    setLocalError('');
    AppSounds.remove();
    setTitle('');
    setMessage('');
    await onSaveAnnouncement({
      active: false,
      kind: 'offer',
      title: '',
      message: '',
    });
  };

  const displayError = localError || error;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="ad-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={() => {
            AppSounds.tap();
            onClose();
          }}
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ad-modal-title"
        >
          <motion.div
            key="ad-modal-card"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg max-h-[92vh] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="kk-brand-gradient text-white px-5 py-4 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-10 h-10 rounded-xl bg-amber-400/20 text-amber-300 ring-1 ring-amber-300/40 flex items-center justify-center shrink-0">
                  <Megaphone className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <h2 id="ad-modal-title" className="text-base font-extrabold tracking-tight truncate">
                    Advertisement &amp; Urgent Message
                  </h2>
                  <p className="text-[11px] font-medium text-indigo-100 truncate">
                    App, Login Link, Master &amp; Sub-Master sabhi ko live dikhega
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

            {/* Body */}
            <div className="flex-1 overflow-y-auto overscroll-y-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4">
              {/* Live Status Bar */}
              <div
                className={`rounded-2xl px-3.5 py-2.5 border flex items-center justify-between gap-2 text-xs font-bold ${
                  isCurrentlyLive
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    : 'bg-slate-50 border-slate-200 text-slate-700'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      isCurrentlyLive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                    }`}
                  />
                  <span>
                    {isCurrentlyLive
                      ? 'LIVE — Sabhi Master, Sub-Master & Link par show ho raha hai'
                      : 'OFF — Abhi koi advertisement live nahi hai'}
                  </span>
                </span>
                {isCurrentlyLive && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                )}
              </div>

              {!isAdminSignedIn ? (
                <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 space-y-3">
                  <div className="text-xs font-bold text-amber-950 leading-relaxed">
                    Sabhi Master, Sub-Master aur App Link par live Offer / Urgent Message bhejne ke liye pehle Admin Google Sign-In karein.
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
                      type="text"
                      maxLength={120}
                      value={title}
                      onChange={(e) => {
                        setTitle(e.target.value);
                        if (localError) setLocalError('');
                      }}
                      placeholder="e.g. Special Diwali Offer! / Urgent 1PM Cutoff Notice"
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
                      rows={4}
                      maxLength={1000}
                      value={message}
                      onChange={(e) => {
                        setMessage(e.target.value);
                        if (localError) setLocalError('');
                      }}
                      placeholder="Apna offer, bonus rate, holiday timing ya urgent message yahan likhein..."
                      className="w-full px-3.5 py-2.5 text-sm font-medium text-slate-950 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-[var(--kk-brand)] focus:outline-none resize-none placeholder:text-slate-400 leading-relaxed"
                    />
                  </label>

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
                      disabled={busy || !hasContent}
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
                        disabled={busy}
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
                        disabled={busy}
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
