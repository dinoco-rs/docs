# Referência da API

Todos os itens públicos do crate `rekka`, agrupados pelo uso. Cada seção aponta para a página do guia que explica o assunto em contexto.

## Queues e QueuesBuilder

`Queues::new(redis_url)` retorna um `QueuesBuilder`; `start()` retorna o `Queues` em execução. Veja [Configuração](/pt-br/docs/rekka/operations/configuration).

| Método do `QueuesBuilder` | Descrição |
| --- | --- |
| `prefix(impl Into<String>)` | Prefixo das chaves (padrão `rekka`). |
| `data<T>(T)` / `data_arc<T>(Arc<T>)` | Valor compartilhado para `RekkaData<T>`. |
| `on_event(Fn(JobEvent))` | Handler de eventos. |
| `register::<J>(FnOnce(RekkaWorker<J>) -> Worker<J>)` | Worker da fila de `J`. |
| `register_recursive(&'static str, FnOnce(RekkaRecursiveWorker) -> RecursiveWorker)` | Worker recorrente. |
| `with_reconcile(TaskFn, Duration)` | Função de reconcile. |
| `completed_ttl(Duration)` | Duração das marcas de "concluído recentemente" (padrão 60 s). |
| `cleanup_interval(Duration)` | Intervalo do janitor (padrão 10 min). |
| `poll_interval(Duration)` | Espera máxima entre verificações da fila (padrão 1 s). |
| `shutdown_timeout(Duration)` | Limite do encerramento gracioso (padrão: nenhum). |
| `handle_signals(bool)` | Para o `join()` com SIGINT/SIGTERM (padrão `true`). |
| `connection_timeout(Duration)` / `response_timeout(Duration)` | Timeouts do Redis (padrão 5 s cada). |
| `start() -> Result<Queues>` | Valida, conecta e inicia tudo. |

| Método do `Queues` | Descrição |
| --- | --- |
| `immediate(J) -> Result<Enqueued>` | Enfileira para rodar agora. |
| `schedule(J, DateTime<Utc>) -> Result<Enqueued>` | Enfileira para rodar em um instante. |
| `schedule_in(J, Duration) -> Result<Enqueued>` | Enfileira para rodar depois de um tempo. |
| `immediate_many(impl IntoIterator<Item = J>) -> Result<Vec<Enqueued>>` | Enfileira vários para rodar agora. |
| `remove::<J>(impl ToTaskId) -> Result<Removed>` | Remove um job. |
| `state::<J>(impl ToTaskId) -> Result<Option<JobState>>` | Estado de um job. |
| `stats::<J>() -> Result<QueueStats>` | Contadores de uma fila. |
| `purge::<J>() -> Result<u64>` / `purge_queue(&str) -> Result<u64>` | Apaga uma fila inteira. |
| `client() -> &RekkaClient` | O client. |
| `cache() -> Cache` | Um cache que compartilha a conexão e o prefixo. |
| `join() -> Result<()>` | Espera o encerramento (e os sinais) e então drena. |
| `shutdown() -> impl Future<Output = Result<()>>` | Começa um encerramento gracioso e espera por ele. |
| `abort()` | Para tudo imediatamente. |
| `is_running() -> bool` | Se o encerramento ainda não começou. |

## RekkaWorker

Recebido pelo closure passado a `register`. Veja [Workers](/pt-br/docs/rekka/queues/workers).

| Método | Descrição |
| --- | --- |
| `retry(RetryPolicy)` | Política de retry (padrão `RetryAfterRange(1s, 30s)`). |
| `max_attempts(u32)` | Total de execuções contando a primeira (padrão 10). |
| `unlimited_attempts()` | Sem limite de tentativas. |
| `concurrency(usize)` | Jobs em paralelo por processo (padrão 1). |
| `concurrency_by_key(Fn(&J) -> impl ToString)` | Um job rodando por key em todos os processos. |
| `timeout(Duration)` | Limite por execução. |
| `lease(Duration)` | Duração da lease (padrão 30 s, no mínimo 100 ms). |
| `build_fn(JobFn) -> Worker<J>` | Termina com o handler. |

## RekkaRecursiveWorker

Recebido pelo closure passado a `register_recursive`. Veja [Workers recorrentes](/pt-br/docs/rekka/queues/recurring).

| Método | Descrição |
| --- | --- |
| `interval(Duration)` | Tempo entre os inícios das execuções (padrão 60 s, no mínimo 10 ms). |
| `lease(Duration)` | Tempo para outra instância assumir (padrão 30 s, no mínimo 100 ms). |
| `build_fn(TaskFn) -> RecursiveWorker` | Termina com a tarefa. |

## RekkaClient e ReconcileHandler

O `RekkaClient` tem os mesmos métodos de enfileiramento, `remove`, `state`, `stats`, `purge`, `purge_queue` e `cache` do `Queues`. É barato de clonar e é um extractor. Veja [Jobs e enfileiramento](/pt-br/docs/rekka/queues/jobs).

| Método do `ReconcileHandler` | Descrição |
| --- | --- |
| `add(J) -> Result<Enqueued>` | Cria o job para rodar agora, se ele não existe e não acabou de terminar. |
| `add_at(J, DateTime<Utc>) -> Result<Enqueued>` | O mesmo, para rodar em um instante. |
| `add_many(impl IntoIterator<Item = J>) -> Result<usize>` | O mesmo, em lote; retorna quantos foram criados. |
| `client() -> &RekkaClient` | O client. |

