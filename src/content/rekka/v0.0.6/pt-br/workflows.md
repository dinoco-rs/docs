# Workflows

Um workflow é uma sequência de handlers em que a saída de cada passo é a entrada do próximo. Cada passo é uma fila própria, com o seu worker, tentativas e timeouts, e uma execução só começa pelo primeiro passo: você enfileira o job de entrada como qualquer outro job, e o Rekka leva a execução de um passo para o outro.

## Definindo um workflow

Registre um workflow com `register_workflow::<J>`, em que `J` é o job de entrada. O closure recebe o mesmo [`RekkaWorker<J>`](/pt-br/docs/rekka/queues/workers#opcoes-do-worker) do `register::<J>`; em vez de `build_fn`, você chama `start_with` com o primeiro handler, que recebe um `J`, e acrescenta os passos seguintes com `then`:

```rust
use std::time::Duration;

use rekka::{JobHandler, Queues, RekkaData, RekkaQueue, RetryPolicy, StepResult};
use serde::{Deserialize, Serialize};

/// O job de entrada: uma execução só começa enfileirando ele.
#[derive(Serialize, Deserialize, RekkaQueue)]
#[rekka(name = "create_customer")]
struct CreateCustomerJob {
    task_id: String,
    account_id: i64,
    name: String,
    email: String,
}

/// Passa de um passo para o outro. Não precisa de `RekkaQueue`.
#[derive(Serialize, Deserialize)]
struct Customer {
    id: i64,
    account_id: i64,
    email: String,
}

async fn create_customer(job: CreateCustomerJob, RekkaData(db): RekkaData<Database>) -> anyhow::Result<Customer> {
    let id = db.insert_customer(&job.name, &job.email).await?;
    Ok(Customer { id, account_id: job.account_id, email: job.email })
}

async fn validate_customer(customer: Customer, handler: JobHandler) -> StepResult<Customer> {
    if !customer.email.contains('@') {
        return handler.cancel().into(); // os passos seguintes não rodam
    }
    StepResult::Next(customer)
}

async fn send_welcome_email(customer: Customer, RekkaData(mailer): RekkaData<Mailer>) -> anyhow::Result<Customer> {
    mailer.welcome(&customer.email).await?;
    Ok(customer)
}

async fn create_invoice(customer: Customer, RekkaData(db): RekkaData<Database>) -> anyhow::Result<()> {
    db.create_first_invoice(customer.id).await?;
    Ok(())
}

let queues = Queues::new(redis_url)
    .data(db)
    .data(mailer)
    .register_workflow::<CreateCustomerJob>(|w| {
        w.concurrency(4)
            .concurrency_by_key(|job| job.account_id)
            .retry(RetryPolicy::RetryAfterRange(Duration::from_secs(2), Duration::from_secs(60)))
            .max_attempts(8)
            .timeout(Duration::from_secs(30))
            .start_with(create_customer)
            .then(validate_customer)
            .then(send_welcome_email)
            .then(create_invoice)
    })
    .start()
    .await?;
```

Cada handler de `then` recebe a saída do passo anterior como primeiro argumento; um tipo diferente é erro de compilação. O `::<CreateCustomerJob>` pode ser omitido, já que o handler de `start_with` define o job de entrada, mas aí o closure do `concurrency_by_key` precisa do tipo do argumento (`|job: &CreateCustomerJob|`).

## Iniciando uma execução

```rust
let job = CreateCustomerJob {
    task_id: "signup:42".into(),
    account_id: 7,
    name: "Ana".into(),
    email: "ana@example.com".into(),
};
queues.immediate(job).await?;
```

A fila de entrada é uma fila comum: `schedule`, `schedule_in`, `immediate_many` e o [reconcile](/pt-br/docs/rekka/queues/reconcile) também iniciam execuções, e um produtor que não registra o workflow pode enfileirar o job de entrada. Os outros passos não podem ser enfileirados diretamente.

O `task_id` do job de entrada identifica a execução em todos os passos. Enfileirar o mesmo `task_id` de novo é um [upsert](/pt-br/docs/rekka/queues/jobs#upserts) na fila de entrada, exatamente como numa fila registrada com `register`.

## Handlers dos passos

### Assinatura

```rust
async fn step(input: Previous, extractor_1: E1, /* ... */ extractor_n: En) -> R
```

O handler de um passo é um [handler](/pt-br/docs/rekka/queues/handlers) cujo primeiro argumento é a saída do passo anterior, em vez de um job. Esse tipo fica guardado no Redis como JSON entre os passos, então precisa implementar `Serialize` e `DeserializeOwned`; não precisa de `RekkaQueue` nem de `task_id`. Os extractors funcionam como em qualquer handler, inclusive o `JobHandler`: `handler.task_id()` é o `task_id` da execução, e `handler.attempt()` conta as tentativas deste passo.

### Tipos de retorno

| Tipo de retorno | Efeito |
| --- | --- |
| `Result<T, E>` | `Ok(valor)` conclui o passo e `valor` é a entrada do próximo. `Err(erro)` é uma falha, repetida pela política de retry. |
| `StepResult<T>` | `StepResult::Next(valor)`, ou qualquer `RekkaExecutionResult` com `.into()`. Veja [Encerrando uma execução](#encerrando-uma-execucao). |
| `Result<StepResult<T>, E>` | Os dois: use `?` e ainda encerre ou reagende a execução. |
| `()` | O próximo passo recebe `()`. |

`E` é qualquer tipo que implementa `Display`, como nos handlers de job. A saída do último passo é descartada, então o último handler normalmente retorna `Result<(), E>` ou `()`.

### Encerrando uma execução

Transforme um resultado do `JobHandler` em `StepResult` com `.into()`:

| Resultado | Efeito |
| --- | --- |
| `handler.cancel().into()` | A execução para aqui, sem retry: evento `Cancelled`, e os passos seguintes nunca rodam. |
| `handler.success().into()` | A execução termina aqui, com sucesso: evento `Succeeded`, e os passos seguintes nunca rodam. |
| `handler.err(motivo).into()` | Uma falha deste passo, como `Err(motivo)`. |
| `handler.retry_after(delay).into()` / `handler.retry_at(instante).into()` | Este passo roda de novo mais tarde, sem contar como falha. |

Um passo que gasta todas as tentativas fica **morto** e a execução para ali, com um evento `Dead` desse passo. Veja [Retries e falhas](/pt-br/docs/rekka/queues/retries).

## Opções dos passos

As opções configuradas antes de `start_with` valem para cada passo, como se cada passo tivesse sido registrado com elas:

- `concurrency(n)` é por passo e por processo: com 4 passos, um processo roda até `4 × n` jobs do workflow.
- `retry`, `max_attempts` e `timeout` valem para cada execução de cada passo. As tentativas contam por passo: um passo que dá certo na terceira tentativa entrega a saída para um próximo passo que começa na tentativa 1.
- `concurrency_by_key(f)` calcula a key uma vez, a partir do job de entrada, e a key acompanha a execução por todos os passos: em cada passo, no máximo um job por key roda ao mesmo tempo.
- `lease` e `max_future_size` valem para o handler de cada passo.

## Como os passos são guardados

O passo de entrada usa a fila do job de entrada, `create_customer` aqui. O passo `n`, contando a partir de 1, é a fila `create_customer.n`, o nome retornado por `handler.queue()`, `JobEvent::job_name()` e `FutureSize::name()`.

As chaves de todos os passos usam a hash tag da fila de entrada (`<prefix>:{create_customer}:n:...`), então concluir um passo e enfileirar o próximo é um único script no Redis: uma queda do processo ou do Redis entre os dois pode atrasar uma execução, mas a passagem nunca perde o próximo passo nem o enfileira duas vezes. Cada passo continua sendo entregue [pelo menos uma vez](/pt-br/docs/rekka/operations/reliability#leases-e-heartbeats), como qualquer job, então mantenha os handlers dos passos idempotentes. Se o job de entrada for removido enquanto roda, o resultado é descartado e a execução para.

> [!WARNING]
> Os passos são identificados pela posição. Com execuções em andamento, só acrescente passos no fim do workflow; inserir, remover ou reordenar passos muda qual handler recebe os jobs que já estão esperando num passo. Um job cuja entrada não desserializa mais conta como falha e passa pela política de retry.

## Inspecionando um workflow

- `state::<CreateCustomerJob>`, `stats::<CreateCustomerJob>` e `remove::<CreateCustomerJob>` enxergam só a fila de entrada. Depois que uma execução passou do primeiro passo, um passo seguinte a encerra retornando `cancel()`.
- `purge::<CreateCustomerJob>()` apaga as filas de todos os passos e retorna quantos jobs existiam em todas elas.
- Os [eventos](/pt-br/docs/rekka/queues/events) são emitidos por passo, com o nome da fila do passo em `job_name()` e o `task_id` da execução. `get_job::<CreateCustomerJob>()` lê o job nos eventos do passo de entrada; nos passos seguintes, `payload()` é a entrada do passo em JSON.
- O [janitor](/pt-br/docs/rekka/operations/reliability#o-janitor) repara as filas de todos os passos registrados.

## Workflows ou jobs encadeados

Um handler também pode enfileirar o próximo job sozinho, pelo extractor [`RekkaClient`](/pt-br/docs/rekka/queues/handlers#rekkaclient). Use um workflow quando o trabalho é uma sequência fixa: os passos são tipados de ponta a ponta, compartilham um conjunto de opções e um `task_id`, e a passagem de um passo para o outro é atômica. Enfileire jobs a partir dos handlers quando o próximo job depende do resultado (ramificações, fan-out para muitos jobs) ou pertence a uma fila com vida própria fora da sequência.
