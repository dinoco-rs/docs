# Inspecting and removing jobs

Besides enqueueing, the `Queues` handle and `RekkaClient` can remove a job, read its state, count what is in a queue, and delete a whole queue. Every method takes the job type as a generic parameter, so it always targets the right queue.

## Removing a job

```rust
use rekka::Removed;

match queues.remove::<SendEmail>("welcome:42").await? {
    Removed::Removed => println!("it was waiting and is gone"),
    Removed::DiscardAfterRun => println!("it is running; its result will be discarded"),
    Removed::NotFound => println!("no such job"),
}
```

| Result | Meaning |
| --- | --- |
| `Removed::Removed` | The job was waiting, scheduled, or blocked on its key, and was deleted. |
| `Removed::DiscardAfterRun` | The job is running. It finishes normally, but its result is ignored: no retry, and a `Discarded` event. A version queued with `AfterCurrentRun` is dropped too. |
| `Removed::NotFound` | No job with this `task_id` exists in the queue. |

`remove` accepts any `Display` id, like the `task_id` field itself: `queues.remove::<ChargeInvoice>(invoice_id)` works with a `Uuid`.

## Checking a job's state

```rust
use rekka::JobState;

match queues.state::<SendEmail>("welcome:42").await? {
    Some(JobState::Waiting { run_in, attempts }) => println!("runs in {run_in:?}, {attempts} attempts so far"),
    Some(JobState::Running { attempt }) => println!("running attempt {attempt}"),
    Some(JobState::Blocked { attempts }) => println!("waiting for its concurrency key ({attempts} attempts so far)"),
    None => println!("not in the queue"),
}
```

`None` means the job does not exist: it was never enqueued, or it already finished. Finished jobs are not kept, see [below](#finished-jobs-are-not-kept).

## Queue statistics

```rust
let stats = queues.stats::<SendEmail>().await?;
println!("{} waiting ({} ready now), {} running, {} keys held", stats.waiting, stats.ready, stats.running, stats.locked_keys);
```

| Field | Meaning |
| --- | --- |
| `waiting` | Jobs in the queue, ready or scheduled for later. Jobs blocked on a concurrency key are not counted. |
| `ready` | Waiting jobs whose run time has arrived. |
| `running` | Jobs a worker is running right now. |
| `locked_keys` | Concurrency keys currently held or reserved. |

`stats` is a single Redis round trip, cheap enough for a metrics endpoint or a health check.

## Purging a queue

```rust
let deleted = queues.purge::<SendEmail>().await?;
let deleted_old = queues.purge_queue("old_emails").await?;
```

`purge` deletes everything a queue has in Redis: waiting, scheduled, and blocked jobs, the state of running jobs (they finish, but their results are ignored), and the queue's indexes. It returns how many jobs existed. `purge_queue` does the same by name, for a queue whose type no longer exists in your code. Both scan incrementally, so they never block Redis.

> [!WARNING]
> A purge is immediate and cannot be undone. The periodic [janitor](/en-us/docs/rekka/operations/reliability#the-janitor) only repairs queues that are registered, so a queue you renamed or deleted stays in Redis until you purge it.

## Finished jobs are not kept

Rekka deletes a job as soon as it finishes, whether it succeeded, was cancelled, or died. The only trace left is a marker that lives for `completed_ttl` (60 seconds by default) so that [reconcile](/en-us/docs/rekka/queues/reconcile) does not recreate it. If you need a history of finished jobs or a dead-letter list, store it yourself from [`on_event`](/en-us/docs/rekka/queues/events).
