# Rekka v0.0.1

Esta página acompanha o que mudou de versão para versão. Cada item aponta para a página que documenta o recurso em detalhe.

## v0.0.1

O primeiro lançamento público do Rekka.

- **Jobs tipados com upsert.** `#[derive(RekkaQueue)]` transforma uma struct serde em um job. O `task_id` faz de todo enfileiramento um upsert: um job aguardando é atualizado, e um job rodando ganha a nova versão na fila logo depois da execução atual. Veja [Jobs e enfileiramento](/pt-br/docs/rekka/queues/jobs).
- **Workers.** Concorrência por processo, políticas de retry, limite de tentativas, timeouts e leases, configurados por fila. Handlers são `async fn` comuns com extractors para estado compartilhado, o client e o cache. Veja [Workers](/pt-br/docs/rekka/queues/workers) e [Handlers e extractors](/pt-br/docs/rekka/queues/handlers).
- **Concorrência por key.** No máximo um job rodando por key em todas as instâncias, com os jobs que aguardam recebendo a key em ordem. Veja [Concorrência](/pt-br/docs/rekka/queues/concurrency).
- **Workers recorrentes e reconcile.** Tarefas por intervalo que rodam em uma instância por ciclo, e um hook, agendado do mesmo jeito, que recria os jobs que a sua fonte da verdade diz que deveriam existir. Veja [Workers recorrentes](/pt-br/docs/rekka/queues/recurring) e [Reconcile](/pt-br/docs/rekka/queues/reconcile).
- **Eventos.** Um único hook `on_event` para cada transição de job. Veja [Eventos](/pt-br/docs/rekka/queues/events).
- **Cache tipado.** `#[derive(RekkaCache)]` com TTL e uma key que é um campo ou um template montado com os campos da struct (`"payments-{business_id}"`), leituras e escritas individuais e em lote e limpeza incremental. Veja [Tipos de cache](/pt-br/docs/rekka/cache/cache-types).
- **Operação.** Encerramento gracioso com SIGINT e SIGTERM, recuperação de jobs travados e um janitor periódico que repara estado inconsistente. Veja [Inicialização e encerramento](/pt-br/docs/rekka/operations/lifecycle) e [Confiabilidade e escala](/pt-br/docs/rekka/operations/reliability).
- Requer Rust 1.88 ou mais recente e um servidor Redis 6+.
