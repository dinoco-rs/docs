# Recurring workers

A recurring worker runs a task on an interval or on a cron schedule: clean up expired sessions every hour, refresh exchange rates every five minutes, send a digest every weekday at 9:00. With several instances of your service running, each cycle still runs on exactly one of them.

## Registering a recurring worker

```rust
use std::time::Duration;

use rekka::{Queues, RekkaData};

async fn purge_expired_sessions(RekkaData(db): RekkaData<Database>) -> anyhow::Result<()> {
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

The task is an `async fn` that takes only [extractors](/en-us/docs/rekka/queues/handlers#extractors) (up to eight) and returns `()` or `Result<(), E>` where `E` implements `Display`. There is no job, and asking for a `JobHandler` makes `start()` fail: a recurring worker is not a queue.

| Method | Default | What it controls |
| --- | --- | --- |
| `interval(duration)` | 60 s | Time between the starts of two runs. At least 10 ms. |
| `cron_time(expr)` | | Runs at the instants of a cron expression instead of an interval. See [Cron schedules](#cron-schedules). |
| `timezone(tz)` | UTC | Time zone the cron expression is evaluated in. |
| `lease(duration)` | 30 s | How long another instance waits before taking over from one that stopped responding. At least 100 ms. |
| `max_future_size(bytes)` | The builder's, 16 KiB | Largest task future before `start()` warns. See [Handler future size](/en-us/docs/rekka/queues/handlers#handler-future-size). |
| `build_fn(task)` | | Finishes the configuration. |

The name identifies the schedule in Redis, so it must be unique, cannot contain `{` or `}`, and should stay the same across deploys.

## Cron schedules

`cron_time` takes a cron expression in the same format as `node-cron` (the `cronTime` of the JavaScript `cron` package). It has five fields, or six with seconds first:

```text
┌────────────── second (0-59, optional)
│ ┌──────────── minute (0-59)
│ │ ┌────────── hour (0-23)
│ │ │ ┌──────── day of month (1-31)
│ │ │ │ ┌────── month (1-12 or jan-dec)
│ │ │ │ │ ┌──── day of week (0-7 or sun-sat; 0 and 7 are Sunday)
* * * * * *
```

```rust
use chrono::FixedOffset;

let queues = Queues::new(redis_url)
    .register_recursive("refresh_rates", |w| w.cron_time("*/2 * * * *").build_fn(refresh_rates))
    .register_recursive("heartbeat", |w| w.cron_time("*/10 * * * * *").build_fn(heartbeat))
    .register_recursive("daily_digest", |w| {
        w.cron_time("0 30 9 * * mon-fri")
            .timezone(FixedOffset::west_opt(3 * 3600).unwrap())
            .build_fn(send_digest)
    })
    .start()
    .await?;
```

| Expression | Runs |
| --- | --- |
| `* * * * *` | Every minute, at second 0. |
| `*/2 * * * *` | Every 2 minutes. |
| `*/10 * * * * *` | Every 10 seconds. |
| `0 30 9 * * 1-5` | At 09:30:00, Monday to Friday. |
| `0 0 1 * *` | At midnight on the first day of every month. |
| `0 8,12,18 * * *` | At 08:00, 12:00, and 18:00. |
| `10-30/10 * * * *` | At minutes 10, 20, and 30 of every hour. |

Each field accepts `*`, a value (`5`), a range (`1-5`), a list (`1,15,30`), and a step over `*`, a range, or a starting value (`*/2`, `10-30/5`, `5/15`). Month and weekday names are case-insensitive, short or long (`jan`, `january`, `mon`, `monday`). As in standard cron, when both the day of month and the day of week are restricted (neither starts with `*`), a day matches if either one does.

- **Never at startup.** Unlike `interval`, a cron worker does not run when the service starts. The first instance to start schedules the next instant of the expression, and every instance waits for it.
- **One clock.** The next instant is computed from the Redis clock, so instances with drifting clocks still agree on it.
- **Time zone.** Expressions are evaluated in UTC. Pass any `chrono::TimeZone` to `timezone`: `chrono::FixedOffset`, `chrono::Local`, or a zone from the `chrono-tz` crate such as `chrono_tz::America::Sao_Paulo`. Use the same zone on every instance. A local time skipped by a daylight saving change does not run that day; a repeated one runs once.
- **Validated at startup.** An invalid expression, or one that can never match such as `0 0 30 2 *`, makes `start()` fail with `RekkaError::InvalidConfig`.
- **Missed instants.** If a run is still going when the next instant arrives, the next run starts as soon as it finishes. If every instance was down, at most one late run happens when the first one comes back.

`interval` and `cron_time` replace each other: the last one called wins.

## How runs are scheduled

- **One instance per cycle.** Before running, an instance takes a lock in Redis and sets the next run time for everyone. The other instances see the schedule and wait.
- **Interval from start to start.** With `interval`, the next run is scheduled when a run starts. If a run takes longer than the interval, the next one waits for it to finish: runs never overlap.
- **First start runs right away.** With `interval`, when no schedule exists in Redis yet, the first instance to start runs the task immediately. After that, every instance follows the shared schedule, so a restart or a deploy does not trigger an extra run.
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

For periodic work at wall-clock times, use [`cron_time`](#cron-schedules). For one-off work at a given time, enqueue a job with `RekkaClient::schedule`.
