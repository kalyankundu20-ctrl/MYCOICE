import {
  AlertCircle,
  ArrowLeft,
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
import { useEffect, useState } from 'react';
import {
  FIREBASE_AUTH_PROVIDERS_URL,
  isAnonymousAuthDisabledError,
} from '../firebase';
import { AppSounds } from '../utils/sound';
import { PWAInstallButton } from './PWAInstallButton';

interface SellerLoginViewProps {
  initialLoginId?: string;
  busy: boolean;
  error: string;
  onLoginWithIdPassword: (loginId: string, password: string) => Promise<void>;
  onCancelToAdmin?: () => void;
}

export function SellerLoginView({
  initialLoginId = '',
  busy,
  error,
  onLoginWithIdPassword,
  onCancelToAdmin,
}: SellerLoginViewProps) {
  const [loginIdInput, setLoginIdInput] = useState(initialLoginId);
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const isAnonDisabled = isAnonymousAuthDisabledError(error);

  useEffect(() => {
    if (initialLoginId) {
      setLoginIdInput(initialLoginId);
    }
  }, [initialLoginId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginIdInput.trim() || !passwordInput.trim() || busy) return;
    AppSounds.tap();
    void onLoginWithIdPassword(loginIdInput.trim(), passwordInput.trim());
  };

  return (
    <div className="h-full w-full overflow-y-auto overscroll-y-contain bg-[var(--kk-canvas)] flex flex-col items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md bg-white border border-slate-200/90 rounded-3xl shadow-xl overflow-hidden">
        <div className="kk-brand-gradient text-white px-6 py-6 text-center space-y-2.5">
          <img
            src="/kk-logo.png"
            alt="KK Agency"
            referrerPolicy="no-referrer"
            className="w-16 h-16 rounded-2xl object-cover mx-auto shadow-lg ring-2 ring-white/30"
          />
          <div>
            <h1 className="text-xl font-black tracking-tight">KK Agency Login</h1>
            <p className="text-xs text-indigo-100 font-medium mt-0.5">
              Master &amp; Client Direct Login — koi Email ya Google nahi, seedha Login ID &amp; Password daalein
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-extrabold text-slate-700 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-[var(--kk-brand)]" />
              <span>Login ID</span>
            </span>
            <input
              type="text"
              required
              autoComplete="username"
              autoCapitalize="characters"
              spellCheck={false}
              value={loginIdInput}
              onChange={(e) => setLoginIdInput(e.target.value.toUpperCase().replace(/\s+/g, ''))}
              placeholder="e.g. SOMA"
              className="w-full px-3.5 py-3 text-base font-black font-mono-tabular uppercase tracking-wider text-slate-950 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:bg-white focus:border-[var(--kk-brand)] focus:outline-none"
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
                autoComplete="current-password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="e.g. 482916"
                className="w-full pl-3.5 pr-12 py-3 text-base font-black font-mono-tabular tracking-widest text-slate-950 bg-slate-50 border-2 border-slate-200 rounded-2xl focus:bg-white focus:border-[var(--kk-brand)] focus:outline-none"
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
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-900 space-y-2.5">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                <span>{error}</span>
              </div>
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
                <strong>Koi Email / Gmail nahi chahiye!</strong> Admin ya Master se mila hua chhota{' '}
                <strong>Login ID</strong> aur <strong>Password</strong> daalein — turant apna 1PM,
                6PM, 8PM entry, Bill aur Prize List khul jayega.
              </span>
            </div>
            <div className="flex items-start gap-2 bg-slate-50 border border-slate-200/80 rounded-xl p-3">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                Har Master aur Client ka data, rate aur bill bilkul alag aur safe rehta hai.
              </span>
            </div>
            <div className="flex items-center justify-center gap-1.5 text-slate-400">
              <Smartphone className="w-3.5 h-3.5" />
              <span>Ek baar login ke baad phone par auto-login rahega</span>
            </div>
          </div>

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
  );
}
