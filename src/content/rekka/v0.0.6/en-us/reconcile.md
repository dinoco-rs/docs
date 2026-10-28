# Reconcile

Jobs live in Redis, but the truth about what should be pending usually lives in your database: invoices that still need charging, reports that still need sending. Reconcile closes the gap. It runs a function of yours that re-adds the jobs your database says should exist, without duplicating or interrupting the ones Redis already has.

It covers the cases a queue alone cannot: a Redis restart without persistence, a failover that lost recent writes, or a code path that saved a row and crashed before enqueueing.

## Registering a reconcile function

```rust
use std::time::Duration;

use rekka::{Queues, ReconcileHandler, RekkaData};

async fn reconcile_invoices(handler: ReconcileHandler, RekkaData(db): RekkaData<Database>) -> anyhow::Result<()> {
    for invoice in db.pending_invoices().await? {
        handler.add(ChargeInvoice { invoice_id: invoice.id, amount_cents: invoice.amount_cents }).await?;
    }
    Ok(())
}

let queues = Queues::new(redis_url)
    .data(database)
    .register::<ChargeInvoice>(|w| w.build_fn(charge_invoice))
    .with_reconcile(reconcile_invoices, Duration::from_secs(5 * 60))
    .start()
    .await?;
```

A reconcile function has the same shape as a [recurring task](/en-us/docs/rekka/queues/recurring#registering-a-recurring-worker): extractors in, `()` or `Result<(), E>` out. You can register several with repeated `with_reconcile` calls.

## When it runs

Reconcile uses the same shared schedule as a [recurring worker](/en-us/docs/rekka/queues/recurring#how-runs-are-scheduled): with several instances running, **only one of them runs each cycle**, startup included.

- **Right away when there is no schedule.** When Redis has no schedule for the function yet (a fresh setup, or a Redis that lost its data), the first instance to start runs it immediately. `start()` does not wait for it.
- **Then once per interval, on one instance.** Every instance follows the shared schedule, so starting several instances together, restarting, or deploying never runs it more than once per cycle.
- **Once more when Redis comes back.** While Redis is down, reconcile does not run, and `add` fails instead of going to the [offline buffer](/en-us/docs/rekka/queues/jobs#enqueueing-while-redis-is-down). When Redis answers again, one instance runs it right away, even before its next scheduled time. Instances that saw the same outage within a minute share that one run.
- **Interval from end to start.** Unlike a recurring worker's `interval`, the next run is scheduled only when the current one finishes. With a 5-minute interval, a reconcile that takes 2 minutes starts again 5 minutes after it ended, on whichever instance takes the lock first. While it runs, every heartbeat keeps the next run at least one interval ahead, so if the instance running it dies, another one starts it after the 30-second lease expires and an interval has passed since the last heartbeat.

## The ReconcileHandler

`ReconcileHandler` is an extractor whose methods only **create** jobs:

| Method | Effect |
| --- | --- |
| `add(job)` | Adds the job to run now, if it should be added. |
| `add_at(job, at)` | Adds the job to run at a `DateTime<Utc>`, if it should be added. |
| `add_many(jobs)` | Adds many jobs in batches and returns how many were created. |
| `client()` | The `RekkaClient`, for regular upserts. |

A job is added only when no job with its `task_id` exists in the queue (waiting, scheduled, blocked, or running) and it did not finish less than `completed_ttl` ago. `add` and `add_at` return `Enqueued::Created`, `Enqueued::AlreadyExists`, or `Enqueued::RecentlyCompleted`. Existing jobs are never updated or interrupted.

## Why completed_ttl matters

Reconcile reads your database and then adds jobs. Between the two, a worker can finish one of those jobs. Without protection, reconcile would see it as missing and add it again, and the work would run twice.

To prevent that, Rekka keeps a small marker for every finished job for `completed_ttl` (60 seconds by default), and reconcile does not recreate a job while its marker exists. Set it to more than the time between your handler finishing and your database reflecting it:

```rust
Queues::new(redis_url).completed_ttl(Duration::from_secs(5 * 60))
```

`Duration::ZERO` turns the markers off. Regular enqueues (`immediate`, `schedule`, ...) ignore and clear the marker, so you can always run a job again on purpose.

## Events

Each reconcile run emits `Started` and then `Succeeded` or `Failed` through [`on_event`](/en-us/docs/rekka/queues/events), with `EventSource::Reconcile` as the source and `reconcile` as `job_name()`.
