import type { DocsLocale } from './locales';

export type DocsTheme = 'light' | 'dark';

export const DOCS_LOCALE_COOKIE = 'docs-locale';
export const DOCS_THEME_COOKIE = 'docs-theme';

export function resolveDocsTheme(value?: string): DocsTheme {
	return value === 'light' ? 'light' : 'dark';
}

export function persistDocsLocale(locale: DocsLocale): void {
	if (typeof document === 'undefined') {
		return;
	}

	document.documentElement.lang = locale;
	try {
		localStorage.setItem('locale', locale);
	} catch {}
	document.cookie = `${DOCS_LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

export function persistDocsTheme(theme: DocsTheme): void {
	if (typeof document === 'undefined') {
		return;
	}

	try {
		localStorage.setItem('theme', theme);
	} catch {}
	document.documentElement.classList.toggle('dark', theme === 'dark');
	document.cookie = `${DOCS_THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}
