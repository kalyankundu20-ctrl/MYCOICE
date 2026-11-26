import { AppThemeId } from '../types/ledger';

export type { AppThemeId };

export interface AppThemeOption {
  id: AppThemeId;
  name: string;
  tagline: string;
  brand: string;
  brandMid: string;
  brandEnd: string;
  brandHover: string;
  canvas: string;
  tint: string;
  tintBorder: string;
  accentDot: string;
}

const STORAGE_KEY = 'kk-app-theme';

export const APP_THEMES: AppThemeOption[] = [
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
    id: 'emerald',
    name: 'Emerald Gold',
    tagline: 'Wealth Ledger',
    brand: '#064E3B',
    brandMid: '#065F46',
    brandEnd: '#0F766E',
    brandHover: '#047857',
    canvas: '#F2FBF7',
    tint: '#ECFDF5',
    tintBorder: '#A7F3D0',
    accentDot: '#34D399',
  },
  {
    id: 'obsidian',
    name: 'Midnight Slate',
    tagline: 'Ultra Pro Dark',
    brand: '#0F172A',
    brandMid: '#1E293B',
    brandEnd: '#334155',
    brandHover: '#1E293B',
    canvas: '#F4F6F9',
    tint: '#F1F5F9',
    tintBorder: '#CBD5E1',
    accentDot: '#94A3B8',
  },
  {
    id: 'amethyst',
    name: 'Imperial Purple',
    tagline: 'Velvet Violet',
    brand: '#2E1065',
    brandMid: '#4C1D95',
    brandEnd: '#6D28D9',
    brandHover: '#5B21B6',
    canvas: '#F6F4FF',
    tint: '#F5F3FF',
    tintBorder: '#DDD6FE',
    accentDot: '#C084FC',
  },
  {
    id: 'crimson',
    name: 'Royal Ruby',
    tagline: 'Classic Crimson',
    brand: '#7F1D1D',
    brandMid: '#991B1B',
    brandEnd: '#B91C1C',
    brandHover: '#991B1B',
    canvas: '#FDF6F6',
    tint: '#FEF2F2',
    tintBorder: '#FECACA',
    accentDot: '#FB7185',
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
  if (themeId === 'graphite') return THEME_MAP.obsidian!;
  if (themeId === 'teal') return THEME_MAP.emerald!;
  return THEME_MAP.navy!;
}

export function getStoredThemeId(): AppThemeId {
  if (typeof window === 'undefined') return 'navy';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) as AppThemeId | null;
    if (raw) return resolveThemeOption(raw).id;
  } catch {
    // ignore storage errors
  }
  return 'navy';
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
    root.style.setProperty('--kk-tint', theme.tint);
    root.style.setProperty('--kk-tint-border', theme.tintBorder);
    root.setAttribute('data-kk-theme', theme.id);

    const metaTheme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.content = theme.brand;
    }
  }
  if (typeof window !== 'undefined' && themeId) {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme.id);
    } catch {
      // ignore storage errors
    }
  }
  return theme;
}

export function applyAppTheme(themeId: AppThemeId): AppThemeOption {
  return applyDocumentTheme(themeId);
}

export function initAppTheme() {
  applyDocumentTheme(getStoredThemeId());
}
