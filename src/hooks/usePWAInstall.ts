import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// Module-level store so `beforeinstallprompt` is never missed when navigating
// between Login, Seller Portal, and Admin views.
let cachedDeferredPrompt: BeforeInstallPromptEvent | null = null;
let cachedInstalled = false;
const promptListeners = new Set<() => void>();

function notifyPromptListeners() {
  promptListeners.forEach((fn) => fn());
}

if (typeof window !== 'undefined') {
  cachedInstalled =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    cachedDeferredPrompt = e as BeforeInstallPromptEvent;
    notifyPromptListeners();
  });

  window.addEventListener('appinstalled', () => {
    cachedInstalled = true;
    cachedDeferredPrompt = null;
    notifyPromptListeners();
  });
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    cachedDeferredPrompt
  );
  const [isInstalled, setIsInstalled] = useState<boolean>(cachedInstalled);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);

  useEffect(() => {
    const syncState = () => {
      const standaloneNow =
        cachedInstalled ||
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsInstalled(standaloneNow);
      setDeferredPrompt(cachedDeferredPrompt);
    };

    const ua = window.navigator.userAgent || '';
    const uaLower = ua.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(uaLower));
    setIsAndroid(/android/.test(uaLower));
    // Detect WhatsApp / Facebook / Instagram / generic Android WebView in-app browsers
    setIsInAppBrowser(
      /whatsapp|fban|fbav|instagram|line\/|wv\)|; wv\)/i.test(ua)
    );

    syncState();
    promptListeners.add(syncState);

    return () => {
      promptListeners.delete(syncState);
    };
  }, []);

  const install = async () => {
    const promptEvent = deferredPrompt || cachedDeferredPrompt;
    if (!promptEvent) return false;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === 'accepted') {
      cachedInstalled = true;
      cachedDeferredPrompt = null;
      setIsInstalled(true);
      setDeferredPrompt(null);
      notifyPromptListeners();
      return true;
    }
    return false;
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    isAndroid,
    isInAppBrowser,
    install,
  };
}
