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

A seed fica dentro do módulo `dinoco` gerado, então `super::models::*` (ou `super::*`) traz os models, e `crate::...` alcança o resto da sua aplicação: helpers, constantes e tudo o que a raiz do crate importa. Depois de criar o arquivo, rode `dinoco models generate` uma vez: o `dinoco/mod.rs` gerado passa a declará-lo,

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

A seed faz parte do crate da sua aplicação, então o `dinoco seed` roda ela ali: o Cargo compila a library e os binários do crate para os testes deles, no target directory do seu projeto e com as suas dependências, e roda só o teste `__dinoco_seed` do `dinoco/mod.rs`, que conecta no banco do workspace e chama a `seed`. A sua `main` nunca roda, nem os seus outros testes. Ele precisa de uma toolchain Rust onde o `dinoco seed` roda; a primeira execução compila o crate para testes, e as seguintes só o que mudou.

Por ser uma build de teste, o crate é compilado com `cfg(test)`: ali o `connect()` gerado devolve o [banco de teste](/pt-br/docs/orm/orm/testing) em memória, então a seed usa o `client` que recebe em vez de chamar `connect()` ela mesma. Um `cargo test -- --ignored` comum pula a seed: ela só roda pelo `dinoco seed`.

A raiz do crate precisa incluir o `dinoco/mod.rs` (`#[path = "../dinoco/mod.rs"] mod dinoco;`, com qualquer nome de módulo), senão o `dinoco seed` avisa que a seed nunca rodou.
