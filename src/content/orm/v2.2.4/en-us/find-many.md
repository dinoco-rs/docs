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

Order by any field with `asc()` or `desc()`. Each `order_by` call adds a column after the previous ones, so ties on the first column are broken by the next:

```rust
// Newest first; accounts created at the same instant by id.
let accounts = dinoco::find_many::<Account>()
    .order_by(|account| account.created_at.desc())
    .order_by(|account| account.id.asc())
    .execute(&client)
    .await?;
```

This compiles to `ORDER BY created_at DESC, id ASC`. The same holds for `find_first`, `pluck`, and [includes](/en-us/docs/orm/orm/includes#order-and-page-the-relation).

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

`skip` works without `take` too, returning every row after the skipped ones. SQLite and MySQL only accept `OFFSET` after a `LIMIT`, so Dinoco writes each one's "no limit" value there (`LIMIT -1` and `LIMIT 18446744073709551615`); PostgreSQL takes `OFFSET` alone.

> [!WARNING]
> Offset pagination (`take`/`skip`) only produces a stable, non-overlapping sequence of pages when paired with a stable `order_by`. Paginate without ordering — or order by a column with ties, like a status field — and rows can appear on two pages or vanish between them as the underlying data changes. End the order with a unique column, such as `.order_by(|x| x.id.asc())`, to break every tie.

## Count with the rows

A paginated list shows the page and how many rows there are in all. `.count()` adds a count of the same model to the find: `execute` returns `(Vec<M>, M::Count)`, and the count uses the find's filters but ignores `order_by`, `take`, and `skip`:

```rust
let (accounts, count) = dinoco::find_many::<Account>()
    .where_(|account| account.active.eq(true))
    .order_by(|account| account.id.asc())
    .take(25)
    .skip(50)
    .count()
    .execute(&client)
    .await?;

println!("{} of {} active accounts", accounts.len(), count.total);
```

`count` is the [generated count type](/en-us/docs/orm/orm/count#generated-count-types), `AccountCount`, the one `count::<Account>()` returns. The count and the find run as two statements on the same connection, the count first. When the page starts at or past the last row (`total` at or below `skip`, which includes no row matching at all), the total already says the page is empty, so the find doesn't run.

The filters are read when the query runs, so a `where_` after `.count()` counts too. Every other stage works before or after it (`select`, `includes`, `order_by`, `take`, `skip`, `read_in_primary`), `.transform(...)` after it maps the rows and returns the count unchanged as `(Vec<R>, M::Count)`, and `.execute(tx)` runs both statements in the [transaction](/en-us/docs/orm/orm/transactions). `.pluck(...)` has no counting form.

`.count()`, `.count_transform(...)`, `.count_custom(...)`, and `.count_custom_complex(...)` each replace the one called before; only the last one runs.

### Change the count's filters

`count_transform` starts from the find's filters and changes them for the count only. Its closure receives a [`count::<M>()`](/en-us/docs/orm/orm/count) builder that holds the find's filters as `where_` calls, and returns it: `remove` drops the conditions on a field, `where_` and `where_complex` add filters, and `includes` asks for [relation counts](/en-us/docs/orm/orm/count#count-relations). The find keeps its own filters:

```rust
// The active accounts of the page, and every account of the domain, active or not.
let (accounts, count) = dinoco::find_many::<Account>()
    .where_(|account| account.active.eq(true))
    .where_(|account| account.email.ends_with("@dinoco.io"))
    .take(25)
    .count_transform(|count| count.remove(|account| account.active))
    .execute(&client)
    .await?;

// The same page, counting the inactive accounts of the domain instead.
let (accounts, count) = dinoco::find_many::<Account>()
    .where_(|account| account.active.eq(true))
    .where_(|account| account.email.ends_with("@dinoco.io"))
    .take(25)
    .count_transform(|count| count.remove(|account| account.active).where_(|account| account.active.eq(false)))
    .execute(&client)
    .await?;
```

`remove` never makes the count narrower:

- every `where_` that filters on the field goes, and the others stay;
- in a [where complex](/en-us/docs/orm/orm/where-complex) tree, the members of an `and` group are removed one by one, and an `or` or `not` group that mentions the field goes as a whole;
- a relation field removes its [relation filters](/en-us/docs/orm/orm/relation-filters) (`count.remove(|account| account.sessions)`), a many-to-many key field its membership filters, and any field of an `@@fulltexts` group the search on that group;
- the conditions inside a relation filter are on the related model, so `remove(|account| account.id)` leaves `account.sessions.where_(|session| session.id.eq(...))` in place.

As on every builder, `where_complex` replaces every filter before it, the find's included, and makes later `where_` calls be ignored.

### Count with filters of its own

`count_custom` ignores the find's filters: its closure receives an empty `count::<M>()` builder. `count_custom_complex` takes a where complex tree directly, the way `where_complex` does:

```rust
// A page of active accounts, and how many accounts are inactive.
let (accounts, count) = dinoco::find_many::<Account>()
    .where_(|account| account.active.eq(true))
    .take(25)
    .count_custom(|count| count.where_(|account| account.active.eq(false)))
    .execute(&client)
    .await?;

let (accounts, count) = dinoco::find_many::<Account>()
    .where_(|account| account.active.eq(true))
    .take(25)
    .count_custom_complex(|account, m| m.or(account.active.eq(false), account.email.ends_with("@example.com")))
    .execute(&client)
    .await?;

// Every account, with how many sessions they have, next to the page.
let (accounts, count) = dinoco::find_many::<Account>()
    .take(25)
    .count_custom(|count| count.includes(|account| account.sessions()))
    .execute(&client)
    .await?;
```

A count with other filters than the find's says nothing about the find's rows, so with `count_transform` and `count_custom` the find always runs.

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

### Group by date and time

On a `DateTime` or `Date` field, `date()`, `week()`, `month()`, and `year()` group by the period a value falls in. The key is the first day of that period as a `NaiveDate` (weeks start on Monday), or `Option<NaiveDate>` for an optional field. `date()` groups by the full date (day, month, and year); `day()` is the same method under another name.

On a `DateTime` field, `hour()` and `minute()` group by the hour or minute of a value. The key is the timestamp the period starts at, as a `DateTime<Utc>` (`Option<DateTime<Utc>>` for an optional field): 18:30:42 falls in the hour 18:00:00 and in the minute 18:30:00.

| Method | Fields | Key of `2026-01-05 18:30:42` |
| --- | --- | --- |
| `date()`, `day()` | `DateTime`, `Date` | `2026-01-05` |
| `week()` | `DateTime`, `Date` | `2026-01-05` (its Monday) |
| `month()` | `DateTime`, `Date` | `2026-01-01` |
| `year()` | `DateTime`, `Date` | `2026-01-01` |
| `hour()` | `DateTime` | `2026-01-05 18:00:00` |
| `minute()` | `DateTime` | `2026-01-05 18:30:00` |

```rust
use dinoco::chrono::{DateTime, NaiveDate, Utc};

let daily: Vec<(NaiveDate, i64)> = dinoco::find_many::<Order>()
    .where_(|order| order.created_at.gte(start))
    .pluck(|order| order.amount.sum())
    .group_by(|order| order.created_at.date())
    .execute(&client)
    .await?;

for (day, total) in daily {
    println!("{}: {total}", day.format("%d/%m/%Y"));
}

let hourly: Vec<(DateTime<Utc>, i64)> = dinoco::find_many::<Order>()
    .where_(|order| order.created_at.gte(start))
    .pluck(|order| order.id.count())
    .group_by(|order| order.created_at.hour())
    .execute(&client)
    .await?;
```

Periods follow the UTC values Dinoco stores, so a day runs from 00:00 to 24:00 UTC and an hour starts at minute zero UTC. The key is a date or a timestamp, not text: format it however you need, as `day.format("%d/%m/%Y")` does above. To count days in another time zone, see the next section.

### Group by date in a time zone

`.with_timezone(&zone)` after `date()`, `day()`, `week()`, `month()`, or `year()` computes the period in that time zone instead of UTC: each timestamp counts on the day it falls on there, daylight saving time included. Zones come from [`chrono_tz`](https://docs.rs/chrono-tz), re-exported as `dinoco::chrono_tz`:

```rust
use dinoco::chrono_tz::America::Sao_Paulo;

// Sales per day as seen in São Paulo (UTC-3): an order at 01:00 UTC on
// January 6 counts on January 5.
let daily = dinoco::find_many::<Order>()
    .pluck(|order| order.amount.sum())
    .group_by(|order| order.created_at.date().with_timezone(&Sao_Paulo))
    .execute(&client)
    .await?; // Vec<(NaiveDate, i64)>
```

The key is still the first day of the period, now in that zone's calendar. Filters, `order_by`, `take`, and `skip` work as usual, and so do optional fields (`NULL` stays its own group) and transactions.

- On a `Date` field, the zone changes nothing: a calendar date is the same in every zone.
- `hour()` and `minute()` don't take a zone; they stay in UTC.
- PostgreSQL converts with `AT TIME ZONE`, and SQLite with a function Dinoco registers on each connection, backed by the same `chrono_tz` data. Neither needs anything else.
- MySQL converts with `CONVERT_TZ`, which reads named zones from its time zone tables. They are loaded in the official Docker image and in most managed services, but not always in a local install: load them with [`mysql_tzinfo_to_sql`](https://dev.mysql.com/doc/refman/8.4/en/time-zone-support.html). Before such a query, Dinoco checks the zone with one extra `SELECT` and fails with that hint instead of grouping every row under `NULL`.

### Order and page groups

With a group, `order_by`, `take`, and `skip` apply to the groups instead of the rows:

- without `order_by`, the groups come by key, ascending;
- `order_by` on the grouped field orders them by key;
- `order_by` on the aggregated field orders them by the aggregate, with ties broken by key, ascending;
- a second `order_by`, on the grouped field, picks the direction of that tie-break: `.order_by(|o| o.amount.desc()).order_by(|o| o.customer_id.desc())`;
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
