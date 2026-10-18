import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import DocsLanding from '../../../src/components/docs/DocsLanding';
import { DOCS_THEME_COOKIE, resolveDocsTheme } from '../../../src/lib/docs-preferences';
import { getMessages } from '../../../src/lib/messages';
import { SITE_URL } from '../../../src/lib/site';
import { SUPPORTED_LOCALES, isDocsLocale, resolveLocale } from '../../../src/lib/locales';

import type { Metadata } from 'next';

type DocsHomeProps = {
	params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: DocsHomeProps): Promise<Metadata> {
	const locale = resolveLocale((await params).locale);
	const { docsHome } = getMessages(locale);

	return {
		alternates: {
			canonical: `${SITE_URL}/${locale}/docs`,
			languages: { ...Object.fromEntries(SUPPORTED_LOCALES.map(supported => [supported, `${SITE_URL}/${supported}/docs`])), 'x-default': `${SITE_URL}/en-us/docs` },
		},
		description: docsHome.subtitle,
		openGraph: { description: docsHome.subtitle, locale, title: docsHome.title, type: 'website', url: `${SITE_URL}/${locale}/docs` },
		title: docsHome.title,
	};
}

const DocsHome = async ({ params }: DocsHomeProps): Promise<React.JSX.Element> => {
	const { locale } = await params;

	if (!isDocsLocale(locale)) {
		notFound();
	}

	const theme = resolveDocsTheme((await cookies()).get(DOCS_THEME_COOKIE)?.value);

	return <DocsLanding locale={locale} theme={theme} />;
};

export default DocsHome;
