import { buildDocsPath, getGroups, getLocalizedGroupName, getLocalizedSections } from './navigation';
import { PRODUCTS } from './products';
import { toAnchorId } from './to-anchor-id';

import type { DocsInPageItemData, DocsItem } from '../jsons/types';
import type { DocsLocale } from './locales';
import type { ProductId } from './products';

/**
 * Client-side search over page titles, descriptions and headings, built from
 * the navigation data. Loaded on demand when the search dialog opens.
 */
export type SearchEntry = {
	description: string;
	/** Heading inside the page, when the entry points at a section. */
	heading?: string;
	href: string;
	location: string;
	product: ProductId;
	title: string;
};

export type SearchResult = SearchEntry & { score: number };

function normalize(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase();
}

function flattenHeadings(items: DocsInPageItemData[]): string[] {
	return items.flatMap(item => (typeof item === 'string' ? [item] : [item.title, ...flattenHeadings(item.items ?? [])]));
}

export function buildSearchIndex(locale: DocsLocale): SearchEntry[] {
	const entries: SearchEntry[] = [];

	for (const product of PRODUCTS) {
		for (const group of getGroups(product.id, locale)) {
			const groupName = getLocalizedGroupName(group, locale);

			for (const section of getLocalizedSections(group, locale)) {
				const pages: { href: string; item: DocsItem }[] = section.items.flatMap(item =>
					item.subItems === undefined || item.subItems.length === 0
						? [{ href: buildDocsPath(locale, product.id, group.shortName, item.shortName), item }]
						: item.subItems.map(subItem => ({ href: buildDocsPath(locale, product.id, group.shortName, item.shortName, subItem.shortName), item: subItem })),
				);

				for (const { href, item } of pages) {
					const location = `${product.name} / ${groupName}`;

					entries.push({ description: item.description, href, location, product: product.id, title: item.name });

					for (const heading of flattenHeadings(item.inPage)) {
						entries.push({ description: item.description, heading, href: `${href}#${toAnchorId(heading)}`, location: `${location} / ${item.name}`, product: product.id, title: item.name });
					}
				}
			}
		}
	}

	return entries;
}

/** 2 when `token` starts a word in `text`, 1 when it only appears inside a word, 0 otherwise. */
function matchStrength(text: string, token: string): number {
	const index = text.indexOf(token);

	if (index === -1) {
		return 0;
	}

	return new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text) ? 2 : 1;
}

export function searchIndex(index: SearchEntry[], query: string, limit = 12): SearchResult[] {
	const tokens = normalize(query).split(/\s+/).filter(Boolean);

	if (tokens.length === 0) {
		return [];
	}

	const results: SearchResult[] = [];

	for (const entry of index) {
		const title = normalize(entry.title);
		const heading = normalize(entry.heading ?? '');
		const description = normalize(entry.description);
		const isPage = entry.heading === undefined;
		let score = 0;

		for (const token of tokens) {
			const inTitle = matchStrength(title, token);
			const inHeading = matchStrength(heading, token);
			const inDescription = matchStrength(description, token);

			// Sections share their page's description, so they only match through their own text or the page title.
			if (isPage ? inTitle + inDescription === 0 : inTitle + inHeading === 0) {
				score = 0;
				break;
			}

			// Word-start matches outrank matches inside a word ("lease" should find "Leases", not "Release notes").
			score += isPage ? [0, 4, 12][inTitle] : [0, 3, 10][inHeading] + [0, 0, 3][inTitle];
			score += [0, 1, 2][inDescription];

			if ((isPage ? title : heading).startsWith(token)) {
				score += 4;
			}
		}

		if (score > 0) {
			results.push({ ...entry, score });
		}
	}

	return results.sort((left, right) => right.score - left.score).slice(0, limit);
}
