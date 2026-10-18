'use client';

import React, { useRef, useState } from 'react';
import clsx from 'clsx';

import type { ProductId } from '../../lib/products';

export type HeroFile = {
	html: string;
	lines: number;
	name: string;
	product: ProductId;
};

/** The hero's example project: one tab per file, the schema and the code that uses both crates. */
const HeroCode = ({ files, label }: { files: HeroFile[]; label: string }): React.JSX.Element => {
	const [active, setActive] = useState(0);
	const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const tallest = Math.max(...files.map(file => file.lines));

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
			return;
		}

		const next = (active + (event.key === 'ArrowRight' ? 1 : files.length - 1)) % files.length;
		setActive(next);
		tabRefs.current[next]?.focus();
	};

	return (
		<div className="meeting-border rounded-2xl p-px shadow-2xl shadow-black/30">
			<div className="overflow-hidden rounded-[15px] bg-code">
				<div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="code-scroll flex overflow-x-auto border-b border-line bg-surface/60">
					{files.map((file, index) => (
						<button
							key={file.name}
							ref={element => {
								tabRefs.current[index] = element;
							}}
							type="button"
							role="tab"
							id={`hero-tab-${index}`}
							aria-selected={index === active}
							aria-controls={`hero-panel-${index}`}
							tabIndex={index === active ? 0 : -1}
							onClick={() => setActive(index)}
							className={clsx(
								'relative flex h-11 shrink-0 cursor-pointer items-center gap-2 border-r border-line px-4 font-mono text-[0.8rem] transition-colors',
								index === active ? 'bg-code text-fg' : 'text-fg-subtle hover:text-fg-muted',
							)}
						>
							<span className={clsx('h-1.5 w-1.5 rounded-full', file.product === 'orm' ? 'bg-dinoco' : 'bg-rekka')} />
							{file.name}
							{index === active ? <span className={clsx('absolute inset-x-0 -bottom-px h-px', file.product === 'orm' ? 'bg-dinoco' : 'bg-rekka')} /> : null}
						</button>
					))}
				</div>

				{files.map((file, index) => (
					<div
						key={file.name}
						role="tabpanel"
						id={`hero-panel-${index}`}
						aria-labelledby={`hero-tab-${index}`}
						hidden={index !== active}
						className="code-scroll overflow-x-auto px-5 py-5 font-mono text-[0.82rem] leading-[1.7] sm:px-6 sm:text-[0.85rem]"
						style={{ minHeight: `calc(${tallest} * 1.7em + 2.5rem)` }}
						dangerouslySetInnerHTML={{ __html: file.html }}
					/>
				))}
			</div>
		</div>
	);
};

export default HeroCode;
