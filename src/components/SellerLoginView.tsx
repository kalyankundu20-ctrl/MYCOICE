import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  User,
} from 'lucide-react';
import { useRef, useState } from 'react';
import {
  FIREBASE_AUTH_PROVIDERS_URL,
  FIREBASE_AUTHORIZED_DOMAINS_URL,
  FIREBASE_FIRESTORE_UPGRADE_URL,
  FIREBASE_PRICING_URL,
  getAuthEnvironmentInfo,
  isAnonymousAuthDisabledError,
  isFirestoreQuotaExceededError,
  isUnauthorizedDomainError,
} from '../firebase';
import type { CloudPublicAnnouncement } from '../services/cloudSync';
import { AppSounds } from '../utils/sound';
import { AnnouncementBanner } from './AnnouncementBanner';
import { PWAInstallButton } from './PWAInstallButton';

interface SellerLoginViewProps {
  busy: boolean;
  error: string;
  onLoginWithIdPassword: (loginId: string, password: string) => Promise<void>;
  onCancelToAdmin?: () => void;
  showAdminSignIn?: boolean;
  allowLogoAdminUnlock?: boolean;
  onAdminGoogleSignIn?: () => Promise<void>;
  announcement?: CloudPublicAnnouncement | null;
}

export function SellerLoginView({
  busy,
  error,
  onLoginWithIdPassword,
  onCancelToAdmin,
  showAdminSignIn = false,
  allowLogoAdminUnlock = false,
  onAdminGoogleSignIn,
  announcement = null,
}: SellerLoginViewProps) {
  const [loginIdInput, setLoginIdInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [adminUnlockedByLogo, setAdminUnlockedByLogo] = useState(false);
  const [domainCopied, setDomainCopied] = useState(false);
  const logoTapRef = useRef<{ count: number; lastTs: number }>({ count: 0, lastTs: 0 });

  const isQuotaExceeded = isFirestoreQuotaExceededError(error);
  const isAnonDisabled = !isQuotaExceeded && isAnonymousAuthDisabledError(error);
  const isUnauthorizedDomain = isUnauthorizedDomainError(error);
  const authEnv = getAuthEnvironmentInfo();
  const canShowAdminButton = Boolean(
    onAdminGoogleSignIn && (showAdminSignIn || (allowLogoAdminUnlock && adminUnlockedByLogo))
  );

  const handleCopyDomain = async () => {
    const host = authEnv.hostname || (typeof window !== 'undefined' ? window.location.hostname : '');
    if (!host) return;
    AppSounds.tap();
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(host);
      } else {
        const ta = document.createElement('textarea');
        ta.value = host;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setDomainCopied(true);
      AppSounds.success();
      window.setTimeout(() => setDomainCopied(false), 2500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = host;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
        setDomainCopied(true);
        window.setTimeout(() => setDomainCopied(false), 2500);
      } catch {
        // Ignore clipboard failure
      }
      document.body.removeChild(ta);
    }
  };

  const handleLogoTap = () => {
    if (!allowLogoAdminUnlock || !onAdminGoogleSignIn || showAdminSignIn) return;
    const now = Date.now();
    if (now - logoTapRef.current.lastTs > 2200) {
      logoTapRef.current = { count: 1, lastTs: now };
    } else {
      logoTapRef.current = { count: logoTapRef.current.count + 1, lastTs: now };
    }
    if (logoTapRef.current.count >= 5) {
      logoTapRef.current = { count: 0, lastTs: 0 };
      AppSounds.tap();
      setAdminUnlockedByLogo(true);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginIdInput.trim() || !passwordInput.trim() || busy) return;
    AppSounds.tap();
    void onLoginWithIdPassword(loginIdInput.trim(), passwordInput.trim());
  };

  return (
    <div className="h-full w-full overflow-y-auto overscroll-y-contain bg-[var(--kk-canvas)] flex flex-col items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md space-y-3 my-auto">
        <AnnouncementBanner announcement={announcement} variant="login" />
        <div className="w-full bg-white border border-slate-200/90 rounded-3xl shadow-xl overflow-hidden">
        <div className="kk-brand-gradient text-white px-6 py-6 text-center space-y-2.5">
          <img
            src="/kk-logo.png"
            alt="KK Agency"
            referrerPolicy="no-referrer"
            onClick={handleLogoTap}
            className="w-16 h-16 rounded-2xl object-cover mx-auto shadow-lg ring-2 ring-white/30 select-none"
          />
          <div>
            <h1 className="text-xl font-black tracking-tight">KK Agency Login</h1>
            <p className="text-xs text-indigo-100 font-medium mt-0.5">
              Master &amp; Sub-Master Direct Login — apna Login ID &amp; Password daalein
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} autoComplete="off" className="p-6 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-[var(--kk-brand)]" />
              <span>User ID</span>
            </span>
            <input
              type="text"
              required
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={loginIdInput}
              onChange={(e) => setLoginIdInput(e.target.value.toUpperCase().replace(/\s+/g, ''))}
              placeholder="Enter User ID"
              className="w-full px-3.5 py-3 text-base font-black font-mono-tabular uppercase tracking-wider text-slate-950 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:bg-white focus:border-[var(--kk-brand)] focus:outline-none placeholder:font-sans placeholder:font-medium placeholder:tracking-normal placeholder:normal-case placeholder:text-slate-400"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-[var(--kk-brand)]" />
              <span>Password</span>
            </span>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter Password"
                className="w-full pl-3.5 pr-12 py-3 text-base font-black font-mono-tabular tracking-widest text-slate-950 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:bg-white focus:border-[var(--kk-brand)] focus:outline-none placeholder:font-sans placeholder:font-medium placeholder:tracking-normal placeholder:text-slate-400"
              />
              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  setShowPassword((v) => !v);
                }}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </label>

          {error && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-900 space-y-2.5 overflow-hidden">
              <div className="flex items-start gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                <span className="break-words min-w-0">{error}</span>
              </div>
              {isQuotaExceeded && (
                <div className="pt-2 border-t border-rose-200/80 space-y-2">
                  <div className="text-[11px] font-semibold text-rose-950 leading-relaxed">
                    <strong>Note:</strong> Ye Firebase ka Free Daily Read limit full hone ki wajah se aaya hai. Kal quota apne aap reset ho jayega, ya Admin turant upgrade karke abhi chalu kar sakte hain.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={FIREBASE_FIRESTORE_UPGRADE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => AppSounds.tap()}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-700 text-white text-xs font-extrabold hover:bg-rose-800 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Upgrade Firestore</span>
                    </a>
                    <a
                      href={FIREBASE_PRICING_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => AppSounds.tap()}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-rose-300 text-rose-900 text-xs font-extrabold hover:bg-rose-100 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Quota Details</span>
                    </a>
                  </div>
                </div>
              )}
              {isUnauthorizedDomain && (
                <div className="pt-2 border-t border-rose-200/80 space-y-2.5">
                  <div className="text-[11px] font-semibold text-rose-950 leading-relaxed">
                    <strong>1-Time Setup (10 sec):</strong> Pehle{' '}
                    <strong>Copy Domain</strong> dabayein, phir{' '}
                    <strong>Open Firebase Settings</strong> khol kar{' '}
                    <strong>Authorized domains → Add domain</strong> me paste kar dein:
                  </div>
                  {authEnv.hostname && (
                    <div className="px-2.5 py-1.5 rounded-xl bg-white border border-rose-200 font-mono-tabular text-xs font-extrabold text-slate-900 select-all break-all">
                      {authEnv.hostname}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopyDomain()}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-extrabold transition-colors cursor-pointer ${
                        domainCopied
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-900 hover:bg-slate-800 text-white'
                      }`}
                    >
                      {domainCopied ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{domainCopied ? 'Domain Copied!' : 'Copy Domain'}</span>
                    </button>
                    <a
                      href={FIREBASE_AUTHORIZED_DOMAINS_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => AppSounds.tap()}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-700 text-white text-xs font-extrabold hover:bg-rose-800 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open Firebase Settings</span>
                    </a>
                  </div>
                </div>
              )}
              {isAnonDisabled && (
                <div className="pt-2 border-t border-rose-200/80 space-y-2">
                  <div className="text-[11px] font-semibold text-rose-950 leading-relaxed">
                    <strong>Admin 1-Time Setting (10 sec):</strong> Neeche button kholein →{' '}
                    <strong>Add new provider</strong> → <strong>Anonymous</strong> →{' '}
                    <strong>Enable</strong> → <strong>Save</strong>. Uske baad sabhi Master &amp;
                    Client bina email ke seedha ID &amp; Password se login kar sakenge.
                  </div>
                  <a
                    href={FIREBASE_AUTH_PROVIDERS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => AppSounds.tap()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-700 text-white text-xs font-extrabold hover:bg-rose-800 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open Firebase Auth Providers</span>
                  </a>
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !loginIdInput.trim() || !passwordInput.trim()}
            className="w-full py-3.5 px-4 rounded-2xl kk-brand-gradient text-white text-sm font-extrabold flex items-center justify-center gap-2 shadow-md hover:opacity-95 disabled:opacity-55 transition-opacity cursor-pointer"
          >
            {busy ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            <span>{busy ? 'Login ho raha hai...' : 'Direct Login Karein'}</span>
          </button>

          <PWAInstallButton variant="banner" />

          <div className="pt-1 space-y-2 text-[11px] text-slate-500">
            <div className="flex items-start gap-2 bg-emerald-50/70 border border-emerald-200/80 rounded-xl p-3 text-emerald-950">
              <KeyRound className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <span>
                <strong>Koi Email / Gmail nahi chahiye!</strong> Apna{' '}
                <strong>User ID</strong> aur <strong>Password</strong> daalein — turant apna 1PM,
                6PM, 8PM entry, Bill aur Prize List khul jayega.
              </span>
            </div>
            <div className="flex items-start gap-2 bg-slate-50 border border-slate-200/80 rounded-xl p-3">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                Har Master, Sub-Master aur Client ka data, rate aur bill bilkul alag aur safe rehta hai.
              </span>
            </div>
            <div className="flex items-center justify-center gap-1.5 text-slate-400">
              <Smartphone className="w-3.5 h-3.5" />
              <span>Ek baar login ke baad phone par auto-login rahega</span>
            </div>
          </div>

          {canShowAdminButton && onAdminGoogleSignIn && (
            <div className="pt-2 border-t border-slate-200/80">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  AppSounds.tap();
                  void onAdminGoogleSignIn();
                }}
                className="w-full py-2.5 px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-55"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
                <span>Admin Google Sign-In</span>
              </button>
            </div>
          )}

          {onCancelToAdmin && (
            <button
              type="button"
              onClick={() => {
                AppSounds.tap();
                onCancelToAdmin();
              }}
              className="w-full py-2 text-xs font-bold text-slate-600 hover:text-slate-900 inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Agency Dashboard</span>
            </button>
          )}
        </form>
        </div>
      </div>
    </div>
  );
}
