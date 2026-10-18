import { buildDocsPath, getAdjacentDocsItems, getFirstDocsPath, getGroups, getLocalizedGroupName, getLocalizedSections, translateDocsPath } from './navigation';
import { PRODUCTS, latestVersion } from './products';
import { SUPPORTED_LOCALES } from './locales';

import type { DocsInPageItemData, DocsItem } from '../jsons/types';
import type { DocsLocale } from './locales';
import type { ResolvedDocsPath } from './navigation';
import type { ProductId } from './products';

export type NavLink = {
	active: boolean;
	children?: NavLink[];
	href: string;
	title: string;
};

export type PagerLink = { context: string; href: string; title: string };

/** Everything the client-side docs shell needs, and nothing more: no navigation tree of other groups or products. */
export type DocsView = {
	groups: { active: boolean; href: string; icon: string; name: string; shortName: string }[];
	locale: DocsLocale;
	localeHrefs: Record<DocsLocale, string>;
	next?: PagerLink;
	page: {
		groupName: string;
		inPage: DocsInPageItemData[];
		markdown: string;
		parentTitle?: string;
		path: string;
		title: string;
	};
	previous?: PagerLink;
	product: { id: ProductId; name: string; repository: string; version: string };
	products: { active: boolean; href: string; id: ProductId; name: string; version: string }[];
	sections: { items: NavLink[]; title: string }[];
};

export function buildDocsView(resolved: ResolvedDocsPath, locale: DocsLocale, markdown: string): DocsView {
	const productId = resolved.product.id;
	const groupShortName = resolved.group.shortName;

	const toLink = (item: DocsItem): NavLink => {
		if (item.subItems === undefined || item.subItems.length === 0) {
			const href = buildDocsPath(locale, productId, groupShortName, item.shortName);

			return { active: href === resolved.path, href, title: item.name };
		}

		const children = item.subItems.map(subItem => {
			const href = buildDocsPath(locale, productId, groupShortName, item.shortName, subItem.shortName);

			return { active: href === resolved.path, href, title: subItem.name };
		});

		return { active: children.some(child => child.active), children, href: children[0].href, title: item.name };
	};

	const { next, previous } = getAdjacentDocsItems(resolved, locale);
	const pager = (entry: typeof next): PagerLink | undefined =>
		entry === undefined ? undefined : { context: entry.parentItem?.name ?? '', href: entry.path, title: entry.item.name };

	return {
		groups: getGroups(productId, locale).map(group => ({
			active: group.shortName === groupShortName,
			href: resolvedGroupPath(locale, productId, group.shortName),
			icon: group.icon,
			name: getLocalizedGroupName(group, locale),
			shortName: group.shortName,
		})),
		locale,
		localeHrefs: Object.fromEntries(SUPPORTED_LOCALES.map(option => [option, translateDocsPath(resolved, option)])) as Record<DocsLocale, string>,
		next: pager(next),
		page: {
			groupName: getLocalizedGroupName(resolved.group, locale),
			inPage: resolved.item.inPage,
			markdown,
			parentTitle: resolved.parentItem?.name,
			path: resolved.path,
			title: resolved.item.name,
		},
		previous: pager(previous),
		product: { id: productId, name: resolved.product.name, repository: resolved.product.repository, version: resolved.version.name },
		products: PRODUCTS.map(product => ({
			active: product.id === productId,
			href: getFirstDocsPath(locale, product.id),
			id: product.id,
			name: product.name,
			version: latestVersion(product).name,
		})),
		sections: getLocalizedSections(resolved.group, locale).map(section => ({ items: section.items.map(toLink), title: section.title })),
	};
}

function resolvedGroupPath(locale: DocsLocale, productId: ProductId, groupShortName: string): string {
	const group = getGroups(productId, locale).find(candidate => candidate.shortName === groupShortName);
	const first = group === undefined ? undefined : getLocalizedSections(group, locale)[0]?.items[0];

	if (first === undefined) {
		return getFirstDocsPath(locale, productId);
	}

	return buildDocsPath(locale, productId, groupShortName, first.shortName, first.subItems?.[0]?.shortName);
}
