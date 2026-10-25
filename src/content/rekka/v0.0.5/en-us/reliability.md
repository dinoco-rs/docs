# Reliability and scaling

Rekka is meant to run on many instances at once, with Redis as the only coordination point. This page explains the guarantees it gives, what it expects from your handlers, and what it stores in Redis.

## Atomic transitions

Every change to a queue (enqueue, claim, finish, retry, remove, lease renewal, recovery) is one Lua script that Redis runs atomically. There is no read-modify-write from Rust, so two instances can never see a job in a half-updated state. Scripts read the time from Redis itself, so servers with different clocks agree on when a job is due and when a lease expires.

## Leases and heartbeats

When a worker claims a job, the job gets a lease: a deadline, 30 seconds by default. While the handler runs, the worker renews the lease every `lease / 3`. If the process crashes, is killed, or stops responding, the lease expires, and a recovery step that every instance runs (every `lease / 2`, between 100 ms and 5 s) returns the job to the queue with a `Stalled` event.

A recovered job counts the lost run as an attempt. If that was its last attempt, it is dead instead; if it had been removed, it is discarded.

> [!WARNING]
> Delivery is **at least once**. A worker that stalls past its lease and then finishes will see its result ignored (Rekka rejects completions from runs that lost their lease), but whatever the handler already did, such as calling an API, has happened, and the job runs again elsewhere. Make handlers idempotent: check whether the work was already done, or use idempotency keys with external services.

## Notifications and polling

When a job becomes ready, the script that changed it publishes a notification on the queue's Redis channel, and idle workers wake up immediately. Workers also re-check the queue when the next scheduled job is due and at least every `poll_interval`, so a lost notification or a dropped subscription only adds latency, never stuck jobs. See [Redis outages and crashes](#redis-outages-and-crashes) for how the subscription recovers.

## The janitor

In normal operation nothing is left behind: finished jobs are deleted at once, markers and helper keys expire on their own, and empty structures disappear. The janitor is a safety net for inconsistent state caused by manual edits, partial restores, or bugs. Every `cleanup_interval` (10 minutes by default), one instance per set of registered queues:

- puts back in the queue jobs that are waiting but missing from the queue index;
- marks for recovery running jobs that lost their lease entry;
- frees concurrency keys whose holder is gone and moves blocked jobs forward;
- deletes corrupted job records and index entries that point to nothing.

It only touches the queues registered in that process (queues of other services sharing the prefix are left alone), works incrementally with short pauses so it uses a small fraction of Redis' CPU, and does not run at startup.

## Redis outages and crashes

Rekka keeps working through a Redis outage and picks up where it left off when Redis returns. Nothing needs to restart.

