import React from 'react';
import Link from 'next/link';
import { FaGithub } from 'react-icons/fa';
import { FiArrowRight, FiCheck, FiStar } from 'react-icons/fi';
import { SiBuymeacoffee } from 'react-icons/si';

import CopyCommand from './CopyCommand';
import HeroCode from './HeroCode';
import Footer from '../site/Footer';
import SiteHeader from '../site/SiteHeader';
import { ProductMark } from '../brand/Marks';
import { highlight } from '../../lib/highlight';
import { getMessages } from '../../lib/messages';
import { buildDocsPath, getFirstDocsPath } from '../../lib/navigation';
import { GITHUB_ORG_URL, PRODUCTS, SUPPORT_URL, getProduct, latestVersion } from '../../lib/products';
import { SUPPORTED_LOCALES } from '../../lib/locales';

import type { HeroFile } from './HeroCode';
import type { DocsTheme } from '../../lib/docs-preferences';
import type { DocsLocale } from '../../lib/locales';
import type { ProductId } from '../../lib/products';

const HERO_FILES: { code: string; lang: string; name: string; product: ProductId }[] = [
	{
		name: 'src/main.rs',
		lang: 'rust',
		product: 'orm',
		code: `
mod dinoco;
mod jobs;

use ::dinoco::insert_into;
use dinoco::{connect, User};
use jobs::{send_welcome, WelcomeEmail};
use rekka::Queues;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let client = connect().await?;

    let user = User::new("ana@example.com".to_string(), "Ana".to_string());
    insert_into::<User>().values(&user).execute(&client).await?;

    let queues = Queues::new(std::env::var("REDIS_URL")?)
        .data(client)
        .register::<WelcomeEmail>(|w| w.concurrency(8).build_fn(send_welcome))
        .start()
        .await?;

    queues.immediate(WelcomeEmail { task_id: format!("welcome:{}", user.id), user_id: user.id }).await?;
    Ok(queues.join().await?)
}`,
	},
	{
		name: 'src/jobs.rs',
		lang: 'rust',
		product: 'rekka',
		code: `
use ::dinoco::find_first;
use dinoco_engine::DinocoClient;
use rekka::{JobHandler, RekkaQueue, RekkaData};
use serde::{Deserialize, Serialize};

use crate::dinoco::User;

#[derive(Serialize, Deserialize, RekkaQueue)]
#[rekka(name = "welcome_emails")]
pub struct WelcomeEmail {
    pub task_id: String,
    pub user_id: String,
}

pub async fn send_welcome(
    job: WelcomeEmail,
    RekkaData(db): RekkaData<DinocoClient>,
    handler: JobHandler,
) -> anyhow::Result<()> {
    let user = find_first::<User>()
        .where_(|x| x.id.eq(job.user_id.as_str()))
        .execute(&db)
        .await?;

    // An Err is retried with backoff, up to 10 attempts by default.
    println!("attempt {}: welcome {:?}", handler.attempt(), user.map(|u| u.email));
    Ok(())
}`,
	},
	{
		name: 'schema.dinoco',
		lang: 'dinoco',
		product: 'orm',
		code: `
config {
    database     = "postgresql"
    connection   = "direct"
    database_url = env("DATABASE_URL")
}

model User {
    id         String   @id @default(uuid())
    email      String   @unique
    name       String
    created_at DateTime @default(now())
}`,
	},
];

const PRODUCT_SNIPPETS: Record<ProductId, string> = {
	orm: `
let users = find_many::<User>()
    .where_(|x| x.email.ends_with("@example.com"))
    .includes(|x| x.posts())
    .order_by(|x| x.created_at.desc())
    .take(20)
    .execute(&client)
    .await?;`,
	rekka: `
Queues::new(redis_url)
    .register::<Invoice>(|w| {
        w.concurrency(16)
            .concurrency_by_key(|job| job.customer_id)
            .timeout(Duration::from_secs(30))
            .build_fn(charge)
    })
    .start()
    .await?;`,
};

/** Renders `code` spans written with backticks in short UI strings. */
function Inline({ text }: { text: string }) {
	return (
		<>
			{text.split('`').map((part, index) =>
				index % 2 === 1 ? (
					<code key={index} className="whitespace-nowrap rounded-md border border-line bg-surface-2 px-1.5 py-px font-mono text-[0.86em] text-fg">
						{part}
					</code>
				) : (
					<React.Fragment key={index}>{part}</React.Fragment>
				),
			)}
		</>
	);
}

