# Dinoco documentation

The website of the Dinoco ecosystem, served at [dinoco.io](https://dinoco.io): the landing page and the documentation of every crate, in English (`en-us`) and Brazilian Portuguese (`pt-br`).

| Product | Crate | Published version | Content |
| --- | --- | --- | --- |
| Dinoco ORM | `dinoco` | v2.1.7 | `src/content/orm/v2.1.7` |
| Rekka | `rekka` | v0.0.1 | `src/content/rekka/v0.0.1` |

```bash
yarn install
yarn dev
```

## Layout

- `src/content/<product>/<version>/<locale>/*.md`: the pages, one Markdown file each.
- `src/jsons/<product>/<version>/<locale>.json`: navigation (groups, sections, pages, and each page's `inPage` headings), combined by `index.ts`.
- `src/lib/products.ts`: the product registry (names, repositories, versions, summaries). Adding a product or a version starts here.
- `app/[locale]/docs/[product]/[[...slug]]`: every docs page, at `/<locale>/docs/<product>/<group>/<item>`.
- `app/mcp`, `app/llms.txt`, `app/llms-full.txt`: the MCP server and `llms.txt` files, built from the same navigation data.

Only the latest version of each product is published, and URLs never contain the version. A release renames the product's version directories in place.

## Checks

Run `yarn run check` before publishing (plain `yarn check` is a built-in Yarn 1 command). It validates every page and heading against the navigation (`yarn validate`), checks that every internal link points to a real page and heading (`yarn anchors`), type-checks the application, and creates a production build.
