import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getAuth,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

const FIRESTORE_DATABASE_ID =
  (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId ||
  'ai-studio-kkagencyledger-4009c142-a714-4d4b-9dd5-d98e312a9f6e';

let firestoreInstance: Firestore;
try {
  firestoreInstance = initializeFirestore(
    app,
    {
      experimentalAutoDetectLongPolling: true,
    },
    FIRESTORE_DATABASE_ID
  );
} catch {
  firestoreInstance = getFirestore(app, FIRESTORE_DATABASE_ID);
}

export const db = firestoreInstance;

// Explicitly prefer durable IndexedDB + LocalStorage persistence so Admin & Seller
// logins stay permanently signed in across reloads, tab closes, and phone restarts.
let authInstance: Auth;
try {
  authInstance = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  });
} catch {
  authInstance = getAuth(app);
}

export const auth = authInstance;
export const popupRedirectResolver = browserPopupRedirectResolver;

// Primary Google provider (clean login without extra select_account hop on iOS Safari)
export const googleProvider = new GoogleAuthProvider();

// Secondary provider when user explicitly taps "Use Other Gmail"
export const googleAccountPickerProvider = new GoogleAuthProvider();
googleAccountPickerProvider.setCustomParameters({ prompt: 'select_account' });

// Minimum Google Workspace scope for live Google Sheets sync (read-only)
export const GOOGLE_SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];

export const googleSheetsProvider = new GoogleAuthProvider();
GOOGLE_SHEETS_SCOPES.forEach((scope) => googleSheetsProvider.addScope(scope));

// In-memory OAuth access token cache ONLY (never stored in localStorage/sessionStorage)
let cachedGoogleSheetsAccessToken: string | null = null;
let cachedGoogleSheetsTokenExpiresAt = 0;
const sheetsTokenListeners = new Set<(hasToken: boolean) => void>();

function notifySheetsTokenListeners() {
  const ready = Boolean(cachedGoogleSheetsAccessToken);
  sheetsTokenListeners.forEach((fn) => fn(ready));
}

function setCachedGoogleSheetsAccessToken(token: string, expiresInSeconds = 3300): void {
  cachedGoogleSheetsAccessToken = token;
  const safeTtlMs = Math.max(60, expiresInSeconds - 300) * 1000;
  cachedGoogleSheetsTokenExpiresAt = Date.now() + safeTtlMs;
  notifySheetsTokenListeners();
}

export function subscribeGoogleSheetsTokenState(listener: (hasToken: boolean) => void): () => void {
  sheetsTokenListeners.add(listener);
  listener(Boolean(cachedGoogleSheetsAccessToken));
  return () => {
    sheetsTokenListeners.delete(listener);
  };
}

export function getGoogleSheetsAccessToken(): string | null {
  return cachedGoogleSheetsAccessToken;
}

export function isGoogleSheetsTokenExpiringSoon(): boolean {
  if (!cachedGoogleSheetsAccessToken || cachedGoogleSheetsTokenExpiresAt <= 0) return false;
  return Date.now() >= cachedGoogleSheetsTokenExpiresAt;
}

export function clearGoogleSheetsAccessToken(): void {
  cachedGoogleSheetsTokenExpiresAt = 0;
  if (cachedGoogleSheetsAccessToken !== null) {
    cachedGoogleSheetsAccessToken = null;
    notifySheetsTokenListeners();
  }
}

// Clear cached in-memory Google Sheets access token whenever the user signs out
onAuthStateChanged(auth, (user) => {
  if (!user) {
    clearGoogleSheetsAccessToken();
  }
});

/**
 * Prompts the user with Google Sign-In to grant read-only access to Google Sheets
 * and caches the returned OAuth access token strictly in memory.
 */
export async function signInForGoogleSheets(): Promise<{ user: User; accessToken: string }> {
  const result = await signInWithPopup(auth, googleSheetsProvider, popupRedirectResolver);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken;
  if (!accessToken) {
    throw new Error('Google Sheets access token could not be obtained. Please try signing in again.');
  }
  setCachedGoogleSheetsAccessToken(accessToken, 3600);
  return { user: result.user, accessToken };
}

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string; hint?: string }) => void;
}