const sectionTitle = 'font-display text-[clamp(1.9rem,3.6vw,2.75rem)] font-bold leading-[1.08] tracking-[-0.035em] text-fg';

const HomePage = async ({ locale, theme }: { locale: DocsLocale; theme: DocsTheme }): Promise<React.JSX.Element> => {
	const m = getMessages(locale);
	const orm = getProduct('orm');
	const rekka = getProduct('rekka');
	const files: HeroFile[] = await Promise.all(
		HERO_FILES.map(async file => ({ html: await highlight(file.code, file.lang), lines: file.code.trim().split('\n').length, name: file.name, product: file.product })),
	);
	const snippets = Object.fromEntries(await Promise.all((Object.keys(PRODUCT_SNIPPETS) as ProductId[]).map(async id => [id, await highlight(PRODUCT_SNIPPETS[id], 'rust')]))) as Record<ProductId, string>;
	const productLinks = PRODUCTS.map(product => ({ href: getFirstDocsPath(locale, product.id), id: product.id, name: product.name }));
	const localeHrefs = Object.fromEntries(SUPPORTED_LOCALES.map(option => [option, `/${option}`])) as Record<DocsLocale, string>;
	const quickstart = (id: ProductId) => buildDocsPath(locale, id, 'guide', 'quickstart');

	const panels = [
		{ points: m.ecosystem.ormPoints, product: orm, status: m.ecosystem.stable },
		{ points: m.ecosystem.rekkaPoints, product: rekka, status: m.ecosystem.new },
	];

	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader locale={locale} localeHrefs={localeHrefs} productLinks={productLinks} startHref={quickstart('orm')} theme={theme} />

			<main className="flex-1">
				<section className="relative overflow-hidden pb-20 sm:pb-28">
					<div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />

					<div className="relative mx-auto flex max-w-[1200px] flex-col items-center px-4 pt-14 text-center sm:px-6 sm:pt-24">
						<Link
							href={getFirstDocsPath(locale, 'rekka')}
							data-product="rekka"
							className="rise-in group inline-flex max-w-full items-center gap-2.5 rounded-full border border-line bg-surface/70 py-1 pl-1 pr-3.5 text-[0.82rem] text-fg-muted backdrop-blur transition-colors hover:border-accent/40 hover:text-fg"
						>
							<ProductMark product="rekka" size={22} className="rounded-full" />
							<span className="truncate">{m.announcement.text}</span>
							<span className="hidden shrink-0 items-center gap-1 font-medium text-accent sm:inline-flex">
								{m.announcement.cta}
								<FiArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
							</span>
						</Link>

						<h1
							className="rise-in mt-8 max-w-[19ch] font-display text-[clamp(2.6rem,6.4vw,4.75rem)] font-bold leading-[1.03] tracking-[-0.038em] text-fg"
							style={{ '--rise-delay': '80ms' } as React.CSSProperties}
						>
							{m.hero.title}
						</h1>

						<p className="rise-in mt-6 max-w-[62ch] text-[1.075rem] leading-[1.7] text-fg-muted sm:text-lg" style={{ '--rise-delay': '160ms' } as React.CSSProperties}>
							{m.hero.subtitle}
						</p>

						<div className="rise-in mt-9 flex flex-wrap items-center justify-center gap-3" style={{ '--rise-delay': '240ms' } as React.CSSProperties}>
							<Link href={quickstart('orm')} className="flex h-11 items-center gap-2 rounded-lg bg-fg px-5 text-[0.925rem] font-semibold text-bg transition-opacity hover:opacity-85">
								<ProductMark product="orm" size={20} className="rounded-[5px]" />
								{m.hero.primary}
							</Link>
							<Link
								href={getFirstDocsPath(locale, 'rekka')}
								className="flex h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface/60 px-5 text-[0.925rem] font-semibold text-fg backdrop-blur transition-colors hover:border-rekka/60"
							>
								<ProductMark product="rekka" size={20} className="rounded-[5px]" />
								{m.hero.secondary}
							</Link>
						</div>

						<div className="rise-in mt-6" style={{ '--rise-delay': '300ms' } as React.CSSProperties}>
							<CopyCommand command="cargo add dinoco rekka" copyLabel={m.hero.copyCommand} copiedLabel={m.hero.copiedCommand} />
						</div>
					</div>

					<div className="rise-in relative mx-auto mt-16 max-w-[980px] px-4 text-left sm:px-6" style={{ '--rise-delay': '420ms' } as React.CSSProperties}>
						<div className="meeting-glow pointer-events-none absolute -inset-x-10 -bottom-10 top-16 opacity-60 dark:opacity-90" aria-hidden="true" />
						<div className="relative">
							<HeroCode files={files} label={m.hero.codeLabel} />
						</div>
					</div>
				</section>

				<section id="products" className="border-t border-line bg-bg-subtle py-20 sm:py-28">
					<div className="mx-auto max-w-[1200px] px-4 sm:px-6">
						<div className="max-w-2xl">
							<h2 className={sectionTitle}>{m.ecosystem.title}</h2>
							<p className="mt-4 text-[1.05rem] leading-[1.7] text-fg-muted">{m.ecosystem.subtitle}</p>
						</div>

						<div className="mt-12 grid gap-6 lg:grid-cols-2">
							{panels.map(({ points, product, status }) => (
								<article key={product.id} data-product={product.id} className="relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface p-6 sm:p-8">
									<div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" aria-hidden="true" />

									<div className="flex flex-wrap items-center gap-3">
										<ProductMark product={product.id} size={44} className="rounded-xl" />
										<div className="mr-auto">
											<h3 className="font-display text-2xl font-bold tracking-[-0.02em] text-fg">{product.name}</h3>
											<p className="font-mono text-xs text-fg-subtle">crate {product.crate}</p>
										</div>
										<span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-xs text-fg-muted">{latestVersion(product).name}</span>
										<span className="rounded-full bg-accent/12 px-2.5 py-0.5 text-xs font-semibold text-accent">{status}</span>
									</div>

									<p className="mt-6 text-[1.05rem] leading-[1.65] text-fg">{product.tagline[locale]}</p>

									<ul className="mt-5 space-y-2.5">
										{points.map(point => (
											<li key={point} className="flex gap-3 text-[0.95rem] leading-[1.6] text-fg-muted">
												<FiCheck size={16} className="mt-[3px] shrink-0 text-accent" />
												<span>
													<Inline text={point} />
												</span>
											</li>
										))}
									</ul>

									<div className="mt-auto pt-7">
										<div className="code-scroll overflow-x-auto rounded-xl border border-line bg-code px-4 py-3.5 font-mono text-[0.78rem] leading-[1.7]" dangerouslySetInnerHTML={{ __html: snippets[product.id] }} />
										<div className="mt-7 flex flex-wrap items-center gap-2 pt-1">
											<Link href={getFirstDocsPath(locale, product.id)} className="flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90">
												{m.ecosystem.docs}
												<FiArrowRight size={15} />
											</Link>
											<Link href={quickstart(product.id)} className="flex h-10 items-center rounded-lg border border-line px-4 text-sm font-semibold text-fg transition-colors hover:border-line-strong">
												{m.ecosystem.quickstart}
											</Link>
											<a href={product.repository} target="_blank" rel="noreferrer" className="ml-auto flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-fg-muted transition-colors hover:text-fg">
												<FaGithub size={16} />
												<span className="hidden sm:inline">{m.ecosystem.source}</span>
											</a>
										</div>
									</div>
								</article>
							))}
						</div>
					</div>
				</section>

				<section className="border-t border-line py-20 sm:py-28">
					<div className="mx-auto grid max-w-[1200px] gap-12 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
						<div>
							<h2 className={sectionTitle}>{m.migration.title}</h2>
							<p className="mt-4 max-w-md text-[1.05rem] leading-[1.7] text-fg-muted">{m.migration.subtitle}</p>
						</div>

						<div className="overflow-hidden rounded-2xl border border-line bg-surface">
							<div className="hidden grid-cols-[1fr_auto_1.3fr] gap-4 border-b border-line bg-surface-2 px-5 py-3 text-xs font-semibold text-fg-subtle sm:grid">
								<span>{m.migration.from}</span>
								<span className="w-4" />
								<span>{m.migration.to}</span>
							</div>
							<ul className="divide-y divide-line">
								{m.migration.rows.map(row => (
									<li key={row.from}>
										<Link
											href={`/${locale}/docs/${row.product}/${row.href}`}
											data-product={row.product}
											className="group grid gap-1.5 px-5 py-4 transition-colors hover:bg-surface-2 sm:grid-cols-[1fr_auto_1.3fr] sm:items-center sm:gap-4"
										>
											<span className="text-[0.95rem] text-fg-subtle">{row.from}</span>
											<FiArrowRight size={15} className="hidden text-fg-subtle transition-colors group-hover:text-accent sm:block" />
											<span className="flex items-center gap-2.5 text-[0.95rem] font-medium text-fg">
												<ProductMark product={row.product as ProductId} size={18} className="rounded-[5px]" />
												<span>
													<Inline text={row.to} />
												</span>
											</span>
										</Link>
									</li>
								))}
							</ul>
						</div>
					</div>
				</section>

				<section className="border-t border-line bg-bg-subtle py-20 sm:py-28">
					<div className="mx-auto max-w-[1200px] px-4 sm:px-6">
						<h2 className={sectionTitle}>{m.principles.title}</h2>
						<div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
							{m.principles.items.map(item => (
								<div key={item.title} className="bg-surface p-7 sm:p-9">
									<h3 className="font-display text-xl font-semibold tracking-[-0.015em] text-fg">{item.title}</h3>
									<p className="mt-3 max-w-[52ch] text-[0.975rem] leading-[1.7] text-fg-muted">{item.body}</p>
								</div>
							))}
						</div>
					</div>
				</section>

				<section className="border-t border-line py-20 sm:py-24">
					<div className="mx-auto max-w-[1200px] px-4 sm:px-6">
						<div className="flex flex-col gap-8 rounded-2xl border border-line bg-surface p-7 sm:p-10 lg:flex-row lg:items-center lg:justify-between">
							<div className="flex gap-5">
								<span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#ffdd00] text-[#0d0c22]" aria-hidden="true">
									<SiBuymeacoffee size={22} />
								</span>
								<div>
									<h2 className="font-display text-2xl font-bold tracking-[-0.02em] text-fg sm:text-[1.75rem]">{m.support.title}</h2>
									<p className="mt-3 max-w-[60ch] text-[1rem] leading-[1.7] text-fg-muted">{m.support.body}</p>
								</div>
							</div>
							<div className="flex flex-wrap gap-3 lg:shrink-0">
								<a
									href={SUPPORT_URL}
									target="_blank"
									rel="noreferrer"
									className="flex h-11 items-center gap-2.5 rounded-lg bg-[#ffdd00] px-5 text-[0.925rem] font-semibold text-[#0d0c22] transition-opacity hover:opacity-90"
								>
									<SiBuymeacoffee size={17} />
									{m.support.cta}
								</a>
								<a
									href={GITHUB_ORG_URL}
									target="_blank"
									rel="noreferrer"
									className="flex h-11 items-center gap-2 rounded-lg border border-line-strong px-5 text-[0.925rem] font-semibold text-fg transition-colors hover:border-fg-subtle"
								>
									<FiStar size={16} />
									{m.support.star}
								</a>
							</div>
						</div>
					</div>
				</section>

				<section className="relative overflow-hidden border-t border-line py-24 sm:py-32">
					<div className="hero-grid pointer-events-none absolute inset-0 rotate-180" aria-hidden="true" />
					<div className="relative mx-auto flex max-w-[1200px] flex-col items-center px-4 text-center sm:px-6">
						<h2 className={`${sectionTitle} max-w-[20ch]`}>{m.closing.title}</h2>
						<p className="mt-4 max-w-[52ch] text-[1.05rem] leading-[1.7] text-fg-muted">{m.closing.subtitle}</p>
						<div className="mt-9 flex flex-wrap justify-center gap-3">
							{PRODUCTS.map(product => (
								<Link
									key={product.id}
									href={quickstart(product.id)}
									data-product={product.id}
									className="flex h-11 items-center gap-2.5 rounded-lg border border-line-strong bg-surface px-5 text-[0.925rem] font-semibold text-fg transition-colors hover:border-accent/60"
								>
									<ProductMark product={product.id} size={20} className="rounded-[5px]" />
									{product.id === 'orm' ? m.closing.orm : m.closing.rekka}
								</Link>
							))}
						</div>
					</div>
				</section>
			</main>

			<Footer locale={locale} />
		</div>
	);
};

export default HomePage;
