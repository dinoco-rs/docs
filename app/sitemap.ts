import { loadDocsIndex } from '../src/lib/docs-index';
import { SITE_URL } from '../src/lib/site';
import { SUPPORTED_LOCALES } from '../src/lib/locales';

import type { MetadataRoute } from 'next';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const index = await loadDocsIndex();
	const latest = new Date(Math.max(...index.map(entry => entry.modifiedAt.getTime())));

	const localized = (path: string, priority: number): MetadataRoute.Sitemap =>
		SUPPORTED_LOCALES.map(locale => ({
			alternates: { languages: Object.fromEntries(SUPPORTED_LOCALES.map(other => [other, `${SITE_URL}/${other}${path}`])) },
			changeFrequency: 'monthly',
			lastModified: latest,
			priority,
			url: `${SITE_URL}/${locale}${path}`,
		}));

	// Every page exists in each locale under the same `product/group/item`, so the alternates share the id.
	const docsEntries: MetadataRoute.Sitemap = index.map(entry => ({
		alternates: { languages: Object.fromEntries(index.filter(other => other.id === entry.id).map(other => [other.locale, other.url])) },
		changeFrequency: 'weekly',
		lastModified: entry.modifiedAt,
		priority: entry.group === 'guide' ? 0.9 : 0.8,
		url: entry.url,
	}));

	return [...localized('', 1), ...localized('/docs', 0.9), ...docsEntries];
}
