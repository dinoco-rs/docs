# Includes

`includes(...)` is how you opt in to loading a relation field. Without it, relations keep whatever empty value they're generated with: `Vec::new()` for a to-many relation, `None` for a to-one one — Dinoco never loads data you didn't ask for.

## Include a many relation

```rust
let accounts = dinoco::find_many::<Account>()
    .includes(|account| account.sessions())
    .execute(&client)
    .await?;
```

Dinoco collects every parent's key first, then loads all the matching children in one batched follow-up query — never one query per parent row.

## Include a one relation

```rust
let session = dinoco::find_first::<AccountSession>()
    .where_(|session| session.id.eq(&session_id))
    .includes(|session| session.account())
    .execute(&client)
    .await?;
```

To-one relations use a left-join-equivalent strategy and stay `None` gracefully when nothing matches — an unmatched to-one include is not an error.

## Filter the relation

The relation builder inside `.includes(...)` exposes the same generated filters as a top-level find:

```rust
let accounts = dinoco::find_many::<Account>()
    .includes(|account| account.sessions().where_(|session| session.revoked.eq(false)))
    .execute(&client)
    .await?;
```

Relation filters work there too, so an include can load only the related rows that have (or lack) related rows of their own: `.where_(|session| session.devices.where_(|device| device.trusted.eq(true)))`.

The include's `where_` chooses which related rows are loaded into each parent; it never removes a parent from the result. To return only the parents that have matching related rows, filter the parent with a [relation filter](/en-us/docs/orm/orm/relation-filters) — the two compose:

```rust
let accounts = dinoco::find_many::<Account>()
    .where_(|account| account.sessions.where_(|session| session.revoked.eq(false)))
    .includes(|account| account.sessions().where_(|session| session.revoked.eq(false)))
    .execute(&client)
    .await?;
```

## Order and page the relation

`order_by`, `take`, and `skip` on the relation builder order and page the related rows of **each parent**:

```rust
let accounts = dinoco::find_many::<Account>()
    .includes(|account| {
        account
            .sessions()
            .where_(|session| session.revoked.eq(false))
            .order_by(|session| session.created_at.desc())
            .order_by(|session| session.id.desc())
            .skip(1)
            .take(5)
    })
    .execute(&client)
    .await?;
```

As at the top level, each `order_by` adds a column after the previous ones, so sessions created at the same instant are ordered by `id`.

> [!NOTE]
> For a to-many relation, `take(5)` applies **per parent**, not to the combined result across all parents — each account gets up to five of its own sessions, after skipping its own first one. Under the hood, the compiler achieves this with a window-partitioned query rather than issuing a separate query per parent.

Paging works on every to-many relation, many-to-many and self relations included, and at every level of [nested includes](#build-nested-includes). `take(0)` loads an empty list, and a `skip` past a parent's last row loads an empty list for that parent. Without `order_by`, which rows a page keeps is up to the database.

## Use where complex and full-text

```rust
let accounts = dinoco::find_many::<Account>()
    .includes(|account| {
        account.sessions().where_complex(|session, m| {
            m.and([
                session.label.fulltext("mobile"),
                m.not(session.revoked.eq(true)),
            ])
        })
    })
    .execute(&client)
    .await?;
```

The same rule as top-level finds applies here too: once a relation builder uses `where_complex`, every plain `where_` on that same builder is ignored. `.fulltext(...)` is only available when the related field actually has `@fulltext` in the schema.

## Build nested includes

```rust
let projects = dinoco::find_many::<Project>()
    .includes(|project| project.owner())
    .includes(|project| {
        project
            .tasks()
            .order_by(|task| task.priority.desc())
            .take(10)
            .includes(|task| task.assignee())
    })
    .execute(&client)
    .await?;
```

Sibling includes — `owner()` and `tasks()` here — are awaited in parallel rather than one after another, and each nested level repeats whatever loading strategy is appropriate for its own relation kind (batched for to-many, left-join-equivalent for to-one), all the way down.

Every level takes its own `where_` (relation filters included), `where_complex`, `order_by`, `take`, and `skip`. They apply to that level's rows only, and pages apply per parent at that level:

```rust
let projects = dinoco::find_many::<Project>()
    .includes(|project| {
        project
            .tasks()
            // Tasks assigned to an active user.
            .where_(|task| task.assignee.where_(|user| user.active.eq(true)))
            .order_by(|task| task.priority.desc())
            .order_by(|task| task.id.asc())
            .take(10)
            .includes(|task| {
                task.comments()
                    // Comments whose author still exists, the 3 latest per task.
                    .where_(|comment| comment.author.exists())
                    .order_by(|comment| comment.created_at.desc())
                    .take(3)
                    .includes(|comment| comment.author())
            })
    })
    .execute(&client)
    .await?;
```

## Combine with select

The relation builder also accepts `select::<S>()`, exactly like a top-level find. The relation's key is tracked separately from the projection internally, purely for grouping rows back to their parent correctly — the projection itself never needs to expose that key as a field. See [Select](/en-us/docs/orm/orm/select).

## Primary and transactions

`read_in_primary()` on the parent find routes both the parent row *and* every include underneath it to the primary — there's no way to keep an include on a replica while its parent reads from the primary.

Inside a [`transaction(...)`](/en-us/docs/orm/orm/transactions#read-inside-a-transaction) closure, pass `tx` to `execute`: the parent and every include, at any depth, read on the transaction's connection and see the writes the closure has made so far.
