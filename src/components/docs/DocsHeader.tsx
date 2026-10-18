'use client';

import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { FaGithub } from 'react-icons/fa';
import { FiMenu, FiSearch } from 'react-icons/fi';

import { groupIcon } from './group-icons';
import LocaleMenu from '../site/LocaleMenu';
import ThemeToggle from '../site/ThemeToggle';
import { ProductMark, Wordmark } from '../brand/Marks';
import { getMessages } from '../../lib/messages';

import type { DocsTheme } from '../../lib/docs-preferences';
import type { DocsView } from '../../lib/docs-view';

type DocsHeaderProps = {
	onMenu: () => void;
	onSearch: () => void;
	theme: DocsTheme;
	view: DocsView;
};

const DocsHeader = ({ onMenu, onSearch, theme, view }: DocsHeaderProps): React.JSX.Element => {
	const messages = getMessages(view.locale);
	const [shortcut, setShortcut] = useState('Ctrl K');

	useEffect(() => {
		if (/Mac|iPhone|iPad/.test(navigator.platform)) {
			setShortcut('⌘K');
		}
	}, []);

	return (
		<header className="sticky top-0 z-50 border-b border-line bg-bg/85 backdrop-blur-xl">
			<div className="flex h-14 items-center gap-3 px-3 sm:px-6">
				<button
					type="button"
					onClick={onMenu}
					aria-label={messages.nav.menu}
					className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg lg:hidden"
				>
					<FiMenu size={19} />
				</button>

				<Wordmark locale={view.locale} />

				<span className="hidden h-5 w-px bg-line sm:block" aria-hidden="true" />

				<nav aria-label={messages.docs.products} className="hidden items-center gap-1 sm:flex">
					{view.products.map(product => (
						<Link
							key={product.id}
							href={product.href}
							data-product={product.id}
							aria-current={product.active ? 'page' : undefined}
							className={clsx(
								'flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium transition-colors',
								product.active ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg',
							)}
						>
							<ProductMark product={product.id} size={18} className="rounded-[5px]" />
							{product.name}
							{product.active ? <span className="font-mono text-[0.7rem] text-accent">{product.version}</span> : null}
						</Link>
					))}
				</nav>

				<div className="ml-auto flex items-center gap-1">
					<button
						type="button"
						onClick={onSearch}
						className="hidden h-9 w-60 cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-surface px-3 text-sm text-fg-subtle transition-colors hover:border-line-strong hover:text-fg-muted md:flex"
					>
						<FiSearch size={15} />
						{messages.docs.search}
						<kbd className="ml-auto rounded-md border border-line px-1.5 py-px font-mono text-[0.68rem]">{shortcut}</kbd>
					</button>
					<button
						type="button"
						onClick={onSearch}
						aria-label={messages.docs.search}
						className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg md:hidden"
					>
						<FiSearch size={17} />
					</button>
					<a
						href={view.product.repository}
						target="_blank"
						rel="noreferrer"
						aria-label={`${view.product.name} on GitHub`}
						className="hidden h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg sm:flex"
					>
						<FaGithub size={17} />
					</a>
					<LocaleMenu locale={view.locale} hrefs={view.localeHrefs} />
					<ThemeToggle locale={view.locale} initialTheme={theme} />
				</div>
			</div>

			<nav className="code-scroll hidden h-11 items-stretch gap-6 overflow-x-auto px-6 md:flex" aria-label={view.product.name}>
				{view.groups.map(group => {
					const Icon = groupIcon(group.icon);

					return (
						<Link
							key={group.shortName}
							href={group.href}
							aria-current={group.active ? 'true' : undefined}
							className={clsx('relative flex shrink-0 items-center gap-2 text-sm font-medium transition-colors', group.active ? 'text-fg' : 'text-fg-subtle hover:text-fg')}
						>
							<Icon size={14} className={group.active ? 'text-accent' : undefined} />
							{group.name}
							{group.active ? <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" /> : null}
						</Link>
					);
				})}
			</nav>
		</header>
	);
};

export default DocsHeader;
