# Events

`on_event` registers one function that receives an event for every job transition, in every queue, recurring worker, and reconcile function of the process. Use it for logs, metrics, alerts, and a history of finished jobs.

## Registering a handler

```rust
use rekka::{JobEvent, Queues};

fn log_event(event: JobEvent) {
    if event.is_failure() {
        eprintln!("{} {:?} failed on attempt {}: {:?}", event.job_name(), event.task_id(), event.attempt(), event.error());
    }
}

let queues = Queues::new(redis_url)
    .on_event(log_event)
    .register::<SendEmail>(|w| w.build_fn(send_email))
    .start()
    .await?;
```

The function is synchronous and runs inside the job's task, so keep it fast. A panic inside it is caught and never affects the job. For slow work, such as writing to a database, send the event to a channel and process it elsewhere:

```rust
let (events, mut receiver) = tokio::sync::mpsc::unbounded_channel::<JobEvent>();

tokio::spawn(async move {
    while let Some(event) = receiver.recv().await {
        // store finished jobs, update metrics, page someone...
    }
});

let queues = Queues::new(redis_url)
    .on_event(move |event| {
        let _ = events.send(event);
    })
    // ...
    .start()
    .await?;
```

## Event kinds

| `JobEventKind` | When | Final |
| --- | --- | --- |
| `Started` | A run starts. | |
| `Succeeded` | The run succeeded. | Yes |
| `Failed` | The run failed and will be retried. | |
| `Dead` | The run failed and will not be retried. | Yes |
| `Cancelled` | The handler returned `cancel()`. | Yes |
| `Rescheduled` | The handler returned `retry_after` or `retry_at`. | |
| `Stalled` | The job's lease expired (its process stopped responding) and it went back to the queue. | |
| `Discarded` | The job was removed while it ran, and its result was ignored. | Yes |

Helpers: `is_started()`, `is_success()`, `is_failure()` (`Failed` or `Dead`), `is_dead()`, `is_cancelled()`, `is_retry()` (`Failed`, `Rescheduled`, or `Stalled`), and `is_final()` (the job left the queue for good).

## Event data

| Method | Returns |
| --- | --- |
| `source()` | `EventSource::Queue`, `EventSource::Recursive`, or `EventSource::Reconcile`. |
| `job_name()` | The queue name (`<entry>.<n>` for step `n` of a [workflow](/en-us/docs/rekka/queues/workflows)), the recurring worker's name, or `reconcile`. |
| `kind()` | The `JobEventKind`. |
| `task_id()` | `Some(id)` for queue jobs, `None` for recurring workers and reconcile. |
| `attempt()` | The attempt the event refers to. |
| `error()` | The error message, for failures. |
| `elapsed()` | How long the run took, on final, failed, and rescheduled events. |
| `retry_in()` | How long until the next attempt, when known. |
| `payload()` | The job's JSON payload. |

## Reading the job

`get_job::<T>()` deserializes the payload when the event belongs to the queue of `T`, and returns `None` otherwise. `is::<T>()` only checks the queue:

```rust
fn on_event(event: JobEvent) {
    if event.is_success()
        && let Some(job) = event.get_job::<SendEmail>()
    {
        println!("email {} delivered to {}", job.task_id, job.to);
    }
}
```

Rekka keeps a job's payload in memory during its run only when an `on_event` handler is registered, so processes without one pay nothing for this.
