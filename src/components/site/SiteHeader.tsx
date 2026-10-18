'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { FaGithub } from 'react-icons/fa';
import { FiMenu, FiX } from 'react-icons/fi';

import LocaleMenu from './LocaleMenu';
import ThemeToggle from './ThemeToggle';
import { ProductMark, Wordmark } from '../brand/Marks';
import { getMessages } from '../../lib/messages';
import { GITHUB_ORG_URL } from '../../lib/products';

import type { DocsTheme } from '../../lib/docs-preferences';
import type { DocsLocale } from '../../lib/locales';
import type { ProductId } from '../../lib/products';

export type SiteHeaderProps = {
	locale: DocsLocale;
	localeHrefs: Record<DocsLocale, string>;
	productLinks: { href: string; id: ProductId; name: string }[];
	startHref: string;
	theme: DocsTheme;
};

const SiteHeader = ({ locale, localeHrefs, productLinks, startHref, theme }: SiteHeaderProps): React.JSX.Element => {
	const messages = getMessages(locale);
	const [menuOpen, setMenuOpen] = useState(false);

	useEffect(() => {
		document.body.style.overflow = menuOpen ? 'hidden' : '';

		return () => {
			document.body.style.overflow = '';
		};
	}, [menuOpen]);

	const links = [
		...productLinks.map(product => ({ href: product.href, icon: <ProductMark product={product.id} size={18} className="rounded-[5px]" />, label: product.name })),
		{ href: `/${locale}/docs`, icon: null, label: messages.nav.docs },
	];

	return (
		<header className="sticky top-0 z-50 border-b border-line/70 bg-bg/80 backdrop-blur-xl">
			<div className="mx-auto flex h-16 max-w-[1200px] items-center gap-8 px-4 sm:px-6">
				<Wordmark locale={locale} />

				<nav className="hidden items-center gap-1 md:flex" aria-label="Main">
					{links.map(link => (
						<Link key={link.href} href={link.href} className="flex h-9 items-center gap-2 rounded-lg px-3 text-[0.925rem] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
							{link.icon}
							{link.label}
						</Link>
					))}
				</nav>

				<div className="ml-auto flex items-center gap-1">
					<a href={GITHUB_ORG_URL} target="_blank" rel="noreferrer" aria-label="GitHub" className="hidden h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg sm:flex">
						<FaGithub size={17} />
					</a>
					<LocaleMenu locale={locale} hrefs={localeHrefs} />
					<ThemeToggle locale={locale} initialTheme={theme} />
					<Link href={startHref} className="ml-2 hidden h-9 items-center rounded-lg bg-fg px-4 text-sm font-semibold text-bg transition-opacity hover:opacity-85 sm:flex">
						{messages.nav.getStarted}
					</Link>
					<button
						type="button"
						onClick={() => setMenuOpen(previous => !previous)}
						aria-expanded={menuOpen}
						aria-label={menuOpen ? messages.nav.closeMenu : messages.nav.menu}
						className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg md:hidden"
					>
						{menuOpen ? <FiX size={19} /> : <FiMenu size={19} />}
					</button>
				</div>
			</div>

			{menuOpen ? (
				<nav className="h-[calc(100dvh-4rem)] border-t border-line bg-bg px-4 pb-8 pt-4 md:hidden" aria-label="Main">
					<ul className="space-y-1">
						{links.map(link => (
							<li key={link.href}>
								<Link href={link.href} onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-3 text-base font-medium text-fg hover:bg-surface-2">
									{link.icon}
									{link.label}
								</Link>
							</li>
						))}
						<li>
							<a href={GITHUB_ORG_URL} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg px-3 py-3 text-base font-medium text-fg hover:bg-surface-2">
								<FaGithub size={18} />
								{messages.nav.github}
							</a>
						</li>
					</ul>
					<Link href={startHref} onClick={() => setMenuOpen(false)} className="mt-6 flex h-11 items-center justify-center rounded-lg bg-fg text-sm font-semibold text-bg">
						{messages.nav.getStarted}
					</Link>
				</nav>
			) : null}
		</header>
	);
};

export default SiteHeader;
