# Inspecionar e remover jobs

Além de enfileirar, o handle `Queues` e o `RekkaClient` removem um job, leem o estado dele, contam o que há em uma fila e apagam uma fila inteira. Todo método recebe o tipo do job como parâmetro genérico, então sempre atua na fila certa.

## Removendo um job

```rust
use rekka::Removed;

match queues.remove::<SendEmail>("welcome:42").await? {
    Removed::Removed => println!("it was waiting and is gone"),
    Removed::DiscardAfterRun => println!("it is running; its result will be discarded"),
    Removed::NotFound => println!("no such job"),
}
```

| Resultado | Significado |
| --- | --- |
| `Removed::Removed` | O job estava aguardando, agendado ou bloqueado na key, e foi apagado. |
| `Removed::DiscardAfterRun` | O job está rodando. Ele termina normalmente, mas o resultado é ignorado: sem retry, e com um evento `Discarded`. Uma versão enfileirada com `AfterCurrentRun` também é descartada. |
| `Removed::NotFound` | Não existe job com esse `task_id` na fila. |

`remove` aceita qualquer id que implemente `Display`, como o próprio campo `task_id`: `queues.remove::<ChargeInvoice>(invoice_id)` funciona com um `Uuid`.

## Consultando o estado de um job

```rust
use rekka::JobState;

match queues.state::<SendEmail>("welcome:42").await? {
    Some(JobState::Waiting { run_in, attempts }) => println!("runs in {run_in:?}, {attempts} attempts so far"),
    Some(JobState::Running { attempt }) => println!("running attempt {attempt}"),
    Some(JobState::Blocked { attempts }) => println!("waiting for its concurrency key ({attempts} attempts so far)"),
    None => println!("not in the queue"),
}
```

`None` significa que o job não existe: nunca foi enfileirado ou já terminou. Jobs finalizados não são guardados, veja [abaixo](#jobs-finalizados-nao-sao-guardados).

## Estatísticas da fila

```rust
let stats = queues.stats::<SendEmail>().await?;
println!("{} waiting ({} ready now), {} running, {} keys held", stats.waiting, stats.ready, stats.running, stats.locked_keys);
```

| Campo | Significado |
| --- | --- |
| `waiting` | Jobs na fila, prontos ou agendados para depois. Jobs bloqueados em uma key de concorrência não entram na conta. |
| `ready` | Jobs aguardando cujo horário já chegou. |
| `running` | Jobs que um worker está rodando agora. |
| `locked_keys` | Keys de concorrência ocupadas ou reservadas no momento. |

`stats` é uma única ida e volta ao Redis, barata o bastante para um endpoint de métricas ou um health check.

## Apagando uma fila

```rust
let deleted = queues.purge::<SendEmail>().await?;
let deleted_old = queues.purge_queue("old_emails").await?;
```

`purge` apaga tudo o que uma fila tem no Redis: jobs aguardando, agendados e bloqueados, o estado dos jobs em execução (eles terminam, mas o resultado é ignorado) e os índices da fila. Retorna quantos jobs existiam. `purge_queue` faz o mesmo pelo nome, para uma fila cujo tipo não existe mais no código. Os dois varrem as chaves de forma incremental, então nunca bloqueiam o Redis.

> [!WARNING]
> O purge é imediato e não pode ser desfeito. O [janitor](/pt-br/docs/rekka/operations/reliability#o-janitor) periódico só repara filas registradas, então uma fila renomeada ou removida continua no Redis até você apagá-la.

## Jobs finalizados não são guardados

O Rekka apaga um job assim que ele termina, tenha dado certo, sido cancelado ou morrido. O único rastro que fica é uma marca que vive por `completed_ttl` (60 segundos por padrão) para que o [reconcile](/pt-br/docs/rekka/queues/reconcile) não recrie o job. Se você precisa de um histórico de jobs finalizados ou de uma lista de jobs mortos, guarde por conta própria a partir do [`on_event`](/pt-br/docs/rekka/queues/events).
