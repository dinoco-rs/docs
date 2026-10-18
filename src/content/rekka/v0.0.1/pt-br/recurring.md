# Workers recorrentes

Um worker recorrente roda uma tarefa a cada intervalo: limpar sessões expiradas a cada hora, atualizar cotações a cada cinco minutos, mandar um resumo diário. Com várias instâncias do serviço rodando, cada ciclo continua rodando em exatamente uma delas.

## Registrando um worker recorrente

```rust
use std::time::Duration;

use rekka::{Queues, RekkaState};

async fn purge_expired_sessions(RekkaState(db): RekkaState<Database>) -> anyhow::Result<()> {
    let removed = db.delete_expired_sessions().await?;
    println!("removed {removed} sessions");
    Ok(())
}

let queues = Queues::new(redis_url)
    .data(database)
    .register_recursive("purge_expired_sessions", |w| {
        w.interval(Duration::from_secs(60 * 60)).build_fn(purge_expired_sessions)
    })
    .start()
    .await?;
```

A tarefa é uma `async fn` que recebe só [extractors](/pt-br/docs/rekka/queues/handlers#extractors) (até oito) e retorna `()` ou `Result<(), E>` em que `E` implementa `Display`. Não há `JobHandler` nem job: um worker recorrente não é uma fila.

| Método | Padrão | O que controla |
| --- | --- | --- |
| `interval(duration)` | 60 s | Tempo entre os inícios de duas execuções. No mínimo 10 ms. |
| `lease(duration)` | 30 s | Quanto tempo outra instância espera antes de assumir o lugar de uma que parou de responder. No mínimo 100 ms. |
| `build_fn(task)` | | Termina a configuração. |

O nome identifica o agendamento no Redis, então precisa ser único, não pode conter `{` nem `}` e deve continuar o mesmo entre deploys.

## Como as execuções são agendadas

- **Uma instância por ciclo.** Antes de rodar, uma instância pega um lock no Redis e define o próximo horário para todas. As outras instâncias veem o agendamento e esperam.
- **Intervalo de início a início.** A próxima execução é agendada quando uma execução começa. Se uma execução demora mais que o intervalo, a próxima espera ela terminar: as execuções nunca se sobrepõem.
- **O primeiro start roda na hora.** Quando ainda não existe agendamento no Redis, a primeira instância a subir roda a tarefa imediatamente. Depois disso, todas as instâncias seguem o agendamento compartilhado, então um restart ou um deploy não dispara uma execução extra.
- **Substituição.** A instância que está rodando renova o lock a cada `lease / 3`. Se ela morrer, outra instância assume quando a lease expirar.
- **Sem retries.** Uma tarefa que retorna erro ou entra em pânico é registrada com `tracing` e emite um evento `Failed`; a próxima execução acontece no próximo ciclo normalmente.
- **Encerramento.** No encerramento gracioso, uma tarefa em execução pode terminar. Com um [`shutdown_timeout`](/pt-br/docs/rekka/operations/lifecycle#timeout-de-encerramento), ela é abortada quando o tempo acaba.

## Eventos

Cada execução emite `Started` e depois `Succeeded` ou `Failed` pelo [`on_event`](/pt-br/docs/rekka/queues/events), com `EventSource::Recursive` como origem, o nome do worker em `job_name()`, a duração em `elapsed()` e sem `task_id`.

## Workers recorrentes ou jobs agendados

| Use | Quando |
| --- | --- |
| Um worker recorrente | O trabalho é periódico e não pertence a uma entidade: varreduras, atualizações, relatórios. |
| Um [job agendado](/pt-br/docs/rekka/queues/jobs#rodar-em-um-instante) | O trabalho pertence a uma entidade em um horário: "lembrar o cliente 42 amanhã às 9:00". |

O Rekka 0.0.1 agenda workers recorrentes por intervalo, não por expressão cron. Para trabalho em horários exatos do relógio, um worker recorrente pode enfileirar jobs agendados com `RekkaClient::schedule`.
