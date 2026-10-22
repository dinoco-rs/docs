# Rekka v0.0.4

This page tracks what changed release over release. Each entry links to the page that documents the feature in depth.

## v0.0.4

- **Reconcile waits for the previous run.** The `with_reconcile` interval now counts from the end of the previous run, not its start: while a reconcile is running, the next one is not scheduled, so a reconcile slower than its interval no longer runs back to back. It still runs on only one instance per cycle, startup included, and every heartbeat keeps the next run an interval ahead, so losing the lock in the middle of a run (Redis down for longer than the lease) does not start a second run on another instance. See [When it runs](/en-us/docs/rekka/queues/reconcile#when-it-runs).
- **Enqueues survive Redis outages.** While Redis is down, `immediate`, `schedule`, `schedule_in`, and `immediate_many` save the jobs to a local file and return the new `Enqueued::Buffered`. They are sent to Redis in order as soon as it answers, survive a restart of the process, and never run before reaching Redis. The directory is set with `buffer_dir` (default `<temp>/rekka`) and the buffer is turned off with `disable_buffer()`. See [Enqueueing while Redis is down](/en-us/docs/rekka/queues/jobs#enqueueing-while-redis-is-down).
- **Reconcile runs when Redis is back.** Reconcile does not run during an outage and never uses the buffer; when Redis answers again, one instance runs it right away, even before its next scheduled time. See [When it runs](/en-us/docs/rekka/queues/reconcile#when-it-runs).
- **Other calls fail fast while Redis is down.** `remove`, `state`, `stats`, and the cache now fail (or read `None`) right away during an outage instead of blocking for several seconds of reconnection attempts, and cache writes are never applied later. The next call reconnects. See [Redis outages and crashes](/en-us/docs/rekka/operations/reliability#redis-outages-and-crashes).
- **Silent connections are replaced.** A connection that stops answering without closing, as after a failover to another address or a network partition, is replaced after two response timeouts in a row instead of timing out for minutes. The notification subscription is checked with a periodic `PING` and replaced the same way, so jobs are picked up immediately again once Redis is back.
- **Breaking: `Enqueued::Buffered`.** `Enqueued` has a new variant; an exhaustive `match` needs an arm for it.
- **Requires Rust 1.89.** The offline buffer locks its files with the standard library's file locks.

## v0.0.3

- **Breaking: `RekkaState` is now `RekkaData`.** The extractor for values registered with `.data(value)` is named after the method that registers them. Replace `RekkaState` with `RekkaData` in imports and handler signatures (`RekkaData(db): RekkaData<Db>`); it works exactly as before. See [RekkaData](/en-us/docs/rekka/queues/handlers#rekkadata).

## v0.0.2

- **Cron schedules.** `cron_time("*/2 * * * *")` runs a recurring worker at the instants of a cron expression, in the `node-cron` format: five fields, or six with seconds first, with ranges, lists, steps, and month and weekday names. It is evaluated in UTC by default or in any `chrono` time zone with `timezone(...)`, from the Redis clock, so every instance agrees. Unlike `interval`, it never runs at startup. See [Cron schedules](/en-us/docs/rekka/queues/recurring#cron-schedules).
- **Hydrated cache keys.** With a single-field template such as `#[rekka(key = "session:{session_id}")]`, `get`, `get_many`, `contains`, `remove`, and `remove_many` accept the field value (`cache.get::<Session>(42)`) as well as the full key (`"session:42"`). See [Dynamic keys](/en-us/docs/rekka/cache/cache-types#dynamic-keys).
- **Breaking: `get` returns `Option<T>`.** `Cache::get` no longer returns a `Result`. A miss, an invalid key, an incompatible entry, or an unreachable Redis all read as `None`, and the error is logged with `tracing`. Drop the `?` or the `match` on the result. Other cache methods still return `rekka::Result`. See [Reading](/en-us/docs/rekka/cache/cache-operations#reading).
- **Shutdown takes nothing new.** A shutdown that starts while a claim is in flight returns those jobs to the queue without running them or counting an attempt, so jobs that other servers enqueue during shutdown always go to the instances that are still running. See [Shutting down from code](/en-us/docs/rekka/operations/lifecycle#shutting-down-from-code).
- **Apache-2.0 only.** Rekka is now licensed under the Apache License 2.0 alone (it was MIT or Apache-2.0).
- **Sturdier under failures.** The internal loops (queue workers, recurring workers, the notification listener) restart if they ever panic instead of stopping silently, and a recurring worker whose lock expired while it was still running (a Redis outage longer than the lease, or a restart without persistence) takes the lock back so no other instance starts a concurrent run. See [Redis outages and crashes](/en-us/docs/rekka/operations/reliability#redis-outages-and-crashes).

## v0.0.1

The first public release of Rekka.

- **Typed jobs with upserts.** `#[derive(RekkaQueue)]` turns a serde struct into a job. Its `task_id` makes every enqueue an upsert: a waiting job is updated, and a running job gets its new version queued right after the current run. See [Jobs and enqueueing](/en-us/docs/rekka/queues/jobs).
- **Workers.** Concurrency per process, retry policies, attempt limits, timeouts, and leases, configured per queue. Handlers are plain `async fn` with extractors for shared state, the client, and the cache. See [Workers](/en-us/docs/rekka/queues/workers) and [Handlers and extractors](/en-us/docs/rekka/queues/handlers).
- **Concurrency per key.** At most one running job per key across every instance, with waiting jobs handed the key in order. See [Concurrency](/en-us/docs/rekka/queues/concurrency).
- **Recurring workers and reconcile.** Interval tasks that run on one instance per cycle, and a hook, scheduled the same way, that re-adds the jobs your source of truth says should exist. See [Recurring workers](/en-us/docs/rekka/queues/recurring) and [Reconcile](/en-us/docs/rekka/queues/reconcile).
- **Events.** One `on_event` hook for every job transition. See [Events](/en-us/docs/rekka/queues/events).
- **Typed cache.** `#[derive(RekkaCache)]` with a TTL and a key that is a field or a template built from the struct's fields (`"payments-{business_id}"`), single and batch reads and writes, and incremental clearing. See [Cache types](/en-us/docs/rekka/cache/cache-types).
- **Operations.** Graceful shutdown on SIGINT and SIGTERM, recovery of stalled jobs, and a periodic janitor that repairs inconsistent state. See [Startup and shutdown](/en-us/docs/rekka/operations/lifecycle) and [Reliability and scaling](/en-us/docs/rekka/operations/reliability).
- Requires Rust 1.88 or newer and a Redis 6+ server.
