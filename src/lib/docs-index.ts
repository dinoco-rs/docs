import { promises as fs } from 'node:fs';
import path from 'node:path';

import { SITE_URL } from './site';
import { getAllDocsSlugs, getLocalizedGroupName, resolveDocsPath } from './navigation';
import { isDocsLocale } from './locales';

import type { DocsLocale } from './locales';
import type { ProductId } from './products';

export { isDocsLocale };

/**
 * Server-side index of every documentation page (all products and locales),
 * built from the same navigation data that drives the site. It backs the
 * sitemap, the `llms.txt` files and the MCP server, so all of them always
 * agree with what is actually published.
 */
export type DocsPageEntry = {
	description: string;
	group: string;
	groupName: string;
	headings: string[];
	/** `product/group/item` (or `product/group/item/subItem`): the URL path after `/docs/`. Unique within a locale. */
	id: string;
	locale: DocsLocale;
	markdown: string;
	modifiedAt: Date;
	path: string;
	product: ProductId;
	productName: string;
	title: string;
	url: string;
};

let cache: Promise<DocsPageEntry[]> | undefined;

export const CONTENT_ROOT = path.join(process.cwd(), 'src', 'content');

/** Reads a page's Markdown, refusing paths that escape the content directory. */
export async function readContentFile(contentPath: string): Promise<string> {
	const filePath = path.join(CONTENT_ROOT, contentPath);

	if (!filePath.startsWith(`${CONTENT_ROOT}${path.sep}`)) {
		throw new Error(`Invalid documentation content path: ${contentPath}`);
	}

	return fs.readFile(filePath, 'utf8');
}

function markdownHeadings(markdown: string): string[] {
	const headings: string[] = [];
	let fenced = false;

	for (const line of markdown.split('\n')) {
		if (line.startsWith('```')) {
			fenced = !fenced;
			continue;
		}

		if (!fenced && /^#{2,6}\s+/.test(line)) {
			headings.push(line.replace(/^#{2,6}\s+/, '').trim());
		}
	}

	return headings;
}

async function buildIndex(): Promise<DocsPageEntry[]> {
	const entries: DocsPageEntry[] = [];

	for (const { locale, product, slug } of getAllDocsSlugs()) {
		const resolved = resolveDocsPath(product, locale, { groupShortName: slug[0], itemShortName: slug[1], subItemShortName: slug[2] });

		if (resolved === undefined) {
			continue;
		}

		const filePath = path.join(CONTENT_ROOT, resolved.item.contentPath);
		const [markdown, stats] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);

		entries.push({
			description: resolved.item.description,
			group: resolved.group.shortName,
			groupName: getLocalizedGroupName(resolved.group, locale),
			headings: markdownHeadings(markdown),
			id: [product, ...slug].join('/'),
			locale,
			markdown,
			modifiedAt: stats.mtime,
			path: resolved.path,
			product,
			productName: resolved.product.name,
			title: resolved.item.name,
			url: `${SITE_URL}${resolved.path}`,
		});
	}

	return entries;
}

export function loadDocsIndex(): Promise<DocsPageEntry[]> {
	cache ??= buildIndex();

	return cache;
}

/** Makes site-relative links absolute, so a page still works when read outside the site. */
export function absolutizeLinks(markdown: string): string {
	return markdown.replace(/\]\(\/(?!\/)/g, `](${SITE_URL}/`);
}

export function extractSection(markdown: string, heading: string): string | undefined {
	const lines = markdown.split('\n');
	const wanted = normalize(heading);
	let fenced = false;
	let start = -1;
	let level = 0;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];

		if (line.startsWith('```')) {
			fenced = !fenced;
			continue;
		}

		const match = fenced ? null : line.match(/^(#{2,6})\s+(.*)$/);

		if (match === null) {
			continue;
		}

		if (start === -1 && normalize(match[2]) === wanted) {
			start = index;
			level = match[1].length;
		} else if (start !== -1 && match[1].length <= level) {
			return lines.slice(start, index).join('\n').trim();
		}
	}

	return start === -1 ? undefined : lines.slice(start).join('\n').trim();
}

function normalize(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.trim();
}

export type SearchHit = { entry: DocsPageEntry; score: number; snippet: string };

export function searchDocs(index: DocsPageEntry[], query: string, options: { group?: string; limit?: number; locale: DocsLocale; product?: ProductId }): SearchHit[] {
	const tokens = normalize(query)
		.split(/[^a-z0-9_]+/)
		.filter(token => token.length > 1);

	if (tokens.length === 0) {
		return [];
	}

	const hits: SearchHit[] = [];

	for (const entry of index) {
		if (entry.locale !== options.locale || (options.product !== undefined && entry.product !== options.product) || (options.group !== undefined && entry.group !== options.group)) {
			continue;
		}

		const title = normalize(entry.title);
		const description = normalize(entry.description);
		const headings = entry.headings.map(normalize);
		const body = normalize(entry.markdown);
		let score = 0;

		for (const token of tokens) {
			if (title.includes(token)) score += 10;
			if (description.includes(token)) score += 4;
			score += headings.filter(heading => heading.includes(token)).length * 5;
			score += Math.min(body.split(token).length - 1, 8);
		}

		if (score > 0) {
			hits.push({ entry, score, snippet: snippetFor(entry.markdown, tokens) });
		}
	}

	return hits.sort((left, right) => right.score - left.score).slice(0, options.limit ?? 8);
}

function snippetFor(markdown: string, tokens: string[]): string {
	const lines = markdown.split('\n').filter(line => line.trim() !== '' && !line.startsWith('```') && !line.startsWith('#'));
	const line = lines.find(candidate => tokens.some(token => normalize(candidate).includes(token))) ?? lines[0] ?? '';
	const clean = line.replace(/[`*>|]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();

	return clean.length > 240 ? `${clean.slice(0, 237)}...` : clean;
}
