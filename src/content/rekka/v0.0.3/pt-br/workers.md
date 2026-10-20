# Workers

Um worker pega jobs de uma fila e roda o seu handler para cada um deles. Você registra workers no builder, antes do `start()`.

## Registrando um worker

`register` recebe o tipo do job e um closure que recebe um `RekkaWorker`, configura e termina com `build_fn(handler)`:

```rust
use std::time::Duration;

use rekka::{Queues, RetryPolicy};

let queues = Queues::new(redis_url)
    .register::<SendEmail>(|w| {
        w.concurrency(10)
            .retry(RetryPolicy::RetryAfterRange(Duration::from_secs(2), Duration::from_secs(60)))
            .max_attempts(8)
            .timeout(Duration::from_secs(30))
            .build_fn(send_email)
    })
    .register::<ResizeImage>(|w| w.concurrency(2).build_fn(resize))
    .start()
    .await?;
```

Cada fila pode ter um worker por `Queues`. Registrar o mesmo tipo de job duas vezes faz o `start()` falhar com `RekkaError::InvalidConfig`.

## Opções do worker

| Método | Padrão | O que controla |
| --- | --- | --- |
| `retry(policy)` | `RetryAfterRange(1s, 30s)` | O que acontece depois de uma falha. Veja [Retries e falhas](/pt-br/docs/rekka/queues/retries). |
| `max_attempts(n)` | `10` | Total de execuções, contando a primeira. Quando acabam, o job morre. |
| `unlimited_attempts()` | | Remove o limite: o job é tentado até dar certo, ser cancelado ou removido. |
| `concurrency(n)` | `1` | Jobs desta fila rodando ao mesmo tempo **neste processo**. |
| `concurrency_by_key(f)` | Nenhum | No máximo um job rodando por key **somando todos os processos**. Veja [Concorrência](/pt-br/docs/rekka/queues/concurrency). |
| `timeout(duration)` | Nenhum | Tempo máximo de uma execução. Estourar conta como falha. |
| `lease(duration)` | `30s` | Por quanto tempo um job fica preso a um processo que parou de responder. Veja [abaixo](#lease). |
| `build_fn(handler)` | | Termina a configuração com o [handler](/pt-br/docs/rekka/queues/handlers). |

### Concorrência

`concurrency(n)` é um limite por processo. Três instâncias de um serviço que registra `concurrency(10)` rodam até 30 jobs daquela fila ao mesmo tempo. Para limitar o trabalho somando todas as instâncias, por exemplo uma sincronização por cliente, use [`concurrency_by_key`](/pt-br/docs/rekka/queues/concurrency#concorrencia-por-key).

### Timeout

`timeout(duration)` cancela o future do handler quando a execução passa de `duration` e registra um erro como `job timed out after 30s`, que segue a política de retry. Sem timeout, uma execução pode levar o tempo que precisar; a lease continua sendo renovada enquanto ela roda.

### Lease

Enquanto um job roda, o processo renova a lease do job a cada `lease / 3`. Se o processo morrer ou parar de responder, a lease expira e qualquer instância devolve o job para a fila, com um evento `Stalled`. Uma lease menor traz de volta mais cedo um job de um processo que caiu; uma maior tolera pausas mais longas, como um runtime async bloqueado. A lease precisa ter pelo menos 100 ms. [Confiabilidade e escala](/pt-br/docs/rekka/operations/reliability#leases-e-heartbeats) explica o que isso significa para os seus handlers.

## Como um worker pega jobs

- **Atomicamente.** Um worker reivindica quantos jobs prontos couberem nos slots livres (no máximo 128 por ida e volta) em um único script no Redis, que os marca como em execução com uma lease nova. Dois workers nunca pegam o mesmo job.
- **Sem demora.** Quando um job fica pronto, o Rekka publica uma notificação no canal da fila no Redis e os workers ociosos acordam na hora. Os workers também conferem a fila no horário do próximo job agendado e a cada `poll_interval` (1 segundo por padrão), então continuam trabalhando mesmo se notificações se perderem.
- **Uma task por job.** Cada job reivindicado roda na própria task do Tokio, e o future do handler não é boxeado.

## Produtores e workers em processos diferentes

Um processo que só enfileira não registra workers:

```rust
// servidor web: só produz jobs
let queues = Queues::new(redis_url).start().await?;
queues.immediate(SendEmail { task_id: "welcome:42".into(), to: "ana@example.com".into(), template: "welcome".into() }).await?;
```

Um processo worker registra os handlers e chama `join()`. Os dois lados só precisam do mesmo Redis, do mesmo [prefixo de chaves](/pt-br/docs/rekka/operations/configuration#prefixo-das-chaves) e do mesmo tipo de job (ou pelo menos de um JSON compatível e do mesmo nome de fila).

## Validação no start

O `start()` confere a configuração antes de qualquer worker rodar, então um erro aparece no boot e não no primeiro job:

- `concurrency` e `max_attempts` precisam ser pelo menos 1, e `lease` pelo menos 100 ms.
- Nomes de fila precisam ser únicos e não podem conter `{` nem `}`.
- Todo `RekkaData<T>` usado por um handler precisa do `T` registrado com `.data(...)`. Caso contrário, o `start()` retorna `RekkaError::MissingData`.
