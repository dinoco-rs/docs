# Rekka v0.0.2

Esta página acompanha o que mudou de versão para versão. Cada item aponta para a página que documenta o recurso em detalhe.

## v0.0.2

- **Agendamento cron.** `cron_time("*/2 * * * *")` executa um worker recorrente nos instantes de uma expressão cron, no formato do `node-cron`: cinco campos, ou seis com os segundos primeiro, com intervalos, listas, passos e nomes de meses e dias da semana. É avaliada em UTC por padrão ou em qualquer fuso do `chrono` com `timezone(...)`, a partir do relógio do Redis, então todas as instâncias concordam. Ao contrário de `interval`, nunca executa na subida. Veja [Agendamento cron](/pt-br/docs/rekka/queues/recurring#agendamento-cron).
- **Keys de cache hidratadas.** Com um template de um único campo, como `#[rekka(key = "session:{session_id}")]`, `get`, `get_many`, `contains`, `remove` e `remove_many` aceitam o valor do campo (`cache.get::<Session>(42)`) além da key completa (`"session:42"`). Veja [Keys dinâmicas](/pt-br/docs/rekka/cache/cache-types#keys-dinamicas).
- **Mudança incompatível: `get` retorna `Option<T>`.** `Cache::get` não retorna mais um `Result`. Entrada ausente, key inválida, entrada incompatível ou Redis inacessível são lidos como `None`, e o erro vai para o log via `tracing`. Remova o `?` ou o `match` sobre o resultado. Os outros métodos do cache continuam retornando `rekka::Result`. Veja [Lendo](/pt-br/docs/rekka/cache/cache-operations#lendo).
- **O shutdown não pega nada novo.** Um encerramento que começa durante um claim devolve esses jobs para a fila sem executar nem contar tentativa, então jobs que outros servidores enfileiram durante o encerramento sempre vão para as instâncias que continuam no ar. Veja [Encerrando pelo código](/pt-br/docs/rekka/operations/lifecycle#encerrando-pelo-codigo).
- **Somente Apache-2.0.** O Rekka agora é licenciado só pela Apache License 2.0 (antes era MIT ou Apache-2.0).
- **Mais resistente a falhas.** Os loops internos (workers de fila, workers recorrentes, o listener de notificações) reiniciam se entrarem em pânico em vez de parar em silêncio, e um worker recorrente cujo lock expirou enquanto ainda executava (queda do Redis maior que a lease, ou restart sem persistência) retoma o lock para que nenhuma outra instância comece uma execução simultânea. Veja [Quedas do Redis e falhas](/pt-br/docs/rekka/operations/reliability#quedas-do-redis-e-falhas).

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
