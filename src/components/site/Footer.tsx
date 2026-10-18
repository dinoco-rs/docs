import React from 'react';
import Link from 'next/link';

import { ProductMark, Wordmark } from '../brand/Marks';
import { getMessages } from '../../lib/messages';
import { buildDocsPath, getFirstDocsPath } from '../../lib/navigation';
import { GITHUB_ORG_URL, SUPPORT_URL, getProduct } from '../../lib/products';

import type { DocsLocale } from '../../lib/locales';

type FooterLink = { external?: boolean; href: string; label: string };

function FooterColumn({ heading, links }: { heading: React.ReactNode; links: FooterLink[] }) {
	return (
		<div>
			<p className="mb-4 flex items-center gap-2 text-sm font-semibold text-fg">{heading}</p>
			<ul className="space-y-2.5 text-sm">
				{links.map(link => (
					<li key={link.href}>
						{link.external ? (
							<a href={link.href} target="_blank" rel="noreferrer" className="text-fg-muted transition-colors hover:text-fg">
								{link.label}
							</a>
						) : (
							<Link href={link.href} className="text-fg-muted transition-colors hover:text-fg">
								{link.label}
							</Link>
						)}
					</li>
				))}
			</ul>
		</div>
	);
}

const Footer = ({ locale }: { locale: DocsLocale }): React.JSX.Element => {
	const { footer } = getMessages(locale);
	const orm = getProduct('orm');
	const rekka = getProduct('rekka');

	return (
		<footer className="border-t border-line bg-bg-subtle">
			<div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(4,1fr)]">
				<div className="max-w-xs">
					<Wordmark locale={locale} />
					<p className="mt-4 text-sm leading-6 text-fg-muted">{footer.tagline}</p>
				</div>

				<FooterColumn
					heading={
						<>
							<ProductMark product="orm" size={18} className="rounded-[5px]" />
							{orm.name}
						</>
					}
					links={[
						{ href: getFirstDocsPath(locale, 'orm'), label: footer.documentation },
						{ href: buildDocsPath(locale, 'orm', 'guide', 'quickstart'), label: footer.quickstart },
						{ href: buildDocsPath(locale, 'orm', 'tooling', 'cli'), label: footer.cli },
						{ external: true, href: 'https://marketplace.visualstudio.com/items?itemName=dinoco-rs.dinoco-vscode', label: footer.vscode },
					]}
				/>

				<FooterColumn
					heading={
						<>
							<ProductMark product="rekka" size={18} className="rounded-[5px]" />
							{rekka.name}
						</>
					}
					links={[
						{ href: getFirstDocsPath(locale, 'rekka'), label: footer.documentation },
						{ href: buildDocsPath(locale, 'rekka', 'guide', 'quickstart'), label: footer.quickstart },
						{ href: buildDocsPath(locale, 'rekka', 'queues', 'workers'), label: footer.workers },
						{ href: buildDocsPath(locale, 'rekka', 'cache', 'cache-types'), label: footer.cache },
					]}
				/>

				<FooterColumn
					heading={footer.community}
					links={[
						{ external: true, href: GITHUB_ORG_URL, label: footer.github },
						{ external: true, href: `${orm.repository}/issues/new`, label: `${footer.issues} (${orm.name})` },
						{ external: true, href: `${rekka.repository}/issues/new`, label: `${footer.issues} (${rekka.name})` },
						{ external: true, href: SUPPORT_URL, label: footer.support },
					]}
				/>

				<FooterColumn
					heading={footer.resources}
					links={[
						{ href: buildDocsPath(locale, 'orm', 'guide', 'ai'), label: footer.ai },
						{ external: true, href: '/mcp', label: footer.mcp },
						{ external: true, href: `/llms.txt${locale === 'en-us' ? '' : `?locale=${locale}`}`, label: footer.llms },
					]}
				/>
			</div>

			<div className="border-t border-line">
				<div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-4 py-6 text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
					<span>© {new Date().getFullYear()} Dinoco</span>
					<span>{footer.licenses}</span>
				</div>
			</div>
		</footer>
	);
};

export default Footer;
