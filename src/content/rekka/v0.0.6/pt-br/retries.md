# Retries e falhas

Quando uma execução falha, a política de retry do worker decide se o job roda de novo e quando. O limite de tentativas decide quando desistir.

## O que conta como falha

Uma execução falha quando:

- o handler retorna `handler.err(...)` ou um `Err(...)`;
- o handler entra em pânico (o pânico é capturado e nunca derruba o worker);
- a execução passa do [`timeout`](/pt-br/docs/rekka/queues/workers#timeout) do worker;
- o payload no Redis não desserializa mais para o tipo do job;
- um [extractor](/pt-br/docs/rekka/queues/handlers#extractors) retorna erro.

`handler.cancel()`, `handler.retry_after(...)` e `handler.retry_at(...)` não são falhas.

## Políticas de retry

Defina a política por worker com `.retry(policy)`:

| Política | Depois de uma falha |
| --- | --- |
| `RetryPolicy::RetryAfterRange(min, max)` | Espera um tempo aleatório entre `min` e `max` e roda de novo. O padrão é `RetryAfterRange(1s, 30s)`. |
| `RetryPolicy::RetryImmediate` | Devolve o job para a fila na hora. |
| `RetryPolicy::Cancel` | Nunca tenta de novo: o job morre na primeira falha. |

A espera aleatória espalha os retries, para que um serviço que acabou de voltar não seja atingido por todos os jobs que falharam no mesmo segundo.

```rust
use std::time::Duration;

use rekka::RetryPolicy;

.register::<SyncCustomer>(|w| {
    w.retry(RetryPolicy::RetryAfterRange(Duration::from_secs(5), Duration::from_secs(120)))
        .max_attempts(20)
        .build_fn(sync_customer)
})
```

## Limite de tentativas

`max_attempts(n)` é o total de execuções, contando a primeira; o padrão é 10. Quando uma execução falha e o job já usou todas as tentativas, o job **morre**: o Rekka o apaga e emite um evento `Dead` com o último erro. `unlimited_attempts()` remove o limite.

Dentro de um handler, `handler.is_last_attempt()` diz se um erro agora seria definitivo. É `true` na última tentativa permitida e sempre `true` com `RetryPolicy::Cancel`. Use para reportar uma falha uma única vez em vez de em toda tentativa:

```rust
async fn sync_customer(job: SyncCustomer, handler: JobHandler) -> RekkaExecutionResult {
    match call_crm(&job.customer_id).await {
        Ok(()) => handler.success(),
        Err(error) if handler.is_last_attempt() => {
            alert_on_call(&job.customer_id, &error).await;
            handler.err(error)
        }
        Err(error) => handler.err(error),
    }
}
```

## Reagendando pelo handler

`retry_after(duration)` e `retry_at(instant)` colocam o job para rodar mais tarde sem aplicar a política de retry e sem evento `Failed`; o evento é `Rescheduled`. Use para "ainda não" e não para "isso falhou": um rate limit que pede para voltar depois, ou um recurso que ainda não está pronto.

O contador de tentativas continua subindo a cada execução, inclusive nas que terminam em reagendamento. Reagendar nunca mata um job sozinho, mas depois que o contador chega a `max_attempts`, o próximo erro é definitivo.

## Timeouts e pânicos

Um timeout descarta o future do handler e registra `job timed out after <duração>`. Um pânico é capturado e registrado como `job panicked: <mensagem>`. Os dois seguem a política de retry como qualquer outro erro. Lembre que um future descartado para no último `.await`; o trabalho que ele já começou em outros sistemas não é desfeito.

## Jobs mortos

Um job morto é apagado do Redis. O Rekka não mantém uma fila de jobs mortos, mas o evento `Dead` traz tudo o que é preciso para montar uma:

```rust
.on_event(|event| {
    if event.is_dead() {
        eprintln!(
            "{} {:?} gave up after {} attempts: {:?} (payload: {:?})",
            event.job_name(),
            event.task_id(),
            event.attempt(),
            event.error(),
            event.payload(),
        );
    }
})
```

Grave no seu banco ou no seu pipeline de logs em vez de no `stderr`, e enfileire o payload de novo quando a causa for corrigida. Veja [Eventos](/pt-br/docs/rekka/queues/events).

## Escolhendo uma política

| Situação | Configuração sugerida |
| --- | --- |
| Chamadas a uma API externa que tem instabilidades | `RetryAfterRange` com um intervalo amplo e mais tentativas |
| Trabalho rápido e local que raramente falha | O padrão, ou `RetryImmediate` com `max_attempts` baixo |
| Trabalho que não pode rodar duas vezes depois de um erro | `RetryPolicy::Cancel` e um alerta no `Dead` |
| Trabalho que precisa acontecer em algum momento | `unlimited_attempts()` e monitoramento dos eventos `Failed` |