- **Enqueues are kept.** While Redis is down, `immediate`, `schedule`, `schedule_in`, and `immediate_many` save the jobs to a local file and return `Enqueued::Buffered`; they are sent, in order, when Redis is back, and only run after reaching it. See [Enqueueing while Redis is down](/en-us/docs/rekka/queues/jobs#enqueueing-while-redis-is-down).
- **Other calls fail fast.** `Cache::get` reads `None`, and `remove`, `state`, `stats`, and cache writes fail right away instead of waiting through a series of reconnection attempts; the next call tries to reconnect. A cache write made during an outage is never applied later. Your handlers and HTTP routes never hang on an unreachable Redis longer than `connection_timeout`.
- **Reconnection.** Every command goes through a connection that reconnects on its own. A connection that stops answering without closing (a failover to another address, a network partition) is replaced after two `response_timeout`s in a row, instead of waiting minutes for the operating system to give up on it.
- **Notifications come back.** The notification subscription reconnects with backoff and is checked with a `PING` every `2 × response_timeout` (between 1 s and 30 s), so a silent subscription is replaced too. Workers keep polling meanwhile, and every queue is checked again as soon as the subscription is back.
- **Workers back off.** While Redis is unreachable, claims, recovery, and recurring schedules fail with a warning and retry with exponential backoff (50 ms up to 5 s). Scripts flushed by a Redis restart are loaded again on first use.
- **Running jobs keep their result.** A job that finishes during an outage keeps retrying its completion until Redis answers, so its result is not lost. If the outage outlasts the lease, another instance may recover and run the job again: delivery stays at least once.
- **Recurring locks are taken back.** If a recurring worker's lock expires while its task is still running, the next heartbeat takes it back (when no other instance holds it), so the schedule does not start a second, concurrent run. A running reconcile also keeps its next run at least one interval ahead on every heartbeat, so even with the lock lost, no other instance starts one until an interval after its last heartbeat. A run that ends during an outage keeps trying to release its lock until Redis answers, so the lease does not hold back the next run.
- **Reconcile runs when Redis is back.** It does not run during an outage; when Redis answers again, one instance runs it once, even before its scheduled time. See [When it runs](/en-us/docs/rekka/queues/reconcile#when-it-runs).
- **Redis restarts without persistence.** Keys and scripts are gone: scripts are loaded again, recurring schedules are created again (an `interval` worker and reconcile run right away), and [reconcile](/en-us/docs/rekka/queues/reconcile) re-adds the jobs your database says should exist.
- **Shutting down during an outage.** The loops stop at once. Jobs still running wait for Redis to report their result, up to [`shutdown_timeout`](/en-us/docs/rekka/operations/lifecycle#shutdown-timeout) when one is set; past it they are abandoned and come back through their lease.
- **Handler crashes.** A handler that panics fails that attempt and follows the retry policy. An error or panic in an `on_event` hook is caught and never reaches the worker.
- **Internal crashes.** If one of Rekka's own loops (a queue worker, a recurring worker, the notification listener) ever panics, it is logged and restarted with backoff. Jobs that were running in that loop return to the queue when their lease expires.
- **Startup.** `start()` and `Cache::connect` need Redis to be reachable. They retry for about 5 seconds (Redis may be starting next to the service) and then return `RekkaError::Redis` instead of starting half-configured. Once started, the process never stops because of Redis.
- **Cache reads.** `Cache::get` reads as `None` while Redis is unreachable, so callers fall back to the source of truth.

## What Rekka stores in Redis

All keys of a queue share the hash tag `{queue}`:

| Key | Type | Content |
| --- | --- | --- |
| `<prefix>:{<queue>}:queue` | Sorted set | Waiting jobs, scored by the time they become ready. |
| `<prefix>:{<queue>}:active` | Sorted set | Running jobs, scored by their lease deadline. |
| `<prefix>:{<queue>}:locks` | Hash | Concurrency key to the job that holds it. |
| `<prefix>:{<queue>}:j:<task_id>` | Hash | One job: payload, attempts, state, concurrency key, and a pending next version. |
| `<prefix>:{<queue>}:g:<key>` | List | Jobs blocked on a concurrency key, in order. |
| `<prefix>:{<queue>}:d:<task_id>` | String with TTL | "Recently completed" marker used by reconcile. |
| `<prefix>:{<queue>}:notify` | Pub/sub channel | Wakes up workers when a job becomes ready. |
| `<prefix>:{rec:<name>}:next` and `:lock` | Strings with TTL | Shared schedule and lock of a recurring worker. |
| `<prefix>:cache:<namespace>:<key>` | String | One cache entry, as JSON. |

## Scaling out

- Run as many instances as you need with the same Redis and prefix. Workers on every instance share each queue's jobs.
- `concurrency` is per instance; [`concurrency_by_key`](/en-us/docs/rekka/queues/concurrency#concurrency-per-key) holds across all of them.
- Recurring workers, reconcile, and the janitor run on one instance per cycle, through the same shared schedule and lock in Redis.
- Redis is the single source of truth for queued jobs. Enable persistence (AOF) if losing queued jobs on a Redis restart is not acceptable, and use [reconcile](/en-us/docs/rekka/queues/reconcile) to rebuild queues from your database.
