# Tipos de cache

O cache do Rekka guarda valores tipados no Redis. Você descreve um tipo cacheado uma vez, com a key e o tempo de vida, e lê de volta como esse tipo em qualquer lugar.

## Derivando RekkaCache

```rust
use rekka::RekkaCache;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, RekkaCache)]
#[rekka(key = id, ttl = "10m")]
struct Business {
    id: i64,
    name: String,
    plan: String,
}
```

| Atributo | Padrão | O que faz |
| --- | --- | --- |
| `key = campo` | O campo chamado `key`, depois `id` | O campo que identifica uma entrada. Qualquer tipo `Display`. |
| `key = "payments-{business_id}"` | | Uma key montada a partir dos campos da struct. Veja [Keys dinâmicas](#keys-dinamicas). |
| `ttl = 10m`, `ttl = "1h 30m"` ou `ttl = 600000` | Sem TTL: as entradas nunca expiram | Tempo de vida: uma duração com unidades, com ou sem aspas, ou um número de milissegundos. |
| `name = "businesses"` | Nome da struct em snake_case | O namespace no Redis. Não pode conter `:`, `{` nem `}`. |
| `crate = "path"` | `::rekka` | Caminho do crate `rekka`, para re-exports. |

Uma duração combina números com as unidades `ms`, `s`, `m`, `h` e `d`, com ou sem aspas: `ttl = 500ms`, `ttl = 30s`, `ttl = 10m`, `ttl = 2h`, `ttl = 7d`, `ttl = 1h30m`. Entre aspas, espaços são permitidos: `ttl = "1d 12h"`. Um número sozinho é em milissegundos. Um TTL zero ou mal formado é erro de compilação.

> [!NOTE]
> Uma struct pode derivar `RekkaQueue` e `RekkaCache` ao mesmo tempo. Os dois compartilham `#[rekka(name = "...")]`, então esse nome vira tanto o nome da fila quanto o namespace do cache.

## Keys dinâmicas

`key` também aceita um template que monta a key a partir dos campos da própria struct. Cada `{campo}` é substituído pelo valor daquele campo:

```rust
#[derive(Serialize, Deserialize, RekkaCache)]
#[rekka(key = "payments-{business_id}", ttl = "5m")]
struct PaymentSummary {
    business_id: i64,
    total_cents: i64,
}
```

`PaymentSummary { business_id: 42, .. }` é guardado com a key `payments-42`, e as leituras usam essa mesma key:

```rust
let summary = cache.get::<PaymentSummary>("payments-42").await?;
let summary = cache.get::<PaymentSummary>(format!("payments-{business_id}")).await?;
```

| Template | Exemplo | Key |
| --- | --- | --- |
| Um campo | `"payments-{business_id}"` | `payments-42` |
| Vários campos | `"{tenant}:{user_id}"` | `acme:7` |
| Um campo aninhado | `"owner-{owner.id}"` | `owner-7` |
| Um especificador de formato | `"inv-{number:06}"` | `inv-000042` |
| Chaves literais | `"{{v2}}-{id}"` | `{v2}-7` |

Todo campo usado em um template precisa implementar `Display` (ou o que o especificador de formato exigir). Um template sem nenhum `{campo}`, um campo que a struct não tem ou `{self.campo}` (escreva só `{campo}`) é erro de compilação apontando para o template. Sem chaves, `key = "id"` continua indicando um campo.

## Formato das chaves

Cada entrada é uma string no Redis, guardada como JSON em:

```text
<prefix>:cache:<namespace>:<key>
```

Com o prefixo padrão, `Business { id: 7, .. }` fica em `rekka:cache:business:7`. Uma key vazia é rejeitada com `RekkaError::InvalidKey`.

## Implementando a trait à mão

O derive implementa `RekkaCache`, que você também pode implementar por conta própria quando a key precisa de uma lógica que um template não expressa, por exemplo normalizar um valor:

```rust
use std::time::Duration;

use rekka::RekkaCache;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Subscriber {
    email: String,
    plan: String,
}

impl RekkaCache for Subscriber {
    const NAMESPACE: &'static str = "subscribers";
    const TTL: Option<Duration> = Some(Duration::from_secs(300));

    fn cache_key(&self) -> String {
        self.email.trim().to_lowercase()
    }
}
```

As leituras usam a mesma string: `cache.get::<Subscriber>("ana@example.com")`.

## Obtendo um Cache

| Como | Quando |
| --- | --- |
| `queues.cache()` ou `client.cache()` | Você já roda filas: o cache compartilha a conexão e o prefixo delas. |
| `cache: Cache` como argumento do handler | Dentro de handlers, workers recorrentes e funções de reconcile. |
| `Cache::new(redis_url).await?` | Um cache avulso com as opções padrão. |
| `Cache::builder(redis_url).prefix("app").connect().await?` | Um cache avulso com prefixo ou timeouts próprios. |

```rust
use std::time::Duration;

use rekka::Cache;

let cache = Cache::builder("redis://127.0.0.1:6379")
    .prefix("billing")
    .connection_timeout(Duration::from_secs(2))
    .response_timeout(Duration::from_secs(2))
    .connect()
    .await?;
```

`Cache` é barato de clonar, e todos os clones compartilham uma conexão que reconecta sozinha.

## Mudando um tipo cacheado

As entradas são JSON. Quando uma struct muda e uma entrada antiga não desserializa mais, o Rekka registra um aviso e trata a entrada como ausente, então `get` retorna `None` e o seu código carrega dados novos. Uma mudança incompatível vira cache miss em vez de erro. Para descartar todas as entradas antigas de uma vez, chame [`clear::<T>()`](/pt-br/docs/rekka/cache/cache-operations#removendo).
