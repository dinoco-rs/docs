import { ImageResponse } from 'next/og';

import { getMessages } from '../../src/lib/messages';
import { resolveLocale } from '../../src/lib/locales';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage({ params }: { params: Promise<{ locale: string }> }) {
	const { hero } = getMessages(resolveLocale((await params).locale));

	return new ImageResponse(
		(
			<div style={{ background: '#070a12', display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between', padding: 80, width: '100%' }}>
				<div style={{ color: '#e8edf6', display: 'flex', fontSize: 44, fontWeight: 800 }}>Dinoco</div>
				<div style={{ color: '#e8edf6', display: 'flex', fontSize: 76, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, maxWidth: 980 }}>{hero.title}</div>
				<div style={{ display: 'flex', gap: 28, fontSize: 30 }}>
					<div style={{ color: '#4fd8f7', display: 'flex' }}>Dinoco ORM</div>
					<div style={{ color: '#ff7a4d', display: 'flex' }}>Rekka</div>
				</div>
			</div>
		),
		{ ...size },
	);
}
