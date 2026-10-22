import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// Published version of each product; keep in sync with `src/lib/products.ts`.
const products = { orm: 'v2.2.0', rekka: 'v0.0.4' };
const locales = ['en-us', 'pt-br'];
const contentRoot = path.join(process.cwd(), 'src', 'content');
const navigationRoot = path.join(process.cwd(), 'src', 'jsons');

function toAnchorId(value) {
	return value
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

function headingsOf(source) {
	let fenced = false;
	const anchors = [];

	for (const line of source.split('\n')) {
		if (line.startsWith('```')) {
			fenced = !fenced;
		} else if (!fenced && /^#{1,6}\s+/.test(line)) {
			anchors.push(toAnchorId(line.replace(/^#{1,6}\s+/, '').replace(/`/g, '').trim()));
		}
	}

	return anchors;
}

// "locale/product/group/item[/subItem]" -> contentPath, for every product and locale.
const routeToContentPath = new Map();

for (const [product, version] of Object.entries(products)) {
	for (const locale of locales) {
		const navigation = JSON.parse(await readFile(path.join(navigationRoot, product, version, `${locale}.json`), 'utf8'));

		for (const group of navigation.groups) {
			for (const section of group.sections) {
				for (const item of section.items) {
					if (item.subItems === undefined || item.subItems.length === 0) {
						routeToContentPath.set(`${locale}/${product}/${group.shortName}/${item.shortName}`, item.contentPath);
						continue;
					}

					for (const subItem of item.subItems) {
						routeToContentPath.set(`${locale}/${product}/${group.shortName}/${item.shortName}/${subItem.shortName}`, subItem.contentPath);
					}
				}
			}
		}
	}
}

const headingsCache = new Map();

async function headingsFor(contentPath) {
	if (!headingsCache.has(contentPath)) {
		headingsCache.set(contentPath, new Set(headingsOf(await readFile(path.join(contentRoot, contentPath), 'utf8'))));
	}

	return headingsCache.get(contentPath);
}

const errors = [];
const ROUTE_PATTERN = /^\/(en-us|pt-br)\/docs\/([a-z]+)\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/;
let links = 0;

for (const [product, version] of Object.entries(products)) {
	for (const locale of locales) {
		const directory = path.join(contentRoot, product, version, locale);

		for (const name of await readdir(directory)) {
			if (!name.endsWith('.md')) continue;

			const source = await readFile(path.join(directory, name), 'utf8');
			const ownHeadings = new Set(headingsOf(source));
			const where = `${product}/${locale}/${name}`;

			for (const match of source.matchAll(/\]\((\/[^)\s]*|#[^)\s]*)\)/g)) {
				const target = match[1];
				const hashIndex = target.indexOf('#');
				const linkPath = hashIndex === -1 ? target : target.slice(0, hashIndex);
				const anchor = hashIndex === -1 ? undefined : target.slice(hashIndex + 1);
				links += 1;

				if (linkPath === '') {
					if (!ownHeadings.has(anchor)) {
						errors.push(`${where}: same-page anchor #${anchor} has no matching heading`);
					}
					continue;
				}

				const routeMatch = linkPath.match(ROUTE_PATTERN);

				if (!routeMatch) {
					if (linkPath.includes('/docs/')) {
						errors.push(`${where}: ${linkPath} is not a valid docs route`);
					}
					continue;
				}

				const [, linkLocale, linkProduct, group, item, subItem] = routeMatch;
				const routeKey = [linkLocale, linkProduct, group, item, subItem].filter(Boolean).join('/');
				const targetContentPath = routeToContentPath.get(routeKey);

				if (linkLocale !== locale) {
					errors.push(`${where}: links to the ${linkLocale} page ${linkPath}`);
				}

				if (targetContentPath === undefined) {
					errors.push(`${where}: link to ${linkPath} does not match any known doc route`);
					continue;
				}

				if (anchor !== undefined && !(await headingsFor(targetContentPath)).has(anchor)) {
					errors.push(`${where}: anchor #${anchor} not found in ${targetContentPath} (linked as ${target})`);
				}
			}
		}
	}
}

if (errors.length > 0) {
	console.error(errors.map(error => `- ${error}`).join('\n'));
	process.exitCode = 1;
} else {
	console.log(`All ${links} internal links resolve to a real page and heading.`);
}
