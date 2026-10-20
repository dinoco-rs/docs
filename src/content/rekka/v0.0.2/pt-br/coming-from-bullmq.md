# Vindo do BullMQ

Se você rodava jobs em background no Node.js, provavelmente usou o BullMQ. O Rekka resolve o mesmo problema em Rust, sobre o mesmo tipo de infraestrutura (Redis), então a maior parte dos conceitos se mantém. Esta página faz o mapeamento e aponta as diferenças que importam.

## Mapa de conceitos

| BullMQ | Rekka |
| --- | --- |
| `new Queue('emails')` | Uma struct com `#[derive(RekkaQueue)]` e `#[rekka(name = "emails")]` |
| `queue.add(name, data, { jobId })` | `queues.immediate(job)`; o `task_id` do job é o id dele, e é obrigatório |
| `{ delay: 5000 }` | `queues.schedule_in(job, Duration::from_secs(5))` ou `queues.schedule(job, at)` |
| `queue.addBulk([...])` | `queues.immediate_many(jobs)` |
| `new Worker('emails', processor, { concurrency })` | `.register::<SendEmail>(\|w\| w.concurrency(n).build_fn(handler))` |
| `attempts` e `backoff` | `.max_attempts(n)` e `.retry(RetryPolicy::...)` |
| Lançar erro dentro do processor | Retornar `handler.err(...)` ou um `Err(...)` |
| `UnrecoverableError` | `handler.cancel()`, ou `RetryPolicy::Cancel` para a fila inteira |
| `job.moveToDelayed(...)` | `handler.retry_after(delay)` ou `handler.retry_at(instant)` |
| Jobs repetíveis e job schedulers | `register_recursive(name, \|w\| w.interval(...).build_fn(task))` |
| `worker.on('completed')`, `QueueEvents` | `.on_event(\|event\| ...)` |
| Stalled jobs | Leases: uma lease expirada devolve o job para a fila com um evento `Stalled` |
| `queue.remove(jobId)` | `queues.remove::<SendEmail>(task_id)` |
| `queue.getJobCounts()` | `queues.stats::<SendEmail>()` |
| `queue.obliterate()` | `queues.purge::<SendEmail>()` |
| Concorrência por grupo | `.concurrency_by_key(\|job\| job.customer_id)` |
| `worker.close()` | `queues.shutdown().await`, ou `queues.join()` com tratamento de sinais |

## Diferenças que importam

### Adicionar de novo atualiza o job

No BullMQ, adicionar um job com um id que já existe é ignorado: o job original fica como estava. No Rekka, enfileirar um `task_id` existente é um **upsert**. Um job aguardando recebe o novo payload e o novo horário, e um job rodando ganha a nova versão na fila logo depois da execução atual. Use o [reconcile](/pt-br/docs/rekka/queues/reconcile) quando quiser "adicionar só se não existir".

### Jobs finalizados não são guardados

O BullMQ mantém jobs concluídos e falhos até `removeOnComplete` ou `removeOnFail` limparem. O Rekka apaga um job assim que ele termina, qualquer que seja o resultado, e guarda só uma marca de curta duração usada pelo reconcile (`completed_ttl`, 60 segundos por padrão). Se você precisa de histórico ou de uma lista de jobs mortos, registre a partir do [`on_event`](/pt-br/docs/rekka/queues/events).

### Jobs são tipos, não nomes mais dados

Uma fila do BullMQ pode misturar nomes de job com formatos de dados diferentes. Uma fila do Rekka guarda exatamente um tipo Rust, e o handler recebe esse tipo. Um payload que deixou de desserializar conta como falha e passa pela política de retry.

### Todo job tem um id

O BullMQ gera um id quando você não passa nenhum. O Rekka sempre precisa de um `task_id`, porque upserts, `remove` e `state` são todos indexados por ele. Use algo com significado (`invoice:42`, `welcome:{user_id}`) ou um UUID quando cada enfileiramento for realmente um job novo.

### Reagendar não é falhar

`handler.retry_after(...)` e `handler.retry_at(...)` rodam o job de novo mais tarde sem aplicar a política de retry. São a ferramenta para "ainda não", por exemplo quando um rate limit pede para voltar daqui a um minuto.

### O reconcile não tem equivalente direto

O [reconcile](/pt-br/docs/rekka/queues/reconcile) roda uma função a cada intervalo, em uma instância por vez, que recria os jobs que o seu banco diz que deveriam existir, sem duplicar nem interromper os que já estão no Redis. Ele cobre dados perdidos no Redis e enfileiramentos que um bug pulou.

## Próximos passos

- [Quickstart](/pt-br/docs/rekka/guide/quickstart), se você ainda não rodou um worker.
- [Retries e falhas](/pt-br/docs/rekka/queues/retries), para as regras exatas de retry.
- [Workers recorrentes](/pt-br/docs/rekka/queues/recurring), para substituir jobs repetíveis.
