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

Quando um job fica pronto, o script que o alterou publica uma notificação no canal da fila no Redis, e os workers ociosos acordam na hora. Os workers também conferem a fila quando o próximo job agendado vence e pelo menos a cada `poll_interval`, então uma notificação perdida ou uma inscrição que caiu só adiciona latência, nunca deixa jobs presos.

## O janitor

Na operação normal nada fica para trás: jobs finalizados são apagados na hora, marcas e chaves auxiliares expiram sozinhas e estruturas vazias somem. O janitor é uma rede de segurança para estado inconsistente causado por edições manuais, restores parciais ou bugs. A cada `cleanup_interval` (10 minutos por padrão), uma instância por conjunto de filas registradas:

- devolve para a fila jobs que estão aguardando mas sumiram do índice da fila;
- marca para recuperação jobs em execução que perderam a entrada de lease;
- libera keys de concorrência cujo dono não existe mais e faz os jobs bloqueados andarem;
- apaga registros de jobs corrompidos e entradas de índice que não apontam para nada.

Ele só mexe nas filas registradas naquele processo (filas de outros serviços que usam o mesmo prefixo ficam intactas), trabalha de forma incremental com pequenas pausas para usar uma fração pequena da CPU do Redis e não roda no start.

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
- Workers recorrentes e o reconcile rodam em uma instância por ciclo.
- O Redis é a única fonte da verdade dos jobs enfileirados. Ative persistência (AOF) se perder jobs enfileirados em um restart do Redis não for aceitável, e use o [reconcile](/pt-br/docs/rekka/queues/reconcile) para reconstruir filas a partir do seu banco.
