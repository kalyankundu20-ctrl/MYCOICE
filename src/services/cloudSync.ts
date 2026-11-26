import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { AppState, DaySnapshot, Seller, SellerBillRow, SessionId, TicketEntryRow } from '../types/ledger';

export const AGENCY_ID = 'kk-main';
export const BOOTSTRAP_ADMIN_EMAIL = 'kalyankundu20@gmail.com';
const ADMIN_ACCESS_KEY = 'KK_ADMIN_MASTER_ACCESS_KEY_01';

export type CloudRole = 'admin' | 'master' | 'client';

export interface CloudUserProfile {
  uid: string;
  agencyId: string;
  partyId: string;
  role: CloudRole;
}

export interface CloudAgencyDoc {
  agencyId: string;
  name: string;
  ownerUid: string;
  adminUids: string[];
  date: string;
  limitThreshold: number;
  sellerLimitThreshold?: number;
  excludedPrizeNames: string[];
  itemOptions: string[];
  winning1PM: string;
  winning6PM: string;
  winning8PM: string;
}

export interface CloudPartyDoc {
  agencyId: string;
  partyId: string;
  name: string;
  role: CloudRole;
  parentMasterId: string;
  parentMasterUid: string;
  ancestorMasterIds?: string[];
  ancestorMasterUids?: string[];
  ownerUid: string;
  adminUids: string[];
  rate: number;
  due: number;
  joma: number;
  active: boolean;
  accessKey: string;
  assignedUid: string;
}

export interface CloudPartyPrivateDoc {
  agencyId: string;
  partyId: string;
  ownerUid: string;
  adminUids: string[];
  parentMasterId?: string;
  parentMasterUid: string;
  mobile: string;
  assignedEmail: string;
  loginId?: string;
  loginPassword?: string;
}

export interface CloudPartySheetDoc {
  agencyId: string;
  sheetId: string;
  partyId: string;
  partyName: string;
  role: CloudRole;
  ownerUid: string;
  adminUids: string[];
  assignedUid: string;
  parentMasterId: string;
  parentMasterUid: string;
  ancestorMasterIds?: string[];
  ancestorMasterUids?: string[];
  date: string;
  entries1PM: TicketEntryRow[];
  entries6PM: TicketEntryRow[];
  entries8PM: TicketEntryRow[];
  updatedByUid: string;
}

export interface CloudPartyInviteDoc {
  accessKey: string;
  agencyId: string;
  partyId: string;
  partyName: string;
  role: CloudRole;
  parentMasterId: string;
  parentMasterUid: string;
  ownerUid: string;
  createdByUid: string;
  active: boolean;
}

function sanitizeId(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!cleaned) return fallback;
  return cleaned.slice(0, 120);
}

export function makePartyIdFromSeller(seller: Seller): string {
  return sanitizeId(seller.id || `seller-${seller.name}`, `seller-${Date.now()}`);
}

export function normalizeLoginId(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_\-]/g, '')
    .slice(0, 32);
}

export function generateEasyLoginId(sellerName: string, usedLoginIds?: Set<string>): string {
  let base = sellerName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  if (base.length < 2) {
    base = `${base || 'KK'}01`;
  }
  if (!usedLoginIds || !usedLoginIds.has(base)) {
    usedLoginIds?.add(base);
    return base;
  }
  for (let n = 2; n <= 99; n += 1) {
    const candidate = `${base.slice(0, 10)}${n}`;
    if (!usedLoginIds.has(candidate)) {
      usedLoginIds.add(candidate);
      return candidate;
    }
  }
  const suffix = String(Math.floor(100 + Math.random() * 900));
  const fallback = `${base.slice(0, 9)}${suffix}`;
  usedLoginIds.add(fallback);
  return fallback;
}

export function generateEasyPassword(): string {
  const bytes = new Uint8Array(6);
  let digits = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
    for (let i = 0; i < 6; i += 1) {
      digits += String(bytes[i] % 10);
    }
  } else {
    for (let i = 0; i < 6; i += 1) {
      digits += String(Math.floor(Math.random() * 10));
    }
  }
  return digits;
}

// Pure-JS SHA-256 fallback used only if crypto.subtle is unavailable (e.g. non-HTTPS local preview)
function sha256FallbackHex(str: string): string {
  const rightRotate = (value: number, amount: number) =>
    (value >>> amount) | (value << (32 - amount));
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const words: number[] = [];
  const ascii = unescape(encodeURIComponent(str));
  const asciiBitLength = ascii.length * 8;

  const hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;
  const isComposite: Record<number, number> = {};
  for (let candidate = 2; primeCounter < 64; candidate += 1) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      primeCounter += 1;
    }
  }

  const padded = `${ascii}\x80${'\x00'.repeat((64 - ((ascii.length + 9) % 64)) % 64)}`;
  for (let i = 0; i < padded.length; i += 1) {
    const j = padded.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength | 0;

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);
    for (let i = 0; i < 64; i += 1) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const a = hash[0];
      const e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash.unshift((temp1 + temp2) | 0);
      hash[4] = (hash[4] + temp1) | 0;
      hash.pop();
    }
    for (let i = 0; i < 8; i += 1) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  let result = '';
  for (let i = 0; i < 8; i += 1) {
    for (let j = 3; j >= 0; j -= 1) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

async function sha256Hex(input: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Fallback to pure-JS SHA-256
  }
  return sha256FallbackHex(input);
}

/**
 * Deterministic SHA-256 credential proof key (`cred_<44 hex chars>`) used as the unlisted
 * /partyInvites/{accessKey} document ID so ONLY a user knowing both Login ID & Password can claim.
 */
export async function computeCredentialAccessKey(
  rawLoginId: string,
  rawPassword: string
): Promise<string> {
  const cleanId = normalizeLoginId(rawLoginId);
  const cleanPass = rawPassword.trim();
  const payload = `kk-agency-cred-v1::${AGENCY_ID}::${cleanId}::${cleanPass}`;
  const hex = await sha256Hex(payload);
  return `cred_${hex.slice(0, 44)}`;
}

export function generateSellerAccessKey(sellerName: string): string {
  const slug =
    sellerName
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8) || 'SELLER';
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  const bytes = new Uint8Array(10);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) {
      rand += alphabet[bytes[i] % alphabet.length];
    }
  } else {
    for (let i = 0; i < 10; i++) {
      rand += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  }
  const key = `KK-${slug}-${rand}`;
  return key.length >= 16 ? key.slice(0, 48) : `${key}XXXXXX`.slice(0, 18);
}

const DEFAULT_PUBLIC_APP_ORIGIN = 'https://mlot-blue.vercel.app';

function resolvePublicAppOrigin(): string {
  const envOrigin = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
  if (envOrigin) {
    try {
      return new URL(envOrigin).origin;
    } catch {
      // Fall through to host inspection
    }
  }
  if (typeof window === 'undefined') return DEFAULT_PUBLIC_APP_ORIGIN;
  const host = window.location.hostname.toLowerCase();
  const isPrivateVercelPreview =
    host.endsWith('.vercel.app') &&
    host !== 'mlot-blue.vercel.app' &&
    (/-kalyan-[a-z0-9-]+\.vercel\.app$/i.test(host) ||
      /^mlot-[a-z0-9]{6,}-.+\.vercel\.app$/i.test(host) ||
      /^mlot-git-.+\.vercel\.app$/i.test(host));
  const isAiStudioPreviewHost = /^ais-(dev|pre)-[a-z0-9-]+\.run\.app$/i.test(host);

  if (isPrivateVercelPreview || isAiStudioPreviewHost) {
    return DEFAULT_PUBLIC_APP_ORIGIN;
  }
  return window.location.origin;
}

export function buildSellerPortalUrl(loginIdOrKey?: string, isLegacyKey = false): string {
  const clean = (loginIdOrKey || '').trim();
  const baseOrigin = resolvePublicAppOrigin();
  const url = new URL(`${baseOrigin}/`);
  if (!clean) {
    url.searchParams.set('login', '1');
  } else if (isLegacyKey) {
    url.searchParams.set('sellerId', clean);
  } else {
    url.searchParams.set('id', normalizeLoginId(clean));
  }
  return url.toString();
}

