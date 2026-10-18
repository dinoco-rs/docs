import type { DocsLocale } from '../lib/locales';

/** A heading listed in a page's "On this page" outline. Titles must match the Markdown headings exactly. */
export type DocsInPageItemData =
	| string
	| {
			items?: DocsInPageItemData[];
			title: string;
	  };

/** One page as written in a navigation JSON file. */
export type RawDocsItem = {
	contentPath: string;
	description: string;
	inPage: DocsInPageItemData[];
	name: string;
	shortName: string;
	subItems?: RawDocsItem[];
};

export type RawDocsSection = {
	items: RawDocsItem[];
	title: string;
};

export type RawDocsGroup = {
	icon: string;
	name: string;
	sections: RawDocsSection[];
	shortName: string;
};

/** Shape of `src/jsons/<product>/<version>/<locale>.json`. */
export type RawDocsNavigation = {
	groups: RawDocsGroup[];
};

export type DocsItem = Omit<RawDocsItem, 'subItems'> & {
	subItems?: DocsItem[];
};

export type DocsSection = {
	items: DocsItem[];
	title: string;
};

export type DocsGroup = {
	icon: string;
	languages: Partial<Record<DocsLocale, DocsSection[]>>;
	localizedNames: Partial<Record<DocsLocale, string>>;
	name: string;
	shortName: string;
};

export type DocsVersion = {
	description: Record<DocsLocale, string>;
	groups: DocsGroup[];
	name: string;
};
