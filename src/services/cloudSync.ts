import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  collection as collectionLite,
  deleteDoc as deleteDocLite,
  doc as docLite,
  getDoc as getDocLite,
  getDocs as getDocsLite,
  query as queryLite,
  serverTimestamp as serverTimestampLite,
  setDoc as setDocLite,
  updateDoc as updateDocLite,
  where as whereLite,
  writeBatch as writeBatchLite,
} from 'firebase/firestore/lite';
import {
  auth,
  db,
  dbLite,
  handleFirestoreError,
  OperationType,
  recoverFirestoreNetwork,
  withNetworkTimeout,
} from '../firebase';
import {
  computeSellerBills,
  generatePrizeAndLimitData,
  parseWinningNumbers,
  processSessionRows,
  round2,
} from '../engine/calculations';
import {
  AgencyConfig,
  AppState,
  ArchivedSellerSummary,
  DaySnapshot,
  PrizeListRow,
  Seller,
  SellerBillRow,
  SessionComputation,
  SessionId,
  TicketEntryRow,
} from '../types/ledger';

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

export type CloudAnnouncementKind = 'offer' | 'urgent' | 'notice';

export interface CloudPublicAnnouncement {
  agencyId: string;
  active: boolean;
  kind: CloudAnnouncementKind;
  title: string;
  message: string;
  imageDataUrl?: string;
  ownerUid: string;
  updatedByUid: string;
  updatedAtMs: number;
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
    await withNetworkTimeout(
      updateDocLite(docLite(dbLite, 'agencies', AGENCY_ID), {
        date: sanitizeIsoDate(state.date),
        limitThreshold: sanitizeNumber(state.config.limitThreshold, 1, 1000, 10),
        sellerLimitThreshold: sanitizeNumber(state.config.sellerLimitThreshold ?? 20, 1, 1000, 20),
        excludedPrizeNames: sanitizeStringList(state.config.excludedPrizeNames, 50),
        itemOptions: sanitizeItemOptions(state.config.itemOptions),
        winning1PM: String(state.winningRaw['1PM'] || '').slice(0, 20000),
        winning6PM: String(state.winningRaw['6PM'] || '').slice(0, 20000),
        winning8PM: String(state.winningRaw['8PM'] || '').slice(0, 20000),
        updatedAt: serverTimestampLite(),
      }),
      15000,
      'NETWORK_TIMEOUT: Agency sync timeout ho gaya. 1 baar dubara Sync IDs dabayein.'
    );
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
 * Ultra-fast parallel batch sync for ALL direct sellers (creates new IDs + updates changed
 * rates/due/joma/mobile/credentials in ONE chunked writeBatch round-trip instead of N sequential awaits).
 */
export async function syncAllSellerPartiesBatch(
  adminUid: string,
  ownerUid: string,
  adminUids: string[],
  sellers: Seller[],
  existingDirectParties: CloudPartyDoc[],
  existingPrivates: CloudPartyPrivateDoc[],
  date: string,
  initialEntriesByPartyId: Record<string, Record<SessionId, TicketEntryRow[]>>,
  usedLoginIds: Set<string>
): Promise<{ changedCount: number; totalCount: number }> {
  if (sellers.length === 0) return { changedCount: 0, totalCount: 0 };

  const cleanDate = sanitizeIsoDate(date);
  const safeAdminUids = adminUids.length > 0 ? adminUids.slice(0, 10) : [ownerUid];

  const partyById = new Map<string, CloudPartyDoc>();
  const partyByUpperName = new Map<string, CloudPartyDoc>();
  for (const p of existingDirectParties) {
    partyById.set(p.partyId, p);
    const up = p.name.trim().toUpperCase();
    if (up && !partyByUpperName.has(up)) partyByUpperName.set(up, p);
  }
  const privByPartyId = new Map<string, CloudPartyPrivateDoc>();
  for (const pr of existingPrivates) {
    privByPartyId.set(pr.partyId, pr);
  }

  interface PreparedSellerOp {
    seller: Seller;
    existingParty?: CloudPartyDoc;
    existingPriv?: CloudPartyPrivateDoc;
    partyId: string;
    cleanName: string;
    cleanRate: number;
    cleanDue: number;
    cleanJoma: number;
    cleanMobile: string;
    mode: 'create' | 'backfill' | 'update';
    partyChanged: boolean;
    mobileChanged: boolean;
    loginId?: string;
    loginPassword?: string;
    accessKey?: string;
  }

  const rawTasks: PreparedSellerOp[] = [];
  for (const seller of sellers) {
    const expectedId = makePartyIdFromSeller(seller);
    const upperName = seller.name.trim().toUpperCase();
    const existingParty = partyById.get(expectedId) || partyByUpperName.get(upperName);
    const existingPriv = existingParty ? privByPartyId.get(existingParty.partyId) : undefined;
    const partyId = existingParty?.partyId || expectedId;
    const cleanName = (seller.name.trim() || 'SELLER').slice(0, 60);
    const cleanRate = sanitizeNumber(seller.rate, 0, 10000, 0);
    const cleanDue = sanitizeNumber(seller.due, -100000000, 100000000, 0);
    const cleanJoma = sanitizeNumber(seller.joma, -100000000, 100000000, 0);
    const cleanMobile = String(seller.mobile || '').slice(0, 30);

    if (!existingParty) {
      const loginId = generateEasyLoginId(cleanName, usedLoginIds);
      const loginPassword = generateEasyPassword();
      rawTasks.push({
        seller,
        partyId,
        cleanName,
        cleanRate,
        cleanDue,
        cleanJoma,
        cleanMobile,
        mode: 'create',
        partyChanged: true,
        mobileChanged: true,
        loginId,
        loginPassword,
      });
      continue;
    }

    const partyChanged =
      existingParty.name !== cleanName ||
      existingParty.rate !== cleanRate ||
      existingParty.due !== cleanDue ||
      existingParty.joma !== cleanJoma ||
      existingParty.active === false;
    const mobileChanged = (existingPriv?.mobile || '') !== cleanMobile;
    const needsCredBackfill =
      !existingPriv?.loginId ||
      !existingPriv?.loginPassword ||
      !existingParty.accessKey?.startsWith('cred_');

    if (!partyChanged && !mobileChanged && !needsCredBackfill) {
      continue;
    }

    if (needsCredBackfill) {
      const loginId = existingPriv?.loginId
        ? normalizeLoginId(existingPriv.loginId)
        : generateEasyLoginId(cleanName, usedLoginIds);
      const loginPassword = existingPriv?.loginPassword || generateEasyPassword();
      rawTasks.push({
        seller,
        existingParty,
        existingPriv,
        partyId,
        cleanName,
        cleanRate,
        cleanDue,
        cleanJoma,
        cleanMobile,
        mode: 'backfill',
        partyChanged,
        mobileChanged,
        loginId,
        loginPassword,
      });
    } else {
      rawTasks.push({
        seller,
        existingParty,
        existingPriv,
        partyId,
        cleanName,
        cleanRate,
        cleanDue,
        cleanJoma,
        cleanMobile,
        mode: 'update',
        partyChanged,
        mobileChanged,
      });
    }
  }

  if (rawTasks.length === 0) {
    return { changedCount: 0, totalCount: sellers.length };
  }

  // Compute all credential SHA-256 hashes in parallel
  await Promise.all(
    rawTasks.map(async (t) => {
      if ((t.mode === 'create' || t.mode === 'backfill') && t.loginId && t.loginPassword) {
        t.accessKey = await computeCredentialAccessKey(t.loginId, t.loginPassword);
      }
    })
  );

  // Pack into writeBatch chunks (<= 50 sellers = <= 200 ops per batch, well under Firestore's 500-op limit)
  const CHUNK_SIZE = 45;
  const chunks: PreparedSellerOp[][] = [];
  for (let i = 0; i < rawTasks.length; i += CHUNK_SIZE) {
    chunks.push(rawTasks.slice(i, i + CHUNK_SIZE));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const batch = writeBatchLite(dbLite);
      for (const t of chunk) {
        const partyRef = docLite(dbLite, 'agencies', AGENCY_ID, 'parties', t.partyId);
        const privateRef = docLite(dbLite, 'agencies', AGENCY_ID, 'partyPrivate', t.partyId);

        if (t.mode === 'create' && t.accessKey && t.loginId && t.loginPassword) {
          const inviteRef = docLite(dbLite, 'partyInvites', t.accessKey);
          const sheetRef = docLite(dbLite, 'agencies', AGENCY_ID, 'sheets', t.partyId);
          const init = initialEntriesByPartyId[t.partyId] || { '1PM': [], '6PM': [], '8PM': [] };

          batch.set(partyRef, {
            agencyId: AGENCY_ID,
            partyId: t.partyId,
            name: t.cleanName,
            role: 'master',
            parentMasterId: '',
            parentMasterUid: '',
            ownerUid,
            adminUids: safeAdminUids,
            rate: t.cleanRate,
            due: t.cleanDue,
            joma: t.cleanJoma,
            active: true,
            accessKey: t.accessKey,
            assignedUid: '',
            createdAt: serverTimestampLite(),
            updatedAt: serverTimestampLite(),
          });
          batch.set(privateRef, {
            agencyId: AGENCY_ID,
            partyId: t.partyId,
            ownerUid,
            adminUids: safeAdminUids,
            parentMasterId: '',
            parentMasterUid: '',
            mobile: t.cleanMobile,
            assignedEmail: '',
            loginId: t.loginId,
            loginPassword: t.loginPassword,
            updatedAt: serverTimestampLite(),
          });
          batch.set(inviteRef, {
            accessKey: t.accessKey,
            agencyId: AGENCY_ID,
            partyId: t.partyId,
            partyName: t.cleanName,
            role: 'master',
            parentMasterId: '',
            parentMasterUid: '',
            ownerUid,
            createdByUid: adminUid,
            active: true,
            createdAt: serverTimestampLite(),
            updatedAt: serverTimestampLite(),
          });
          batch.set(sheetRef, {
            agencyId: AGENCY_ID,
            sheetId: t.partyId,
            partyId: t.partyId,
            partyName: t.cleanName,
            role: 'master',
            ownerUid,
            adminUids: safeAdminUids,
            assignedUid: '',
            parentMasterId: '',
            parentMasterUid: '',
            date: cleanDate,
            entries1PM: sanitizeSheetEntriesForCloud(init['1PM'], t.cleanName),
            entries6PM: sanitizeSheetEntriesForCloud(init['6PM'], t.cleanName),
            entries8PM: sanitizeSheetEntriesForCloud(init['8PM'], t.cleanName),
            updatedByUid: adminUid,
            createdAt: serverTimestampLite(),
            updatedAt: serverTimestampLite(),
          });
        } else if (t.mode === 'backfill' && t.existingParty && t.accessKey && t.loginId && t.loginPassword) {
          if (t.existingParty.accessKey && t.existingParty.accessKey !== t.accessKey) {
            batch.delete(docLite(dbLite, 'partyInvites', t.existingParty.accessKey));
          }
          batch.set(docLite(dbLite, 'partyInvites', t.accessKey), {
            accessKey: t.accessKey,
            agencyId: AGENCY_ID,
            partyId: t.partyId,
            partyName: t.cleanName,
            role: t.existingParty.role,
            parentMasterId: t.existingParty.parentMasterId || '',
            parentMasterUid: t.existingParty.parentMasterUid || '',
            ownerUid: t.existingParty.ownerUid,
            createdByUid: adminUid,
            active: true,
            createdAt: serverTimestampLite(),
            updatedAt: serverTimestampLite(),
          });
          batch.update(partyRef, {
            name: t.cleanName,
            rate: t.cleanRate,
            due: t.cleanDue,
            joma: t.cleanJoma,
            active: true,
            accessKey: t.accessKey,
            updatedAt: serverTimestampLite(),
          });
          if (t.existingPriv) {
            batch.update(privateRef, {
              parentMasterId: t.existingParty.parentMasterId || '',
              mobile: t.cleanMobile,
              loginId: t.loginId,
              loginPassword: t.loginPassword,
              updatedAt: serverTimestampLite(),
            });
          } else {
            batch.set(privateRef, {
              agencyId: AGENCY_ID,
              partyId: t.partyId,
              ownerUid,
              adminUids: safeAdminUids,
              parentMasterId: t.existingParty.parentMasterId || '',
              parentMasterUid: t.existingParty.parentMasterUid || '',
              mobile: t.cleanMobile,
              assignedEmail: '',
              loginId: t.loginId,
              loginPassword: t.loginPassword,
              updatedAt: serverTimestampLite(),
            });
          }
        } else if (t.existingParty) {
          if (t.partyChanged) {
            batch.update(partyRef, {
              name: t.cleanName,
              rate: t.cleanRate,
              due: t.cleanDue,
              joma: t.cleanJoma,
              active: true,
              updatedAt: serverTimestampLite(),
            });
            if (
              (t.existingParty.name !== t.cleanName || t.existingParty.active === false) &&
              t.existingParty.accessKey
            ) {
              batch.update(docLite(dbLite, 'partyInvites', t.existingParty.accessKey), {
                partyName: t.cleanName,
                active: true,
                updatedAt: serverTimestampLite(),
              });
            }
          }
          if (t.mobileChanged) {
            if (t.existingPriv) {
              batch.update(privateRef, {
                mobile: t.cleanMobile,
                updatedAt: serverTimestampLite(),
              });
            } else {
              batch.set(privateRef, {
                agencyId: AGENCY_ID,
                partyId: t.partyId,
                ownerUid,
                adminUids: safeAdminUids,
                parentMasterId: t.existingParty.parentMasterId || '',
                parentMasterUid: t.existingParty.parentMasterUid || '',
                mobile: t.cleanMobile,
                assignedEmail: '',
                updatedAt: serverTimestampLite(),
              });
            }
          }
        }
      }

      try {
        await withNetworkTimeout(
          batch.commit(),
          15000,
          'NETWORK_TIMEOUT: Seller IDs sync timeout ho gaya. 1 baar dubara Sync IDs dabayein.'
        );
      } catch (batchErr) {
        const msg = batchErr instanceof Error ? batchErr.message : String(batchErr);
        const lower = msg.toLowerCase();
        if (
          msg.includes('NETWORK_TIMEOUT') ||
          lower.includes('quota') ||
          lower.includes('resource-exhausted') ||
          lower.includes('permission')
        ) {
          throw batchErr;
        }
        // Fallback to parallel per-party commit if any single doc failed rules (e.g. missing invite doc)
        await Promise.all(
          chunk.map((t) =>
            createOrSyncSellerParty(
              adminUid,
              ownerUid,
              safeAdminUids,
              t.seller,
              t.existingParty,
              t.existingPriv,
              cleanDate,
              initialEntriesByPartyId[t.partyId] || { '1PM': [], '6PM': [], '8PM': [] },
              usedLoginIds
            )
          )
        );
      }
    })
  );

  return { changedCount: rawTasks.length, totalCount: sellers.length };
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
  const sheetRef = docLite(dbLite, 'agencies', AGENCY_ID, 'sheets', party.partyId);
  const cleanDate = sanitizeIsoDate(date);
  const e1 = sanitizeSheetEntriesForCloud(entries1PM, party.name);
  const e6 = sanitizeSheetEntriesForCloud(entries6PM, party.name);
  const e8 = sanitizeSheetEntriesForCloud(entries8PM, party.name);

  try {
    if (sheetExists) {
      await withNetworkTimeout(
        updateDocLite(sheetRef, {
          partyName: party.name,
          date: cleanDate,
          entries1PM: e1,
          entries6PM: e6,
          entries8PM: e8,
          updatedByUid: adminUid,
          updatedAt: serverTimestampLite(),
        }),
        15000,
        'NETWORK_TIMEOUT: Sheet sync timeout ho gaya. 1 baar dubara Sync IDs dabayein.'
      );
    } else {
      await withNetworkTimeout(
        setDocLite(sheetRef, {
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
          createdAt: serverTimestampLite(),
          updatedAt: serverTimestampLite(),
        }),
        15000,
        'NETWORK_TIMEOUT: Sheet create timeout ho gaya. 1 baar dubara Sync IDs dabayein.'
      );
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

async function safeDeleteCompanionDocLite(ref: ReturnType<typeof docLite>): Promise<void> {
  try {
    await deleteDocLite(ref);
  } catch {
    // Companion doc may already be deleted, missing, or reassigned to another session
  }
}

async function safeUpdateCompanionDocLite(
  ref: ReturnType<typeof docLite>,
  patch: Record<string, unknown>
): Promise<void> {
  try {
    await updateDocLite(ref, patch);
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
    await withNetworkTimeout(
      updateDocLite(docLite(dbLite, 'agencies', AGENCY_ID, 'parties', party.partyId), {
        active: nextActive,
        updatedAt: serverTimestampLite(),
      }),
      12000
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
  const tasks: Promise<void>[] = [];
  if (party.accessKey) {
    tasks.push(
      safeUpdateCompanionDocLite(docLite(dbLite, 'partyInvites', party.accessKey), {
        active: nextActive,
        updatedAt: serverTimestampLite(),
      })
    );
  }
  if (party.assignedUid && party.assignedUid !== activeUid) {
    tasks.push(
      safeUpdateCompanionDocLite(docLite(dbLite, 'agencies', AGENCY_ID, 'members', party.assignedUid), {
        active: nextActive,
        updatedAt: serverTimestampLite(),
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
  const batch = writeBatchLite(dbLite);

  if (existingInvite) {
    batch.update(docLite(dbLite, 'partyInvites', newKey), {
      partyName: party.name,
      role: party.role,
      active: true,
      updatedAt: serverTimestampLite(),
    });
  } else {
    batch.set(docLite(dbLite, 'partyInvites', newKey), {
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
      createdAt: serverTimestampLite(),
      updatedAt: serverTimestampLite(),
    });
  }

  batch.update(docLite(dbLite, 'agencies', agencyId, 'parties', party.partyId), {
    accessKey: newKey,
    ...(unbindOldPhone ? { assignedUid: '' } : {}),
    active: true,
    updatedAt: serverTimestampLite(),
  });

  const privateRef = docLite(dbLite, 'agencies', agencyId, 'partyPrivate', party.partyId);
  if (existingPrivate) {
    batch.update(privateRef, {
      parentMasterId: party.parentMasterId || '',
      loginId,
      loginPassword,
      updatedAt: serverTimestampLite(),
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
      updatedAt: serverTimestampLite(),
    });
  }

  try {
    await withNetworkTimeout(
      batch.commit(),
      15000,
      'NETWORK_TIMEOUT: Login ID/Password save timeout ho gaya. Dubara try karein.'
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }

  // Clean up old invite / old phone member / sheet assignedUid safely without failing the credential save
  const cleanupTasks: Promise<void>[] = [];
  if (party.accessKey && party.accessKey !== newKey) {
    cleanupTasks.push(safeDeleteCompanionDocLite(docLite(dbLite, 'partyInvites', party.accessKey)));
  }
  if (unbindOldPhone && party.assignedUid && party.assignedUid !== activeActorUid) {
    cleanupTasks.push(
      safeUpdateCompanionDocLite(docLite(dbLite, 'agencies', agencyId, 'members', party.assignedUid), {
        active: false,
        updatedAt: serverTimestampLite(),
      })
    );
  }
  if (unbindOldPhone && sheetExists) {
    cleanupTasks.push(
      safeUpdateCompanionDocLite(docLite(dbLite, 'agencies', agencyId, 'sheets', party.partyId), {
        assignedUid: '',
        updatedByUid: activeActorUid,
        updatedAt: serverTimestampLite(),
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
    const snap = await withNetworkTimeout(
      getDocLite(docLite(dbLite, 'partyInvites', accessKey)),
      10000
    );
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
  const inviteDocRef = docLite(dbLite, 'partyInvites', accessKey);
  let inviteSnap;
  try {
    inviteSnap = await withNetworkTimeout(
      getDocLite(inviteDocRef),
      12000,
      'NETWORK_TIMEOUT: Login verify karne me network slow hai. Dubara try karein.'
    );
  } catch (firstErr) {
    const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    if (firstMsg.includes('NETWORK_TIMEOUT') || firstMsg.toLowerCase().includes('offline')) {
      await recoverFirestoreNetwork();
      try {
        inviteSnap = await withNetworkTimeout(
          getDocLite(inviteDocRef),
          12000,
          'NETWORK_TIMEOUT: Server se connection nahi ban pa raha. Internet check karke dubara Login dabayein.'
        );
      } catch (retryErr) {
        handleFirestoreError(retryErr, OperationType.GET, invitePath);
      }
    } else {
      handleFirestoreError(firstErr, OperationType.GET, invitePath);
    }
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
  const memberRef = docLite(dbLite, 'agencies', agencyId, 'members', uid);
  const partyRef = docLite(dbLite, 'agencies', agencyId, 'parties', partyId);
  const profileRef = docLite(dbLite, 'userProfiles', uid);

  let memberExists = false;
  let profileExists = false;
  try {
    const [mSnap, pSnap] = await withNetworkTimeout(
      Promise.all([getDocLite(memberRef), getDocLite(profileRef)]),
      12000,
      'NETWORK_TIMEOUT: Profile load hone me samay lag raha hai. Dubara Login dabayein.'
    );
    memberExists = mSnap.exists();
    profileExists = pSnap.exists();
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `agencies/${agencyId}/members/${uid}`);
  }

  const batch = writeBatchLite(dbLite);
  if (memberExists) {
    batch.update(memberRef, {
      partyId,
      role: invite.role,
      parentMasterId: invite.parentMasterId || '',
      accessKey,
      active: true,
      updatedAt: serverTimestampLite(),
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
      createdAt: serverTimestampLite(),
      updatedAt: serverTimestampLite(),
    });
  }

  batch.update(partyRef, {
    assignedUid: uid,
    updatedAt: serverTimestampLite(),
  });

  if (profileExists) {
    batch.update(profileRef, {
      agencyId,
      partyId,
      role: invite.role,
      updatedAt: serverTimestampLite(),
    });
  } else {
    batch.set(profileRef, {
      uid,
      agencyId,
      partyId,
      role: invite.role,
      updatedAt: serverTimestampLite(),
    });
  }

  try {
    await withNetworkTimeout(
      batch.commit(),
      15000,
      'NETWORK_TIMEOUT: Login save hone me timeout ho gaya. Dubara Login dabayein.'
    );
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
 * One-shot fetch of all agency parties & live sheets (used as a safety net during Day Close
 * if live listeners haven't populated yet).
 */
export async function fetchAdminPartiesAndSheetsOnce(
  ownerUid: string,
  agencyId = AGENCY_ID
): Promise<{ parties: CloudPartyDoc[]; sheets: CloudPartySheetDoc[] }> {
  const cleanAgencyId = sanitizeId(agencyId || AGENCY_ID, AGENCY_ID);
  const [partiesSnap, sheetsSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, 'agencies', cleanAgencyId, 'parties'),
        where('ownerUid', '==', ownerUid)
      )
    ),
    getDocs(
      query(
        collection(db, 'agencies', cleanAgencyId, 'sheets'),
        where('ownerUid', '==', ownerUid)
      )
    ),
  ]);
  return {
    parties: partiesSnap.docs.map((d) => d.data() as CloudPartyDoc),
    sheets: sheetsSnap.docs.map((d) => d.data() as CloudPartySheetDoc),
  };
}

/**
 * Ultra-fast stateless dbLite fetch of agency parties ONLY (zero sheets downloaded).
 * Used by Sync IDs when live party listener hasn't populated yet.
 */
export async function fetchAdminPartiesOnlyOnce(
  ownerUid: string,
  agencyId = AGENCY_ID
): Promise<CloudPartyDoc[]> {
  const cleanAgencyId = sanitizeId(agencyId || AGENCY_ID, AGENCY_ID);
  const partiesCol = collectionLite(dbLite, 'agencies', cleanAgencyId, 'parties');
  if (ownerUid) {
    try {
      const snap = await withNetworkTimeout(
        getDocsLite(queryLite(partiesCol, whereLite('ownerUid', '==', ownerUid))),
        10000
      );
      if (snap.docs.length > 0) {
        return snap.docs.map((d) => d.data() as CloudPartyDoc);
      }
    } catch {
      // Fallback to unfiltered admin read below
    }
  }
  try {
    const snap = await withNetworkTimeout(getDocsLite(partiesCol), 10000);
    return snap.docs.map((d) => d.data() as CloudPartyDoc);
  } catch {
    return [];
  }
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
  const batch = writeBatchLite(dbLite);
  batch.update(docLite(dbLite, 'agencies', agencyId, 'parties', subParty.partyId), {
    parentMasterUid: lineage.parentMasterUid,
    ancestorMasterIds: lineage.ancestorMasterIds,
    ancestorMasterUids: lineage.ancestorMasterUids,
    updatedAt: serverTimestampLite(),
  });
  if (hasPrivate && lineage.parentMasterUid && subParty.parentMasterUid !== lineage.parentMasterUid) {
    batch.update(docLite(dbLite, 'agencies', agencyId, 'partyPrivate', subParty.partyId), {
      parentMasterUid: lineage.parentMasterUid,
      updatedAt: serverTimestampLite(),
    });
  }
  if (subParty.accessKey && lineage.parentMasterUid && subParty.parentMasterUid !== lineage.parentMasterUid) {
    batch.update(docLite(dbLite, 'partyInvites', subParty.accessKey), {
      parentMasterUid: lineage.parentMasterUid,
      updatedAt: serverTimestampLite(),
    });
  }
  if (hasSheet) {
    batch.update(docLite(dbLite, 'agencies', agencyId, 'sheets', subParty.partyId), {
      parentMasterUid: lineage.parentMasterUid,
      ancestorMasterIds: lineage.ancestorMasterIds,
      ancestorMasterUids: lineage.ancestorMasterUids,
      updatedByUid: adminUid,
      updatedAt: serverTimestampLite(),
    });
  }
  try {
    await withNetworkTimeout(batch.commit(), 12000);
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

  // Signed-in Master / Sub-Master live multi-level listeners (Ultra-Low-Read):
  // Subscribe to parties FIRST; only attach partyPrivate & sheets listeners once at least 1
  // Sub-Seller actually exists (eliminates 4 unnecessary live listeners on Masters with 0 subs!).
  const directPartyMap = new Map<string, CloudPartyDoc>();
  const deepPartyMap = new Map<string, CloudPartyDoc>();
  const directSheetMap = new Map<string, CloudPartySheetDoc>();
  const deepSheetMap = new Map<string, CloudPartySheetDoc>();
  const uidPrivMap = new Map<string, CloudPartyPrivateDoc>();
  const idPrivMap = new Map<string, CloudPartyPrivateDoc>();

  let childListenersActive = false;
  let unsubPrivatesByUid: Unsubscribe | null = null;
  let unsubPrivatesByMasterId: Unsubscribe | null = null;
  let unsubDirectSheets: Unsubscribe | null = null;
  let unsubDeepSheets: Unsubscribe | null = null;

  const emitPrivates = () => {
    const merged = new Map<string, CloudPartyPrivateDoc>();
    for (const [id, pr] of uidPrivMap.entries()) merged.set(id, pr);
    for (const [id, pr] of idPrivMap.entries()) merged.set(id, pr);
    callbacks.onSubPrivates(Array.from(merged.values()));
  };

  const emitSheets = () => {
    const merged = new Map<string, CloudPartySheetDoc>();
    for (const [id, s] of directSheetMap.entries()) merged.set(id, s);
    for (const [id, s] of deepSheetMap.entries()) merged.set(id, s);
    callbacks.onSubSheets(Array.from(merged.values()));
  };

  const detachChildListeners = () => {
    if (!childListenersActive) return;
    childListenersActive = false;
    unsubPrivatesByUid?.();
    unsubPrivatesByMasterId?.();
    unsubDirectSheets?.();
    unsubDeepSheets?.();
    unsubPrivatesByUid = null;
    unsubPrivatesByMasterId = null;
    unsubDirectSheets = null;
    unsubDeepSheets = null;
    uidPrivMap.clear();
    idPrivMap.clear();
    directSheetMap.clear();
    deepSheetMap.clear();
    callbacks.onSubPrivates([]);
    callbacks.onSubSheets([]);
  };

  const ensureChildListeners = () => {
    if (childListenersActive) return;
    childListenersActive = true;

    unsubPrivatesByUid = onSnapshot(
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

    unsubPrivatesByMasterId = onSnapshot(
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

    unsubDirectSheets = onSnapshot(
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

    unsubDeepSheets = onSnapshot(
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
  };

  const emitParties = () => {
    const merged = new Map<string, CloudPartyDoc>();
    for (const [id, p] of directPartyMap.entries()) merged.set(id, p);
    for (const [id, p] of deepPartyMap.entries()) merged.set(id, p);
    const allDesc = Array.from(merged.values());
    const direct = allDesc.filter((p) => p.parentMasterId === masterPartyId);
    callbacks.onSubParties(direct);
    callbacks.onAllChainParties?.(allDesc);
    if (allDesc.length > 0) {
      ensureChildListeners();
    } else {
      detachChildListeners();
    }
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

  return () => {
    unsubDirectParties();
    unsubDeepParties();
    detachChildListeners();
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

export const ARCHIVE_RETENTION_DAYS = 7;
export const ARCHIVE_RETENTION_MS = ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Returns true strictly when an archive snapshot is at least 7 full days old
 * (measured from savedAt/deletedAt, or end of snapshot date if timestamp missing).
 */
export function isArchiveSnapshotExpired(
  snap: Pick<DaySnapshot, 'date' | 'savedAt' | 'deletedAt'> | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!snap) return true;
  const rawTs = snap.deletedAt || snap.savedAt || '';
  const parsedTs = Date.parse(rawTs);
  if (Number.isFinite(parsedTs)) {
    return nowMs - parsedTs >= ARCHIVE_RETENTION_MS;
  }
  const dateStr = String(snap.date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const endOfDayTs = Date.parse(`${dateStr}T23:59:59Z`);
    if (Number.isFinite(endOfDayTs)) {
      return nowMs - endOfDayTs >= ARCHIVE_RETENTION_MS;
    }
  }
  return false;
}

/**
 * Admin-only background cleanup: permanently deletes partyArchives older than 7 days
 * from Firestore so Seller/Master/Sub-Seller archive storage stays lean and fast.
 */
export async function purgeExpiredPartyArchivesCloud(agencyId = AGENCY_ID): Promise<void> {
  const cleanAgencyId = sanitizeId(agencyId || AGENCY_ID, AGENCY_ID);
  try {
    const snap = await withNetworkTimeout(
      getDocsLite(collectionLite(dbLite, 'agencies', cleanAgencyId, 'partyArchives')),
      12000
    );
    const nowMs = Date.now();
    const expiredIds: string[] = [];
    for (const d of snap.docs) {
      const data = d.data() as CloudPartyArchiveDoc;
      if (!data) continue;
      const expired = isArchiveSnapshotExpired(
        {
          date: data.date || data.payload?.date || '',
          savedAt: data.savedAt || data.payload?.savedAt || '',
        },
        nowMs
      );
      if (expired) expiredIds.push(d.id);
    }
    const CONCURRENCY = 4;
    for (let i = 0; i < expiredIds.length; i += CONCURRENCY) {
      const slice = expiredIds.slice(i, i + CONCURRENCY);
      await Promise.all(
        slice.map(async (id) => {
          try {
            await withNetworkTimeout(
              deleteDocLite(docLite(dbLite, 'agencies', cleanAgencyId, 'partyArchives', id)),
              10000
            );
          } catch {
            // Non-fatal cleanup error
          }
        })
      );
    }
  } catch {
    // Ignore transient network errors during background cleanup
  }
}

function sanitizePartyArchiveEntryRows(
  rows: TicketEntryRow[] | undefined,
  maxRows = 600
): TicketEntryRow[] {
  if (!Array.isArray(rows) || maxRows <= 0) return [];
  const out: TicketEntryRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const start = String(r.start || '').trim().slice(0, 20);
    const end = String(r.end || '').trim().slice(0, 20);
    const qtyOverride = String(r.qtyOverride || '').trim().slice(0, 20);
    const rangeOverride = String(r.rangeOverride || '').trim().slice(0, 20);
    if (!start && !end && !qtyOverride && !rangeOverride) continue;
    out.push({
      id: String(r.id || `row-${out.length}`).slice(0, 96),
      name: String(r.name || '').trim().slice(0, 60),
      item: String(r.item || '').trim().slice(0, 20),
      start,
      end,
      qtyOverride,
      rangeOverride,
    });
    if (out.length >= maxRows) break;
  }
  return out;
}

// Safe JSON byte cap so Firestore's protobuf serialization (~1.6x-2.1x JSON for arrays of maps)
// stays fast (<450 KB protobuf) and NEVER approaches Firestore's 1 MiB document limit on heavy Masters (e.g. 7,000+ tickets).
const MAX_PARTY_ARCHIVE_PAYLOAD_BYTES = 260_000;

function buildCompactPartyArchivePayload(payload: DaySnapshot): DaySnapshot {
  return {
    ...payload,
    prizeList: (payload.prizeList || []).slice(0, 120),
    entries: { '1PM': [], '6PM': [], '8PM': [] },
  };
}

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
  const allPrizes = (snapshot.prizeList || []).slice(0, 300).map((p) => ({
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
  const sellers = (snapshot.sellers || []).slice(0, 120).map((s, idx) => ({
    id: String(s.id || `seller-${idx}`).slice(0, 64),
    name: String(s.name || '').trim().slice(0, 60),
    mobile: '',
    rate: Number(s.rate) || 0,
    due: Number(s.due) || 0,
    joma: Number(s.joma) || 0,
  }));
  const winningRaw = {
    '1PM': String(snapshot.winningRaw?.['1PM'] || '').slice(0, 6000),
    '6PM': String(snapshot.winningRaw?.['6PM'] || '').slice(0, 6000),
    '8PM': String(snapshot.winningRaw?.['8PM'] || '').slice(0, 6000),
  };
  const adminAccountSummary = snapshot.adminAccountSummary
    ? {
        name: String(snapshot.adminAccountSummary.name || '').slice(0, 60),
        mor: Number(snapshot.adminAccountSummary.mor) || 0,
        day: Number(snapshot.adminAccountSummary.day) || 0,
        eve: Number(snapshot.adminAccountSummary.eve) || 0,
        sold: Number(snapshot.adminAccountSummary.sold) || 0,
        bill: Number(snapshot.adminAccountSummary.bill) || 0,
        prizeTotal: Number(snapshot.adminAccountSummary.prizeTotal) || 0,
        fresh: Number(snapshot.adminAccountSummary.fresh) || 0,
        joma: Number(snapshot.adminAccountSummary.joma) || 0,
        due: Number(snapshot.adminAccountSummary.due) || 0,
        total: Number(snapshot.adminAccountSummary.total) || 0,
      }
    : undefined;

  const basePayload = {
    id: cleanId,
    date: cleanDate,
    savedAt: String(snapshot.savedAt || new Date().toISOString()).slice(0, 64),
    trigger: (
      snapshot.trigger === 'day-close' || snapshot.trigger === 'daily-auto'
        ? snapshot.trigger
        : 'manual'
    ) as DaySnapshot['trigger'],
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
    ...(adminAccountSummary ? { adminAccountSummary } : {}),
    limitPrizeGroups: [] as DaySnapshot['limitPrizeGroups'],
    sellers,
    winningRaw,
  };

  // Fast path: <= 400 total rows is guaranteed well below Firestore's 1 MiB document limit,
  // avoiding expensive JSON.stringify serialization on every party during Sync IDs & Day Close.
  const e1Full = sanitizePartyArchiveEntryRows(snapshot.entries?.['1PM'], 600);
  const e6Full = sanitizePartyArchiveEntryRows(snapshot.entries?.['6PM'], 600);
  const e8Full = sanitizePartyArchiveEntryRows(snapshot.entries?.['8PM'], 600);
  const fullCandidate: DaySnapshot = {
    ...basePayload,
    prizeList: allPrizes,
    entries: {
      '1PM': e1Full,
      '6PM': e6Full,
      '8PM': e8Full,
    },
  };
  const totalRowCount =
    e1Full.length + e6Full.length + e8Full.length + allPrizes.length + summaries.length + sellers.length;
  if (totalRowCount <= 150 || JSON.stringify(fullCandidate).length <= MAX_PARTY_ARCHIVE_PAYLOAD_BYTES) {
    return fullCandidate;
  }

  // Heavy Master fallback (6,000+ tickets): shrink entries progressively so uploads stay fast & well under 1 MiB
  const shrinkCaps = [180, 90, 35, 0];
  for (const cap of shrinkCaps) {
    const candidate: DaySnapshot = {
      ...basePayload,
      prizeList: allPrizes,
      entries: {
        '1PM': e1Full.slice(0, cap),
        '6PM': e6Full.slice(0, cap),
        '8PM': e8Full.slice(0, cap),
      },
    };
    if (JSON.stringify(candidate).length <= MAX_PARTY_ARCHIVE_PAYLOAD_BYTES) {
      return candidate;
    }
  }

  return {
    ...basePayload,
    prizeList: allPrizes.slice(0, 120),
    entries: { '1PM': [], '6PM': [], '8PM': [] },
  };
}

/**
 * Generates a collision-free Firestore document ID for a party's daily archive.
 * Uses the trailing 24 chars of partyId PLUS an FNV-1a hash of the full partyId so
 * parties created in the same millisecond (e.g. `seller-gs-1763...`) NEVER collide.
 */
export function makeUniquePartyArchiveId(
  partyId: string,
  cleanDate: string,
  uniqueSalt?: string
): string {
  const cleanPid = String(partyId || 'party').replace(/[^a-zA-Z0-9_-]/g, '');
  const dateCompact = sanitizeIsoDate(cleanDate).replace(/[^0-9]/g, '').slice(0, 8) || '00000000';
  let h = 2166136261;
  for (let i = 0; i < cleanPid.length; i += 1) {
    h ^= cleanPid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const pidHash = (h >>> 0).toString(36);
  const tail = cleanPid.slice(-24) || 'p';
  const cleanSalt = uniqueSalt ? String(uniqueSalt).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8) : '';
  const raw = cleanSalt
    ? `pa-${dateCompact}-${tail}-${pidHash}-${cleanSalt}`
    : `pa-${dateCompact}-${tail}-${pidHash}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function sanitizeOptionalRuleId(raw: string | undefined | null): string {
  return String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 128);
}

function buildPartyArchiveDocBody(
  actorUid: string,
  party: CloudPartyDoc,
  targetId: string,
  cleanDate: string,
  targetPayload: DaySnapshot,
  isAdminActor: boolean
) {
  const cleanAgencyId = sanitizeOptionalRuleId(party.agencyId || AGENCY_ID) || AGENCY_ID;
  const cleanOwnerUid =
    sanitizeOptionalRuleId(party.ownerUid || actorUid) || sanitizeOptionalRuleId(actorUid);
  const cleanPartyId = sanitizeOptionalRuleId(party.partyId);
  const cleanSnapshotId = sanitizeOptionalRuleId(targetId);
  const cleanAssignedUid = sanitizeOptionalRuleId(isAdminActor ? party.assignedUid || '' : actorUid);
  const cleanParentMasterId = sanitizeOptionalRuleId(party.parentMasterId || '');
  const cleanParentMasterUid = sanitizeOptionalRuleId(party.parentMasterUid || '');
  const rawAdminUids =
    Array.isArray(party.adminUids) && party.adminUids.length > 0
      ? party.adminUids
      : [cleanOwnerUid];
  const adminUids = Array.from(
    new Set(
      [cleanOwnerUid, ...rawAdminUids]
        .map((u) => (typeof u === 'string' ? sanitizeOptionalRuleId(u) : ''))
        .filter((u) => u.length > 0)
    )
  ).slice(0, 10);
  const cleanSavedAt = String(targetPayload.savedAt || new Date().toISOString()).slice(0, 64);
  const cleanTrigger: DaySnapshot['trigger'] =
    targetPayload.trigger === 'day-close' || targetPayload.trigger === 'daily-auto'
      ? targetPayload.trigger
      : 'manual';

  return {
    cleanAgencyId,
    cleanOwnerUid,
    adminUids,
    body: {
      agencyId: cleanAgencyId,
      snapshotId: cleanSnapshotId,
      partyId: cleanPartyId,
      partyName: (party.name || 'SELLER').trim().slice(0, 60) || 'SELLER',
      ownerUid: cleanOwnerUid,
      adminUids,
      assignedUid: cleanAssignedUid,
      parentMasterId: cleanParentMasterId,
      parentMasterUid: cleanParentMasterUid,
      date: cleanDate,
      savedAt: cleanSavedAt,
      trigger: cleanTrigger,
      payload: targetPayload,
      createdAt: serverTimestampLite(),
      updatedAt: serverTimestampLite(),
    },
  };
}

export async function savePartyArchiveCloud(
  actorUid: string,
  party: CloudPartyDoc,
  snapshot: DaySnapshot,
  isAdminActor = false
): Promise<DaySnapshot> {
  const cleanDate = sanitizeIsoDate(snapshot.date);
  const safeSuffix = String(snapshot.id || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
  const snapshotId =
    safeSuffix.length >= 4
      ? safeSuffix
      : makeUniquePartyArchiveId(party.partyId, cleanDate, Math.random().toString(36).slice(2, 6));
  const payload = sanitizePartyArchivePayload(snapshot, snapshotId, cleanDate);
  const { cleanAgencyId, body } = buildPartyArchiveDocBody(
    actorUid,
    party,
    snapshotId,
    cleanDate,
    payload,
    isAdminActor
  );

  // Use stateless dbLite HTTPS REST so every save is 100% server-acknowledged on Firestore
  // before resolving (eliminates memoryLocalCache illusions that disappear on app restart).
  const ref = docLite(dbLite, 'agencies', cleanAgencyId, 'partyArchives', snapshotId);
  const commitSetOrUpdate = async (targetPayload: DaySnapshot): Promise<DaySnapshot> => {
    const built =
      targetPayload === payload
        ? { cleanAgencyId, body }
        : buildPartyArchiveDocBody(actorUid, party, snapshotId, cleanDate, targetPayload, isAdminActor);
    try {
      await withNetworkTimeout(setDocLite(ref, built.body), 15000);
      return targetPayload;
    } catch (firstErr) {
      // Idempotency & collision recovery: if a doc with `snapshotId` already exists in Firestore,
      // `setDocLite` hits `allow update` (which forbids modifying `createdAt` or `partyId`).
      const existingSnap = await withNetworkTimeout(getDocLite(ref), 10000).catch(() => null);
      if (existingSnap && existingSnap.exists()) {
        const existingData = existingSnap.data() as Partial<CloudPartyArchiveDoc>;
        if (existingData?.partyId === party.partyId) {
          await withNetworkTimeout(
            updateDocLite(ref, {
              ...(isAdminActor
                ? {
                    adminUids: built.body.adminUids,
                    assignedUid: built.body.assignedUid,
                  }
                : {}),
              date: cleanDate,
              payload: targetPayload,
              updatedAt: serverTimestampLite(),
            }),
            15000
          );
          return targetPayload;
        }
        // Different party owned that legacy ID -> mint a fresh unique ID and create cleanly
        const freshId = makeUniquePartyArchiveId(
          party.partyId,
          cleanDate,
          Math.random().toString(36).slice(2, 6)
        );
        const freshPayload = sanitizePartyArchivePayload(targetPayload, freshId, cleanDate);
        const freshBuilt = buildPartyArchiveDocBody(
          actorUid,
          party,
          freshId,
          cleanDate,
          freshPayload,
          isAdminActor
        );
        const freshRef = docLite(dbLite, 'agencies', cleanAgencyId, 'partyArchives', freshId);
        await withNetworkTimeout(setDocLite(freshRef, freshBuilt.body), 15000);
        return freshPayload;
      }
      throw firstErr;
    }
  };

  try {
    return await commitSetOrUpdate(payload);
  } catch (firstErr) {
    // Guaranteed-under-1MiB compact fallback if a heavy Master snapshot hit Firestore's 1 MiB protobuf cap
    const hasEntries =
      (payload.entries?.['1PM']?.length || 0) +
        (payload.entries?.['6PM']?.length || 0) +
        (payload.entries?.['8PM']?.length || 0) >
      0;
    if (hasEntries) {
      try {
        const compactPayload = buildCompactPartyArchivePayload(payload);
        return await commitSetOrUpdate(compactPayload);
      } catch {
        // Fall through to report original error below
      }
    }
    handleFirestoreError(firstErr, OperationType.CREATE, ref.path);
  }
}

export async function updatePartyArchiveDateCloud(
  agencyId: string,
  snapshot: DaySnapshot,
  newDate: string
): Promise<void> {
  const cleanDate = sanitizeIsoDate(newDate);
  const ref = docLite(dbLite, 'agencies', agencyId, 'partyArchives', snapshot.id);
  const updatedPayload = sanitizePartyArchivePayload(
    { ...snapshot, date: cleanDate },
    snapshot.id,
    cleanDate
  );
  try {
    await withNetworkTimeout(
      updateDocLite(ref, {
        date: cleanDate,
        payload: updatedPayload,
        updatedAt: serverTimestampLite(),
      }),
      15000
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, ref.path);
  }
}

export async function deletePartyArchiveCloud(
  agencyId: string,
  snapshotId: string
): Promise<void> {
  const ref = docLite(dbLite, 'agencies', agencyId, 'partyArchives', snapshotId);
  try {
    await withNetworkTimeout(deleteDocLite(ref), 12000);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code || '';
    if (code === 'not-found') return;
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
      // Ignore stale memoryLocalCache snapshots while online so fresh stateless dbLite Sync IDs
      // writes are never briefly overwritten by older cached data.
      if (snap.metadata.fromCache && typeof navigator !== 'undefined' && navigator.onLine !== false) {
        return;
      }
      const nowMs = Date.now();
      const list: DaySnapshot[] = [];
      for (const d of snap.docs) {
        const data = d.data() as CloudPartyArchiveDoc;
        if (!data || !data.payload) continue;
        const hydrated: DaySnapshot = {
          ...data.payload,
          id: data.snapshotId || d.id,
          date: data.date || data.payload.date,
          savedAt: data.savedAt || data.payload.savedAt,
          trigger: data.trigger || data.payload.trigger || 'manual',
        };
        if (isArchiveSnapshotExpired(hydrated, nowMs)) continue;
        list.push(hydrated);
      }
      list.sort(
        (a, b) =>
          (b.date || '').localeCompare(a.date || '') ||
          (b.savedAt || '').localeCompare(a.savedAt || '')
      );
      onSnapshots(list.slice(0, 30));
    },
    () => {
      // Keep local cached archives visible if offline or permission refresh pending
    }
  );
}

/**
 * Lightweight one-shot fetch of a party's cloud archives via stateless dbLite
 * (avoids holding a permanent onSnapshot over large archive documents while on non-Archive tabs).
 */
export async function fetchPartyArchivesOnce(
  agencyId: string,
  partyId: string
): Promise<DaySnapshot[]> {
  try {
    const q = queryLite(
      collectionLite(dbLite, 'agencies', agencyId, 'partyArchives'),
      whereLite('partyId', '==', partyId)
    );
    const snap = await withNetworkTimeout(getDocsLite(q), 12000);
    const nowMs = Date.now();
    const list: DaySnapshot[] = [];
    for (const d of snap.docs) {
      const data = d.data() as CloudPartyArchiveDoc;
      if (!data || !data.payload) continue;
      const hydrated: DaySnapshot = {
        ...data.payload,
        id: data.snapshotId || d.id,
        date: data.date || data.payload.date,
        savedAt: data.savedAt || data.payload.savedAt,
        trigger: data.trigger || data.payload.trigger || 'manual',
      };
      if (isArchiveSnapshotExpired(hydrated, nowMs)) continue;
      list.push(hydrated);
    }
    list.sort(
      (a, b) =>
        (b.date || '').localeCompare(a.date || '') ||
        (b.savedAt || '').localeCompare(a.savedAt || '')
    );
    return list.slice(0, 30);
  } catch {
    return [];
  }
}

/**
 * Ultra-cheap 1-doc timestamp peek on /agencies/{agencyId} so Admin reloads with warm
 * local IndexedDB can verify whether another Admin device wrote newer cloud data
 * without downloading MBs of adminLedgerChunks & archives on every page load.
 */
export async function peekAgencyUpdatedAtMs(agencyId = AGENCY_ID): Promise<number> {
  const cleanAgencyId = sanitizeId(agencyId || AGENCY_ID, AGENCY_ID);
  try {
    const snap = await withNetworkTimeout(
      getDocLite(docLite(dbLite, 'agencies', cleanAgencyId)),
      8000
    );
    if (!snap.exists()) return 0;
    const raw = snap.data() as Record<string, unknown>;
    const val = raw.updatedAt;
    if (!val) return 0;
    if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
    if (typeof val === 'object' && val !== null) {
      const obj = val as { toMillis?: () => number; seconds?: number };
      if (typeof obj.toMillis === 'function') return obj.toMillis();
      if (typeof obj.seconds === 'number') return obj.seconds * 1000;
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Stateless HTTPS REST fetch of /agencies/{agencyId} so Seller/Master portals always see
 * the true live billing date (e.g. right after Admin Close Day) even if WebSocket reconnects slowly.
 */
export async function fetchAgencyDocOnce(agencyId = AGENCY_ID): Promise<CloudAgencyDoc | null> {
  const cleanAgencyId = sanitizeId(agencyId || AGENCY_ID, AGENCY_ID);
  try {
    const snap = await withNetworkTimeout(
      getDocLite(docLite(dbLite, 'agencies', cleanAgencyId)),
      10000
    );
    return snap.exists() ? (snap.data() as CloudAgencyDoc) : null;
  } catch {
    return null;
  }
}

/**
 * Admin-only lightweight balance update on a party's current-day live document
 * (updates ONLY due, joma, updatedAt so live entries/date/winning remain 100% untouched).
 */
export async function updatePartyBalancesAdminCloud(
  agencyId: string,
  partyId: string,
  due: number,
  joma: number
): Promise<void> {
  const safeDue = Math.max(-100000000, Math.min(100000000, round2(Number(due) || 0)));
  const safeJoma = Math.max(-100000000, Math.min(100000000, round2(Number(joma) || 0)));
  const ref = doc(db, 'agencies', agencyId, 'parties', partyId);
  try {
    await updateDoc(ref, {
      due: safeDue,
      joma: safeJoma,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, ref.path);
  }
}

function isTicketEntryRowBlank(r: TicketEntryRow | undefined | null): boolean {
  if (!r) return true;
  return (
    !String(r.name || '').trim() &&
    !String(r.item || '').trim() &&
    !String(r.start || '').trim() &&
    !String(r.end || '').trim() &&
    !String(r.qtyOverride || '').trim() &&
    !String(r.rangeOverride || '').trim()
  );
}

async function fetchAllAgencyPartyArchives(
  agencyId: string,
  ownerUid: string,
  actorUid: string,
  activeParties: CloudPartyDoc[],
  targetDate?: string
): Promise<Array<{ docId: string; data: CloudPartyArchiveDoc }>> {
  const byDocId = new Map<string, CloudPartyArchiveDoc>();
  const addSnap = (snap: Awaited<ReturnType<typeof getDocsLite>>) => {
    for (const d of snap.docs) {
      const data = d.data() as CloudPartyArchiveDoc;
      if (data && data.partyId) {
        byDocId.set(d.id, data);
      }
    }
  };

  let fetchedPrimary = false;

  // Stateless dbLite HTTPS REST query: always inspects true Firestore server state
  // (never stale memoryLocalCache!) and downloads ONLY the 1 target date when provided.
  if (targetDate) {
    const cleanDate = sanitizeIsoDate(targetDate);
    try {
      const qDate = queryLite(
        collectionLite(dbLite, 'agencies', agencyId, 'partyArchives'),
        whereLite('date', '==', cleanDate)
      );
      addSnap(await withNetworkTimeout(getDocsLite(qDate), 14000));
      fetchedPrimary = true;
    } catch {
      // Non-bootstrap co-admin fallback: try ownerUid / adminUids query below
    }
  }

  if (!fetchedPrimary && ownerUid) {
    try {
      const qOwner = queryLite(
        collectionLite(dbLite, 'agencies', agencyId, 'partyArchives'),
        whereLite('ownerUid', '==', ownerUid)
      );
      addSnap(await withNetworkTimeout(getDocsLite(qOwner), 14000));
      fetchedPrimary = true;
    } catch {
      // Fallback to adminUids / per-party query below
    }
  }

  if (!fetchedPrimary && actorUid) {
    try {
      const qAdmin = queryLite(
        collectionLite(dbLite, 'agencies', agencyId, 'partyArchives'),
        whereLite('adminUids', 'array-contains', actorUid)
      );
      addSnap(await withNetworkTimeout(getDocsLite(qAdmin), 14000));
      fetchedPrimary = true;
    } catch {
      // Fallback to per-party query below
    }
  }

  if (!fetchedPrimary && activeParties.length > 0) {
    const slice = activeParties.slice(0, 40);
    let idx = 0;
    const workers = Array.from({ length: Math.min(4, slice.length) }, async () => {
      while (idx < slice.length) {
        const p = slice[idx++];
        try {
          const qParty = queryLite(
            collectionLite(dbLite, 'agencies', agencyId, 'partyArchives'),
            whereLite('partyId', '==', p.partyId)
          );
          addSnap(await withNetworkTimeout(getDocsLite(qParty), 12000));
        } catch {
          // Ignore individual party query failure when no docs exist or restricted
        }
      }
    });
    await Promise.all(workers);
  }

  return Array.from(byDocId.entries()).map(([docId, data]) => ({ docId, data }));
}

async function syncSingleAdminArchiveAgainstExisting(
  agencyId: string,
  ownerUid: string,
  restoredDate: string,
  editedAdminSnap: DaySnapshot,
  activeParties: CloudPartyDoc[],
  config: AgencyConfig,
  allPartyArchiveDocs: Array<{ docId: string; data: CloudPartyArchiveDoc }>,
  createMissing = true,
  onPartialFailure?: (failedNames: string[]) => void
): Promise<number> {
  const cleanDate = sanitizeIsoDate(restoredDate);
  if (activeParties.length === 0) return 0;

  const existingByPartyId = new Map<string, Array<{ docId: string; data: CloudPartyArchiveDoc }>>();
  for (const item of allPartyArchiveDocs) {
    const docDate = item.data.date || item.data.payload?.date || '';
    if (docDate !== cleanDate) continue;
    const list = existingByPartyId.get(item.data.partyId) || [];
    list.push(item);
    existingByPartyId.set(item.data.partyId, list);
  }

  // Fast lookups from Admin's freshly edited restored snapshot
  const adminSummaryByName = new Map<string, ArchivedSellerSummary>();
  for (const sum of editedAdminSnap.sellerSummaries || []) {
    const key = (sum.name || '').trim().toUpperCase();
    if (key) adminSummaryByName.set(key, sum);
  }
  const adminSellerByName = new Map<string, Seller>();
  for (const s of editedAdminSnap.sellers || []) {
    const key = (s.name || '').trim().toUpperCase();
    if (key) adminSellerByName.set(key, s);
  }
  const adminPrizesByName = new Map<string, PrizeListRow[]>();
  for (const pr of editedAdminSnap.prizeList || []) {
    const key = (pr.name || '').trim().toUpperCase();
    if (!key) continue;
    const list = adminPrizesByName.get(key) || [];
    list.push(pr);
    adminPrizesByName.set(key, list);
  }

  const topOwnRowsByName = new Map<string, Record<SessionId, TicketEntryRow[]>>();
  const subRowsByPartyId = new Map<string, Record<SessionId, TicketEntryRow[]>>();
  const ensureBucket = (
    map: Map<string, Record<SessionId, TicketEntryRow[]>>,
    key: string
  ): Record<SessionId, TicketEntryRow[]> => {
    let b = map.get(key);
    if (!b) {
      b = { '1PM': [], '6PM': [], '8PM': [] };
      map.set(key, b);
    }
    return b;
  };

  for (const sid of ['1PM', '6PM', '8PM'] as SessionId[]) {
    const rows = editedAdminSnap.entries?.[sid] || [];
    let lastResolved = '';
    for (const r of rows) {
      if (isTicketEntryRowBlank(r)) continue;
      const explicit = (r.name || '').trim();
      const resolved = explicit || lastResolved;
      if (explicit) lastResolved = explicit;
      if (r.id && r.id.startsWith('sub::')) {
        const parts = r.id.split('::');
        const subPid = parts[1] || '';
        const origId = parts.slice(2).join('::') || r.id;
        if (subPid) {
          ensureBucket(subRowsByPartyId, subPid)[sid].push({
            ...r,
            id: origId,
          });
        }
      } else if (resolved) {
        ensureBucket(topOwnRowsByName, resolved.toUpperCase())[sid].push({
          ...r,
          name: resolved,
        });
      }
    }
  }

  const adminHasSubTracking = subRowsByPartyId.size > 0;

  const winningRaw: Record<SessionId, string> = {
    '1PM': editedAdminSnap.winningRaw?.['1PM'] || '',
    '6PM': editedAdminSnap.winningRaw?.['6PM'] || '',
    '8PM': editedAdminSnap.winningRaw?.['8PM'] || '',
  };
  const parsedWinning = parseWinningNumbers(winningRaw);

  const directChildrenByParentId = new Map<string, CloudPartyDoc[]>();
  for (const p of activeParties) {
    if (!p.parentMasterId) continue;
    const list = directChildrenByParentId.get(p.parentMasterId) || [];
    list.push(p);
    directChildrenByParentId.set(p.parentMasterId, list);
  }

  const getDescendants = (rootPartyId: string): CloudPartyDoc[] => {
    const result: CloudPartyDoc[] = [];
    const seen = new Set<string>([rootPartyId]);
    const qIds = [rootPartyId];
    while (qIds.length > 0) {
      const cur = qIds.shift()!;
      for (const child of directChildrenByParentId.get(cur) || []) {
        if (seen.has(child.partyId)) continue;
        seen.add(child.partyId);
        result.push(child);
        qIds.push(child.partyId);
      }
    }
    return result;
  };

  type PendingArchiveWriteOp =
    | {
        kind: 'update';
        party: CloudPartyDoc;
        item: { docId: string; data: CloudPartyArchiveDoc };
        payload: DaySnapshot;
        approxBytes: number;
      }
    | {
        kind: 'create';
        party: CloudPartyDoc;
        payload: DaySnapshot;
        approxBytes: number;
      };

  const estimatePayloadBytes = (snap: DaySnapshot): number => {
    const entryCount =
      (snap.entries?.['1PM']?.length || 0) +
      (snap.entries?.['6PM']?.length || 0) +
      (snap.entries?.['8PM']?.length || 0);
    const prizeCount = snap.prizeList?.length || 0;
    const sellerCount = (snap.sellers?.length || 0) + (snap.sellerSummaries?.length || 0);
    return 4096 + entryCount * 240 + prizeCount * 180 + sellerCount * 220;
  };

  let syncedCount = 0;
  const pendingOps: PendingArchiveWriteOp[] = [];
  const failedParties: string[] = [];

  for (const party of activeParties) {
    const partyUpper = (party.name || '').trim().toUpperCase();
    const isTopLevel = !party.parentMasterId;
    const directSubs = directChildrenByParentId.get(party.partyId) || [];
    const descendants = party.role === 'master' ? getDescendants(party.partyId) : [];
    const existingDocs = existingByPartyId.get(party.partyId) || [];

    const adminSeller = isTopLevel ? adminSellerByName.get(partyUpper) : undefined;
    const adminSummary = isTopLevel ? adminSummaryByName.get(partyUpper) : undefined;
    const adminPrizes = isTopLevel ? adminPrizesByName.get(partyUpper) || [] : [];

    const buildUpdatedPayloadForParty = (
      existingSnap?: DaySnapshot
    ): { payload: DaySnapshot; hasData: boolean } => {
      const snapId = existingSnap?.id || makeUniquePartyArchiveId(party.partyId, cleanDate);

      // Split existing snapshot entries into own vs sub::partyId:: buckets
      const existingOwnEntries: Record<SessionId, TicketEntryRow[]> = {
        '1PM': [],
        '6PM': [],
        '8PM': [],
      };
      const existingSubEntriesByPid = new Map<string, Record<SessionId, TicketEntryRow[]>>();
      if (existingSnap?.entries) {
        for (const sid of ['1PM', '6PM', '8PM'] as SessionId[]) {
          for (const r of existingSnap.entries[sid] || []) {
            if (isTicketEntryRowBlank(r)) continue;
            if (r.id && r.id.startsWith('sub::')) {
              const parts = r.id.split('::');
              const subPid = parts[1] || '';
              const origId = parts.slice(2).join('::') || r.id;
              if (subPid) {
                ensureBucket(existingSubEntriesByPid, subPid)[sid].push({
                  ...r,
                  id: origId,
                });
              }
            } else {
              existingOwnEntries[sid].push(r);
            }
          }
        }
      }

      // 1. Build party's own entries
      const ownEntries: Record<SessionId, TicketEntryRow[]> = {
        '1PM': [],
        '6PM': [],
        '8PM': [],
      };
      const ownAdminSubBucket = subRowsByPartyId.get(party.partyId);
      for (const sid of ['1PM', '6PM', '8PM'] as SessionId[]) {
        if (isTopLevel) {
          const fromAdmin = topOwnRowsByName.get(partyUpper)?.[sid] || [];
          ownEntries[sid] = fromAdmin.map((r) => ({ ...r, name: party.name }));
        } else if (ownAdminSubBucket || adminHasSubTracking) {
          ownEntries[sid] = (ownAdminSubBucket?.[sid] || []).map((r) => ({
            ...r,
            name: party.name,
          }));
        } else {
          ownEntries[sid] = existingOwnEntries[sid].map((r) => ({ ...r, name: party.name }));
        }
      }

      // 2. Build merged entries (own + descendants tagged sub::dpId::)
      const descendantEntriesByPid = new Map<string, Record<SessionId, TicketEntryRow[]>>();
      for (const dp of descendants) {
        const fromAdminSub = subRowsByPartyId.get(dp.partyId);
        const fromExisting = existingSubEntriesByPid.get(dp.partyId);
        const useAdminSub = Boolean(fromAdminSub) || adminHasSubTracking;
        const chosen: Record<SessionId, TicketEntryRow[]> = {
          '1PM': useAdminSub ? fromAdminSub?.['1PM'] || [] : fromExisting?.['1PM'] || [],
          '6PM': useAdminSub ? fromAdminSub?.['6PM'] || [] : fromExisting?.['6PM'] || [],
          '8PM': useAdminSub ? fromAdminSub?.['8PM'] || [] : fromExisting?.['8PM'] || [],
        };
        descendantEntriesByPid.set(dp.partyId, chosen);
      }

      const mergedEntries: Record<SessionId, TicketEntryRow[]> = {
        '1PM': [...ownEntries['1PM']],
        '6PM': [...ownEntries['6PM']],
        '8PM': [...ownEntries['8PM']],
      };
      const handledSubIds = new Set<string>();
      for (const dp of descendants) {
        handledSubIds.add(dp.partyId);
        const bucket = descendantEntriesByPid.get(dp.partyId);
        if (!bucket) continue;
        for (const sid of ['1PM', '6PM', '8PM'] as SessionId[]) {
          for (const r of bucket[sid]) {
            mergedEntries[sid].push({
              ...r,
              id: `sub::${dp.partyId}::${r.id}`,
              name: dp.name,
            });
          }
        }
      }
      // Preserve any historical sub:: entries for removed sub-sellers
      for (const [subPid, bucket] of existingSubEntriesByPid.entries()) {
        if (handledSubIds.has(subPid)) continue;
        for (const sid of ['1PM', '6PM', '8PM'] as SessionId[]) {
          for (const r of bucket[sid]) {
            mergedEntries[sid].push({
              ...r,
              id: `sub::${subPid}::${r.id}`,
            });
          }
        }
      }

      // 3. Build updated sellers array (own party updated from Admin's restored edit; sub-sellers preserved)
      const existingOwnSeller = (existingSnap?.sellers || []).find(
        (s) => s.id === party.partyId || (s.name || '').trim().toUpperCase() === partyUpper
      );
      const updatedOwnSeller: Seller = {
        id: party.partyId,
        name: party.name,
        mobile: '',
        rate: adminSeller
          ? adminSeller.rate
          : existingOwnSeller
            ? existingOwnSeller.rate
            : party.rate,
        due: adminSeller
          ? adminSeller.due
          : existingOwnSeller
            ? existingOwnSeller.due
            : party.due,
        joma: adminSeller
          ? adminSeller.joma
          : existingOwnSeller
            ? existingOwnSeller.joma
            : party.joma,
      };

      const updatedSellers: Seller[] = [updatedOwnSeller];
      const seenSellerIds = new Set<string>([party.partyId]);
      const existingSubSellerMap = new Map<string, Seller>();
      for (const s of existingSnap?.sellers || []) {
        if (!s || s.id === party.partyId || (s.name || '').trim().toUpperCase() === partyUpper) {
          continue;
        }
        existingSubSellerMap.set(s.id, s);
      }
      for (const dp of descendants) {
        if (seenSellerIds.has(dp.partyId)) continue;
        seenSellerIds.add(dp.partyId);
        const prevSub = existingSubSellerMap.get(dp.partyId);
        updatedSellers.push({
          id: dp.partyId,
          name: dp.name,
          mobile: '',
          rate: prevSub ? prevSub.rate : dp.rate,
          due: prevSub ? prevSub.due : dp.due,
          joma: prevSub ? prevSub.joma : dp.joma,
        });
      }
      for (const [sidKey, prevSub] of existingSubSellerMap.entries()) {
        if (seenSellerIds.has(sidKey)) continue;
        seenSellerIds.add(sidKey);
        updatedSellers.push(prevSub);
      }

      // 4. Build updated sellerSummaries & prizeList
      let updatedSummaries: ArchivedSellerSummary[] = [];
      let updatedPrizes: PrizeListRow[] = [];

      if (party.role === 'master' && directSubs.length > 0) {
        const hasOwnRows =
          ownEntries['1PM'].length > 0 ||
          ownEntries['6PM'].length > 0 ||
          ownEntries['8PM'].length > 0;
        if (hasOwnRows) {
          const ownComps: Record<SessionId, SessionComputation> = {
            '1PM': processSessionRows(ownEntries['1PM'], '1PM', config),
            '6PM': processSessionRows(ownEntries['6PM'], '6PM', config),
            '8PM': processSessionRows(ownEntries['8PM'], '8PM', config),
          };
          const ownPrizeData = generatePrizeAndLimitData(ownComps, parsedWinning, config);
          updatedPrizes.push(...ownPrizeData.prizeList);
        }

        for (const sp of directSubs) {
          const spBranchIds = new Set<string>([sp.partyId]);
          const spDescendants = getDescendants(sp.partyId);
          for (const d of spDescendants) spBranchIds.add(d.partyId);

          const collectBranchRows = (sid: SessionId): TicketEntryRow[] => {
            const out: TicketEntryRow[] = [];
            for (const bid of spBranchIds) {
              const bucket = descendantEntriesByPid.get(bid);
              for (const r of bucket?.[sid] || []) {
                out.push({
                  ...r,
                  id: `branch::${bid}::${r.id}`,
                  name: sp.name,
                });
              }
            }
            return out;
          };

          const spSeller =
            updatedSellers.find((s) => s.id === sp.partyId) || {
              id: sp.partyId,
              name: sp.name,
              mobile: '',
              rate: sp.rate,
              due: sp.due,
              joma: sp.joma,
            };

          const r1 = collectBranchRows('1PM');
          const r6 = collectBranchRows('6PM');
          const r8 = collectBranchRows('8PM');
          if (r1.length === 0 && r6.length === 0 && r8.length === 0) {
            const dueVal = round2(Number(spSeller.due) || 0);
            const jomaVal = round2(Number(spSeller.joma) || 0);
            updatedSummaries.push({
              name: spSeller.name,
              mor: 0,
              day: 0,
              eve: 0,
              sold: 0,
              bill: 0,
              prizeTotal: 0,
              fresh: 0,
              joma: jomaVal,
              due: dueVal,
              total: round2(dueVal - jomaVal),
            });
            continue;
          }

          const spComps: Record<SessionId, SessionComputation> = {
            '1PM': processSessionRows(r1, '1PM', config),
            '6PM': processSessionRows(r6, '6PM', config),
            '8PM': processSessionRows(r8, '8PM', config),
          };
          const spPrizeData = generatePrizeAndLimitData(spComps, parsedWinning, config);
          updatedPrizes.push(...spPrizeData.prizeList);

          const [spBill] = computeSellerBills([spSeller], spComps, spPrizeData.prizeList, cleanDate);
          if (spBill) {
            updatedSummaries.push({
              name: spBill.name,
              mor: spBill.mor,
              day: spBill.day,
              eve: spBill.eve,
              sold: spBill.sold,
              bill: spBill.bill,
              prizeTotal: spBill.prizeTotal,
              fresh: spBill.fresh,
              joma: spBill.joma,
              due: spBill.due,
              total: spBill.total,
            });
          }
        }

        // If no sub-seller had any activity on this date and Admin has a summary for this Master, show Master's Admin summary
        const subsHaveActivity = updatedSummaries.some(
          (s) => s.sold > 0 || s.bill !== 0 || s.prizeTotal !== 0 || s.due !== 0 || s.joma !== 0
        );
        if (!subsHaveActivity && adminSummary) {
          updatedSummaries = [adminSummary];
          if (adminPrizes.length > 0) {
            updatedPrizes = adminPrizes;
          }
        }
      } else if (isTopLevel && adminSummary) {
        // Top-level Direct Seller or Master without sub-sellers (e.g. RIJU): mirror Admin's exact edited summary & prizes
        updatedSummaries = [adminSummary];
        updatedPrizes = adminPrizes;
      } else {
        // Sub-Seller / Leaf party: fast-path empty sheets or recompute own bill with updated entries + winning numbers
        const hasOwnRows =
          ownEntries['1PM'].length > 0 ||
          ownEntries['6PM'].length > 0 ||
          ownEntries['8PM'].length > 0;
        if (!hasOwnRows) {
          const dueVal = round2(Number(updatedOwnSeller.due) || 0);
          const jomaVal = round2(Number(updatedOwnSeller.joma) || 0);
          updatedPrizes = [];
          updatedSummaries = [
            {
              name: updatedOwnSeller.name,
              mor: 0,
              day: 0,
              eve: 0,
              sold: 0,
              bill: 0,
              prizeTotal: 0,
              fresh: 0,
              joma: jomaVal,
              due: dueVal,
              total: round2(dueVal - jomaVal),
            },
          ];
        } else {
          const ownComps: Record<SessionId, SessionComputation> = {
            '1PM': processSessionRows(ownEntries['1PM'], '1PM', config),
            '6PM': processSessionRows(ownEntries['6PM'], '6PM', config),
            '8PM': processSessionRows(ownEntries['8PM'], '8PM', config),
          };
          const ownPrizeData = generatePrizeAndLimitData(ownComps, parsedWinning, config);
          updatedPrizes = ownPrizeData.prizeList;
          const [ownBill] = computeSellerBills([updatedOwnSeller], ownComps, updatedPrizes, cleanDate);
          if (ownBill) {
            updatedSummaries = [
              {
                name: ownBill.name,
                mor: ownBill.mor,
                day: ownBill.day,
                eve: ownBill.eve,
                sold: ownBill.sold,
                bill: ownBill.bill,
                prizeTotal: ownBill.prizeTotal,
                fresh: ownBill.fresh,
                joma: ownBill.joma,
                due: ownBill.due,
                total: ownBill.total,
              },
            ];
          }
        }
      }

      if (updatedSummaries.length === 0) {
        const netBal = round2((updatedOwnSeller.due || 0) - (updatedOwnSeller.joma || 0));
        updatedSummaries = [
          {
            name: updatedOwnSeller.name,
            mor: 0,
            day: 0,
            eve: 0,
            sold: 0,
            bill: 0,
            prizeTotal: 0,
            fresh: 0,
            joma: updatedOwnSeller.joma || 0,
            due: updatedOwnSeller.due || 0,
            total: netBal,
          },
        ];
      }

      const totalSold = round2(updatedSummaries.reduce((a, b) => a + b.sold, 0));
      const totalBill = round2(updatedSummaries.reduce((a, b) => a + b.bill, 0));
      const totalPrize = round2(updatedSummaries.reduce((a, b) => a + b.prizeTotal, 0));
      const totalNetPayable = round2(updatedSummaries.reduce((a, b) => a + b.total, 0));

      const hasData =
        updatedOwnSeller.due !== 0 ||
        updatedOwnSeller.joma !== 0 ||
        updatedSummaries.some(
          (s) => s.sold > 0 || s.bill !== 0 || s.prizeTotal !== 0 || s.due !== 0 || s.joma !== 0
        ) ||
        mergedEntries['1PM'].length > 0 ||
        mergedEntries['6PM'].length > 0 ||
        mergedEntries['8PM'].length > 0;

      const attachAdminAccountSummary =
        isTopLevel &&
        adminSummary &&
        party.role === 'master' &&
        directSubs.length > 0 &&
        !updatedSummaries.some((s) => (s.name || '').trim().toUpperCase() === partyUpper);

      const rawSnap: DaySnapshot = {
        id: snapId,
        date: cleanDate,
        savedAt: existingSnap?.savedAt || editedAdminSnap.savedAt || new Date().toISOString(),
        trigger: existingSnap?.trigger || editedAdminSnap.trigger || 'manual',
        totalSold,
        totalBill,
        totalPrize,
        totalNetPayable,
        limitGrandTotal: 0,
        overLimitTotals: { '1PM': 0, '6PM': 0, '8PM': 0 },
        sellerSummaries: updatedSummaries,
        ...(attachAdminAccountSummary ? { adminAccountSummary: adminSummary } : {}),
        prizeList: updatedPrizes,
        limitPrizeGroups: [],
        sellers: updatedSellers,
        entries: mergedEntries,
        winningRaw,
      };

      return {
        payload: sanitizePartyArchivePayload(rawSnap, snapId, cleanDate),
        hasData,
      };
    };

    if (existingDocs.length > 0) {
      for (const item of existingDocs) {
        const existingSnap: DaySnapshot = {
          ...item.data.payload,
          id: item.data.snapshotId || item.docId,
          date: item.data.date || cleanDate,
          savedAt: item.data.savedAt || item.data.payload.savedAt,
          trigger: item.data.trigger || item.data.payload.trigger || 'manual',
        };
        const { payload } = buildUpdatedPayloadForParty(existingSnap);
        const nextSig = JSON.stringify(payload);
        // Fast-path: most Firestore archive payloads are already sanitized; skip re-sanitizing if identical
        if (JSON.stringify(existingSnap) === nextSig) continue;
        const normalizedExisting = sanitizePartyArchivePayload(
          existingSnap,
          existingSnap.id,
          cleanDate
        );
        if (JSON.stringify(normalizedExisting) === nextSig) continue;

        pendingOps.push({
          kind: 'update',
          party,
          item,
          payload,
          approxBytes: estimatePayloadBytes(payload),
        });
      }
    } else if (createMissing) {
      // Backfill missing archive for EVERY active Master, Sub-Master, Direct Seller & Sub-Seller
      const { payload } = buildUpdatedPayloadForParty(undefined);
      pendingOps.push({
        kind: 'create',
        party,
        payload,
        approxBytes: estimatePayloadBytes(payload),
      });
    }
  }

  if (pendingOps.length === 0) return 0;

  // Pack writes into stateless dbLite `writeBatchLite` chunks:
  // - Max 5 ops per batch (<= 10 Firestore `exists()` rule reads, safely half of Firestore's 20-read batch cap)
  // - Max 320 KB JSON per batch (~550 KB protobuf) for instant sub-second HTTPS REST commits on mobile 5G/Wi-Fi.
  const MAX_BATCH_OPS = 5;
  const MAX_BATCH_BYTES = 320_000;
  const CONCURRENCY = 4;
  const batches: PendingArchiveWriteOp[][] = [];
  let currentBatch: PendingArchiveWriteOp[] = [];
  let currentBytes = 0;

  for (const op of pendingOps) {
    if (
      currentBatch.length > 0 &&
      (currentBatch.length >= MAX_BATCH_OPS || currentBytes + op.approxBytes > MAX_BATCH_BYTES)
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBytes = 0;
    }
    currentBatch.push(op);
    currentBytes += op.approxBytes;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  let lastFailureReason = '';
  const recordFailureReason = (err: unknown) => {
    if (lastFailureReason || !err) return;
    const obj = err as { code?: string; message?: string };
    const code = typeof obj.code === 'string' ? obj.code.trim() : '';
    const msg = typeof obj.message === 'string' ? obj.message.trim() : String(err);
    if (code) {
      lastFailureReason = code;
      return;
    }
    if (msg.startsWith('{')) {
      try {
        const parsed = JSON.parse(msg) as { error?: string };
        if (parsed.error) {
          lastFailureReason = parsed.error.slice(0, 80);
          return;
        }
      } catch {
        // Not valid JSON
      }
    }
    lastFailureReason = msg.slice(0, 80);
  };

  const runWithConcurrency = async <T,>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
  ): Promise<void> => {
    if (items.length === 0) return;
    let cursor = 0;
    const pool = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await worker(item);
      }
    });
    await Promise.all(pool);
  };

  const runOpIndividually = async (op: PendingArchiveWriteOp): Promise<void> => {
    if (op.kind === 'update') {
      const ref = docLite(dbLite, 'agencies', agencyId, 'partyArchives', op.item.docId);
      const commitUpdate = async (targetPayload: DaySnapshot) => {
        await withNetworkTimeout(
          updateDocLite(ref, {
            payload: targetPayload,
            updatedAt: serverTimestampLite(),
          }),
          15000
        );
        op.item.data = { ...op.item.data, payload: targetPayload };
      };
      try {
        await commitUpdate(op.payload);
        syncedCount++;
      } catch (err) {
        // Retry once with compact payload (entries stripped, full bills/prizes preserved)
        // in case a heavy Master doc exceeded Firestore's 1 MiB protobuf limit
        try {
          const compactPayload = buildCompactPartyArchivePayload(op.payload);
          await commitUpdate(compactPayload);
          syncedCount++;
        } catch (retryErr) {
          recordFailureReason(retryErr || err);
          failedParties.push(op.party.name || op.party.partyId);
          console.error('[KK Agency] Could not update partyArchive:', op.party.name, retryErr || err);
        }
      }
    } else {
      try {
        const saved = await savePartyArchiveCloud(ownerUid, op.party, op.payload, true);
        allPartyArchiveDocs.push({
          docId: saved.id,
          data: {
            agencyId,
            snapshotId: saved.id,
            partyId: op.party.partyId,
            partyName: op.party.name,
            ownerUid: op.party.ownerUid || ownerUid,
            adminUids: op.party.adminUids || [ownerUid],
            assignedUid: op.party.assignedUid || '',
            parentMasterId: op.party.parentMasterId || '',
            parentMasterUid: op.party.parentMasterUid || '',
            date: cleanDate,
            savedAt: saved.savedAt,
            trigger: saved.trigger,
            payload: saved,
          },
        });
        syncedCount++;
      } catch (err) {
        recordFailureReason(err);
        failedParties.push(op.party.name || op.party.partyId);
        console.error('[KK Agency] Could not create missing partyArchive:', op.party.name, err);
      }
    }
  };

  // Bounded concurrency (max 4 in-flight HTTPS requests) prevents flooding iOS Safari's 6-connection cap
  await runWithConcurrency(batches, CONCURRENCY, async (ops) => {
    try {
      const batch = writeBatchLite(dbLite);
      const createdMeta: Array<{
        docId: string;
        op: Extract<PendingArchiveWriteOp, { kind: 'create' }>;
        ownerUid: string;
        adminUids: string[];
      }> = [];
      for (const op of ops) {
        if (op.kind === 'update') {
          const ref = docLite(dbLite, 'agencies', agencyId, 'partyArchives', op.item.docId);
          batch.update(ref, {
            payload: op.payload,
            updatedAt: serverTimestampLite(),
          });
        } else {
          const targetId = op.payload.id || makeUniquePartyArchiveId(op.party.partyId, cleanDate);
          const built = buildPartyArchiveDocBody(
            ownerUid,
            op.party,
            targetId,
            cleanDate,
            op.payload,
            true
          );
          const ref = docLite(dbLite, 'agencies', built.cleanAgencyId, 'partyArchives', built.body.snapshotId);
          batch.set(ref, built.body);
          createdMeta.push({
            docId: built.body.snapshotId,
            op,
            ownerUid: built.cleanOwnerUid,
            adminUids: built.adminUids,
          });
        }
      }
      await withNetworkTimeout(batch.commit(), 15000);
      for (const op of ops) {
        if (op.kind === 'update') {
          op.item.data = { ...op.item.data, payload: op.payload };
        }
        syncedCount++;
      }
      for (const meta of createdMeta) {
        allPartyArchiveDocs.push({
          docId: meta.docId,
          data: {
            agencyId,
            snapshotId: meta.docId,
            partyId: meta.op.party.partyId,
            partyName: meta.op.party.name,
            ownerUid: meta.ownerUid,
            adminUids: meta.adminUids,
            assignedUid: meta.op.party.assignedUid || '',
            parentMasterId: meta.op.party.parentMasterId || '',
            parentMasterUid: meta.op.party.parentMasterUid || '',
            date: cleanDate,
            savedAt: meta.op.payload.savedAt,
            trigger: meta.op.payload.trigger,
            payload: meta.op.payload,
          },
        });
      }
    } catch {
      // If any single doc in the batch collided, exceeded size, or timed out, fall back cleanly per-op via dbLite
      await runWithConcurrency(ops, CONCURRENCY, runOpIndividually);
    }
  });

  if (failedParties.length > 0) {
    onPartialFailure?.(failedParties);
    if (syncedCount === 0) {
      const reasonSuffix = lastFailureReason ? ` (${lastFailureReason})` : '';
      throw new Error(`Archive sync failed${reasonSuffix} for: ${failedParties.slice(0, 4).join(', ')}`);
    }
  }

  return syncedCount;
}

/**
 * Propagates Admin's edits on a restored archive date (e.g. Joma, Due, Rate, Entries, Winning Numbers)
 * to EVERY active Master, Sub-Master, Direct Seller, and Sub-Seller's `partyArchives` for that date.
 */
export async function syncAdminRestoredArchiveToPartiesCloud(
  agencyId: string,
  ownerUid: string,
  restoredDate: string,
  editedAdminSnap: DaySnapshot,
  parties: CloudPartyDoc[],
  config: AgencyConfig,
  actorUid?: string,
  onPartialFailure?: (failedNames: string[]) => void
): Promise<number> {
  const activeParties = parties.filter((p) => p.active !== false && p.role !== 'admin');
  if (activeParties.length === 0) return 0;

  // Query ONLY the single target date over stateless dbLite HTTPS REST so Sync IDs sees true server state!
  const allDocs = await fetchAllAgencyPartyArchives(
    agencyId,
    ownerUid,
    actorUid || ownerUid,
    activeParties,
    restoredDate
  );

  return syncSingleAdminArchiveAgainstExisting(
    agencyId,
    ownerUid,
    restoredDate,
    editedAdminSnap,
    activeParties,
    config,
    allDocs,
    true,
    onPartialFailure
  );
}

/**
 * Batch-reconciles multiple Admin Archive snapshots against every party's `partyArchives`
 * using a single Firestore read pass and writing ONLY documents whose payload actually changed.
 */
export async function syncAdminArchivesBatchToPartiesCloud(
  agencyId: string,
  ownerUid: string,
  actorUid: string,
  snapshots: DaySnapshot[],
  parties: CloudPartyDoc[],
  config: AgencyConfig,
  createMissing = false,
  onPartialFailure?: (failedNames: string[]) => void
): Promise<number> {
  const activeParties = parties.filter((p) => p.active !== false && p.role !== 'admin');
  if (activeParties.length === 0 || snapshots.length === 0) return 0;

  // Deduplicate by date (keep the newest/first Admin snapshot per date)
  const seenDates = new Set<string>();
  const uniqueSnaps: DaySnapshot[] = [];
  for (const snap of snapshots) {
    const cleanDate = sanitizeIsoDate(snap.date);
    if (seenDates.has(cleanDate)) continue;
    seenDates.add(cleanDate);
    uniqueSnaps.push(snap);
  }
  if (uniqueSnaps.length === 0) return 0;

  // Ultra-Low-Read query strategy: when reconciling 1-3 dates, query ONLY those exact dates
  // instead of downloading all historical partyArchives!
  let allDocs: Array<{ docId: string; data: CloudPartyArchiveDoc }> = [];
  if (uniqueSnaps.length <= 3) {
    const perDateArrays = await Promise.all(
      uniqueSnaps.map((snap) =>
        fetchAllAgencyPartyArchives(agencyId, ownerUid, actorUid, activeParties, snap.date)
      )
    );
    const dedupMap = new Map<string, CloudPartyArchiveDoc>();
    for (const arr of perDateArrays) {
      for (const item of arr) dedupMap.set(item.docId, item.data);
    }
    allDocs = Array.from(dedupMap.entries()).map(([docId, data]) => ({ docId, data }));
  } else {
    allDocs = await fetchAllAgencyPartyArchives(agencyId, ownerUid, actorUid, activeParties);
  }

  const allFailed: string[] = [];
  const counts = await Promise.all(
    uniqueSnaps.map((snap) =>
      syncSingleAdminArchiveAgainstExisting(
        agencyId,
        ownerUid,
        snap.date,
        snap,
        activeParties,
        config,
        allDocs,
        createMissing,
        (names) => allFailed.push(...names)
      )
    )
  );
  if (allFailed.length > 0) {
    onPartialFailure?.(Array.from(new Set(allFailed)));
  }
  return counts.reduce((sum, n) => sum + n, 0);
}

export async function carryForwardSubSellerBalancesCloud(
  _masterUid: string,
  masterParty: CloudPartyDoc,
  subParties: CloudPartyDoc[],
  subBillsByPartyId: Record<string, SellerBillRow>
): Promise<void> {
  const directSubs = subParties.filter((p) => p.parentMasterId === masterParty.partyId);
  const updates: Array<{ sub: CloudPartyDoc; nextDue: number; nextJoma: number }> = [];
  for (const sub of directSubs) {
    const bill = subBillsByPartyId[sub.partyId];
    if (!bill) continue;
    const net = Math.round(bill.total * 100) / 100;
    const nextDue = net > 0 ? net : 0;
    const nextJoma = net < 0 ? Math.round(Math.abs(net) * 100) / 100 : 0;
    if (sub.due === nextDue && sub.joma === nextJoma) continue;
    updates.push({ sub, nextDue, nextJoma });
  }
  if (updates.length === 0) return;

  try {
    const batch = writeBatch(db);
    for (const u of updates) {
      const agencyId = u.sub.agencyId || AGENCY_ID;
      batch.update(doc(db, 'agencies', agencyId, 'parties', u.sub.partyId), {
        due: sanitizeNumber(u.nextDue, -100000000, 100000000, 0),
        joma: sanitizeNumber(u.nextJoma, -100000000, 100000000, 0),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch {
    await Promise.all(
      updates.map((u) =>
        updateSubSellerParty(u.sub, undefined, {
          due: u.nextDue,
          joma: u.nextJoma,
        })
      )
    );
  }
}

const PUBLIC_ANNOUNCEMENT_CACHE_PREFIX = 'kk-public-announcement-cache:v1:';
const MAX_ANNOUNCEMENT_IMAGE_CHARS = 160000;
const ANNOUNCEMENT_IMAGE_DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function sanitizeAnnouncementKind(raw: unknown): CloudAnnouncementKind {
  if (raw === 'urgent' || raw === 'notice' || raw === 'offer') return raw;
  return 'offer';
}

export function sanitizeAnnouncementImageDataUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_ANNOUNCEMENT_IMAGE_CHARS) return '';
  if (!ANNOUNCEMENT_IMAGE_DATA_URL_RE.test(trimmed)) return '';
  return trimmed;
}

export function readCachedPublicAnnouncement(
  agencyId = AGENCY_ID
): CloudPublicAnnouncement | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${PUBLIC_ANNOUNCEMENT_CACHE_PREFIX}${agencyId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CloudPublicAnnouncement> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      agencyId: typeof parsed.agencyId === 'string' && parsed.agencyId ? parsed.agencyId : agencyId,
      active: Boolean(parsed.active),
      kind: sanitizeAnnouncementKind(parsed.kind),
      title: typeof parsed.title === 'string' ? parsed.title.slice(0, 120) : '',
      message: typeof parsed.message === 'string' ? parsed.message.slice(0, 1000) : '',
      imageDataUrl: sanitizeAnnouncementImageDataUrl(parsed.imageDataUrl),
      ownerUid: typeof parsed.ownerUid === 'string' ? parsed.ownerUid : '',
      updatedByUid: typeof parsed.updatedByUid === 'string' ? parsed.updatedByUid : '',
      updatedAtMs: typeof parsed.updatedAtMs === 'number' ? parsed.updatedAtMs : 0,
    };
  } catch {
    return null;
  }
}

function writeCachedPublicAnnouncement(
  agencyId: string,
  announcement: CloudPublicAnnouncement | null
): void {
  if (typeof window === 'undefined') return;
  try {
    const key = `${PUBLIC_ANNOUNCEMENT_CACHE_PREFIX}${agencyId}`;
    if (!announcement) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(announcement));
    }
  } catch {
    // Ignore localStorage quota/private-mode errors
  }
}

function parseTimestampMs(raw: unknown): number {
  if (!raw) return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'toMillis' in raw &&
    typeof (raw as { toMillis: unknown }).toMillis === 'function'
  ) {
    try {
      return (raw as { toMillis: () => number }).toMillis();
    } catch {
      return 0;
    }
  }
  return 0;
}

export function subscribePublicAnnouncement(
  agencyId: string,
  onAnnouncement: (announcement: CloudPublicAnnouncement | null) => void
): Unsubscribe {
  const cleanAgencyId = sanitizeId(agencyId || AGENCY_ID, AGENCY_ID);
  const ref = doc(db, 'publicAnnouncements', cleanAgencyId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        writeCachedPublicAnnouncement(cleanAgencyId, null);
        onAnnouncement(null);
        return;
      }
      const data = snap.data();
      const parsed: CloudPublicAnnouncement = {
        agencyId: typeof data.agencyId === 'string' ? data.agencyId : cleanAgencyId,
        active: Boolean(data.active),
        kind: sanitizeAnnouncementKind(data.kind),
        title: typeof data.title === 'string' ? data.title.slice(0, 120) : '',
        message: typeof data.message === 'string' ? data.message.slice(0, 1000) : '',
        imageDataUrl: sanitizeAnnouncementImageDataUrl(data.imageDataUrl),
        ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : '',
        updatedByUid: typeof data.updatedByUid === 'string' ? data.updatedByUid : '',
        updatedAtMs: parseTimestampMs(data.updatedAt) || Date.now(),
      };
      writeCachedPublicAnnouncement(cleanAgencyId, parsed);
      onAnnouncement(parsed);
    },
    () => {
      // Keep cached announcement visible if offline or transient network hiccup
    }
  );
}

export async function savePublicAnnouncementCloud(
  adminUid: string,
  agencyId: string,
  ownerUid: string,
  input: {
    active: boolean;
    kind: CloudAnnouncementKind;
    title: string;
    message: string;
    imageDataUrl?: string;
  }
): Promise<CloudPublicAnnouncement> {
  const cleanAgencyId = sanitizeId(agencyId || AGENCY_ID, AGENCY_ID);
  const cleanTitle = input.title.trim().slice(0, 120);
  const cleanMessage = input.message.trim().slice(0, 1000);
  const cleanImageDataUrl = sanitizeAnnouncementImageDataUrl(input.imageDataUrl);
  const cleanKind = sanitizeAnnouncementKind(input.kind);
  const cleanActive = Boolean(input.active && (cleanTitle || cleanMessage || cleanImageDataUrl));

  const ref = docLite(dbLite, 'publicAnnouncements', cleanAgencyId);
  let existsNow = false;
  try {
    const snap = await withNetworkTimeout(
      getDocLite(ref),
      15000,
      'NETWORK_TIMEOUT: Advertisement server se connect nahi ho paya.'
    );
    existsNow = snap.exists();
  } catch (err) {
    // Re-throw quota/permission errors immediately rather than masking them as non-existent doc
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('resource-exhausted') ||
      msg.includes('Quota exceeded') ||
      msg.includes('permission-denied') ||
      msg.includes('NETWORK_TIMEOUT')
    ) {
      handleFirestoreError(err, OperationType.GET, ref.path);
    }
    existsNow = false;
  }

  try {
    if (existsNow) {
      await withNetworkTimeout(
        updateDocLite(ref, {
          active: cleanActive,
          kind: cleanKind,
          title: cleanTitle,
          message: cleanMessage,
          imageDataUrl: cleanImageDataUrl,
          updatedByUid: adminUid,
          updatedAt: serverTimestampLite(),
        }),
        18000,
        'NETWORK_TIMEOUT: Advertisement save hone me samay lag raha hai. Dobara try karein.'
      );
    } else {
      await withNetworkTimeout(
        setDocLite(ref, {
          agencyId: cleanAgencyId,
          active: cleanActive,
          kind: cleanKind,
          title: cleanTitle,
          message: cleanMessage,
          imageDataUrl: cleanImageDataUrl,
          ownerUid,
          updatedByUid: adminUid,
          createdAt: serverTimestampLite(),
          updatedAt: serverTimestampLite(),
        }),
        18000,
        'NETWORK_TIMEOUT: Advertisement publish hone me samay lag raha hai. Dobara try karein.'
      );
    }
    const result: CloudPublicAnnouncement = {
      agencyId: cleanAgencyId,
      active: cleanActive,
      kind: cleanKind,
      title: cleanTitle,
      message: cleanMessage,
      imageDataUrl: cleanImageDataUrl,
      ownerUid,
      updatedByUid: adminUid,
      updatedAtMs: Date.now(),
    };
    writeCachedPublicAnnouncement(cleanAgencyId, result);
    return result;
  } catch (err) {
    handleFirestoreError(err, existsNow ? OperationType.UPDATE : OperationType.CREATE, ref.path);
  }
}

// =============================================================================
// PERMANENT ADMIN CLOUD VAULT (1PM/6PM/8PM Chunks, Private Config & Archives)
// Guarantees 100% of Admin data survives app delete, phone change, or domain switch.
// =============================================================================

const ADMIN_LEDGER_CHUNK_SIZE = 800;
const ADMIN_LEDGER_MAX_CHUNKS_PER_SESSION = 100;

export interface CloudAdminPrivateConfigDoc {
  agencyId: string;
  ownerUid: string;
  whatsappNumber: string;
  autoArchiveDaily: boolean;
  pausedAutoArchiveDate: string;
  extraNames: string[];
  updatedAtMs: number;
}

export interface AdminCloudVaultData {
  agency: CloudAgencyDoc | null;
  agencyUpdatedAtMs: number;
  privateConfig: CloudAdminPrivateConfigDoc | null;
  entries: Record<SessionId, TicketEntryRow[]>;
  ledgerDate: string;
  ledgerRevisionMs: number;
  chunkSigs: Record<string, string>;
  chunkIds: string[];
  history: DaySnapshot[];
  recycleBin: DaySnapshot[];
  archiveSigs: Record<string, string>;
  archiveDocIds: string[];
}

function sanitizeChunkRowsForCloud(rows: TicketEntryRow[]): TicketEntryRow[] {
  const out: TicketEntryRow[] = [];
  if (!Array.isArray(rows)) return out;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (!r) continue;
    const name = String(r.name || '');
    const item = String(r.item || '');
    const start = String(r.start || '');
    const end = String(r.end || '');
    const qtyOverride = String(r.qtyOverride || '');
    const rangeOverride = String(r.rangeOverride || '');
    if (
      !name.trim() &&
      !item.trim() &&
      !start.trim() &&
      !end.trim() &&
      !qtyOverride.trim() &&
      !rangeOverride.trim()
    ) {
      continue;
    }
    out.push({
      id: String(r.id || `r-${i}`),
      name,
      item,
      start,
      end,
      qtyOverride,
      rangeOverride,
    });
  }
  return out;
}

function computeChunkSignature(
  date: string,
  sessionId: SessionId,
  chunkIndex: number,
  totalChunks: number,
  rows: TicketEntryRow[]
): string {
  const compact = rows.map((r) => [
    r.id,
    r.name,
    r.item,
    r.start,
    r.end,
    r.qtyOverride,
    r.rangeOverride,
  ]);
  return JSON.stringify([date, sessionId, chunkIndex, totalChunks, compact]);
}

interface DesiredLedgerChunk {
  chunkId: string;
  sessionId: SessionId;
  chunkIndex: number;
  totalChunks: number;
  rows: TicketEntryRow[];
  sig: string;
}

function buildDesiredLedgerChunks(
  date: string,
  entries: Record<SessionId, TicketEntryRow[]>
): DesiredLedgerChunk[] {
  const cleanDate = sanitizeIsoDate(date);
  const chunks: DesiredLedgerChunk[] = [];
  const sessions: SessionId[] = ['1PM', '6PM', '8PM'];

  for (const sid of sessions) {
    const cleaned = sanitizeChunkRowsForCloud(entries[sid] || []);
    const totalChunks = Math.min(
      ADMIN_LEDGER_MAX_CHUNKS_PER_SESSION,
      Math.max(1, Math.ceil(cleaned.length / ADMIN_LEDGER_CHUNK_SIZE))
    );
    for (let idx = 0; idx < totalChunks; idx += 1) {
      const start = idx * ADMIN_LEDGER_CHUNK_SIZE;
      const slice = cleaned.slice(start, start + ADMIN_LEDGER_CHUNK_SIZE);
      const chunkId = `${sid}_${idx}`;
      chunks.push({
        chunkId,
        sessionId: sid,
        chunkIndex: idx,
        totalChunks,
        rows: slice,
        sig: computeChunkSignature(cleanDate, sid, idx, totalChunks, slice),
      });
    }
  }
  return chunks;
}

export function makeAdminArchiveDocId(snapshotId: string): string {
  return sanitizeId(`snap-${snapshotId}`, `snap-${Date.now()}`);
}

function sanitizeArchiveTrigger(raw: unknown): 'manual' | 'daily-auto' | 'day-close' {
  if (raw === 'daily-auto' || raw === 'day-close' || raw === 'manual') return raw;
  return 'manual';
}

function stripUndefinedDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function buildSafeArchivePayload(
  snap: DaySnapshot,
  inRecycleBin: boolean
): Record<string, unknown> {
  const cleanSnap: DaySnapshot = {
    ...snap,
    entries: {
      '1PM': sanitizeChunkRowsForCloud(snap.entries?.['1PM'] || []),
      '6PM': sanitizeChunkRowsForCloud(snap.entries?.['6PM'] || []),
      '8PM': sanitizeChunkRowsForCloud(snap.entries?.['8PM'] || []),
    },
    winningRaw: {
      '1PM': String(snap.winningRaw?.['1PM'] || '').slice(0, 20000),
      '6PM': String(snap.winningRaw?.['6PM'] || '').slice(0, 20000),
      '8PM': String(snap.winningRaw?.['8PM'] || '').slice(0, 20000),
    },
  };

  const basePayload: Record<string, unknown> = stripUndefinedDeep({
    ...cleanSnap,
    _inRecycleBin: inRecycleBin,
  });

  // Stay strictly below Firestore's 1MB document limit even on massive 30,000-row days
  let jsonLen = JSON.stringify(basePayload).length;
  if (jsonLen > 760000) {
    const caps = [1800, 900, 350, 0];
    for (const cap of caps) {
      basePayload.entries = {
        '1PM': cleanSnap.entries['1PM'].slice(0, cap),
        '6PM': cleanSnap.entries['6PM'].slice(0, cap),
        '8PM': cleanSnap.entries['8PM'].slice(0, cap),
      };
      jsonLen = JSON.stringify(basePayload).length;
      if (jsonLen <= 760000) break;
    }
  }
  return basePayload;
}

function computeArchiveSignature(snap: DaySnapshot, inRecycleBin: boolean): string {
  const e1 = snap.entries?.['1PM']?.length || 0;
  const e6 = snap.entries?.['6PM']?.length || 0;
  const e8 = snap.entries?.['8PM']?.length || 0;
  return JSON.stringify([
    snap.id,
    snap.date,
    snap.savedAt,
    snap.deletedAt || '',
    snap.trigger,
    inRecycleBin ? 1 : 0,
    snap.totalSold,
    snap.totalBill,
    snap.totalPrize,
    snap.totalNetPayable,
    e1,
    e6,
    e8,
  ]);
}

function parseArchiveSnapshotFromDoc(
  docId: string,
  data: Record<string, unknown>
): { snapshot: DaySnapshot; inRecycleBin: boolean } | null {
  const payload = data.payload;
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const inRecycleBin = Boolean(p._inRecycleBin);
  const rawEntries = (p.entries as Partial<Record<SessionId, TicketEntryRow[]>> | undefined) || {};
  const rawWinning = (p.winningRaw as Partial<Record<SessionId, string>> | undefined) || {};

  const snapshot: DaySnapshot = {
    id: typeof p.id === 'string' && p.id ? p.id : docId,
    date: typeof p.date === 'string' && p.date ? p.date : String(data.date || ''),
    savedAt: typeof p.savedAt === 'string' && p.savedAt ? p.savedAt : String(data.savedAt || ''),
    ...(typeof p.deletedAt === 'string' && p.deletedAt ? { deletedAt: p.deletedAt } : {}),
    trigger: sanitizeArchiveTrigger(p.trigger ?? data.trigger),
    totalSold: Number(p.totalSold) || 0,
    totalBill: Number(p.totalBill) || 0,
    totalPrize: Number(p.totalPrize) || 0,
    totalNetPayable: Number(p.totalNetPayable) || 0,
    limitGrandTotal: Number(p.limitGrandTotal) || 0,
    overLimitTotals: {
      '1PM': Number((p.overLimitTotals as Record<string, unknown> | undefined)?.['1PM']) || 0,
      '6PM': Number((p.overLimitTotals as Record<string, unknown> | undefined)?.['6PM']) || 0,
      '8PM': Number((p.overLimitTotals as Record<string, unknown> | undefined)?.['8PM']) || 0,
    },
    sellerSummaries: Array.isArray(p.sellerSummaries) ? (p.sellerSummaries as DaySnapshot['sellerSummaries']) : [],
    prizeList: Array.isArray(p.prizeList) ? (p.prizeList as DaySnapshot['prizeList']) : [],
    limitPrizeGroups: Array.isArray(p.limitPrizeGroups)
      ? (p.limitPrizeGroups as DaySnapshot['limitPrizeGroups'])
      : [],
    sellers: Array.isArray(p.sellers) ? (p.sellers as Seller[]) : [],
    entries: {
      '1PM': sanitizeChunkRowsForCloud(rawEntries['1PM'] || []),
      '6PM': sanitizeChunkRowsForCloud(rawEntries['6PM'] || []),
      '8PM': sanitizeChunkRowsForCloud(rawEntries['8PM'] || []),
    },
    winningRaw: {
      '1PM': String(rawWinning['1PM'] || ''),
      '6PM': String(rawWinning['6PM'] || ''),
      '8PM': String(rawWinning['8PM'] || ''),
    },
  };

  return { snapshot, inRecycleBin };
}

/**
 * Loads Admin's complete cloud vault (agency config/winning, private settings,
 * chunked 1PM/6PM/8PM ledger rows, and archived history + recycle bin) for
 * automatic recovery after app uninstall, reinstall, or device switch.
 */
export async function loadAdminCloudVault(
  ownerUid: string,
  agencyId = AGENCY_ID
): Promise<AdminCloudVaultData> {
  const cleanAgencyId = sanitizeId(agencyId || AGENCY_ID, AGENCY_ID);
  const agencyPath = `agencies/${cleanAgencyId}`;
  const privatePath = `agencies/${cleanAgencyId}/private/config`;
  const chunksPath = `agencies/${cleanAgencyId}/adminLedgerChunks`;
  const archivesPath = `agencies/${cleanAgencyId}/archives`;

  const [agencySnap, privateSnap, chunksSnap, archivesSnap] = await Promise.all([
    getDoc(doc(db, 'agencies', cleanAgencyId)).catch((err) => {
      handleFirestoreError(err, OperationType.GET, agencyPath);
    }),
    getDoc(doc(db, 'agencies', cleanAgencyId, 'private', 'config')).catch((err) => {
      handleFirestoreError(err, OperationType.GET, privatePath);
    }),
    getDocs(
      query(
        collection(db, 'agencies', cleanAgencyId, 'adminLedgerChunks'),
        where('ownerUid', '==', ownerUid)
      )
    ).catch((err) => {
      handleFirestoreError(err, OperationType.LIST, chunksPath);
    }),
    getDocs(
      query(
        collection(db, 'agencies', cleanAgencyId, 'archives'),
        where('ownerUid', '==', ownerUid)
      )
    ).catch((err) => {
      handleFirestoreError(err, OperationType.LIST, archivesPath);
    }),
  ]);

  let agency: CloudAgencyDoc | null = null;
  let agencyUpdatedAtMs = 0;
  if (agencySnap && agencySnap.exists()) {
    const raw = agencySnap.data();
    agency = raw as CloudAgencyDoc;
    agencyUpdatedAtMs = parseTimestampMs(raw.updatedAt);
  }

  let privateConfig: CloudAdminPrivateConfigDoc | null = null;
  if (privateSnap && privateSnap.exists()) {
    const raw = privateSnap.data();
    privateConfig = {
      agencyId: typeof raw.agencyId === 'string' ? raw.agencyId : cleanAgencyId,
      ownerUid: typeof raw.ownerUid === 'string' ? raw.ownerUid : ownerUid,
      whatsappNumber: typeof raw.whatsappNumber === 'string' ? raw.whatsappNumber : '',
      autoArchiveDaily: Boolean(raw.autoArchiveDaily),
      pausedAutoArchiveDate:
        typeof raw.pausedAutoArchiveDate === 'string' ? raw.pausedAutoArchiveDate : '',
      extraNames: Array.isArray(raw.extraNames)
        ? raw.extraNames.map((n) => String(n || '').trim()).filter(Boolean)
        : [],
      updatedAtMs: parseTimestampMs(raw.updatedAt),
    };
  }

  const chunksBySession: Record<
    SessionId,
    { chunkIndex: number; totalChunks: number; date: string; revisionMs: number; rows: TicketEntryRow[] }[]
  > = {
    '1PM': [],
    '6PM': [],
    '8PM': [],
  };
  const chunkSigs: Record<string, string> = {};
  const chunkIds: string[] = [];
  let ledgerRevisionMs = 0;
  let ledgerDate = agency?.date || '';

  if (chunksSnap) {
    chunksSnap.forEach((docSnap) => {
      const d = docSnap.data();
      const sid = d.sessionId as SessionId;
      if (sid !== '1PM' && sid !== '6PM' && sid !== '8PM') return;
      const chunkId = typeof d.chunkId === 'string' && d.chunkId ? d.chunkId : docSnap.id;
      const chunkIndex = Number(d.chunkIndex) || 0;
      const totalChunks = Math.max(1, Number(d.totalChunks) || 1);
      const dateStr = typeof d.date === 'string' ? d.date : agency?.date || '';
      const revMs = Math.max(Number(d.revisionMs) || 0, parseTimestampMs(d.updatedAt));
      const rows = sanitizeChunkRowsForCloud(Array.isArray(d.rows) ? (d.rows as TicketEntryRow[]) : []);

      chunkIds.push(chunkId);
      chunkSigs[chunkId] = computeChunkSignature(dateStr, sid, chunkIndex, totalChunks, rows);
      chunksBySession[sid].push({
        chunkIndex,
        totalChunks,
        date: dateStr,
        revisionMs: revMs,
        rows,
      });
      if (revMs > ledgerRevisionMs) {
        ledgerRevisionMs = revMs;
        if (dateStr) ledgerDate = dateStr;
      }
    });
  }

  const entries: Record<SessionId, TicketEntryRow[]> = {
    '1PM': [],
    '6PM': [],
    '8PM': [],
  };
  for (const sid of ['1PM', '6PM', '8PM'] as SessionId[]) {
    const list = chunksBySession[sid];
    if (list.length === 0) continue;
    list.sort((a, b) => a.chunkIndex - b.chunkIndex);
    // Respect totalChunks from chunk 0 (the freshest header) so stale tail chunks are ignored
    const declaredTotal = list[0]?.totalChunks || list.length;
    const assembled: TicketEntryRow[] = [];
    for (const c of list) {
      if (c.chunkIndex >= declaredTotal) continue;
      for (let i = 0; i < c.rows.length; i += 1) {
        assembled.push(c.rows[i]);
      }
    }
    entries[sid] = assembled;
  }

  const history: DaySnapshot[] = [];
  const recycleBin: DaySnapshot[] = [];
  const archiveSigs: Record<string, string> = {};
  const archiveDocIds: string[] = [];
  const expiredCloudArchiveDocIds: string[] = [];
  const nowMs = Date.now();

  if (archivesSnap) {
    archivesSnap.forEach((docSnap) => {
      const parsed = parseArchiveSnapshotFromDoc(docSnap.id, docSnap.data() as Record<string, unknown>);
      if (!parsed) return;
      if (isArchiveSnapshotExpired(parsed.snapshot, nowMs)) {
        expiredCloudArchiveDocIds.push(docSnap.id);
        return;
      }
      archiveDocIds.push(docSnap.id);
      archiveSigs[docSnap.id] = computeArchiveSignature(parsed.snapshot, parsed.inRecycleBin);
      if (parsed.inRecycleBin) {
        recycleBin.push(parsed.snapshot);
      } else {
        history.push(parsed.snapshot);
      }
    });
  }

  // Automatically remove Admin archives older than 7 days from Firestore in the background
  if (expiredCloudArchiveDocIds.length > 0) {
    void Promise.all(
      expiredCloudArchiveDocIds.map(async (expiredId) => {
        try {
          await deleteDoc(doc(db, 'agencies', cleanAgencyId, 'archives', expiredId));
        } catch {
          // Non-fatal background cleanup
        }
      })
    );
  }

  const sortNewest = (a: DaySnapshot, b: DaySnapshot) =>
    String(b.savedAt || '').localeCompare(String(a.savedAt || ''));
  history.sort(sortNewest);
  recycleBin.sort(sortNewest);

  return {
    agency,
    agencyUpdatedAtMs,
    privateConfig,
    entries,
    ledgerDate,
    ledgerRevisionMs,
    chunkSigs,
    chunkIds,
    history,
    recycleBin,
    archiveSigs,
    archiveDocIds,
  };
}

/**
 * Persists Admin's private settings (WhatsApp number, extra seller names, auto-archive flags)
 * to /agencies/{agencyId}/private/config so they recover automatically on reinstall.
 */
export async function syncAdminPrivateConfigCloud(
  ownerUid: string,
  state: AppState,
  agencyId = AGENCY_ID
): Promise<void> {
  const cleanAgencyId = sanitizeId(agencyId || AGENCY_ID, AGENCY_ID);
  const ref = doc(db, 'agencies', cleanAgencyId, 'private', 'config');
  const whatsappNumber = String(state.config.whatsappNumber || '').slice(0, 30);
  const autoArchiveDaily = Boolean(state.config.autoArchiveDaily);
  const pausedAutoArchiveDate = String(state.config.pausedAutoArchiveDate || '').slice(0, 10);
  const extraNames = sanitizeStringList(state.extraNames, 100);

  let existsNow = false;
  try {
    const snap = await getDoc(ref);
    existsNow = snap.exists();
  } catch {
    existsNow = false;
  }

  try {
    if (existsNow) {
      await updateDoc(ref, {
        whatsappNumber,
        autoArchiveDaily,
        pausedAutoArchiveDate,
        extraNames,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        agencyId: cleanAgencyId,
        ownerUid,
        whatsappNumber,
        autoArchiveDaily,
        pausedAutoArchiveDate,
        extraNames,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, existsNow ? OperationType.UPDATE : OperationType.CREATE, ref.path);
  }
}

/**
 * Incrementally syncs Admin's full 1PM, 6PM, and 8PM ledger rows (including MY CHOICE,
 * manual/pasted rows, and up to 30,000+ rows) into chunked Admin-only Firestore docs.
 * Only writes changed chunks and deletes stale extra chunks.
 */
export async function syncAdminLedgerChunksCloud(
  adminUid: string,
  ownerUid: string,
  adminUids: string[],
  date: string,
  entries: Record<SessionId, TicketEntryRow[]>,
  revisionMs: number,
  knownChunkSigs: Record<string, string>,
  knownChunkIds: Set<string>,
  agencyId = AGENCY_ID
): Promise<void> {
  const cleanAgencyId = sanitizeId(agencyId || AGENCY_ID, AGENCY_ID);
  const cleanDate = sanitizeIsoDate(date);
  const safeAdminUids = adminUids.length > 0 ? adminUids.slice(0, 10) : [ownerUid];
  const safeRevision = Math.max(0, Math.floor(revisionMs || Date.now()));

  const desired = buildDesiredLedgerChunks(cleanDate, entries);
  const desiredIdSet = new Set(desired.map((c) => c.chunkId));

  const toWrite = desired.filter(
    (c) => !knownChunkIds.has(c.chunkId) || knownChunkSigs[c.chunkId] !== c.sig
  );
  const toDelete = Array.from(knownChunkIds).filter((id) => !desiredIdSet.has(id));

  if (toWrite.length === 0 && toDelete.length === 0) return;

  const CONCURRENCY = 6;
  for (let i = 0; i < toWrite.length; i += CONCURRENCY) {
    const slice = toWrite.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (chunk) => {
        const ref = doc(db, 'agencies', cleanAgencyId, 'adminLedgerChunks', chunk.chunkId);
        const existed = knownChunkIds.has(chunk.chunkId);
        try {
          if (existed) {
            try {
              await updateDoc(ref, {
                sessionId: chunk.sessionId,
                chunkIndex: chunk.chunkIndex,
                totalChunks: chunk.totalChunks,
                date: cleanDate,
                revisionMs: safeRevision,
                adminUids: safeAdminUids,
                rows: chunk.rows,
                updatedByUid: adminUid,
                updatedAt: serverTimestamp(),
              });
            } catch (updateErr) {
              const code =
                typeof updateErr === 'object' && updateErr !== null && 'code' in updateErr
                  ? String((updateErr as { code?: unknown }).code || '')
                  : '';
              if (code === 'not-found') {
                await setDoc(ref, {
                  agencyId: cleanAgencyId,
                  chunkId: chunk.chunkId,
                  sessionId: chunk.sessionId,
                  chunkIndex: chunk.chunkIndex,
                  totalChunks: chunk.totalChunks,
                  date: cleanDate,
                  revisionMs: safeRevision,
                  ownerUid,
                  adminUids: safeAdminUids,
                  rows: chunk.rows,
                  updatedByUid: adminUid,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
              } else {
                throw updateErr;
              }
            }
          } else {
            await setDoc(ref, {
              agencyId: cleanAgencyId,
              chunkId: chunk.chunkId,
              sessionId: chunk.sessionId,
              chunkIndex: chunk.chunkIndex,
              totalChunks: chunk.totalChunks,
              date: cleanDate,
              revisionMs: safeRevision,
              ownerUid,
              adminUids: safeAdminUids,
              rows: chunk.rows,
              updatedByUid: adminUid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          knownChunkIds.add(chunk.chunkId);
          knownChunkSigs[chunk.chunkId] = chunk.sig;
        } catch (err) {
          handleFirestoreError(err, existed ? OperationType.UPDATE : OperationType.CREATE, ref.path);
        }
      })
    );
  }

  for (let i = 0; i < toDelete.length; i += CONCURRENCY) {
    const slice = toDelete.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (staleId) => {
        const ref = doc(db, 'agencies', cleanAgencyId, 'adminLedgerChunks', staleId);
        try {
          await deleteDoc(ref);
          knownChunkIds.delete(staleId);
          delete knownChunkSigs[staleId];
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, ref.path);
        }
      })
    );
  }
}

/**
 * Incrementally syncs Admin's Archive history & Recycle Bin snapshots to
 * /agencies/{agencyId}/archives/{snapshotId} so all past days survive app deletion.
 */
export async function syncAdminArchivesCloud(
  ownerUid: string,
  adminUids: string[],
  history: DaySnapshot[],
  recycleBin: DaySnapshot[],
  knownArchiveSigs: Record<string, string>,
  knownArchiveDocIds: Set<string>,
  agencyId = AGENCY_ID,
  allowDeletions = false
): Promise<void> {
  const cleanAgencyId = sanitizeId(agencyId || AGENCY_ID, AGENCY_ID);
  const safeAdminUids = adminUids.length > 0 ? adminUids.slice(0, 10) : [ownerUid];

  const desiredMap = new Map<
    string,
    { docId: string; snap: DaySnapshot; inRecycleBin: boolean; sig: string }
  >();

  const nowMs = Date.now();
  const expiredExplicitIds = new Set<string>();

  for (const snap of history) {
    if (!snap || !snap.id) continue;
    const docId = makeAdminArchiveDocId(snap.id);
    if (isArchiveSnapshotExpired(snap, nowMs)) {
      if (knownArchiveDocIds.has(docId)) expiredExplicitIds.add(docId);
      continue;
    }
    desiredMap.set(docId, {
      docId,
      snap,
      inRecycleBin: false,
      sig: computeArchiveSignature(snap, false),
    });
  }
  for (const snap of recycleBin) {
    if (!snap || !snap.id) continue;
    const docId = makeAdminArchiveDocId(snap.id);
    if (isArchiveSnapshotExpired(snap, nowMs)) {
      if (knownArchiveDocIds.has(docId)) expiredExplicitIds.add(docId);
      continue;
    }
    if (desiredMap.has(docId)) continue;
    desiredMap.set(docId, {
      docId,
      snap,
      inRecycleBin: true,
      sig: computeArchiveSignature(snap, true),
    });
  }

  const toWrite = Array.from(desiredMap.values()).filter(
    (item) => !knownArchiveDocIds.has(item.docId) || knownArchiveSigs[item.docId] !== item.sig
  );
  // SAFETY: Never auto-delete non-expired cloud archives during routine background sync (prevents
  // truncated localStorage or stale sessions from wiping saved Close Day records in Firestore).
  // Expired (>7 days) archives are always auto-deleted cleanly.
  const toDelete = allowDeletions
    ? Array.from(knownArchiveDocIds).filter((id) => !desiredMap.has(id))
    : Array.from(expiredExplicitIds);

  if (toWrite.length === 0 && toDelete.length === 0) return;

  const CONCURRENCY = 4;
  for (let i = 0; i < toWrite.length; i += CONCURRENCY) {
    const slice = toWrite.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async ({ docId, snap, inRecycleBin, sig }) => {
        const ref = doc(db, 'agencies', cleanAgencyId, 'archives', docId);
        const cleanDate = sanitizeIsoDate(snap.date);
        const cleanSavedAt = String(snap.savedAt || new Date().toISOString()).slice(0, 64);
        const cleanTrigger = sanitizeArchiveTrigger(snap.trigger);
        const payload = buildSafeArchivePayload(snap, inRecycleBin);
        const existed = knownArchiveDocIds.has(docId);

        try {
          if (existed) {
            try {
              await updateDoc(ref, {
                adminUids: safeAdminUids,
                date: cleanDate,
                savedAt: cleanSavedAt,
                trigger: cleanTrigger,
                payload,
                updatedAt: serverTimestamp(),
              });
            } catch (updateErr) {
              const code =
                typeof updateErr === 'object' && updateErr !== null && 'code' in updateErr
                  ? String((updateErr as { code?: unknown }).code || '')
                  : '';
              if (code === 'not-found') {
                await setDoc(ref, {
                  agencyId: cleanAgencyId,
                  snapshotId: docId,
                  ownerUid,
                  adminUids: safeAdminUids,
                  date: cleanDate,
                  savedAt: cleanSavedAt,
                  trigger: cleanTrigger,
                  payload,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
              } else {
                throw updateErr;
              }
            }
          } else {
            await setDoc(ref, {
              agencyId: cleanAgencyId,
              snapshotId: docId,
              ownerUid,
              adminUids: safeAdminUids,
              date: cleanDate,
              savedAt: cleanSavedAt,
              trigger: cleanTrigger,
              payload,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          knownArchiveDocIds.add(docId);
          knownArchiveSigs[docId] = sig;
        } catch (err) {
          handleFirestoreError(err, existed ? OperationType.UPDATE : OperationType.CREATE, ref.path);
        }
      })
    );
  }

  for (let i = 0; i < toDelete.length; i += CONCURRENCY) {
    const slice = toDelete.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (staleId) => {
        const ref = doc(db, 'agencies', cleanAgencyId, 'archives', staleId);
        try {
          await deleteDoc(ref);
          knownArchiveDocIds.delete(staleId);
          delete knownArchiveSigs[staleId];
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, ref.path);
        }
      })
    );
  }
}

/**
 * Explicitly deletes specific Admin archive documents from Firestore ONLY when the Admin
 * confirms Permanent Delete or Empty Recycle Bin in the Archive UI.
 */
export async function deleteAdminArchivesByIdCloud(
  snapshotIds: string[],
  knownArchiveSigs: Record<string, string>,
  knownArchiveDocIds: Set<string>,
  agencyId = AGENCY_ID
): Promise<void> {
  if (!Array.isArray(snapshotIds) || snapshotIds.length === 0) return;
  const cleanAgencyId = sanitizeId(agencyId || AGENCY_ID, AGENCY_ID);
  const candidateIds = new Set<string>();
  for (const raw of snapshotIds) {
    if (!raw) continue;
    const prefixed = makeAdminArchiveDocId(raw);
    if (prefixed) candidateIds.add(prefixed);
    const cleanedRaw = sanitizeId(raw, '');
    if (cleanedRaw && cleanedRaw !== prefixed) {
      candidateIds.add(cleanedRaw);
    }
  }
  const docIds = Array.from(candidateIds);
  const CONCURRENCY = 4;
  for (let i = 0; i < docIds.length; i += CONCURRENCY) {
    const slice = docIds.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (docId) => {
        const ref = doc(db, 'agencies', cleanAgencyId, 'archives', docId);
        try {
          await deleteDoc(ref);
          knownArchiveDocIds.delete(docId);
          delete knownArchiveSigs[docId];
        } catch (err) {
          // Ignore not-found / already-deleted candidate doc IDs
          const code =
            typeof err === 'object' && err !== null && 'code' in err
              ? String((err as { code?: unknown }).code || '')
              : '';
          if (code === 'not-found') {
            knownArchiveDocIds.delete(docId);
            delete knownArchiveSigs[docId];
            return;
          }
          handleFirestoreError(err, OperationType.DELETE, ref.path);
        }
      })
    );
  }
}



