import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudOff,
  Copy,
  ExternalLink,
  Eye,
  KeyRound,
  Link2,
  Lock,
  LogIn,
  LogOut,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import {
  FIREBASE_AUTHORIZED_DOMAINS_URL,
  getAuthEnvironmentInfo,
  isUnauthorizedDomainError,
} from '../firebase';
import {
  buildSellerInviteWhatsAppUrl,
  buildSellerPortalUrl,
  CloudPartyDoc,
  CloudPartyPrivateDoc,
} from '../services/cloudSync';
import { Seller } from '../types/ledger';
import { AppSounds } from '../utils/sound';

interface SellerIdManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  isAdminSignedIn: boolean;
  adminEmail: string | null;
  cloudBusy: boolean;
  cloudError: string;
  sellers: Seller[];
  allCloudParties: CloudPartyDoc[];
  partiesBySellerId: Record<string, CloudPartyDoc>;
  privatesByPartyId: Record<string, CloudPartyPrivateDoc>;
  subSellersCountByMasterId: Record<string, number>;
  onAdminSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSyncAllSellersNow: () => Promise<void>;
  onEnableChainAll: () => Promise<void>;
  onTogglePartyActive: (party: CloudPartyDoc, nextActive: boolean) => Promise<void>;
  onTogglePartyChainRole: (party: CloudPartyDoc, nextRole: 'master' | 'client') => Promise<void>;
  onResetPartyKey: (party: CloudPartyDoc) => Promise<void>;
  onUpdatePartyCredentials: (
    party: CloudPartyDoc,
    loginId: string,
    loginPassword: string
  ) => Promise<void>;
  onCreateSubSellerForMaster: (
    parentMaster: CloudPartyDoc,
    subInput: { name: string; rate: number; mobile: string; allowChain: boolean }
  ) => Promise<void>;
  onDeleteSubParty: (subParty: CloudPartyDoc) => Promise<void>;
  onAddSeller: (seller: Omit<Seller, 'id'>) => void;
  onPreviewSeller: (party: CloudPartyDoc) => void;
  onOpenSellerLoginMode: () => void;
}

