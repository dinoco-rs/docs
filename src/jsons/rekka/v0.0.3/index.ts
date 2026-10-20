import { defineVersion } from '../../define-version';
import enUs from './en-us.json';
import ptBr from './pt-br.json';

export default defineVersion(
	'v0.0.3',
	{
		'en-us': 'Redis-backed job queues and a typed cache for Rust, safe to scale horizontally.',
		'pt-br': 'Filas de jobs sobre Redis e cache tipado para Rust, seguros para escalar horizontalmente.',
	},
	{ 'en-us': enUs, 'pt-br': ptBr },
);
