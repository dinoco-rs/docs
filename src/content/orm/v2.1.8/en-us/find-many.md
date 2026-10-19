# Find many

`find_many` returns every matching row as `Vec<M>`. Zero matches is a perfectly normal result here — you get back an empty vector, never an error.

## Basic query

```rust
let accounts = dinoco::find_many::<Account>()
    .where_(|account| account.active.eq(true))
    .execute(&client)
    .await?;
```

Repeated `where_` calls combine with `AND`. Reach for [Where complex](/en-us/docs/orm/orm/where-complex) the moment you need explicit precedence across `AND`, `OR`, and `NOT`.

## Order results

```rust
let accounts = dinoco::find_many::<Account>()
    .order_by(|account| account.created_at.desc())
    .execute(&client)
    .await?;
```

The builder accepts one typed ordering, via `asc()` or `desc()` on a field.

## Pagination

`take` caps how many rows come back; `skip` sets how many to skip before counting:

```rust
let page = dinoco::find_many::<Account>()
    .order_by(|account| account.id.asc())
    .take(25)
    .skip(50)
    .execute(&client)
    .await?;
```

> [!WARNING]
> Offset pagination (`take`/`skip`) only produces a stable, non-overlapping sequence of pages when paired with a stable `order_by`. Paginate without ordering — or order by a column with ties, like a status field — and rows can appear on two pages or vanish between them as the underlying data changes.

## Full-text search

Any field marked `@fulltext` exposes a matching method:

```rust
let accounts = dinoco::find_many::<Account>()
    .where_(|account| account.biography.fulltext("rust database"))
    .execute(&client)
    .await?;
```

See [Full-text search](/en-us/docs/orm/orm/full-text-search) for how this behaves differently per adapter.

## Select and include

```rust
let accounts = dinoco::find_many::<Account>()
    .select::<AccountSummary>()
    .execute(&client)
    .await?;
```

The return type becomes `Vec<AccountSummary>` instead of `Vec<Account>`. `includes(...)` works alongside `select`, and can filter, order, and paginate the related rows independently of the parent query — see [Select](/en-us/docs/orm/orm/select) and [Includes](/en-us/docs/orm/orm/includes).

## Pluck a single column

`pluck` projects onto one column and returns its raw values directly, instead of a row-model struct:

```rust
let ids = dinoco::find_many::<Account>()
    .where_(|account| account.active.eq(true))
    .pluck(|account| account.id)
    .execute(&client)
    .await?; // Vec<i64>
```

