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

When a job becomes ready, the script that changed it publishes a notification on the queue's Redis channel, and idle workers wake up immediately. Workers also re-check the queue when the next scheduled job is due and at least every `poll_interval`, so a lost notification or a dropped subscription only adds latency, never stuck jobs.

## The janitor

In normal operation nothing is left behind: finished jobs are deleted at once, markers and helper keys expire on their own, and empty structures disappear. The janitor is a safety net for inconsistent state caused by manual edits, partial restores, or bugs. Every `cleanup_interval` (10 minutes by default), one instance per set of registered queues:

- puts back in the queue jobs that are waiting but missing from the queue index;
- marks for recovery running jobs that lost their lease entry;
- frees concurrency keys whose holder is gone and moves blocked jobs forward;
- deletes corrupted job records and index entries that point to nothing.

It only touches the queues registered in that process (queues of other services sharing the prefix are left alone), works incrementally with short pauses so it uses a small fraction of Redis' CPU, and does not run at startup.

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
- Recurring workers and reconcile run on one instance per cycle.
- Redis is the single source of truth for queued jobs. Enable persistence (AOF) if losing queued jobs on a Redis restart is not acceptable, and use [reconcile](/en-us/docs/rekka/queues/reconcile) to rebuild queues from your database.
