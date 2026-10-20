# Cache types

Rekka's cache stores typed values in Redis. You describe a cached type once, with its key and its time to live, and read it back as that type everywhere.

## Deriving RekkaCache

```rust
use rekka::RekkaCache;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, RekkaCache)]
#[rekka(key = id, ttl = "10m")]
struct Business {
    id: i64,
    name: String,
    plan: String,
}
```

| Attribute | Default | What it does |
| --- | --- | --- |
| `key = field` | The field named `key`, then `id` | The field that identifies an entry. Any `Display` type. |
| `key = "payments-{business_id}"` | | A key built from the struct's fields. See [Dynamic keys](#dynamic-keys). |
| `ttl = 10m`, `ttl = "1h 30m"`, or `ttl = 600000` | No TTL: entries never expire | Time to live: a duration with units, with or without quotes, or a number of milliseconds. |
| `name = "businesses"` | Struct name in snake_case | The namespace in Redis. Cannot contain `:`, `{`, or `}`. |
| `crate = "path"` | `::rekka` | Path to the `rekka` crate, for re-exports. |

A duration combines numbers with the units `ms`, `s`, `m`, `h`, and `d`, with or without quotes: `ttl = 500ms`, `ttl = 30s`, `ttl = 10m`, `ttl = 2h`, `ttl = 7d`, `ttl = 1h30m`. Inside quotes, spaces are allowed: `ttl = "1d 12h"`. A plain number is milliseconds. A zero or malformed TTL is a compile error.

> [!NOTE]
> A struct can derive both `RekkaQueue` and `RekkaCache`. They share `#[rekka(name = "...")]`, so that name becomes both the queue name and the cache namespace.

## Dynamic keys

`key` also accepts a template that builds the key from the struct's own fields. Each `{field}` is replaced with the value of that field:

```rust
#[derive(Serialize, Deserialize, RekkaCache)]
#[rekka(key = "payments-{business_id}", ttl = "5m")]
struct PaymentSummary {
    business_id: i64,
    total_cents: i64,
}
```

`PaymentSummary { business_id: 42, .. }` is stored under the key `payments-42`. With a template that has a single `{field}`, reads take either the field value or the full key:

```rust
let summary = cache.get::<PaymentSummary>(42).await;            // hydrated to "payments-42"
let summary = cache.get::<PaymentSummary>("payments-42").await; // already the full key
```

The same applies to `get_many`, `contains`, `remove`, and `remove_many`. A value that already has the template's shape (starts and ends with its fixed text, with something in place of the field) is used as is; anything else fills the field, with the template's format spec applied (`"inv-{number:06}"` turns `42` into `inv-000042`). Templates with several fields, or with a type-specific format spec such as `{id:x}`, still read by the full key.

| Template | Example | Key |
| --- | --- | --- |
| One field | `"payments-{business_id}"` | `payments-42` |
| Several fields | `"{tenant}:{user_id}"` | `acme:7` |
| A nested field | `"owner-{owner.id}"` | `owner-7` |
| A format spec | `"inv-{number:06}"` | `inv-000042` |
| Literal braces | `"{{v2}}-{id}"` | `{v2}-7` |

Every field in a template must implement `Display` (or whatever its format spec needs). A template without any `{field}`, a field the struct does not have, or `{self.field}` (write `{field}` instead) is a compile error that points at the template. Without braces, `key = "id"` still names a field.

## Key layout

Each entry is one Redis string, stored as JSON under:

```text
<prefix>:cache:<namespace>:<key>
```

With the default prefix, `Business { id: 7, .. }` lives at `rekka:cache:business:7`. An empty key is rejected with `RekkaError::InvalidKey`.

## Implementing the trait by hand

The derive implements `RekkaCache`, which you can also implement yourself when the key needs logic a template cannot express, for example normalizing a value:

```rust
use std::time::Duration;

use rekka::RekkaCache;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Subscriber {
    email: String,
    plan: String,
}

impl RekkaCache for Subscriber {
    const NAMESPACE: &'static str = "subscribers";
    const TTL: Option<Duration> = Some(Duration::from_secs(300));

    fn cache_key(&self) -> String {
        self.email.trim().to_lowercase()
    }
}
```

Reads use the same string: `cache.get::<Subscriber>("ana@example.com")`.

## Getting a Cache

| How | When |
| --- | --- |
| `queues.cache()` or `client.cache()` | You already run queues: the cache shares their connection and key prefix. |
| `cache: Cache` as a handler argument | Inside handlers, recurring workers, and reconcile functions. |
| `Cache::new(redis_url).await?` | A standalone cache with the default options. |
| `Cache::builder(redis_url).prefix("app").connect().await?` | A standalone cache with a custom prefix or timeouts. |

```rust
use std::time::Duration;

use rekka::Cache;

let cache = Cache::builder("redis://127.0.0.1:6379")
    .prefix("billing")
    .connection_timeout(Duration::from_secs(2))
    .response_timeout(Duration::from_secs(2))
    .connect()
    .await?;
```

`Cache` is cheap to clone, and every clone shares one auto-reconnecting connection.

## Changing a cached type

Entries are JSON. When a struct changes and an old entry no longer deserializes, Rekka logs a warning and treats the entry as missing, so `get` returns `None` and your code loads fresh data. A breaking change degrades to cache misses instead of errors. To drop every old entry at once, call [`clear::<T>()`](/en-us/docs/rekka/cache/cache-operations#removing).
