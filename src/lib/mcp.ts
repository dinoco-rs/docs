import { SITE_URL } from './site';
import { absolutizeLinks, extractSection, isDocsLocale, loadDocsIndex, searchDocs } from './docs-index';

import { PRODUCT_IDS, isProductId } from './products';

import type { DocsPageEntry } from './docs-index';
import type { DocsLocale } from './locales';
import type { ProductId } from './products';

/**
 * A small, dependency-free Model Context Protocol server for the Dinoco ecosystem docs,
 * served over Streamable HTTP in its stateless JSON mode: every POST carries
 * one JSON-RPC message (or a batch) and gets the JSON response back. It is
 * read-only and exposes public content only.
 */
const SERVER_INFO = { name: 'dinoco-docs', title: 'Dinoco documentation', version: '1.0.0' };
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const RESOURCE_PREFIX = 'dinoco://docs/';

const INSTRUCTIONS = [
	'Documentation for the Dinoco ecosystem of Rust crates. Two products: "orm" (Dinoco ORM, crate `dinoco`: schema.dinoco -> generated models, typed queries, migrations) and "rekka" (Rekka, crate `rekka`: Redis-backed job queues, recurring workers and a typed cache).',
	'Start with search_docs to find pages, then get_doc to read one. Use list_docs to see the whole outline. Pass product to narrow either tool to one crate.',
	'Pass locale "en-us" (default) or "pt-br". Page ids are the URL path after /docs/: "orm/orm/find-many", "orm/guide/transforms-recipes", "rekka/queues/workers". Two-segment ids such as "orm/find-many" are read as Dinoco ORM pages.',
	'Dinoco ORM docs cover schema and config, queries (find, insert, update, delete, count, exists, where_complex), relations, transactions, migrations, code transforms and the CLI. Rekka docs cover jobs and enqueueing, workers and handlers, retries, concurrency per key, recurring workers, reconcile, events, the cache, configuration, shutdown and reliability.',
].join(' ');

type JsonRpcId = string | number | null;
type JsonRpcRequest = { id?: JsonRpcId; jsonrpc?: string; method?: string; params?: Record<string, unknown> };
type JsonRpcResponse = { error?: { code: number; data?: unknown; message: string }; id: JsonRpcId; jsonrpc: '2.0'; result?: unknown };

class RpcError extends Error {
	constructor(
		readonly code: number,
		message: string,
	) {
		super(message);
	}
}

const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;
const INVALID_REQUEST = -32600;

const productProperty = {
	description: 'Only this product: "orm" (Dinoco ORM) or "rekka" (Rekka). Omit to use both.',
	enum: PRODUCT_IDS,
	type: 'string',
};

const localeProperty = {
	default: 'en-us',
	description: 'Documentation language.',
	enum: ['en-us', 'pt-br'],
	type: 'string',
};

const TOOLS = [
	{
		annotations: { openWorldHint: false, readOnlyHint: true, title: 'Search the Dinoco docs' },
		description: 'Full-text search over the Dinoco ecosystem documentation (Dinoco ORM and Rekka). Returns the best matching pages with a snippet each. Use it first when you do not know which page covers a topic.',
		inputSchema: {
			properties: {
				group: { description: 'Restrict to one group. Dinoco ORM: guide, orm, tooling, reference. Rekka: guide, queues, cache, operations, reference.', type: 'string' },
				limit: { default: 8, description: 'Maximum results (1-25).', maximum: 25, minimum: 1, type: 'integer' },
				locale: localeProperty,
				product: productProperty,
				query: { description: 'What to look for, e.g. "where_complex count", "transaction custom error" or "retry policy max attempts".', type: 'string' },
			},
			required: ['query'],
			type: 'object',
		},
		name: 'search_docs',
	},
	{
		annotations: { openWorldHint: false, readOnlyHint: true, title: 'Read a Dinoco docs page' },
		description: 'Returns one documentation page as Markdown. Pass the page id from search_docs/list_docs (for example "orm/orm/find-many" or "rekka/queues/workers"), or the page URL. Optionally return only one section by heading.',
		inputSchema: {
			properties: {
				id: { description: 'Page id (product/group/item) or a full page URL.', type: 'string' },
				locale: localeProperty,
				section: { description: 'Return only the section under this heading (e.g. "Pagination").', type: 'string' },
			},
			required: ['id'],
			type: 'object',
		},
		name: 'get_doc',
	},
	{
		annotations: { openWorldHint: false, readOnlyHint: true, title: 'List Dinoco docs pages' },
		description: 'Lists every documentation page (id, title, description, URL), grouped by product and area. Use it to discover what exists.',
		inputSchema: {
			properties: {
				group: { description: 'Only this group.', type: 'string' },
				locale: localeProperty,
				product: productProperty,
			},
			type: 'object',
		},
		name: 'list_docs',
	},
];

