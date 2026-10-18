import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import DocsShell from '../../../../../src/components/docs/DocsShell';
import MarkdownContent from '../../../../../src/components/markdown/MarkdownContent';
import Footer from '../../../../../src/components/site/Footer';
import { DOCS_THEME_COOKIE, resolveDocsTheme } from '../../../../../src/lib/docs-preferences';
import { absolutizeLinks, loadDocsIndex, readContentFile } from '../../../../../src/lib/docs-index';
import { buildDocsView } from '../../../../../src/lib/docs-view';
import { getAllDocsSlugs, parseDocsPath, resolveDocsPath, translateDocsPath } from '../../../../../src/lib/navigation';
import { isProductId } from '../../../../../src/lib/products';
import { docsPageJsonLd, docsPageKeywords, docsPageTitle } from '../../../../../src/lib/seo';
import { SITE_URL } from '../../../../../src/lib/site';
import { SUPPORTED_LOCALES, isDocsLocale } from '../../../../../src/lib/locales';

import type { Metadata } from 'next';
import type { DocsLocale } from '../../../../../src/lib/locales';

type DocsRouteProps = {
	params: Promise<{ locale: string; product: string; slug?: string[] }>;
};

export async function generateStaticParams(): Promise<{ locale: string; product: string; slug: string[] }[]> {
	return getAllDocsSlugs();
}

async function resolveRoute(params: DocsRouteProps['params']) {
	const { locale, product, slug } = await params;

	if (!isDocsLocale(locale) || !isProductId(product)) {
		return undefined;
	}

	const resolved = resolveDocsPath(product, locale, parseDocsPath(slug));

	return resolved === undefined ? undefined : { locale, product, resolved, slug };
}

export async function generateMetadata({ params }: DocsRouteProps): Promise<Metadata> {
	const route = await resolveRoute(params);

	if (route === undefined) {
		return { title: 'Documentation' };
	}

	const { locale, resolved } = route;
	const title = docsPageTitle(resolved, locale);
	const url = `${SITE_URL}${resolved.path}`;
	const languages = Object.fromEntries(SUPPORTED_LOCALES.map(option => [option, `${SITE_URL}${translateDocsPath(resolved, option)}`])) as Record<DocsLocale, string>;
	const imageUrl = `${SITE_URL}/og${resolved.path.replace('/docs/', '/')}`;
	const description = resolved.item.description;

	return {
		alternates: { canonical: url, languages: { ...languages, 'x-default': languages['en-us'] } },
		description,
		keywords: docsPageKeywords(resolved, locale),
		openGraph: {
			alternateLocale: SUPPORTED_LOCALES.filter(option => option !== locale),
			description,
			images: [{ alt: title, height: 630, url: imageUrl, width: 1200 }],
			locale,
			siteName: 'Dinoco',
			title,
			type: 'article',
			url,
		},
		robots: { follow: true, index: true },
		title,
		twitter: { card: 'summary_large_image', description, images: [imageUrl], title },
	};
}

const DocsRoute = async ({ params }: DocsRouteProps): Promise<React.JSX.Element> => {
	const route = await resolveRoute(params);

	if (route === undefined) {
		notFound();
	}

	const { locale, product, resolved, slug } = route;
	const requestedPath = `/${locale}/docs/${product}${slug && slug.length > 0 ? `/${slug.join('/')}` : ''}`;

	if (resolved.path !== requestedPath) {
		redirect(resolved.path);
	}

	const [markdown, index, cookieStore] = await Promise.all([readContentFile(resolved.item.contentPath), loadDocsIndex(), cookies()]);
	const theme = resolveDocsTheme(cookieStore.get(DOCS_THEME_COOKIE)?.value);
	const entry = index.find(page => page.locale === locale && page.path === resolved.path);
	const jsonLd = docsPageJsonLd({
		description: resolved.item.description,
		keywords: docsPageKeywords(resolved, locale),
		locale,
		modifiedAt: entry?.modifiedAt,
		resolved,
		title: docsPageTitle(resolved, locale),
	});

	return (
		<>
			<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
			<DocsShell view={buildDocsView(resolved, locale, absolutizeLinks(markdown))} theme={theme} footer={<Footer locale={locale} />}>
				<MarkdownContent locale={locale} source={markdown} />
			</DocsShell>
		</>
	);
};

export default DocsRoute;
