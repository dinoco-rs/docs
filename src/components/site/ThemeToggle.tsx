'use client';

import React from 'react';
import { FiMoon, FiSun } from 'react-icons/fi';

import { useThemePreference } from '../../hooks/useThemePreference';
import { getMessages } from '../../lib/messages';

import type { DocsTheme } from '../../lib/docs-preferences';
import type { DocsLocale } from '../../lib/locales';

const ThemeToggle = ({ initialTheme, locale }: { initialTheme: DocsTheme; locale: DocsLocale }): React.JSX.Element => {
	const { setTheme, theme } = useThemePreference(initialTheme);
	const messages = getMessages(locale);
	const label = theme === 'dark' ? messages.themeLight : messages.themeDark;

	return (
		<button
			type="button"
			onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
			aria-label={label}
			title={label}
			className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
		>
			{theme === 'dark' ? <FiSun size={16} /> : <FiMoon size={16} />}
		</button>
	);
};

export default ThemeToggle;
