# Seeds

Seeds colocam no banco as rows que todo ambiente precisa: roles, países, planos, configurações. Elas são código Rust em `dinoco/seed.rs`, escrito com os mesmos models e builders da aplicação, e o `dinoco seed` executa elas no banco de um workspace.

## Escreva uma seed

Crie o `dinoco/seed.rs` com uma função `seed`. Ela recebe um client já conectado ao banco:

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

A seed fica dentro do módulo `dinoco` gerado, então `super::models::*` (ou `super::*`) traz os models. Depois de criar o arquivo, rode `dinoco models generate` uma vez: o `dinoco/mod.rs` gerado passa a declará-lo,

```rust
/// `dinoco/seed.rs` (or `dinoco/seed/mod.rs`), run by `dinoco seed`.
pub mod seed;
```

então o rust-analyzer e o `cargo check` analisam a seed junto com o resto da aplicação, e uma seed que não bate mais com os models falha a compilação ali primeiro. A sua aplicação também pode chamar `dinoco::seed::seed(&client)` ela mesma, por exemplo em testes.

## Rode as seeds

```bash
dinoco seed
dinoco seed --workspace production
```

O `dinoco seed` conecta no banco do workspace, escolhido do mesmo jeito que no [`dinoco migrate run`](/pt-br/docs/orm/tooling/cli#dinoco-migrate-run), roda a `seed` e reporta o resultado. Um erro retornado pela seed, ou um panic, faz o comando falhar com exit code `1` e a mensagem. Rode depois das migrations, para que toda tabela que as seeds escrevem já exista:

```bash
dinoco migrate run --workspace production
dinoco seed --workspace production
```

## Mantenha as seeds idempotentes

O `dinoco seed` roda todas as seeds toda vez; ele não registra quais rows escreveu. Escreva cada seed de forma que rodar de novo não mude nada, o que também a deixa segura num pipeline de deploy:

- insira com [`on_conflict_do_nothing`](/pt-br/docs/orm/orm/insert#ignore-duplicados-e-retorne-a-row-existente) num field único, para pular as rows que já existem;
- para também atualizar as rows existentes, atualize-as pelo field único com `update_many`;
- para aplicar tudo ou nada, envolva a seed numa [transaction](/pt-br/docs/orm/orm/transactions) e passe o `tx` para os builders.

## Divida as seeds em arquivos

Para mais do que algumas tabelas, use `dinoco/seed/mod.rs` no lugar de `dinoco/seed.rs`, com um arquivo por grupo. A `seed` dele roda as outras em ordem: os parents antes das rows que apontam para eles.

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

Use um dos dois layouts: o Rust rejeita um módulo com `seed.rs` e `seed/mod.rs` ao mesmo tempo.

## Como as seeds rodam

Como o [`dinoco/transform.rs`](/pt-br/docs/orm/guide/transforms#onde-o-transform-roda), as seeds são compiladas pela CLI num pequeno projeto gerado em `dinoco/.runner/` (ignorado pelo Git), então elas precisam de uma toolchain Rust onde o `dinoco seed` roda. Esse projeto compila no target directory do seu projeto com uma cópia do seu `Cargo.lock`, então ele reaproveita as dependências que a sua aplicação já compilou: a primeira execução compila só o que difere (o Dinoco com todas as features, por exemplo), e as seguintes só a seed.

O runner compila o `dinoco/mod.rs`, os models e a seed. Uma seed pode usar os models, o `dinoco` e a `std`, mas não o resto da sua aplicação (módulos `crate::...`) nem outros crates.