interface GisWindow extends Window {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          callback: (resp: GisTokenResponse) => void;
          error_callback?: (err: { type?: string }) => void;
        }) => GisTokenClient;
      };
    };
  };
}

let gisScriptPromise: Promise<boolean> | null = null;

function loadGoogleIdentityServicesScript(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(false);
  }
  const win = window as GisWindow;
  if (win.google?.accounts?.oauth2?.initTokenClient) {
    return Promise.resolve(true);
  }
  if (gisScriptPromise) return gisScriptPromise;

  gisScriptPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]'
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean(win.google?.accounts?.oauth2?.initTokenClient)), {
        once: true,
      });
      existing.addEventListener('error', () => resolve(false), { once: true });
      window.setTimeout(() => resolve(Boolean(win.google?.accounts?.oauth2?.initTokenClient)), 4000);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(Boolean(win.google?.accounts?.oauth2?.initTokenClient));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  return gisScriptPromise;
}

let silentRefreshPromise: Promise<string | null> | null = null;

/**
 * Attempts a silent in-memory Google OAuth access token refresh via Google Identity Services
 * (no prompt, no storage persistence). Returns null cleanly if browser blocks silent renewal.
 */
export async function trySilentGoogleSheetsTokenRefresh(
  loginHint?: string
): Promise<string | null> {
  const clientId = (firebaseConfig as { oAuthClientId?: string }).oAuthClientId;
  if (!clientId || typeof window === 'undefined') return null;
  if (silentRefreshPromise) return silentRefreshPromise;

  silentRefreshPromise = (async () => {
    try {
      const loaded = await loadGoogleIdentityServicesScript();
      const win = window as GisWindow;
      const initTokenClient = win.google?.accounts?.oauth2?.initTokenClient;
      if (!loaded || !initTokenClient) return null;

      return await new Promise<string | null>((resolve) => {
        let settled = false;
        const finish = (tok: string | null) => {
          if (settled) return;
          settled = true;
          resolve(tok);
        };

        const timer = window.setTimeout(() => finish(null), 5000);
        try {
          const client = initTokenClient({
            client_id: clientId,
            scope: GOOGLE_SHEETS_SCOPES.join(' '),
            callback: (resp) => {
              window.clearTimeout(timer);
              if (resp && resp.access_token && !resp.error) {
                setCachedGoogleSheetsAccessToken(
                  resp.access_token,
                  typeof resp.expires_in === 'number' ? resp.expires_in : 3600
                );
                finish(resp.access_token);
              } else {
                finish(null);
              }
            },
            error_callback: () => {
              window.clearTimeout(timer);
              finish(null);
            },
          });
          client.requestAccessToken({
            prompt: '',
            ...(loginHint ? { hint: loginHint } : {}),
          });
        } catch {
          window.clearTimeout(timer);
          finish(null);
        }
      });
    } catch {
      return null;
    } finally {
      silentRefreshPromise = null;
    }
  })();

  return silentRefreshPromise;
}

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIREBASE_AUTHORIZED_DOMAINS_URL = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/settings`;
export const FIREBASE_AUTH_PROVIDERS_URL = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`;

/**
 * Ensures an active Anonymous Firebase Auth session for Master & Client direct ID+Password login
 * (no email, no Gmail, no popup — works smoothly inside WhatsApp browser, Safari, Chrome & PWA).
 */
export async function ensureAnonymousSellerAuth(): Promise<User> {
  if (auth.currentUser?.isAnonymous) {
    return auth.currentUser;
  }
  if (auth.currentUser) {
    await signOut(auth);
  }
  const cred = await signInAnonymously(auth);
  return cred.user;
}

export interface AuthEnvironmentInfo {
  isEmbeddedIframe: boolean;
  isIOS: boolean;
  isInAppBrowser: boolean;
  directUrl: string;
  hostname: string;
}

