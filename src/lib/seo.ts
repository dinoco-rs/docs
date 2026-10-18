import { SITE_URL } from './site';
import { getLocalizedGroupName } from './navigation';
import { GITHUB_ORG_URL, PRODUCTS } from './products';

import type { DocsLocale } from './locales';
import type { ResolvedDocsPath } from './navigation';

/** Page titles carry their product, and their group unless the two names are the same. */
export function docsPageTitle(resolved: ResolvedDocsPath, locale: DocsLocale): string {
	const name = resolved.item.name;

	// Sub-pages such as "Overview" repeat across parents, so the parent names them.
	if (resolved.parentItem !== undefined) {
		return `${name} - ${resolved.parentItem.name} - ${resolved.product.name}`;
	}

	const groupName = getLocalizedGroupName(resolved.group, locale);

	return name.toLowerCase() === groupName.toLowerCase() ? `${name} - ${resolved.product.name}` : `${name} - ${groupName} - ${resolved.product.name}`;
}

export function docsPageKeywords(resolved: ResolvedDocsPath, locale: DocsLocale): string[] {
	const headings = resolved.item.inPage.slice(0, 6).map(entry => (typeof entry === 'string' ? entry : entry.title));

	return [...new Set([resolved.item.name, ...headings, ...resolved.product.keywords[locale]])];
}

const ORGANIZATION = {
	'@type': 'Organization',
	logo: `${SITE_URL}/logo.png`,
	name: 'Dinoco',
	sameAs: [GITHUB_ORG_URL, ...PRODUCTS.map(product => product.repository)],
	url: SITE_URL,
};

export function websiteJsonLd(locale: DocsLocale, description: string) {
	return {
		'@context': 'https://schema.org',
		'@graph': [
			{ '@id': `${SITE_URL}/#website`, '@type': 'WebSite', description, inLanguage: locale, name: 'Dinoco', publisher: ORGANIZATION, url: `${SITE_URL}/${locale}` },
			...PRODUCTS.map(product => ({
				'@type': 'SoftwareSourceCode',
				codeRepository: product.repository,
				description: product.summary[locale],
				name: product.name,
				programmingLanguage: 'Rust',
			})),
		],
	};
}

export function docsPageJsonLd(params: { description: string; keywords: string[]; locale: DocsLocale; modifiedAt?: Date; resolved: ResolvedDocsPath; title: string }) {
	const { description, keywords, locale, modifiedAt, resolved, title } = params;
	const url = `${SITE_URL}${resolved.path}`;
	const groupName = getLocalizedGroupName(resolved.group, locale);
	const homeName = locale === 'pt-br' ? 'Início' : 'Home';

	return {
		'@context': 'https://schema.org',
		'@graph': [
			{
				'@type': 'TechArticle',
				about: { '@type': 'SoftwareApplication', name: resolved.product.name },
				dateModified: modifiedAt?.toISOString(),
				description,
				headline: title,
				inLanguage: locale,
				isPartOf: { '@id': `${SITE_URL}/#website` },
				keywords: keywords.join(', '),
				mainEntityOfPage: url,
				proficiencyLevel: 'Beginner',
				publisher: ORGANIZATION,
				url,
			},
			{
				'@type': 'BreadcrumbList',
				itemListElement: [
					{ '@type': 'ListItem', item: `${SITE_URL}/${locale}`, name: homeName, position: 1 },
					{ '@type': 'ListItem', item: `${SITE_URL}/${locale}/docs/${resolved.product.id}`, name: resolved.product.name, position: 2 },
					{ '@type': 'ListItem', name: groupName, position: 3 },
					{ '@type': 'ListItem', item: url, name: resolved.item.name, position: 4 },
				],
			},
		],
	};
}
