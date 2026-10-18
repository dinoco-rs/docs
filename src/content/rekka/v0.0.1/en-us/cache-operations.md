# Reading and writing

Every cache method takes the cached type as a generic parameter, so the namespace, the TTL, and the decoding always match the type.

## Writing

```rust
let business = Business { id: 7, name: "Acme".into(), plan: "pro".into() };

cache.insert(&business).await?;                                     // uses the type's TTL
cache.insert_with_ttl(&business, Duration::from_secs(30)).await?;   // overrides it for this write
cache.insert_many(&businesses).await?;                              // many entries, few round trips
```

| Method | Effect |
| --- | --- |
| `insert(&item)` | Writes or replaces the entry, with the type's TTL. |
| `insert_with_ttl(&item, ttl)` | Writes or replaces the entry with a specific TTL. |
| `insert_many(items)` | Writes many entries with the type's TTL, pipelined in chunks of 1,000. Takes any iterator of `&T`. |

## Reading

```rust
let one: Option<Business> = cache.get::<Business>(7).await?;
let many: Vec<Option<Business>> = cache.get_many::<Business>([7, 8, 9]).await?;
let cached: bool = cache.contains::<Business>(7).await?;
```

| Method | Returns |
| --- | --- |
| `get::<T>(key)` | `Some(value)`, or `None` when the entry is missing, expired, or in an incompatible format. |
| `get_many::<T>(keys)` | One `Option<T>` per key, **in the same order** as the keys, read in chunks of 1,000. |
| `contains::<T>(key)` | Whether the entry exists, without reading it. |

Keys are anything that implements `Display`, the same as the key field.

## Removing

```rust
let existed: bool = cache.remove::<Business>(7).await?;
let removed: u64 = cache.remove_many::<Business>([8, 9]).await?;
let cleared: u64 = cache.clear::<Business>().await?;
```

| Method | Returns |
| --- | --- |
| `remove::<T>(key)` | Whether there was an entry to remove. |
| `remove_many::<T>(keys)` | How many of the keys existed. |
| `clear::<T>()` | How many entries of the type were removed. It scans incrementally and never blocks Redis. |

## A read-through helper

The usual pattern is to read from the cache and fall back to the database on a miss:

```rust
async fn business(cache: &Cache, db: &Database, id: i64) -> anyhow::Result<Option<Business>> {
    if let Some(cached) = cache.get::<Business>(id).await? {
        return Ok(Some(cached));
    }

    let Some(fresh) = db.find_business(id).await? else {
        return Ok(None);
    };

    cache.insert(&fresh).await?;
    Ok(Some(fresh))
}
```

After writing to the database, call `cache.remove::<Business>(id)` (or `insert` the new value) so readers don't see stale data until the TTL runs out.

## Errors

Cache methods return `rekka::Result`. Expect `RekkaError::Redis` when Redis is unreachable, `RekkaError::Serialization` when a value cannot be encoded, and `RekkaError::InvalidKey` for an empty key. A value that cannot be decoded is not an error: it reads as `None`.
