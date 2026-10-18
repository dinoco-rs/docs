import { PRODUCTS, getProduct, latestVersion } from './products';
import { SUPPORTED_LOCALES } from './locales';

import type { DocsGroup, DocsItem, DocsSection, DocsVersion } from '../jsons/types';
import type { DocsLocale } from './locales';
import type { Product, ProductId } from './products';

export type ResolvedDocsPath = {
	group: DocsGroup;
	item: DocsItem;
	parentItem?: DocsItem;
	path: string;
	product: Product;
	sections: DocsSection[];
	version: DocsVersion;
};

export type DocsNavigationItem = {
	item: DocsItem;
	parentItem?: DocsItem;
	path: string;
};

export type DocsRoute = {
	groupShortName?: string;
	itemShortName?: string;
	subItemShortName?: string;
};

export function getLocalizedSections(group: DocsGroup, locale: DocsLocale): DocsSection[] {
	return group.languages[locale] ?? group.languages['en-us'] ?? [];
}

export function getLocalizedGroupName(group: DocsGroup, locale: DocsLocale): string {
	return group.localizedNames[locale] ?? group.localizedNames['en-us'] ?? group.name;
}

/** Groups of the product's current version that have content in `locale`. */
export function getGroups(productId: ProductId, locale: DocsLocale): DocsGroup[] {
	return latestVersion(getProduct(productId)).groups.filter(group => getLocalizedSections(group, locale).length > 0);
}

/**
 * Public doc URLs never encode the version (only the latest one is published):
 * `/{locale}/docs/{product}/{group}/{item}/{subItem?}`.
 */
export function buildDocsPath(locale: DocsLocale, productId: ProductId, groupShortName: string, itemShortName: string, subItemShortName?: string): string {
	const base = `/${locale}/docs/${productId}/${groupShortName}/${itemShortName}`;

	return subItemShortName === undefined ? base : `${base}/${subItemShortName}`;
}

function resolveEntryItem(entry: DocsItem, subItemShortName?: string): { item: DocsItem; parentItem?: DocsItem } {
	if (entry.subItems === undefined || entry.subItems.length === 0) {
		return { item: entry };
	}

	const matched = subItemShortName === undefined ? undefined : entry.subItems.find(subItem => subItem.shortName === subItemShortName);

	return { item: matched ?? entry.subItems[0], parentItem: entry };
}

function pathOf(locale: DocsLocale, productId: ProductId, group: DocsGroup, item: DocsItem, parentItem?: DocsItem): string {
	return parentItem === undefined ? buildDocsPath(locale, productId, group.shortName, item.shortName) : buildDocsPath(locale, productId, group.shortName, parentItem.shortName, item.shortName);
}

/**
 * Resolves a docs route. Unknown segments fall back to the first group or
 * page, and the route handler redirects to the canonical `path`.
 */
export function resolveDocsPath(productId: ProductId, locale: DocsLocale, route: DocsRoute = {}): ResolvedDocsPath | undefined {
	const product = getProduct(productId);
	const version = latestVersion(product);
	const groups = getGroups(productId, locale);
	const group = groups.find(candidate => candidate.shortName === route.groupShortName) ?? groups[0];

	if (group === undefined) {
		return undefined;
	}

	const sections = getLocalizedSections(group, locale);
	const items = sections.flatMap(section => section.items);
	const firstItem = items[0];

	if (firstItem === undefined) {
		return undefined;
	}

	let resolved = resolveEntryItem(firstItem);

	if (route.itemShortName !== undefined) {
		for (const entry of items) {
			if (entry.shortName === route.itemShortName) {
				resolved = resolveEntryItem(entry, route.subItemShortName);
				break;
			}

			const subItem = entry.subItems?.find(child => child.shortName === route.itemShortName || child.shortName === route.subItemShortName);

			if (subItem !== undefined) {
				resolved = { item: subItem, parentItem: entry };
				break;
			}
		}
	}

	return {
		group,
		item: resolved.item,
		parentItem: resolved.parentItem,
		path: pathOf(locale, productId, group, resolved.item, resolved.parentItem),
		product,
		sections,
		version,
	};
}

export function getFirstDocsPath(locale: DocsLocale, productId: ProductId): string {
	return resolveDocsPath(productId, locale)?.path ?? `/${locale}/docs/${productId}`;
}

export function parseDocsPath(slug?: string[]): DocsRoute {
	const segments = (slug ?? []).filter(Boolean);

	return { groupShortName: segments[0], itemShortName: segments[1], subItemShortName: segments[2] };
}

/** The same page in `locale`, used by the language switcher and `hreflang` alternates. */
export function translateDocsPath(resolved: ResolvedDocsPath, locale: DocsLocale): string {
	return (
		resolveDocsPath(resolved.product.id, locale, {
			groupShortName: resolved.group.shortName,
			itemShortName: resolved.parentItem?.shortName ?? resolved.item.shortName,
			subItemShortName: resolved.parentItem === undefined ? undefined : resolved.item.shortName,
		})?.path ?? getFirstDocsPath(locale, resolved.product.id)
	);
}

/**
 * Every real (locale, product, group, item, subItem) combination. Shared by
 * the sitemap, the docs index and `generateStaticParams`, so all of them stay
 * in sync with the navigation data.
 */
export function getAllDocsSlugs(): { locale: DocsLocale; product: ProductId; slug: string[] }[] {
	const entries: { locale: DocsLocale; product: ProductId; slug: string[] }[] = [];

	for (const product of PRODUCTS) {
		for (const locale of SUPPORTED_LOCALES) {
			for (const group of getGroups(product.id, locale)) {
				for (const section of getLocalizedSections(group, locale)) {
					for (const item of section.items) {
						if (item.subItems === undefined || item.subItems.length === 0) {
							entries.push({ locale, product: product.id, slug: [group.shortName, item.shortName] });
							continue;
						}

						for (const subItem of item.subItems) {
							entries.push({ locale, product: product.id, slug: [group.shortName, item.shortName, subItem.shortName] });
						}
					}
				}
			}
		}
	}

	return entries;
}

/** Previous and next pages, crossing group boundaries so a reader can go through a product end to end. */
export function getAdjacentDocsItems(resolved: ResolvedDocsPath, locale: DocsLocale): { next?: DocsNavigationItem; previous?: DocsNavigationItem } {
	const flattened = getGroups(resolved.product.id, locale).flatMap(group =>
		getLocalizedSections(group, locale).flatMap(section =>
			section.items.flatMap(item =>
				item.subItems === undefined || item.subItems.length === 0
					? [{ item, path: pathOf(locale, resolved.product.id, group, item) }]
					: item.subItems.map(subItem => ({ item: subItem, parentItem: item, path: pathOf(locale, resolved.product.id, group, subItem, item) })),
			),
		),
	);
	const index = flattened.findIndex(entry => entry.path === resolved.path);

	if (index === -1) {
		return {};
	}

	return { next: flattened[index + 1], previous: flattened[index - 1] };
}
