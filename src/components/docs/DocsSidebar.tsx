'use client';

import React, { useState } from 'react';
import clsx from 'clsx';
import Link from 'next/link';
import { FiChevronDown, FiX } from 'react-icons/fi';

import { groupIcon } from './group-icons';
import { ProductMark, Wordmark } from '../brand/Marks';
import { getMessages } from '../../lib/messages';

import type { DocsView, NavLink } from '../../lib/docs-view';

type DocsSidebarProps = {
	onClose: () => void;
	open: boolean;
	view: DocsView;
};

function linkClass(active: boolean): string {
	return clsx(
		'block rounded-lg px-3 py-[0.4rem] text-[0.9rem] leading-snug transition-colors',
		active ? 'bg-accent/10 font-medium text-accent' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
	);
}

function NavEntry({ item, labels, onClose }: { item: NavLink; labels: { close: string; open: string }; onClose: () => void }) {
	const [expanded, setExpanded] = useState(item.active);

	if (item.children === undefined) {
		return (
			<li>
				<Link href={item.href} onClick={onClose} aria-current={item.active ? 'page' : undefined} className={linkClass(item.active)}>
					{item.title}
				</Link>
			</li>
		);
	}

	return (
		<li>
			<div className="flex items-center">
				<Link href={item.href} onClick={onClose} className={clsx(linkClass(false), 'flex-1', item.active && 'font-medium text-fg')}>
					{item.title}
				</Link>
				<button
					type="button"
					onClick={() => setExpanded(previous => !previous)}
					aria-expanded={expanded}
					aria-label={expanded ? labels.close : labels.open}
					className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-fg-subtle hover:bg-surface-2 hover:text-fg"
				>
					<FiChevronDown size={14} className={clsx('transition-transform', expanded && 'rotate-180')} />
				</button>
			</div>
			{expanded ? (
				<ul className="ml-3 mt-0.5 space-y-0.5 border-l border-line pl-2">
					{item.children.map(child => (
						<li key={child.href}>
							<Link href={child.href} onClick={onClose} aria-current={child.active ? 'page' : undefined} className={linkClass(child.active)}>
								{child.title}
							</Link>
						</li>
					))}
				</ul>
			) : null}
		</li>
	);
}

const DocsSidebar = ({ onClose, open, view }: DocsSidebarProps): React.JSX.Element => {
	const messages = getMessages(view.locale);
	const labels = { close: messages.docs.closeSubItems, open: messages.docs.openSubItems };

	return (
		<>
			{open ? <div className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm lg:hidden" onClick={onClose} aria-hidden="true" /> : null}

			<aside
				className={clsx(
					'thin-scroll fixed inset-y-0 left-0 z-[210] w-[300px] max-w-[85vw] overflow-y-auto border-r border-line bg-bg px-4 pb-10 transition-transform duration-300',
					'lg:sticky lg:top-[100px] lg:z-0 lg:h-[calc(100vh-100px)] lg:w-[280px] lg:max-w-none lg:translate-x-0 lg:bg-transparent lg:px-5 lg:pt-6',
					open ? 'translate-x-0' : '-translate-x-full',
				)}
			>
				<div className="lg:hidden">
					<div className="flex h-14 items-center justify-between">
						<Wordmark locale={view.locale} />
						<button type="button" onClick={onClose} aria-label={messages.nav.closeMenu} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2">
							<FiX size={19} />
						</button>
					</div>

					<div className="mt-3 grid grid-cols-2 gap-2">
						{view.products.map(product => (
							<Link
								key={product.id}
								href={product.href}
								onClick={onClose}
								className={clsx('flex items-center gap-2 whitespace-nowrap rounded-lg border px-2 py-2 text-[0.82rem] font-medium', product.active ? 'border-accent/50 bg-accent/10 text-fg' : 'border-line text-fg-muted')}
							>
								<ProductMark product={product.id} size={18} className="rounded-[5px]" />
								{product.name}
							</Link>
						))}
					</div>

					<ul className="mt-4 space-y-0.5 border-b border-line pb-4">
						{view.groups.map(group => {
							const Icon = groupIcon(group.icon);

							return (
								<li key={group.shortName}>
									<Link href={group.href} onClick={onClose} className={clsx(linkClass(group.active), 'flex items-center gap-2.5')}>
										<Icon size={15} />
										{group.name}
									</Link>
								</li>
							);
						})}
					</ul>
				</div>

				<nav className="space-y-7 pt-5 lg:pt-0" aria-label={view.page.groupName}>
					{view.sections.map(section => (
						<div key={section.title}>
							<p className="mb-2 px-3 text-[0.8rem] font-semibold text-fg">{section.title}</p>
							<ul className="space-y-0.5">
								{section.items.map(item => (
									<NavEntry key={item.href} item={item} labels={labels} onClose={onClose} />
								))}
							</ul>
						</div>
					))}
				</nav>
			</aside>
		</>
	);
};

export default DocsSidebar;
