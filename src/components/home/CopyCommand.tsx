'use client';

import React, { useEffect, useState } from 'react';
import { FiCheck, FiCopy } from 'react-icons/fi';

type CopyCommandProps = {
	command: string;
	copiedLabel: string;
	copyLabel: string;
};

const CopyCommand = ({ command, copiedLabel, copyLabel }: CopyCommandProps): React.JSX.Element => {
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
					await navigator.clipboard.writeText(command);
					setCopied(true);
				} catch {
					setCopied(false);
				}
			}}
			aria-label={copied ? copiedLabel : copyLabel}
			className="group inline-flex h-10 cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface/70 pl-4 pr-3 font-mono text-[0.85rem] text-fg-muted backdrop-blur transition-colors hover:border-line-strong hover:text-fg"
		>
			<span className="select-none text-fg-subtle">$</span>
			<span>{command}</span>
			{copied ? <FiCheck size={14} className="text-dinoco" /> : <FiCopy size={14} className="text-fg-subtle group-hover:text-fg-muted" />}
		</button>
	);
};

export default CopyCommand;
