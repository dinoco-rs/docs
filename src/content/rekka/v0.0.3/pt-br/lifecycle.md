# Inicialização e encerramento

Um handle `Queues` tem uma vida simples: `start()` sobe tudo, o handle é usado para enfileirar enquanto o processo roda, e um encerramento gracioso deixa os jobs em execução terminarem antes de o processo sair.

## Iniciando

O `start()` confere a [configuração](/pt-br/docs/rekka/operations/configuration#validacao-no-start), conecta ao Redis, carrega os scripts Lua do Rekka, confere se cada extractor tem o que precisa e inicia os workers, os workers recorrentes e o listener de notificações. Ele retorna assim que tudo está rodando.

O `Queues` retornado é barato de clonar. Guarde no estado da aplicação e enfileire a partir dos handlers de requisição.

## Esperando com join

`join()` bloqueia até o encerramento ser pedido, então para de pegar jobs novos e espera os que estão rodando:

```rust
let queues = Queues::new(redis_url)
    .register::<SendEmail>(|w| w.build_fn(send_email))
    .start()
    .await?;

queues.join().await // retorna com Ctrl+C ou SIGTERM
```

Por padrão, `join()` para com SIGINT (Ctrl+C) e SIGTERM (o que o Docker e o Kubernetes mandam). Desligue com `handle_signals(false)` quando a sua aplicação já trata sinais e chama `shutdown()` por conta própria.

## Encerrando pelo código

`shutdown()` começa um encerramento gracioso na hora, mesmo antes do `.await`, e retorna um future que termina quando todos os jobs em execução acabarem:

```rust
let queues = Queues::new(redis_url)
    .handle_signals(false)
    .register::<SendEmail>(|w| w.build_fn(send_email))
    .start()
    .await?;

let for_requests = queues.clone();
// ... inicie o servidor web com `for_requests` no estado ...

tokio::signal::ctrl_c().await.expect("listen for Ctrl+C");
// A partir daqui esta instância não pega nada novo, mesmo com outros servidores enfileirando.
queues.shutdown().await?;
```

Depois que o encerramento começa, os workers não pegam nada novo, os workers recorrentes param de agendar e `is_running()` retorna `false`. Com várias instâncias, outros servidores continuam enfileirando enquanto esta termina: esses jobs ficam na fila para as instâncias que continuam no ar, mesmo que esta tenha slots livres. Jobs que um claim já estava buscando quando o encerramento começou voltam para a fila sem executar e sem contar tentativa. Enfileirar por este handle continua funcionando enquanto a conexão estiver aberta.

## Timeout de encerramento

Sem limite, o encerramento gracioso espera o tempo que os jobs em execução levarem. `shutdown_timeout(duration)` limita isso: jobs que ainda estiverem rodando quando o tempo acabar são abortados e devolvidos para a fila na hora, para que outra instância os pegue sem esperar a lease. `join()` e `shutdown()` então retornam `RekkaError::ShutdownTimeout { abandoned }` com o número de jobs devolvidos.

```rust
Queues::new(redis_url).shutdown_timeout(Duration::from_secs(25))
```

Use um valor um pouco abaixo do período de tolerância da sua plataforma, como o `terminationGracePeriodSeconds` do Kubernetes, para que o próprio Rekka devolva os jobs antes de o processo ser morto.

## Abortando

`abort()` para tudo de uma vez, como se o processo tivesse morrido. Os jobs em execução não voltam para a fila; outras instâncias os recuperam quando as leases expirarem. Use em testes ou quando o processo precisa parar imediatamente.

## Checklist para produção

- Chame `join()` ou `shutdown()` antes de o processo sair, para que os jobs em execução terminem.
- Defina `shutdown_timeout` abaixo do prazo em que a plataforma mata o processo.
- Mantenha os handlers idempotentes: um job pode rodar de novo depois de uma queda. Veja [Confiabilidade e escala](/pt-br/docs/rekka/operations/reliability#leases-e-heartbeats).
