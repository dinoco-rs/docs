# API reference

Every public item of the `rekka` crate, grouped by what you use it for. Each section links to the guide page that explains it in context.

## Queues and QueuesBuilder

`Queues::new(redis_url)` returns a `QueuesBuilder`; `start()` returns the running `Queues`. See [Configuration](/en-us/docs/rekka/operations/configuration).

| `QueuesBuilder` method | Description |
| --- | --- |
| `prefix(impl Into<String>)` | Key prefix (default `rekka`). |
| `data<T>(T)` / `data_arc<T>(Arc<T>)` | Shared value for `RekkaState<T>`. |
| `on_event(Fn(JobEvent))` | Event handler. |
| `register::<J>(FnOnce(RekkaWorker<J>) -> Worker<J>)` | Worker for the queue of `J`. |
| `register_recursive(&'static str, FnOnce(RekkaRecursiveWorker) -> RecursiveWorker)` | Recurring worker. |
| `with_reconcile(TaskFn, Duration)` | Reconcile function. |
| `completed_ttl(Duration)` | Lifetime of "recently completed" markers (default 60 s). |
| `cleanup_interval(Duration)` | Janitor interval (default 10 min). |
| `poll_interval(Duration)` | Longest wait between queue checks (default 1 s). |
| `shutdown_timeout(Duration)` | Limit for graceful shutdown (default: none). |
| `handle_signals(bool)` | Stop `join()` on SIGINT/SIGTERM (default `true`). |
| `connection_timeout(Duration)` / `response_timeout(Duration)` | Redis timeouts (default 5 s each). |
| `start() -> Result<Queues>` | Validates, connects, and starts everything. |

| `Queues` method | Description |
| --- | --- |
| `immediate(J) -> Result<Enqueued>` | Enqueue to run now. |
| `schedule(J, DateTime<Utc>) -> Result<Enqueued>` | Enqueue to run at an instant. |
| `schedule_in(J, Duration) -> Result<Enqueued>` | Enqueue to run after a delay. |
| `immediate_many(impl IntoIterator<Item = J>) -> Result<Vec<Enqueued>>` | Enqueue many to run now. |
| `remove::<J>(impl ToTaskId) -> Result<Removed>` | Remove a job. |
| `state::<J>(impl ToTaskId) -> Result<Option<JobState>>` | State of a job. |
| `stats::<J>() -> Result<QueueStats>` | Counters of a queue. |
| `purge::<J>() -> Result<u64>` / `purge_queue(&str) -> Result<u64>` | Delete a whole queue. |
| `client() -> &RekkaClient` | The client. |
| `cache() -> Cache` | A cache sharing the connection and prefix. |
| `join() -> Result<()>` | Wait for shutdown (and signals), then drain. |
| `shutdown() -> impl Future<Output = Result<()>>` | Start a graceful shutdown and wait for it. |
| `abort()` | Stop everything immediately. |
| `is_running() -> bool` | Whether shutdown has not started. |

## RekkaWorker

Received by the closure passed to `register`. See [Workers](/en-us/docs/rekka/queues/workers).

| Method | Description |
| --- | --- |
| `retry(RetryPolicy)` | Retry policy (default `RetryAfterRange(1s, 30s)`). |
| `max_attempts(u32)` | Total runs including the first (default 10). |
| `unlimited_attempts()` | No attempt limit. |
| `concurrency(usize)` | Parallel jobs per process (default 1). |
| `concurrency_by_key(Fn(&J) -> impl ToString)` | One running job per key across all processes. |
| `timeout(Duration)` | Limit per run. |
| `lease(Duration)` | Lease length (default 30 s, at least 100 ms). |
| `build_fn(JobFn) -> Worker<J>` | Finish with the handler. |

## RekkaRecursiveWorker

Received by the closure passed to `register_recursive`. See [Recurring workers](/en-us/docs/rekka/queues/recurring).

| Method | Description |
| --- | --- |
| `interval(Duration)` | Time between run starts (default 60 s, at least 10 ms). |
| `lease(Duration)` | Takeover delay (default 30 s, at least 100 ms). |
| `build_fn(TaskFn) -> RecursiveWorker` | Finish with the task. |

## RekkaClient and ReconcileHandler

`RekkaClient` has the same enqueue, `remove`, `state`, `stats`, `purge`, `purge_queue`, and `cache` methods as `Queues`. It is cheap to clone and is an extractor. See [Jobs and enqueueing](/en-us/docs/rekka/queues/jobs).

| `ReconcileHandler` method | Description |
| --- | --- |
| `add(J) -> Result<Enqueued>` | Create the job to run now, if it does not exist and did not just complete. |
| `add_at(J, DateTime<Utc>) -> Result<Enqueued>` | Same, to run at an instant. |
| `add_many(impl IntoIterator<Item = J>) -> Result<usize>` | Same, in batches; returns how many were created. |
| `client() -> &RekkaClient` | The client. |

## Handlers

