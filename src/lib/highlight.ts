import { createHighlighter } from 'shiki';

import dinocoGrammar from './dinoco.tmLanguage.json';

import type { BundledLanguage, Highlighter, LanguageRegistration } from 'shiki';

export const SHIKI_THEMES = { dark: 'vitesse-dark', light: 'vitesse-light' } as const;

export const SHIKI_LANGS: (BundledLanguage | LanguageRegistration)[] = [
	'bash',
	'json',
	'rust',
	'sql',
	'toml',
	'lua',
	{ ...(dinocoGrammar as unknown as LanguageRegistration), displayName: 'Dinoco', name: 'dinoco' },
];

let highlighter: Promise<Highlighter> | undefined;

/** Highlights a snippet outside Markdown (home page examples) with the same themes the docs use. */
export async function highlight(code: string, lang: string): Promise<string> {
	highlighter ??= createHighlighter({ langs: SHIKI_LANGS, themes: Object.values(SHIKI_THEMES) });

	return (await highlighter).codeToHtml(code.trim(), { defaultColor: false, lang, themes: SHIKI_THEMES });
}
