'use client';

import React, { useEffect, useState } from 'react';
import { FiCheck, FiCopy } from 'react-icons/fi';

import { getMessages } from '../../lib/messages';
import { resolveLocale } from '../../lib/locales';

import type { DocsLocale } from '../../lib/locales';

type CodeBlockPreProps = React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode };

const LANGUAGE_LABELS: Record<string, string> = {
	bash: 'Terminal',
	sh: 'Terminal',
	shellscript: 'Terminal',
	dinoco: 'schema.dinoco',
	json: 'JSON',
	lua: 'Lua',
	rust: 'Rust',
	sql: 'SQL',
	text: 'Text',
	toml: 'TOML',
	txt: 'Text',
};

function getNodeText(node: React.ReactNode): string {
	if (typeof node === 'string' || typeof node === 'number') {
		return String(node);
	}

	if (Array.isArray(node)) {
		return node.map(getNodeText).join('');
	}

	if (React.isValidElement(node)) {
		return getNodeText((node.props as { children?: React.ReactNode }).children);
	}

	return '';
}

function languageOf(className?: string): string {
	const languageClass = className?.split(/\s+/).find(part => part.startsWith('language-'));

	return languageClass?.replace('language-', '') ?? 'txt';
}

const CodeBlockPre = ({ children }: CodeBlockPreProps): React.JSX.Element => {
	const [copied, setCopied] = useState(false);
	const [locale, setLocale] = useState<DocsLocale>('en-us');
	const codeElement = React.Children.toArray(children)[0] as React.ReactElement<{ children?: React.ReactNode; className?: string }> | undefined;
	const language = languageOf(codeElement?.props?.className);
	const code = getNodeText(codeElement?.props?.children).replace(/\n$/, '');
	const labels = getMessages(locale).code;

	useEffect(() => {
		setLocale(resolveLocale(document.documentElement.lang));
	}, []);

	useEffect(() => {
		if (!copied) {
			return;
		}

		const timeout = window.setTimeout(() => setCopied(false), 1800);

		return () => window.clearTimeout(timeout);
	}, [copied]);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	};

	return (
		<div className="group/code mb-6 overflow-hidden rounded-xl border border-line bg-code">
			<div className="flex h-10 items-center justify-between border-b border-line pl-4 pr-2">
				<span className="font-mono text-xs text-fg-subtle">{LANGUAGE_LABELS[language] ?? language}</span>

				<button
					type="button"
					onClick={handleCopy}
					aria-label={copied ? labels.copiedLabel : labels.copyLabel}
					className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs font-medium text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
				>
					{copied ? <FiCheck size={13} className="text-accent" /> : <FiCopy size={13} />}
					{copied ? labels.copied : labels.copy}
				</button>
			</div>

			<pre className="shiki code-scroll overflow-x-auto px-4 py-3.5 font-mono text-[0.84rem] leading-[1.7]">{children}</pre>
		</div>
	);
};

export default CodeBlockPre;