function text(value: string, structuredContent?: unknown) {
	return { content: [{ text: value, type: 'text' }], ...(structuredContent === undefined ? {} : { structuredContent }) };
}

function toolError(message: string) {
	return { content: [{ text: message, type: 'text' }], isError: true };
}

function localeArgument(args: Record<string, unknown>): DocsLocale {
	if (args.locale === undefined) {
		return 'en-us';
	}

	if (!isDocsLocale(args.locale)) {
		throw new RpcError(INVALID_PARAMS, 'locale must be "en-us" or "pt-br"');
	}

	return args.locale;
}

function stringArgument(args: Record<string, unknown>, key: string, required = false): string | undefined {
	const value = args[key];

	if (value === undefined || value === null) {
		if (required) {
			throw new RpcError(INVALID_PARAMS, `${key} is required`);
		}

		return undefined;
	}

	if (typeof value !== 'string' || (required && value.trim() === '')) {
		throw new RpcError(INVALID_PARAMS, `${key} must be a non-empty string`);
	}

	return value;
}

function productArgument(args: Record<string, unknown>): ProductId | undefined {
	if (args.product === undefined || args.product === null) {
		return undefined;
	}

	if (!isProductId(args.product)) {
		throw new RpcError(INVALID_PARAMS, `product must be one of: ${PRODUCT_IDS.join(', ')}`);
	}

	return args.product;
}

function summarize(entry: DocsPageEntry) {
	return { description: entry.description, group: entry.group, id: entry.id, product: entry.product, title: entry.title, url: entry.url };
}

