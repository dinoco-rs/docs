# Quickstart

This walkthrough takes you from an empty crate to a worker that processes jobs, retries a failure, and shuts down cleanly. It takes about five minutes.

## Prerequisites

- Rust 1.89 or newer (`rustc --version`).
- A Redis server. To run one locally with Docker:

```bash
docker run -d --name redis -p 6379:6379 redis:7
```

## 1. Create the project

```bash
cargo new rekka-quickstart
cd rekka-quickstart
cargo add rekka@0.0.6
cargo add serde --features derive
cargo add tokio --features macros,rt-multi-thread
```

Rekka stores every job as JSON, so jobs need serde's `Serialize` and `Deserialize`. Tokio runs the workers.

## 2. Define a job

A job is a struct with named fields that derives `RekkaQueue`. Put this in `src/main.rs`:

```rust
use rekka::RekkaQueue;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, RekkaQueue)]
#[rekka(name = "emails")]
struct SendEmail {
    task_id: String,
    to: String,
    subject: String,
}
```

Two things to notice:

- `task_id` identifies the job inside its queue. It can be any type that implements `Display` (`String`, integers, `Uuid`, ...). Enqueueing the same `task_id` again updates the existing job instead of creating a second one.
- `name = "emails"` names the queue in Redis. Without it, the name is the struct name in snake_case (`send_email`).

## 3. Write the handler

A handler is an `async fn` that receives the job first, then the extractors it needs, such as the `JobHandler` of the current run:

```rust
use rekka::{JobHandler, RekkaExecutionResult};

async fn send_email(job: SendEmail, handler: JobHandler) -> RekkaExecutionResult {
    if job.to.is_empty() {
        // Retrying will not fix a missing address: drop the job.
        return handler.cancel();
    }

    if handler.attempt() < 2 {
        // Pretend the SMTP server refused the first attempt.
        return handler.err("smtp connection refused");
    }

    println!("sent {:?} to {} on attempt {}", job.subject, job.to, handler.attempt());
    handler.success()
}
```

`JobHandler` builds the result: `success()` removes the job, `err(...)` hands it to the retry policy, `cancel()` removes it without retrying, and `retry_after(...)` runs it again later without counting as a failure. `attempt()` starts at 1.

## 4. Start the queues

```rust
use std::time::Duration;

use rekka::{Queues, RetryPolicy};

#[tokio::main]
async fn main() -> rekka::Result<()> {
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());

    let queues = Queues::new(redis_url)
        .register::<SendEmail>(|w| {
            w.concurrency(5)
                .retry(RetryPolicy::RetryAfterRange(Duration::from_secs(1), Duration::from_secs(3)))
                .max_attempts(5)
                .build_fn(send_email)
        })
        .start()
        .await?;

    queues
        .immediate(SendEmail { task_id: "welcome:ana".into(), to: "ana@example.com".into(), subject: "Welcome!".into() })
        .await?;

    // Runs until Ctrl+C (SIGINT) or SIGTERM, then waits for running jobs.
    queues.join().await
}
```

`register` takes a closure that configures the worker for one queue: up to five `SendEmail` jobs at once in this process, a random 1–3 second wait between failed attempts, and at most five attempts in total. `start()` connects, checks the configuration, and returns once every worker is running.

## 5. Run it

```bash
cargo run
```

After a second or two:

```text
sent "Welcome!" to ana@example.com on attempt 2
```

The first attempt returned an error, waited between one and three seconds, and the second attempt succeeded. Press Ctrl+C: Rekka stops taking new jobs, waits for the ones that are running, and `join()` returns `Ok(())`.

## 6. See the upsert

Replace the `immediate` call with two calls for the same `task_id` and print what Rekka did:

```rust
let first = queues
    .immediate(SendEmail { task_id: "welcome:bia".into(), to: "bia@example.com".into(), subject: "Welcome!".into() })
    .await?;
let second = queues
    .immediate(SendEmail { task_id: "welcome:bia".into(), to: "bia@example.com".into(), subject: "Welcome, Bia!".into() })
    .await?;

println!("{first:?} then {second:?}");
```

The first call prints `Created`. The second one prints `Updated` if the job was still waiting (its payload was replaced, so only "Welcome, Bia!" is sent), or `AfterCurrentRun` if a worker had already picked it up (the new version runs right after the current run). Either way, two runs of `welcome:bia` never happen at the same time. [Jobs and enqueueing](/en-us/docs/rekka/queues/jobs#upserts) lists every outcome.

## Next steps

- [Workers](/en-us/docs/rekka/queues/workers): every worker option and how jobs are picked up.
- [Handlers and extractors](/en-us/docs/rekka/queues/handlers): share a database pool or the cache with your handlers.
- [Events](/en-us/docs/rekka/queues/events): log, measure, and alert on every job.