Unlike `select::<S>()`, `pluck` never builds `S` — the column comes back as `Vec<T>` (a `String`, `bool`, `i64`, `f64`, date, enum, or JSON value, matching the field's type). It replaces `select`/`includes` rather than combining with them.

## Aggregate a column

Hand `pluck` an aggregate instead of a field — `sum`, `avg`, `min`, `max`, or `count` — and the database computes it over the matching rows. You get one value back, not a `Vec`:

```rust
let revenue = dinoco::find_many::<Order>()
    .where_(|order| order.status.eq(OrderStatus::Paid))
    .pluck(|order| order.amount.sum())
    .execute(&client)
    .await?; // i64
```

| Aggregate | Fields | Returns | Over no rows |
| --- | --- | --- | --- |
| `sum()` | `Integer`, `Float` | `i64`, `f64` | `0` |
| `avg()` | `Integer`, `Float` | `Option<f64>` | `None` |
| `min()`, `max()` | `Integer`, `Float`, `String`, `DateTime`, `Date` | `Option<T>` | `None` |
| `count()` | any scalar field | `i64` | `0` |

Optional fields work too, and `NULL` values are skipped: `discount.sum()` adds up the orders that have a discount, and `discount.count()` counts only those. `count()` on a field that is never `NULL`, such as the primary key, counts rows. A sum comes back as the same type in every database — Dinoco casts PostgreSQL's `numeric` and MySQL's `DECIMAL` sums back to `i64`/`f64`, so there is no decimal type to convert.

### Rows in the aggregate

The aggregate reads exactly the rows `find_many` would return. `where_`, `where_complex`, and [relation filters](/en-us/docs/orm/orm/relation-filters) narrow them, and `take`/`skip` aggregate a window of them, with `order_by` deciding which rows the window keeps:

```rust
// The total of the 10 largest paid orders.
let top_ten = dinoco::find_many::<Order>()
    .where_(|order| order.status.eq(OrderStatus::Paid))
    .order_by(|order| order.amount.desc())
    .take(10)
    .pluck(|order| order.amount.sum())
    .execute(&client)
    .await?;

// What VIP customers spent.
let vip = dinoco::find_many::<Order>()
    .where_(|order| order.customer.where_(|customer| customer.vip.eq(true)))
    .pluck(|order| order.amount.sum())
    .execute(&client)
    .await?;
```

Without `take` or `skip`, `order_by` can't change the result, so it's left out of the SQL.

## Group the aggregate

`.group_by(...)` after an aggregate computes it once per group of rows that share a key, and returns `Vec<(key, value)>`:

```rust
let revenue_by_status = dinoco::find_many::<Order>()
    .pluck(|order| order.amount.sum())
    .group_by(|order| order.status)
    .execute(&client)
    .await?; // Vec<(OrderStatus, i64)>
```

Any scalar field can be the key, enums and optional fields included. `NULL` is a group of its own, read back as `None`. `where_`, `where_complex`, and relation filters still pick the rows that are grouped.

### Group by date

On a `DateTime` or `Date` field, `day()`, `week()`, `month()`, and `year()` group by the period a value falls in. The key is the first day of that period as a `NaiveDate` (weeks start on Monday), or `Option<NaiveDate>` for an optional field:

```rust
use dinoco::chrono::NaiveDate;

let daily: Vec<(NaiveDate, i64)> = dinoco::find_many::<Order>()
    .where_(|order| order.created_at.gte(start))
    .pluck(|order| order.amount.sum())
    .group_by(|order| order.created_at.day())
    .execute(&client)
    .await?;

for (day, total) in daily {
    println!("{day}: {total}");
}
```

Periods follow the UTC values Dinoco stores, so a day runs from 00:00 to 24:00 UTC.

### Order and page groups

With a group, `order_by`, `take`, and `skip` apply to the groups instead of the rows:

- without `order_by`, the groups come by key, ascending;
- `order_by` on the grouped field orders them by key;
- `order_by` on the aggregated field orders them by the aggregate, with ties broken by key;
- `take` and `skip` page the groups.

```rust
// The 7 most recent days with orders, newest first.
let last_days = dinoco::find_many::<Order>()
    .order_by(|order| order.created_at.desc())
    .take(7)
    .pluck(|order| order.amount.sum())
    .group_by(|order| order.created_at.day())
    .execute(&client)
    .await?;

// The 3 customers who spent the most.
let best_customers = dinoco::find_many::<Order>()
    .where_(|order| order.customer_id.not_null())
    .order_by(|order| order.amount.desc())
    .take(3)
    .pluck(|order| order.amount.sum())
    .group_by(|order| order.customer_id)
    .execute(&client)
    .await?; // Vec<(Option<String>, i64)>
```

`order_by` on any other field fails the query with an error, since a group has no single value of that column to sort by.

> [!NOTE]
> Where `NULL` keys sort depends on the database (last on PostgreSQL, first on SQLite and MySQL), and so does the order of enum keys (declaration order for PostgreSQL and MySQL enums, alphabetical on SQLite). When the order matters, order by the aggregate or sort the `Vec` in Rust.

## Transform results

`transform` runs a plain Rust closure over every row after the query (and any `.includes(...)`) has already run — it is a post-query mapping, not a SQL projection:

```rust
let summaries = dinoco::find_many::<Account>()
    .transform(|account| serde_json::json!({
        "id": account.id,
        "email": account.email,
    }))
    .execute(&client)
    .await?; // Vec<serde_json::Value>
```

Because the callback receives the fully materialized row, it can read fields from `.includes(...)`, reshape data for an API response, or convert into a different type entirely.

## Read from primary

`read_in_primary()` routes this query — and every relation it `.includes(...)` — away from replicas and onto the primary. Reach for it specifically when the read depends on a write that just happened and can't tolerate replication lag.

## Inside a transaction

Pass the `tx` of a [`transaction(...)`](/en-us/docs/orm/orm/transactions#read-inside-a-transaction) closure instead of `&client` to read on the transaction's connection. The rows reflect every write the closure has made so far, and `.includes(...)`, `.pluck(...)` (aggregates and groups included), and `.transform(...)` run there too:

```rust
dinoco::transaction(&client, |tx| async move {
    dinoco::insert_many::<Task>().values(&tasks).execute(tx).await?;

    let open = dinoco::find_many::<Task>()
        .where_(|x| x.project_id.eq(&project_id))
        .pluck(|x| x.id)
        .execute(tx)
        .await?;

    Ok(open)
})
.await?;
```
