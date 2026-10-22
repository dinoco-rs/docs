# Rekka

O Rekka é uma biblioteca Rust para trabalho em background sobre o Redis: filas de jobs com retries e agendamento, workers recorrentes e um cache tipado. Ele foi feito para serviços que rodam em mais de uma instância. Toda mudança de estado acontece dentro de um único script atômico no Redis, jobs em execução têm lease com heartbeat e um processo que cai nunca perde nem duplica um job.

> [!NOTE]
> O Rekka faz parte do ecossistema Dinoco, ao lado do [Dinoco ORM](/pt-br/docs/orm/guide/introduction). O Rekka está nos primeiros lançamentos 0.0.x: a API ainda pode mudar antes da 1.0.

## Por que o Rekka

- **Jobs são structs tipadas.** Um job é uma struct serde que deriva `RekkaQueue`. O handler recebe essa struct, não um JSON solto, e um payload que deixou de desserializar passa pela política de retry em vez de derrubar o worker.
- **Enfileirar é um upsert.** Todo job tem um `task_id`. Enfileirar o mesmo id de novo atualiza o job que está aguardando em vez de criar um segundo, e um job que já está rodando ganha a nova versão na fila logo depois da execução atual. Duas execuções do mesmo `task_id` nunca se sobrepõem.
- **Feito para várias instâncias.** Leases, recuperação de jobs travados, concorrência por key que vale em todos os processos e workers recorrentes que rodam em exatamente uma instância por ciclo.
- **Nada novo para operar.** O Rekka só precisa do Redis. Não há serviço extra, painel ou banco para manter.

## O que você ganha

- `#[derive(RekkaQueue)]` para jobs e `#[derive(RekkaCache)]` para entradas de cache.
- `immediate`, `schedule`, `schedule_in` e `immediate_many` para enfileirar; `remove`, `state`, `stats` e `purge` para gerenciar filas.
- Workers com concorrência por processo, concorrência por key, timeouts, leases, políticas de retry e limite de tentativas.
- Handlers escritos como `async fn` comuns, com extractors para estado compartilhado (`RekkaData<T>`), o client e o cache.
- Workers recorrentes (`register_recursive`) e um hook de reconcile (`with_reconcile`) que restaura jobs a partir da sua própria fonte da verdade.
- Um único hook `on_event` para cada transição de job: started, succeeded, failed, dead, cancelled, rescheduled, stalled e discarded.
- Encerramento gracioso com SIGINT e SIGTERM, com timeout opcional.
- Um cache tipado com TTL, leituras e escritas em lote e limpeza incremental.

## Como as peças se encaixam

Um processo configura tudo com um único builder e o inicia:

1. Descreva cada job como uma struct e derive `RekkaQueue`.
2. Registre um worker por fila com `Queues::new(redis_url).register::<Job>(...)`, além de workers recorrentes e dados compartilhados.
3. Chame `.start().await?`. Você recebe um handle `Queues`: enfileire com ele de qualquer lugar da aplicação e chame `join()` para continuar trabalhando até o processo ser encerrado.

O mesmo binário pode produzir jobs, processá-los ou os dois. Um servidor web que só enfileira inicia um `Queues` sem registrar workers; um processo worker registra os handlers. Os dois só precisam apontar para o mesmo Redis e usar o mesmo [prefixo de chaves](/pt-br/docs/rekka/operations/configuration#prefixo-das-chaves).

## Um exemplo mínimo

```rust
use rekka::{JobHandler, Queues, RekkaQueue};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, RekkaQueue)]
struct ResizeImage {
    task_id: String,
    width: u32,
}

async fn resize(handler: JobHandler, job: ResizeImage) {
    println!("resizing {} to {}px (attempt {})", job.task_id, job.width, handler.attempt());
}

#[tokio::main]
async fn main() -> rekka::Result<()> {
    let queues = Queues::new("redis://127.0.0.1:6379")
        .register::<ResizeImage>(|w| w.concurrency(4).build_fn(resize))
        .start()
        .await?;

    queues.immediate(ResizeImage { task_id: "avatar:42".into(), width: 256 }).await?;
    queues.join().await
}
```

Sem `#[rekka(name = "...")]`, a fila recebe o nome da struct em snake_case, `resize_image` aqui. Um handler que retorna `()` sempre tem sucesso; [Handlers e extractors](/pt-br/docs/rekka/queues/handlers) mostra como reportar falhas e reagendar.

## Requisitos

- Rust 1.89 ou mais recente (edition 2024).
- Tokio. `#[tokio::main]` precisa das features `macros` e `rt-multi-thread` no seu crate.
- `serde` com a feature `derive`: jobs e entradas de cache são guardados como JSON.
- Um servidor Redis 6+. O Rekka 0.0.4 se conecta a um único endpoint Redis.

## Próximos passos

- [Quickstart](/pt-br/docs/rekka/guide/quickstart): monte um worker com retries em cinco minutos.
- [Vindo do BullMQ](/pt-br/docs/rekka/guide/coming-from-bullmq): como os conceitos que você já conhece se traduzem para o Rekka.
- [Jobs e enfileiramento](/pt-br/docs/rekka/queues/jobs): `task_id`, upserts e agendamento em detalhe.
