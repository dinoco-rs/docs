# Retries and failures

When a run fails, the worker's retry policy decides whether the job runs again and when. Attempt limits decide when to give up.

## What counts as a failure

A run fails when:

- the handler returns `handler.err(...)` or an `Err(...)`;
- the handler panics (the panic is caught and never takes the worker down);
- the run takes longer than the worker's [`timeout`](/en-us/docs/rekka/queues/workers#timeout);
- the payload in Redis no longer deserializes into the job type;
- an [extractor](/en-us/docs/rekka/queues/handlers#extractors) returns an error.

`handler.cancel()`, `handler.retry_after(...)`, and `handler.retry_at(...)` are not failures.

## Retry policies

Set the policy per worker with `.retry(policy)`:

| Policy | After a failure |
| --- | --- |
| `RetryPolicy::RetryAfterRange(min, max)` | Waits a random time between `min` and `max`, then runs again. The default is `RetryAfterRange(1s, 30s)`. |
| `RetryPolicy::RetryImmediate` | Puts the job back in the queue right away. |
| `RetryPolicy::Cancel` | Never retries: the job is dead after its first failure. |

The random wait spreads retries out, so a downstream service that just came back is not hit by every failed job in the same second.

```rust
use std::time::Duration;

use rekka::RetryPolicy;

.register::<SyncCustomer>(|w| {
    w.retry(RetryPolicy::RetryAfterRange(Duration::from_secs(5), Duration::from_secs(120)))
        .max_attempts(20)
        .build_fn(sync_customer)
})
```

## Attempt limits

`max_attempts(n)` is the total number of runs, counting the first one; the default is 10. When a run fails and the job has used all its attempts, the job is **dead**: Rekka deletes it and emits a `Dead` event with the last error. `unlimited_attempts()` removes the limit.

Inside a handler, `handler.is_last_attempt()` tells you whether an error now would be final. It is `true` on the last allowed attempt and always `true` with `RetryPolicy::Cancel`. Use it to report a failure once instead of on every attempt:

```rust
async fn sync_customer(handler: JobHandler, job: SyncCustomer) -> RekkaExecutionResult {
    match call_crm(&job.customer_id).await {
        Ok(()) => handler.success(),
        Err(error) if handler.is_last_attempt() => {
            alert_on_call(&job.customer_id, &error).await;
            handler.err(error)
        }
        Err(error) => handler.err(error),
    }
}
```

## Rescheduling from the handler

`retry_after(duration)` and `retry_at(instant)` put the job back to run later without applying the retry policy and without a `Failed` event; the event is `Rescheduled`. Use them for "not yet" rather than "this failed": a rate limit that asks you to come back later, or a resource that is not ready.

The attempt counter still goes up on every run, including runs that end in a reschedule. Rescheduling never kills a job by itself, but once the counter has reached `max_attempts`, the next error is final.

## Timeouts and panics

A timeout drops the handler's future and records `job timed out after <duration>`. A panic is caught and recorded as `job panicked: <message>`. Both then follow the retry policy like any other error. Keep in mind that a dropped future stops at its last `.await`; work it already started on other systems is not rolled back.

## Dead jobs

A dead job is deleted from Redis. Rekka does not keep a dead-letter queue, but the `Dead` event carries everything needed to build one:

```rust
.on_event(|event| {
    if event.is_dead() {
        eprintln!(
            "{} {:?} gave up after {} attempts: {:?} (payload: {:?})",
            event.job_name(),
            event.task_id(),
            event.attempt(),
            event.error(),
            event.payload(),
        );
    }
})
```

Write it to your database or log pipeline instead of `stderr`, and re-enqueue the payload once the cause is fixed. See [Events](/en-us/docs/rekka/queues/events).

## Choosing a policy

| Situation | Suggested setup |
| --- | --- |
| Calls to an external API that has outages | `RetryAfterRange` with a wide range and more attempts |
| Fast, local work that rarely fails | The default, or `RetryImmediate` with a low `max_attempts` |
| Work that must not run twice after an error | `RetryPolicy::Cancel` and an alert on `Dead` |
| Work that must eventually happen | `unlimited_attempts()` plus monitoring of `Failed` events |
