# Jobs and enqueueing

A job is a Rust struct that Rekka stores in Redis until a worker runs it. This page covers how to define jobs, how to enqueue them now or later, and what happens when the same job is enqueued twice.

## Defining a job

Derive `RekkaQueue` on a struct with named fields that also derives serde's `Serialize` and `Deserialize`:

```rust
use rekka::RekkaQueue;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, RekkaQueue)]
#[rekka(name = "emails")]
struct SendEmail {
    task_id: String,
    to: String,
    template: String,
}
```

The struct must be `Send + 'static`. Generic structs work too: the derive adds the bounds Rekka needs.

### The task_id

Every job has a `task_id` that identifies it inside its queue. By default the derive uses the field named `task_id`; to use another field, mark it with `#[rekka(task_id)]`:

```rust
use rekka::RekkaQueue;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize, Deserialize, RekkaQueue)]
#[rekka(name = "invoices")]
struct ChargeInvoice {
    #[rekka(task_id)]
    invoice_id: Uuid,
    amount_cents: i64,
}
```

The field can be any type that implements `Display`: `String`, integers, `Uuid`, or your own type. Rekka converts it with `to_string()`. An empty id is rejected when you enqueue, with `RekkaError::InvalidTaskId`.

Pick an id that describes the work, such as `invoice:42` or `welcome:{user_id}`. That is what makes [upserts](#upserts) useful: enqueueing "charge invoice 42" twice can never charge it twice at the same time.

### Queue names

`#[rekka(name = "...")]` sets the queue name. Without it, the name is the struct name in snake_case: `ChargeInvoice` becomes `charge_invoice`. Names cannot contain `{` or `}` (a compile error), and each queue can be registered only once per `Queues`.

The name is part of every Redis key of the queue, so renaming a queue creates a new, empty one. Jobs still waiting under the old name stay there; remove them with [`purge_queue`](/en-us/docs/rekka/queues/managing-jobs#purging-a-queue).

### Derive attributes

| Attribute | Where | What it does |
| --- | --- | --- |
| `#[rekka(name = "emails")]` | Struct | Queue name. Default: struct name in snake_case. |
| `#[rekka(task_id)]` | Field | Marks the id field. Default: the field named `task_id`. |
| `#[rekka(crate = "path")]` | Struct | Path to the `rekka` crate, for re-exports. Default: `::rekka`. |

## Enqueueing

All enqueue methods exist on the `Queues` handle returned by `start()` and on `RekkaClient`. They return a [`Enqueued`](#upserts) status per job.

### Run now

```rust
queues.immediate(SendEmail { task_id: "welcome:42".into(), to: "ana@example.com".into(), template: "welcome".into() }).await?;
```

### Run at an instant

`schedule` takes a `DateTime<Utc>`. Rekka re-exports `chrono`, so you don't need it as a dependency:

```rust
use rekka::chrono::{Duration as ChronoDuration, Utc};

let tomorrow = Utc::now() + ChronoDuration::days(1);
queues.schedule(SendEmail { task_id: "reminder:42".into(), to: "ana@example.com".into(), template: "reminder".into() }, tomorrow).await?;
```

### Run after a delay

`schedule_in` takes a `std::time::Duration`, measured by the Redis clock, so servers with different clocks agree on when the job is due:

```rust
use std::time::Duration;

queues.schedule_in(SendEmail { task_id: "nudge:42".into(), to: "ana@example.com".into(), template: "nudge".into() }, Duration::from_secs(15 * 60)).await?;
```

### Many at once

`immediate_many` sends jobs to Redis in batches of 256 per round trip and returns one status per job, in order:

```rust
let statuses = queues.immediate_many(users.iter().map(|user| SendEmail {
    task_id: format!("digest:{}", user.id),
    to: user.email.clone(),
    template: "digest".into(),
})).await?;
```

## Upserts

Enqueueing a `task_id` that already exists never creates a second job. What happens depends on the state of the existing one:

| Status | When | What Rekka does |
| --- | --- | --- |
| `Enqueued::Created` | No job with this id exists | Adds the job. |
| `Enqueued::Updated` | The job is waiting, scheduled, or [blocked on its key](/en-us/docs/rekka/queues/concurrency#concurrency-per-key) | Replaces the payload, the run time, and the concurrency key, and resets the attempt count. |
| `Enqueued::AfterCurrentRun` | The job is running | Stores the new version and queues it as soon as the current run finishes, whatever its result. |
| `Enqueued::AlreadyExists` | Only from [reconcile](/en-us/docs/rekka/queues/reconcile) | Nothing: the job already exists. |
| `Enqueued::RecentlyCompleted` | Only from [reconcile](/en-us/docs/rekka/queues/reconcile) | Nothing: the job finished less than `completed_ttl` ago. |

`AfterCurrentRun` is how Rekka guarantees that two runs of the same `task_id` never overlap. If the running job fails, the new version still replaces it instead of the failed one being retried. Enqueueing a job that was [removed while running](/en-us/docs/rekka/queues/managing-jobs#removing-a-job) cancels that removal: the new version runs after the current one.

## Where to enqueue from

- **The `Queues` handle.** It is cheap to clone; keep one in your application state.
- **`RekkaClient`.** Get it with `queues.client()`, or receive it as an [extractor](/en-us/docs/rekka/queues/handlers#extractors) in a handler to chain jobs: one job enqueues the next.
- **A producer-only process.** A web server can call `Queues::new(url).start().await?` without registering any worker, and enqueue from there.

> [!NOTE]
> With [`concurrency_by_key`](/en-us/docs/rekka/queues/concurrency#concurrency-per-key), the key is computed at enqueue time only when the worker for that queue is registered in the same process. Otherwise the worker computes it when it first picks the job up. Both give the same guarantee.

## Payload format

Jobs are stored as JSON with `serde_json`. When you change a job struct while jobs are waiting in Redis, keep the change compatible: add new fields with `#[serde(default)]` and avoid renaming or removing fields that waiting jobs still have. A payload that fails to deserialize counts as a failure and goes through the retry policy until the job is dead. For a breaking change, use a new queue name and let the old queue drain.
