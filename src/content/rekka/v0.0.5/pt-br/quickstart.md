# Quickstart

Este passo a passo leva de um crate vazio a um worker que processa jobs, faz retry de uma falha e encerra de forma limpa. Leva uns cinco minutos.

## Pré-requisitos

- Rust 1.89 ou mais recente (`rustc --version`).
- Um servidor Redis. Para rodar um localmente com Docker:

```bash
docker run -d --name redis -p 6379:6379 redis:7
```

## 1. Crie o projeto

```bash
cargo new rekka-quickstart
cd rekka-quickstart
cargo add rekka@0.0.5
cargo add serde --features derive
cargo add tokio --features macros,rt-multi-thread
```

O Rekka guarda cada job como JSON, então os jobs precisam de `Serialize` e `Deserialize` do serde. O Tokio roda os workers.

## 2. Defina um job

Um job é uma struct com campos nomeados que deriva `RekkaQueue`. Coloque isto em `src/main.rs`:

```rust
use rekka::RekkaQueue;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, RekkaQueue)]
#[rekka(name = "emails")]
struct SendEmail {
    task_id: String,
    to: String,
    subject: String,
}
```

Duas coisas para notar:

- `task_id` identifica o job dentro da fila. Pode ser qualquer tipo que implemente `Display` (`String`, inteiros, `Uuid`, ...). Enfileirar o mesmo `task_id` de novo atualiza o job existente em vez de criar um segundo.
- `name = "emails"` dá nome à fila no Redis. Sem ele, o nome é o da struct em snake_case (`send_email`).

## 3. Escreva o handler

Um handler é uma `async fn` que recebe um `JobHandler` e o job:

```rust
use rekka::{JobHandler, RekkaExecutionResult};

async fn send_email(handler: JobHandler, job: SendEmail) -> RekkaExecutionResult {
    if job.to.is_empty() {
        // Tentar de novo não resolve um endereço vazio: descarta o job.
        return handler.cancel();
    }

    if handler.attempt() < 2 {
        // Finge que o servidor SMTP recusou a primeira tentativa.
        return handler.err("smtp connection refused");
    }

    println!("sent {:?} to {} on attempt {}", job.subject, job.to, handler.attempt());
    handler.success()
}
```

O `JobHandler` monta o resultado: `success()` remove o job, `err(...)` entrega o job para a política de retry, `cancel()` remove sem retry e `retry_after(...)` roda de novo mais tarde sem contar como falha. `attempt()` começa em 1.

## 4. Inicie as filas

```rust
use std::time::Duration;

use rekka::{Queues, RetryPolicy};

#[tokio::main]
async fn main() -> rekka::Result<()> {
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());

    let queues = Queues::new(redis_url)
        .register::<SendEmail>(|w| {
            w.concurrency(5)
                .retry(RetryPolicy::RetryAfterRange(Duration::from_secs(1), Duration::from_secs(3)))
                .max_attempts(5)
                .build_fn(send_email)
        })
        .start()
        .await?;

    queues
        .immediate(SendEmail { task_id: "welcome:ana".into(), to: "ana@example.com".into(), subject: "Welcome!".into() })
        .await?;

    // Roda até Ctrl+C (SIGINT) ou SIGTERM e então espera os jobs em execução.
    queues.join().await
}
```

`register` recebe um closure que configura o worker de uma fila: até cinco jobs `SendEmail` ao mesmo tempo neste processo, uma espera aleatória de 1 a 3 segundos entre tentativas que falharam e no máximo cinco tentativas no total. `start()` conecta, confere a configuração e retorna assim que todos os workers estão rodando.

## 5. Rode

```bash
cargo run
```

Depois de um ou dois segundos:

```text
sent "Welcome!" to ana@example.com on attempt 2
```

A primeira tentativa retornou erro, esperou entre um e três segundos, e a segunda teve sucesso. Aperte Ctrl+C: o Rekka para de pegar jobs novos, espera os que estão rodando e `join()` retorna `Ok(())`.

## 6. Veja o upsert

Troque a chamada de `immediate` por duas chamadas com o mesmo `task_id` e imprima o que o Rekka fez:

```rust
let first = queues
    .immediate(SendEmail { task_id: "welcome:bia".into(), to: "bia@example.com".into(), subject: "Welcome!".into() })
    .await?;
let second = queues
    .immediate(SendEmail { task_id: "welcome:bia".into(), to: "bia@example.com".into(), subject: "Welcome, Bia!".into() })
    .await?;

println!("{first:?} then {second:?}");
```

A primeira chamada imprime `Created`. A segunda imprime `Updated` se o job ainda estava aguardando (o payload foi substituído, então só "Welcome, Bia!" é enviado) ou `AfterCurrentRun` se um worker já tinha pegado o job (a nova versão roda logo depois da execução atual). Em qualquer caso, duas execuções de `welcome:bia` nunca acontecem ao mesmo tempo. [Jobs e enfileiramento](/pt-br/docs/rekka/queues/jobs#upserts) lista todos os resultados.

## Próximos passos

- [Workers](/pt-br/docs/rekka/queues/workers): todas as opções de worker e como os jobs são pegos.
- [Handlers e extractors](/pt-br/docs/rekka/queues/handlers): compartilhe um pool de banco ou o cache com os handlers.
- [Eventos](/pt-br/docs/rekka/queues/events): registre, meça e alerte sobre cada job.
