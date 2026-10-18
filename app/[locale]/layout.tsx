import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import '../globals.css';

import { DOCS_THEME_COOKIE, resolveDocsTheme } from '../../src/lib/docs-preferences';
import { getMessages } from '../../src/lib/messages';
import { SITE_URL } from '../../src/lib/site';
import { SUPPORTED_LOCALES, isDocsLocale, resolveLocale } from '../../src/lib/locales';

import type { Metadata, Viewport } from 'next';

type LocaleLayoutProps = {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
};

const FONTS_URL =
	'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Bungee&family=Instrument+Sans:wght@400..700&family=JetBrains+Mono:wght@400..600&display=swap';

export async function generateStaticParams(): Promise<{ locale: string }[]> {
	return SUPPORTED_LOCALES.map(locale => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
	const locale = resolveLocale((await params).locale);

	return {
		applicationName: 'Dinoco',
		authors: [{ name: 'Dinoco', url: 'https://github.com/dinoco-rs' }],
		category: 'technology',
		description: getMessages(locale).siteDescription,
		icons: { icon: [{ type: 'image/svg+xml', url: '/dinoco-mark.svg' }], apple: '/dinoco-mark.svg' },
		keywords:
			locale === 'pt-br'
				? ['Dinoco', 'Rekka', 'ORM Rust', 'fila de jobs Rust', 'cache Redis', 'migrations', 'queries type-safe']
				: ['Dinoco', 'Rekka', 'Rust ORM', 'Rust job queue', 'Redis cache', 'migrations', 'type-safe queries'],
		metadataBase: new URL(SITE_URL),
		openGraph: { siteName: 'Dinoco', type: 'website' },
		other: { 'llms-txt': `${SITE_URL}/llms.txt`, 'mcp-server': `${SITE_URL}/mcp` },
		title: { default: 'Dinoco', template: '%s | Dinoco' },
	};
}

export const viewport: Viewport = {
	themeColor: [
		{ color: '#f8fafd', media: '(prefers-color-scheme: light)' },
		{ color: '#070a12', media: '(prefers-color-scheme: dark)' },
	],
};

// Applies the stored theme before first paint, so a light-theme reader never sees a dark flash.
const themeScript = `
(() => {
	try {
		const theme = localStorage.getItem('theme') === 'light' ? 'light' : 'dark';
		document.documentElement.classList.toggle('dark', theme === 'dark');
		document.cookie = '${DOCS_THEME_COOKIE}=' + theme + '; path=/; max-age=31536000; samesite=lax';
	} catch {}
})();
`;

const LocaleLayout = async ({ children, params }: LocaleLayoutProps): Promise<React.JSX.Element> => {
	const { locale } = await params;

	if (!isDocsLocale(locale)) {
		notFound();
	}

	const theme = resolveDocsTheme((await cookies()).get(DOCS_THEME_COOKIE)?.value);

	return (
		<html lang={locale} className={theme === 'dark' ? 'dark' : undefined} suppressHydrationWarning>
			<head>
				<link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt" />
				<link rel="preconnect" href="https://fonts.googleapis.com" />
				<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
				<link href={FONTS_URL} rel="stylesheet" />
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
			</head>
			<body>{children}</body>
		</html>
	);
};

export default LocaleLayout;
