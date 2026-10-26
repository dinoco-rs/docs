import ormV2_2_3 from '../jsons/orm/v2.2.3';
import rekkaV0_0_5 from '../jsons/rekka/v0.0.5';

import type { DocsVersion } from '../jsons/types';
import type { DocsLocale } from './locales';

export type ProductId = 'orm' | 'rekka';

export type Product = {
	/** Colour family used by the product's marks, links and active states. */
	accent: 'dinoco' | 'rekka';
	crate: string;
	id: ProductId;
	keywords: Record<DocsLocale, string[]>;
	license: { name: string; url: string };
	name: string;
	repository: string;
	/** One paragraph used by `llms.txt`, the MCP server and the docs landing page. */
	summary: Record<DocsLocale, string>;
	tagline: Record<DocsLocale, string>;
	/** Newest first. Only the first version is published today. */
	versions: DocsVersion[];
};

export const GITHUB_ORG_URL = 'https://github.com/dinoco-rs';
export const SUPPORT_URL = 'https://buymeacoffee.com/theuszastro';

export const PRODUCTS: Product[] = [
	{
		accent: 'dinoco',
		crate: 'dinoco',
		id: 'orm',
		keywords: {
			'en-us': ['Dinoco', 'Rust ORM', 'Rust database', 'type-safe queries', 'schema migrations', 'PostgreSQL', 'MySQL', 'SQLite'],
			'pt-br': ['Dinoco', 'ORM Rust', 'banco de dados Rust', 'queries type-safe', 'migrations de schema', 'PostgreSQL', 'MySQL', 'SQLite'],
		},
		license: { name: 'Apache-2.0', url: 'https://github.com/dinoco-rs/dinoco/blob/master/LICENSE' },
		name: 'Dinoco ORM',
		repository: 'https://github.com/dinoco-rs/dinoco',
		summary: {
			'en-us':
				'Dinoco ORM is a schema-driven ORM for Rust. You describe your data in `schema.dinoco`; Dinoco generates typed models, builds migrations (automatic or hand-written in Rust), and provides type-safe queries for PostgreSQL, MySQL, and SQLite.',
			'pt-br':
				'O Dinoco ORM é um ORM para Rust guiado por schema. Você descreve seus dados em `schema.dinoco`; o Dinoco gera models tipados, cria migrations (automáticas ou escritas à mão em Rust) e oferece queries type-safe para PostgreSQL, MySQL e SQLite.',
		},
		tagline: {
			'en-us': 'One schema, typed models, and real SQL migrations for PostgreSQL, MySQL, and SQLite.',
			'pt-br': 'Um schema, models tipados e migrations em SQL de verdade para PostgreSQL, MySQL e SQLite.',
		},
		versions: [ormV2_2_3],
	},
	{
		accent: 'rekka',
		crate: 'rekka',
		id: 'rekka',
		keywords: {
			'en-us': ['Rekka', 'Rust job queue', 'Redis queue', 'background jobs', 'Rust cache', 'Redis cache', 'recurring jobs'],
			'pt-br': ['Rekka', 'fila de jobs Rust', 'fila Redis', 'jobs em background', 'cache Rust', 'cache Redis', 'jobs recorrentes'],
		},
		license: { name: 'Apache-2.0', url: 'https://github.com/dinoco-rs/rekka/blob/master/LICENSE' },
		name: 'Rekka',
		repository: 'https://github.com/dinoco-rs/rekka',
		summary: {
			'en-us':
				'Rekka is a Rust library for Redis-backed job queues and a typed cache. Jobs are serde structs identified by a `task_id`, so enqueueing is an upsert. Workers retry, schedule, and limit concurrency per key across every instance, recurring workers run on one instance per cycle, and the cache stores typed values with a TTL.',
			'pt-br':
				'O Rekka é uma biblioteca Rust de filas de jobs sobre Redis e cache tipado. Jobs são structs serde identificadas por um `task_id`, então enfileirar é um upsert. Os workers fazem retry, agendamento e limitam a concorrência por key em todas as instâncias, workers recorrentes rodam em uma instância por ciclo e o cache guarda valores tipados com TTL.',
		},
		tagline: {
			'en-us': 'Job queues, recurring workers, and a typed cache on top of the Redis you already run.',
			'pt-br': 'Filas de jobs, workers recorrentes e cache tipado sobre o Redis que você já usa.',
		},
		versions: [rekkaV0_0_5],
	},
];

export const PRODUCT_IDS: ProductId[] = PRODUCTS.map(product => product.id);

export function isProductId(value: unknown): value is ProductId {
	return typeof value === 'string' && PRODUCT_IDS.includes(value as ProductId);
}

export function getProduct(id: ProductId): Product {
	return PRODUCTS.find(product => product.id === id) as Product;
}

export function latestVersion(product: Product): DocsVersion {
	return product.versions[0];
}