## Handlers

| Item | Descrição |
| --- | --- |
| `JobHandler` | Primeiro argumento do handler: `queue()`, `task_id()`, `attempt()`, `max_attempts()`, `is_last_attempt()` e os construtores de resultado `success()`, `err(impl Display)`, `cancel()`, `retry_at(DateTime<Utc>)`, `retry_after(Duration)`. |
| `RekkaExecutionResult` | `Success`, `Error(String)`, `Cancel`, `RetryAt(DateTime<Utc>)`, `RetryAfter(Duration)`. |
| `IntoExecutionResult` | Implementado para `RekkaExecutionResult`, `()` e `Result<T: IntoExecutionResult, E: Display>`. |
| `IntoTaskResult` | Tipos de retorno de tarefas recorrentes e de reconcile: `()` e `Result<(), E: Display>`. |
| `JobFn<J, M>` / `TaskFn<M>` | Implementados para `async fn`s com até oito extractors; você nunca os implementa. |
| `RetryPolicy` | `RetryImmediate`, `RetryAfterRange(Duration, Duration)`, `Cancel`. |

Veja [Handlers e extractors](/pt-br/docs/rekka/queues/handlers) e [Retries e falhas](/pt-br/docs/rekka/queues/retries).

## Extractors

| Item | Descrição |
| --- | --- |
| `FromContext` | Trait dos extractors: `from_context(&RekkaContext) -> Result<Self>` e um `validate(&RekkaContext) -> Result<()>` opcional. |
| `RekkaContext` | `data::<T>() -> Option<Arc<T>>`, `has_data::<T>() -> bool`, `client() -> &RekkaClient`. |
| `RekkaData<T>` | Dado registrado; uma tuple struct sobre `Arc<T>` que faz deref para `T`. |
| `RekkaClient`, `Cache`, `ReconcileHandler` | Também são extractors. |

## Status

| Item | Valores |
| --- | --- |
| `Enqueued` | `Created`, `Updated`, `AfterCurrentRun`, `AlreadyExists`, `RecentlyCompleted`. |
| `Removed` | `NotFound`, `Removed`, `DiscardAfterRun`. |
| `JobState` | `Waiting { run_in: Duration, attempts: u32 }`, `Running { attempt: u32 }`, `Blocked { attempts: u32 }`. |
| `QueueStats` | `waiting`, `ready`, `running`, `locked_keys` (todos `u64`). |

Veja [Inspecionar e remover jobs](/pt-br/docs/rekka/queues/managing-jobs).

## Eventos

| Item | Descrição |
| --- | --- |
| `JobEvent` | `source()`, `job_name()`, `kind()`, `task_id()`, `attempt()`, `error()`, `elapsed()`, `retry_in()`, `payload()`, `get_job::<T>()`, `is::<T>()` e os helpers `is_*`. |
| `JobEventKind` | `Started`, `Succeeded`, `Failed`, `Dead`, `Cancelled`, `Rescheduled`, `Stalled`, `Discarded`. |
| `EventSource` | `Queue`, `Recursive`, `Reconcile`. |

Veja [Eventos](/pt-br/docs/rekka/queues/events).

## Cache

| Item | Descrição |
| --- | --- |
| `Cache` | `new(url)`, `builder(url)`, `insert`, `insert_with_ttl`, `insert_many`, `get`, `get_many`, `contains`, `remove`, `remove_many`, `clear`. |
| `CacheBuilder` | `prefix`, `connection_timeout`, `response_timeout`, `connect() -> Result<Cache>`. |
| `RekkaCache` | Trait: `const NAMESPACE: &'static str`, `const TTL: Option<Duration>`, `fn cache_key(&self) -> String`. |

Veja [Tipos de cache](/pt-br/docs/rekka/cache/cache-types) e [Leitura e escrita](/pt-br/docs/rekka/cache/cache-operations).

## Jobs

| Item | Descrição |
| --- | --- |
| `RekkaQueue` | Trait: `const NAME: &'static str` e `fn task_id(&self) -> String`. Exige `Serialize + DeserializeOwned + Send + 'static`. |
| `ToTaskId` | Converte qualquer valor `Display` em um `task_id`. |
| `#[derive(RekkaQueue)]` | Atributos `name`, `crate` e `task_id` em um campo. |
| `#[derive(RekkaCache)]` | Atributos `key` (um campo, ou um template como `"payments-{business_id}"`), `ttl`, `name` e `crate`. |

## Erros

`rekka::Result<T>` é `std::result::Result<T, RekkaError>`. `RekkaError` é non-exhaustive:

| Variante | Quando |
| --- | --- |
| `Redis(redis::RedisError)` | O Redis não pôde ser alcançado ou retornou um erro. |
| `Serialization(serde_json::Error)` | Um job ou valor de cache não pôde ser codificado. |
| `MissingData(&'static str)` | Um `RekkaData<T>` sem `.data(...)` para `T`. |
| `InvalidConfig(String)` | Configuração inválida no builder. |
| `InvalidTaskId` | Um `task_id` vazio. |
| `InvalidKey` | Uma key de cache vazia. |
| `ShutdownTimeout { abandoned: usize }` | O encerramento gracioso estourou o `shutdown_timeout`; `abandoned` jobs voltaram para as filas. |
| `Protocol(String)` | O Redis respondeu algo inesperado. |

## Re-exports

`rekka::chrono` re-exporta o crate `chrono`, para o `DateTime<Utc>` de `schedule`, `add_at` e `retry_at`.
