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

The seed lives inside the generated `dinoco` module, so `super::models::*` (or `super::*`) brings the models in. After creating the file, run `dinoco models generate` once: the generated `dinoco/mod.rs` then declares it,

```rust
/// `dinoco/seed.rs` (or `dinoco/seed/mod.rs`), run by `dinoco seed`.
pub mod seed;
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

Like [`dinoco/transform.rs`](/en-us/docs/orm/guide/transforms#where-the-transform-runs), seeds are compiled by the CLI through a small generated project in `dinoco/.runner/` (ignored by Git), so they need a Rust toolchain wherever `dinoco seed` runs. That project builds into your project's target directory with a copy of your `Cargo.lock`, so it reuses the dependencies your application already compiled: the first run builds only what differs (Dinoco with all its features, for example), and later runs only the seed.

The runner compiles `dinoco/mod.rs`, the models, and the seed. A seed can use the models, `dinoco`, and `std`, but not the rest of your application (`crate::...` modules) or other crates.
