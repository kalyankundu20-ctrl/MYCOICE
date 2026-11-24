import { Check, Copy, Download, MoreVertical, Share, Smartphone, X } from 'lucide-react';
import { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { AppSounds } from '../utils/sound';

interface PWAInstallButtonProps {
  variant?: 'header' | 'sidebar' | 'banner';
}

export function PWAInstallButton({ variant = 'header' }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, isAndroid, isInAppBrowser, install } =
    usePWAInstall();
  const [guideMode, setGuideMode] = useState<'none' | 'ios' | 'android'>('none');
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Hide automatically when already launched as an installed Home Screen / WebAPK app
  if (isInstalled) return null;

  // Show on Android, iOS, or any desktop browser where native install prompt is available
  if (!isInstallable && !isIOS && !isAndroid) return null;

  const handleClick = async () => {
    AppSounds.tap();
    if (isInstallable) {
      const accepted = await install();
      if (!accepted && isAndroid) {
        // User dismissed or browser didn't show prompt — no extra popup needed
      }
      return;
    }
    if (isAndroid) {
      setGuideMode('android');
    } else if (isIOS) {
      setGuideMode('ios');
    }
  };

  const handleCopyCurrentUrl = async () => {
    AppSounds.tap();
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = window.location.href;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedUrl(true);
    window.setTimeout(() => setCopiedUrl(false), 2000);
  };

  const primaryLabel = isAndroid ? 'Install App (Android)' : 'Install App';

  return (
    <>
      {variant === 'sidebar' ? (
        <button
          type="button"
          onClick={() => void handleClick()}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-semibold text-amber-200 bg-white/10 hover:bg-white/20 border border-amber-300/25 rounded-xl transition-colors cursor-pointer"
        >
          <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{primaryLabel}</span>
        </button>
      ) : variant === 'banner' ? (
        <button
          type="button"
          onClick={() => void handleClick()}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-emerald-50 hover:bg-emerald-100/90 border border-emerald-300 text-emerald-950 transition-colors cursor-pointer shadow-xs text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Smartphone className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-black text-emerald-950 leading-tight">
                {isAndroid
                  ? 'KK Agency Android App Install Karein'
                  : isIOS
                  ? 'KK Agency iPhone App Add Karein'
                  : 'KK Agency App Install Karein'}
              </div>
              <div className="text-[11px] font-semibold text-emerald-800/85 mt-0.5 leading-snug">
                {isInstallable
                  ? '1-tap me phone par asli App icon install ho jayega'
                  : isAndroid
                  ? 'Phone ke App Drawer & Home Screen me direct app banayein'
                  : 'Home Screen par direct KK Agency app icon add karein'}
              </div>
            </div>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-700 text-white text-xs font-extrabold shadow-xs">
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Install</span>
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void handleClick()}
          title="Install KK Agency App on Phone"
          aria-label="Install KK Agency App"
          className="inline-flex items-center justify-center gap-1 h-9 sm:h-10 px-2 sm:px-3 text-xs font-extrabold text-amber-100 bg-white/15 hover:bg-white/25 border border-amber-200/35 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
        >
          <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">Install App</span>
        </button>
      )}

      {guideMode === 'android' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-[2px] p-4"
          onClick={() => setGuideMode('none')}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white text-slate-950 p-5 shadow-2xl border border-slate-200 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <img
                  src="/kk-logo.png"
                  alt="KK Agency"
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-2xl shadow-md border border-slate-200 object-cover"
                />
                <div>
                  <h3 className="text-base font-black text-slate-950 leading-tight">
                    Android App Install Karein
                  </h3>
                  <p className="text-xs font-semibold text-emerald-700">
                    Direct Android WebAPK (No Play Store needed)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGuideMode('none')}
                aria-label="Close install guide"
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isInAppBrowser && (
              <div className="rounded-2xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-[11.5px] font-bold text-amber-950 leading-relaxed">
                Abhi yeh link WhatsApp / In-App browser me khula hai. App install karne ke liye pehle <strong>Chrome</strong> me open karein!
              </div>
            )}

            <ol className="space-y-2.5 text-xs text-slate-700 bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-[var(--kk-brand)] text-white font-black text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                  1
                </span>
                <span>
                  Upar right corner me{' '}
                  <MoreVertical className="w-3.5 h-3.5 inline text-[var(--kk-brand)] -mt-0.5" />{' '}
                  <strong>3 dots</strong> par tap karein
                  {isInAppBrowser ? (
                    <>
                      {' '}
                      aur <strong>Open in Chrome</strong> select karein.
                    </>
                  ) : (
                    <> (agar WhatsApp ke andar khula hai to pehle <strong>Open in Chrome</strong> karein).</>
                  )}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-[var(--kk-brand)] text-white font-black text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                  2
                </span>
                <span>
                  Chrome menu me <strong>Install app</strong> (ya <strong>Add to Home screen → Install</strong>) par tap karein.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-[var(--kk-brand)] text-white font-black text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                  3
                </span>
                <span>
                  5 second me asli <strong>KK Agency</strong> app aapke Android phone ke <strong>App Drawer &amp; Home Screen</strong> par install ho jayega!
                </span>
              </li>
            </ol>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyCurrentUrl()}
                className="flex-1 py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-extrabold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {copiedUrl ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Link Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Link for Chrome</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  setGuideMode('none');
                }}
                className="flex-1 py-2.5 px-3 rounded-xl kk-brand-gradient text-white text-xs font-extrabold cursor-pointer shadow-sm"
              >
                Samajh Gaya
              </button>
            </div>
          </div>
        </div>
      )}

      {guideMode === 'ios' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-[2px] p-4"
          onClick={() => setGuideMode('none')}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white text-slate-950 p-5 shadow-2xl border border-slate-200 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <img
                  src="/kk-logo.png"
                  alt="KK Agency"
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-2xl shadow-md border border-slate-200 object-cover"
                />
                <div>
                  <h3 className="text-base font-black text-slate-950 leading-tight">
                    KK Agency Logo Add Karein
                  </h3>
                  <p className="text-xs font-semibold text-slate-500">
                    iPhone Home Screen App Setup
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGuideMode('none')}
                aria-label="Close install guide"
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <ol className="space-y-2.5 text-xs text-slate-700 bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-[var(--kk-brand)] text-white font-black text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                  1
                </span>
                <span>
                  Agar purana grey <strong>K</strong> icon Home Screen par hai to pehle usse remove kar dein.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-[var(--kk-brand)] text-white font-black text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                  2
                </span>
                <span>
                  Safari me neeche <Share className="w-3.5 h-3.5 inline text-[var(--kk-brand)] -mt-0.5" />{' '}
                  <strong>Share</strong> button par tap karein.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-[var(--kk-brand)] text-white font-black text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                  3
                </span>
                <span>
                  <strong>Add to Home Screen</strong> select karein — naya royal gold <strong>KK Agency</strong> logo add ho jayega!
                </span>
              </li>
            </ol>

            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                setGuideMode('none');
              }}
              className="w-full py-2.5 rounded-xl kk-brand-gradient text-white text-xs font-extrabold cursor-pointer shadow-sm"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
}
