# Rekka v0.0.5

Esta página acompanha o que mudou de versão para versão. Cada item aponta para a página que documenta o recurso em detalhe.

## v0.0.5

- **O future do handler é boxeado uma única vez.** O Rekka boxeia o future que o handler devolve no momento em que chama o handler e guarda só um ponteiro para ele, então o estado do próprio Rekka para cada job tem o mesmo tamanho, seja o que for que o handler mantenha vivo através de um `.await`. Antes, uma fila guardava o future do handler três vezes por job e o copiava por todos os frames do caminho do spawn: num build de debug, um handler cujo future tem 64 KiB precisava de cerca de 1 MiB de stack, e um de 128 KiB estourava os 2 MiB padrão do Tokio. Workers recorrentes, agendamentos cron e reconcile passam pelo mesmo caminho. Veja [Tamanho do future do handler](/pt-br/docs/rekka/queues/handlers#tamanho-do-future-do-handler).
- **Verificação do tamanho do handler no start.** O `start()` mede o future de cada handler e emite um aviso quando ele passa do `max_future_size`, 16 KiB por padrão. Defina o limite por worker com `max_future_size(bytes)` ou para todos os handlers com `QueuesBuilder::max_future_size`. Com `strict_future_size(true)`, o `start()` falha com `RekkaError::InvalidConfig` em vez de avisar. `Queues::future_sizes()` lista os tamanhos medidos. Veja [Tamanho do future do handler](/pt-br/docs/rekka/queues/handlers#tamanho-do-future-do-handler).
- **Breaking: `JobFn::call` e `TaskFn::call` retornam `Pin<Box<Self::Future>>`.** Só afeta código que chama esses métodos ou implementa as traits na mão; handlers escritos como `async fn` ou closures não mudam.

## v0.0.4

- **O reconcile espera a execução anterior.** O intervalo do `with_reconcile` agora conta do fim da execução anterior, não do início: enquanto um reconcile está rodando, o próximo não é agendado, então um reconcile mais lento que o intervalo não roda mais emendado. Ele continua rodando em uma única instância por ciclo, inclusive na subida, e cada heartbeat mantém a próxima execução um intervalo à frente, então perder o lock no meio de uma execução (Redis fora por mais que a lease) não inicia uma segunda execução em outra instância. Veja [Quando roda](/pt-br/docs/rekka/queues/reconcile#quando-roda).
- **Os enqueues sobrevivem a quedas do Redis.** Com o Redis fora do ar, `immediate`, `schedule`, `schedule_in` e `immediate_many` salvam os jobs num arquivo local e retornam o novo `Enqueued::Buffered`. Eles são enviados ao Redis na ordem assim que ele responde, sobrevivem a um restart do processo e nunca executam antes de chegar ao Redis. O diretório é definido com `buffer_dir` (padrão `<temp>/rekka`) e o buffer é desligado com `disable_buffer()`. Veja [Enfileirando com o Redis fora do ar](/pt-br/docs/rekka/queues/jobs#enfileirando-com-o-redis-fora-do-ar).
- **O reconcile roda quando o Redis volta.** O reconcile não roda durante uma queda e nunca usa o buffer; quando o Redis volta a responder, uma instância o executa na hora, mesmo antes do próximo horário. Veja [Quando roda](/pt-br/docs/rekka/queues/reconcile#quando-roda).
- **As outras chamadas falham rápido com o Redis fora do ar.** `remove`, `state`, `stats` e o cache agora falham (ou leem `None`) na hora durante uma queda, em vez de ficarem presos por vários segundos de tentativas de reconexão, e escritas no cache nunca são aplicadas depois. A próxima chamada reconecta. Veja [Quedas do Redis e falhas](/pt-br/docs/rekka/operations/reliability#quedas-do-redis-e-falhas).
- **Conexões mudas são trocadas.** Uma conexão que para de responder sem fechar, como depois de um failover para outro endereço ou de uma partição de rede, é trocada depois de dois timeouts de resposta seguidos, em vez de dar timeout por minutos. A assinatura de notificações é verificada com um `PING` periódico e trocada do mesmo jeito, então os jobs voltam a ser pegos na hora assim que o Redis volta.
- **Breaking: `Enqueued::Buffered`.** O `Enqueued` tem uma variante nova; um `match` exaustivo precisa de um braço para ela.
- **Requer Rust 1.89.** O buffer local trava os arquivos com os locks de arquivo da biblioteca padrão.

## v0.0.3

- **Breaking: `RekkaState` agora é `RekkaData`.** O extractor dos valores registrados com `.data(value)` passa a ter o nome do método que os registra. Troque `RekkaState` por `RekkaData` nos imports e nas assinaturas dos handlers (`RekkaData(db): RekkaData<Db>`); o funcionamento é o mesmo de antes. Veja [RekkaData](/pt-br/docs/rekka/queues/handlers#rekkadata).

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