export function getAuthEnvironmentInfo(): AuthEnvironmentInfo {
  if (typeof window === 'undefined') {
    return {
      isEmbeddedIframe: false,
      isIOS: false,
      isInAppBrowser: false,
      directUrl: '',
      hostname: '',
    };
  }
  let isEmbeddedIframe = false;
  try {
    isEmbeddedIframe = window.self !== window.top;
  } catch {
    isEmbeddedIframe = true;
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isIOS = /iPad|iPhone|iPod/i.test(ua);
  const isInAppBrowser =
    /GSA\/|FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|Twitter|WebView/i.test(ua);
  return {
    isEmbeddedIframe,
    isIOS,
    isInAppBrowser,
    directUrl: window.location.href,
    hostname: window.location.hostname,
  };
}

export function isUnauthorizedDomainError(errOrMessage: unknown): boolean {
  const code =
    typeof errOrMessage === 'object' && errOrMessage !== null && 'code' in errOrMessage
      ? String((errOrMessage as { code?: unknown }).code || '')
      : '';
  const raw =
    typeof errOrMessage === 'string'
      ? errOrMessage
      : errOrMessage instanceof Error
        ? errOrMessage.message
        : '';
  return (
    code === 'auth/unauthorized-domain' ||
    raw.includes('auth/unauthorized-domain') ||
    raw.includes('Authorized domains')
  );
}

export function isAnonymousAuthDisabledError(errOrMessage: unknown): boolean {
  const code =
    typeof errOrMessage === 'object' && errOrMessage !== null && 'code' in errOrMessage
      ? String((errOrMessage as { code?: unknown }).code || '')
      : '';
  const raw =
    typeof errOrMessage === 'string'
      ? errOrMessage
      : errOrMessage instanceof Error
        ? errOrMessage.message
        : '';
  return (
    code === 'auth/admin-restricted-operation' ||
    code === 'auth/operation-not-allowed' ||
    raw.includes('auth/admin-restricted-operation') ||
    raw.includes('auth/operation-not-allowed') ||
    raw.includes('Anonymous')
  );
}

export function formatFirebaseAuthError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const raw = err instanceof Error ? err.message : String(err || '');

  if (
    code === 'auth/admin-restricted-operation' ||
    code === 'auth/operation-not-allowed' ||
    raw.includes('auth/admin-restricted-operation') ||
    raw.includes('auth/operation-not-allowed')
  ) {
    return 'Direct ID + Password Login ON karne ke liye Admin ko Firebase Console me 1 baar "Anonymous" sign-in Enable karna hoga (sirf 10 second ka 1-time setting). Neeche button par tap karein.';
  }
  if (code === 'auth/unauthorized-domain' || raw.includes('auth/unauthorized-domain')) {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    return `auth/unauthorized-domain: Is app ka domain (${host}) Firebase Authorized domains me add karna hoga. Neeche "Copy Domain" aur "Open Firebase Settings" se 10 second me allow kar dein.`;
  }
  if (code === 'auth/popup-blocked') {
    return 'Browser ne Google Login popup block kar diya hai. Neeche "Open Direct in Safari / Chrome" button dabakar direct browser me login karein — phir kabhi logout nahi hoga.';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google Login window band ho gayi. Agar "The requested action is invalid" dikha, to neeche "Open Direct in Safari / Chrome" button se direct Safari/Chrome me khol kar login karein.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Internet connection slow ya offline hai. Network check karke dubara try karein.';
  }
  if (code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/internal-error') {
    return 'Is in-app browser / preview me Google popup support nahi ho raha. Neeche "Open Direct in Safari / Chrome" se app kholein aur 1 baar login karein.';
  }
  return raw.replace(/^[A-Z_]+:\s*/, '') || 'Login failed.';
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function buildFirestoreErrorInfo(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  return {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo = buildFirestoreErrorInfo(error, operationType, path);
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();
