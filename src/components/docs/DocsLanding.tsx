import React from 'react';
import Link from 'next/link';
import { FiArrowRight } from 'react-icons/fi';

import LandingSearch from './LandingSearch';
import { groupIcon } from './group-icons';
import Footer from '../site/Footer';
import SiteHeader from '../site/SiteHeader';
import { ProductMark } from '../brand/Marks';
import { getMessages } from '../../lib/messages';
import { buildDocsPath, getFirstDocsPath, getGroups, getLocalizedGroupName, getLocalizedSections } from '../../lib/navigation';
import { PRODUCTS, latestVersion } from '../../lib/products';
import { SITE_URL } from '../../lib/site';
import { SUPPORTED_LOCALES } from '../../lib/locales';

import type { DocsTheme } from '../../lib/docs-preferences';
import type { DocsLocale } from '../../lib/locales';

const DocsLanding = ({ locale, theme }: { locale: DocsLocale; theme: DocsTheme }): React.JSX.Element => {
	const m = getMessages(locale);
	const productLinks = PRODUCTS.map(product => ({ href: getFirstDocsPath(locale, product.id), id: product.id, name: product.name }));
	const localeHrefs = Object.fromEntries(SUPPORTED_LOCALES.map(option => [option, `/${option}/docs`])) as Record<DocsLocale, string>;

	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader locale={locale} localeHrefs={localeHrefs} productLinks={productLinks} startHref={buildDocsPath(locale, 'orm', 'guide', 'quickstart')} theme={theme} />

			<main className="flex-1">
				<section className="relative overflow-hidden border-b border-line">
					<div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
					<div className="relative mx-auto max-w-[1200px] px-4 pb-14 pt-16 sm:px-6 sm:pt-20">
						<h1 className="font-display text-[clamp(2.4rem,5vw,3.6rem)] font-bold leading-[1.05] tracking-[-0.04em] text-fg">{m.docsHome.title}</h1>
						<p className="mb-8 mt-4 max-w-[56ch] text-[1.075rem] leading-[1.7] text-fg-muted">{m.docsHome.subtitle}</p>
						<LandingSearch locale={locale} label={m.docs.searchPlaceholder} />
					</div>
				</section>

				<section className="mx-auto grid max-w-[1200px] gap-6 px-4 py-14 sm:px-6 lg:grid-cols-2">
					{PRODUCTS.map(product => {
						const groups = getGroups(product.id, locale);
						const guide = groups.find(group => group.shortName === 'guide');
						const starters = guide === undefined ? [] : getLocalizedSections(guide, locale)[0].items.slice(0, 4);

						return (
							<article key={product.id} data-product={product.id} className="flex flex-col rounded-2xl border border-line bg-surface p-6 sm:p-8">
								<div className="flex items-center gap-3">
									<ProductMark product={product.id} size={44} className="rounded-xl" />
									<div>
										<h2 className="font-display text-2xl font-bold tracking-[-0.02em] text-fg">{product.name}</h2>
										<p className="font-mono text-xs text-fg-subtle">
											{product.crate} {latestVersion(product).name}
										</p>
									</div>
								</div>
								<p className="mt-5 text-[0.975rem] leading-[1.7] text-fg-muted">{product.tagline[locale]}</p>

								<p className="mb-2 mt-7 text-[0.8rem] font-semibold text-fg">{m.docsHome.startHere}</p>
								<ul className="grid gap-1 sm:grid-cols-2">
									{starters.map(item => (
										<li key={item.shortName}>
											<Link href={buildDocsPath(locale, product.id, 'guide', item.shortName)} className="group flex items-start justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2">
												<span>
													<span className="block text-[0.925rem] font-medium text-fg group-hover:text-accent">{item.name}</span>
													<span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-fg-subtle">{item.description}</span>
												</span>
											</Link>
										</li>
									))}
								</ul>

								<p className="mb-2 mt-6 text-[0.8rem] font-semibold text-fg">{m.docsHome.allPages}</p>
								<div className="flex flex-wrap gap-2">
									{groups.map(group => {
										const Icon = groupIcon(group.icon);
										const first = getLocalizedSections(group, locale)[0]?.items[0];

										return first === undefined ? null : (
											<Link
												key={group.shortName}
												href={buildDocsPath(locale, product.id, group.shortName, first.shortName)}
												className="flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm text-fg-muted transition-colors hover:border-accent/50 hover:text-fg"
											>
												<Icon size={14} className="text-accent" />
												{getLocalizedGroupName(group, locale)}
											</Link>
										);
									})}
								</div>
							</article>
						);
					})}
				</section>

				<section className="mx-auto max-w-[1200px] px-4 pb-20 sm:px-6">
					<div className="flex flex-col gap-5 rounded-2xl border border-line bg-bg-subtle p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
						<div>
							<h2 className="font-display text-xl font-semibold tracking-[-0.015em] text-fg">{m.docsHome.aiTitle}</h2>
							<p className="mt-2 text-[0.95rem] text-fg-muted">{m.docsHome.aiBody}</p>
							<code className="mt-3 inline-block rounded-md border border-line bg-surface px-2 py-1 font-mono text-[0.8rem] text-fg">{SITE_URL}/mcp</code>
						</div>
						<Link href={buildDocsPath(locale, 'orm', 'guide', 'ai')} className="flex h-10 shrink-0 items-center gap-2 self-start rounded-lg bg-fg px-4 text-sm font-semibold text-bg transition-opacity hover:opacity-85 sm:self-auto">
							{m.docsHome.aiCta}
							<FiArrowRight size={15} />
						</Link>
					</div>
				</section>
			</main>

			<Footer locale={locale} />
		</div>
	);
};

export default DocsLanding;
