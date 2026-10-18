export type DocsLocale = 'en-us' | 'pt-br';

export const SUPPORTED_LOCALES: DocsLocale[] = ['en-us', 'pt-br'];

export const DEFAULT_LOCALE: DocsLocale = 'en-us';

export function isDocsLocale(value: unknown): value is DocsLocale {
	return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as DocsLocale);
}

export function resolveLocale(value?: string | null): DocsLocale {
	return isDocsLocale(value) ? value : DEFAULT_LOCALE;
}
