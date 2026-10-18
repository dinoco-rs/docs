import { FiBox, FiCompass, FiDatabase, FiLayers, FiSliders, FiTerminal, FiZap } from 'react-icons/fi';

import type { IconType } from 'react-icons';

/** Icons named by the `icon` field of each navigation group. */
export const GROUP_ICONS: Record<string, IconType> = {
	box: FiBox,
	database: FiDatabase,
	layers: FiLayers,
	rocket: FiCompass,
	settings: FiSliders,
	terminal: FiTerminal,
	zap: FiZap,
};

export function groupIcon(name: string): IconType {
	return GROUP_ICONS[name] ?? FiCompass;
}
