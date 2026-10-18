# Concorrência

O Rekka tem dois limites independentes: quantos jobs de uma fila um processo roda ao mesmo tempo, e quantos jobs com a mesma key rodam ao mesmo tempo somando todos os processos.

## Concorrência por processo

`concurrency(n)` define quantos jobs da fila rodam ao mesmo tempo neste processo. O padrão é 1.

```rust
.register::<ResizeImage>(|w| w.concurrency(8).build_fn(resize))
```

O limite é local: cada instância do seu serviço tem os próprios `n` slots. Dimensione pelo que um processo aguenta, como núcleos de CPU para trabalho pesado de CPU ou conexões do pool para trabalho que depende do banco.

## Concorrência por key

`concurrency_by_key(f)` garante no máximo um job rodando por key, **somando todos os processos**. `f` recebe o job e retorna a key, que pode ser de qualquer tipo que implemente `ToString`:

```rust
#[derive(Serialize, Deserialize, RekkaQueue)]
#[rekka(name = "customer_sync")]
struct SyncCustomer {
    task_id: String,
    customer_id: i64,
}

.register::<SyncCustomer>(|w| {
    w.concurrency(16)
        .concurrency_by_key(|job| job.customer_id)
        .build_fn(sync_customer)
})
```

Com essa configuração, até 16 sincronizações rodam por processo, mas nunca duas do mesmo cliente, não importa quantas instâncias estejam rodando. Jobs de outros clientes não ficam esperando.

### Como a espera funciona

- Quando a key de um job está ocupada, o job fica **bloqueado**: sai da fila de prontos e espera em uma lista na ordem de chegada daquela key. O `state` dele é `JobState::Blocked`, e ele não ocupa um slot do worker enquanto espera.
- Quando o job em execução termina, a key passa para o próximo job bloqueado, na ordem, que fica pronto na hora.
- Um job que falha e espera um retry **libera** a key. Outros jobs com a mesma key rodam nesse meio tempo, e o job que falhou disputa a key de novo quando o retry vencer.
- Enfileirar de novo um job bloqueado com outra key move o job para a fila da nova key.
- Se um processo morre segurando uma key, ela é liberada quando a lease do job expira.

### Quando a key é calculada

Se o worker da fila está registrado no processo que enfileira, a key é calculada no enfileiramento. Um produtor que não registra o worker não consegue calculá-la, então o worker calcula quando pega o job pela primeira vez; se a key estiver ocupada nesse momento, o job fica bloqueado e a tentativa não é contada. A garantia é a mesma nos dois casos.

`queues.stats::<SyncCustomer>().await?.locked_keys` mostra quantas keys estão ocupadas agora.

## Combinando os dois limites

Os dois limites trabalham juntos: `concurrency` limita os slots de cada processo, e `concurrency_by_key` decide quais jobs podem usá-los. Uma fila com `concurrency(16)` e uma key por cliente em quatro instâncias roda até 64 jobs ao mesmo tempo, cada um de um cliente diferente.

> [!TIP]
> Use concorrência por key para tudo que precisa ser serializado por entidade: sincronizar uma conta com um sistema externo, recalcular um saldo ou tratar os eventos de um pedido um de cada vez.
