# Use Rekka with AI

The Rekka documentation is served to AI assistants through the same MCP server and `llms.txt` files as the rest of the Dinoco ecosystem, so an assistant can answer from the current docs instead of guessing from training data.

## MCP server

```text
https://dinoco.io/mcp
```

The server is read-only and needs no login. Connect it once and it covers both Dinoco ORM and Rekka. With Claude Code:

```bash
claude mcp add --transport http dinoco-docs https://dinoco.io/mcp
```

Other clients, and the full list of tools and resources, are described on the [Dinoco ORM AI page](/en-us/docs/orm/guide/ai).

## Rekka page ids

A page id is the URL path after `/docs/`: `rekka/queues/workers`, `rekka/cache/cache-types`, `rekka/operations/reliability`. Pass `product: "rekka"` to `search_docs` or `list_docs` to search only the Rekka docs:

```text
search_docs  { "query": "retry policy max attempts", "product": "rekka" }
get_doc      { "id": "rekka/queues/retries", "section": "Attempt limits" }
```

## llms.txt

`https://dinoco.io/llms.txt` lists every page of both products, and `https://dinoco.io/llms-full.txt` has their full text. Add `?locale=pt-br` for Portuguese.

## Tips for prompts

- Name the API the way the docs do (`concurrency_by_key`, `ReconcileHandler`, `RekkaExecutionResult`), so search finds the right page.
- Ask the assistant to read the page first: "Read `rekka/queues/concurrency` and write a worker that syncs one customer at a time."
- Say which version you use. These docs describe Rekka v0.0.6.
