# Watch changes

`watch` streams the inserts, updates, and deletes of a model as they commit. The changes come from the database's own log, the PostgreSQL write-ahead log (logical replication) or the MySQL binary log, never from hooks around Dinoco's methods. So a watch sees every writer: your builders, plain SQL, another service, a database console.

```rust
use dinoco::{WatchEvent, watch};

use crate::dinoco::Account;

watch::<Account>()
    .filter(|account| account.active)
    .on_event(|event| match event {
        WatchEvent::Created(account) => println!("created {}", account.id),
        WatchEvent::Updated { before, after } => println!("{} -> {}", before.email, after.email),
        WatchEvent::Deleted(account) => println!("deleted {}", account.id),
    })
    .observer(&client)
    .await?;
```

## Enable it in the schema

Declare `@@with_watch_changes` on each model to stream, and `replication_url` in the config block:

```dinoco
config {
    database        = "postgresql"
    database_url    = env("DATABASE_URL")
    replication_url = env("REPLICATION_DATABASE_URL")
}

model Account {
    id     String  @id @default(uuid())
    email  String
    active Boolean

    @@with_watch_changes
}
```

`replication_url` is the URL of the **replication user** watches connect as, a database user of its own that the CLI creates from the URL's user name and password. Any schema with a watched model must declare it for every PostgreSQL and MySQL workspace. On a model, the attribute takes no arguments.

```bash
export DATABASE_URL="postgres://app:secret@db:5432/app"
export REPLICATION_DATABASE_URL="postgres://app_replica:other-secret@db:5432/app"
```

Then run `dinoco migrate generate` (or `dinoco migrate run` when deploying). The generated `connect()` reads `REPLICATION_DATABASE_URL` when it is set, so watches use that user. A client built by hand takes it with `client.with_replication_url(url)`, and without one it connects with the primary URL, whose user then needs replication privileges itself.

## What the CLI sets up

After applying migrations, `migrate generate` and `migrate run` compare the watched models with the database and create or remove what changed, printing each change in a **Watch** section:

| | PostgreSQL | MySQL |
| --- | --- | --- |
| Per watched table | A publication `dinoco_watch_<table>` (inserts, updates, deletes) and `REPLICA IDENTITY FULL`, so updates and deletes log the whole previous row | `SELECT` on the table for the replication user |
| Replication user | A role with `LOGIN REPLICATION`, the URL's password, and `SELECT` on the watched tables | A user with `REPLICATION SLAVE, REPLICATION CLIENT` and the URL's password |

- **Adding the attribute** to a model publishes its table on the next run.
- **Removing it** from a model drops the table's publication and restores its default replica identity (PostgreSQL), or revokes its `SELECT` (MySQL).
- **Removing it from every model** also drops the replication user, as long as Dinoco created it: users Dinoco creates carry the comment `dinoco replication user`, and no other user is ever dropped.
- A setup changed by hand (a dropped publication, a different replica identity) is repaired on the next run, and a run with nothing to change prints nothing.

None of this is written to migration files: the replication user's password comes from the environment and must never be committed. Every `migrate run` brings a database in line with the schema, so a deploy sets it up like any other environment. The password is never printed.

Creating the replication user takes a privileged migration user: on PostgreSQL a superuser, or on PostgreSQL 16+ a role with `CREATEROLE` and `REPLICATION`; on MySQL `CREATE USER` and the replication privileges `WITH GRANT OPTION`. When it is missing, the command fails and prints the statements to run yourself. When `replication_url` names the same user as `database_url`, Dinoco doesn't manage that user, and only warns when it lacks `REPLICATION`.

## Server requirements

| Database | Requirement |
| --- | --- |
| PostgreSQL | 14 or newer, with `wal_level = logical` (`ALTER SYSTEM SET wal_level = logical`, then restart the server). Every running watch takes one of `max_wal_senders` and one of `max_replication_slots` (10 each by default). `replication_url` must reach PostgreSQL directly, not through PgBouncer. |
| MySQL | `log_bin` on, `binlog_format = ROW`, `binlog_row_image = FULL` and an empty `binlog_row_value_options`, the defaults of MySQL 8. |
| SQLite | Not supported: SQLite has no log to read. A schema whose every workspace is SQLite can't declare `@@with_watch_changes`, and `observer` returns `WatchError::Unsupported` on a SQLite client, such as the [test ambient](/en-us/docs/orm/orm/testing). |