export function SellerIdManagerModal({
  isOpen,
  onClose,
  isAdminSignedIn,
  adminEmail,
  cloudBusy,
  cloudError,
  sellers,
  allCloudParties,
  partiesBySellerId,
  privatesByPartyId,
  subSellersCountByMasterId,
  onAdminSignIn,
  onSignOut,
  onSyncAllSellersNow,
  onEnableChainAll,
  onTogglePartyActive,
  onTogglePartyChainRole,
  onResetPartyKey,
  onUpdatePartyCredentials,
  onCreateSubSellerForMaster,
  onDeleteSubParty,
  onAddSeller,
  onPreviewSeller,
  onOpenSellerLoginMode,
}: SellerIdManagerModalProps) {
  const [copiedKey, setCopiedKey] = useState<string>('');
  const [busyPartyId, setBusyPartyId] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRate, setNewRate] = useState('11');
  const [newMobile, setNewMobile] = useState('');
  const [expandedMasters, setExpandedMasters] = useState<Record<string, boolean>>({});
  const [assigningParentId, setAssigningParentId] = useState<string | null>(null);
  const [subName, setSubName] = useState('');
  const [subRate, setSubRate] = useState('11.5');
  const [subMobile, setSubMobile] = useState('');
  const [subAllowChain, setSubAllowChain] = useState(false);
  const [editingCredPartyId, setEditingCredPartyId] = useState<string | null>(null);
  const [editLoginId, setEditLoginId] = useState('');
  const [editLoginPass, setEditLoginPass] = useState('');
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [copiedAppUrl, setCopiedAppUrl] = useState(false);
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [justSynced, setJustSynced] = useState(false);

  const handleInstantSyncAll = async () => {
    if (syncingNow || cloudBusy) return;
    AppSounds.tap();
    setSyncingNow(true);
    setJustSynced(false);
    await new Promise((r) => window.setTimeout(r, 0));
    try {
      await onSyncAllSellersNow();
      setJustSynced(true);
      window.setTimeout(() => setJustSynced(false), 2600);
    } finally {
      setSyncingNow(false);
    }
  };

  const openEditCreds = (party: CloudPartyDoc, priv?: CloudPartyPrivateDoc) => {
    AppSounds.tap();
    if (editingCredPartyId === party.partyId) {
      setEditingCredPartyId(null);
      return;
    }
    setEditingCredPartyId(party.partyId);
    setEditLoginId(priv?.loginId || party.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12));
    setEditLoginPass(priv?.loginPassword || '');
  };

  const handleSaveCreds = async (e: React.FormEvent, party: CloudPartyDoc) => {
    e.preventDefault();
    if (!editLoginId.trim() || !editLoginPass.trim()) return;
    setBusyPartyId(party.partyId);
    try {
      await onUpdatePartyCredentials(party, editLoginId.trim(), editLoginPass.trim());
      AppSounds.success();
      setEditingCredPartyId(null);
    } finally {
      setBusyPartyId('');
    }
  };

  const authEnv = getAuthEnvironmentInfo();
  const isDomainErr = isUnauthorizedDomainError(cloudError);
  const showDirectBrowserGuide =
    !isDomainErr &&
    (authEnv.isEmbeddedIframe || authEnv.isInAppBrowser || authEnv.isIOS || Boolean(cloudError));

  const childrenByParentId: Record<string, CloudPartyDoc[]> = {};
  for (const p of allCloudParties) {
    if (p.parentMasterId) {
      if (!childrenByParentId[p.parentMasterId]) {
        childrenByParentId[p.parentMasterId] = [];
      }
      childrenByParentId[p.parentMasterId].push(p);
    }
  }

  const countAllDescendants = (partyId: string, seen = new Set<string>()): number => {
    const kids = childrenByParentId[partyId] || [];
    let total = 0;
    for (const k of kids) {
      if (seen.has(k.partyId)) continue;
      seen.add(k.partyId);
      total += 1 + countAllDescendants(k.partyId, seen);
    }
    return total;
  };

  const openAssignSubForm = (parent: CloudPartyDoc) => {
    AppSounds.tap();
    setExpandedMasters((prev) => ({ ...prev, [parent.partyId]: true }));
    if (assigningParentId === parent.partyId) {
      setAssigningParentId(null);
      return;
    }
    setAssigningParentId(parent.partyId);
    setSubName('');
    setSubRate(String(Math.round(((parent.rate || 11) + 0.5) * 100) / 100));
    setSubMobile('');
    setSubAllowChain(false);
  };

  const handleAssignSubSubmit = async (e: React.FormEvent, parent: CloudPartyDoc) => {
    e.preventDefault();
    const cleaned = subName.trim().toUpperCase();
    if (!cleaned) return;
    const rateNum = Number(subRate);
    setBusyPartyId(parent.partyId);
    try {
      await onCreateSubSellerForMaster(parent, {
        name: cleaned,
        rate: Number.isFinite(rateNum) && rateNum >= 0 ? rateNum : parent.rate,
        mobile: subMobile.trim(),
        allowChain: subAllowChain,
      });
      AppSounds.success();
      setAssigningParentId(null);
      setSubName('');
      setSubMobile('');
      setSubAllowChain(false);
      setExpandedMasters((prev) => ({ ...prev, [parent.partyId]: true }));
    } finally {
      setBusyPartyId('');
    }
  };

  const handleQuickAddSeller = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedName = newName.trim().toUpperCase();
    if (!cleanedName) return;
    const rateNum = Number(newRate);
    AppSounds.add();
    onAddSeller({
      name: cleanedName,
      rate: Number.isFinite(rateNum) && rateNum >= 0 ? rateNum : 11,
      mobile: newMobile.trim(),
      due: 0,
      joma: 0,
    });
    setNewName('');
    setNewMobile('');
    setShowAddForm(false);
  };

  const copyText = async (text: string, token: string) => {
    AppSounds.tap();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedKey(token);
    window.setTimeout(() => {
      setCopiedKey((curr) => (curr === token ? '' : curr));
    }, 1800);
  };

  const partyList = Object.values(partiesBySellerId);
  const connectedCount = partyList.filter((p) => Boolean(p.assignedUid) && p.active).length;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="seller-id-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/55 backdrop-blur-[2px] p-0 pt-[env(safe-area-inset-top)] sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="seller-id-modal-title"
        >
          <motion.div
            key="seller-id-modal-card"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[92%]"
          >
            {/* Header */}
            <div className="kk-brand-gradient text-white px-5 py-4 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-10 h-10 rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5 text-white" />
                </span>
                <div className="min-w-0">
                  <h2 id="seller-id-modal-title" className="text-base font-black tracking-tight truncate">
                    Master &amp; Client Login IDs
                  </h2>
                  <p className="text-[11px] text-indigo-100 font-medium truncate">
                    Simple Login ID &amp; Password — bina Email/Google ke seedha phone par app khulega
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  AppSounds.tap();
                  onClose();
                }}
                aria-label="Close Seller IDs modal"
                className="p-2 rounded-xl hover:bg-white/15 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] overflow-y-auto space-y-4 flex-1 bg-slate-50/70">
              {cloudError && (
                <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-900 space-y-2.5">
                  <div>{cloudError}</div>
                  {isDomainErr && authEnv.hostname && (
                    <div className="pt-2.5 border-t border-rose-200/90 space-y-2">
                      <div className="text-[11px] font-semibold text-rose-950 leading-relaxed">
                        <strong>10-Second Permanent Fix:</strong> Neeche <strong>Copy Domain</strong>{' '}
                        dabayein → <strong>Open Firebase Settings</strong> kholein →{' '}
                        <strong>Authorized domains</strong> → <strong>Add domain</strong> me paste
                        karke save kar dein.
                      </div>
                      <div className="px-2.5 py-1.5 rounded-lg bg-white border border-rose-200 font-mono-tabular text-[11px] text-slate-950 break-all">
                        {authEnv.hostname}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            AppSounds.tap();
                            void navigator.clipboard?.writeText(authEnv.hostname).then(() => {
                              setCopiedDomain(true);
                              window.setTimeout(() => setCopiedDomain(false), 2000);
                            });
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-rose-300 text-rose-950 text-xs font-extrabold hover:bg-rose-100 cursor-pointer"
                        >
                          {copiedDomain ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>{copiedDomain ? 'Domain Copied!' : 'Copy Domain'}</span>
                        </button>
                        <a
                          href={FIREBASE_AUTHORIZED_DOMAINS_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => AppSounds.tap()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-700 text-white text-xs font-extrabold hover:bg-rose-800 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Open Firebase Settings</span>
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!isAdminSignedIn ? (
                <div className="space-y-4">
                  <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
                    <div className="flex items-start gap-3">
                      <span className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 text-[var(--kk-brand)] flex items-center justify-center shrink-0">
                        <Cloud className="w-5 h-5" />
                      </span>
                      <div className="space-y-1">
                        <h3 className="text-sm font-extrabold text-slate-950">
                          Step 1: Admin Cloud Sync On Karein
                        </h3>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          Apne Admin Google account se sign in karne ke baad har seller ka unique{' '}
                          <strong className="text-slate-900">Seller ID</strong> aur{' '}
                          <strong className="text-slate-900">WhatsApp Login Link</strong> generate ho jayega.
                          Sellers apne phone par 1PM / 6PM / 8PM ticket entry karenge aur aapke Winning Number daalte hi unki Prize List live khul jayegi.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={cloudBusy}
                      onClick={() => {
                        AppSounds.tap();
                        void onAdminSignIn();
                      }}
                      className="w-full py-3 px-4 rounded-xl kk-brand-gradient text-white text-sm font-extrabold flex items-center justify-center gap-2 shadow-md hover:opacity-95 disabled:opacity-60 transition-opacity cursor-pointer"
                    >
                      {cloudBusy ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="w-4 h-4" />
                      )}
                      <span>
                        {cloudBusy
                          ? 'Connecting Admin Cloud...'
                          : 'Admin Google Sign In (Auto-Login)'}
                      </span>
                    </button>

                    {showDirectBrowserGuide && authEnv.directUrl && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50/85 p-3 space-y-2.5">
                        <div className="text-[11px] font-bold text-amber-950 leading-relaxed">
                          iPhone / In-App Preview me agar{' '}
                          <span className="font-mono-tabular">&quot;The requested action is invalid&quot;</span>{' '}
                          aaye ya login bar-bar logout ho, to app ko direct{' '}
                          <strong>Safari / Chrome</strong> me khol kar 1 baar Google Sign In karein —
                          phir <strong>kabhi logout nahi hoga</strong>.
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={authEnv.directUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => AppSounds.tap()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-900 text-white text-xs font-extrabold hover:bg-amber-950 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Open Direct in Safari / Chrome</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              AppSounds.tap();
                              void navigator.clipboard?.writeText(authEnv.directUrl).then(() => {
                                setCopiedAppUrl(true);
                                window.setTimeout(() => setCopiedAppUrl(false), 2000);
                              });
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-950 text-xs font-bold hover:bg-amber-100 cursor-pointer"
                          >
                            {copiedAppUrl ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>{copiedAppUrl ? 'Link Copied!' : 'Copy App Link'}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="bg-emerald-50/80 border-2 border-emerald-300 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-black text-emerald-950">
                        Master / Client Login (Direct ID &amp; Password)
                      </div>
                      <div className="text-[11px] font-semibold text-emerald-900">
                        Koi Email ya Google nahi — seedha Login ID aur Password daal kar kholein
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        AppSounds.tap();
                        onClose();
                        onOpenSellerLoginMode();
                      }}
                      className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-extrabold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl cursor-pointer shadow-sm transition-colors"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      <span>ID / Pass Login</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Connected Status Bar */}
                  <div className="bg-white border border-emerald-200 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-5 h-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-extrabold text-emerald-950 flex items-center gap-1.5 flex-wrap">
                          <span>Live Cloud Sync Active</span>
                          <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-mono-tabular text-[10px]">
                            {connectedCount}/{sellers.length} Phones Active
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-800 text-[10px] font-bold">
                            Auto-Login Saved
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 truncate">
                          Admin: {adminEmail || 'Connected'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                      {partyList.some((p) => p.role !== 'master') && (
                        <button
                          type="button"
                          disabled={cloudBusy}
                          onClick={() => {
                            AppSounds.tap();
                            void onEnableChainAll();
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-white kk-brand-gradient rounded-xl cursor-pointer disabled:opacity-50"
                        >
                          <Users className="w-3.5 h-3.5" />
                          <span>Enable Chain All</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={cloudBusy || syncingNow}
                        onClick={() => void handleInstantSyncAll()}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl cursor-pointer disabled:opacity-50 transition-colors ${
                          justSynced
                            ? 'text-emerald-800 bg-emerald-50 border border-emerald-200'
                            : 'text-[var(--kk-brand)] bg-indigo-50 hover:bg-indigo-100 border border-indigo-200'
                        }`}
                      >
                        {justSynced ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <RefreshCw className={`w-3.5 h-3.5 ${cloudBusy || syncingNow ? 'animate-spin' : ''}`} />
                        )}
                        <span>{syncingNow || cloudBusy ? 'Syncing...' : justSynced ? 'Synced ✓' : 'Sync IDs'}</span>
                      </button>
                      {!confirmSignOut ? (
                        <button
                          type="button"
                          onClick={() => {
                            AppSounds.tap();
                            setConfirmSignOut(true);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Sign Out</span>
                        </button>
                      ) : (
                        <div className="inline-flex items-center gap-1 bg-rose-50 border border-rose-200 rounded-xl p-1">
                          <button
                            type="button"
                            onClick={() => {
                              AppSounds.tap();
                              setConfirmSignOut(false);
                              void onSignOut();
                            }}
                            className="px-2 py-1 text-[11px] font-extrabold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer"
                          >
                            Confirm Logout
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              AppSounds.tap();
                              setConfirmSignOut(false);
                            }}
                            className="px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-white rounded-lg cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quick Add New Seller Bar */}
                  <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 shadow-xs space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-extrabold text-slate-950">
                          Naya Seller Add Karein ({sellers.length} Saved)
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Naam aur Rate daalte hi uska naya Seller ID &amp; WhatsApp Link ban jayega
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          AppSounds.tap();
                          setShowAddForm((v) => !v);
                        }}
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl kk-brand-gradient text-white text-xs font-extrabold shadow-xs hover:opacity-95 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{showAddForm ? 'Close' : 'Add Seller'}</span>
                      </button>
                    </div>

                    {showAddForm && (
                      <form
                        onSubmit={handleQuickAddSeller}
                        className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-12 gap-2"
                      >
                        <input
                          type="text"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder="Seller Name (e.g. RAHUL)"
                          required
                          className="sm:col-span-5 px-3 py-2 text-xs font-bold uppercase text-slate-950 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-[var(--kk-brand)] focus:bg-white"
                        />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={newRate}
                          onChange={(e) => setNewRate(e.target.value)}
                          placeholder="Rate ₹"
                          required
                          className="sm:col-span-2 px-3 py-2 text-xs font-bold font-mono-tabular text-slate-950 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-[var(--kk-brand)] focus:bg-white"
                        />
                        <input
                          type="tel"
                          value={newMobile}
                          onChange={(e) => setNewMobile(e.target.value)}
                          placeholder="Mobile (Optional)"
                          className="sm:col-span-3 px-3 py-2 text-xs font-bold font-mono-tabular text-slate-950 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-[var(--kk-brand)] focus:bg-white"
                        />
                        <button
                          type="submit"
                          className="sm:col-span-2 px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold cursor-pointer transition-colors"
                        >
                          Save &amp; ID
                        </button>
                      </form>
                    )}
                  </div>

                  {/* Seller IDs List */}
                  <div className="space-y-2.5">
                    {sellers.length === 0 ? (
                      <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center space-y-1.5">
                        <UserPlus className="w-6 h-6 text-slate-400 mx-auto" />
                        <div className="text-xs font-bold text-slate-800">
                          Abhi koi seller add nahi hai
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Upar "+ Add Seller" dabakar naya seller add karein — ID apne aap ban jayega.
                        </div>
                      </div>
                    ) : (
                      sellers.map((seller) => {
                        const party = partiesBySellerId[seller.id];
                        const priv = party ? privatesByPartyId[party.partyId] : undefined;
                        const mobile = priv?.mobile || seller.mobile || '';
                        const isBusy = busyPartyId === party?.partyId;

                        if (!party) {
                          return (
                            <div
                              key={seller.id}
                              className="bg-white border border-slate-200 rounded-2xl p-3.5 flex items-center justify-between gap-3"
                            >
                              <div>
                                <div className="text-sm font-extrabold text-slate-950">
                                  {seller.name || 'Unnamed Seller'}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  Rate ₹{seller.rate} · ID sync pending...
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={cloudBusy || syncingNow}
                                onClick={() => void handleInstantSyncAll()}
                                className="px-3 py-1.5 text-xs font-bold text-white kk-brand-gradient rounded-xl cursor-pointer disabled:opacity-50"
                              >
                                {syncingNow ? 'Syncing...' : 'Generate ID'}
                              </button>
                            </div>
                          );
                        }

                        const loginId = priv?.loginId || '';
                        const loginPass = priv?.loginPassword || '';
                        const hasEasyCreds = Boolean(loginId && loginPass);
                        const inviteLink = hasEasyCreds
                          ? buildSellerPortalUrl(loginId, false)
                          : buildSellerPortalUrl(party.accessKey, true);
                        const { waUrl } = buildSellerInviteWhatsAppUrl(
                          party.name,
                          party.rate,
                          mobile,
                          hasEasyCreds ? loginId : party.accessKey,
                          loginPass
                        );
                        const copyCredsText = hasEasyCreds
                          ? `Login ID: ${loginId}\nPassword: ${loginPass}\nLink: ${inviteLink}`
                          : party.accessKey;
                        const isClaimed = Boolean(party.assignedUid);

                        return (
                          <div
                            key={seller.id}
                            className={`bg-white border rounded-2xl p-3.5 space-y-3 shadow-xs transition-colors ${
                              party.active
                                ? 'border-slate-200/90'
                                : 'border-rose-200 bg-rose-50/35'
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-black text-slate-950">
                                    {party.name}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[11px] font-bold font-mono-tabular text-slate-800">
                                    Rate ₹{party.rate}
                                  </span>
                                  {!party.active ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[10.5px] font-extrabold">
                                      <CloudOff className="w-3 h-3" />
                                      Paused
                                    </span>
                                  ) : isClaimed ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10.5px] font-extrabold">
                                      <Smartphone className="w-3 h-3" />
                                      Phone Connected
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10.5px] font-extrabold">
                                      <KeyRound className="w-3 h-3" />
                                      Ready to Login
                                    </span>
                                  )}
                                  {party.role === 'master' && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-100 text-[var(--kk-brand)] text-[10.5px] font-extrabold">
                                      <Users className="w-3 h-3" />
                                      Chain ({subSellersCountByMasterId[party.partyId] || 0} Sub)
                                    </span>
                                  )}
                                </div>
                                {mobile && (
                                  <div className="text-[11px] font-mono-tabular text-slate-500 mt-0.5">
                                    Mob: {mobile}
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={async () => {
                                    AppSounds.tap();
                                    setBusyPartyId(party.partyId);
                                    try {
                                      await onTogglePartyChainRole(
                                        party,
                                        party.role === 'master' ? 'client' : 'master'
                                      );
                                    } finally {
                                      setBusyPartyId('');
                                    }
                                  }}
                                  title={
                                    party.role === 'master'
                                      ? 'Chain ON: Seller aage aur Sub-Sellers ko ID de sakta hai (Tap to turn OFF)'
                                      : 'Chain OFF: Tap karke is Seller ko Sub-Seller ID banane ka permission dein'
                                  }
                                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-xl border cursor-pointer transition-colors disabled:opacity-50 ${
                                    party.role === 'master'
                                      ? 'text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border-indigo-200'
                                      : 'text-slate-700 bg-slate-100 hover:bg-slate-200 border-slate-200'
                                  }`}
                                >
                                  <Users className="w-3.5 h-3.5" />
                                  <span>{party.role === 'master' ? 'Chain ON' : 'Chain OFF'}</span>
                                </button>

                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={async () => {
                                    AppSounds.tap();
                                    setBusyPartyId(party.partyId);
                                    try {
                                      await onTogglePartyActive(party, !party.active);
                                    } finally {
                                      setBusyPartyId('');
                                    }
                                  }}
                                  title={party.active ? 'Pause Seller Access' : 'Activate Seller Access'}
                                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-xl border cursor-pointer transition-colors disabled:opacity-50 ${
                                    party.active
                                      ? 'text-amber-800 bg-amber-50 hover:bg-amber-100 border-amber-200'
                                      : 'text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'
                                  }`}
                                >
                                  {party.active ? (
                                    <>
                                      <PauseCircle className="w-3.5 h-3.5" />
                                      <span>Pause</span>
                                    </>
                                  ) : (
                                    <>
                                      <PlayCircle className="w-3.5 h-3.5" />
                                      <span>Resume</span>
                                    </>
                                  )}
                                </button>

                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={async () => {
                                    AppSounds.warning();
                                    setBusyPartyId(party.partyId);
                                    try {
                                      await onResetPartyKey(party);
                                    } finally {
                                      setBusyPartyId('');
                                    }
                                  }}
                                  title="Purane phone ko logout karein aur naya Password banayein"
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl cursor-pointer transition-colors disabled:opacity-50"
                                >
                                  <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                                  <span>New Pass</span>
                                </button>
                              </div>
                            </div>

                            {/* Easy Login ID & Password Display + Share Actions */}
                            <div className="bg-slate-50 border border-slate-200/90 rounded-xl px-3 py-2.5 space-y-2.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                {hasEasyCreds ? (
                                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                                    <div className="px-2.5 py-1 rounded-lg bg-white border border-indigo-200/80">
                                      <div className="text-[9.5px] font-extrabold uppercase tracking-wider text-slate-500">
                                        Login ID
                                      </div>
                                      <div className="text-xs sm:text-sm font-black font-mono-tabular text-[var(--kk-brand)] select-all">
                                        {loginId}
                                      </div>
                                    </div>
                                    <div className="px-2.5 py-1 rounded-lg bg-white border border-emerald-200/80">
                                      <div className="text-[9.5px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                                        <Lock className="w-2.5 h-2.5 text-emerald-700" />
                                        <span>Password</span>
                                      </div>
                                      <div className="text-xs sm:text-sm font-black font-mono-tabular text-emerald-800 select-all">
                                        {loginPass}
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-xs font-bold text-amber-800">
                                    Easy ID/Pass sync ho raha hai — &ldquo;Sync IDs&rdquo; dabayein
                                  </div>
                                )}

                                <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
                                  <button
                                    type="button"
                                    onClick={() => openEditCreds(party, priv)}
                                    title="Apni pasand ka Login ID & Password set karein"
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                    <span>Edit</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => void copyText(copyCredsText, `id-${party.partyId}`)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer"
                                  >
                                    {copiedKey === `id-${party.partyId}` ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                    <span>
                                      {copiedKey === `id-${party.partyId}` ? 'Copied' : 'Copy ID/Pass'}
                                    </span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => void copyText(inviteLink, `link-${party.partyId}`)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer"
                                  >
                                    {copiedKey === `link-${party.partyId}` ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    ) : (
                                      <Link2 className="w-3.5 h-3.5" />
                                    )}
                                    <span>{copiedKey === `link-${party.partyId}` ? 'Copied' : 'Link'}</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      AppSounds.tap();
                                      onPreviewSeller(party);
                                    }}
                                    title="Preview how this Seller sees their mobile app"
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-[var(--kk-brand)] bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg cursor-pointer"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                    <span>Preview</span>
                                  </button>

                                  <a
                                    href={waUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => AppSounds.success()}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    <span>WhatsApp</span>
                                  </a>
                                </div>
                              </div>

                              {editingCredPartyId === party.partyId && (
                                <form
                                  onSubmit={(e) => void handleSaveCreds(e, party)}
                                  className="pt-2 border-t border-slate-200/80 grid grid-cols-1 sm:grid-cols-12 gap-2"
                                >
                                  <input
                                    type="text"
                                    required
                                    minLength={2}
                                    maxLength={32}
                                    value={editLoginId}
                                    onChange={(e) =>
                                      setEditLoginId(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))
                                    }
                                    placeholder="Enter Login ID"
                                    className="sm:col-span-5 px-2.5 py-1.5 text-xs font-black font-mono-tabular uppercase bg-white border border-slate-300 rounded-lg outline-none focus:border-[var(--kk-brand)]"
                                  />
                                  <input
                                    type="text"
                                    required
                                    minLength={4}
                                    maxLength={32}
                                    value={editLoginPass}
                                    onChange={(e) => setEditLoginPass(e.target.value)}
                                    placeholder="Password (min 4 digits)"
                                    className="sm:col-span-4 px-2.5 py-1.5 text-xs font-black font-mono-tabular bg-white border border-slate-300 rounded-lg outline-none focus:border-[var(--kk-brand)]"
                                  />
                                  <div className="sm:col-span-3 flex items-center gap-1">
                                    <button
                                      type="submit"
                                      disabled={isBusy}
                                      className="flex-1 px-2.5 py-1.5 text-xs font-extrabold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer disabled:opacity-50"
                                    >
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingCredPartyId(null)}
                                      className="px-2 py-1.5 text-xs font-bold text-slate-600 bg-slate-200/70 rounded-lg cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </form>
                              )}
                            </div>

                            {/* Multi-Level Chain Bar & Expandable Sub-Seller Tree */}
                            {party.role === 'master' && (() => {
                              const totalSubs =
                                countAllDescendants(party.partyId) ||
                                subSellersCountByMasterId[party.partyId] ||
                                0;
                              const isExpanded = Boolean(expandedMasters[party.partyId]);
                              const directSubs = childrenByParentId[party.partyId] || [];

                              const renderSubNodes = (
                                nodes: CloudPartyDoc[],
                                level: number
                              ) => (
                                <div className="space-y-2">
                                  {nodes.map((sub) => {
                                    const subPriv = privatesByPartyId[sub.partyId];
                                    const subMob = subPriv?.mobile || '';
                                    const subLoginId = subPriv?.loginId || '';
                                    const subLoginPass = subPriv?.loginPassword || '';
                                    const subHasCreds = Boolean(subLoginId && subLoginPass);
                                    const subLink = subHasCreds
                                      ? buildSellerPortalUrl(subLoginId, false)
                                      : buildSellerPortalUrl(sub.accessKey, true);
                                    const { waUrl: subWa } = buildSellerInviteWhatsAppUrl(
                                      sub.name,
                                      sub.rate,
                                      subMob,
                                      subHasCreds ? subLoginId : sub.accessKey,
                                      subLoginPass
                                    );
                                    const subCopyText = subHasCreds
                                      ? `Login ID: ${subLoginId}\nPassword: ${subLoginPass}\nLink: ${subLink}`
                                      : sub.accessKey;
                                    const subKids = childrenByParentId[sub.partyId] || [];
                                    const subBusy = busyPartyId === sub.partyId;

                                    return (
                                      <div
                                        key={sub.partyId}
                                        className={`rounded-xl border p-2.5 space-y-2 ${
                                          sub.active
                                            ? 'bg-indigo-50/45 border-indigo-200/80'
                                            : 'bg-rose-50/40 border-rose-200'
                                        }`}
                                      >
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                            <span className="px-1.5 py-0.5 rounded bg-[var(--kk-brand)] text-white text-[9.5px] font-black font-mono-tabular">
                                              L{level}
                                            </span>
                                            <span className="text-xs font-black text-slate-950">
                                              {sub.name}
                                            </span>
                                            <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-bold font-mono-tabular text-slate-800">
                                              ₹{sub.rate}
                                            </span>
                                            {!sub.active ? (
                                              <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-extrabold">
                                                Paused
                                              </span>
                                            ) : sub.assignedUid ? (
                                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">
                                                Phone Live
                                              </span>
                                            ) : (
                                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-extrabold">
                                                Ready
                                              </span>
                                            )}
                                            {sub.role === 'master' && (
                                              <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-[var(--kk-brand)] text-[10px] font-extrabold">
                                                Sub-Master ({subKids.length})
                                              </span>
                                            )}
                                          </div>

                                          <div className="flex items-center gap-1 flex-wrap">
                                            <button
                                              type="button"
                                              disabled={subBusy}
                                              onClick={async () => {
                                                AppSounds.tap();
                                                setBusyPartyId(sub.partyId);
                                                try {
                                                  await onTogglePartyChainRole(
                                                    sub,
                                                    sub.role === 'master' ? 'client' : 'master'
                                                  );
                                                } finally {
                                                  setBusyPartyId('');
                                                }
                                              }}
                                              className={`px-2 py-1 text-[10px] font-bold rounded-lg border cursor-pointer ${
                                                sub.role === 'master'
                                                  ? 'bg-indigo-100 text-indigo-900 border-indigo-200'
                                                  : 'bg-white text-slate-700 border-slate-200'
                                              }`}
                                            >
                                              {sub.role === 'master' ? 'Chain ON' : 'Chain OFF'}
                                            </button>

                                            {sub.role === 'master' && level < 5 && (
                                              <button
                                                type="button"
                                                onClick={() => openAssignSubForm(sub)}
                                                className="inline-flex items-center gap-0.5 px-2 py-1 text-[10px] font-extrabold rounded-lg kk-brand-gradient text-white cursor-pointer"
                                              >
                                                <Plus className="w-3 h-3" />
                                                <span>L{level + 1} ID</span>
                                              </button>
                                            )}

                                            <button
                                              type="button"
                                              disabled={subBusy}
                                              onClick={async () => {
                                                AppSounds.tap();
                                                setBusyPartyId(sub.partyId);
                                                try {
                                                  await onTogglePartyActive(sub, !sub.active);
                                                } finally {
                                                  setBusyPartyId('');
                                                }
                                              }}
                                              className="px-2 py-1 text-[10px] font-bold rounded-lg bg-white border border-slate-200 text-slate-700 cursor-pointer"
                                            >
                                              {sub.active ? 'Pause' : 'Resume'}
                                            </button>

                                            <button
                                              type="button"
                                              disabled={subBusy}
                                              onClick={async () => {
                                                AppSounds.warning();
                                                setBusyPartyId(sub.partyId);
                                                try {
                                                  await onResetPartyKey(sub);
                                                } finally {
                                                  setBusyPartyId('');
                                                }
                                              }}
                                              className="px-2 py-1 text-[10px] font-bold rounded-lg bg-white border border-slate-200 text-slate-700 cursor-pointer"
                                            >
                                              Reset
                                            </button>

                                            <button
                                              type="button"
                                              disabled={subBusy}
                                              onClick={async () => {
                                                AppSounds.warning();
                                                setBusyPartyId(sub.partyId);
                                                try {
                                                  await onDeleteSubParty(sub);
                                                } finally {
                                                  setBusyPartyId('');
                                                }
                                              }}
                                              aria-label={`Delete ${sub.name}`}
                                              className="p-1 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 cursor-pointer"
                                            >
                                              <Trash2 className="w-3 h-3" />
                                            </button>
                                          </div>
                                        </div>

                                        <div className="bg-white/90 border border-slate-200/80 rounded-lg px-2.5 py-1.5 space-y-2">
                                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                                            {subHasCreds ? (
                                              <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono-tabular">
                                                <span className="font-black text-[var(--kk-brand)] select-all">
                                                  ID: {subLoginId}
                                                </span>
                                                <span className="text-slate-300">|</span>
                                                <span className="font-black text-emerald-800 select-all">
                                                  Pass: {subLoginPass}
                                                </span>
                                              </div>
                                            ) : (
                                              <span className="text-[10.5px] font-bold text-amber-800">
                                                Tap &ldquo;Sync IDs&rdquo; ya &ldquo;Edit&rdquo; for ID/Pass
                                              </span>
                                            )}
                                            <div className="flex items-center gap-1 shrink-0 flex-wrap">
                                              <button
                                                type="button"
                                                onClick={() => openEditCreds(sub, subPriv)}
                                                className="px-2 py-1 text-[10px] font-bold bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md cursor-pointer"
                                              >
                                                Edit
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  void copyText(subCopyText, `id-${sub.partyId}`)
                                                }
                                                className="px-2 py-1 text-[10px] font-bold bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md cursor-pointer"
                                              >
                                                {copiedKey === `id-${sub.partyId}` ? 'Copied' : 'ID/Pass'}
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  void copyText(subLink, `link-${sub.partyId}`)
                                                }
                                                className="px-2 py-1 text-[10px] font-bold bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md cursor-pointer"
                                              >
                                                {copiedKey === `link-${sub.partyId}` ? 'Copied' : 'Link'}
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  AppSounds.tap();
                                                  onPreviewSeller(sub);
                                                }}
                                                className="px-2 py-1 text-[10px] font-bold text-[var(--kk-brand)] bg-indigo-50 border border-indigo-200 rounded-md cursor-pointer"
                                              >
                                                Preview
                                              </button>
                                              <a
                                                href={subWa}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={() => AppSounds.success()}
                                                className="px-2 py-1 text-[10px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md"
                                              >
                                                WA
                                              </a>
                                            </div>
                                          </div>

                                          {editingCredPartyId === sub.partyId && (
                                            <form
                                              onSubmit={(e) => void handleSaveCreds(e, sub)}
                                              className="pt-1.5 border-t border-slate-200/80 grid grid-cols-1 sm:grid-cols-12 gap-1.5"
                                            >
                                              <input
                                                type="text"
                                                required
                                                minLength={2}
                                                maxLength={32}
                                                value={editLoginId}
                                                onChange={(e) =>
                                                  setEditLoginId(
                                                    e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '')
                                                  )
                                                }
                                                placeholder="Login ID"
                                                className="sm:col-span-5 px-2 py-1 text-[11px] font-black font-mono-tabular uppercase bg-slate-50 border border-slate-300 rounded-md"
                                              />
                                              <input
                                                type="text"
                                                required
                                                minLength={4}
                                                maxLength={32}
                                                value={editLoginPass}
                                                onChange={(e) => setEditLoginPass(e.target.value)}
                                                placeholder="Password"
                                                className="sm:col-span-4 px-2 py-1 text-[11px] font-black font-mono-tabular bg-slate-50 border border-slate-300 rounded-md"
                                              />
                                              <div className="sm:col-span-3 flex items-center gap-1">
                                                <button
                                                  type="submit"
                                                  disabled={subBusy}
                                                  className="flex-1 px-2 py-1 text-[10px] font-extrabold text-white bg-emerald-700 rounded-md cursor-pointer"
                                                >
                                                  Save
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => setEditingCredPartyId(null)}
                                                  className="px-2 py-1 text-[10px] font-bold text-slate-600 bg-slate-200/70 rounded-md cursor-pointer"
                                                >
                                                  ×
                                                </button>
                                              </div>
                                            </form>
                                          )}
                                        </div>

                                        {/* Inline Level+1 Assign Form under this Sub-Master */}
                                        {assigningParentId === sub.partyId && (
                                          <form
                                            onSubmit={(e) => void handleAssignSubSubmit(e, sub)}
                                            className="bg-white border border-indigo-200 rounded-xl p-2.5 grid grid-cols-1 sm:grid-cols-12 gap-1.5"
                                          >
                                            <input
                                              type="text"
                                              value={subName}
                                              onChange={(e) => setSubName(e.target.value)}
                                              placeholder={`L${level + 1} Seller under ${sub.name}`}
                                              required
                                              className="sm:col-span-5 px-2.5 py-1.5 text-xs font-bold uppercase bg-slate-50 border border-slate-200 rounded-lg"
                                            />
                                            <input
                                              type="number"
                                              step="0.01"
                                              min="0"
                                              value={subRate}
                                              onChange={(e) => setSubRate(e.target.value)}
                                              placeholder="Rate ₹"
                                              required
                                              className="sm:col-span-2 px-2.5 py-1.5 text-xs font-bold font-mono-tabular bg-slate-50 border border-slate-200 rounded-lg"
                                            />
                                            <input
                                              type="tel"
                                              value={subMobile}
                                              onChange={(e) => setSubMobile(e.target.value)}
                                              placeholder="Mobile"
                                              className="sm:col-span-3 px-2.5 py-1.5 text-xs font-bold font-mono-tabular bg-slate-50 border border-slate-200 rounded-lg"
                                            />
                                            <button
                                              type="submit"
                                              disabled={subBusy}
                                              className="sm:col-span-2 px-2.5 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-extrabold cursor-pointer"
                                            >
                                              Assign
                                            </button>
                                            <label className="sm:col-span-12 flex items-center gap-1.5 text-[10.5px] font-bold text-slate-700 cursor-pointer">
                                              <input
                                                type="checkbox"
                                                checked={subAllowChain}
                                                onChange={(e) => setSubAllowChain(e.target.checked)}
                                                className="accent-[var(--kk-brand)]"
                                              />
                                              <span>Allow further Sub-Chain IDs</span>
                                            </label>
                                          </form>
                                        )}

                                        {subKids.length > 0 && (
                                          <div className="pl-3 border-l-2 border-indigo-200">
                                            {renderSubNodes(subKids, level + 1)}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              );

                              return (
                                <div className="pt-1 border-t border-slate-100 space-y-2.5">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        AppSounds.tap();
                                        setExpandedMasters((prev) => ({
                                          ...prev,
                                          [party.partyId]: !prev[party.partyId],
                                        }));
                                      }}
                                      className="inline-flex items-center gap-1 text-[11px] font-extrabold text-[var(--kk-brand)] hover:underline cursor-pointer"
                                    >
                                      {isExpanded ? (
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      ) : (
                                        <ChevronRight className="w-3.5 h-3.5" />
                                      )}
                                      <span>
                                        Sub-Seller Chain ({totalSubs} Assigned)
                                      </span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => openAssignSubForm(party)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-extrabold text-[var(--kk-brand)] bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg cursor-pointer"
                                    >
                                      <Plus className="w-3 h-3" />
                                      <span>
                                        {assigningParentId === party.partyId
                                          ? 'Close'
                                          : 'Assign Sub-ID'}
                                      </span>
                                    </button>
                                  </div>

                                  {assigningParentId === party.partyId && (
                                    <form
                                      onSubmit={(e) => void handleAssignSubSubmit(e, party)}
                                      className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-12 gap-2"
                                    >
                                      <input
                                        type="text"
                                        value={subName}
                                        onChange={(e) => setSubName(e.target.value)}
                                        placeholder={`Sub-Seller under ${party.name}`}
                                        required
                                        className="sm:col-span-5 px-2.5 py-2 text-xs font-bold uppercase bg-white border border-slate-200 rounded-lg outline-none focus:border-[var(--kk-brand)]"
                                      />
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={subRate}
                                        onChange={(e) => setSubRate(e.target.value)}
                                        placeholder="Rate ₹"
                                        required
                                        className="sm:col-span-2 px-2.5 py-2 text-xs font-bold font-mono-tabular bg-white border border-slate-200 rounded-lg outline-none focus:border-[var(--kk-brand)]"
                                      />
                                      <input
                                        type="tel"
                                        value={subMobile}
                                        onChange={(e) => setSubMobile(e.target.value)}
                                        placeholder="Mobile (Optional)"
                                        className="sm:col-span-3 px-2.5 py-2 text-xs font-bold font-mono-tabular bg-white border border-slate-200 rounded-lg outline-none focus:border-[var(--kk-brand)]"
                                      />
                                      <button
                                        type="submit"
                                        disabled={isBusy}
                                        className="sm:col-span-2 px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold cursor-pointer disabled:opacity-50"
                                      >
                                        Assign ID
                                      </button>
                                      <label className="sm:col-span-12 flex items-center gap-2 text-[11px] font-bold text-slate-700 cursor-pointer select-none">
                                        <input
                                          type="checkbox"
                                          checked={subAllowChain}
                                          onChange={(e) => setSubAllowChain(e.target.checked)}
                                          className="w-3.5 h-3.5 accent-[var(--kk-brand)] cursor-pointer"
                                        />
                                        <span>
                                          Multi-Level Chain ON (Yeh Sub-Seller bhi aage apne Sub-IDs bana sake)
                                        </span>
                                      </label>
                                    </form>
                                  )}

                                  {isExpanded && (
                                    <div className="pl-2.5 border-l-2 border-indigo-200/90 space-y-2">
                                      {directSubs.length === 0 ? (
                                        <div className="text-[11px] text-slate-500 font-medium py-1">
                                          Abhi koi Sub-Seller assign nahi hai. Upar "+ Assign Sub-ID" dabakar banayein ya {party.name} apne phone ke Chain tab se bana sakte hain.
                                        </div>
                                      ) : (
                                        renderSubNodes(directSubs, 2)
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })
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
