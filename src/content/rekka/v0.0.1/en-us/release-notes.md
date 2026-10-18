# Rekka v0.0.1

This page tracks what changed release over release. Each entry links to the page that documents the feature in depth.

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
