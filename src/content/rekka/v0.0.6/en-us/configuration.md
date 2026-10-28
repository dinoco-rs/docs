# Configuration

Everything Rekka does in a process is configured on one builder: `Queues::new(redis_url)` returns a `QueuesBuilder`, and `start()` turns it into a running `Queues` handle.

## The builder

```rust
use std::time::Duration;

use rekka::Queues;

let queues = Queues::new("redis://:secret@redis.internal:6379/0")
    .prefix("billing")
    .data(database)
    .on_event(log_event)
    .register::<ChargeInvoice>(|w| w.concurrency(8).build_fn(charge_invoice))
    .register_recursive("expire_trials", |w| w.interval(Duration::from_secs(3600)).build_fn(expire_trials))
    .with_reconcile(reconcile_invoices, Duration::from_secs(300))
    .shutdown_timeout(Duration::from_secs(30))
    .start()
    .await?;
```

## Options

| Method | Default | What it controls |
| --- | --- | --- |
| `prefix(prefix)` | `"rekka"` | First segment of every Redis key, queues and cache alike. |
| `data(value)` / `data_arc(arc)` | | Shared values for [`RekkaData<T>`](/en-us/docs/rekka/queues/handlers#rekkadata). |
| `on_event(f)` | | The [event](/en-us/docs/rekka/queues/events) handler. |
| `register::<J>(f)` | | A [worker](/en-us/docs/rekka/queues/workers) for the queue of `J`. |
| `register_recursive(name, f)` | | A [recurring worker](/en-us/docs/rekka/queues/recurring). |
| `with_reconcile(f, interval)` | | A [reconcile](/en-us/docs/rekka/queues/reconcile) function, run `interval` after the previous run ends. |
| `completed_ttl(duration)` | 60 s | How long a finished job blocks reconcile from recreating it. `Duration::ZERO` disables it. |
| `cleanup_interval(duration)` | 10 min | Time between [janitor](/en-us/docs/rekka/operations/reliability#the-janitor) passes. At least 10 ms; `Duration::ZERO` disables it. |
| `poll_interval(duration)` | 1 s | Longest a worker waits between checks when no notification arrives. Must be greater than zero. |
| `shutdown_timeout(duration)` | None | Longest graceful shutdown waits for running jobs. See [Startup and shutdown](/en-us/docs/rekka/operations/lifecycle#shutdown-timeout). |
| `handle_signals(bool)` | `true` | Whether `join()` also stops on SIGINT and SIGTERM. |
| `connection_timeout(duration)` | 5 s | Timeout to open a connection to Redis. |
| `response_timeout(duration)` | 5 s | Timeout for each Redis response. Two in a row replace the connection. |
| `buffer_dir(path)` | `<temp>/rekka` | Where enqueues made while Redis is down are kept until it returns. See [Enqueueing while Redis is down](/en-us/docs/rekka/queues/jobs#enqueueing-while-redis-is-down). |
| `disable_buffer()` | | Turns that buffer off: enqueues return the Redis error during an outage. |
| `max_future_size(bytes)` | 16 KiB | Largest handler future before `start()` warns, for workers that don't set their own and for reconcile. See [Handler future size](/en-us/docs/rekka/queues/handlers#handler-future-size). |
| `strict_future_size(bool)` | `false` | Whether an oversized handler future makes `start()` fail instead of logging a warning. |

## Redis URL

`Queues::new` and `Cache::new` take a standard Redis URL: `redis://host:port/db`, with optional credentials as `redis://:password@host:port` or `redis://user:password@host:port`. Rekka opens one auto-reconnecting connection per `Queues`, shared by the cache it returns, plus one for notifications when the process registers workers.

## Key prefix

Every key Rekka writes starts with the prefix: `rekka:{emails}:queue`, `rekka:cache:business:7`, and so on. Use different prefixes to run several applications or environments on one Redis server. A producer and the workers for its jobs must use the **same** prefix, or they will not see each other's queues. The prefix cannot be empty or contain `{` or `}`.

## Validation at startup

`start()` returns an error before running anything when:

- the prefix, a queue name, or a recurring worker's name is invalid, or a name is registered twice (`RekkaError::InvalidConfig`);
- a worker's `concurrency` or `max_attempts` is 0, a `lease` is below 100 ms, or an interval or `poll_interval` is out of range (`RekkaError::InvalidConfig`);
- a handler, recurring worker, or reconcile function uses `RekkaData<T>` without `.data(...)` for `T` (`RekkaError::MissingData`);
- with `strict_future_size(true)`, a handler's future is larger than its `max_future_size` (`RekkaError::InvalidConfig`);
- Redis cannot be reached (`RekkaError::Redis`).

## Connection failures

The connection reconnects on its own: a call made while Redis is down fails at once, and the next one tries again. While Redis is unavailable:

- enqueues go to the [offline buffer](/en-us/docs/rekka/queues/jobs#enqueueing-while-redis-is-down) and are sent when Redis is back;
- workers back off between attempts to claim jobs, from 50 ms up to 5 seconds;
- finishing a job is retried until Redis answers, so a completed job is not run again because of a short outage;
- the notification listener falls back to polling until it can subscribe again.

## Logging

Rekka logs through [`tracing`](https://docs.rs/tracing): warnings for failed claims, lost leases, recovered jobs, failing recurring workers, and handlers whose future is larger than `max_future_size`, and an info line when the janitor repairs something. Install a subscriber such as `tracing-subscriber` in your binary to see them.
