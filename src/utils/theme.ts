import { AppThemeId } from '../types/ledger';

export type { AppThemeId };

export interface AppThemeOption {
  id: AppThemeId;
  name: string;
  tagline: string;
  isDark?: boolean;
  brand: string;
  brandMid: string;
  brandEnd: string;
  brandHover: string;
  canvas: string;
  surface?: string;
  tint: string;
  tintBorder: string;
  accentDot: string;
}

const STORAGE_KEY = 'kk-app-theme';

export const APP_THEMES: AppThemeOption[] = [
  {
    id: 'aurora-live',
    name: 'Neon Aurora Live',
    tagline: 'Animated Particles',
    isDark: true,
    brand: '#0C1E3A',
    brandMid: '#1E3A8A',
    brandEnd: '#0D9488',
    brandHover: '#0EA5E9',
    canvas: '#060D1A',
    surface: 'rgba(12, 24, 44, 0.72)',
    tint: 'rgba(45, 212, 191, 0.18)',
    tintBorder: 'rgba(52, 245, 197, 0.52)',
    accentDot: '#2DD4BF',
  },
  {
    id: 'navy',
    name: 'Royal Navy',
    tagline: 'Executive Blue',
    brand: '#0B1E47',
    brandMid: '#122E6B',
    brandEnd: '#1B449C',
    brandHover: '#1D4ED8',
    canvas: '#F3F6FB',
    tint: '#EEF4FF',
    tintBorder: '#C7D7FE',
    accentDot: '#60A5FA',
  },
  {
    id: 'sapphire',
    name: 'Ocean Sapphire',
    tagline: 'Crisp Azure',
    brand: '#0C4A6E',
    brandMid: '#075985',
    brandEnd: '#0284C7',
    brandHover: '#0369A1',
    canvas: '#F1F8FD',
    tint: '#F0F9FF',
    tintBorder: '#BAE6FD',
    accentDot: '#38BDF8',
  },
];

const THEME_MAP: Partial<Record<AppThemeId, AppThemeOption>> = APP_THEMES.reduce(
  (acc, t) => {
    acc[t.id] = t;
    return acc;
  },
  {} as Partial<Record<AppThemeId, AppThemeOption>>
);

export function resolveThemeOption(themeId?: AppThemeId): AppThemeOption {
  if (themeId && THEME_MAP[themeId]) {
    return THEME_MAP[themeId]!;
  }
  if (themeId === 'cobalt') return THEME_MAP.navy!;
  if (themeId === 'teal') return THEME_MAP.sapphire!;
  return THEME_MAP['aurora-live']!;
}

export function getStoredThemeId(): AppThemeId {
  if (typeof window === 'undefined') return 'aurora-live';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) as AppThemeId | null;
    if (raw) return resolveThemeOption(raw).id;
  } catch {
    // ignore storage errors
  }
  return 'aurora-live';
}

export function applyDocumentTheme(themeId?: AppThemeId): AppThemeOption {
  const theme = resolveThemeOption(themeId ?? getStoredThemeId());
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.style.setProperty('--kk-brand', theme.brand);
    root.style.setProperty('--kk-brand-mid', theme.brandMid);
    root.style.setProperty('--kk-brand-end', theme.brandEnd);
    root.style.setProperty('--kk-brand-hover', theme.brandHover);
    root.style.setProperty('--kk-canvas', theme.canvas);
    root.style.setProperty('--kk-surface', theme.surface || '#FFFFFF');
    root.style.setProperty('--kk-tint', theme.tint);
    root.style.setProperty('--kk-tint-border', theme.tintBorder);
    root.setAttribute('data-kk-theme', theme.id);
    root.classList.toggle('dark', Boolean(theme.isDark));

    const metaTheme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.content = theme.isDark ? theme.canvas : theme.brand;
    }
  }
  if (typeof window !== 'undefined') {
    if (themeId) {
      try {
        window.localStorage.setItem(STORAGE_KEY, theme.id);
      } catch {
        // ignore storage errors
      }
    }
    window.dispatchEvent(new CustomEvent<AppThemeId>('kk-theme-change', { detail: theme.id }));
  }
  return theme;
}

export function getActiveDocumentThemeId(): AppThemeId {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-kk-theme') as AppThemeId | null;
    if (attr) return resolveThemeOption(attr).id;
  }
  return getStoredThemeId();
}

export function subscribeThemeChange(listener: (themeId: AppThemeId) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const custom = event as CustomEvent<AppThemeId>;
    listener(resolveThemeOption(custom.detail ?? getActiveDocumentThemeId()).id);
  };
  window.addEventListener('kk-theme-change', handler);
  return () => window.removeEventListener('kk-theme-change', handler);
}

export function applyAppTheme(themeId: AppThemeId): AppThemeOption {
  return applyDocumentTheme(themeId);
}

export function initAppTheme() {
  applyDocumentTheme(getStoredThemeId());
}
