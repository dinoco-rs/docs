# Coming from BullMQ

If you ran background jobs in Node.js, you probably used BullMQ. Rekka solves the same problem in Rust, on the same kind of infrastructure (Redis), so most concepts carry over. This page maps them and points out the differences that matter.

## Concept map

| BullMQ | Rekka |
| --- | --- |
| `new Queue('emails')` | A struct with `#[derive(RekkaQueue)]` and `#[rekka(name = "emails")]` |
| `queue.add(name, data, { jobId })` | `queues.immediate(job)`; the job's `task_id` is its id, and it is required |
| `{ delay: 5000 }` | `queues.schedule_in(job, Duration::from_secs(5))` or `queues.schedule(job, at)` |
| `queue.addBulk([...])` | `queues.immediate_many(jobs)` |
| `new Worker('emails', processor, { concurrency })` | `.register::<SendEmail>(\|w\| w.concurrency(n).build_fn(handler))` |
| `attempts` and `backoff` | `.max_attempts(n)` and `.retry(RetryPolicy::...)` |
| Throwing inside the processor | Returning `handler.err(...)` or an `Err(...)` |
| `UnrecoverableError` | `handler.cancel()`, or `RetryPolicy::Cancel` for the whole queue |
| `job.moveToDelayed(...)` | `handler.retry_after(delay)` or `handler.retry_at(instant)` |
| `FlowProducer` | `register_workflow(\|w\| w.start_with(first).then(next))`, a linear chain of steps; see [Workflows](/en-us/docs/rekka/queues/workflows) |
| Repeatable jobs and job schedulers | `register_recursive(name, \|w\| w.interval(...).build_fn(task))` |
| `worker.on('completed')`, `QueueEvents` | `.on_event(\|event\| ...)` |
| Stalled jobs | Leases: an expired lease returns the job to the queue with a `Stalled` event |
| `queue.remove(jobId)` | `queues.remove::<SendEmail>(task_id)` |
| `queue.getJobCounts()` | `queues.stats::<SendEmail>()` |
| `queue.obliterate()` | `queues.purge::<SendEmail>()` |
| Group concurrency | `.concurrency_by_key(\|job\| job.customer_id)` |
| `worker.close()` | `queues.shutdown().await`, or `queues.join()` with signal handling |

## Differences that matter

### Re-adding a job updates it

In BullMQ, adding a job whose id already exists is ignored: the original job stays as it was. In Rekka, enqueueing an existing `task_id` is an **upsert**. A waiting job gets the new payload and run time, and a running job gets its new version queued right after the current run. Use [reconcile](/en-us/docs/rekka/queues/reconcile) when you want "add only if it does not exist".

### Finished jobs are not kept

BullMQ keeps completed and failed jobs until `removeOnComplete` or `removeOnFail` cleans them up. Rekka deletes a job as soon as it finishes, whatever the outcome, and keeps only a short-lived marker used by reconcile (`completed_ttl`, 60 seconds by default). If you need a history or a dead-letter list, record it from [`on_event`](/en-us/docs/rekka/queues/events).

### Jobs are types, not names plus data

A BullMQ queue can mix job names with different data shapes. A Rekka queue holds exactly one Rust type, and the handler receives that type. A payload that no longer deserializes counts as a failure and goes through the retry policy.

### Every job has an id

BullMQ generates an id when you don't pass one. Rekka always needs a `task_id`, because upserts, `remove`, and `state` are all keyed by it. Use something meaningful (`invoice:42`, `welcome:{user_id}`) or a UUID when every enqueue really is a new job.

### Rescheduling is not a failure

`handler.retry_after(...)` and `handler.retry_at(...)` run the job again later without applying the retry policy. They are the tool for "not yet", for example when a rate limit says to come back in a minute.

### Reconcile has no direct equivalent

[Reconcile](/en-us/docs/rekka/queues/reconcile) runs a function on an interval, on one instance at a time, that re-adds the jobs your database says should exist, without duplicating or interrupting the ones already in Redis. It covers lost Redis data and enqueues that a bug skipped.

## Next steps

- [Quickstart](/en-us/docs/rekka/guide/quickstart) if you haven't run a worker yet.
- [Retries and failures](/en-us/docs/rekka/queues/retries) for the exact retry rules.
- [Recurring workers](/en-us/docs/rekka/queues/recurring) to replace repeatable jobs.
