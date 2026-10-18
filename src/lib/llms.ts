import { SITE_URL } from './site';
import { absolutizeLinks, loadDocsIndex } from './docs-index';
import { PRODUCTS, latestVersion } from './products';

import type { DocsLocale } from './locales';

const SUMMARY: Record<DocsLocale, string> = {
	'en-us': 'Dinoco is an open-source ecosystem of Rust crates for developers coming from TypeScript. It has two products, documented below.',
	'pt-br': 'Dinoco é um ecossistema open-source de crates Rust para quem vem do TypeScript. Ele tem dois produtos, documentados abaixo.',
};

const MCP_NOTE: Record<DocsLocale, string> = {
	'en-us': `An MCP server with search, read, and list tools is available at ${SITE_URL}/mcp.`,
	'pt-br': `Um servidor MCP com ferramentas de busca, leitura e listagem está disponível em ${SITE_URL}/mcp.`,
};

function productLines(locale: DocsLocale): string[] {
	return PRODUCTS.map(product => `- **${product.name} ${latestVersion(product).name}** (crate \`${product.crate}\`): ${product.summary[locale]}`);
}

/** `llms.txt`: a curated index of the docs for language models (llmstxt.org format). */
export async function renderLlmsTxt(locale: DocsLocale): Promise<string> {
	const index = (await loadDocsIndex()).filter(entry => entry.locale === locale);
	const lines = [
		'# Dinoco',
		'',
		`> ${SUMMARY[locale]}`,
		'',
		...productLines(locale),
		'',
		MCP_NOTE[locale],
		`Full text of every page: ${SITE_URL}/llms-full.txt${locale === 'en-us' ? '' : `?locale=${locale}`}`,
		'',
	];

	for (const product of PRODUCTS) {
		const pages = index.filter(entry => entry.product === product.id);

		for (const group of [...new Set(pages.map(entry => entry.group))]) {
			const inGroup = pages.filter(entry => entry.group === group);

			lines.push(`## ${product.name}: ${inGroup[0].groupName}`, '');
			for (const page of inGroup) {
				lines.push(`- [${page.title}](${page.url}): ${page.description}`);
			}
			lines.push('');
		}
	}

	return `${lines.join('\n').trimEnd()}\n`;
}

/** `llms-full.txt`: every page's Markdown in one document. */
export async function renderLlmsFullTxt(locale: DocsLocale): Promise<string> {
	const index = (await loadDocsIndex()).filter(entry => entry.locale === locale);
	const parts = [`# Dinoco documentation\n\n> ${SUMMARY[locale]}\n\n${productLines(locale).join('\n')}\n`];

	for (const page of index) {
		parts.push(`<!-- ${page.productName} / ${page.groupName} / ${page.title} -->\nSource: ${page.url}\n\n${absolutizeLinks(page.markdown).trim()}\n`);
	}

	return `${parts.join('\n---\n\n')}\n`;
}
