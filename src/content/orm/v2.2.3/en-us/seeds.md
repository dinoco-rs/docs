# Seeds

Seeds put the rows every environment needs into the database: roles, countries, plans, settings. They are Rust code in `dinoco/seed.rs`, written with the same models and builders as the application, and `dinoco seed` runs them against the database of a workspace.

## Write a seed

Create `dinoco/seed.rs` with a `seed` function. It receives a client already connected to the database:

```rust
// dinoco/seed.rs
use dinoco::DinocoClient;

use super::models::*;

pub async fn seed(client: &DinocoClient) -> dinoco::anyhow::Result<()> {
    dinoco::insert_many::<Role>()
        .values([
            Role::new("admin".to_string(), "Administrator".to_string()),
            Role::new("member".to_string(), "Member".to_string()),
        ])
        .on_conflict_do_nothing(|role| role.id)
        .execute(client)
        .await?;

    Ok(())
}
```

The seed lives inside the generated `dinoco` module, so `super::models::*` (or `super::*`) brings the models in, and `crate::...` reaches the rest of your application: its helpers, constants and anything its crate root imports. After creating the file, run `dinoco models generate` once: the generated `dinoco/mod.rs` then declares it,

```rust
/// `dinoco/seed.rs` (or `dinoco/seed/mod.rs`), run by `dinoco seed`.
pub mod seed;

#[cfg(test)]
#[test]
#[ignore = "run by `dinoco seed`"]
fn __dinoco_seed() -> ::dinoco::anyhow::Result<()> {
    ::dinoco::__run_seed(|client| async move { seed::seed(&client).await })
}
```

so rust-analyzer and `cargo check` analyze the seed with the rest of the application, and a seed that no longer matches the models fails to compile there first. Your application can also call `dinoco::seed::seed(&client)` itself, for example in tests.

## Run the seeds

```bash
dinoco seed
dinoco seed --workspace production
```

`dinoco seed` connects to the database of the workspace, chosen the same way as in [`dinoco migrate run`](/en-us/docs/orm/tooling/cli#dinoco-migrate-run), runs `seed`, and reports the result. An error returned by the seed, or a panic, fails the command with exit code `1` and the message. Run it after the migrations, so every table the seeds write already exists:

```bash
dinoco migrate run --workspace production
dinoco seed --workspace production
```

## Keep seeds idempotent

`dinoco seed` runs every seed every time; it does not record which rows it wrote. Write each seed so that running it again changes nothing, which also makes it safe in a deploy pipeline:

- insert with [`on_conflict_do_nothing`](/en-us/docs/orm/orm/insert#skip-duplicates-and-return-the-existing-row) on a unique field, so rows already there are skipped;
- to also bring existing rows up to date, update them by their unique field with `update_many`;
- to apply all or nothing, wrap the seed in a [transaction](/en-us/docs/orm/orm/transactions) and pass `tx` to the builders.

## Split seeds into files

For more than a few tables, use `dinoco/seed/mod.rs` instead of `dinoco/seed.rs`, with one file per group. Its `seed` runs the others in order: parents before the rows that reference them.

```
dinoco/seed/
├── mod.rs
├── countries.rs
└── roles.rs
```

```rust
// dinoco/seed/mod.rs
mod countries;
mod roles;

pub async fn seed(client: &dinoco::DinocoClient) -> dinoco::anyhow::Result<()> {
    countries::seed(client).await?;
    roles::seed(client).await?;
    Ok(())
}
```

```rust
// dinoco/seed/roles.rs
use super::super::models::*;

pub async fn seed(client: &dinoco::DinocoClient) -> dinoco::anyhow::Result<()> {
    // ...
    Ok(())
}
```

Use one of the two layouts: Rust rejects a module with both `seed.rs` and `seed/mod.rs`.

## How seeds run

A seed is part of your application's crate, so `dinoco seed` runs it there: Cargo compiles the crate's library and binaries for their tests, in your project's target directory and with your dependencies, and runs only the `__dinoco_seed` test of `dinoco/mod.rs`, which connects to the workspace's database and calls `seed` on the multi-threaded Tokio runtime that `#[tokio::main]` builds. Your `main` never runs, and neither do your other tests. Only the package in the current directory is built, even at the root of a workspace. It needs a Rust toolchain wherever `dinoco seed` runs; the first run builds the crate for tests, and later runs only what changed.

Because it is a test build, the crate is compiled with `cfg(test)`: the generated `connect()` returns the in-memory [test database](/en-us/docs/orm/orm/testing) there, so a seed uses the `client` it receives instead of calling `connect()` itself. A plain `cargo test -- --ignored` skips the seed: it runs only under `dinoco seed`.

The crate root must include `dinoco/mod.rs` (`#[path = "../dinoco/mod.rs"] mod dinoco;`, under any module name), or `dinoco seed` reports that the seed never ran.
