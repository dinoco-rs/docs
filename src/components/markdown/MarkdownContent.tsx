import rehypeShiki from '@shikijs/rehype';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import Link from 'next/link';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import Callout from './Callout';
import CodeBlockPre from './CodeBlockPre';
import { SHIKI_LANGS, SHIKI_THEMES } from '../../lib/highlight';
import { CALLOUT_TYPES, remarkCallouts } from '../../lib/remark-callouts';
import { toAnchorId } from '../../lib/to-anchor-id';

import type { RehypeShikiOptions } from '@shikijs/rehype';
import type { Root } from 'hast';
import type { DocsLocale } from '../../lib/locales';
import type { CalloutType } from '../../lib/remark-callouts';

type ComponentProps = React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode };

function classes(...values: Array<string | false | undefined>): string {
	return values.filter(Boolean).join(' ');
}

function isCalloutType(value: unknown): value is CalloutType {
	return typeof value === 'string' && (CALLOUT_TYPES as readonly string[]).includes(value);
}

function Heading({ as: Tag, children, className, id, ...props }: ComponentProps & { as: 'h2' | 'h3' }) {
	return (
		<Tag {...props} id={id} className={classes('group relative scroll-mt-28', className)}>
			{children}
			{id ? (
				<a href={`#${id}`} aria-hidden="true" tabIndex={-1} className="ml-2 font-normal text-fg-subtle no-underline opacity-0 transition-opacity group-hover:opacity-100">
					#
				</a>
			) : null}
		</Tag>
	);
}

