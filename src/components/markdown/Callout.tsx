import React from 'react';
import { FiAlertOctagon, FiAlertTriangle, FiInfo, FiZap } from 'react-icons/fi';

import { getMessages } from '../../lib/messages';

import type { DocsLocale } from '../../lib/locales';
import type { CalloutType } from '../../lib/remark-callouts';

type CalloutProps = {
	children?: React.ReactNode;
	locale: DocsLocale;
	type: CalloutType;
};

const icons: Record<CalloutType, React.ComponentType<{ size?: number; className?: string }>> = {
	danger: FiAlertOctagon,
	note: FiInfo,
	tip: FiZap,
	warning: FiAlertTriangle,
};

// Notes take the product colour; the other kinds keep their conventional meaning in both products.
const tones: Record<CalloutType, { box: string; label: string }> = {
	danger: { box: 'border-red-500/25 bg-red-500/[0.06]', label: 'text-red-600 dark:text-red-400' },
	note: { box: 'border-accent/25 bg-accent/[0.06]', label: 'text-accent' },
	tip: { box: 'border-emerald-500/25 bg-emerald-500/[0.06]', label: 'text-emerald-700 dark:text-emerald-400' },
	warning: { box: 'border-amber-500/30 bg-amber-500/[0.07]', label: 'text-amber-700 dark:text-amber-400' },
};

const Callout = ({ children, locale, type }: CalloutProps): React.JSX.Element => {
	const Icon = icons[type];
	const tone = tones[type];

	return (
		<div className={`mb-6 rounded-xl border px-5 py-4 [&_p]:mb-0 [&_p]:text-[0.96rem] [&_p+p]:mt-2 [&_pre]:mt-3 ${tone.box}`}>
			<div className={`mb-1.5 flex items-center gap-2 text-sm font-semibold ${tone.label}`}>
				<Icon size={15} />
				{getMessages(locale).callouts[type]}
			</div>
			{children}
		</div>
	);
};

export default Callout;
