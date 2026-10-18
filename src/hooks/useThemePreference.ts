'use client';

import { useEffect, useState } from 'react';

import { persistDocsTheme } from '../lib/docs-preferences';

import type { DocsTheme } from '../lib/docs-preferences';

export function useThemePreference(initialTheme: DocsTheme) {
	const [theme, setThemeState] = useState<DocsTheme>(initialTheme);

	useEffect(() => {
		// The inline script in the layout may have applied a stored preference before hydration.
		setThemeState(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
	}, []);

	const setTheme = (nextTheme: DocsTheme) => {
		setThemeState(nextTheme);
		persistDocsTheme(nextTheme);
	};

	return { setTheme, theme };
}