function createMarkdownComponents(locale: DocsLocale) {
	return {
		h1: ({ children, className, ...props }: ComponentProps) => (
			<h1 {...props} className={classes('mb-5 font-display text-[2.35rem] font-bold leading-[1.1] tracking-[-0.03em] text-fg sm:text-[2.75rem]', className)}>
				{children}
			</h1>
		),
		h2: (props: ComponentProps) => <Heading as="h2" {...props} className={classes('mb-4 mt-14 font-display text-[1.6rem] font-semibold leading-tight tracking-[-0.02em] text-fg', props.className)} />,
		h3: (props: ComponentProps) => <Heading as="h3" {...props} className={classes('mb-3 mt-9 font-display text-[1.2rem] font-semibold tracking-[-0.01em] text-fg', props.className)} />,
		h4: ({ children, className, ...props }: ComponentProps) => (
			<h4 {...props} className={classes('mb-2 mt-7 font-semibold text-fg', className)}>
				{children}
			</h4>
		),
		p: ({ children, className, ...props }: ComponentProps) => (
			<p {...props} className={classes('mb-5 text-[1.0125rem] leading-[1.75] text-fg-muted [&_strong]:font-semibold [&_strong]:text-fg', className)}>
				{children}
			</p>
		),
		ul: ({ children, className, ...props }: ComponentProps) => (
			<ul {...props} className={classes('mb-5 list-disc space-y-2 pl-5 text-[1.0125rem] leading-[1.7] text-fg-muted marker:text-fg-subtle [&_strong]:font-semibold [&_strong]:text-fg', className)}>
				{children}
			</ul>
		),
		ol: ({ children, className, ...props }: ComponentProps) => (
			<ol {...props} className={classes('mb-5 list-decimal space-y-2 pl-5 text-[1.0125rem] leading-[1.7] text-fg-muted marker:text-fg-subtle [&_strong]:font-semibold [&_strong]:text-fg', className)}>
				{children}
			</ol>
		),
		li: ({ children, className, ...props }: ComponentProps) => (
			<li {...props} className={classes('pl-1 [&>p]:mb-2', className)}>
				{children}
			</li>
		),
		hr: () => <hr className="my-10 border-line" />,
		pre: CodeBlockPre,
		code: ({ children, className, ...props }: ComponentProps) =>
			className === undefined ? (
				<code {...props} className="rounded-md border border-line bg-surface-2 px-[0.35em] py-[0.1em] font-mono text-[0.85em] text-fg">
					{children}
				</code>
			) : (
				<code {...props} className={className}>
					{children}
				</code>
			),
		blockquote: ({ children, className, ...props }: ComponentProps & { 'data-callout'?: string }) => {
			const calloutType = props['data-callout'];

			if (isCalloutType(calloutType)) {
				return (
					<Callout type={calloutType} locale={locale}>
						{children}
					</Callout>
				);
			}

			return (
				<blockquote {...props} className={classes('mb-5 border-l-2 border-line-strong pl-5 text-fg-muted [&>p]:mb-2', className)}>
					{children}
				</blockquote>
			);
		},
		table: ({ children, className, ...props }: ComponentProps) => (
			<div className="thin-scroll mb-6 overflow-x-auto rounded-xl border border-line">
				<table {...props} className={classes('w-full border-collapse text-left text-[0.925rem] text-fg-muted', className)}>
					{children}
				</table>
			</div>
		),
		thead: ({ children, className, ...props }: ComponentProps) => (
			<thead {...props} className={classes('bg-surface-2', className)}>
				{children}
			</thead>
		),
		tr: ({ children, className, ...props }: ComponentProps) => (
			<tr {...props} className={classes('border-t border-line first:border-t-0', className)}>
				{children}
			</tr>
		),
		th: ({ children, className, ...props }: ComponentProps) => (
			<th {...props} className={classes('px-4 py-2.5 font-semibold text-fg', className)}>
				{children}
			</th>
		),
		td: ({ children, className, ...props }: ComponentProps) => (
			<td {...props} className={classes('px-4 py-2.5 align-top', className)}>
				{children}
			</td>
		),
		a: ({ children, className, href = '', ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
			const style = classes('font-medium text-accent underline decoration-accent/35 underline-offset-[3px] transition-colors hover:decoration-accent', className);

			if (href.startsWith('/')) {
				return (
					<Link href={href} className={style}>
						{children}
					</Link>
				);
			}

			const external = /^https?:\/\//.test(href);

			return (
				<a {...props} href={href} className={style} {...(external ? { rel: 'noreferrer', target: '_blank' } : {})}>
					{children}
				</a>
			);
		},
	};
}

type HastNode = {
	children?: unknown[];
	properties?: Record<string, unknown>;
	tagName?: string;
	type: string;
	value?: string;
};

function asHastNode(value: unknown): HastNode | undefined {
	return typeof value === 'object' && value !== null && 'type' in value ? (value as HastNode) : undefined;
}

function extractText(children: unknown[]): string {
	return children
		.map(child => {
			const node = asHastNode(child);

			if (node === undefined) {
				return '';
			}

			return node.type === 'text' ? (node.value ?? '') : extractText(node.children ?? []);
		})
		.join('')
		.trim();
}

function addHeadingAnchors(value: unknown): void {
	const node = asHastNode(value);

	if (node === undefined) {
		return;
	}

	if (node.type === 'element' && ['h1', 'h2', 'h3'].includes(node.tagName ?? '')) {
		const text = extractText(node.children ?? []);

		if (text.length > 0) {
			node.properties = { ...node.properties, id: toAnchorId(text) };
		}
	}

	for (const child of node.children ?? []) {
		addHeadingAnchors(child);
	}
}

const shikiOptions: RehypeShikiOptions = {
	addLanguageClass: true,
	defaultColor: false,
	defaultLanguage: 'txt',
	fallbackLanguage: 'txt',
	langs: SHIKI_LANGS,
	themes: SHIKI_THEMES,
};

const processor = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkCallouts)
	.use(remarkRehype)
	.use(rehypeShiki, shikiOptions);

type MarkdownContentProps = {
	locale: DocsLocale;
	source: string;
};

const MarkdownContent = async ({ locale, source }: MarkdownContentProps): Promise<React.JSX.Element> => {
	const hastTree = (await processor.run(processor.parse(source), { value: source })) as Root;

	addHeadingAnchors(hastTree);

	const content = toJsxRuntime(hastTree, {
		Fragment: jsxRuntime.Fragment,
		components: createMarkdownComponents(locale),
		jsx: jsxRuntime.jsx,
		jsxs: jsxRuntime.jsxs,
	});

	return <div className="w-full">{content}</div>;
};

export default MarkdownContent;
