# Startup and shutdown

A `Queues` handle has a simple life: `start()` brings everything up, the handle is used to enqueue while the process runs, and a graceful shutdown lets running jobs finish before the process exits.

## Starting

`start()` checks the [configuration](/en-us/docs/rekka/operations/configuration#validation-at-startup), connects to Redis, loads Rekka's Lua scripts, checks that every extractor has what it needs, and spawns the workers, recurring workers, and the notification listener. It returns as soon as everything is running.

The returned `Queues` is cheap to clone. Keep it in your application state and enqueue from request handlers.

## Waiting with join

`join()` blocks until shutdown is requested, then stops taking new jobs and waits for the running ones:

```rust
let queues = Queues::new(redis_url)
    .register::<SendEmail>(|w| w.build_fn(send_email))
    .start()
    .await?;

queues.join().await // returns on Ctrl+C or SIGTERM
```

By default, `join()` stops on SIGINT (Ctrl+C) and SIGTERM (what Docker and Kubernetes send). Turn that off with `handle_signals(false)` when your application already handles signals and calls `shutdown()` itself.

## Shutting down from code

`shutdown()` starts a graceful shutdown immediately, even before you `.await` it, and returns a future that completes when every running job has finished:

```rust
let queues = Queues::new(redis_url)
    .handle_signals(false)
    .register::<SendEmail>(|w| w.build_fn(send_email))
    .start()
    .await?;

let for_requests = queues.clone();
// ... start your web server with `for_requests` in its state ...

tokio::signal::ctrl_c().await.expect("listen for Ctrl+C");
// ... stop the web server first, so nothing enqueues during shutdown ...
queues.shutdown().await?;
```

After shutdown starts, workers claim nothing new, recurring workers stop scheduling, and `is_running()` returns `false`. Enqueueing still works while the connection is open.

## Shutdown timeout

Without a limit, graceful shutdown waits as long as running jobs take. `shutdown_timeout(duration)` caps it: jobs still running when the time is up are aborted and put back in the queue right away, so another instance picks them up without waiting for their lease. `join()` and `shutdown()` then return `RekkaError::ShutdownTimeout { abandoned }` with the number of jobs returned.

```rust
Queues::new(redis_url).shutdown_timeout(Duration::from_secs(25))
```

Set it a little below the grace period of your platform, such as Kubernetes' `terminationGracePeriodSeconds`, so Rekka returns the jobs itself before the process is killed.

## Aborting

`abort()` stops everything at once, as if the process had died. Running jobs are not returned to the queue; other instances recover them when their leases expire. Use it in tests, or when the process must stop immediately.

## Checklist for production

- Call `join()` or `shutdown()` before the process exits, so running jobs finish.
- Set `shutdown_timeout` below your platform's kill deadline.
- Keep handlers idempotent: a job can run again after a crash. See [Reliability and scaling](/en-us/docs/rekka/operations/reliability#leases-and-heartbeats).