| Item | Description |
| --- | --- |
| `JobHandler` | First handler argument: `queue()`, `task_id()`, `attempt()`, `max_attempts()`, `is_last_attempt()`, and the result builders `success()`, `err(impl Display)`, `cancel()`, `retry_at(DateTime<Utc>)`, `retry_after(Duration)`. |
| `RekkaExecutionResult` | `Success`, `Error(String)`, `Cancel`, `RetryAt(DateTime<Utc>)`, `RetryAfter(Duration)`. |
| `IntoExecutionResult` | Implemented for `RekkaExecutionResult`, `()`, and `Result<T: IntoExecutionResult, E: Display>`. |
| `IntoTaskResult` | Return types of recurring and reconcile tasks: `()` and `Result<(), E: Display>`. |
| `JobFn<J, M>` / `TaskFn<M>` | Implemented for `async fn`s with up to eight extractors; you never implement them yourself. |
| `RetryPolicy` | `RetryImmediate`, `RetryAfterRange(Duration, Duration)`, `Cancel`. |

See [Handlers and extractors](/en-us/docs/rekka/queues/handlers) and [Retries and failures](/en-us/docs/rekka/queues/retries).

## Extractors

| Item | Description |
| --- | --- |
| `FromContext` | Trait for extractors: `from_context(&RekkaContext) -> Result<Self>` and an optional `validate(&RekkaContext) -> Result<()>`. |
| `RekkaContext` | `data::<T>() -> Option<Arc<T>>`, `has_data::<T>() -> bool`, `client() -> &RekkaClient`. |
| `RekkaState<T>` | Registered data; a tuple struct around `Arc<T>` that dereferences to `T`. |
| `RekkaClient`, `Cache`, `ReconcileHandler` | Also extractors. |

## Statuses

| Item | Values |
| --- | --- |
| `Enqueued` | `Created`, `Updated`, `AfterCurrentRun`, `AlreadyExists`, `RecentlyCompleted`. |
| `Removed` | `NotFound`, `Removed`, `DiscardAfterRun`. |
| `JobState` | `Waiting { run_in: Duration, attempts: u32 }`, `Running { attempt: u32 }`, `Blocked { attempts: u32 }`. |
| `QueueStats` | `waiting`, `ready`, `running`, `locked_keys` (all `u64`). |

See [Inspecting and removing jobs](/en-us/docs/rekka/queues/managing-jobs).

## Events

| Item | Description |
| --- | --- |
| `JobEvent` | `source()`, `job_name()`, `kind()`, `task_id()`, `attempt()`, `error()`, `elapsed()`, `retry_in()`, `payload()`, `get_job::<T>()`, `is::<T>()`, and the `is_*` helpers. |
| `JobEventKind` | `Started`, `Succeeded`, `Failed`, `Dead`, `Cancelled`, `Rescheduled`, `Stalled`, `Discarded`. |
| `EventSource` | `Queue`, `Recursive`, `Reconcile`. |

See [Events](/en-us/docs/rekka/queues/events).

## Cache

| Item | Description |
| --- | --- |
| `Cache` | `new(url)`, `builder(url)`, `insert`, `insert_with_ttl`, `insert_many`, `get`, `get_many`, `contains`, `remove`, `remove_many`, `clear`. |
| `CacheBuilder` | `prefix`, `connection_timeout`, `response_timeout`, `connect() -> Result<Cache>`. |
| `RekkaCache` | Trait: `const NAMESPACE: &'static str`, `const TTL: Option<Duration>`, `fn cache_key(&self) -> String`. |

See [Cache types](/en-us/docs/rekka/cache/cache-types) and [Reading and writing](/en-us/docs/rekka/cache/cache-operations).

## Jobs

| Item | Description |
| --- | --- |
| `RekkaQueue` | Trait: `const NAME: &'static str` and `fn task_id(&self) -> String`. Requires `Serialize + DeserializeOwned + Send + 'static`. |
| `ToTaskId` | Converts any `Display` value into a `task_id`. |
| `#[derive(RekkaQueue)]` | Attributes `name`, `crate`, and `task_id` on a field. |
| `#[derive(RekkaCache)]` | Attributes `key` (a field, or a template such as `"payments-{business_id}"`), `ttl`, `name`, and `crate`. |

## Errors

`rekka::Result<T>` is `std::result::Result<T, RekkaError>`. `RekkaError` is non-exhaustive:

| Variant | When |
| --- | --- |
| `Redis(redis::RedisError)` | Redis could not be reached or returned an error. |
| `Serialization(serde_json::Error)` | A job or cache value could not be encoded. |
| `MissingData(&'static str)` | A `RekkaState<T>` without `.data(...)` for `T`. |
| `InvalidConfig(String)` | Invalid builder configuration. |
| `InvalidTaskId` | An empty `task_id`. |
| `InvalidKey` | An empty cache key. |
| `ShutdownTimeout { abandoned: usize }` | Graceful shutdown hit `shutdown_timeout`; `abandoned` jobs went back to their queues. |
| `Protocol(String)` | Redis returned something unexpected. |

## Re-exports

`rekka::chrono` re-exports the `chrono` crate, for `DateTime<Utc>` in `schedule`, `add_at`, and `retry_at`.
