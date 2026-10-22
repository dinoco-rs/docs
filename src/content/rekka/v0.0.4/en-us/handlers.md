# Handlers and extractors

A handler is the function a worker runs for each job. It is a plain `async fn`: the first two arguments are the `JobHandler` and the job, and the rest are **extractors** that Rekka fills in from shared state.

## Handler signature

```rust
async fn handler(handler: JobHandler, job: MyJob, extractor_1: E1, /* ... */ extractor_n: En) -> R
```

- Up to eight extractors, each a type that implements [`FromContext`](#writing-your-own-extractor).
- `R` is any [supported return type](#return-types).
- The future must be `Send + 'static`. Closures work too, as long as they are `Fn(JobHandler, MyJob, ...) -> impl Future` and `Send + Sync + 'static`.

## The JobHandler

`JobHandler` describes the current run and builds its result:

| Method | Returns |
| --- | --- |
| `queue()` | The queue name. |
| `task_id()` | The job's `task_id` as a string. |
| `attempt()` | The current attempt, starting at 1. |
| `max_attempts()` | `Some(n)`, or `None` with `unlimited_attempts()`. |
| `is_last_attempt()` | `true` when an error in this run will not be retried. |
| `success()` | Finish the job. |
| `err(reason)` | Fail this run; the [retry policy](/en-us/docs/rekka/queues/retries) decides what happens next. `reason` is anything that implements `Display`. |
| `cancel()` | Finish the job without retrying. |
| `retry_after(duration)` | Run again after `duration`. Not a failure. |
| `retry_at(instant)` | Run again at a `DateTime<Utc>`. Not a failure. |

## Return types

A handler can return:

- `RekkaExecutionResult`, usually built with the `JobHandler` methods above.
- `()`, which always means success.
- `Result<T, E>` where `T` is one of these types and `E` implements `Display`. `Ok(value)` uses `value`'s outcome; `Err(error)` is a failure whose message is `format!("{error:#}")`, so `anyhow` errors keep their whole chain.

`Result<(), E>` is the most convenient for code that uses `?`:

```rust
async fn sync_customer(handler: JobHandler, job: SyncCustomer, client: RekkaClient) -> anyhow::Result<()> {
    let customer = fetch_customer(&job.customer_id).await?; // an Err here is retried
    client.immediate(IndexCustomer { task_id: customer.id.clone() }).await?;
    println!("synced {} on attempt {}", customer.id, handler.attempt());
    Ok(())
}
```

What each outcome does:

| Outcome | Effect | Event |
| --- | --- | --- |
| Success | The job is deleted. | `Succeeded` |
| Error | The retry policy runs it again later, or the job is deleted. | `Failed` or `Dead` |
| Cancel | The job is deleted without retrying. | `Cancelled` |
| `retry_after` / `retry_at` | The job waits and runs again; the retry policy is not applied. | `Rescheduled` |

A handler that panics or exceeds its `timeout` produces an error too, with a message such as `job panicked: ...` or `job timed out after 30s`.

## Extractors

### RekkaData

`RekkaData<T>` gives a handler access to a value you registered with `.data(value)`, typically a database pool, an HTTP client, or configuration:

```rust
use rekka::{JobHandler, Queues, RekkaData};

struct Mailer {
    from: String,
}

async fn send_email(handler: JobHandler, job: SendEmail, RekkaData(mailer): RekkaData<Mailer>) {
    println!("{} -> {} (attempt {})", mailer.from, job.to, handler.attempt());
}

let queues = Queues::new(redis_url)
    .data(Mailer { from: "no-reply@example.com".into() })
    .register::<SendEmail>(|w| w.build_fn(send_email))
    .start()
    .await?;
```

`.data(value)` wraps the value in an `Arc`; use `.data_arc(arc)` when you already have one, for example to share the same pool with your web server. Each type is stored once, so register several values with different types. `RekkaData<T>` dereferences to `T`, and destructuring it with `RekkaData(value)` gives the `Arc<T>`.

If a handler uses `RekkaData<T>` and no `T` was registered, `start()` fails with `RekkaError::MissingData`.

### RekkaClient

`RekkaClient` adds, removes, and inspects jobs of any queue from inside a handler, with the same methods as the `Queues` handle. You don't register anything with `.data(...)` for it: declare the argument and Rekka passes the client of the running `Queues`. It is the way to chain work, where one job enqueues the next or cancels one that is no longer needed:

```rust
async fn charge(handler: JobHandler, job: ChargeInvoice, client: RekkaClient) -> rekka::Result<()> {
    // ... charge the card ...
    client.immediate(SendReceipt { task_id: format!("receipt:{}", job.invoice_id) }).await?;
    client.remove::<PaymentReminder>(format!("reminder:{}", job.invoice_id)).await?;
    Ok(())
}
```

### Cache

`Cache` is the [typed cache](/en-us/docs/rekka/cache/cache-types), using the same Redis connection and key prefix as the queues.

### ReconcileHandler

[`ReconcileHandler`](/en-us/docs/rekka/queues/reconcile#the-reconcilehandler) adds jobs only when they don't exist yet. It is meant for reconcile functions, but works as an extractor anywhere.

## Writing your own extractor

Implement `FromContext` for any `Send + 'static` type. `from_context` runs before each call; `validate` runs once in `start()`, so a missing dependency fails at boot:

```rust
use rekka::{FromContext, RekkaContext, RekkaError};

struct AppConfig {
    dry_run: bool,
}

struct DryRun(bool);

impl FromContext for DryRun {
    fn from_context(cx: &RekkaContext) -> rekka::Result<Self> {
        let config = cx.data::<AppConfig>().ok_or(RekkaError::MissingData("AppConfig"))?;
        Ok(DryRun(config.dry_run))
    }

    fn validate(cx: &RekkaContext) -> rekka::Result<()> {
        if cx.has_data::<AppConfig>() { Ok(()) } else { Err(RekkaError::MissingData("AppConfig")) }
    }
}

async fn send_email(handler: JobHandler, job: SendEmail, DryRun(dry_run): DryRun) -> RekkaExecutionResult {
    if dry_run {
        println!("would send {} to {}", job.template, job.to);
    }
    handler.success()
}
```

`RekkaContext` gives access to registered data (`data::<T>()`, `has_data::<T>()`) and to the client (`client()`). If `from_context` returns an error while a job runs, that run fails with the error's message.
