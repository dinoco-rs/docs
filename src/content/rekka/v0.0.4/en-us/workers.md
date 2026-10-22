# Workers

A worker takes jobs from one queue and runs your handler for each of them. You register workers on the builder, before `start()`.

## Registering a worker

`register` takes the job type and a closure that receives a `RekkaWorker`, configures it, and finishes with `build_fn(handler)`:

```rust
use std::time::Duration;

use rekka::{Queues, RetryPolicy};

let queues = Queues::new(redis_url)
    .register::<SendEmail>(|w| {
        w.concurrency(10)
            .retry(RetryPolicy::RetryAfterRange(Duration::from_secs(2), Duration::from_secs(60)))
            .max_attempts(8)
            .timeout(Duration::from_secs(30))
            .build_fn(send_email)
    })
    .register::<ResizeImage>(|w| w.concurrency(2).build_fn(resize))
    .start()
    .await?;
```

Each queue can have one worker per `Queues`. Registering the same job type twice makes `start()` fail with `RekkaError::InvalidConfig`.

## Worker options

| Method | Default | What it controls |
| --- | --- | --- |
| `retry(policy)` | `RetryAfterRange(1s, 30s)` | What happens after a failure. See [Retries and failures](/en-us/docs/rekka/queues/retries). |
| `max_attempts(n)` | `10` | Total runs, counting the first one. When they run out, the job is dead. |
| `unlimited_attempts()` | | Removes the attempt limit: the job is retried until it succeeds, is cancelled, or is removed. |
| `concurrency(n)` | `1` | Jobs of this queue running at the same time **in this process**. |
| `concurrency_by_key(f)` | None | At most one running job per key **across all processes**. See [Concurrency](/en-us/docs/rekka/queues/concurrency). |
| `timeout(duration)` | None | Longest a single run may take. A run that exceeds it counts as a failure. |
| `lease(duration)` | `30s` | How long a job stays assigned to a process that stops responding. See [below](#lease). |
| `build_fn(handler)` | | Finishes the configuration with the [handler](/en-us/docs/rekka/queues/handlers). |

### Concurrency

`concurrency(n)` is a limit per process. Three instances of a service that registers `concurrency(10)` run up to 30 jobs of that queue at once. To limit work across every instance, for example one sync per customer, use [`concurrency_by_key`](/en-us/docs/rekka/queues/concurrency#concurrency-per-key).

### Timeout

`timeout(duration)` cancels the handler's future when the run takes longer than `duration` and records an error such as `job timed out after 30s`, which goes through the retry policy. Without a timeout, a run can take as long as it needs; its lease keeps being renewed while it runs.

### Lease

While a job runs, its process renews the job's lease every `lease / 3`. If the process dies or stops responding, the lease expires and any instance returns the job to the queue, with a `Stalled` event. A shorter lease brings a crashed job back sooner; a longer one tolerates longer pauses, such as a blocked async runtime. The lease must be at least 100 ms. [Reliability and scaling](/en-us/docs/rekka/operations/reliability#leases-and-heartbeats) explains what this means for your handlers.

## How a worker picks up jobs

- **Atomically.** A worker claims up to as many ready jobs as it has free slots (at most 128 per round trip) in one Redis script, which marks them as running with a fresh lease. Two workers can never claim the same job.
- **Without delay.** When a job becomes ready, Rekka publishes a notification on the queue's Redis channel and idle workers wake up immediately. Workers also check the queue at the time the next scheduled job is due and every `poll_interval` (1 second by default), so they keep working if notifications are lost.
- **One task per job.** Each claimed job runs in its own Tokio task, and the handler's future is not boxed.

## Producers and workers in different processes

A process that only enqueues does not register workers:

```rust
// web server: only produces jobs
let queues = Queues::new(redis_url).start().await?;
queues.immediate(SendEmail { task_id: "welcome:42".into(), to: "ana@example.com".into(), template: "welcome".into() }).await?;
```

A worker process registers the handlers and calls `join()`. Both sides only need the same Redis, the same [key prefix](/en-us/docs/rekka/operations/configuration#key-prefix), and the same job type (or at least a compatible JSON shape and queue name).

## Validation at startup

`start()` checks the configuration before any worker runs, so a mistake fails at boot instead of on the first job:

- `concurrency` and `max_attempts` must be at least 1, and `lease` at least 100 ms.
- Queue names must be unique and cannot contain `{` or `}`.
- Every `RekkaData<T>` used by a handler must have its `T` registered with `.data(...)`. Otherwise `start()` returns `RekkaError::MissingData`.
