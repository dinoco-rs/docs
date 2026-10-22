import { defineVersion } from '../../define-version';
import enUs from './en-us.json';
import ptBr from './pt-br.json';

export default defineVersion(
	'v2.2.0',
	{
		'en-us': 'Type-safe database access for Rust, from schema to production.',
		'pt-br': 'Acesso type-safe a bancos de dados em Rust, do schema à produção.',
	},
	{ 'en-us': enUs, 'pt-br': ptBr },
);
