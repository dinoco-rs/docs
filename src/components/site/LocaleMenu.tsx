'use client';

import React, { startTransition, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { FiCheck, FiGlobe } from 'react-icons/fi';

import { getMessages } from '../../lib/messages';
import { persistDocsLocale } from '../../lib/docs-preferences';
import { SUPPORTED_LOCALES } from '../../lib/locales';

import type { DocsLocale } from '../../lib/locales';

type LocaleMenuProps = {
	/** Where each language version of the current page lives. */
	hrefs: Record<DocsLocale, string>;
	locale: DocsLocale;
};

const SHORT_LABELS: Record<DocsLocale, string> = { 'en-us': 'EN', 'pt-br': 'PT' };

const LocaleMenu = ({ hrefs, locale }: LocaleMenuProps): React.JSX.Element => {
	const router = useRouter();
	const messages = getMessages(locale);
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) {
			return;
		}

		const close = (event: MouseEvent | KeyboardEvent) => {
			if (event instanceof KeyboardEvent ? event.key === 'Escape' : !rootRef.current?.contains(event.target as Node)) {
				setOpen(false);
			}
		};

		document.addEventListener('mousedown', close);
		document.addEventListener('keydown', close);

		return () => {
			document.removeEventListener('mousedown', close);
			document.removeEventListener('keydown', close);
		};
	}, [open]);

	const choose = (next: DocsLocale) => {
		setOpen(false);

		if (next === locale) {
			return;
		}

		startTransition(() => {
			persistDocsLocale(next);
			router.push(hrefs[next]);
		});
	};

	return (
		<div className="relative" ref={rootRef}>
			<button
				type="button"
				onClick={() => setOpen(previous => !previous)}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label={messages.languageLabel}
				className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
			>
				<FiGlobe size={15} />
				{SHORT_LABELS[locale]}
			</button>

			{open ? (
				<div role="menu" className="absolute right-0 z-50 mt-2 w-40 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-2xl shadow-black/20">
					{SUPPORTED_LOCALES.map(option => (
						<button
							key={option}
							type="button"
							role="menuitemradio"
							aria-checked={option === locale}
							onClick={() => choose(option)}
							className={clsx(
								'flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2',
								option === locale ? 'font-semibold text-fg' : 'text-fg-muted',
							)}
						>
							{messages.locales[option]}
							{option === locale ? <FiCheck size={14} className="text-accent" /> : null}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
};

export default LocaleMenu;
