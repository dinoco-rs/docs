# Eventos

`on_event` registra uma função que recebe um evento para cada transição de job, em todas as filas, workers recorrentes e funções de reconcile do processo. Use para logs, métricas, alertas e um histórico de jobs finalizados.

## Registrando um handler

```rust
use rekka::{JobEvent, Queues};

fn log_event(event: JobEvent) {
    if event.is_failure() {
        eprintln!("{} {:?} failed on attempt {}: {:?}", event.job_name(), event.task_id(), event.attempt(), event.error());
    }
}

let queues = Queues::new(redis_url)
    .on_event(log_event)
    .register::<SendEmail>(|w| w.build_fn(send_email))
    .start()
    .await?;
```

A função é síncrona e roda dentro da task do job, então mantenha-a rápida. Um pânico dentro dela é capturado e nunca afeta o job. Para trabalho lento, como gravar em um banco, mande o evento para um canal e processe em outro lugar:

```rust
let (events, mut receiver) = tokio::sync::mpsc::unbounded_channel::<JobEvent>();

tokio::spawn(async move {
    while let Some(event) = receiver.recv().await {
        // guardar jobs finalizados, atualizar métricas, acionar alguém...
    }
});

let queues = Queues::new(redis_url)
    .on_event(move |event| {
        let _ = events.send(event);
    })
    // ...
    .start()
    .await?;
```

## Tipos de evento

| `JobEventKind` | Quando | Final |
| --- | --- | --- |
| `Started` | Uma execução começa. | |
| `Succeeded` | A execução teve sucesso. | Sim |
| `Failed` | A execução falhou e vai ser tentada de novo. | |
| `Dead` | A execução falhou e não vai ser tentada de novo. | Sim |
| `Cancelled` | O handler retornou `cancel()`. | Sim |
| `Rescheduled` | O handler retornou `retry_after` ou `retry_at`. | |
| `Stalled` | A lease do job expirou (o processo dele parou de responder) e ele voltou para a fila. | |
| `Discarded` | O job foi removido enquanto rodava, e o resultado foi ignorado. | Sim |

Helpers: `is_started()`, `is_success()`, `is_failure()` (`Failed` ou `Dead`), `is_dead()`, `is_cancelled()`, `is_retry()` (`Failed`, `Rescheduled` ou `Stalled`) e `is_final()` (o job saiu da fila de vez).

## Dados do evento

| Método | Retorna |
| --- | --- |
| `source()` | `EventSource::Queue`, `EventSource::Recursive` ou `EventSource::Reconcile`. |
| `job_name()` | O nome da fila (`<entrada>.<n>` no passo `n` de um [workflow](/pt-br/docs/rekka/queues/workflows)), o nome do worker recorrente ou `reconcile`. |
| `kind()` | O `JobEventKind`. |
| `task_id()` | `Some(id)` para jobs de fila, `None` para workers recorrentes e reconcile. |
| `attempt()` | A tentativa a que o evento se refere. |
| `error()` | A mensagem de erro, nas falhas. |
| `elapsed()` | Quanto tempo a execução levou, nos eventos finais, de falha e de reagendamento. |
| `retry_in()` | Quanto falta para a próxima tentativa, quando se sabe. |
| `payload()` | O payload JSON do job. |

## Lendo o job

`get_job::<T>()` desserializa o payload quando o evento pertence à fila de `T`, e retorna `None` caso contrário. `is::<T>()` só confere a fila:

```rust
fn on_event(event: JobEvent) {
    if event.is_success()
        && let Some(job) = event.get_job::<SendEmail>()
    {
        println!("email {} delivered to {}", job.task_id, job.to);
    }
}
```

O Rekka só mantém o payload de um job em memória durante a execução quando há um handler `on_event` registrado, então processos sem ele não pagam nada por isso.
