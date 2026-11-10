# Filtros

Todo tipo `Where` gerado só expõe methods para fields que realmente existem na entity — não existe um escape hatch tipo `.where("alguma_coluna", ...)` baseado em string. O tipo Rust de cada field também restringe quais valores compilam contra ele, então um filtro comparando um field `DateTime` contra uma `String` falha em tempo de compilação, em vez de virar um erro confuso de banco em runtime.

## Monte uma cláusula where

```rust
let users = dinoco::find_many::<User>()
    .where_(|user| user.active.eq(true))
    .where_(|user| user.age.gte(18))
    .execute(&client)
    .await?;
```

Várias chamadas `where_` se combinam com `AND` — esse mesmo padrão funciona de forma idêntica em finds, includes, counts, updates e deletes, então uma vez que você aprendeu aqui, é o mesmo em todo lugar.

## Operadores comuns

| Method | SQL |
| --- | --- |
| `eq(value)` | `field = value` |
| `neq(value)` | `field <> value` |
| `gt(value)` | `field > value` |
| `gte(value)` | `field >= value` |
| `lt(value)` | `field < value` |
| `lte(value)` | `field <= value` |
| `batch(values)` | `field IN (...)` |
| `not_in_batch(values)` | `field NOT IN (...)` |
| `in_query(query)` | `field IN (SELECT ...)` |
| `not_in_query(query)` | `field NOT IN (SELECT ...)` |
| `null()` | `field IS NULL` |
| `not_null()` | `field IS NOT NULL` |

Todo valor passado para esses methods é enviado como parâmetro vinculado do adapter — nunca interpolado diretamente na string SQL, o que é o que mantém essa API imune a SQL injection por construção, não por convenção.

## Operadores de String

Fields `String` e `Option<String>` ganham mais três:

```rust
dinoco::find_many::<User>().where_(|user| user.email.like("dinoco"));
dinoco::find_many::<User>().where_(|user| user.email.starts_with("support"));
dinoco::find_many::<User>().where_(|user| user.email.ends_with("@example.com"));
```

`like` envolve seu valor com `%` dos dois lados, `starts_with` adiciona só à direita, e `ends_with` só à esquerda — não adicione os curingas `%` você mesmo, ou vai acabar procurando por um caractere `%` literal.

Um field declarado com `@fulltext` expõe adicionalmente `.fulltext(termo)` — um field `String` comum sem esse atributo simplesmente não tem esse method, então não tem como chamar busca full-text por acidente numa coluna sem índice. Veja [Busca full-text](/pt-br/docs/orm/orm/full-text-search).

## Ranges numéricos e temporais

`Integer`, `Float`, `DateTime`, `Date` e suas versões opcionais suportam uma checagem de range inclusivo:

```rust
let users = dinoco::find_many::<User>()
    .where_(|user| user.age.between(18, 65))
    .execute(&client)
    .await?;
```

## Verificações de null

```rust
let tasks = dinoco::find_many::<Task>()
    .where_(|task| task.owner_id.null()) // SQL: owner_id IS NULL
    .execute(&client)
    .await?;
```

Use `not_null()` para o oposto — rows onde uma foreign key nullable (ou qualquer field nullable) está de fato preenchida.

## Valores em batch

```rust
let users = dinoco::find_many::<User>()
    .where_(|user| user.id.batch(["user-a", "user-b"]))
    .execute(&client)
    .await?;
```

`batch` gera SQL `IN (...)`. É também o que você vai usar quando precisar fornecer várias keys de origem de uma vez para as operações `connect`/`disconnect` de uma pivô many-to-many.

### Exclua um batch

`not_in_batch` é o oposto: mantém as rows cuja coluna não tem nenhum dos valores, como SQL `NOT IN (...)`:

```rust
let open = dinoco::find_many::<Order>()
    .where_(|order| order.status.not_in_batch([OrderStatus::Paid, OrderStatus::Refunded]))
    .execute(&client)
    .await?;
```

Uma lista vazia não exclui nada, então todas as rows ficam (e um `batch` vazio não mantém nenhuma). Uma coluna `NULL` não está em nenhuma das listas: combine com `null()` via `where_complex` para manter essas rows também. Como todo filtro, funciona em filtros de relação, includes, `count`, `exists`, updates e deletes, e numa key many-to-many mantém as rows ligadas a nenhum dos valores, incluindo as sem ligação (igual ao `not_in` desse field).

## Filtre por uma subquery

`in_query` mantém as rows cuja coluna tem um dos valores que outra query pluca, no mesmo statement — `field IN (SELECT ...)`. A subquery é um `find_many` ou `find_first` terminado em `.pluck(|x| x.column)`, de uma coluna do mesmo tipo, opcional ou não em qualquer um dos lados:

```rust
// Pedidos de clientes VIP.
let orders = dinoco::find_many::<Order>()
    .where_(|order| {
        order.customer_id.in_query(
            dinoco::find_many::<Customer>().where_(|customer| customer.vip.eq(true)).pluck(|customer| customer.id),
        )
    })
    .execute(&client)
    .await?;
```

`not_in_query` é o oposto, `NOT IN (SELECT ...)`. Como o `NOT IN` do SQL, ele não mantém nenhuma row quando a subquery seleciona um `NULL`, então filtre esses valores na subquery (`.where_(|o| o.customer_id.not_null())`); uma subquery vazia não exclui nada.

A subquery aceita tudo que um find aceita: `where_`, `where_complex`, filtros de relação e os seus próprios `in_query` escolhem os valores; `order_by` com `take`/`skip` (ou `find_first`) escolhe uma janela, como "o cliente do maior pedido"; e um [cursor](/pt-br/docs/orm/orm/find-many#paginacao-por-cursor) escolhe as rows depois dele. Os dois filtros funcionam onde um `where_` funcionar — finds, `count`, `exists`, updates, deletes, includes, filtros de relação, `where_complex` e transactions. O MySQL não aceita um `LIMIT` numa subquery de `IN` nem um write cuja subquery lê a tabela escrita, então lá o Dinoco lê essas subqueries de uma tabela derivada.

## Filtre por registros relacionados

Fields de relação também estão no `Where`. Eles mantêm as rows cujas rows relacionadas batem com o filtro, sem carregar a relação:

```rust
let transactions = dinoco::find_many::<Transaction>()
    .where_(|transaction| transaction.payout.where_(|payout| payout.method.eq(PayoutMethod::Pix)))
    .execute(&client)
    .await?;
```

Além de `where_`, todo field de relação oferece `where_complex`, `none`, `none_complex`, `every`, `every_complex`, `exists`, `exists_complex`, `not_exists` e `not_exists_complex` (mais `empty` e `not_empty` nas relações de lista), e os callbacks se aninham por outras relações. Veja [Filtros de relação](/pt-br/docs/orm/orm/relation-filters).

## Combine condições

```rust
let users = dinoco::find_many::<User>()
    .where_(|user| user.office.eq("engineering"))
    .where_(|user| user.age.lt(30))
    .where_(|user| user.email.ends_with("@example.com"))
    .execute(&client)
    .await?;
```

> [!NOTE]
> Todo exemplo nesta página combina condições com um `AND` implícito — é a única precedência que `where_` entende. No momento em que você precisar de `OR` ou `NOT`, ou de `AND`/`OR` misturados com agrupamento explícito, essa API não consegue expressar isso; veja [Where complex](/pt-br/docs/orm/orm/where-complex) em vez disso.