`migrate generate` and `migrate run` warn when a server setting is missing, and `observer` fails with `WatchError::NotConfigured`, naming the setting, until it is fixed.

## Watch a model

`watch::<M>()` builds the watch, `on_event` sets the handler, and `observer(&client)` connects and runs it. Only models whose schema model declares `@@with_watch_changes` can be watched; `watch::<Bank>()` on any other model fails to compile.

```rust
pub enum WatchEvent<M> {
    Created(M),
    Updated { before: M, after: M },
    Deleted(M),
}
```

- `Created` carries the inserted row, `Deleted` the row as it was, and `Updated` both versions of the row.
- Changes arrive once their transaction commits, in commit order, and the changes of a rolled-back transaction never arrive.
- A statement that touches several rows delivers one event per row.
- Every field of the model is decoded, with the same types as a query: enums, JSON, dates, `NULL`s, and large values the update left unchanged. Relation fields are empty, as in a query without includes.
- `TRUNCATE` is not reported.

## Filter the changes

`filter` takes a closure over the row and delivers only the changes it accepts:

```rust
watch::<Account>()
    .filter(|account| account.active)
    .on_event(|event| { /* ... */ })
    .observer(&client)
    .await?;
```

`Created` and `Deleted` are checked against their row. An update arrives as `Updated` when the row passes the filter **before or after** it, so a row that stops passing, or starts to, is still reported, with both versions to compare:

| Update | Delivered |
| --- | --- |
| Active before and after | `Updated` |
| Active before, inactive after | `Updated`, with `before.active == true` and `after.active == false` |
| Inactive before, active after | `Updated` |
| Inactive before and after | Nothing |

## Handlers

The handler is a closure that receives each event. It may return nothing or a `Result`, and it may be async:

```rust
watch::<Account>()
    .on_event(|event| async move {
        if let WatchEvent::Created(account) = event {
            send_welcome_email(&account.email).await?;
        }
        Ok::<(), anyhow::Error>(())
    })
    .observer(&client)
    .await?;
```

- Events are handled one at a time: the next change is read once the handler returns, or once its future completes.
- An `Err` stops the watch: `observer` returns `WatchError::Handler` with the error.
- A slow handler holds back every change after it, so hand long work to a queue (a [Rekka](/en-us/docs/rekka/guide/introduction) job, for example) instead of doing it in the handler.

## Run in the background

`observer` runs until the connection fails or the handler returns an error. Spawn it to keep it running next to the rest of the application, and drop its future to stop watching, for example with `tokio::select!` or by aborting the task:

```rust
let client = std::sync::Arc::new(crate::dinoco::connect().await?);

let accounts = tokio::spawn({
    let client = client.clone();
    async move {
        watch::<Account>()
            .on_event(|event| { /* ... */ })
            .observer(&client)
            .await
    }
});
```

Each running watch holds one database connection; on PostgreSQL it also holds a temporary replication slot, which the server drops with the connection.

## Delivery and reconnection

A watch streams the changes committed from the moment `observer` connects. Changes made while no watch runs are not delivered later, so a watch suits reacting to changes, refreshing caches, and pushing updates to clients, but it is no substitute for reading the table when a process starts. To keep watching across lost connections, call `observer` again:

```rust
loop {
    let result = watch::<Account>()
        .on_event(|event| { /* ... */ })
        .observer(&client)
        .await;
    if let Err(error) = result {
        eprintln!("account watch stopped: {error}");
    }
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
}
```

## Errors

| `WatchError` | When |
| --- | --- |
| `Unsupported(database)` | The client's database is SQLite. |
| `NotConfigured { table, reason }` | The server or the table is not set up: a server setting, the table's publication or replica identity, the replication user's privileges, or a PgBouncer client without `replication_url`. `reason` says what to change. |
| `Decode { table }` | A streamed row could not be decoded into the model, usually because the table changed and the models were not regenerated. |
| `Database(error)` | The connection failed or was lost. |
| `Handler(error)` | The handler returned an error. |
