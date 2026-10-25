# Workers recorrentes

Um worker recorrente roda uma tarefa a cada intervalo ou em um agendamento cron: limpar sessões expiradas a cada hora, atualizar cotações a cada cinco minutos, mandar um resumo todo dia útil às 9:00. Com várias instâncias do serviço rodando, cada ciclo continua rodando em exatamente uma delas.

## Registrando um worker recorrente

```rust
use std::time::Duration;

use rekka::{Queues, RekkaData};

async fn purge_expired_sessions(RekkaData(db): RekkaData<Database>) -> anyhow::Result<()> {
    let removed = db.delete_expired_sessions().await?;
    println!("removed {removed} sessions");
    Ok(())
}

let queues = Queues::new(redis_url)
    .data(database)
    .register_recursive("purge_expired_sessions", |w| {
        w.interval(Duration::from_secs(60 * 60)).build_fn(purge_expired_sessions)
    })
    .start()
    .await?;
```

A tarefa é uma `async fn` que recebe só [extractors](/pt-br/docs/rekka/queues/handlers#extractors) (até oito) e retorna `()` ou `Result<(), E>` em que `E` implementa `Display`. Não há `JobHandler` nem job: um worker recorrente não é uma fila.

| Método | Padrão | O que controla |
| --- | --- | --- |
| `interval(duration)` | 60 s | Tempo entre os inícios de duas execuções. No mínimo 10 ms. |
| `cron_time(expr)` | | Executa nos instantes de uma expressão cron em vez de um intervalo. Veja [Agendamento cron](#agendamento-cron). |
| `timezone(tz)` | UTC | Fuso em que a expressão cron é avaliada. |
| `lease(duration)` | 30 s | Quanto tempo outra instância espera antes de assumir o lugar de uma que parou de responder. No mínimo 100 ms. |
| `max_future_size(bytes)` | O do builder, 16 KiB | Maior future de tarefa antes de o `start()` avisar. Veja [Tamanho do future do handler](/pt-br/docs/rekka/queues/handlers#tamanho-do-future-do-handler). |
| `build_fn(task)` | | Termina a configuração. |

O nome identifica o agendamento no Redis, então precisa ser único, não pode conter `{` nem `}` e deve continuar o mesmo entre deploys.

## Agendamento cron

`cron_time` recebe uma expressão cron no mesmo formato do `node-cron` (o `cronTime` do pacote `cron` do JavaScript). Ela tem cinco campos, ou seis com os segundos primeiro:

```text
┌────────────── segundo (0-59, opcional)
│ ┌──────────── minuto (0-59)
│ │ ┌────────── hora (0-23)
│ │ │ ┌──────── dia do mês (1-31)
│ │ │ │ ┌────── mês (1-12 ou jan-dec)
│ │ │ │ │ ┌──── dia da semana (0-7 ou sun-sat; 0 e 7 são domingo)
* * * * * *
```

```rust
use chrono::FixedOffset;

let queues = Queues::new(redis_url)
    .register_recursive("refresh_rates", |w| w.cron_time("*/2 * * * *").build_fn(refresh_rates))
    .register_recursive("heartbeat", |w| w.cron_time("*/10 * * * * *").build_fn(heartbeat))
    .register_recursive("daily_digest", |w| {
        w.cron_time("0 30 9 * * mon-fri")
            .timezone(FixedOffset::west_opt(3 * 3600).unwrap())
            .build_fn(send_digest)
    })
    .start()
    .await?;
```

| Expressão | Executa |
| --- | --- |
| `* * * * *` | A cada minuto, no segundo 0. |
| `*/2 * * * *` | A cada 2 minutos. |
| `*/10 * * * * *` | A cada 10 segundos. |
| `0 30 9 * * 1-5` | Às 09:30:00, de segunda a sexta. |
| `0 0 1 * *` | À meia-noite do primeiro dia de cada mês. |
| `0 8,12,18 * * *` | Às 08:00, 12:00 e 18:00. |
| `10-30/10 * * * *` | Nos minutos 10, 20 e 30 de cada hora. |

Cada campo aceita `*`, um valor (`5`), um intervalo (`1-5`), uma lista (`1,15,30`) e um passo sobre `*`, um intervalo ou um valor inicial (`*/2`, `10-30/5`, `5/15`). Nomes de meses e dias da semana, em inglês, valem em maiúsculas ou minúsculas, curtos ou longos (`jan`, `january`, `mon`, `monday`). Como no cron padrão, quando o dia do mês e o dia da semana são restritos (nenhum começa com `*`), um dia casa se qualquer um dos dois casar.

- **Nunca na subida.** Ao contrário de `interval`, um worker cron não executa quando o serviço sobe. A primeira instância a subir agenda o próximo instante da expressão, e todas as instâncias esperam por ele.
- **Um único relógio.** O próximo instante é calculado a partir do relógio do Redis, então instâncias com relógios diferentes ainda concordam.
- **Fuso horário.** As expressões são avaliadas em UTC. Passe qualquer `chrono::TimeZone` para `timezone`: `chrono::FixedOffset`, `chrono::Local` ou um fuso do crate `chrono-tz`, como `chrono_tz::America::Sao_Paulo`. Use o mesmo fuso em todas as instâncias. Um horário pulado por uma mudança de horário de verão não executa naquele dia; um horário repetido executa uma vez.
- **Validado na subida.** Uma expressão inválida, ou uma que nunca casa como `0 0 30 2 *`, faz o `start()` falhar com `RekkaError::InvalidConfig`.
- **Instantes perdidos.** Se uma execução ainda está rodando quando chega o próximo instante, a próxima começa assim que ela terminar. Se todas as instâncias estavam fora do ar, acontece no máximo uma execução atrasada quando a primeira voltar.

`interval` e `cron_time` se substituem: vale o último chamado.

## Como as execuções são agendadas

- **Uma instância por ciclo.** Antes de rodar, uma instância pega um lock no Redis e define o próximo horário para todas. As outras instâncias veem o agendamento e esperam.
- **Intervalo de início a início.** Com `interval`, a próxima execução é agendada quando uma execução começa. Se uma execução demora mais que o intervalo, a próxima espera ela terminar: as execuções nunca se sobrepõem.
- **O primeiro start roda na hora.** Com `interval`, quando ainda não existe agendamento no Redis, a primeira instância a subir roda a tarefa imediatamente. Depois disso, todas as instâncias seguem o agendamento compartilhado, então um restart ou um deploy não dispara uma execução extra.
- **Substituição.** A instância que está rodando renova o lock a cada `lease / 3`. Se ela morrer, outra instância assume quando a lease expirar.
- **Sem retries.** Uma tarefa que retorna erro ou entra em pânico é registrada com `tracing` e emite um evento `Failed`; a próxima execução acontece no próximo ciclo normalmente.
- **Encerramento.** No encerramento gracioso, uma tarefa em execução pode terminar. Com um [`shutdown_timeout`](/pt-br/docs/rekka/operations/lifecycle#timeout-de-encerramento), ela é abortada quando o tempo acaba.

## Eventos

Cada execução emite `Started` e depois `Succeeded` ou `Failed` pelo [`on_event`](/pt-br/docs/rekka/queues/events), com `EventSource::Recursive` como origem, o nome do worker em `job_name()`, a duração em `elapsed()` e sem `task_id`.

## Workers recorrentes ou jobs agendados

| Use | Quando |
| --- | --- |
| Um worker recorrente | O trabalho é periódico e não pertence a uma entidade: varreduras, atualizações, relatórios. |
| Um [job agendado](/pt-br/docs/rekka/queues/jobs#rodar-em-um-instante) | O trabalho pertence a uma entidade em um horário: "lembrar o cliente 42 amanhã às 9:00". |

Para trabalho periódico em horários do relógio, use [`cron_time`](#agendamento-cron). Para um trabalho único em um horário, enfileire um job com `RekkaClient::schedule`.
