import React from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { FiArrowLeft, FiArrowRight } from 'react-icons/fi';

import type { PagerLink } from '../../lib/docs-view';

function PagerCard({ direction, label, link }: { direction: 'previous' | 'next'; label: string; link: PagerLink }) {
	const isNext = direction === 'next';

	return (
		<Link
			href={link.href}
			className={clsx(
				'group flex flex-1 flex-col gap-1 rounded-xl border border-line bg-surface px-5 py-4 transition-colors hover:border-accent/50',
				isNext ? 'items-end text-right' : 'items-start text-left',
			)}
		>
			<span className="flex items-center gap-1.5 text-xs text-fg-subtle">
				{isNext ? null : <FiArrowLeft size={12} className="transition-transform group-hover:-translate-x-0.5" />}
				{label}
				{isNext ? <FiArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" /> : null}
			</span>
			<span className="font-medium text-fg group-hover:text-accent">{link.title}</span>
		</Link>
	);
}

const DocsPager = ({ labels, next, previous }: { labels: { next: string; pagination: string; previous: string }; next?: PagerLink; previous?: PagerLink }): React.JSX.Element | null => {
	if (previous === undefined && next === undefined) {
		return null;
	}

	return (
		<nav aria-label={labels.pagination} className="mt-16 grid gap-3 border-t border-line pt-8 sm:grid-cols-2">
			{previous ? <PagerCard direction="previous" label={labels.previous} link={previous} /> : <span className="hidden sm:block" />}
			{next ? <PagerCard direction="next" label={labels.next} link={next} /> : null}
		</nav>
	);
};

export default DocsPager;
