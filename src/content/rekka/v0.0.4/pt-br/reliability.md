# Confiabilidade e escala

O Rekka foi feito para rodar em muitas instâncias ao mesmo tempo, com o Redis como único ponto de coordenação. Esta página explica as garantias que ele dá, o que ele espera dos seus handlers e o que ele guarda no Redis.

## Transições atômicas

Toda mudança em uma fila (enfileirar, pegar, finalizar, retry, remover, renovar lease, recuperar) é um script Lua que o Redis roda atomicamente. Não há leitura-modificação-escrita a partir do Rust, então duas instâncias nunca veem um job pela metade. Os scripts leem a hora do próprio Redis, então servidores com relógios diferentes concordam sobre quando um job vence e quando uma lease expira.

## Leases e heartbeats

Quando um worker pega um job, o job recebe uma lease: um prazo, de 30 segundos por padrão. Enquanto o handler roda, o worker renova a lease a cada `lease / 3`. Se o processo cair, for morto ou parar de responder, a lease expira, e uma etapa de recuperação que toda instância roda (a cada `lease / 2`, entre 100 ms e 5 s) devolve o job para a fila com um evento `Stalled`.

Um job recuperado conta a execução perdida como uma tentativa. Se era a última tentativa, ele morre; se tinha sido removido, é descartado.

> [!WARNING]
> A entrega é **at-least-once** (pelo menos uma vez). Um worker que trava além da lease e depois termina tem o resultado ignorado (o Rekka rejeita finalizações de execuções que perderam a lease), mas o que o handler já fez, como chamar uma API, aconteceu, e o job roda de novo em outro lugar. Mantenha os handlers idempotentes: confira se o trabalho já foi feito ou use chaves de idempotência com serviços externos.

## Notificações e polling

