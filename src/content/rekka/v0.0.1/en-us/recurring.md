# Recurring workers

A recurring worker runs a task on an interval: clean up expired sessions every hour, refresh exchange rates every five minutes, send a daily digest. With several instances of your service running, each cycle still runs on exactly one of them.

## Registering a recurring worker

```rust
use std::time::Duration;

use rekka::{Queues, RekkaState};

async fn purge_expired_sessions(RekkaState(db): RekkaState<Database>) -> anyhow::Result<()> {
    let removed = db.delete_expired_sessions().await?;
    println!("removed {removed} sessions");
    Ok(())
}

let queues = Queues::new(redis_url)
    .data(database)
    .register_recursive("purge_expired_sessions", |w| {
        w.interval(Duration::from_secs(60 * 60)).build_fn(purge_expired_sessions)
    })
    .start()
    .await?;
```

The task is an `async fn` that takes only [extractors](/en-us/docs/rekka/queues/handlers#extractors) (up to eight) and returns `()` or `Result<(), E>` where `E` implements `Display`. There is no `JobHandler` and no job: a recurring worker is not a queue.

| Method | Default | What it controls |
| --- | --- | --- |
| `interval(duration)` | 60 s | Time between the starts of two runs. At least 10 ms. |
| `lease(duration)` | 30 s | How long another instance waits before taking over from one that stopped responding. At least 100 ms. |
| `build_fn(task)` | | Finishes the configuration. |

The name identifies the schedule in Redis, so it must be unique, cannot contain `{` or `}`, and should stay the same across deploys.

## How runs are scheduled

- **One instance per cycle.** Before running, an instance takes a lock in Redis and sets the next run time for everyone. The other instances see the schedule and wait.
- **Interval from start to start.** The next run is scheduled when a run starts. If a run takes longer than the interval, the next one waits for it to finish: runs never overlap.
- **First start runs right away.** When no schedule exists in Redis yet, the first instance to start runs the task immediately. After that, every instance follows the shared schedule, so a restart or a deploy does not trigger an extra run.
- **Takeover.** The running instance renews its lock every `lease / 3`. If it dies, another instance takes over once the lease expires.
- **No retries.** A task that returns an error or panics is logged with `tracing` and emits a `Failed` event; the next run happens at the next cycle as usual.
- **Shutdown.** On graceful shutdown, a running task is allowed to finish. With a [`shutdown_timeout`](/en-us/docs/rekka/operations/lifecycle#shutdown-timeout), it is aborted when the timeout expires.

## Events

Each run emits `Started` and then `Succeeded` or `Failed` through [`on_event`](/en-us/docs/rekka/queues/events), with `EventSource::Recursive` as the source, the worker's name as `job_name()`, the run time in `elapsed()`, and no `task_id`.

## Recurring workers or scheduled jobs

| Use | When |
| --- | --- |
| A recurring worker | The work is periodic and not tied to one entity: sweeps, refreshes, reports. |
| A [scheduled job](/en-us/docs/rekka/queues/jobs#run-at-an-instant) | The work belongs to one entity at one time: "remind customer 42 tomorrow at 9:00". |

Rekka 0.0.1 schedules recurring workers by interval, not by cron expression. For work at exact wall-clock times, a recurring worker can enqueue scheduled jobs with `RekkaClient::schedule`.