function findPage(index: DocsPageEntry[], locale: DocsLocale, id: string): DocsPageEntry | undefined {
	const cleaned = id
		.trim()
		.replace(SITE_URL, '')
		.replace(/[?#].*$/, '')
		.replace(/^\/(en-us|pt-br)\/docs\//, '')
		.replace(/^\/+|\/+$/g, '');
	// Ids from before Rekka existed were `group/item` inside the ORM docs.
	const canonical = isProductId(cleaned.split('/')[0]) && cleaned.split('/').length >= 3 ? cleaned : `orm/${cleaned}`;

	return index.find(entry => entry.locale === locale && entry.id === canonical);
}

async function callTool(name: string, args: Record<string, unknown>) {
	const index = await loadDocsIndex();
	const locale = localeArgument(args);

	if (name === 'search_docs') {
		const query = stringArgument(args, 'query', true) as string;
		const limit = typeof args.limit === 'number' ? Math.min(Math.max(Math.trunc(args.limit), 1), 25) : 8;
		const hits = searchDocs(index, query, { group: stringArgument(args, 'group'), limit, locale, product: productArgument(args) });

		if (hits.length === 0) {
			return text(`No documentation pages matched "${query}". Try fewer or different keywords, or call list_docs.`, { results: [] });
		}

		const results = hits.map(hit => ({ ...summarize(hit.entry), snippet: hit.snippet }));
		const body = results.map((result, position) => `${position + 1}. ${result.title} (${result.product}/${result.group}) - id: ${result.id}\n   ${result.url}\n   ${result.snippet}`).join('\n');

		return text(body, { results });
	}

	if (name === 'get_doc') {
		const id = stringArgument(args, 'id', true) as string;
		const entry = findPage(index, locale, id);

		if (entry === undefined) {
			return toolError(`No page with id "${id}" for locale ${locale}. Use search_docs or list_docs to find valid ids.`);
		}

		const section = stringArgument(args, 'section');
		let markdown = entry.markdown;

		if (section !== undefined) {
			const found = extractSection(entry.markdown, section);

			if (found === undefined) {
				return toolError(`Page "${entry.id}" has no section "${section}". Available sections: ${entry.headings.join('; ')}`);
			}

			markdown = found;
		}

		return text(`Source: ${entry.url}\n\n${absolutizeLinks(markdown)}`, { ...summarize(entry), sections: entry.headings });
	}

	if (name === 'list_docs') {
		const group = stringArgument(args, 'group');
		const product = productArgument(args);
		const pages = index.filter(entry => entry.locale === locale && (product === undefined || entry.product === product) && (group === undefined || entry.group === group));
		const groups = [...new Set(pages.map(entry => `${entry.product}/${entry.group}`))];
		const body = groups
			.map(key => {
				const inGroup = pages.filter(entry => `${entry.product}/${entry.group}` === key);

				return `## ${inGroup[0].productName}: ${inGroup[0].groupName} (${key})\n${inGroup.map(entry => `- ${entry.id}: ${entry.title} - ${entry.description}`).join('\n')}`;
			})
			.join('\n\n');

		return text(body === '' ? 'No pages found.' : body, { pages: pages.map(summarize) });
	}

	throw new RpcError(INVALID_PARAMS, `Unknown tool: ${name}`);
}

async function listResources() {
	const index = await loadDocsIndex();

	return index.map(entry => ({
		description: entry.description,
		mimeType: 'text/markdown',
		name: `${entry.productName} / ${entry.groupName}: ${entry.title}`,
		title: entry.title,
		uri: `${RESOURCE_PREFIX}${entry.locale}/${entry.id}`,
	}));
}

async function readResource(uri: string) {
	const index = await loadDocsIndex();

	if (!uri.startsWith(RESOURCE_PREFIX)) {
		throw new RpcError(INVALID_PARAMS, `Unknown resource: ${uri}`);
	}

	const [locale, ...rest] = uri.slice(RESOURCE_PREFIX.length).split('/');
	const entry = isDocsLocale(locale) ? findPage(index, locale, rest.join('/')) : undefined;

	if (entry === undefined) {
		throw new RpcError(-32002, `Resource not found: ${uri}`);
	}

	return { contents: [{ mimeType: 'text/markdown', text: absolutizeLinks(entry.markdown), uri }] };
}

async function dispatch(request: JsonRpcRequest): Promise<unknown> {
	const params = request.params ?? {};

	switch (request.method) {
		case 'initialize': {
			const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : undefined;

			return {
				capabilities: { resources: { listChanged: false, subscribe: false }, tools: { listChanged: false } },
				instructions: INSTRUCTIONS,
				protocolVersion: requested !== undefined && SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
				serverInfo: SERVER_INFO,
			};
		}
		case 'ping':
			return {};
		case 'tools/list':
			return { tools: TOOLS };
		case 'tools/call': {
			const name = params.name;
			const args = params.arguments;

			if (typeof name !== 'string') {
				throw new RpcError(INVALID_PARAMS, 'name is required');
			}

			try {
				return await callTool(name, typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {});
			} catch (error) {
				// Bad arguments are reported to the model as a tool error so it can retry;
				// only unknown tools stay protocol errors.
				if (error instanceof RpcError && error.code === INVALID_PARAMS && !error.message.startsWith('Unknown tool')) {
					return toolError(error.message);
				}

				throw error;
			}
		}
		case 'resources/list':
			return { resources: await listResources() };
		case 'resources/templates/list':
			return {
				resourceTemplates: [
					{ description: 'A Dinoco ecosystem documentation page as Markdown.', mimeType: 'text/markdown', name: 'docs-page', uriTemplate: `${RESOURCE_PREFIX}{locale}/{product}/{group}/{item}` },
				],
			};
		case 'resources/read':
			if (typeof params.uri !== 'string') {
				throw new RpcError(INVALID_PARAMS, 'uri is required');
			}

			return readResource(params.uri);
		default:
			throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${request.method ?? '(none)'}`);
	}
}

async function handleOne(request: unknown): Promise<JsonRpcResponse | undefined> {
	if (typeof request !== 'object' || request === null || Array.isArray(request)) {
		return { error: { code: INVALID_REQUEST, message: 'Invalid Request' }, id: null, jsonrpc: '2.0' };
	}

	const message = request as JsonRpcRequest;
	const isNotification = message.id === undefined;

	if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
		return isNotification ? undefined : { error: { code: INVALID_REQUEST, message: 'Invalid Request' }, id: message.id ?? null, jsonrpc: '2.0' };
	}

	// Notifications (e.g. notifications/initialized) never get a response.
	if (isNotification || message.method.startsWith('notifications/')) {
		return undefined;
	}

	try {
		return { id: message.id ?? null, jsonrpc: '2.0', result: await dispatch(message) };
	} catch (error) {
		if (error instanceof RpcError) {
			return { error: { code: error.code, message: error.message }, id: message.id ?? null, jsonrpc: '2.0' };
		}

		return { error: { code: -32603, message: 'Internal error' }, id: message.id ?? null, jsonrpc: '2.0' };
	}
}

/** Handles a parsed JSON-RPC body. Returns `undefined` when there is nothing to send back (notifications only). */
export async function handleMcpBody(body: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | undefined> {
	if (Array.isArray(body)) {
		if (body.length === 0) {
			return { error: { code: INVALID_REQUEST, message: 'Invalid Request' }, id: null, jsonrpc: '2.0' };
		}

		const responses = (await Promise.all(body.map(handleOne))).filter((response): response is JsonRpcResponse => response !== undefined);

		return responses.length === 0 ? undefined : responses;
	}

	return handleOne(body);
}

export const MCP_SERVER_CARD = {
	description: 'Read-only MCP server for the Dinoco ecosystem documentation (Dinoco ORM and Rekka): search, read, and list pages in English and Portuguese.',
	endpoint: `${SITE_URL}/mcp`,
	name: SERVER_INFO.name,
	protocol: 'Streamable HTTP (stateless JSON)',
	tools: TOOLS.map(tool => ({ description: tool.description, name: tool.name })),
};
