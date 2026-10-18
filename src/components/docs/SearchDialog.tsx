'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { FiCornerDownLeft, FiHash, FiSearch } from 'react-icons/fi';

import { ProductMark } from '../brand/Marks';
import { getMessages } from '../../lib/messages';

import type { DocsLocale } from '../../lib/locales';
import type { SearchEntry, SearchResult } from '../../lib/search-index';

type Engine = { index: SearchEntry[]; search: (index: SearchEntry[], query: string) => SearchResult[] };

type SearchDialogProps = {
	locale: DocsLocale;
	onClose: () => void;
	open: boolean;
};

const SearchDialog = ({ locale, onClose, open }: SearchDialogProps): React.JSX.Element | null => {
	const router = useRouter();
	const messages = getMessages(locale).docs;
	const [engine, setEngine] = useState<Engine>();
	const [query, setQuery] = useState('');
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLUListElement>(null);

	useEffect(() => {
		if (!open || engine !== undefined) {
			return;
		}

		let cancelled = false;

		import('../../lib/search-index').then(module => {
			if (!cancelled) {
				setEngine({ index: module.buildSearchIndex(locale), search: module.searchIndex });
			}
		});

		return () => {
			cancelled = true;
		};
	}, [engine, locale, open]);

	useEffect(() => {
		if (!open) {
			return;
		}

		setQuery('');
		setActive(0);
		document.body.style.overflow = 'hidden';
		window.setTimeout(() => inputRef.current?.focus(), 0);

		return () => {
			document.body.style.overflow = '';
		};
	}, [open]);

	const results = useMemo(() => (engine === undefined ? [] : engine.search(engine.index, query)), [engine, query]);

	useEffect(() => {
		setActive(0);
	}, [query]);

	useEffect(() => {
		listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
	}, [active]);

	if (!open) {
		return null;
	}

	const go = (result: SearchResult | undefined) => {
		if (result === undefined) {
			return;
		}

		onClose();
		router.push(result.href);
	};

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			setActive(current => Math.min(current + 1, Math.max(results.length - 1, 0)));
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			setActive(current => Math.max(current - 1, 0));
		} else if (event.key === 'Enter') {
			event.preventDefault();
			go(results[active]);
		}
	};

	return (
		<div className="fixed inset-0 z-[300] flex items-start justify-center bg-black/45 px-4 pt-[10vh] backdrop-blur-sm" onMouseDown={onClose}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={messages.search}
				onMouseDown={event => event.stopPropagation()}
				onKeyDown={onKeyDown}
				className="flex max-h-[72vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl shadow-black/40"
			>
				<div className="flex items-center gap-3 border-b border-line px-4">
					<FiSearch size={17} className="shrink-0 text-fg-subtle" />
					<input
						ref={inputRef}
						value={query}
						onChange={event => setQuery(event.target.value)}
						placeholder={messages.searchPlaceholder}
						role="combobox"
						aria-expanded={results.length > 0}
						aria-controls="docs-search-results"
						aria-activedescendant={results.length > 0 ? `docs-search-${active}` : undefined}
						aria-autocomplete="list"
						className="h-14 min-w-0 flex-1 bg-transparent text-[0.975rem] text-fg outline-none placeholder:text-fg-subtle"
					/>
					<button type="button" onClick={onClose} className="cursor-pointer rounded-md border border-line px-1.5 py-0.5 font-mono text-[0.7rem] text-fg-subtle hover:text-fg" aria-label={messages.searchClose}>
						Esc
					</button>
				</div>

				{query.trim() === '' ? (
					<p className="px-5 py-10 text-center text-sm text-fg-subtle">{messages.searchHint}</p>
				) : results.length === 0 ? (
					<p className="px-5 py-10 text-center text-sm text-fg-subtle">{engine === undefined ? '…' : messages.searchEmpty}</p>
				) : (
					<ul ref={listRef} id="docs-search-results" role="listbox" className="thin-scroll overflow-y-auto p-2">
						{results.map((result, index) => (
							<li
								key={result.href}
								id={`docs-search-${index}`}
								data-index={index}
								role="option"
								aria-selected={index === active}
								data-product={result.product}
								onMouseMove={() => setActive(index)}
								onClick={() => go(result)}
								className={clsx('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5', index === active ? 'bg-surface-2' : '')}
							>
								{result.heading === undefined ? (
									<ProductMark product={result.product} size={26} className="rounded-md" />
								) : (
									<span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border border-line text-fg-subtle">
										<FiHash size={13} />
									</span>
								)}
								<span className="min-w-0 flex-1">
									<span className="block truncate text-[0.925rem] font-medium text-fg">{result.heading ?? result.title}</span>
									<span className="block truncate text-xs text-fg-subtle">{result.location}</span>
								</span>
								{index === active ? <FiCornerDownLeft size={14} className="shrink-0 text-accent" /> : null}
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
};

export default SearchDialog;
