'use client';

import React, { useEffect, useState } from 'react';
import { FiSearch } from 'react-icons/fi';

import SearchDialog from './SearchDialog';

import type { DocsLocale } from '../../lib/locales';

/** The large search field on the docs landing page; opens the same dialog as the docs header. */
const LandingSearch = ({ label, locale }: { label: string; locale: DocsLocale }): React.JSX.Element => {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				setOpen(true);
			}
		};

		window.addEventListener('keydown', onKeyDown);

		return () => window.removeEventListener('keydown', onKeyDown);
	}, []);

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="flex h-12 w-full max-w-[520px] cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface px-4 text-left text-[0.95rem] text-fg-subtle shadow-sm transition-colors hover:border-line-strong hover:text-fg-muted"
			>
				<FiSearch size={17} />
				{label}
			</button>
			<SearchDialog locale={locale} open={open} onClose={() => setOpen(false)} />
		</>
	);
};

export default LandingSearch;
