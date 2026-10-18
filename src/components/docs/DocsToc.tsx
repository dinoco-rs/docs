'use client';

import React, { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { FiArrowUp } from 'react-icons/fi';

import { toAnchorId } from '../../lib/to-anchor-id';

import type { DocsInPageItemData } from '../../jsons/types';

type TocEntry = { depth: number; id: string; title: string };

function flatten(items: DocsInPageItemData[], depth = 0): TocEntry[] {
	return items.flatMap(item => {
		const title = typeof item === 'string' ? item : item.title;
		const children = typeof item === 'string' ? [] : (item.items ?? []);

		return [{ depth, id: toAnchorId(title), title }, ...flatten(children, depth + 1)];
	});
}

type DocsTocProps = {
	backToTop: string;
	items: DocsInPageItemData[];
	label: string;
	pageKey: string;
};

/** "On this page": the page's headings, with the one being read highlighted. */
const DocsToc = ({ backToTop, items, label, pageKey }: DocsTocProps): React.JSX.Element | null => {
	const entries = useMemo(() => flatten(items), [items]);
	const [activeId, setActiveId] = useState<string>();

	useEffect(() => {
		setActiveId(undefined);

		if (entries.length === 0) {
			return;
		}

		let frame = 0;

		const sync = () => {
			frame = 0;
			const headings = entries.map(entry => document.getElementById(entry.id)).filter((element): element is HTMLElement => element !== null);

			if (headings.length === 0) {
				return;
			}

			const atBottom = Math.ceil(window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 24;
			const passed = headings.filter(element => element.getBoundingClientRect().top <= 140);
			const current = atBottom ? headings[headings.length - 1] : (passed[passed.length - 1] ?? headings[0]);

			setActiveId(current.id);
		};

		const schedule = () => {
			if (frame === 0) {
				frame = window.requestAnimationFrame(sync);
			}
		};

		sync();
		window.addEventListener('scroll', schedule, { passive: true });
		window.addEventListener('resize', schedule);

		return () => {
			if (frame !== 0) {
				window.cancelAnimationFrame(frame);
			}
			window.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', schedule);
		};
	}, [entries, pageKey]);

	if (entries.length === 0) {
		return null;
	}

	return (
		<aside className="sticky top-[100px] hidden h-[calc(100vh-100px)] w-[240px] shrink-0 py-8 pr-6 xl:block">
			<div className="thin-scroll flex max-h-full flex-col overflow-y-auto">
				<p className="mb-3 text-[0.8rem] font-semibold text-fg">{label}</p>
				<nav aria-label={label}>
					<ul className="border-l border-line">
						{entries.map(entry => (
							<li key={`${entry.depth}-${entry.id}`}>
								<a
									href={`#${entry.id}`}
									onClick={() => setActiveId(entry.id)}
									aria-current={entry.id === activeId ? 'location' : undefined}
									className={clsx(
										'-ml-px block border-l py-1 text-[0.84rem] leading-snug transition-colors',
										entry.id === activeId ? 'border-accent font-medium text-fg' : 'border-transparent text-fg-subtle hover:text-fg-muted',
									)}
									style={{ paddingLeft: `${0.85 + entry.depth * 0.75}rem` }}
								>
									{entry.title}
								</a>
							</li>
						))}
					</ul>
				</nav>
				<a href="#top" className="mt-6 inline-flex items-center gap-1.5 text-[0.8rem] text-fg-subtle transition-colors hover:text-fg">
					<FiArrowUp size={13} />
					{backToTop}
				</a>
			</div>
		</aside>
	);
};

export default DocsToc;
