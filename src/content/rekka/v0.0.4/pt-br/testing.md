# Testes

O comportamento do Rekka vive em scripts no Redis, então os testes mais úteis rodam contra um servidor Redis de verdade. Esta página mostra como isolar testes, esperar jobs terminarem e manter os handlers fáceis de testar.

## Rode um Redis para os testes

Localmente ou no CI, um container basta:

```bash
docker run -d --name redis-test -p 6379:6379 redis:7
```

## Isole cada teste com um prefixo

Dê a cada teste o próprio [prefixo de chaves](/pt-br/docs/rekka/operations/configuration#prefixo-das-chaves). Assim os testes rodam em paralelo contra o mesmo servidor sem enxergar os jobs uns dos outros. Desligue também o tratamento de sinais, que só faz sentido em um processo real, e diminua o intervalo de polling:

```rust
use std::time::Duration;

use rekka::{Queues, QueuesBuilder};

fn test_queues() -> QueuesBuilder {
    Queues::new(std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into()))
        .prefix(format!("test-{}", uuid::Uuid::new_v4()))
        .handle_signals(false)
        .poll_interval(Duration::from_millis(50))
}
```

## Espere um job com eventos

Mande os eventos para um canal e espere o evento final:

```rust
use rekka::JobEvent;

#[tokio::test]
async fn sends_the_welcome_email() -> rekka::Result<()> {
    let (events, mut received) = tokio::sync::mpsc::unbounded_channel::<JobEvent>();
    let queues = test_queues()
        .on_event(move |event| {
            let _ = events.send(event);
        })
        .register::<SendEmail>(|w| w.build_fn(send_email))
        .start()
        .await?;

    queues
        .immediate(SendEmail { task_id: "welcome:1".into(), to: "ana@example.com".into(), template: "welcome".into() })
        .await?;

    let finished = loop {
        let event = received.recv().await.expect("the queues stopped");
        if event.is_final() {
            break event;
        }
    };
    assert!(finished.is_success(), "{:?}", finished.error());

    queues.purge::<SendEmail>().await?;
    queues.shutdown().await
}
```

Envolva o loop em `tokio::time::timeout` se quiser que um job travado falhe o teste em vez de deixá-lo pendurado.

## Mantenha os handlers finos

O `JobHandler` é criado pelo Rekka, então um handler só pode ser chamado por um worker em execução. Coloque a regra de negócio em funções comuns que recebem os dados do job e as suas dependências, e deixe o handler como um adaptador pequeno que transforma o resultado delas em um `RekkaExecutionResult`. A regra ganha testes unitários rápidos sem Redis, e um teste de integração por fila cobre a ligação.

## Limpeza

`purge::<J>()` remove tudo o que uma fila deixou no Redis, e `cache.clear::<T>()` faz o mesmo para um tipo de cache. Um prefixo único por teste também garante que um teste que falhou nunca afete a próxima execução.

## A suíte de testes do próprio Rekka

O repositório do Rekka roda a suíte de integração do mesmo jeito: cada teste usa um prefixo `rekka-test-*` e apaga as próprias chaves no final.

```bash
REKKA_REDIS_URL=redis://127.0.0.1:6379 cargo test
```
