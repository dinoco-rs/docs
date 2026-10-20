# Usar o Rekka com IA

A documentação do Rekka é servida para assistentes de IA pelo mesmo servidor MCP e pelos mesmos arquivos `llms.txt` do resto do ecossistema Dinoco, para que um assistente responda com a documentação atual em vez de chutar a partir do que aprendeu no treinamento.

## Servidor MCP

```text
https://dinoco.io/mcp
```

O servidor é somente leitura e não precisa de login. Conecte uma vez e ele cobre o Dinoco ORM e o Rekka. Com o Claude Code:

```bash
claude mcp add --transport http dinoco-docs https://dinoco.io/mcp
```

Outros clientes, e a lista completa de ferramentas e recursos, estão na [página de IA do Dinoco ORM](/pt-br/docs/orm/guide/ai).

## Ids das páginas do Rekka

O id de uma página é o caminho da URL depois de `/docs/`: `rekka/queues/workers`, `rekka/cache/cache-types`, `rekka/operations/reliability`. Passe `product: "rekka"` para `search_docs` ou `list_docs` para buscar só na documentação do Rekka:

```text
search_docs  { "query": "política de retry tentativas", "product": "rekka", "locale": "pt-br" }
get_doc      { "id": "rekka/queues/retries", "section": "Limite de tentativas", "locale": "pt-br" }
```

## llms.txt

`https://dinoco.io/llms.txt?locale=pt-br` lista todas as páginas dos dois produtos em português, e `https://dinoco.io/llms-full.txt?locale=pt-br` traz o texto completo delas.

## Dicas para prompts

- Chame a API do jeito que a documentação chama (`concurrency_by_key`, `ReconcileHandler`, `RekkaExecutionResult`), para que a busca encontre a página certa.
- Peça para o assistente ler a página primeiro: "Leia `rekka/queues/concurrency` e escreva um worker que sincroniza um cliente por vez."
- Diga qual versão você usa. Esta documentação descreve o Rekka v0.0.2.
