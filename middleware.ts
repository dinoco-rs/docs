import { NextResponse } from 'next/server';

import { DOCS_LOCALE_COOKIE } from './src/lib/docs-preferences';
import { DEFAULT_LOCALE, isDocsLocale } from './src/lib/locales';

import type { NextRequest } from 'next/server';
import type { DocsLocale } from './src/lib/locales';

const LEGACY_VERSION_SEGMENT = /^\/v\d[\w.-]*(\/.*)?$/;
const UNPREFIXED_DOCS = /^\/docs(\/.*)?$/;

function negotiateLocale(request: NextRequest): DocsLocale {
	const cookieLocale = request.cookies.get(DOCS_LOCALE_COOKIE)?.value;

	if (isDocsLocale(cookieLocale)) {
		return cookieLocale;
	}

	for (const tag of (request.headers.get('accept-language') ?? '').split(',')) {
		const languageCode = tag.trim().split(';')[0]?.toLowerCase();

		if (languageCode?.startsWith('pt')) {
			return 'pt-br';
		}

		if (languageCode?.startsWith('en')) {
			return 'en-us';
		}
	}

	return DEFAULT_LOCALE;
}

function redirectTo(request: NextRequest, pathname: string): NextResponse {
	const url = request.nextUrl.clone();
	url.pathname = pathname;

	return NextResponse.redirect(url);
}

export function middleware(request: NextRequest) {
	const { pathname } = request.nextUrl;

	if (pathname === '/') {
		return redirectTo(request, `/${negotiateLocale(request)}`);
	}

	// Links without a locale, such as the crates' `homepage` (`/docs/rekka`), go to the reader's language.
	const docsMatch = pathname.match(UNPREFIXED_DOCS);

	if (docsMatch) {
		return redirectTo(request, `/${negotiateLocale(request)}/docs${docsMatch[1] ?? ''}`);
	}

	// The pre-reformulation site served ORM pages unprefixed at `/{version}/{group}/{item}`
	// (e.g. `/v1.3.3/guide/introduction`); keep those links working.
	const legacyMatch = pathname.match(LEGACY_VERSION_SEGMENT);

	if (legacyMatch) {
		return redirectTo(request, `/${negotiateLocale(request)}/docs/orm${legacyMatch[1] ?? ''}`);
	}

	return NextResponse.next();
}

export const config = {
	// Static files and Next.js internals never need a redirect. Only real file extensions are skipped,
	// because legacy paths such as `/v1.3.3/...` contain dots too.
	matcher: ['/((?!_next/|.*\\.(?:png|svg|ico|jpg|webp|txt|xml|json|webmanifest)$).*)'],
};
