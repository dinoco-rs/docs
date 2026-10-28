# Jobs e enfileiramento

Um job é uma struct Rust que o Rekka guarda no Redis até um worker executá-la. Esta página mostra como definir jobs, como enfileirá-los agora ou mais tarde e o que acontece quando o mesmo job é enfileirado duas vezes.

## Definindo um job

Derive `RekkaQueue` em uma struct com campos nomeados que também derive `Serialize` e `Deserialize` do serde:

```rust
use rekka::RekkaQueue;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, RekkaQueue)]
#[rekka(name = "emails")]
struct SendEmail {
    task_id: String,
    to: String,
    template: String,
}
```

A struct precisa ser `Send + 'static`. Structs genéricas também funcionam: o derive adiciona os bounds de que o Rekka precisa.

### O task_id

Todo job tem um `task_id` que o identifica dentro da fila. Por padrão o derive usa o campo chamado `task_id`; para usar outro campo, marque-o com `#[rekka(task_id)]`:

```rust
use rekka::RekkaQueue;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize, Deserialize, RekkaQueue)]
#[rekka(name = "invoices")]
struct ChargeInvoice {
    #[rekka(task_id)]
    invoice_id: Uuid,
    amount_cents: i64,
}
```

O campo pode ser de qualquer tipo que implemente `Display`: `String`, inteiros, `Uuid` ou um tipo seu. O Rekka converte com `to_string()`. Um id vazio é rejeitado ao enfileirar, com `RekkaError::InvalidTaskId`.

