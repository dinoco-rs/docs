# Handlers e extractors

Um handler é a função que um worker roda para cada job. É uma `async fn` comum: os dois primeiros argumentos são o `JobHandler` e o job, e os demais são **extractors** que o Rekka preenche a partir do estado compartilhado.

## Assinatura do handler

```rust
async fn handler(handler: JobHandler, job: MyJob, extractor_1: E1, /* ... */ extractor_n: En) -> R
```

- Até oito extractors, cada um de um tipo que implementa [`FromContext`](#escrevendo-o-seu-proprio-extractor).
- `R` é qualquer [tipo de retorno suportado](#tipos-de-retorno).
- O future precisa ser `Send + 'static`. Closures também funcionam, desde que sejam `Fn(JobHandler, MyJob, ...) -> impl Future` e `Send + Sync + 'static`.

## O JobHandler

O `JobHandler` descreve a execução atual e monta o resultado:

| Método | Retorna |
| --- | --- |
| `queue()` | O nome da fila. |
| `task_id()` | O `task_id` do job como string. |
| `attempt()` | A tentativa atual, começando em 1. |
| `max_attempts()` | `Some(n)`, ou `None` com `unlimited_attempts()`. |
| `is_last_attempt()` | `true` quando um erro nesta execução não vai ser tentado de novo. |
| `success()` | Finaliza o job. |
| `err(reason)` | Falha esta execução; a [política de retry](/pt-br/docs/rekka/queues/retries) decide o que vem depois. `reason` é qualquer coisa que implemente `Display`. |
| `cancel()` | Finaliza o job sem retry. |
| `retry_after(duration)` | Roda de novo depois de `duration`. Não é falha. |
| `retry_at(instant)` | Roda de novo em um `DateTime<Utc>`. Não é falha. |

## Tipos de retorno

Um handler pode retornar:

- `RekkaExecutionResult`, normalmente montado com os métodos do `JobHandler` acima.
- `()`, que sempre significa sucesso.
- `Result<T, E>` em que `T` é um destes tipos e `E` implementa `Display`. `Ok(valor)` usa o resultado de `valor`; `Err(erro)` é uma falha cuja mensagem é `format!("{erro:#}")`, então erros do `anyhow` mantêm a cadeia inteira.

`Result<(), E>` é o mais prático para código que usa `?`:

```rust
async fn sync_customer(handler: JobHandler, job: SyncCustomer, client: RekkaClient) -> anyhow::Result<()> {
    let customer = fetch_customer(&job.customer_id).await?; // um Err aqui entra em retry
    client.immediate(IndexCustomer { task_id: customer.id.clone() }).await?;
    println!("synced {} on attempt {}", customer.id, handler.attempt());
    Ok(())
}
```

O que cada resultado faz:

| Resultado | Efeito | Evento |
| --- | --- | --- |
| Sucesso | O job é apagado. | `Succeeded` |
| Erro | A política de retry roda o job de novo mais tarde, ou o job é apagado. | `Failed` ou `Dead` |
| Cancelamento | O job é apagado sem retry. | `Cancelled` |
| `retry_after` / `retry_at` | O job aguarda e roda de novo; a política de retry não é aplicada. | `Rescheduled` |

Um handler que entra em pânico ou estoura o `timeout` também gera um erro, com uma mensagem como `job panicked: ...` ou `job timed out after 30s`.

## Extractors

### RekkaData

`RekkaData<T>` dá ao handler acesso a um valor registrado com `.data(valor)`, tipicamente um pool de banco, um client HTTP ou configuração:

```rust
use rekka::{JobHandler, Queues, RekkaData};

struct Mailer {
    from: String,
}

async fn send_email(handler: JobHandler, job: SendEmail, RekkaData(mailer): RekkaData<Mailer>) {
    println!("{} -> {} (attempt {})", mailer.from, job.to, handler.attempt());
}

let queues = Queues::new(redis_url)
    .data(Mailer { from: "no-reply@example.com".into() })
    .register::<SendEmail>(|w| w.build_fn(send_email))
    .start()
    .await?;
```

`.data(valor)` coloca o valor em um `Arc`; use `.data_arc(arc)` quando você já tem um, por exemplo para compartilhar o mesmo pool com o servidor web. Cada tipo é guardado uma vez, então registre vários valores com tipos diferentes. `RekkaData<T>` faz deref para `T`, e desestruturar com `RekkaData(valor)` entrega o `Arc<T>`.

Se um handler usa `RekkaData<T>` e nenhum `T` foi registrado, o `start()` falha com `RekkaError::MissingData`.

### RekkaClient

`RekkaClient` adiciona, remove e inspeciona jobs de qualquer fila de dentro de um handler, com os mesmos métodos do handle `Queues`. Você não registra nada com `.data(...)` para ele: declare o argumento e o Rekka entrega o client do `Queues` em execução. É o jeito de encadear trabalho, em que um job enfileira o próximo ou cancela um que não é mais necessário:

```rust
async fn charge(handler: JobHandler, job: ChargeInvoice, client: RekkaClient) -> rekka::Result<()> {
    // ... cobra o cartão ...
    client.immediate(SendReceipt { task_id: format!("receipt:{}", job.invoice_id) }).await?;
    client.remove::<PaymentReminder>(format!("reminder:{}", job.invoice_id)).await?;
    Ok(())
}
```

### Cache

`Cache` é o [cache tipado](/pt-br/docs/rekka/cache/cache-types), usando a mesma conexão Redis e o mesmo prefixo de chaves das filas.

### ReconcileHandler

O [`ReconcileHandler`](/pt-br/docs/rekka/queues/reconcile#o-reconcilehandler) adiciona jobs só quando eles ainda não existem. Foi pensado para funções de reconcile, mas funciona como extractor em qualquer lugar.

## Escrevendo o seu próprio extractor

Implemente `FromContext` para qualquer tipo `Send + 'static`. `from_context` roda antes de cada chamada; `validate` roda uma vez no `start()`, então uma dependência faltando falha no boot:

```rust
use rekka::{FromContext, RekkaContext, RekkaError};

struct AppConfig {
    dry_run: bool,
}

struct DryRun(bool);

impl FromContext for DryRun {
    fn from_context(cx: &RekkaContext) -> rekka::Result<Self> {
        let config = cx.data::<AppConfig>().ok_or(RekkaError::MissingData("AppConfig"))?;
        Ok(DryRun(config.dry_run))
    }

    fn validate(cx: &RekkaContext) -> rekka::Result<()> {
        if cx.has_data::<AppConfig>() { Ok(()) } else { Err(RekkaError::MissingData("AppConfig")) }
    }
}

async fn send_email(handler: JobHandler, job: SendEmail, DryRun(dry_run): DryRun) -> RekkaExecutionResult {
    if dry_run {
        println!("would send {} to {}", job.template, job.to);
    }
    handler.success()
}
```

O `RekkaContext` dá acesso aos dados registrados (`data::<T>()`, `has_data::<T>()`) e ao client (`client()`). Se `from_context` retornar um erro enquanto um job roda, aquela execução falha com a mensagem do erro.
