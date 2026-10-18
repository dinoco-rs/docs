'use client';

import React, { useEffect, useState } from 'react';
import { FiCheck, FiCopy } from 'react-icons/fi';

/** Copies the page's Markdown, ready to paste into an AI assistant or an issue. */
const CopyPageButton = ({ copiedLabel, label, markdown }: { copiedLabel: string; label: string; markdown: string }): React.JSX.Element => {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) {
			return;
		}

		const timeout = window.setTimeout(() => setCopied(false), 1800);

		return () => window.clearTimeout(timeout);
	}, [copied]);

	return (
		<button
			type="button"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(markdown);
					setCopied(true);
				} catch {
					setCopied(false);
				}
			}}
			className="flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[0.8rem] font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
		>
			{copied ? <FiCheck size={13} className="text-accent" /> : <FiCopy size={13} />}
			{copied ? copiedLabel : label}
		</button>
	);
};

export default CopyPageButton;
