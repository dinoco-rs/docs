# Rekka

Rekka is a Rust library for background work on top of Redis: job queues with retries and scheduling, recurring workers, and a typed cache. It is built for services that run on more than one instance. Every state change happens inside one atomic Redis script, running jobs are leased and heartbeated, and a process that crashes never loses or duplicates a job.

> [!NOTE]
> Rekka is part of the Dinoco ecosystem, next to [Dinoco ORM](/en-us/docs/orm/guide/introduction). Rekka is in its first 0.0.x releases: the API may still change before 1.0.

## Why Rekka

- **Jobs are typed structs.** A job is a serde struct that derives `RekkaQueue`. The handler receives that struct, not a JSON blob, and a payload that no longer deserializes goes through the retry policy instead of crashing the worker.
- **Enqueueing is an upsert.** Every job has a `task_id`. Enqueueing the same id again updates the waiting job instead of adding a second one, and a job that is already running gets its new version queued right after the current run. Two runs of the same `task_id` never overlap.
- **Built for many instances.** Leases, recovery of stalled jobs, concurrency per key that holds across every process, and recurring workers that run on exactly one instance per cycle.
- **Nothing new to operate.** Rekka only needs Redis. There is no extra service, dashboard, or database to run.

## What you get

- `#[derive(RekkaQueue)]` for jobs and `#[derive(RekkaCache)]` for cache entries.
- `immediate`, `schedule`, `schedule_in`, and `immediate_many` to enqueue; `remove`, `state`, `stats`, and `purge` to manage queues.
- Workers with concurrency per process, concurrency per key, timeouts, leases, retry policies, and attempt limits.
- Handlers written as plain `async fn`, with extractors for shared state (`RekkaData<T>`), the client, and the cache.
- Recurring workers (`register_recursive`) and a reconcile hook (`with_reconcile`) that restores jobs from your own source of truth.
- One `on_event` hook for every job transition: started, succeeded, failed, dead, cancelled, rescheduled, stalled, and discarded.
- Graceful shutdown on SIGINT and SIGTERM, with an optional timeout.
- A typed cache with TTLs, batch reads and writes, and incremental clearing.

## How the pieces fit

A process configures everything with one builder and starts it:

1. Describe each job as a struct and derive `RekkaQueue`.
2. Register a worker per queue with `Queues::new(redis_url).register::<Job>(...)`, plus any recurring workers and shared data.
3. Call `.start().await?`. You get a `Queues` handle back: enqueue with it from anywhere in your application, and call `join()` to keep working until the process is asked to stop.

The same binary can produce jobs, process them, or both. A web server that only enqueues starts a `Queues` without registering workers; a worker process registers the handlers. Both only need to point at the same Redis and use the same [key prefix](/en-us/docs/rekka/operations/configuration#key-prefix).

## A minimal example

```rust
use rekka::{JobHandler, Queues, RekkaQueue};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, RekkaQueue)]
struct ResizeImage {
    task_id: String,
    width: u32,
}

async fn resize(handler: JobHandler, job: ResizeImage) {
    println!("resizing {} to {}px (attempt {})", job.task_id, job.width, handler.attempt());
}

#[tokio::main]
async fn main() -> rekka::Result<()> {
    let queues = Queues::new("redis://127.0.0.1:6379")
        .register::<ResizeImage>(|w| w.concurrency(4).build_fn(resize))
        .start()
        .await?;

    queues.immediate(ResizeImage { task_id: "avatar:42".into(), width: 256 }).await?;
    queues.join().await
}
```

Without `#[rekka(name = "...")]`, the queue is named after the struct in snake_case, `resize_image` here. A handler that returns `()` always succeeds; [Handlers and extractors](/en-us/docs/rekka/queues/handlers) shows how to report failures and reschedule.

## Requirements

- Rust 1.89 or newer (edition 2024).
- Tokio. `#[tokio::main]` needs the `macros` and `rt-multi-thread` features in your crate.
- `serde` with the `derive` feature: jobs and cache entries are stored as JSON.
- A Redis 6+ server. Rekka 0.0.5 connects to a single Redis endpoint.

## Next steps

- [Quickstart](/en-us/docs/rekka/guide/quickstart): build a worker with retries in five minutes.
- [Coming from BullMQ](/en-us/docs/rekka/guide/coming-from-bullmq): how the concepts you know map to Rekka.
- [Jobs and enqueueing](/en-us/docs/rekka/queues/jobs): `task_id`, upserts, and scheduling in depth.
