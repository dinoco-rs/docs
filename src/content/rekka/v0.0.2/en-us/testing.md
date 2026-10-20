# Testing

Rekka's behavior lives in Redis scripts, so the most useful tests run against a real Redis server. This page shows how to isolate tests, wait for jobs to finish, and keep handlers easy to test.

## Run a Redis for tests

Locally or in CI, a container is enough:

```bash
docker run -d --name redis-test -p 6379:6379 redis:7
```

## Isolate each test with a prefix

Give each test its own [key prefix](/en-us/docs/rekka/operations/configuration#key-prefix). Tests can then run in parallel against the same server without seeing each other's jobs. Also turn off signal handling, which only makes sense in a real process, and shorten the polling interval:

```rust
use std::time::Duration;

use rekka::{Queues, QueuesBuilder};

fn test_queues() -> QueuesBuilder {
    Queues::new(std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into()))
        .prefix(format!("test-{}", uuid::Uuid::new_v4()))
        .handle_signals(false)
        .poll_interval(Duration::from_millis(50))
}
```

## Wait for a job with events

Send events to a channel and wait for the final one:

```rust
use rekka::JobEvent;

#[tokio::test]
async fn sends_the_welcome_email() -> rekka::Result<()> {
    let (events, mut received) = tokio::sync::mpsc::unbounded_channel::<JobEvent>();
    let queues = test_queues()
        .on_event(move |event| {
            let _ = events.send(event);
        })
        .register::<SendEmail>(|w| w.build_fn(send_email))
        .start()
        .await?;

    queues
        .immediate(SendEmail { task_id: "welcome:1".into(), to: "ana@example.com".into(), template: "welcome".into() })
        .await?;

    let finished = loop {
        let event = received.recv().await.expect("the queues stopped");
        if event.is_final() {
            break event;
        }
    };
    assert!(finished.is_success(), "{:?}", finished.error());

    queues.purge::<SendEmail>().await?;
    queues.shutdown().await
}
```

Wrap the loop in `tokio::time::timeout` if you want a stuck job to fail the test instead of hanging it.

## Keep handlers thin

`JobHandler` is created by Rekka, so a handler can only be called through a running worker. Put the business logic in plain functions that take the job's data and your dependencies, and keep the handler as a small adapter that turns their result into a `RekkaExecutionResult`. The logic then gets fast unit tests without Redis, and one integration test per queue covers the wiring.

## Cleaning up

`purge::<J>()` removes everything a queue left in Redis, and `cache.clear::<T>()` does the same for a cache type. A unique prefix per test also means a failed test never affects the next run.

## Rekka's own test suite

The Rekka repository runs its integration suite the same way: every test uses a `rekka-test-*` prefix and deletes its keys at the end.

```bash
REKKA_REDIS_URL=redis://127.0.0.1:6379 cargo test
```