export function buildSellerInviteWhatsAppUrl(
  sellerName: string,
  rate: number,
  mobile: string,
  loginId: string,
  loginPassword: string
): { message: string; waUrl: string } {
  const hasCreds = Boolean(loginId && loginPassword);
  const link = hasCreds ? buildSellerPortalUrl(loginId, false) : buildSellerPortalUrl(loginId, true);
  const message = hasCreds
    ? [
        `*KK Agency — Mobile App Login*`,
        `Name: *${sellerName}*`,
        `Rate: ₹${rate}`,
        ``,
        `Login ID: *${loginId}*`,
        `Password: *${loginPassword}*`,
        ``,
        `Direct App Link:`,
        link,
        ``,
        `Link open karke upar diya hua Login ID aur Password daalein — bina kisi email ke seedha app khul jayega!`,
      ].join('\n')
    : [
        `*KK Agency — Mobile App Login*`,
        `Name: *${sellerName}*`,
        `Rate: ₹${rate}`,
        ``,
        `Direct App Link:`,
        link,
      ].join('\n');

  const cleanMobile = mobile.replace(/\D/g, '');
  const fullMobile = cleanMobile.length === 10 ? `91${cleanMobile}` : cleanMobile;
  const waUrl = fullMobile
    ? `https://wa.me/${fullMobile}?text=${encodeURIComponent(message)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;

  return { message, waUrl };
}

function sanitizeIsoDate(date: string): string {
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return date;
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sanitizeNumber(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

function sanitizeItemOptions(opts: string[]): string[] {
  const cleaned = (Array.isArray(opts) ? opts : [])
    .map((s) => String(s || '').trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20);
  return cleaned.length > 0 ? cleaned : ['M5', 'M10', 'M15', 'M20'];
}

function sanitizeStringList(list: string[], maxLen: number): string[] {
  return (Array.isArray(list) ? list : [])
    .map((s) => String(s || '').trim().toUpperCase())
    .filter(Boolean)
    .slice(0, maxLen);
}

export function sanitizeSheetEntriesForCloud(
  rows: TicketEntryRow[],
  forcedSellerName?: string
): TicketEntryRow[] {
  const out: TicketEntryRow[] = [];
  for (let i = 0; i < rows.length && out.length < 500; i++) {
    const r = rows[i];
    const isBlank =
      !r.name.trim() &&
      !r.item.trim() &&
      !r.start.trim() &&
      !r.end.trim() &&
      !r.qtyOverride.trim() &&
      !r.rangeOverride.trim();
    if (isBlank) continue;
    out.push({
      id: String(r.id || `r-${i}`),
      name: forcedSellerName ? forcedSellerName : String(r.name || ''),
      item: String(r.item || ''),
      start: String(r.start || ''),
      end: String(r.end || ''),
      qtyOverride: String(r.qtyOverride || ''),
      rangeOverride: String(r.rangeOverride || ''),
    });
  }
  return out;
}

export function serializeSheetEntries(
  e1: TicketEntryRow[],
  e6: TicketEntryRow[],
  e8: TicketEntryRow[]
): string {
  const norm = (rows: TicketEntryRow[]) =>
    rows.map((r) => [r.id, r.name, r.item, r.start, r.end, r.qtyOverride, r.rangeOverride]);
  return JSON.stringify([norm(e1), norm(e6), norm(e8)]);
}

/**
 * Resolve the signed-in user's role & active session from Firestore.
 */
export async function loadUserCloudSession(
  uid: string,
  email: string | null
): Promise<
  | { kind: 'admin'; agencyId: string; ownerUid: string }
  | { kind: 'seller'; agencyId: string; partyId: string }
  | { kind: 'none' }
> {
  // Always keep Bootstrap Admin in Admin Mode so testing a Seller link never traps the Admin
  if (email && email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) {
    return { kind: 'admin', agencyId: AGENCY_ID, ownerUid: uid };
  }

  const profilePath = `userProfiles/${uid}`;
  try {
    const profileSnap = await getDoc(doc(db, 'userProfiles', uid));
    if (profileSnap.exists()) {
      const p = profileSnap.data() as CloudUserProfile;
      if (p.role === 'admin') {
        return { kind: 'admin', agencyId: p.agencyId || AGENCY_ID, ownerUid: uid };
      }
      if (p.role === 'client' || p.role === 'master') {
        const memberPath = `agencies/${p.agencyId}/members/${uid}`;
        try {
          const memberSnap = await getDoc(doc(db, 'agencies', p.agencyId, 'members', uid));
          if (memberSnap.exists() && memberSnap.data()?.active === true) {
            return { kind: 'seller', agencyId: p.agencyId, partyId: p.partyId };
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, memberPath);
        }
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, profilePath);
  }

  return { kind: 'none' };
}

/**
 * Ensure the Admin's agency root, member authority, profile pointer, and private config exist.
 */
export async function bootstrapAdminAgency(
  adminUid: string,
  state: AppState
): Promise<CloudAgencyDoc> {
  const agencyRef = doc(db, 'agencies', AGENCY_ID);
  const memberRef = doc(db, 'agencies', AGENCY_ID, 'members', adminUid);
  const profileRef = doc(db, 'userProfiles', adminUid);
  const privateRef = doc(db, 'agencies', AGENCY_ID, 'private', 'config');

  let existingAgency: CloudAgencyDoc | null = null;
  try {
    const snap = await getDoc(agencyRef);
    if (snap.exists()) {
      existingAgency = snap.data() as CloudAgencyDoc;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `agencies/${AGENCY_ID}`);
  }

  const cleanDate = sanitizeIsoDate(state.date);
  const cleanLimit = sanitizeNumber(state.config.limitThreshold, 1, 1000, 10);
  const cleanSellerLimit = sanitizeNumber(state.config.sellerLimitThreshold ?? 20, 1, 1000, 20);
  const cleanExcluded = sanitizeStringList(state.config.excludedPrizeNames, 50);
  const cleanItems = sanitizeItemOptions(state.config.itemOptions);
  const cleanWin1 = String(state.winningRaw['1PM'] || '').slice(0, 20000);
  const cleanWin6 = String(state.winningRaw['6PM'] || '').slice(0, 20000);
  const cleanWin8 = String(state.winningRaw['8PM'] || '').slice(0, 20000);

  if (!existingAgency) {
    const batch = writeBatch(db);
    const agencyPayload = {
      agencyId: AGENCY_ID,
      name: 'KK Agency',
      ownerUid: adminUid,
      adminUids: [adminUid],
      date: cleanDate,
      limitThreshold: cleanLimit,
      sellerLimitThreshold: cleanSellerLimit,
      excludedPrizeNames: cleanExcluded,
      itemOptions: cleanItems,
      winning1PM: cleanWin1,
      winning6PM: cleanWin6,
      winning8PM: cleanWin8,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    batch.set(agencyRef, agencyPayload);
    batch.set(memberRef, {
      agencyId: AGENCY_ID,
      uid: adminUid,
      partyId: 'admin-owner',
      role: 'admin',
      parentMasterId: '',
      ownerUid: adminUid,
      accessKey: ADMIN_ACCESS_KEY,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(profileRef, {
      uid: adminUid,
      agencyId: AGENCY_ID,
      partyId: 'admin-owner',
      role: 'admin',
      updatedAt: serverTimestamp(),
    });
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `agencies/${AGENCY_ID}`);
    }

    try {
      await setDoc(privateRef, {
        agencyId: AGENCY_ID,
        ownerUid: adminUid,
        whatsappNumber: String(state.config.whatsappNumber || '').slice(0, 30),
        autoArchiveDaily: false,
        pausedAutoArchiveDate: '',
        extraNames: sanitizeStringList(state.extraNames, 100),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `agencies/${AGENCY_ID}/private/config`);
    }

    return {
      agencyId: AGENCY_ID,
      name: 'KK Agency',
      ownerUid: adminUid,
      adminUids: [adminUid],
      date: cleanDate,
      limitThreshold: cleanLimit,
      sellerLimitThreshold: cleanSellerLimit,
      excludedPrizeNames: cleanExcluded,
      itemOptions: cleanItems,
      winning1PM: cleanWin1,
      winning6PM: cleanWin6,
      winning8PM: cleanWin8,
    };
  }

  // Ensure admin's member & profile docs exist and have role === 'admin' (self-heal if Admin tested a Seller ID earlier)
  try {
    const [mSnap, pSnap] = await Promise.all([getDoc(memberRef), getDoc(profileRef)]);
    const mData = mSnap.exists() ? mSnap.data() : null;
    const pData = pSnap.exists() ? pSnap.data() : null;
    const needsMemberFix =
      !mData || mData.role !== 'admin' || mData.active !== true || mData.partyId !== 'admin-owner';
    const needsProfileFix =
      !pData || pData.role !== 'admin' || pData.partyId !== 'admin-owner';

    if (needsMemberFix || needsProfileFix) {
      const batch = writeBatch(db);
      const previouslyBoundPartyId =
        mData && typeof mData.partyId === 'string' && mData.partyId !== 'admin-owner'
          ? mData.partyId
          : '';

      if (!mSnap.exists()) {
        batch.set(memberRef, {
          agencyId: AGENCY_ID,
          uid: adminUid,
          partyId: 'admin-owner',
          role: 'admin',
          parentMasterId: '',
          ownerUid: existingAgency.ownerUid,
          accessKey: ADMIN_ACCESS_KEY,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (needsMemberFix) {
        batch.update(memberRef, {
          partyId: 'admin-owner',
          role: 'admin',
          parentMasterId: '',
          accessKey: ADMIN_ACCESS_KEY,
          active: true,
          updatedAt: serverTimestamp(),
        });
      }

      if (!pSnap.exists()) {
        batch.set(profileRef, {
          uid: adminUid,
          agencyId: AGENCY_ID,
          partyId: 'admin-owner',
          role: 'admin',
          updatedAt: serverTimestamp(),
        });
      } else if (needsProfileFix) {
        batch.update(profileRef, {
          agencyId: AGENCY_ID,
          partyId: 'admin-owner',
          role: 'admin',
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();

      // Release accidentally bound seller party so the real seller can claim it on their own phone
      if (previouslyBoundPartyId) {
        const boundPartyRef = doc(db, 'agencies', AGENCY_ID, 'parties', previouslyBoundPartyId);
        const boundSnap = await getDoc(boundPartyRef);
        if (boundSnap.exists() && boundSnap.data()?.assignedUid === adminUid) {
          await updateDoc(boundPartyRef, {
            assignedUid: '',
            updatedAt: serverTimestamp(),
          });
        }
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `agencies/${AGENCY_ID}/members/${adminUid}`);
  }

  return existingAgency;
}

/**
 * Push Admin's live billing date, config, and official Winning Numbers to /agencies/kk-main.
 */
export async function syncAdminAgencyState(state: AppState): Promise<void> {
  const path = `agencies/${AGENCY_ID}`;
  try {
    await updateDoc(doc(db, 'agencies', AGENCY_ID), {
      date: sanitizeIsoDate(state.date),
      limitThreshold: sanitizeNumber(state.config.limitThreshold, 1, 1000, 10),
      sellerLimitThreshold: sanitizeNumber(state.config.sellerLimitThreshold ?? 20, 1, 1000, 20),
      excludedPrizeNames: sanitizeStringList(state.config.excludedPrizeNames, 50),
      itemOptions: sanitizeItemOptions(state.config.itemOptions),
      winning1PM: String(state.winningRaw['1PM'] || '').slice(0, 20000),
      winning6PM: String(state.winningRaw['6PM'] || '').slice(0, 20000),
      winning8PM: String(state.winningRaw['8PM'] || '').slice(0, 20000),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

/**
 * Create or update a Seller Party + Private Contact + Secret Invite Key + Initial Live Sheet.
 */
export async function createOrSyncSellerParty(
  adminUid: string,
  ownerUid: string,
  adminUids: string[],
  seller: Seller,
  existingParty: CloudPartyDoc | undefined,
  existingPrivate: CloudPartyPrivateDoc | undefined,
  date: string,
  initialEntries: Record<SessionId, TicketEntryRow[]>,
  usedLoginIds?: Set<string>
): Promise<CloudPartyDoc> {
  const partyId = existingParty?.partyId || makePartyIdFromSeller(seller);
  const cleanName = (seller.name.trim() || 'SELLER').slice(0, 60);
  const cleanRate = sanitizeNumber(seller.rate, 0, 10000, 0);
  const cleanDue = sanitizeNumber(seller.due, -100000000, 100000000, 0);
  const cleanJoma = sanitizeNumber(seller.joma, -100000000, 100000000, 0);
  const cleanMobile = String(seller.mobile || '').slice(0, 30);
  const cleanDate = sanitizeIsoDate(date);
  const safeAdminUids = adminUids.length > 0 ? adminUids.slice(0, 10) : [ownerUid];

  const partyRef = doc(db, 'agencies', AGENCY_ID, 'parties', partyId);
  const privateRef = doc(db, 'agencies', AGENCY_ID, 'partyPrivate', partyId);
  const sheetRef = doc(db, 'agencies', AGENCY_ID, 'sheets', partyId);

  if (!existingParty) {
    const loginId = generateEasyLoginId(cleanName, usedLoginIds);
    const loginPassword = generateEasyPassword();
    const accessKey = await computeCredentialAccessKey(loginId, loginPassword);
    const inviteRef = doc(db, 'partyInvites', accessKey);
    const batch = writeBatch(db);

    batch.set(partyRef, {
      agencyId: AGENCY_ID,
      partyId,
      name: cleanName,
      role: 'master',
      parentMasterId: '',
      parentMasterUid: '',
      ownerUid,
      adminUids: safeAdminUids,
      rate: cleanRate,
      due: cleanDue,
      joma: cleanJoma,
      active: true,
      accessKey,
      assignedUid: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(privateRef, {
      agencyId: AGENCY_ID,
      partyId,
      ownerUid,
      adminUids: safeAdminUids,
      parentMasterId: '',
      parentMasterUid: '',
      mobile: cleanMobile,
      assignedEmail: '',
      loginId,
      loginPassword,
      updatedAt: serverTimestamp(),
    });

    batch.set(inviteRef, {
      accessKey,
      agencyId: AGENCY_ID,
      partyId,
      partyName: cleanName,
      role: 'master',
      parentMasterId: '',
      parentMasterUid: '',
      ownerUid,
      createdByUid: adminUid,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(sheetRef, {
      agencyId: AGENCY_ID,
      sheetId: partyId,
      partyId,
      partyName: cleanName,
      role: 'master',
      ownerUid,
      adminUids: safeAdminUids,
      assignedUid: '',
      parentMasterId: '',
      parentMasterUid: '',
      date: cleanDate,
      entries1PM: sanitizeSheetEntriesForCloud(initialEntries['1PM'], cleanName),
      entries6PM: sanitizeSheetEntriesForCloud(initialEntries['6PM'], cleanName),
      entries8PM: sanitizeSheetEntriesForCloud(initialEntries['8PM'], cleanName),
      updatedByUid: adminUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `agencies/${AGENCY_ID}/parties/${partyId}`);
    }

    return {
      agencyId: AGENCY_ID,
      partyId,
      name: cleanName,
      role: 'master',
      parentMasterId: '',
      parentMasterUid: '',
      ownerUid,
      adminUids: safeAdminUids,
      rate: cleanRate,
      due: cleanDue,
      joma: cleanJoma,
      active: true,
      accessKey,
      assignedUid: '',
    };
  }

  // Update existing party if relevant fields changed OR backfill easy Login ID + Password
  const partyChanged =
    existingParty.name !== cleanName ||
    existingParty.rate !== cleanRate ||
    existingParty.due !== cleanDue ||
    existingParty.joma !== cleanJoma;

  const mobileChanged = (existingPrivate?.mobile || '') !== cleanMobile;
  const needsCredBackfill =
    !existingPrivate?.loginId ||
    !existingPrivate?.loginPassword ||
    !existingParty.accessKey?.startsWith('cred_');

  if (partyChanged || mobileChanged || needsCredBackfill) {
    const batch = writeBatch(db);
    let nextAccessKey = existingParty.accessKey;

    if (needsCredBackfill) {
      const loginId = existingPrivate?.loginId
        ? normalizeLoginId(existingPrivate.loginId)
        : generateEasyLoginId(cleanName, usedLoginIds);
      const loginPassword = existingPrivate?.loginPassword || generateEasyPassword();
      nextAccessKey = await computeCredentialAccessKey(loginId, loginPassword);

      if (existingParty.accessKey && existingParty.accessKey !== nextAccessKey) {
        batch.delete(doc(db, 'partyInvites', existingParty.accessKey));
      }
      batch.set(doc(db, 'partyInvites', nextAccessKey), {
        accessKey: nextAccessKey,
        agencyId: AGENCY_ID,
        partyId,
        partyName: cleanName,
        role: existingParty.role,
        parentMasterId: existingParty.parentMasterId || '',
        parentMasterUid: existingParty.parentMasterUid || '',
        ownerUid: existingParty.ownerUid,
        createdByUid: adminUid,
        active: existingParty.active,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.update(partyRef, {
        name: cleanName,
        rate: cleanRate,
        due: cleanDue,
        joma: cleanJoma,
        accessKey: nextAccessKey,
        updatedAt: serverTimestamp(),
      });
      if (existingPrivate) {
        batch.update(privateRef, {
          parentMasterId: existingParty.parentMasterId || '',
          mobile: cleanMobile,
          loginId,
          loginPassword,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(privateRef, {
          agencyId: AGENCY_ID,
          partyId,
          ownerUid,
          adminUids: safeAdminUids,
          parentMasterId: existingParty.parentMasterId || '',
          parentMasterUid: existingParty.parentMasterUid || '',
          mobile: cleanMobile,
          assignedEmail: '',
          loginId,
          loginPassword,
          updatedAt: serverTimestamp(),
        });
      }
    } else {
      if (partyChanged) {
        batch.update(partyRef, {
          name: cleanName,
          rate: cleanRate,
          due: cleanDue,
          joma: cleanJoma,
          updatedAt: serverTimestamp(),
        });
        if (existingParty.name !== cleanName && existingParty.accessKey) {
          batch.update(doc(db, 'partyInvites', existingParty.accessKey), {
            partyName: cleanName,
            updatedAt: serverTimestamp(),
          });
        }
      }
      if (mobileChanged) {
        if (existingPrivate) {
          batch.update(privateRef, {
            mobile: cleanMobile,
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.set(privateRef, {
            agencyId: AGENCY_ID,
            partyId,
            ownerUid,
            adminUids: safeAdminUids,
            parentMasterId: existingParty.parentMasterId || '',
            parentMasterUid: existingParty.parentMasterUid || '',
            mobile: cleanMobile,
            assignedEmail: '',
            updatedAt: serverTimestamp(),
          });
        }
      }
    }

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `agencies/${AGENCY_ID}/parties/${partyId}`);
    }

    return {
      ...existingParty,
      name: cleanName,
      rate: cleanRate,
      due: cleanDue,
      joma: cleanJoma,
      accessKey: nextAccessKey,
    };
  }

  return {
    ...existingParty,
    name: cleanName,
    rate: cleanRate,
    due: cleanDue,
    joma: cleanJoma,
  };
}

/**
 * Push Admin's edits for a specific Seller's rows to /agencies/kk-main/sheets/{partyId}.
 */
export async function pushAdminSheetRowsForParty(
  adminUid: string,
  party: CloudPartyDoc,
  date: string,
  entries1PM: TicketEntryRow[],
  entries6PM: TicketEntryRow[],
  entries8PM: TicketEntryRow[],
  sheetExists: boolean
): Promise<void> {
  const path = `agencies/${AGENCY_ID}/sheets/${party.partyId}`;
  const sheetRef = doc(db, 'agencies', AGENCY_ID, 'sheets', party.partyId);
  const cleanDate = sanitizeIsoDate(date);
  const e1 = sanitizeSheetEntriesForCloud(entries1PM, party.name);
  const e6 = sanitizeSheetEntriesForCloud(entries6PM, party.name);
  const e8 = sanitizeSheetEntriesForCloud(entries8PM, party.name);

  try {
    if (sheetExists) {
      await updateDoc(sheetRef, {
        partyName: party.name,
        date: cleanDate,
        entries1PM: e1,
        entries6PM: e6,
        entries8PM: e8,
        updatedByUid: adminUid,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(sheetRef, {
        agencyId: AGENCY_ID,
        sheetId: party.partyId,
        partyId: party.partyId,
        partyName: party.name,
        role: party.role,
        ownerUid: party.ownerUid,
        adminUids: party.adminUids,
        assignedUid: party.assignedUid || '',
        parentMasterId: party.parentMasterId || '',
        parentMasterUid: party.parentMasterUid || '',
        date: cleanDate,
        entries1PM: e1,
        entries6PM: e6,
        entries8PM: e8,
        updatedByUid: adminUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, sheetExists ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

/**
 * Instantly Pause or Re-activate a Seller ID across party, invite, and active member docs.
 */
async function safeDeleteCompanionDoc(ref: ReturnType<typeof doc>): Promise<void> {
  try {
    await deleteDoc(ref);
  } catch {
    // Companion doc may already be deleted, missing, or reassigned to another session
  }
}

async function safeUpdateCompanionDoc(
  ref: ReturnType<typeof doc>,
  patch: Record<string, unknown>
): Promise<void> {
  try {
    await updateDoc(ref, patch);
  } catch {
    // Companion doc may be missing or reassigned to another session
  }
}

/**
 * Instantly Pause or Re-activate a Seller ID across party, invite, and active member docs.
 */
export async function toggleSellerPartyActive(
  party: CloudPartyDoc,
  nextActive: boolean
): Promise<void> {
  const path = `agencies/${AGENCY_ID}/parties/${party.partyId}`;
  const activeUid = auth.currentUser?.uid || '';
  try {
    await updateDoc(doc(db, 'agencies', AGENCY_ID, 'parties', party.partyId), {
      active: nextActive,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
  const tasks: Promise<void>[] = [];
  if (party.accessKey) {
    tasks.push(
      safeUpdateCompanionDoc(doc(db, 'partyInvites', party.accessKey), {
        active: nextActive,
        updatedAt: serverTimestamp(),
      })
    );
  }
  if (party.assignedUid && party.assignedUid !== activeUid) {
    tasks.push(
      safeUpdateCompanionDoc(doc(db, 'agencies', AGENCY_ID, 'members', party.assignedUid), {
        active: nextActive,
        updatedAt: serverTimestamp(),
      })
    );
  }
  if (tasks.length > 0) await Promise.all(tasks);
}

/**
 * Customize or Reset a Seller/Sub-Seller's Login ID & Password atomically.
 * Works for both Admin and the owning Master Seller.
 */
export async function updatePartyLoginCredentials(
  actorUid: string,
  party: CloudPartyDoc,
  existingPrivate: CloudPartyPrivateDoc | undefined,
  rawLoginId: string,
  rawPassword: string,
  sheetExists: boolean,
  unbindOldPhone = false
): Promise<{ loginId: string; loginPassword: string; accessKey: string }> {
  const loginId = normalizeLoginId(rawLoginId);
  const loginPassword = rawPassword.trim();

  if (loginId.length < 2 || loginId.length > 32) {
    throw new Error('Login ID kam se kam 2 akshar (A-Z, 0-9) ka hona chahiye.');
  }
  if (loginPassword.length < 4 || loginPassword.length > 32) {
    throw new Error('Password kam se kam 4 akshar ya digits ka hona chahiye.');
  }

  const activeActorUid = auth.currentUser?.uid || actorUid;
  const agencyId = party.agencyId || AGENCY_ID;
  const newKey = await computeCredentialAccessKey(loginId, loginPassword);

  // Prevent accidental collision with another account having the exact same Login ID + Password
  const existingInvite = await lookupPartyInvite(newKey);
  if (existingInvite && existingInvite.partyId !== party.partyId) {
    throw new Error(
      'Yeh Login ID aur Password kisi aur account me already use ho raha hai. Thoda alag ID ya Password rakhein.'
    );
  }

  const path = `agencies/${agencyId}/parties/${party.partyId}`;
  const batch = writeBatch(db);

  if (existingInvite) {
    batch.update(doc(db, 'partyInvites', newKey), {
      partyName: party.name,
      role: party.role,
      active: true,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(doc(db, 'partyInvites', newKey), {
      accessKey: newKey,
      agencyId,
      partyId: party.partyId,
      partyName: party.name,
      role: party.role,
      parentMasterId: party.parentMasterId || '',
      parentMasterUid: party.parentMasterUid || '',
      ownerUid: party.ownerUid,
      createdByUid: activeActorUid,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  batch.update(doc(db, 'agencies', agencyId, 'parties', party.partyId), {
    accessKey: newKey,
    ...(unbindOldPhone ? { assignedUid: '' } : {}),
    active: true,
    updatedAt: serverTimestamp(),
  });

  const privateRef = doc(db, 'agencies', agencyId, 'partyPrivate', party.partyId);
  if (existingPrivate) {
    batch.update(privateRef, {
      parentMasterId: party.parentMasterId || '',
      loginId,
      loginPassword,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(privateRef, {
      agencyId,
      partyId: party.partyId,
      ownerUid: party.ownerUid,
      adminUids: party.adminUids,
      parentMasterId: party.parentMasterId || '',
      parentMasterUid: party.parentMasterUid || activeActorUid,
      mobile: '',
      assignedEmail: '',
      loginId,
      loginPassword,
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }

  // Clean up old invite / old phone member / sheet assignedUid safely without failing the credential save
  const cleanupTasks: Promise<void>[] = [];
  if (party.accessKey && party.accessKey !== newKey) {
    cleanupTasks.push(safeDeleteCompanionDoc(doc(db, 'partyInvites', party.accessKey)));
  }
  if (unbindOldPhone && party.assignedUid && party.assignedUid !== activeActorUid) {
    cleanupTasks.push(
      safeUpdateCompanionDoc(doc(db, 'agencies', agencyId, 'members', party.assignedUid), {
        active: false,
        updatedAt: serverTimestamp(),
      })
    );
  }
  if (unbindOldPhone && sheetExists) {
    cleanupTasks.push(
      safeUpdateCompanionDoc(doc(db, 'agencies', agencyId, 'sheets', party.partyId), {
        assignedUid: '',
        updatedByUid: activeActorUid,
        updatedAt: serverTimestamp(),
      })
    );
  }
  if (cleanupTasks.length > 0) await Promise.all(cleanupTasks);

  return { loginId, loginPassword, accessKey: newKey };
}

/**
 * Reset a Seller's Password (unbinds old phone and generates a brand-new 6-digit Password, keeping easy Login ID).
 */
export async function resetSellerAccessKey(
  adminUid: string,
  party: CloudPartyDoc,
  sheetExists: boolean,
  existingPrivate?: CloudPartyPrivateDoc
): Promise<{ loginId: string; loginPassword: string; accessKey: string }> {
  const loginId = existingPrivate?.loginId
    ? normalizeLoginId(existingPrivate.loginId)
    : generateEasyLoginId(party.name);
  const loginPassword = generateEasyPassword();
  return updatePartyLoginCredentials(
    adminUid,
    party,
    existingPrivate,
    loginId,
    loginPassword,
    sheetExists,
    true
  );
}

/**
 * Remove a deleted seller's cloud party, invite, sheet, and member access cleanly.
 */
export async function deleteSellerPartyCloud(party: CloudPartyDoc): Promise<void> {
  const agencyId = party.agencyId || AGENCY_ID;
  const path = `agencies/${agencyId}/parties/${party.partyId}`;
  const activeUid = auth.currentUser?.uid || '';

  const companionDeletes: Promise<void>[] = [
    safeDeleteCompanionDoc(doc(db, 'agencies', agencyId, 'partyPrivate', party.partyId)),
    safeDeleteCompanionDoc(doc(db, 'agencies', agencyId, 'sheets', party.partyId)),
  ];
  if (party.accessKey) {
    companionDeletes.push(safeDeleteCompanionDoc(doc(db, 'partyInvites', party.accessKey)));
  }
  if (party.assignedUid && party.assignedUid !== activeUid) {
    companionDeletes.push(
      safeDeleteCompanionDoc(doc(db, 'agencies', agencyId, 'members', party.assignedUid))
    );
  }
  await Promise.all(companionDeletes);

  try {
    await deleteDoc(doc(db, 'agencies', agencyId, 'parties', party.partyId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Look up a Seller/Sub-Seller invite key (strictly single-doc get, allowed for any verified user).
 */
export async function lookupPartyInvite(
  rawAccessKey: string
): Promise<CloudPartyInviteDoc | null> {
  const accessKey = rawAccessKey.trim();
  if (!/^[a-zA-Z0-9_\-]{16,64}$/.test(accessKey)) return null;
  try {
    const snap = await getDoc(doc(db, 'partyInvites', accessKey));
    if (!snap.exists()) return null;
    return snap.data() as CloudPartyInviteDoc;
  } catch {
    return null;
  }
}

/**
 * Seller Atomic Invite Claim: verifies the Seller ID and binds the seller's Google account
 * atomically to /members, /parties, and /userProfiles in a single writeBatch.
 */
export async function claimSellerAccessKey(
  uid: string,
  rawAccessKey: string,
  userEmail?: string | null
): Promise<{ agencyId: string; partyId: string; partyName: string }> {
  if (userEmail && userEmail.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) {
    throw new Error(
      'ADMIN_ACCOUNT: Yeh Admin Google account hai. Seller ID kisi dusre Google account (seller ke phone) par login karein, ya Admin IDs modal me "Preview" button use karein.'
    );
  }
  const accessKey = rawAccessKey.trim();
  if (!/^[a-zA-Z0-9_\-]{16,64}$/.test(accessKey)) {
    throw new Error('INVALID_ID: Seller ID galat hai. Admin se sahi Seller ID ya link maangein.');
  }

  const invitePath = `partyInvites/${accessKey}`;
  let inviteSnap;
  try {
    inviteSnap = await getDoc(doc(db, 'partyInvites', accessKey));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, invitePath);
  }

  if (!inviteSnap.exists()) {
    throw new Error('NOT_FOUND: Yeh Seller ID exist nahi karta ya expire ho gaya hai.');
  }

  const invite = inviteSnap.data() as CloudPartyInviteDoc;
  if (!invite.active) {
    throw new Error('PAUSED: Admin ne is Seller ID ko pause/block kiya hua hai.');
  }

  const agencyId = invite.agencyId;
  const partyId = invite.partyId;
  const memberRef = doc(db, 'agencies', agencyId, 'members', uid);
  const partyRef = doc(db, 'agencies', agencyId, 'parties', partyId);
  const profileRef = doc(db, 'userProfiles', uid);

  let memberExists = false;
  let profileExists = false;
  try {
    const [mSnap, pSnap] = await Promise.all([getDoc(memberRef), getDoc(profileRef)]);
    memberExists = mSnap.exists();
    profileExists = pSnap.exists();
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `agencies/${agencyId}/members/${uid}`);
  }

  const batch = writeBatch(db);
  if (memberExists) {
    batch.update(memberRef, {
      partyId,
      role: invite.role,
      parentMasterId: invite.parentMasterId || '',
      accessKey,
      active: true,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(memberRef, {
      agencyId,
      uid,
      partyId,
      role: invite.role,
      parentMasterId: invite.parentMasterId || '',
      ownerUid: invite.ownerUid,
      accessKey,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  batch.update(partyRef, {
    assignedUid: uid,
    updatedAt: serverTimestamp(),
  });

  if (profileExists) {
    batch.update(profileRef, {
      agencyId,
      partyId,
      role: invite.role,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(profileRef, {
      uid,
      agencyId,
      partyId,
      role: invite.role,
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('permission') || msg.includes('PERMISSION_DENIED')) {
      throw new Error(
        'PAUSED_OR_DENIED: Yeh account pause hai ya login permission denied hai. Admin / Master se contact karein.'
      );
    }
    handleFirestoreError(err, OperationType.WRITE, `agencies/${agencyId}/parties/${partyId}`);
  }

  return { agencyId, partyId, partyName: invite.partyName };
}

/**
 * Direct Master / Client Login with easy Login ID + Password (ZERO Email / Google Login).
 * Computes the SHA-256 credential proof key and atomically binds the Anonymous Firebase session.
 */
export async function loginSellerWithIdPassword(
  uid: string,
  rawLoginId: string,
  rawPassword: string
): Promise<{ agencyId: string; partyId: string; partyName: string }> {
  const cleanId = normalizeLoginId(rawLoginId);
  const cleanPass = rawPassword.trim();
  if (cleanId.length < 2) {
    throw new Error('INVALID_ID: Sahi Login ID daalein (kam se kam 2 akshar).');
  }
  if (cleanPass.length < 4) {
    throw new Error('INVALID_PASS: Sahi Password daalein (kam se kam 4 digits/akshar).');
  }

  const credKey = await computeCredentialAccessKey(cleanId, cleanPass);
  try {
    return await claimSellerAccessKey(uid, credKey, null);
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    if (rawMsg.includes('NOT_FOUND') || rawMsg.includes('INVALID_ID')) {
      throw new Error(
        'Galat Login ID ya Password! Sahi Login ID aur Password check karke dubara daalein.'
      );
    }
    if (rawMsg.includes('PAUSED')) {
      throw new Error('Admin / Master ne aapka account abhi pause kiya hua hai.');
    }
    throw err;
  }
}

/**
 * Seller saves their own 1PM/6PM/8PM ticket sheet using ONLY Seller-allowed fields.
 * When sheetExists is true and changedSessions is provided, ONLY patches those specific
 * session fields so locked sessions (after 12:58 / 5:58 / 7:58 IST) are never touched.
 */
export async function saveSellerOwnSheet(
  sellerUid: string,
  agencyId: string,
  party: CloudPartyDoc,
  date: string,
  entries1PM: TicketEntryRow[],
  entries6PM: TicketEntryRow[],
  entries8PM: TicketEntryRow[],
  sheetExists: boolean,
  changedSessions?: SessionId[]
): Promise<void> {
  const path = `agencies/${agencyId}/sheets/${party.partyId}`;
  const sheetRef = doc(db, 'agencies', agencyId, 'sheets', party.partyId);
  const activeUid = auth.currentUser?.uid || sellerUid;
  const isSelfSeller = Boolean(activeUid && party.assignedUid && activeUid === party.assignedUid);
  const cleanDate = sanitizeIsoDate(date);
  const e1 = sanitizeSheetEntriesForCloud(entries1PM, party.name);
  const e6 = sanitizeSheetEntriesForCloud(entries6PM, party.name);
  const e8 = sanitizeSheetEntriesForCloud(entries8PM, party.name);

  const buildUpdatePatch = (): Record<string, unknown> => {
    const targetSessions =
      changedSessions && changedSessions.length > 0
        ? changedSessions
        : (['1PM', '6PM', '8PM'] as SessionId[]);
    const patch: Record<string, unknown> = {
      date: cleanDate,
      updatedByUid: activeUid,
      updatedAt: serverTimestamp(),
    };
    if (isSelfSeller) {
      patch.assignedUid = activeUid;
    }
    if (targetSessions.includes('1PM')) patch.entries1PM = e1;
    if (targetSessions.includes('6PM')) patch.entries6PM = e6;
    if (targetSessions.includes('8PM')) patch.entries8PM = e8;
    return patch;
  };

  const buildCreatePayload = () => {
    const ancestorIds =
      Array.isArray(party.ancestorMasterIds) && party.ancestorMasterIds.length > 0
        ? party.ancestorMasterIds.slice(0, 10)
        : party.parentMasterId
          ? [party.parentMasterId]
          : [];
    const ancestorUids =
      Array.isArray(party.ancestorMasterUids) && party.ancestorMasterUids.length > 0
        ? party.ancestorMasterUids.slice(0, 10)
        : party.parentMasterUid
          ? [party.parentMasterUid]
          : [];
    const safeAdminUids =
      Array.isArray(party.adminUids) && party.adminUids.length > 0
        ? party.adminUids.slice(0, 10)
        : [party.ownerUid];
    const allowedCreateSessions =
      isSelfSeller && changedSessions && changedSessions.length > 0 ? changedSessions : null;
    return {
      agencyId,
      sheetId: party.partyId,
      partyId: party.partyId,
      partyName: (party.name || 'SELLER').slice(0, 60),
      role: party.role,
      ownerUid: party.ownerUid,
      adminUids: safeAdminUids,
      assignedUid: isSelfSeller ? activeUid : party.assignedUid || activeUid,
      parentMasterId: party.parentMasterId || '',
      parentMasterUid: party.parentMasterUid || '',
      ancestorMasterIds: ancestorIds,
      ancestorMasterUids: ancestorUids,
      date: cleanDate,
      entries1PM: !allowedCreateSessions || allowedCreateSessions.includes('1PM') ? e1 : [],
      entries6PM: !allowedCreateSessions || allowedCreateSessions.includes('6PM') ? e6 : [],
      entries8PM: !allowedCreateSessions || allowedCreateSessions.includes('8PM') ? e8 : [],
      updatedByUid: activeUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
  };

  let resolvedExists = sheetExists;
  try {
    // If local state thinks sheet doesn't exist yet, verify on Firestore first so we never
    // accidentally run setDoc() on an existing sheet (which triggers allow update & fails createdAt check).
    if (!resolvedExists) {
      try {
        const snap = await getDoc(sheetRef);
        resolvedExists = snap.exists();
      } catch {
        // Proceed with create attempt if getDoc is unavailable
      }
    }

    if (resolvedExists) {
      try {
        await updateDoc(sheetRef, buildUpdatePatch());
      } catch (updateErr) {
        const code =
          typeof updateErr === 'object' && updateErr !== null && 'code' in updateErr
            ? String((updateErr as { code?: unknown }).code || '')
            : '';
        const msg = updateErr instanceof Error ? updateErr.message : String(updateErr);
        if (code === 'not-found' || msg.includes('No document to update')) {
          resolvedExists = false;
          await setDoc(sheetRef, buildCreatePayload());
        } else {
          throw updateErr;
        }
      }
    } else {
      await setDoc(sheetRef, buildCreatePayload());
    }
  } catch (err) {
    handleFirestoreError(err, resolvedExists ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

/**
 * Admin real-time subscriptions (secure list queries adhering to Pillar 8).
 */
export function subscribeAdminParties(
  ownerUid: string,
  onData: (parties: CloudPartyDoc[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = `agencies/${AGENCY_ID}/parties`;
  const q = query(
    collection(db, 'agencies', AGENCY_ID, 'parties'),
    where('ownerUid', '==', ownerUid)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => d.data() as CloudPartyDoc));
    },
    (err) => {
      if (onError) onError(err);
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export function subscribeAdminPartyPrivates(
  ownerUid: string,
  onData: (privates: CloudPartyPrivateDoc[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = `agencies/${AGENCY_ID}/partyPrivate`;
  const q = query(
    collection(db, 'agencies', AGENCY_ID, 'partyPrivate'),
    where('ownerUid', '==', ownerUid)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => d.data() as CloudPartyPrivateDoc));
    },
    (err) => {
      if (onError) onError(err);
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export function subscribeAdminSheets(
  ownerUid: string,
  onData: (sheets: CloudPartySheetDoc[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const path = `agencies/${AGENCY_ID}/sheets`;
  const q = query(
    collection(db, 'agencies', AGENCY_ID, 'sheets'),
    where('ownerUid', '==', ownerUid)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => d.data() as CloudPartySheetDoc));
    },
    (err) => {
      if (onError) onError(err);
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

/**
 * Seller real-time single-document subscriptions (strictly isolated to own party & live agency winning numbers).
 */
export function subscribeSellerPortal(
  agencyId: string,
  partyId: string,
  callbacks: {
    onAgency: (agency: CloudAgencyDoc | null) => void;
    onParty: (party: CloudPartyDoc | null) => void;
    onSheet: (sheet: CloudPartySheetDoc | null) => void;
    onAccessRevoked: (reason: string) => void;
  }
): () => void {
  const unsubAgency = onSnapshot(
    doc(db, 'agencies', agencyId),
    (snap) => {
      callbacks.onAgency(snap.exists() ? (snap.data() as CloudAgencyDoc) : null);
    },
    (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('permission') || msg.includes('PERMISSION_DENIED')) {
        callbacks.onAccessRevoked('Admin ne aapka Seller ID pause ya remove kar diya hai.');
        return;
      }
      handleFirestoreError(err, OperationType.GET, `agencies/${agencyId}`);
    }
  );

  const unsubParty = onSnapshot(
    doc(db, 'agencies', agencyId, 'parties', partyId),
    (snap) => {
      if (!snap.exists()) {
        callbacks.onParty(null);
        callbacks.onAccessRevoked('Yeh Seller account agency mein nahi mila.');
        return;
      }
      const p = snap.data() as CloudPartyDoc;
      if (!p.active) {
        callbacks.onAccessRevoked('Admin ne aapka Seller ID pause kar diya hai.');
        return;
      }
      callbacks.onParty(p);
    },
    (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('permission') || msg.includes('PERMISSION_DENIED')) {
        callbacks.onAccessRevoked('Admin ne aapka Seller ID pause ya reset kar diya hai.');
        return;
      }
      handleFirestoreError(err, OperationType.GET, `agencies/${agencyId}/parties/${partyId}`);
    }
  );

  const unsubSheet = onSnapshot(
    doc(db, 'agencies', agencyId, 'sheets', partyId),
    (snap) => {
      callbacks.onSheet(snap.exists() ? (snap.data() as CloudPartySheetDoc) : null);
    },
    (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('permission') || msg.includes('PERMISSION_DENIED')) {
        callbacks.onAccessRevoked('Sheet access paused by Admin.');
        return;
      }
      handleFirestoreError(err, OperationType.GET, `agencies/${agencyId}/sheets/${partyId}`);
    }
  );

  return () => {
    unsubAgency();
    unsubParty();
    unsubSheet();
  };
}

/**
 * Admin toggles whether a Seller has Chain permission ('master') or is a direct-only seller ('client').
 */
export async function toggleSellerChainRole(
  party: CloudPartyDoc,
  nextRole: 'master' | 'client'
): Promise<void> {
  const path = `agencies/${party.agencyId}/parties/${party.partyId}`;
  const activeUid = auth.currentUser?.uid || '';
  try {
    await updateDoc(doc(db, 'agencies', party.agencyId, 'parties', party.partyId), {
      role: nextRole,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
  const tasks: Promise<void>[] = [];
  if (party.accessKey) {
    tasks.push(
      safeUpdateCompanionDoc(doc(db, 'partyInvites', party.accessKey), {
        role: nextRole,
        updatedAt: serverTimestamp(),
      })
    );
  }
  if (party.assignedUid && party.assignedUid !== activeUid) {
    tasks.push(
      safeUpdateCompanionDoc(doc(db, 'agencies', party.agencyId, 'members', party.assignedUid), {
        role: nextRole,
        updatedAt: serverTimestamp(),
      })
    );
  }
  if (tasks.length > 0) await Promise.all(tasks);
}

function buildChildAncestorLists(
  parentMaster: CloudPartyDoc,
  parentMasterUidOverride?: string
): { ancestorMasterIds: string[]; ancestorMasterUids: string[] } {
  const baseIds =
    Array.isArray(parentMaster.ancestorMasterIds) && parentMaster.ancestorMasterIds.length > 0
      ? parentMaster.ancestorMasterIds
      : parentMaster.parentMasterId
        ? [parentMaster.parentMasterId]
        : [];
  const ancestorMasterIds = Array.from(
    new Set([...baseIds, parentMaster.partyId].filter(Boolean))
  ).slice(0, 10);

  const baseUids =
    Array.isArray(parentMaster.ancestorMasterUids) && parentMaster.ancestorMasterUids.length > 0
      ? parentMaster.ancestorMasterUids
      : parentMaster.parentMasterUid
        ? [parentMaster.parentMasterUid]
        : [];
  const directUid = parentMasterUidOverride || parentMaster.assignedUid || '';
  const ancestorMasterUids = Array.from(
    new Set([...baseUids, directUid].filter(Boolean))
  ).slice(0, 10);

  return { ancestorMasterIds, ancestorMasterUids };
}

/**
 * Compute full ancestor chain (ordered top-down) for any party from the full agency party list.
 */
export function computeFullAncestorChainFromParties(
  party: CloudPartyDoc,
  allParties: CloudPartyDoc[]
): { parentMasterUid: string; ancestorMasterIds: string[]; ancestorMasterUids: string[] } {
  if (!party.parentMasterId) {
    return { parentMasterUid: '', ancestorMasterIds: [], ancestorMasterUids: [] };
  }
  const byId = new Map<string, CloudPartyDoc>();
  for (const p of allParties) {
    byId.set(p.partyId, p);
  }
  const ids: string[] = [];
  const uids: string[] = [];
  const visited = new Set<string>([party.partyId]);
  let currParentId = party.parentMasterId;
  let directParentUid = '';

  while (currParentId && !visited.has(currParentId) && ids.length < 10) {
    visited.add(currParentId);
    const parent = byId.get(currParentId);
    if (!parent) {
      ids.unshift(currParentId);
      break;
    }
    if (!directParentUid && currParentId === party.parentMasterId) {
      directParentUid = parent.assignedUid || '';
    }
    ids.unshift(parent.partyId);
    if (parent.assignedUid) {
      uids.unshift(parent.assignedUid);
    }
    currParentId = parent.parentMasterId || '';
  }

  return {
    parentMasterUid: directParentUid || party.parentMasterUid || '',
    ancestorMasterIds: Array.from(new Set(ids)).slice(0, 10),
    ancestorMasterUids: Array.from(new Set(uids)).slice(0, 10),
  };
}

/**
 * Master Seller creates a new Sub-Seller (Chain ID) with their own Rate & Mobile.
 * Uses 2-step write (Batch for party/private/invite, then sheet) to satisfy firestore.rules exists() check on /sheets.
 */
export async function createSubSellerParty(
  masterUid: string,
  masterParty: CloudPartyDoc,
  subInput: {
    name: string;
    rate: number;
    mobile: string;
    due?: number;
    allowChain?: boolean;
    loginId?: string;
    loginPassword?: string;
  },
  date: string,
  usedLoginIds?: Set<string>
): Promise<CloudPartyDoc & { loginId: string; loginPassword: string }> {
  const cleanName = (subInput.name.trim().toUpperCase() || 'SUB SELLER').slice(0, 60);
  const cleanRate = sanitizeNumber(subInput.rate, 0, 10000, masterParty.rate || 11);
  const cleanDue = sanitizeNumber(subInput.due ?? 0, -100000000, 100000000, 0);
  const cleanMobile = String(subInput.mobile || '').slice(0, 30);
  const cleanDate = sanitizeIsoDate(date);
  const subRole: 'master' | 'client' = subInput.allowChain ? 'master' : 'client';
  const subPartyId = sanitizeId(
    `sub-${masterParty.partyId.slice(0, 24)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    `sub-${Date.now()}`
  );
  const loginId =
    subInput.loginId && normalizeLoginId(subInput.loginId).length >= 2
      ? normalizeLoginId(subInput.loginId)
      : generateEasyLoginId(cleanName, usedLoginIds);
  let loginPassword =
    subInput.loginPassword && subInput.loginPassword.trim().length >= 4
      ? subInput.loginPassword.trim().slice(0, 32)
      : generateEasyPassword();
  let accessKey = await computeCredentialAccessKey(loginId, loginPassword);

  // Guard against invite key collision on auto-generated or custom credentials
  const existingCred = await lookupPartyInvite(accessKey);
  if (existingCred) {
    if (subInput.loginPassword && subInput.loginPassword.trim().length >= 4) {
      throw new Error(
        'Yeh Login ID aur Password kisi aur account me already use ho raha hai. Thoda alag ID ya Password rakhein.'
      );
    }
    loginPassword = generateEasyPassword();
    accessKey = await computeCredentialAccessKey(loginId, loginPassword);
  }

  const activeMasterUid = auth.currentUser?.uid || masterUid;
  const safeAdminUids =
    masterParty.adminUids && masterParty.adminUids.length > 0
      ? masterParty.adminUids.slice(0, 10)
      : [masterParty.ownerUid];
  const { ancestorMasterIds, ancestorMasterUids } = buildChildAncestorLists(
    masterParty,
    activeMasterUid
  );

  const agencyId = masterParty.agencyId;
  const partyRef = doc(db, 'agencies', agencyId, 'parties', subPartyId);
  const privateRef = doc(db, 'agencies', agencyId, 'partyPrivate', subPartyId);
  const inviteRef = doc(db, 'partyInvites', accessKey);
  const sheetRef = doc(db, 'agencies', agencyId, 'sheets', subPartyId);

  const batch = writeBatch(db);
  batch.set(partyRef, {
    agencyId,
    partyId: subPartyId,
    name: cleanName,
    role: subRole,
    parentMasterId: masterParty.partyId,
    parentMasterUid: activeMasterUid,
    ancestorMasterIds,
    ancestorMasterUids,
    ownerUid: masterParty.ownerUid,
    adminUids: safeAdminUids,
    rate: cleanRate,
    due: cleanDue,
    joma: 0,
    active: true,
    accessKey,
    assignedUid: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(privateRef, {
    agencyId,
    partyId: subPartyId,
    ownerUid: masterParty.ownerUid,
    adminUids: safeAdminUids,
    parentMasterId: masterParty.partyId,
    parentMasterUid: activeMasterUid,
    mobile: cleanMobile,
    assignedEmail: '',
    loginId,
    loginPassword,
    updatedAt: serverTimestamp(),
  });

  batch.set(inviteRef, {
    accessKey,
    agencyId,
    partyId: subPartyId,
    partyName: cleanName,
    role: subRole,
    parentMasterId: masterParty.partyId,
    parentMasterUid: activeMasterUid,
    ownerUid: masterParty.ownerUid,
    createdByUid: activeMasterUid,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `agencies/${agencyId}/parties/${subPartyId}`);
  }

  // Step 2: Create Sub-Seller's live entry sheet now that party doc exists (best-effort; also auto-created on first entry)
  try {
    await setDoc(sheetRef, {
      agencyId,
      sheetId: subPartyId,
      partyId: subPartyId,
      partyName: cleanName,
      role: subRole,
      ownerUid: masterParty.ownerUid,
      adminUids: safeAdminUids,
      assignedUid: '',
      parentMasterId: masterParty.partyId,
      parentMasterUid: activeMasterUid,
      ancestorMasterIds,
      ancestorMasterUids,
      date: cleanDate,
      entries1PM: [],
      entries6PM: [],
      entries8PM: [],
      updatedByUid: activeMasterUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Sheet will be created automatically on the Sub-Seller's first save
  }

  return {
    agencyId,
    partyId: subPartyId,
    name: cleanName,
    role: subRole,
    parentMasterId: masterParty.partyId,
    parentMasterUid: activeMasterUid,
    ancestorMasterIds,
    ancestorMasterUids,
    ownerUid: masterParty.ownerUid,
    adminUids: safeAdminUids,
    rate: cleanRate,
    due: cleanDue,
    joma: 0,
    active: true,
    accessKey,
    assignedUid: '',
    loginId,
    loginPassword,
  };
}

/**
 * Admin directly generates and assigns a Sub-Seller ID under any Master (or Sub-Master) seller.
 */
export async function createSubSellerForMasterByAdmin(
  adminUid: string,
  parentMaster: CloudPartyDoc,
  subInput: {
    name: string;
    rate: number;
    mobile: string;
    allowChain?: boolean;
    loginId?: string;
    loginPassword?: string;
  },
  date: string,
  allParties?: CloudPartyDoc[],
  usedLoginIds?: Set<string>
): Promise<CloudPartyDoc & { loginId: string; loginPassword: string }> {
  const cleanName = (subInput.name.trim().toUpperCase() || 'SUB SELLER').slice(0, 60);
  const cleanRate = sanitizeNumber(subInput.rate, 0, 10000, parentMaster.rate || 11);
  const cleanMobile = String(subInput.mobile || '').slice(0, 30);
  const cleanDate = sanitizeIsoDate(date);
  const subRole: 'master' | 'client' = subInput.allowChain ? 'master' : 'client';
  const parentMasterUid = parentMaster.assignedUid || '';
  const subPartyId = sanitizeId(
    `sub-${parentMaster.partyId.slice(0, 24)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    `sub-${Date.now()}`
  );
  const loginId =
    subInput.loginId && normalizeLoginId(subInput.loginId).length >= 2
      ? normalizeLoginId(subInput.loginId)
      : generateEasyLoginId(cleanName, usedLoginIds);
  const loginPassword =
    subInput.loginPassword && subInput.loginPassword.trim().length >= 4
      ? subInput.loginPassword.trim().slice(0, 32)
      : generateEasyPassword();
  const accessKey = await computeCredentialAccessKey(loginId, loginPassword);

  const safeAdminUids =
    parentMaster.adminUids && parentMaster.adminUids.length > 0
      ? parentMaster.adminUids.slice(0, 10)
      : [parentMaster.ownerUid];

  const ancestorLists =
    allParties && allParties.length > 0
      ? (() => {
          const parentChain = computeFullAncestorChainFromParties(parentMaster, allParties);
          return {
            ancestorMasterIds: Array.from(
              new Set([...parentChain.ancestorMasterIds, parentMaster.partyId].filter(Boolean))
            ).slice(0, 10),
            ancestorMasterUids: Array.from(
              new Set([...parentChain.ancestorMasterUids, parentMasterUid].filter(Boolean))
            ).slice(0, 10),
          };
        })()
      : buildChildAncestorLists(parentMaster, parentMasterUid);
  const { ancestorMasterIds, ancestorMasterUids } = ancestorLists;

  const agencyId = parentMaster.agencyId;
  const partyRef = doc(db, 'agencies', agencyId, 'parties', subPartyId);
  const privateRef = doc(db, 'agencies', agencyId, 'partyPrivate', subPartyId);
  const inviteRef = doc(db, 'partyInvites', accessKey);
  const sheetRef = doc(db, 'agencies', agencyId, 'sheets', subPartyId);

  const batch = writeBatch(db);
  batch.set(partyRef, {
    agencyId,
    partyId: subPartyId,
    name: cleanName,
    role: subRole,
    parentMasterId: parentMaster.partyId,
    parentMasterUid,
    ancestorMasterIds,
    ancestorMasterUids,
    ownerUid: parentMaster.ownerUid,
    adminUids: safeAdminUids,
    rate: cleanRate,
    due: 0,
    joma: 0,
    active: true,
    accessKey,
    assignedUid: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(privateRef, {
    agencyId,
    partyId: subPartyId,
    ownerUid: parentMaster.ownerUid,
    adminUids: safeAdminUids,
    parentMasterId: parentMaster.partyId,
    parentMasterUid,
    mobile: cleanMobile,
    assignedEmail: '',
    loginId,
    loginPassword,
    updatedAt: serverTimestamp(),
  });

  batch.set(inviteRef, {
    accessKey,
    agencyId,
    partyId: subPartyId,
    partyName: cleanName,
    role: subRole,
    parentMasterId: parentMaster.partyId,
    parentMasterUid,
    ownerUid: parentMaster.ownerUid,
    createdByUid: adminUid,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(sheetRef, {
    agencyId,
    sheetId: subPartyId,
    partyId: subPartyId,
    partyName: cleanName,
    role: subRole,
    ownerUid: parentMaster.ownerUid,
    adminUids: safeAdminUids,
    assignedUid: '',
    parentMasterId: parentMaster.partyId,
    parentMasterUid,
    ancestorMasterIds,
    ancestorMasterUids,
    date: cleanDate,
    entries1PM: [],
    entries6PM: [],
    entries8PM: [],
    updatedByUid: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `agencies/${agencyId}/parties/${subPartyId}`);
  }

  return {
    agencyId,
    partyId: subPartyId,
    name: cleanName,
    role: subRole,
    parentMasterId: parentMaster.partyId,
    parentMasterUid,
    ancestorMasterIds,
    ancestorMasterUids,
    ownerUid: parentMaster.ownerUid,
    adminUids: safeAdminUids,
    rate: cleanRate,
    due: 0,
    joma: 0,
    active: true,
    accessKey,
    assignedUid: '',
    loginId,
    loginPassword,
  };
}

/**
 * Walk up parentMasterId links to find the root top-level Master Seller for multi-level chain rollup.
 */
export function resolveTopLevelMasterParty(
  startPartyId: string,
  allParties: CloudPartyDoc[]
): CloudPartyDoc | undefined {
  const byId = new Map<string, CloudPartyDoc>();
  for (const p of allParties) {
    byId.set(p.partyId, p);
  }
  let curr = byId.get(startPartyId);
  const visited = new Set<string>();
  while (curr && curr.parentMasterId && !visited.has(curr.partyId)) {
    visited.add(curr.partyId);
    const parent = byId.get(curr.parentMasterId);
    if (!parent) break;
    curr = parent;
  }
  return curr;
}

/**
 * Backfill parentMasterUid, ancestorMasterIds, and ancestorMasterUids on Sub-Sellers & their sheets
 * so every ancestor Master in a multi-level chain receives live entries immediately.
 */
export async function syncSubSellerChainLineage(
  adminUid: string,
  subParty: CloudPartyDoc,
  lineage: { parentMasterUid: string; ancestorMasterIds: string[]; ancestorMasterUids: string[] },
  hasPrivate: boolean,
  hasSheet: boolean
): Promise<void> {
  const agencyId = subParty.agencyId;
  const batch = writeBatch(db);
  batch.update(doc(db, 'agencies', agencyId, 'parties', subParty.partyId), {
    parentMasterUid: lineage.parentMasterUid,
    ancestorMasterIds: lineage.ancestorMasterIds,
    ancestorMasterUids: lineage.ancestorMasterUids,
    updatedAt: serverTimestamp(),
  });
  if (hasPrivate && lineage.parentMasterUid && subParty.parentMasterUid !== lineage.parentMasterUid) {
    batch.update(doc(db, 'agencies', agencyId, 'partyPrivate', subParty.partyId), {
      parentMasterUid: lineage.parentMasterUid,
      updatedAt: serverTimestamp(),
    });
  }
  if (subParty.accessKey && lineage.parentMasterUid && subParty.parentMasterUid !== lineage.parentMasterUid) {
    batch.update(doc(db, 'partyInvites', subParty.accessKey), {
      parentMasterUid: lineage.parentMasterUid,
      updatedAt: serverTimestamp(),
    });
  }
  if (hasSheet) {
    batch.update(doc(db, 'agencies', agencyId, 'sheets', subParty.partyId), {
      parentMasterUid: lineage.parentMasterUid,
      ancestorMasterIds: lineage.ancestorMasterIds,
      ancestorMasterUids: lineage.ancestorMasterUids,
      updatedByUid: adminUid,
      updatedAt: serverTimestamp(),
    });
  }
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `agencies/${agencyId}/parties/${subParty.partyId}`
    );
  }
}

/**
 * Master Seller updates their Sub-Seller's Name, Rate, Due, Joma, or Mobile.
 */
export async function updateSubSellerParty(
  subParty: CloudPartyDoc,
  existingPrivate: CloudPartyPrivateDoc | undefined,
  patch: { name?: string; rate?: number; due?: number; joma?: number; mobile?: string }
): Promise<void> {
  const agencyId = subParty.agencyId;
  const cleanName =
    patch.name !== undefined
      ? (patch.name.trim().toUpperCase() || subParty.name).slice(0, 60)
      : subParty.name;
  const cleanRate =
    patch.rate !== undefined
      ? sanitizeNumber(patch.rate, 0, 10000, subParty.rate)
      : subParty.rate;
  const cleanDue =
    patch.due !== undefined
      ? sanitizeNumber(patch.due, -100000000, 100000000, subParty.due)
      : subParty.due;
  const cleanJoma =
    patch.joma !== undefined
      ? sanitizeNumber(patch.joma, -100000000, 100000000, subParty.joma)
      : subParty.joma;
  const cleanMobile =
    patch.mobile !== undefined
      ? String(patch.mobile || '').slice(0, 30)
      : existingPrivate?.mobile || '';

  const activeUid = auth.currentUser?.uid || '';
  const batch = writeBatch(db);
  let hasWrite = false;
  const nameChanged = cleanName !== subParty.name;

  if (
    nameChanged ||
    cleanRate !== subParty.rate ||
    cleanDue !== subParty.due ||
    cleanJoma !== subParty.joma
  ) {
    hasWrite = true;
    batch.update(doc(db, 'agencies', agencyId, 'parties', subParty.partyId), {
      name: cleanName,
      rate: cleanRate,
      due: cleanDue,
      joma: cleanJoma,
      updatedAt: serverTimestamp(),
    });
  }

  if (patch.mobile !== undefined && cleanMobile !== (existingPrivate?.mobile || '')) {
    hasWrite = true;
    const privRef = doc(db, 'agencies', agencyId, 'partyPrivate', subParty.partyId);
    if (existingPrivate) {
      batch.update(privRef, {
        mobile: cleanMobile,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(privRef, {
        agencyId,
        partyId: subParty.partyId,
        ownerUid: subParty.ownerUid,
        adminUids: subParty.adminUids,
        parentMasterId: subParty.parentMasterId || '',
        parentMasterUid: activeUid || subParty.parentMasterUid || '',
        mobile: cleanMobile,
        assignedEmail: '',
        updatedAt: serverTimestamp(),
      });
    }
  }

  if (!hasWrite) return;
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `agencies/${agencyId}/parties/${subParty.partyId}`);
  }

  if (nameChanged && subParty.accessKey) {
    await safeUpdateCompanionDoc(doc(db, 'partyInvites', subParty.accessKey), {
      partyName: cleanName,
      updatedAt: serverTimestamp(),
    });
  }
}

/**
 * Master Seller pauses or resumes their Sub-Seller.
 */
export async function toggleSubSellerActive(
  subParty: CloudPartyDoc,
  nextActive: boolean
): Promise<void> {
  const agencyId = subParty.agencyId;
  const activeUid = auth.currentUser?.uid || '';
  try {
    await updateDoc(doc(db, 'agencies', agencyId, 'parties', subParty.partyId), {
      active: nextActive,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `agencies/${agencyId}/parties/${subParty.partyId}`);
  }
  const tasks: Promise<void>[] = [];
  if (subParty.accessKey) {
    tasks.push(
      safeUpdateCompanionDoc(doc(db, 'partyInvites', subParty.accessKey), {
        active: nextActive,
        updatedAt: serverTimestamp(),
      })
    );
  }
  if (subParty.assignedUid && subParty.assignedUid !== activeUid) {
    tasks.push(
      safeUpdateCompanionDoc(doc(db, 'agencies', agencyId, 'members', subParty.assignedUid), {
        active: nextActive,
        updatedAt: serverTimestamp(),
      })
    );
  }
  if (tasks.length > 0) await Promise.all(tasks);
}

/**
 * Master Seller resets a Sub-Seller's Password (unbinds old phone and issues new 6-digit Password).
 */
export async function resetSubSellerAccessKey(
  masterUid: string,
  subParty: CloudPartyDoc,
  sheetExists: boolean,
  existingPrivate?: CloudPartyPrivateDoc
): Promise<{ loginId: string; loginPassword: string; accessKey: string }> {
  const activeUid = auth.currentUser?.uid || masterUid;
  const loginId = existingPrivate?.loginId
    ? normalizeLoginId(existingPrivate.loginId)
    : generateEasyLoginId(subParty.name);
  const loginPassword = generateEasyPassword();
  return updatePartyLoginCredentials(
    activeUid,
    { ...subParty, parentMasterUid: activeUid },
    existingPrivate,
    loginId,
    loginPassword,
    sheetExists,
    true
  );
}

/**
 * Master Seller deletes one of their own Sub-Sellers cleanly.
 */
export async function deleteSubSellerParty(subParty: CloudPartyDoc): Promise<void> {
  const agencyId = subParty.agencyId;
  const activeUid = auth.currentUser?.uid || '';

  // Clean up companion docs first (safely skipping missing or reassigned docs, and NEVER deleting own UID)
  const companionDeletes: Promise<void>[] = [
    safeDeleteCompanionDoc(doc(db, 'agencies', agencyId, 'partyPrivate', subParty.partyId)),
    safeDeleteCompanionDoc(doc(db, 'agencies', agencyId, 'sheets', subParty.partyId)),
  ];
  if (subParty.accessKey) {
    companionDeletes.push(safeDeleteCompanionDoc(doc(db, 'partyInvites', subParty.accessKey)));
  }
  if (subParty.assignedUid && subParty.assignedUid !== activeUid) {
    companionDeletes.push(
      safeDeleteCompanionDoc(doc(db, 'agencies', agencyId, 'members', subParty.assignedUid))
    );
  }
  await Promise.all(companionDeletes);

  // Authoritative party deletion
  try {
    await deleteDoc(doc(db, 'agencies', agencyId, 'parties', subParty.partyId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `agencies/${agencyId}/parties/${subParty.partyId}`);
  }
}

/**
 * Collect all descendant partyIds under a given masterPartyId (supports L2, L3, L4, L5+ chains).
 */
export function collectDescendantPartyIds(
  rootPartyId: string,
  allParties: CloudPartyDoc[]
): Set<string> {
  const result = new Set<string>();
  const queue: string[] = [rootPartyId];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const p of allParties) {
      if (p.parentMasterId === curr && !result.has(p.partyId)) {
        result.add(p.partyId);
        queue.push(p.partyId);
      }
    }
  }
  return result;
}

/**
 * Real-time subscriptions for a Master Seller's entire downline chain (direct L2 + nested L3/L4/L5+,
 * Pillar-8 compliant). Emits both direct sub-sellers (for management) and all descendant parties & sheets
 * so entries from ANY depth in the chain arrive LIVE.
 */
export function subscribeMasterSubChain(
  agencyId: string,
  queryUid: string,
  masterPartyId: string,
  isAdminPreview: boolean,
  callbacks: {
    onSubParties: (directParties: CloudPartyDoc[]) => void;
    onAllChainParties?: (allDescendants: CloudPartyDoc[]) => void;
    onSubPrivates: (privates: CloudPartyPrivateDoc[]) => void;
    onSubSheets: (allDescendantSheets: CloudPartySheetDoc[]) => void;
  }
): () => void {
  if (isAdminPreview) {
    let latestAgencyParties: CloudPartyDoc[] = [];
    let latestAgencySheets: CloudPartySheetDoc[] = [];

    const emitFromAdmin = () => {
      const descIds = collectDescendantPartyIds(masterPartyId, latestAgencyParties);
      const direct = latestAgencyParties.filter((p) => p.parentMasterId === masterPartyId);
      const allDesc = latestAgencyParties.filter(
        (p) => descIds.has(p.partyId) || p.ancestorMasterIds?.includes(masterPartyId)
      );
      const allDescIdSet = new Set(allDesc.map((p) => p.partyId));
      const sheets = latestAgencySheets.filter(
        (s) =>
          s.parentMasterId === masterPartyId ||
          allDescIdSet.has(s.partyId) ||
          s.ancestorMasterIds?.includes(masterPartyId)
      );
      callbacks.onSubParties(direct);
      callbacks.onAllChainParties?.(allDesc);
      callbacks.onSubSheets(sheets);
    };

    const unsubParties = onSnapshot(
      query(collection(db, 'agencies', agencyId, 'parties'), where('ownerUid', '==', queryUid)),
      (snap) => {
        latestAgencyParties = snap.docs.map((d) => d.data() as CloudPartyDoc);
        emitFromAdmin();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `agencies/${agencyId}/parties`);
      }
    );

    const unsubPrivates = onSnapshot(
      query(collection(db, 'agencies', agencyId, 'partyPrivate'), where('ownerUid', '==', queryUid)),
      (snap) => {
        callbacks.onSubPrivates(snap.docs.map((d) => d.data() as CloudPartyPrivateDoc));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `agencies/${agencyId}/partyPrivate`);
      }
    );

    const unsubSheets = onSnapshot(
      query(collection(db, 'agencies', agencyId, 'sheets'), where('ownerUid', '==', queryUid)),
      (snap) => {
        latestAgencySheets = snap.docs.map((d) => d.data() as CloudPartySheetDoc);
        emitFromAdmin();
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `agencies/${agencyId}/sheets`);
      }
    );

    return () => {
      unsubParties();
      unsubPrivates();
      unsubSheets();
    };
  }

  // Signed-in Master / Sub-Master live multi-level listeners:
  // Merge direct children (parentMasterId == masterPartyId, works even before UID backfill)
  // AND deep chain descendants (ancestorMasterIds array-contains masterPartyId).
  const directPartyMap = new Map<string, CloudPartyDoc>();
  const deepPartyMap = new Map<string, CloudPartyDoc>();
  const directSheetMap = new Map<string, CloudPartySheetDoc>();
  const deepSheetMap = new Map<string, CloudPartySheetDoc>();

  const emitParties = () => {
    const merged = new Map<string, CloudPartyDoc>();
    for (const [id, p] of directPartyMap.entries()) merged.set(id, p);
    for (const [id, p] of deepPartyMap.entries()) merged.set(id, p);
    const allDesc = Array.from(merged.values());
    const direct = allDesc.filter((p) => p.parentMasterId === masterPartyId);
    callbacks.onSubParties(direct);
    callbacks.onAllChainParties?.(allDesc);
  };

  const emitSheets = () => {
    const merged = new Map<string, CloudPartySheetDoc>();
    for (const [id, s] of directSheetMap.entries()) merged.set(id, s);
    for (const [id, s] of deepSheetMap.entries()) merged.set(id, s);
    callbacks.onSubSheets(Array.from(merged.values()));
  };

  const unsubDirectParties = onSnapshot(
    query(
      collection(db, 'agencies', agencyId, 'parties'),
      where('parentMasterId', '==', masterPartyId)
    ),
    (snap) => {
      directPartyMap.clear();
      snap.docs.forEach((d) => {
        const p = d.data() as CloudPartyDoc;
        directPartyMap.set(p.partyId, p);
      });
      emitParties();
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, `agencies/${agencyId}/parties`);
    }
  );

  const unsubDeepParties = onSnapshot(
    query(
      collection(db, 'agencies', agencyId, 'parties'),
      where('ancestorMasterIds', 'array-contains', masterPartyId)
    ),
    (snap) => {
      deepPartyMap.clear();
      snap.docs.forEach((d) => {
        const p = d.data() as CloudPartyDoc;
        deepPartyMap.set(p.partyId, p);
      });
      emitParties();
    },
    () => {
      // Fallback silently if ancestor query index/permission not yet backfilled; direct listener remains active.
    }
  );

  const uidPrivMap = new Map<string, CloudPartyPrivateDoc>();
  const idPrivMap = new Map<string, CloudPartyPrivateDoc>();
  const emitPrivates = () => {
    const merged = new Map<string, CloudPartyPrivateDoc>();
    for (const [id, pr] of uidPrivMap.entries()) merged.set(id, pr);
    for (const [id, pr] of idPrivMap.entries()) merged.set(id, pr);
    callbacks.onSubPrivates(Array.from(merged.values()));
  };

  const unsubPrivatesByUid = onSnapshot(
    query(
      collection(db, 'agencies', agencyId, 'partyPrivate'),
      where('parentMasterUid', '==', queryUid)
    ),
    (snap) => {
      uidPrivMap.clear();
      snap.docs.forEach((d) => {
        const pr = d.data() as CloudPartyPrivateDoc;
        uidPrivMap.set(pr.partyId, pr);
      });
      emitPrivates();
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, `agencies/${agencyId}/partyPrivate`);
    }
  );

  const unsubPrivatesByMasterId = onSnapshot(
    query(
      collection(db, 'agencies', agencyId, 'partyPrivate'),
      where('parentMasterId', '==', masterPartyId)
    ),
    (snap) => {
      idPrivMap.clear();
      snap.docs.forEach((d) => {
        const pr = d.data() as CloudPartyPrivateDoc;
        idPrivMap.set(pr.partyId, pr);
      });
      emitPrivates();
    },
    () => {
      // Fallback silently; UID listener remains active.
    }
  );

  const unsubDirectSheets = onSnapshot(
    query(
      collection(db, 'agencies', agencyId, 'sheets'),
      where('parentMasterId', '==', masterPartyId)
    ),
    (snap) => {
      directSheetMap.clear();
      snap.docs.forEach((d) => {
        const s = d.data() as CloudPartySheetDoc;
        directSheetMap.set(s.partyId, s);
      });
      emitSheets();
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, `agencies/${agencyId}/sheets`);
    }
  );

  const unsubDeepSheets = onSnapshot(
    query(
      collection(db, 'agencies', agencyId, 'sheets'),
      where('ancestorMasterIds', 'array-contains', masterPartyId)
    ),
    (snap) => {
      deepSheetMap.clear();
      snap.docs.forEach((d) => {
        const s = d.data() as CloudPartySheetDoc;
        deepSheetMap.set(s.partyId, s);
      });
      emitSheets();
    },
    () => {
      // Fallback silently; direct sheet listener remains active.
    }
  );

  return () => {
    unsubDirectParties();
    unsubDeepParties();
    unsubPrivatesByUid();
    unsubPrivatesByMasterId();
    unsubDirectSheets();
    unsubDeepSheets();
  };
}

export interface CloudPartyArchiveDoc {
  agencyId: string;
  snapshotId: string;
  partyId: string;
  partyName: string;
  ownerUid: string;
  adminUids: string[];
  assignedUid: string;
  parentMasterId: string;
  parentMasterUid: string;
  date: string;
  savedAt: string;
  trigger: DaySnapshot['trigger'];
  payload: DaySnapshot;
}

const ARCHIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function sanitizePartyArchivePayload(snapshot: DaySnapshot, cleanId: string, cleanDate: string): DaySnapshot {
  const summaries = (snapshot.sellerSummaries || []).slice(0, 120).map((s) => ({
    name: String(s.name || '').slice(0, 60),
    mor: Number(s.mor) || 0,
    day: Number(s.day) || 0,
    eve: Number(s.eve) || 0,
    sold: Number(s.sold) || 0,
    bill: Number(s.bill) || 0,
    prizeTotal: Number(s.prizeTotal) || 0,
    fresh: Number(s.fresh) || 0,
    joma: Number(s.joma) || 0,
    due: Number(s.due) || 0,
    total: Number(s.total) || 0,
  }));
  const prizes = (snapshot.prizeList || []).slice(0, 300).map((p) => ({
    id: String(p.id || '').slice(0, 64),
    time: (p.time === '6PM' || p.time === '8PM' ? p.time : '1PM') as SessionId,
    name: String(p.name || '').slice(0, 60),
    number: String(p.number || '').slice(0, 20),
    rank: String(p.rank || '').slice(0, 20),
    item: String(p.item || '').slice(0, 20),
    prize: Number(p.prize) || 0,
    vc: Number(p.vc) || 0,
    svc: Number(p.svc) || 0,
    total: Number(p.total) || 0,
  }));
  return {
    id: cleanId,
    date: cleanDate,
    savedAt: String(snapshot.savedAt || new Date().toISOString()).slice(0, 64),
    trigger:
      snapshot.trigger === 'day-close' || snapshot.trigger === 'daily-auto'
        ? snapshot.trigger
        : 'manual',
    totalSold: Number(snapshot.totalSold) || 0,
    totalBill: Number(snapshot.totalBill) || 0,
    totalPrize: Number(snapshot.totalPrize) || 0,
    totalNetPayable: Number(snapshot.totalNetPayable) || 0,
    limitGrandTotal: Number(snapshot.limitGrandTotal) || 0,
    overLimitTotals: {
      '1PM': Number(snapshot.overLimitTotals?.['1PM']) || 0,
      '6PM': Number(snapshot.overLimitTotals?.['6PM']) || 0,
      '8PM': Number(snapshot.overLimitTotals?.['8PM']) || 0,
    },
    sellerSummaries: summaries,
    prizeList: prizes,
    limitPrizeGroups: [],
    sellers: [],
    entries: { '1PM': [], '6PM': [], '8PM': [] },
    winningRaw: { '1PM': '', '6PM': '', '8PM': '' },
  };
}

export async function savePartyArchiveCloud(
  actorUid: string,
  party: CloudPartyDoc,
  snapshot: DaySnapshot,
  isAdminActor = false
): Promise<DaySnapshot> {
  const safeSuffix = String(snapshot.id || `snap-${Date.now()}`)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
  const snapshotId =
    safeSuffix.length >= 4
      ? safeSuffix
      : `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const cleanDate = sanitizeIsoDate(snapshot.date);
  const cleanSavedAt = String(snapshot.savedAt || new Date().toISOString()).slice(0, 64);
  const cleanTrigger: DaySnapshot['trigger'] =
    snapshot.trigger === 'day-close' || snapshot.trigger === 'daily-auto'
      ? snapshot.trigger
      : 'manual';
  const payload = sanitizePartyArchivePayload(snapshot, snapshotId, cleanDate);
  const adminUids =
    Array.isArray(party.adminUids) && party.adminUids.length > 0
      ? party.adminUids.slice(0, 10)
      : [party.ownerUid];

  const ref = doc(db, 'agencies', party.agencyId, 'partyArchives', snapshotId);
  try {
    await setDoc(ref, {
      agencyId: party.agencyId,
      snapshotId,
      partyId: party.partyId,
      partyName: (party.name || 'SELLER').trim().slice(0, 60) || 'SELLER',
      ownerUid: party.ownerUid,
      adminUids,
      assignedUid: isAdminActor ? party.assignedUid || '' : actorUid,
      parentMasterId: party.parentMasterId || '',
      parentMasterUid: party.parentMasterUid || '',
      date: cleanDate,
      savedAt: cleanSavedAt,
      trigger: cleanTrigger,
      payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, ref.path);
  }
}

export async function updatePartyArchiveDateCloud(
  agencyId: string,
  snapshot: DaySnapshot,
  newDate: string
): Promise<void> {
  const cleanDate = sanitizeIsoDate(newDate);
  const ref = doc(db, 'agencies', agencyId, 'partyArchives', snapshot.id);
  const updatedPayload = sanitizePartyArchivePayload(
    { ...snapshot, date: cleanDate },
    snapshot.id,
    cleanDate
  );
  try {
    await updateDoc(ref, {
      date: cleanDate,
      payload: updatedPayload,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, ref.path);
  }
}

export async function deletePartyArchiveCloud(
  agencyId: string,
  snapshotId: string
): Promise<void> {
  const ref = doc(db, 'agencies', agencyId, 'partyArchives', snapshotId);
  try {
    await deleteDoc(ref);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, ref.path);
  }
}

export function subscribePartyArchives(
  agencyId: string,
  partyId: string,
  onSnapshots: (snapshots: DaySnapshot[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'agencies', agencyId, 'partyArchives'),
    where('partyId', '==', partyId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const cutoff = Date.now() - ARCHIVE_RETENTION_MS;
      const list: DaySnapshot[] = [];
      for (const d of snap.docs) {
        const data = d.data() as CloudPartyArchiveDoc;
        if (!data || !data.payload) continue;
        const savedTs = Date.parse(data.savedAt || data.payload.savedAt || '');
        if (Number.isFinite(savedTs) && savedTs < cutoff) continue;
        list.push({
          ...data.payload,
          id: data.snapshotId || d.id,
          date: data.date || data.payload.date,
          savedAt: data.savedAt || data.payload.savedAt,
          trigger: data.trigger || data.payload.trigger || 'manual',
        });
      }
      list.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
      onSnapshots(list.slice(0, 60));
    },
    () => {
      // Keep local cached archives visible if offline or permission refresh pending
    }
  );
}

export async function carryForwardSubSellerBalancesCloud(
  _masterUid: string,
  masterParty: CloudPartyDoc,
  subParties: CloudPartyDoc[],
  subBillsByPartyId: Record<string, SellerBillRow>
): Promise<void> {
  const directSubs = subParties.filter((p) => p.parentMasterId === masterParty.partyId);
  for (const sub of directSubs) {
    const bill = subBillsByPartyId[sub.partyId];
    if (!bill) continue;
    const net = Math.round(bill.total * 100) / 100;
    const nextDue = net > 0 ? net : 0;
    const nextJoma = net < 0 ? Math.round(Math.abs(net) * 100) / 100 : 0;
    if (sub.due === nextDue && sub.joma === nextJoma) continue;
    await updateSubSellerParty(sub, undefined, {
      due: nextDue,
      joma: nextJoma,
    });
  }
}

