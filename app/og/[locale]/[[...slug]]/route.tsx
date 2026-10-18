import { ImageResponse } from 'next/og';

import { getLocalizedGroupName, parseDocsPath, resolveDocsPath } from '../../../../src/lib/navigation';
import { isProductId } from '../../../../src/lib/products';
import { resolveLocale } from '../../../../src/lib/locales';

const size = { width: 1200, height: 630 };

const ACCENTS = { orm: '#4fd8f7', rekka: '#ff7a4d' } as const;

// A route handler rather than a file-convention `opengraph-image`, which cannot live below a catch-all segment.
// URL shape: `/og/{locale}/{product}/{group}/{item}/{subItem?}`.
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string; slug?: string[] }> }): Promise<Response> {
	const { locale, slug = [] } = await params;
	const resolvedLocale = resolveLocale(locale);
	const [productId, ...rest] = slug;
	const product = isProductId(productId) ? productId : 'orm';
	const resolved = resolveDocsPath(product, resolvedLocale, parseDocsPath(rest));
	const title = resolved === undefined ? 'Dinoco' : resolved.parentItem === undefined ? resolved.item.name : `${resolved.parentItem.name}: ${resolved.item.name}`;
	const eyebrow = resolved === undefined ? 'Dinoco' : `${resolved.product.name}  /  ${getLocalizedGroupName(resolved.group, resolvedLocale)}`;
	const description = resolved?.item.description ?? '';
	const accent = ACCENTS[product];

	return new ImageResponse(
		(
			<div style={{ background: '#070a12', color: '#e8edf6', display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between', padding: 72, width: '100%' }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
					<div style={{ background: accent, borderRadius: 12, display: 'flex', height: 40, width: 40 }} />
					<div style={{ color: accent, display: 'flex', fontSize: 32, fontWeight: 700 }}>{eyebrow}</div>
				</div>
				<div style={{ display: 'flex', flexDirection: 'column' }}>
					<div style={{ display: 'flex', fontSize: title.length > 28 ? 72 : 92, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05 }}>{title}</div>
					<div style={{ color: '#a0abc0', display: 'flex', fontSize: 34, lineHeight: 1.3, marginTop: 28, maxWidth: 1000 }}>{description}</div>
				</div>
				<div style={{ color: '#6e7a90', display: 'flex', fontSize: 28 }}>dinoco.io</div>
			</div>
		),
		{ ...size },
	);
}