Quando um job fica pronto, o script que o alterou publica uma notificação no canal da fila no Redis, e os workers ociosos acordam na hora. Os workers também conferem a fila quando o próximo job agendado vence e pelo menos a cada `poll_interval`, então uma notificação perdida ou uma inscrição que caiu só adiciona latência, nunca deixa jobs presos. Veja [Quedas do Redis e falhas](#quedas-do-redis-e-falhas) para como a inscrição se recupera.

## O janitor

Na operação normal nada fica para trás: jobs finalizados são apagados na hora, marcas e chaves auxiliares expiram sozinhas e estruturas vazias somem. O janitor é uma rede de segurança para estado inconsistente causado por edições manuais, restores parciais ou bugs. A cada `cleanup_interval` (10 minutos por padrão), uma instância por conjunto de filas registradas:

- devolve para a fila jobs que estão aguardando mas sumiram do índice da fila;
- marca para recuperação jobs em execução que perderam a entrada de lease;
- libera keys de concorrência cujo dono não existe mais e faz os jobs bloqueados andarem;
- apaga registros de jobs corrompidos e entradas de índice que não apontam para nada.

Ele só mexe nas filas registradas naquele processo (filas de outros serviços que usam o mesmo prefixo ficam intactas), trabalha de forma incremental com pequenas pausas para usar uma fração pequena da CPU do Redis e não roda no start.

## Quedas do Redis e falhas

O Rekka continua funcionando durante uma queda do Redis e retoma de onde parou quando ele volta. Nada precisa ser reiniciado.

- **Os enqueues são guardados.** Com o Redis fora do ar, `immediate`, `schedule`, `schedule_in` e `immediate_many` salvam os jobs num arquivo local e retornam `Enqueued::Buffered`; eles são enviados, na ordem, quando o Redis volta, e só executam depois de chegar a ele. Veja [Enfileirando com o Redis fora do ar](/pt-br/docs/rekka/queues/jobs#enfileirando-com-o-redis-fora-do-ar).
- **As outras chamadas falham rápido.** `Cache::get` lê `None`, e `remove`, `state`, `stats` e as escritas do cache falham na hora, em vez de esperar uma série de tentativas de reconexão; a próxima chamada tenta reconectar. Uma escrita no cache feita durante uma queda nunca é aplicada depois. Seus handlers e rotas HTTP nunca ficam presos num Redis inacessível por mais que o `connection_timeout`.
- **Reconexão.** Todo comando passa por uma conexão que se reconecta sozinha. Uma conexão que para de responder sem fechar (failover para outro endereço, partição de rede) é trocada depois de dois `response_timeout` seguidos, em vez de esperar minutos até o sistema operacional desistir dela.
- **As notificações voltam.** A assinatura de notificações se reconecta com backoff e é verificada com um `PING` a cada `2 × response_timeout` (entre 1 s e 30 s), então uma assinatura muda também é trocada. Os workers continuam fazendo polling enquanto isso, e todas as filas são conferidas assim que a assinatura volta.
- **Workers recuam.** Enquanto o Redis está inacessível, claims, recuperação e agendamentos recorrentes falham com um aviso e tentam de novo com backoff exponencial (de 50 ms até 5 s). Scripts apagados por um restart do Redis são carregados de novo no primeiro uso.
- **Jobs em execução mantêm o resultado.** Um job que termina durante uma queda continua tentando concluir até o Redis responder, então o resultado não se perde. Se a queda passar da lease, outra instância pode recuperar e rodar o job de novo: a entrega continua sendo pelo menos uma vez.
- **Locks recorrentes são retomados.** Se o lock de um worker recorrente expira enquanto a tarefa ainda roda, o próximo heartbeat o retoma (quando nenhuma outra instância o detém), então o agendamento não começa uma segunda execução simultânea. Um reconcile em execução também mantém a próxima execução pelo menos um intervalo à frente a cada heartbeat, então, mesmo com o lock perdido, nenhuma outra instância começa outra antes de um intervalo depois do último heartbeat. Uma execução que termina durante uma queda continua tentando liberar o lock até o Redis responder, então a lease não segura a próxima execução.
- **O reconcile roda quando o Redis volta.** Ele não roda durante uma queda; quando o Redis volta a responder, uma instância o executa uma vez, mesmo antes do horário. Veja [Quando roda](/pt-br/docs/rekka/queues/reconcile#quando-roda).
- **Restart do Redis sem persistência.** Chaves e scripts somem: os scripts são carregados de novo, os agendamentos recorrentes são recriados (um worker com `interval` e o reconcile rodam na hora) e o [reconcile](/pt-br/docs/rekka/queues/reconcile) devolve os jobs que o seu banco diz que deveriam existir.
- **Encerrando durante uma queda.** Os loops param na hora. Jobs ainda em execução esperam o Redis para reportar o resultado, até o [`shutdown_timeout`](/pt-br/docs/rekka/operations/lifecycle#timeout-de-encerramento) quando ele está configurado; depois disso são abandonados e voltam pela lease.
- **Falhas no handler.** Um handler que entra em pânico falha aquela tentativa e segue a política de retry. Um erro ou pânico no hook `on_event` é capturado e nunca chega ao worker.
- **Falhas internas.** Se um dos loops do próprio Rekka (um worker de fila, um worker recorrente, o listener de notificações) entrar em pânico, ele é registrado no log e reiniciado com backoff. Os jobs que rodavam naquele loop voltam para a fila quando a lease expira.
- **Subida.** `start()` e `Cache::connect` precisam do Redis acessível. Eles tentam por cerca de 5 segundos (o Redis pode estar subindo junto com o serviço) e então retornam `RekkaError::Redis` em vez de subir configurados pela metade. Depois de no ar, o processo nunca para por causa do Redis.
- **Leituras do cache.** `Cache::get` retorna `None` enquanto o Redis está inacessível, então quem chama cai para a fonte da verdade.

## O que o Rekka guarda no Redis

Todas as chaves de uma fila compartilham a hash tag `{fila}`:

| Chave | Tipo | Conteúdo |
| --- | --- | --- |
| `<prefix>:{<fila>}:queue` | Sorted set | Jobs aguardando, com score no horário em que ficam prontos. |
| `<prefix>:{<fila>}:active` | Sorted set | Jobs em execução, com score no prazo da lease. |
| `<prefix>:{<fila>}:locks` | Hash | Key de concorrência para o job que a detém. |
| `<prefix>:{<fila>}:j:<task_id>` | Hash | Um job: payload, tentativas, estado, key de concorrência e uma próxima versão pendente. |
| `<prefix>:{<fila>}:g:<key>` | List | Jobs bloqueados em uma key de concorrência, em ordem. |
| `<prefix>:{<fila>}:d:<task_id>` | String com TTL | Marca de "concluído recentemente" usada pelo reconcile. |
| `<prefix>:{<fila>}:notify` | Canal pub/sub | Acorda os workers quando um job fica pronto. |
| `<prefix>:{rec:<nome>}:next` e `:lock` | Strings com TTL | Agendamento compartilhado e lock de um worker recorrente. |
| `<prefix>:cache:<namespace>:<key>` | String | Uma entrada de cache, em JSON. |

## Escalando

- Rode quantas instâncias precisar com o mesmo Redis e o mesmo prefixo. Os workers de todas as instâncias dividem os jobs de cada fila.
- `concurrency` é por instância; [`concurrency_by_key`](/pt-br/docs/rekka/queues/concurrency#concorrencia-por-key) vale somando todas.
- Workers recorrentes, o reconcile e o janitor rodam em uma instância por ciclo, pelo mesmo agendamento e lock compartilhados no Redis.
- O Redis é a única fonte da verdade dos jobs enfileirados. Ative persistência (AOF) se perder jobs enfileirados em um restart do Redis não for aceitável, e use o [reconcile](/pt-br/docs/rekka/queues/reconcile) para reconstruir filas a partir do seu banco.