Escolha um id que descreva o trabalho, como `invoice:42` ou `welcome:{user_id}`. É isso que torna os [upserts](#upserts) úteis: enfileirar "cobrar a fatura 42" duas vezes nunca cobra a fatura duas vezes ao mesmo tempo.

### Nomes de fila

`#[rekka(name = "...")]` define o nome da fila. Sem ele, o nome é o da struct em snake_case: `ChargeInvoice` vira `charge_invoice`. Nomes não podem conter `{` nem `}` (erro de compilação), e cada fila só pode ser registrada uma vez por `Queues`.

O nome faz parte de todas as chaves da fila no Redis, então renomear uma fila cria uma fila nova e vazia. Jobs que ainda aguardam com o nome antigo continuam lá; remova-os com [`purge_queue`](/pt-br/docs/rekka/queues/managing-jobs#apagando-uma-fila).

### Atributos do derive

| Atributo | Onde | O que faz |
| --- | --- | --- |
| `#[rekka(name = "emails")]` | Struct | Nome da fila. Padrão: nome da struct em snake_case. |
| `#[rekka(task_id)]` | Campo | Marca o campo identificador. Padrão: o campo chamado `task_id`. |
| `#[rekka(crate = "path")]` | Struct | Caminho do crate `rekka`, para re-exports. Padrão: `::rekka`. |

## Enfileirando

Todos os métodos de enfileiramento existem no handle `Queues` retornado por `start()` e no `RekkaClient`. Eles retornam um status [`Enqueued`](#upserts) por job.

### Rodar agora

```rust
queues.immediate(SendEmail { task_id: "welcome:42".into(), to: "ana@example.com".into(), template: "welcome".into() }).await?;
```

### Rodar em um instante

`schedule` recebe um `DateTime<Utc>`. O Rekka re-exporta o `chrono`, então você não precisa dele como dependência:

```rust
use rekka::chrono::{Duration as ChronoDuration, Utc};

let tomorrow = Utc::now() + ChronoDuration::days(1);
queues.schedule(SendEmail { task_id: "reminder:42".into(), to: "ana@example.com".into(), template: "reminder".into() }, tomorrow).await?;
```

### Rodar depois de um tempo

`schedule_in` recebe um `std::time::Duration`, medido pelo relógio do Redis, para que servidores com relógios diferentes concordem sobre quando o job vence:

```rust
use std::time::Duration;

queues.schedule_in(SendEmail { task_id: "nudge:42".into(), to: "ana@example.com".into(), template: "nudge".into() }, Duration::from_secs(15 * 60)).await?;
```

### Vários de uma vez

`immediate_many` manda os jobs para o Redis em lotes de 256 por ida e volta e retorna um status por job, na mesma ordem:

```rust
let statuses = queues.immediate_many(users.iter().map(|user| SendEmail {
    task_id: format!("digest:{}", user.id),
    to: user.email.clone(),
    template: "digest".into(),
})).await?;
```

## Upserts

Enfileirar um `task_id` que já existe nunca cria um segundo job. O que acontece depende do estado do job existente:

| Status | Quando | O que o Rekka faz |
| --- | --- | --- |
| `Enqueued::Created` | Não existe job com esse id | Adiciona o job. |
| `Enqueued::Updated` | O job está aguardando, agendado ou [bloqueado na key](/pt-br/docs/rekka/queues/concurrency#concorrencia-por-key) | Substitui o payload, o horário e a key de concorrência, e zera as tentativas. |
| `Enqueued::AfterCurrentRun` | O job está rodando | Guarda a nova versão e a coloca na fila assim que a execução atual terminar, qualquer que seja o resultado. |
| `Enqueued::AlreadyExists` | Só no [reconcile](/pt-br/docs/rekka/queues/reconcile) | Nada: o job já existe. |
| `Enqueued::RecentlyCompleted` | Só no [reconcile](/pt-br/docs/rekka/queues/reconcile) | Nada: o job terminou há menos de `completed_ttl`. |
| `Enqueued::Buffered` | O Redis está inacessível | Salva o job no buffer local e o envia quando o Redis voltar. Veja [Enfileirando com o Redis fora do ar](#enfileirando-com-o-redis-fora-do-ar). |

`AfterCurrentRun` é como o Rekka garante que duas execuções do mesmo `task_id` nunca se sobreponham. Se o job em execução falhar, a nova versão substitui o job em vez de a execução que falhou ser tentada de novo. Enfileirar um job que foi [removido durante a execução](/pt-br/docs/rekka/queues/managing-jobs#removendo-um-job) cancela essa remoção: a nova versão roda depois da atual.

## De onde enfileirar

- **O handle `Queues`.** É barato de clonar; guarde um no estado da sua aplicação.
- **`RekkaClient`.** Obtenha com `queues.client()` ou receba como [extractor](/pt-br/docs/rekka/queues/handlers#extractors) em um handler para encadear jobs: um job enfileira o próximo.
- **Um processo que só produz.** Um servidor web pode chamar `Queues::new(url).start().await?` sem registrar nenhum worker e enfileirar a partir dali.

> [!NOTE]
> Com [`concurrency_by_key`](/pt-br/docs/rekka/queues/concurrency#concorrencia-por-key), a key só é calculada no enfileiramento quando o worker daquela fila está registrado no mesmo processo. Caso contrário, o worker calcula a key quando pega o job pela primeira vez. As duas formas dão a mesma garantia.

## Enfileirando com o Redis fora do ar

`immediate`, `schedule`, `schedule_in` e `immediate_many` não perdem jobs numa queda. Quando o Redis não responde, os jobs são gravados num arquivo local e a chamada retorna `Enqueued::Buffered`. Assim que o Redis volta a responder, o Rekka envia o arquivo para o Redis, na ordem, e o esvazia.

- **Nada executa a partir do buffer.** O Redis continua sendo a fonte da verdade: um job do buffer só executa depois de chegar ao Redis, pego por um worker como qualquer outro job, em qualquer instância.
- **A ordem é mantida.** Enquanto o buffer ainda tem jobs, enqueues novos também vão para o fim dele, então uma versão antiga de um `task_id` nunca sobrescreve uma nova.
- **Atrasos contam da chamada.** `schedule_in(job, delay)` durante uma queda roda `delay` depois da chamada, pelo relógio local, e não depois de o Redis voltar.
- **Sobrevive a restarts.** O buffer fica em disco. Se o processo para com o Redis fora, a próxima instância que sobe com o mesmo diretório e prefixo o envia. Cada instância em execução trava um arquivo próprio, então várias instâncias podem dividir um diretório.
- **O reconcile não usa o buffer.** `ReconcileHandler::add` falha enquanto o Redis está fora, e o reconcile roda de novo quando o Redis volta. Veja [Quando roda](/pt-br/docs/rekka/queues/reconcile#quando-roda).
- **Só enqueues.** `remove`, `state`, `stats` e as escritas do [cache](/pt-br/docs/rekka/cache/cache-operations) continuam retornando o erro do Redis durante uma queda.

O buffer fica em `<temp>/rekka` por padrão. Em containers, aponte para um volume para ele sobreviver ao container:

```rust
Queues::new(redis_url).buffer_dir("/var/lib/my-app/rekka")
```

`disable_buffer()` desliga o buffer: os enqueues passam a retornar `RekkaError::Redis` enquanto o Redis está fora.

> [!NOTE]
> A entrega continua sendo pelo menos uma vez. Se a conexão cai depois de o Redis aplicar um enqueue, mas antes de a resposta chegar, o job também vai para o buffer e é enviado de novo: ele é atualizado se ainda estiver aguardando, ou criado de novo se já tiver rodado.

## Formato do payload

Jobs são guardados como JSON com `serde_json`. Ao mudar a struct de um job enquanto há jobs aguardando no Redis, mantenha a mudança compatível: adicione campos novos com `#[serde(default)]` e evite renomear ou remover campos que os jobs aguardando ainda têm. Um payload que não desserializa conta como falha e passa pela política de retry até o job morrer. Para uma mudança incompatível, use um nome de fila novo e deixe a fila antiga esvaziar.
