# Concurrency

Rekka has two independent limits: how many jobs of a queue one process runs at once, and how many jobs with the same key run at once across every process.

## Per-process concurrency

`concurrency(n)` sets how many jobs of the queue run at the same time in this process. The default is 1.

```rust
.register::<ResizeImage>(|w| w.concurrency(8).build_fn(resize))
```

The limit is local: each instance of your service has its own `n` slots. Size it for what one process can handle, such as CPU cores for CPU-bound work or connections in your database pool for database-bound work.

## Concurrency per key

`concurrency_by_key(f)` guarantees that at most one job per key runs at a time, **summing every process**. `f` receives the job and returns the key, which can be any type that implements `ToString`:

```rust
#[derive(Serialize, Deserialize, RekkaQueue)]
#[rekka(name = "customer_sync")]
struct SyncCustomer {
    task_id: String,
    customer_id: i64,
}

.register::<SyncCustomer>(|w| {
    w.concurrency(16)
        .concurrency_by_key(|job| job.customer_id)
        .build_fn(sync_customer)
})
```

With this setup, up to 16 syncs run per process, but never two for the same customer, no matter how many instances are running. Jobs for other customers are not held back.

### How waiting works

- When a job's key is busy, the job is **blocked**: it leaves the ready queue and waits in a first-in, first-out list for that key. Its `state` is `JobState::Blocked`, and it does not take one of the worker's slots while it waits.
- When the running job finishes, the key goes to the next blocked job in order, which becomes ready immediately.
- A job that fails and waits for a retry **releases** its key. Other jobs with the same key run in the meantime, and the failed job competes for the key again when its retry is due.
- Enqueueing a blocked job again with a different key moves it to the new key's line.
- If a process dies while holding a key, the key is freed when the job's lease expires.

### When the key is computed

If the worker for the queue is registered in the process that enqueues, the key is computed at enqueue time. A producer that does not register the worker cannot compute it, so the worker computes it when it first picks the job up; if the key is busy at that moment, the job is blocked and the attempt is not counted. The guarantee is the same in both cases.

`queues.stats::<SyncCustomer>().await?.locked_keys` shows how many keys are held right now.

## Combining both limits

The two limits work together: `concurrency` caps the slots in each process, and `concurrency_by_key` decides which jobs may use them. A queue with `concurrency(16)` and a key per customer on four instances runs up to 64 jobs at once, each for a different customer.

> [!TIP]
> Use concurrency per key for anything that must be serialized per entity: syncing an account with an external system, recalculating a balance, or handling the events of one order one at a time.
