'use client';

import React, { useEffect, useState } from 'react';
import { FiChevronRight } from 'react-icons/fi';

import CopyPageButton from './CopyPageButton';
import DocsHeader from './DocsHeader';
import DocsPager from './DocsPager';
import DocsSidebar from './DocsSidebar';
import DocsToc from './DocsToc';
import SearchDialog from './SearchDialog';
import { getMessages } from '../../lib/messages';

import type { DocsTheme } from '../../lib/docs-preferences';
import type { DocsView } from '../../lib/docs-view';

type DocsShellProps = {
	children: React.ReactNode;
	footer: React.ReactNode;
	theme: DocsTheme;
	view: DocsView;
};

function isTyping(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

const DocsShell = ({ children, footer, theme, view }: DocsShellProps): React.JSX.Element => {
	const messages = getMessages(view.locale);
	const [menuOpen, setMenuOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);

	useEffect(() => {
		setMenuOpen(false);
	}, [view.page.path]);

	useEffect(() => {
		document.body.style.overflow = menuOpen ? 'hidden' : '';

		return () => {
			document.body.style.overflow = '';
		};
	}, [menuOpen]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !isTyping(event.target))) {
				event.preventDefault();
				setSearchOpen(true);
			}
		};

		window.addEventListener('keydown', onKeyDown);

		return () => window.removeEventListener('keydown', onKeyDown);
	}, []);

	return (
		<div id="top" data-product={view.product.id} className="flex min-h-screen flex-col">
			<DocsHeader view={view} theme={theme} onMenu={() => setMenuOpen(true)} onSearch={() => setSearchOpen(true)} />

			<div className="mx-auto flex w-full max-w-[1480px] flex-1 items-start">
				<DocsSidebar view={view} open={menuOpen} onClose={() => setMenuOpen(false)} />

				<main className="min-w-0 flex-1 px-4 pb-24 pt-8 sm:px-8 lg:px-12">
					<div className="mx-auto max-w-[780px]">
						<div className="mb-7 flex flex-wrap items-center justify-between gap-3">
							<nav aria-label={messages.docs.breadcrumb}>
								<ol className="flex flex-wrap items-center gap-1 text-[0.84rem] text-fg-subtle">
									<li className="font-medium text-accent">{view.product.name}</li>
									<li aria-hidden="true">
										<FiChevronRight size={13} />
									</li>
									<li>{view.page.groupName}</li>
									{view.page.parentTitle ? (
										<>
											<li aria-hidden="true">
												<FiChevronRight size={13} />
											</li>
											<li>{view.page.parentTitle}</li>
										</>
									) : null}
								</ol>
							</nav>
							<CopyPageButton markdown={view.page.markdown} label={messages.docs.copyPage} copiedLabel={messages.docs.copiedPage} />
						</div>

						<article key={view.page.path}>{children}</article>

						<DocsPager previous={view.previous} next={view.next} labels={messages.docs} />
					</div>
				</main>

				<DocsToc key={view.page.path} pageKey={view.page.path} items={view.page.inPage} label={messages.docs.onThisPage} backToTop={messages.docs.backToTop} />
			</div>

			{footer}

			<SearchDialog locale={view.locale} open={searchOpen} onClose={() => setSearchOpen(false)} />
		</div>
	);
};

export default DocsShell;
