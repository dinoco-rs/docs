import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// Published version of each product; keep in sync with `src/lib/products.ts`.
const products = { orm: ['v2.1.7'], rekka: ['v0.0.1'] };
const locales = ['en-us', 'pt-br'];
const contentRoot = path.join(process.cwd(), 'src', 'content');
const navigationRoot = path.join(process.cwd(), 'src', 'jsons');

function flattenInPage(items) {
	return items.flatMap(item => (typeof item === 'string' ? [item] : [item.title, ...flattenInPage(item.items ?? [])]));
}

function flattenItems(items) {
	return items.flatMap(item => [item, ...flattenItems(item.subItems ?? [])]);
}

function markdownHeadings(source) {
	let fenced = false;
	const headings = [];

	for (const line of source.split('\n')) {
		if (line.startsWith('```')) {
			fenced = !fenced;
		} else if (!fenced && /^#{2,6}\s+/.test(line)) {
			headings.push(line.replace(/^#{2,6}\s+/, '').trim());
		}
	}

	return headings;
}

const referencedPaths = new Set();
const errors = [];
let pages = 0;

for (const [product, versions] of Object.entries(products)) {
	for (const version of versions) {
		const groupsByLocale = {};

		for (const locale of locales) {
			const navigationPath = path.join(navigationRoot, product, version, `${locale}.json`);
			const navigation = JSON.parse(await readFile(navigationPath, 'utf8'));
			const itemKeys = new Set();
			groupsByLocale[locale] = navigation.groups.map(group => group.shortName).join(',');

			for (const group of navigation.groups) {
				for (const section of group.sections) {
					for (const item of flattenItems(section.items)) {
						const itemKey = `${group.shortName}/${item.shortName}`;
						const where = `${product}/${version}/${locale}`;

						if (itemKeys.has(itemKey)) {
							errors.push(`${where}: duplicate route ${itemKey}`);
						}
						itemKeys.add(itemKey);

						const expectedPrefix = `${product}/${version}/${locale}/`;
						if (!item.contentPath.startsWith(expectedPrefix)) {
							errors.push(`${where}: ${item.contentPath} must start with ${expectedPrefix}`);
						}

						const contentPath = path.join(contentRoot, item.contentPath);
						referencedPaths.add(contentPath);

						let source;
						try {
							source = await readFile(contentPath, 'utf8');
						} catch {
							errors.push(`${where}: missing content file ${item.contentPath}`);
							continue;
						}

						pages += 1;

						if (!source.startsWith('# ')) {
							errors.push(`${where}: ${item.contentPath} must start with a "# " title`);
						}

						const availableHeadings = new Set(markdownHeadings(source));
						for (const heading of flattenInPage(item.inPage)) {
							if (!availableHeadings.has(heading)) {
								errors.push(`${where}: ${item.contentPath} is missing heading "${heading}"`);
							}
						}
					}
				}
			}
		}

		if (new Set(Object.values(groupsByLocale)).size > 1) {
			errors.push(`${product}/${version}: locales list different groups (${JSON.stringify(groupsByLocale)})`);
		}

		for (const locale of locales) {
			const localeDirectory = path.join(contentRoot, product, version, locale);
			for (const name of await readdir(localeDirectory)) {
				const filePath = path.join(localeDirectory, name);
				if (name.endsWith('.md') && !referencedPaths.has(filePath)) {
					errors.push(`${product}/${version}/${locale}: unreferenced content file ${name}`);
				}
			}
		}
	}
}

if (errors.length > 0) {
	console.error(errors.map(error => `- ${error}`).join('\n'));
	process.exitCode = 1;
} else {
	console.log(`Validated ${pages} documentation pages: ${Object.entries(products).map(([product, versions]) => `${product} ${versions.join(', ')}`).join('; ')}.`);
}
