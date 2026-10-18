import React from 'react';
import Link from 'next/link';
import clsx from 'clsx';

import type { DocsLocale } from '../../lib/locales';
import type { ProductId } from '../../lib/products';

const MARK_SOURCES: Record<ProductId, string> = {
	orm: '/dinoco-mark.svg',
	rekka: '/rekka.svg',
};

/** Square product mark: the T-rex on cyan for Dinoco ORM, the job stack on ember for Rekka. */
export function ProductMark({ className, product, size = 28 }: { className?: string; product: ProductId; size?: number }): React.JSX.Element {
	return <img src={MARK_SOURCES[product]} width={size} height={size} alt="" aria-hidden="true" className={clsx('shrink-0 select-none', className)} />;
}

/** The ecosystem wordmark: T-rex silhouette plus "Dinoco" in the brand face. */
export function Wordmark({ className, locale }: { className?: string; locale: DocsLocale }): React.JSX.Element {
	return (
		<Link href={`/${locale}`} className={clsx('flex shrink-0 items-center gap-2.5 rounded-md', className)} aria-label="Dinoco">
			<img src="/logo-mark.png" width={40} height={23} alt="" aria-hidden="true" className="h-[23px] w-10 object-contain invert dark:invert-0" />
			<span className="font-brand text-[1.15rem] leading-none text-fg">Dinoco</span>
		</Link>
	);
}
