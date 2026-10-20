# Reconcile

Os jobs vivem no Redis, mas a verdade sobre o que deveria estar pendente normalmente vive no seu banco: faturas que ainda precisam ser cobradas, relatórios que ainda precisam ser enviados. O reconcile fecha essa lacuna. Ele roda uma função sua que recria os jobs que o banco diz que deveriam existir, sem duplicar nem interromper os que o Redis já tem.

Ele cobre os casos que uma fila sozinha não cobre: um restart do Redis sem persistência, um failover que perdeu escritas recentes ou um trecho de código que salvou uma linha e caiu antes de enfileirar.

## Registrando uma função de reconcile

```rust
use std::time::Duration;

use rekka::{Queues, ReconcileHandler, RekkaState};

async fn reconcile_invoices(handler: ReconcileHandler, RekkaState(db): RekkaState<Database>) -> anyhow::Result<()> {
    for invoice in db.pending_invoices().await? {
        handler.add(ChargeInvoice { invoice_id: invoice.id, amount_cents: invoice.amount_cents }).await?;
    }
    Ok(())
}

let queues = Queues::new(redis_url)
    .data(database)
    .register::<ChargeInvoice>(|w| w.build_fn(charge_invoice))
    .with_reconcile(reconcile_invoices, Duration::from_secs(5 * 60))
    .start()
    .await?;
```

Uma função de reconcile tem o mesmo formato de uma [tarefa recorrente](/pt-br/docs/rekka/queues/recurring#registrando-um-worker-recorrente): extractors na entrada, `()` ou `Result<(), E>` na saída. Você pode registrar várias com chamadas repetidas de `with_reconcile`.

## Quando roda

O reconcile é agendado exatamente como um [worker recorrente](/pt-br/docs/rekka/queues/recurring#como-as-execucoes-sao-agendadas): com várias instâncias rodando, **só uma delas executa cada ciclo**, inclusive na subida.

- **Na hora, quando não há agendamento.** Quando o Redis ainda não tem agendamento para a função (uma instalação nova, ou um Redis que perdeu os dados), a primeira instância a subir a executa imediatamente. O `start()` não espera por isso.
- **Depois, uma vez por intervalo, em uma instância.** Todas as instâncias seguem o agendamento compartilhado, então subir várias instâncias juntas, reiniciar ou fazer deploy nunca executa mais de uma vez por ciclo.

## O ReconcileHandler

O `ReconcileHandler` é um extractor cujos métodos só **criam** jobs:

| Método | Efeito |
| --- | --- |
| `add(job)` | Adiciona o job para rodar agora, se ele deve ser adicionado. |
| `add_at(job, at)` | Adiciona o job para rodar em um `DateTime<Utc>`, se ele deve ser adicionado. |
| `add_many(jobs)` | Adiciona vários jobs em lote e retorna quantos foram criados. |
| `client()` | O `RekkaClient`, para upserts normais. |

Um job só é adicionado quando não existe job com o mesmo `task_id` na fila (aguardando, agendado, bloqueado ou rodando) e ele não terminou há menos de `completed_ttl`. `add` e `add_at` retornam `Enqueued::Created`, `Enqueued::AlreadyExists` ou `Enqueued::RecentlyCompleted`. Jobs existentes nunca são atualizados nem interrompidos.

## Por que o completed_ttl importa

O reconcile lê o banco e depois adiciona jobs. Entre uma coisa e outra, um worker pode terminar um desses jobs. Sem proteção, o reconcile veria o job como ausente e o adicionaria de novo, e o trabalho rodaria duas vezes.

Para evitar isso, o Rekka guarda uma pequena marca de cada job finalizado por `completed_ttl` (60 segundos por padrão), e o reconcile não recria um job enquanto a marca existe. Use um valor maior que o tempo entre o handler terminar e o banco refletir isso:

```rust
Queues::new(redis_url).completed_ttl(Duration::from_secs(5 * 60))
```

`Duration::ZERO` desliga as marcas. Enfileiramentos normais (`immediate`, `schedule`, ...) ignoram e limpam a marca, então você sempre pode rodar um job de novo de propósito.

## Eventos

Cada execução do reconcile emite `Started` e depois `Succeeded` ou `Failed` pelo [`on_event`](/pt-br/docs/rekka/queues/events), com `EventSource::Reconcile` como origem e `reconcile` em `job_name()`.
