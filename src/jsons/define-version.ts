import type { DocsLocale } from '../lib/locales';
import type { DocsGroup, DocsItem, DocsVersion, RawDocsItem, RawDocsNavigation } from './types';

function mapItem(item: RawDocsItem): DocsItem {
	return { ...item, subItems: item.subItems?.map(mapItem) };
}

/**
 * Builds one documentation version from its per-locale navigation files.
 * Group order and icons come from the English file; every locale brings its
 * own group names and sections, falling back to English when a group is
 * missing from a translation.
 */
export function defineVersion(name: string, description: Record<DocsLocale, string>, content: Record<DocsLocale, RawDocsNavigation>): DocsVersion {
	const locales = Object.keys(content) as DocsLocale[];
	const groups: DocsGroup[] = content['en-us'].groups.map(group => {
		const localized = (locale: DocsLocale) => content[locale].groups.find(candidate => candidate.shortName === group.shortName);

		return {
			icon: group.icon,
			languages: Object.fromEntries(locales.map(locale => [locale, (localized(locale)?.sections ?? group.sections).map(section => ({ ...section, items: section.items.map(mapItem) }))])),
			localizedNames: Object.fromEntries(locales.map(locale => [locale, localized(locale)?.name ?? group.name])),
			name: group.name,
			shortName: group.shortName,
		};
	});

	return { description, groups, name };
}
