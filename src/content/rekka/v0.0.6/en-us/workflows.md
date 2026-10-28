# Workflows

A workflow is a chain of handlers in which each step's output is the next step's input. Every step is its own queue, with its own worker, attempts, and timeouts, and a run can only start through the first step: you enqueue the entry job like any other job, and Rekka moves the run from step to step.

## Defining a workflow

Register a workflow with `register_workflow::<J>`, where `J` is the entry job. The closure receives the same [`RekkaWorker<J>`](/en-us/docs/rekka/queues/workers#worker-options) as `register::<J>`; instead of `build_fn`, you call `start_with` with the first handler, which takes a `J`, and add the following steps with `then`:

```rust
use std::time::Duration;

use rekka::{JobHandler, Queues, RekkaData, RekkaQueue, RetryPolicy, StepResult};
use serde::{Deserialize, Serialize};

/// The entry job: a run starts only by enqueueing it.
#[derive(Serialize, Deserialize, RekkaQueue)]
#[rekka(name = "create_customer")]
struct CreateCustomerJob {
    task_id: String,
    account_id: i64,
    name: String,
    email: String,
}

/// Passed from step to step. It does not need `RekkaQueue`.
#[derive(Serialize, Deserialize)]
struct Customer {
    id: i64,
    account_id: i64,
    email: String,
}

async fn create_customer(job: CreateCustomerJob, RekkaData(db): RekkaData<Database>) -> anyhow::Result<Customer> {
    let id = db.insert_customer(&job.name, &job.email).await?;
    Ok(Customer { id, account_id: job.account_id, email: job.email })
}

async fn validate_customer(customer: Customer, handler: JobHandler) -> StepResult<Customer> {
    if !customer.email.contains('@') {
        return handler.cancel().into(); // the steps after this one never run
    }
    StepResult::Next(customer)
}

async fn send_welcome_email(customer: Customer, RekkaData(mailer): RekkaData<Mailer>) -> anyhow::Result<Customer> {
    mailer.welcome(&customer.email).await?;
    Ok(customer)
}

async fn create_invoice(customer: Customer, RekkaData(db): RekkaData<Database>) -> anyhow::Result<()> {
    db.create_first_invoice(customer.id).await?;
    Ok(())
}

let queues = Queues::new(redis_url)
    .data(db)
    .data(mailer)
    .register_workflow::<CreateCustomerJob>(|w| {
        w.concurrency(4)
            .concurrency_by_key(|job| job.account_id)
            .retry(RetryPolicy::RetryAfterRange(Duration::from_secs(2), Duration::from_secs(60)))
            .max_attempts(8)
            .timeout(Duration::from_secs(30))
            .start_with(create_customer)
            .then(validate_customer)
            .then(send_welcome_email)
            .then(create_invoice)
    })
    .start()
    .await?;
```

Each `then` handler must take the previous step's output as its first argument; a mismatch is a compile error. The `::<CreateCustomerJob>` can be left out, since the `start_with` handler already names the entry job, but then the closure given to `concurrency_by_key` needs its argument type (`|job: &CreateCustomerJob|`).

## Starting a run

```rust
let job = CreateCustomerJob {
    task_id: "signup:42".into(),
    account_id: 7,
    name: "Ana".into(),
    email: "ana@example.com".into(),
};
queues.immediate(job).await?;
```

The entry queue is an ordinary queue: `schedule`, `schedule_in`, `immediate_many`, and [reconcile](/en-us/docs/rekka/queues/reconcile) start runs too, and a producer that does not register the workflow can enqueue the entry job. The other steps cannot be enqueued directly.

The entry job's `task_id` identifies the run in every step. Enqueueing the same `task_id` again is an [upsert](/en-us/docs/rekka/queues/jobs#upserts) on the entry queue, exactly as in a queue registered with `register`.

## Step handlers

### Signature

```rust
async fn step(input: Previous, extractor_1: E1, /* ... */ extractor_n: En) -> R
```

A step handler is a [handler](/en-us/docs/rekka/queues/handlers) whose first argument is the previous step's output instead of a job. That type is stored in Redis as JSON between steps, so it must implement `Serialize` and `DeserializeOwned`; it does not need `RekkaQueue` or a `task_id`. Extractors work as in any handler, `JobHandler` included: `handler.task_id()` is the run's `task_id`, and `handler.attempt()` counts this step's attempts.

### Return types

| Return type | Effect |
| --- | --- |
| `Result<T, E>` | `Ok(value)` finishes the step and `value` is the next step's input. `Err(error)` is a failure, retried by the retry policy. |
| `StepResult<T>` | `StepResult::Next(value)`, or any `RekkaExecutionResult` with `.into()`. See [Stopping a run](#stopping-a-run). |
| `Result<StepResult<T>, E>` | Both: use `?` and still stop or reschedule the run. |
| `()` | The next step receives `()`. |

`E` is any type that implements `Display`, as in job handlers. The last step's output is discarded, so the last handler usually returns `Result<(), E>` or `()`.

### Stopping a run

Turn a `JobHandler` result into a `StepResult` with `.into()`:

| Result | Effect |
| --- | --- |
| `handler.cancel().into()` | The run stops here, without retrying: `Cancelled` event, the following steps never run. |
| `handler.success().into()` | The run ends here as successful: `Succeeded` event, the following steps never run. |
| `handler.err(reason).into()` | A failure of this step, like `Err(reason)`. |
| `handler.retry_after(delay).into()` / `handler.retry_at(instant).into()` | This step runs again later, without counting as a failure. |

A step that uses all of its attempts is **dead** and the run stops there, with a `Dead` event for that step. See [Retries and failures](/en-us/docs/rekka/queues/retries).

## Step options

The options set before `start_with` apply to each step, as if every step had been registered with them:

- `concurrency(n)` is per step and per process: with 4 steps, a process runs up to `4 × n` jobs of the workflow.
- `retry`, `max_attempts`, and `timeout` apply to each run of each step. Attempts count per step: a step that succeeds on its third attempt hands its output to a next step that starts at attempt 1.
- `concurrency_by_key(f)` computes the key once, from the entry job, and the key follows the run through every step: in each step, at most one job per key runs at a time.
- `lease` and `max_future_size` apply to each step's handler.

## How steps are stored

The entry step uses the entry job's queue, `create_customer` here. Step `n`, counting from 1, is the queue `create_customer.n`, the name returned by `handler.queue()`, `JobEvent::job_name()`, and `FutureSize::name()`.

Every step's keys share the entry queue's hash tag (`<prefix>:{create_customer}:n:...`), so finishing a step and enqueueing the next one is a single Redis script: a crash or a Redis outage between the two can delay a run, but the hand-off never loses the next step or enqueues it twice. Each step is still delivered [at least once](/en-us/docs/rekka/operations/reliability#leases-and-heartbeats), like any job, so keep step handlers idempotent. If the entry job is removed while it runs, its result is discarded and the run stops.

> [!WARNING]
> Steps are identified by their position. While runs are in flight, only add steps at the end of a workflow; inserting, removing, or reordering steps changes which handler receives the jobs already waiting in a step. A job whose input no longer deserializes counts as a failure and goes through the retry policy.

## Inspecting a workflow

- `state::<CreateCustomerJob>`, `stats::<CreateCustomerJob>`, and `remove::<CreateCustomerJob>` see only the entry queue. Once a run has moved past the first step, a later step stops it by returning `cancel()`.
- `purge::<CreateCustomerJob>()` deletes the queues of every step and returns how many jobs existed in all of them.
- [Events](/en-us/docs/rekka/queues/events) are emitted per step, with the step's queue name in `job_name()` and the run's `task_id`. `get_job::<CreateCustomerJob>()` reads the job of entry-step events; in later steps, `payload()` is the step's input as JSON.
- The [janitor](/en-us/docs/rekka/operations/reliability#the-janitor) repairs the queues of every registered step.

## Workflows or chained jobs

A handler can also enqueue the next job itself through the [`RekkaClient`](/en-us/docs/rekka/queues/handlers#rekkaclient) extractor. Use a workflow when the work is a fixed sequence: the steps are typed end to end, share one set of options and one `task_id`, and the hand-off from one step to the next is atomic. Enqueue jobs from handlers when the next job depends on the result (branching, fan-out to many jobs) or belongs to a queue with its own life outside the sequence.
