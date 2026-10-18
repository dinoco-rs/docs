import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import HomePage from '../../src/components/home/HomePage';
import { DOCS_THEME_COOKIE, resolveDocsTheme } from '../../src/lib/docs-preferences';
import { getMessages } from '../../src/lib/messages';
import { websiteJsonLd } from '../../src/lib/seo';
import { SITE_URL } from '../../src/lib/site';
import { SUPPORTED_LOCALES, isDocsLocale, resolveLocale } from '../../src/lib/locales';

import type { Metadata } from 'next';

type HomeRouteProps = {
	params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: HomeRouteProps): Promise<Metadata> {
	const locale = resolveLocale((await params).locale);
	const { hero, siteDescription } = getMessages(locale);
	const title = `Dinoco: ${hero.title}`;

	return {
		alternates: {
			canonical: `${SITE_URL}/${locale}`,
			languages: { ...Object.fromEntries(SUPPORTED_LOCALES.map(supported => [supported, `${SITE_URL}/${supported}`])), 'x-default': `${SITE_URL}/en-us` },
		},
		description: siteDescription,
		openGraph: { description: siteDescription, locale, title, type: 'website', url: `${SITE_URL}/${locale}` },
		robots: { follow: true, index: true },
		title: { absolute: title },
		twitter: { card: 'summary_large_image', description: siteDescription, title },
	};
}

const HomeRoute = async ({ params }: HomeRouteProps): Promise<React.JSX.Element> => {
	const { locale } = await params;

	if (!isDocsLocale(locale)) {
		notFound();
	}

	const theme = resolveDocsTheme((await cookies()).get(DOCS_THEME_COOKIE)?.value);

	return (
		<>
			<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd(locale, getMessages(locale).siteDescription)).replace(/</g, '\\u003c') }} />
			<HomePage locale={locale} theme={theme} />
		</>
	);
};

export default HomeRoute;
