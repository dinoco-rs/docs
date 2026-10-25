# Configuração

Tudo o que o Rekka faz em um processo é configurado em um único builder: `Queues::new(redis_url)` retorna um `QueuesBuilder`, e `start()` o transforma em um handle `Queues` em execução.

## O builder

```rust
use std::time::Duration;

use rekka::Queues;

let queues = Queues::new("redis://:secret@redis.internal:6379/0")
    .prefix("billing")
    .data(database)
    .on_event(log_event)
    .register::<ChargeInvoice>(|w| w.concurrency(8).build_fn(charge_invoice))
    .register_recursive("expire_trials", |w| w.interval(Duration::from_secs(3600)).build_fn(expire_trials))
    .with_reconcile(reconcile_invoices, Duration::from_secs(300))
    .shutdown_timeout(Duration::from_secs(30))
    .start()
    .await?;
```

## Opções

| Método | Padrão | O que controla |
| --- | --- | --- |
| `prefix(prefix)` | `"rekka"` | Primeiro segmento de todas as chaves no Redis, de filas e de cache. |
| `data(value)` / `data_arc(arc)` | | Valores compartilhados para [`RekkaData<T>`](/pt-br/docs/rekka/queues/handlers#rekkadata). |
| `on_event(f)` | | O handler de [eventos](/pt-br/docs/rekka/queues/events). |
| `register::<J>(f)` | | Um [worker](/pt-br/docs/rekka/queues/workers) para a fila de `J`. |
| `register_recursive(name, f)` | | Um [worker recorrente](/pt-br/docs/rekka/queues/recurring). |
| `with_reconcile(f, interval)` | | Uma função de [reconcile](/pt-br/docs/rekka/queues/reconcile), executada `interval` depois do fim da execução anterior. |
| `completed_ttl(duration)` | 60 s | Por quanto tempo um job finalizado impede o reconcile de recriá-lo. `Duration::ZERO` desliga. |
| `cleanup_interval(duration)` | 10 min | Tempo entre as passadas do [janitor](/pt-br/docs/rekka/operations/reliability#o-janitor). No mínimo 10 ms; `Duration::ZERO` desliga. |
| `poll_interval(duration)` | 1 s | Espera máxima de um worker entre verificações quando não chega notificação. Precisa ser maior que zero. |
| `shutdown_timeout(duration)` | Nenhum | Tempo máximo que o encerramento gracioso espera os jobs em execução. Veja [Inicialização e encerramento](/pt-br/docs/rekka/operations/lifecycle#timeout-de-encerramento). |
| `handle_signals(bool)` | `true` | Se `join()` também para com SIGINT e SIGTERM. |
| `connection_timeout(duration)` | 5 s | Timeout para abrir uma conexão com o Redis. |
| `response_timeout(duration)` | 5 s | Timeout de cada resposta do Redis. Dois seguidos trocam a conexão. |
| `buffer_dir(path)` | `<temp>/rekka` | Onde os enqueues feitos com o Redis fora do ar ficam até ele voltar. Veja [Enfileirando com o Redis fora do ar](/pt-br/docs/rekka/queues/jobs#enfileirando-com-o-redis-fora-do-ar). |
| `disable_buffer()` | | Desliga esse buffer: os enqueues retornam o erro do Redis durante uma queda. |
| `max_future_size(bytes)` | 16 KiB | Maior future de handler antes de o `start()` avisar, para os workers que não definem o próprio e para o reconcile. Veja [Tamanho do future do handler](/pt-br/docs/rekka/queues/handlers#tamanho-do-future-do-handler). |
| `strict_future_size(bool)` | `false` | Se um future de handler acima do limite faz o `start()` falhar em vez de só emitir um aviso. |

## URL do Redis

`Queues::new` e `Cache::new` recebem uma URL padrão do Redis: `redis://host:porta/db`, com credenciais opcionais como `redis://:senha@host:porta` ou `redis://usuario:senha@host:porta`. O Rekka abre uma conexão que reconecta sozinha por `Queues`, compartilhada pelo cache que ele retorna, além de uma para notificações quando o processo registra workers.

## Prefixo das chaves

Toda chave que o Rekka grava começa com o prefixo: `rekka:{emails}:queue`, `rekka:cache:business:7` e assim por diante. Use prefixos diferentes para rodar várias aplicações ou ambientes no mesmo servidor Redis. Um produtor e os workers dos jobs dele precisam usar o **mesmo** prefixo, ou não vão enxergar as filas um do outro. O prefixo não pode ser vazio nem conter `{` ou `}`.

## Validação no start

O `start()` retorna erro antes de rodar qualquer coisa quando:

- o prefixo, um nome de fila ou o nome de um worker recorrente é inválido, ou um nome é registrado duas vezes (`RekkaError::InvalidConfig`);
- o `concurrency` ou o `max_attempts` de um worker é 0, uma `lease` é menor que 100 ms, ou um intervalo ou o `poll_interval` está fora do permitido (`RekkaError::InvalidConfig`);
- um handler, worker recorrente ou função de reconcile usa `RekkaData<T>` sem `.data(...)` para `T` (`RekkaError::MissingData`);
- com `strict_future_size(true)`, o future de um handler passa do seu `max_future_size` (`RekkaError::InvalidConfig`);
- o Redis não pode ser alcançado (`RekkaError::Redis`).

## Falhas de conexão

A conexão se refaz sozinha: uma chamada feita com o Redis fora falha na hora, e a próxima tenta de novo. Enquanto o Redis está indisponível:

- os enqueues vão para o [buffer local](/pt-br/docs/rekka/queues/jobs#enfileirando-com-o-redis-fora-do-ar) e são enviados quando o Redis volta;
- os workers esperam entre as tentativas de pegar jobs, de 50 ms até 5 segundos;
- finalizar um job é tentado de novo até o Redis responder, então um job concluído não roda de novo por causa de uma queda curta;
- o listener de notificações cai para polling até conseguir se inscrever de novo.

## Logs

O Rekka registra logs pelo [`tracing`](https://docs.rs/tracing): avisos para claims que falharam, leases perdidas, jobs recuperados, workers recorrentes falhando e handlers cujo future passa do `max_future_size`, e uma linha de info quando o janitor repara alguma coisa. Instale um subscriber como o `tracing-subscriber` no seu binário para vê-los.
