# Filters

Every generated `Where` type only exposes methods for fields that actually exist on the entity — there's no string-keyed `.where("some_column", ...)` escape hatch. Each field's Rust type also constrains which values compile against it, so a filter comparing a `DateTime` field against a `String` fails at compile time rather than as a confusing runtime database error.

## Build a where clause

```rust
let users = dinoco::find_many::<User>()
    .where_(|user| user.active.eq(true))
    .where_(|user| user.age.gte(18))
    .execute(&client)
    .await?;
```

Repeated `where_` calls combine with `AND` — this same pattern works identically across finds, includes, counts, updates, and deletes, so once you've learned it here, it's the same everywhere else.

## Common operators

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

Every value passed to these is sent as a bound adapter parameter — never interpolated directly into the SQL string, which is what keeps this API immune to SQL injection by construction, not by convention.

## String operators

`String` and `Option<String>` fields get three more:

```rust
dinoco::find_many::<User>().where_(|user| user.email.like("dinoco"));
dinoco::find_many::<User>().where_(|user| user.email.starts_with("support"));
dinoco::find_many::<User>().where_(|user| user.email.ends_with("@example.com"));
```

`like` wraps your value in `%` on both sides, `starts_with` adds it only on the right, and `ends_with` only on the left — don't add the `%` wildcards yourself, or you'll end up searching for a literal `%` character.

A field declared with `@fulltext` additionally exposes `.fulltext(term)` — a plain `String` field without that attribute doesn't have this method at all, so there's no way to accidentally call full-text search against an unindexed column. See [Full-text search](/en-us/docs/orm/orm/full-text-search).

## Numeric and temporal ranges

`Integer`, `Float`, `DateTime`, `Date`, and their optional forms all support an inclusive range check:

```rust
let users = dinoco::find_many::<User>()
    .where_(|user| user.age.between(18, 65))
    .execute(&client)
    .await?;
```

## Null checks

```rust
let tasks = dinoco::find_many::<Task>()
    .where_(|task| task.owner_id.null()) // SQL: owner_id IS NULL
    .execute(&client)
    .await?;
```

Use `not_null()` for the opposite — rows where a nullable foreign key (or any nullable field) is actually populated.

## Batch values

```rust
let users = dinoco::find_many::<User>()
    .where_(|user| user.id.batch(["user-a", "user-b"]))
    .execute(&client)
    .await?;
```

`batch` emits SQL `IN (...)`. It's also what you'll reach for when you need to supply multiple source keys at once for a many-to-many pivot's `connect`/`disconnect` operations.

### Exclude a batch

`not_in_batch` is the opposite: it keeps the rows whose column holds none of the values, as SQL `NOT IN (...)`:

```rust
let open = dinoco::find_many::<Order>()
    .where_(|order| order.status.not_in_batch([OrderStatus::Paid, OrderStatus::Refunded]))
    .execute(&client)
    .await?;
```

An empty list excludes nothing, so every row is kept (and an empty `batch` keeps none). A `NULL` column is in neither list: combine with `null()` through `where_complex` to keep those rows too. Like every filter, it works in relation filters, includes, `count`, `exists`, updates and deletes, and on a many-to-many key it keeps the rows linked to none of the values, unlinked rows included (the same as that field's `not_in`).

## Filter by a subquery

`in_query` keeps the rows whose column holds one of the values another query plucks, in the same statement — `field IN (SELECT ...)`. The subquery is a `find_many` or `find_first` ending in `.pluck(|x| x.column)`, of a column of the same type, optional or not on either side:

```rust
// Orders of VIP customers.
let orders = dinoco::find_many::<Order>()
    .where_(|order| {
        order.customer_id.in_query(
            dinoco::find_many::<Customer>().where_(|customer| customer.vip.eq(true)).pluck(|customer| customer.id),
        )
    })
    .execute(&client)
    .await?;
```

`not_in_query` is the opposite, `NOT IN (SELECT ...)`. Like SQL's `NOT IN`, it keeps no row when the subquery selects a `NULL`, so filter those out in the subquery (`.where_(|o| o.customer_id.not_null())`); an empty subquery excludes nothing.

The subquery takes everything a find does: `where_`, `where_complex`, relation filters, and its own `in_query`s pick the values; `order_by` with `take`/`skip` (or `find_first`) picks a window, such as "the customer of the largest order"; and a [cursor](/en-us/docs/orm/orm/find-many#cursor-pagination) picks rows past it. Both filters work wherever a `where_` does — finds, `count`, `exists`, updates, deletes, includes, relation filters, `where_complex`, and transactions. MySQL accepts neither a `LIMIT` in an `IN` subquery nor a write whose subquery reads the table being written, so there Dinoco reads those subqueries from a derived table.

## Filter by related records

Relation fields are on `Where` too. They keep the rows whose related rows match, without loading the relation:

```rust
let transactions = dinoco::find_many::<Transaction>()
    .where_(|transaction| transaction.payout.where_(|payout| payout.method.eq(PayoutMethod::Pix)))
    .execute(&client)
    .await?;
```

Besides `where_`, every relation field offers `where_complex`, `none`, `none_complex`, `every`, `every_complex`, `exists`, `exists_complex`, `not_exists`, and `not_exists_complex` (plus `empty` and `not_empty` on list relations), and the callbacks nest through further relations. See [Relation filters](/en-us/docs/orm/orm/relation-filters).

## Combine conditions

```rust
let users = dinoco::find_many::<User>()
    .where_(|user| user.office.eq("engineering"))
    .where_(|user| user.age.lt(30))
    .where_(|user| user.email.ends_with("@example.com"))
    .execute(&client)
    .await?;
```

> [!NOTE]
> Every example on this page combines conditions with an implicit `AND` — that's the only precedence `where_` understands. The moment you need `OR` or `NOT`, or `AND`/`OR` mixed with explicit grouping, this API can't express it; see [Where complex](/en-us/docs/orm/orm/where-complex) instead.
