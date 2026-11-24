import { AppThemeId } from '../types/ledger';

export const PERMANENT_THEME: AppThemeId = 'sapphire';

export function resolveThemeId(_theme?: AppThemeId): AppThemeId {
  return PERMANENT_THEME;
}

export function applyDocumentTheme(_theme?: AppThemeId) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', PERMANENT_THEME);
  }
}
